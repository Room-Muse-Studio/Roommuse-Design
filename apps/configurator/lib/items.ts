/**
 * Everything that stands in a room is one kind of thing: an Item, a MOZU model
 * (lib/models.ts) with a footprint centre and rotation (free on the floor, not
 * tied to a wall), a size, and a finish. Items from the library and items the
 * scan came with can be added, removed, moved, turned and recoloured alike.
 *
 * The scan's own objects are only shown when they can be a MOZU model: storage
 * (wardrobes, cupboards, shelves) becomes the nearest model in size; beds,
 * sofas, tables, appliances and the rest are left out (lib/scanMatch.ts).
 *
 * Millimetres; rotation in radians in the scan's convention (it turns the
 * width axis from +x toward +z, which is clockwise seen from above). No Three.js.
 */
import type { RoomScan, Vec2 } from '@mozu/scan-sdk';
import { DEFAULT_FRONT, type Finish } from './finishes';
import { MODEL_GROUPS, MODEL_SPECS, modelById, type ModelGroupId, type ModelSpec } from './models';
import { convexOverlap, findSpot, obstacles, outlineFits, type Obstacle } from './placement';
import { isKitchen, matchStorage } from './scanMatch';
import { containsPoint, labelPoint, pointOnWall, wallFrames, type WallFrame } from './walls';

/**
 * A MOZU model has one finish, and that's `primary`. `secondary` stays in the
 * saved shape (every stored design and the server's checks expect both) but is
 * never shown or edited.
 */
export type Slot = 'primary' | 'secondary';

export type Builder = { kind: 'model'; modelId: string };

export interface Size {
  width: number;
  depth: number;
  height: number;
  /** Bottom above the floor: 0 for most things, 1450 for a kitchen wall cabinet. */
  elevation: number;
}

export interface Item {
  uid: number;
  roomKey: string;
  name: string;
  builder: Builder;
  size: Size;
  /** Centre of the footprint. */
  center: Vec2;
  rotation: number;
  finishes: Record<Slot, Finish>;
  /** It came with the scan (it can still be moved, recoloured or removed). */
  fromScan?: boolean;
}

/** Something the library can add. */
export interface ItemSpec {
  id: string;
  group: ModelGroupId;
  name: string;
  builder: Builder;
  size: Size;
  finishes: Record<Slot, Finish>;
}

/** Same distance the viewer insets walls by, so a flush item sits on the wall face. */
export const WALL_GAP = 12;
/** Released this close to a wall, and parallel to it, an item snaps flush. */
export const SNAP_MM = 120;

export const DEFAULT_FINISHES: Record<Slot, Finish> = { primary: DEFAULT_FRONT, secondary: DEFAULT_FRONT };

/** What the finish slots are called. */
export const slotNames = (_builder: Builder): Record<Slot, string> => ({ primary: 'Finish', secondary: 'Finish' });

/** The slots the edit menu offers: one, for a model. */
export const editableSlots = (_builder: Builder): Slot[] => ['primary'];

/** What to call a model's kind of thing, for "use on every …". */
const FAMILY_NAME: Record<ModelGroupId, string> = {
  'kitchen-base': 'base cabinet', 'kitchen-wall': 'wall cabinet', 'kitchen-tall': 'tall cabinet',
  'wardrobe-main': 'wardrobe', 'wardrobe-side': 'side cabinet',
};
export const groupOf = (i: Pick<Item, 'builder'>): ModelGroupId | undefined => modelById(i.builder.modelId)?.group;
export const familyName = (i: Pick<Item, 'builder'>) => FAMILY_NAME[groupOf(i) ?? 'kitchen-base'];
/** Items of the same kind, for a finish applied to every one of them. */
export const sameFamily = (a: Pick<Item, 'builder'>, b: Pick<Item, 'builder'>) => groupOf(a) !== undefined && groupOf(a) === groupOf(b);

export const modelSpec = (m: ModelSpec): ItemSpec => ({
  id: m.id, group: m.group, name: m.name, builder: { kind: 'model', modelId: m.id },
  size: { width: m.width, depth: m.depth, height: m.height, elevation: m.elevation },
  finishes: DEFAULT_FINISHES,
});

export const ITEM_GROUPS = MODEL_GROUPS;
export const ITEM_SPECS: ItemSpec[] = MODEL_SPECS.map(modelSpec);
export const specById = (id: string) => ITEM_SPECS.find((s) => s.id === id);

// ── geometry ────────────────────────────────────────────────────────────────

/** The item's floor outline at `center`, turned by `rotation`. */
export function outline(size: Pick<Size, 'width' | 'depth'>, center: Vec2, rotation: number): Vec2[] {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const dx = (i * size.width) / 2, dz = (j * size.depth) / 2;
    return { x: center.x + dx * c - dz * s, z: center.z + dx * s + dz * c };
  });
}

