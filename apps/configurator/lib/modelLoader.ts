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
 * A file may also carry doors and drawers as their own nodes (written by
 * tools/mozu/step-to-glb-parts.mjs): a node whose extras say `part: 'hinge'`
 * or `'slide'` sits at its pivot (the hinge line, or any point of a drawer),
 * in the closed pose, with its mesh relative to that pivot. Those become
 * `parts`; everything else is the `body`.
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

/** A door (turns about `axis` through `pivot`) or a drawer (slides along `dir`). Metres and radians. */
export interface ModelPart {
  kind: 'hinge' | 'slide';
  pivot: [number, number, number];
  /** The hinge axis, or the slide direction: a unit vector in the file's frame. */
  axis: [number, number, number];
  /** Fully open: radians for a hinge (signed, about `axis`), metres for a slide. */
  open: number;
  /** Relative to the pivot. */
  geometries: THREE.BufferGeometry[];
}

export interface LoadedModel {
  body: THREE.BufferGeometry[];
  parts: ModelPart[];
}

interface Entry {
  state: ModelState;
  model?: LoadedModel;
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

/** One mesh's geometry, moved by `matrix` and prepared for the scene (see the top of the file). */
function prepareMesh(mesh: THREE.Mesh, matrix: THREE.Matrix4): THREE.BufferGeometry {
  let g = mesh.geometry.clone();
  g.applyMatrix4(matrix);
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
  return g;
}

const vec3 = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n)) ? [v[0], v[1], v[2]] : null;

/** The loaded file as body geometry plus its doors and drawers. */
function prepare(scene: THREE.Group): LoadedModel {
  scene.updateMatrixWorld(true);
  const body: THREE.BufferGeometry[] = [];
  const parts: ModelPart[] = [];
  // A part's root is the node carrying the extras; GLTFLoader puts them in userData.
  const partOf = (o: THREE.Object3D): THREE.Object3D | null => {
    for (let p: THREE.Object3D | null = o; p && p !== scene; p = p.parent) {
      const kind = p.userData?.part;
      if (kind === 'hinge' || kind === 'slide') return p;
    }
    return null;
  };
  const byRoot = new Map<THREE.Object3D, ModelPart>();
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const root = partOf(mesh);
    if (!root) {
      body.push(prepareMesh(mesh, mesh.matrixWorld));
    } else {
      let part = byRoot.get(root);
      if (!part) {
        const x = root.userData;
        const pivot = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld).multiplyScalar(M);
        const axis = vec3(x.part === 'hinge' ? x.axis : x.dir) ?? (x.part === 'hinge' ? [0, 1, 0] : [0, 0, 1]);
        const open = Number.isFinite(x.open) ? (x.part === 'hinge' ? x.open : x.open * M) : 0;
        part = { kind: x.part, pivot: [pivot.x, pivot.y, pivot.z], axis, open, geometries: [] };
        byRoot.set(root, part);
        parts.push(part);
      }
      // The mesh relative to its part's root: the root's own translation is the pivot, not baked in.
      const local = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
      part.geometries.push(prepareMesh(mesh, local));
    }
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
  }
  return { body, parts };
}

function load(id: string) {
  const spec = modelById(id);
  if (!spec) return;
  entries.set(id, { state: 'loading' });
  loader ??= new GLTFLoader();
  loader.loadAsync(`/${spec.file}`).then(
    (gltf) => {
      entries.set(id, { state: 'ready', model: prepare(gltf.scene) });
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
export function getModel(id: string): LoadedModel | undefined {
  const e = entries.get(id);
  if (!e) {
    load(id);
    return undefined;
  }
  return e.model;
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
