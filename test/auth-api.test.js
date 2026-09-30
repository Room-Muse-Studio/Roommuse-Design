'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../server/server');
const { MemoryAppStore } = require('../server/app-store');
const { createFirebaseVerifier } = require('../server/firebase-token');
const { fakeFirebase } = require('./helpers/fake-firebase');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** A local server whose verifier trusts the fake Firebase key and whose clock matches it. */
function setup(t, extra = {}) {
  const fb = fakeFirebase({ now: () => Date.now() });
  const verifier = createFirebaseVerifier({ projectId: fb.projectId, certsUrl: 'https://certs.test', fetch: fb.fetch });
  const store = new MemoryAppStore();
  const server = createServer({ store, verifier, limits: { uploads: 0, lookups: 0, sessions: 0, ...extra.limits } });
  return listen(server).then(({ base, close }) => { t.after(close); return { base, fb, store }; });
}

const signIn = (base, token, headers = {}) => fetch(base + '/api/auth/session', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ idToken: token }),
});
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

test('sign in → cookie → me → sign out', async (t) => {
  const { base, fb } = await setup(t);

  const res = await signIn(base, fb.token());
  assert.equal(res.status, 201);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /^mozu_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const body = await res.json();
  assert.deepEqual(body.user, { uid: 'uid_123', email: 'person@example.com', emailVerified: true, name: 'Pat Person', picture: 'https://example.com/p.png', providers: ['password'] });
  assert.ok(Date.parse(body.session.expiresAt) > Date.now() + 29 * 86400_000);

  const cookie = cookieOf(res);
  const me = await fetch(base + '/api/auth/me', { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.uid, 'uid_123');

  const out = await fetch(base + '/api/auth/session', { method: 'DELETE', headers: { cookie } });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /^mozu_session=; .*Max-Age=0/);
  assert.equal((await fetch(base + '/api/auth/me', { headers: { cookie } })).status, 401, 'the session is revoked server-side');
});

test('me without or with a bogus cookie is 401 (and clears the bogus one)', async (t) => {
  const { base } = await setup(t);
  assert.equal((await fetch(base + '/api/auth/me')).status, 401);
  const bogus = await fetch(base + '/api/auth/me', { headers: { cookie: 'mozu_session=nope' } });
  assert.equal(bogus.status, 401);
  assert.match(bogus.headers.get('set-cookie'), /Max-Age=0/);
});

test('the cookie is Secure behind https', async (t) => {
  const { base, fb } = await setup(t);
  const res = await signIn(base, fb.token(), { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'mozu.test' });
  assert.equal(res.status, 201);
  assert.match(res.headers.get('set-cookie'), /; Secure$/);
});

test('bad, stale or missing tokens are refused', async (t) => {
  const { base, fb } = await setup(t);
  assert.equal((await signIn(base, 'garbage')).status, 401);
  assert.equal((await signIn(base, fb.token({ aud: 'other' }))).status, 401);
  const stale = await signIn(base, fb.token({ auth_time: Math.floor(Date.now() / 1000) - 3600 }));
  assert.equal(stale.status, 401);
  assert.match((await stale.json()).error, /too old/);
  const missing = await fetch(base + '/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(missing.status, 400);
});

test('cross-site and non-JSON sign-in attempts are refused', async (t) => {
  const { base, fb } = await setup(t);
  const cross = await signIn(base, fb.token(), { origin: 'https://evil.test' });
  assert.equal(cross.status, 403);
  const fetchSite = await signIn(base, fb.token(), { 'sec-fetch-site': 'cross-site' });
  assert.equal(fetchSite.status, 403);
  const form = await fetch(base + '/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'idToken=x' });
  assert.equal(form.status, 415);
  const sameOrigin = await signIn(base, fb.token(), { origin: base });
  assert.equal(sameOrigin.status, 201, 'our own origin is fine');
  const signedIn = cookieOf(sameOrigin);
  const crossOut = await fetch(base + '/api/auth/session', { method: 'DELETE', headers: { cookie: signedIn, origin: 'https://evil.test' } });
  assert.equal(crossOut.status, 403);
  assert.equal((await fetch(base + '/api/auth/me', { headers: { cookie: signedIn } })).status, 200, 'still signed in');
});

test('sign-in attempts are rate limited per network', async (t) => {
  const { base, fb } = await setup(t, { limits: { sessions: 2 } });
  assert.equal((await signIn(base, fb.token())).status, 201);
  assert.equal((await signIn(base, fb.token())).status, 201);
  const limited = await signIn(base, fb.token());
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /sign-in attempts/);
});

test('unknown auth routes and methods', async (t) => {
  const { base } = await setup(t);
  assert.equal((await fetch(base + '/api/auth/whatever')).status, 404);
  assert.equal((await fetch(base + '/api/auth/session', { method: 'GET' })).status, 405);
  assert.equal((await fetch(base + '/api/auth/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 405);
});

test('Vercel catch-all api/auth/[action].js dispatches by path', async (t) => {
  const fn = require('../api/auth/[action].js');
  const server = http.createServer((req, res) => fn(req, res));
  const { base, close } = await listen(server);
  t.after(close);
  assert.equal((await fetch(base + '/api/auth/me')).status, 401);
  // No FIREBASE_PROJECT_ID in the test environment → a clear "not configured" answer.
  const prev = process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_PROJECT_ID;
  try {
    const res = await signIn(base, 'x.y.z');
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /FIREBASE_PROJECT_ID/);
  } finally {
    if (prev !== undefined) process.env.FIREBASE_PROJECT_ID = prev;
  }
});
