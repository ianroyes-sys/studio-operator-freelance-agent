import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const POLL_SECONDS = 300;
// Searches aimed at fast, self-contained text/code work that local production can actually finish.
export const DISCOVERY_QUERIES = Object.freeze(['website', 'landing page', 'automation', 'python script', 'spreadsheet', 'google sheets', 'copywriting', 'article writing', 'technical writing', 'javascript', 'react', 'bug fix', 'ios app', 'swiftui', 'mobile app', 'react native', 'mvp app']);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = () => process.env.STUDIO_DATA_DIR || path.join(ROOT, 'data/studio');
const seeds = [
  { id: 'freelancer', name: 'Freelancer', mode: 'official_api', status: 'not_checked', url: 'https://www.freelancer.com/search/projects', note: 'Public API discovery every 5 minutes while the Mac is awake. Bidding may require an available account balance; discovery never deposits money.' },
];
export function readSources() {
  let state;
  try { state = JSON.parse(fs.readFileSync(path.join(directory(), 'sources.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('The discovery store could not be read. Existing data was preserved.'); }
  if (state) {
    for (const source of state.sources) {
      if (source.status === 'live' && (!source.lastSuccessAt || Date.now() - Date.parse(source.lastSuccessAt) > POLL_SECONDS * 2000)) source.status = 'stale';
    }
    return state;
  }
  return { version: 1, pollSeconds: POLL_SECONDS, updatedAt: null, sources: seeds.map(s => ({ ...s, lastAttemptAt: null, lastSuccessAt: null, nextRefreshAt: null, error: null })), listings: [], receipts: [] };
}
function write(state) {
  fs.mkdirSync(directory(), { recursive: true });
  const tmp = path.join(directory(), `sources.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, path.join(directory(), 'sources.json'));
}
function lock() {
  fs.mkdirSync(directory(), { recursive: true });
  const file = path.join(directory(), 'sources.lock');
  try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let old; try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Discovery lock requires inspection.'); }
    let alive = true; try { process.kill(old.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
    if (alive || Date.now() - old.at < 120000) return null;
    fs.unlinkSync(file);
    return lock();
  }
  return () => { try { const owner = JSON.parse(fs.readFileSync(file, 'utf8')); if (owner.pid === process.pid) fs.unlinkSync(file); } catch {} };
}
export function normalizeProject(p, observedAt = new Date().toISOString()) {
  if (!Number.isSafeInteger(p?.id) || typeof p.title !== 'string' || !p.title.trim()) return null;
  const description = String(p.description || p.preview_description || '');
  const descriptionIncomplete = !p.description || description.length > 30000;
  const text = [p.title, p.description || p.preview_description || '', ...(p.jobs || []).map(j => j.name || '')].join(' ');
  const excluded = /\b(on[- ]site|cold call|phone calls|licensed (?:engineer|attorney)|physical installation|3d print|filming|voice actor|higgsfield|seedance|kling|in person|human only|no ai|no artificial intelligence|paid ads|ad spend|media buyer|facebook ads|google ads|telemarketing|hipaa|pci[- ]dss|legal advice|medical advice|tax advice)\b/i.test(text);
  const skills = [...new Set((p.jobs || []).map(j => j.name).filter(x => typeof x === 'string'))].slice(0,30);
  const suitable = /\b(website|landing page|html|css|javascript|typescript|react|python|spreadsheet|excel|csv|automation|copywriting|technical writ|proofread|data clean|script|dashboard|wordpress|content writ)\b/i.test(text) && !excluded;
  const timestamp = Number(p.time_submitted || p.submitdate);
  return { id: `freelancer:${p.id}`, source: 'freelancer', title: p.title.slice(0,300), description: description.slice(0,30000), descriptionIncomplete, descriptionOriginalLength: description.length, url: typeof p.seo_url === 'string' && /^[a-zA-Z0-9/_-]+$/.test(p.seo_url) ? `https://www.freelancer.com/projects/${p.seo_url}` : `https://www.freelancer.com/projects/${p.id}`, publishedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null, firstSeenAt: observedAt, lastSeenAt: observedAt, currency: /^[A-Z]{3}$/.test(p.currency?.code || '') ? p.currency.code : 'UNKNOWN', budgetMin: Number.isFinite(p.budget?.minimum) ? p.budget.minimum : null, budgetMax: Number.isFinite(p.budget?.maximum) ? p.budget.maximum : null, budgetType: ['hourly','fixed'].includes(p.type) ? p.type : 'unknown', skills, suitable: suitable && !descriptionIncomplete && (!p.status || p.status === 'active'), fitReasons: descriptionIncomplete ? ['Incomplete source description. Open the original listing and supply its full requirements before creating a job.'] : suitable ? ['Text/code deliverable keywords match the configured local-tool services. Confirm scope before committing.'] : [excluded ? 'Potential physical, paid-tool, or AI-restricted requirement: review before pursuing.' : 'No clear local-tool service match in the source text.'], actionBlocker: 'Freelancer currently requires $20 available wallet balance to bid. Discovery is free; bidding and account eligibility are unverified.', availability: typeof p.status === 'string' ? `last_observed_${p.status}` : 'last_observed_in_active_feed', shortlisted: false, bidCount: Number.isSafeInteger(p.bid_stats?.bid_count) ? p.bid_stats.bid_count : null, bidAvg: Number.isFinite(p.bid_stats?.bid_avg) ? Math.round(p.bid_stats.bid_avg) : null, urgent: p.upgrades?.urgent === true || p.urgent === true, language: typeof p.language === 'string' ? p.language.slice(0,8) : null };
}
export function mergeListings(old, fresh) {
  const map = new Map(old.map(row => [row.id, row]));
  for (const row of fresh) { const prior = map.get(row.id); map.set(row.id, { ...prior, ...row, firstSeenAt: prior?.firstSeenAt || row.firstSeenAt, shortlisted: prior?.shortlisted || false }); }
  return [...map.values()].sort((a,b) => (b.publishedAt || b.firstSeenAt).localeCompare(a.publishedAt || a.firstSeenAt)).slice(0,1000);
}
export async function refreshSources({ fetchImpl = fetch, now = new Date(), retryAfterNetworkFix = false } = {}) {
  const release = lock();
  if (!release) return { ...readSources(), refreshing: true };
  try {
    const state = readSources();
    const source = state.sources.find(s => s.id === 'freelancer');
    if (!retryAfterNetworkFix && source.nextRefreshAt && Date.parse(source.nextRefreshAt) > now.getTime()) return { ...state, throttled: true };
    const at = now.toISOString();
    source.lastAttemptAt = at;
    source.nextRefreshAt = new Date(now.getTime() + POLL_SECONDS * 1000).toISOString();
    try {
      const rows = [];
      for (const query of DISCOVERY_QUERIES) {
        const url = new URL('https://www.freelancer.com/api/projects/0.1/projects/active/');
        url.search = new URLSearchParams({ query, limit: '50', compact: 'false', full_description: 'true', job_details: 'true' }).toString();
        const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'StudioOperator/1.0 (public project discovery)' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
        if (!response.ok) {
          const error = new Error(`Freelancer API returned HTTP ${response.status}.`);
          error.status = response.status;
          const retry = response.headers?.get('retry-after');
          if (retry) error.retryAt = /^\d+$/.test(retry) ? now.getTime() + Number(retry) * 1000 : Date.parse(retry);
          throw error;
        }
        const json = await response.json();
        if (json.status !== 'success' || !Array.isArray(json.result?.projects)) throw new Error('Freelancer returned an unexpected project response.');
        rows.push(...json.result.projects.map(p => normalizeProject(p, at)).filter(Boolean));
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      const previous = new Set(state.listings.map(l => l.id));
      state.listings = mergeListings(state.listings, rows);
      source.status = 'live'; source.lastSuccessAt = at; source.error = null; source.failureCount = 0;
      state.receipts.push({ at, source: source.id, outcome: 'success', observed: new Set(rows.map(l=>l.id)).size, newListings: new Set(rows.filter(l=>!previous.has(l.id)).map(l=>l.id)).size });
    } catch (error) {
      source.status = error.status === 401 ? 'needs_login' : error.status === 403 ? 'access_denied' : 'error'; source.error = error.message.startsWith('Freelancer') ? error.message : 'Discovery could not reach Freelancer. Last good listings are retained.';
      source.failureCount = Math.min(10, (source.failureCount || 0) + 1);
      const backoff = now.getTime() + ([401,403].includes(error.status) ? 86400 : Math.min(3600, POLL_SECONDS * 2 ** source.failureCount)) * 1000;
      source.nextRefreshAt = new Date(Math.max(backoff, Number.isFinite(error.retryAt) ? error.retryAt : 0)).toISOString();
      state.receipts.push({ at, source: source.id, outcome: 'error', error: source.error });
    }
    state.updatedAt = at; state.receipts = state.receipts.slice(-200); write(state); return state;
  } finally { release(); }
}
export function shortlistListing(id, value) {
  if (typeof id !== 'string' || typeof value !== 'boolean') throw new Error('A listing and shortlist choice are required.');
  const release = lock(); if (!release) throw new Error('Discovery is refreshing. Try again shortly.');
  try { const state = readSources(); const row = state.listings.find(l=>l.id===id); if (!row) throw new Error('Listing not found.'); row.shortlisted = value; write(state); return state; } finally { release(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const state = await refreshSources();
  // Rank and draft proposals on every tick, even when the refresh was throttled or failed:
  // cached listings are still worth ranking. Drafting failures never fail discovery.
  let leads = null;
  if (!fs.existsSync(path.join(ROOT, 'STOP')) && !fs.existsSync(path.join(directory(), 'LEADS-PAUSED'))) {
    try { const { runLeadPipeline } = await import('./studio-leads.mjs'); leads = await runLeadPipeline({ listings: state.listings, log: m => console.error(m) }); }
    catch (error) { leads = { error: error.message }; }
  }
  // Fast lane: ping Ian within minutes about strong drafts that are still open and uncrowded.
  let fastLane = null;
  try { const { runFastLane } = await import('./studio-fast-lane.mjs'); fastLane = await runFastLane({ listings: state.listings, log: m => console.error(m) }); }
  catch (error) { fastLane = { error: error.message }; }
  console.log(JSON.stringify({ updatedAt: state.updatedAt, listings: state.listings.length, leads, fastLane, sources: state.sources.map(({id,status,lastSuccessAt,nextRefreshAt,error})=>({id,status,lastSuccessAt,nextRefreshAt,error})) }));
  if (state.sources.some(s=>s.status==='error')) process.exitCode=1;
}
