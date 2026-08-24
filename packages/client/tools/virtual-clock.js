/**
 * Replace the page's clock, so a test or a capture owns time instead of racing it.
 *
 * Installed by `page.addInitScript({ path })` **before any app script runs**, by
 * both `tools/film.mjs` and `e2e/vfx.spec.ts`. Shared by path rather than copied
 * into each: two clocks that drift apart would make a film and a test disagree
 * about the same frame, and the one that was wrong would be whichever nobody had
 * looked at recently.
 *
 * WHY IT HAS TO EXIST. This scene renders at ~3.3fps under SwiftShader and a
 * screenshot of an animating board waits ~2.2s for the compositor. Anything
 * shorter than that — the 0.18s victim flash, a tracer, a single stride — cannot
 * be photographed by sampling: the shutter is twelve times slower than the thing
 * it is pointed at. Freezing the clock inverts that. Between `step()` calls the
 * page is genuinely static, so the board is not dirty, the render loop idles, and
 * the same screenshot costs ~0.17s and shows exactly the moment asked for.
 *
 * Both of the app's time sources go through these two functions — the renderer's
 * mixer deltas (`renderer3d.ts`) and the playback timeline (`app.ts`) — so
 * stepping 33ms advances the animation by exactly 33ms, whatever the wall clock
 * is doing. No product code is involved and nothing ships: the page under test
 * is the built bundle, unmodified.
 */
(() => {
  let t = 0;
  let nextId = 1;
  const queue = new Map();
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => { queue.delete(id); };
  Object.defineProperty(window.performance, 'now', { configurable: true, value: () => t });
  window.__film = {
    now: () => t,
    pending: () => queue.size,
    /**
     * Advance the clock and run one round of frame callbacks.
     *
     * The queue is drained before the callbacks run, so a callback that asks for
     * the next frame is scheduled for the *next* step rather than being run
     * again inside this one — which is what an animation loop does every frame,
     * and would otherwise spin forever.
     */
    step(ms) {
      t += ms;
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) cb(t);
      return t;
    },
  };
})();
