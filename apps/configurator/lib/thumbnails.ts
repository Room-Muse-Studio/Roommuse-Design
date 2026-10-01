/**
 * Pictures of items, rendered with the same builder the 3D view uses, so a
 * picture always matches what gets placed (and its current finish).
 *
 * One small off-screen renderer is shared by every picture; browsers limit how
 * many WebGL contexts a page may hold. Browser only.
 */
import * as THREE from 'three';
import type { Item } from './items';
import { buildItem } from './itemMesh';
import { modelState } from './modelLoader';

const SIZE = 192;
const cache = new Map<string, string>();
let stage: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;

function getStage() {
  if (!stage) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8bd, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(-2, 3, 4);
    scene.add(key);
    stage = { renderer, scene, camera: new THREE.PerspectiveCamera(30, 1, 0.01, 50) };
  }
  return stage;
}

/** A PNG data URL of the item, seen from the front and a little to the left, doors closed (whatever its `open`). */
export function itemThumbnail(item: Pick<Item, 'builder' | 'size' | 'finishes'>): string {
  const f = item.finishes, s = item.size;
  // A model's picture changes when its file arrives: until then it shows the placeholder box.
  const state = item.builder.kind === 'model' ? modelState(item.builder.modelId) : '';
  const key = [JSON.stringify(item.builder), state, s.width, s.depth, s.height,
    f.primary.color, f.primary.pattern, f.primary.sheen, f.secondary.color, f.secondary.pattern, f.secondary.sheen].join('|');
  const hit = cache.get(key);
  if (hit) return hit;

  const { renderer, scene, camera } = getStage();
  const obj = buildItem(item, false);
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.02;
  camera.position.copy(center).addScaledVector(new THREE.Vector3(-0.45, 0.3, 1).normalize(), distance);
  camera.near = distance / 50;
  camera.far = distance * 4;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');

  scene.remove(obj);
  // Materials are shared between items and kept; so is a model file's geometry.
  obj.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g && !g.userData.shared) g.dispose();
  });
  cache.set(key, url);
  return url;
}
