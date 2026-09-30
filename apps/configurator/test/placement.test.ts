import test from 'node:test';
import assert from 'node:assert/strict';
import { convexOverlap, findSpot, fits, footprint, nearestFit, obstacles, wallsByDistance, type PlacedFootprint } from '../lib/placement';
import { wallFrames } from '../lib/walls';
import { MODULES, moduleById } from '../lib/modules';
import { twoBedroom } from './fixtures';

const INSET = 12;
const [, bedroomA, bedroomB] = twoBedroom().rooms;
const size = (id: string) => moduleById(id)!;

test('filling the L-shaped room: no clashes, door swing and window kept clear, then "no space"', () => {
  const placed: PlacedFootprint[] = [];
  const order = ['base-900-doors', 'base-900-doors', 'wall-900-doors', 'wall-900-doors', 'tall-600-pantry', 'wardrobe-900-doors'];
  for (let i = 0; i < 20; i++) order.push('base-900-doors');
  let none = 0;
  for (const id of order) {
    const spot = findSpot(bedroomA, size(id), placed, INSET);
    if (spot) placed.push({ ...size(id), ...spot });
    else none++;
  }
  assert.ok(placed.length >= 6, `placed ${placed.length}`);
  assert.ok(none > 0, 'the room should eventually be full');
  const walls = wallFrames(bedroomA.polygon);
  placed.forEach((p, i) => {
    const others = placed.filter((_, j) => j !== i);
    assert.ok(fits(bedroomA, p, p, obstacles(bedroomA, others, INSET), INSET), `placement ${i} clashes`);
  });
  const outline = (p: PlacedFootprint) => footprint(walls[p.wall], p.u, p.width, p.depth, INSET);
  const swing = footprint(walls[5], 1150, 850, 850, 0);
  assert.ok(!placed.some((p) => p.elevation < 2050 && convexOverlap(outline(p), swing)), 'something is in the door swing');
  const glass = footprint(walls[1], 400, 1200, 100, 0);
  assert.ok(!placed.some((p) => p.elevation + p.height > 900 && p.elevation < 2000 && convexOverlap(outline(p), glass)), 'something covers the window');
});

test('a wall cabinet can hang above a base cabinet, a tall unit cannot', () => {
  const base = size('base-900-doors');
  const spot = findSpot(bedroomB, base, [], INSET)!;
  const placed = [{ ...base, ...spot }];
  const blockers = obstacles(bedroomB, placed, INSET);
  assert.ok(fits(bedroomB, size('wall-900-doors'), spot, blockers, INSET));
  assert.ok(!fits(bedroomB, { ...size('tall-600-pantry') }, spot, blockers, INSET));
});

test('nothing fits that is wider than every wall', () => {
  assert.equal(findSpot(bedroomA, { width: 5000, depth: 580, height: 870, elevation: 0 }, [], INSET), null);
});

test('dragging snaps to the nearest free stretch of the wall', () => {
  const drawer = size('base-600-drawers');
  const blockers = obstacles(bedroomB, [], INSET);
  // East wall: the window (800–2200, sill 850) blocks an 870 mm base unit and the desk blocks the far end,
  // so the only room for a 600 mm unit is 0–800: flush against the window at u = 200.
  for (const dropped of [0, 840, 2000, 2200]) assert.equal(nearestFit(bedroomB, drawer, 1, dropped, blockers, INSET), dropped === 0 ? 0 : 200);
  assert.equal(nearestFit(bedroomB, drawer, 1, 840, blockers, INSET, 300), null, 'a limited search that reaches nothing');
});

test('walls are ordered by distance from the cursor', () => {
  const near = wallsByDistance(bedroomB, { x: 4210, z: 4490 });
  assert.deepEqual(near.slice(0, 2).map((w) => w.wall), [1, 0]);
  assert.ok(near.every((w, i) => i === 0 || near[i - 1].distance <= w.distance));
});

test('every sample module fits in an empty room it is sized for', () => {
  const big = { ...bedroomB, objects: [], openings: [], height: 2500 };
  for (const m of MODULES) assert.ok(findSpot(big, m, [], INSET), m.id);
});

test("a cabinet opposite a door can't stand in the door's swing", () => {
  const hallway = twoBedroom().rooms[0];
  // The 1.2 m hallway: the door to Bedroom A (east wall, z 1200–2050) swings to within 350 mm of the west
  // wall, so a 580 mm deep base unit on the west wall opposite it would block the door.
  const base = size('base-450-door');
  const blockers = obstacles(hallway, [], INSET);
  const west = 3; // runs (0, 6000) → (0, 0), so u = 6000 − z
  assert.ok(!fits(hallway, base, { wall: west, u: 6000 - 1850 }, blockers, INSET), 'opposite the door');
  assert.ok(fits(hallway, base, { wall: west, u: 6000 - 3000 }, blockers, INSET), 'further along the hallway');
});
