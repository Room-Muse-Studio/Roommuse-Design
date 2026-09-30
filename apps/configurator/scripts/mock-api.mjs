#!/usr/bin/env node
/**
 * A stand-in for the account API, for working on the configurator without the
 * real backend: in memory, same contract, and sign-in accepts any token.
 *
 *   node scripts/mock-api.mjs            # http://localhost:3000
 *   MOZU_HANDOFF_URL=http://localhost:3000 npm run dev
 *
 * Codes: the two sample scans are preloaded under TWOBED and KITCHN, and
 * POST /api/scan-handoff (what the iPad does) mints new ones. /scan/:code
 * redirects to the page like the real server does.
 */
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(here, '..', '..', '..', 'samples');
const COOKIE = 'mozu_mock_session';
const MAX_PROJECTS = 100;
const MAX_DESIGN_BYTES = 512 * 1024;
const MAX_THUMB_BYTES = 64 * 1024;

const sessions = new Map(); // token → user
const codes = new Map(); // code → { scan, expiresAt }
const projects = new Map(); // id → { meta, scan, design, uid }

// Preload the samples as codes, so "Code from the phone" can be tried.
for (const f of readdirSync(SAMPLES).filter((f) => f.endsWith('.roomscan.json'))) {
  const name = f.slice(0, -'.roomscan.json'.length);
  const code = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6).padEnd(6, 'X');
  codes.set(code, { scan: JSON.parse(readFileSync(join(SAMPLES, f), 'utf8')), expiresAt: Date.now() + 86_400_000 });
  console.log(`[mock] code ${code} → samples/${f}`);
}

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
const fail = (res, status, error) => json(res, status, { error });
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return resolve({ raw: '', body: {} });
    try { resolve({ raw: text, body: JSON.parse(text) }); } catch { reject(new Error('The request body is not valid JSON.')); }
  });
  req.on('error', reject);
});
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
const userOf = (req) => sessions.get(cookies(req)[COOKIE]) || null;
const roomsOf = (scan) => (scan && Array.isArray(scan.rooms) ? scan.rooms.length : scan ? 1 : 0);
const newCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
};
const meta = (p) => ({ ...p.meta, thumbnail: p.thumbnail || null });

