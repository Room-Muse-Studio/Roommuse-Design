// POST /api/scan-handoff and GET /api/scan-handoff?code= — see server/handoff-api.js.
'use strict';
const api = require('./_handoff');

module.exports = (req, res) => api.handoff(req, res);
