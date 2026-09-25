'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../server/server');
const { MemoryAppStore, RedisAppStore } = require('../server/app-store');
const { createFirebaseVerifier } = require('../server/firebase-token');
const { defaultProjectData, validateProjectData } = require('../server/project-api');
const { fakeFirebase } = require('./helpers/fake-firebase');
const { fakeUpstash } = require('./helpers/fake-upstash');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Server + two signed-in people (A and B) as cookie strings. */
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
  const as = (cookie) => async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: json, headers: res.headers };
  };
  return { base, store, A: as(await login('alice')), B: as(await login('bob')) };
}

test('defaultProjectData is a valid blank kitchen', () => {
  const d = defaultProjectData('My kitchen');
  assert.equal(validateProjectData(d), null);
  assert.equal(d.spaces[0].wallW, 6000);
  assert.match(validateProjectData({ version: 1, spaces: [] }), /version/);
  assert.match(validateProjectData({ version: 2, spaces: [] }), /non-empty/);
  assert.match(validateProjectData({ version: 2, spaces: [{ id: 1 }] }), /string id/);
});

for (const [name, makeStore] of [
  ['memory', () => new MemoryAppStore()],
  ['redis', () => new RedisAppStore({ url: 'https://redis.test', token: 'secret', fetch: fakeUpstash().fetch })],
]) {
  test(`${name}: create, list, open, autosave with rev, rename, duplicate, delete`, async (t) => {
    const { A } = await setup(t, { store: makeStore() });

    assert.deepEqual((await A('GET', '/api/projects')).body, { projects: [] });

    const created = await A('POST', '/api/projects', { name: '  Sennett   Residence ' });
    assert.equal(created.status, 201);
    const p = created.body.project;
    assert.equal(p.name, 'Sennett Residence');
    assert.equal(p.rev, 1);
    assert.equal(p.source, 'blank');

    const opened = await A('GET', `/api/projects/${p.id}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.data.projectName, 'Sennett Residence');
    assert.equal(opened.body.data.spaces[0].wallW, 6000);

    // Autosave: the editor PUTs the whole saved-project JSON with the rev it loaded.
    const data = { ...opened.body.data, projectName: 'Sennett Residence — Unit 12-04', spaces: [{ ...opened.body.data.spaces[0], items: [{ uid: 101, sku: 'KF01', x: 0 }] }] };
    const saved = await A('PUT', `/api/projects/${p.id}`, { rev: 1, data });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.rev, 2);

    const stale = await A('PUT', `/api/projects/${p.id}`, { rev: 1, data });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.rev, 2);
    assert.match(stale.body.error, /changed somewhere else/);

    const list = (await A('GET', '/api/projects')).body.projects;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Sennett Residence — Unit 12-04', 'the name follows data.projectName');
    assert.equal(list[0].rev, 2);

    const renamed = await A('PATCH', `/api/projects/${p.id}`, { name: 'Unit 12-04', clientName: 'Studio Aoki' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.project.name, 'Unit 12-04');
    assert.equal(renamed.body.project.clientName, 'Studio Aoki');
    assert.equal(renamed.body.project.rev, 3);
    assert.equal((await A('GET', `/api/projects/${p.id}`)).body.data.projectName, 'Unit 12-04');
    assert.equal((await A('PATCH', `/api/projects/${p.id}`, {})).status, 400);

    const dup = await A('POST', `/api/projects/${p.id}/duplicate`, {});
    assert.equal(dup.status, 201);
    assert.equal(dup.body.project.name, 'Unit 12-04 (copy)');
    assert.equal(dup.body.project.source, `copy:${p.id}`);
    assert.equal((await A('GET', `/api/projects/${dup.body.project.id}`)).body.data.spaces[0].items.length, 1);
    assert.deepEqual((await A('GET', '/api/projects')).body.projects.map((m) => m.id), [dup.body.project.id, p.id], 'newest first');

    assert.equal((await A('DELETE', `/api/projects/${p.id}`)).status, 200);
    assert.equal((await A('GET', `/api/projects/${p.id}`)).status, 404);
    assert.equal((await A('GET', '/api/projects')).body.projects.length, 1);
  });
}

test('projects are private: another account gets 404 on every route', async (t) => {
  const { A, B } = await setup(t);
  const p = (await A('POST', '/api/projects', { name: 'Mine' })).body.project;
  assert.equal((await B('GET', `/api/projects/${p.id}`)).status, 404);
  assert.equal((await B('PUT', `/api/projects/${p.id}`, { rev: 1, data: defaultProjectData('x') })).status, 404);
  assert.equal((await B('PATCH', `/api/projects/${p.id}`, { name: 'x' })).status, 404);
  assert.equal((await B('DELETE', `/api/projects/${p.id}`)).status, 404);
  assert.equal((await B('POST', `/api/projects/${p.id}/duplicate`, {})).status, 404);
  assert.deepEqual((await B('GET', '/api/projects')).body.projects, []);
  assert.equal((await A('GET', `/api/projects/${p.id}`)).status, 200, 'the owner is unaffected');
});

test('importing existing data, validation, size and count limits', async (t) => {
  const { A } = await setup(t, { maxProjectBytes: 2000, maxProjects: 2 });
  const imported = await A('POST', '/api/projects', { data: { ...defaultProjectData('From this device'), clientName: 'Ms Tan' }, source: 'local-import' });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.project.name, 'From this device');
  assert.equal(imported.body.project.clientName, 'Ms Tan');
  assert.equal(imported.body.project.source, 'local-import');

  assert.equal((await A('POST', '/api/projects', { data: { version: 1 } })).status, 400);
  const big = { ...defaultProjectData('Big'), note: 'x'.repeat(3000) };
  const tooBig = await A('PUT', `/api/projects/${imported.body.project.id}`, { rev: 1, data: big });
  assert.equal(tooBig.status, 413);
  assert.equal((await A('PUT', `/api/projects/${imported.body.project.id}`, { rev: 'one', data: defaultProjectData('x') })).status, 400);

  assert.equal((await A('POST', '/api/projects', { name: 'Second' })).status, 201);
  const third = await A('POST', '/api/projects', { name: 'Third' });
  assert.equal(third.status, 409);
  assert.match(third.body.error, /limit of 2 projects/);
});

test('needs a session, refuses cross-site writes, rate limits saves', async (t) => {
  const { base, A } = await setup(t, { limits: { writes: 2 } });
  assert.equal((await fetch(base + '/api/projects')).status, 401);
  assert.equal((await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  const p = (await A('POST', '/api/projects', { name: 'One' })).body.project;
  const cross = await fetch(base + `/api/projects/${p.id}`, { method: 'DELETE', headers: { origin: 'https://evil.test' } });
  assert.equal(cross.status, 403, 'cross-site delete refused before even checking the session');
  assert.equal((await A('POST', '/api/projects', { name: 'Two' })).status, 201);
  const limited = await A('POST', '/api/projects', { name: 'Three' });
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /saves/);
  assert.equal((await A('GET', '/api/projects')).status, 200, 'reads are limited separately');
  assert.equal((await A('GET', '/api/projects/nope')).status, 404);
  assert.equal((await A('GET', `/api/projects/${p.id}/unknown`)).status, 404);
  assert.equal((await A('POST', `/api/projects/${p.id}/duplicate/x`, {})).status, 404);
});

test('Vercel catch-all api/projects/[[...path]].js routes list and item paths', async (t) => {
  const fn = require('../api/projects/[[...path]].js');
  const server = http.createServer((req, res) => fn(req, res));
  const { base, close } = await listen(server);
  t.after(close);
  assert.equal((await fetch(base + '/api/projects')).status, 401);
  assert.equal((await fetch(base + '/api/projects/abcdefgh12')).status, 401);
});
