import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-leads-'));
const m = await import('./studio-leads.mjs');
const NOW = Date.parse('2026-10-13T12:00:00Z');
const listing = (over = {}) => ({ id: 'freelancer:1', source: 'freelancer', title: 'CSV date cleanup script', description: 'Need a python script that normalizes every date column in our CSV exports to DD/MM/YYYY. Two sample files supplied. Deliver source and README. '.repeat(2), skills: ['Python'], url: 'https://www.freelancer.com/projects/1', publishedAt: new Date(NOW - 3600000).toISOString(), firstSeenAt: new Date(NOW - 3600000).toISOString(), currency: 'USD', budgetMin: 150, budgetMax: 400, budgetType: 'fixed', bidCount: 3, bidAvg: 300, urgent: false, language: 'en', descriptionIncomplete: false, ...over });
const proposal = { worthBidding: true, fit: 'strong', fitReason: 'Clear script', coverLetter: 'You need every date normalized. I can deliver for $270 in 2 days.', deliveryDays: 2, approach: ['a'], clarifyingQuestions: ['q?'], risks: [] };

test('fresh, well-paid, low-competition fast deliverable is hot', () => {
  const s = m.scoreListing(listing(), NOW);
  assert.equal(s.tier, 'hot'); assert.ok(s.score >= m.HOT); assert.equal(s.usdMax, 400);
});

test('red flags, stale posts, tiny budgets and incomplete briefs are skipped', () => {
  assert.equal(m.scoreListing(listing({ description: 'Contact me on telegram for details about this python script job and the budget. '.repeat(3) }), NOW).tier, 'skip');
  assert.equal(m.scoreListing(listing({ publishedAt: new Date(NOW - 4 * 86400000).toISOString() }), NOW).tier, 'skip');
  assert.equal(m.scoreListing(listing({ budgetMin: 10, budgetMax: 30 }), NOW).tier, 'skip');
  assert.equal(m.scoreListing(listing({ descriptionIncomplete: true }), NOW).tier, 'skip');
});

test('heavy or ongoing work ranks below a fast deliverable', () => {
  const fast = m.scoreListing(listing(), NOW).score;
  const heavy = m.scoreListing(listing({ title: 'Ongoing maintenance for mobile app', description: 'Long-term flutter mobile app maintenance with monthly retainer and ongoing support for our users. '.repeat(2) }), NOW).score;
  assert.ok(heavy < fast - 20);
});

test('currency converts for ranking; unknown currency is flagged, not guessed', () => {
  assert.equal(m.scoreListing(listing({ currency: 'INR', budgetMin: 1500, budgetMax: 12500 }), NOW).usdMax, 150);
  const unknown = m.scoreListing(listing({ currency: 'XYZ' }), NOW);
  assert.equal(unknown.usdMax, null); assert.ok(unknown.flags.some(f => /Unknown currency/.test(f)));
});

test('bid suggestion undercuts the average and stays inside the client range', () => {
  assert.equal(m.suggestBidUsd(m.scoreListing(listing(), NOW)), 270);
  assert.equal(m.suggestBidUsd(m.scoreListing(listing({ bidAvg: 2000 }), NOW)), 400);
  assert.equal(m.suggestBidUsd(m.scoreListing(listing({ bidAvg: 20 }), NOW)), 150);
});

test('proposal validation rejects malformed or empty bids', () => {
  assert.deepEqual(m.validateProposal(proposal).deliveryDays, 2);
  assert.throws(() => m.validateProposal({ ...proposal, deliveryDays: 0 }));
  assert.throws(() => m.validateProposal({ ...proposal, coverLetter: '' }));
  assert.throws(() => m.validateProposal({ ...proposal, fit: 'great' }));
});

