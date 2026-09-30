/*
 * Projects: a scan plus the design made on it, owned by a signed-in person.
 *
 *   GET    /api/projects                 → { projects: [meta] }       newest first
 *   POST   /api/projects                 { code, name? }              → 201 { project }   copy the scan behind a code
 *                                        { scan, name?, source? }     → 201 { project }   a scan file or sample
 *   GET    /api/projects/:id             → { project, scan, design }  design is { version, items } or null
 *   PUT    /api/projects/:id             { rev, design: { items } } → { rev, updatedAt } | 409 { error, rev, updatedAt }
 *   PATCH  /api/projects/:id             { name } → { project }
 *   DELETE /api/projects/:id             → { ok }
 *   POST   /api/projects/:id/duplicate   { name? } → 201 { project }
 *   PUT    /api/projects/:id/thumbnail   { dataUrl } → { ok }         JPEG or WebP, 64 KB at most
 *
 * meta = { id, name, rooms, source: 'code' | 'file' | 'sample', createdAt, updatedAt, rev, thumbnail? }
 *
 * A code is only the phone → laptop handoff: creating a project copies the scan
 * out of it, the code itself is not kept and expires as usual. Every route
 * needs the session cookie and checks the project belongs to the caller;
 * someone else's project is a 404, so ids can't be probed.
 */
'use strict';

const { createAppStore, newId } = require('./app-store');
const { fetchScan, normaliseCode } = require('./handoff-store');
const { parseScan, parseHome, HOMESCAN } = require('./handoff-api');
const { createRateLimiter, numberFrom, unavailable } = require('./rate-limit');
const { sendJson, readJson, clientIp } = require('./http');

const NAME_MAX = 120;
const DESIGN_VERSION = 3;
const THUMBNAIL_MAX_BYTES = 64 * 1024;
const THUMBNAIL_RE = /^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const cleanName = (v, fallback) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return (s || fallback).slice(0, NAME_MAX);
};

/** Two names are "the same" when they differ only in case or spacing. */
const nameKey = (name) => cleanName(name, '').toLowerCase();

/** `base`, or `base (2)`, `base (3)`… — the first not in `taken` (a Set of name keys). */
function uniqueName(base, taken) {
  const first = cleanName(base, 'Project');
  if (!taken.has(nameKey(first))) return first;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = first.slice(0, NAME_MAX - suffix.length) + suffix;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}

const isHome = (scan) => !!scan && scan.schema === HOMESCAN;
const roomCount = (scan) => (isHome(scan) ? scan.rooms.length : 1);

/** The name a project gets when none is given: what the scan calls itself, else its shape. */
function defaultName(scan) {
  if (typeof scan.name === 'string' && scan.name.trim()) return scan.name.trim();
  if (!isHome(scan)) return 'Room';
  const n = scan.rooms.length;
  return `Home (${n} ${n === 1 ? 'room' : 'rooms'})`;
}

/** Normalise a scan the browser sent (a file or a sample): a room or a home, or null. */
async function normaliseScan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.schema === HOMESCAN) {
    const parsed = await parseHome(raw);
    return parsed ? parsed.home : null;
  }
  return parseScan(raw);
}

/** Why `design` can't be stored, or null when it is fine. Shallow on purpose: the editor owns the item shape. */
function validateDesign(design) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return 'design must be an object.';
  if (!Array.isArray(design.items)) return 'design.items must be an array.';
  for (const item of design.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Every item must be an object.';
    if (typeof item.uid !== 'number' || !Number.isFinite(item.uid)) return 'Every item needs a numeric uid.';
    if (typeof item.roomKey !== 'string') return 'Every item needs a string roomKey.';
    const c = item.center;
    if (!c || typeof c !== 'object' || typeof c.x !== 'number' || typeof c.z !== 'number' || !Number.isFinite(c.x) || !Number.isFinite(c.z)) {
      return 'Every item needs a center with numeric x and z.';
    }
  }
  return null;
}

/** What the browser sees of a project: no owner, no internal sizes. */
function publicMeta(meta) {
  const out = {
    id: meta.id, name: meta.name, rooms: meta.rooms, source: meta.source,
    createdAt: meta.createdAt, updatedAt: meta.updatedAt, rev: meta.rev,
  };
  if (meta.thumbnail) out.thumbnail = meta.thumbnail;
  return out;
}