function userFromToken(idToken) {
  // Any token is accepted; a real Firebase ID token carries the email in its payload.
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    if (payload && payload.email) {
      return {
        uid: payload.user_id || payload.sub || 'mock-' + payload.email,
        email: payload.email,
        emailVerified: !!payload.email_verified,
        name: payload.name || null,
        picture: payload.picture || null,
        providers: [payload.firebase?.sign_in_provider === 'google.com' ? 'google.com' : 'password'],
      };
    }
  } catch { /* not a JWT */ }
  return { uid: 'mock-dev', email: 'dev@example.com', emailVerified: false, name: 'Dev', picture: null, providers: ['password'] };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  // The iPad's links.
  const scanLink = /^\/scan(?:\/([A-Za-z0-9]{6}))?$/.exec(path);
  if (scanLink && method === 'GET') {
    const location = scanLink[1] ? `/?code=${scanLink[1].toUpperCase()}` : `/?${url.searchParams.toString()}`;
    res.writeHead(302, { location });
    return res.end();
  }

  if (!path.startsWith('/api/')) return fail(res, 404, 'Not found.');
  if (method !== 'GET' && !/^application\/json/i.test(req.headers['content-type'] || '')) {
    return fail(res, 415, 'Send JSON (content-type: application/json).');
  }
  const { raw, body } = method === 'GET' ? { raw: '', body: {} } : await readBody(req);

  // ── scan handoff ────────────────────────────────────────────────
  if (path === '/api/scan-handoff') {
    if (method === 'POST') {
      const code = newCode();
      codes.set(code, { scan: body, expiresAt: Date.now() + 86_400_000 });
      return json(res, 201, { code, url: `http://localhost:3100/scan/${code}`, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    }
    const code = (url.searchParams.get('code') || '').toUpperCase();
    const found = codes.get(code);
    if (!found || found.expiresAt < Date.now()) return fail(res, 404, 'That code is not known, or it has expired. Codes last 24 hours.');
    return json(res, 200, { code, scan: found.scan, expiresAt: new Date(found.expiresAt).toISOString() });
  }

  // ── auth ─────────────────────────────────────────────────────────
  if (path === '/api/auth/session') {
    if (method === 'POST') {
      if (typeof body.idToken !== 'string' || !body.idToken) return fail(res, 400, 'Missing idToken.');
      const token = randomUUID();
      const user = userFromToken(body.idToken);
      sessions.set(token, user);
      return json(res, 201, { user }, { 'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (method === 'DELETE') {
      sessions.delete(cookies(req)[COOKIE]);
      return json(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` });
    }
    return fail(res, 405, 'Method not allowed.');
  }
  if (path === '/api/auth/me') {
    const user = userOf(req);
    return user ? json(res, 200, { user }) : fail(res, 401, 'Not signed in.');
  }

  // ── projects ─────────────────────────────────────────────────────
  const user = userOf(req);
  if (!user) return fail(res, 401, 'Please sign in.');
  const mine = [...projects.values()].filter((p) => p.uid === user.uid);

  if (path === '/api/projects') {
    if (method === 'GET') {
      return json(res, 200, { projects: mine.sort((a, b) => new Date(b.meta.updatedAt) - new Date(a.meta.updatedAt)).map(meta) });
    }
    if (method === 'POST') {
      if (mine.length >= MAX_PROJECTS) return fail(res, 409, `You have ${MAX_PROJECTS} projects already. Delete one to make room.`);
      let scan, source;
      if (typeof body.code === 'string') {
        const found = codes.get(body.code.toUpperCase());
        if (!found || found.expiresAt < Date.now()) return fail(res, 404, 'That code is not known, or it has expired. Codes last 24 hours.');
        scan = found.scan;
        source = `code:${body.code.toUpperCase()}`;
      } else if (body.scan && typeof body.scan === 'object') {
        scan = body.scan;
        source = typeof body.source === 'string' ? body.source : 'upload';
      } else return fail(res, 400, 'Send a code or a scan.');
      const now = new Date().toISOString();
      const name = (typeof body.name === 'string' && body.name.trim()) || (source.startsWith('code:') ? `Scan ${source.slice(5)}` : 'Scanned room');
      const p = { uid: user.uid, scan, design: null, thumbnail: null,
        meta: { id: randomUUID().slice(0, 8), name: name.slice(0, 120), rooms: roomsOf(scan), source, createdAt: now, updatedAt: now, rev: 1 } };
      projects.set(p.meta.id, p);
      return json(res, 201, { project: meta(p) });
    }
    return fail(res, 405, 'Method not allowed.');
  }

  const m = /^\/api\/projects\/([^/]+)(?:\/(duplicate|thumbnail))?$/.exec(path);
  if (!m) return fail(res, 404, 'Not found.');
  const p = projects.get(m[1]);
  if (!p || p.uid !== user.uid) return fail(res, 404, 'That project does not exist (or is not yours).');
  const sub = m[2];

  if (sub === 'duplicate' && method === 'POST') {
    if (mine.length >= MAX_PROJECTS) return fail(res, 409, `You have ${MAX_PROJECTS} projects already. Delete one to make room.`);
    const now = new Date().toISOString();
    const copy = { uid: user.uid, scan: p.scan, design: p.design, thumbnail: p.thumbnail,
      meta: { ...p.meta, id: randomUUID().slice(0, 8), name: (typeof body.name === 'string' && body.name.trim()) || `${p.meta.name} (copy)`, createdAt: now, updatedAt: now, rev: 1 } };
    projects.set(copy.meta.id, copy);
    return json(res, 201, { project: meta(copy) });
  }
  if (sub === 'thumbnail' && method === 'PUT') {
    if (typeof body.dataUrl !== 'string' || !body.dataUrl.startsWith('data:image/jpeg;base64,')) return fail(res, 400, 'Send a JPEG data URL.');
    if (body.dataUrl.length * 0.75 > MAX_THUMB_BYTES) return fail(res, 413, 'The thumbnail is too big (64 KB at most).');
    p.thumbnail = body.dataUrl;
    return json(res, 200, { ok: true });
  }
  if (sub) return fail(res, 405, 'Method not allowed.');

  if (method === 'GET') return json(res, 200, { project: meta(p), scan: p.scan, design: p.design });
  if (method === 'PATCH') {
    if (typeof body.name !== 'string' || !body.name.trim()) return fail(res, 400, 'Give the project a name.');
    p.meta.name = body.name.trim().slice(0, 120);
    p.meta.updatedAt = new Date().toISOString();
    return json(res, 200, { project: meta(p) });
  }
  if (method === 'DELETE') {
    projects.delete(p.meta.id);
    return json(res, 200, { ok: true });
  }
  if (method === 'PUT') {
    if (raw.length > MAX_DESIGN_BYTES) return fail(res, 413, 'This design is too big to save (512 KB at most).');
    if (!body.design || !Array.isArray(body.design.items)) return fail(res, 400, 'Send { rev, design: { items } }.');
    if (typeof body.rev !== 'number' || body.rev !== p.meta.rev) {
      return json(res, 409, { error: 'This project was changed somewhere else.', rev: p.meta.rev, updatedAt: p.meta.updatedAt });
    }
    p.design = { version: 3, items: body.design.items };
    p.meta.rev += 1;
    p.meta.updatedAt = new Date().toISOString();
    return json(res, 200, { rev: p.meta.rev, updatedAt: p.meta.updatedAt });
  }
  return fail(res, 405, 'Method not allowed.');
}

createServer((req, res) => {
  handle(req, res).catch((e) => fail(res, 400, e.message || 'Bad request.'));
}).listen(PORT, () => {
  console.log(`[mock] account + handoff API at http://localhost:${PORT} (in memory; sign-in accepts any token)`);
});
