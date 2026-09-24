/*
 * Short-code store for the iPad → web handoff.
 *
 * Matches mozu-configurator/src/systems/handoff/scanHandoff.ts: six characters
 * from an unambiguous alphabet, valid for 24 hours, forgiving of how people type.
 *
 * In-memory on purpose: codes live as long as the server process. Restarting
 * the server forgets them, which is fine for a prototype and wrong for two servers.
 */
'use strict';

const crypto = require('node:crypto');

/** No O/0, no I/1/L, no U — the characters people misread aloud. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 6;
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SCAN_BYTES = 2_000_000;

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

class MemoryHandoffStore {
  constructor() {
    this.entries = new Map();
  }

  put(code, entry) {
    this.sweep();
    this.entries.set(code, entry);
  }

  get(code) {
    const found = this.entries.get(code);
    if (!found) return null;
    if (found.expiresAt <= Date.now()) {
      this.entries.delete(code);
      return null;
    }
    return found;
  }

  delete(code) {
    this.entries.delete(code);
  }

  sweep(now = Date.now()) {
    for (const [code, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(code);
  }

  get size() {
    return this.entries.size;
  }
}

/** Store a scan and return its code, retrying on the (unlikely) collision. */
function storeScan(store, scan, now = Date.now(), ttlMs = HANDOFF_TTL_MS) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    if (store.get(code)) continue;
    const entry = { scan, createdAt: now, expiresAt: now + ttlMs };
    store.put(code, entry);
    return { code, ...entry };
  }
  throw new Error('could not allocate a handoff code');
}

/** Look up a scan by whatever the person typed. */
function fetchScan(store, input) {
  const code = normaliseCode(input);
  if (!code) return null;
  const entry = store.get(code);
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
  newCode,
  normaliseCode,
  storeScan,
  fetchScan,
  handoffUrl,
};
