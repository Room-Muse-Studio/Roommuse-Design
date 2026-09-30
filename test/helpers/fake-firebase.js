'use strict';

const crypto = require('node:crypto');

const PROJECT = 'mozu-test';
const NOW_MS = 1_800_000_000_000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** A signing key plus a fake "Google certs" endpoint that publishes it. */
function fakeFirebase({ projectId = PROJECT, now = () => NOW_MS } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = { kid1: publicKey.export({ type: 'spki', format: 'pem' }) };
  let fetches = 0;

  async function fetch() {
    fetches++;
    return { ok: true, status: 200, headers: { get: () => 'public, max-age=3600' }, json: async () => ({ ...keys }) };
  }

  function token(overrides = {}, { kid = 'kid1', key = privateKey, alg = 'RS256' } = {}) {
    const t = Math.floor(now() / 1000);
    const payload = {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: 'uid_123',
      iat: t - 10,
      exp: t + 3600,
      auth_time: t - 10,
      email: 'Person@Example.com',
      email_verified: true,
      name: 'Pat Person',
      picture: 'https://example.com/p.png',
      firebase: { sign_in_provider: 'password' },
      ...overrides,
    };
    const signed = `${b64url(JSON.stringify({ alg, typ: 'JWT', kid }))}.${b64url(JSON.stringify(payload))}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signed), key);
    return `${signed}.${b64url(signature)}`;
  }

  return { projectId, now, fetch, token, keys, privateKey, get fetches() { return fetches; } };
}

module.exports = { fakeFirebase, NOW_MS, PROJECT };
