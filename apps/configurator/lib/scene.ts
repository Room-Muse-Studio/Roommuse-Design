/**
 * Build Three.js objects for the rooms of a home. One group per room, all in
 * the scan's shared coordinate space, so rooms land at their real positions.
 *
 * Scan x/z (millimetres) map to Three.js x/z (metres); y is up. Walls are
 * single-sided and face into their room, so from outside you look through the
 * near walls into the room ("dollhouse" view), and two rooms that share a wall
 * each draw their own face of it, slightly inset, without flickering.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { FIXTURE_LABEL } from '@mozu/scan-sdk';
import type { ScanFixture, ScanOpening, Vec2 } from '@mozu/scan-sdk';
import type { ViewerRoom } from './home';
import { labelPoint, openingRect, pointOnWall, solidPieces, wallFrames, type WallFrame, type WallRect } from './walls';

const M = 1 / 1000;
/** How far each room's wall faces sit inside its polygon, so shared walls don't overlap. */
export const WALL_INSET = 12;
const FIXTURE_SIZE = 90;

const ROOM_TINTS = [0xe9e2d6, 0xdfe7e1, 0xe3e1ec, 0xefe2dc, 0xe0e7ee, 0xeae6d2];
const OPENING_COLOR: Record<ScanOpening['type'], number> = { door: 0x2f7d63, window: 0x3d7fc1, archway: 0x8a8f94 };
const FIXTURE_COLOR: Record<string, number> = {
  socket: 0xd09e16, switch: 0xb46a14, water: 0x146bc0, waste: 0x5b6770, gas: 0xc33a20, vent: 0x8a8f94, radiator: 0xa0522d,
};

export interface RoomView {
  key: string;
  group: THREE.Group;
  ceiling: THREE.Object3D;
  /** The room's items (cabinets and furniture) go here, so isolating a room shows or hides them with it. */
  items: THREE.Group;
}

type Materials = ReturnType<typeof makeMaterials>;

function makeMaterials() {
  return {
    wall: new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.95, side: THREE.FrontSide }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xfbfaf7, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9cc7ee, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    outline: new THREE.LineBasicMaterial({ color: 0x4a4a48 }),
  };
}

function label(text: string, className: string): CSS2DObject {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return new CSS2DObject(el);
}

const toV3 = (p: Vec2, y: number) => new THREE.Vector3(p.x * M, y * M, p.z * M);

/** Face a flat object (normal +z) into the room along this wall. */
function faceInward(obj: THREE.Object3D, wall: WallFrame) {
  obj.rotation.y = Math.atan2(wall.inward.x, wall.inward.z);
}

/** A rectangle of a wall as a flat mesh, `inset` mm into the room. */
function wallQuad(wall: WallFrame, r: WallRect, material: THREE.Material, inset: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry((r.u1 - r.u0) * M, (r.v1 - r.v0) * M), material);
  mesh.position.copy(toV3(pointOnWall(wall, (r.u0 + r.u1) / 2, inset), (r.v0 + r.v1) / 2));
  faceInward(mesh, wall);
  mesh.receiveShadow = true;
  return mesh;
}

/** A rectangle's outline on the wall (door and window frames). */
function wallOutline(wall: WallFrame, r: WallRect, material: THREE.LineBasicMaterial, inset: number, closeBottom: boolean) {
  const at = (u: number, v: number) => toV3(pointOnWall(wall, u, inset), v);
  const pts = [at(r.u0, r.v0), at(r.u0, r.v1), at(r.u0, r.v1), at(r.u1, r.v1), at(r.u1, r.v1), at(r.u1, r.v0)];
  if (closeBottom) pts.push(at(r.u1, r.v0), at(r.u0, r.v0));
  return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), material);
}

