// /scan and /scan/:code (rewritten here by vercel.json) → the page, same as server/server.js.
'use strict';
const { scanLinkLocation } = require('../server/handoff-api');

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.writeHead(302, { location: scanLinkLocation(url.pathname, url.search) || '/', 'cache-control': 'no-store' });
  res.end();
};
