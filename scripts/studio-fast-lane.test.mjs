import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fastlane-'));
process.env.STUDIO_DATA_DIR = root;
process.env.STUDIO_PING_OUTBOX = path.join(root, 'outbox');
const m = await import('./studio-fast-lane.mjs');
const NOW = Date.parse('2026-10-22T12:00:00Z');
const proposal = { worthBidding: true, fit: 'strong', fitReason: 'x', coverLetter: 'You need an iOS booking app shipped to the App Store with Stripe deposits. I would build it in SwiftUI.', deliveryDays: 5, approach: [], clarifyingQuestions: [], risks: [], bidUsd: 450 };
const lead = (over = {}) => ({ id: 'freelancer:111', status: 'drafted', title: 'SwiftUI booking app', url: 'https://www.freelancer.com/projects/111', score: 80, tier: 'hot', publishedAt: new Date(NOW - 3600000).toISOString(), createdAt: new Date(NOW - 3600000).toISOString(), reasons: ['Core app build: swiftui'], flags: [], bidCount: 4, usdMin: 250, usdMax: 750, hourly: false, suggestedBidUsd: 450, proposal, ...over });
const store = () => ({ config: { ...m.DEFAULT_CONFIG }, state: { handled: {} } });
const live = (result, ok = true, status = 200) => async () => ({ ok, status, json: async () => (result ? { status: 'success', result } : { status: 'error' }) });

test('candidates: only strong, fresh, uncrowded, unhandled drafts; app builds first', () => {
  const leads = {
    a: lead({ id: 'freelancer:1', reasons: ['Fast deliverable: csv'], score: 95 }),
    b: lead({ id: 'freelancer:2' }),
    stale: lead({ id: 'freelancer:3', publishedAt: new Date(NOW - 20 * 3600000).toISOString() }),
    weak: lead({ id: 'freelancer:4', proposal: { ...proposal, fit: 'ok' } }),
    crowded: lead({ id: 'freelancer:5', bidCount: 90 }),
    sent: lead({ id: 'freelancer:6', status: 'sent' }),
    flagged: lead({ id: 'freelancer:7', flags: ['Red flag: telegram'] }),
    seen: lead({ id: 'freelancer:8' }),
  };
  const s = store(); s.state.handled['freelancer:8'] = { at: new Date(NOW).toISOString() };
  const ids = m.fastLaneCandidates(leads, new Map(), s, NOW).map(l => l.id);
  assert.deepEqual(ids, ['freelancer:2', 'freelancer:1']);
});

test('live listing bid count overrides the stale cached one', () => {
  const ids = m.fastLaneCandidates({ x: lead() }, new Map([['freelancer:111', { bidCount: 60 }]]), store(), NOW);
  assert.equal(ids.length, 0);
});

test('live check drops closed, missing and crowded listings', async () => {
  assert.equal((await m.liveCheck('freelancer:1', { fetchImpl: live({ status: 'active', frontend_project_status: 'open', bid_stats: { bid_count: 7 } }) })).ok, true);
  assert.match((await m.liveCheck('freelancer:1', { fetchImpl: live({ status: 'closed' }) })).reason, /closed/);
  assert.match((await m.liveCheck('freelancer:1', { fetchImpl: live(null, false, 404) })).reason, /404/);
  assert.match((await m.liveCheck('freelancer:1', { fetchImpl: live({ status: 'active', bid_stats: { bid_count: 120 } }) })).reason, /120 live bids/);
});

test('ping carries everything needed to send from a phone', () => {
  const text = m.pingText(lead(), { bids: 6 });
  assert.match(text, /BID NOW/); assert.match(text, /6 bids so far/); assert.match(text, /\$450/);
  assert.ok(text.includes(proposal.coverLetter)); assert.ok(text.includes('https://www.freelancer.com/projects/111'));
});

test('a full pass pings once per lead, dedupes and respects off mode', async () => {
  const leads = await import('./studio-leads.mjs');
  fs.writeFileSync(path.join(root, 'leads.json'), JSON.stringify({ version: 1, leads: { 'freelancer:111': lead() }, daily: {}, receipts: [] }));
  fs.writeFileSync(path.join(root, 'sources.json'), JSON.stringify({ version: 1, sources: [], listings: [], receipts: [] }));
  assert.ok(leads.readLeads().leads['freelancer:111']);
  const fetchImpl = live({ status: 'active', frontend_project_status: 'open', bid_stats: { bid_count: 5 } });
  const first = await m.runFastLane({ now: NOW, fetchImpl });
  assert.deepEqual(first.actions.map(a => a.outcome), ['pinged']);
  assert.equal(fs.readdirSync(process.env.STUDIO_PING_OUTBOX).length, 1);
  const again = await m.runFastLane({ now: NOW + 300000, fetchImpl });
  assert.equal(again.actions.length, 0);
  m.setMode('off');
  assert.equal((await m.runFastLane({ now: NOW, fetchImpl })).actions.length, 0);
  assert.throws(() => m.setMode('turbo'), /Mode must be/);
});