function floorGeometry(polygon: Vec2[]): THREE.BufferGeometry {
  // Shape y = -z, then lying the shape flat maps (x, -z) to (x, 0, z). Earcut
  // triangulates, so concave rooms work.
  const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x * M, -p.z * M)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function buildOpening(opening: ScanOpening, wall: WallFrame, height: number, mats: Materials): THREE.Object3D {
  const g = new THREE.Group();
  const r = openingRect(opening, wall, height);
  const frame = new THREE.LineBasicMaterial({ color: OPENING_COLOR[opening.type] });
  g.add(wallOutline(wall, r, frame, WALL_INSET + 2, opening.type === 'window'));
  if (opening.type === 'window') g.add(wallQuad(wall, r, mats.glass, WALL_INSET + 1));
  if (opening.type === 'door') {
    // A thin leaf-shaped tint in the doorway, so a door reads differently from an archway.
    const leaf = new THREE.MeshStandardMaterial({ color: OPENING_COLOR.door, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    g.add(wallQuad(wall, r, leaf, WALL_INSET + 1));
  }
  g.userData.id = opening.id;
  return g;
}

function buildFixture(fixture: ScanFixture, wall: WallFrame): THREE.Object3D {
  const g = new THREE.Group();
  const u = Math.max(0, Math.min(wall.length, fixture.offset));
  const color = FIXTURE_COLOR[fixture.type] ?? 0x555555;
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(FIXTURE_SIZE * M, FIXTURE_SIZE * M, 20 * M),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  );
  plate.position.copy(toV3(pointOnWall(wall, u, WALL_INSET + 10), fixture.height));
  faceInward(plate, wall);
  g.add(plate);
  const tag = label(fixture.label ?? FIXTURE_LABEL[fixture.type] ?? fixture.type, 'tag tag-fixture');
  tag.position.copy(toV3(pointOnWall(wall, u, WALL_INSET + 60), fixture.height + FIXTURE_SIZE));
  g.add(tag);
  g.userData.id = fixture.id;
  return g;
}

export function buildRoom(room: ViewerRoom, index: number, mats: Materials): RoomView {
  const { scan } = room;
  const group = new THREE.Group();
  group.name = room.name;
  const walls = wallFrames(scan.polygon);

  const floor = new THREE.Mesh(
    floorGeometry(scan.polygon),
    new THREE.MeshStandardMaterial({ color: ROOM_TINTS[index % ROOM_TINTS.length], roughness: 1, side: THREE.DoubleSide }),
  );
  floor.receiveShadow = true;
  group.add(floor);

  // Outline of the room at floor level and along the top of the walls.
  const loop = (y: number) => new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(scan.polygon.map((p) => toV3(p, y))), mats.outline);
  group.add(loop(1), loop(scan.height));

  for (const wall of walls) {
    if (wall.length < 1) continue;
    const openings = scan.openings.filter((o) => o.wall === wall.index);
    const holes = openings.map((o) => openingRect(o, wall, scan.height));
    for (const piece of solidPieces(wall.length, scan.height, holes)) group.add(wallQuad(wall, piece, mats.wall, WALL_INSET));
    for (const o of openings) group.add(buildOpening(o, wall, scan.height, mats));
  }
  for (const f of scan.fixtures ?? []) {
    const wall = walls[f.wall];
    if (wall) group.add(buildFixture(f, wall));
  }

  const ceiling = new THREE.Mesh(floorGeometry(scan.polygon), mats.ceiling);
  ceiling.position.y = scan.height * M;
  ceiling.name = 'ceiling';
  group.add(ceiling);

  // At ceiling height, so the name floats above the room rather than colliding
  // with furniture labels on the floor.
  const name = label(room.name, 'tag tag-room');
  name.position.copy(toV3(labelPoint(scan.polygon), scan.height));
  group.add(name);

  const items = new THREE.Group();
  items.name = 'items';
  group.add(items);

  group.userData.key = room.key;
  return { key: room.key, group, ceiling, items };
}

export function buildHome(rooms: ViewerRoom[]): { root: THREE.Group; views: RoomView[]; dispose: () => void } {
  const mats = makeMaterials();
  const root = new THREE.Group();
  const views = rooms.map((room, i) => buildRoom(room, i, mats));
  for (const v of views) root.add(v.group);
  const dispose = () => {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      if (o instanceof CSS2DObject) o.element.remove();
    });
    root.removeFromParent();
  };
  return { root, views, dispose };
}

/** Show or hide a subtree, including its HTML labels (which CSS2DRenderer draws per object). */
export function setVisible(obj: THREE.Object3D, visible: boolean) {
  obj.visible = visible;
  obj.traverse((o) => {
    if (o instanceof CSS2DObject) o.visible = visible && ancestorsVisible(o);
  });
}

function ancestorsVisible(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o.parent; p; p = p.parent) if (!p.visible) return false;
  return true;
}
