/**
 * Pure geometry for the viewer: where each wall runs, which way is into the
 * room, and how a wall splits into solid pieces around its openings.
 * Millimetres throughout; no Three.js, so it can be tested on its own.
 */
import type { ScanOpening, Vec2 } from '@mozu/scan-sdk';

export interface WallFrame {
  index: number;
  start: Vec2;
  end: Vec2;
  length: number;
  /** Unit vector from `start` to `end`. `offset` in the scan is measured along this. */
  dir: Vec2;
  /** Unit normal pointing into the room. */
  inward: Vec2;
}

/** A rectangle on a wall: `u` along the wall from its start, `v` up from the floor. */
export interface WallRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export const DEFAULT_WINDOW_SILL = 900;

/** Twice the signed area; positive when the corners run counter-clockwise in x/z. */
export function signedArea2(polygon: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum;
}

/** Wall i runs polygon[i] → polygon[i + 1]; works for either winding and concave rooms. */
export function wallFrames(polygon: Vec2[]): WallFrame[] {
  const turn = signedArea2(polygon) >= 0 ? 1 : -1;
  return polygon.map((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    const dir = length > 0 ? { x: dx / length, z: dz / length } : { x: 1, z: 0 };
    // The interior is on the left of each edge for a counter-clockwise polygon.
    const inward = { x: -dir.z * turn, z: dir.x * turn };
    return { index, start, end, length, dir, inward };
  });
}

/** Point `u` mm along the wall, pushed `inset` mm into the room. */
export function pointOnWall(wall: WallFrame, u: number, inset = 0): Vec2 {
  return {
    x: wall.start.x + wall.dir.x * u + wall.inward.x * inset,
    z: wall.start.z + wall.dir.z * u + wall.inward.z * inset,
  };
}

/** Where an opening sits on its wall, clamped to the wall and the room height. */
export function openingRect(opening: ScanOpening, wall: WallFrame, roomHeight: number): WallRect {
  const u0 = Math.max(0, Math.min(wall.length, opening.offset));
  const u1 = Math.max(u0, Math.min(wall.length, opening.offset + opening.width));
  const sill = opening.sill ?? (opening.type === 'window' ? DEFAULT_WINDOW_SILL : 0);
  const v0 = Math.max(0, Math.min(roomHeight, sill));
  const v1 = Math.max(v0, Math.min(roomHeight, v0 + opening.height));
  return { u0, u1, v0, v1 };
}

/**
 * The solid parts of a wall once its openings are cut out: full-height pieces
 * between openings, plus the lintel above and (for windows) the wall below each
 * one. Overlapping openings merge into one gap.
 */
export function solidPieces(length: number, height: number, holes: WallRect[]): WallRect[] {
  const sorted = [...holes].filter((h) => h.u1 > h.u0 && h.v1 > h.v0).sort((a, b) => a.u0 - b.u0);
  const pieces: WallRect[] = [];
  let cursor = 0;
  for (const h of sorted) {
    const u0 = Math.max(h.u0, cursor);
    if (u0 > cursor) pieces.push({ u0: cursor, u1: u0, v0: 0, v1: height });
    if (h.u1 <= u0) continue; // fully covered by an earlier opening
    if (h.v0 > 0) pieces.push({ u0, u1: h.u1, v0: 0, v1: h.v0 });
    if (h.v1 < height) pieces.push({ u0, u1: h.u1, v0: h.v1, v1: height });
    cursor = h.u1;
  }
  if (cursor < length) pieces.push({ u0: cursor, u1: length, v0: 0, v1: height });
  return pieces;
}

/** Area centroid of a simple polygon; the corner average if the area is ~0. */
export function centroid(polygon: Vec2[]): Vec2 {
  const a2 = signedArea2(polygon);
  if (Math.abs(a2) < 1e-6) {
    const n = polygon.length || 1;
    return { x: polygon.reduce((s, p) => s + p.x, 0) / n, z: polygon.reduce((s, p) => s + p.z, 0) / n };
  }
  let cx = 0, cz = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const k = a.x * b.z - b.x * a.z;
    cx += (a.x + b.x) * k;
    cz += (a.z + b.z) * k;
  }
  return { x: cx / (3 * a2), z: cz / (3 * a2) };
}

/** Even-odd point-in-polygon test. */
export function containsPoint(polygon: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Somewhere inside the room to put its name. The centroid, unless the room is
 * concave enough that the centroid falls outside it; then the middle of the
 * widest inside run across the room at the centroid's depth.
 */
export function labelPoint(polygon: Vec2[]): Vec2 {
  const c = centroid(polygon);
  if (containsPoint(polygon, c)) return c;
  const xs: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((a.z > c.z) !== (b.z > c.z)) xs.push(a.x + ((c.z - a.z) * (b.x - a.x)) / (b.z - a.z));
  }
  xs.sort((p, q) => p - q);
  let best = { x: c.x, width: -1 };
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > best.width) best = { x: (xs[i] + xs[i + 1]) / 2, width: xs[i + 1] - xs[i] };
  }
  return { x: best.x, z: c.z };
}
