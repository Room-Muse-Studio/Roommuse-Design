// One API instance per warm function, so the Redis client and rate counters are reused.
'use strict';
const { createHandoffApi } = require('../server/handoff-api');

module.exports = createHandoffApi();
