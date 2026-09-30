// /api/projects/:id, /:id/duplicate and /:id/thumbnail — see server/project-api.js. The bare /api/projects is index.js.
'use strict';
const { projects } = require('../_app');

module.exports = (req, res) => projects.handle(req, res);
