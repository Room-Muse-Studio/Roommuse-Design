/*
 * Sessions on top of Firebase sign-in.
 *
 *   POST   /api/auth/session   { idToken }  → 201 { user } + mozu_session cookie
 *   GET    /api/auth/me                     → 200 { user, session } | 401
 *   DELETE /api/auth/session                → 200 { ok } and the cookie cleared
 *
 * The browser proves who it is once, with a fresh Firebase ID token. From then
 * on it carries an opaque session id in an HttpOnly cookie; the id maps to a
 * uid in the store and can be revoked server-side. Sessions last 30 days and
 * slide: any use with under 7 days left renews them.
 */
'use strict';

const { createAppStore } = require('./app-store');
const { createFirebaseVerifier, TokenError } = require('./firebase-token');
const { createRateLimiter, numberFrom, unavailable } = require('./rate-limit');
const { sendJson, isHttps, clientIp, readJson, parseCookies, cookieHeader, sameOrigin, isJsonRequest } = require('./http');

const COOKIE = 'mozu_session';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TOKEN_BYTES = 16 * 1024;

function publicUser(user) {
  return {
    uid: user.uid,
    email: user.email || '',
    emailVerified: !!user.emailVerified,
    name: user.name || '',
    picture: user.picture || '',
    providers: user.providers || [],
  };
}

/**
 * @param options.store        shared app store (default: createAppStore() on first use)
 * @param options.getStore     alternative: a function returning the store
 * @param options.verifier     { verify(idToken) } (default: Firebase, FIREBASE_PROJECT_ID)
 * @param options.limits       { sessions } per IP per 10 min
 * @param options.sessionTtlMs default 30 days (SESSION_TTL_DAYS)
 * @param options.maxAuthAgeS  how fresh the Firebase sign-in must be at session creation (default 300 s)
 */
function createAuthApi(options = {}) {
  let store = options.store || null;
  const getStore = options.getStore || (() => { if (!store) store = createAppStore(); return store; });
  let verifier = options.verifier || null;
  const getVerifier = () => {
    if (!verifier) verifier = createFirebaseVerifier({ projectId: process.env.FIREBASE_PROJECT_ID });
    return verifier;
  };
  const sessionTtlMs = options.sessionTtlMs || numberFrom(process.env.SESSION_TTL_DAYS, 30) * DAY_MS;
  const renewBelowMs = Math.min(7 * DAY_MS, sessionTtlMs / 4);
  const maxAuthAgeS = options.maxAuthAgeS || 300;
  const rate = createRateLimiter(getStore, { sessions: numberFrom(process.env.RATE_LIMIT_SESSIONS, 30), ...options.limits });

  const setCookie = (req, sid, maxAgeS) => ({ 'set-cookie': cookieHeader(COOKIE, sid, { maxAge: maxAgeS, secure: isHttps(req) }) });
  const clearCookie = (req) => setCookie(req, '', 0);

  /** Reject cross-site state changes before touching anything. */
  function guardWrite(req, res, needsJson) {
    if (!sameOrigin(req)) { sendJson(res, 403, { error: 'Cross-site request refused.' }); return false; }
    if (needsJson && !isJsonRequest(req)) { sendJson(res, 415, { error: 'Send JSON (content-type: application/json).' }); return false; }
    return true;
  }

  /**
   * The signed-in person for this request, or null after sending a 401.
   * Renews the session (and cookie) when it is close to expiring.
   */
  async function requireUser(req, res) {
    const sid = parseCookies(req)[COOKIE];
    if (!sid) { sendJson(res, 401, { error: 'Please sign in.' }); return null; }
    let session, user;
    try {
      session = await getStore().getSession(sid);
      if (session) user = await getStore().getUser(session.uid);
    } catch (e) {
      unavailable(res, e);
      return null;
    }
    if (!session || !user) { sendJson(res, 401, { error: 'Your session has expired. Please sign in again.' }, clearCookie(req)); return null; }
    let headers = {};
    if (session.expiresAt - Date.now() < renewBelowMs) {
      try {
        const expiresAt = await getStore().touchSession(sid, sessionTtlMs);
        if (expiresAt) { session.expiresAt = expiresAt; headers = setCookie(req, sid, sessionTtlMs / 1000); }
      } catch { /* renewal is best effort */ }
    }
    return { uid: session.uid, sid, session, user, headers };
  }

  async function createSession(req, res) {
    if (!guardWrite(req, res, true)) return;
    if (!(await rate.allowed('sessions', clientIp(req)))) return rate.tooMany(res, 'sign-in attempts from this network');
    let body;
    try { body = await readJson(req, MAX_TOKEN_BYTES); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }
    if (!body || typeof body.idToken !== 'string') return sendJson(res, 400, { error: 'Missing idToken.' });

    let identity;
    try {
      identity = await getVerifier().verify(body.idToken);
    } catch (e) {
      if (e instanceof TokenError) return sendJson(res, e.reason === 'unconfigured' ? 503 : 401, { error: e.message });
      console.error('[mozu] token verification failed:', e.message);
      return sendJson(res, 503, { error: 'Could not verify the sign-in right now. Try again in a minute.' });
    }
    if (Date.now() / 1000 - identity.authTime > maxAuthAgeS) {
      return sendJson(res, 401, { error: 'That sign-in is too old. Please sign in again.' });
    }

    try {
      const user = await getStore().upsertUser(identity.uid, identity);
      const session = await getStore().createSession(identity.uid, { ua: req.headers['user-agent'] }, sessionTtlMs);
      console.log(`[mozu] session for ${identity.uid.slice(0, 6)}… via ${identity.provider || 'unknown'}`);
      return sendJson(res, 201, { user: publicUser(user), session: { expiresAt: new Date(session.expiresAt).toISOString() } },
        setCookie(req, session.sid, sessionTtlMs / 1000));
    } catch (e) {
      return unavailable(res, e);
    }
  }

  async function me(req, res) {
    const who = await requireUser(req, res);
    if (!who) return;
    return sendJson(res, 200, { user: publicUser(who.user), session: { expiresAt: new Date(who.session.expiresAt).toISOString() } }, who.headers);
  }

  async function signOut(req, res) {
    if (!guardWrite(req, res, false)) return;
    const sid = parseCookies(req)[COOKIE];
    if (sid) {
      try { await getStore().deleteSession(sid); } catch (e) { return unavailable(res, e); }
    }
    return sendJson(res, 200, { ok: true }, clearCookie(req));
  }

  /** Route /api/auth/* (works for the local server and the Vercel catch-all). */
  async function handle(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '');
    const action = pathname.split('/').pop();
    try {
      if (action === 'session') {
        if (req.method === 'POST') return await createSession(req, res);
        if (req.method === 'DELETE') return await signOut(req, res);
        return sendJson(res, 405, { error: 'Use POST to sign in or DELETE to sign out.' }, { allow: 'POST, DELETE' });
      }
      if (action === 'me') {
        if (req.method === 'GET' || req.method === 'HEAD') return await me(req, res);
        return sendJson(res, 405, { error: 'Method not allowed.' }, { allow: 'GET' });
      }
      return sendJson(res, 404, { error: 'Not found.' });
    } catch (e) {
      console.error('[mozu] auth:', e);
      if (!res.headersSent) return sendJson(res, 500, { error: 'Server error.' });
      res.end();
    }
  }

  return { handle, requireUser, guardWrite, getStore, publicUser, COOKIE };
}

module.exports = { createAuthApi, publicUser, COOKIE };
