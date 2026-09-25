/*
 * Vercel build: gather everything the browser loads into public/, laid out the
 * way server/server.js serves it locally.
 *
 *   apps/web/*                 → public/*
 *   packages/scan-sdk/dist/*   → public/packages/scan-sdk/dist/*
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'apps', 'web'), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'packages', 'scan-sdk', 'dist'), path.join(OUT, 'packages', 'scan-sdk', 'dist'), { recursive: true });

for (const required of ['index.html', 'scan-import.js', 'packages/scan-sdk/dist/mozu-scan-sdk.global.js']) {
  if (!fs.existsSync(path.join(OUT, required))) {
    console.error(`[build] missing ${required}`);
    process.exit(1);
  }
}
console.log(`[build] wrote ${path.relative(ROOT, OUT)}/`);
