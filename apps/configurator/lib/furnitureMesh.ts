/**
 * Loose furniture as simple, recognisable 3D shapes: beds, sofas, tables,
 * chairs, storage, TVs, appliances. Like the cabinets (lib/moduleMesh.ts) each
 * piece has two finishes, a main one and a frame one, so colour and texture work
 * the same for everything.
 *
 * Local frame, in metres: centred on the footprint, y up from the floor, the
 * front (a sofa's seat, a bed's foot) facing +z, width along x.
 */
import * as THREE from 'three';
import type { Finish } from './finishes';
import { box, buildModule, material } from './moduleMesh';

export type FurnitureType = 'bed' | 'sofa' | 'armchair' | 'table' | 'desk' | 'chair' | 'storage' | 'television' | 'appliance' | 'box';

export interface FurnitureSize {
  width: number;
  depth: number;
  height: number;
}

const dark = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.25, metalness: 0.1 });

/** Four square legs `size` mm thick, inset `inset` mm, from the floor to `top`. */
function legs(g: THREE.Group, w: number, d: number, top: number, size: number, inset: number, mat: THREE.Material) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - inset - size / 2), z = sz * (d / 2 - inset - size / 2);
    g.add(box(x - size / 2, x + size / 2, 0, top, z - size / 2, z + size / 2, mat));
  }
}

export function buildFurniture(type: FurnitureType, s: FurnitureSize, main: Finish, frame: Finish): THREE.Group {
  const g = new THREE.Group();
  const a = material(main), b = material(frame);
  const W = s.width, D = s.depth, H = s.height;
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;

  switch (type) {
    case 'bed': {
      const base = Math.min(300, H * 0.45);
      const mattress = Math.min(base + 220, Math.max(base + 120, H * 0.8));
      const headTop = Math.max(H, mattress + 350);
      g.add(box(x0, x1, 0, base, z0, z1, b)); // frame
      g.add(box(x0 + 25, x1 - 25, base, mattress, z0 + 90, z1 - 20, a, true)); // mattress
      g.add(box(x0, x1, 0, headTop, z0, z0 + 80, b, true)); // headboard at the back
      const pw = Math.min(600, (W - 120) / 2);
      for (const sx of W > 1100 ? [-1, 1] : [0]) {
        const cx = (sx * W) / 4;
        g.add(box(cx - pw / 2, cx + pw / 2, mattress, mattress + 110, z0 + 120, z0 + 480, a, true)); // pillows
      }
      break;
    }
    case 'sofa':
    case 'armchair': {
      const arm = Math.min(180, W * 0.18), seat = Math.min(430, H * 0.5), back = Math.min(220, D * 0.28);
      g.add(box(x0, x1, 0, 120, z0, z1, b)); // plinth
      g.add(box(x0 + arm, x1 - arm, 120, seat, z0 + back, z1, a, true)); // seat
      g.add(box(x0, x1, 120, H, z0, z0 + back, a, true)); // back
      g.add(box(x0, x0 + arm, 120, Math.min(H, seat + 220), z0, z1, a, true)); // arms
      g.add(box(x1 - arm, x1, 120, Math.min(H, seat + 220), z0, z1, a, true));
      const cushions = type === 'sofa' ? Math.max(2, Math.round((W - 2 * arm) / 700)) : 1;
      const cw = (W - 2 * arm) / cushions;
      for (let i = 0; i < cushions; i++) {
        const cx0 = x0 + arm + i * cw + 8, cx1 = x0 + arm + (i + 1) * cw - 8;
        g.add(box(cx0, cx1, seat, seat + 90, z0 + back + 10, z1 - 10, a, true));
      }
      break;
    }
    case 'table':
    case 'desk': {
      const top = 32;
      g.add(box(x0, x1, H - top, H, z0, z1, a, true));
      legs(g, W, D, H - top, 55, 40, b);
      if (type === 'desk') g.add(box(x1 - Math.min(420, W * 0.35), x1 - 60, H - top - 140, H - top, z0 + 30, z1 - 30, b)); // drawer
      break;
    }
    case 'chair': {
      const seat = Math.min(460, H * 0.55);
      g.add(box(x0, x1, seat - 40, seat, z0, z1, a, true));
      g.add(box(x0, x1, seat, H, z0, z0 + 35, a, true));
      legs(g, W, D, seat - 40, 35, 15, b);
      break;
    }
    case 'storage': {
      // A freestanding cupboard: the cabinet builder, re-centred on its footprint.
      const cabinet = buildModule(
        { id: 'storage', group: 'living', name: 'Storage', width: W, height: H, depth: D, elevation: 0, plinth: Math.min(60, H * 0.1),
          fronts: [{ kind: 'door', columns: W > 700 ? 2 : 1 }] },
        { front: main, carcass: frame },
      );
      cabinet.position.z = (-D / 2) / 1000;
      g.add(cabinet);
      break;
    }
    case 'television': {
      const screenBottom = H * 0.28, standW = Math.min(W * 0.4, 500);
      g.add(box(-standW / 2, standW / 2, 0, 25, z0, z1, b)); // foot
      g.add(box(-30, 30, 25, screenBottom + 40, -30, 30, b)); // neck
      g.add(box(x0, x1, screenBottom, H, -25, 25, a, true)); // body
      g.add(box(x0 + 20, x1 - 20, screenBottom + 20, H - 20, 25, 28, dark)); // glass
      break;
    }
    case 'appliance': {
      g.add(box(x0, x1, 0, H, z0, z1 - 20, a, true)); // body
      g.add(box(x0 + 4, x1 - 4, 4, H - 4, z1 - 20, z1, a, true)); // door
      g.add(box(x1 - 70, x1 - 50, H * 0.45, H * 0.8, z1, z1 + 30, b)); // handle
      break;
    }
    default:
      g.add(box(x0, x1, 0, H, z0, z1, a, true));
  }
  return g;
}
