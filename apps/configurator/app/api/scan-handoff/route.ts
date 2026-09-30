/**
 * GET /api/scan-handoff?code=XXXXXX — fetch a scan the phone uploaded, by its code.
 *
 * Proxies to the handoff API (server/handoff-api.js: `npm start` locally, or the
 * Vercel deploy). Going through the viewer's own server avoids CORS (the handoff
 * API sends no CORS headers) and lets the handoff URL be configured per
 * environment. Status and `{ error }` bodies are passed through unchanged, so
 * its messages reach the person as written.
 */
/** Where the handoff API lives. Set MOZU_HANDOFF_URL, e.g. in apps/configurator/.env.local. */
const HANDOFF_URL = (process.env.MOZU_HANDOFF_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = 10_000;

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code') ?? '';
  // The handoff API rate-limits per client address; pass the visitor's on, or
  // every viewer user would share this server's single allowance.
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  let upstream: Response;
  try {
    upstream = await fetch(`${HANDOFF_URL}/api/scan-handoff?code=${encodeURIComponent(code)}`, {
      cache: 'no-store',
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return Response.json(
      { error: `Could not reach the scan service at ${HANDOFF_URL}. Is it running (npm start)?` },
      { status: 502 },
    );
  }
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}
