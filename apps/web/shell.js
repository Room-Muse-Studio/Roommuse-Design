/*
 * MOZU Design shell — Phase 0: hosts the editor (editor.html) in an iframe and
 * passes the page's query string through, so /?code=… and the iPad's
 * /scan?poly=… links keep working exactly as before. Sign-in and the projects
 * gallery arrive in later phases.
 */
(function () {
  'use strict';

  var shell = document.getElementById('shell');
  var views = ['loading', 'login', 'gallery', 'editor'];

  function show(view) {
    shell.dataset.view = view;
    views.forEach(function (v) { document.getElementById('view-' + v).hidden = v !== view; });
    document.getElementById('shell-header').hidden = view !== 'editor';
  }

  function openEditor(query) {
    var frame = document.getElementById('editor');
    frame.src = 'editor.html' + (query || '');
    show('editor');
  }

  // Guest mode: the editor as it always was, on this device only.
  document.getElementById('shell-header').hidden = true;
  openEditor(window.location.search);
})();
