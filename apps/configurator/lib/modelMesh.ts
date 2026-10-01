/**
 * Draw a MOZU model as Three.js objects: the file's geometry (shared, from
 * modelLoader.ts) in one finish, turned so its doors face +z. While the file
 * is still on its way, or if it never arrives, a plain box the item's size
 * stands in for it (`userData.placeholder`).
 *
 * Local frame, in metres: centred on the footprint, y up from the model's own
 * bottom, front toward +z.
 */
import * as THREE from 'three';
import { finishMaterial, type Finish } from './finishes';
import { getModel } from './modelLoader';
import { fitScale, modelById, yawOf } from './models';

const M = 1 / 1000;

const materials = new Map<string, THREE.MeshStandardMaterial>();
/** One material per finish, shared by every model that wears it. Double-sided: the files are single surfaces, not solids. */
export function modelMaterial(finish: Finish): THREE.MeshStandardMaterial {
  const key = `${finish.color}|${finish.pattern}|${finish.sheen}`;
  let m = materials.get(key);
  if (!m) {
    m = finishMaterial(finish);
    m.side = THREE.DoubleSide;
    materials.set(key, m);
  }
  return m;
}

export interface ModelSize {
  width: number;
  depth: number;
  height: number;
}

export function buildModel(modelId: string, size: ModelSize, finish: Finish): THREE.Group {
  const root = new THREE.Group();
  const material = modelMaterial(finish);
  const spec = modelById(modelId);
  const geometries = spec && getModel(modelId);
  if (!spec || !geometries) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(size.width * M, size.height * M, size.depth * M), material);
    box.position.y = (size.height / 2) * M;
    box.castShadow = box.receiveShadow = true;
    root.add(box);
    root.userData.placeholder = true;
    return root;
  }
  root.name = spec.name;
  const inner = new THREE.Group();
  inner.rotation.y = yawOf(spec.front);
  inner.scale.setScalar(fitScale(size, spec));
  for (const g of geometries) {
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = mesh.receiveShadow = true;
    inner.add(mesh);
  }
  root.add(inner);
  return root;
}
