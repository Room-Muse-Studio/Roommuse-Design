/**
 * Everything that stands in a room — the cabinets from the library and the
 * furniture that came with the scan — is one kind of thing: an Item. Each has a
 * footprint centre and rotation (free on the floor, not tied to a wall), a
 * size, and two finishes. Items can be added, removed, moved, turned and
 * recoloured alike; they differ only in how they are drawn.
 *
 * Millimetres; rotation in radians in the scan's convention (it turns the
 * width axis from +x toward +z, which is clockwise seen from above). No Three.js.
 */
import type { RoomScan, ScanObject, Vec2 } from '@mozu/scan-sdk';
import { MODULE_GROUPS, MODULES, moduleById } from './modules';
import { customFinish, DEFAULT_CARCASS, DEFAULT_FRONT, swatchById, type Finish } from './finishes';
import type { FurnitureType } from './furnitureMesh';
import { convexOverlap, findSpot, obstacles, outlineFits, type Obstacle } from './placement';
import { containsPoint, labelPoint, pointOnWall, wallFrames, type WallFrame } from './walls';

export type Slot = 'primary' | 'secondary';

export type Builder = { kind: 'module'; moduleId: string } | { kind: 'furniture'; type: FurnitureType };

export interface Size {
  width: number;
  depth: number;
  height: number;
  /** Bottom above the floor: 0 for most things, ~1450 for a kitchen wall cabinet. */
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
  group: string;
  name: string;
  builder: Builder;
  size: Size;
  finishes: Record<Slot, Finish>;
}

/** Same distance the viewer insets walls by, so a flush item sits on the wall face. */
export const WALL_GAP = 12;
/** Released this close to a wall, and parallel to it, an item snaps flush. */
export const SNAP_MM = 120;

const swatch = (id: string) => swatchById(id)!;
const steel = customFinish('#c9cacc', 'smooth', 'metallic');

/** Default finishes and what the two finish slots are called, per kind of furniture. */
const FURNITURE_LOOK: Record<FurnitureType, { slots: Record<Slot, string>; finishes: Record<Slot, Finish> }> = {
  bed: { slots: { primary: 'Bedding', secondary: 'Frame' }, finishes: { primary: swatch('fabric_03'), secondary: swatch('wood_oak_04') } },
  sofa: { slots: { primary: 'Upholstery', secondary: 'Base' }, finishes: { primary: swatch('fabric_04_02'), secondary: swatch('wood_walnut_02') } },
  armchair: { slots: { primary: 'Upholstery', secondary: 'Base' }, finishes: { primary: swatch('fabric_05'), secondary: swatch('wood_walnut_02') } },
  table: { slots: { primary: 'Top', secondary: 'Legs' }, finishes: { primary: swatch('wood_oak_01'), secondary: swatch('hue_4_2') } },
  desk: { slots: { primary: 'Top', secondary: 'Legs & drawer' }, finishes: { primary: swatch('wood_oak_06'), secondary: swatch('hue_1_1') } },
  chair: { slots: { primary: 'Seat & back', secondary: 'Legs' }, finishes: { primary: swatch('wood_oak_01'), secondary: swatch('hue_4_2') } },
  storage: { slots: { primary: 'Doors', secondary: 'Carcass' }, finishes: { primary: DEFAULT_FRONT, secondary: DEFAULT_CARCASS } },
  television: { slots: { primary: 'Frame', secondary: 'Stand' }, finishes: { primary: swatch('hue_4_2'), secondary: swatch('hue_4_1') } },
  appliance: { slots: { primary: 'Body', secondary: 'Handle' }, finishes: { primary: swatch('glossy_01'), secondary: steel } },
  box: { slots: { primary: 'Finish', secondary: 'Detail' }, finishes: { primary: customFinish('#b9a58c', 'smooth', 'matte'), secondary: swatch('hue_4_1') } },
};

export function slotNames(builder: Builder): Record<Slot, string> {
  return builder.kind === 'module' ? { primary: 'Doors & drawers', secondary: 'Carcass' } : FURNITURE_LOOK[builder.type].slots;
}

/** RoomPlan's object categories, drawn as the nearest kind of furniture. */
const CATEGORY_TYPE: Record<string, FurnitureType> = {
  bed: 'bed', sofa: 'sofa', chair: 'chair', table: 'table', storage: 'storage', television: 'television',
  refrigerator: 'appliance', stove: 'appliance', oven: 'appliance', dishwasher: 'appliance', washerDryer: 'appliance',
};

