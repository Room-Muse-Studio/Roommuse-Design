// GET/PUT/PATCH/DELETE /api/projects/:id — see server/project-api.js.
// Vercel's file router maps one dynamic segment per file: [id].js here,
// [id]/duplicate.js and [id]/thumbnail.js for the two-segment routes. (A
// catch-all [...path].js only matched a single segment on Vercel.)
'use strict';
const { projects } = require('../_app');

module.exports = (req, res) => projects.handle(req, res);
