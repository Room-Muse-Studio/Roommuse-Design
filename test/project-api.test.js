'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createServer } = require('../server/server');
const { MemoryAppStore, RedisAppStore } = require('../server/app-store');
const { createFirebaseVerifier } = require('../server/firebase-token');
const { validateDesign, defaultName } = require('../server/project-api');
const { fakeFirebase } = require('./helpers/fake-firebase');
const { fakeUpstash } = require('./helpers/fake-upstash');

const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'samples', 'kitchen.roomscan.json'), 'utf8');
const HOME = fs.readFileSync(path.join(__dirname, '..', 'samples', 'twobedroom.roomscan.json'), 'utf8');
/** The kitchen sample carries no name; this one does. */
const NAMED = JSON.stringify({ ...JSON.parse(SAMPLE), name: 'Kitchen' });

const item = (uid, extra = {}) => ({ uid, roomKey: 'room-0', name: 'Bed', center: { x: 1, z: 2 }, rotation: 0, ...extra });
const JPEG = 'data:image/jpeg;base64,' + Buffer.from('not really a jpeg').toString('base64');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Server + two signed-in people (A and B) as request helpers, plus a way to upload a scan as the phone. */
async function setup(t, { store = new MemoryAppStore(), limits = {}, ...opts } = {}) {
  const fb = fakeFirebase({ now: () => Date.now() });
  const verifier = createFirebaseVerifier({ projectId: fb.projectId, certsUrl: 'https://certs.test', fetch: fb.fetch });
  const server = createServer({ store, verifier, limits: { uploads: 0, lookups: 0, sessions: 0, reads: 0, writes: 0, ...limits }, ...opts });
  const { base, close } = await listen(server);
  t.after(close);
  const login = async (sub) => {
    const res = await fetch(base + '/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: fb.token({ sub, email: sub + '@x.test' }) }) });
    assert.equal(res.status, 201);
    return res.headers.get('set-cookie').split(';')[0];
  };
  const as = (cookie) => async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: json, headers: res.headers };
  };
  const phone = async (scanText) => {
    const res = await fetch(base + '/api/scan-handoff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: scanText });
    assert.equal(res.status, 201);
    return (await res.json()).code;
  };
  return { base, store, phone, A: as(await login('alice')), B: as(await login('bob')) };
}

test('validateDesign checks the shape the editor saves, shallowly', () => {
  assert.equal(validateDesign({ items: [] }), null);
  assert.equal(validateDesign({ items: [item(1), item(2, { anything: { goes: true } })] }), null);
  assert.match(validateDesign(null), /object/);
  assert.match(validateDesign([]), /object/);
  assert.match(validateDesign({}), /items/);
  assert.match(validateDesign({ items: {} }), /items/);
  assert.match(validateDesign({ items: [null] }), /object/);
  assert.match(validateDesign({ items: [item('1')] }), /uid/);
  assert.match(validateDesign({ items: [item(1, { roomKey: 7 })] }), /roomKey/);
  assert.match(validateDesign({ items: [item(1, { center: { x: 1 } })] }), /center/);
  assert.match(validateDesign({ items: [item(1, { center: { x: '1', z: 2 } })] }), /center/);
  assert.match(validateDesign({ items: [item(1, { center: null })] }), /center/);
});

test('defaultName comes from the scan when it has one', () => {
  assert.equal(defaultName({ schema: 'mozu.roomscan/1', name: ' Kitchen ' }), 'Kitchen');
  assert.equal(defaultName({ schema: 'mozu.roomscan/1' }), 'Room');
  assert.equal(defaultName({ schema: 'mozu.homescan/1', rooms: [{}, {}, {}] }), 'Home (3 rooms)');
  assert.equal(defaultName({ schema: 'mozu.homescan/1', rooms: [{}] }), 'Home (1 room)');
});

