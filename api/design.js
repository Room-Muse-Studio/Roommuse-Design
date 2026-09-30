// GET/PUT /api/design?code= — the design saved under a code. See server/handoff-api.js.
'use strict';
const api = require('./_handoff');

module.exports = (req, res) => api.design(req, res);
