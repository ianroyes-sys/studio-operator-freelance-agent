import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bid-deliver-'));
process.env.STUDIO_DATA_DIR = root;
process.env.STUDIO_PING_OUTBOX = path.join(root, 'outbox');
const vetMod = await import('./studio-vet.mjs');
const bid = await import('./studio-bid.mjs');
const del = await import('./studio-deliver.mjs');
const NOW = Date.parse('2026-10-26T12:00:00Z');
const letter = 'Your bakery needs a fast one-page site that turns Instagram visitors into catering orders. I would build it in clean HTML/CSS with an order form. Price $300, 3 days.';
const goodVet = { verdict: 'bid', deliveryClass: 'static-site', autonomy: 9, reasons: 'Self-contained page, copy supplied.', acceptanceCriteria: ['Responsive at 390px and 1440px', 'Order form validates required fields'], inputsNeededFromClient: ['Logo file'], humanOnly: [], estimatedHours: 5, deliveryDays: 3, bidUsd: 300, coverLetter: letter };

test('vet: a bid must be autonomous work inside every hard rule', () => {
  assert.equal(vetMod.validateVet(goodVet).verdict, 'bid');
  const bad = over => assert.throws(() => vetMod.validateVet({ ...goodVet, ...over }));
  bad({ deliveryClass: 'ios-app' });
  bad({ autonomy: 7 });
  bad({ humanOnly: ['Phone call with the client'] });
  bad({ acceptanceCriteria: ['Looks good'] });
  bad({ estimatedHours: 40 });
  bad({ deliveryDays: 10 });
  bad({ bidUsd: 2000 });
  bad({ coverLetter: `${letter} Reach me on telegram.` });
  bad({ coverLetter: `${letter} ian@example.com` });
  bad({ verdict: 'maybe' });
  // Non-bid verdicts only need a reason.
  assert.equal(vetMod.validateVet({ verdict: 'ping_ian', autonomy: 3, reasons: 'SwiftUI app — Ian builds these.' }).verdict, 'ping_ian');
  assert.throws(() => vetMod.validateVet({ verdict: 'skip', autonomy: 2, reasons: '' }));
});

test('vet: freshness gates bidding, not delivery', () => {
  const v = { ...goodVet, vettedAt: new Date(NOW - 3600000).toISOString() };
  assert.equal(vetMod.vetAllowsBid(v, NOW), true);
  assert.equal(vetMod.vetAllowsBid({ ...v, vettedAt: new Date(NOW - 7 * 3600000).toISOString() }, NOW), false);
  assert.equal(vetMod.vetIsAutonomous({ ...v, vettedAt: new Date(NOW - 30 * 86400000).toISOString() }), true);
  assert.equal(vetMod.vetIsAutonomous({ ...v, verdict: 'ping_ian' }), false);
});

const proposal = { worthBidding: true, fit: 'strong', coverLetter: letter, bidUsd: 300, deliveryDays: 3 };
const lead = (id, over = {}) => ({ id, status: 'drafted', title: `Lead ${id}`, url: `https://www.freelancer.com/projects/${id}`, score: 70, publishedAt: new Date(NOW - 3600000).toISOString(), flags: [], bidCount: 5, proposal, ...over });

test('bid queue: fresh clean drafts not yet decided, best first', () => {
  const leads = {
    a: lead('freelancer:1', { score: 60 }),
    b: lead('freelancer:2', { score: 90 }),
    old: lead('freelancer:3', { publishedAt: new Date(NOW - 30 * 3600000).toISOString() }),
    red: lead('freelancer:4', { flags: ['Red flag: telegram'] }),
    vetted: lead('freelancer:5', { vet: { ...goodVet, vettedAt: new Date(NOW).toISOString() } }),
    staleVet: lead('freelancer:6', { vet: { ...goodVet, vettedAt: new Date(NOW - 8 * 3600000).toISOString() } }),
    skipped: lead('freelancer:7', { vet: { verdict: 'skip', reasons: 'x', vettedAt: new Date(NOW).toISOString() } }),
    dropped: lead('freelancer:8'),
    sent: lead('freelancer:9', { status: 'sent' }),
  };
  const ids = bid.bidQueue(leads, { 'freelancer:8': { outcome: 'dropped' } }, NOW).map(l => l.id);
  assert.deepEqual(ids, ['freelancer:2', 'freelancer:6', 'freelancer:1']);
});

