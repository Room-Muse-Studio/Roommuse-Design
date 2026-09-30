import test from 'node:test';
import assert from 'node:assert/strict';
import { containsPoint, labelPoint, openingRect, pointOnWall, solidPieces, wallFrames } from '../lib/walls';
import { twoBedroom } from './fixtures';

const rooms = twoBedroom().rooms;

test('every wall faces into its room, for either winding and the L-shaped room', () => {
  for (const room of rooms) {
    for (const polygon of [room.polygon, [...room.polygon].reverse()]) {
      for (const w of wallFrames(polygon)) {
        assert.ok(containsPoint(polygon, pointOnWall(w, w.length / 2, 50)), `${room.name} wall ${w.index}`);
      }
    }
  }
});

test('solid pieces and openings add up to the whole wall', () => {
  for (const room of rooms) {
    for (const w of wallFrames(room.polygon)) {
      const holes = room.openings.filter((o) => o.wall === w.index).map((o) => openingRect(o, w, room.height));
      const area = (rs: { u0: number; u1: number; v0: number; v1: number }[]) => rs.reduce((s, r) => s + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
      assert.equal(Math.round(area(solidPieces(w.length, room.height, holes)) + area(holes)), Math.round(w.length * room.height), `${room.name} wall ${w.index}`);
    }
  }
});

test('a window keeps the wall below its sill; a door does not', () => {
  const a = rooms[1];
  const walls = wallFrames(a.polygon);
  const windowWall = walls[1], doorWall = walls[5];
  const windowPieces = solidPieces(windowWall.length, a.height, a.openings.filter((o) => o.wall === 1).map((o) => openingRect(o, windowWall, a.height)));
  assert.ok(windowPieces.some((p) => p.v0 === 0 && p.v1 === 900 && p.u0 === 400 && p.u1 === 1600));
  const doorPieces = solidPieces(doorWall.length, a.height, a.openings.filter((o) => o.wall === 5).map((o) => openingRect(o, doorWall, a.height)));
  assert.ok(!doorPieces.some((p) => p.u0 >= 1150 && p.u1 <= 2000 && p.v0 === 0));
});

test('room names go somewhere inside the room', () => {
  for (const room of rooms) assert.ok(containsPoint(room.polygon, labelPoint(room.polygon)), room.name);
  // A U-shaped room whose centroid falls outside it.
  const u = [{ x: 0, z: 0 }, { x: 3000, z: 0 }, { x: 3000, z: 3000 }, { x: 2000, z: 3000 }, { x: 2000, z: 1000 }, { x: 1000, z: 1000 }, { x: 1000, z: 3000 }, { x: 0, z: 3000 }];
  assert.ok(containsPoint(u, labelPoint(u)));
});
