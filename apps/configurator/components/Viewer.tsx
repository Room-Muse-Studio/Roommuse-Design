'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { scanFromParams, type Vec2 } from '@mozu/scan-sdk';
import { loadHome, type ViewerHome } from '@/lib/home';
import { buildHome, setVisible, type RoomView } from '@/lib/scene';
import {
  fitsAt, fitsRoom, freeSpot, itemFromSpec, itemsFromScan, overlapping, settle, snapToWall, specById, swapPlaces,
  type Item, type Slot,
} from '@/lib/items';
import { buildItem, positionItem } from '@/lib/itemMesh';
import { containsPoint } from '@/lib/walls';
import type { Finish } from '@/lib/finishes';
import ItemPanel from './ItemPanel';
import ItemToolbar from './ItemToolbar';
import { useDesignSync } from './useDesignSync';

const ALL = 'all';
const ACCENT = 0xc33a20, BLOCKED = 0x8a8f94, SWAP = 0x2f6fd6;

interface Stage {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  home?: { views: RoomView[]; dispose: () => void };
  /** Outline around the selected item, and the item the edit menu floats over. */
  highlight?: THREE.BoxHelper;
  selected?: THREE.Object3D;
  /** Outline around the item a drop would swap with. */
  swapHighlight?: THREE.BoxHelper;
}

/** What a finished drag asks for. */
type DragResult =
  | { uid: number; kind: 'move'; roomKey: string; center: Vec2 }
  | { uid: number; kind: 'swap'; with: number; from: { center: Vec2; rotation: number } }
  | { uid: number; kind: 'none' };

/** Free an item's geometry. Materials are shared between items and kept. */
function clearItems(group: THREE.Group) {
  group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  group.clear();
}

/** Point the camera at everything visible, from above and to one side. */
function frame(stage: Stage) {
  const box = new THREE.Box3();
  for (const v of stage.home?.views ?? []) if (v.group.visible) box.expandByObject(v.group);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  const fov = THREE.MathUtils.degToRad(stage.camera.fov);
  const distance = (radius / Math.sin(fov / 2)) * 1.05;
  const direction = new THREE.Vector3(0.35, 1.1, 0.9).normalize();
  stage.camera.position.copy(center).addScaledVector(direction, distance);
  stage.camera.near = distance / 100;
  stage.camera.far = distance * 20;
  stage.camera.updateProjectionMatrix();
  stage.controls.target.copy(center);
  stage.controls.update();
}

