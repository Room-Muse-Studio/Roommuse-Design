// Measure the MOZU models (models/mozu/*.glb) and write lib/models.manifest.json:
// the catalogue the configurator builds its library, placement and scan
// matching from. Run it again whenever a model file changes:
//
//   npm run models:measure -w apps/configurator
//
// A GLB carries its size: every POSITION accessor records min/max, so the
// bounding box is read from the JSON chunk without touching the vertex data.
// The files are millimetres, Y up, base at y = 0 and footprint centred; this
// checks that rather than trusting it. A node may carry a translation (a door's
// or drawer's node sits at its hinge or slide point, see
// tools/mozu/step-to-glb-parts.mjs), which offsets its box; any other transform
// is refused, since the box would then be wrong. Doors and drawers (nodes whose
// extras say `part: 'hinge' | 'slide'`) are counted into the row's `parts`.
//
// Which side is the front isn't recorded in the files, and in some of them the
// width runs along z instead of x. Both are the `front` field: the axis the
// doors face in the file. The viewer turns that axis toward +z, so a model whose
// front is ±x is turned a quarter and its measured x extent is its depth, not
// its width. `front`, `name` and `elevation` are hand-kept: a value in the
// existing manifest survives a re-run, so an orientation fixed by eye stays fixed.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const MODELS_DIR = join(here, '..', 'models', 'mozu');
export const MANIFEST = join(here, '..', 'lib', 'models.manifest.json');

/** The groups, in catalogue order, and the deepest a cabinet of that kind can plausibly be (mm). */
export const GROUPS = [
  { id: 'kitchen-base', name: 'Kitchen · Base', maxDepth: 650, prefix: 'KF', label: 'Base cabinet' },
  { id: 'kitchen-wall', name: 'Kitchen · Wall', maxDepth: 450, prefix: 'KH', label: 'Wall cabinet' },
  { id: 'kitchen-tall', name: 'Kitchen · Tall', maxDepth: 700, prefix: 'KT', label: 'Tall cabinet' },
  { id: 'wardrobe-main', name: 'Wardrobes · Main', maxDepth: 700, prefix: 'W', label: 'Wardrobe' },
  { id: 'wardrobe-side', name: 'Wardrobes · Side', maxDepth: 650, prefix: 'W', label: 'Side cabinet' },
];

/** Kitchen wall cabinets hang with their bottom this far above the floor. */
const WALL_ELEVATION = 1450;

/**
 * Per-model defaults that the files can't tell us. The main wardrobes W04–W10
 * are modelled with their width along z and their open side toward -x (their
 * back panel is the +x face). Everything else faces +z: the kitchen units' doors
 * and drawers, and the side cabinets' open fronts (their backs are at -z).
 */
const FRONT_OVERRIDES = {
  W04: '-x', W05: '-x', W06: '-x', W07: '-x', W08: '-x', W09: '-x', W10: '-x',
};

export function groupOf(id) {
  if (id.startsWith('KF')) return 'kitchen-base';
  if (id.startsWith('KH')) return 'kitchen-wall';
  if (id.startsWith('KT')) return 'kitchen-tall';
  if (/^W(0[4-9]|10)$/.test(id)) return 'wardrobe-main';
  if (/^W(0[1-3]|_ADJ\d)$/.test(id)) return 'wardrobe-side';
  throw new Error(`Don't know which group ${id} belongs to.`);
}

export function defaultName(id) {
  const group = GROUPS.find((g) => g.id === groupOf(id));
  return `${group.label} ${id.replace(/^W_/, '')}`;
}

/** A node may be translated (a door at its hinge), but not turned, scaled or given a matrix. */
const onlyTranslated = (node) => {
  if (node.matrix && node.matrix.some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-6)) return false;
  if (node.scale && node.scale.some((v) => Math.abs(v - 1) > 1e-6)) return false;
  if (node.rotation && node.rotation.some((v, i) => Math.abs(v - (i === 3 ? 1 : 0)) > 1e-6)) return false;
  return true;
};

/**
 * The JSON chunk of a GLB, the union of its meshes' bounding boxes (each offset
 * by its nodes' translations) in the file's units, and how many doors and
 * drawers it has (`parts`). Throws when the file isn't a glTF 2 binary, when a
 * node is turned or scaled (the box would then be wrong), when a POSITION
 * accessor has no min/max, or when a part's extras are malformed.
 */