test('recordVet validates before storing and only on drafted leads', async () => {
  fs.writeFileSync(path.join(root, 'leads.json'), JSON.stringify({ version: 1, leads: { 'freelancer:11': lead('freelancer:11'), 'freelancer:12': lead('freelancer:12', { status: 'sent' }) }, daily: {}, receipts: [] }));
  await assert.rejects(bid.recordVet('freelancer:11', { ...goodVet, autonomy: 4 }), /autonomy/);
  const r = await bid.recordVet('freelancer:11', JSON.stringify(goodVet));
  assert.equal(r.bidAllowed, true);
  await assert.rejects(bid.recordVet('freelancer:12', goodVet), /only drafted/);
});

// ---------- delivery ----------
function freelancer(handlers) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url), method = opts.method || 'GET';
    calls.push({ u, method, body: opts.body });
    for (const [match, result] of handlers) if (u.includes(match) && (!result.method || result.method === method)) {
      if (result.error) return { ok: false, status: 400, json: async () => ({ status: 'error', message: result.error }) };
      return { ok: true, status: 200, json: async () => ({ status: 'success', result: typeof result.body === 'function' ? result.body(u, opts) : result.body }) };
    }
    throw new Error(`unexpected ${method} ${u}`);
  };
  return { fetchImpl, calls };
}
const wonLeads = () => fs.writeFileSync(path.join(root, 'leads.json'), JSON.stringify({ version: 1, daily: {}, receipts: [], leads: {
  'freelancer:500': lead('freelancer:500', { status: 'won', wonAt: new Date(NOW).toISOString(), finalPriceUsd: 300, sentDetail: { by: 'autobid', bidId: 77 }, vet: { ...goodVet, vettedAt: new Date(NOW - 86400000).toISOString() } }),
  'freelancer:501': lead('freelancer:501', { status: 'won', finalPriceUsd: 900, vet: { verdict: 'ping_ian', reasons: 'app', autonomy: 2, vettedAt: new Date(NOW).toISOString() } }),
} }));

test('sync opens a workspace only for won, vetted-autonomous leads, once', async () => {
  wonLeads();
  assert.deepEqual((await del.openDeliveries({ now: NOW })).opened, ['freelancer:500']);
  assert.deepEqual((await del.openDeliveries({ now: NOW })).opened, []);
  const d = del.readDeliveries().deliveries['freelancer:500'];
  assert.equal(d.dueAt, new Date(NOW + 3 * 86400000).toISOString());
  const brief = fs.readFileSync(path.join(root, d.workspace, 'BRIEF.md'), 'utf8');
  assert.match(brief, /- \[ \] Responsive at 390px/);
  assert.match(brief, /untrusted client text/);
  assert.equal(del.listDeliveries(NOW)[0].id, 500);
});

test('send: on-platform only, capped per day, opens a thread when none exists', async () => {
  const api = freelancer([
    ['/messages/0.1/threads/?', { body: { threads: [] } }],
    ['/projects/0.1/projects/500/', { body: { owner_id: 321 } }],
    ['/messages/0.1/threads/', { method: 'POST', body: { thread: { id: 9 } } }],
  ]);
  await assert.rejects(del.send('500', 'Email me at ian@example.com', { token: 't', fetchImpl: api.fetchImpl }), /off-platform/);
  await assert.rejects(del.send('500', 'Add me on WhatsApp', { token: 't', fetchImpl: api.fetchImpl }), /off-platform/);
  const r = await del.send('500', 'Thanks for the award! Could you send the logo file here?', { token: 't', fetchImpl: api.fetchImpl, now: NOW });
  assert.equal(r.threadId, 9);
  const post = api.calls.find(c => c.method === 'POST');
  assert.match(post.body, /members%5B%5D=321/);
  assert.match(post.body, /context_type=project/);
  const s = JSON.parse(fs.readFileSync(path.join(root, 'deliveries.json'), 'utf8'));
  s.deliveries['freelancer:500'].messagesSent = { day: new Date(NOW).toISOString().slice(0, 10), count: del.MESSAGES_PER_DAY };
  fs.writeFileSync(path.join(root, 'deliveries.json'), JSON.stringify(s));
  await assert.rejects(del.send('500', 'One more thing', { token: 't', fetchImpl: api.fetchImpl, now: NOW }), /cap/);
});

