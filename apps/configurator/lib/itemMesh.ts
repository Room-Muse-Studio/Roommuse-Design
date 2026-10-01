/**
 * Draw an Item: MOZU models through the model builder, the old procedural
 * cabinets and furniture through theirs. Either way the result is centred on
 * the item's footprint, so placing and turning work the same for all.
 */
import * as THREE from 'three';
import type { Item } from './items';
import { moduleById } from './modules';
import { buildModule } from './moduleMesh';
import { buildFurniture } from './furnitureMesh';
import { buildModel } from './modelMesh';

const M = 1 / 1000;

export function buildItem(item: Pick<Item, 'builder' | 'size' | 'finishes'>): THREE.Group {
  const root = new THREE.Group();
  const { primary, secondary } = item.finishes;
  if (item.builder.kind === 'model') {
    root.add(buildModel(item.builder.modelId, item.size, primary));
  } else if (item.builder.kind === 'module') {
    const spec = moduleById(item.builder.moduleId);
    if (spec) {
      const cabinet = buildModule(spec, { front: primary, carcass: secondary });
      cabinet.position.z = (-item.size.depth / 2) * M; // the builder's origin is the cabinet's back
      root.add(cabinet);
    }
  } else {
    root.add(buildFurniture(item.builder.type, item.size, primary, secondary));
  }
  return root;
}

/** Stand a built item at its centre and turn it (scan rotation → Three.js, hence the minus). */
export function positionItem(obj: THREE.Object3D, item: Pick<Item, 'center' | 'rotation' | 'size'>) {
  obj.position.set(item.center.x * M, item.size.elevation * M, item.center.z * M);
  obj.rotation.y = -item.rotation;
}
