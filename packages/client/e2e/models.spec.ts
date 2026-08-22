import { expect, test } from '@playwright/test';

/**
 * MODEL-FREEZE — the coverage that `?models=off` would otherwise have cost.
 *
 * The board suite in `render.spec.ts` runs with rigged models disabled, because
 * they render ~3x slower under SwiftShader and arrive at an arbitrary moment;
 * together those took that suite from 3 failures to 14, all timeouts. Turning
 * them off there is only defensible if the model path is covered *somewhere*,
 * and this is somewhere: one test, its own generous budget, asserting the thing
 * the board suite can no longer see.
 *
 * Deliberately narrow. It does not check what the character looks like — that
 * is what `ART_PIPELINE.md`'s own verification is for. It checks that enabling
 * models still produces a drawn board, which is the regression that would
 * matter and the one nothing else would now catch.
 */

test.describe('rigged character models', () => {
  // Three minutes: the board suite's 60s budget is exactly what models blow
  // through, so inheriting it here would reproduce the failure this file exists
  // to keep out of that suite.
  test.setTimeout(180_000);

  test('a board with models enabled still composites a scene', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (err) => failures.push(String(err)));

    // Explicitly on, overriding the project-wide `?models=off`.
    await page.goto('http://127.0.0.1:4173/?ambient=off&models=on');
    await expect(page.locator('#board canvas')).toBeVisible();

    // Long enough for the manifest fetch, the .glb, and the rebuild pass that
    // swaps the box for the mesh — `staleUnitGroups` runs on the next paint
    // after the model lands, so a board drawn before then is a board of boxes.
    await page.waitForTimeout(20_000);

    expect(failures, 'loading a character model threw').toEqual([]);
    await expect(page.locator('.hud-ability').first()).toBeVisible();

    // The board is still live and interactive, not a frozen or blank frame.
    const canvas = page.locator('#board canvas');
    const box = (await canvas.boundingBox())!;
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  test('a missing model degrades to a box rather than a dead board', async ({ page }) => {
    // `CharacterModels.load` records a 404 as missing and keeps the box. That
    // is the path every character without art takes today, so it is the common
    // case rather than an edge one.
    const failures: string[] = [];
    page.on('pageerror', (err) => failures.push(String(err)));
    await page.route('**/models/**', (route) => route.fulfill({ status: 404, body: '' }));

    await page.goto('http://127.0.0.1:4173/?ambient=off&models=on');
    await expect(page.locator('#board canvas')).toBeVisible();
    await page.waitForTimeout(3_000);

    expect(failures, 'a 404 on a model took the page down').toEqual([]);
    await expect(page.locator('.hud-ability').first()).toBeVisible();
  });
});
