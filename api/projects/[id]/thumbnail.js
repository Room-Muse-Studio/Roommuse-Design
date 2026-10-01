// PUT /api/projects/:id/thumbnail — see server/project-api.js.
'use strict';
const { projects } = require('../../_app');

module.exports = (req, res) => projects.handle(req, res);
