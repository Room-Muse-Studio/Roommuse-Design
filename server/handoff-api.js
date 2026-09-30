/*
 * The handoff API, shared by the local server (server/server.js) and the
 * Vercel functions (api/*.js) so both run exactly the same code.
 *
 *   POST /api/scan-handoff              iPad uploads a RoomScan → 201 { code, url, expiresAt }
 *   GET  /api/scan-handoff?code=XXXXXX  page fetches it back   → 200 { code, scan, expiresAt }
 *   GET  /api/health                    store reachable?       → 200 { ok, store } / 503
 *
 * Errors are always { error } with a sentence a person can act on; the iPad app
 * shows that text as-is (apps/ios/MozuScanner/Export/Handoff.swift).
 */
'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  MAX_SCAN_BYTES,
  HANDOFF_TTL_MS,
  createStore,
  storeScan,
  fetchScan,
  handoffUrl,
  normaliseCode,
} = require('./handoff-store');

const SDK_FILE = path.join(__dirname, '..', 'packages', 'scan-sdk', 'dist', 'mozu-scan-sdk.js');
const RATE_WINDOW_MS = 10 * 60 * 1000;

// ── scan validation ────────────────────────────────────────────────────────

// The built SDK validates the room outline and normalises the scan (fixtures
// included). The checks below are only for when it fails to load.
const ROOMSCAN = 'mozu.roomscan/1';
const HOMESCAN = 'mozu.homescan/1';
let sdk = null;
const sdkReady = import(pathToFileURL(SDK_FILE).href)
  .then((module) => { sdk = module; })
  .catch((e) => console.warn('[mozu] scan SDK not loaded, using built-in checks:', e.message));

/** One room without the SDK: at least 3 usable corners. */
function fallbackRoom(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const polygon = Array.isArray(raw.polygon)
    ? raw.polygon.map((p) => ({ x: Number(p && p.x), z: Number(p && p.z) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z))
    : [];
  const list = (key) => (Array.isArray(raw[key]) ? raw[key] : []);
  return polygon.length >= 3
    ? { ...raw, schema: ROOMSCAN, polygon, openings: list('openings'), objects: list('objects'), fixtures: list('fixtures') }
    : null;
}

/** A single room (mozu.roomscan/1), normalised; null if it isn't one. */
async function parseScan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.schema && raw.schema !== ROOMSCAN) return null;
  await sdkReady;
  return sdk ? sdk.parseScan(JSON.stringify(raw)) : fallbackRoom(raw);
}

/**
 * A whole home (mozu.homescan/1: several rooms in one coordinate space),
 * normalised: `{ home, warnings }`, or null if no room in it is usable. Rooms
 * without an outline and connections that point nowhere are left out, and
 * `warnings` says which.
 */
async function parseHome(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== HOMESCAN) return null;
  await sdkReady;
  if (sdk) return sdk.parseHomeScan(JSON.stringify(raw));
  const all = Array.isArray(raw.rooms) ? raw.rooms : [];
  const rooms = all.map(fallbackRoom).filter(Boolean);
  if (!rooms.length) return null;
  const warnings = rooms.length < all.length ? [`${all.length - rooms.length} room(s) had no usable outline and were left out.`] : [];
  return { home: { schema: HOMESCAN, rooms, capturedAt: typeof raw.capturedAt === 'string' ? raw.capturedAt : rooms[0].capturedAt }, warnings };
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

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

