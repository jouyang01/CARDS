import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import {
  AIM_STEPS,
  aimInRange,
  circleSquares,
  coneSquares,
  expandShape,
  lineSquares,
  stepToVector,
} from '../src/shapes.js';
import { makeMap, posKeys } from './helpers.js';
import type { AbilityDef, Vec2 } from '../src/types.js';

/**
 * The acceptance harness for Track A — AIM-METRIC, CONE-B, CIRCLE-FIX and
 * DASH-IMPACT, verified over **all four shape families** at once.
 *
 * The property the whole track exists to restore: **a shape describes the same
 * thing whichever way it points.** Both bugs it fixes were the same mistake —
 * lattice-step metering applied to projected geometry — and both hid from a
 * casual test, so this asserts three things rather than one:
 *
 *   1. **Reach** — the furthest covered tile, measured ALONG THE AXIS. This is
 *      the check that caught the cone-length bug (range 4 reaching 7 tiles on
 *      the diagonal) and it is invisible to a tile count.
 *   2. **Tile count** — bounded, per shape, by what the geometry can actually
 *      deliver. Not the same bound for every family: a 1-tile-wide beam and a
 *      solid wedge sample the lattice completely differently.
 *   3. **Determinism** — the same aim yields the identical tile set, every run.
 *
 * Where a stated acceptance figure is not attainable, the bound here is the
 * measured one and the gap is written up for the Analyzer rather than papered
 * over. See docs/DECISIONS.md, 2026-08-27.
 */

const BOARD = buildBoard(makeMap(Array.from({ length: 61 }, () => '.'.repeat(61))));
const CENTRE: Vec2 = { x: 30, y: 30 };
/** Every quantized aim, plus the 8 compass vectors a click-to-aim order makes. */
const ALL_STEPS = Array.from({ length: AIM_STEPS }, (_, s) => stepToVector(s));
const COMPASS: Vec2[] = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) if (x !== 0 || y !== 0) COMPASS.push({ x, y });

/** How far the furthest covered tile sits **along the aim** — the reach check. */
function axialReach(dir: Vec2, squares: readonly Vec2[]): number {
  const len = Math.hypot(dir.x, dir.y);
  return Math.max(0, ...squares.map((p) =>
    ((p.x - CENTRE.x) * dir.x + (p.y - CENTRE.y) * dir.y) / len));
}

