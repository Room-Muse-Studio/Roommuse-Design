#!/usr/bin/env node
/**
 * MOZU's STEP assemblies → the configurator's GLBs, with doors and drawers as
 * their own nodes so the viewer can open and close them.
 *
 *   cd tools/mozu && npm install && node step-to-glb-parts.mjs [KT01 KH02 …]
 *
 * Writes apps/configurator/models/mozu/<ID>.glb for every step/<ID>.step (or
 * just the ids given), then `npm run models:measure -w apps/configurator`
 * re-measures them into the manifest.
 *
 * WHAT IT DOES
 *
 * occt-import-js (OpenCASCADE in WASM) tessellates each assembly into one mesh
 * per part, in millimetres, Y up, with the assembly transforms applied. Part
 * names are GBK-encoded Chinese: 柜体 body, 柜门 door, 抽屉 drawer, 定位销
 * locating pin, 电器 appliance, 冰箱 fridge.
 *
 *  - Parts are sorted into `door` (named 柜门, a thin slab ≤ 45 mm), `drawer`
 *    (named 抽屉, or a 柜门 that is a box rather than a slab) and `body`
 *    (everything else: carcass, pins, appliances, shelves, fittings).
 *  - The designers left some doors standing open at odd angles. Each door is
 *    turned back about its hinge, a vertical line through the locating pins
 *    that sit inside the door's hinge edge (the pin is the SolidWorks hinge
 *    mate), until its slab faces ±z. Every door is then checked: ≤ 45 mm thick
 *    along z, inside the body's x/y extents, back face on the carcass front.
 *    A door that fails stops the run.
 *  - Opening: a door swings 95° about its hinge, the sign chosen so its free
 *    edge moves out of the front (+z); a drawer slides out along +z by 60 % of
 *    its depth.
 *
 * OUTPUT (the convention modelLoader.ts reads)
 *
 * Millimetres, Y up, base at y = 0, footprint of the CLOSED assembly centred on
 * x = z = 0, axes as in the STEP file (so the manifest's `front` still says
 * which way a model faces). Nodes:
 *   body                     one mesh, every body part merged, no transform
 *   door:<n> / drawer:<n>    translation = the pivot (a point on the hinge
 *                            line, or a point on the drawer), mesh positions
 *                            relative to it, CLOSED pose, and extras
 *                            { part: 'hinge', axis: [0,1,0], open: <radians> } or
 *                            { part: 'slide', dir: [0,0,1], open: <mm> }
 * POSITION + NORMAL (occt's) + indices, no UVs (the loader projects them), one
 * plain grey material.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import occtimportjs from 'occt-import-js';

const here = dirname(fileURLToPath(import.meta.url));
const STEP_DIR = join(here, 'step');
const OUT_DIR = join(here, '..', '..', 'apps', 'configurator', 'models', 'mozu');

const DOOR_MAX_THICKNESS = 45; // mm: thicker than this is a box, not a slab
const OPEN_DOOR = (95 * Math.PI) / 180;
const OPEN_DRAWER = 0.6; // of the drawer's depth
const TOL_EXTENT = 5; // a closed door stays inside the body's x/y extents to within this
const TOL_FLUSH = 10; // a closed door's back face sits this close to the carcass front
const APPLIANCE_PROUD = 30; // a built-in oven's face stands this far in front of the carcass, like the doors

const gbk = new TextDecoder('gbk');
const decodeName = (s) => {
  try {
    return gbk.decode(Uint8Array.from([...(s ?? '')].map((c) => c.charCodeAt(0) & 255)));
  } catch {
    return s ?? '';
  }
};

// ── geometry helpers (xz rotation about a vertical line) ──

/** Turn (x, z) about (hx, hz) by `a` radians about +y (Three.js sense: +x toward -z for a > 0). */
const turn = (x, z, hx, hz, a) => {
  const c = Math.cos(a), s = Math.sin(a), dx = x - hx, dz = z - hz;
  return [hx + dx * c + dz * s, hz - dx * s + dz * c];
};

