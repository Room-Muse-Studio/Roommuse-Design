import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateItems } from '../lib/migrate';
import { itemFromSpec, outline, specById } from '../lib/items';
import { modelById } from '../lib/models';
import { DEFAULT_FRONT, swatchById } from '../lib/finishes';

const oak = swatchById('wood_oak_01')!;
/** An item as a design saved before the MOZU catalogue held it. */
const old = (uid: number, builder: unknown, size: { width: number; depth: number; height: number; elevation?: number }, extra: object = {}) => ({
  uid, roomKey: 'bedroom-a', name: 'Old thing', builder, size: { elevation: 0, ...size },
  center: { x: 1000, z: 290 }, rotation: 0, finishes: { primary: oak, secondary: DEFAULT_FRONT }, ...extra,
});

test('each old module becomes a MOZU model of the same kind', () => {
  const list = migrateItems([
    old(1, { kind: 'module', moduleId: 'base-900-doors' }, { width: 900, depth: 580, height: 870 }),
    old(2, { kind: 'module', moduleId: 'wall-450-door' }, { width: 450, depth: 330, height: 720, elevation: 1450 }),
    old(3, { kind: 'module', moduleId: 'tall-600-pantry' }, { width: 600, depth: 580, height: 2200 }),
    old(4, { kind: 'module', moduleId: 'wardrobe-900-doors' }, { width: 900, depth: 600, height: 2350 }),
    old(5, { kind: 'module', moduleId: 'tv-1800' }, { width: 1800, depth: 400, height: 450 }),
    old(6, { kind: 'module', moduleId: 'shelf-800-open' }, { width: 800, depth: 320, height: 1800 }),
  ]);
  assert.deepEqual(list.map((i) => [i.uid, modelById(i.builder.modelId)!.group]), [
    [1, 'kitchen-base'], [2, 'kitchen-wall'], [3, 'kitchen-tall'], [4, 'wardrobe-main'], [5, 'wardrobe-side'], [6, 'wardrobe-side'],
  ]);
  assert.equal(list[0].builder.modelId, 'KF05', 'a 900 × 580 × 870 base cabinet is nearest the KF05 (900 × 614 × 832)');
  assert.equal(list[3].builder.modelId, 'W05', 'a 900 × 600 wardrobe is a W05');
  assert.equal(list[1].size.elevation, 1450, 'the stored elevation is kept');
  for (const i of list) {
    const m = modelById(i.builder.modelId)!;
    assert.deepEqual([i.size.width, i.size.depth, i.size.height], [m.width, m.depth, m.height], `${i.uid}: the model's size`);
    assert.equal(i.name, m.name);
    assert.equal(i.roomKey, 'bedroom-a');
    assert.equal(i.finishes.primary, oak, 'finishes travel');
  }
});

test('old storage furniture becomes a model; other furniture and unknown kinds are dropped', () => {
  const list = migrateItems([
    old(1, { kind: 'furniture', type: 'bed' }, { width: 1400, depth: 2000, height: 500 }),
    old(2, { kind: 'furniture', type: 'storage' }, { width: 1200, depth: 600, height: 2000 }),
    old(3, { kind: 'furniture', type: 'table' }, { width: 1000, depth: 600, height: 750 }),
    old(4, { kind: 'module', moduleId: 'something-new' }, { width: 1000, depth: 600, height: 750 }),
    old(5, { kind: 'model', modelId: 'NOPE' }, { width: 1000, depth: 600, height: 750 }),
    old(6, { kind: 'teapot' }, { width: 100, depth: 100, height: 100 }),
  ]);
  assert.deepEqual(list.map((i) => `${i.uid}:${i.builder.modelId}`), ['2:W05']);
});

test('an old item keeps its back face where it was; a model item is left exactly as it was', () => {
  // A 580 mm deep base cabinet with its back on the north wall (z = 0), centre z = 290.
  const [cab] = migrateItems([old(1, { kind: 'module', moduleId: 'base-900-doors' }, { width: 900, depth: 580, height: 870 })]);
  const back = Math.min(...outline(cab.size, cab.center, cab.rotation).map((p) => p.z));
  assert.equal(Math.round(back), 0);
  assert.equal(cab.center.z, 307, 'a KF05 is 614 deep, so its centre is 17 mm further into the room');
  const item = itemFromSpec(specById('KH04')!, 7, 'kitchen', { center: { x: 1234, z: 178 }, rotation: Math.PI / 2 });
  item.fromScan = true;
  assert.deepEqual(migrateItems([item]), [item]);
});

test('migration is idempotent and shrugs at odd data', () => {
  const once = migrateItems([
    old(1, { kind: 'module', moduleId: 'wardrobe-450-door' }, { width: 450, depth: 600, height: 2350 }),
    old(2, { kind: 'furniture', type: 'storage' }, { width: 900, depth: 250, height: 300, elevation: 1500 }, { finishes: { primary: oak } }),
  ]);
  assert.deepEqual(migrateItems(once), once);
  assert.deepEqual(once[1].finishes, { primary: oak, secondary: oak }, 'a missing second slot is filled in');
  for (const odd of [null, undefined, 42, 'items', {}, [null, 1, 'x', {}, { uid: 'a' }, { uid: 1, roomKey: 'r', builder: null }, { uid: 1, roomKey: 'r', builder: { kind: 'model', modelId: 'KF01' }, center: { x: 'no' } }]]) {
    assert.deepEqual(migrateItems(odd), [], JSON.stringify(odd));
  }
});
