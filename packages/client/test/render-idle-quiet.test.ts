// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, click, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * RENDER-IDLE-QUIET — the **app** half: a settled board asks for no redraws.
 *
 * RENDER-ON-DEMAND made the renderer skip frames it does not need, and the
 * finding filed against it was that the app kept waking the board anyway —
 * "~49 camera marks + 15 highlights over 5 idle seconds", so the loop could
 * never quiet.
 *
 * **Measured here rather than assumed, and the measurement moved the item.**
 * Those 15 highlights are the *opening paint*, issued once: over five seconds
 * of a genuinely idle board the controller issues nothing at all. The camera
 * marks were the auto-camera's ease, which is bounded in seconds now
 * (`camera-ease.ts`) and stops marking when it settles.
 *
 * So this is a **pin**, not a fix. It exists because the property is easy to
 * lose by accident — one `setInterval` that repaints, one hover handler that
 * re-issues an unchanged highlight — and losing it costs a frame every tick
 * forever, which is invisible in a unit test and expensive in a browser. The
 * loop half ("and the loop draws no new frames") needs a real renderer and
 * lives in `e2e/render.spec.ts`.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION, WISP, AEGIS]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

/**
 * Every renderer method that would mark the board dirty.
 *
 * Kept as a list here rather than imported from `renderer3d`'s `MUTATORS`
 * deliberately: this test's job is to notice when the app starts calling
 * something it did not before, and sharing the source's own list would let a
 * new mutator be added to both at once and slip through.
 */
const MARKING = [
  'show', 'highlight', 'drawPath', 'drawPaths', 'drawShape', 'drawAuras', 'drawTracers', 'drawWalls',
  'drawParticles', 'focusOn', 'lookAt', 'fitBoard', 'setUnitAt', 'setUnitFade',
  'setUnitClip', 'setUnitFacing', 'setSpotlight', 'setProjection', 'resize', 'render',
] as const;

/** Boot a hot-seat, counting every marking call the controller makes. */
const bootCounting = () => {
  const ui = mountUI();
  const counts = new Map<string, number>();
  const target = ui.renderer as unknown as Record<string, unknown>;
  for (const name of MARKING) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = (...args: unknown[]): unknown => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      return (original as (...a: unknown[]) => unknown)(...args);
    };
  }
  const teams: [CharacterDef[], CharacterDef[]] = [[VEX, BASTION], [WISP, AEGIS]];
  const opening: GameState = createMatch(OPEN_MAP, '2v2', teams);
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, '2v2', [1, 1], POOL, undefined, undefined, opening);
  const total = (): number => [...counts.values()].reduce((a, b) => a + b, 0);
  return { ...ui, counts, total, reset: () => counts.clear() };
};

beforeEach(() => { document.body.replaceChildren(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('RENDER-IDLE-QUIET: a settled board asks for nothing', () => {
  it('THE ITEM: five idle seconds produce not one render mark', () => {
    // Five seconds because that is the window the original finding was measured
    // over, so a regression is comparable against the number that opened the
    // item. Fake timers because the failure mode is something on an interval —
    // real time would make this a flaky sleep.
    const b = bootCounting();
    expect(b.total(), 'the opening paint drew the board').toBeGreaterThan(0);
    b.reset();

    vi.advanceTimersByTime(5000);

    expect(
      [...b.counts].map(([name, n]) => `${name}×${n}`),
      'an idle board woke the renderer',
    ).toEqual([]);
  });

  it('and the opening paint is a burst, not the first tick of a stream', () => {
    // The distinction the measurement turned on. "15 highlights over 5 idle
    // seconds" and "15 highlights at boot, then silence" are the same reading
    // taken two ways, and only one of them is a leak.
    const b = bootCounting();
    const opening = b.counts.get('highlight') ?? 0;
    expect(opening, 'the board paints its layers once').toBeGreaterThan(0);
    b.reset();
    vi.advanceTimersByTime(5000);
    expect(b.counts.get('highlight') ?? 0, 'and does not keep painting them').toBe(0);
  });

  it('the timer ticks for five seconds without touching the renderer', () => {
    // The most likely regression, named. The decision clock runs at 10 Hz and
    // repaints the HUD; if it ever repainted the *board* instead of the DOM
    // strip it owns, this board would redraw fifty times over the window and
    // nothing else in the suite would notice.
    const b = bootCounting();
    b.reset();
    vi.advanceTimersByTime(5000);
    expect(b.counts.get('show') ?? 0, 'the clock does not redraw the board').toBe(0);
  });
});

describe('RENDER-IDLE-QUIET: interaction wakes it, and only interaction', () => {
  it('a real interaction still marks — the board is quiet, not deaf', () => {
    // The other half of any "stop doing work" change, and the one worth being
    // afraid of: a board that has stopped redrawing because it stopped
    // listening looks identical to one that is efficiently idle, right up until
    // a player tries to use it.
    const b = bootCounting();
    b.reset();
    click(b.controls.querySelector('.hud-move'));
    expect(b.total(), 'arming Move repainted the board').toBeGreaterThan(0);
  });

  it('and goes quiet again once that interaction has settled', () => {
    // Wake, then idle: the property has to hold after use, not just at boot.
    // A leak that only started on first interaction would pass every assertion
    // above.
    const b = bootCounting();
    click(b.controls.querySelector('.hud-move'));
    b.reset();
    vi.advanceTimersByTime(5000);
    expect([...b.counts.keys()], 'the board settled back down').toEqual([]);
  });
});
