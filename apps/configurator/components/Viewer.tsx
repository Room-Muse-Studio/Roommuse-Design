'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { scanFromParams, type HomeScan, type RoomScan, type Vec2 } from '@mozu/scan-sdk';
import { loadHome, type ViewerHome } from '@/lib/home';
import { buildHome, setVisible, type RoomView } from '@/lib/scene';
import {
  fitsAt, fitsRoom, freeSpot, itemFromSpec, itemsFromScan, overlapping, settle, snapToWall, specById, swapPlaces,
  type Item, type Slot,
} from '@/lib/items';
import { buildItem, positionItem } from '@/lib/itemMesh';
import { preloadModels } from '@/lib/modelLoader';
import { MODEL_SPECS } from '@/lib/models';
import { ItemOutline } from '@/lib/outline';
import { containsPoint } from '@/lib/walls';
import type { Finish } from '@/lib/finishes';
import { api, ApiError, createProject, fetchScanByCode, renameProject, type ProjectRecord } from '@/lib/api';
import { captureThumbnail } from '@/lib/capture';
import { bbox } from '@/lib/dimensions';
import { stashGuestWork, takeGuestStash } from '@/lib/guestStash';
import { canRedo, canUndo, emptyHistory, record, redo, undo, type History } from '@/lib/history';
import { DEFAULT_SAMPLE, type OpenRequest } from '@/lib/openRequest';
import { defaultProjectName, sourceOf, statusText, subtitleText, type Origin, type SyncState } from '@/lib/status';
import BottomToolbar, { type ViewMode } from './BottomToolbar';
import ItemDrawer, { RAIL_SECTIONS } from './ItemDrawer';
import ItemToolbar from './ItemToolbar';
import NewProjectDialog from './NewProjectDialog';
import Rail from './Rail';
import SpacesPopover, { ALL_ROOMS as ALL } from './SpacesPopover';
import SummaryCard from './SummaryCard';
import Toast from './Toast';
import TopBar from './TopBar';
import { useAuth } from './useAuth';
import { useModelsVersion } from './useModels';
import { useProjectSync } from './useProjectSync';

const ACCENT = 0xc33a20, BLOCKED = 0x8a8f94, SWAP = 0x2f6fd6;

interface Stage {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  persp: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
  /** The camera in use: perspective in 3D, top-down orthographic in 2D. */
  camera: THREE.Camera;
  /** Half the height the orthographic camera shows, in metres (kept for resizes). */
  orthoHalf: number;
  controls: OrbitControls;
  home?: { views: RoomView[]; dispose: () => void };
  /** Outline around the selected item, and the item the edit menu floats over. */
  highlight?: ItemOutline;
  selected?: THREE.Object3D;
  /** Outline around the item a drop would swap with. */
  swapHighlight?: ItemOutline;
}

/** What a finished drag asks for. */
type DragResult =
  | { uid: number; kind: 'move'; roomKey: string; center: Vec2 }
  | { uid: number; kind: 'swap'; with: number; from: { center: Vec2; rotation: number } }
  | { uid: number; kind: 'none' };

/** Free an item's geometry. Materials, and the geometry of a model file, are shared between items and kept. */
function clearItems(group: THREE.Group) {
  group.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g && !g.userData.shared) g.dispose();
  });
  group.clear();
}

/** The ids of the models the items use, each once. */
const modelIds = (items: Item[]) => [...new Set(items.flatMap((i) => (i.builder.kind === 'model' ? [i.builder.modelId] : [])))];

/** Point the camera at everything visible: from above and to one side in 3D, straight down in 2D. */
function frame(stage: Stage) {
  const box = new THREE.Box3();
  for (const v of stage.home?.views ?? []) if (v.group.visible) box.expandByObject(v.group);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  if (stage.camera === stage.persp) {
    const fov = THREE.MathUtils.degToRad(stage.persp.fov);
    const distance = (radius / Math.sin(fov / 2)) * 1.05;
    const direction = new THREE.Vector3(0.35, 1.1, 0.9).normalize();
    stage.persp.position.copy(center).addScaledVector(direction, distance);
    stage.persp.near = distance / 100;
    stage.persp.far = distance * 20;
    stage.persp.updateProjectionMatrix();
  } else {
    const distance = radius * 3 + 5;
    stage.ortho.position.set(center.x, center.y + distance, center.z);
    stage.ortho.near = 0.01;
    stage.ortho.far = distance * 4;
    stage.ortho.zoom = 1;
    stage.orthoHalf = radius * 1.2; // room for the floating bars around the plan
    fitOrtho(stage);
  }
  stage.controls.target.copy(center);
  stage.controls.update();
}

