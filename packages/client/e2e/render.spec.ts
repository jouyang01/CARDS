import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  countPixels,
  decodePng,
  distinctColours,
  findPixels,
  isAimOrange,
  isBrushGreen,
  isChaseOrange,
  isPadTeal,
  isDashYellow,
  isDecoyPurple,
  isFogged,
  isTeamBlue,
  isMoveLine,
  isRangeWash,
  isSceneBackground,
  isTeamRed,
  largestCluster,
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
 * Clipped to the canvas's **uncovered** region rather than to its bounding box.
 * Since UI-VIEWPORT the canvas fills the whole viewport and the HUD, the
 * scoreboard and the combat log are drawn *over* it, so its box is the page. A
 * screenshot of that is a screenshot of the chrome as much as of the board —
 * and the chrome is painted in the same two team colours the probes below use
 * to prove units drew, which turns every one of those assertions into a
 * tautology. Anti-aliased title text was already enough stray colour to keep a
 * "no units drew" mutation passing once; a team-coloured HUD is that failure
 * with the volume up.
 *
 * The insets mirror `app.ts`'s `sizeToViewport`, which is what the camera
 * itself frames the board into — so this samples exactly the region the board
 * was fitted to.
 */
async function boardClip(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = (await boardCanvas(page).boundingBox())!;
  const chrome = await page.evaluate(() => {
    const rect = (sel: string): DOMRect | undefined =>
      document.querySelector(sel)?.getBoundingClientRect();
    const controls = rect('#controls');
    const log = rect('#log');
    const logIsColumn = log !== undefined && log.width < globalThis.innerWidth * 0.6;
    return {
      top: (rect('.scoreboard')?.bottom ?? rect('#status')?.bottom ?? 0) + 8,
      right: logIsColumn ? (log?.width ?? 0) : 0,
      bottom: (controls?.height ?? 0) + (logIsColumn ? 0 : (log?.height ?? 0)),
    };
  });
  return {
    x: box.x,
    y: box.y + chrome.top,
    width: Math.max(1, box.width - chrome.right),
    height: Math.max(1, box.height - chrome.top - chrome.bottom),
  };
}

async function frame(page: Page): Promise<Buffer> {
  return await page.screenshot({ clip: await boardClip(page) });
}

/** The composited board, decoded to pixels. */
async function pixels(page: Page): Promise<Image> {
  return decodePng(await frame(page));
}

const same = (a: Buffer, b: Buffer): boolean => a.equals(b);

/** Point at a fraction of the board and settle a frame. */
/**
 * Fractions address the **uncovered board region**, not the canvas box.
 *
 * Since UI-VIEWPORT the canvas is the whole viewport, so `0.55, 0.85` of its box
 * is inside the hotbar — and hovering a hotbar button paints a range envelope,
 * which changes the frame. That is the app working correctly; it is the
 * fractions that stopped meaning "somewhere on the board". Routing them through
 * the same clip `frame()` samples keeps the two in step: what a test points at
 * is inside what it then looks at.
 */
async function pointAt(page: Page, fx: number, fy: number): Promise<void> {
  const clip = await boardClip(page);
  await page.mouse.move(clip.x + clip.width * fx, clip.y + clip.height * fy);
  await page.waitForTimeout(180);
}

