/**
 * Find a free spot for a module against a room's walls.
 *
 * A module stands with its back to a wall. A spot is free when its footprint is
 * inside the room (so it can't poke through a corner of an L-shaped room) and
 * it doesn't clash, at the same height, with another module, scanned furniture,
 * a door's swing, an archway, or a window. So a base cabinet fits under a
 * window and a wall cabinet above a base cabinet, but a tall unit fits neither.
 *
 * Pure geometry in millimetres; no Three.js.
 */
import type { RoomScan, Vec2 } from '@mozu/scan-sdk';
import { containsPoint, openingRect, pointOnWall, wallFrames, type WallFrame } from './walls';

export interface Size {
  width: number;
  depth: number;
  height: number;
  elevation: number;
}

export interface WallSpot {
  wall: number;
  /** Left edge of the module, mm along the wall from its start. */
  u: number;
}

export interface PlacedFootprint extends Size, WallSpot {}

export interface Obstacle {
  outline: Vec2[];
  bottom: number;
  top: number;
}

/** Search step along each wall (mm). */
const STEP = 10;
/** Depth kept clear in front of a window or archway (mm). */
const OPENING_CLEARANCE = 100;
const ARCHWAY_CLEARANCE = 600;

/** The module's floor outline when it stands at `spot`, back `inset` mm off the wall. */
export function footprint(wall: WallFrame, u: number, width: number, depth: number, inset: number): Vec2[] {
  return [
    pointOnWall(wall, u, inset),
    pointOnWall(wall, u + width, inset),
    pointOnWall(wall, u + width, inset + depth),
    pointOnWall(wall, u, inset + depth),
  ];
}

/** Separating-axis test for two convex outlines; touching doesn't count as overlapping. */
export function convexOverlap(a: Vec2[], b: Vec2[], tolerance = 1): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = -(q.z - p.z), nz = q.x - p.x;
      const len = Math.hypot(nx, nz) || 1;
      const project = (pts: Vec2[]) => pts.map((v) => (v.x * nx + v.z * nz) / len);
      const pa = project(a), pb = project(b);
      if (Math.max(...pa) - tolerance <= Math.min(...pb) || Math.max(...pb) - tolerance <= Math.min(...pa)) return false;
    }
  }
  return true;
}

/** Inside the room: every corner inside, and no room corner poking into the outline. */
function insideRoom(outline: Vec2[], polygon: Vec2[]): boolean {
  const c = outline.reduce((s, p) => ({ x: s.x + p.x / outline.length, z: s.z + p.z / outline.length }), { x: 0, z: 0 });
  // Test points pulled 1 mm toward the middle, so an outline flush with a wall passes.
  const pulled = outline.map((p) => {
    const dx = c.x - p.x, dz = c.z - p.z, len = Math.hypot(dx, dz) || 1;
    return { x: p.x + dx / len, z: p.z + dz / len };
  });
  if (!pulled.every((p) => containsPoint(polygon, p))) return false;
  return !polygon.some((v) => convexContains(pulled, v));
}

function convexContains(poly: Vec2[], p: Vec2): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    if (Math.abs(cross) < 1e-6) return false; // on an edge: not strictly inside
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** Everything in the room a new module mustn't clash with. */
export function obstacles(room: RoomScan, placed: PlacedFootprint[], inset: number): Obstacle[] {
  const walls = wallFrames(room.polygon);
  const out: Obstacle[] = [];
  for (const p of placed) {
    const wall = walls[p.wall];
    if (wall) out.push({ outline: footprint(wall, p.u, p.width, p.depth, inset), bottom: p.elevation, top: p.elevation + p.height });
  }
  for (const o of room.objects) {
    const c = Math.cos(o.rotation), s = Math.sin(o.rotation);
    const outline = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
      const dx = (i * o.width) / 2, dz = (j * o.depth) / 2;
      return { x: o.center.x + dx * c - dz * s, z: o.center.z + dx * s + dz * c };
    });
    const bottom = o.elevation ?? 0;
    out.push({ outline, bottom, top: bottom + (o.height ?? 800) });
  }
  for (const o of room.openings) {
    const wall = walls[o.wall];
    if (!wall) continue;
    const r = openingRect(o, wall, room.height);
    // A door needs its swing clear (a square of its width) the full height of the
    // doorway; an archway a walkway; a window just the wall in front of the glass.
    const depth = o.type === 'door' ? r.u1 - r.u0 : o.type === 'archway' ? ARCHWAY_CLEARANCE : OPENING_CLEARANCE;
    out.push({ outline: footprint(wall, r.u0, r.u1 - r.u0, depth, 0), bottom: r.v0, top: r.v1 });
  }
  return out;
}