function bounds(pos) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) {
    if (pos[i + a] < lo[a]) lo[a] = pos[i + a];
    if (pos[i + a] > hi[a]) hi[a] = pos[i + a];
  }
  return { lo, hi, size: hi.map((h, a) => h - lo[a]) };
}

/** Extent of the part's points along the horizontal direction (sin θ, cos θ) — θ = 0 is +z. */
function extentAlong(pos, theta) {
  const sx = Math.sin(theta), cz = Math.cos(theta);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const d = pos[i] * sx + pos[i + 2] * cz;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return hi - lo;
}

/** The horizontal direction across which the part is thinnest: its slab normal if it is a vertical slab. */
function thinnest(pos) {
  let best = 0, bestT = Infinity;
  for (let d = 0; d < 180; d += 0.5) {
    const t = extentAlong(pos, (d * Math.PI) / 180);
    if (t < bestT) [best, bestT] = [d, t];
  }
  for (let d = best - 0.5; d <= best + 0.5; d += 0.01) {
    const t = extentAlong(pos, (d * Math.PI) / 180);
    if (t < bestT) [best, bestT] = [d, t];
  }
  return { theta: (best * Math.PI) / 180, thickness: bestT };
}

function rotatePart(part, hx, hz, a) {
  const p = part.pos, n = part.nor;
  for (let i = 0; i < p.length; i += 3) {
    [p[i], p[i + 2]] = turn(p[i], p[i + 2], hx, hz, a);
    if (n) [n[i], n[i + 2]] = turn(n[i], n[i + 2], 0, 0, a);
  }
}

const normAngle = (a) => {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
};

/**
 * The carcass front: the furthest-forward z plane whose faces reach across most
 * of the body's width (covered, not just spanned) and over half its height — the front edges of the side
 * panels, top and bottom. Hinge cups and top rails poke further out but are
 * narrow or short.
 */
function carcassFront(body, box) {
  const CELL = 5, cells = Math.ceil(box.size[0] / CELL) + 1;
  const bins = new Map();
  const grow = (k, x0, x1, y0, y1) => {
    const b = bins.get(k) ?? { x: new Uint8Array(cells), y: [Infinity, -Infinity] };
    for (let i = Math.floor((x0 - box.lo[0]) / CELL); i <= Math.min(cells - 1, Math.floor((x1 - box.lo[0]) / CELL)); i++) b.x[i] = 1;
    b.y = [Math.min(b.y[0], y0), Math.max(b.y[1], y1)];
    bins.set(k, b);
  };
  for (const part of body) {
    const p = part.pos, ix = part.idx;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const area = Math.hypot(...cr) / 2;
      if (!area || Math.abs(cr[2]) / (2 * area) < 0.99) continue;
      grow(Math.round(p[a + 2]), Math.min(p[a], p[b], p[c]), Math.max(p[a], p[b], p[c]), Math.min(p[a + 1], p[b + 1], p[c + 1]), Math.max(p[a + 1], p[b + 1], p[c + 1]));
    }
  }
  const planes = [...bins]
    .filter(([, b]) => b.x.reduce((n, c) => n + c, 0) >= 0.8 * cells && b.y[1] - b.y[0] >= 0.5 * box.size[1])
    .map(([z]) => z);
  return planes.length ? Math.max(...planes) : box.hi[2];
}

// ── one model ──