test('pipeline drafts the best fresh lead within limits and never bids', async () => {
  let calls = 0;
  const runModel = async (prompt, schema) => { calls++; assert.match(prompt, /untrusted DATA/); assert.equal(schema, m.proposalSchema); return JSON.stringify(proposal); };
  const listings = [listing(), listing({ id: 'freelancer:2', title: 'Logo design', description: 'Need a logo illustration for my brand, ongoing design work. '.repeat(3) })];
  const result = await m.runLeadPipeline({ listings, now: NOW, runModel, perTick: 3, perDay: 1 });
  assert.equal(calls, 1); assert.equal(result.drafted.length, 1);
  const lead = m.readLeads().leads['freelancer:1'];
  assert.equal(lead.status, 'drafted'); assert.equal(lead.proposal.bidUsd, 270);
  assert.equal(m.readLeads().leads['freelancer:2'], undefined);
  await m.runLeadPipeline({ listings, now: NOW, runModel, perTick: 3, perDay: 1 });
  assert.equal(calls, 1, 'drafted leads are not redrafted and the daily cap holds');
});

test('drafter decline dismisses the lead; model failure is recorded and retried at most twice', async () => {
  const declined = listing({ id: 'freelancer:3' });
  await m.runLeadPipeline({ listings: [declined], now: NOW, runModel: async () => JSON.stringify({ ...proposal, worthBidding: false, fit: 'poor', fitReason: 'Needs app store release' }) });
  assert.equal(m.readLeads().leads['freelancer:3'].status, 'dismissed');
  const failing = listing({ id: 'freelancer:4' }); let calls = 0;
  for (let i = 0; i < 3; i++) await m.runLeadPipeline({ listings: [failing], now: NOW + i, runModel: async () => { calls++; throw new Error('timeout'); } });
  assert.equal(calls, 2); assert.equal(m.readLeads().leads['freelancer:4'].draftError, 'timeout');
});

test('funnel transitions are enforced and human decisions survive rescoring', async () => {
  await assert.rejects(m.updateLead({ id: 'freelancer:1', action: 'lost' }), /Cannot mark/);
  await m.updateLead({ id: 'freelancer:1', action: 'sent' });
  await assert.rejects(m.updateLead({ id: 'freelancer:1', action: 'won', priceUsd: -5 }), /price/);
  await m.updateLead({ id: 'freelancer:1', action: 'won', priceUsd: 250 });
  await m.runLeadPipeline({ listings: [listing()], now: NOW, runModel: async () => { throw new Error('should not draft'); } });
  const lead = m.readLeads().leads['freelancer:1'];
  assert.equal(lead.status, 'won'); assert.equal(lead.finalPriceUsd, 250);
  const funnel = m.leadFunnel(m.readLeads(), NOW + 1000);
  assert.equal(funnel.won, 1); assert.equal(funnel.wonValueUsd, 250); assert.equal(funnel.winRate, 100);
});

test('open leads expire after a week; won leads do not', () => {
  const state = { leads: { a: { id: 'a', status: 'drafted', tier: 'hot', proposal: proposal, publishedAt: new Date(NOW - 8 * 86400000).toISOString(), createdAt: new Date(NOW).toISOString() }, b: { id: 'b', status: 'won', tier: 'hot', publishedAt: new Date(NOW - 8 * 86400000).toISOString(), createdAt: new Date(NOW).toISOString() } }, daily: {}, receipts: [] };
  m.syncLeads(state, [], NOW);
  assert.equal(state.leads.a.status, 'expired'); assert.equal(state.leads.b.status, 'won');
});

test('won lead converts into one Studio job with price and deadline', async () => {
  const sourcesFile = path.join(process.env.STUDIO_DATA_DIR, 'sources.json');
  fs.writeFileSync(sourcesFile, JSON.stringify({ version: 1, pollSeconds: 300, updatedAt: null, sources: [], listings: [listing()], receipts: [] }));
  const first = await m.convertWonLead('freelancer:1');
  const again = await m.convertWonLead('freelancer:1');
  assert.equal(again.jobId, first.jobId); assert.equal(again.existing, true);
  const { readStudio } = await import('./studio-store.mjs');
  const job = (await readStudio('live')).jobs.find(j => j.id === first.jobId);
  assert.equal(job.budgetCents, 25000); assert.equal(job.status, 'new'); assert.ok(Date.parse(job.deadline) > Date.now());
  assert.match(job.clientNotes, /Agreed price \$250/);
});
