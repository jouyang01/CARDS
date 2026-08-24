import { test as base } from '@playwright/test';

/**
 * RENDER-FLAGS — a `page.goto` that keeps the suite's flags attached.
 *
 * **Putting them in `baseURL` does not work, and did not work.** Playwright
 * resolves a relative navigation against `baseURL` as a URL, and
 * `new URL('./', 'http://host/?ambient=off')` is `http://host/` — the query is
 * *replaced*, not merged. Every test here navigates relatively (`./`,
 * `./?map=duel-arena`), so a flag parked in `baseURL` reaches exactly the tests
 * that navigate to the bare base and no others.
 *
 * That is not a hypothetical. `?ambient=off` shipped in `baseURL` and was inert
 * from the moment it landed: the guard built specifically so the first piece of
 * ambient motion could not break the frame-equality tests was not attached to
 * anything. It would have been discovered by that motion breaking those tests —
 * which is precisely the failure it existed to prevent.
 *
 * So the flags are merged per navigation instead, and only when the test has not
 * asked for something else: `models.spec.ts` passes `models=on` explicitly and
 * keeps it.
 */

const FLAGS: Readonly<Record<string, string>> = {
  // No ambient motion exists yet; this is the guard waiting for it.
  ambient: 'off',
  // Rigged models are covered by `models.spec.ts` on its own budget.
  models: 'off',
  // Terrain props load async and change the frame; the pixel tests need the
  // plain terrain boxes they were written against. models.spec keeps this off too.
  props: 'off',
  // RENDER-ON-DEMAND, and the single biggest thing keeping this suite honest.
  //
  // `page.screenshot` cannot return until the compositor hands it a frame, and
  // a board that redraws unconditionally at the ~3.3fps SwiftShader manages
  // makes that wait ~2.2s. Nearly every test here is a sequence of screenshots,
  // so the whole suite ran at that price and 17 of its 34 tests timed out.
  //
  // Measured on this scene, once the camera has settled:
  //
  // | loop        | screenshot |
  // |-------------|------------|
  // | always draw | ~2200 ms   |
  // | on demand   | ~166 ms    |
  //
  // The earlier reading that put this at "no benefit" counted frames on a page
  // that had been idle two seconds — which was still inside the camera's ease,
  // so the scene genuinely was changing and the loop was right to draw. The
  // ease is now bounded in seconds rather than frames (`camera-ease.ts`), so an
  // untouched board reaches a true resting state and this flag collects on it.
  //
  // Now the product default too, so this line is a **pin** rather than a switch:
  // it states what the suite requires, so a future change to that default moves
  // the game without silently putting the suite back on a 2.2s screenshot.
  render: 'ondemand',
};

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const navigate = page.goto.bind(page);
    page.goto = async (url, options) => {
      const resolved = new URL(url, baseURL ?? 'http://127.0.0.1:4173/');
      for (const [key, value] of Object.entries(FLAGS)) {
        if (!resolved.searchParams.has(key)) resolved.searchParams.set(key, value);
      }
      return navigate(resolved.toString(), options);
    };
    await use(page);
  },
});

export { expect } from '@playwright/test';
