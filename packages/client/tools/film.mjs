/**
 * film.mjs — capture an animation as evenly-spaced frames, on a clock we own.
 *
 *   npm run film -w @cards/client -- --frames 24 --fps 30
 *
 * WHY THIS EXISTS. Animation is the one thing a screenshot cannot show, and the
 * obvious fix — screenshot repeatedly and hope — produces a lie. Under software
 * GL this container renders at ~10fps, so "a frame every 110ms" is really "a
 * frame whenever the renderer got round to it", and every timing conclusion
 * drawn from it is about the capture rig rather than the game. A gait bug was
 * diagnosed twice off such captures and both readings were wrong.
 *
 * So the page runs on a VIRTUAL CLOCK. `performance.now` and
 * `requestAnimationFrame` are replaced before any app code loads; nothing
 * advances until this script says so. Both of the app's time sources go through
 * them — the renderer's mixer deltas (`renderer3d.ts`) and the playback timeline
 * (`app.ts`) — so stepping 33ms advances the animation by exactly 33ms, however
 * long the render actually takes. The frames are then a true 30fps film.
 *
 * No product code is involved: the shim lives entirely in the page's init
 * script, so nothing ships and nothing is special-cased for being filmed.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const URL_BASE = arg('url', 'http://127.0.0.1:4173/');
const CHARS = arg('chars', 'aegis,vex,wisp,ravok');
const FPS = Number(arg('fps', '30'));
const FRAMES = Number(arg('frames', '24'));
const PHASE = arg('phase', 'MOVE');
/** Name of an ability to arm before locking in, e.g. "Shield Bash". Optional. */
const ABILITY = arg('ability', '');
const OUT = arg('out', 'film');
const STEP_MS = 1000 / FPS;

/** Replace the page's clock. Installed before any app script runs. */
const virtualClock = () => {
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
    /** Advance the clock and run one round of frame callbacks. */
    step(ms) {
      t += ms;
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) cb(t);
      return t;
    },
  };
};

const main = async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(virtualClock);
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[cards]') || t.startsWith('[dbg]') || t.startsWith('[film]')) console.log(t);
  });

  await page.goto(`${URL_BASE}?chars=${CHARS}`, { waitUntil: 'load' });

  // Assets arrive on real time (fetch), the scene draws on virtual time. Give
  // both a chance: step frames while letting real milliseconds pass.
  for (let i = 0; i < 60; i++) {
    await page.evaluate((ms) => window.__film.step(ms), STEP_MS);
    await page.waitForTimeout(40);
  }

  // Order a move for the seat on the clock, then lock every seat so the turn
  // resolves. Clicks are real events; only the clock is fake.
  const board = page.locator('#board canvas');
  const box = await board.boundingBox();
  if (ABILITY !== '') {
    // An ability instead of a move, so a Blast phase has something in it.
    await page.locator(`button:has-text("${ABILITY}")`).first().click();
    await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.5);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + box.width * 0.52, box.y + box.height * 0.5);
    await page.waitForTimeout(150);
  } else {
  await page.locator('button:has-text("Move")').first().click();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.58);
  await page.waitForTimeout(150);
  await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.58);
  await page.waitForTimeout(150);
  }
  for (let i = 0; i < 4; i++) {
    const lock = page.locator('.hud-lockrow .hud-lock');
    if (await lock.count()) {
      await lock.first().click().catch(() => {});
      await page.waitForTimeout(150);
    }
  }

  // Step until the phase we want is on screen. The timeline runs on our clock,
  // so this cannot race: nothing advances between our steps.
  const label = page.locator('.phase-label');
  let found = false;
  for (let i = 0; i < 400 && !found; i++) {
    await page.evaluate((ms) => window.__film.step(ms), STEP_MS);
    const text = ((await label.textContent().catch(() => '')) ?? '').trim();
    if (text === PHASE) found = true;
  }
  if (!found) {
    console.log(`[film] never reached ${PHASE} — captured nothing`);
    await browser.close();
    process.exitCode = 1;
    return;
  }
  console.log(`[film] ${PHASE} reached at t=${await page.evaluate(() => window.__film.now())}ms`);

  for (let f = 0; f < FRAMES; f++) {
    await page.screenshot({ path: `${OUT}/f${String(f).padStart(3, '0')}.png` });
    await page.evaluate((ms) => window.__film.step(ms), STEP_MS);
  }
  console.log(`[film] ${FRAMES} frames at ${FPS}fps (${STEP_MS.toFixed(1)}ms apart) -> ${OUT}/`);
  await browser.close();
};

await main();
