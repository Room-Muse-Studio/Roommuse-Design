'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAppStore, RedisAppStore, createAppStore, newId } = require('../server/app-store');
const { fakeUpstash } = require('./helpers/fake-upstash');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const identity = { email: 'a@b.test', name: 'A', picture: '', emailVerified: false, provider: 'password' };
const data = (name, n = 1) => ({ version: 2, projectName: name, clientName: 'C', spaces: Array.from({ length: n }, (_, i) => ({ id: 'sp' + i, items: [] })), activeSpace: 'sp0', tab: 'kitchen', uid: 100 });

for (const [name, make] of [
  ['memory', () => new MemoryAppStore()],
  ['redis', () => new RedisAppStore({ url: 'https://redis.test', token: 'secret', fetch: fakeUpstash().fetch })],
]) {
  test(`${name}: users are upserted and providers accumulate`, async () => {
    const store = make();
    assert.equal(await store.getUser('u1'), null);
    const first = await store.upsertUser('u1', identity);
    assert.equal(first.email, 'a@b.test');
    assert.deepEqual(first.providers, ['password']);
    const second = await store.upsertUser('u1', { ...identity, emailVerified: true, provider: 'google.com', name: '' });
    assert.deepEqual(second.providers.sort(), ['google.com', 'password']);
    assert.equal(second.emailVerified, true);
    assert.equal(second.name, 'A', 'an empty name never overwrites a known one');
    assert.equal(second.createdAt, first.createdAt);
    assert.equal((await store.getUser('u1')).uid, 'u1');
  });

  test(`${name}: sessions create, read, renew, delete, expire`, async () => {
    const store = make();
    const s = await store.createSession('u1', { ua: 'test' }, 60_000);
    assert.equal(s.sid.length, 43, 'sid is 32 random bytes base64url');
    assert.equal((await store.getSession(s.sid)).uid, 'u1');
    assert.equal(await store.getSession('nope'), null);
    const renewed = await store.touchSession(s.sid, 120_000);
    assert.ok(renewed > s.expiresAt);
    await store.deleteSession(s.sid);
    assert.equal(await store.getSession(s.sid), null);
    const short = await store.createSession('u1', {}, 1);
    await sleep(5);
    assert.equal(await store.getSession(short.sid), null, 'expired sessions are gone');
  });

  test(`${name}: projects — create, list newest first, get, save with rev, conflict, delete`, async () => {
    const store = make();
    const now = Date.now();
    const mk = (n, at) => store.createProject({ id: 'p' + n, ownerId: 'u1', name: 'Project ' + n, clientName: 'C', createdAt: at, updatedAt: at, schemaVersion: 2, source: 'blank' }, data('Project ' + n, n));
    await mk(1, now - 3000);
    await mk(2, now - 2000);
    await mk(3, now - 1000);
    await store.createProject({ id: 'px', ownerId: 'u2', name: 'Other', createdAt: now, updatedAt: now, schemaVersion: 2 }, data('Other'));

    const list = await store.listProjects('u1');
    assert.deepEqual(list.map((m) => m.id), ['p3', 'p2', 'p1']);
    assert.equal(list[0].rev, 1);
    assert.equal(list[0].spaces, 3);
    assert.ok(list[0].bytes > 50);
    assert.equal(await store.countProjects('u1'), 3);
    assert.deepEqual((await store.listProjects('u1', 2)).map((m) => m.id), ['p3', 'p2']);

    const got = await store.getProject('p1');
    assert.equal(got.meta.ownerId, 'u1');
    assert.equal(got.data.projectName, 'Project 1');
    assert.equal(await store.getProject('missing'), null);
    assert.equal(await store.getProjectMeta('missing'), null);

    const saved = await store.saveProject('p1', 1, data('Renamed', 2), { name: 'Renamed' });
    assert.equal(saved.ok, true);
    assert.equal(saved.rev, 2);
    const after = await store.getProject('p1');
    assert.equal(after.meta.rev, 2);
    assert.equal(after.meta.name, 'Renamed');
    assert.equal(after.meta.spaces, 2);
    assert.equal(after.data.projectName, 'Renamed');
    assert.equal((await store.listProjects('u1'))[0].id, 'p1', 'saving moves a project to the top');

    const conflict = await store.saveProject('p1', 1, data('Stale'));
    assert.deepEqual({ ok: conflict.ok, conflict: conflict.conflict, rev: conflict.rev }, { ok: false, conflict: true, rev: 2 });
    assert.equal((await store.getProject('p1')).data.projectName, 'Renamed', 'a conflicting save changes nothing');
    assert.equal(await store.saveProject('missing', 1, data('x')), null);

    assert.equal(await store.deleteProject('p2'), true);
    assert.equal(await store.deleteProject('p2'), false);
    assert.deepEqual((await store.listProjects('u1')).map((m) => m.id), ['p1', 'p3']);
    assert.equal(await store.getProject('p2'), null);
  });
}

test('redis: the user index drops projects that no longer exist', async () => {
  const upstash = fakeUpstash();
  const store = new RedisAppStore({ url: 'https://redis.test', token: 'secret', fetch: upstash.fetch });
  const now = Date.now();
  await store.createProject({ id: 'p1', ownerId: 'u1', name: 'One', createdAt: now, updatedAt: now, schemaVersion: 2 }, data('One'));
  upstash.data.delete('mozu:project:p1'); // meta vanished behind our back
  assert.deepEqual(await store.listProjects('u1'), []);
  assert.equal(await store.countProjects('u1'), 0, 'stale index entry was removed');
});

test('ids are url-safe and long enough', () => {
  const id = newId();
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
});

test('createAppStore picks memory locally and redis from the environment', () => {
  assert.ok(createAppStore({}) instanceof MemoryAppStore);
  assert.ok(createAppStore({ KV_REST_API_URL: 'https://r', KV_REST_API_TOKEN: 't' }) instanceof RedisAppStore);
  assert.throws(() => createAppStore({ VERCEL: '1' }), /No Redis configured/);
});
