import { defineConfig } from 'vitest/config';

// Client tests cover the PURE view/order logic (no DOM): order-building,
// event→render-intent mapping, per-player order merging. Node environment.
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
