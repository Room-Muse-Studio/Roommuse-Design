// GET/POST /api/projects (list, create). Vercel's [...path].js next to this file
// only matches paths with a segment after /api/projects, so the bare path needs
// its own function. Both delegate to the same router in server/project-api.js.
'use strict';
const { projects } = require('../_app');

module.exports = (req, res) => projects.handle(req, res);