function convert(occt, id) {
  const result = occt.ReadStepFile(new Uint8Array(readFileSync(join(STEP_DIR, `${id}.step`))), null);
  if (!result.success || !result.meshes.length) throw new Error(`${id}: OpenCASCADE could not read the STEP file`);
  const parts = result.meshes.map((m) => ({
    name: decodeName(m.name),
    pos: Float64Array.from(m.attributes.position.array),
    nor: m.attributes.normal ? Float64Array.from(m.attributes.normal.array) : null,
    idx: Uint32Array.from(m.index.array),
  }));

  for (const part of parts) {
    part.box = bounds(part.pos);
    const named = /柜门/.test(part.name) && !/门顶柜/.test(part.name);
    if (/抽屉/.test(part.name)) part.kind = 'drawer';
    else if (named) {
      part.slab = thinnest(part.pos);
      part.kind = part.slab.thickness <= DOOR_MAX_THICKNESS ? 'door' : 'drawer';
    } else part.kind = 'body';
    const s = part.box.size;
    // A locating pin: a thin vertical rod (named 定位销, though the name is often truncated).
    part.pin = part.kind === 'body' && s[0] < 20 && s[2] < 20 && (/定/.test(part.name) || s[1] > 50);
  }
  const body = parts.filter((p) => p.kind === 'body');
  const bodyBox = bounds(Float64Array.from(body.flatMap((p) => [...p.pos])));
  const front = carcassFront(body.filter((p) => !p.pin), bodyBox);
  // Built-in ovens (电器) were left pulled forward of the cabinet in KT03/KT04 (by 70–230 mm, two
  // of them by different amounts), which made those units 680–840 mm deep. Push each back so its
  // face is level with the closed door fronts.
  const notes = [];
  for (const part of body.filter((p) => /电器/.test(p.name))) {
    const shift = front + APPLIANCE_PROUD - part.box.hi[2];
    if (shift >= -1) continue;
    for (let i = 2; i < part.pos.length; i += 3) part.pos[i] += shift;
    part.box = bounds(part.pos);
    notes.push(`${id}: ${part.name} pushed back ${Math.round(-shift)} mm, face now level with the doors`);
  }
  const pins = body.filter((p) => p.pin).map((p) => ({ x: (p.box.lo[0] + p.box.hi[0]) / 2, z: (p.box.lo[2] + p.box.hi[2]) / 2, y: [p.box.lo[1], p.box.hi[1]] }));

  const report = [];
  const moving = [];
  for (const part of parts.filter((p) => p.kind === 'door')) {
    const name = part.name || '(unnamed door)';
    // The pins beside this door: overlapping it in height, within a few cm of its outline in plan.
    const near = pins.filter((pin) => pin.y[1] > part.box.lo[1] && pin.y[0] < part.box.hi[1]).map((pin) => {
      let d = Infinity;
      for (let i = 0; i < part.pos.length; i += 3) d = Math.min(d, Math.hypot(part.pos[i] - pin.x, part.pos[i + 2] - pin.z));
      return { ...pin, d };
    }).filter((pin) => pin.d < 60);
    let hinge, how;
    if (near.length) {
      hinge = [near.reduce((s, p) => s + p.x, 0) / near.length, near.reduce((s, p) => s + p.z, 0) / near.length];
      const spread = Math.max(...near.map((p) => Math.hypot(p.x - hinge[0], p.z - hinge[1])));
      if (spread > 3) throw new Error(`${id} ${name}: its pins disagree about the hinge by ${spread.toFixed(1)} mm`);
      how = `${near.length} pin${near.length > 1 ? 's' : ''}`;
    } else {
      // No pins: the door's vertical edge nearest a front corner of the body.
      const corners = [[bodyBox.lo[0], front], [bodyBox.hi[0], front]];
      let best = null;
      for (let i = 0; i < part.pos.length; i += 3) for (const c of corners) {
        const d = Math.hypot(part.pos[i] - c[0], part.pos[i + 2] - c[1]);
        if (!best || d < best.d) best = { d, x: part.pos[i], z: part.pos[i + 2] };
      }
      hinge = [best.x, best.z];
      how = 'edge (no pins)';
    }
    const { theta } = part.slab;
    // Two turns bring the slab normal to ±z; keep the one that lands the door on the body's front.
    let pick = null;
    for (const cand of [normAngle(-theta), normAngle(Math.PI - theta)]) {
      const trial = { pos: Float64Array.from(part.pos), nor: null };
      rotatePart(trial, hinge[0], hinge[1], cand);
      const b = bounds(trial.pos);
      // Off the body sideways, off the carcass front, and (a tie-break for a door that is already
      // closed, which a half turn about its hinge would also leave flush) the size of the turn.
      const score = Math.max(0, bodyBox.lo[0] - b.lo[0]) + Math.max(0, b.hi[0] - bodyBox.hi[0]) + Math.abs(b.lo[2] - front)
        + (b.lo[2] < front - TOL_FLUSH ? 1000 : 0) + 5 * Math.abs(cand);
      if (!pick || score < pick.score) pick = { angle: cand, score };
    }
    rotatePart(part, hinge[0], hinge[1], pick.angle);
    const b = (part.box = bounds(part.pos));
    const checks = {
      thickness: b.size[2],
      outX: Math.max(0, bodyBox.lo[0] - b.lo[0], b.hi[0] - bodyBox.hi[0]),
      outY: Math.max(0, bodyBox.lo[1] - b.lo[1], b.hi[1] - bodyBox.hi[1]),
      flush: b.lo[2] - front,
      // A door can also sit flush with a fixed front panel instead (KF08's blind corner has one
      // across its whole front, 30 mm proud of the carcass): then its FRONT face meets that plane.
      flushFront: b.hi[2] - front,
    };
    // Which way is out: the free edge (the side away from the hinge) must move toward +z.
    const free = Math.abs(b.lo[0] - hinge[0]) > Math.abs(b.hi[0] - hinge[0]) ? b.lo[0] : b.hi[0];
    const [, zPlus] = turn(free, b.hi[2], hinge[0], hinge[1], OPEN_DOOR);
    const open = zPlus > b.hi[2] ? OPEN_DOOR : -OPEN_DOOR;
    const asModelled = -pick.angle; // the turn from closed back to the pose the designer left
    const row = {
      id, part: name, how,
      side: free > hinge[0] ? 'left' : 'right',
      wasOpen: Math.round((asModelled * 180) / Math.PI),
      sameWay: Math.abs(asModelled) < 0.02 || Math.sign(asModelled) === Math.sign(open),
      ...Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    };
    const ok = checks.thickness <= DOOR_MAX_THICKNESS && checks.outX <= TOL_EXTENT && checks.outY <= TOL_EXTENT && (Math.abs(checks.flush) <= TOL_FLUSH || (Math.abs(asModelled) < 0.01 && Math.abs(checks.flushFront) <= TOL_FLUSH));
    row.ok = ok && row.sameWay;
    report.push(row);
    moving.push({ part, kind: 'hinge', pivot: [hinge[0], b.lo[1], hinge[1]], extras: { part: 'hinge', axis: [0, 1, 0], open: Math.round(open * 1e6) / 1e6 } });
  }
  for (const part of parts.filter((p) => p.kind === 'drawer')) {
    const b = part.box;
    const depth = b.size[2];
    report.push({ id, part: part.name || '(unnamed drawer)', how: 'slide', side: '-', wasOpen: 0, sameWay: true, thickness: Math.round(depth), outX: 0, outY: 0, flush: Math.round((b.hi[2] - front) * 10) / 10, ok: b.hi[2] >= front - 2 && b.hi[2] <= front + 40 });
    moving.push({ part, kind: 'slide', pivot: [(b.lo[0] + b.hi[0]) / 2, b.lo[1], b.hi[2]], extras: { part: 'slide', dir: [0, 0, 1], open: Math.round(depth * OPEN_DRAWER) } });
  }

  // The closed assembly's frame: base at y = 0, footprint centred.
  const all = bounds(Float64Array.from(parts.flatMap((p) => [...p.pos])));
  const offset = [-(all.lo[0] + all.hi[0]) / 2, -all.lo[1], -(all.lo[2] + all.hi[2]) / 2];
  const meshes = [{ name: 'body', parts: body, origin: [0, 0, 0], extras: null }];
  let doors = 0, drawers = 0;
  for (const m of moving) {
    const pivot = m.pivot.map((v, a) => v + offset[a]);
    meshes.push({
      name: m.kind === 'hinge' ? `door:${doors++}` : `drawer:${drawers++}`,
      parts: [m.part],
      origin: pivot,
      translation: pivot,
      extras: m.extras,
    });
  }
  const glb = writeGlb(meshes, offset);
  return { glb, report, notes, size: all.size, doors, drawers };
}

