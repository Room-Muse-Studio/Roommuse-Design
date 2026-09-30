/**
 * Build a module (lib/modules.ts) as Three.js geometry: carcass boards, a
 * recessed plinth, fronts (doors, drawers, an appliance panel or open shelves)
 * and bar handles. Fronts and carcass take separate finishes.
 *
 * Local frame, in metres: x across the front (centred), y up from the module's
 * own bottom, z out of the wall (the back is at z = 0, the fronts face +z).
 */
import * as THREE from 'three';
import type { ModuleSpec } from './modules';
import { finishMaterial, TILE_MM, type Finish } from './finishes';

const M = 1 / 1000;
const BOARD = 18;
const FRONT = 18;
const GAP = 3;
const BACK = 6;
const PLINTH_SETBACK = 50;

const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.3, metalness: 0.85 });
const applianceMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.12, metalness: 0.2 });
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 });

const materials = new Map<string, THREE.MeshStandardMaterial>();
/** One material per finish, shared by every module that uses it. */
export function material(finish: Finish): THREE.MeshStandardMaterial {
  const key = `${finish.color}|${finish.pattern}|${finish.sheen}`;
  let m = materials.get(key);
  if (!m) materials.set(key, (m = finishMaterial(finish)));
  return m;
}

/** Scale a box's UVs so a texture tile covers TILE_MM of surface on every face. */
function worldUVs(geometry: THREE.BoxGeometry, w: number, h: number, d: number) {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry faces, 4 vertices each: +x, -x, +y, -y, +z, -z.
  const spans: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = spans[face];
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, (uv.getX(i) * su) / TILE_MM, (uv.getY(i) * sv) / TILE_MM);
    }
  }
  uv.needsUpdate = true;
}

/** A board from (x0,y0,z0) to (x1,y1,z1), in millimetres. */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material, edges = false) {
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
  const geometry = new THREE.BoxGeometry(w * M, h * M, d * M);
  worldUVs(geometry, w, h, d);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(((x0 + x1) / 2) * M, ((y0 + y1) / 2) * M, ((z0 + z1) / 2) * M);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (edges) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
  return mesh;
}

/** A bar handle: horizontal on drawers, vertical on doors. Centre (x, y) on the front face at z. */
export function handle(x: number, y: number, z: number, length: number, vertical: boolean) {
  const g = new THREE.Group();
  const [lx, ly] = vertical ? [12, length] : [length, 12];
  g.add(box(x - lx / 2, x + lx / 2, y - ly / 2, y + ly / 2, z + 22, z + 34, handleMaterial));
  // Two stand-offs holding the bar off the front.
  for (const s of [-1, 1]) {
    const px = vertical ? x : x + s * (length / 2 - 12), py = vertical ? y + s * (length / 2 - 12) : y;
    g.add(box(px - 5, px + 5, py - 5, py + 5, z, z + 22, handleMaterial));
  }
  return g;
}

export interface ModuleFinishes {
  front: Finish;
  carcass: Finish;
}

export function buildModule(spec: ModuleSpec, finishes: ModuleFinishes): THREE.Group {
  const root = new THREE.Group();
  root.name = spec.name;
  const carcass = material(finishes.carcass), front = material(finishes.front);
  const { width: W, height: H, depth: D, plinth: P } = spec;
  const x0 = -W / 2, x1 = W / 2;
  const cz = D - FRONT - 2; // carcass depth; fronts sit in front of it

  // Plinth, set back from the fronts so toes fit under.
  if (P > 0) root.add(box(x0 + BOARD, x1 - BOARD, 0, P, cz - PLINTH_SETBACK - BOARD, cz - PLINTH_SETBACK, carcass));

  // Carcass: two sides, top, bottom, back.
  root.add(box(x0, x0 + BOARD, P, H, 0, cz, carcass));
  root.add(box(x1 - BOARD, x1, P, H, 0, cz, carcass));
  root.add(box(x0 + BOARD, x1 - BOARD, H - BOARD, H, 0, cz, carcass));
  root.add(box(x0 + BOARD, x1 - BOARD, P, P + BOARD, 0, cz, carcass));
  root.add(box(x0 + BOARD, x1 - BOARD, P + BOARD, H - BOARD, 0, BACK, carcass));

  // Fronts, bottom to top; the last band without a height takes what's left.
  const fixed = spec.fronts.reduce((s, r) => s + (r.height ?? 0), 0);
  const flexible = spec.fronts.filter((r) => r.height === undefined).length || 1;
  const spare = Math.max(0, H - P - fixed) / flexible;
  let y = P;
  for (const row of spec.fronts) {
    const rowH = row.height ?? spare;
    const top = Math.min(H, y + rowH);
    const cols = row.columns ?? 1;
    if (row.kind === 'open') {
      // No fronts: shelves spaced evenly inside the band.
      const shelves = row.shelves ?? 1;
      for (let i = 1; i <= shelves; i++) {
        const sy = y + ((top - y) * i) / (shelves + 1);
        root.add(box(x0 + BOARD, x1 - BOARD, sy - BOARD / 2, sy + BOARD / 2, BACK, cz, carcass));
      }
      y = top;
      continue;
    }
    const colW = W / cols;
    for (let c = 0; c < cols; c++) {
      const fx0 = x0 + c * colW + GAP / 2, fx1 = x0 + (c + 1) * colW - GAP / 2;
      const fy0 = y + GAP / 2, fy1 = top - GAP / 2;
      const isAppliance = row.kind === 'appliance';
      root.add(box(fx0, fx1, fy0, fy1, cz + 2, cz + 2 + FRONT, isAppliance ? applianceMaterial : front, true));
      const fz = cz + 2 + FRONT, fw = fx1 - fx0, fh = fy1 - fy0;
      if (row.kind === 'drawer' || isAppliance) {
        root.add(handle((fx0 + fx1) / 2, fy1 - Math.min(45, fh / 4), fz, Math.min(fw * 0.45, 400), false));
      } else {
        // Door handle on the opening edge: the inner edges of a pair, else the right.
        const hx = cols > 1 ? (c < cols / 2 ? fx1 - 40 : fx0 + 40) : fx1 - 40;
        const len = Math.min(180, fh * 0.5);
        const absoluteBottom = spec.elevation + fy0, absoluteTop = spec.elevation + fy1;
        // Wall units: near the bottom. Base units: near the top. Tall doors: at hand height.
        const hy =
          spec.elevation > 0 ? fy0 + len / 2 + 40
          : absoluteTop < 1200 ? fy1 - len / 2 - 40
          : Math.min(fy1 - len / 2 - 40, Math.max(fy0 + len / 2 + 40, 1050 - absoluteBottom + fy0));
        root.add(handle(hx, hy, fz, len, true));
      }
    }
    y = top;
  }
  return root;
}
