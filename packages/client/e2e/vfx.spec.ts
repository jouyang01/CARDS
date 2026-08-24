import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures.js';
import { countPixels, decodePng, type Rgb } from './pixels.js';
import type { Page } from '@playwright/test';

/**
 * VFX-FLASH — the victim flash, photographed.
 *
 * Everything else about the flash is already pinned: `vfx.test.ts` fixes the
 * decision, `vfx-wiring.test.ts` proves the app asks the renderer for it with
 * the victim's id, `detach-materials.test.ts` proves the material it writes to
 * belongs to that unit alone, and `paint-flash.test.ts` proves the write lands
 * on every mesh of a body. None of that says the result is *on screen*, which is
 * the one claim only a browser can settle — and the claim that was outstanding
 * when the effect shipped.
 *
 * WHY THIS FILE OWNS A CLOCK. The flash is 0.18s and a screenshot of an
 * animating board waits ~2.2s for the compositor: the shutter is twelve times
 * slower than the subject, so sampling for it is not a flaky test, it is an
 * impossible one. `tools/virtual-clock.js` freezes the page's clock, which
 * inverts the problem — between steps nothing moves, the render loop idles, and
 * a screenshot costs ~0.17s and shows precisely the millisecond asked for.
 *
 * Deliberately in its own file, like `models.spec.ts`: it needs an init script
 * and a budget the board suite does not, and folding it in would put both on
 * every test there.
 */

const CLOCK = fileURLToPath(new URL('../tools/virtual-clock.js', import.meta.url));

/** Advance the page's own clock by one frame at 30fps. */
const STEP_MS = 1000 / 30;
const step = async (page: Page, ms = STEP_MS): Promise<void> => {
  await page.evaluate((n) => (window as unknown as { __film: { step(n: number): number } }).__film.step(n), ms);
};

/**
 * Emissive lights a unit's own material, so a flashed box goes pale: team blue
 * `#4f8cff` gains ~0.55 on every channel and lands near `#dbdcff`. Nothing on a
 * resting board is that bright inside the board clip — the sky is excluded by
 * the crop and the floors are mid-tone — so "very light pixels" is a specific
 * enough probe without having to know which unit was hit.
 */
const isLit = (px: Rgb): boolean => px.r > 185 && px.g > 185 && px.b > 185;

/**
 * How far above its neighbours a frame must rise to count as a flash.
 *
 * Measured, and with the mutant to calibrate against. Stepping the same scripted
 * turn on a frozen clock is deterministic to the pixel — the two runs below
 * differ at exactly one frame and are byte-identical everywhere else:
 *
 * |                     | flash on | `paintFlash` stubbed out |
 * |---------------------|---------:|-------------------------:|
 * | impact frame        |     4595 |                     3215 |
 * | its two neighbours  | 3137/2835 |               3137/2835 |
 * | rise above both     | **1458** |                   **78** |
 *
 * 800 sits between them with 1.8x headroom under the real signal and 10x over
 * the noise floor, so this fails if the flash stops reaching the screen and does
 * not fail because a shadow moved.
 */
const FLASH_SPIKE_MIN = 800;

