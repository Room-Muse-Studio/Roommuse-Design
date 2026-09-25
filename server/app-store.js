/*
 * Accounts and projects on the same store as the scan handoff codes.
 *
 *   mozu:user:{uid}            HASH    email, name, picture, emailVerified, providers, createdAt, lastLoginAt
 *   mozu:session:{sid}         STRING  JSON { uid, createdAt, expiresAt, ua }, with a Redis TTL
 *   mozu:project:{pid}         HASH    ownerId, name, clientName, createdAt, updatedAt, rev, schemaVersion, bytes, spaces, source
 *   mozu:project:{pid}:data    STRING  the saved-project JSON the editor reads
 *   mozu:user:{uid}:projects   ZSET    pid scored by updatedAt (newest first)
 *
 * Meta and data are separate so listing a gallery never fetches the blobs.
 * Saves are conditional on the project's revision (`rev`), so two tabs or
 * devices can't silently overwrite each other: the loser gets a conflict.
 *
 * MemoryAppStore for `npm start`; RedisAppStore (Upstash REST, plain fetch)
 * in production. Both extend the handoff stores, so one object serves every API.
 */
'use strict';

const crypto = require('node:crypto');
const { MemoryHandoffStore, RedisHandoffStore } = require('./handoff-store');

const K = {
  user: (uid) => `mozu:user:${uid}`,
  session: (sid) => `mozu:session:${sid}`,
  project: (pid) => `mozu:project:${pid}`,
  projectData: (pid) => `mozu:project:${pid}:data`,
  userProjects: (uid) => `mozu:user:${uid}:projects`,
};

const META_NUMBERS = ['createdAt', 'updatedAt', 'rev', 'schemaVersion', 'bytes', 'spaces'];

const newId = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');
const newSessionId = () => newId(32);

/** Normalise a meta record: numbers as numbers, only known fields. */
function normaliseMeta(meta) {
  if (!meta || !meta.ownerId) return null;
  const out = {
    id: String(meta.id),
    ownerId: String(meta.ownerId),
    name: String(meta.name || 'Untitled project'),
    clientName: String(meta.clientName || ''),
    source: String(meta.source || ''),
  };
  for (const k of META_NUMBERS) out[k] = Number(meta[k]) || 0;
  return out;
}

const projectBytes = (json) => Buffer.byteLength(json, 'utf8');
const spaceCount = (data) => (data && Array.isArray(data.spaces) ? data.spaces.length : 0);

// ── memory ─────────────────────────────────────────────────────────────────

class MemoryAppStore extends MemoryHandoffStore {
  constructor(opts = {}) {
    super(opts);
    this.users = new Map();
    this.sessions = new Map();
    this.projects = new Map(); // pid → { meta, json }
  }

  // users
  async upsertUser(uid, fields) {
    const now = this.now();
    const existing = this.users.get(uid) || { uid, createdAt: now, providers: [] };
    const providers = new Set(existing.providers || []);
    if (fields.provider) providers.add(fields.provider);
    const user = {
      ...existing,
      email: fields.email ?? existing.email ?? '',
      name: fields.name || existing.name || '',
      picture: fields.picture || existing.picture || '',
      emailVerified: !!(fields.emailVerified || existing.emailVerified),
      providers: [...providers],
      lastLoginAt: now,
    };
    this.users.set(uid, user);
    return { ...user };
  }

  async getUser(uid) {
    const u = this.users.get(uid);
    return u ? { ...u } : null;
  }

  // sessions
  async createSession(uid, info, ttlMs) {
    const sid = newSessionId();
    const now = this.now();
    const session = { uid, createdAt: now, expiresAt: now + ttlMs, ua: String(info && info.ua || '').slice(0, 200) };
    this.sessions.set(sid, session);
    return { sid, ...session };
  }

  async getSession(sid) {
    const s = this.sessions.get(sid);
    if (!s) return null;
    if (s.expiresAt <= this.now()) { this.sessions.delete(sid); return null; }
    return { sid, ...s };
  }

  async touchSession(sid, ttlMs) {
    const s = this.sessions.get(sid);
    if (!s) return null;
    s.expiresAt = this.now() + ttlMs;
    return s.expiresAt;
  }

  async deleteSession(sid) {
    this.sessions.delete(sid);
  }

  // projects
  async createProject(meta, data) {
    const json = JSON.stringify(data);
    const full = normaliseMeta({ ...meta, rev: meta.rev || 1, bytes: projectBytes(json), spaces: spaceCount(data) });
    this.projects.set(full.id, { meta: full, json });
    return { ...full };
  }

