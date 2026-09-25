'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createServer } = require('../server/server');
const { MemoryHandoffStore } = require('../server/handoff-store');

const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'samples', 'kitchen.roomscan.json'), 'utf8');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

const post = (base, body, headers = {}) => fetch(base + '/api/scan-handoff', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
});

test('local server: upload → code → fetch back, with the iPad contract', async (t) => {
  const { base, close } = await listen(createServer({ store: new MemoryHandoffStore(), limits: { uploads: 0, lookups: 0 } }));
  t.after(close);

  const res = await post(base, SAMPLE, { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'mozu.test' });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const ticket = await res.json();
  assert.match(ticket.code, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  assert.equal(ticket.url, `https://mozu.test/scan/${ticket.code}`);
  assert.ok(Date.parse(ticket.expiresAt) > Date.now() + 23 * 3600 * 1000);

  const typed = ticket.code.toLowerCase().slice(0, 3) + '-' + ticket.code.slice(3);
  const got = await fetch(`${base}/api/scan-handoff?code=${encodeURIComponent(typed)}`);
  assert.equal(got.status, 200);
  const body = await got.json();
  assert.equal(body.code, ticket.code);
  assert.equal(body.expiresAt, ticket.expiresAt);
  assert.equal(body.scan.polygon.length, 4);
  assert.equal(body.scan.openings.length, 1);
  assert.equal(body.scan.fixtures.length, 2, 'fixtures survive even though the SDK drops them');
});

test('local server: errors the iPad and the page show', async (t) => {
  const { base, close } = await listen(createServer({ store: new MemoryHandoffStore(), limits: { uploads: 0, lookups: 0 } }));
  t.after(close);
  const status = async (resP) => { const r = await resP; return [r.status, (await r.json()).error]; };

  let [s, e] = await status(post(base, 'not json'));
  assert.equal(s, 400); assert.match(e, /RoomScan JSON/);

  [s, e] = await status(post(base, JSON.stringify({ schema: 'mozu.roomscan/1', polygon: [{ x: 0, z: 0 }, { x: 1, z: 1 }] })));
  assert.equal(s, 400); assert.match(e, /at least 3 corner/);

  [s, e] = await status(post(base, JSON.stringify({ schema: 'other/1', polygon: [] })));
  assert.equal(s, 400);

  [s, e] = await status(post(base, 'x'.repeat(2_000_001)));
  assert.equal(s, 413); assert.match(e, /2 MB/);

  [s, e] = await status(fetch(`${base}/api/scan-handoff?code=abc`));
  assert.equal(s, 400);

  [s, e] = await status(fetch(`${base}/api/scan-handoff?code=B7K4M2`));
  assert.equal(s, 404); assert.match(e, /24 hours/);

  const put = await fetch(`${base}/api/scan-handoff`, { method: 'PUT' });
  assert.equal(put.status, 405);
  assert.equal(put.headers.get('allow'), 'GET, POST');
});

test('local server: rate limits uploads and lookups per network', async (t) => {
  const { base, close } = await listen(createServer({ store: new MemoryHandoffStore(), limits: { uploads: 2, lookups: 3 } }));
  t.after(close);

  assert.equal((await post(base, SAMPLE)).status, 201);
  assert.equal((await post(base, SAMPLE)).status, 201);
  const limited = await post(base, SAMPLE);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.match((await limited.json()).error, /Too many/);
  assert.equal((await post(base, SAMPLE, { 'x-forwarded-for': '10.0.0.9' })).status, 201, 'other networks are unaffected');

  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${base}/api/scan-handoff?code=B7K4M2`)).status, 404);
  assert.equal((await fetch(`${base}/api/scan-handoff?code=B7K4M2`)).status, 429);
});

test('local server: /scan links, static files, health', async (t) => {
  const { base, close } = await listen(createServer({ store: new MemoryHandoffStore() }));
  t.after(close);
  const loc = async (p) => (await fetch(base + p, { redirect: 'manual' })).headers.get('location');

  assert.equal(await loc('/scan/B7K4M2'), '/?code=B7K4M2');
  assert.equal(await loc('/scan?poly=0,0;1,0;1,1&h=2500'), '/?poly=0%2C0%3B1%2C0%3B1%2C1&h=2500');
  assert.equal(await loc('/scan'), '/');

  const js = await fetch(base + '/scan-import.js');
  assert.equal(js.status, 200, '/scan-import.js is a file, not a /scan link');
  assert.equal((await fetch(base + '/packages/scan-sdk/dist/mozu-scan-sdk.global.js')).status, 200);
  assert.equal((await fetch(base + '/../package.json')).status, 404);
  const home = await fetch(base + '/', { method: 'HEAD' });
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);

  const health = await fetch(base + '/api/health');
  assert.deepEqual(await health.json(), { ok: true, store: 'memory' });
});

test('Vercel functions: same contract through api/*.js', async (t) => {
  const functions = {
    '/api/scan-handoff': require('../api/scan-handoff'),
    '/api/health': require('../api/health'),
    '/api/scan-link': require('../api/scan-link'),
  };
  // Stand-in for Vercel's router, including vercel.json's /scan rewrites.
  const vercel = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/scan(?:\/([^/]+))?$/);
    if (m) {
      if (m[1]) url.searchParams.set('code', m[1]);
      req.url = '/api/scan-link' + url.search;
    }
    const fn = functions[new URL(req.url, 'http://localhost').pathname];
    if (fn) return fn(req, res);
    res.writeHead(404); res.end();
  });
  const { base, close } = await listen(vercel);
  t.after(close);

  const ticket = await (await post(base, SAMPLE)).json();
  const got = await (await fetch(`${base}/api/scan-handoff?code=${ticket.code}`)).json();
  assert.equal(got.scan.fixtures.length, 2);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/scan/${ticket.code}`, { redirect: 'manual' })).headers.get('location'), `/?code=${ticket.code}`);
  assert.equal((await fetch(`${base}/scan?poly=1&h=2`, { redirect: 'manual' })).headers.get('location'), '/?poly=1&h=2');
});
