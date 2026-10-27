import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.STUDIO_QA_URL || 'http://127.0.0.1:3000';
const out = path.resolve('artifacts/studio-2026-10-13');
fs.mkdirSync(out, { recursive: true });
const key = fs.readFileSync('.env.local', 'utf8').match(/^STUDIO_KEY=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
assert.ok(key, 'Local authentication configuration required');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [], results = {};
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport });
    await context.addCookies([{ name: 'studio_key', value: key, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    // Read-only: never sends lead actions, drafts, job writes or model calls.
    await context.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    await page.goto(`${origin}/studio`);
    await page.getByRole('button', { name: 'Hot leads' }).first().waitFor();
    await page.getByText('Ready to send').first().waitFor();
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const cards = await page.locator('article[data-tier]').count();
    await page.screenshot({ path: path.join(out, `leads-${label}.png`), fullPage: false });
    await page.goto(`${origin}/autonomy`);
    await page.getByText('Studio Operator', { exact: true }).first().waitFor();
    await page.waitForTimeout(1000);
    const autonomyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: path.join(out, `autonomy-${label}.png`), fullPage: false });
    results[label] = { overflow, cards, autonomyOverflow };
    await context.close();
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(out, 'leads-verification.json'), JSON.stringify({ origin, at: new Date().toISOString(), results, errors }, null, 2));
console.log(JSON.stringify({ results, errors }));
assert.equal(errors.length, 0); for (const r of Object.values(results)) { assert.ok(r.overflow <= 1); assert.ok(r.autonomyOverflow <= 1); }
