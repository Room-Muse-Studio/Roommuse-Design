/**
 * Work out which walls and openings two rooms share, from geometry alone.
 *
 * Each room is scanned on its own, so nothing in a scan says that the door in
 * the hallway is the same door as the one in the bedroom. When all rooms share
 * one coordinate space (a {@link HomeScan}), the geometry does say it: the two
 * walls run along the same line, facing away from each other, and the two
 * openings sit in the same stretch of it. This turns that into
 * {@link RoomConnection} records.
 *
 * Pure and dependency-free.
 */
import type { RoomConnection, RoomScan, ScanOpening, Vec2 } from './types';

export interface FindConnectionsOptions {
  /**
   * How far apart the two faces of one wall may be (millimetres). A scan
   * measures each room's inside surface, so the faces are a wall's thickness
   * apart, typically 70–250 mm. Default 300.
   */
  maxGapMm?: number;
  /** How much of their length two walls must share (millimetres). Default 100. */
  minOverlapMm?: number;
  /** How far from parallel two walls may be (degrees). Default 3. */
  maxAngleDeg?: number;
  /** Share of the narrower opening's width two openings must overlap by. Default 0.5. */
  minOpeningOverlap?: number;
}

interface Wall {
  index: number;
  start: Vec2;
  length: number;
  dir: Vec2;
  /** Unit normal pointing into the room. */
  inward: Vec2;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
const cross = (a: Vec2, b: Vec2) => a.x * b.z - a.z * b.x;
const along = (w: Wall, t: number): Vec2 => ({ x: w.start.x + w.dir.x * t, z: w.start.z + w.dir.z * t });

function walls(polygon: Vec2[]): Wall[] {
  let area2 = 0;
  for (let i = 0; i < polygon.length; i++) area2 += cross(polygon[i], polygon[(i + 1) % polygon.length]);
  const turn = area2 >= 0 ? 1 : -1; // interior is on the left of a counter-clockwise edge
  return polygon.map((start, index) => {
    const d = sub(polygon[(index + 1) % polygon.length], start);
    const length = Math.hypot(d.x, d.z);
    const dir = length > 0 ? { x: d.x / length, z: d.z / length } : { x: 1, z: 0 };
    return { index, start, length, dir, inward: { x: -dir.z * turn, z: dir.x * turn } };
  });
}

/** An opening's span on wall `w`, as distances along `axis` from its start. */
function spanOn(axis: Wall, w: Wall, o: ScanOpening): [number, number] {
  const a = dot(sub(along(w, o.offset), axis.start), axis.dir);
  const b = dot(sub(along(w, o.offset + o.width), axis.start), axis.dir);
  return a < b ? [a, b] : [b, a];
}

const overlap = (a: [number, number], b: [number, number]) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

/**
 * Walls and openings shared between rooms. Rooms without an `id`, and openings
 * without an `id`, can't be referred to and are skipped. Each opening is matched
 * to at most one other.
 */
export function findConnections(rooms: RoomScan[], options: FindConnectionsOptions = {}): RoomConnection[] {
  const maxGap = options.maxGapMm ?? 300;
  const minOverlap = options.minOverlapMm ?? 100;
  const maxSin = Math.sin(((options.maxAngleDeg ?? 3) * Math.PI) / 180);
  const minOpening = options.minOpeningOverlap ?? 0.5;

  const named = rooms.filter((r) => r.id);
  const wallsOf = new Map(named.map((r) => [r, walls(r.polygon)]));
  const out: RoomConnection[] = [];
  const usedOpenings = new Set<string>();

  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const A = named[i], B = named[j];
      for (const wa of wallsOf.get(A)!) {
        if (wa.length < 1) continue;
        for (const wb of wallsOf.get(B)!) {
          if (wb.length < 1) continue;
          if (Math.abs(cross(wa.dir, wb.dir)) > maxSin) continue; // not parallel
          if (dot(wa.inward, wb.inward) > -0.9) continue; // must face away from each other
          // B's wall must sit behind A's, within a wall's thickness (a little slack for scan noise).
          const behind = -dot(sub(wb.start, wa.start), wa.inward);
          if (behind < -20 || behind > maxGap) continue;
          const tb: [number, number] = [dot(sub(wb.start, wa.start), wa.dir), dot(sub(along(wb, wb.length), wa.start), wa.dir)];
          const shared = overlap([0, wa.length], tb[0] < tb[1] ? tb : [tb[1], tb[0]]);
          if (shared < minOverlap) continue;

          out.push({ type: 'wall', a: { room: A.id!, wall: wa.index }, b: { room: B.id!, wall: wb.index } });

          // Openings: same kind, same stretch of the shared wall.
          for (const oa of A.openings.filter((o) => o.wall === wa.index && o.id)) {
            const key = `${A.id} ${oa.id}`;
            if (usedOpenings.has(key)) continue;
            const sa = spanOn(wa, wa, oa);
            let best: { o: ScanOpening; share: number } | null = null;
            for (const ob of B.openings.filter((o) => o.wall === wb.index && o.id && o.type === oa.type)) {
              if (usedOpenings.has(`${B.id} ${ob.id}`)) continue;
              const sb = spanOn(wa, wb, ob);
              const share = overlap(sa, sb) / Math.max(1, Math.min(oa.width, ob.width));
              if (share >= minOpening && (!best || share > best.share)) best = { o: ob, share };
            }
            if (!best) continue;
            usedOpenings.add(key);
            usedOpenings.add(`${B.id} ${best.o.id}`);
            out.push({ type: 'opening', a: { room: A.id!, opening: oa.id! }, b: { room: B.id!, opening: best.o.id! } });
          }
        }
      }
    }
  }
  return out;
}
