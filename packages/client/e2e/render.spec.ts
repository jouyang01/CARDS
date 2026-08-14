import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  countPixels,
  decodePng,
  distinctColours,
  isAimOrange,
  isFogged,
  isTeamBlue,
  isTeamRed,
  type Image,
} from './pixels.js';

/**
 * RENDER-VERIFY — a thin smoke test over what the renderer actually composites.
 *
 * **Why this cannot be a unit test.** `gl.readPixels` and `toDataURL()` both come
 * back all-black off this canvas, so nothing in-page can see the render. The
 * renderer's *inputs* (cues, view-model, shape geometry, the interaction state
 * machine) are unit-covered elsewhere; this covers the one thing they cannot —
 * that the pixels arrive at all. It is what caught the `transparent`/
 * `needsUpdate` bug, where every fade and dim silently did nothing.
 *
 * **Deliberately not golden screenshots.** Pixel-perfect baselines across
 * SwiftShader versions and font stacks are a maintenance tax that fails for
 * reasons unrelated to the game. Instead this asserts the two properties a
 * broken renderer actually violates:
 *
 * 1. **The frame is not blank, and the right things are in it.** The screenshot
 *    is decoded and sampled: a dead renderer yields one or two distinct
 *    colours, a live board yields hundreds, and both teams' units must actually
 *    be on screen. Colours are matched as *families* (relationships between
 *    channels) rather than exact values, because everything is Lambert-shaded —
 *    so a lighting tweak does not break the suite, but "nothing drew" does.
 * 2. **The frame responds, then holds.** Arming an ability and moving the
 *    pointer must change the composited image; committing must freeze it. That
 *    pair also pins UI1-fix in a real browser.
 *
 * PNG *size* was tried first and rejected: a flat frame and a full board come
 * out within 20% of each other, so it could not tell them apart.
 */

/**
 * A blank frame samples to one or two colours; a drawn board to dozens. This is
 * only a coarse "the canvas is not a flat fill" net — the assertion with real
 * teeth is the team-colour check below, which goes to zero the moment units
 * stop drawing while the colour count barely moves.
 */
const MIN_DISTINCT_COLOURS = 12;

const boardCanvas = (page: Page): Locator => page.locator('#board canvas');
/** Lock In specifically — the playback Skip button shares its class. */
const lockIn = (page: Page): Locator => page.locator('.hud-right .hud-lock');

/**
 * The composited board, as PNG bytes — the only honest view of the render.
 *
 * Clipped to the canvas's own box rather than `locator.screenshot()`, which
 * captures the element's region *after* scrolling it into view and so drags in
 * page chrome. Anti-aliased title text was enough stray colour to keep a
 * "no units drew" mutation passing, which is the failure mode this suite exists
 * to catch.
 */
async function frame(page: Page): Promise<Buffer> {
  const clip = (await boardCanvas(page).boundingBox())!;
  return await page.screenshot({ clip });
}

/** The composited board, decoded to pixels. */
async function pixels(page: Page): Promise<Image> {
  return decodePng(await frame(page));
}

const same = (a: Buffer, b: Buffer): boolean => a.equals(b);

/** Point at a fraction of the board and settle a frame. */
async function pointAt(page: Page, fx: number, fy: number): Promise<void> {
  const box = (await boardCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(180);
}

async function clickAt(page: Page, fx: number, fy: number): Promise<void> {
  const box = (await boardCanvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(220);
}

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  await page.goto('./');
  await expect(boardCanvas(page)).toBeVisible();
  await page.waitForTimeout(600); // let the first frames composite
  expect(failures, 'the page must load without throwing').toEqual([]);
});

test('the board composites an actual scene, fogged to the seat on the clock', async ({ page }) => {
  const image = await pixels(page);

  // A renderer that draws nothing composites one flat colour. Hundreds of
  // distinct colours means terrain, units and shading all made it to the screen.
  expect(distinctColours(image), 'the canvas looks flat — nothing was drawn').toBeGreaterThan(MIN_DISTINCT_COLOURS);

  // And they are the right things. Team 0 has the clock, so its units are on
  // screen; team 1 spawns further than sight reaches, so under VISION1 it is
  // not drawn at all. Both halves matter: the first catches "nothing drew", the
  // second catches fog quietly doing nothing.
  expect(countPixels(image, isTeamBlue), 'team 0 units are missing from the board').toBeGreaterThan(0);
  expect(countPixels(image, isTeamRed), 'the unseen enemy team must not be drawn').toBe(0);
  expect(countPixels(image, isFogged), 'the board is not fogged — VISION1 did not paint').toBeGreaterThan(0);

  // The HUD came up with it, so this is a live match rather than a
  // half-initialised page that happened to paint a background.
  await expect(page.locator('.hud-ability').first()).toBeVisible();
  await expect(lockIn(page)).toBeVisible();
});