for (const [name, makeStore] of [
  ['memory', () => new MemoryAppStore()],
  ['redis', () => new RedisAppStore({ url: 'https://redis.test', token: 'secret', fetch: fakeUpstash().fetch })],
]) {
  test(`${name}: code → project → open → save with rev → stale rev 409 → rename → duplicate → delete`, async (t) => {
    const { A, phone } = await setup(t, { store: makeStore() });

    assert.deepEqual((await A('GET', '/api/projects')).body, { projects: [] });

    const code = await phone(NAMED);
    const typed = code.toLowerCase().slice(0, 3) + '-' + code.slice(3);
    const created = await A('POST', '/api/projects', { code: typed });
    assert.equal(created.status, 201);
    const p = created.body.project;
    assert.deepEqual(Object.keys(p).sort(), ['createdAt', 'id', 'name', 'rev', 'rooms', 'source', 'updatedAt']);
    assert.match(p.id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(p.name, 'Kitchen', 'named after the scan');
    assert.equal(p.rooms, 1);
    assert.equal(p.source, 'code');
    assert.equal(p.rev, 1);
    assert.equal(p.createdAt, p.updatedAt);

    const opened = await A('GET', `/api/projects/${p.id}`);
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.body.project, p);
    assert.equal(opened.body.scan.schema, 'mozu.roomscan/1');
    assert.equal(opened.body.scan.polygon.length, 4);
    assert.equal(opened.body.scan.fixtures.length, 2, 'the normalised scan, sockets included');
    assert.equal(opened.body.design, null, 'no design yet');

    // The editor PUTs the whole design with the rev it loaded.
    const saved = await A('PUT', `/api/projects/${p.id}`, { rev: 1, design: { items: [item(101)] } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.rev, 2);
    assert.ok(saved.body.updatedAt >= p.updatedAt);
    assert.deepEqual(Object.keys(saved.body).sort(), ['rev', 'updatedAt']);

    const stale = await A('PUT', `/api/projects/${p.id}`, { rev: 1, design: { items: [] } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.rev, 2);
    assert.equal(stale.body.updatedAt, saved.body.updatedAt);
    assert.match(stale.body.error, /changed somewhere else/);

    const again = await A('GET', `/api/projects/${p.id}`);
    assert.deepEqual(again.body.design, { version: 3, items: [item(101)] }, 'the stale save changed nothing; the design has a version');
    assert.equal(again.body.project.rev, 2);

    const list = (await A('GET', '/api/projects')).body.projects;
    assert.equal(list.length, 1);
    assert.equal(list[0].rev, 2);

    const renamed = await A('PATCH', `/api/projects/${p.id}`, { name: '  Sennett   Residence ' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.project.name, 'Sennett Residence');
    assert.equal(renamed.body.project.rev, 2, 'a rename does not bump the revision');
    assert.equal((await A('PATCH', `/api/projects/${p.id}`, {})).status, 400);
    assert.equal((await A('PATCH', `/api/projects/${p.id}`, { name: '   ' })).status, 400);
    const long = await A('PATCH', `/api/projects/${p.id}`, { name: 'x'.repeat(200) });
    assert.equal(long.body.project.name.length, 120);

    const dup = await A('POST', `/api/projects/${p.id}/duplicate`, {});
    assert.equal(dup.status, 201);
    // "…(copy)" doesn't fit in 120 characters, so the copy would repeat the name: it gets a number instead.
    assert.equal(dup.body.project.name, 'x'.repeat(116) + ' (2)');
    assert.equal(dup.body.project.source, 'code');
    assert.equal(dup.body.project.rev, 1);
    const dupOpened = (await A('GET', `/api/projects/${dup.body.project.id}`)).body;
    assert.deepEqual(dupOpened.design, { version: 3, items: [item(101)] }, 'the copy has the design');
    assert.deepEqual(dupOpened.scan, opened.body.scan, 'and the scan');
    const named = await A('POST', `/api/projects/${p.id}/duplicate`, { name: 'Second copy' });
    assert.equal(named.body.project.name, 'Second copy');
    const listed = (await A('GET', '/api/projects')).body.projects;
    assert.deepEqual(listed.map((m) => m.id).sort(), [named.body.project.id, dup.body.project.id, p.id].sort());
    for (let i = 1; i < listed.length; i++) assert.ok(listed[i - 1].updatedAt >= listed[i].updatedAt, 'newest first');

    assert.deepEqual((await A('DELETE', `/api/projects/${p.id}`)).body, { ok: true });
    assert.equal((await A('GET', `/api/projects/${p.id}`)).status, 404);
    assert.equal((await A('DELETE', `/api/projects/${p.id}`)).status, 404);
    assert.equal((await A('GET', '/api/projects')).body.projects.length, 2);

    // The code was only copied: it still works, for anyone, until it expires.
    assert.equal((await A('POST', '/api/projects', { code })).status, 201);
  });
}

test('a project from a scan file or a sample, and from a whole home', async (t) => {
  const { A } = await setup(t);
  const file = await A('POST', '/api/projects', { scan: JSON.parse(NAMED) });
  assert.equal(file.status, 201);
  assert.equal(file.body.project.source, 'file');
  assert.equal(file.body.project.name, 'Kitchen');
  const sample = await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE), source: 'sample', name: 'Demo kitchen' });
  assert.equal(sample.body.project.source, 'sample');
  assert.equal(sample.body.project.name, 'Demo kitchen');
  const odd = await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE), source: 'whatever' });
  assert.equal(odd.body.project.source, 'file', 'only file or sample');

  const home = await A('POST', '/api/projects', { scan: JSON.parse(HOME) });
  assert.equal(home.status, 201);
  assert.equal(home.body.project.name, 'Home (3 rooms)');
  assert.equal(home.body.project.rooms, 3);
  const openedHome = (await A('GET', `/api/projects/${home.body.project.id}`)).body;
  assert.equal(openedHome.scan.schema, 'mozu.homescan/1');
  assert.deepEqual(openedHome.scan.rooms.map((r) => r.name), ['Hallway', 'Bedroom A', 'Bedroom B']);

  // The kitchen sample has no name of its own; "Room" is already taken by the file project above.
  assert.equal((await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE) })).body.project.name, 'Room (2)');
});

