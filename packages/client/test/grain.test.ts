import { describe, expect, it } from 'vitest';
import {
  GRAIN_BASE, GRAIN_MAX, clampGrain, hash2, hashUnit, seedOf, tileTint,
} from '../src/grain.js';
import { FALLBACK_THEME, THEMES, foggedColour } from '../src/themes.js';

/**
 * GRAIN — phase 3's arithmetic, which is all of it that can be wrong quietly.
 *
 * The raster needs a canvas and the material needs a GL context, but the hash
 * does not, and the hash is the part that must never drift: it is what makes the
 * board look identical to both teams, identical across runs, and identical
 * between a screenshot and the 32 Playwright frames compared against it.
 */

const ALL = Object.values(THEMES);

describe('the hash is a hash, and it is deterministic', () => {
  it('returns the same value for the same inputs, every time', () => {
    // The rule from `ART_PIPELINE.md` §"Seed the randomness", and the reason
    // `Math.random()` is not used here: a board that reshuffled per load would
    // break same-board-for-both-teams, reproducible screenshots, and the
    // frame-equality pixel tests, in that order of seriousness.
    for (const [s, x, y] of [[1, 0, 0], [99, 7, 3], [0xdead, -2, 41]] as const) {
      expect(hash2(s, x, y)).toBe(hash2(s, x, y));
    }
  });

  it('is stable across calls interleaved with other calls', () => {
    const first = hash2(7, 2, 3);
    hash2(99, 100, 100);
    hashUnit(1, 1, 1);
    expect(hash2(7, 2, 3)).toBe(first);
  });

  it('separates neighbours rather than banding them', () => {
    // A weak hash gives adjacent squares near-identical values, which shows up
    // as stripes across the floor rather than as variation. Asserted as a
    // *statistic*, not per pair: a first draft demanded every adjacent pair
    // differ by 0.02 and failed, correctly — a genuinely uniform hash produces
    // the occasional near-collision, and forbidding that would be demanding
    // structure rather than the absence of it. Uniform-random neighbours average
    // |Δ| = 1/3, and all three seeds below land at 0.30–0.37.
    for (const seed of [11, 5, seedOf('proving-floor')]) {
      const row = Array.from({ length: 64 }, (_, x) => hashUnit(seed, x, 0));
      let total = 0;
      for (let i = 1; i < row.length; i++) total += Math.abs(row[i]! - row[i - 1]!);
      expect(total / (row.length - 1), `seed ${seed}`).toBeGreaterThan(0.25);
    }
  });

  it('never runs a stretch of squares at the same value', () => {
    // The failure the statistic above could hide: a mean pulled up by big jumps
    // elsewhere while one region sits flat.
    const row = Array.from({ length: 64 }, (_, x) => hashUnit(11, x, 0));
    let run = 1;
    for (let i = 1; i < row.length; i++) {
      run = Math.abs(row[i]! - row[i - 1]!) < 0.02 ? run + 1 : 1;
      expect(run, `flat run ending at ${i}`).toBeLessThan(3);
    }
  });

  it('separates rows as well as columns', () => {
    expect(hashUnit(11, 3, 4)).not.toBeCloseTo(hashUnit(11, 4, 3), 3);
  });

  it('stays inside 0..1 across a wide sweep', () => {
    for (let x = -50; x < 50; x += 7) {
      for (let y = -50; y < 50; y += 11) {
        const v = hashUnit(3, x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('spreads over the whole range rather than clustering', () => {
    const buckets = new Array<number>(4).fill(0);
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        buckets[Math.min(3, Math.floor(hashUnit(5, x, y) * 4))]! += 1;
      }
    }
    for (const [i, n] of buckets.entries()) expect(n, `quartile ${i}`).toBeGreaterThan(250);
  });

  it('gives different themes different grain from the same square', () => {
    expect(seedOf('proving-floor')).not.toBe(seedOf('drained-works'));
    expect(hashUnit(seedOf('proving-floor'), 4, 4)).not.toBeCloseTo(
      hashUnit(seedOf('drained-works'), 4, 4), 3,
    );
  });

  it('seeds identically from an identical id', () => {
    expect(seedOf('proving-floor')).toBe(seedOf('proving-floor'));
  });
});

describe('tileTint perturbs a colour without breaking it', () => {
  it('is exactly 1 when a theme asks for no variation', () => {
    // "No grain" has to mean no grain, not a zero-width band, or a theme that
    // wants a surface left alone cannot say so.
    for (let x = 0; x < 5; x++) expect(tileTint(1, x, 0, 0)).toBe(1);
  });

  it('stays near 1, so it modulates an albedo rather than replacing it', () => {
    for (let x = 0; x < 30; x++) {
      const t = tileTint(9, x, 1, GRAIN_MAX.tint);
      expect(t).toBeGreaterThan(1 - GRAIN_MAX.tint / 255 - 1e-9);
      expect(t).toBeLessThan(1 + GRAIN_MAX.tint / 255 + 1e-9);
    }
  });

  it('never goes negative, whatever it is handed', () => {
    expect(tileTint(1, 2, 3, 10_000)).toBeGreaterThanOrEqual(0);
  });

  it('actually varies — a tint that did nothing would pass everything above', () => {
    const seen = new Set(Array.from({ length: 24 }, (_, x) => tileTint(4, x, 0, 12).toFixed(4)));
    expect(seen.size).toBeGreaterThan(18);
  });
});

describe('the ceilings keep grain under the marks that carry meaning', () => {
  it('clamps a spec that asks for too much', () => {
    const wild = clampGrain({ style: 'mottle', tint: 900, speckle: -4 });
    expect(wild.tint).toBe(GRAIN_MAX.tint);
    expect(wild.speckle).toBe(0);
  });

  it('leaves a legal spec exactly as authored', () => {
    const ok = { style: 'brushed', tint: 9, speckle: 12 } as const;
    expect(clampGrain(ok)).toEqual(ok);
  });

  it.each(ALL)('$name grains inside the ceilings', (theme) => {
    for (const kind of ['open', 'wall', 'cover', 'brush'] as const) {
      expect(theme.grain[kind].tint, `${theme.id}.${kind}`).toBeLessThanOrEqual(GRAIN_MAX.tint);
      expect(theme.grain[kind].speckle, `${theme.id}.${kind}`).toBeLessThanOrEqual(GRAIN_MAX.speckle);
    }
  });

  it('keeps a grained floor inside the tolerance isFogged allows', () => {
    // `foggedColour` is a two-point fit that `e2e/pixels.ts` matches within ±14.
    // Grain moves the floor either side of its authored value, so the swing has
    // to fit inside that slack or the fog predicate starts missing real fog.
    for (const theme of ALL) {
      const flat = foggedColour(theme.terrain.open);
      const swing = GRAIN_MAX.tint * 0.49;
      expect(swing).toBeLessThan(14);
      expect(flat.r - swing).toBeGreaterThan(0);
    }
  });

  it('centres the raster near white, so a map perturbs rather than dims', () => {
    // A `map` multiplies the material colour in three. Centred on mid-grey it
    // would halve every albedo in the theme and the palette would stop meaning
    // what it says.
    expect(GRAIN_BASE).toBeGreaterThan(230);
    expect(GRAIN_BASE).toBeLessThanOrEqual(255);
  });
});

describe('grain is achromatic, and that is load-bearing', () => {
  it('moves brightness only, leaving every hue relationship intact', () => {
    // `isRangeWash` is `b − r`, `isTeamRed` is `r − g`. Both survived MAP-THEMES
    // precisely because they test hue rather than value, and a grain that tinted
    // would put all of them back in play. `tileTint` returns one scalar applied
    // to all three channels, so this is true by construction — the test pins the
    // property rather than the implementation.
    const before = { r: 180, g: 120, b: 90 };
    const t = tileTint(2, 5, 6, GRAIN_MAX.tint);
    const after = { r: before.r * t, g: before.g * t, b: before.b * t };
    expect((after.b - after.r) / (before.b - before.r)).toBeCloseTo(t, 6);
    expect(Math.sign(after.r - after.g)).toBe(Math.sign(before.r - before.g));
  });

  it('leaves the fallback theme ungrained, so a themeless map is unchanged', () => {
    for (const kind of ['open', 'wall', 'cover', 'brush'] as const) {
      expect(FALLBACK_THEME.grain[kind].tint).toBe(0);
      expect(FALLBACK_THEME.grain[kind].speckle).toBe(0);
    }
  });
});
