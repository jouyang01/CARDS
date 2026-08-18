import { defineConfig } from 'vite';

/**
 * GH_PAGES_BASE is set by the deploy workflow to "/<repo-name>/" so the built
 * site works on GitHub Pages project URLs. Locally it defaults to "/".
 *
 * M3-DEPLOY-PREP adds the dev proxy. In production the client and the Worker are
 * on **different origins** (Pages vs workers.dev) and the client is told where
 * the Worker is via `VITE_WORKER_ORIGIN`. In development they are the same
 * origin because this proxy makes them one: `/rooms` — including the WebSocket
 * upgrade — goes to a local `wrangler dev`.
 *
 * That is deliberate, and it is why `VITE_WORKER_ORIGIN` defaults to empty. A
 * dev setup that also had to configure an origin would be a second way to get
 * the same thing wrong, and the local path would stop resembling the deployed
 * one in the way that matters (same-origin requests, real upgrade handshake).
 *
 * `WRANGLER_DEV_URL` overrides the target for anyone running the Worker on
 * another port.
 */
const WORKER = process.env.WRANGLER_DEV_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  base: process.env.GH_PAGES_BASE ?? '/',
  build: { target: 'es2022' },
  server: {
    proxy: {
      // `ws: true` matters: the room socket is an upgrade on this same path, and
      // a proxy that only forwarded HTTP would leave the lobby connecting forever.
      '/rooms': { target: WORKER, ws: true, changeOrigin: true },
    },
  },
});