/** Unit vector the item's front faces. */
export const frontOf = (rotation: number): Vec2 => ({ x: -Math.sin(rotation), z: Math.cos(rotation) });

/** The rotation that puts an item's back to `wall`, facing into the room. */
export const facing = (wall: WallFrame) => Math.atan2(-wall.inward.x, wall.inward.z);

/** Doors (and their swing), archways and windows: what no item may cover. */
export const roomBlockers = (room: RoomScan): Obstacle[] => obstacles({ ...room, objects: [] }, [], 0);

const itemObstacle = (i: Item): Obstacle =>
  ({ outline: outline(i.size, i.center, i.rotation), bottom: i.size.elevation, top: i.size.elevation + i.size.height });

const clash = (a: Obstacle, b: Obstacle) => a.bottom < b.top - 1 && b.bottom < a.top - 1 && convexOverlap(a.outline, b.outline);

/**
 * Free placement: while on, moving, turning, duplicating and swapping only
 * require an item to stay inside the room (walls and ceiling). Door swings,
 * window and archway clearances, and overlaps with other items are not
 * enforced — the rules got in the way more than they helped. Turn off to
 * restore them; adding a new item still uses the full rules (`freeSpot`).
 */
export const FREE_PLACEMENT = true;

/** Whether an item of `size` can stand at `center`/`rotation` among `others` (items in the same room). */
export function fitsAt(room: RoomScan, size: Size, center: Vec2, rotation: number, others: Item[]): boolean {
  const blockers = FREE_PLACEMENT ? [] : [...roomBlockers(room), ...others.map(itemObstacle)];
  return outlineFits(room, outline(size, center, rotation), size.elevation, size.elevation + size.height, blockers);
}

/** Whether it would fit if the other items weren't there (walls, doors and windows only). */
export const fitsRoom = (room: RoomScan, size: Size, center: Vec2, rotation: number) => fitsAt(room, size, center, rotation, []);

/** The items it would overlap at `center`/`rotation`. */
export function overlapping(size: Size, center: Vec2, rotation: number, others: Item[]): Item[] {
  const me: Obstacle = { outline: outline(size, center, rotation), bottom: size.elevation, top: size.elevation + size.height };
  return others.filter((o) => clash(me, itemObstacle(o)));
}

/**
 * The fitting position nearest `center`, searching outward in 50 mm rings up
 * to `radius`; null if there's none. Used to settle an item into a spot that's
 * almost, but not quite, the right shape for it (after a swap, say).
 */
export function settle(room: RoomScan, size: Size, center: Vec2, rotation: number, others: Item[], radius = 600): Vec2 | null {
  if (fitsAt(room, size, center, rotation, others)) return center;
  for (let r = 50; r <= radius; r += 50) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / 50));
    for (let k = 0; k < steps; k++) {
      const t = (k / steps) * Math.PI * 2;
      const c = { x: center.x + Math.cos(t) * r, z: center.z + Math.sin(t) * r };
      if (fitsAt(room, size, c, rotation, others)) return c;
    }
  }
  return null;
}

/**
 * If the item is parallel to a wall with its back within SNAP_MM of it, the
 * centre that puts it flush against that wall; otherwise `center` unchanged.
 */
export function snapToWall(room: RoomScan, size: Size, center: Vec2, rotation: number): Vec2 {
  const front = frontOf(rotation);
  for (const wall of wallFrames(room.polygon)) {
    if (front.x * wall.inward.x + front.z * wall.inward.z < 0.995) continue; // not facing out from this wall
    const rel = { x: center.x - wall.start.x, z: center.z - wall.start.z };
    const along = rel.x * wall.dir.x + rel.z * wall.dir.z;
    if (along < -size.width / 2 || along > wall.length + size.width / 2) continue; // not beside this wall
    const gap = rel.x * wall.inward.x + rel.z * wall.inward.z - size.depth / 2 - WALL_GAP;
    if (Math.abs(gap) > SNAP_MM || Math.abs(gap) < 0.5) continue;
    return { x: center.x - wall.inward.x * gap, z: center.z - wall.inward.z * gap };
  }
  return center;
}

/**
 * Swap two items: `a` (being dragged, originally at `aFrom`) takes `b`'s place and
 * turn, `b` takes `a`'s old place and turn, each settling into the nearest spot it
 * fits if the other's is the wrong shape (further for items of very different
 * size). Null if either can't be placed.
 */
export function swapPlaces(
  room: RoomScan, a: Item, aFrom: { center: Vec2; rotation: number }, b: Item, rest: Item[],
): { a: { center: Vec2; rotation: number }; b: { center: Vec2; rotation: number } } | null {
  // Two items of very different size (a side cabinet and a wardrobe) can't land on each
  // other's exact centre, so allow settling further the more their sizes differ.
  const long = (i: Item) => Math.max(i.size.width, i.size.depth);
  const reach = 400 + Math.abs(long(a) - long(b));
  for (const [ra, rb] of [[b.rotation, aFrom.rotation], [aFrom.rotation, b.rotation]] as const) {
    const bAt = settle(room, b.size, aFrom.center, rb, rest, reach);
    if (!bAt) continue;
    const bNow = { ...b, center: bAt, rotation: rb };
    const aAt = settle(room, a.size, b.center, ra, [...rest, bNow], reach);
    if (aAt) return { a: { center: aAt, rotation: ra }, b: { center: bAt, rotation: rb } };
  }
  return null;
}