test('qa gate: needs a passing, complete, fresh review and a clean note', async () => {
  const d = del.readDeliveries().deliveries['freelancer:500'];
  const dir = path.join(root, d.workspace);
  fs.writeFileSync(path.join(dir, 'deliver', 'site.zip'), 'zipbytes');
  assert.throws(() => del.qaGate(d, ['site.zip']), /QA.md missing/);
  fs.writeFileSync(path.join(dir, 'QA.md'), 'VERDICT: FAIL\n');
  assert.throws(() => del.qaGate(d, ['site.zip']), /PASS/);
  fs.writeFileSync(path.join(dir, 'QA.md'), 'VERDICT: PASS\n- [x] Responsive at 390px and 1440px\n');
  assert.throws(() => del.qaGate(d, ['site.zip']), /does not address/);
  fs.writeFileSync(path.join(dir, 'QA.md'), 'VERDICT: PASS\n- [x] Responsive at 390px and 1440px\n- [x] Order form validates required fields\n');
  assert.throws(() => del.qaGate(d, ['site.zip']), /DELIVERY-NOTE/);
  fs.writeFileSync(path.join(dir, 'DELIVERY-NOTE.md'), 'Here is your finished site. Unzip and open index.html; the README covers hosting it anywhere.');
  assert.equal(del.qaGate(d, ['site.zip']).length, 1);
  assert.throws(() => del.qaGate(d, ['../BRIEF.md']), /not inside deliver|empty|ENOENT/);
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dir, 'deliver', 'site.zip'), later, later);
  assert.throws(() => del.qaGate(d, ['site.zip']), /changed after QA/);
  fs.utimesSync(path.join(dir, 'QA.md'), new Date(Date.now() + 10000), new Date(Date.now() + 10000));
});

test('deliver uploads, sends the note, then inbox turns a client reply into a revision', async () => {
  const api = freelancer([
    ['/messages/0.1/threads/9/messages/', { method: 'POST', body: { id: 1 } }],
    ['/messages/0.1/messages/', { body: { messages: [{ id: 5, from_user: 321, message: 'Can the button be green?', time_created: NOW / 1000 }] } }],
    ['/projects/0.1/projects/500/', { body: { owner_id: 321 } }],
  ]);
  const s = JSON.parse(fs.readFileSync(path.join(root, 'deliveries.json'), 'utf8'));
  s.deliveries['freelancer:500'].messagesSent = { day: null, count: 0 };
  fs.writeFileSync(path.join(root, 'deliveries.json'), JSON.stringify(s));
  const r = await del.deliver('500', ['site.zip'], { token: 't', fetchImpl: api.fetchImpl });
  assert.equal(r.delivered, true);
  const posts = api.calls.filter(c => c.method === 'POST');
  assert.ok(posts[0].body instanceof FormData, 'files go up as multipart');
  assert.match(posts[1].body, /finished\+site/);
  const ib = await del.inbox('500', { token: 't', fetchImpl: api.fetchImpl });
  assert.equal(ib.newClientMessages.length, 1);
  assert.equal(del.readDeliveries().deliveries['freelancer:500'].status, 'revision');
  assert.equal((await del.inbox('500', { token: 't', fetchImpl: api.fetchImpl })).newClientMessages.length, 0, 'messages are read once');
});

test('release requests release on funded milestones, asks for one when unfunded, and records payment', async () => {
  await del.setStatus('500', 'building');
  await assert.rejects(del.release('500', { token: 't' }), /Deliver first/);
  const s = JSON.parse(fs.readFileSync(path.join(root, 'deliveries.json'), 'utf8'));
  s.deliveries['freelancer:500'].status = 'delivered';
  fs.writeFileSync(path.join(root, 'deliveries.json'), JSON.stringify(s));
  const unfunded = freelancer([
    ['/users/0.1/self/', { body: { id: 4242 } }],
    ['/projects/0.1/milestones/', { method: 'GET', body: { milestones: {} } }],
    ['/projects/0.1/milestone_requests/', { method: 'POST', body: { id: 3 } }],
  ]);
  const a = await del.release('500', { token: 't', fetchImpl: unfunded.fetchImpl });
  assert.deepEqual(a.actions, [{ milestoneRequested: 300 }]);
  assert.equal(JSON.parse(unfunded.calls.at(-1).body).bid_id, 77);
  const funded = freelancer([
    ['/users/0.1/self/', { body: { id: 4242 } }],
    ['/projects/0.1/milestones/88/', { method: 'PUT', body: {} }],
    ['/projects/0.1/milestones/', { method: 'GET', body: { milestones: { 88: { transaction_id: 88, bidder_id: 4242, status: 'frozen', amount: 300 } } } }],
  ]);
  const b = await del.release('500', { token: 't', fetchImpl: funded.fetchImpl });
  assert.deepEqual(b.actions, [{ requestedRelease: 88, amount: 300 }]);
  const paid = freelancer([
    ['/users/0.1/self/', { body: { id: 4242 } }],
    ['/projects/0.1/milestones/', { body: { milestones: { 88: { transaction_id: 88, bidder_id: 4242, status: 'cleared', amount: 300 } } } }],
  ]);
  assert.equal((await del.release('500', { token: 't', fetchImpl: paid.fetchImpl })).status, 'paid');
  await assert.rejects(del.setStatus('500', 'paid'), /set by deliver/);
});

