/*
 * Short-code store for the iPad → web handoff.
 *
 * Matches mozu-configurator/src/systems/handoff/scanHandoff.ts: six characters
 * from an unambiguous alphabet, valid for 24 hours, forgiving of how people type.
 *
 * A code only carries a scan. Anyone with the code can fetch the scan (that is
 * the point: type it on the laptop) and, signed in, turn it into a project of
 * their own (server/project-api.js). The code keeps its 24-hour expiry either way.
 *
 * Two stores share one async interface:
 *   MemoryHandoffStore — `npm start` on a laptop; codes live as long as the process.
 *   RedisHandoffStore  — production (Vercel + Upstash Redis). Every server
 *                        instance sees the same codes, and they survive redeploys.
 * createStore() picks one from the environment. server/app-store.js extends both
 * with users, sessions and projects.
 */
'use strict';

const crypto = require('node:crypto');

/** No O/0, no I/1/L, no U — the characters people misread aloud. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 6;
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SCAN_BYTES = 2_000_000;
const KEY_PREFIX = 'mozu:handoff:';
const RATE_PREFIX = 'mozu:rate:';

function newCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Accept "b7k4-m2", "B7K 4M2" etc.; fold excluded characters onto included ones. */
function normaliseCode(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/0/g, 'Q')
    .replace(/1/g, 'J')
    .replace(/U/g, 'V');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const c of cleaned) if (!ALPHABET.includes(c)) return null;
  return cleaned;
}

// ── stores ─────────────────────────────────────────────────────────────────
//
// Interface (all async):
//   claim(code, entry, ttlMs) → true if stored, false if the code was taken
//   get(code)                 → entry or null (expired entries are null)
//   hit(bucket, windowMs)     → how many times `bucket` was hit in this window
//   ping()                    → true when the store is reachable

class MemoryHandoffStore {
  constructor({ now = () => Date.now() } = {}) {
    this.kind = 'memory';
    this.now = now;
    this.entries = new Map();
    this.counters = new Map();
  }

  async claim(code, entry) {
    this.sweep();
    if (this.entries.has(code)) return false;
    this.entries.set(code, entry);
    return true;
  }

  async get(code) {
    const found = this.entries.get(code);
    if (!found) return null;
    if (found.expiresAt <= this.now()) {
      this.entries.delete(code);
      return null;
    }
    return found;
  }

  async hit(bucket, windowMs) {
    const now = this.now();
    const c = this.counters.get(bucket);
    if (!c || c.resetAt <= now) {
      this.counters.set(bucket, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    return ++c.count;
  }

  async ping() {
    return true;
  }

  sweep(now = this.now()) {
    for (const [code, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(code);
    for (const [bucket, c] of this.counters) if (c.resetAt <= now) this.counters.delete(bucket);
  }

  get size() {
    return this.entries.size;
  }
}

/** Upstash Redis over its REST API — plain fetch, no npm dependency. */
class RedisHandoffStore {
  constructor({ url, token, fetch: fetchImpl = globalThis.fetch }) {
    if (!url || !token) throw new Error('RedisHandoffStore needs a REST url and token.');
    this.kind = 'redis';
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }

  async command(args) {
    const [result] = await this.pipeline([args]);
    return result;
  }

  async pipeline(commands) {
    const res = await this.fetch(this.url + '/pipeline', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands),
    });
    let body;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok || !Array.isArray(body)) {
      const why = (body && body.error) || `HTTP ${res.status}`;
      throw new Error(`Redis request failed: ${why}`);
    }
    return body.map((r) => {
      if (r && r.error) throw new Error(`Redis error: ${r.error}`);
      return r ? r.result : null;
    });
  }

  async claim(code, entry, ttlMs) {
    const seconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const result = await this.command(['SET', KEY_PREFIX + code, JSON.stringify(entry), 'NX', 'EX', String(seconds)]);
    return result === 'OK';
  }

  async get(code) {
    const text = await this.command(['GET', KEY_PREFIX + code]);
    if (typeof text !== 'string') return null;
    let entry;
    try { entry = JSON.parse(text); } catch { return null; }
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry;
  }

  async hit(bucket, windowMs) {
    const key = RATE_PREFIX + bucket;
    // Create the window's counter with its expiry, then count; INCR keeps the TTL.
    const [, count] = await this.pipeline([
      ['SET', key, '0', 'PX', String(windowMs), 'NX'],
      ['INCR', key],
    ]);
    return Number(count) || 0;
  }

  async ping() {
    return (await this.command(['PING'])) === 'PONG';
  }
}

/**
 * Redis when its credentials are set (Vercel's Upstash integration sets KV_REST_API_*;
 * a direct Upstash database uses UPSTASH_REDIS_REST_*), memory otherwise. On Vercel,
 * memory would hand out codes other instances can't see, so it refuses instead.
 */
function createStore(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisHandoffStore({ url, token });
  if (env.VERCEL) {
    throw new Error('No Redis configured. Connect Upstash Redis to this Vercel project (it sets KV_REST_API_URL and KV_REST_API_TOKEN).');
  }
  return new MemoryHandoffStore();
}

/** Store a scan and return its code, retrying on the (unlikely) collision. */
async function storeScan(store, scan, now = Date.now(), ttlMs = HANDOFF_TTL_MS) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    const entry = { scan, createdAt: now, expiresAt: now + ttlMs };
    if (await store.claim(code, entry, ttlMs)) return { code, ...entry };
  }
  throw new Error('could not allocate a handoff code');
}

/** Look up a scan by whatever the person typed. */
async function fetchScan(store, input) {
  const code = normaliseCode(input);
  if (!code) return null;
  const entry = await store.get(code);
  return entry ? { code, ...entry } : null;
}

/** The page a person opens to land on their room. */
function handoffUrl(origin, code) {
  return `${origin.replace(/\/+$/, '')}/scan/${code}`;
}

module.exports = {
  ALPHABET,
  CODE_LENGTH,
  HANDOFF_TTL_MS,
  MAX_SCAN_BYTES,
  MemoryHandoffStore,
  RedisHandoffStore,
  createStore,
  newCode,
  normaliseCode,
  storeScan,
  fetchScan,
  handoffUrl,
};