/**
 * Where a new item goes: against a wall (longest first), facing into the
 * room; when the walls are full, at the free floor spot nearest the middle.
 */
export function freeSpot(room: RoomScan, spec: Pick<ItemSpec, 'builder' | 'size'>, others: Item[]): { center: Vec2; rotation: number } | null {
  const walls = wallFrames(room.polygon);
  const spot = findSpot({ ...room, objects: [] }, spec.size, [], WALL_GAP, others.map(itemObstacle));
  if (spot) {
    const wall = walls[spot.wall];
    return { center: pointOnWall(wall, spot.u + spec.size.width / 2, WALL_GAP + spec.size.depth / 2), rotation: facing(wall) };
  }
  const middle = labelPoint(room.polygon);
  for (const rotation of [0, Math.PI / 2]) {
    for (let r = 0; r <= 8000; r += 100) {
      const steps = r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / 100));
      for (let k = 0; k < steps; k++) {
        const t = (k / steps) * Math.PI * 2;
        const c = { x: middle.x + Math.cos(t) * r, z: middle.z + Math.sin(t) * r };
        if (containsPoint(room.polygon, c) && fitsAt(room, spec.size, c, rotation, others)) return { center: c, rotation };
      }
    }
  }
  return null;
}

/** Distance from a point to the nearest wall of the room. */
function toWall(room: RoomScan, p: Vec2): number {
  let best = Infinity;
  for (const w of wallFrames(room.polygon)) {
    const rel = { x: p.x - w.start.x, z: p.z - w.start.z };
    const t = Math.max(0, Math.min(w.length, rel.x * w.dir.x + rel.z * w.dir.z));
    const q = pointOnWall(w, t);
    best = Math.min(best, Math.hypot(p.x - q.x, p.z - q.z));
  }
  return best;
}

/**
 * A scan says where something is and which way its width runs, not which end
 * is its back. Storage stands back-to-wall, so turn it so the back is the end
 * nearer a wall.
 */
export function backToNearerWall(room: RoomScan, center: Vec2, rotation: number, depth: number): number {
  const f = frontOf(rotation);
  const front = { x: center.x + (f.x * depth) / 2, z: center.z + (f.z * depth) / 2 };
  const back = { x: center.x - (f.x * depth) / 2, z: center.z - (f.z * depth) / 2 };
  return toWall(room, front) < toWall(room, back) ? (rotation + Math.PI) % (Math.PI * 2) : rotation;
}

/**
 * The centre of a model standing where a scanned (or previously stored) box
 * stood, with the same back face: the model is usually a different depth, so
 * its centre moves along the front direction by half the difference. Keeps a
 * wardrobe scanned against a wall against that wall.
 */
export function keepBackFace(center: Vec2, rotation: number, storedDepth: number, modelDepth: number): Vec2 {
  const f = frontOf(rotation);
  const shift = (modelDepth - storedDepth) / 2;
  return { x: center.x + f.x * shift, z: center.z + f.z * shift };
}

/**
 * The scan's storage as items, each the nearest MOZU model in size (its size,
 * hung where the scan found it); everything else in the scan is left out.
 * Uids are consecutive from `firstUid`.
 */
export function itemsFromScan(roomKey: string, room: RoomScan, firstUid: number): Item[] {
  const kitchen = isKitchen(room);
  const out: Item[] = [];
  for (const o of room.objects) {
    if (o.category !== 'storage') continue;
    const model = matchStorage({ width: o.width, depth: o.depth, height: o.height ?? 800, elevation: o.elevation ?? 0 }, kitchen);
    if (!model) continue;
    const rotation = backToNearerWall(room, o.center, o.rotation, o.depth);
    out.push({
      uid: firstUid + out.length,
      roomKey,
      name: model.name,
      builder: { kind: 'model', modelId: model.id },
      size: { width: model.width, depth: model.depth, height: model.height, elevation: o.elevation ?? model.elevation },
      center: keepBackFace(o.center, rotation, o.depth, model.depth),
      rotation,
      finishes: DEFAULT_FINISHES,
      fromScan: true,
    });
  }
  return out;
}

/** A new item from the library. */
export function itemFromSpec(spec: ItemSpec, uid: number, roomKey: string, at: { center: Vec2; rotation: number }): Item {
  return { uid, roomKey, name: spec.name, builder: spec.builder, size: { ...spec.size }, center: at.center, rotation: at.rotation, finishes: spec.finishes };
}
