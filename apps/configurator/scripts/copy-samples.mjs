// Copy the repo's sample scans into public/samples/ (plus an index), so the
// page can offer them as plain files — the site is static.
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', '..', '..', 'samples');
const to = join(here, '..', 'public', 'samples');
const SUFFIX = '.roomscan.json';

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const names = readdirSync(from).filter((f) => f.endsWith(SUFFIX)).sort();
for (const f of names) cpSync(join(from, f), join(to, f));
writeFileSync(join(to, 'index.json'), JSON.stringify({ samples: names.map((f) => f.slice(0, -SUFFIX.length)) }) + '\n');
console.log(`[samples] ${names.length} sample scan(s) → public/samples/`);