test('creating: bad codes, expired codes, bad scans, bare bodies, limits', async (t) => {
  let now = Date.now();
  const store = new MemoryAppStore({ now: () => now });
  const { A, phone } = await setup(t, { store, maxProjectBytes: 20_000, maxProjects: 3 });

  const bare = await A('POST', '/api/projects', {});
  assert.equal(bare.status, 400);
  assert.match(bare.body.error, /code.*scan/);
  assert.equal((await A('POST', '/api/projects', '')).status, 400);
  assert.equal((await A('POST', '/api/projects', 'not json')).status, 400);
  assert.equal((await A('POST', '/api/projects', [])).status, 400);
  assert.equal((await A('POST', '/api/projects', { code: 'abc' })).status, 400, 'not a code');
  const gone = await A('POST', '/api/projects', { code: 'B7K4M2' });
  assert.equal(gone.status, 404);
  assert.match(gone.body.error, /not found or has expired/);
  assert.equal((await A('POST', '/api/projects', { scan: { schema: 'mozu.roomscan/1', polygon: [{ x: 0, z: 0 }] } })).status, 400);
  assert.equal((await A('POST', '/api/projects', { scan: { schema: 'mozu.homescan/1', rooms: [] } })).status, 400);
  assert.equal((await A('POST', '/api/projects', { scan: 'nope' })).status, 400);

  const code = await phone(SAMPLE);
  now += 25 * 60 * 60 * 1000;
  assert.equal((await A('POST', '/api/projects', { code })).status, 404, 'an expired code is gone for projects too');

  const big = { ...JSON.parse(SAMPLE), note: 'x'.repeat(25_000) };
  const tooBig = await A('POST', '/api/projects', { scan: big });
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.body.error, /too large/);

  for (let i = 0; i < 3; i++) assert.equal((await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE) })).status, 201);
  const fourth = await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE) });
  assert.equal(fourth.status, 409);
  assert.match(fourth.body.error, /limit of 3 projects/);
  const first = (await A('GET', '/api/projects')).body.projects[0];
  assert.equal((await A('POST', `/api/projects/${first.id}/duplicate`, {})).status, 409, 'duplicating counts too');
});

