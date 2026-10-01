import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MODEL_SPECS, modelById } from '../lib/models';

// The doors and drawers in the model files (tools/mozu/step-to-glb-parts.mjs), read from each GLB's JSON chunk.
interface Node { name?: string; mesh?: number; translation?: number[]; extras?: { part?: string; axis?: number[]; dir?: number[]; open?: number } }
interface Gltf { nodes: Node[]; meshes: { primitives: { attributes: Record<string, number> }[] }[]; accessors: { min: number[]; max: number[] }[] }

const MODELS = path.resolve(import.meta.dirname, '..', 'models');
function gltf(file: string): Gltf {
  const buf = readFileSync(path.join(MODELS, file.replace(/^models\//, '')));
  return JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
}
const boxOf = (g: Gltf, n: Node) => {
  const a = g.accessors[g.meshes[n.mesh!].primitives[0].attributes.POSITION];
  return { min: a.min, max: a.max };
};

test('every model with parts has that many door/drawer nodes, each well formed and closed against the front', () => {
  for (const spec of MODEL_SPECS) {
    const g = gltf(spec.file);
    const parts = g.nodes.filter((n) => n.extras?.part);
    assert.equal(parts.length, spec.parts, `${spec.id}: manifest parts`);
    const body = g.nodes.find((n) => n.name === 'body');
    assert.ok(body && body.mesh !== undefined && !body.translation, `${spec.id}: an untranslated body node`);
    for (const n of parts) {
      const x = n.extras!;
      const label = `${spec.id} ${n.name}`;
      assert.ok(n.mesh !== undefined && n.translation?.length === 3, `${label}: mesh and pivot`);
      const { min, max } = boxOf(g, n);
      if (x.part === 'hinge') {
        assert.match(n.name!, /^door:\d+$/);
        assert.deepEqual(x.axis, [0, 1, 0], `${label}: vertical hinge`);
        assert.ok(Math.abs(Math.abs(x.open!) - (95 * Math.PI) / 180) < 1e-3, `${label}: swings 95°`);
        assert.ok(max[2] - min[2] <= 45, `${label}: closed, it is a slab facing z (${max[2] - min[2]} mm)`);
        // The pivot is at one vertical edge, inside the slab; the door reaches across from it.
        const reach = Math.max(-min[0], max[0]);
        assert.ok(Math.min(-min[0], max[0]) < 40 && reach > 200, `${label}: hinge at an edge`);
        // Opening swings the free edge out of the front (+z).
        const free = -min[0] > max[0] ? min[0] : max[0];
        assert.ok(-free * Math.sin(x.open!) > 100, `${label}: swings outward`);
      } else {
        assert.equal(x.part, 'slide', label);
        assert.match(n.name!, /^drawer:\d+$/);
        assert.deepEqual(x.dir, [0, 0, 1], `${label}: slides out of the front`);
        assert.ok(x.open! > 100 && x.open! < max[2] - min[2], `${label}: slides ${x.open} mm`);
      }
    }
  }
});

test('KT01 measures with its door closed: 600 wide, about 610 deep, hinged on the left', () => {
  const kt01 = modelById('KT01')!;
  assert.deepEqual([kt01.width, kt01.height, kt01.front], [600, 2350, '+z']);
  assert.ok(kt01.depth >= 600 && kt01.depth <= 615, `${kt01.depth}`);
  const g = gltf(kt01.file);
  const door = g.nodes.find((n) => n.name === 'door:0')!;
  assert.ok(door.translation![0] < -280, 'the hinge is at the left edge (seen from the front)');
  assert.ok(door.extras!.open! < 0, 'a left hinge opens with a negative turn about +y');
});