test.describe('the victim flash reaches the screen', () => {
  // The clock is ours, but asset loading is not: the .glb fetches and the first
  // composite still happen on real time, and a stepped page only advances when
  // asked. Generous on purpose — this file has two tests, not thirty.
  test.setTimeout(180_000);

  test('VFX-FLASH-ON-SCREEN: a landed hit lights the victim, then releases it', async ({ page }) => {
    await page.addInitScript({ path: CLOCK });
    await page.goto('./');
    await expect(page.locator('#board canvas')).toBeVisible();

    // Photograph the RENDERER, not the page drawn over it.
    //
    // This is not tidiness — without it the test is a false positive, and was.
    // UI5's floating damage numbers are DOM, they live inside `#board`, they are
    // near-white, and they appear at exactly the moment of impact. So "the board
    // got brighter when the hit landed" was satisfied by the readout every time,
    // and the test passed unchanged with `paintFlash` stubbed out to never light
    // anything. Hiding the overlays leaves the canvas as the only thing that can
    // move the count, which is the only thing this test is about.
    await page.addStyleTag({
      content: '#board > *:not(canvas), .readouts, .phase-label { visibility: hidden !important; }',
    });

    // Assets arrive on real time, the scene draws on ours. Give both a chance.
    for (let i = 0; i < 60; i++) {
      await step(page);
      await page.waitForTimeout(30);
    }

    const canvas = page.locator('#board canvas');
    const box = (await canvas.boundingBox())!;

    // Arm the first ability, then aim it where the game itself says it will
    // hurt somebody. A fixed fraction of the viewport aims at whatever happens
    // to be there — on this map, empty floor — and a Blast with nothing in it
    // triggers no impact at all, which would make this test pass or fail on
    // where the board happened to be rather than on the flash.
    await page.locator('.hud-ability:not([disabled])').first().click();
    const aim = await aimAtSomethingLive(page, box);
    expect(aim, 'found no square where the armed ability would damage anyone').not.toBeNull();
    await page.mouse.click(aim!.x, aim!.y);
    await page.waitForTimeout(150);

    // Lock every seat so the turn resolves.
    for (let i = 0; i < 4; i++) {
      const lock = page.locator('.hud-lockrow .hud-lock');
      if (!(await lock.count())) break;
      await lock.first().click().catch(() => {});
      await page.waitForTimeout(150);
    }

    // Step until Blast is on screen. The timeline runs on our clock, so this
    // cannot overshoot: nothing advances between our steps.
    const label = page.locator('.phase-label');
    let reached = false;
    for (let i = 0; i < 400 && !reached; i++) {
      await step(page);
      reached = ((await label.textContent().catch(() => '')) ?? '').trim() === 'BLAST';
    }
    expect(reached, 'never reached the Blast phase').toBe(true);

    // Walk the phase a frame at a time, counting lit pixels. The flash is 0.18s
    // — about 6 frames at 30fps — inside a Blast of a few seconds, so this is
    // looking for a spike, not a level.
    // Tight on the victim, at full sample density. The flash lights ONE unit,
    // which is a few hundred pixels of a 1400x950 board — a rounding error in a
    // whole-board count, and smaller than the jitter the screen shake puts into
    // one. Cropping to where the hit was aimed makes the same pixels the
    // majority of what is measured.
    const clip = {
      x: Math.max(0, aim!.x - 160), y: Math.max(0, aim!.y - 160), width: 320, height: 320,
    };
    const lit: number[] = [];
    for (let i = 0; i < 90; i++) {
      lit.push(countPixels(decodePng(await page.screenshot({ clip })), isLit, 1));
      await step(page);
    }


    // A SPIKE, not a peak, and the difference is the whole test.
    //
    // The first version of this looked for the brightest frame and compared it
    // to the median. It passed with `paintFlash` stubbed out to never light
    // anything, because the phase ends with the board brightening as the camera
    // pulls back — so "the brightest frame is brighter than average" was true of
    // a build with no flash in it at all. What is specific to a flash is that a
    // frame is brighter than the frames on BOTH sides of it: it arrives and
    // leaves inside the window, which a camera move and a phase change do not.
    const spikes = lit.map((n, i) =>
      i === 0 || i === lit.length - 1 ? 0 : Math.min(n - lit[i - 1]!, n - lit[i + 1]!));
    const spike = Math.max(...spikes);
    const at = spikes.indexOf(spike);

    expect(
      spike,
      `no frame lit up and went dark again (lit pixels per frame: ${summarise(lit)})`,
    ).toBeGreaterThan(FLASH_SPIKE_MIN);

    // And it releases: the material goes back to where it started rather than
    // staying lit, which is what `paintFlash(body, 0)` is for.
    expect(lit[at + 1]!, 'the flash never released').toBeLessThan(lit[at]! - FLASH_SPIKE_MIN);
  });
});

/** A compact per-frame trace, so a failure says what the board actually did. */
function summarise(xs: readonly number[]): string {
  return xs.map((n) => String(n)).join(',');
}

/**
 * The board region, minus the chrome drawn over it.
 *
 * The canvas is the whole viewport since UI-VIEWPORT, and the HUD is painted in
 * the team colours — and, more to the point here, in bright text. Cropping the
 * chrome out keeps `isLit` measuring the board.
 */
async function boardClip(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<{ x: number; y: number; width: number; height: number }> {
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

/**
 * Find a point the armed ability would actually damage, the way a player does.
 *
 * Hovering a legal target makes the game offer a damage number
 * (`.readout.preview.damage`); a point that shows one is a point that lands. No
 * debug hook and nothing special-cased for being tested — this reads only what
 * the HUD already shows a human. The sweep is a coarse grid because the board is
 * drawn in perspective and tile centres sit on no screen-space lattice.
 */
async function aimAtSomethingLive(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  steps = 11,
): Promise<{ x: number; y: number } | null> {
  const damage = page.locator('.readout.preview.damage');
  for (let row = 1; row < steps; row++) {
    for (let col = 1; col < steps; col++) {
      const x = box.x + (box.width * col) / steps;
      const y = box.y + (box.height * row) / steps;
      await page.mouse.move(x, y);
      await step(page, 16); // the preview paints on the next drawn frame — ours
      await page.waitForTimeout(20);
      if (await damage.count()) return { x, y };
    }
  }
  return null;
}
