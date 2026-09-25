'use strict';

// The website side of the App Clip: Apple's association file, the /clip landing
// page and its QR encoder, as served locally and as laid out by the Vercel build.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createServer } = require('../server/server');
const { MemoryHandoffStore } = require('../server/handoff-store');

const ROOT = path.join(__dirname, '..');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('apple-app-site-association is valid and names the clip', () => {
  const text = fs.readFileSync(path.join(ROOT, 'apps', 'web', '.well-known', 'apple-app-site-association'), 'utf8');
  const aasa = JSON.parse(text);
  assert.ok(Array.isArray(aasa.appclips.apps) && aasa.appclips.apps.length === 1);
  assert.match(aasa.appclips.apps[0], /^[A-Z0-9]{10}\.com\.averyhsu\.roommuse\.Clip$|^TEAMID\.com\.averyhsu\.roommuse\.Clip$/);
  assert.ok(Buffer.byteLength(text) < 128 * 1024, 'Apple caps the file at 128 KB');

  // The bundle id must match the clip target, and the entitlement must match the site.
  const spec = fs.readFileSync(path.join(ROOT, 'apps', 'ios', 'project.yml'), 'utf8');
  assert.match(spec, /PRODUCT_BUNDLE_IDENTIFIER: com\.averyhsu\.roommuse\.Clip/);
  assert.match(spec, /appclips:roommuse-design\.vercel\.app/);
});

test('local server serves the association file as JSON and /clip as a page', async (t) => {
  const { base, close } = await listen(createServer({ store: new MemoryHandoffStore() }));
  t.after(close);

  const aasa = await fetch(base + '/.well-known/apple-app-site-association', { redirect: 'manual' });
  assert.equal(aasa.status, 200);
  assert.match(aasa.headers.get('content-type'), /^application\/json/);
  assert.ok((await aasa.json()).appclips);

  for (const p of ['/clip', '/clip/', '/clip/index.html']) {
    const page = await fetch(base + p);
    assert.equal(page.status, 200, p);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const html = await page.text();
    assert.match(html, /app-clip-bundle-id=com\.averyhsu\.roommuse\.Clip/);
    assert.match(html, /src="\/clip\/qr\.js"/);
  }
  const qr = await fetch(base + '/clip/qr.js');
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get('content-type'), /javascript/);
});

test('vercel.json serves the association file with a JSON content type', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const rule = config.headers.find((h) => h.source === '/.well-known/apple-app-site-association');
  assert.ok(rule, 'header rule for the association file');
  assert.ok(rule.headers.some((h) => h.key === 'Content-Type' && h.value === 'application/json'));
  assert.ok(!config.rewrites.some((r) => r.source.startsWith('/.well-known') || r.source.startsWith('/clip')), 'nothing rewrites the clip paths');
});

test('the Vercel build includes the clip files', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-web.js')], { stdio: 'pipe' });
  for (const f of ['.well-known/apple-app-site-association', 'clip/index.html', 'clip/qr.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public', f)), f);
  }
});

test('QR encoder: structure of the symbol', () => {
  const { MozuQR } = require('../apps/web/clip/qr.js');
  const url = 'https://roommuse-design.vercel.app/clip';
  const m = MozuQR.matrix(url);
  assert.equal(m.size, m.version * 4 + 17);
  // Finder pattern corners are dark, the always-dark module is set.
  assert.equal(m.get(0, 0), true);
  assert.equal(m.get(0, m.size - 1), true);
  assert.equal(m.get(m.size - 1, 0), true);
  assert.equal(m.get(m.size - 8, 8), true);
  // Timing pattern alternates.
  for (let i = 8; i < m.size - 8; i++) assert.equal(m.get(6, i), i % 2 === 0);
  assert.throws(() => MozuQR.matrix('x'.repeat(214)), /too long/);
  const svg = MozuQR.svg(url);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<path d="M/);
});
