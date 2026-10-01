import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Plain JavaScript, so the types come from the test's own description of it.
interface Measured { min: number[]; max: number[]; normals: boolean; primitives: number }
interface Row { id: string; name: string; group: string; width: number; depth: number; height: number; elevation: number; front: string; swapped?: boolean }
interface Script {
  measureGlb: (buffer: Buffer) => Measured;
  describe: (id: string, measured: Measured, bytes: number, kept?: object) => { row: Row; warnings: string[] };
}
const script = () => import(path.resolve(import.meta.dirname, '..', 'scripts', 'measure-models.mjs') as string) as Promise<Script>;
const glb = (id: string) => readFileSync(path.resolve(import.meta.dirname, '..', 'models', 'mozu', `${id}.glb`));

test('the GLB header and accessor bounds give a model’s size without reading the vertices', async () => {
  const { measureGlb } = await script();
  const m = measureGlb(glb('W03'));
  assert.deepEqual([m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]].map(Math.round), [450, 2350, 580]);
  assert.equal(m.min[1], 0, 'base on the floor');
  assert.ok(m.normals && m.primitives >= 1);
  assert.throws(() => measureGlb(Buffer.from('not a glb at all, honestly')), /GLB/);
});

test('a row swaps width and depth for a ±x front, hangs wall cabinets, and keeps hand-edited fields', async () => {
  const { measureGlb, describe } = await script();
  const kt01 = describe('KT01', measureGlb(glb('KT01')), 1).row;
  assert.deepEqual([kt01.width, kt01.depth, kt01.height, kt01.front, kt01.swapped, kt01.group], [936, 605, 2350, '+x', true, 'kitchen-tall']);
  const kh04 = describe('KH04', measureGlb(glb('KH04')), 1).row;
  assert.deepEqual([kh04.elevation, kh04.name, kh04.front], [1450, 'Wall cabinet KH04', '+z']);
  const kept = describe('KH04', measureGlb(glb('KH04')), 1, { front: '-x', name: 'Shelf', elevation: 1200 }).row;
  assert.deepEqual([kept.width, kept.depth, kept.front, kept.name, kept.elevation], [333, 900, '-x', 'Shelf', 1200]);
  assert.equal(describe('W_ADJ1', measureGlb(glb('W_ADJ1')), 1).row.name, 'Side cabinet ADJ1');
});