/** Whether a floor outline, `bottom`–`top` mm high, is inside the room and clear of `blockers`. */
export function outlineFits(room: RoomScan, outline: Vec2[], bottom: number, top: number, blockers: Obstacle[]): boolean {
  if (top > room.height || !insideRoom(outline, room.polygon)) return false;
  return !blockers.some((b) => b.bottom < top - 1 && bottom < b.top - 1 && convexOverlap(outline, b.outline));
}

/** Whether a module of `size` fits at `spot`. */
export function fits(room: RoomScan, size: Size, spot: WallSpot, blockers: Obstacle[], inset: number): boolean {
  const wall = wallFrames(room.polygon)[spot.wall];
  if (!wall || spot.u < 0 || spot.u + size.width > wall.length + 0.5) return false;
  if (size.elevation + size.height > room.height) return false;
  const outline = footprint(wall, spot.u, size.width, size.depth, inset);
  if (!insideRoom(outline, room.polygon)) return false;
  const bottom = size.elevation, top = size.elevation + size.height;
  return !blockers.some((b) => b.bottom < top - 1 && bottom < b.top - 1 && convexOverlap(outline, b.outline));
}

/**
 * The first free spot against a wall, trying the longest wall first and each
 * wall from its start. `extra` adds obstacles that aren't wall-mounted modules.
 */
export function findSpot(room: RoomScan, size: Size, placed: PlacedFootprint[], inset: number, extra: Obstacle[] = []): WallSpot | null {
  const blockers = [...obstacles(room, placed, inset), ...extra];
  const walls = wallFrames(room.polygon).filter((w) => w.length >= size.width).sort((a, b) => b.length - a.length);
  for (const wall of walls) {
    const last = wall.length - size.width;
    for (let u = 0; u <= last + 0.001; u = u + STEP > last && u < last ? last : u + STEP) {
      const spot = { wall: wall.index, u };
      if (fits(room, size, spot, blockers, inset)) return spot;
    }
  }
  return null;
}

/** Every wall, nearest a floor point first, with how far along each the point falls (mm from its start). */
export function wallsByDistance(room: RoomScan, point: Vec2): { wall: number; along: number; distance: number }[] {
  return wallFrames(room.polygon)
    .filter((w) => w.length >= 1)
    .map((w) => {
      const rel = { x: point.x - w.start.x, z: point.z - w.start.z };
      const along = Math.max(0, Math.min(w.length, rel.x * w.dir.x + rel.z * w.dir.z));
      const foot = pointOnWall(w, along);
      return { wall: w.index, along, distance: Math.hypot(point.x - foot.x, point.z - foot.z) };
    })
    .sort((a, b) => a.distance - b.distance);
}

/**
 * The position on `wall` closest to `desired` (the module's left edge) where it
 * fits, searching up to `maxShift` mm either way (default: the whole wall); null
 * if it fits nowhere on that wall. This is what makes dragging slide up against
 * an obstacle instead of stopping.
 */
export function nearestFit(
  room: RoomScan, size: Size, wall: number, desired: number, blockers: Obstacle[], inset: number, maxShift = Infinity,
): number | null {
  const frame = wallFrames(room.polygon)[wall];
  if (!frame || frame.length < size.width) return null;
  const last = frame.length - size.width;
  const start = Math.max(0, Math.min(last, desired));
  const reach = Math.min(maxShift, Math.max(start, last - start));
  for (let d = 0; d <= reach + STEP; d += STEP) {
    // Clamped rather than skipped, so a position flush with either end is tried too.
    for (const u of d === 0 ? [start] : [Math.max(0, start - d), Math.min(last, start + d)]) {
      if (fits(room, size, { wall, u }, blockers, inset)) return u;
    }
  }
  return null;
}

