// GET /api/health — 200 when the code store is reachable, 503 otherwise.
'use strict';
const api = require('./_handoff');

module.exports = (req, res) => api.health(req, res);
