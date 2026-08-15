import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  countPixels,
  decodePng,
  distinctColours,
  findPixels,
  isAimOrange,
  isBrushGreen,
  isDashYellow,
  isFogged,
  isTeamBlue,
  isRangeWash,
  isTeamRed,
  pixelAt,
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

/**
 * VISION1-opening — the enemy team must be absent from the FIRST frame, not
 * from the frame after fog engages. `beforeEach` settles for 600ms before it
 * looks, which is exactly long enough to miss a one-frame flash, so this test
 * navigates itself and starts sampling the moment the canvas exists.
 */
test('the opening frame is already fogged — no turn-1 grace reveal', async ({ page }) => {
  await page.goto('./', { waitUntil: 'commit' });
  await expect(boardCanvas(page)).toBeVisible();

  let sampled = 0;
  for (let i = 0; i < 8; i++) {
    const box = await boardCanvas(page).boundingBox();
    if (box !== null && box.width > 0) {
      const image = decodePng(await page.screenshot({ clip: box }));
      // Only judge frames that have actually drawn something — an empty canvas
      // before the first composite is not evidence either way.
      if (countPixels(image, isTeamBlue) > 0) {
        sampled += 1;
        expect(countPixels(image, isTeamRed), `frame ${i} flashed the enemy team`).toBe(0);
        expect(countPixels(image, isFogged), `frame ${i} drew before fog engaged`).toBeGreaterThan(0);
      }
    }
    await page.waitForTimeout(60);
  }
  expect(sampled, 'never caught a drawn frame to judge').toBeGreaterThan(0);
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
 * CAT2 — the catalyst row exists in the real bundle and a slot can be armed
 * without losing the ability underneath it. A unit test proves the draft
 * reducer keeps both; only a browser proves the two controls are wired to it.
 */
test('a catalyst can be armed without clearing the chosen ability', async ({ page }) => {
  const slots = page.locator('.hud-catalyst');
  await expect(slots).toHaveCount(3);
  // Prep / Dash / Blast — one per phase, the ruling's shape.
  await expect(slots.nth(0)).toHaveAttribute('data-phase', 'prep');
  await expect(slots.nth(2)).toHaveAttribute('data-phase', 'blast');

  const ability = page.locator('.hud-ability:not([disabled])').first();
  await ability.click();
  await expect(ability).toHaveClass(/sel/);

  await slots.nth(0).click(); // Second Wind: a self-cast, so it commits at once
  await expect(slots.nth(0)).toHaveClass(/sel/);
  // The ability is still selected — the whole point of a separate slot.
  await expect(ability).toHaveClass(/sel/);
});

/**
 * CAT-DASH-COST — "Dash Catalysts should not be a free action." The reducer is
 * unit-covered; what only a browser shows is that the cost is *visible* before
 * it is paid, which is the difference between a rule and a bug.
 */
test('arming the Dash catalyst prices the turn: Sprint greys out, Move reads 0', async ({ page }) => {
  const slots = page.locator('.hud-catalyst');
  await expect(slots.nth(1)).toHaveAttribute('data-phase', 'dash');
  const moveButtons = page.locator('.hud-moves .hud-move');
  const move = moveButtons.nth(0);
  const sprint = moveButtons.nth(1);
  await expect(sprint).toBeEnabled();
  await expect(move).toHaveText(/Move \([1-9]/);

  await slots.nth(1).click(); // Shift
  await expect(slots.nth(1)).toHaveClass(/sel/);
  await expect(sprint, 'Sprint must not stay offered once the Move is spent').toBeDisabled();
  await expect(move, 'the budget has to say what you will actually get').toHaveText('Move (0)');

  // Handing the slot back gives the Move back with it.
  await slots.nth(1).click();
  await expect(sprint).toBeEnabled();
  await expect(move).toHaveText(/Move \([1-9]/);
});

/**
 * FREE-UI — the mechanic the engine implemented and the client never exposed.
 * A unit test proves the reducer keeps both slots; only a browser proves the
 * hotbar button is wired to the free slot and not to the normal one.
 */
test('a free ability arms alongside a normal ability, and does not disable Sprint', async ({ page }) => {
  // Vex leads the dev draft and carries Overwatch Trap, the free Prep action.
  const free = page.locator('.hud-ability.free').first();
  await expect(free).toBeVisible();
  await expect(free).toContainText('free');

  const normal = page.locator('.hud-ability:not(.free):not([disabled])').first();
  await normal.click();
  await expect(normal).toHaveClass(/sel/);

  await free.click();
  await expect(free).toHaveClass(/sel/);
  // Both armed at once — the whole point of a separate slot.
  await expect(normal).toHaveClass(/sel/);
});

/**
 * MAPTOGGLE — the 4v4 map has been in `data/` and validated by unit tests since
 * M1, and was still unreachable in a browser because the entry point hard-coded
 * `duel-arena`. A unit test cannot tell you the URL boots; this can.
 */
test.describe('the dev map/format toggle', () => {
  test('?map=iron-basin&format=4v4 boots a playable 4v4', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
    await page.goto('./?map=iron-basin&format=4v4');
    await expect(boardCanvas(page)).toBeVisible();
    await page.waitForTimeout(700);
    expect(failures, 'the 4v4 setup must load without throwing').toEqual([]);

    // A live board with the seat's own team on it, and a HUD you can act
    // through — "playable", not just "painted".
    const image = await pixels(page);
    expect(distinctColours(image), 'the 4v4 board looks flat').toBeGreaterThan(MIN_DISTINCT_COLOURS);
    expect(countPixels(image, isTeamBlue), 'no units on the 4v4 board').toBeGreaterThan(0);
    await expect(page.locator('.hud-ability').first()).toBeVisible();
    await expect(lockIn(page)).toBeVisible();
  });

  test('a mistyped map says so instead of quietly loading another one', async ({ page }) => {
    await page.goto('./?map=iron-bason');
    await expect(page.locator('#app pre')).toContainText('unknown map');
    await expect(boardCanvas(page)).toHaveCount(0);
  });
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

/**
 * FOG-ZORDER — "the green stealth squares are STILL hiding aoe effect and
 * movement options".
 *
 * The green is brush, drawn as a 0.02-high box, and the highlight layers used to
 * live at 0.002–0.022 — *under* that lid. So an overlay covering a brush square
 * lost the depth test and simply did not appear, which to a player reads as the
 * ability being unable to reach there. Overlays now start above the brush
 * (`OVERLAY_BASE`), and `renderer3d.test.ts` pins that invariant numerically.
 *
 * This is the half a unit test cannot see: whether the pixels arrive. It finds
 * real lit brush on the composited board, aims at it, and asserts the overlay
 * shows up **on those same pixels** — not merely somewhere on screen, which is
 * what a whole-frame colour count would have let through.
 *
 * 4v4 on purpose: in the default format the seat's vision never reaches either
 * brush band, so every green pixel on screen is fogged brush and there is
 * nothing to prove anything against.
 */
test('overlays draw over brush instead of being eaten by it (FOG-ZORDER)', async ({ page }) => {
  await page.goto('./?map=duel-arena&format=4v4');
  await expect(boardCanvas(page)).toBeVisible();
  await page.waitForTimeout(700);

  const bare = await pixels(page);
  const brush = findPixels(bare, isBrushGreen, 2);
  expect(brush.length, 'no lit brush on the board — nothing to test against').toBeGreaterThan(100);

  const box = (await boardCanvas(page).boundingBox())!;
  const scale = { x: box.width / bare.width, y: box.height / bare.height };
  const hoverAt = async (p: { x: number; y: number }): Promise<Image> => {
    await page.mouse.move(box.x + p.x * scale.x, box.y + p.y * scale.y);
    await page.waitForTimeout(200);
    return await pixels(page);
  };
  /** Brush pixels that are no longer bare brush — i.e. something drew on them. */
  const covered = (img: Image): number => brush.filter((p) => !isBrushGreen(pixelAt(img, p.x, p.y))).length;
  const aimed = (img: Image): number => brush.filter((p) => isAimOrange(pixelAt(img, p.x, p.y))).length;

  // Candidates spread across both bands: only one of them is inside any given
  // ability's range, and which one depends on where the seat's units spawned.
  const step = Math.max(1, Math.floor(brush.length / 6));
  const candidates = Array.from({ length: 6 }, (_, i) => brush[i * step]).filter((p) => p !== undefined);

  const abilities = page.locator('.hud-ability:not([disabled])');
  const count = await abilities.count();
  expect(count, 'no usable ability to aim with').toBeGreaterThan(0);

  let bestCovered = 0;
  let bestAimed = 0;
  for (let i = 0; i < count && bestAimed === 0; i++) {
    await abilities.nth(i).click();
    for (const p of candidates) {
      const img = await hoverAt(p);
      bestCovered = Math.max(bestCovered, covered(img));
      bestAimed = Math.max(bestAimed, aimed(img));
      if (bestAimed > 0) break;
    }
  }

  // The hover range envelope reaching brush at all is the coarse half: under the
  // old lifts every one of these pixels stayed bare green.
  expect(bestCovered, 'no overlay composited onto brush at all').toBeGreaterThan(brush.length / 4);
  // And the aimed AoE specifically — the "hiding aoe effect" in the report.
  // A floor well above one tile's worth of edge pixels, so an antialiased
  // fringe cannot pass for a painted square.
  expect(bestAimed, 'the aim overlay did not survive the brush tiles').toBeGreaterThan(20);
});

/**
 * PREVIEW-NUMBERS — "Players should know what their action is going to do."
 *
 * The polarity and the amounts are unit-covered; what only a browser can say is
 * whether the floats are in the DOM, anchored over the board, and gone again
 * once the turn stops being a plan.
 */
test('an aimed action floats its numbers before Lock In (PREVIEW-NUMBERS)', async ({ page }) => {
  await page.goto('./?map=duel-arena&format=4v4');
  await expect(boardCanvas(page)).toBeVisible();
  await page.waitForTimeout(700);

  const previews = page.locator('.readout.preview');
  await expect(previews).toHaveCount(0); // nothing armed, nothing promised

  // Sweep the board until an aim covers somebody. Which square that is depends
  // on spawns and on the first ability's shape, so this searches rather than
  // guessing — including the seat's own column, since friendly fire means an
  // ally in your own area is a legitimate (and important) red number.
  await page.locator('.hud-ability:not([disabled])').first().click();
  const spots: [number, number][] = [];
  for (let ix = 1; ix <= 9; ix++) for (let iy = 1; iy <= 5; iy++) spots.push([ix / 10, iy / 6]);
  for (const [fx, fy] of spots) {
    if ((await previews.count()) > 0) break;
    await pointAt(page, fx, fy);
  }
  expect(await previews.count(), 'no aim over the board ever previewed a number').toBeGreaterThan(0);

  // A number, positioned over the board — not a stray empty node in the corner.
  const first = previews.first();
  await expect(first).toHaveText(/^[+]?\d+$/);
  const box = (await first.boundingBox())!;
  const board = (await boardCanvas(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(board.x - 40);
  expect(box.x).toBeLessThanOrEqual(board.x + board.width + 40);

  // Locking in resolves the turn, and a resolved turn is no longer a plan.
  await lockIn(page).click();
  await page.waitForTimeout(400);
  await expect(previews).toHaveCount(0);
});

/**
 * AIM-RANGE + DASH-CAT-ROUTE — "Dash catalyst doesn\'t have a range indicator",
 * "Overwatch Trap doesn\'t have a range indicator either", "Shift\'s dash
 * catalyst should show as a yellow movement similar to other dash/blinks."
 *
 * The gate and the envelope geometry are unit-covered; what only a browser shows
 * is that arming these slots actually paints something, since the bug was
 * precisely that they painted nothing.
 */
test('arming a catalyst or a free ability paints a range envelope (AIM-RANGE)', async ({ page }) => {
  const before = countPixels(await pixels(page), isRangeWash);
  // A whole envelope is thousands of sampled pixels (Shift's range-3 disc is
  // ~29 tiles), so the margin is well clear of frame-to-frame jitter while
  // still failing outright if nothing paints.
  const ENVELOPE = 1500;

  // The Dash slot — Shift, the one the Dev Note named.
  await page.locator('.hud-catalyst').nth(1).click();
  await page.waitForTimeout(220);
  expect(countPixels(await pixels(page), isRangeWash), 'the Dash catalyst shows no range envelope')
    .toBeGreaterThan(before + ENVELOPE);

  // …and the free ability slot, which had the same gap.
  await page.locator('.hud-catalyst').nth(1).click(); // hand the slot back
  await page.locator('.hud-ability.free').first().click();
  await page.waitForTimeout(220);
  expect(countPixels(await pixels(page), isRangeWash), 'the free ability shows no envelope')
    .toBeGreaterThan(before + ENVELOPE);
});

test('aiming Shift draws a yellow route to its landing square (DASH-CAT-ROUTE)', async ({ page }) => {
  const before = countPixels(await pixels(page), isDashYellow);

  await page.locator('.hud-catalyst').nth(1).click(); // Shift
  // Shift reaches 3, so sweep close to the unit rather than across the board.
  let painted = before;
  for (const [fx, fy] of [[0.30, 0.5], [0.26, 0.42], [0.34, 0.58], [0.30, 0.62]] as const) {
    await pointAt(page, fx, fy);
    painted = Math.max(painted, countPixels(await pixels(page), isDashYellow));
    if (painted > before) break;
  }
  expect(painted, 'Shift drew no yellow route — it still reads as an area, not a move')
    .toBeGreaterThan(before);
});
