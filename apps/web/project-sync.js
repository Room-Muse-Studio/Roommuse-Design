/*
 * MOZU project sync — runs inside editor.html and autosaves the open project
 * to the person's account. Active only when the page was opened by the shell
 * as /editor.html?project=<id> (guest mode has no ?project and nothing here runs).
 *
 * How it works, without touching the prototype's code:
 *   1. The shell wrote the project into the prototype's localStorage slot and a
 *      note in `mozu.shell.slot` ({ pid, rev, name, openedAt }); the prototype
 *      restores the slot on load as it always has.
 *   2. We find the planner instance through React's fiber tree under #dc-root,
 *      confirm the restore succeeded (state.saved === true; a failed restore
 *      loads the default project and must never be saved over the real one),
 *      then wrap its setState to notice edits. Workflow answers are mutated in
 *      place, so those are hashed on a timer.
 *   3. Two seconds after the last change (ten at most) the same JSON the
 *      prototype's own "Save" builds is PUT to /api/projects/<id> with the
 *      revision we loaded. A 409 means another tab or device saved first: the
 *      person chooses to reload theirs or keep this one.
 *   4. Status goes to the shell with postMessage; it shows "Saved 12:03" etc.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var pid = params.get('project');
  if (!pid) return;

  var SLOT = 'mozu.prototype.kitchenWorkflow.project.v2';
  var VERSIONS_KEY = 'mozu.prototype.kitchenWorkflow.versions';
  var SHELL_SLOT = 'mozu.shell.slot';
  var DEBOUNCE_MS = 2000, MAX_WAIT_MS = 10000, TICK_MS = 3000, KEEP_VERSIONS = 10;
  var TRACKED = ['spaces', 'projectName', 'clientName', 'activeSpace', 'tab'];

  var shellInfo = null;
  try { shellInfo = JSON.parse(window.localStorage.getItem(SHELL_SLOT) || 'null'); } catch (e) { /* storage blocked */ }
  if (!shellInfo || shellInfo.pid !== pid) {
    // Opened directly (bookmark, refresh in a new tab): let the shell load the project properly.
    window.location.replace('/?open=' + encodeURIComponent(pid));
    return;
  }

  var inShell = window.parent && window.parent !== window;
  var rev = Number(shellInfo.rev) || 1;
  var openedAt = shellInfo.openedAt;
  var baseline = null;
  try { baseline = JSON.parse(window.localStorage.getItem(SLOT) || 'null'); } catch (e) { /* ignore */ }

  var inst = null, hooked = false, readOnly = false, dirty = false, saving = false, conflict = null;
  var timer = null, maxTimer = null, retryTimer = null, retryDelay = 5000;
  var lastSent = baseline ? JSON.stringify(baseline) : '';
  var lastWfHash = '', lastVersionsLen = -1, slotOwned = true, currentStatus = { state: '', text: '' };

  var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
  /** Same FNV-1a hash as shell.js; compares the slot with what the account holds. */
  function hashOf(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  }
  var clock = function () { var d = new Date(); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

  function post(msg) {
    if (!inShell) return;
    try { window.parent.postMessage(msg, window.location.origin); } catch (e) { /* ignore */ }
  }

  function status(state, text) {
    currentStatus = { state: state, text: text || '' };
    post({ type: 'mozu:status', state: state, text: text || '', dirty: dirty, rev: rev, name: inst ? inst.state.projectName : shellInfo.name });
  }

  // ── Finding the planner ───────────────────────────────────────────────

  function isPlanner(c) {
    return !!(c && typeof c.saveProject === 'function' && typeof c.setState === 'function' && c.state && Array.isArray(c.state.spaces));
  }

  function fromFiber(fiber) {
    var stack = [fiber], seen = 0;
    while (stack.length && seen < 20000) {
      var f = stack.pop();
      seen++;
      if (!f) continue;
      var sn = f.stateNode;
      if (isPlanner(sn)) return sn;
      if (sn && isPlanner(sn.logic)) return sn.logic;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  }

  function findPlanner() {
    var root = document.getElementById('dc-root');
    var start = root || document.body;
    if (!start) return null;
    var key = Object.keys(start).find(function (k) { return k.indexOf('__reactContainer$') === 0 || k.indexOf('__reactFiber$') === 0; });
    if (key && start[key]) {
      var found = fromFiber(start[key]);
      if (found) return found;
    }
    // Fallback: climb from any rendered element, the way scan-import.js does from the 3D canvas.
    var els = (root || document).querySelectorAll('button, canvas');
    for (var i = 0; i < els.length && i < 40; i++) {
      var el = els[i];
      var fk = Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
      for (var f = fk && el[fk], n = 0; f && n < 80; f = f.return, n++) {
        var sn = f.stateNode;
        if (isPlanner(sn)) return sn;
        if (sn && isPlanner(sn.logic)) return sn.logic;
      }
    }
    return null;
  }

  // ── Change detection ──────────────────────────────────────────────────

  function hook() {
    if (hooked) return;
    hooked = true;
    var original = inst.setState;
    inst.setState = function (patch) {
      var result = original.apply(this, arguments);
      if (patch && typeof patch === 'object' && TRACKED.some(function (k) { return Object.prototype.hasOwnProperty.call(patch, k); })) markDirty();
      return result;
    };
  }

  function wfHash() {
    try { return JSON.stringify(inst._wf && inst._wf.rooms ? inst._wf.rooms : null); } catch (e) { return ''; }
  }

  function markDirty() {
    if (readOnly) return;
    dirty = true;
    if (!conflict) status('dirty', 'Unsaved changes');
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(timer);
    timer = setTimeout(function () { save(); }, DEBOUNCE_MS);
    if (!maxTimer) maxTimer = setTimeout(function () { save(); }, MAX_WAIT_MS);
  }

  // ── Snapshot: the same shape the prototype's saveProject writes ───────

  function snapshot() {
    var w = inst._wf || {};
    var data = {
      version: 2,
      projectName: inst.state.projectName,
      clientName: inst.state.clientName,
      spaces: copy(inst.state.spaces),
      activeSpace: inst.state.activeSpace,
      tab: inst.state.tab,
      uid: inst.uid,
      workflowAnswers: copy(w.rooms || {}),
    };
    if (baseline && baseline.workflowRules) data.workflowRules = baseline.workflowRules;
    return data;
  }

  function rememberRev(name, json) {
    try {
      var s = JSON.parse(window.localStorage.getItem(SHELL_SLOT) || 'null');
      if (s && s.pid === pid) {
        s.rev = rev;
        if (name) s.name = name;
        if (json) s.hash = hashOf(json);
        window.localStorage.setItem(SHELL_SLOT, JSON.stringify(s));
      }
    } catch (e) { /* ignore */ }
  }

  // ── Saving ────────────────────────────────────────────────────────────

  function save(opts) {
    opts = opts || {};
    clearTimeout(timer); clearTimeout(maxTimer); clearTimeout(retryTimer);
    timer = maxTimer = retryTimer = null;
    if (!inst || readOnly || conflict) return Promise.resolve(false);
    if (saving) { dirty = true; return Promise.resolve(false); }
    if (inst._wfPreview) { scheduleSave(); return Promise.resolve(false); } // mid auto-design preview: wait
    var data = snapshot();
    var json = JSON.stringify(data);
    if (json === lastSent) { dirty = false; status('saved', currentStatus.state === 'saved' ? currentStatus.text : 'Saved'); return Promise.resolve(true); }

    saving = true;
    dirty = false;
    status('saving', 'Saving…');
    if (slotOwned) { try { window.localStorage.setItem(SLOT, json); } catch (e) { /* quota: the server copy is what matters */ } }

    var init = { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev: rev, data: data }) };
    if (opts.keepalive && init.body.length < 60000) init.keepalive = true;
    return fetch('/api/projects/' + encodeURIComponent(pid), init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.status === 409) { onConflict(body); return false; }
        if (res.status === 401) {
          readOnly = true;
          status('error', 'You were signed out. Sign in again to keep saving; your latest changes are kept on this device.');
          post({ type: 'mozu:signed-out' });
          return false;
        }
        if (res.status === 413 || res.status === 400) {
          readOnly = true;
          status('error', body.error || 'This project could not be saved.');
          return false;
        }
        if (!res.ok) throw Object.assign(new Error(body.error || ('HTTP ' + res.status)), { status: res.status });
        rev = body.rev || rev + 1;
        lastSent = json;
        retryDelay = 5000;
        rememberRev(data.projectName, json);
        status('saved', 'Saved ' + clock());
        return true;
      });
    }).catch(function () {
      dirty = true;
      var offline = typeof navigator.onLine === 'boolean' && !navigator.onLine;
      status(offline ? 'offline' : 'error', offline ? 'Offline — changes are kept on this device' : 'Couldn’t save — retrying…');
      retryTimer = setTimeout(function () { save(); }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60000);
      return false;
    }).then(function (ok) {
      saving = false;
      if (dirty && !conflict && !readOnly) scheduleSave();
      return ok;
    });
  }

  // ── Conflicts (two tabs / devices) ────────────────────────────────────

  var conflictBox = null;

  function onConflict(body) {
    conflict = { rev: body.rev, updatedAt: body.updatedAt };
    dirty = true;
    status('conflict', 'Changed elsewhere — choose which version to keep');
    if (conflictBox) return;
    conflictBox = document.createElement('div');
    conflictBox.setAttribute('role', 'alertdialog');
    conflictBox.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:10002;max-width:520px;background:#fff;border:1px solid #C33A20;border-radius:8px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.14);font:13px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;color:#2C2D2D';
    var when = body.updatedAt ? new Date(body.updatedAt).toLocaleString() : 'just now';
    conflictBox.innerHTML =
      '<div><b>This project was changed somewhere else</b> (' + when + '), perhaps in another tab or on another device.</div>' +
      '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">' +
      '<button type="button" data-act="theirs" style="padding:5px 10px;border:1px solid #C33A20;border-radius:6px;background:#C33A20;color:#fff;font:600 12px -apple-system,sans-serif;cursor:pointer">Reload their version</button>' +
      '<button type="button" data-act="mine" style="padding:5px 10px;border:1px solid #C33A20;border-radius:6px;background:#fff;color:#C33A20;font:600 12px -apple-system,sans-serif;cursor:pointer">Keep mine</button>' +
      '</div>';
    conflictBox.addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act');
      if (act === 'theirs') reloadTheirs();
      if (act === 'mine') keepMine();
    });
    document.body.appendChild(conflictBox);
  }

  function closeConflict() {
    if (conflictBox) { conflictBox.remove(); conflictBox = null; }
    conflict = null;
  }

  function keepMine() {
    rev = conflict.rev;
    closeConflict();
    lastSent = '';
    save();
  }

  function reloadTheirs() {
    status('saving', 'Loading the other version…');
    fetch('/api/projects/' + encodeURIComponent(pid), { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      var theirs = JSON.stringify(json.data);
      window.localStorage.setItem(SLOT, theirs);
      rev = json.project.rev;
      rememberRev(json.project.name, theirs);
      closeConflict();
      dirty = false;
      window.location.reload();
    }).catch(function () {
      status('conflict', 'Couldn’t load the other version. Try again, or keep yours.');
    });
  }

  // ── Wiring ────────────────────────────────────────────────────────────

  // Flush requests from the shell (leaving the editor, signing out).
  window.addEventListener('message', function (e) {
    if (e.origin !== window.location.origin || !e.data || e.data.type !== 'mozu:flush') return;
    var done = function () { post({ type: 'mozu:flushed', dirty: dirty }); };
    if (dirty && !saving) save({ keepalive: true }).then(done, done);
    else if (saving) setTimeout(done, 1500);
    else done();
  });

  // Save before the tab hides or unloads; warn if something is still pending.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && dirty && !saving) save({ keepalive: true });
  });
  window.addEventListener('pagehide', function () { if (dirty && !saving) save({ keepalive: true }); });
  window.addEventListener('beforeunload', function (e) {
    if (dirty || saving) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('online', function () { if (dirty) save(); });

  // Another tab opened a project: the shared slot is theirs now.
  window.addEventListener('storage', function (e) {
    if (e.key !== SHELL_SLOT || !e.newValue) return;
    var other;
    try { other = JSON.parse(e.newValue); } catch (err) { return; }
    if (!other) return;
    if (other.pid === pid && other.openedAt && other.openedAt !== openedAt) {
      status('conflict', 'This project is open in another tab. Close one of them to avoid overwriting changes.');
    } else if (other.pid !== pid) {
      slotOwned = false; // keep saving to the account, stop touching this device's slot
    }
  });

  // The prototype's own "Save as New Prototype Version" appends forever; keep the last few.
  function trimVersions() {
    try {
      var raw = window.localStorage.getItem(VERSIONS_KEY);
      var len = raw ? raw.length : 0;
      if (len === lastVersionsLen) return;
      lastVersionsLen = len;
      if (!raw) return;
      var versions = JSON.parse(raw);
      if (Array.isArray(versions) && versions.length > KEEP_VERSIONS) {
        window.localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions.slice(-KEEP_VERSIONS)));
        lastVersionsLen = -1;
      }
    } catch (e) { /* ignore */ }
  }

  function start() {
    // Restore must have succeeded, or the editor is showing the default project.
    var waited = 0;
    var check = setInterval(function () {
      waited += 250;
      if (inst.state.saved === true) {
        clearInterval(check);
        hook();
        lastWfHash = wfHash();
        status('saved', 'All changes saved');
        // The slot no longer matches the account copy (a scan was imported into it,
        // or a save didn't finish last time): push it now.
        if (shellInfo.hash && lastSent && hashOf(lastSent) !== shellInfo.hash) { lastSent = ''; markDirty(); }
        setInterval(function () {
          if (readOnly) return;
          var h = wfHash();
          if (h !== lastWfHash) { lastWfHash = h; markDirty(); }
          trimVersions();
        }, TICK_MS);
      } else if (waited >= 4000) {
        clearInterval(check);
        readOnly = true;
        status('readonly', 'This project couldn’t be opened by this version of the planner, so changes here won’t be saved to your account.');
      }
    }, 250);
  }

  var tries = 0;
  var finder = setInterval(function () {
    tries++;
    var found = findPlanner();
    if (found) {
      clearInterval(finder);
      inst = found;
      start();
    } else if (tries > 480) { // two minutes: the page never mounted
      clearInterval(finder);
      status('error', 'Autosave couldn’t connect to the editor. Use “Save as New Prototype Version” and reload.');
    }
  }, 250);

  window.MozuProjectSync = {
    get state() { return { pid: pid, rev: rev, dirty: dirty, saving: saving, readOnly: readOnly, conflict: conflict, status: currentStatus }; },
    save: function () { return save(); },
    snapshot: function () { return inst ? snapshot() : null; },
  };
})();
