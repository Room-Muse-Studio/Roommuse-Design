import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fitScale, hasDoors, MODEL_GROUPS, MODEL_SPECS, modelById, modelsIn, yawOf } from '../lib/models';

const MODELS = path.resolve(import.meta.dirname, '..', 'models');

test('the manifest lists MOZU’s 30 models, each once, in a known group, with its file present and unchanged', () => {
  assert.equal(MODEL_SPECS.length, 30);
  assert.equal(new Set(MODEL_SPECS.map((m) => m.id)).size, 30, 'ids are unique');
  const groups = new Set(MODEL_GROUPS.map((g) => g.id));
  for (const m of MODEL_SPECS) {
    assert.ok(groups.has(m.group), `${m.id}: group ${m.group}`);
    assert.ok(m.width > 0 && m.depth > 0 && m.height > 0, `${m.id}: size`);
    const file = path.join(MODELS, m.file.replace(/^models\//, ''));
    assert.ok(existsSync(file), `${m.id}: ${m.file} exists`);
    assert.equal(statSync(file).size, m.bytes, `${m.id}: measured from the file as it is now`);
  }
  assert.deepEqual(['kitchen-base', 'kitchen-wall', 'kitchen-tall', 'wardrobe-main', 'wardrobe-side'].map((g) => modelsIn(g as never).length), [8, 4, 6, 7, 5]);
});

test('kitchen wall cabinets hang at 1450; everything else stands on the floor', () => {
  for (const m of MODEL_SPECS) assert.equal(m.elevation, m.group === 'kitchen-wall' ? 1450 : 0, m.id);
});

test('only the main wardrobes are turned a quarter (open side toward -x), so their width is their longer side', () => {
  for (const m of MODEL_SPECS) {
    const turned = /^W(0[4-9]|10)$/.test(m.id);
    assert.equal(!!m.swapped, turned, `${m.id}: swapped`);
    assert.equal(m.front, turned ? '-x' : '+z', `${m.id}: front`);
    if (turned) assert.ok(m.width > m.depth, `${m.id}: ${m.width} wide × ${m.depth} deep`);
  }
  assert.equal(modelById('W05')!.width, 900);
  // The tall units measured with their doors closed: 600 wide, about 610 deep.
  for (const id of ['KT01', 'KT02', 'KT03', 'KT04', 'KT05']) {
    const m = modelById(id)!;
    assert.equal(m.width, 600, `${id} width`);
    assert.ok(m.depth >= 600 && m.depth <= 640, `${id}: ${m.depth} deep`);
  }
});

test('the kitchen units have doors or drawers that open; the wardrobes and KF04 have none', () => {
  for (const m of MODEL_SPECS) {
    const expected = m.id.startsWith('K') && m.id !== 'KF04';
    assert.equal(m.parts > 0, expected, `${m.id}: ${m.parts} parts`);
    assert.equal(hasDoors(m.id), expected, m.id);
  }
  assert.equal(modelById('KF06')!.parts, 3);
  assert.equal(modelById('KH02')!.parts, 2);
  assert.equal(hasDoors('nope'), false);
});

test('a front of +x turns -90° to face +z; a model is drawn at its own size', () => {
  assert.equal(yawOf('+z'), 0);
  assert.equal(yawOf('-z'), Math.PI);
  assert.equal(yawOf('+x'), -Math.PI / 2);
  assert.equal(yawOf('-x'), Math.PI / 2);
  const kf01 = modelById('KF01')!;
  assert.equal(fitScale({ width: 455, depth: 600, height: 800 }, kf01), 1);
  assert.equal(fitScale({ width: 457, depth: 602, height: 804 }, kf01), 1, 'within 1 %');
  assert.equal(fitScale({ width: 455, depth: 300, height: 800 }, kf01), 0.5, 'shrunk to the tightest axis');
});