// ── GLB writer ──

function writeGlb(meshes, offset) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [], accessors = [], gltfMeshes = [], nodes = [];
  const push = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    chunks.push(bytes);
    byteLength += bytes.length;
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    return bufferViews.length - 1;
  };
  for (const m of meshes) {
    const count = m.parts.reduce((s, p) => s + p.pos.length / 3, 0);
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    const indexCount = m.parts.reduce((s, p) => s + p.idx.length, 0);
    const idx = count > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let v = 0, k = 0;
    for (const p of m.parts) {
      for (let i = 0; i < p.pos.length; i += 3) for (let a = 0; a < 3; a++) {
        pos[v * 3 + i + a] = p.pos[i + a] + offset[a] - m.origin[a];
        nor[v * 3 + i + a] = p.nor ? p.nor[i + a] : 0;
      }
      for (const j of p.idx) idx[k++] = j + v;
      v += p.pos.length / 3;
    }
    const b = bounds(pos);
    const posAcc = accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count, type: 'VEC3', min: b.lo, max: b.hi }) - 1;
    const norAcc = accessors.push({ bufferView: push(nor, 34962), componentType: 5126, count, type: 'VEC3' }) - 1;
    const idxAcc = accessors.push({ bufferView: push(idx, 34963), componentType: idx instanceof Uint32Array ? 5125 : 5123, count: indexCount, type: 'SCALAR' }) - 1;
    gltfMeshes.push({ name: m.name, primitives: [{ attributes: { POSITION: posAcc, NORMAL: norAcc }, indices: idxAcc, material: 0 }] });
    const node = { name: m.name, mesh: gltfMeshes.length - 1 };
    if (m.translation) node.translation = m.translation.map((t) => Math.round(t * 1000) / 1000);
    if (m.extras) node.extras = m.extras;
    nodes.push(node);
  }
  const json = {
    asset: { version: '2.0', generator: 'tools/mozu/step-to-glb-parts.mjs' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    materials: [{ name: 'grey', pbrMetallicRoughness: { baseColorFactor: [0.82, 0.82, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: true }],
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const bin = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const chunkHeader = (len, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h; };
  return Buffer.concat([header, chunkHeader(jsonBytes.length, 0x4e4f534a), jsonBytes, chunkHeader(bin.length, 0x004e4942), bin]);
}

// ── CLI ──

async function main() {
  const wanted = process.argv.slice(2);
  const ids = readdirSync(STEP_DIR).filter((f) => f.endsWith('.step')).map((f) => f.slice(0, -5)).sort()
    .filter((id) => !wanted.length || wanted.includes(id));
  const occt = await occtimportjs();
  const rows = [], allNotes = [];
  let failed = false;
  console.log('model   size (mm, closed)      doors drawers  bytes before → after');
  for (const id of ids) {
    const out = join(OUT_DIR, `${id}.glb`);
    const before = existsSync(out) ? statSync(out).size : 0;
    const { glb, report, notes, size, doors, drawers } = convert(occt, id);
    rows.push(...report);
    allNotes.push(...notes);
    if (report.some((r) => !r.ok)) failed = true;
    else writeFileSync(out, glb);
    console.log(`${id.padEnd(7)} ${size.map((v) => Math.round(v)).join(' × ').padEnd(22)} ${String(doors).padStart(5)} ${String(drawers).padStart(7)}  ${String(before).padStart(8)} → ${glb.length}${report.some((r) => !r.ok) ? '  NOT WRITTEN' : ''}`);
  }
  if (rows.length) {
    console.log('\nClosed pose per door/drawer, mm. hinge: the side it is on, seen from the front. wasOpen: the turn the');
    console.log('designer left it at. vsFront: door back face (drawer front face) minus the carcass front plane.');
    console.table(rows.map((r) => ({ model: r.id, part: r.part, hinge: r.how === 'slide' ? 'slide' : `${r.side} (${r.how})`, wasOpen: r.how === 'slide' ? '-' : `${r.wasOpen}°`, 'thick/deep': r.thickness, outsideX: r.outX, outsideY: r.outY, vsFront: r.flush, ok: r.ok ? 'ok' : 'FAIL' })));
  }
  for (const n of allNotes) console.log(n);
  if (failed) {
    console.error('Some doors could not be closed cleanly (see FAIL above); those models were not written.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
