/*
 * Small HTTP helpers shared by every API: JSON responses, request origin,
 * client IP, body reading with a size cap, cookies, and the two checks that
 * keep cross-site requests out (same-origin + JSON content type).
 */
'use strict';

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

const firstHeader = (v) => String(v || '').split(',')[0].trim();

/** Public origin, honouring the proxy in front (Vercel, Cloudflare tunnel). */
function originOf(req) {
  const proto = firstHeader(req.headers['x-forwarded-proto']) || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = firstHeader(req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function isHttps(req) {
  return originOf(req).startsWith('https://');
}

function clientIp(req) {
  return firstHeader(req.headers['x-real-ip']) ||
    firstHeader(req.headers['x-forwarded-for']) ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** Read the whole body as UTF-8, rejecting with status 413 past `limit` bytes. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error('Body is too large.'), { status: 413 });
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume(); // discard the body so the client reads the 413 instead of a reset connection
      reject(tooLarge());
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(tooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Read and parse a JSON body. Errors carry `status` (400 or 413). */
async function readJson(req, limit) {
  const text = await readBody(req, limit);
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Body must be JSON.'), { status: 400 });
  }
}

// ── cookies ────────────────────────────────────────────────────────────────

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    try { out[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[name] = part.slice(i + 1).trim(); }
  }
  return out;
}

/** A Set-Cookie value. `maxAge` in seconds; 0 clears the cookie. */
function cookieHeader(name, value, { maxAge, secure, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// ── cross-site request checks ──────────────────────────────────────────────

/**
 * True when a state-changing request plausibly came from our own pages.
 * Browsers send Origin (or at least Sec-Fetch-Site) on cross-site requests, so
 * a mismatch is rejected. Requests with neither header (curl, the iPad app)
 * are allowed: they don't carry the person's cookies automatically anyway.
 */
function sameOrigin(req) {
  const origin = firstHeader(req.headers.origin);
  if (origin && origin !== 'null') return origin === originOf(req);
  const site = firstHeader(req.headers['sec-fetch-site']);
  if (site) return site === 'same-origin' || site === 'none';
  return true;
}

function isJsonRequest(req) {
  return /^application\/json\b/i.test(String(req.headers['content-type'] || ''));
}

module.exports = {
  sendJson,
  originOf,
  isHttps,
  clientIp,
  readBody,
  readJson,
  parseCookies,
  cookieHeader,
  sameOrigin,
  isJsonRequest,
};
