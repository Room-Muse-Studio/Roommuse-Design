/*
 * Projects: each design is a project a signed-in person owns.
 *
 *   GET    /api/projects                → { projects: [meta] }       newest first
 *   POST   /api/projects                { name?, clientName?, data?, source? } → 201 { project }
 *   GET    /api/projects/:id            → { project, data }
 *   PUT    /api/projects/:id            { rev, data } → { rev, updatedAt } | 409 { rev, updatedAt }
 *   PATCH  /api/projects/:id            { name?, clientName? } → { project }
 *   DELETE /api/projects/:id            → { ok }
 *   POST   /api/projects/:id/duplicate  { name? } → 201 { project }
 *
 * `data` is the saved-project JSON the editor itself reads and writes
 * ({ version: 2, projectName, clientName, spaces, activeSpace, tab, uid, … }).
 * Every route needs the session cookie and checks the project belongs to the
 * caller; someone else's project is a 404, so ids can't be probed.
 */
'use strict';

const { createAppStore, newId } = require('./app-store');
const { createRateLimiter, numberFrom, unavailable } = require('./rate-limit');
const { sendJson, readJson } = require('./http');

const NAME_MAX = 120;

/** A blank kitchen — the same space the prototype starts with. */
function defaultProjectData(name = 'Untitled kitchen', clientName = '') {
  return {
    version: 2,
    projectName: name,
    clientName,
    spaces: [{
      id: 'sp1', countertopHeight: 850, name: 'Kitchen', type: 'Kitchen', room: 'kitchen',
      wallW: 6000, wallH: 2700, finish: 'mozu-default', hw: 'h1', install: true, delivery: true,
      extras: {}, tops: [], items: [],
    }],
    activeSpace: 'sp1',
    tab: 'kitchen',
    uid: 100,
  };
}

const cleanName = (v, fallback) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return (s || fallback).slice(0, NAME_MAX);
};

/** Why `data` can't be stored, or null when it is fine. */
function validateProjectData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'data must be an object.';
  if (data.version !== 2) return 'data.version must be 2.';
  if (!Array.isArray(data.spaces) || !data.spaces.length) return 'data.spaces must be a non-empty array.';
  for (const s of data.spaces) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id) return 'Every space needs a string id.';
    if (s.items !== undefined && !Array.isArray(s.items)) return 'space.items must be an array.';
    if (s.tops !== undefined && !Array.isArray(s.tops)) return 'space.tops must be an array.';
  }
  if (data.projectName !== undefined && typeof data.projectName !== 'string') return 'projectName must be a string.';
  if (data.clientName !== undefined && typeof data.clientName !== 'string') return 'clientName must be a string.';
  return null;
}

/**
 * @param options.auth        the auth api (requireUser / guardWrite)
 * @param options.store       shared app store, or options.getStore
 * @param options.limits      { reads, writes } per user per 10 min
 * @param options.maxBytes    largest project JSON accepted (MAX_PROJECT_BYTES, default 512 KB)
 * @param options.maxProjects per user (MAX_PROJECTS_PER_USER, default 100)
 */