test('saving: validation, revs and the size cap', async (t) => {
  const { A } = await setup(t, { maxProjectBytes: 20_000 });
  const p = (await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE) })).body.project;
  const put = (body) => A('PUT', `/api/projects/${p.id}`, body);
  assert.equal((await put({ rev: 'one', design: { items: [] } })).status, 400);
  assert.equal((await put({ rev: 0, design: { items: [] } })).status, 400);
  assert.equal((await put({ design: { items: [] } })).status, 400);
  assert.equal((await put({ rev: 1 })).status, 400);
  assert.equal((await put({ rev: 1, design: [] })).status, 400);
  assert.equal((await put({ rev: 1, design: { items: 'no' } })).status, 400);
  assert.match((await put({ rev: 1, design: { items: [{ uid: 'a', roomKey: 'r', center: { x: 0, z: 0 } }] } })).body.error, /uid/);
  assert.match((await put({ rev: 1, design: { items: [{ uid: 1, center: { x: 0, z: 0 } }] } })).body.error, /roomKey/);
  assert.match((await put({ rev: 1, design: { items: [{ uid: 1, roomKey: 'r', center: { x: 0 } }] } })).body.error, /center/);
  const big = await put({ rev: 1, design: { items: [item(1, { blob: 'x'.repeat(25_000) })] } });
  assert.equal(big.status, 413);
  assert.equal((await A('GET', `/api/projects/${p.id}`)).body.project.rev, 1, 'nothing was saved');

  assert.equal((await put({ rev: 1, design: { items: [item(1)], version: 99, extra: true } })).status, 200);
  const got = (await A('GET', `/api/projects/${p.id}`)).body;
  assert.deepEqual(got.design, { version: 3, items: [item(1)] }, 'only items are kept, under the server\'s version');
  assert.equal((await put({ rev: 2, design: { items: [] } })).body.rev, 3);
  assert.equal((await put({ rev: 5, design: { items: [] } })).status, 409, 'a rev from the future is stale too');
  assert.equal((await put({ rev: 3, design: { items: [] } })).body.rev, 4);
});

test('thumbnails: JPEG or WebP data URLs up to 64 KB, shown in the list', async (t) => {
  const { A } = await setup(t);
  const p = (await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE) })).body.project;
  const put = (body) => A('PUT', `/api/projects/${p.id}/thumbnail`, body);
  assert.deepEqual((await put({ dataUrl: JPEG })).body, { ok: true });
  const listed = (await A('GET', '/api/projects')).body.projects[0];
  assert.equal(listed.thumbnail, JPEG);
  assert.equal(listed.updatedAt, p.updatedAt, 'a thumbnail does not reorder the gallery');
  assert.equal(listed.rev, 1);
  assert.equal((await A('GET', `/api/projects/${p.id}`)).body.project.thumbnail, JPEG);

  const webp = 'data:image/webp;base64,' + Buffer.from('webp').toString('base64');
  assert.equal((await put({ dataUrl: webp })).status, 200);
  assert.equal((await put({ dataUrl: 'data:image/png;base64,AAAA' })).status, 400);
  assert.equal((await put({ dataUrl: 'https://evil.test/x.jpg' })).status, 400);
  assert.equal((await put({ dataUrl: 'data:image/jpeg;base64,<script>' })).status, 400);
  assert.equal((await put({})).status, 400);
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(64 * 1024);
  assert.equal((await put({ dataUrl: huge })).status, 413);
  assert.equal((await put({ dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(64 * 1024 - 23) })).status, 200, 'exactly 64 KB is fine');

  assert.equal((await put({ dataUrl: webp })).status, 200);
  const dup = (await A('POST', `/api/projects/${p.id}/duplicate`, {})).body.project;
  assert.equal(dup.thumbnail, webp, 'a copy keeps the thumbnail');
  assert.equal((await A('GET', `/api/projects/${p.id}/thumbnail`)).status, 405);
});

test('projects are private: another account gets 404 on every route', async (t) => {
  const { A, B } = await setup(t);
  const p = (await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE) })).body.project;
  assert.equal((await B('GET', `/api/projects/${p.id}`)).status, 404);
  assert.equal((await B('PUT', `/api/projects/${p.id}`, { rev: 1, design: { items: [] } })).status, 404);
  assert.equal((await B('PATCH', `/api/projects/${p.id}`, { name: 'x' })).status, 404);
  assert.equal((await B('DELETE', `/api/projects/${p.id}`)).status, 404);
  assert.equal((await B('POST', `/api/projects/${p.id}/duplicate`, {})).status, 404);
  assert.equal((await B('PUT', `/api/projects/${p.id}/thumbnail`, { dataUrl: JPEG })).status, 404);
  assert.deepEqual((await B('GET', '/api/projects')).body.projects, []);
  assert.equal((await A('GET', `/api/projects/${p.id}`)).status, 200, 'the owner is unaffected');
  assert.equal((await A('GET', `/api/projects/${p.id}`)).body.project.rev, 1, 'and nothing changed');
});

