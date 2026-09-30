'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAppStore, RedisAppStore, createAppStore, newId, K } = require('../server/app-store');
const { fakeUpstash } = require('./helpers/fake-upstash');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const identity = { email: 'a@b.test', name: 'A', picture: '', emailVerified: false, provider: 'password' };
const room = (name) => ({ schema: 'mozu.roomscan/1', name, polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], openings: [], objects: [], fixtures: [] });
const design = (n) => ({ version: 3, items: Array.from({ length: n }, (_, i) => ({ uid: i + 1, roomKey: 'r0', center: { x: i, z: 0 } })) });

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

  test(`${name}: projects — create, list newest first, get, save a design with rev, conflict, rename, thumbnail, delete`, async () => {
    const store = make();
    const now = Date.now();
    const mk = (n, at) => store.createProject({ id: 'p' + n, ownerId: 'u1', name: 'Project ' + n, rooms: n, source: 'code', createdAt: at, updatedAt: at }, room('Room ' + n));
    await mk(1, now - 3000);
    await mk(2, now - 2000);
    await mk(3, now - 1000);
    await store.createProject({ id: 'px', ownerId: 'u2', name: 'Other', rooms: 1, source: 'file', createdAt: now, updatedAt: now }, room('Other'));

    const list = await store.listProjects('u1');
    assert.deepEqual(list.map((m) => m.id), ['p3', 'p2', 'p1']);
    assert.deepEqual(list[0], { id: 'p3', ownerId: 'u1', name: 'Project 3', source: 'code', createdAt: now - 1000, updatedAt: now - 1000, rev: 1, rooms: 3, bytes: 0 });
    assert.equal(await store.countProjects('u1'), 3);
    assert.deepEqual((await store.listProjects('u1', 2)).map((m) => m.id), ['p3', 'p2']);

    const got = await store.getProject('p1');
    assert.equal(got.meta.ownerId, 'u1');
    assert.equal(got.scan.name, 'Room 1');
    assert.equal(got.design, null, 'no design until the first save');
    assert.equal(await store.getProject('missing'), null);
    assert.equal(await store.getProjectMeta('missing'), null);

    const saved = await store.saveDesign('p1', 1, design(2));
    assert.equal(saved.ok, true);
    assert.equal(saved.rev, 2);
    const after = await store.getProject('p1');
    assert.equal(after.meta.rev, 2);
    assert.ok(after.meta.bytes > 50, 'bytes follow the design');
    assert.deepEqual(after.design, design(2));
    assert.deepEqual(after.scan, room('Room 1'), 'the scan is untouched');
    assert.equal((await store.listProjects('u1'))[0].id, 'p1', 'saving moves a project to the top');

    const conflict = await store.saveDesign('p1', 1, design(9));
    assert.deepEqual({ ok: conflict.ok, conflict: conflict.conflict, rev: conflict.rev }, { ok: false, conflict: true, rev: 2 });
    assert.equal(conflict.updatedAt, after.meta.updatedAt);
    assert.deepEqual((await store.getProject('p1')).design, design(2), 'a conflicting save changes nothing');
    assert.equal(await store.saveDesign('missing', 1, design(1)), null);

    const renamed = await store.updateMeta('p2', { name: 'Renamed' }, { touch: true });
    assert.equal(renamed.name, 'Renamed');
    assert.equal(renamed.rev, 1, 'renaming does not bump the revision');
    assert.ok(renamed.updatedAt >= now);
    assert.equal((await store.listProjects('u1'))[0].id, 'p2', 'renaming moves it to the top');
    const thumb = await store.updateMeta('p3', { thumbnail: 'data:image/jpeg;base64,AAAA' });
    assert.equal(thumb.thumbnail, 'data:image/jpeg;base64,AAAA');
    assert.equal(thumb.updatedAt, now - 1000, 'a thumbnail does not touch updatedAt');
    assert.equal((await store.listProjects('u1')).find((m) => m.id === 'p3').thumbnail, 'data:image/jpeg;base64,AAAA', 'the list carries it');
    assert.ok(!('thumbnail' in (await store.getProjectMeta('p1'))), 'absent until set');
    assert.equal(await store.updateMeta('missing', { name: 'x' }), null);

    assert.equal(await store.deleteProject('p2'), true);
    assert.equal(await store.deleteProject('p2'), false);
    assert.deepEqual((await store.listProjects('u1')).map((m) => m.id), ['p1', 'p3']);
    assert.equal(await store.getProject('p2'), null);
  });

  test(`${name}: a project can be created with a design already in it (duplicates)`, async () => {
    const store = make();
    const now = Date.now();
    await store.createProject({ id: 'p1', ownerId: 'u1', name: 'One', rooms: 1, source: 'sample', createdAt: now, updatedAt: now }, room('One'), design(3));
    const got = await store.getProject('p1');
    assert.deepEqual(got.design, design(3));
    assert.equal(got.meta.rev, 1);
    assert.ok(got.meta.bytes > 0);
  });
}

test('redis: the keys are laid out as documented', async () => {
  const upstash = fakeUpstash();
  const store = new RedisAppStore({ url: 'https://redis.test', token: 'secret', fetch: upstash.fetch });
  const now = Date.now();
  await store.createProject({ id: 'p1', ownerId: 'u1', name: 'One', rooms: 1, source: 'code', createdAt: now, updatedAt: now }, room('One'));
  assert.equal(upstash.data.get(K.project('p1')).type, 'hash');
  assert.equal(upstash.data.get(K.projectScan('p1')).type, 'string');
  assert.equal(upstash.data.has(K.projectDesign('p1')), false, 'no design key until the first save');
  assert.equal(upstash.data.get(K.userProjects('u1')).type, 'zset');
  await store.saveDesign('p1', 1, design(1));
  assert.equal(upstash.data.get(K.projectDesign('p1')).type, 'string');
  await store.deleteProject('p1');
  for (const key of [K.project('p1'), K.projectScan('p1'), K.projectDesign('p1')]) assert.equal(upstash.data.has(key), false, key);
  assert.equal(upstash.data.get(K.userProjects('u1')).value.size, 0);
});

test('redis: the user index drops projects that no longer exist', async () => {
  const upstash = fakeUpstash();
  const store = new RedisAppStore({ url: 'https://redis.test', token: 'secret', fetch: upstash.fetch });
  const now = Date.now();
  await store.createProject({ id: 'p1', ownerId: 'u1', name: 'One', rooms: 1, source: 'code', createdAt: now, updatedAt: now }, room('One'));
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