async function clickAt(page: Page, fx: number, fy: number): Promise<void> {
  const clip = await boardClip(page);
  await page.mouse.click(clip.x + clip.width * fx, clip.y + clip.height * fy);
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
      // Same uncovered-region clip the rest of the suite uses — the HUD is
      // painted in the team colours this test is looking for.
      const image = decodePng(await page.screenshot({ clip: await boardClip(page) }));
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
 * UI-VIEWPORT — the scene fills the viewport and the HUD overlays it.
 *
 * The board used to be the app frame: a DOM box the chrome was subtracted from,
 * so a bigger map pushed the controls off the bottom of the screen. `iron-basin`
 * at 22×19 is where that stopped being theoretical. The canvas is full-bleed
 * now and the *camera* frames the board into whatever the chrome leaves, so map
 * size and control placement are no longer the same question — which is exactly
 * the claim this drives at both required resolutions on both maps.
 */
test.describe('UI-VIEWPORT: the scene fills the viewport and the controls stay on it', () => {
  const MAPS = [
    { map: 'duel-arena', query: './?map=duel-arena' },
    { map: 'iron-basin', query: './?map=iron-basin&format=4v4' },
  ];
  const SIZES = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }];
  /** Everything a player has to be able to hit. */
  // Every button the HUD ships. `.hud-bank` (UI-TIMER's Time Bank pip) is in
  // the list deliberately: it is small and looks decorative, which is exactly
  // the reasoning that produced the undersized controls this rule exists to fix.
  const CONTROLS = '.hud-ability, .hud-catalyst, .hud-move, .hud-lock, .hud-small, .hud-bank';

  for (const { map, query } of MAPS) {
    for (const viewport of SIZES) {
      test(`${map} at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(query);
        await expect(boardCanvas(page)).toBeVisible();
        await page.waitForTimeout(700);

        // 1. The canvas IS the viewport.
        const canvas = (await boardCanvas(page).boundingBox())!;
        expect(Math.round(canvas.width), 'canvas does not span the viewport width').toBe(viewport.width);
        expect(Math.round(canvas.height), 'canvas does not span the viewport height').toBe(viewport.height);
        expect(Math.round(canvas.x)).toBe(0);
        expect(Math.round(canvas.y)).toBe(0);

        // 2. No control falls outside the visible area, at any map size.
        const controls = page.locator(CONTROLS);
        const count = await controls.count();
        expect(count, 'no controls found — the selector or the HUD moved').toBeGreaterThan(4);
        for (let i = 0; i < count; i++) {
          const el = controls.nth(i);
          if (!(await el.isVisible())) continue;
          const box = (await el.boundingBox())!;
          const label = (await el.textContent())?.trim().slice(0, 24) ?? `#${i}`;
          expect(box.x, `"${label}" runs off the left`).toBeGreaterThanOrEqual(-1);
          expect(box.y, `"${label}" runs off the top`).toBeGreaterThanOrEqual(-1);
          expect(box.x + box.width, `"${label}" runs off the right`).toBeLessThanOrEqual(viewport.width + 1);
          expect(box.y + box.height, `"${label}" runs off the bottom`).toBeLessThanOrEqual(viewport.height + 1);

          // 3. …and is big enough to hit rather than aim at.
          expect(box.width, `"${label}" is ${Math.round(box.width)}px wide`).toBeGreaterThanOrEqual(44);
          expect(box.height, `"${label}" is ${Math.round(box.height)}px tall`).toBeGreaterThanOrEqual(44);
        }

        // 4. The whole board is in frame: the corners of the *uncovered* region
        //    show scene background, so no rank of the board is clipped by an
        //    edge or hidden under the chrome.
        //    `pixels` already clips to that region, so the corners are the
        //    image's own — reading page-absolute coordinates into a clipped
        //    image would index past its edge and prove nothing.
        const image = await pixels(page);
        for (const [name, at] of [
          ['top-left', { x: 6, y: 6 }],
          ['top-right', { x: image.width - 6, y: 6 }],
          ['bottom-left', { x: 6, y: image.height - 6 }],
        ] as const) {
          expect(isSceneBackground(pixelAt(image, at.x, at.y)), `board is clipped at the ${name}`).toBe(true);
        }

        // 5. And it is a live scene, not a stretched empty canvas.
        expect(countPixels(image, isTeamBlue), 'units stopped drawing at this size').toBeGreaterThan(0);
      });
    }
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

/**
 * STEALTH-CONFIRM — "Does Veil's Stealth work? It doesn\'t seem to be working."
 *
 * The unit suite answers the render question (a stealthed Wisp is absent from
 * the enemy view, the decoy is enemy-styled) and pins the reason a player cannot
 * observe it: the shipped `duration: 1` is over by the enemy\'s next Decision
 * phase. What only a browser can say is that the *cast* works end to end — that
 * the free action is reachable from the hotbar, survives a lock-in, resolves,
 * and leaves a decoy the owner can actually see on the board.
 */