// ---- auto-bid (mocked Freelancer API; nothing leaves the machine) ----
const freshStore = (leadsById) => {
  fs.rmSync(path.join(root, 'fast-lane.json'), { force: true });
  fs.rmSync(process.env.STUDIO_PING_OUTBOX, { recursive: true, force: true });
  fs.writeFileSync(path.join(root, 'leads.json'), JSON.stringify({ version: 1, leads: leadsById, daily: {}, receipts: [] }));
};
const openListing = { status: 'active', frontend_project_status: 'open', type: 'fixed', currency: { code: 'USD' }, budget: { minimum: 250, maximum: 750 }, bid_stats: { bid_count: 5 } };
function freelancerApi({ listing = openListing, bidError = null, award = 'pending', acceptError = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url), method = opts.method || 'GET';
    calls.push({ u, method, body: opts.body ? JSON.parse(opts.body) : null, token: opts.headers?.['Freelancer-OAuth-V1'] });
    const ok = (result) => ({ ok: true, status: 200, json: async () => ({ status: 'success', result }) });
    if (u.includes('/users/0.1/self/')) return ok({ id: 4242 });
    if (u.includes('/projects/0.1/bids/9001/') && method === 'PUT') return acceptError ? { ok: false, status: 403, json: async () => ({ status: 'error', message: acceptError }) } : ok({});
    if (u.includes('/projects/0.1/bids/') && method === 'POST') return bidError ? { ok: false, status: 409, json: async () => ({ status: 'error', message: bidError, error_code: 'X' }) } : ok({ id: 9001 });
    if (u.includes('/projects/0.1/bids/')) return ok({ bids: [{ id: 9001, award_status: award }] });
    if (u.includes('/projects/0.1/projects/')) return ok(listing);
    throw new Error(`unexpected ${u}`);
  };
  return { fetchImpl, calls, posts: () => calls.filter(c => c.method === 'POST') };
}


// Auto mode bids only on leads the studio-bid loop vetted as autonomous work.
const vet = { verdict: 'bid', deliveryClass: 'static-site', autonomy: 9, reasons: 'Self-contained landing page.', acceptanceCriteria: ['Responsive at 390px and 1440px', 'Contact form posts to the client endpoint'], inputsNeededFromClient: [], humanOnly: [], estimatedHours: 6, deliveryDays: 3, bidUsd: 400, coverLetter: proposal.coverLetter, vettedAt: new Date(NOW - 3600000).toISOString() };
const vetted = (over = {}) => lead({ title: 'Landing page', reasons: ['Fast deliverable: landing page'], vet, ...over });

test('bid terms: USD fixed-price only, under the ceiling, inside the live budget', () => {
  const live = { ok: true, currency: 'USD', type: 'fixed', budgetMin: 250, budgetMax: 750 };
  assert.equal(m.bidTerms(lead(), live).ok, true);
  assert.equal(m.bidTerms(lead(), live).amount, 450);
  assert.match(m.bidTerms(lead({ hourly: true }), live).reason, /hourly/);
  assert.match(m.bidTerms(lead(), { ...live, currency: 'INR' }).reason, /INR/);
  assert.match(m.bidTerms(lead(), { ...live, budgetMax: 300 }).reason, /outside the live budget/);
  assert.match(m.bidTerms(lead({ proposal: { ...proposal, bidUsd: 2000 } }), { ...live, budgetMax: 5000 }).reason, /ceiling/);
  assert.match(m.bidTerms(lead({ proposal: { ...proposal, coverLetter: 'too short' } }), live).reason, /cover letter/);
});