/** The orthographic frustum for the canvas's aspect ratio. */
function fitOrtho(stage: Stage) {
  const size = stage.renderer.getSize(new THREE.Vector2());
  const aspect = size.x / Math.max(1, size.y);
  const half = stage.orthoHalf;
  stage.ortho.left = -half * aspect;
  stage.ortho.right = half * aspect;
  stage.ortho.top = half;
  stage.ortho.bottom = -half;
  stage.ortho.updateProjectionMatrix();
}

const toScan = (home: ViewerHome): HomeScan => ({
  schema: 'mozu.homescan/1',
  rooms: home.rooms.map((r) => r.scan),
  capturedAt: home.rooms[0]?.scan.capturedAt ?? new Date().toISOString(),
  ...(home.connections.length ? { connections: home.connections } : {}),
});

export default function Viewer({ request }: { request: OpenRequest }) {
  const projectId = request.kind === 'project' ? request.id : null;
  const { user, setUser } = useAuth();
  // Changes when a model file arrives: everything drawn from models is redrawn.
  const modelsVersion = useModelsVersion();
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [home, setHome] = useState<ViewerHome | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  /** The scan as opened, for a guest's "Save to my projects". */
  const [guestScan, setGuestScan] = useState<HomeScan | RoomScan | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(ALL);
  const [ceilings, setCeilings] = useState(false);
  const [view, setView] = useState<ViewMode>('3d');
  const [section, setSection] = useState<string | null>('kitchen');
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  /** Everything standing in the rooms: the scan's furniture and whatever has been added. */
  const [items, setItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [targetRoom, setTargetRoom] = useState('');
  const [toast, setToast] = useState('');
  const [toolbarMessage, setToolbarMessage] = useState('');
  const [busy, setBusy] = useState('');
  const nextUid = useRef(1);
  // Items to start from instead of the scan's furniture (a saved design, a guest's stash).
  const pendingItems = useRef<Item[] | null>(null);
  // Tell the sync hook the starting items once the next scan is shown.
  const pendingMark = useRef(false);
  // A guest's stash restored after sign-in: save it to the account as soon as we're signed in.
  const autoSave = useRef(false);

  // The pointer handlers live as long as the renderer; they read the latest state through these.
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const homeRef = useRef<ViewerHome | null>(null);
  homeRef.current = home;
  const pickRef = useRef<(uid: number | null) => void>(() => {});
  pickRef.current = (uid) => {
    setPicked(uid);
    setToolbarMessage('');
  };
  const dropRef = useRef<(r: DragResult) => void>(() => {});
  dropRef.current = (r) => {
    if (r.kind === 'move') {
      setItems((list) => list.map((i) => (i.uid === r.uid ? { ...i, roomKey: r.roomKey, center: r.center } : i)));
      return;
    }
    if (r.kind === 'swap') {
      const a = items.find((i) => i.uid === r.uid), b = items.find((i) => i.uid === r.with);
      const room = b && home?.rooms.find((x) => x.key === b.roomKey);
      const rest = items.filter((i) => i.roomKey === b?.roomKey && i !== a && i !== b);
      const result = a && b && room ? swapPlaces(room.scan, a, r.from, b, rest) : null;
      if (result) {
        setItems((list) => list.map((i) => (i.uid === r.uid ? { ...i, ...result.a } : i.uid === r.with ? { ...i, ...result.b } : i)));
        return;
      }
      setToolbarMessage(`No room to swap ${a?.name.toLowerCase()} and ${b?.name.toLowerCase()} here.`);
    }
    setItems((list) => [...list]); // redraw: puts the item back where it was
  };

  /** Show a scan. `starting` are the items to begin with instead of the scan's furniture. */
  const open = useCallback((text: string, from: Origin, opts: { items?: Item[] | null; project?: boolean } = {}) => {
    try {
      const loaded = loadHome(text);
      pendingItems.current = opts.items ?? null;
      pendingMark.current = !!opts.project;
      setHome(loaded);
      setOrigin(from);
      setGuestScan(opts.project ? null : (JSON.parse(text) as HomeScan | RoomScan));
      setError('');
      if (loaded.warnings.length) setToast(loaded.warnings.join(' '));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Project mode: the account holds the scan and the design; keep the design saved.
  const sync = useProjectSync({
    projectId,
    items,
    onLoad: (rec: ProjectRecord) => {
      open(JSON.stringify(rec.scan), { kind: 'project', source: rec.project.source }, { items: rec.design?.items ?? null, project: true });
    },
    capture: () => {
      const s = stageRef.current;
      if (!s?.home) return null;
      s.renderer.render(s.scene, s.camera);
      return captureThumbnail(s.renderer.domElement);
    },
  });
  const markLoadedRef = useRef(sync.markLoaded);
  markLoadedRef.current = sync.markLoaded;

  // Renderer, cameras, controls and pointer handling live for the whole page.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'labels';
    mount.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f1ed);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c8, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(6, 12, 8);
    scene.add(sun);
    const grid = new THREE.GridHelper(60, 60, 0xd6d1c8, 0xe6e2da);
    grid.position.y = -0.002;
    scene.add(grid);

    const persp = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 200);
    const controls = new OrbitControls(persp, labels.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // stay above the floor
    const stage: Stage = { renderer, labels, scene, persp, ortho, camera: persp, orthoHalf: 10, controls };
    stageRef.current = stage;

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      persp.aspect = w / Math.max(1, h);
      persp.updateProjectionMatrix();
      fitOrtho(stage);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    // ── pointer ──────────────────────────────────────────────────
    // Press on an item and drag: it moves over the floor (into another visible
    // room too), sliding along anything in its way, snapping flush to a wall it
    // is parallel to and close to, and swapping places with an item it is
    // dropped on. A click selects; a click on empty space clears the selection.
    const surface = labels.domElement;
    const ray = new THREE.Raycaster();
    const toRay = (e: PointerEvent) => {
      const rect = surface.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), stage.camera);
    };
    const itemAt = (e: PointerEvent) => {
      toRay(e);
      const targets = (stage.home?.views ?? []).filter((v) => v.group.visible).map((v) => v.items);
      for (const hit of ray.intersectObjects(targets, true)) {
        // Solid parts only: Three.js counts a ray within a whole metre of an outline as hitting it.
        if (!(hit.object instanceof THREE.Mesh)) continue;
        let o: THREE.Object3D | null = hit.object;
        while (o && o.userData.uid === undefined) o = o.parent;
        if (o) return { obj: o, point: hit.point };
      }
      return null;
    };
    const outlineColor = (h: ItemOutline | undefined, color: number) => h?.setColor(color);
    const clearSwapHighlight = () => {
      stage.swapHighlight?.dispose();
      stage.swapHighlight = undefined;
    };

    let press: { x: number; y: number } | null = null;
    let drag: {
      uid: number; obj: THREE.Object3D; x: number; y: number; plane: THREE.Plane; moving: boolean;
      offset: Vec2; from: { roomKey: string; center: Vec2; rotation: number };
      roomKey: string; at: Vec2; swapWith: number | null;
    } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      press = { x: e.clientX, y: e.clientY };
      const hit = itemAt(e);
      const item = hit && itemsRef.current.find((i) => i.uid === hit.obj.userData.uid);
      if (!hit || !item) return;
      // Registered in the capture phase, so this runs before OrbitControls sees the press.
      controls.enabled = false;
      surface.setPointerCapture(e.pointerId);
      drag = {
        uid: item.uid, obj: hit.obj, x: e.clientX, y: e.clientY, moving: false, swapWith: null,
        // Drag in the horizontal plane at the height it was grabbed, so it stays under the cursor.
        plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y),
        offset: { x: item.center.x - hit.point.x * 1000, z: item.center.z - hit.point.z * 1000 },
        from: { roomKey: item.roomKey, center: item.center, rotation: item.rotation },
        roomKey: item.roomKey, at: item.center,
      };
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag;
      if (!d.moving) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
        d.moving = true;
        pickRef.current(d.uid);
        surface.style.cursor = 'grabbing';
      }
      const item = itemsRef.current.find((i) => i.uid === d.uid);
      const home = homeRef.current;
      if (!item || !home) return;
      toRay(e);
      const hit = ray.ray.intersectPlane(d.plane, new THREE.Vector3());
      if (!hit) return;
      const want = { x: hit.x * 1000 + d.offset.x, z: hit.z * 1000 + d.offset.z };
      // The visible room under it, else the room it's in now.
      const visible = new Set((stage.home?.views ?? []).filter((v) => v.group.visible).map((v) => v.key));
      const room = home.rooms.find((r) => visible.has(r.key) && containsPoint(r.scan.polygon, want)) ?? home.rooms.find((r) => r.key === d.roomKey);
      const view = stage.home?.views.find((v) => v.key === room?.key);
      if (!room || !view) return;
      // A model arriving mid-drag rebuilds every item: carry on with the new object for this one.
      for (const v of stage.home?.views ?? []) {
        const live = v.items.children.find((c) => c.userData.uid === d.uid);
        if (live) d.obj = live;
      }
      if (room.key !== d.roomKey) {
        d.roomKey = room.key;
        d.at = want;
      }
      const others = itemsRef.current.filter((i) => i.roomKey === room.key && i.uid !== d.uid);
      const size = item.size, rot = item.rotation;
      let shown = d.at;
      let clear = true;
      d.swapWith = null;
      // Over exactly one other item (in its own room): dropping here swaps them.
      const hits = room.key === d.from.roomKey && fitsRoom(room.scan, size, want, rot) ? overlapping(size, want, rot, others) : [];
      if (hits.length === 1) {
        d.swapWith = hits[0].uid;
        shown = want;
      } else if (fitsAt(room.scan, size, want, rot, others)) {
        const snapped = snapToWall(room.scan, size, want, rot);
        d.at = snapped !== want && fitsAt(room.scan, size, snapped, rot, others) ? snapped : want;
        shown = d.at;
      } else {
        // Blocked (by a wall, with free placement on): slide along whichever direction is free.
        const slide = [{ x: want.x, z: d.at.z }, { x: d.at.x, z: want.z }].find((c) => fitsAt(room.scan, size, c, rot, others));
        if (slide) d.at = slide;
        else clear = false;
        shown = d.at;
      }
      if (d.obj.parent !== view.items) view.items.add(d.obj);
      positionItem(d.obj, { center: shown, rotation: rot, size });
      // The outline is a child of the item, so it moves and turns with it; only its colour changes here.
      outlineColor(stage.highlight, d.swapWith !== null ? SWAP : clear ? ACCENT : BLOCKED);
      clearSwapHighlight();
      const target = d.swapWith !== null ? view.items.children.find((c) => c.userData.uid === d.swapWith) : undefined;
      if (target) stage.swapHighlight = new ItemOutline(target, SWAP);
    };

    const onUp = (e: PointerEvent) => {
      if (drag) {
        const d = drag;
        drag = null;
        press = null;
        controls.enabled = true;
        surface.style.cursor = '';
        clearSwapHighlight();
        if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
        if (!d.moving) pickRef.current(d.uid);
        else if (d.swapWith !== null) dropRef.current({ uid: d.uid, kind: 'swap', with: d.swapWith, from: { center: d.from.center, rotation: d.from.rotation } });
        else if (d.at !== d.from.center || d.roomKey !== d.from.roomKey) dropRef.current({ uid: d.uid, kind: 'move', roomKey: d.roomKey, center: d.at });
        else dropRef.current({ uid: d.uid, kind: 'none' });
        return;
      }
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) <= 4) pickRef.current(null);
      press = null;
    };
    surface.addEventListener('pointerdown', onDown, { capture: true });
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointercancel', onUp);

    // ── render loop; keeps the edit menu floating over the selected item ──
    const top = new THREE.Vector3();
    const bounds = new THREE.Box3();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, stage.camera);
      labels.render(scene, stage.camera);
      const menu = toolbarRef.current, target = stage.selected;
      if (!menu) return;
      if (!target || !target.parent) {
        menu.style.visibility = 'hidden';
        return;
      }
      bounds.setFromObject(target);
      top.set((bounds.min.x + bounds.max.x) / 2, bounds.max.y, (bounds.min.z + bounds.max.z) / 2).project(stage.camera);
      const w = mount.clientWidth, h = mount.clientHeight;
      const x = ((top.x + 1) / 2) * w, y = ((1 - top.y) / 2) * h;
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      // Above the item; below it when there's no room above; always on screen.
      const below = y - mh - 14 < 8;
      menu.style.left = `${Math.min(w - mw - 8, Math.max(8, x - mw / 2))}px`;
      menu.style.top = `${below ? Math.max(8, Math.min(h - mh - 8, y + 14)) : y - mh - 14}px`;
      menu.style.visibility = top.z > 1 ? 'hidden' : 'visible'; // behind the camera
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      surface.removeEventListener('pointerdown', onDown, { capture: true });
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onUp);
      stage.home?.dispose();
      controls.dispose();
      renderer.dispose();
      mount.innerHTML = '';
      stageRef.current = null;
    };
  }, []);

  // ── history: every change to the items can be undone ─────────
  const hist = useRef<History<Item[]>>(emptyHistory([]));
  const historyReset = useRef(false);
  const [, setHistTick] = useState(0);
  useEffect(() => {
    if (historyReset.current) {
      historyReset.current = false;
      hist.current = emptyHistory(items);
      setHistTick((t) => t + 1);
      return;
    }
    if (hist.current.present === items) return;
    const next = record(hist.current, items);
    if (next !== hist.current) {
      hist.current = next;
      setHistTick((t) => t + 1);
    }
  }, [items]);

  /** Replace every item (undo, redo, or another version of the design). */
  const replaceItems = (next: Item[]) => {
    setItems(next);
    nextUid.current = Math.max(nextUid.current, ...next.map((i) => i.uid + 1));
    setPicked((p) => (p !== null && next.some((i) => i.uid === p) ? p : null));
    setToolbarMessage('');
  };
  const undoItems = () => {
    const h = undo(hist.current);
    if (!h) return;
    hist.current = h;
    replaceItems(h.present);
  };
  const redoItems = () => {
    const h = redo(hist.current);
    if (!h) return;
    hist.current = h;
    replaceItems(h.present);
  };

  // A new scan: rebuild the rooms, and start from the furniture it came with (or the saved design).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !home) return;
    stage.home?.dispose();
    const built = buildHome(home.rooms);
    stage.scene.add(built.root);
    stage.home = built;
    setSelected(ALL);
    let uid = 1;
    let initial = home.rooms.flatMap((r) => {
      const list = itemsFromScan(r.key, r.scan, uid);
      uid += list.length;
      return list;
    });
    if (pendingItems.current) {
      initial = pendingItems.current;
      pendingItems.current = null;
      uid = Math.max(1, ...initial.map((i) => i.uid + 1));
    }
    nextUid.current = uid;
    historyReset.current = true;
    preloadModels(modelIds(initial)); // what this design needs first; the rest of the catalogue follows when idle
    setItems(initial);
    setPicked(null);
    setTargetRoom(home.rooms[0]?.key ?? '');
    for (const v of built.views) setVisible(v.ceiling, ceilings);
    frame(stage);
    if (pendingMark.current) {
      pendingMark.current = false;
      markLoadedRef.current(initial);
    }
    // Deliberately keyed on the scan only; `ceilings` has its own effect.
  }, [home]);

  // The whole catalogue, fetched while nothing else is going on, so the library and later adds are instant.
  useEffect(() => {
    const all = () => preloadModels(MODEL_SPECS.map((m) => m.id));
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(all, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(all, 2000);
    return () => window.clearTimeout(id);
  }, []);

  // Isolate one room, or show all; re-frame on the result.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage?.home) return;
    for (const v of stage.home.views) setVisible(v.group, selected === ALL || v.key === selected);
    for (const v of stage.home.views) setVisible(v.ceiling, ceilings && v.group.visible);
    frame(stage);
    if (selected !== ALL) setTargetRoom(selected);
  }, [selected]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage?.home) return;
    for (const v of stage.home.views) setVisible(v.ceiling, ceilings && v.group.visible);
  }, [ceilings]);

  // 2D is the plan from straight above (orthographic); 3D orbits the perspective camera.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.camera = view === '2d' ? stage.ortho : stage.persp;
    stage.controls.object = stage.camera;
    stage.controls.enableRotate = view === '3d';
    stage.controls.minPolarAngle = 0;
    stage.controls.maxPolarAngle = view === '2d' ? 0 : Math.PI / 2 - 0.02;
    frame(stage);
  }, [view]);

  // Redraw the items whenever they, the rooms they stand in, or the model files they're drawn from change.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage?.home) return;
    for (const v of stage.home.views) clearItems(v.items);
    for (const item of items) {
      const view = stage.home.views.find((v) => v.key === item.roomKey);
      if (!view) continue;
      const obj = buildItem(item);
      obj.userData.uid = item.uid;
      positionItem(obj, item);
      view.items.add(obj);
    }
  }, [items, home, modelsVersion]);

  // Outline the selected item; the edit menu floats over it.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.highlight?.dispose();
    stage.highlight = undefined;
    stage.selected = undefined;
    let target: THREE.Object3D | undefined;
    for (const v of stage.home?.views ?? []) target ??= v.items.children.find((c) => c.userData.uid === picked);
    if (target) {
      stage.highlight = new ItemOutline(target, ACCENT);
      stage.selected = target;
    }
  }, [picked, items, modelsVersion]);

  const roomOf = (key: string) => home?.rooms.find((r) => r.key === key);
  const roomName = (key: string) => roomOf(key)?.name ?? key;
  const pickedItem = items.find((i) => i.uid === picked) ?? null;
  const editable = request.kind !== 'project' || !sync.readOnly;

  const addItem = (specId: string) => {
    const spec = specById(specId);
    const room = roomOf(targetRoom);
    if (!spec || !room) return;
    const at = freeSpot(room.scan, spec, items.filter((i) => i.roomKey === room.key));
    if (!at) {
      setToast(`No free space in ${room.name} for the ${spec.name.toLowerCase()} (${spec.size.width} × ${spec.size.depth} mm).`);
      return;
    }
    const item = itemFromSpec(spec, nextUid.current++, room.key, at);
    setItems((list) => [...list, item]);
    setPicked(item.uid);
    setToolbarMessage('');
    if (selected !== ALL && selected !== room.key) setSelected(room.key);
  };

  const removeItem = (uid: number) => {
    setItems((list) => list.filter((i) => i.uid !== uid));
    setPicked((p) => (p === uid ? null : p));
  };

  /** A copy of the selected item beside it (or wherever it fits). */
  const duplicateItem = () => {
    const item = pickedItem, room = item && roomOf(item.roomKey);
    if (!item || !room) return;
    const others = items.filter((i) => i.roomKey === room.key);
    const along = { x: Math.cos(item.rotation), z: Math.sin(item.rotation) }; // the item's width axis
    let at: { center: Vec2; rotation: number } | null = null;
    for (const side of [1, -1]) {
      const step = side * (item.size.width + 20);
      const c = settle(room.scan, item.size, { x: item.center.x + along.x * step, z: item.center.z + along.z * step }, item.rotation, others, 600);
      if (c) {
        at = { center: c, rotation: item.rotation };
        break;
      }
    }
    at ??= freeSpot(room.scan, { builder: item.builder, size: item.size }, others);
    if (!at) {
      setToast(`No free space in ${room.name} for another ${item.name.toLowerCase()}.`);
      return;
    }
    const copy: Item = { ...item, uid: nextUid.current++, center: at.center, rotation: at.rotation };
    delete copy.fromScan;
    setItems((list) => [...list, copy]);
    setPicked(copy.uid);
  };

  /** Turn the selected item clockwise (seen from above), settling it nearby if it doesn't fit as it is. */
  const rotateItem = (degrees: number) => {
    const item = pickedItem, room = item && roomOf(item.roomKey);
    if (!item || !room) return;
    const rotation = (item.rotation + (degrees * Math.PI) / 180) % (Math.PI * 2);
    const others = items.filter((i) => i.roomKey === item.roomKey && i.uid !== item.uid);
    const center = settle(room.scan, item.size, item.center, rotation, others, 400);
    if (!center) {
      setToolbarMessage('No room to turn it here. Drag it somewhere more open first.');
      return;
    }
    setToolbarMessage('');
    setItems((list) => list.map((i) => (i.uid === item.uid ? { ...i, rotation, center } : i)));
  };

  /** A finish for the selected item, or for every item of the same kind. */
  const setFinish = (slot: Slot, finish: Finish, everywhere: boolean) => {
    const me = pickedItem;
    if (!me) return;
    const sameKind = (i: Item) =>
      i.builder.kind === me.builder.kind
      && (me.builder.kind !== 'furniture' || (i.builder.kind === 'furniture' && i.builder.type === me.builder.type));
    setItems((list) => list.map((i) => (i.uid === me.uid || (everywhere && sameKind(i)) ? { ...i, finishes: { ...i.finishes, [slot]: finish } } : i)));
  };

  // Keys: ⌘Z / ⇧⌘Z undo and redo; Delete removes the selected item, R turns it (Shift: 15°), Escape deselects. Not while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoItems();
        else undoItems();
        return;
      }
      if (picked === null) return;
      if (e.key === 'Escape') setPicked(null);
      else if (e.key === 'r' || e.key === 'R') rotateItem(e.shiftKey ? 15 : 90);
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeItem(picked);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const openSample = async (name: string) => {
    try {
      const res = await fetch(`/samples/${encodeURIComponent(name)}.roomscan.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not load the sample "${name}" (HTTP ${res.status}).`);
      open(await res.text(), { kind: 'sample', name });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Fetch a scan the phone uploaded, by the 6-character code it showed. */
  const openCode = async (code: string) => {
    setBusy('Fetching the scan from the phone…');
    try {
      const found = await fetchScanByCode(code);
      open(JSON.stringify(found.scan), { kind: 'code', code: found.code });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  // What the address asks for (a project loads through the sync hook).
  useEffect(() => {
    switch (request.kind) {
      case 'project': return;
      case 'code': void openCode(request.code); return;
      case 'sample': void openSample(request.name); return;
      case 'link': {
        const scan = scanFromParams(request.params);
        if (scan) open(JSON.stringify(scan), { kind: 'link' });
        else setError('The link from the phone is damaged and could not be read.');
        return;
      }
      case 'restore': {
        const stash = takeGuestStash();
        if (!stash) {
          void openSample(DEFAULT_SAMPLE);
          return;
        }
        autoSave.current = true;
        open(JSON.stringify(stash.scan), stash.origin, { items: stash.items });
        return;
      }
      default: void openSample(DEFAULT_SAMPLE);
    }
  }, [request]);

  /** A guest's work into the account: sign in first if need be, then a project from the scan and the items. */
  const saveToProjects = async () => {
    if (!home || !guestScan || !origin) return;
    const name = defaultProjectName(origin, home.rooms.map((r) => r.name));
    if (!user) {
      if (!stashGuestWork({ scan: guestScan, items, origin, name })) {
        setToast('The browser would not keep your work while you sign in (storage is blocked).');
        return;
      }
      window.location.assign('/');
      return;
    }
    setBusy('Saving to your projects…');
    try {
      const byScan = () => createProject({ scan: guestScan, suggestedName: name, source: sourceOf(origin) });
      let project;
      if (origin.kind === 'code') {
        // The code may have expired since the scan was opened: the scan in hand is the same one.
        project = await createProject({ code: origin.code, suggestedName: name }).catch((e: ApiError) => (e.status === 404 ? byScan() : Promise.reject(e)));
      } else project = await byScan();
      await api('PUT', `/api/projects/${encodeURIComponent(project.id)}`, { rev: project.rev, design: { items } });
      window.location.replace(`/editor?project=${encodeURIComponent(project.id)}`);
    } catch (e) {
      setBusy('');
      if ((e as ApiError).status === 401) {
        setUser(null);
        stashGuestWork({ scan: guestScan, items, origin, name });
        window.location.assign('/');
        return;
      }
      setToast((e as Error).message);
    }
  };
  // A stash restored after sign-in saves itself once we know who is signed in.
  useEffect(() => {
    if (!autoSave.current || user === undefined || !home || !guestScan) return;
    autoSave.current = false;
    if (user) void saveToProjects();
  }, [user, home, guestScan]);

  const signIn = () => {
    if (home && guestScan && origin) stashGuestWork({ scan: guestScan, items, origin, name: defaultProjectName(origin, home.rooms.map((r) => r.name)) });
    window.location.assign('/');
  };
  const backToProjects = async () => {
    setBusy('Saving…');
    await sync.flush();
    window.location.assign('/projects');
  };

  // ── what the bars show ─────────────────────────────────────────
  const isProject = request.kind === 'project';
  const status: { state: SyncState; text: string } = isProject
    ? { state: sync.state, text: statusText(sync.state, { savedAt: sync.savedAt, error: sync.error }) }
    : { state: 'idle', text: home ? statusText('idle', { guest: true }) : '' };
  const subtitle = subtitleText(home?.rooms.length ?? 0, isProject ? { kind: 'project', source: sync.project?.source } : origin);
  const scopeRooms = selected === ALL ? home?.rooms ?? [] : home?.rooms.filter((r) => r.key === selected) ?? [];
  const scopeItems = selected === ALL ? items : items.filter((i) => i.roomKey === selected);
  const extent = bbox(scopeRooms.map((r) => r.scan.polygon));
  const scopeTitle = !home ? '' : selected === ALL ? (home.rooms.length === 1 ? home.rooms[0].name : 'Whole home') : roomName(selected);
  const railSection = RAIL_SECTIONS.find((s) => s.id === section) ?? null;
  const loadFailed = isProject && sync.loadError;

  return (
    <div className="app">
      <TopBar
        projectName={isProject ? sync.project?.name ?? '' : null}
        onRename={async (name) => {
          if (!sync.project) return;
          sync.setProject(await renameProject(sync.project.id, name));
        }}
        subtitle={subtitle}
        status={status}
        user={user}
        guest={!isProject}
        onBack={() => void backToProjects()}
        onSaveToProjects={() => void saveToProjects()}
        onSignIn={signIn}
        beforeSignOut={sync.flush}
        onSignedOut={() => window.location.replace('/')}
        onNotice={setToast}
      />

      {sync.conflict && (
        <div className="bar conflict" role="alertdialog" aria-label="This project was changed somewhere else">
          <span>This project was changed somewhere else. Which version do you want to keep?</span>
          <button type="button" className="btn primary small" onClick={() => void sync.reloadTheirs()}>Reload their version</button>
          <button type="button" className="btn ghost small" onClick={sync.keepMine}>Keep mine</button>
        </div>
      )}
      {isProject && sync.state === 'signedout' && !loadFailed && (
        <div className="bar warn" role="alert">
          <span>You were signed out. Sign in again to keep saving; your latest changes are kept in this tab.</span>
          <a className="btn ghost small" href="/" target="_blank" rel="noopener">Sign in</a>
          <button type="button" className="btn ghost small" onClick={sync.retry}>Try again</button>
        </div>
      )}
      {isProject && sync.state === 'error' && sync.readOnly && (
        <div className="bar warn" role="alert"><span>{sync.error}</span></div>
      )}

      <div className="body">
        <Rail sections={RAIL_SECTIONS} active={section} onPick={(id) => setSection((s) => (s === id ? null : id))} />
        {railSection && (
          <ItemDrawer
            section={railSection}
            rooms={home?.rooms.map((r) => ({ key: r.key, name: r.name })) ?? []}
            targetRoom={targetRoom}
            onTargetRoom={setTargetRoom}
            onAdd={addItem}
            items={items}
            selected={picked}
            onSelect={(uid) => { setPicked(uid); setToolbarMessage(''); }}
            onRemove={removeItem}
            onCollapse={() => setSection(null)}
          />
        )}

        <div className="canvas">
          <div ref={mountRef} className="stage" />

          <SpacesPopover
            open={spacesOpen}
            onOpen={setSpacesOpen}
            rooms={home?.rooms.map((r) => ({ key: r.key, name: r.name, items: items.filter((i) => i.roomKey === r.key).length })) ?? []}
            selected={selected}
            onSelect={(key) => { setSelected(key); setSpacesOpen(false); }}
            ceilings={ceilings}
            onCeilings={setCeilings}
          />
          <SummaryCard title={scopeTitle} extent={extent} items={scopeItems} roomName={roomName} />

          {!isProject && (
            <button type="button" className="corner-btn open-btn" title="Open a code, a sample or a file" onClick={() => setOpenDialog(true)}>
              <span className="ic" aria-hidden="true">folder_open</span><span>Open</span>
            </button>
          )}

          <BottomToolbar
            view={view}
            onView={setView}
            canUndo={editable && canUndo(hist.current)}
            canRedo={editable && canRedo(hist.current)}
            onUndo={undoItems}
            onRedo={redoItems}
            canEdit={editable && pickedItem !== null}
            onDuplicate={duplicateItem}
            onDelete={() => { if (picked !== null) removeItem(picked); }}
            roomsOpen={spacesOpen}
            onRooms={() => setSpacesOpen((v) => !v)}
            ceilings={ceilings}
            onCeilings={() => setCeilings((v) => !v)}
            onReset={() => { const s = stageRef.current; if (s) frame(s); }}
          />

          {pickedItem && (
            <ItemToolbar
              ref={toolbarRef}
              item={pickedItem}
              roomName={roomName(pickedItem.roomKey)}
              message={toolbarMessage}
              onRotate={rotateItem}
              onFinish={setFinish}
              onRemove={() => removeItem(pickedItem.uid)}
              onClose={() => setPicked(null)}
            />
          )}

          {(busy || (isProject && sync.state === 'loading' && !home)) && (
            <div className="veil" role="status">
              <div className="spinner" />
              <span>{busy || 'Opening…'}</span>
            </div>
          )}
          {loadFailed && (
            <div className="veil">
              <div className="card notice-card">
                <h2>{sync.loadError!.status === 401 ? 'Please sign in' : 'Couldn’t open this project'}</h2>
                <p className="muted">{sync.loadError!.status === 401 ? 'Sign in to open this project.' : sync.loadError!.message}</p>
                <div className="dialog-actions">
                  {sync.loadError!.status === 401
                    ? <a className="btn primary" href="/">Sign in</a>
                    : <a className="btn primary" href="/projects">My projects</a>}
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="canvas-error" role="alert">
              <span>{error}</span>
              <button type="button" className="link" onClick={() => setError('')}>Dismiss</button>
            </div>
          )}
          <Toast message={toast} onDone={() => setToast('')} />
        </div>
      </div>

      {!isProject && (
        <NewProjectDialog open={openDialog} onClose={() => setOpenDialog(false)} onOpen={(text, from) => { setOpenDialog(false); open(text, from); }} />
      )}
    </div>
  );
}
