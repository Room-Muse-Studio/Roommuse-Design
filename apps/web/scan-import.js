/*
 * MOZU scan import — turns a RoomScan (mozu.roomscan/1) into the prototype's
 * own saved-project format, then reloads so the prototype restores it through
 * its normal "saved project" path. Nothing inside the prototype is patched.
 *
 * Prototype room model (read from index.html):
 *   space.roomW / roomD / wallH          room box in mm
 *   space.workflowSetup.openings[]       {kind:'door'|'window', wall:'back'|'left'|'right'|'front', start, width, height, bottom?, swing?}
 *   space.workflowSetup.obstacles[]      {kind, x, z, w, d}   (x across, z into the room, from the back-left corner)
 *   space.workflowSetup.services[]       {kind:'electrical'|'water'|'drainage'|'gas'|'duct', role, mobility, wall, u}
 * Saved under localStorage['mozu.prototype.kitchenWorkflow.project.v2'] as {version:2, spaces, ...}.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'mozu.prototype.kitchenWorkflow.project.v2';
  var BACKUP_KEY = STORAGE_KEY + '.before-scan';
  var JUST_LOADED_KEY = 'mozu.scanImport.justLoaded';
  var SDK_URL = '../../packages/scan-sdk/dist/mozu-scan-sdk.global.js';
  var HANDOFF_API = '/api/scan-handoff';
  var LINK_PARAMS = ['code', 'scan', 'poly'];
  var DEFAULT_PROJECT = {
    projectName: 'Sennett Residence — Unit 12-04',
    clientName: 'Studio Aoki / Ms L. Tan',
  };

  // ── RoomScan → prototype ──────────────────────────────────────────────

  var FIXTURE_KIND = { socket: 'electrical', switch: 'electrical', water: 'water', waste: 'drainage', gas: 'gas', vent: 'duct' };
  var FIXTURE_ROLE = { socket: 'socket', switch: 'switch', water: 'water pipe', waste: 'waste pipe', gas: 'gas pipe', vent: 'vent' };
  var RADIATOR = { w: 800, d: 120 };

  var num = function (v, fallback) { var n = Number(v); return Number.isFinite(n) ? n : fallback; };
  var round = function (v) { return Math.round(v); };

  /** Rotate the plan so the longest wall runs along X; RoomPlan rooms are rarely axis-aligned. */
  function alignment(polygon) {
    var best = 0, angle = 0;
    for (var i = 0; i < polygon.length; i++) {
      var a = polygon[i], b = polygon[(i + 1) % polygon.length];
      var len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len > best + 1) { best = len; angle = Math.atan2(b.z - a.z, b.x - a.x); } // ties keep the earlier wall
    }
    // Snap to the nearest quarter turn so an already-square room is left alone.
    var quarter = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
    return Math.abs(angle - quarter) < 0.01 ? 0 : angle;
  }

  function translate(scan) {
    var turn = alignment(scan.polygon), cos = Math.cos(-turn), sin = Math.sin(-turn);
    var rot = function (p) { return { x: p.x * cos - p.z * sin, z: p.x * sin + p.z * cos }; };
    var pts = scan.polygon.map(rot);
    var minX = Math.min.apply(null, pts.map(function (p) { return p.x; }));
    var maxX = Math.max.apply(null, pts.map(function (p) { return p.x; }));
    var minZ = Math.min.apply(null, pts.map(function (p) { return p.z; }));
    var maxZ = Math.max.apply(null, pts.map(function (p) { return p.z; }));
    var W = round(maxX - minX), D = round(maxZ - minZ), H = round(num(scan.height, 2700));
    var local = function (p) { var r = rot(p); return { x: r.x - minX, z: r.z - minZ }; };
    var warnings = [];

    var rectangular = pts.length === 4 && pts.every(function (p) {
      return (Math.abs(p.x - minX) < 50 || Math.abs(p.x - maxX) < 50) && (Math.abs(p.z - minZ) < 50 || Math.abs(p.z - maxZ) < 50);
    });
    if (!rectangular) warnings.push('The scanned room is not a simple rectangle; its outer ' + W + ' × ' + D + ' mm box was used.');

    // Wall i runs polygon[i] → polygon[i+1]. Name it by the side of the box it lies on.
    function wallInfo(i) {
      var a = scan.polygon[i % scan.polygon.length], b = scan.polygon[(i + 1) % scan.polygon.length];
      if (!a || !b) return null;
      var la = local(a), lb = local(b), mx = (la.x + lb.x) / 2, mz = (la.z + lb.z) / 2;
      var side = [['back', mz], ['front', D - mz], ['left', mx], ['right', W - mx]]
        .sort(function (p, q) { return p[1] - q[1]; })[0][0];
      var len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return {
        side: side,
        limit: side === 'back' || side === 'front' ? W : D,
        // Distance from the back-left corner along this wall for a point `t` mm from the wall's start.
        along: function (t) {
          var f = Math.max(0, Math.min(1, t / len));
          var p = { x: la.x + (lb.x - la.x) * f, z: la.z + (lb.z - la.z) * f };
          return side === 'back' || side === 'front' ? p.x : p.z;
        },
        point: function (t) {
          var f = Math.max(0, Math.min(1, t / len));
          return { x: la.x + (lb.x - la.x) * f, z: la.z + (lb.z - la.z) * f };
        },
      };
    }

    var openings = [], obstacles = [], services = [];

    (scan.openings || []).forEach(function (o, i) {
      var w = wallInfo(num(o.wall, -1));
      if (!w) { warnings.push('Opening ' + (i + 1) + ' is on an unknown wall and was skipped.'); return; }
      var offset = num(o.offset, 0), width = num(o.width, 0);
      var start = Math.min(w.along(offset), w.along(offset + width));
      start = Math.max(0, Math.min(w.limit - width, start));
      var isWindow = o.type === 'window';
      var out = { kind: isWindow ? 'window' : 'door', wall: w.side, start: round(start), width: round(width), height: round(num(o.height, isWindow ? 1200 : 2050)) };
      if (isWindow) out.bottom = o.sill != null ? round(num(o.sill, 0)) : '';
      else out.swing = o.type === 'archway' ? 'open' : ''; // the scan can't see the hinge side
      openings.push(out);
    });

    (scan.objects || []).forEach(function (o) {
      var c = local(o.center || { x: 0, z: 0 });
      var r = num(o.rotation, 0) - turn, cw = num(o.width, 0), cd = num(o.depth, 0);
      var w = Math.abs(cw * Math.cos(r)) + Math.abs(cd * Math.sin(r));
      var d = Math.abs(cw * Math.sin(r)) + Math.abs(cd * Math.cos(r));
      var x = Math.max(0, c.x - w / 2), z = Math.max(0, c.z - d / 2);
      obstacles.push({ kind: 'obstacle', label: o.category || 'object', x: round(x), z: round(z), w: round(Math.min(w, W - x)), d: round(Math.min(d, D - z)) });
    });

    (scan.fixtures || []).forEach(function (f, i) {
      var w = wallInfo(num(f.wall, -1));
      if (!w) { warnings.push('Fixture ' + (i + 1) + ' is on an unknown wall and was skipped.'); return; }
      var offset = num(f.offset, 0);
      if (f.type === 'radiator') {
        var p = w.point(offset), ow = RADIATOR.w, od = RADIATOR.d;
        var along = w.side === 'back' || w.side === 'front';
        var bw = along ? ow : od, bd = along ? od : ow;
        var bx = Math.max(0, Math.min(W - bw, p.x - bw / 2)), bz = Math.max(0, Math.min(D - bd, p.z - bd / 2));
        obstacles.push({ kind: 'obstacle', label: 'radiator', x: round(bx), z: round(bz), w: bw, d: bd });
        return;
      }
      var kind = FIXTURE_KIND[f.type];
      if (!kind) { warnings.push('Fixture type "' + f.type + '" is not supported and was skipped.'); return; }
      services.push({
        kind: kind, role: f.label || FIXTURE_ROLE[f.type], mobility: 'fixed', wall: w.side, u: round(w.along(offset)),
        height: f.height != null ? round(num(f.height, 0)) : undefined, source: 'scan', scanType: f.type,
      });
    });

    return { W: W, D: D, H: H, openings: openings, obstacles: obstacles, services: services, warnings: warnings };
  }

  // ── Parsing ───────────────────────────────────────────────────────────

  var sdkPromise = null;
  function loadSdk() {
    if (window.MozuScan) return Promise.resolve(window.MozuScan);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = new URL(SDK_URL, scriptBase).href;
      s.onload = function () { resolve(window.MozuScan || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  /** Validate with the SDK, but take fixtures from the raw JSON — the built SDK drops them. */
  function parse(text) {
    var raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('This file is not valid JSON.'); }
    if (!raw || typeof raw !== 'object') throw new Error('This file is not a room scan.');
    if (raw.schema && raw.schema !== 'mozu.roomscan/1') throw new Error('Unsupported scan format "' + raw.schema + '".');
    return loadSdk().then(function (sdk) {
      var scan = sdk && sdk.parseScan ? sdk.parseScan(JSON.stringify(raw)) : fallbackParse(raw);
      if (!scan) throw new Error('This file has no usable room outline (it needs at least 3 corner points).');
      scan.fixtures = Array.isArray(raw.fixtures) ? raw.fixtures : [];
      return scan;
    });
  }

  function fallbackParse(raw) {
    if (!Array.isArray(raw.polygon)) return null;
    var polygon = raw.polygon.map(function (p) { return { x: Number(p.x), z: Number(p.z) }; })
      .filter(function (p) { return Number.isFinite(p.x) && Number.isFinite(p.z); });
    if (polygon.length < 3) return null;
    return {
      polygon: polygon, height: Number(raw.height) || 2700,
      openings: Array.isArray(raw.openings) ? raw.openings : [],
      objects: Array.isArray(raw.objects) ? raw.objects : [],
      source: raw.source || 'manual', confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.8,
      capturedAt: raw.capturedAt || new Date().toISOString(),
    };
  }

  // ── Writing into the prototype's saved project ────────────────────────

  function readSaved() {
    try {
      var data = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      return data && data.version === 2 && Array.isArray(data.spaces) && data.spaces.length ? data : null;
    } catch (e) { return null; }
  }

  function apply(scan, fileName) {
    var t = translate(scan);
    var saved = readSaved();
    var data = saved ? JSON.parse(JSON.stringify(saved)) : {
      version: 2, projectName: DEFAULT_PROJECT.projectName, clientName: DEFAULT_PROJECT.clientName,
      spaces: [], activeSpace: 'sp1', tab: 'kitchen', uid: 100,
    };
    var kitchen = data.spaces.find(function (s) { return s.id === data.activeSpace && s.room === 'kitchen'; }) ||
      data.spaces.find(function (s) { return s.room === 'kitchen'; });
    if (!kitchen) {
      kitchen = { id: 'sp1', countertopHeight: 850, name: 'Kitchen', type: 'Kitchen', room: 'kitchen', finish: 'mozu-default', hw: 'h1', install: true, delivery: true, extras: {}, tops: [], items: [] };
      if (data.spaces.some(function (s) { return s.id === 'sp1'; })) kitchen.id = 'sp-scan';
      data.spaces.unshift(kitchen);
    }
    // Existing cabinets were placed for the old room and may not fit the scanned one.
    kitchen.items = [];
    kitchen.tops = [];
    kitchen.roomW = t.W;
    kitchen.wallW = t.W;
    kitchen.roomD = t.D;
    kitchen.wallH = t.H;
    kitchen.workflowSetup = { openings: t.openings, obstacles: t.obstacles, services: t.services };
    kitchen.scanImport = { file: fileName, source: scan.source, confidence: scan.confidence, capturedAt: scan.capturedAt, importedAt: new Date().toISOString() };
    data.activeSpace = kitchen.id;
    data.tab = 'kitchen';
    // Old workflow answers for this room would override the scanned setup.
    if (data.workflowAnswers) delete data.workflowAnswers[kitchen.id];

    try {
      if (saved) window.localStorage.setItem(BACKUP_KEY, JSON.stringify(saved));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      window.sessionStorage.setItem(JUST_LOADED_KEY, JSON.stringify(summary(scan, t, fileName)));
    } catch (e) {
      throw new Error('The browser would not let the page save the room (storage is blocked or full).');
    }
    // Drop ?code= / ?scan= so the reload doesn't import the same room again.
    if (LINK_PARAMS.some(function (k) { return new URLSearchParams(window.location.search).has(k); })) {
      window.location.replace(window.location.pathname + window.location.hash);
    } else {
      window.location.reload();
    }
  }

  function summary(scan, t, fileName) {
    var count = function (list, pred) { return list.filter(pred).length; };
    var plural = function (n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); };
    var parts = [
      (t.W / 1000).toFixed(2) + ' × ' + (t.D / 1000).toFixed(2) + ' m, ' + (t.H / 1000).toFixed(2) + ' m ceiling',
      plural(count(t.openings, function (o) { return o.kind === 'door'; }), 'door'),
      plural(count(t.services, function (s) { return s.scanType === 'socket'; }), 'socket'),
    ];
    var windows = count(t.openings, function (o) { return o.kind === 'window'; });
    if (windows) parts.push(plural(windows, 'window'));
    var other = count(t.services, function (s) { return s.scanType !== 'socket'; });
    if (other) parts.push(plural(other, 'other service point'));
    if (t.obstacles.length) parts.push(plural(t.obstacles.length, 'obstacle'));
    return {
      text: 'Scan loaded' + (fileName ? ' from ' + fileName : '') + ': ' + parts.join(' · ') +
        // The workflow lists the water, drainage and appliance power it needs (wfServices in the
        // prototype) whether or not the scan found them; say so, or they read as scan errors.
        '\nThe workflow also lists the water, drainage and appliance power a kitchen needs. ' +
        'The scan can’t see pipes, so mark those positions under “Connections and mobility”.',
      warnings: t.warnings,
    };
  }

  // ── 3D markers for doors, windows and service points ──────────────────
  //
  // The prototype's 3D room (createRoom) only draws floor, walls and ceiling; the
  // scanned openings and sockets live in space.workflowSetup and only reach the 2D
  // room plan. Rather than patch the bundle, find the planner component through
  // React's fiber on the 3D canvas and add our own group to its scene. This leans
  // on the prototype's internals (_v3d.scene, v3dRoomDims, space()); if a future
  // export renames them the markers just stop appearing.

  var MARKER = {
    inset: 15,           // mm in front of the wall surface, so markers don't z-fight with it
    frame: 40,           // door/window frame bar thickness, mm
    plate: 120,          // service marker plate size, mm
    serviceHeight: 300,  // used when a service point has no height
    sill: 900,           // used when a window has no sill height
    colors: { door: 0x32816B, window: 0x4D8FC8, electrical: 0xD09E16, water: 0x146BC0, drainage: 0x5B6770, gas: 0xC33A20, duct: 0x8A8F94 },
  };

  function plannerFromCanvas(canvas) {
    var host = canvas.parentElement;
    var key = host && Object.keys(host).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
    for (var f = key && host[key], i = 0; f && i < 60; f = f.return, i++) {
      // The prototype's runtime wraps the planner class: the React component keeps it as `.logic`.
      var candidates = [f.stateNode, f.stateNode && f.stateNode.logic];
      for (var j = 0; j < candidates.length; j++) {
        var inst = candidates[j];
        if (inst && inst._v3d && inst._v3d.renderer && inst._v3d.renderer.domElement === canvas) return inst;
      }
    }
    return null;
  }

  function findPlanner() {
    var canvases = document.querySelectorAll('canvas');
    for (var i = 0; i < canvases.length; i++) {
      var inst = plannerFromCanvas(canvases[i]);
      if (inst) return inst;
    }
    return null;
  }

  /** Place a flat w×h (mm) rectangle on a wall, `u` = its left edge from the back-left corner, `y` = its bottom. */
  var given = function (v, fallback) { return v === '' || v == null ? fallback : num(v, fallback); };

  function onWall(obj, wall, R, u, w, y, h) {
    var s = 1 / 1000, c = u + w / 2, cy = (y + h / 2) * s;
    if (wall === 'back') { obj.position.set(c * s, cy, MARKER.inset * s); }
    else if (wall === 'front') { obj.position.set(c * s, cy, (R.d - MARKER.inset) * s); obj.rotation.y = Math.PI; }
    else if (wall === 'left') { obj.position.set(MARKER.inset * s, cy, c * s); obj.rotation.y = Math.PI / 2; }
    else if (wall === 'right') { obj.position.set((R.w - MARKER.inset) * s, cy, c * s); obj.rotation.y = -Math.PI / 2; }
    else return null;
    return obj;
  }

  function buildMarkers(THREE, setup, R) {
    var s = 1 / 1000, group = new THREE.Group();
    group.name = 'mozu-scan-markers';
    var mat = function (color, opacity) {
      return new THREE.MeshBasicMaterial({ color: color, transparent: opacity < 1, opacity: opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide });
    };
    var box = function (w, h, d, material, x, y) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, d * s), material);
      m.position.set(x * s, y * s, 0);
      return m;
    };

    (setup.openings || []).forEach(function (o) {
      var w = num(o.width, 0), isWindow = o.kind === 'window';
      var y = isWindow ? given(o.bottom, MARKER.sill) : 0;
      var h = given(o.height, isWindow ? 1200 : 2050);
      if (!(w > 0 && h > 0)) return;
      var color = MARKER.colors[isWindow ? 'window' : 'door'], bar = MARKER.frame, frame = mat(color, 1);
      // A rectangle centred on the origin, facing +z: a see-through panel inside a solid frame.
      var g = new THREE.Group();
      g.add(box(w, h, 2, mat(color, 0.22), 0, 0));
      g.add(box(bar, h, bar / 2, frame, -w / 2 + bar / 2, 0));
      g.add(box(bar, h, bar / 2, frame, w / 2 - bar / 2, 0));
      g.add(box(w, bar, bar / 2, frame, 0, h / 2 - bar / 2));
      if (isWindow) g.add(box(w, bar, bar / 2, frame, 0, -h / 2 + bar / 2));
      if (onWall(g, o.wall, R, num(o.start, 0), w, y, h)) group.add(g);
    });

    (setup.services || []).forEach(function (p) {
      if (!p.wall || p.u === '' || p.u == null || !Number.isFinite(Number(p.u))) return;
      var size = MARKER.plate, y = given(p.height, MARKER.serviceHeight);
      var plate = box(size, size, 20, mat(MARKER.colors[p.kind] || MARKER.colors.electrical, 1), 0, 0);
      plate.name = p.kind + ' · ' + p.role;
      if (onWall(plate, p.wall, R, Number(p.u) - size / 2, size, y - size / 2, size)) group.add(plate);
    });
    return group;
  }

  function disposeMarkers(group) {
    group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    if (group.parent) group.parent.remove(group);
  }

  function watchMarkers() {
    var current = null, currentScene = null, sig = '';
    setInterval(function () {
      var THREE = window.THREE, inst = THREE && findPlanner(), T = inst && inst._v3d;
      var sp = T && typeof inst.space === 'function' ? inst.space() : null;
      if (!sp || !T.scene) return;
      var setup = sp.workflowSetup || {}, R = inst.v3dRoomDims(sp);
      var next = JSON.stringify([sp.id, R.w, R.d, R.h, setup.openings || [], setup.services || []]);
      if (current && currentScene === T.scene && current.parent === T.scene && next === sig) return;
      if (current) disposeMarkers(current);
      current = buildMarkers(THREE, setup, R);
      currentScene = T.scene;
      sig = next;
      T.scene.add(current);
      T.dirty = true;
    }, 400);
  }
  watchMarkers();

  // ── UI (the section lives in index.html; the bundle swaps the whole document on load) ──

  var scriptBase = (document.currentScript && document.currentScript.src) || window.location.href;
  var section = document.getElementById('mozu-scan-import');
  if (!section) return;
  section.style.display = 'none';
  var fileBtn = section.querySelector('#mozu-scan-file-btn');
  var fileInput = section.querySelector('#mozu-scan-file');
  var status = section.querySelector('#mozu-scan-status');
  var codeForm = section.querySelector('#mozu-scan-code-form');
  var codeInput = section.querySelector('#mozu-scan-code');

  function setStatus(text, isError) {
    status.textContent = text || '';
    status.style.color = isError ? '#B3261E' : '#2C2D2D';
    status.hidden = !text;
  }

  /** Cabinets in the kitchen the scan would replace (0 when nothing is saved yet). */
  function cabinetCount() {
    var saved = readSaved();
    if (!saved) return 0;
    var kitchen = saved.spaces.find(function (s) { return s.id === saved.activeSpace && s.room === 'kitchen'; }) ||
      saved.spaces.find(function (s) { return s.room === 'kitchen'; });
    return kitchen && Array.isArray(kitchen.items) ? kitchen.items.length : 0;
  }

  /** In-page yes/no inside the scan section; resolves true for Replace. */
  function confirmReplace(cabinets) {
    return new Promise(function (resolve) {
      setStatus('');
      var previous = section.querySelector('[role="alertdialog"]');
      if (previous) previous.remove();
      var box = document.createElement('div');
      box.setAttribute('role', 'alertdialog');
      box.style.cssText = 'flex-basis:100%;background:#fff;border:1px solid #C33A20;border-radius:6px;padding:8px 10px;box-shadow:0 1px 4px rgba(0,0,0,.08)';
      var text = document.createElement('div');
      text.textContent = 'Replace the current kitchen with the scanned room? Its ' + cabinets + ' cabinet' + (cabinets === 1 ? '' : 's') +
        ' will be cleared; the previous project is kept as a backup.';
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;margin-top:6px';
      var button = function (label, primary, value) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = 'padding:5px 10px;border:1px solid #C33A20;border-radius:6px;cursor:pointer;font:600 12px -apple-system,BlinkMacSystemFont,sans-serif;' +
          (primary ? 'background:#C33A20;color:#fff' : 'background:#fff;color:#C33A20');
        b.addEventListener('click', function () { box.remove(); resolve(value); });
        return b;
      };
      var yes = button('Replace kitchen', true, true);
      row.appendChild(yes);
      row.appendChild(button('Cancel', false, false));
      box.appendChild(text);
      box.appendChild(row);
      section.appendChild(box);
      yes.focus();
    });
  }

  function importText(text, fileName) {
    setStatus('Reading scan…');
    return parse(text).then(function (scan) {
      var cabinets = cabinetCount();
      return (cabinets ? confirmReplace(cabinets) : Promise.resolve(true)).then(function (ok) {
        if (!ok) { setStatus(''); return; }
        apply(scan, fileName);
      });
    }).catch(function (e) { setStatus(e.message, true); });
  }

  /** Fetch a scan the iPad uploaded, by its 6-character code. */
  function importCode(input) {
    var code = String(input || '').trim();
    if (!code) { setStatus('Type the 6-character code shown in the MOZU Scanner app.', true); return Promise.resolve(); }
    if (window.location.protocol === 'file:') {
      setStatus('Codes need the MOZU server. In Terminal run "npm start" in the mozu-design folder, then open http://localhost:3000', true);
      return Promise.resolve();
    }
    setStatus('Looking up ' + code.toUpperCase() + '…');
    return fetch(HANDOFF_API + '?code=' + encodeURIComponent(code), { cache: 'no-store' })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || !body.scan) throw new Error(body.error || 'The server could not find that code (HTTP ' + res.status + ').');
          return importText(JSON.stringify(body.scan), 'code ' + (body.code || code.toUpperCase()));
        });
      })
      .catch(function (e) {
        setStatus(e instanceof TypeError ? 'Could not reach MOZU. Check the internet connection and try again.' : e.message, true);
      });
  }

  /** The iPad's "Open in MOZU on this iPad" link: ?poly=x,z;x,z…&h=…&src=…[&scan=<base64url JSON>]. */
  function scanFromLink(params) {
    var b64 = params.get('scan');
    if (b64) {
      var text = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
      return decodeURIComponent(Array.prototype.map.call(text, function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    }
    var polygon = String(params.get('poly') || '').split(';').map(function (pair) {
      var xz = pair.split(',');
      return { x: Number(xz[0]), z: Number(xz[1]) };
    });
    return JSON.stringify({
      schema: 'mozu.roomscan/1', polygon: polygon, height: Number(params.get('h')) || 2700,
      openings: [], objects: [], fixtures: [], source: params.get('src') || 'manual',
    });
  }

  function importFromAddress() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('code')) {
      codeInput.value = params.get('code').toUpperCase();
      return importCode(params.get('code'));
    }
    if (params.get('scan') || params.get('poly')) {
      var text;
      try { text = scanFromLink(params); } catch (e) { setStatus('The scan link is damaged and could not be read.', true); return; }
      return importText(text, 'phone link');
    }
  }

  codeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    importCode(codeInput.value);
  });

  fileBtn.addEventListener('click', function () { fileInput.value = ''; fileInput.click(); });
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    file.text().then(function (text) { importText(text, file.name); });
  });

  // Exposed for the code box (Phase 3) and for testing from the console.
  window.MozuScanImport = { importText: importText, importCode: importCode, translate: translate, parse: parse, setStatus: setStatus };

  // Keep the section on the page: the bundle replaces <html> once it has unpacked.
  var ready = false;
  var keeper = setInterval(function () {
    if (!document.body) return;
    if (!section.isConnected) document.body.appendChild(section);
    if (!document.getElementById('__bundler_loading') && document.querySelector('[class], button') && !ready) {
      ready = true;
      section.hidden = false;
      section.style.display = 'flex';
      afterReload();
      importFromAddress();
    }
  }, 250);
  setTimeout(function () { clearInterval(keeper); }, 5 * 60 * 1000);

  function afterReload() {
    var info = null;
    try { info = JSON.parse(window.sessionStorage.getItem(JUST_LOADED_KEY) || 'null'); window.sessionStorage.removeItem(JUST_LOADED_KEY); } catch (e) { /* storage blocked */ }
    if (!info) return;
    setStatus(info.text + (info.warnings && info.warnings.length ? '\n⚠ ' + info.warnings.join('\n⚠ ') : ''));
    // Open the Kitchen Workflow room setup, where the doors and sockets are drawn.
    // A first visit unpacks a large page, so give the button up to a minute to appear.
    var tries = 0;
    var opener = setInterval(function () {
      var start = Array.prototype.find.call(document.querySelectorAll('button'), function (b) {
        return b.textContent.trim() === 'Start Workflow Auto Design' && b.offsetParent !== null;
      });
      if (start) { clearInterval(opener); start.click(); }
      else if (++tries > 240) clearInterval(opener);
    }, 250);
  }
})();