test('Wisp casts Veil & Decoy and its own team sees the purple decoy (STEALTH-CONFIRM)', async ({ page }) => {
  const status = page.locator('#status');
  const lock = lockIn(page);

  // Walk the hot-seat until Wisp is on the clock, casting nothing on the way.
  let cast = false;
  for (let i = 0; i < 6 && !cast; i++) {
    if ((await status.textContent())?.includes('Wisp') === true) {
      const veil = page.locator('.hud-ability.free').first();
      await expect(veil).toBeVisible();
      await veil.click();
      // A `self` free action commits on selection — no board click to make.
      await expect(veil).toHaveClass(/sel/);
      cast = true;
    }
    await lock.click();
    await page.waitForTimeout(200);
  }
  expect(cast, "never reached Wisp's seat to cast Veil & Decoy").toBe(true);

  // Lock the remaining seats so the turn resolves, then let playback finish.
  for (let i = 0; i < 4; i++) {
    if (await page.locator('.hud-playback').isVisible()) break;
    if (!(await lock.isVisible())) break;
    await lock.click();
    await page.waitForTimeout(200);
  }
  const skip = page.locator('.hud-playback');
  if (await skip.isVisible()) await skip.click();
  await page.waitForTimeout(600);

  // The log is the engine\'s own account of the turn: the decoy went down.
  await expect(page.locator('.log')).toContainText(/stealth/i);

  // …and the board shows it, in the purple only a decoy\'s owner ever sees.
  await expect(status).toContainText('Turn 2');
  expect(countPixels(await pixels(page), isDecoyPurple), 'no purple decoy on the board')
    .toBeGreaterThan(0);
});


/**
 * WAYPOINTS-FIX — the reported gesture, in a real browser, through the real
 * click handler.
 *
 * This test exists because the shipped WAYPOINTS had **thirteen green unit
 * tests and did nothing**. Both halves of the failure were in the wiring the
 * unit tests could not see: the Shift branch was nested inside "move is already
 * armed", and the append refused anything non-adjacent. So the AC asks for the
 * handler itself to be driven, and only a browser can do that.
 *
 * The assertion is the route's own colour rather than "the frame changed": a
 * frame diff would also pass on the hover highlight that any click produces.
 */
test('Shift-click draws a move route without arming Move first (WAYPOINTS-FIX)', async ({ page }) => {
  const before = countPixels(await pixels(page), isMoveLine);

  // Nothing armed — exactly the state the owner was in. Shift-click a tile a
  // few squares from the selected unit; the client should arm move itself and
  // route there.
  await page.keyboard.down('Shift');
  let painted = before;
  for (const [fx, fy] of [[0.42, 0.5], [0.38, 0.42], [0.46, 0.58], [0.34, 0.55]] as const) {
    await clickAt(page, fx, fy);
    painted = Math.max(painted, countPixels(await pixels(page), isMoveLine));
    if (painted > before) break;
  }
  await page.keyboard.up('Shift');

  expect(painted, 'a Shift-click with nothing armed drew no route — the reported bug')
    .toBeGreaterThan(before);

  // And it armed Move rather than committing and disarming: the readout has to
  // have been spent by the segment, which is the "budget draws down" half.
  const move = page.locator('.hud-moves .hud-move').nth(0);
  const left = Number(/\((\d+)\)/.exec((await move.textContent()) ?? '')?.[1] ?? '-1');
  expect(left, 'the waypoint segment did not draw the budget down').toBeGreaterThanOrEqual(0);
});

/**
 * RENDER-COVERAGE — one multi-turn drive over the render styles that shipped
 * without a browser test between them.
 *
 * Four things are drawn today that nothing composited has ever looked at: the
 * **pad marker** (PADS-INDICATOR), the **chase route** (CHASE1), the
 * **last-known ghost** (LAST-KNOWN) and the **camo red tile** (CAMO-REVEAL).
 * Each was unit-covered at the view-model level, which is exactly the layer that
 * cannot fail the way a render fails — the `transparent`/`needsUpdate` bug this
 * suite exists for passed every unit test in the repo.
 *
 * The style here is FOG-ZORDER's: match colour **families**, and where a colour
 * is shared with something else on the board (the chase route is the same warm
 * orange as an aim overlay, on purpose), assert a **delta** across an action
 * rather than an absolute count.
 */
