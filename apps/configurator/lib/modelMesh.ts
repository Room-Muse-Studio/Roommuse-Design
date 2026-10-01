/**
 * Draw a MOZU model as Three.js objects: the file's geometry (shared, from
 * modelLoader.ts) in one finish, turned so its doors face +z. While the file
 * is still on its way, or if it never arrives, a plain box the item's size
 * stands in for it (`userData.placeholder`).
 *
 * Local frame, in metres: centred on the footprint, y up from the model's own
 * bottom, front toward +z.
 *
 * A model's doors and drawers (modelLoader.ts `parts`) are each a group at
 * their pivot, so opening one is a turn about its hinge or a slide along its
 * runners. `setDoorsOpen` moves them anywhere between closed (0) and open (1);
 * the viewer uses it to animate the change.
 */
import * as THREE from 'three';
import { finishMaterial, type Finish } from './finishes';
import { getModel, type ModelPart } from './modelLoader';
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

/** What `setDoorsOpen` needs, kept in the model root's `userData.doors` when the model has doors or drawers. */
export interface DoorRig {
  /** 0 closed … 1 open, as last set. */
  amount: number;
  parts: { group: THREE.Group; part: ModelPart }[];
}

const tmpAxis = new THREE.Vector3();

/** Move a model's doors and drawers to `amount` of the way open (0 closed, 1 open). */
export function setDoorsOpen(rig: DoorRig, amount: number) {
  rig.amount = amount;
  for (const { group, part } of rig.parts) {
    tmpAxis.fromArray(part.axis);
    if (part.kind === 'hinge') {
      group.quaternion.setFromAxisAngle(tmpAxis.normalize(), part.open * amount);
      group.position.fromArray(part.pivot);
    } else {
      group.quaternion.identity();
      group.position.fromArray(part.pivot).addScaledVector(tmpAxis, part.open * amount);
    }
  }
}

export function buildModel(modelId: string, size: ModelSize, finish: Finish, open = false): THREE.Group {
  const root = new THREE.Group();
  const material = modelMaterial(finish);
  const spec = modelById(modelId);
  const model = spec && getModel(modelId);
  if (!spec || !model) {
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
  const meshOf = (g: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  };
  for (const g of model.body) inner.add(meshOf(g));
  if (model.parts.length) {
    const rig: DoorRig = { amount: 0, parts: [] };
    for (const part of model.parts) {
      const group = new THREE.Group();
      group.name = part.kind === 'hinge' ? 'door' : 'drawer';
      for (const g of part.geometries) group.add(meshOf(g));
      inner.add(group);
      rig.parts.push({ group, part });
    }
    setDoorsOpen(rig, open ? 1 : 0);
    root.userData.doors = rig;
  }
  root.add(inner);
  return root;
}
