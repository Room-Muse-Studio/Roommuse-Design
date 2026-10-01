/**
 * Fetch the model files and keep their geometry, once each, for every item and
 * thumbnail that uses them. Browser only.
 *
 * The files are plain grey meshes: no UVs, some without normals, in
 * millimetres. Each is prepared once on arrival — transforms baked, normals
 * computed where missing, box-projected UVs so a wood finish shows grain,
 * scaled to metres — and the prepared geometry is shared, never disposed
 * (`userData.shared`). The file's own materials are thrown away: an item's
 * finish supplies the material.
 *
 * Loading is asynchronous, so a scene built before a model arrives shows a
 * placeholder. `subscribeModels` tells React when any model's state changes
 * (at most once per frame) so it rebuilds; `getModel` starts the fetch on the
 * first ask and answers immediately either way.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TILE_MM } from './finishes';
import { modelById } from './models';

const M = 1 / 1000;

export type ModelState = 'idle' | 'loading' | 'ready' | 'failed';

interface Entry {
  state: ModelState;
  geometries?: THREE.BufferGeometry[];
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
let scheduled = false;
let loader: GLTFLoader | null = null;

/** Tell subscribers something changed, once per frame however many models arrive together. */
function notify() {
  if (scheduled) return;
  scheduled = true;
  const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f: () => void) => setTimeout(f, 0);
  later(() => {
    scheduled = false;
    version++;
    for (const l of listeners) l();
  });
}

/**
 * UVs by box projection: each vertex is mapped by the two coordinates across
 * its dominant normal direction, so a texture tile covers TILE_MM of surface
 * on every face, the way the old procedural cabinets did. Needs normals.
 */
function projectUVs(geometry: THREE.BufferGeometry) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (ny >= nx && ny >= nz) [u, v] = [x, z]; // top or bottom
    else if (nx >= nz) [u, v] = [z, y]; // a side
    else [u, v] = [x, y]; // front or back
    uv[i * 2] = u / TILE_MM;
    uv[i * 2 + 1] = v / TILE_MM;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** The geometry of a loaded file, prepared for the scene (see the top of the file). */
function prepare(scene: THREE.Group): THREE.BufferGeometry[] {
  scene.updateMatrixWorld(true);
  const out: THREE.BufferGeometry[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.getAttribute('normal')) {
      // Flat shading needs its own vertex per face corner.
      g = g.toNonIndexed();
      g.computeVertexNormals();
    }
    projectUVs(g);
    g.scale(M, M, M);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData.shared = true;
    out.push(g);
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
  });
  return out;
}

function load(id: string) {
  const spec = modelById(id);
  if (!spec) return;
  entries.set(id, { state: 'loading' });
  loader ??= new GLTFLoader();
  loader.loadAsync(`/${spec.file}`).then(
    (gltf) => {
      entries.set(id, { state: 'ready', geometries: prepare(gltf.scene) });
      notify();
    },
    (e) => {
      console.error(`[models] ${id} did not load:`, e);
      entries.set(id, { state: 'failed' });
      notify();
    },
  );
}

export const modelState = (id: string): ModelState => entries.get(id)?.state ?? 'idle';

/** The model's geometry (metres, as in the file: not yet turned by `front`), or undefined while it's on its way. Starts the fetch. */
export function getModel(id: string): THREE.BufferGeometry[] | undefined {
  const e = entries.get(id);
  if (!e) {
    load(id);
    return undefined;
  }
  return e.geometries;
}

export function preloadModels(ids: string[]) {
  for (const id of ids) if (!entries.has(id)) load(id);
}

export const modelsVersion = () => version;

export function subscribeModels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