test.describe('RENDER-COVERAGE: the render styles that had no browser test', () => {
  // These drive several real turns each, animation included, so they need more
  // than the suite's single-frame budget. The alternative — skipping the
  // animation — would be testing a different renderer than the one that ships.
  test.setTimeout(150_000);

/**
   * Lock in every seat until the turn resolves, then wait out the playback.
   * Returns false once the match is over — a drive that keeps going after a
   * Double KO would sit on an invisible Lock In until the timeout.
   */
  const resolveTurn = async (page: Page, perSeat?: (page: Page) => Promise<void>): Promise<boolean> => {
    for (let i = 0; i < 10; i++) {
      const lock = lockIn(page);
      if (!(await lock.isVisible())) break;
      // `perSeat` runs once per character on the clock, not once per turn: the
      // HUD hands the board to the next seat after each Lock In, so ordering
      // only the first one walks half the board and wonders why nobody met.
      if (perSeat !== undefined) await perSeat(page);
      await lock.click();
      await page.waitForTimeout(150);
      if (await page.locator('.hud-playback').isVisible()) break;
    }
    // Playback owns the screen until the decision HUD comes back — unless the
    // match ended, in which case it never does.
    // "Neither control is up" is ambiguous: it is the game-over screen, but it
    // is also the single frame where the HUD swaps between ordering and
    // playback. Requiring it to persist is what stops a mid-swap sample from
    // reporting a finished match — the flake this loop shipped with.
    let quiet = 0;
    for (let i = 0; i < 160; i++) {
      if (await lockIn(page).isVisible()) {
        await page.waitForTimeout(400);
        return true;
      }
      quiet = (await page.locator('.hud-playback').isVisible()) ? 0 : quiet + 1;
      if (quiet >= 8) return false; // two seconds of neither: the match is over
      await page.waitForTimeout(250);
    }
    return false;
  };

  /**
   * RENDER-DRIVE-FIX — walk a seat's characters at each other until somebody is
   * in sight.
   *
   * The old helper clicked **Move** and gave up after five turns. `duel-arena`
   * puts a wall pillar either side of the centre row, so a four-square move
   * spends most of its budget going around and the two teams — thirteen squares
   * apart, with six squares of sight — never met inside the cap. Both drives
   * then failed on their *premise* rather than on what they assert.
   *
   * Two changes, both of them things a player would actually do: **Sprint**
   * instead of Move (nothing is armed, so it is always available, and it is
   * twice the ground), and a cap with enough room that a detour around the
   * pillar does not exhaust it.
   */
  const CLOSE_TURNS = 8;
  const closeTheDistance = async (page: Page): Promise<void> => {
    // Sprint, not Move: no ability is armed in either drive, so the longer
    // reposition is always legal and halves the number of turns this takes.
    const sprint = page.locator('.hud-move', { hasText: /^Sprint/ });
    const move = page.locator('.hud-move', { hasText: /^Move/ });
    const control = (await sprint.isVisible()) && !(await sprint.isDisabled()) ? sprint : move;
    if (!(await control.isVisible()) || (await control.isDisabled())) return;
    await control.click();
    await clickAt(page, 0.5, 0.5);
  };

  /**
   * PADS-SCHEDULE — a pad is dormant until its `firstTurn`, so "is a pad drawn"
   * is a question with a clock on it, and the drive has to wind that clock.
   *
   * `isPadTeal` is the **Health** predicate, and duel-arena opens Might on turn
   * 2 but the regular flavours on turn 4 (PADS-PLACEMENT put Might in the
   * centre and Health on the flanks). A dormant plate draws at 0.14 opacity,
   * which is far below the predicate's floor — correctly, since "nearly
   * invisible" is what dormant is supposed to look like — so a frame sampled on
   * turn 2 has no teal in it at all. That is what this pair was failing on: the
   * schedule, not the renderer.
   *
   * Resolving until the plate appears rather than hard-coding "three turns"
   * keeps the *schedule* out of the suite. The numbers are the Designer's to
   * tune (`everyTurns` 4 → 5 on iron-basin is an open lever), and a test that
   * pinned them would go red on a balance pass instead of on a render bug.
   *
   * **Sampled from straight overhead**, which is the other half of why this
   * pair had never passed. A pad is a flat mark on the floor and the default
   * camera is pitched, so a raised block hides the ground one row *behind* it —
   * and PADS-PLACEMENT (PR #57) parks duel-arena's Health pads on `y = 3`,
   * directly north of the wall line at `y = 4`, where the wall boxes cover them
   * completely. (Measured, not guessed: the Energy pads on `y = 11` composite
   * fine at the same turn, and the Might pads on `y = 7` show only slivers past
   * the cover boxes at `y = 8`.) That is a **placement** problem for the
   * Designer, not a renderer one — flagged, not fixed here — so the question
   * this test is actually asking, "does an armed pad composite at all", is
   * asked from the projection where nothing can be in the way.
   */
  const PAD_TURNS = 5;

  /** Switch to the top-down projection, where a ground mark cannot be occluded. */
  const lookStraightDown = async (page: Page): Promise<void> => {
    const proj = page.locator('.hud-view .hud-small').first();
    // The button is labelled with the projection it is currently *in*.
    if ((await proj.textContent()) !== 'Top-down') await proj.click();
    await expect(proj).toHaveText('Top-down');
    await page.waitForTimeout(200);
  };

  const drivePadOpen = async (page: Page): Promise<number> => {
    await lookStraightDown(page);
    let teal = countPixels(await pixels(page), isPadTeal);
    for (let turn = 0; turn < PAD_TURNS && teal <= 20; turn++) {
      if (!(await resolveTurn(page))) break; // the match ended; report what we saw
      await lookStraightDown(page); // playback re-frames the camera, not the pitch
      teal = countPixels(await pixels(page), isPadTeal);
    }
    return teal;
  };

  test('an armed pad marker is on the board, in its own colour family', async ({ page }) => {
    // duel-arena ships a mirrored pair of Health pads, and they are public
    // terrain — drawn for both teams, fog or no fog.
    expect(
      await drivePadOpen(page),
      'no pad marker composited — the maps carry pads nobody can see',
    ).toBeGreaterThan(20);
  });

  test('a pad marker survives the next turn boundary', async ({ page }) => {
    expect(await drivePadOpen(page)).toBeGreaterThan(20);
    if (!(await resolveTurn(page))) return; // match ended; nothing left to assert
    // Whether this particular pad was taken or not, *a* Health pad is still
    // drawn: a consumed one keeps its plate and loses only its glyph. The
    // failure this catches is a marker that vanishes at a turn boundary.
    expect(
      countPixels(await pixels(page), isPadTeal),
      'the pad markers disappeared after a turn resolved',
    ).toBeGreaterThan(0);
  });

  test('arming a chase draws a route that is not there otherwise', async ({ page }) => {
    // The chase route shares the aim overlay's orange deliberately — both mean
    // "the thing you are pointing at" — so this is a delta with nothing else
    // armed, where the only orange that can appear is the chase.
    // The teams spawn thirteen apart with six squares of sight, so nobody is
    // chaseable on turn 1 and the control is correctly greyed out. Walk toward
    // the middle until somebody comes into view — driving the board into the
    // state under test rather than skipping because it did not start there.
    const chase = page.locator('.hud-move', { hasText: 'Chase' });
    await expect(chase).toBeVisible();
    for (let turn = 0; turn < CLOSE_TURNS && (await chase.isDisabled()); turn++) {
      if (!(await resolveTurn(page, closeTheDistance))) break;
    }
    expect(await chase.isDisabled(), 'never got an enemy into sight to chase').toBe(false);

    // A chase names a *unit*, so the click has to land on one. Rather than
    // sweeping and hoping, find the enemy the way this suite finds everything
    // else — by its pixels — and click the middle of the biggest red cluster.
    const baseline = await pixels(page);
    const before = countPixels(baseline, isChaseOrange);
    const allRed = findPixels(baseline, isTeamRed, 2);
    expect(allRed.length, 'no enemy on screen after closing the distance').toBeGreaterThan(10);
    // One BODY, not every red pixel on the frame. With two enemies in view the
    // median of all of them lands in the gap between the two — empty ground,
    // where a click arms nothing.
    const enemyPixels = largestCluster(allRed, 6);
    const clip = await boardClip(page);
    const scale = { x: clip.width / baseline.width, y: clip.height / baseline.height };
    // The median of each axis, so an antialiased fringe cannot drag the point
    // off the body the way a mean would.
    //
    // **This is also BODY-CLICK's regression test.** The middle of a body used
    // to be the one place on it you could not click: a unit stands 0.6 above the
    // floor under a pitched camera, `squareFromPoint` raycasted only the ground
    // plane, and the pixels at a waist therefore resolved to the square behind
    // it — measured, at the time, as "the median arms nothing, 70%-100% down the
    // silhouette all arm". The test clicked the foot to get past it. Now that
    // the ray asks the unit meshes first, the middle of a body is that unit's
    // square, and pointing at the middle of what you mean to click is what the
    // suite should be asserting.
    const median = (ns: number[]): number => [...ns].sort((a2, b2) => a2 - b2)[Math.floor(ns.length / 2)]!;
    const target = {
      x: median(enemyPixels.map((q) => q.x)),
      y: median(enemyPixels.map((q) => q.y)),
    };

    await chase.click();
    await page.waitForTimeout(150);
    await page.mouse.click(clip.x + target.x * scale.x, clip.y + target.y * scale.y);
    await page.waitForTimeout(300);

    const after = countPixels(await pixels(page), isChaseOrange);
    expect(after, 'arming a chase drew no route or ring').toBeGreaterThan(before);
    // …and the HUD agrees it took: the control names the quarry once one is set.
    expect(await chase.textContent()).not.toBe('Chase');
  });

  test('an enemy is drawn on a board that is still fogged (LAST-KNOWN)', async ({ page }) => {
    // The opening frame has the enemy team fully hidden — that is VISION1, and
    // another test pins it. What this one wants is the *other* side: an enemy
    // rendered while fog is still on the board, which is the frame a last-known
    // ghost lives in. Walk in until one is on screen and the fog has not lifted.
    let sawEnemyUnderFog = false;
    for (let turn = 0; turn < CLOSE_TURNS && !sawEnemyUnderFog; turn++) {
      const image = await pixels(page);
      // Both at once: an enemy body composited, and fog still covering part of
      // the board. Either alone is uninteresting — the pair is the state a
      // ghost is drawn in, and the state a "draw everything" regression breaks.
      sawEnemyUnderFog = countPixels(image, isFogged) > 0 && countPixels(image, isTeamRed) > 0;
      if (!sawEnemyUnderFog && !(await resolveTurn(page, closeTheDistance))) break;
    }
    expect(sawEnemyUnderFog, 'never composited an enemy while the board was still fogged').toBe(true);
  });

  /**
   * MOVE-SPRINT-FIRST — the owner's *"Vex's first sprint action does not move
   * the character"*, asked at the layer the report came from.
   *
   * The client modules answer this in `move-sprint-first.test.ts` and answer it
   * cleanly, which is exactly why the browser has to be asked too: the two
   * candidate explanations left were the app wiring and a stale bundle, and
   * neither is visible from a unit test. This is the drive that establishes
   * which — it fails if the button, the click handler or the order assembly is
   * broken, and it is green against a build made from this tree.
   *
   * Bodies rather than an exact square: the landing tile is `duel-arena`'s wall
   * pillar and MOVE1's re-route talking, and pinning it would turn a map edit
   * into a movement-bug report.
   */
  const blueBodies = (image: Image): { x: number; y: number }[] => {
    let rest = findPixels(image, isTeamBlue, 2);
    const out: { x: number; y: number }[] = [];
    // Two characters per seat, and a peel per body; the floor drops the route
    // line and antialiased fringes, which are not units.
    for (let i = 0; i < 4 && rest.length > 60; i++) {
      const blob = largestCluster(rest, 6);
      if (blob.length < 60) break;
      const seen = new Set(blob.map((p) => `${p.x},${p.y}`));
      rest = rest.filter((p) => !seen.has(`${p.x},${p.y}`));
      out.push({
        x: Math.round(blob.reduce((s, p) => s + p.x, 0) / blob.length),
        y: Math.round(blob.reduce((s, p) => s + p.y, 0) / blob.length),
      });
    }
    return out.sort((a, b) => a.y - b.y || a.x - b.x);
  };

  test('clicking a character to move onto its tile still moves you (BODY-CLICK)', async ({ page }) => {
    // Owner Dev Note: *"BUG: When moving to a location that another character
    // occupies … the character does not move at all."* Two failures in a row
    // produced that, and this drives both: the click has to land on the body's
    // square (BODY-CLICK, the raycast), and MOVE1 then has to turn an occupied
    // destination into a walk to the nearest legal square rather than into
    // nothing (`body-click.test.ts` owns that half in isolation).
    //
    // The seat's *other* character is the target, because it is the one body
    // guaranteed to be on screen on turn 1 — the enemy team spawns outside
    // vision — and because a teammate's tile is the likelier misclick anyway.
    const before = blueBodies(await pixels(page));
    expect(before.length, 'need both of the seat\'s characters on screen').toBeGreaterThan(1);

    await page.locator('.hud-move', { hasText: /^Move/ }).click();
    await page.waitForTimeout(150);

    // The teammate is whichever body is not the selected one; either works, so
    // take the second in the suite's stable top-to-bottom order.
    const clip = await boardClip(page);
    const image = await pixels(page);
    const scale = { x: clip.width / image.width, y: clip.height / image.height };
    const mate = blueBodies(image)[1]!;
    await page.mouse.click(clip.x + mate.x * scale.x, clip.y + mate.y * scale.y);
    await page.waitForTimeout(250);

    expect(await resolveTurn(page), 'the turn did not resolve').toBe(true);
    const after = blueBodies(await pixels(page));
    const stayed = after.filter((a) => before.some((b) => Math.hypot(a.x - b.x, a.y - b.y) < 12));
    expect(stayed.length, 'clicking a character produced no movement at all')
      .toBeLessThan(before.length);
  });

  test('the opening Sprint of the match actually moves a unit (MOVE-SPRINT-FIRST)', async ({ page }) => {
    const sprint = page.locator('.hud-move', { hasText: /^Sprint/ });
    const move = page.locator('.hud-move', { hasText: /^Move/ });
    // The HUD prints the budget it would spend, which is the only place the
    // engine's number is legible from out here — so read it rather than
    // hard-coding SPRINT_RANGE, and the assertion survives a rebalance.
    const budget = async (): Promise<number> =>
      Number(/\((\d+)\)/.exec((await move.textContent()) ?? '')?.[1] ?? '0');

    const walk = await budget();
    expect(walk, 'the Move control should be pricing a walk before anything is armed').toBeGreaterThan(0);
    await expect(sprint).toBeEnabled();
    await sprint.click();
    await page.waitForTimeout(150);
    expect(await budget(), 'arming Sprint did not re-price the turn').toBeGreaterThan(walk);

    const before = blueBodies(await pixels(page));
    expect(before.length, 'both of the seat\'s characters should be on screen').toBeGreaterThan(1);
    await clickAt(page, 0.5, 0.5); // straight at the middle — further than any budget reaches
    expect(await resolveTurn(page), 'the opening turn did not resolve').toBe(true);

    const after = blueBodies(await pixels(page));
    const stayed = after.filter((a) => before.some((b) => Math.hypot(a.x - b.x, a.y - b.y) < 12));
    expect(stayed.length, 'the first Sprint left every unit exactly where it started')
      .toBeLessThan(before.length);
  });

});


