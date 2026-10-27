import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.STUDIO_QA_URL || 'http://127.0.0.1:3000';
const out = path.resolve('artifacts/studio-2026-09-28');
fs.mkdirSync(out, { recursive: true });
const key = fs.readFileSync('.env.local', 'utf8').match(/^STUDIO_KEY=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
assert.ok(key, 'Local authentication configuration required');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: 'studio_key', value: key, url: origin, httpOnly: true, sameSite: 'Lax' }]);
// This check never creates jobs, sends messages, or calls a model.
await context.route('**/api/studio**', route => route.request().method() === 'GET' ? route.continue() : route.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin);
  await page.getByRole('link', { name: /Open Studio Operator/ }).click();
  await page.getByRole('heading', { name: 'Studio Operator', exact: true }).waitFor();
  await page.getByRole('region', { name: 'Studio Operator getting started' }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Studio Operator', exact: true }).getAttribute('aria-current'), 'page');
  await page.screenshot({ path: path.join(out, 'operator-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Explore demo jobs', exact: true }).click();
  await page.getByText('Demo · Landing page rescue', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Demo', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Check accounts & payouts →', exact: true }).click();
  await page.getByRole('heading', { name: 'Upwork / account & payouts' }).waitFor();
  assert.ok((await page.locator('body').innerText()).includes('2026'));
  await page.getByRole('navigation', { name: 'Studio workspace' }).getByRole('button', { name: 'Overview', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('region', { name: 'Studio Operator getting started' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'No mobile overflow');
  await page.screenshot({ path: path.join(out, 'operator-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const receipt = { checkedAt: new Date().toISOString(), origin, homeEntry: true, railEntry: true, guidedWorkflow: true, demoReadable: true, connectionsReadable: true, mobileOverflow: false, errors, mutations: false };
  fs.writeFileSync(path.join(out, 'navigation-verification.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await browser.close(); }
