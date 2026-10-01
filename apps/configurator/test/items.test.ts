import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomScan } from '@mozu/scan-sdk';
import {
  fitsAt, freeSpot, frontOf, itemFromSpec, itemsFromScan, outline, overlapping, snapToWall, specById, swapPlaces, WALL_GAP,
  type Item,
} from '../lib/items';
import { containsPoint, wallFrames } from '../lib/walls';
import { twoBedroom } from './fixtures';

const [, bedroomA, bedroomB] = twoBedroom().rooms;
const others = (items: Item[], me: Item) => items.filter((i) => i !== me);
const square = (w: number, d: number): RoomScan => ({
  schema: 'mozu.roomscan/1', polygon: [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }],
  height: 2500, openings: [], objects: [], fixtures: [], source: 'manual', unitSystem: 'metric', confidence: 1, capturedAt: '',
});

test('the scan’s furniture becomes items like everything else', () => {
  const items = itemsFromScan('a', bedroomA, 1);
  assert.deepEqual(items.map((i) => `${i.uid}:${i.name}:${i.builder.kind === 'furniture' ? i.builder.type : ''}`),
    ['1:Storage:storage', '2:Storage:storage', '3:Bed:bed']);
  assert.ok(items.every((i) => i.fromScan));
  assert.deepEqual(items[1].size, { width: 900, depth: 250, height: 300, elevation: 1500 }, 'the wall shelf keeps its height off the floor');
  // Everything fits where it was scanned. (The fixture's wardrobe stands 200 mm in front of the
  // window; with FREE_PLACEMENT on, window clearance isn't enforced, so it fits too.)
  for (const i of items) assert.ok(fitsAt(bedroomA, i.size, i.center, i.rotation, others(items, i)), i.name);
});

test('scanned beds and storage stand with their backs to the nearer wall', () => {
  const b = itemsFromScan('b', bedroomB, 1).find((i) => i.name === 'Bed')!;
  // Bedroom B's bed runs z 4100–6000 against the south wall (z = 6000): the headboard (its back) goes there.
  assert.ok(frontOf(b.rotation).z < -0.99, 'bed faces north, away from the south wall');
  const wardrobe = itemsFromScan('a', bedroomA, 1)[0]; // x 3600–4800, z 0–600, against the north wall
  assert.ok(frontOf(wardrobe.rotation).z > 0.99, 'wardrobe faces south, into the room');
  const desk = itemsFromScan('b', bedroomB, 1).find((i) => i.name === 'Table')!;
  assert.equal(desk.rotation, bedroomB.objects.find((o) => o.id === 'obj-b-desk')!.rotation, 'tables keep the scanned rotation');
});

test('rotating clockwise turns the front from south to west, seen from above', () => {
  const f = (r: number) => ({ x: Math.round(frontOf(r).x), z: Math.round(frontOf(r).z) });
  assert.deepEqual(f(0), { x: -0, z: 1 }); // front toward +z: south on the plan
  assert.deepEqual(f(Math.PI / 2), { x: -1, z: 0 }); // a quarter turn clockwise: west
  assert.deepEqual(f(Math.PI), { x: -0, z: -1 }); // north
});

test('new cabinets start against a wall; new furniture in open floor', () => {
  const room = square(4000, 3000);
  const cab = specById('base-900-doors')!;
  const at = freeSpot(room, cab, [])!;
  const back = outline(cab.size, at.center, at.rotation).map((p) => p.z);
  assert.equal(Math.round(Math.min(...back)), WALL_GAP, 'back flush on the longest wall');
  assert.deepEqual(frontOf(at.rotation).z > 0.99, true, 'facing into the room');
  const bed = specById('bed-double')!;
  const spot = freeSpot(room, bed, [])!;
  assert.ok(containsPoint(room.polygon, spot.center) && fitsAt(room, bed.size, spot.center, spot.rotation, []));
});

test('released near a wall and parallel to it, an item snaps flush; otherwise it stays put', () => {
  const room = square(4000, 3000);
  const size = specById('base-600-drawers')!.size;
  const r = 0; // front toward +z: back to the north wall (z = 0)
  const flush = WALL_GAP + size.depth / 2;
  const near = { x: 2000, z: flush + 80 }; // 80 mm off the wall
  assert.deepEqual(snapToWall(room, size, near, r), { x: 2000, z: flush });
  const far = { x: 2000, z: flush + 400 };
  assert.deepEqual(snapToWall(room, size, far, r), far, 'too far to snap');
  assert.deepEqual(snapToWall(room, size, near, Math.PI / 4), near, 'not parallel');
});

