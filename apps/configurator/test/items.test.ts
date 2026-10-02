import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomScan } from '@mozu/scan-sdk';
import {
  DEFAULT_FINISHES, fitsAt, freeSpot, frontOf, itemFromSpec, outline, overlapping, sameFamily, snapToWall, specById,
  swapPlaces, WALL_GAP, type Item, type ItemSpec,
} from '../lib/items';
import { containsPoint, wallFrames } from '../lib/walls';
import { twoBedroom } from './fixtures';

const [, bedroomA, bedroomB] = twoBedroom().rooms;
const others = (items: Item[], me: Item) => items.filter((i) => i !== me);
const square = (w: number, d: number): RoomScan => ({
  schema: 'mozu.roomscan/1', polygon: [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }],
  height: 2500, openings: [], objects: [], fixtures: [], source: 'manual', unitSystem: 'metric', confidence: 1, capturedAt: '',
});
/** A spec of any size, for the geometry tests: which model it draws doesn't matter there. */
const boxSpec = (id: string, width: number, depth: number, height: number): ItemSpec =>
  ({ id, group: 'kitchen-base', name: id, builder: { kind: 'model', modelId: 'KF01' }, size: { width, depth, height, elevation: 0 }, finishes: DEFAULT_FINISHES });
const chair = boxSpec('chair', 450, 500, 850), sofa = boxSpec('sofa', 2100, 900, 820);

test('a scan places nothing: the configurator has no way to turn scanned objects into items', async () => {
  // The rooms in the sample do contain storage, beds and a desk; none of them becomes an item.
  assert.ok(bedroomA.objects.length > 0 && bedroomB.objects.length > 0);
  const items = await import('../lib/items');
  assert.equal('itemsFromScan' in items, false);
});

test('rotating clockwise turns the front from south to west, seen from above', () => {
  const f = (r: number) => ({ x: Math.round(frontOf(r).x), z: Math.round(frontOf(r).z) });
  assert.deepEqual(f(0), { x: -0, z: 1 }); // front toward +z: south on the plan
  assert.deepEqual(f(Math.PI / 2), { x: -1, z: 0 }); // a quarter turn clockwise: west
  assert.deepEqual(f(Math.PI), { x: -0, z: -1 }); // north
});

test('new items start against a wall, facing into the room; wall cabinets hang', () => {
  const room = square(4000, 3000);
  const cab = specById('KF06')!;
  const at = freeSpot(room, cab, [])!;
  const back = outline(cab.size, at.center, at.rotation).map((p) => p.z);
  assert.equal(Math.round(Math.min(...back)), WALL_GAP, 'back flush on the longest wall');
  assert.ok(frontOf(at.rotation).z > 0.99, 'facing into the room');
  const hung = specById('KH04')!;
  assert.equal(hung.size.elevation, 1450);
  const spot = freeSpot(room, hung, [itemFromSpec(cab, 1, 'r', at)])!;
  assert.ok(containsPoint(room.polygon, spot.center) && fitsAt(room, hung.size, spot.center, spot.rotation, []));
});

test('a finish can go on every item of the same kind, and not the others', () => {
  const [w05, w06, kf01] = ['W05', 'W06', 'KF01'].map((id) => itemFromSpec(specById(id)!, 1, 'r', { center: { x: 0, z: 0 }, rotation: 0 }));
  assert.ok(sameFamily(w05, w06), 'two wardrobes');
  assert.ok(!sameFamily(w05, kf01), 'a wardrobe and a base cabinet');
});

test('released near a wall and parallel to it, an item snaps flush; otherwise it stays put', () => {
  const room = square(4000, 3000);
  const size = specById('KF01')!.size;
  const r = 0; // front toward +z: back to the north wall (z = 0)
  const flush = WALL_GAP + size.depth / 2;
  const near = { x: 2000, z: flush + 80 }; // 80 mm off the wall
  assert.deepEqual(snapToWall(room, size, near, r), { x: 2000, z: flush });
  const far = { x: 2000, z: flush + 400 };
  assert.deepEqual(snapToWall(room, size, far, r), far, 'too far to snap');
  assert.deepEqual(snapToWall(room, size, near, Math.PI / 4), near, 'not parallel');
});