test('auto mode places one bid with the drafted terms, marks the lead sent, and dedupes', async () => {
  freshStore({ 'freelancer:111': vetted() });
  m.setMode('auto');
  const api = freelancerApi();
  const r = await m.runFastLane({ now: NOW, fetchImpl: api.fetchImpl, token: 'tok', listings: [] });
  assert.deepEqual(r.actions.map(a => a.outcome), ['bid_placed', 'award_accepted']);
  const [post] = api.posts();
  assert.equal(post.token, 'tok');
  assert.deepEqual({ ...post.body, description: undefined }, { project_id: 111, bidder_id: 4242, amount: 400, period: 3, milestone_percentage: 50, description: undefined });
  assert.equal(post.body.description, proposal.coverLetter);
  const leads = await import('./studio-leads.mjs');
  const saved = leads.readLeads();
  assert.equal(saved.leads['freelancer:111'].status, 'sent');
  assert.equal(saved.leads['freelancer:111'].sentDetail.by, 'autobid');
  assert.equal(saved.leads['freelancer:111'].sentDetail.bidId, 9001);
  assert.ok(saved.receipts.some(x => x.outcome === 'autobid_sent'));
  const again = await m.runFastLane({ now: NOW + 300000, fetchImpl: api.fetchImpl, token: 'tok', listings: [] });
  assert.equal(api.posts().length, 1, 'never bids twice on one listing');
  assert.equal(again.actions.filter(a => a.outcome.startsWith('award')).length, 0, 'an award is accepted once');
});

test('an accepted award becomes Won; a rejected bid becomes Lost', async () => {
  freshStore({ 'freelancer:111': vetted(), 'freelancer:222': vetted({ id: 'freelancer:222', url: 'https://www.freelancer.com/projects/222' }) });
  m.setMode('auto');
  const placing = freelancerApi({ award: 'none' });
  await m.runFastLane({ now: NOW, fetchImpl: placing.fetchImpl, token: 'tok', listings: [] });
  assert.equal(placing.posts().length, 2);
  const leads = await import('./studio-leads.mjs');
  const rejected = freelancerApi({ award: 'rejected' });
  const r = await m.runFastLane({ now: NOW + 600000, fetchImpl: rejected.fetchImpl, token: 'tok', listings: [] });
  assert.deepEqual(r.actions.map(a => a.outcome).sort(), ['lost', 'lost']);
  assert.equal(leads.readLeads().leads['freelancer:111'].status, 'lost');
});

test('caps, ceiling and missing token fall back to a ping instead of a bid', async () => {
  freshStore({ 'freelancer:1': vetted({ id: 'freelancer:1' }), 'freelancer:2': vetted({ id: 'freelancer:2' }), 'freelancer:3': vetted({ id: 'freelancer:3' }) });
  m.setMode('auto');
  const api = freelancerApi({ award: 'none' });
  const r = await m.runFastLane({ now: NOW, fetchImpl: api.fetchImpl, token: 'tok', listings: [] });
  assert.equal(api.posts().length, m.DEFAULT_CONFIG.dailyBids);
  const capped = r.actions.find(a => a.outcome === 'pinged');
  assert.match(capped.note, /daily bid cap/);
  freshStore({ 'freelancer:4': vetted({ id: 'freelancer:4' }) });
  m.setMode('auto');
  const noToken = await m.runFastLane({ now: NOW, fetchImpl: api.fetchImpl, token: null, listings: [] });
  assert.match(noToken.actions[0].note, /no Freelancer token/);
  assert.equal(api.posts().length, m.DEFAULT_CONFIG.dailyBids);
});

test('a refused bid pauses auto mode; repeated refusals switch back to ping', async () => {
  freshStore({ 'freelancer:1': vetted({ id: 'freelancer:1' }), 'freelancer:2': vetted({ id: 'freelancer:2' }) });
  m.setMode('auto');
  const api = freelancerApi({ bidError: 'Insufficient balance' });
  const r = await m.runFastLane({ now: NOW, fetchImpl: api.fetchImpl, token: 'tok', listings: [] });
  assert.equal(r.actions[0].outcome, 'bid_failed');
  assert.match(r.actions[1].note, /paused until/, 'the next lead is pinged, not bid');
  assert.equal(api.posts().length, 1);
  let s = m.readFastLane();
  assert.equal(s.state.failures, 1);
  assert.equal(s.state.handled['freelancer:1'].outcome, 'bid_failed');
  // Simulate the pause expiring twice more with fresh leads.
  for (const [i, id] of [[1, 'freelancer:3'], [2, 'freelancer:4']]) {
    const leads = JSON.parse(fs.readFileSync(path.join(root, 'leads.json'), 'utf8'));
    const fresh = new Date(NOW + i * 7 * 3600000 - 3600000).toISOString();
    leads.leads[id] = vetted({ id, publishedAt: fresh, createdAt: fresh, vet: { ...vet, vettedAt: fresh } });
    fs.writeFileSync(path.join(root, 'leads.json'), JSON.stringify(leads));
    await m.runFastLane({ now: NOW + i * 7 * 3600000, fetchImpl: api.fetchImpl, token: 'tok', listings: [] });
  }
  s = m.readFastLane();
  assert.equal(s.config.mode, 'ping');
  assert.ok(s.receipts.some(x => x.outcome === 'mode_ping'));
});

