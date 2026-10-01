import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fitScale, MODEL_GROUPS, MODEL_SPECS, modelById, modelsIn, yawOf } from '../lib/models';

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

test('the swapped files are turned a quarter, so their width is their longer side', () => {
  for (const id of ['KT01', 'KT02', 'KT03', 'KT04', 'KT05', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10']) {
    const m = modelById(id)!;
    assert.ok(m.swapped && (m.front === '+x' || m.front === '-x'), `${id}: front ${m.front}`);
    assert.ok(m.width > m.depth, `${id}: ${m.width} wide × ${m.depth} deep`);
  }
  assert.equal(modelById('W05')!.width, 900);
  assert.equal(modelById('KT01')!.depth, 605);
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
