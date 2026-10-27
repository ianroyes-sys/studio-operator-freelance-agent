// Copies the fake fixtures in data/examples/ into the live data directory so the CLIs have
// something to show without a Freelancer account. Never overwrites an existing store.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.STUDIO_DATA_DIR || path.join(ROOT, 'data/studio');
fs.mkdirSync(target, { recursive: true });
for (const name of ['sources', 'leads', 'fast-lane', 'accounts']) {
  const to = path.join(target, `${name}.json`);
  if (fs.existsSync(to)) { console.log(`kept   ${to}`); continue; }
  fs.copyFileSync(path.join(ROOT, 'data/examples', `${name}.sample.json`), to);
  console.log(`seeded ${to}`);
}
