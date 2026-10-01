// GET/POST /api/projects (list, create). The per-project routes live in
// [id].js, [id]/duplicate.js and [id]/thumbnail.js — one dynamic segment per
// file, the way Vercel's router matches. All delegate to server/project-api.js.
'use strict';
const { projects } = require('../_app');

module.exports = (req, res) => projects.handle(req, res);
