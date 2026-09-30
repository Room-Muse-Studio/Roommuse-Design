// /api/auth/session and /api/auth/me — see server/auth-api.js.
'use strict';
const { auth } = require('../_app');

module.exports = (req, res) => auth.handle(req, res);
