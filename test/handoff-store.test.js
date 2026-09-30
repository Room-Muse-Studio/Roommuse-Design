'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALPHABET,
  MemoryHandoffStore,
  RedisHandoffStore,
  createStore,
  newCode,
  normaliseCode,
  storeScan,
  fetchScan,
  handoffUrl,
} = require('../server/handoff-store');

/** Just enough of Upstash's REST /pipeline endpoint to run the store against. */
function fakeUpstash({ token = 'secret', now = () => Date.now() } = {}) {
  const data = new Map(); // key → { value, expiresAt }
  const live = (key) => {
    const v = data.get(key);
    if (v && v.expiresAt && v.expiresAt <= now()) { data.delete(key); return null; }
    return v || null;
  };
  const run = ([cmd, key, ...args]) => {
    switch (cmd.toUpperCase()) {
      case 'PING': return 'PONG';
      case 'GET': { const v = live(key); return v ? v.value : null; }
      case 'SET': {
        const opts = args.slice(1).map(String);
        if (opts.includes('NX') && live(key)) return null;
        const ex = opts.indexOf('EX'), px = opts.indexOf('PX');
        const ttl = ex >= 0 ? Number(opts[ex + 1]) * 1000 : px >= 0 ? Number(opts[px + 1]) : 0;
        data.set(key, { value: String(args[0]), expiresAt: ttl ? now() + ttl : 0 });
        return 'OK';
      }
      case 'INCR': {
        const v = live(key) || { value: '0', expiresAt: 0 };
        v.value = String(Number(v.value) + 1);
        data.set(key, v);
        return Number(v.value);
      }
      default: return { error: `unknown command ${cmd}` };
    }
  };
  const calls = [];
  async function fetch(url, init) {
    calls.push({ url, init });
    if (init.headers.authorization !== `Bearer ${token}`) {
      return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
    }
    const body = JSON.parse(init.body).map((c) => {
      const r = run(c);
      return r && r.error ? r : { result: r };
    });
    return { ok: true, status: 200, json: async () => body };
  }
  return { fetch, data, calls };
}

const scan = { schema: 'mozu.roomscan/1', polygon: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }], fixtures: [] };

test('codes use the unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const code = newCode();
    assert.equal(code.length, 6);
    for (const c of code) assert.ok(ALPHABET.includes(c), `${c} in ${code}`);
  }
});

test('normaliseCode forgives case, spaces, dashes and look-alike characters', () => {
  assert.equal(normaliseCode('b7k4-m2'), 'B7K4M2');
  assert.equal(normaliseCode(' B7K 4M2 '), 'B7K4M2');
  assert.equal(normaliseCode('B7K4MO'), 'B7K4MQ'); // O → 0 → Q
  assert.equal(normaliseCode('B7K4ML'), 'B7K4MJ'); // L → 1 → J
  assert.equal(normaliseCode('B7K4MU'), 'B7K4MV');
  assert.equal(normaliseCode('B7K4M'), null);
  assert.equal(normaliseCode('B7K4M2X'), null);
  assert.equal(normaliseCode(42), null);
});

test('handoffUrl points at /scan/:code', () => {
  assert.equal(handoffUrl('https://x.test/', 'B7K4M2'), 'https://x.test/scan/B7K4M2');
});

for (const [name, make] of [
  ['memory', (now) => new MemoryHandoffStore({ now })],
  ['redis', (now) => new RedisHandoffStore({ url: 'https://redis.test', token: 'secret', fetch: fakeUpstash({ now }).fetch })],
]) {
  test(`${name}: stores a scan and fetches it back by any spelling of the code`, async () => {
    const store = make(() => Date.now());
    const entry = await storeScan(store, scan);
    const found = await fetchScan(store, entry.code.toLowerCase().slice(0, 3) + '-' + entry.code.slice(3));
    assert.equal(found.code, entry.code);
    assert.deepEqual(found.scan, scan);
    assert.equal(found.expiresAt - found.createdAt, 24 * 60 * 60 * 1000);
  });

  test(`${name}: claim never overwrites an existing code`, async () => {
    const store = make(() => Date.now());
    const e = { scan, createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
    assert.equal(await store.claim('B7K4M2', e, 60_000), true);
    assert.equal(await store.claim('B7K4M2', { ...e, scan: { other: true } }, 60_000), false);
    assert.deepEqual((await store.get('B7K4M2')).scan, scan);
  });

  test(`${name}: rate counter counts within a window and resets after it`, async () => {
    let t = 1_000_000;
    const store = make(() => t);
    assert.equal(await store.hit('uploads:1.2.3.4', 1_000), 1);
    assert.equal(await store.hit('uploads:1.2.3.4', 1_000), 2);
    assert.equal(await store.hit('uploads:5.6.7.8', 1_000), 1);
    t += 1_001;
    assert.equal(await store.hit('uploads:1.2.3.4', 1_000), 1);
  });

  test(`${name}: ping`, async () => {
    assert.equal(await make(() => Date.now()).ping(), true);
  });
}

test('memory: codes expire', async () => {
  let t = 1_000_000;
  const store = new MemoryHandoffStore({ now: () => t });
  const entry = await storeScan(store, scan, t, 5_000);
  assert.ok(await fetchScan(store, entry.code));
  t += 5_001;
  assert.equal(await fetchScan(store, entry.code), null);
});

test('redis: stored codes expire through Redis TTL', async () => {
  let t = 1_000_000;
  const upstash = fakeUpstash({ now: () => t });
  const store = new RedisHandoffStore({ url: 'https://redis.test/', token: 'secret', fetch: upstash.fetch });
  const entry = await storeScan(store, scan, Date.now(), 5_000);
  assert.ok(await store.get(entry.code));
  t += 5_001;
  assert.equal(await store.get(entry.code), null);
  assert.equal(upstash.calls[0].url, 'https://redis.test/pipeline');
});

test('redis: a bad token is an error, not an empty result', async () => {
  const store = new RedisHandoffStore({ url: 'https://redis.test', token: 'wrong', fetch: fakeUpstash().fetch });
  await assert.rejects(store.get('B7K4M2'), /Unauthorized/);
});

test('createStore picks Redis from either env naming, memory locally, and refuses memory on Vercel', () => {
  assert.equal(createStore({}).kind, 'memory');
  assert.equal(createStore({ KV_REST_API_URL: 'https://r', KV_REST_API_TOKEN: 't' }).kind, 'redis');
  assert.equal(createStore({ UPSTASH_REDIS_REST_URL: 'https://r', UPSTASH_REDIS_REST_TOKEN: 't' }).kind, 'redis');
  assert.throws(() => createStore({ VERCEL: '1' }), /No Redis configured/);
});

test('redis: a whole home is stored and comes back intact, with the 24-hour expiry', async () => {
  const upstash = fakeUpstash();
  const store = new RedisHandoffStore({ url: 'https://redis.test', token: 'secret', fetch: upstash.fetch });
  const home = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'samples', 'twobedroom.roomscan.json'), 'utf8'));
  const entry = await storeScan(store, home);
  const found = await fetchScan(store, entry.code);
  assert.deepEqual(found.scan, home);
  assert.equal(found.expiresAt - found.createdAt, 24 * 60 * 60 * 1000);
});