test('arming an ability paints an overlay that follows the pointer', async ({ page }) => {
  const before = await frame(page);

  await page.locator('.hud-ability:not([disabled])').first().click();
  await pointAt(page, 0.72, 0.30);
  const aimedHigh = await frame(page);
  expect(same(aimedHigh, before), 'selecting + aiming must change the board').toBe(false);

  // Not just "something changed" — the overlay's own colour must appear, and
  // more of it than the bare board had.
  const orangeBefore = countPixels(decodePng(before), isAimOrange);
  const orangeAimed = countPixels(decodePng(aimedHigh), isAimOrange);
  expect(orangeAimed, 'the ability overlay did not paint').toBeGreaterThan(orangeBefore);

  await pointAt(page, 0.72, 0.70);
  const aimedLow = await frame(page);
  expect(same(aimedLow, aimedHigh), 'the overlay must track the pointer').toBe(false);
});

test('a committing click locks the action so it stops following the mouse (UI1-fix)', async ({ page }) => {
  await page.locator('.hud-ability:not([disabled])').first().click();
  await pointAt(page, 0.72, 0.70);
  await clickAt(page, 0.72, 0.70);
  const committed = await frame(page);

  for (const [fx, fy] of [[0.30, 0.25], [0.55, 0.85], [0.85, 0.45]] as const) {
    await pointAt(page, fx, fy);
    expect(same(await frame(page), committed), `pointer at ${fx},${fy} must not move a committed aim`).toBe(true);
  }

  // Re-selecting re-arms, so the player is never stuck with one aim.
  await page.locator('.hud-ability:not([disabled])').first().click();
  await pointAt(page, 0.30, 0.25);
  expect(same(await frame(page), committed), 're-selecting must re-arm aiming').toBe(false);
});

test('a resolved turn animates, logs both ends, and floats a readout', async ({ page }) => {
  // Order every seat with its first available ability, aimed across the board,
  // then lock in until the turn resolves.
  for (let i = 0; i < 10; i++) {
    const lock = lockIn(page);
    if (!(await lock.isVisible())) break;
    const ability = page.locator('.hud-ability:not([disabled])');
    if (await ability.count() > 0) {
      await ability.first().click();
      const fy = 0.35 + (i % 3) * 0.15;
      await pointAt(page, 0.78, fy);
      await clickAt(page, 0.78, fy);
    }
    await lock.click();
    await page.waitForTimeout(160);
    if (await page.locator('.hud-playback').isVisible()) break;
  }

  // Playback runs: the phase label appears and the board keeps changing.
  await expect(page.locator('.phase-label')).toBeVisible({ timeout: 10_000 });
  const during = await frame(page);
  await page.waitForTimeout(400);
  expect(same(await frame(page), during), 'the resolution must be animating').toBe(false);

  // UI5's floating numbers and UI6's log are the two readable outputs of a turn.
  // Poll rather than sample once: a readout lives about two beats.
  let sawReadout = false;
  for (let i = 0; i < 40 && !sawReadout; i++) {
    sawReadout = (await page.locator('.readout').count()) > 0;
    await page.waitForTimeout(80);
  }
  expect(sawReadout, 'a damage/heal readout must float during resolution').toBe(true);

  await expect(page.locator('.log-turn').first()).toBeVisible();
  await expect(page.locator('.log-line').first()).toBeVisible();
  expect(await page.locator('.log-line').first().textContent()).toMatch(/hit|healed|shielded|killed/);
});

test('the camera responds to a right-drag orbit', async ({ page }) => {
  const before = await frame(page);
  const box = (await boardCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.42, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  expect(same(await frame(page), before), 'a right-drag must orbit the camera').toBe(false);
});

/**
 * UI-responsive — the HUD and log are `position: fixed`, so on a laptop they
 * cover the board rather than pushing it. The board subtracts their *measured*
 * sizes, which is the part that silently regresses: a breakpoint changes the
 * chrome and the fit keeps using yesterday's numbers.
 */
test.describe('the layout survives a laptop-sized window', () => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 700 }]) {
    test(`${viewport.width}x${viewport.height}: the board fits and still draws`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400);

      const board = (await boardCanvas(page).boundingBox())!;
      const hud = (await page.locator('.hud').boundingBox())!;

      // Fully on screen, and clear of the fixed chrome rather than under it.
      expect(board.x, 'board runs off the left').toBeGreaterThanOrEqual(-1);
      expect(board.x + board.width, 'board runs off the right').toBeLessThanOrEqual(viewport.width + 1);
      expect(board.y + board.height, 'board is hidden behind the HUD').toBeLessThanOrEqual(hud.y + 2);
      // Not collapsed to the minimum: it should still use most of the width.
      expect(board.width).toBeGreaterThan(viewport.width * 0.4);

      // And it is still a live scene, not a stretched empty canvas.
      const image = await pixels(page);
      expect(countPixels(image, isTeamBlue), 'units stopped drawing at this size').toBeGreaterThan(0);
    });
  }
});
