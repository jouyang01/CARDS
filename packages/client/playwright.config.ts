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
    baseURL: 'http://127.0.0.1:4173/',
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
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  },
});
