/*
 * MOZU project sync — runs inside editor.html. Autosaves the open project to
 * the person's account when the page was opened as /editor.html?project=<id>.
 * Without ?project (guest mode) it does nothing. Filled in by a later phase.
 */
(function () {
  'use strict';
  if (!new URLSearchParams(window.location.search).get('project')) return;
})();
