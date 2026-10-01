import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateGroups, isKitchen, matchStorage, nearestModel, sizeScore } from '../lib/scanMatch';
import { modelById, modelsIn } from '../lib/models';

test('a kitchen is told by the room type, or failing that its name', () => {
  assert.ok(isKitchen({ type: 'kitchen' }));
  assert.ok(isKitchen({ name: 'Kitchen / diner' }));
  assert.ok(!isKitchen({ type: 'bedroom', name: 'Bedroom A' }));
  assert.ok(!isKitchen({}));
});

test('where a thing stands decides which groups it may become', () => {
  assert.deepEqual(candidateGroups({ height: 300, elevation: 1500 }, false), ['kitchen-wall'], 'hung on the wall');
  assert.deepEqual(candidateGroups({ height: 900, elevation: 0 }, false), ['kitchen-base', 'wardrobe-side'], 'counter height');
  assert.deepEqual(candidateGroups({ height: 2000, elevation: 0 }, false), ['wardrobe-main', 'wardrobe-side'], 'tall, in a bedroom');
  assert.deepEqual(candidateGroups({ height: 2000, elevation: 0 }, true), ['kitchen-tall', 'wardrobe-main', 'wardrobe-side'], 'tall, in a kitchen');
});

test('the nearest model counts height double; ties go to the first in the catalogue', () => {
  const kf06 = modelById('KF06')!;
  assert.equal(sizeScore({ width: 900, depth: 600, height: 800 }, kf06), 0);
  assert.equal(sizeScore({ width: 910, depth: 590, height: 850 }, kf06), 10 + 10 + 100);
  // W05–W09 are the same size: W05 is first.
  assert.equal(nearestModel({ width: 900, depth: 580, height: 2400 }, modelsIn('wardrobe-main'))!.id, 'W05');
  assert.equal(nearestModel({ width: 900, depth: 560, height: 2400 }, modelsIn('wardrobe-main'))!.id, 'W04');
  assert.equal(nearestModel({ width: 1, depth: 1, height: 1 }, []), undefined);
});

test('scanned storage becomes the MOZU model you would expect', () => {
  assert.equal(matchStorage({ width: 1200, depth: 600, height: 2000, elevation: 0 }, false)!.id, 'W05', 'a bedroom wardrobe');
  assert.equal(matchStorage({ width: 900, depth: 250, height: 300, elevation: 1500 }, false)!.id, 'KH04', 'a wall shelf');
  // The tall units are 600 wide (KT01–05) or 900 (KT06, the fridge unit), measured with their doors shut.
  assert.equal(matchStorage({ width: 1000, depth: 600, height: 2300, elevation: 0 }, true)!.id, 'KT06', 'a wide tall unit in a kitchen');
  assert.equal(matchStorage({ width: 600, depth: 600, height: 2300, elevation: 0 }, true)!.id, 'KT01', 'a tall unit in a kitchen');
  assert.equal(matchStorage({ width: 1000, depth: 600, height: 2300, elevation: 0 }, false)!.group, 'wardrobe-main', 'the same thing in a bedroom is a wardrobe');
  assert.equal(matchStorage({ width: 450, depth: 450, height: 500, elevation: 0 }, false)!.id, 'W_ADJ1', 'a low cupboard');
});
