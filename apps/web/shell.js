/*
 * MOZU Design shell — sign-in, the projects gallery, and the header around
 * the editor. The editor is editor.html (the packed prototype) in an iframe;
 * it restores whatever is in its localStorage "saved project" slot on load, so
 * opening a project = write the project into that slot, then load the frame
 * with ?project=<id>. project-sync.js inside the frame autosaves changes and
 * reports its status here with postMessage.
 *
 * Guest mode ("Try without an account") loads the editor with no ?project, which
 * is exactly the old device-local behaviour; /?code=… and the iPad's /scan links
 * keep working for guests.
 */
(function () {
  'use strict';

  var SLOT = 'mozu.prototype.kitchenWorkflow.project.v2';
  var SLOT_PREFIX = 'mozu.prototype.kitchenWorkflow.';
  var SHELL_SLOT = 'mozu.shell.slot';
  var LINK_PARAMS = ['code', 'scan', 'poly', 'h', 'src'];
  var FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

  var $ = function (id) { return document.getElementById(id); };
  var config = window.MOZU_FIREBASE || {};
  var configured = !!(config.apiKey && config.projectId && config.authDomain);
  var state = { user: null, projects: [], current: null, guest: false, mode: 'signin', pendingOpen: null, editorStatus: null };
  var firebaseAuth = null;

  // ── API ──────────────────────────────────────────────────────────────

  function api(method, path, body) {
    var init = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) {
          var err = new Error(json.error || ('Request failed (HTTP ' + res.status + ').'));
          err.status = res.status; err.body = json;
          throw err;
        }
        return json;
      });
    }, function () {
      var err = new Error('Could not reach MOZU. Check your connection and try again.');
      err.status = 0;
      throw err;
    });
  }

  // ── Views ────────────────────────────────────────────────────────────

  var VIEWS = ['loading', 'login', 'gallery', 'editor'];
  function show(view) {
    $('shell').dataset.view = view;
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== view; });
    $('shell-header').hidden = view !== 'editor';
    closeMenus();
  }

  function setError(id, message) {
    var el = $(id);
    el.textContent = message || '';
    el.hidden = !message;
  }

  function closeMenus() {
    document.querySelectorAll('.menu').forEach(function (m) { m.hidden = true; });
    document.querySelectorAll('[aria-expanded="true"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  }
  document.addEventListener('pointerdown', function (e) {
    if (!e.target.closest('.menu') && !e.target.closest('[aria-haspopup="menu"]')) closeMenus();
  }, true);

  function toggleMenu(button, menu) {
    var open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  // ── Dialog ───────────────────────────────────────────────────────────

  /** Promise<string|null>: the typed value (or '' for confirms), null when cancelled. */
  function dialog(opts) {
    var dlg = $('dialog');
    $('dialog-title').textContent = opts.title;
    $('dialog-text').textContent = opts.text || '';
    $('dialog-text').hidden = !opts.text;
    $('dialog-field-wrap').hidden = !opts.field;
    $('dialog-label').textContent = opts.field || '';
    $('dialog-input').value = opts.value || '';
    $('dialog-input').placeholder = opts.placeholder || '';
    $('dialog-ok').textContent = opts.ok || 'OK';
    $('dialog-ok').classList.toggle('danger-btn', !!opts.danger);
    $('dialog-ok').style.background = opts.danger ? '#B3261E' : '';
    setError('dialog-error', '');
    return new Promise(function (resolve) {
      var done = function (value) {
        dlg.removeEventListener('close', onClose);
        $('dialog-form').removeEventListener('submit', onSubmit);
        if (dlg.open) dlg.close();
        resolve(value);
      };
      var onSubmit = function (e) {
        e.preventDefault();
        var value = $('dialog-input').value.trim();
        if (opts.field && !value) { setError('dialog-error', 'Please enter a ' + opts.field.toLowerCase() + '.'); return; }
        done(value);
      };
      var onClose = function () { done(null); };
      $('dialog-form').addEventListener('submit', onSubmit);
      dlg.addEventListener('close', onClose);
      dlg.querySelector('[data-action="dialog-cancel"]').onclick = function () { done(null); };
      dlg.showModal();
      if (opts.field) { $('dialog-input').focus(); $('dialog-input').select(); }
    });
  }

  // ── Firebase sign-in ─────────────────────────────────────────────────

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load the sign-in library. Check your connection.')); };
      document.head.appendChild(s);
    });
  }

  function ensureFirebase() {
    if (firebaseAuth) return Promise.resolve(firebaseAuth);
    if (!configured) return Promise.reject(new Error('Sign-in is not set up on this site yet.'));
    return loadScript(FIREBASE_SDK + 'firebase-app-compat.js')
      .then(function () { return loadScript(FIREBASE_SDK + 'firebase-auth-compat.js'); })
      .then(function () {
        if (!window.firebase.apps.length) window.firebase.initializeApp({ apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId });
        firebaseAuth = window.firebase.auth();
        return firebaseAuth;
      });
  }

  var FIREBASE_MESSAGES = {
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'Wrong email or password.',
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-password': 'Please enter your password.',
    'auth/weak-password': 'Choose a password with at least 8 characters.',
    'auth/email-already-in-use': 'There is already an account with that email. Sign in instead, or reset the password.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
    'auth/popup-closed-by-user': 'The Google sign-in window was closed before finishing.',
    'auth/cancelled-popup-request': 'The Google sign-in window was closed before finishing.',
    'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
    'auth/unauthorized-domain': 'This site isn’t authorised for sign-in yet (add it under Firebase → Authentication → Settings → Authorized domains).',
    'auth/operation-not-allowed': 'This sign-in method isn’t enabled in Firebase yet.',
  };
  function friendly(e) {
    if (e && e.code && FIREBASE_MESSAGES[e.code]) return FIREBASE_MESSAGES[e.code];
    return (e && e.message) || 'Something went wrong. Please try again.';
  }

  /** Exchange a fresh Firebase sign-in for our session cookie. */
  function establishSession(fbUser) {
    return fbUser.getIdToken(true)
      .then(function (idToken) { return api('POST', '/api/auth/session', { idToken: idToken }); })
      .then(function (json) { state.user = json.user; state.guest = false; return json.user; });
  }

  function setBusy(busy) {
    $('login-submit').disabled = busy;
    $('btn-google').disabled = busy;
  }

  function submitLogin(e) {
    e.preventDefault();
    var form = $('login-form');
    var email = form.email.value.trim(), password = form.password.value;
    setError('login-error', '');
    if (!email || !password) { setError('login-error', 'Enter your email and password.'); return; }
    if (state.mode === 'signup' && password.length < 8) { setError('login-error', 'Choose a password with at least 8 characters.'); return; }
    setBusy(true);
    ensureFirebase().then(function (auth) {
      var p = state.mode === 'signup'
        ? auth.createUserWithEmailAndPassword(email, password).then(function (cred) {
          cred.user.sendEmailVerification().catch(function () { /* the banner offers a resend */ });
          return cred;
        })
        : auth.signInWithEmailAndPassword(email, password);
      return p.then(function (cred) { return establishSession(cred.user); });
    }).then(afterSignIn).catch(function (err) { setError('login-error', friendly(err)); }).then(function () { setBusy(false); });
  }

  function googleSignIn() {
    setError('login-error', '');
    setBusy(true);
    ensureFirebase().then(function (auth) {
      var provider = new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      return auth.signInWithPopup(provider).then(function (cred) { return establishSession(cred.user); });
    }).then(afterSignIn).catch(function (err) { setError('login-error', friendly(err)); }).then(function () { setBusy(false); });
  }

  function forgotPassword() {
    var email = $('login-form').email.value.trim();
    setError('login-error', '');
    if (!email) { setError('login-error', 'Type your email above first, then click “Forgot password?”.'); $('login-form').email.focus(); return; }
    ensureFirebase().then(function (auth) { return auth.sendPasswordResetEmail(email); })
      .then(function () { setError('login-error', ''); flashLogin('Password reset email sent to ' + email + '. Check your inbox (and spam).'); })
      .catch(function (err) { setError('login-error', friendly(err)); });
  }

  function flashLogin(text) {
    var el = $('login-error');
    el.textContent = text;
    el.hidden = false;
    el.style.background = '#EAF5F0'; el.style.borderColor = '#BFE0D2'; el.style.color = '#1E5B47';
    setTimeout(function () { el.style.background = ''; el.style.borderColor = ''; el.style.color = ''; }, 6000);
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.tab').forEach(function (t) {
      var active = t.dataset.mode === mode;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });
    $('login-submit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    $('login-form').password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    $('btn-forgot').hidden = mode === 'signup';
    setError('login-error', '');
  }

  function afterSignIn() {
    if (state.pendingOpen) { var pid = state.pendingOpen; state.pendingOpen = null; return openProject(pid); }
    if (state.pendingScan) { var q = state.pendingScan; state.pendingScan = null; return importScanIntoNewProject(q); }
    return showGallery();
  }

  function signOut() {
    closeMenus();
    return flushEditor().then(function () {
      return api('DELETE', '/api/auth/session').catch(function () { /* cookie may already be gone */ });
    }).then(function () {
      if (firebaseAuth) firebaseAuth.signOut().catch(function () {});
      state.user = null; state.projects = []; state.current = null;
      $('editor').src = 'about:blank';
      history.replaceState(null, '', '/');
      showLogin();
    });
  }

  function showLogin() {
    $('login-unconfigured').hidden = configured;
    $('login-forms').hidden = !configured;
    setMode('signin');
    show('login');
    if (configured) $('login-form').email.focus();
  }

  // ── Gallery ──────────────────────────────────────────────────────────

  function timeAgo(ms) {
    var s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' d ago';
    return new Date(ms).toLocaleDateString();
  }

  function localProject() {
    try {
      var data = JSON.parse(window.localStorage.getItem(SLOT) || 'null');
      return data && data.version === 2 && Array.isArray(data.spaces) && data.spaces.length ? data : null;
    } catch (e) { return null; }
  }

  function showGallery() {
    state.current = null;
    history.replaceState(null, '', '/');
    show('gallery');
    $('gallery-grid').innerHTML = '';
    $('gallery-empty').hidden = true;
    $('gallery-sub').textContent = 'Loading…';
    setError('gallery-error', '');
    var u = state.user || {};
    var needsVerify = u.email && !u.emailVerified && (u.providers || []).indexOf('password') >= 0;
    $('verify-banner').hidden = !needsVerify;
    $('verify-email').textContent = u.email || '';
    var local = localProject();
    var localIsShellCopy = false;
    try { localIsShellCopy = !!window.localStorage.getItem(SHELL_SLOT); } catch (e) { /* ignore */ }
    $('btn-import-local').hidden = !(local && !localIsShellCopy);
    return api('GET', '/api/projects').then(function (json) {
      state.projects = json.projects || [];
      renderGallery();
    }).catch(function (err) {
      if (err.status === 401) return showLogin();
      $('gallery-sub').textContent = '';
      setError('gallery-error', err.message);
    });
  }

  function renderGallery() {
    var grid = $('gallery-grid');
    grid.innerHTML = '';
    var list = state.projects;
    $('gallery-sub').textContent = list.length ? list.length + (list.length === 1 ? ' project' : ' projects') : '';
    $('gallery-empty').hidden = list.length > 0;
    var tpl = $('tpl-card');
    list.forEach(function (p) {
      var node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = p.id;
      node.querySelector('.card-title').textContent = p.name;
      node.querySelector('.card-title').title = p.name;
      var meta = ['Edited ' + timeAgo(p.updatedAt)];
      if (p.clientName) meta.unshift(p.clientName);
      if (p.spaces > 1) meta.push(p.spaces + ' rooms');
      node.querySelector('.card-meta').textContent = meta.join(' · ');
      node.setAttribute('aria-label', 'Open ' + p.name);
      node.addEventListener('click', function (e) {
        if (e.target.closest('.card-menu-btn') || e.target.closest('.card-menu')) return;
        openProject(p.id);
      });
      node.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target === node) openProject(p.id); });
      var btn = node.querySelector('.card-menu-btn'), menu = node.querySelector('.card-menu');
      btn.addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(btn, menu); });
      menu.addEventListener('click', function (e) {
        var action = e.target.dataset.action;
        if (!action) return;
        e.stopPropagation();
        closeMenus();
        if (action === 'open') openProject(p.id);
        if (action === 'rename') renameProject(p);
        if (action === 'duplicate') duplicateProject(p);
        if (action === 'delete') deleteProject(p);
      });
      grid.appendChild(node);
    });
  }

  function galleryError(err) {
    if (err.status === 401) return showLogin();
    setError('gallery-error', err.message);
  }

  function newProject() {
    return dialog({ title: 'New project', field: 'Name', placeholder: 'e.g. Sennett Residence — Unit 12-04', ok: 'Create' }).then(function (name) {
      if (name === null) return;
      return api('POST', '/api/projects', { name: name }).then(function (json) { return openProject(json.project.id, { fresh: true }); }).catch(galleryError);
    });
  }

  function renameProject(p) {
    return dialog({ title: 'Rename project', field: 'Name', value: p.name, ok: 'Rename' }).then(function (name) {
      if (name === null || name === p.name) return;
      return api('PATCH', '/api/projects/' + p.id, { name: name }).then(showGallery).catch(galleryError);
    });
  }

  function duplicateProject(p) {
    return api('POST', '/api/projects/' + p.id + '/duplicate', {}).then(showGallery).catch(galleryError);
  }

  function deleteProject(p) {
    return dialog({ title: 'Delete “' + p.name + '”?', text: 'This removes the project from your account. There is no undo.', ok: 'Delete', danger: true }).then(function (v) {
      if (v === null) return;
      return api('DELETE', '/api/projects/' + p.id).then(showGallery).catch(galleryError);
    });
  }

  function importLocalProject() {
    var data = localProject();
    if (!data) { $('btn-import-local').hidden = true; return; }
    var name = (data.projectName || 'Imported kitchen').trim();
    return dialog({ title: 'Import the design saved on this device', text: 'It becomes a project in your account; the copy on this device is kept.', field: 'Name', value: name, ok: 'Import' }).then(function (chosen) {
      if (chosen === null) return;
      return api('POST', '/api/projects', { name: chosen, data: data, source: 'local-import' })
        .then(function (json) { return openProject(json.project.id); })
        .catch(galleryError);
    });
  }

  // ── Editor ───────────────────────────────────────────────────────────

  /** Small fast string hash (FNV-1a); project-sync.js computes the same to spot slot changes. */
  function hashOf(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  }

  function writeSlot(pid, rev, name, data) {
    try {
      var json = JSON.stringify(data);
      window.localStorage.setItem(SLOT, json);
      // Per-device scratch from another project must not leak into this one.
      window.localStorage.removeItem(SLOT_PREFIX + 'versions');
      window.localStorage.removeItem(SLOT_PREFIX + 'backups');
      window.localStorage.removeItem(SLOT + '.before-scan');
      // `hash` is what the account holds; if the slot differs on load (a scan was
      // imported into it, say) project-sync saves straight away.
      window.localStorage.setItem(SHELL_SLOT, JSON.stringify({ pid: pid, rev: rev, name: name, hash: hashOf(json), openedAt: Date.now() }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function setStatus(stateName, text) {
    var el = $('header-status');
    el.dataset.state = stateName || '';
    el.textContent = text || '';
  }

  /** Load a project from the account into the editor frame. */
  function openProject(pid, opts) {
    opts = opts || {};
    show('loading');
    return api('GET', '/api/projects/' + pid).then(function (json) {
      if (!writeSlot(pid, json.project.rev, json.project.name, json.data)) {
        throw new Error('The browser would not let the page prepare the project (storage is blocked or full).');
      }
      state.current = { pid: pid, rev: json.project.rev, name: json.project.name };
      state.editorStatus = null;
      $('header-name').textContent = json.project.name;
      setStatus('', 'Opening…');
      $('btn-gallery').textContent = '‹ My projects';
      $('editor-notice').hidden = true;
      var extra = opts.query ? '&' + opts.query : '';
      $('editor').src = 'editor.html?project=' + encodeURIComponent(pid) + extra;
      history.replaceState(null, '', '/?open=' + encodeURIComponent(pid));
      show('editor');
    }).catch(function (err) {
      if (err.status === 401) { state.pendingOpen = pid; return showLogin(); }
      showGallery().then(function () { setError('gallery-error', err.message); });
    });
  }

  /** A scan link (?code= / ?poly=) while signed in: a fresh project receives the room. */
  function importScanIntoNewProject(query) {
    var params = new URLSearchParams(query);
    var label = params.get('code') ? 'Scan ' + params.get('code').toUpperCase() : 'Scanned room';
    return api('POST', '/api/projects', { name: label, source: params.get('code') ? 'scan:' + params.get('code').toUpperCase() : 'scan' })
      .then(function (json) {
        var keep = new URLSearchParams();
        LINK_PARAMS.forEach(function (k) { if (params.has(k)) keep.set(k, params.get(k)); });
        return openProject(json.project.id, { query: keep.toString() });
      })
      .catch(function (err) { showGallery().then(function () { setError('gallery-error', err.message); }); });
  }

  /** Guest: the editor as it always was, on this device only. */
  function openGuestEditor(query) {
    state.guest = true;
    state.current = null;
    try { window.localStorage.removeItem(SHELL_SLOT); } catch (e) { /* ignore */ }
    $('header-name').textContent = 'Guest · saved on this device only';
    setStatus('', '');
    $('btn-gallery').textContent = configured ? 'Sign in to save your work' : '';
    $('btn-gallery').hidden = !configured;
    $('btn-account').textContent = '';
    $('editor-notice').hidden = true;
    $('editor').src = 'editor.html' + (query || '');
    show('editor');
  }

  /** Ask project-sync.js to save now; resolves when it has (or after a timeout). */
  function flushEditor() {
    var frame = $('editor');
    if (!state.current || !frame.contentWindow || $('view-editor').hidden) return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () { if (!done) { done = true; window.removeEventListener('message', onMessage); resolve(); } };
      var onMessage = function (e) {
        if (e.source === frame.contentWindow && e.data && e.data.type === 'mozu:flushed') finish();
      };
      window.addEventListener('message', onMessage);
      try { frame.contentWindow.postMessage({ type: 'mozu:flush' }, window.location.origin); } catch (e) { finish(); }
      setTimeout(finish, 5000);
    });
  }

  function backToGallery() {
    if (state.guest) { state.pendingOpen = null; return showLogin(); }
    setStatus('saving', 'Saving…');
    return flushEditor().then(function () {
      $('editor').src = 'about:blank';
      return showGallery();
    });
  }

  // Status and name updates from project-sync.js inside the frame.
  window.addEventListener('message', function (e) {
    if (e.origin !== window.location.origin || !e.data || typeof e.data.type !== 'string') return;
    var frame = $('editor');
    if (e.source !== frame.contentWindow) return;
    var msg = e.data;
    if (msg.type === 'mozu:status') {
      state.editorStatus = msg;
      setStatus(msg.state, msg.text || '');
      if (msg.name && state.current && msg.name !== state.current.name) {
        state.current.name = msg.name;
        $('header-name').textContent = msg.name;
      }
      if (msg.rev && state.current) state.current.rev = msg.rev;
      if (msg.state === 'readonly') {
        $('editor-notice').textContent = msg.text || 'This project is read-only.';
        $('editor-notice').hidden = false;
      }
    }
    if (msg.type === 'mozu:signed-out') {
      state.user = null;
      showLogin();
    }
  });

  window.addEventListener('beforeunload', function (e) {
    if (state.editorStatus && (state.editorStatus.state === 'saving' || state.editorStatus.dirty)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ── Account menu ─────────────────────────────────────────────────────

  function renderAccount() {
    var u = state.user;
    $('btn-account').textContent = u ? (u.name || u.email || 'Account') : '';
    $('btn-account').hidden = !u;
    $('account-email').textContent = u ? u.email : '';
    $('btn-verify').hidden = !(u && u.email && !u.emailVerified && (u.providers || []).indexOf('password') >= 0);
  }

  function resendVerification() {
    closeMenus();
    ensureFirebase().then(function (auth) {
      var fbUser = auth.currentUser;
      if (!fbUser) throw new Error('Please sign out and sign in again, then resend the verification email.');
      return fbUser.sendEmailVerification();
    }).then(function () { window.alert('Verification email sent to ' + (state.user && state.user.email) + '.'); })
      .catch(function (err) { window.alert(friendly(err)); });
  }

  // ── Wiring ───────────────────────────────────────────────────────────

  $('login-form').addEventListener('submit', submitLogin);
  $('btn-google').addEventListener('click', googleSignIn);
  $('btn-forgot').addEventListener('click', forgotPassword);
  document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { setMode(t.dataset.mode); }); });
  document.querySelectorAll('[data-action="guest"]').forEach(function (b) { b.addEventListener('click', function () { openGuestEditor(''); }); });
  document.querySelectorAll('[data-action="new"]').forEach(function (b) { b.addEventListener('click', newProject); });
  document.querySelectorAll('[data-action="resend-verify"]').forEach(function (b) { b.addEventListener('click', resendVerification); });
  $('btn-new').addEventListener('click', newProject);
  $('btn-import-local').addEventListener('click', importLocalProject);
  $('btn-gallery').addEventListener('click', backToGallery);
  $('btn-account').addEventListener('click', function () { toggleMenu($('btn-account'), $('account-menu')); });
  $('btn-signout').addEventListener('click', signOut);
  $('btn-verify').addEventListener('click', resendVerification);

  // ── Boot ─────────────────────────────────────────────────────────────

  function boot() {
    var params = new URLSearchParams(window.location.search);
    var isScanLink = LINK_PARAMS.some(function (k) { return params.has(k); });
    var wantsGuest = params.has('guest');
    var open = params.get('open');

    return api('GET', '/api/auth/me').then(function (json) { state.user = json.user; }, function (err) {
      state.user = null;
      if (err.status && err.status !== 401) setError('gallery-error', err.message);
    }).then(function () {
      renderAccount();
      if (!state.user && params.has('signin')) return showLogin();
      if (wantsGuest || (!state.user && (isScanLink || !configured))) return openGuestEditor(isScanLink ? window.location.search : '');
      if (!state.user) {
        if (open) state.pendingOpen = open;
        return showLogin();
      }
      if (isScanLink) return importScanIntoNewProject(window.location.search);
      if (open) return openProject(open);
      return showGallery();
    });
  }

  // The gallery re-reads the account after sign-in changes elsewhere.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && $('shell').dataset.view === 'gallery') {
      api('GET', '/api/auth/me').then(function (json) { state.user = json.user; renderAccount(); }, function (err) { if (err.status === 401) showLogin(); });
    }
  });

  window.MozuShell = { state: state, openProject: openProject, showGallery: showGallery, api: api };
  boot();
})();