function createProjectApi(options = {}) {
  const { auth } = options;
  if (!auth) throw new Error('createProjectApi needs the auth api.');
  let store = options.store || null;
  const getStore = options.getStore || (() => { if (!store) store = createAppStore(); return store; });
  const maxBytes = options.maxBytes || numberFrom(process.env.MAX_PROJECT_BYTES, 512 * 1024);
  const maxProjects = options.maxProjects || numberFrom(process.env.MAX_PROJECTS_PER_USER, 100);
  const rate = createRateLimiter(getStore, {
    reads: numberFrom(process.env.RATE_LIMIT_READS, 600),
    writes: numberFrom(process.env.RATE_LIMIT_WRITES, 300),
    ...options.limits,
  });

  const tooBig = (res) => sendJson(res, 413, { error: `This project is too large to save (limit ${Math.round(maxBytes / 1024)} KB).` });

  async function body(req, res) {
    try {
      const parsed = await readJson(req, maxBytes + 4096);
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
    if (!meta || meta.ownerId !== who.uid) { sendJson(res, 404, { error: 'Project not found.' }); return null; }
    return meta;
  }

  const ok = (res, status, payload, who) => sendJson(res, status, payload, who.headers || {});

  async function list(req, res) {
    const who = await gate(req, res, 'reads');
    if (!who) return;
    try {
      return ok(res, 200, { projects: await getStore().listProjects(who.uid, maxProjects) }, who);
    } catch (e) { return unavailable(res, e); }
  }

  async function create(req, res) {
    const who = await gate(req, res, 'writes');
    if (!who) return;
    const input = await body(req, res);
    if (!input) return;
    try {
      if ((await getStore().countProjects(who.uid)) >= maxProjects) {
        return sendJson(res, 409, { error: `You have reached the limit of ${maxProjects} projects. Delete one to make room.` });
      }
      const name = cleanName(input.name, input.data && input.data.projectName ? cleanName(input.data.projectName, 'Untitled kitchen') : 'Untitled kitchen');
      const clientName = cleanName(input.clientName, input.data && typeof input.data.clientName === 'string' ? input.data.clientName : '');
      const data = input.data === undefined ? defaultProjectData(name, clientName) : input.data;
      const why = validateProjectData(data);
      if (why) return sendJson(res, 400, { error: why });
      data.projectName = name;
      data.clientName = clientName;
      if (Buffer.byteLength(JSON.stringify(data)) > maxBytes) return tooBig(res);
      const now = Date.now();
      const meta = await getStore().createProject({
        id: newId(), ownerId: who.uid, name, clientName, createdAt: now, updatedAt: now, rev: 1,
        schemaVersion: data.version, source: typeof input.source === 'string' ? input.source.slice(0, 40) : (input.data ? 'import' : 'blank'),
      }, data);
      console.log(`[mozu] project ${meta.id} created for ${who.uid.slice(0, 6)}…`);
      return ok(res, 201, { project: meta }, who);
    } catch (e) { return unavailable(res, e); }
  }

  async function get(req, res, pid) {
    const who = await gate(req, res, 'reads');
    if (!who) return;
    try {
      const meta = await owned(res, who, pid);
      if (!meta) return;
      const found = await getStore().getProject(pid);
      if (!found) return sendJson(res, 404, { error: 'Project not found.' });
      return ok(res, 200, { project: found.meta, data: found.data }, who);
    } catch (e) { return unavailable(res, e); }
  }

  async function save(req, res, pid) {
    const who = await gate(req, res, 'writes');
    if (!who) return;
    const input = await body(req, res);
    if (!input) return;
    const rev = Number(input.rev);
    if (!Number.isInteger(rev) || rev < 1) return sendJson(res, 400, { error: 'rev must be the revision you loaded.' });
    const why = validateProjectData(input.data);
    if (why) return sendJson(res, 400, { error: why });
    if (Buffer.byteLength(JSON.stringify(input.data)) > maxBytes) return tooBig(res);
    try {
      const meta = await owned(res, who, pid);
      if (!meta) return;
      const patch = { name: cleanName(input.data.projectName, meta.name), clientName: cleanName(input.data.clientName, '') };
      const result = await getStore().saveProject(pid, rev, input.data, patch);
      if (!result) return sendJson(res, 404, { error: 'Project not found.' });
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
    if (input.name === undefined && input.clientName === undefined) return sendJson(res, 400, { error: 'Nothing to change.' });
    try {
      const meta = await owned(res, who, pid);
      if (!meta) return;
      const found = await getStore().getProject(pid);
      if (!found) return sendJson(res, 404, { error: 'Project not found.' });
      const name = input.name === undefined ? meta.name : cleanName(input.name, meta.name);
      const clientName = input.clientName === undefined ? meta.clientName : cleanName(input.clientName, '');
      const data = { ...found.data, projectName: name, clientName };
      const result = await getStore().saveProject(pid, found.meta.rev, data, { name, clientName });
      if (!result || !result.ok) return sendJson(res, 409, { error: 'The project changed while renaming; try again.' });
      return ok(res, 200, { project: await getStore().getProjectMeta(pid) }, who);
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
    const input = (await body(req, res));
    if (!input) return;
    try {
      const meta = await owned(res, who, pid);
      if (!meta) return;
      if ((await getStore().countProjects(who.uid)) >= maxProjects) {
        return sendJson(res, 409, { error: `You have reached the limit of ${maxProjects} projects. Delete one to make room.` });
      }
      const found = await getStore().getProject(pid);
      if (!found) return sendJson(res, 404, { error: 'Project not found.' });
      const name = cleanName(input.name, `${meta.name} (copy)`);
      const data = { ...found.data, projectName: name };
      const now = Date.now();
      const copy = await getStore().createProject({
        id: newId(), ownerId: who.uid, name, clientName: meta.clientName, createdAt: now, updatedAt: now, rev: 1,
        schemaVersion: data.version, source: `copy:${pid}`,
      }, data);
      return ok(res, 201, { project: copy }, who);
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
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(pid)) return sendJson(res, 404, { error: 'Project not found.' });
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
      return sendJson(res, 404, { error: 'Not found.' });
    } catch (e) {
      console.error('[mozu] projects:', e);
      if (!res.headersSent) return sendJson(res, 500, { error: 'Server error.' });
      res.end();
    }
  }

  return { handle, getStore, maxBytes, maxProjects };
}

module.exports = { createProjectApi, defaultProjectData, validateProjectData };
