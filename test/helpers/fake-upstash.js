'use strict';

/**
 * Just enough of Upstash's REST /pipeline endpoint to run the stores against:
 * strings with TTLs, hashes, sorted sets, counters, and the one Lua script the
 * project store uses for conditional saves (recognised by its text).
 */
function fakeUpstash({ token = 'secret', now = () => Date.now() } = {}) {
  const data = new Map(); // key → { type, value, expiresAt }
  const live = (key) => {
    const v = data.get(key);
    if (v && v.expiresAt && v.expiresAt <= now()) { data.delete(key); return null; }
    return v || null;
  };
  const ensure = (key, type) => {
    let v = live(key);
    if (!v) { v = { type, value: type === 'string' ? '' : new Map(), expiresAt: 0 }; data.set(key, v); }
    if (v.type !== type) throw new Error('WRONGTYPE');
    return v;
  };
  const num = (x) => Number(x);

  const run = ([cmd, ...args]) => {
    const key = args[0];
    switch (String(cmd).toUpperCase()) {
      case 'PING': return 'PONG';
      case 'GET': { const v = live(key); return v && v.type === 'string' ? v.value : null; }
      case 'SET': {
        const opts = args.slice(2).map(String);
        if (opts.includes('NX') && live(key)) return null;
        const ex = opts.indexOf('EX'), px = opts.indexOf('PX');
        const ttl = ex >= 0 ? num(opts[ex + 1]) * 1000 : px >= 0 ? num(opts[px + 1]) : 0;
        data.set(key, { type: 'string', value: String(args[1]), expiresAt: ttl ? now() + ttl : 0 });
        return 'OK';
      }
      case 'DEL': { let n = 0; for (const k of args) if (live(k)) { data.delete(k); n++; } return n; }
      case 'EXISTS': { let n = 0; for (const k of args) if (live(k)) n++; return n; }
      case 'EXPIRE': { const v = live(key); if (!v) return 0; v.expiresAt = now() + num(args[1]) * 1000; return 1; }
      case 'PEXPIRE': { const v = live(key); if (!v) return 0; v.expiresAt = now() + num(args[1]); return 1; }
      case 'PTTL': { const v = live(key); return v ? (v.expiresAt ? v.expiresAt - now() : -1) : -2; }
      case 'INCR': {
        const v = ensure(key, 'string');
        v.value = String(num(v.value || '0') + 1);
        return num(v.value);
      }
      case 'HSET': {
        const v = ensure(key, 'hash');
        let added = 0;
        for (let i = 1; i < args.length; i += 2) { if (!v.value.has(String(args[i]))) added++; v.value.set(String(args[i]), String(args[i + 1])); }
        return added;
      }
      case 'HGET': { const v = live(key); return v && v.type === 'hash' && v.value.has(args[1]) ? v.value.get(args[1]) : null; }
      case 'HGETALL': { const v = live(key); return v && v.type === 'hash' ? [...v.value.entries()].flat() : []; }
      case 'HINCRBY': { const v = ensure(key, 'hash'); const n = num(v.value.get(args[1]) || '0') + num(args[2]); v.value.set(args[1], String(n)); return n; }
      case 'ZADD': {
        const v = ensure(key, 'zset');
        let added = 0;
        for (let i = 1; i < args.length; i += 2) { if (!v.value.has(String(args[i + 1]))) added++; v.value.set(String(args[i + 1]), num(args[i])); }
        return added;
      }
      case 'ZREM': { const v = live(key); if (!v) return 0; let n = 0; for (const m of args.slice(1)) if (v.value.delete(String(m))) n++; return n; }
      case 'ZCARD': { const v = live(key); return v && v.type === 'zset' ? v.value.size : 0; }
      case 'ZREVRANGE': {
        const v = live(key); if (!v || v.type !== 'zset') return [];
        const sorted = [...v.value.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)).map((e) => e[0]);
        const start = num(args[1]), stop = num(args[2]);
        return sorted.slice(start, stop < 0 ? sorted.length + stop + 1 : stop + 1);
      }
      case 'EVAL': {
        const [script, numkeys, ...rest] = args;
        const keys = rest.slice(0, num(numkeys)), argv = rest.slice(num(numkeys));
        if (String(script).includes('CONFLICT')) return conditionalSave(keys, argv);
        return { error: 'unknown script' };
      }
      default: return { error: `unknown command ${cmd}` };
    }
  };

  // Mirrors RedisAppStore.SAVE_SCRIPT: KEYS = meta, design, userIndex;
  // ARGV = expectedRev, designJson, newRev, updatedAt, bytes, pid
  function conditionalSave(keys, argv) {
    const meta = live(keys[0]);
    if (!meta) return 'NOTFOUND';
    const rev = meta.value.get('rev');
    if (rev !== String(argv[0])) return 'CONFLICT:' + rev;
    run(['SET', keys[1], argv[1]]);
    run(['HSET', keys[0], 'rev', argv[2], 'updatedAt', argv[3], 'bytes', argv[4]]);
    run(['ZADD', keys[2], argv[3], argv[5]]);
    return 'OK:' + argv[2];
  }

  const calls = [];
  async function fetch(url, init) {
    calls.push({ url, init });
    if (init.headers.authorization !== `Bearer ${token}`) {
      return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
    }
    const body = JSON.parse(init.body).map((c) => {
      try {
        const r = run(c);
        return r && r.error ? r : { result: r };
      } catch (e) {
        return { error: e.message };
      }
    });
    return { ok: true, status: 200, json: async () => body };
  }
  return { fetch, data, calls };
}

module.exports = { fakeUpstash };
