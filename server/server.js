/*
 * MOZU design server — no dependencies, plain Node. For local use (`npm start`);
 * production runs the same API as Vercel functions (api/**\/*.js, vercel.json).
 *
 *   GET  /                              the site: the configurator, built into public/ (npm run build)
 *   GET  /projects, /editor, …          the site's other pages (Next's static export writes <route>.html)
 *   GET  /packages/scan-sdk/dist/*      the scan SDK, so the page can load it
 *   GET  /scan, /scan/:code             what the iPad app links to → redirected to the page
 *   POST /api/scan-handoff              iPad uploads a RoomScan → { code, url, expiresAt }
 *   GET  /api/scan-handoff?code=XXXXXX  page fetches it back   → { code, scan, expiresAt }
 *   *    /api/auth/*                    sign in / who am I / sign out (server/auth-api.js)
 *   *    /api/projects[/…]              a signed-in person's projects (server/project-api.js)
 *   GET  /api/health                    store reachable?
 *
 * The request/response shape matches apps/ios/MozuScanner/Export/Handoff.swift
 * (ScanHandoff.send), so the iPad app needs no changes. Codes, sessions and
 * projects are kept in memory unless KV_REST_API_URL / KV_REST_API_TOKEN point
 * at a Redis database.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHandoffApi, scanLinkLocation, sendJson } = require('./handoff-api');
const { createAppStore } = require('./app-store');
const { createAuthApi } = require('./auth-api');
const { createProjectApi } = require('./project-api');

const ROOT = path.resolve(__dirname, '..');
// The built site: the configurator's static export plus the SDK (scripts/build-web.js),
// the same folder Vercel serves.
const WEB_DIR = path.join(ROOT, 'public');
const SDK_DIR = path.join(ROOT, 'packages', 'scan-sdk', 'dist');

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
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
};

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
    'x-content-type-options': 'nosniff',
  });
  if (method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}

/**
 * A page of the built site. Next's static export writes `/projects` as
 * `projects.html` (or `projects/index.html`), and Vercel serves those at the
 * clean URL (vercel.json `cleanUrls`); this does the same locally.
 */
function servePage(res, webDir, p, method) {
  if (serveFile(res, webDir, p === '/' ? 'index.html' : p, method)) return true;
  if (path.posix.extname(p)) return false;
  const route = p.replace(/\/+$/, '');
  return !!route && (serveFile(res, webDir, `${route}.html`, method) || serveFile(res, webDir, `${route}/index.html`, method));
}

/**
 * Build the server. One store serves the handoff codes, sessions and projects.
 * Tests pass their own `store`, `verifier`, `limits` and `webDir`.
 */
function createServer(options = {}) {
  const store = options.store || createAppStore();
  const api = createHandoffApi({ ...options, store });
  const auth = createAuthApi({ store, verifier: options.verifier, limits: options.limits });
  const projects = createProjectApi({ store, auth, limits: options.limits, maxBytes: options.maxProjectBytes, maxProjects: options.maxProjects });
  const webDir = options.webDir || WEB_DIR;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { p = url.pathname; }
    try {
      if (p === '/api/scan-handoff' || p === '/api/scan-handoff/') return await api.handoff(req, res);
      if (p === '/api/health') return await api.health(req, res);
      if (p.startsWith('/api/auth/')) return await auth.handle(req, res);
      if (p === '/api/projects' || p.startsWith('/api/projects/')) return await projects.handle(req, res);
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });

      // Links from the iPad: /scan/B7K4M2 (code screen) and /scan?poly=…&scan=… (open on this iPad).
      const location = p.startsWith('/scan') ? scanLinkLocation(p, url.search) : null;
      if (location) {
        res.writeHead(302, { location });
        return res.end();
      }

      if (p.startsWith('/packages/scan-sdk/dist/')) {
        if (serveFile(res, SDK_DIR, p.slice('/packages/scan-sdk/dist/'.length), req.method)) return;
      } else if (servePage(res, webDir, p, req.method)) {
        return;
      } else if (p === '/' || p === '/index.html') {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('The site has not been built yet. Run "npm start" (it builds first), or "npm run build" then "npm run serve".');
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (e) {
      console.error('[mozu]', e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
      else res.end();
    }
  });
}

module.exports = { createServer };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const server = createServer();
  const storeKind = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? 'Redis' : 'memory';

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`[mozu] Port ${PORT} is already in use (another server is running). Stop it, or pick another port: PORT=${PORT + 100} npm start`);
      process.exit(1);
    }
    throw e;
  });

  server.listen(PORT, HOST, () => {
    console.log(`[mozu] serving ${path.relative(process.cwd(), WEB_DIR) || WEB_DIR} at http://localhost:${PORT}/`);
    console.log(`[mozu] handoff API at http://localhost:${PORT}/api/scan-handoff (codes last 24 hours; codes, sessions and projects kept in ${storeKind})`);
    if (!process.env.FIREBASE_PROJECT_ID) console.log('[mozu] FIREBASE_PROJECT_ID is not set: sign-in answers 503 until it is');
  });
}