test('dry run in auto mode reports would_bid and sends nothing', async () => {
  freshStore({ 'freelancer:111': vetted() });
  m.setMode('auto');
  const api = freelancerApi();
  const r = await m.runFastLane({ now: NOW, fetchImpl: api.fetchImpl, token: 'tok', listings: [], dry: true });
  assert.equal(r.actions[0].outcome, 'would_bid');
  assert.equal(api.posts().length, 0);
  assert.equal(fs.existsSync(process.env.STUDIO_PING_OUTBOX), false);
});

test('auto mode leaves unvetted non-app drafts for the bid loop and pings app builds', async () => {
  freshStore({ 'freelancer:1': lead({ id: 'freelancer:1', reasons: ['Fast deliverable: csv'] }), 'freelancer:2': lead({ id: 'freelancer:2' }), 'freelancer:3': vetted({ id: 'freelancer:3', vet: { ...vet, verdict: 'skip' } }) });
  m.setMode('auto');
  const api = freelancerApi({ award: 'none' });
  const r = await m.runFastLane({ now: NOW, fetchImpl: api.fetchImpl, token: 'tok', listings: [] });
  assert.deepEqual(r.actions.map(a => [a.id, a.outcome]), [['freelancer:2', 'pinged'], ['freelancer:3', 'vet_skip']]);
  assert.match(r.actions[0].note, /hand-builds/);
  assert.equal(api.posts().length, 0);
  assert.equal(m.readFastLane().state.handled['freelancer:1'], undefined, 'unvetted lead stays open for the loop');
  assert.equal(api.calls.filter(c => c.u.includes('/projects/111')).length, 0);
});

test('a stale vet does not authorize a bid', async () => {
  freshStore({ 'freelancer:111': vetted({ vet: { ...vet, vettedAt: new Date(NOW - 7 * 3600000).toISOString() } }) });
  m.setMode('auto');
  const api = freelancerApi();
  const r = await m.runFastLane({ now: NOW, fetchImpl: api.fetchImpl, token: 'tok', listings: [] });
  assert.equal(r.actions[0].outcome, 'pinged');
  assert.equal(api.posts().length, 0);
});

test('a failed award accept falls back to asking Ian', async () => {
  freshStore({ 'freelancer:111': vetted() });
  m.setMode('auto');
  const api = freelancerApi({ acceptError: 'Not enough balance for the project fee' });
  const r = await m.runFastLane({ now: NOW, fetchImpl: api.fetchImpl, token: 'tok', listings: [] });
  assert.deepEqual(r.actions.map(a => a.outcome), ['bid_placed', 'award_accept_failed']);
  const again = await m.runFastLane({ now: NOW + 300000, fetchImpl: api.fetchImpl, token: 'tok', listings: [] });
  assert.equal(again.actions.length, 0, 'accept is tried once');
});

test('placeVettedBid: the bid loop places one vetted bid under the shared caps', async () => {
  freshStore({ 'freelancer:111': vetted(), 'freelancer:5': lead({ id: 'freelancer:5' }) });
  m.setMode('ping');
  const api = freelancerApi({ award: 'none' });
  const off = await m.placeVettedBid('freelancer:111', { now: NOW, fetchImpl: api.fetchImpl, token: 'tok' });
  assert.equal(off.placed, false); assert.equal(off.ready, true); assert.match(off.reason, /mode is "ping"/);
  m.setMode('auto');
  assert.match((await m.placeVettedBid('freelancer:5', { now: NOW, fetchImpl: api.fetchImpl, token: 'tok' })).reason, /no fresh passing vet/);
  const r = await m.placeVettedBid('freelancer:111', { now: NOW, fetchImpl: api.fetchImpl, token: 'tok' });
  assert.equal(r.placed, true); assert.equal(r.bidId, 9001);
  assert.equal(api.posts()[0].body.amount, 400);
  const s = m.readFastLane();
  assert.equal(s.state.dayBids, 1); assert.equal(s.state.handled['freelancer:111'].outcome, 'bid_placed');
  assert.match((await m.placeVettedBid('freelancer:111', { now: NOW, fetchImpl: api.fetchImpl, token: 'tok' })).reason, /lead is sent/);
});
