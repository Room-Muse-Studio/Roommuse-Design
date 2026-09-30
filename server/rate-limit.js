/*
 * Fixed-window rate limiting on top of a store's `hit(bucket, windowMs)`.
 * Shared by the handoff, auth and project APIs. Fails open: if the counter
 * store is unreachable, requests go through — an outage should never lock
 * people out of their own work.
 */
'use strict';

const { sendJson } = require('./http');

const RATE_WINDOW_MS = 10 * 60 * 1000;

/** Read a non-negative number from an env var, else the fallback. */
function numberFrom(value, fallback) {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * @param getStore  () => store with hit()
 * @param limits    { [kind]: maxPerWindow } — 0 or missing turns a kind off
 */
function createRateLimiter(getStore, limits) {
  async function allowed(kind, who) {
    const limit = limits[kind];
    if (!limit) return true;
    try {
      return (await getStore().hit(`${kind}:${who}`, RATE_WINDOW_MS)) <= limit;
    } catch (e) {
      console.error('[mozu] rate limit check failed:', e.message);
      return true;
    }
  }

  function tooMany(res, what = 'requests from this network') {
    return sendJson(res, 429, { error: `Too many ${what}. Wait a few minutes and try again.` },
      { 'retry-after': String(RATE_WINDOW_MS / 1000) });
  }

  return { allowed, tooMany, limits };
}

function unavailable(res, e) {
  console.error('[mozu] store error:', e && e.message);
  return sendJson(res, 503, { error: 'MOZU could not reach its storage just now. Try again in a minute.' });
}

module.exports = { RATE_WINDOW_MS, createRateLimiter, numberFrom, unavailable };
