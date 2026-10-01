/**
 * Draw an Item: a MOZU model through the model builder, centred on the item's
 * footprint, so placing and turning work the same for everything.
 */
import * as THREE from 'three';
import type { Item } from './items';
import { buildModel } from './modelMesh';

const M = 1 / 1000;

/**
 * `open` draws the doors and drawers open (the item's `open`, unless the caller
 * says otherwise: pictures are always closed). The model's door rig, if it has
 * one, is passed up to the item's `userData.doors` for the viewer to animate.
 */
export function buildItem(item: Pick<Item, 'builder' | 'size' | 'finishes' | 'open'>, open = !!item.open): THREE.Group {
  const root = new THREE.Group();
  const model = buildModel(item.builder.modelId, item.size, item.finishes.primary, open);
  if (model.userData.doors) root.userData.doors = model.userData.doors;
  root.add(model);
  return root;
}

/** Stand a built item at its centre and turn it (scan rotation → Three.js, hence the minus). */
export function positionItem(obj: THREE.Object3D, item: Pick<Item, 'center' | 'rotation' | 'size'>) {
  obj.position.set(item.center.x * M, item.size.elevation * M, item.center.z * M);
  obj.rotation.y = -item.rotation;
}
