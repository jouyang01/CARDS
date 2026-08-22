import { defineConfig, devices } from '@playwright/test';

/**
 * RENDER-VERIFY — the only check that can see what the renderer actually drew.
 *
 * `gl.readPixels` and `canvas.toDataURL()` both return an all-black false
 * negative off this canvas (the drawing buffer is not preserved), so nothing
 * inside the page can inspect the render. Only a **composited screenshot**,
 * taken by the browser itself, shows the truth — which is why this exists as a
 * separate Playwright suite rather than another Vitest file.
 *
 * It runs against the production build via `vite preview`, so it exercises the
 * bundle that actually ships, not the dev server.
 */
export default defineConfig({
  testDir: './e2e',
  // Deliberately serial and single-worker: these tests drive one shared hot-seat
  // match through a scripted turn, and WebGL under SwiftShader is slow enough
  // that parallel contexts add flake for no wall-clock gain.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI !== undefined ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI !== undefined ? [['github'], ['list']] : [['list']],

  use: {
    // AMBIENT-FREEZE: every test navigates relative to this, so the whole suite
    // runs with decorative motion off. `render.spec.ts` compares frames
    // byte-for-byte to prove a committed aim stops following the pointer, and a
    // single moving prop would break that permanently — with a failure message
    // accusing the aim rather than the scenery. See `src/ambient.ts`.
    baseURL: 'http://127.0.0.1:4173/?ambient=off',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 950 },
        launchOptions: {
          // Headless Linux has no GPU, so WebGL needs a software rasteriser.
          // Without these the canvas silently renders nothing and every pixel
          // assertion below fails for the wrong reason.
          args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
        },
      },
    },
  ],

  webServer: {
    // `--host 127.0.0.1` is load-bearing, not tidiness. Vite's default host is
    // the *name* `localhost`, and since Node 17 DNS results are returned
    // verbatim rather than IPv4-first — so on a GitHub runner `localhost`
    // resolves to `::1` and the server binds there, while Playwright polls the
    // literal `127.0.0.1` below and waits until it times out. Binding and
    // polling the same literal address removes the ambiguity entirely.
    //
    // `npm run preview` rather than `npx vite preview` so resolution goes
    // through the workspace's own dependency rather than npx's lookup.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
    // Surface the server's own output: the first CI failure here showed the
    // build log and then silence, which said nothing about why the poll failed.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
