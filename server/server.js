/*
 * MOZU design server — no dependencies, plain Node.
 *
 *   GET  /                              apps/web (the prototype + scan-import.js)
 *   GET  /packages/scan-sdk/dist/*      the scan SDK, so the page can load it
 *   GET  /scan, /scan/:code             what the iPad app links to → redirected to the page
 *   POST /api/scan-handoff              iPad uploads a RoomScan → { code, url, expiresAt }
 *   GET  /api/scan-handoff?code=XXXXXX  page fetches it back   → { code, scan, expiresAt }
 *
 * The request/response shape matches apps/ios/MozuScanner/Export/Handoff.swift
 * (ScanHandoff.send), so the iPad app needs no changes.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  MemoryHandoffStore,
  MAX_SCAN_BYTES,
  storeScan,
  fetchScan,
  handoffUrl,
  normaliseCode,
} = require('./handoff-store');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'apps', 'web');
const SDK_DIR = path.join(ROOT, 'packages', 'scan-sdk', 'dist');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const store = new MemoryHandoffStore();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// The built SDK validates the room outline. It drops `fixtures`, so those are
// carried over from the raw JSON (same as apps/web/scan-import.js).
let sdkParse = null;
const sdkReady = import(pathToFileURL(path.join(SDK_DIR, 'mozu-scan-sdk.js')).href)
  .then((sdk) => { sdkParse = sdk.parseScan; })
  .catch((e) => console.warn('[mozu] scan SDK not loaded, using built-in checks:', e.message));

function parseScan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.schema && raw.schema !== 'mozu.roomscan/1') return null;
  let scan;
  if (sdkParse) {
    scan = sdkParse(JSON.stringify(raw));
  } else {
    const polygon = Array.isArray(raw.polygon)
      ? raw.polygon.map((p) => ({ x: Number(p && p.x), z: Number(p && p.z) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z))
      : [];
    scan = polygon.length >= 3 ? { ...raw, schema: 'mozu.roomscan/1', polygon } : null;
  }
  if (!scan) return null;
  scan.fixtures = Array.isArray(raw.fixtures) ? raw.fixtures : [];
  return scan;
}

// ── helpers ────────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/** Public origin, honouring a tunnel/proxy in front (Cloudflare sets these). */
function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() ||
    (req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  return `${proto}://${host}`;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
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

function serveFile(res, baseDir, relPath, method) {
  const file = path.resolve(baseDir, '.' + path.posix.normalize('/' + relPath));
  if (!file.startsWith(baseDir + path.sep) && file !== baseDir) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-cache',
  });
  if (method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}

// ── handoff API ────────────────────────────────────────────────────────────

async function handoffPost(req, res) {
  let text;
  try {
    text = await readBody(req, MAX_SCAN_BYTES);
  } catch (e) {
    return sendJson(res, e.status || 400, { error: e.status === 413 ? 'Scan is too large (limit 2 MB).' : 'Could not read the upload.' });
  }
  let raw;
  try { raw = JSON.parse(text); } catch { return sendJson(res, 400, { error: 'Body must be RoomScan JSON.' }); }
  await sdkReady;
  const scan = parseScan(raw);
  if (!scan) return sendJson(res, 400, { error: 'Not a valid mozu.roomscan/1 room (it needs at least 3 corner points).' });

  const entry = storeScan(store, scan);
  console.log(`[mozu] stored scan ${entry.code} (${scan.polygon.length} corners, ${scan.openings.length} openings, ${scan.fixtures.length} fixtures)`);
  return sendJson(res, 201, {
    code: entry.code,
    url: handoffUrl(originOf(req), entry.code),
    expiresAt: new Date(entry.expiresAt).toISOString(),
  });
}

function handoffGet(req, res, url) {
  const input = url.searchParams.get('code') || '';
  if (!normaliseCode(input)) return sendJson(res, 400, { error: 'Enter the 6-character code shown on the iPad.' });
  const found = fetchScan(store, input);
  if (!found) return sendJson(res, 404, { error: 'That code was not found or has expired (codes last 24 hours).' });
  return sendJson(res, 200, {
    code: found.code,
    scan: found.scan,
    expiresAt: new Date(found.expiresAt).toISOString(),
  });
}

// ── router ─────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p === '/api/scan-handoff' || p === '/api/scan-handoff/') {
      if (req.method === 'POST') return await handoffPost(req, res);
      if (req.method === 'GET') return handoffGet(req, res, url);
      res.setHeader('allow', 'GET, POST');
      return sendJson(res, 405, { error: 'Use POST to upload a scan or GET ?code= to fetch one.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });

    // Links from the iPad: /scan/B7K4M2 (code screen) and /scan?poly=…&scan=… (open on this iPad).
    const scanLink = p.match(/^\/scan(?:\/([^/]+))?\/?$/);
    if (scanLink) {
      const query = new URLSearchParams(url.search);
      if (scanLink[1]) query.set('code', scanLink[1]);
      res.writeHead(302, { location: '/' + (query.toString() ? '?' + query : '') });
      return res.end();
    }

    if (p.startsWith('/packages/scan-sdk/dist/')) {
      if (serveFile(res, SDK_DIR, p.slice('/packages/scan-sdk/dist/'.length), req.method)) return;
    } else if (serveFile(res, WEB_DIR, p === '/' ? 'index.html' : p, req.method)) {
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (e) {
    console.error('[mozu]', e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
    else res.end();
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[mozu] Port ${PORT} is already in use (another server is running). Stop it, or pick another port: PORT=${PORT + 100} npm start`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`[mozu] serving ${path.relative(process.cwd(), WEB_DIR) || WEB_DIR} at http://localhost:${PORT}/`);
  console.log(`[mozu] handoff API at http://localhost:${PORT}/api/scan-handoff (codes last 24 hours, kept in memory)`);
});
