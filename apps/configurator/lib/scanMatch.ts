/**
 * Which MOZU model a cabinet of a given size stands for. Used to migrate old
 * saved designs (lib/migrate.ts) whose cabinets predate the MOZU catalogue;
 * scans no longer place anything (lib/items.ts).
 *
 * Nearest means closest footprint and, counting double, height: a tall unit
 * must not become a base unit because its width happened to agree. The groups
 * considered depend on where the thing stands (hung on the wall, low, or tall)
 * and whether kitchen tall units are allowed.
 *
 * Millimetres, pure.
 */
import { modelsIn, type ModelGroupId, type ModelSpec } from './models';

export interface Measured {
  width: number;
  depth: number;
  height: number;
  /** Bottom above the floor. */
  elevation: number;
}

/** The model groups a scanned storage object may become, most likely first. */
export function candidateGroups(measured: Pick<Measured, 'height' | 'elevation'>, kitchen: boolean): ModelGroupId[] {
  if (measured.elevation >= 500) return ['kitchen-wall']; // hung on the wall: the only things MOZU hangs
  if (measured.height <= 1200) return ['kitchen-base', 'wardrobe-side']; // counter height or lower
  return kitchen ? ['kitchen-tall', 'wardrobe-main', 'wardrobe-side'] : ['wardrobe-main', 'wardrobe-side'];
}

/** How unlike the scanned size a model is: footprint difference plus twice the height difference. */
export const sizeScore = (measured: Pick<Measured, 'width' | 'depth' | 'height'>, model: ModelSpec) =>
  Math.abs(measured.width - model.width) + Math.abs(measured.depth - model.depth) + 2 * Math.abs(measured.height - model.height);

/** The candidate nearest in size; on a tie, the first in catalogue order. */
export function nearestModel(measured: Pick<Measured, 'width' | 'depth' | 'height'>, candidates: ModelSpec[]): ModelSpec | undefined {
  let best: ModelSpec | undefined, bestScore = Infinity;
  for (const m of candidates) {
    const score = sizeScore(measured, m);
    if (score < bestScore) [best, bestScore] = [m, score];
  }
  return best;
}

/** The MOZU model a scanned storage object becomes. */
export const matchStorage = (measured: Measured, kitchen: boolean) => nearestModel(measured, modelsIn(...candidateGroups(measured, kitchen)));