test('needs a session, refuses cross-site writes, rate limits saves and code lookups', async (t) => {
  const { base, A, phone } = await setup(t, { limits: { writes: 2, lookups: 2 } });
  assert.equal((await fetch(base + '/api/projects')).status, 401);
  assert.equal((await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  const p = (await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE) })).body.project;
  const cross = await fetch(base + `/api/projects/${p.id}`, { method: 'DELETE', headers: { origin: 'https://evil.test' } });
  assert.equal(cross.status, 403, 'cross-site delete refused before even checking the session');
  assert.equal((await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE) }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE) })).status, 201);
  const limited = await A('POST', '/api/projects', { scan: JSON.parse(SAMPLE) });
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /saves/);
  assert.equal((await A('GET', '/api/projects')).status, 200, 'reads are limited separately');
  assert.equal((await A('GET', '/api/projects/nope')).status, 404);
  assert.equal((await A('GET', `/api/projects/${p.id}/unknown`)).status, 404);
  assert.equal((await A('POST', `/api/projects/${p.id}/duplicate/x`, {})).status, 404);
  assert.equal((await A('POST', `/api/projects/${p.id}`, {})).status, 405);

  // Guessing codes through POST /api/projects is limited per network, like GET /api/scan-handoff.
  const { A: fresh } = await setup(t, { limits: { lookups: 2 } });
  const code = await phone(SAMPLE);
  assert.equal((await fresh('POST', '/api/projects', { code: 'B7K4M2' })).status, 404);
  assert.equal((await fresh('POST', '/api/projects', { code: 'B7K4M3' })).status, 404);
  const guessed = await fresh('POST', '/api/projects', { code });
  assert.equal(guessed.status, 429);
  assert.match(guessed.body.error, /code lookups/);
});

test('Vercel functions api/projects/index.js and [...path].js share one router', async (t) => {
  const index = require('../api/projects/index.js');
  const item = require('../api/projects/[...path].js');
  const server = http.createServer((req, res) => (new URL(req.url, 'http://x').pathname.replace(/\/$/, '') === '/api/projects' ? index : item)(req, res));
  const { base, close } = await listen(server);
  t.after(close);
  assert.equal((await fetch(base + '/api/projects')).status, 401);
  assert.equal((await fetch(base + '/api/projects/abcdefgh12')).status, 401);
  assert.equal((await fetch(base + '/api/projects/abcdefgh12/thumbnail', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
});

test('project names are unique within an account: typed duplicates are refused, automatic ones get a number', async (t) => {
  const { A, B, phone } = await setup(t);
  const code = await phone(NAMED); // the scan calls itself "Kitchen"

  const first = await A('POST', '/api/projects', { code });
  assert.equal(first.body.project.name, 'Kitchen');
  assert.equal((await A('POST', '/api/projects', { code })).body.project.name, 'Kitchen (2)', 'automatic names are numbered');
  assert.equal((await A('POST', '/api/projects', { code })).body.project.name, 'Kitchen (3)');

  const clash = await A('POST', '/api/projects', { code, name: '  kitchen ' });
  assert.equal(clash.status, 409, 'a typed name that only differs in case or spacing is a duplicate');
  assert.match(clash.body.error, /already have a project called “kitchen”/);

  const suggested = await A('POST', '/api/projects', { scan: JSON.parse(HOME), suggestedName: 'Two-bedroom', source: 'sample' });
  assert.equal(suggested.body.project.name, 'Two-bedroom');
  assert.equal((await A('POST', '/api/projects', { scan: JSON.parse(HOME), suggestedName: 'Two-bedroom' })).body.project.name, 'Two-bedroom (2)');

  const p = first.body.project;
  assert.equal((await A('PATCH', `/api/projects/${p.id}`, { name: 'KITCHEN (2)' })).status, 409, 'renaming onto another project is refused');
  assert.equal((await A('PATCH', `/api/projects/${p.id}`, { name: 'KITCHEN' })).status, 200, 'changing only the case of its own name is fine');

  assert.equal((await A('POST', `/api/projects/${p.id}/duplicate`, {})).body.project.name, 'KITCHEN (copy)');
  assert.equal((await A('POST', `/api/projects/${p.id}/duplicate`, {})).body.project.name, 'KITCHEN (copy) (2)');
  assert.equal((await A('POST', `/api/projects/${p.id}/duplicate`, { name: 'Kitchen (3)' })).status, 409);

  assert.equal((await B('POST', '/api/projects', { code, name: 'Kitchen' })).status, 201, 'names are per account');
});
