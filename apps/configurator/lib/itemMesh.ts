/**
 * Draw an Item: a MOZU model through the model builder, centred on the item's
 * footprint, so placing and turning work the same for everything.
 */
import * as THREE from 'three';
import type { Item } from './items';
import { buildModel } from './modelMesh';

const M = 1 / 1000;

export function buildItem(item: Pick<Item, 'builder' | 'size' | 'finishes'>): THREE.Group {
  const root = new THREE.Group();
  root.add(buildModel(item.builder.modelId, item.size, item.finishes.primary));
  return root;
}

/** Stand a built item at its centre and turn it (scan rotation → Three.js, hence the minus). */
export function positionItem(obj: THREE.Object3D, item: Pick<Item, 'center' | 'rotation' | 'size'>) {
  obj.position.set(item.center.x * M, item.size.elevation * M, item.center.z * M);
  obj.rotation.y = -item.rotation;
}