function clientIp(req) {
  return firstHeader(req.headers['x-real-ip']) ||
    firstHeader(req.headers['x-forwarded-for']) ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume(); // discard the body so the client reads the 413 instead of a reset connection
      reject(Object.assign(new Error('Scan is too large.'), { status: 413 }));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Scan is too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── API ────────────────────────────────────────────────────────────────────

/**
 * Build the API handlers around one store.
 *   options.store   — a store from handoff-store.js; default createStore() on first use
 *   options.limits  — { uploads, lookups } per IP per 10 minutes; 0 turns a limit off
 */
function createHandoffApi(options = {}) {
  let store = options.store || null;
  const limits = {
    uploads: numberFrom(process.env.RATE_LIMIT_UPLOADS, 20),
    lookups: numberFrom(process.env.RATE_LIMIT_LOOKUPS, 60),
    ...options.limits,
  };
  const ttlMs = options.ttlMs || HANDOFF_TTL_MS;

  // Created on first use so a missing Redis setup is a clear 503, not a crashed function.
  function getStore() {
    if (!store) store = createStore();
    return store;
  }

  /** True when this request may go ahead. Fails open: a counter outage never blocks scans. */
  async function allowed(req, kind) {
    const limit = limits[kind];
    if (!limit) return true;
    try {
      return (await getStore().hit(`${kind}:${clientIp(req)}`, RATE_WINDOW_MS)) <= limit;
    } catch (e) {
      console.error('[mozu] rate limit check failed:', e.message);
      return true;
    }
  }

  function tooMany(res) {
    return sendJson(res, 429, { error: 'Too many requests from this network. Wait a few minutes and try again.' },
      { 'retry-after': String(RATE_WINDOW_MS / 1000) });
  }

  function unavailable(res, e) {
    console.error('[mozu] store error:', e.message);
    return sendJson(res, 503, { error: 'MOZU could not reach its storage just now. Try again in a minute.' });
  }

  async function post(req, res) {
    if (!(await allowed(req, 'uploads'))) return tooMany(res);
    let text;
    try {
      text = await readBody(req, MAX_SCAN_BYTES);
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.status === 413 ? 'Scan is too large (limit 2 MB).' : 'Could not read the upload.' });
    }
    let raw;
    try { raw = JSON.parse(text); } catch { return sendJson(res, 400, { error: 'Body must be RoomScan JSON (one room) or HomeScan JSON (a whole home).' }); }
    // A whole home from the "Build house" screen, or a single room.
    let scan, warnings = [], summary;
    if (raw && raw.schema === HOMESCAN) {
      const parsed = await parseHome(raw);
      if (!parsed) return sendJson(res, 400, { error: 'Not a valid mozu.homescan/1 home (it needs at least one room with 3 or more corner points).' });
      ({ home: scan, warnings } = parsed);
      summary = `home, ${scan.rooms.length} rooms, ${(scan.connections || []).length} connections`;
    } else {
      scan = await parseScan(raw);
      if (!scan) return sendJson(res, 400, { error: 'Not a valid mozu.roomscan/1 room (it needs at least 3 corner points).' });
      summary = `${scan.polygon.length} corners, ${(scan.openings || []).length} openings, ${scan.fixtures.length} fixtures`;
    }

    let entry;
    try {
      entry =await storeScan(getStore(), scan, Date.now(), ttlMs);
    } catch (e) {
      return unavailable(res, e);
    }
    console.log(`[mozu] stored scan ${entry.code} (${summary})`);
    return sendJson(res, 201, {
      code: entry.code,
      url: handoffUrl(originOf(req), entry.code),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      // Only when part of a home had to be left out; the iPad ignores fields it doesn't know.
      ...(warnings.length ? { warnings } : {}),
    });
  }

  async function get(req, res, url) {
    if (!(await allowed(req, 'lookups'))) return tooMany(res);
    const input = url.searchParams.get('code') || '';
    if (!normaliseCode(input)) return sendJson(res, 400, { error: 'Enter the 6-character code shown in the MOZU Scanner app.' });
    let found;
    try {
      found =await fetchScan(getStore(), input);
    } catch (e) {
      return unavailable(res, e);
    }
    if (!found) return sendJson(res, 404, { error: 'That code was not found or has expired (codes last 24 hours).' });
    return sendJson(res, 200, {
      code: found.code,
      scan: found.scan,
      expiresAt: new Date(found.expiresAt).toISOString(),
    });
  }

  /** /api/scan-handoff */
  async function handoff(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'POST') return await post(req, res);
      if (req.method === 'GET' || req.method === 'HEAD') return await get(req, res, url);
      return sendJson(res, 405, { error: 'Use POST to upload a scan or GET ?code= to fetch one.' }, { allow: 'GET, POST' });
    } catch (e) {
      console.error('[mozu]', e);
      if (!res.headersSent) return sendJson(res, 500, { error: 'Server error.' });
      res.end();
    }
  }

  /** /api/health */
  async function health(req, res) {
    try {
      const s = getStore();
      if (!(await s.ping())) throw new Error('store did not answer');
      return sendJson(res, 200, { ok: true, store: s.kind });
    } catch (e) {
      console.error('[mozu] health check failed:', e.message);
      return sendJson(res, 503, { ok: false, error: e.message });
    }
  }

  return { handoff, health, getStore };
}

/**
 * Where an iPad link lands: /scan/B7K4M2 (code screen) → /?code=B7K4M2, and
 * /scan?poly=…&scan=… (open on this iPad) → /?poly=…&scan=…. Returns null for other paths.
 */
function scanLinkLocation(pathname, search) {
  const match = pathname.match(/^(?:\/api\/scan-link|\/scan(?:\/([^/]+))?)\/?$/);
  if (!match) return null;
  const query = new URLSearchParams(search);
  if (match[1]) query.set('code', match[1]);
  return '/' + (query.toString() ? '?' + query : '');
}

function numberFrom(value, fallback) {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

module.exports = { createHandoffApi, scanLinkLocation, parseScan, parseHome, sendJson, originOf, clientIp, readBody };
