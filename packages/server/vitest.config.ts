import { defineConfig } from 'vitest/config';

/**
 * Plain Vitest, not `@cloudflare/vitest-pool-workers`.
 *
 * Everything worth testing in this package is the room's rules and its message
 * handling, and both are written against plain data and an abstract `Sink` —
 * see `hub.ts` for why. Booting a Workers runtime would test Cloudflare's
 * WebSocket implementation, which is not ours to test, and would need an
 * account the sandbox does not have. The DO itself is plumbing: if it ever
 * grows logic, that is the signal to move the logic out, not to add a runtime.
 */
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
