import type { NextConfig } from 'next';

/**
 * Two ways to run:
 *
 *  - Deployed (and `npm start`): a static export (`MOZU_STATIC_EXPORT=1 next build`
 *    → out/), served as the site root next to the handoff API, which is Vercel
 *    functions (api/*.js) in production and server/server.js locally. The page
 *    calls /api/scan-handoff on its own site, and /scan/:code links are
 *    redirected by that server to /?code=….
 *
 *  - `next dev`: a live-reloading copy on its own port. A static export allows
 *    no rewrites, so only here /api/* and /scan/* go to the handoff server
 *    (MOZU_HANDOFF_URL, default http://localhost:3000 — `npm start`).
 */
const exporting = process.env.MOZU_STATIC_EXPORT === '1';
const HANDOFF_URL = (process.env.MOZU_HANDOFF_URL || 'http://localhost:3000').replace(/\/+$/, '');

const config: NextConfig = {
  // The scan SDK is a workspace package shipped as TypeScript source.
  transpilePackages: ['@mozu/scan-sdk'],
  ...(exporting
    ? { output: 'export' }
    : {
        async rewrites() {
          return [
            { source: '/api/:path*', destination: `${HANDOFF_URL}/api/:path*` },
            { source: '/scan', destination: `${HANDOFF_URL}/scan` },
            { source: '/scan/:code', destination: `${HANDOFF_URL}/scan/:code` },
          ];
        },
      }),
};

export default config;
