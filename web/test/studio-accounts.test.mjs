import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseStudioAccounts, readStudioAccounts} from '../lib/server/studioAccounts.ts';

const source = JSON.parse(await fs.readFile(new URL('../../data/examples/accounts.sample.json', import.meta.url), 'utf8'));

test('account evidence has current observed blockers, not payout readiness', () => {
  const accounts = parseStudioAccounts(source);
  assert.equal(accounts.length, 5);
  assert.match(accounts.find(a => a.id === 'upwork').accountStatus, /Signed in/);
  assert.match(accounts.find(a => a.id === 'upwork').nextStep, /payout method/);
  assert.equal(accounts.find(a => a.id === 'fiverr').payoutStatus, 'Payout method not linked');
});

test('account validator rejects missing, duplicate, invalid date and untrusted destination evidence', () => {
  for (const mutate of [
    a => a.pop(), a => {a[1] = a[0];}, a => {a[0].checkedAt = '2026-02-30T00:00:00.000Z';},
    a => {a[0].setupUrl = 'javascript:alert(1)';}, a => {a[0].payoutUrl = 'https://www.upwork.com.attacker.test/';},
    a => {a[0].setupUrl = 'https://name:secret@www.upwork.com/';}, a => {a[0].profileStatus = '';},
  ]) {
    const changed = structuredClone(source); mutate(changed);
    assert.throws(() => parseStudioAccounts(changed));
  }
  const extra = structuredClone(source); extra[0].secret = 'never echo';
  assert.equal('secret' in parseStudioAccounts(extra)[0], false);
});

test('request-time reads observe edits and fail closed for missing or malformed files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-accounts-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const file = path.join(root, 'data/studio/accounts.json');
  const verifyUnknown = rows => {
    assert.equal(rows.length, 5);
    assert.ok(rows.every(a => a.payoutStatus === 'Not verified' && a.checkedAt === '' && a.accountStatus.includes('unknown')));
  };
  verifyUnknown(await readStudioAccounts(root));
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, JSON.stringify(source));
  assert.deepEqual(await readStudioAccounts(root), parseStudioAccounts(source));
  const changed = structuredClone(source); changed[0].profileStatus = 'New observation';
  await fs.writeFile(file, JSON.stringify(changed));
  assert.equal((await readStudioAccounts(root))[0].profileStatus, 'New observation');
  await fs.writeFile(file, '{broken');
  verifyUnknown(await readStudioAccounts(root));
});
