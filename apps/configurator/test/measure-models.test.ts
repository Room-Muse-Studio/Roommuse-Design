import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Plain JavaScript, so the types come from the test's own description of it.
interface Measured { min: number[]; max: number[]; normals: boolean; primitives: number; parts: number }
interface Row { id: string; name: string; group: string; width: number; depth: number; height: number; elevation: number; front: string; swapped?: boolean; parts: number }
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

test('a row swaps width and depth for a ±x front, hangs wall cabinets, counts doors, and keeps hand-edited fields', async () => {
  const { measureGlb, describe } = await script();
  const w05 = describe('W05', measureGlb(glb('W05')), 1).row;
  assert.deepEqual([w05.width, w05.depth, w05.height, w05.front, w05.swapped, w05.group, w05.parts], [900, 580, 2400, '-x', true, 'wardrobe-main', 0]);
  const kt01 = describe('KT01', measureGlb(glb('KT01')), 1).row;
  assert.deepEqual([kt01.width, kt01.height, kt01.front, kt01.swapped, kt01.parts], [600, 2350, '+z', undefined, 1]);
  assert.ok(kt01.depth >= 605 && kt01.depth <= 615, `KT01 closed is ${kt01.depth} deep`);
  const kh04 = describe('KH04', measureGlb(glb('KH04')), 1).row;
  assert.deepEqual([kh04.elevation, kh04.name, kh04.front, kh04.parts], [1450, 'Wall cabinet KH04', '+z', 2]);
  const kept = describe('KH04', measureGlb(glb('KH04')), 1, { front: '-x', name: 'Shelf', elevation: 1200 }).row;
  assert.deepEqual([kept.width, kept.depth, kept.front, kept.name, kept.elevation], [330, 900, '-x', 'Shelf', 1200]);
  assert.equal(describe('W_ADJ1', measureGlb(glb('W_ADJ1')), 1).row.name, 'Side cabinet ADJ1');
});

/** A minimal GLB: one JSON chunk, no binary (the measurer never reads vertices). */
function fakeGlb(json: object): Buffer {
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, text]);
}

test('a translated node offsets its box; door and drawer nodes are counted; a turned node is refused', async () => {
  const { measureGlb } = await script();
  const mesh = (i: number) => ({ primitives: [{ attributes: { POSITION: i, NORMAL: i } }] });
  const json = {
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [
      { name: 'body', mesh: 0 },
      { name: 'door:0', mesh: 1, translation: [-300, 0, 300], extras: { part: 'hinge', axis: [0, 1, 0], open: -1.658 } },
      { name: 'drawer:0', mesh: 1, translation: [0, 100, 280], extras: { part: 'slide', dir: [0, 0, 1], open: 300 } },
    ],
    meshes: [mesh(0), mesh(1)],
    accessors: [
      { min: [-300, 0, -300], max: [300, 800, 280] },
      { min: [0, 0, -10], max: [600, 700, 20] },
    ],
  };
  const m = measureGlb(fakeGlb(json));
  assert.deepEqual(m.min, [-300, 0, -300]);
  assert.deepEqual(m.max, [600, 800, 320], 'each mesh box moved by its node translation');
  assert.equal(m.parts, 2);
  const turned = structuredClone(json);
  (turned.nodes[1] as Record<string, unknown>).rotation = [0, 0.7071, 0, 0.7071];
  assert.throws(() => measureGlb(fakeGlb(turned)), /turned or scaled/);
  const bad = structuredClone(json);
  (bad.nodes[2] as Record<string, unknown>).extras = { part: 'slide', open: 300 };
  assert.throws(() => measureGlb(fakeGlb(bad)), /malformed part extras/);
});
