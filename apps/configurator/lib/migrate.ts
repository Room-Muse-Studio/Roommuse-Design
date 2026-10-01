/**
 * Bring a saved design up to date. Designs saved before the MOZU catalogue
 * hold procedural cabinets (`module`) and generic furniture (`furniture`);
 * each becomes the nearest MOZU model of the same kind, in the same place,
 * with the same finishes and uid, so a project opens as it was left as far
 * as the range allows. Furniture MOZU doesn't make (beds, sofas, tables…) is
 * dropped, as are entries that don't look like items at all.
 *
 * Pure and idempotent: a list of model items comes back as it went in, so it
 * runs on every project load and guest-stash restore. Never throws.
 */
import { DEFAULT_FINISHES, keepBackFace, type Item, type Size } from './items';
import { modelById, modelsIn, type ModelGroupId, type ModelSpec } from './models';
import { matchStorage, nearestModel } from './scanMatch';

/** The builders designs used to hold, beside today's `model`. */
export type LegacyBuilder = { kind: 'module'; moduleId: string } | { kind: 'furniture'; type: string };

/** Which model groups an old module id (base-900-doors, wardrobe-450-door, tv-1800…) can become. */
const MODULE_GROUPS: [RegExp, ModelGroupId[]][] = [
  [/^base-/, ['kitchen-base']],
  [/^wall-/, ['kitchen-wall']],
  [/^tall-/, ['kitchen-tall']],
  [/^wardrobe-/, ['wardrobe-main', 'wardrobe-side']],
  [/^(tv|shoe|shelf)-/, ['wardrobe-side', 'kitchen-base']],
];

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function readSize(v: unknown): Size | null {
  if (!isObject(v) || !isNumber(v.width) || !isNumber(v.depth) || !isNumber(v.height)) return null;
  return { width: v.width, depth: v.depth, height: v.height, elevation: isNumber(v.elevation) ? v.elevation : 0 };
}

/** The finishes as stored, with the second slot filled in when a design only kept one. */
function readFinishes(v: unknown): Item['finishes'] {
  if (!isObject(v)) return DEFAULT_FINISHES;
  const ok = (f: unknown) => isObject(f) && typeof f.color === 'string' && typeof f.pattern === 'string' && typeof f.sheen === 'string';
  const primary = ok(v.primary) ? (v.primary as Item['finishes']['primary']) : DEFAULT_FINISHES.primary;
  const secondary = ok(v.secondary) ? (v.secondary as Item['finishes']['secondary']) : primary;
  return { primary, secondary };
}

/** The model an old item turns into, or undefined to drop it. */
function modelFor(builder: Record<string, unknown>, size: Size): ModelSpec | undefined {
  if (builder.kind === 'model') return typeof builder.modelId === 'string' ? modelById(builder.modelId) : undefined;
  if (builder.kind === 'module' && typeof builder.moduleId === 'string') {
    const id = builder.moduleId;
    const groups = MODULE_GROUPS.find(([re]) => re.test(id))?.[1];
    return groups && nearestModel(size, modelsIn(...groups));
  }
  if (builder.kind === 'furniture' && builder.type === 'storage') return matchStorage(size, false);
  return undefined;
}

export function migrateItems(items: unknown): Item[] {
  if (!Array.isArray(items)) return [];
  const out: Item[] = [];
  for (const raw of items) {
    if (!isObject(raw) || !isNumber(raw.uid) || typeof raw.roomKey !== 'string' || !isObject(raw.builder)) continue;
    const center = raw.center;
    if (!isObject(center) || !isNumber(center.x) || !isNumber(center.z)) continue;
    const size = readSize(raw.size);
    if (!size) continue;
    const model = modelFor(raw.builder, size);
    if (!model) continue;
    const rotation = isNumber(raw.rotation) ? raw.rotation : 0;
    const item: Item = {
      uid: raw.uid,
      roomKey: raw.roomKey,
      name: typeof raw.name === 'string' && raw.builder.kind === 'model' ? raw.name : model.name,
      builder: { kind: 'model', modelId: model.id },
      size: raw.builder.kind === 'model' ? size : { width: model.width, depth: model.depth, height: model.height, elevation: size.elevation },
      // A model item is where it was; an old item keeps its back face (the model is a different depth).
      center: raw.builder.kind === 'model' ? { x: center.x, z: center.z } : keepBackFace({ x: center.x, z: center.z }, rotation, size.depth, model.depth),
      rotation,
      finishes: readFinishes(raw.finishes),
    };
    if (raw.fromScan === true) item.fromScan = true;
    out.push(item);
  }
  return out;
}
