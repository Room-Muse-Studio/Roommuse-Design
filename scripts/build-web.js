/*
 * Site build (Vercel's buildCommand, and `npm start` locally): gather what the
 * browser loads into public/, which Vercel serves as the site root and
 * server/server.js serves locally.
 *
 *   apps/configurator (static export) → public/*
 *   packages/scan-sdk/dist/*          → public/packages/scan-sdk/dist/*
 *
 * The handoff API is not in here: it's api/*.js on Vercel, server/server.js locally.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public');
const APP = path.join(ROOT, 'apps', 'configurator');

const built = spawnSync('npm', ['run', 'export', '-w', 'apps/configurator'], { cwd: ROOT, stdio: 'inherit' });
if (built.status !== 0) {
  console.error('[build] the configurator did not build (see above)');
  process.exit(built.status || 1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(APP, 'out'), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'packages', 'scan-sdk', 'dist'), path.join(OUT, 'packages', 'scan-sdk', 'dist'), { recursive: true });

for (const required of ['index.html', 'samples/index.json', 'models/mozu/KF01.glb', 'packages/scan-sdk/dist/mozu-scan-sdk.global.js']) {
  if (!fs.existsSync(path.join(OUT, required))) {
    console.error(`[build] missing ${required}`);
    process.exit(1);
  }
}
console.log(`[build] wrote ${path.relative(ROOT, OUT)}/`);
