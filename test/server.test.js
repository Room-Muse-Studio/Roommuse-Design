'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server/server');
const { MemoryAppStore } = require('../server/app-store');

const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'samples', 'kitchen.roomscan.json'), 'utf8');
const HOME = fs.readFileSync(path.join(__dirname, '..', 'samples', 'twobedroom.roomscan.json'), 'utf8');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

const post = (base, body, headers = {}) => fetch(base + '/api/scan-handoff', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
});

/** A stand-in for the built site (public/), so tests don't need a full build. */
function fakeSite(t, files) {
  const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozu-site-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(webDir, name)), { recursive: true });
    fs.writeFileSync(path.join(webDir, name), text);
  }
  t.after(() => fs.rmSync(webDir, { recursive: true, force: true }));
  return webDir;
}

test('local server: upload → code → fetch back, with the iPad contract', async (t) => {
  const { base, close } = await listen(createServer({ store: new MemoryAppStore(), limits: { uploads: 0, lookups: 0 } }));
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
  const { base, close } = await listen(createServer({ store: new MemoryAppStore(), limits: { uploads: 0, lookups: 0 } }));
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
  const { base, close } = await listen(createServer({ store: new MemoryAppStore(), limits: { uploads: 2, lookups: 3 } }));
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
  const webDir = fakeSite(t, { 'index.html': '<!doctype html><title>RoomMuse</title>', 'samples/index.json': '{"samples":[]}' });
  const { base, close } = await listen(createServer({ store: new MemoryAppStore(), webDir }));
  t.after(close);
  const loc = async (p) => (await fetch(base + p, { redirect: 'manual' })).headers.get('location');

  assert.equal(await loc('/scan/B7K4M2'), '/?code=B7K4M2');
  assert.equal(await loc('/scan?poly=0,0;1,0;1,1&h=2500'), '/?poly=0%2C0%3B1%2C0%3B1%2C1&h=2500');
  assert.equal(await loc('/scan'), '/');

  const samples = await fetch(base + '/samples/index.json');
  assert.equal(samples.status, 200, 'a file whose path merely starts with /s is served, not taken for a /scan link');
  assert.equal((await fetch(base + '/packages/scan-sdk/dist/mozu-scan-sdk.global.js')).status, 200);
  assert.equal((await fetch(base + '/../package.json')).status, 404);
  const home = await fetch(base + '/', { method: 'HEAD' });
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);

  const health = await fetch(base + '/api/health');
  assert.deepEqual(await health.json(), { ok: true, store: 'memory' });
});

test('local server: clean URLs serve the pages of the static export (/projects → projects.html)', async (t) => {
  const webDir = fakeSite(t, {
    'index.html': '<!doctype html><title>RoomMuse</title>',
    'projects.html': '<!doctype html><title>My projects</title>',
    'editor/index.html': '<!doctype html><title>Editor</title>',
    'notes.txt': 'plain',
  });
  const { base, close } = await listen(createServer({ store: new MemoryAppStore(), webDir }));
  t.after(close);
  const page = async (p) => { const r = await fetch(base + p); return [r.status, r.status === 200 ? await r.text() : '']; };

  let [status, text] = await page('/projects');
  assert.equal(status, 200); assert.match(text, /My projects/);
  [status, text] = await page('/projects/');
  assert.equal(status, 200); assert.match(text, /My projects/, 'a trailing slash finds the same page');
  [status, text] = await page('/editor');
  assert.equal(status, 200); assert.match(text, /Editor/, 'editor/index.html works too');
  [status] = await page('/projects.html');
  assert.equal(status, 200, 'the file itself is still there');
  [status] = await page('/notes');
  assert.equal(status, 404, 'only .html pages get clean URLs');
  [status] = await page('/nowhere');
  assert.equal(status, 404);
  assert.equal((await fetch(base + '/api/design?code=B7K4M2')).status, 404, 'code-designs are gone');
});