test('dropping one item on another swaps them', () => {
  const items = itemsFromScan('b', bedroomB, 1);
  const bed = items.find((i) => i.name === 'Bed')!, desk = items.find((i) => i.name === 'Table')!;
  // The desk dragged onto the bed.
  assert.deepEqual(overlapping(desk.size, bed.center, desk.rotation, others(items, desk)).map((i) => i.uid), [bed.uid]);
  const swap = swapPlaces(bedroomB, desk, { center: desk.center, rotation: desk.rotation }, bed, [])!;
  assert.ok(swap, 'they swap');
  // Each ends up near the other's old place (the bed, 900 mm longer, settles up to 1.3 m from the
  // desk's corner spot), and both fit together.
  const reach = 400 + Math.abs(Math.max(bed.size.width, bed.size.depth) - Math.max(desk.size.width, desk.size.depth));
  assert.ok(Math.hypot(swap.a.center.x - bed.center.x, swap.a.center.z - bed.center.z) <= reach);
  assert.ok(Math.hypot(swap.b.center.x - desk.center.x, swap.b.center.z - desk.center.z) <= reach);
  assert.ok(Math.hypot(swap.b.center.x - desk.center.x, swap.b.center.z - desk.center.z) < Math.hypot(bed.center.x - desk.center.x, bed.center.z - desk.center.z), 'the bed moved toward the desk’s old place');
  const deskNow = { ...desk, ...swap.a }, bedNow = { ...bed, ...swap.b };
  assert.ok(fitsAt(bedroomB, desk.size, deskNow.center, deskNow.rotation, [bedNow]));
  assert.ok(fitsAt(bedroomB, bed.size, bedNow.center, bedNow.rotation, [deskNow]));
});

test('a swap settles items of different sizes around each other', () => {
  // A 3 m × 1 m room: a chair at the left end, a sofa on the right. Swapped, the sofa shifts
  // right enough to clear the left wall and the chair tucks in beyond it.
  const room = square(3000, 1000);
  const chair = itemFromSpec(specById('chair')!, 1, 'r', { center: { x: 300, z: 500 }, rotation: 0 });
  const sofa = itemFromSpec(specById('sofa-3')!, 2, 'r', { center: { x: 1900, z: 500 }, rotation: 0 });
  const swap = swapPlaces(room, chair, { center: chair.center, rotation: 0 }, sofa, [])!;
  assert.ok(swap && swap.b.center.x < swap.a.center.x, 'the sofa is now left of the chair');
  assert.ok(fitsAt(room, sofa.size, swap.b.center, swap.b.rotation, [{ ...chair, ...swap.a }]));
});

test('with free placement, a cramped swap still works (items may overlap)', () => {
  // A 5 m corridor: a chair at the left end, another chair 1.1 m along, a sofa at the right end.
  // With the old rules the sofa couldn't fit near the first chair; now only the walls matter.
  const room = square(5000, 1000);
  const chairA = itemFromSpec(specById('chair')!, 1, 'r', { center: { x: 300, z: 500 }, rotation: 0 });
  const chairB = itemFromSpec(specById('chair')!, 2, 'r', { center: { x: 1400, z: 500 }, rotation: 0 });
  const sofa = itemFromSpec(specById('sofa-3')!, 3, 'r', { center: { x: 3900, z: 500 }, rotation: 0 });
  for (const [i, rest] of [[chairA, [chairB, sofa]], [chairB, [chairA, sofa]], [sofa, [chairA, chairB]]] as const) {
    assert.ok(fitsAt(room, i.size, i.center, 0, [...rest]), `${i.name} fits to start with`);
  }
  const swap = swapPlaces(room, chairA, { center: chairA.center, rotation: 0 }, sofa, [chairB])!;
  assert.ok(swap, 'the swap goes ahead');
  assert.ok(fitsAt(room, sofa.size, swap.b.center, swap.b.rotation, []), 'the sofa is still inside the room');
});

test('with free placement, an item may sit in a door swing; the room boundary still holds', () => {
  const walls = wallFrames(bedroomB.polygon);
  const chair = specById('chair')!;
  // Just inside the hallway door (west wall, z 4400–5250), in its swing: allowed for now.
  assert.ok(fitsAt(bedroomB, chair.size, { x: 1500, z: 4800 }, 0, []));
  // Through the wall: never.
  assert.ok(!fitsAt(bedroomB, chair.size, { x: -200, z: 4800 }, 0, []));
  assert.ok(walls.length === 4);
});