const sizeLabel = (bytes) => (bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024) * 10) / 10} MB` : `${Math.round(bytes / 1024)} KB`);

/**
 * @param options.auth        the auth api (requireUser / guardWrite)
 * @param options.store       shared app store, or options.getStore
 * @param options.limits      { reads, writes } per user and { lookups } per IP, per 10 min
 * @param options.maxBytes    largest scan or design accepted (MAX_PROJECT_BYTES, default 2 MB)
 * @param options.maxProjects per user (MAX_PROJECTS_PER_USER, default 100)
 */
function createProjectApi(options = {}) {
  const { auth } = options;
  if (!auth) throw new Error('createProjectApi needs the auth api.');
  let store = options.store || null;
  const getStore = options.getStore || (() => { if (!store) store = createAppStore(); return store; });
  const maxBytes = options.maxBytes || numberFrom(process.env.MAX_PROJECT_BYTES, 2 * 1024 * 1024);
  const maxProjects = options.maxProjects || numberFrom(process.env.MAX_PROJECTS_PER_USER, 100);
  const rate = createRateLimiter(getStore, {
    reads: numberFrom(process.env.RATE_LIMIT_READS, 600),
    writes: numberFrom(process.env.RATE_LIMIT_WRITES, 300),
    // Shared with GET /api/scan-handoff, so codes can't be guessed through either door.
    lookups: numberFrom(process.env.RATE_LIMIT_LOOKUPS, 60),
    ...options.limits,
  });

  const tooBig = (res) => sendJson(res, 413, { error: `This project is too large to save (limit ${sizeLabel(maxBytes)}).` });
  const notFound = (res) => sendJson(res, 404, { error: 'Project not found.' });
  const atLimit = (res) => sendJson(res, 409, { error: `You have reached the limit of ${maxProjects} projects. Delete one to make room.` });
  const nameTaken = (res, name) => sendJson(res, 409, { error: `You already have a project called “${name}”. Choose another name.` });

  /** Name keys of every project the person owns — names are unique per account. */
  async function takenNames(uid) {
    return new Set((await getStore().listProjects(uid, maxProjects)).map((m) => nameKey(m.name)));
  }

  /**
   * A typed name must be free (else 409, and null is returned after replying);
   * an automatic one is made unique with " (2)", " (3)"….
   */
  async function chooseName(res, taken, typed, automatic) {
    const wanted = cleanName(typed, '');
    if (!wanted) return uniqueName(automatic, taken);
    if (taken.has(nameKey(wanted))) { nameTaken(res, wanted); return null; }
    return wanted;
  }

  /** The JSON body as an object; `optional` lets an empty body stand for {}. Replies and returns undefined otherwise. */
  async function body(req, res, { optional = false } = {}) {
    try {
      const parsed = await readJson(req, maxBytes + 4096, { optional });
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { sendJson(res, 400, { error: 'Body must be a JSON object.' }); return undefined; }
      return parsed;
    } catch (e) {
      if (e.status === 413) tooBig(res); else sendJson(res, e.status || 400, { error: e.message });
      return undefined;
    }
  }

  /** Who + rate check; null after replying. `kind` is reads|writes. */
  async function gate(req, res, kind) {
    if (kind === 'writes' && !auth.guardWrite(req, res, req.method !== 'DELETE')) return null;
    const who = await auth.requireUser(req, res);
    if (!who) return null;
    if (!(await rate.allowed(kind, who.uid))) { rate.tooMany(res, kind === 'writes' ? 'saves' : 'requests'); return null; }
    return who;
  }

  /** The caller's project meta, or null after a 404. */
  async function owned(res, who, pid) {
    const meta = await getStore().getProjectMeta(pid);
    if (!meta || meta.ownerId !== who.uid) { notFound(res); return null; }
    return meta;
  }

  const ok = (res, status, payload, who) => sendJson(res, status, payload, who.headers || {});

  async function list(req, res) {
    const who = await gate(req, res, 'reads');
    if (!who) return;
    try {
      const metas = await getStore().listProjects(who.uid, maxProjects);
      return ok(res, 200, { projects: metas.map(publicMeta) }, who);
    } catch (e) { return unavailable(res, e); }
  }

  async function create(req, res) {
    const who = await gate(req, res, 'writes');
    if (!who) return;
    const input = await body(req, res);
    if (!input) return;
    if (input.code === undefined && input.scan === undefined) {
      return sendJson(res, 400, { error: 'Send the code from the phone ({ code }) or a scan ({ scan }).' });
    }

    let scan, source;
    if (input.code !== undefined) {
      if (!(await rate.allowed('lookups', clientIp(req)))) return rate.tooMany(res, 'code lookups from this network');
      if (!normaliseCode(input.code)) return sendJson(res, 400, { error: 'Enter the 6-character code shown in the MOZU Scanner app.' });
      let found;
      try { found = await fetchScan(getStore(), input.code); } catch (e) { return unavailable(res, e); }
      if (!found) return sendJson(res, 404, { error: 'That code was not found or has expired (codes last 24 hours).' });
      scan = found.scan;
      source = 'code';
    } else {
      scan = await normaliseScan(input.scan);
      if (!scan) return sendJson(res, 400, { error: 'Not a valid mozu.roomscan/1 room (at least 3 corner points) or mozu.homescan/1 home.' });
      if (Buffer.byteLength(JSON.stringify(scan)) > maxBytes) return tooBig(res);
      source = input.source === 'sample' ? 'sample' : 'file';
    }

    try {
      const taken = await takenNames(who.uid);
      if (taken.size >= maxProjects) return atLimit(res);
      const name = await chooseName(res, taken, input.name, input.suggestedName || defaultName(scan));
      if (!name) return;
      const now = Date.now();
      const meta = await getStore().createProject({
        id: newId(), ownerId: who.uid, name, rooms: roomCount(scan), source,
        createdAt: now, updatedAt: now, rev: 1,
      }, scan);
      console.log(`[mozu] project ${meta.id} created from ${source} for ${who.uid.slice(0, 6)}…`);
      return ok(res, 201, { project: publicMeta(meta) }, who);
    } catch (e) { return unavailable(res, e); }
  }

  async function get(req, res, pid) {
    const who = await gate(req, res, 'reads');
    if (!who) return;
    try {
      const meta = await owned(res, who, pid);
      if (!meta) return;
      const found = await getStore().getProject(pid);
      if (!found) return notFound(res);
      return ok(res, 200, { project: publicMeta(found.meta), scan: found.scan, design: found.design }, who);
    } catch (e) { return unavailable(res, e); }
  }

  async function save(req, res, pid) {
    const who = await gate(req, res, 'writes');
    if (!who) return;
    const input = await body(req, res);
    if (!input) return;
    const rev = Number(input.rev);
    if (!Number.isInteger(rev) || rev < 1) return sendJson(res, 400, { error: 'rev must be the revision you loaded.' });
    const why = validateDesign(input.design);
    if (why) return sendJson(res, 400, { error: why });
    const design = { version: DESIGN_VERSION, items: input.design.items };
    if (Buffer.byteLength(JSON.stringify(design)) > maxBytes) return tooBig(res);
    try {
      const meta = await owned(res, who, pid);
      if (!meta) return;
      const result = await getStore().saveDesign(pid, rev, design);
      if (!result) return notFound(res);
      if (!result.ok) {
        return sendJson(res, 409, { error: 'This project was changed somewhere else since you opened it.', rev: result.rev, updatedAt: result.updatedAt });
      }
      return ok(res, 200, { rev: result.rev, updatedAt: result.updatedAt }, who);
    } catch (e) { return unavailable(res, e); }
  }

  async function rename(req, res, pid) {
    const who = await gate(req, res, 'writes');
    if (!who) return;
    const input = await body(req, res);
    if (!input) return;
    if (typeof input.name !== 'string' || !input.name.trim()) return sendJson(res, 400, { error: 'A name is needed.' });
    try {
      const meta = await owned(res, who, pid);
      if (!meta) return;
      const name = cleanName(input.name, meta.name);
      if (nameKey(name) !== nameKey(meta.name) && (await takenNames(who.uid)).has(nameKey(name))) return nameTaken(res, name);
      const updated = await getStore().updateMeta(pid, { name }, { touch: true });
      if (!updated) return notFound(res);
      return ok(res, 200, { project: publicMeta(updated) }, who);
    } catch (e) { return unavailable(res, e); }
  }

  async function remove(req, res, pid) {
    const who = await gate(req, res, 'writes');
    if (!who) return;
    try {
      const meta = await owned(res, who, pid);
      if (!meta) return;
      await getStore().deleteProject(pid);
      console.log(`[mozu] project ${pid} deleted`);
      return ok(res, 200, { ok: true }, who);
    } catch (e) { return unavailable(res, e); }
  }

  async function duplicate(req, res, pid) {
    const who = await gate(req, res, 'writes');
    if (!who) return;
    const input = await body(req, res, { optional: true });
    if (!input) return;
    try {
      const meta = await owned(res, who, pid);
      if (!meta) return;
      const taken = await takenNames(who.uid);
      if (taken.size >= maxProjects) return atLimit(res);
      const name = await chooseName(res, taken, input.name, `${meta.name} (copy)`);
      if (!name) return;
      const found = await getStore().getProject(pid);
      if (!found) return notFound(res);
      const now = Date.now();
      const copy = await getStore().createProject({
        id: newId(), ownerId: who.uid, name, rooms: meta.rooms, source: meta.source,
        createdAt: now, updatedAt: now, rev: 1, thumbnail: meta.thumbnail,
      }, found.scan, found.design);
      return ok(res, 201, { project: publicMeta(copy) }, who);
    } catch (e) { return unavailable(res, e); }
  }

  async function thumbnail(req, res, pid) {
    const who = await gate(req, res, 'writes');
    if (!who) return;
    const input = await body(req, res);
    if (!input) return;
    const dataUrl = input.dataUrl;
    if (typeof dataUrl !== 'string' || !THUMBNAIL_RE.test(dataUrl)) return sendJson(res, 400, { error: 'dataUrl must be a base64 data URL of a JPEG or WebP image.' });
    if (Buffer.byteLength(dataUrl) > THUMBNAIL_MAX_BYTES) return sendJson(res, 413, { error: 'The thumbnail is too large (limit 64 KB).' });
    try {
      const meta = await owned(res, who, pid);
      if (!meta) return;
      // A thumbnail is a snapshot of what's already saved: it doesn't move the project in the gallery.
      if (!(await getStore().updateMeta(pid, { thumbnail: dataUrl }))) return notFound(res);
      return ok(res, 200, { ok: true }, who);
    } catch (e) { return unavailable(res, e); }
  }

  /** Route /api/projects[/…] for the local server and the Vercel catch-all. */
  async function handle(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '');
    const rest = pathname.replace(/^\/api\/projects/, '');
    const parts = rest.split('/').filter(Boolean);
    const [pid, action] = parts;
    const m = req.method;
    try {
      if (parts.length === 0) {
        if (m === 'GET' || m === 'HEAD') return await list(req, res);
        if (m === 'POST') return await create(req, res);
        return sendJson(res, 405, { error: 'Method not allowed.' }, { allow: 'GET, POST' });
      }
      if (!ID_RE.test(pid)) return notFound(res);
      if (parts.length === 1) {
        if (m === 'GET' || m === 'HEAD') return await get(req, res, pid);
        if (m === 'PUT') return await save(req, res, pid);
        if (m === 'PATCH') return await rename(req, res, pid);
        if (m === 'DELETE') return await remove(req, res, pid);
        return sendJson(res, 405, { error: 'Method not allowed.' }, { allow: 'GET, PUT, PATCH, DELETE' });
      }
      if (parts.length === 2 && action === 'duplicate') {
        if (m === 'POST') return await duplicate(req, res, pid);
        return sendJson(res, 405, { error: 'Method not allowed.' }, { allow: 'POST' });
      }
      if (parts.length === 2 && action === 'thumbnail') {
        if (m === 'PUT') return await thumbnail(req, res, pid);
        return sendJson(res, 405, { error: 'Method not allowed.' }, { allow: 'PUT' });
      }
      return sendJson(res, 404, { error: 'Not found.' });
    } catch (e) {
      console.error('[mozu] projects:', e);
      if (!res.headersSent) return sendJson(res, 500, { error: 'Server error.' });
      res.end();
    }
  }

  return { handle, getStore, maxBytes, maxProjects };
}

module.exports = { createProjectApi, validateDesign, defaultName, publicMeta, DESIGN_VERSION, THUMBNAIL_MAX_BYTES };