export default function Viewer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [home, setHome] = useState<ViewerHome | null>(null);
  const [source, setSource] = useState('');
  const [samples, setSamples] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(ALL);
  const [ceilings, setCeilings] = useState(false);
  const [code, setCode] = useState('');
  const [loadingCode, setLoadingCode] = useState(false);
  /** Everything standing in the rooms: the scan's furniture and whatever has been added. */
  const [items, setItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [targetRoom, setTargetRoom] = useState('');
  const [panelMessage, setPanelMessage] = useState('');
  const [toolbarMessage, setToolbarMessage] = useState('');
  /** The code the open scan came from; its design is saved under it. Null for samples and files. */
  const [designCode, setDesignCode] = useState<string | null>(null);
  const nextUid = useRef(1);

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

  // Renderer, camera, controls and pointer handling live for the whole page.
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

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    const controls = new OrbitControls(camera, labels.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // stay above the floor
    const stage: Stage = { renderer, labels, scene, camera, controls };
    stageRef.current = stage;

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
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
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
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
    const outlineColor = (h: THREE.BoxHelper | undefined, color: number) => (h?.material as THREE.LineBasicMaterial | undefined)?.color.set(color);
    const clearSwapHighlight = () => {
      stage.swapHighlight?.removeFromParent();
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
      if (room.key !== d.roomKey) {
        d.roomKey = room.key;
        d.at = want;
      }
      const others = itemsRef.current.filter((i) => i.roomKey === room.key && i.uid !== d.uid);
      const size = item.size, rot = item.rotation;
      let shown = d.at;
      let clear = true;
      d.swapWith = null;
      if (fitsAt(room.scan, size, want, rot, others)) {
        const snapped = snapToWall(room.scan, size, want, rot);
        d.at = snapped !== want && fitsAt(room.scan, size, snapped, rot, others) ? snapped : want;
        shown = d.at;
      } else {
        const hits = room.key === d.from.roomKey && fitsRoom(room.scan, size, want, rot) ? overlapping(size, want, rot, others) : [];
        if (hits.length === 1) {
          // Over exactly one other item: dropping here swaps them.
          d.swapWith = hits[0].uid;
          shown = want;
        } else {
          // Blocked by a wall, a door or several things: slide along whichever direction is free.
          const slide = [{ x: want.x, z: d.at.z }, { x: d.at.x, z: want.z }].find((c) => fitsAt(room.scan, size, c, rot, others));
          if (slide) d.at = slide;
          else clear = false;
          shown = d.at;
        }
      }
      if (d.obj.parent !== view.items) view.items.add(d.obj);
      positionItem(d.obj, { center: shown, rotation: rot, size });
      stage.highlight?.setFromObject(d.obj);
      outlineColor(stage.highlight, d.swapWith !== null ? SWAP : clear ? ACCENT : BLOCKED);
      clearSwapHighlight();
      const target = d.swapWith !== null ? view.items.children.find((c) => c.userData.uid === d.swapWith) : undefined;
      if (target) {
        stage.swapHighlight = new THREE.BoxHelper(target, SWAP);
        scene.add(stage.swapHighlight);
      }
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
      renderer.render(scene, camera);
      labels.render(scene, camera);
      const menu = toolbarRef.current, target = stage.selected;
      if (!menu) return;
      if (!target || !target.parent) {
        menu.style.visibility = 'hidden';
        return;
      }
      bounds.setFromObject(target);
      top.set((bounds.min.x + bounds.max.x) / 2, bounds.max.y, (bounds.min.z + bounds.max.z) / 2).project(camera);
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

  // A new scan: rebuild the rooms, and start from the furniture it came with.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !home) return;
    stage.home?.dispose();
    const built = buildHome(home.rooms);
    stage.scene.add(built.root);
    stage.home = built;
    setSelected(ALL);
    let uid = 1;
    const scanned = home.rooms.flatMap((r) => {
      const list = itemsFromScan(r.key, r.scan, uid);
      uid += list.length;
      return list;
    });
    nextUid.current = uid;
    setItems(scanned);
    setPicked(null);
    setPanelMessage('');
    setTargetRoom(home.rooms[0]?.key ?? '');
    for (const v of built.views) setVisible(v.ceiling, ceilings);
    frame(stage);
    // Deliberately keyed on the scan only; `ceilings` has its own effect.
  }, [home]);

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

  // Redraw the items whenever they, or the rooms they stand in, change.
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
  }, [items, home]);

  // Outline the selected item; the edit menu floats over it.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.highlight?.removeFromParent();
    stage.highlight?.dispose();
    stage.highlight = undefined;
    stage.selected = undefined;
    let target: THREE.Object3D | undefined;
    for (const v of stage.home?.views ?? []) target ??= v.items.children.find((c) => c.userData.uid === picked);
    if (target) {
      stage.highlight = new THREE.BoxHelper(target, ACCENT);
      stage.scene.add(stage.highlight);
      stage.selected = target;
    }
  }, [picked, items]);

  const roomOf = (key: string) => home?.rooms.find((r) => r.key === key);
  const pickedItem = items.find((i) => i.uid === picked) ?? null;

  // Save the items under the code, and pick up what others save there.
  const sync = useDesignSync({
    code: designCode,
    home,
    items,
    replaceItems: (next) => {
      setItems(next);
      nextUid.current = Math.max(nextUid.current, ...next.map((i) => i.uid + 1));
      setPicked((p) => (p !== null && next.some((i) => i.uid === p) ? p : null));
    },
    onCode: (newCode) => {
      setDesignCode(newCode);
      setCode(newCode);
      setSource(`code ${newCode}`);
      window.history.replaceState(null, '', `/?code=${newCode}`);
    },
  });
  const savedTime = sync.savedAt ? new Date(sync.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  const addItem = (specId: string) => {
    const spec = specById(specId);
    const room = roomOf(targetRoom);
    if (!spec || !room) return;
    const at = freeSpot(room.scan, spec, items.filter((i) => i.roomKey === room.key));
    if (!at) {
      setPanelMessage(`No free space in ${room.name} for the ${spec.name.toLowerCase()} (${spec.size.width} × ${spec.size.depth} mm).`);
      return;
    }
    const item = itemFromSpec(spec, nextUid.current++, room.key, at);
    setItems((list) => [...list, item]);
    setPicked(item.uid);
    setPanelMessage('');
    setToolbarMessage('');
    if (selected !== ALL && selected !== room.key) setSelected(room.key);
  };

  const removeItem = (uid: number) => {
    setItems((list) => list.filter((i) => i.uid !== uid));
    setPicked((p) => (p === uid ? null : p));
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
      i.builder.kind === me.builder.kind && (i.builder.kind === 'module' || (me.builder.kind === 'furniture' && i.builder.type === me.builder.type));
    setItems((list) => list.map((i) => (i.uid === me.uid || (everywhere && sameKind(i)) ? { ...i, finishes: { ...i.finishes, [slot]: finish } } : i)));
  };

  // Delete removes the selected item, R turns it (Shift: 15°), Escape deselects. Not while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
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

  /** Show a scan. `fromCode` is the code it came from, so its design is loaded and saved there. */
  const open = (text: string, name: string, fromCode: string | null = null) => {
    try {
      setHome(loadHome(text));
      setSource(name);
      setDesignCode(fromCode);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openSample = async (name: string) => {
    try {
      const res = await fetch(`/samples/${encodeURIComponent(name)}.roomscan.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not load the sample "${name}" (HTTP ${res.status}).`);
      open(await res.text(), `samples/${name}.roomscan.json`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Fetch a scan the phone uploaded, by the 6-character code it showed. */
  const openCode = async (input: string) => {
    const wanted = input.trim();
    if (!wanted) {
      setError('Type the 6-character code shown in the MOZU Scanner app.');
      return;
    }
    setLoadingCode(true);
    try {
      const res = await fetch(`/api/scan-handoff?code=${encodeURIComponent(wanted)}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { code?: string; scan?: unknown; error?: string };
      if (!res.ok || !body.scan) throw new Error(body.error || `The scan service could not find that code (HTTP ${res.status}).`);
      const found = body.code ?? wanted.toUpperCase();
      open(JSON.stringify(body.scan), `code ${found}`, found);
      setCode(found);
    } catch (e) {
      setError(e instanceof TypeError ? 'Could not reach the scan service. Check the connection and try again.' : (e as Error).message);
    } finally {
      setLoadingCode(false);
    }
  };

  useEffect(() => {
    fetch('/samples/index.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then((body: { samples: string[] }) => setSamples(body.samples))
      .catch(() => setSamples([]));
    // What the address asks for (the /scan links redirect here):
    //   ?code=B7K4M2           a scan sent from the phone, by its code
    //   ?poly=…&h=…[&scan=…]   the phone's "Open in MOZU on this device" link, the scan in the address
    // Otherwise, the two-bedroom sample.
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('code');
    if (linked) {
      setCode(linked.toUpperCase());
      void openCode(linked);
    } else if (params.get('scan') || params.get('poly')) {
      const scan = scanFromParams(params);
      if (scan) open(JSON.stringify(scan), 'link from the phone');
      else setError('The link from the phone is damaged and could not be read.');
    } else {
      void openSample('twobedroom');
    }
  }, []);

  return (
    <main className="viewer">
      <div ref={mountRef} className="stage" />
      <section className="panel" aria-label="Viewer controls">
        <h1>RoomMuse viewer</h1>
        <p className="source">{source || 'No scan loaded'}</p>

        <label className="field">
          Rooms
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!home}>
            <option value={ALL}>All rooms ({home?.rooms.length ?? 0})</option>
            {home?.rooms.map((r) => (
              <option key={r.key} value={r.key}>{r.name}</option>
            ))}
          </select>
        </label>

        <label className="check">
          <input type="checkbox" checked={ceilings} onChange={(e) => setCeilings(e.target.checked)} />
          Show ceilings
        </label>

        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void openCode(code);
          }}
        >
          Code from the phone
          <div className="row">
            <input
              className="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="B7K4M2"
              maxLength={9}
              autoComplete="off"
              spellCheck={false}
              aria-label="6-character code from the MOZU Scanner app"
            />
            <button type="submit" disabled={loadingCode}>{loadingCode ? 'Loading…' : 'Load'}</button>
          </div>
        </form>

        <div className="field">
          Or open a scan
          <div className="row">
            <select defaultValue="" onChange={(e) => e.target.value && void openSample(e.target.value)}>
              <option value="">Sample…</option>
              {samples.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className="file">
              File…
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) open(await file.text(), file.name);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>

        <div className="save-status" aria-live="polite">
          {designCode ? (
            <>
              <strong>
                {sync.status === 'loading' ? 'Loading the saved design…'
                  : sync.status === 'saving' ? 'Saving…'
                  : sync.status === 'error' ? 'Not saved'
                  : savedTime ? `Saved · ${savedTime}` : 'Saved'}
              </strong>
              {sync.status === 'error' ? <span className="error">{sync.error} Your next change tries again.</span>
                : <span>Anyone with code {designCode} can open and edit this design. It&apos;s kept for good.</span>}
              {sync.notice && sync.status !== 'error' && <span className="notice-inline">{sync.notice}</span>}
            </>
          ) : home ? (
            <>
              <strong>Not saved</strong>
              <span>Changes to a sample or file stay in this tab.</span>
              <button type="button" className="secondary" onClick={() => void sync.saveAndGetCode()} disabled={sync.status === 'saving'}>
                {sync.status === 'saving' ? 'Saving…' : 'Save & get a code'}
              </button>
              {sync.status === 'error' && <span className="error">{sync.error}</span>}
            </>
          ) : null}
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        {home?.warnings.map((w) => <p key={w} className="warning">{w}</p>)}

        <ul className="legend">
          <li><i style={{ background: '#2f7d63' }} />Door</li>
          <li><i style={{ background: '#3d7fc1' }} />Window</li>
          <li><i style={{ background: '#8a8f94' }} />Archway</li>
          <li><i style={{ background: '#d09e16' }} />Socket</li>
          <li><i style={{ background: '#b46a14' }} />Switch</li>
        </ul>
        <p className="hint">Drag to orbit · scroll to zoom · right-drag to pan</p>
      </section>

      <ItemPanel
        rooms={home?.rooms.map((r) => ({ key: r.key, name: r.name })) ?? []}
        targetRoom={targetRoom}
        onTargetRoom={setTargetRoom}
        onAdd={addItem}
        items={items}
        selected={picked}
        onSelect={(uid) => { setPicked(uid); setToolbarMessage(''); }}
        onRemove={removeItem}
        message={panelMessage}
      />

      {pickedItem && (
        <ItemToolbar
          ref={toolbarRef}
          item={pickedItem}
          roomName={roomOf(pickedItem.roomKey)?.name ?? ''}
          message={toolbarMessage}
          onRotate={rotateItem}
          onFinish={setFinish}
          onRemove={() => removeItem(pickedItem.uid)}
          onClose={() => setPicked(null)}
        />
      )}
    </main>
  );
}
