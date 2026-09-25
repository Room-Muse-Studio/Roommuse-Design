'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createFirebaseVerifier, TokenError } = require('../server/firebase-token');
const { fakeFirebase, NOW_MS } = require('./helpers/fake-firebase');

function verifierFor(fb, extra = {}) {
  return createFirebaseVerifier({ projectId: fb.projectId, certsUrl: 'https://certs.test', fetch: fb.fetch, now: fb.now, ...extra });
}

const reason = async (p) => {
  try { await p; } catch (e) { assert.ok(e instanceof TokenError, `TokenError expected, got ${e && e.message}`); return e.reason; }
  return 'no-error';
};

test('a valid token yields the identity', async () => {
  const fb = fakeFirebase();
  const id = await verifierFor(fb).verify(fb.token());
  assert.deepEqual(id, {
    uid: 'uid_123', email: 'person@example.com', emailVerified: true, name: 'Pat Person',
    picture: 'https://example.com/p.png', provider: 'password', authTime: Math.floor(NOW_MS / 1000) - 10,
  });
});

test('rejects wrong audience, issuer, expiry, future iat, missing sub', async () => {
  const fb = fakeFirebase();
  const v = verifierFor(fb);
  const t = Math.floor(NOW_MS / 1000);
  assert.equal(await reason(v.verify(fb.token({ aud: 'other-project' }))), 'aud');
  assert.equal(await reason(v.verify(fb.token({ iss: 'https://securetoken.google.com/other' }))), 'iss');
  assert.equal(await reason(v.verify(fb.token({ exp: t - 3600 }))), 'exp');
  assert.equal(await reason(v.verify(fb.token({ iat: t + 3600 }))), 'iat');
  assert.equal(await reason(v.verify(fb.token({ sub: '' }))), 'sub');
});

test('rejects bad signatures, unknown keys, wrong algorithm and garbage', async () => {
  const fb = fakeFirebase();
  const v = verifierFor(fb);
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.equal(await reason(v.verify(fb.token({}, { key: other }))), 'signature');
  assert.equal(await reason(v.verify(fb.token({}, { kid: 'nope' }))), 'kid');
  assert.equal(await reason(v.verify(fb.token({}, { alg: 'HS256' }))), 'alg');
  assert.equal(await reason(v.verify('not.a.jwt.at.all')), 'malformed');
  assert.equal(await reason(v.verify('')), 'malformed');
  const [h, p] = fb.token().split('.');
  assert.equal(await reason(v.verify(`${h}.${p}.AAAA`)), 'signature');
});

test('without a project id every token is refused as unconfigured', async () => {
  const fb = fakeFirebase();
  assert.equal(await reason(verifierFor(fb, { projectId: '' }).verify(fb.token())), 'unconfigured');
});

test('caches Google keys and refetches when an unknown kid shows up', async () => {
  const fb = fakeFirebase();
  const v = verifierFor(fb);
  await v.verify(fb.token());
  await v.verify(fb.token());
  assert.equal(fb.fetches, 1, 'second verify used the cache');
  // Key rotation: a new key id appears; the verifier refetches once.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fb.keys.kid2 = publicKey.export({ type: 'spki', format: 'pem' });
  await v.verify(fb.token({}, { kid: 'kid2', key: privateKey }));
  assert.equal(fb.fetches, 2);
});
