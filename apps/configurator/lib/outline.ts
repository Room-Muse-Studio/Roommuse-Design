import * as THREE from 'three';

/**
 * The box drawn around a selected item (and around the item a drop would swap
 * with). It is a child of the item, measured in the item's own frame, so it
 * turns with the item. THREE.BoxHelper can't do that: it always draws the
 * world-axis-aligned bounds, which on a scanned room at an angle looks like a
 * box twisted away from the furniture.
 */
export class ItemOutline extends THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  constructor(target: THREE.Object3D, color: number) {
    super(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    this.name = 'outline';
    this.renderOrder = 999; // over the item, never hidden by its own faces
    this.frustumCulled = false;
    this.raycast = () => { /* never picked */ };
    this.fit(target);
    target.add(this);
  }

  /** Measure the item's meshes in its own frame and rebuild the box. */
  fit(target: THREE.Object3D) {
    const bounds = localBounds(target, this);
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    bounds.getSize(size);
    bounds.getCenter(centre);
    this.geometry.dispose();
    const box = new THREE.BoxGeometry(size.x, size.y, size.z);
    this.geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    this.position.copy(centre);
  }

  setColor(color: number) {
    this.material.color.set(color);
  }

  dispose() {
    this.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Bounds of every mesh under `root`, expressed in `root`'s local space. */
function localBounds(root: THREE.Object3D, skip: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const toLocal = root.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  const part = new THREE.Box3();
  const relative = new THREE.Matrix4();
  root.traverse((o) => {
    if (o === skip) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    part.copy(mesh.geometry.boundingBox!).applyMatrix4(relative.multiplyMatrices(toLocal, mesh.matrixWorld));
    bounds.union(part);
  });
  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.1, 0.1, 0.1));
  return bounds;
}