const pretty = (category: string) => {
  const words = category.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const furniture = (id: string, name: string, type: FurnitureType, width: number, depth: number, height: number): ItemSpec =>
  ({ id, group: 'furniture', name, builder: { kind: 'furniture', type }, size: { width, depth, height, elevation: 0 }, finishes: FURNITURE_LOOK[type].finishes });

export const ITEM_GROUPS: { id: string; name: string; short: string }[] = [
  ...MODULE_GROUPS.map((g) => ({ ...g, short: { 'kitchen-base': 'Base', 'kitchen-wall': 'Wall', 'kitchen-tall': 'Tall', wardrobe: 'Wardrobes', living: 'Living' }[g.id] })),
  { id: 'furniture', name: 'Furniture', short: 'Furniture' },
];

export const ITEM_SPECS: ItemSpec[] = [
  ...MODULES.map((m): ItemSpec => ({
    id: m.id, group: m.group, name: m.name, builder: { kind: 'module', moduleId: m.id },
    size: { width: m.width, depth: m.depth, height: m.height, elevation: m.elevation },
    finishes: { primary: DEFAULT_FRONT, secondary: DEFAULT_CARCASS },
  })),
  furniture('bed-double', 'Double bed', 'bed', 1400, 2000, 1000),
  furniture('bed-single', 'Single bed', 'bed', 900, 2000, 950),
  furniture('sofa-3', 'Sofa, 3 seats', 'sofa', 2100, 900, 820),
  furniture('armchair', 'Armchair', 'armchair', 850, 850, 820),
  furniture('table-dining', 'Dining table', 'table', 1600, 900, 750),
  furniture('desk', 'Desk', 'desk', 1200, 600, 750),
  furniture('chair', 'Chair', 'chair', 450, 500, 850),
  furniture('storage-800', 'Storage cupboard', 'storage', 800, 450, 1800),
  furniture('tv-55', 'TV, 55"', 'television', 1230, 250, 780),
];

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

/** Whether an item of `size` can stand at `center`/`rotation` among `others` (items in the same room). */
export function fitsAt(room: RoomScan, size: Size, center: Vec2, rotation: number, others: Item[]): boolean {
  return outlineFits(room, outline(size, center, rotation), size.elevation, size.elevation + size.height, [
    ...roomBlockers(room),
    ...others.map(itemObstacle),
  ]);
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
  // Two items of very different size (a desk and a bed) can't land on each other's exact
  // centre, so allow settling further the more their sizes differ.
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
 * Where a new item goes. Cabinets start against a wall (longest first); other
 * furniture, and cabinets when the walls are full, at the free floor spot nearest
 * the middle of the room.
 */
export function freeSpot(room: RoomScan, spec: Pick<ItemSpec, 'builder' | 'size'>, others: Item[]): { center: Vec2; rotation: number } | null {
  const walls = wallFrames(room.polygon);
  if (spec.builder.kind === 'module') {
    const spot = findSpot({ ...room, objects: [] }, spec.size, [], WALL_GAP, others.map(itemObstacle));
    if (spot) {
      const wall = walls[spot.wall];
      return { center: pointOnWall(wall, spot.u + spec.size.width / 2, WALL_GAP + spec.size.depth / 2), rotation: facing(wall) };
    }
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

/** Furniture that normally stands with its back to a wall. */
const BACK_TO_WALL = new Set<FurnitureType>(['bed', 'sofa', 'armchair', 'storage', 'television', 'appliance']);

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
 * is its back. For furniture that stands back-to-wall (a bed's headboard, a
 * sofa's back), turn it so the back is the end nearer a wall.
 */
function backToNearerWall(room: RoomScan, type: FurnitureType, center: Vec2, rotation: number, depth: number): number {
  if (!BACK_TO_WALL.has(type)) return rotation;
  const f = frontOf(rotation);
  const front = { x: center.x + (f.x * depth) / 2, z: center.z + (f.z * depth) / 2 };
  const back = { x: center.x - (f.x * depth) / 2, z: center.z - (f.z * depth) / 2 };
  return toWall(room, front) < toWall(room, back) ? (rotation + Math.PI) % (Math.PI * 2) : rotation;
}

/** The furniture a scan came with, as items. */
export function itemsFromScan(roomKey: string, room: RoomScan, firstUid: number): Item[] {
  return room.objects.map((o: ScanObject, i) => {
    const type = CATEGORY_TYPE[o.category] ?? 'box';
    return {
      uid: firstUid + i,
      roomKey,
      name: pretty(o.category),
      builder: { kind: 'furniture', type },
      size: { width: o.width, depth: o.depth, height: o.height ?? 800, elevation: o.elevation ?? 0 },
      center: { ...o.center },
      rotation: backToNearerWall(room, type, o.center, o.rotation, o.depth),
      finishes: FURNITURE_LOOK[type].finishes,
      fromScan: true,
    };
  });
}

/** A new item from the library. */
export function itemFromSpec(spec: ItemSpec, uid: number, roomKey: string, at: { center: Vec2; rotation: number }): Item {
  return { uid, roomKey, name: spec.name, builder: spec.builder, size: { ...spec.size }, center: at.center, rotation: at.rotation, finishes: spec.finishes };
}

export const isModule = (i: Item) => i.builder.kind === 'module';
export const moduleOf = (i: Item) => (i.builder.kind === 'module' ? moduleById(i.builder.moduleId) : undefined);