  async getProjectMeta(pid) {
    const p = this.projects.get(pid);
    return p ? { ...p.meta } : null;
  }

  async getProject(pid) {
    const p = this.projects.get(pid);
    return p ? { meta: { ...p.meta }, data: JSON.parse(p.json) } : null;
  }

  async listProjects(uid, limit = 100) {
    return [...this.projects.values()]
      .filter((p) => p.meta.ownerId === uid)
      .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt || (a.meta.id < b.meta.id ? 1 : -1))
      .slice(0, limit)
      .map((p) => ({ ...p.meta }));
  }

  async countProjects(uid) {
    let n = 0;
    for (const p of this.projects.values()) if (p.meta.ownerId === uid) n++;
    return n;
  }

  async saveProject(pid, expectedRev, data, patch = {}) {
    const p = this.projects.get(pid);
    if (!p) return null;
    if (p.meta.rev !== Number(expectedRev)) return { ok: false, conflict: true, rev: p.meta.rev, updatedAt: p.meta.updatedAt };
    const json = JSON.stringify(data);
    const updatedAt = this.now();
    p.meta = normaliseMeta({
      ...p.meta,
      name: patch.name ?? p.meta.name,
      clientName: patch.clientName ?? p.meta.clientName,
      rev: p.meta.rev + 1,
      updatedAt,
      bytes: projectBytes(json),
      spaces: spaceCount(data),
    });
    p.json = json;
    return { ok: true, rev: p.meta.rev, updatedAt };
  }

  async deleteProject(pid) {
    return this.projects.delete(pid);
  }
}

// ── redis ──────────────────────────────────────────────────────────────────

// Conditional save: only when the stored rev matches. Returns plain strings so
// the REST pipeline never turns a business outcome into an error.
//   KEYS: meta, data, userIndex
//   ARGV: expectedRev, dataJson, newRev, updatedAt, name, clientName, bytes, spaces, pid
const SAVE_SCRIPT = `
local rev = redis.call('HGET', KEYS[1], 'rev')
if not rev then return 'NOTFOUND' end
if rev ~= ARGV[1] then return 'CONFLICT:' .. rev end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('HSET', KEYS[1], 'rev', ARGV[3], 'updatedAt', ARGV[4], 'name', ARGV[5], 'clientName', ARGV[6], 'bytes', ARGV[7], 'spaces', ARGV[8])
redis.call('ZADD', KEYS[3], ARGV[4], ARGV[9])
return 'OK:' .. ARGV[3]
`.trim();

const flatten = (obj) => Object.entries(obj).flatMap(([k, v]) => [k, v === undefined || v === null ? '' : String(v)]);
const unflatten = (arr) => {
  const out = {};
  for (let i = 0; i + 1 < (arr || []).length; i += 2) out[arr[i]] = arr[i + 1];
  return out;
};

class RedisAppStore extends RedisHandoffStore {
  // users
  async upsertUser(uid, fields) {
    const now = Date.now();
    const existing = await this.getUser(uid);
    const providers = new Set(existing ? existing.providers : []);
    if (fields.provider) providers.add(fields.provider);
    const user = {
      uid,
      email: fields.email ?? (existing && existing.email) ?? '',
      name: fields.name || (existing && existing.name) || '',
      picture: fields.picture || (existing && existing.picture) || '',
      emailVerified: !!(fields.emailVerified || (existing && existing.emailVerified)),
      providers: [...providers],
      createdAt: existing ? existing.createdAt : now,
      lastLoginAt: now,
    };
    await this.command(['HSET', K.user(uid), ...flatten({ ...user, providers: user.providers.join(','), emailVerified: user.emailVerified ? '1' : '0' })]);
    return user;
  }

  async getUser(uid) {
    const h = unflatten(await this.command(['HGETALL', K.user(uid)]));
    if (!h.uid) return null;
    return {
      uid: h.uid,
      email: h.email || '',
      name: h.name || '',
      picture: h.picture || '',
      emailVerified: h.emailVerified === '1',
      providers: h.providers ? h.providers.split(',').filter(Boolean) : [],
      createdAt: Number(h.createdAt) || 0,
      lastLoginAt: Number(h.lastLoginAt) || 0,
    };
  }

  // sessions
  async createSession(uid, info, ttlMs) {
    const sid = newSessionId();
    const now = Date.now();
    const session = { uid, createdAt: now, expiresAt: now + ttlMs, ua: String(info && info.ua || '').slice(0, 200) };
    await this.command(['SET', K.session(sid), JSON.stringify(session), 'PX', String(ttlMs)]);
    return { sid, ...session };
  }

