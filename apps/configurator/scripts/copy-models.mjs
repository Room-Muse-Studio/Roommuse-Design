// Copy the MOZU model files (models/mozu/*.glb, tracked) into public/models/mozu/
// so the page can fetch them — public/ is generated, not committed. Refuses to
// build when the files and lib/models.manifest.json disagree: the manifest is
// what the catalogue, placement and scan matching trust, so a model added or
// replaced without `npm run models:measure` would be wrong on screen.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'models', 'mozu');
const to = join(here, '..', 'public', 'models', 'mozu');
const manifest = JSON.parse(readFileSync(join(here, '..', 'lib', 'models.manifest.json'), 'utf8'));

const files = readdirSync(from).filter((f) => f.endsWith('.glb')).sort();
const listed = new Map(manifest.models.map((m) => [`${m.id}.glb`, m]));
const problems = [];
for (const f of files) {
  const m = listed.get(f);
  if (!m) problems.push(`${f} is not in the manifest`);
  else if (m.bytes !== statSync(join(from, f)).size) problems.push(`${f} has changed since it was measured`);
}
for (const f of listed.keys()) if (!files.includes(f)) problems.push(`${f} is in the manifest but missing from models/mozu/`);
if (problems.length) {
  for (const p of problems) console.error(`[models] ${p}`);
  console.error('[models] run: npm run models:measure -w apps/configurator');
  process.exit(1);
}

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const f of files) cpSync(join(from, f), join(to, f));
console.log(`[models] ${files.length} model(s) → public/models/mozu/`);
