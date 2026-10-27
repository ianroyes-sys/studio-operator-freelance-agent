// Studio fast lane: the last mile between a drafted proposal and a placed bid.
//
// The 2026-10-21 audit: proposals were drafted within minutes of a listing appearing, but the
// twice-daily closer re-checked them 3–12 hours later, when every one already had 80–200 bids.
// This runs on every 5-minute discovery tick instead. For each fresh, strong draft it re-checks the
// listing live and, if it is still open and uncrowded, either
//   - mode "ping": pings you (a JSON file in the ping outbox + a macOS banner) with the finished cover letter;
//   - mode "auto": places the bid itself through Freelancer's official API with Ian's own token
//     (authorized by Ian 2026-10-22), inside hard limits: daily/monthly caps, a per-bid USD ceiling,
//     fixed-price USD listings only, the drafted price only while it sits inside the live budget.
//     Anything outside the limits falls back to a ping. An API refusal pauses auto mode for a few
//     hours; repeated refusals drop back to ping mode, so a broken account never silently eats leads.
//
// 2026-10-26 (Ian): bidding became a loop. In auto mode an unattended bid now also needs a passing
// vet from the studio-bid loop (scripts/studio-vet.mjs): proof the studio-deliver loop can finish the
// work alone. The loop places vetted bids through placeVettedBid(); this tick places them too when it
// sees one first. Unvetted non-app drafts are left for the loop instead of pinged; app builds (Ian
// hand-builds those) still ping. With autoAcceptAwards on, an award offer on a vetted bid is accepted
// and the won lead is handed to the delivery loop (scripts/studio-deliver.mjs).
// It never deposits money or withdraws funds.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { vetAllowsBid, vetIsAutonomous } from './studio-vet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = () => process.env.STUDIO_DATA_DIR || path.join(ROOT, 'data/studio');
const file = () => path.join(directory(), 'fast-lane.json');
const lockFile = () => path.join(directory(), 'fast-lane.lock');
const OUTBOX = () => process.env.STUDIO_PING_OUTBOX || path.join(directory(), 'outbox');
const API = 'https://www.freelancer.com/api';
export const KEYCHAIN = Object.freeze({ account: 'studio-operator', service: 'studio-operator:freelancer-oauth-token' });
export const MODES = Object.freeze(['off', 'ping', 'auto']);

export const DEFAULT_CONFIG = Object.freeze({
  mode: 'ping',
  maxAgeHours: 8,          // older than this and the listing is usually flooded
  maxLiveBids: 30,         // more live bids than this and a new bid rarely gets read
  minScore: 60,
  fits: ['strong'],        // drafter verdicts worth interrupting Ian for, or bidding unattended
  dailyPings: 6,
  // Auto-bid limits.
  dailyBids: 2,
  monthlyBids: 6,          // the free plan allows a handful of bids a month; spend them on the best
  maxBidUsd: 1500,         // never commit to more than this without Ian looking
  milestonePercentage: 50,
  pauseHoursOnError: 6,
  maxConsecutiveFailures: 3,
  // Accept award offers on vetted bids so the delivery loop can start (Ian, 2026-10-26). Freelancer
  // takes its project fee from the account when an award is accepted.
  autoAcceptAwards: true,
});

const ageHours = (at, now) => at ? (now - Date.parse(at)) / 3600000 : Infinity;
export const numericId = (leadId) => /^freelancer:(\d+)$/.exec(leadId || '')?.[1] || null;