  async getSession(sid) {
    const text = await this.command(['GET', K.session(sid)]);
    if (typeof text !== 'string') return null;
    let s;
    try { s = JSON.parse(text); } catch { return null; }
    if (!s || !s.uid || s.expiresAt <= Date.now()) return null;
    return { sid, ...s };
  }

  async touchSession(sid, ttlMs) {
    const s = await this.getSession(sid);
    if (!s) return null;
    const expiresAt = Date.now() + ttlMs;
    const { sid: _omit, ...rest } = s;
    await this.command(['SET', K.session(sid), JSON.stringify({ ...rest, expiresAt }), 'PX', String(ttlMs)]);
    return expiresAt;
  }

  async deleteSession(sid) {
    await this.command(['DEL', K.session(sid)]);
  }

  // projects
  async createProject(meta, data) {
    const json = JSON.stringify(data);
    const full = normaliseMeta({ ...meta, rev: meta.rev || 1, bytes: projectBytes(json), spaces: spaceCount(data) });
    await this.pipeline([
      ['HSET', K.project(full.id), ...flatten(full)],
      ['SET', K.projectData(full.id), json],
      ['ZADD', K.userProjects(full.ownerId), String(full.updatedAt), full.id],
    ]);
    return full;
  }

  async getProjectMeta(pid) {
    return normaliseMeta(unflatten(await this.command(['HGETALL', K.project(pid)])));
  }

  async getProject(pid) {
    const [flat, json] = await this.pipeline([['HGETALL', K.project(pid)], ['GET', K.projectData(pid)]]);
    const meta = normaliseMeta(unflatten(flat));
    if (!meta || typeof json !== 'string') return null;
    let data;
    try { data = JSON.parse(json); } catch { return null; }
    return { meta, data };
  }

  async listProjects(uid, limit = 100) {
    const ids = await this.command(['ZREVRANGE', K.userProjects(uid), '0', String(Math.max(0, limit - 1))]);
    if (!Array.isArray(ids) || !ids.length) return [];
    const metas = await this.pipeline(ids.map((id) => ['HGETALL', K.project(id)]));
    const out = [];
    const stale = [];
    ids.forEach((id, i) => {
      const meta = normaliseMeta(unflatten(metas[i]));
      if (meta && meta.ownerId === uid) out.push(meta);
      else stale.push(id);
    });
    if (stale.length) await this.command(['ZREM', K.userProjects(uid), ...stale]).catch(() => {});
    return out;
  }

  async countProjects(uid) {
    return Number(await this.command(['ZCARD', K.userProjects(uid)])) || 0;
  }

  async saveProject(pid, expectedRev, data, patch = {}) {
    const meta = await this.getProjectMeta(pid);
    if (!meta) return null;
    const json = JSON.stringify(data);
    const updatedAt = Date.now();
    const name = patch.name ?? meta.name;
    const clientName = patch.clientName ?? meta.clientName;
    const result = await this.command([
      'EVAL', SAVE_SCRIPT, '3',
      K.project(pid), K.projectData(pid), K.userProjects(meta.ownerId),
      String(expectedRev), json, String(Number(expectedRev) + 1), String(updatedAt),
      name, clientName, String(projectBytes(json)), String(spaceCount(data)), pid,
    ]);
    if (result === 'NOTFOUND') return null;
    if (typeof result === 'string' && result.startsWith('CONFLICT:')) {
      const current = await this.getProjectMeta(pid);
      return { ok: false, conflict: true, rev: Number(result.slice(9)), updatedAt: current ? current.updatedAt : 0 };
    }
    return { ok: true, rev: Number(String(result).slice(3)), updatedAt };
  }

  async deleteProject(pid) {
    const meta = await this.getProjectMeta(pid);
    if (!meta) return false;
    await this.pipeline([
      ['DEL', K.project(pid), K.projectData(pid)],
      ['ZREM', K.userProjects(meta.ownerId), pid],
    ]);
    return true;
  }
}

/** Same environment rules as handoff-store's createStore. */
function createAppStore(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisAppStore({ url, token });
  if (env.VERCEL) {
    throw new Error('No Redis configured. Connect Upstash Redis to this Vercel project (it sets KV_REST_API_URL and KV_REST_API_TOKEN).');
  }
  return new MemoryAppStore();
}

module.exports = { MemoryAppStore, RedisAppStore, createAppStore, newId, SAVE_SCRIPT, K };
