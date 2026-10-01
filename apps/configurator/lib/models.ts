/**
 * The catalogue: MOZU's 30 models, as measured from their files by
 * scripts/measure-models.mjs into models.manifest.json. A model is a GLB in
 * models/mozu/ plus the facts the file can't tell us: which way its doors face
 * (`front`), what it's called, and how high a wall cabinet hangs.
 *
 * Millimetres, no Three.js: the loader (modelLoader.ts) and the mesh builder
 * (modelMesh.ts) sit on top of this, and the tests run it under plain Node.
 */
import manifest from './models.manifest.json';

export type ModelGroupId = 'kitchen-base' | 'kitchen-wall' | 'kitchen-tall' | 'wardrobe-main' | 'wardrobe-side';

/** The axis the doors face in the model file. The viewer turns it toward +z. */
export type Front = '+x' | '-x' | '+z' | '-z';

export interface ModelSpec {
  id: string;
  name: string;
  group: ModelGroupId;
  /** Under public/, e.g. models/mozu/KF01.glb. */
  file: string;
  /** Across the front, once the front faces +z. */
  width: number;
  depth: number;
  height: number;
  /** Bottom above the floor: 0 for floor units, 1450 for kitchen wall cabinets. */
  elevation: number;
  front: Front;
  /** The file's width runs along z (front is ±x), so its x extent is the depth. */
  swapped?: boolean;
  bytes: number;
}

export const MODEL_SPECS: ModelSpec[] = manifest.models as ModelSpec[];

export const MODEL_GROUPS: { id: ModelGroupId; name: string; short: string }[] = [
  { id: 'kitchen-base', name: 'Kitchen · Base', short: 'Base' },
  { id: 'kitchen-wall', name: 'Kitchen · Wall', short: 'Wall' },
  { id: 'kitchen-tall', name: 'Kitchen · Tall', short: 'Tall' },
  { id: 'wardrobe-main', name: 'Wardrobes · Main', short: 'Main' },
  { id: 'wardrobe-side', name: 'Wardrobes · Side', short: 'Side' },
];

export const modelById = (id: string) => MODEL_SPECS.find((m) => m.id === id);

/** The models of one or more groups, in catalogue order. */
export const modelsIn = (...groups: ModelGroupId[]) => MODEL_SPECS.filter((m) => groups.includes(m.group));

/**
 * The turn about y (radians, Three.js) that brings the file's front to +z.
 * Three.js turns +x toward -z for a positive angle, so a +x front needs -90°.
 */
export function yawOf(front: Front): number {
  switch (front) {
    case '+z': return 0;
    case '-z': return Math.PI;
    case '+x': return -Math.PI / 2;
    case '-x': return Math.PI / 2;
  }
}

/**
 * A uniform scale that fits the model into an item's stored size: 1 when the
 * sizes agree to within 1 %, otherwise the smallest axis ratio, so the model
 * never pokes out of the footprint placement was checked against. Items made
 * from the catalogue have the model's size exactly; this covers odd data.
 */
export function fitScale(size: { width: number; depth: number; height: number }, spec: ModelSpec): number {
  const ratios = [size.width / spec.width, size.depth / spec.depth, size.height / spec.height];
  if (ratios.every((r) => Math.abs(r - 1) <= 0.01)) return 1;
  return Math.min(...ratios);
}