export function readFastLane() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('The fast-lane store could not be read. Existing data was preserved.'); }
  return {
    version: 1,
    config: { ...DEFAULT_CONFIG, ...(saved.config || {}) },
    state: { day: null, dayPings: 0, dayBids: 0, month: null, monthBids: 0, bidderId: null, pausedUntil: null, failures: 0, lastError: null, handled: {}, ...(saved.state || {}) },
    receipts: saved.receipts || [],
  };
}
function writeFastLane(store) {
  fs.mkdirSync(directory(), { recursive: true });
  // Listings expire long before two weeks; older handled ids are dead weight. Placed bids stay
  // until their award resolves, because award tracking reads them.
  const cutoff = Date.now() - 14 * 86400000;
  for (const [id, h] of Object.entries(store.state.handled)) if (Date.parse(h.at) < cutoff && h.outcome !== 'bid_placed') delete store.state.handled[id];
  store.receipts = store.receipts.slice(-300);
  const tmp = path.join(directory(), `fast-lane.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

// One pass at a time: two overlapping passes could bid on the same listing twice.
function lock() {
  fs.mkdirSync(directory(), { recursive: true });
  try { fs.writeFileSync(lockFile(), String(process.pid), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (Date.now() - fs.statSync(lockFile()).mtimeMs < 10 * 60000) return null;
    fs.writeFileSync(lockFile(), String(process.pid)); // a crashed pass left it behind
  }
  return () => fs.rmSync(lockFile(), { force: true });
}

// Ian's own Freelancer OAuth token: env for tests/one-offs, otherwise the login keychain entry
// that `node scripts/studio-fast-lane.mjs set-token` creates. Never logged or written to disk.
export function readToken() {
  if (process.env.FREELANCER_OAUTH_TOKEN) return process.env.FREELANCER_OAUTH_TOKEN.trim();
  if (process.env.STUDIO_DATA_DIR) return null; // tests never touch the keychain
  const r = spawnSync('/usr/bin/security', ['find-generic-password', '-a', KEYCHAIN.account, '-s', KEYCHAIN.service, '-w'], { encoding: 'utf8', timeout: 10000 });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

// Strong, fresh drafts worth an interruption, best first: core app builds, then score.
export function fastLaneCandidates(leads, listingsById, store, now = Date.now()) {
  const { config, state } = store;
  const appBuild = l => (l.reasons || []).some(r => r.startsWith('Core app build'));
  return Object.values(leads)
    .filter(l => l.status === 'drafted' && l.proposal?.worthBidding && config.fits.includes(l.proposal.fit))
    .filter(l => !state.handled[l.id] && numericId(l.id))
    .filter(l => l.score >= config.minScore && ageHours(l.publishedAt || l.createdAt, now) <= config.maxAgeHours)
    .filter(l => !(l.flags || []).some(f => /^Red flag|^Out of scope/.test(f)))
    .filter(l => { const bids = listingsById.get(l.id)?.bidCount ?? l.bidCount; return bids == null || bids <= config.maxLiveBids; })
    .sort((a, b) => appBuild(b) - appBuild(a) || b.score - a.score);
}

// Public, unauthenticated: is the listing still open and still winnable right now?
export async function liveCheck(leadId, { fetchImpl = fetch, maxLiveBids = DEFAULT_CONFIG.maxLiveBids } = {}) {
  const r = await fetchImpl(`${API}/projects/0.1/projects/${numericId(leadId)}/`, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.status !== 'success' || !json.result) return { ok: false, reason: `listing unavailable (HTTP ${r.status})` };
  const p = json.result, bids = p.bid_stats?.bid_count ?? null;
  if (p.status !== 'active' || (p.frontend_project_status && p.frontend_project_status !== 'open')) return { ok: false, reason: `listing ${p.sub_status || p.status}` };
  if (bids !== null && bids > maxLiveBids) return { ok: false, reason: `${bids} live bids`, bids };
  return { ok: true, bids, currency: p.currency?.code || null, budgetMin: p.budget?.minimum ?? null, budgetMax: p.budget?.maximum ?? null, type: p.type || null };
}

// The drafted cover letter states its price in USD, so unattended bids go only to fixed-price USD
// listings, at the drafted price, under the ceiling, and only while it is inside the live budget.
export function bidTerms(lead, live, config = DEFAULT_CONFIG) {
  const amount = lead.proposal?.bidUsd ?? lead.suggestedBidUsd;
  if (lead.hourly || (live.type && live.type !== 'fixed')) return { ok: false, reason: 'hourly listing' };
  if (live.currency !== 'USD') return { ok: false, reason: `listing priced in ${live.currency || 'an unknown currency'}` };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'no bid price' };
  if (amount > config.maxBidUsd) return { ok: false, reason: `$${amount} is over the $${config.maxBidUsd} auto-bid ceiling` };
  if ((live.budgetMin != null && amount < live.budgetMin) || (live.budgetMax != null && amount > live.budgetMax)) return { ok: false, reason: `$${amount} is outside the live budget` };
  const description = String(lead.proposal.coverLetter || '').trim();
  if (description.length < 100 || description.length > 1500) return { ok: false, reason: 'cover letter length out of range' };
  const period = Number.isInteger(lead.proposal.deliveryDays) && lead.proposal.deliveryDays > 0 ? lead.proposal.deliveryDays : 3;
  return { ok: true, amount, period, milestone_percentage: config.milestonePercentage, description };
}

export async function api(token, method, pathname, { body, query, fetchImpl = fetch } = {}) {
  const url = new URL(`${API}${pathname}`);
  if (query) for (const [k, v] of Object.entries(query)) for (const x of [].concat(v)) url.searchParams.append(k, String(x));
  const r = await fetchImpl(url, { method, headers: { Accept: 'application/json', 'Freelancer-OAuth-V1': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(20000) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.status !== 'success') { const e = new Error(json.message || `Freelancer API HTTP ${r.status}`); e.code = json.error_code || r.status; throw e; }
  return json.result;
}

export async function bidderId(token, store, { fetchImpl } = {}) {
  if (store.state.bidderId) return store.state.bidderId;
  const self = await api(token, 'GET', '/users/0.1/self/', { fetchImpl });
  if (!Number.isSafeInteger(self?.id)) throw new Error('Freelancer did not return your user id.');
  store.state.bidderId = self.id;
  return self.id;
}

export function pingText(lead, live, { placed = false, note = null } = {}) {
  const budget = lead.hourly ? `$${lead.usdMin ?? '?'}–$${lead.usdMax ?? '?'}/h` : `$${lead.usdMin ?? '?'}–$${lead.usdMax ?? '?'}`;
  const price = `$${lead.proposal.bidUsd ?? lead.suggestedBidUsd}${lead.hourly ? '/h' : ''}`;
  const lines = [
    placed ? `✅ BID PLACED — ${price} on ${lead.title.slice(0, 90)}` : `⚡ BID NOW — ${lead.title.slice(0, 90)}`,
    `${budget} · ${live?.bids ?? lead.bidCount ?? '?'} bids so far · score ${lead.score}`,
  ];
  if (note) lines.push(`Not auto-bid: ${note}. Send it by hand:`);
  if (!placed) lines.push('', lead.proposal.coverLetter, '', `Bid ${price} · ${lead.proposal.deliveryDays} day(s)`);
  lines.push(lead.url);
  lines.push(placed ? 'Studio Operator tracks the award.' : 'After sending: Studio → Hot leads → Mark sent.');
  return lines.join('\n');
}

export function notify(text, { title = 'Studio — bid ready', dry = false } = {}) {
  if (dry) return;
  // A ping must never break the caller: a failed write after a placed bid would lose its cap count.
  try {
    fs.mkdirSync(OUTBOX(), { recursive: true });
    fs.writeFileSync(path.join(OUTBOX(), `ping-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-studio.json`), JSON.stringify({ notify: text, source: 'studio-fast-lane' }));
  } catch {}
  if (process.env.STUDIO_DATA_DIR) return; // tests never touch the desktop
  const esc = s => s.replace(/[\\"]/g, ' ').slice(0, 200);
  const [head, meta] = text.split('\n');
  spawnSync('/usr/bin/osascript', ['-e', `display notification "${esc(meta || '')}" with title "${esc(title)}" subtitle "${esc(head)}" sound name "Glass"`], { timeout: 5000 });
}

const paused = () => fs.existsSync(path.join(ROOT, 'STOP')) || fs.existsSync(path.join(directory(), 'FAST-LANE-PAUSED'));

// Why an auto pass would not bid right now, or null when it may.
function autoBlocker(store, token, now) {
  const { config, state } = store;
  if (state.pausedUntil && Date.parse(state.pausedUntil) > now) return `auto-bid paused until ${state.pausedUntil} after: ${state.lastError?.message || 'an API error'}`;
  if (!token) return 'no Freelancer token saved';
  if (state.dayBids >= config.dailyBids) return `daily bid cap reached (${config.dailyBids})`;
  if (state.monthBids >= config.monthlyBids) return `monthly bid cap reached (${config.monthlyBids})`;
  return null;
}

// The vet's sharpened letter, price and timeline replace the first draft's.
function vettedLead(lead) {
  const v = lead.vet;
  return { ...lead, proposal: { ...lead.proposal, coverLetter: v.coverLetter, bidUsd: v.bidUsd, deliveryDays: v.deliveryDays } };
}

// Places one bid inside every limit. Mutates store state; the caller holds the lock and writes it.
async function submitBid(store, token, lead, live, { fetchImpl = fetch, now = Date.now(), dry = false, log = () => {}, updateLead }) {
  const { config, state } = store, at = new Date(now).toISOString();
  const terms = bidTerms(lead, live, config);
  const note = autoBlocker(store, token, now) || (terms.ok ? null : terms.reason);
  if (note) return { outcome: 'pinged', note, bid: null };
  if (dry) return { outcome: 'would_bid', note: null, bid: null };
  try {
    const bidder = await bidderId(token, store, { fetchImpl });
    const bid = await api(token, 'POST', '/projects/0.1/bids/', { fetchImpl, body: { project_id: Number(numericId(lead.id)), bidder_id: bidder, amount: terms.amount, period: terms.period, milestone_percentage: terms.milestone_percentage, description: terms.description } });
    state.dayBids++; state.monthBids++; state.failures = 0;
    try { await updateLead({ id: lead.id, action: 'sent', by: 'autobid', extra: { bidId: bid?.id ?? null, amount: terms.amount, period: terms.period, liveBidsAtSend: live.bids } }); }
    catch (e) { log(`fast lane: bid ${bid?.id} placed but the lead could not be marked sent: ${e.message}`); }
    return { outcome: 'bid_placed', note: null, bid };
  } catch (e) {
    // A refusal is usually account-level (balance, membership, verification): back off.
    state.failures++;
    state.lastError = { at, message: e.message, code: e.code ?? null };
    state.pausedUntil = new Date(now + config.pauseHoursOnError * 3600000).toISOString();
    if (state.failures >= config.maxConsecutiveFailures) {
      config.mode = 'ping';
      store.receipts.push({ at, outcome: 'mode_ping', reason: `${state.failures} bids refused in a row` });
      notify(`⚠️ Auto-bid switched off after ${state.failures} refused bids.\nLast error: ${e.message}\nFix the account, then: node scripts/studio-fast-lane.mjs mode auto`, { title: 'Studio — auto-bid off', dry });
    }
    return { outcome: 'bid_failed', note: `Freelancer refused the bid (${e.message})`, bid: null };
  }
}

function rollCounters(state, now) {
  const day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7);
  if (state.day !== day) { state.day = day; state.dayPings = 0; state.dayBids = 0; }
  if (state.month !== month) { state.month = month; state.monthBids = 0; }
}

async function lockWithWait(tries = 20) {
  for (let i = 0; i < tries; i++) { const release = lock(); if (release) return release; await new Promise(r => setTimeout(r, 3000)); }
  return null;
}

// The studio-bid loop's entry point: place one vetted bid now, under the same lock, caps and
// back-off as the discovery tick. Returns { placed, reason?, bidId? }.
export async function placeVettedBid(leadId, { now = Date.now(), fetchImpl = fetch, dry = false, token, log = () => {} } = {}) {
  if (paused()) return { placed: false, reason: 'paused (STOP or FAST-LANE-PAUSED)' };
  const release = await lockWithWait(process.env.STUDIO_DATA_DIR ? 1 : 20);
  if (!release) return { placed: false, reason: 'fast lane busy; retry next pass' };
  try {
    const store = readFastLane(), { config, state } = store;
    rollCounters(state, now);
    const { readLeads, updateLead } = await import('./studio-leads.mjs');
    const lead = readLeads().leads[leadId];
    if (!lead) return { placed: false, reason: 'lead not found' };
    if (lead.status !== 'drafted') return { placed: false, reason: `lead is ${lead.status}` };
    if (!vetAllowsBid(lead.vet, now)) return { placed: false, reason: 'no fresh passing vet (verdict bid, ≤6h, all rules)' };
    if (config.mode !== 'auto') return { placed: false, ready: true, reason: `auto-bid mode is "${config.mode}"${readToken() ? '' : ' and no Freelancer token is saved'}` };
    if (token === undefined) token = readToken();
    const live = await liveCheck(leadId, { fetchImpl, maxLiveBids: config.maxLiveBids });
    const at = new Date(now).toISOString();
    if (!live.ok) {
      state.handled[leadId] = { at, outcome: 'dropped', reason: live.reason };
      store.receipts.push({ at, id: leadId, outcome: 'dropped', reason: live.reason });
      if (!dry) writeFastLane(store);
      return { placed: false, reason: live.reason };
    }
    const vetted = vettedLead(lead);
    const { outcome, note, bid } = await submitBid(store, token, vetted, live, { fetchImpl, now, dry, log, updateLead });
    if (outcome === 'bid_placed') {
      notify(pingText(vetted, live, { placed: true }), { title: 'Studio — bid placed', dry });
      state.handled[leadId] = { at, outcome, liveBids: live.bids ?? null, bidId: bid?.id ?? null, amount: vetted.proposal.bidUsd, by: 'studio-bid' };
    }
    store.receipts.push({ at, id: leadId, outcome, by: 'studio-bid', liveBids: live.bids ?? null, ...(note ? { note } : {}), ...(bid?.id ? { bidId: bid.id } : {}) });
    if (!dry) writeFastLane(store);
    return { placed: outcome === 'bid_placed', ...(note ? { reason: note } : {}), ...(bid?.id ? { bidId: bid.id } : {}), ...(outcome === 'would_bid' ? { wouldBid: true } : {}) };
  } finally { release(); }
}

// One fast-lane pass. Called from every discovery tick; safe to run standalone.
// The discovery tick passes its listings in: importing studio-sources.mjs from inside its own
// top-level await deadlocks the import (exit 13, the fast lane never runs).
export async function runFastLane({ now = Date.now(), fetchImpl = fetch, dry = false, log = () => {}, listings = null, token } = {}) {
  const first = readFastLane();
  if (first.config.mode === 'off' || paused()) return { mode: first.config.mode, paused: paused(), actions: [] };
  const release = lock();
  if (!release) return { mode: first.config.mode, busy: true, actions: [] };
  try {
    const store = readFastLane();
    const { config, state } = store;
    const { readLeads, updateLead } = await import('./studio-leads.mjs');
    if (!listings) listings = (await import('./studio-sources.mjs')).readSources().listings;
    const listingsById = new Map(listings.map(l => [l.id, l]));
    rollCounters(state, now);
    const auto = config.mode === 'auto';
    if (auto && token === undefined) token = readToken();
    const actions = [];
    for (const lead of fastLaneCandidates(readLeads().leads, listingsById, store, now).slice(0, 5)) {
      if (state.dayPings >= config.dailyPings) break;
      const appBuild = (lead.reasons || []).some(r => r.startsWith('Core app build'));
      // Not vetted yet: the studio-bid loop decides whether it is autonomous work. Leave it unhandled.
      if (auto && !appBuild && !lead.vet) continue;
      if (auto && lead.vet?.verdict === 'skip') {
        state.handled[lead.id] = { at: new Date(now).toISOString(), outcome: 'vet_skip' };
        actions.push({ id: lead.id, outcome: 'vet_skip' });
        continue;
      }
      let live;
      try { live = await liveCheck(lead.id, { fetchImpl, maxLiveBids: config.maxLiveBids }); }
      catch (e) { log(`fast lane: live check failed for ${lead.id}: ${e.message}`); continue; }
      const at = new Date(now).toISOString();
      if (!live.ok) {
        state.handled[lead.id] = { at, outcome: 'dropped', reason: live.reason };
        store.receipts.push({ at, id: lead.id, outcome: 'dropped', liveBids: live.bids ?? null, reason: live.reason });
        actions.push({ id: lead.id, outcome: 'dropped', reason: live.reason });
        continue;
      }
      let outcome = 'pinged', note = null, bid = null, sentLead = lead;
      if (auto) {
        if (!vetAllowsBid(lead.vet, now)) {
          note = lead.vet ? `vet says ${lead.vet.verdict}: ${lead.vet.reasons.slice(0, 160)}` : 'app build — Ian hand-builds these';
        } else {
          sentLead = vettedLead(lead);
          ({ outcome, note, bid } = await submitBid(store, token, sentLead, live, { fetchImpl, now, dry, log, updateLead }));
        }
      }
      if (outcome !== 'would_bid') {
        notify(pingText(sentLead, live, { placed: outcome === 'bid_placed', note }), { title: outcome === 'bid_placed' ? 'Studio — bid placed' : 'Studio — bid ready', dry });
        state.dayPings++;
      }
      state.handled[lead.id] = { at, outcome, liveBids: live.bids ?? null, ...(note ? { note } : {}), ...(bid?.id ? { bidId: bid.id, amount: sentLead.proposal.bidUsd } : {}) };
      store.receipts.push({ at, id: lead.id, outcome, liveBids: live.bids ?? null, ...(note ? { note } : {}), ...(bid?.id ? { bidId: bid.id } : {}) });
      actions.push({ id: lead.id, outcome, ...(note ? { note } : {}) });
    }
    if (token && (auto || Object.values(state.handled).some(h => h.outcome === 'bid_placed'))) {
      try { actions.push(...await trackAwards({ token, store, fetchImpl, now, dry })); }
      catch (e) { log(`fast lane: award tracking failed: ${e.message}`); }
    }
    if (!dry) writeFastLane(store);
    return { mode: config.mode, actions };
  } finally { release(); }
}

// Bids the agent placed: an award offer pings Ian to accept (a contract is his call); an accepted award
// becomes Won and flows into the existing Studio autopilot; a rejected or revoked bid becomes Lost.
export async function trackAwards({ token, store, fetchImpl = fetch, now = Date.now(), dry = false }) {
  const { readLeads, updateLead, convertWonLead, autopilotWonJob } = await import('./studio-leads.mjs');
  const open = Object.values(readLeads().leads).filter(l => l.status === 'sent' && l.sentDetail?.by === 'autobid' && l.sentDetail.bidId);
  if (!open.length) return [];
  const result = await api(token, 'GET', '/projects/0.1/bids/', { fetchImpl, query: { 'bids[]': open.map(l => l.sentDetail.bidId), limit: 100 } });
  const byId = new Map((result?.bids || []).map(b => [b.id, b]));
  const actions = [], at = new Date(now).toISOString();
  for (const lead of open) {
    const bid = byId.get(lead.sentDetail.bidId), status = bid?.award_status || null;
    const seen = store.state.handled[lead.id] || { at, outcome: 'bid_placed' };
    if (status === 'pending' && store.config.autoAcceptAwards && vetIsAutonomous(lead.vet) && !seen.acceptTried && !dry) {
      // Ian authorized the whole bid → win → deliver chain for vetted work (2026-10-26).
      store.state.handled[lead.id] = { ...seen, acceptTried: at };
      try {
        await api(token, 'PUT', `/projects/0.1/bids/${bid.id}/`, { fetchImpl, query: { action: 'accept' } });
        notify(`🏆 AWARD ACCEPTED — ${lead.title.slice(0, 90)} at $${lead.sentDetail.amount}\nThe studio-deliver loop takes it from here.\n${lead.url}`, { title: 'Studio — award accepted', dry });
        actions.push({ id: lead.id, outcome: 'award_accepted' });
      } catch (e) {
        notify(`🏆 AWARDED — ${lead.title.slice(0, 90)} at $${lead.sentDetail.amount}\nAuto-accept failed (${e.message}). Accept it on Freelancer:\n${lead.url}`, { title: 'Studio — award offered', dry });
        actions.push({ id: lead.id, outcome: 'award_accept_failed', error: e.message });
      }
    } else if (status === 'pending' && !seen.awardPinged && !seen.acceptTried) {
      notify(`🏆 AWARDED — ${lead.title.slice(0, 90)} at $${lead.sentDetail.amount}\nAccept it on Freelancer (auto-accept is off):\n${lead.url}`, { title: 'Studio — award offered', dry });
      store.state.handled[lead.id] = { ...seen, awardPinged: true };
      actions.push({ id: lead.id, outcome: 'award_offered' });
    } else if (status === 'awarded' && !dry) {
      await updateLead({ id: lead.id, action: 'won', priceUsd: lead.sentDetail.amount, by: 'autobid', extra: { bidId: bid.id } });
      const { jobId, existing } = await convertWonLead(lead.id);
      // Vetted autonomous work belongs to the studio-deliver loop; anything else keeps the Studio autopilot.
      if (vetIsAutonomous(lead.vet)) await (await import('./studio-deliver.mjs')).openDeliveries({ log: () => {} }).catch(() => {});
      else if (!existing) await autopilotWonJob(jobId).catch(() => {});
      store.state.handled[lead.id] = { ...seen, at, outcome: 'won' };
      actions.push({ id: lead.id, outcome: 'won', jobId });
    } else if (['rejected', 'revoked', 'canceled'].includes(status) && !dry) {
      await updateLead({ id: lead.id, action: 'lost', by: 'autobid', extra: { awardStatus: status } });
      store.state.handled[lead.id] = { ...seen, at, outcome: 'lost' };
      actions.push({ id: lead.id, outcome: 'lost' });
    }
  }
  return actions;
}

export function setMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`Mode must be one of: ${MODES.join(', ')}`);
  const store = readFastLane();
  store.config.mode = mode;
  if (mode === 'auto') { store.state.pausedUntil = null; store.state.failures = 0; }
  store.receipts.push({ at: new Date().toISOString(), outcome: `mode_${mode}` });
  writeFastLane(store);
  return store.config;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'mode') {
    if (arg === 'auto' && !readToken()) { console.error('No Freelancer token yet. Run: node scripts/studio-fast-lane.mjs set-token'); process.exit(1); }
    console.log(JSON.stringify(setMode(arg), null, 2));
  } else if (cmd === 'set-token') {
    // `security` prompts for the value itself, so the token never lands in argv or shell history.
    const r = spawnSync('/usr/bin/security', ['add-generic-password', '-U', '-a', KEYCHAIN.account, '-s', KEYCHAIN.service, '-w'], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
    const store = readFastLane(); store.state.bidderId = null;
    try { console.log(`Token saved. Freelancer user id: ${await bidderId(readToken(), store)}`); writeFastLane(store); }
    catch (e) { console.error(`Token saved, but Freelancer rejected it: ${e.message}`); process.exit(1); }
  } else if (cmd === 'run' || cmd === '--dry') {
    console.log(JSON.stringify(await runFastLane({ dry: cmd === '--dry', log: m => console.error(m) }), null, 2));
  } else {
    const { config, state, receipts } = readFastLane();
    console.log(JSON.stringify({ config, token: readToken() ? 'saved' : 'missing', state: { ...state, handled: Object.keys(state.handled).length }, lastReceipts: receipts.slice(-8) }, null, 2));
  }
}
