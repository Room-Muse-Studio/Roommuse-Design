/*
 * Verify a Firebase Authentication ID token without any SDK.
 *
 * The browser signs in with Firebase (email+password or Google) and hands the
 * server the resulting ID token exactly once, at POST /api/auth/session. The
 * token is a JWT signed with one of Google's rotating RS256 keys, published as
 * X.509 certificates at a public URL. We fetch those (cached for the max-age
 * Google sends), check the signature with node:crypto, then the claims Firebase
 * documents: aud = project id, iss = https://securetoken.google.com/<project>,
 * exp in the future, iat in the past, non-empty sub.
 *
 * `fetch` and `now` are injectable so tests can sign tokens with their own key.
 */
'use strict';

const crypto = require('node:crypto');

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CLOCK_SKEW_S = 60;

class TokenError extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
    this.status = 401;
  }
}

function b64urlDecode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4), 'base64');
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new TokenError('Not a valid token.', 'malformed');
  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch {
    throw new TokenError('Not a valid token.', 'malformed');
  }
  return { header, payload, signed: `${parts[0]}.${parts[1]}`, signature: b64urlDecode(parts[2]) };
}

function maxAgeSeconds(cacheControl) {
  const m = /max-age=(\d+)/i.exec(String(cacheControl || ''));
  return m ? Number(m[1]) : 3600;
}

/**
 * @param options.projectId  Firebase project id (FIREBASE_PROJECT_ID)
 * @param options.certsUrl   override Google's certificate URL (tests)
 * @param options.fetch      fetch implementation (tests)
 * @param options.now        () => ms since epoch (tests)
 */
function createFirebaseVerifier({ projectId, certsUrl = GOOGLE_CERTS_URL, fetch: fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  let cache = { keys: null, expiresAt: 0 };

  async function publicKeys(force = false) {
    if (!force && cache.keys && cache.expiresAt > now()) return cache.keys;
    const res = await fetchImpl(certsUrl, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Could not fetch Firebase signing keys (HTTP ${res.status}).`);
    const certs = await res.json();
    const keys = {};
    for (const [kid, pem] of Object.entries(certs)) {
      // Google publishes X.509 certificates; a bare public key is accepted too (tests).
      try { keys[kid] = new crypto.X509Certificate(pem).publicKey; continue; } catch { /* not a certificate */ }
      try { keys[kid] = crypto.createPublicKey(pem); } catch { /* skip unreadable entries */ }
    }
    cache = { keys, expiresAt: now() + maxAgeSeconds(res.headers && res.headers.get && res.headers.get('cache-control')) * 1000 };
    return keys;
  }

  /** Verify an ID token; resolves to the identity it carries. */
  async function verify(idToken) {
    if (!projectId) throw new TokenError('Sign-in is not configured on this server (FIREBASE_PROJECT_ID is missing).', 'unconfigured');
    const { header, payload, signed, signature } = parseJwt(idToken);
    if (header.alg !== 'RS256' || !header.kid) throw new TokenError('Not a valid token.', 'alg');

    let keys = await publicKeys();
    if (!keys[header.kid]) keys = await publicKeys(true); // key rotated since we cached
    const key = keys[header.kid];
    if (!key) throw new TokenError('Token was signed with an unknown key.', 'kid');
    if (!crypto.verify('RSA-SHA256', Buffer.from(signed), key, signature)) throw new TokenError('Token signature is invalid.', 'signature');

    const t = Math.floor(now() / 1000);
    if (payload.aud !== projectId) throw new TokenError('Token is for a different project.', 'aud');
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new TokenError('Token issuer is wrong.', 'iss');
    if (!(Number(payload.exp) > t - CLOCK_SKEW_S)) throw new TokenError('Your sign-in expired. Please sign in again.', 'exp');
    if (!(Number(payload.iat) <= t + CLOCK_SKEW_S)) throw new TokenError('Token is not valid yet.', 'iat');
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new TokenError('Token has no subject.', 'sub');

    const firebase = payload.firebase || {};
    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : '',
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : '',
      picture: typeof payload.picture === 'string' ? payload.picture : '',
      provider: typeof firebase.sign_in_provider === 'string' ? firebase.sign_in_provider : '',
      authTime: Number(payload.auth_time) || Number(payload.iat) || t,
    };
  }

  return { verify, publicKeys };
}

module.exports = { createFirebaseVerifier, TokenError, GOOGLE_CERTS_URL, parseJwt };