describe('rotation invariance: reach — the check a tile count cannot make', () => {
  it('a CONE reaches `range` tile-widths, within half a tile, at every rotation', () => {
    for (const range of [1, 2, 3, 4, 6, 8]) {
      for (const dir of [...ALL_STEPS, ...COMPASS]) {
        const got = axialReach(dir, coneSquares(BOARD, CENTRE, dir, range));
        expect(Math.abs(got - range), `cone range ${range} dir ${dir.x},${dir.y} reached ${got}`)
          .toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('a LINE never over-reaches its range, whichever way it points', () => {
    // The nerf AIM-METRIC exists for: a range-8 beam used to run 11.3 tiles on
    // the diagonal. Over-reach is the bug, so the cap is the hard half.
    for (const range of [2, 4, 8]) {
      for (const dir of [...ALL_STEPS, ...COMPASS]) {
        const got = axialReach(dir, lineSquares(BOARD, CENTRE, dir, range));
        expect(got, `line range ${range} dir ${dir.x},${dir.y}`).toBeLessThanOrEqual(range);
      }
    }
  });

  it('…and falls short of it by less than one tile of spacing', () => {
    // The soft half. A beam is one tile wide, so its last covered centre can sit
    // up to √2/2 inside the end — that is the lattice, not the rule. Measured
    // worst case is 1.30 tiles at range 8; the bound is 1.5.
    for (const range of [2, 4, 8]) {
      for (const dir of [...ALL_STEPS, ...COMPASS]) {
        const got = axialReach(dir, lineSquares(BOARD, CENTRE, dir, range));
        expect(range - got, `line range ${range} dir ${dir.x},${dir.y} reached ${got}`)
          .toBeLessThan(1.5);
      }
    }
  });
});

describe('rotation invariance: tile counts', () => {
  it('a CONE stays within the measured boundary band of its axis-aligned count', () => {
    // The region's area is exactly rotation-invariant now, so all that varies is
    // how the lattice samples the half-tile boundary band — an effect that grows
    // with the perimeter, and therefore with range. `axis + range + 1` is that
    // measured bound, verified at every rotation for ranges 1–8. (The ruling
    // asks for ±1; that is not attainable while the axis-aligned footprint stays
    // 3/8/15/24, because the axis case sits at the BOTTOM of the distribution —
    // the lattice lines up with its edges. Raised in DECISIONS.md.)
    for (const range of [1, 2, 3, 4, 6, 8]) {
      const axis = coneSquares(BOARD, CENTRE, { x: 1, y: 0 }, range).length;
      for (const dir of [...ALL_STEPS, ...COMPASS]) {
        const n = coneSquares(BOARD, CENTRE, dir, range).length;
        expect(n, `cone range ${range} dir ${dir.x},${dir.y}`).toBeGreaterThanOrEqual(axis - 1);
        expect(n, `cone range ${range} dir ${dir.x},${dir.y}`).toBeLessThanOrEqual(axis + range + 1);
      }
    }
  });

  it('the axis-aligned cone is the owner-approved 3 / 8 / 15 / 24', () => {
    expect([1, 2, 3, 4].map((r) => coneSquares(BOARD, CENTRE, { x: 1, y: 0 }, r).length))
      .toEqual([3, 8, 15, 24]);
  });

  it('no LINE tile is ever further than `range` — the reach rule, exactly', () => {
    // The assertion with teeth, and the one AIM-SMOOTH made necessary. A beam's
    // *reach* is a distance, not a tile count, and this holds to the square at
    // every one of the AIM_STEPS rotations: raising the resolution must not let
    // a rotated beam creep one tile past what its range promises.
    for (const range of [1, 2, 4, 8]) {
      for (const dir of [...ALL_STEPS, ...COMPASS]) {
        for (const p of lineSquares(BOARD, CENTRE, dir, range)) {
          const d = Math.hypot(p.x - CENTRE.x, p.y - CENTRE.y);
          expect(d, `line range ${range} dir ${dir.x},${dir.y} tile ${p.x},${p.y}`)
            .toBeLessThanOrEqual(range);
        }
      }
    }
  });

  it('a LINE never goes short: at least `range/√2` tiles', () => {
    // A diagonal beam's tiles are √2 apart, so the same distance covers 1/√2 as
    // many of them. Asserting ±1 here would be asserting something false.
    for (const range of [2, 4, 8]) {
      for (const dir of [...ALL_STEPS, ...COMPASS]) {
        expect(lineSquares(BOARD, CENTRE, dir, range).length, `line range ${range} dir ${dir.x},${dir.y}`)
          .toBeGreaterThanOrEqual(Math.floor(range / Math.SQRT2));
      }
    }
  });

  it('…and never runs away: at most 1.25x `range` tiles', () => {
    // The upper bound used to be `range + 1`, which held at AIM_STEPS = 256 by
    // luck rather than by geometry. At 512 a slope just off 1/2 walks a shallow
    // staircase whose shoulder tiles push a range-8 beam to ten squares — all
    // of them inside range 8 (the test above proves it), just more of them.
    // 1.25 is the measured worst case across every step and range; it is a
    // guard against a beam running away, not a claim about the exact count.
    for (const range of [2, 4, 8]) {
      for (const dir of [...ALL_STEPS, ...COMPASS]) {
        expect(lineSquares(BOARD, CENTRE, dir, range).length, `line range ${range} dir ${dir.x},${dir.y}`)
          .toBeLessThanOrEqual(Math.ceil(range * 1.25));
      }
    }
  });

  it('a CIRCLE is 5 / 13 / 29 and has no orientation to lose', () => {
    expect([1, 2, 3].map((r) => circleSquares(BOARD, CENTRE, r).length)).toEqual([5, 13, 29]);
    // A disc is rotation-invariant by construction, and the lattice proves it:
    // the covered set maps onto itself under every 90° turn about the centre.
    for (const r of [1, 2, 3, 4, 6]) {
      const covered = new Set(posKeys(circleSquares(BOARD, CENTRE, r)));
      for (const key of covered) {
        const [x, y] = key.split(',').map(Number) as [number, number];
        const dx = x - CENTRE.x, dy = y - CENTRE.y;
        expect(covered.has(`${CENTRE.x - dy},${CENTRE.y + dx}`), `r${r} ${key} rotated`).toBe(true);
      }
    }
  });

  it('the aimable region (`square`/`circle` range) is a disc, symmetric in both axes', () => {
    for (const range of [2, 4, 6, 8]) {
      for (let dy = -range - 1; dy <= range + 1; dy++) {
        for (let dx = -range - 1; dx <= range + 1; dx++) {
          const inside = aimInRange(CENTRE, { x: CENTRE.x + dx, y: CENTRE.y + dy }, range);
          // Every reflection and quarter-turn of an aimable square is aimable.
          for (const [rx, ry] of [[-dx, dy], [dx, -dy], [-dy, dx], [dy, -dx]] as const) {
            expect(aimInRange(CENTRE, { x: CENTRE.x + rx, y: CENTRE.y + ry }, range), `${dx},${dy} @ ${range}`)
              .toBe(inside);
          }
        }
      }
    }
  });
});

describe('rotation invariance: determinism', () => {
  const shaped = (over: Partial<AbilityDef>): AbilityDef => ({
    id: 'a', name: 'A', phase: 'blast', shape: 'line', range: 5, cooldown: 0, energyGain: 0,
    effects: [{ kind: 'damage', amount: 1 }], description: 'test', ...over,
  });

  it('the same aim yields the identical tile set, through the public entry point', () => {
    // `expandShape` is the one authority every consumer reads — the resolver,
    // UI2's overlay, the client's preview — so it is the one worth pinning.
    for (const def of [
      shaped({ shape: 'line', range: 6 }),
      shaped({ shape: 'cone', range: 4 }),
      shaped({ shape: 'circle', range: 6, radius: 2 }),
      shaped({ shape: 'square', range: 6 }),
    ]) {
      for (let step = 0; step < AIM_STEPS; step += 7) {
        const aim = [{ x: CENTRE.x + 3, y: CENTRE.y + 2 }];
        const once = expandShape(BOARD, def, CENTRE, aim, step);
        const twice = expandShape(BOARD, def, CENTRE, aim, step);
        expect(once, `${def.shape} step ${step}`).toEqual(twice);
        // Integers only: a float anywhere would be a machine-dependent answer.
        for (const p of once) {
          expect(Number.isInteger(p.x) && Number.isInteger(p.y), `${def.shape} step ${step}`).toBe(true);
        }
      }
    }
  });

  it('opposite aims are mirror images, tile for tile', () => {
    // Not a restatement of the count bound: this catches an asymmetry that
    // preserves the count, which is exactly what a lattice-step metric produces.
    for (const range of [2, 4, 6]) {
      for (let step = 0; step < AIM_STEPS / 2; step += 5) {
        const dir = stepToVector(step);
        const opposite = stepToVector((step + AIM_STEPS / 2) % AIM_STEPS);
        for (const fn of [coneSquares, lineSquares]) {
          const forward = fn(BOARD, CENTRE, dir, range);
          const back = fn(BOARD, CENTRE, opposite, range);
          expect(back.length, `${fn.name} range ${range} step ${step}`).toBe(forward.length);
          const mirrored = posKeys(forward.map((p) => ({
            x: 2 * CENTRE.x - p.x,
            y: 2 * CENTRE.y - p.y,
          })));
          expect(posKeys(back), `${fn.name} range ${range} step ${step}`).toEqual(mirrored);
        }
      }
    }
  });
});