test('Vercel functions: same contract through api/**/*.js', async (t) => {
  const functions = {
    '/api/scan-handoff': require('../api/scan-handoff'),
    '/api/health': require('../api/health'),
    '/api/scan-link': require('../api/scan-link'),
    '/api/auth/[action]': require('../api/auth/[action]'),
    '/api/projects/index': require('../api/projects/index'),
    '/api/projects/[...path]': require('../api/projects/[...path]'),
  };
  // Stand-in for Vercel's file-system router: exact files first, then
  // [action] for one segment and [...path] for one or more (never zero).
  const resolve = (pathname) => {
    if (functions[pathname]) return functions[pathname];
    if (/^\/api\/auth\/[^/]+$/.test(pathname)) return functions['/api/auth/[action]'];
    if (pathname === '/api/projects' || pathname === '/api/projects/') return functions['/api/projects/index'];
    if (/^\/api\/projects\/[^/]+/.test(pathname)) return functions['/api/projects/[...path]'];
    return null;
  };
  // …plus vercel.json's /scan rewrites.
  const vercel = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/scan(?:\/([^/]+))?$/);
    if (m) {
      if (m[1]) url.searchParams.set('code', m[1]);
      req.url = '/api/scan-link' + url.search;
    }
    const fn = resolve(new URL(req.url, 'http://localhost').pathname);
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

  // A whole home from "Build house" takes the same path.
  const homeTicket = await (await post(base, HOME)).json();
  const home = await (await fetch(`${base}/api/scan-handoff?code=${homeTicket.code}`)).json();
  assert.equal(home.scan.schema, 'mozu.homescan/1');
  assert.equal(home.scan.rooms.length, 3);

  // Account routes reach their functions (401 = handled, not a routing 404).
  assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);
  assert.equal((await fetch(`${base}/api/projects`)).status, 401, 'bare /api/projects is served by index.js');
  assert.equal((await fetch(`${base}/api/projects/abcdefgh12`)).status, 401);
  assert.equal((await fetch(`${base}/api/projects/abcdefgh12/duplicate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(`${base}/api/design?code=${ticket.code}`)).status, 404, 'code-designs are gone');
});

test('local server: a whole home (mozu.homescan/1) goes up and comes back under one code', async (t) => {
  const { base, close } = await listen(createServer({ store: new MemoryAppStore(), limits: { uploads: 0, lookups: 0 } }));
  t.after(close);

  const res = await post(base, HOME);
  assert.equal(res.status, 201);
  const ticket = await res.json();
  assert.ok(!('warnings' in ticket));
  const body = await (await fetch(`${base}/api/scan-handoff?code=${ticket.code}`)).json();
  assert.equal(body.scan.schema, 'mozu.homescan/1');
  assert.deepEqual(body.scan.rooms.map((r) => r.name), ['Hallway', 'Bedroom A', 'Bedroom B']);
  assert.equal(body.scan.connections.length, 5);
  assert.equal(body.scan.rooms[1].fixtures.length, 3, 'sockets survive');

  // As the iPad sends it: rooms with generated ids and names, no connections.
  const fromIpad = JSON.parse(HOME);
  delete fromIpad.connections;
  fromIpad.rooms.forEach((r, i) => { r.id = `8F1C${i}-UUID`; r.name = `Room ${i + 1}`; });
  const up = await post(base, JSON.stringify(fromIpad));
  assert.equal(up.status, 201);
  const back = await (await fetch(`${base}/api/scan-handoff?code=${(await up.json()).code}`)).json();
  assert.deepEqual(back.scan.rooms.map((r) => r.id), ['8F1C0-UUID', '8F1C1-UUID', '8F1C2-UUID']);
  assert.ok(!('connections' in back.scan));
});

test('local server: a home with a broken room is kept with a warning; one with no usable room is refused', async (t) => {
  const { base, close } = await listen(createServer({ store: new MemoryAppStore(), limits: { uploads: 0, lookups: 0 } }));
  t.after(close);
  const home = JSON.parse(HOME);
  home.rooms[2].polygon = [{ x: 0, z: 0 }];
  const res = await post(base, JSON.stringify(home));
  assert.equal(res.status, 201);
  const ticket = await res.json();
  assert.match(ticket.warnings[0], /Room 3 has no usable outline/);
  const body = await (await fetch(`${base}/api/scan-handoff?code=${ticket.code}`)).json();
  assert.equal(body.scan.rooms.length, 2);

  for (const bad of [{ schema: 'mozu.homescan/1', rooms: [] }, { schema: 'mozu.homescan/1', rooms: [{ polygon: [] }] }, { schema: 'mozu.homescan/1' }]) {
    const r = await post(base, JSON.stringify(bad));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /mozu\.homescan\/1 home/);
  }
});

test('local server: codes expire after 24 hours, whatever was done with them', async (t) => {
  let now = Date.now();
  const store = new MemoryAppStore({ now: () => now });
  const { base, close } = await listen(createServer({ store, limits: { uploads: 0, lookups: 0 } }));
  t.after(close);
  const { code } = await (await post(base, SAMPLE)).json();
  assert.equal((await fetch(`${base}/api/scan-handoff?code=${code}`)).status, 200);
  now += 25 * 60 * 60 * 1000;
  assert.equal((await fetch(`${base}/api/scan-handoff?code=${code}`)).status, 404);
});

test('local server: says so when the site has not been built', async (t) => {
  const webDir = fakeSite(t, {});
  const { base, close } = await listen(createServer({ store: new MemoryAppStore(), webDir }));
  t.after(close);
  const res = await fetch(base + '/');
  assert.equal(res.status, 503);
  assert.match(await res.text(), /npm start/);
  assert.equal((await fetch(base + '/api/health')).status, 200, 'the API works without the site');
  assert.equal((await fetch(base + '/api/projects')).status, 401, 'and so do the account routes');
});