export function measureGlb(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.length < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  if (view.getUint32(4, true) !== 2) throw new Error(`glTF version ${view.getUint32(4, true)}, expected 2`);
  const chunkLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + chunkLength));

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let normals = true, primitives = 0, parts = 0;
  const visit = (index, offset) => {
    const node = json.nodes[index];
    if (!onlyTranslated(node)) throw new Error(`node ${index} is turned or scaled; bake that into the mesh first (only a translation is allowed)`);
    const at = offset.map((v, k) => v + (node.translation?.[k] ?? 0));
    const part = node.extras?.part;
    if (part !== undefined) {
      const okHinge = part === 'hinge' && Array.isArray(node.extras.axis) && node.extras.axis.length === 3 && Number.isFinite(node.extras.open);
      const okSlide = part === 'slide' && Array.isArray(node.extras.dir) && node.extras.dir.length === 3 && Number.isFinite(node.extras.open);
      if (!okHinge && !okSlide) throw new Error(`node ${index} has malformed part extras ${JSON.stringify(node.extras)}`);
      parts++;
    }
    if (node.mesh !== undefined) {
      for (const p of json.meshes[node.mesh].primitives) {
        const a = json.accessors[p.attributes.POSITION];
        if (!a?.min || !a?.max) throw new Error('a POSITION accessor has no min/max');
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], a.min[k] + at[k]);
          max[k] = Math.max(max[k], a.max[k] + at[k]);
        }
        if (p.attributes.NORMAL === undefined) normals = false;
        primitives++;
      }
    }
    for (const child of node.children ?? []) visit(child, at);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const n of scene?.nodes ?? []) visit(n, [0, 0, 0]);
  if (!primitives) throw new Error('no meshes in the default scene');
  return { json, min, max, normals, primitives, parts, materials: json.materials?.length ?? 0 };
}

/**
 * One manifest row from a measured file. `kept` is the row from the previous
 * manifest, whose hand-kept fields win over the defaults.
 */
export function describe(id, measured, bytes, kept = {}) {
  const group = groupOf(id);
  const front = kept.front ?? FRONT_OVERRIDES[id] ?? '+z';
  if (!['+x', '-x', '+z', '-z'].includes(front)) throw new Error(`${id}: front must be one of +x -x +z -z, not ${front}`);
  const x = measured.max[0] - measured.min[0], y = measured.max[1] - measured.min[1], z = measured.max[2] - measured.min[2];
  const swapped = front === '+x' || front === '-x';
  const row = {
    id,
    name: kept.name ?? defaultName(id),
    group,
    file: `models/mozu/${id}.glb`,
    width: Math.round(swapped ? z : x),
    depth: Math.round(swapped ? x : z),
    height: Math.round(y),
    elevation: kept.elevation ?? (group === 'kitchen-wall' ? WALL_ELEVATION : 0),
    front,
    ...(swapped ? { swapped: true } : {}),
    parts: measured.parts ?? 0,
    bytes,
  };
  const warnings = [];
  const g = GROUPS.find((e) => e.id === group);
  if (row.depth > row.width && row.depth > g.maxDepth) {
    warnings.push(`${id}: ${row.width} wide × ${row.depth} deep looks turned (deeper than wide and than any ${g.name.toLowerCase()} unit); set "front" to "+x" or "-x" if so`);
  } else if (row.depth > g.maxDepth) warnings.push(`${id}: ${row.depth} mm deep is more than a ${g.name.toLowerCase()} unit should be`);
  if (Math.abs(measured.min[1]) > 1) warnings.push(`${id}: base is at y = ${measured.min[1].toFixed(1)}, not 0`);
  const cx = (measured.min[0] + measured.max[0]) / 2, cz = (measured.min[2] + measured.max[2]) / 2;
  if (Math.abs(cx) > 1 || Math.abs(cz) > 1) warnings.push(`${id}: footprint is centred at (${cx.toFixed(1)}, ${cz.toFixed(1)}), not the origin`);
  if (!measured.normals) warnings.push(`${id}: no normals (the viewer computes flat ones)`);
  return { row, warnings };
}

export function buildManifest(dir = MODELS_DIR, previous = null) {
  const kept = new Map((previous?.models ?? []).map((m) => [m.id, m]));
  const files = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort();
  const rows = [], warnings = [];
  for (const file of files) {
    const id = file.slice(0, -4);
    const buffer = readFileSync(join(dir, file));
    const measured = measureGlb(buffer);
    const { row, warnings: w } = describe(id, measured, statSync(join(dir, file)).size, kept.get(id));
    rows.push(row);
    warnings.push(...w);
  }
  // Catalogue order: group by group, ids in order within each.
  const order = new Map(GROUPS.map((g, i) => [g.id, i]));
  rows.sort((a, b) => order.get(a.group) - order.get(b.group) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  for (const id of kept.keys()) if (!rows.some((r) => r.id === id)) warnings.push(`${id}: in the old manifest but there is no ${id}.glb any more`);
  return { manifest: { version: 1, models: rows }, warnings };
}

function main() {
  const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
  const { manifest, warnings } = buildManifest(MODELS_DIR, previous);
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  for (const m of manifest.models) {
    console.log(`${m.id.padEnd(7)} ${m.group.padEnd(14)} ${String(m.width).padStart(5)} × ${String(m.depth).padStart(4)} × ${String(m.height).padStart(4)} mm  front ${m.front}${m.parts ? `  ${m.parts} door/drawer${m.parts > 1 ? 's' : ''}` : ''}${m.elevation ? `  hung at ${m.elevation}` : ''}`);
  }
  for (const w of warnings) console.warn(`[models] warning: ${w}`);
  console.log(`[models] ${manifest.models.length} model(s) → lib/models.manifest.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
