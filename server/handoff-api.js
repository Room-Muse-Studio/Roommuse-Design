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

const { sendJson, originOf, clientIp, readBody } = require('./http');
const { createRateLimiter, numberFrom, unavailable } = require('./rate-limit');

const SDK_FILE = path.join(__dirname, '..', 'packages', 'scan-sdk', 'dist', 'mozu-scan-sdk.js');

// ── scan validation ────────────────────────────────────────────────────────

// The built SDK validates the room outline. It drops `fixtures`, so those are
// carried over from the raw JSON (same as apps/web/scan-import.js).
let sdkParse = null;
const sdkReady = import(pathToFileURL(SDK_FILE).href)
  .then((sdk) => { sdkParse = sdk.parseScan; })
  .catch((e) => console.warn('[mozu] scan SDK not loaded, using built-in checks:', e.message));

async function parseScan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.schema && raw.schema !== 'mozu.roomscan/1') return null;
  await sdkReady;
  let scan;
  if (sdkParse) {
    scan = sdkParse(JSON.stringify(raw));
  } else {
    const polygon = Array.isArray(raw.polygon)
      ? raw.polygon.map((p) => ({ x: Number(p && p.x), z: Number(p && p.z) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z))
      : [];
    scan = polygon.length >= 3
      ? { openings: [], objects: [], ...raw, schema: 'mozu.roomscan/1', polygon }
      : null;
  }
  if (!scan) return null;
  scan.fixtures = Array.isArray(raw.fixtures) ? raw.fixtures : [];
  return scan;
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

  const rate = createRateLimiter(getStore, limits);
  const allowed = (req, kind) => rate.allowed(kind, clientIp(req));
  const tooMany = (res) => rate.tooMany(res);

  async function post(req, res) {
    if (!(await allowed(req, 'uploads'))) return tooMany(res);
    let text;
    try {
      text = await readBody(req, MAX_SCAN_BYTES);
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.status === 413 ? 'Scan is too large (limit 2 MB).' : 'Could not read the upload.' });
    }
    let raw;
    try { raw = JSON.parse(text); } catch { return sendJson(res, 400, { error: 'Body must be RoomScan JSON.' }); }
    const scan = await parseScan(raw);
    if (!scan) return sendJson(res, 400, { error: 'Not a valid mozu.roomscan/1 room (it needs at least 3 corner points).' });

    let entry;
    try {
      entry =await storeScan(getStore(), scan, Date.now(), ttlMs);
    } catch (e) {
      return unavailable(res, e);
    }
    console.log(`[mozu] stored scan ${entry.code} (${scan.polygon.length} corners, ${(scan.openings || []).length} openings, ${scan.fixtures.length} fixtures)`);
    return sendJson(res, 201, {
      code: entry.code,
      url: handoffUrl(originOf(req), entry.code),
      expiresAt: new Date(entry.expiresAt).toISOString(),
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

module.exports = { createHandoffApi, scanLinkLocation, parseScan, sendJson, originOf, clientIp, readBody };
