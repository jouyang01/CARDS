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