test('dropping one item on another swaps them', () => {
  // A wardrobe on the north wall and a side cabinet on the south wall of a 4 m × 3 m room.
  const room = square(4000, 3000);
  const wardrobe = itemFromSpec(specById('W05')!, 1, 'r', { center: { x: 1000, z: 302 }, rotation: 0 });
  const side = itemFromSpec(specById('W02')!, 2, 'r', { center: { x: 3000, z: 2698 }, rotation: Math.PI });
  const items = [wardrobe, side];
  // The side cabinet dragged onto the wardrobe.
  assert.deepEqual(overlapping(side.size, wardrobe.center, side.rotation, others(items, side)).map((i) => i.uid), [wardrobe.uid]);
  const swap = swapPlaces(room, side, { center: side.center, rotation: side.rotation }, wardrobe, [])!;
  assert.ok(swap, 'they swap');
  // Each takes the other's place and turn, and both fit together.
  assert.deepEqual(swap.a, { center: wardrobe.center, rotation: wardrobe.rotation });
  assert.deepEqual(swap.b, { center: side.center, rotation: side.rotation });
  const sideNow = { ...side, ...swap.a }, wardrobeNow = { ...wardrobe, ...swap.b };
  assert.ok(fitsAt(room, side.size, sideNow.center, sideNow.rotation, [wardrobeNow]));
  assert.ok(fitsAt(room, wardrobe.size, wardrobeNow.center, wardrobeNow.rotation, [sideNow]));
});

test('a swap settles items of different sizes around each other', () => {
  // A 3 m × 1 m room: a chair-sized box at the left end, a sofa-sized one on the right. Swapped, the big one
  // shifts right enough to clear the left wall and the small one tucks in beyond it.
  const room = square(3000, 1000);
  const small = itemFromSpec(chair, 1, 'r', { center: { x: 300, z: 500 }, rotation: 0 });
  const big = itemFromSpec(sofa, 2, 'r', { center: { x: 1900, z: 500 }, rotation: 0 });
  const swap = swapPlaces(room, small, { center: small.center, rotation: 0 }, big, [])!;
  assert.ok(swap && swap.b.center.x < swap.a.center.x, 'the big one is now left of the small one');
  assert.ok(fitsAt(room, big.size, swap.b.center, swap.b.rotation, [{ ...small, ...swap.a }]));
});

test('with free placement, a cramped swap still works (items may overlap)', () => {
  // A 5 m corridor: a small box at the left end, another 1.1 m along, a big one at the right end.
  // With the old rules the big one couldn't fit near the first; now only the walls matter.
  const room = square(5000, 1000);
  const a = itemFromSpec(chair, 1, 'r', { center: { x: 300, z: 500 }, rotation: 0 });
  const b = itemFromSpec(chair, 2, 'r', { center: { x: 1400, z: 500 }, rotation: 0 });
  const big = itemFromSpec(sofa, 3, 'r', { center: { x: 3900, z: 500 }, rotation: 0 });
  for (const [i, rest] of [[a, [b, big]], [b, [a, big]], [big, [a, b]]] as const) {
    assert.ok(fitsAt(room, i.size, i.center, 0, [...rest]), `${i.name} fits to start with`);
  }
  const swap = swapPlaces(room, a, { center: a.center, rotation: 0 }, big, [b])!;
  assert.ok(swap, 'the swap goes ahead');
  assert.ok(fitsAt(room, big.size, swap.b.center, swap.b.rotation, []), 'the big one is still inside the room');
});

test('with free placement, an item may sit in a door swing; the room boundary still holds', () => {
  const walls = wallFrames(bedroomB.polygon);
  // Just inside the hallway door (west wall, z 4400–5250), in its swing: allowed for now.
  assert.ok(fitsAt(bedroomB, chair.size, { x: 1500, z: 4800 }, 0, []));
  // Through the wall: never.
  assert.ok(!fitsAt(bedroomB, chair.size, { x: -200, z: 4800 }, 0, []));
  assert.ok(walls.length === 4);
});
