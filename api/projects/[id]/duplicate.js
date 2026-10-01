// POST /api/projects/:id/duplicate — see server/project-api.js.
'use strict';
const { projects } = require('../../_app');

module.exports = (req, res) => projects.handle(req, res);
