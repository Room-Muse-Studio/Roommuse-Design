/**
 * The overall size of a room, or of a whole home: the axis-aligned box around
 * the polygon(s), in millimetres. What the summary card shows as "W × D".
 */
import type { Vec2 } from '@mozu/scan-sdk';

export interface Extent {
  width: number;
  depth: number;
}

export function bbox(polygons: Vec2[][]): Extent | null {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const poly of polygons) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) return null;
  return { width: Math.round(maxX - minX), depth: Math.round(maxZ - minZ) };
}

/** "W 4000 × D 3000 mm" */
export const extentText = (e: Extent | null) => (e ? `W ${e.width} × D ${e.depth} mm` : '—');
