import { describe, expect, it } from 'vitest';
import { ambientEnabled, modelsEnabled, renderOnDemand } from '../src/render-flags.js';

/**
 * AMBIENT-FREEZE — the guard shipped before the hazard.
 *
 * Nothing in the client moves decoratively yet. This exists so that when
 * something does, `render.spec.ts`'s byte-identical frame comparisons keep
 * working — and, more to the point, so nobody has to first debug a scenery bug
 * disguised as an aiming bug.
 */

describe('ambient motion runs by default', () => {
  it('is on for an ordinary page with nothing asked of it', () => {
    // The default has to be *on*: a player with no query string and no
    // accessibility preference is the case phase 5 exists for.
    expect(ambientEnabled()).toBe(true);
    expect(ambientEnabled({ search: '' })).toBe(true);
    expect(ambientEnabled({ search: '?map=iron-basin' })).toBe(true);
  });

  it('stays on for an unrelated value, rather than failing closed', () => {
    expect(ambientEnabled({ search: '?ambient=on' })).toBe(true);
    expect(ambientEnabled({ search: '?ambient=please' })).toBe(true);
  });
});

describe('three ways to ask for stillness', () => {
  it('honours ?ambient=off — what the browser suite uses', () => {
    expect(ambientEnabled({ search: '?ambient=off' })).toBe(false);
    expect(ambientEnabled({ search: 'ambient=off' })).toBe(false);
  });

  it('accepts the obvious spellings of off', () => {
    for (const v of ['off', 'none', '0', 'false', 'OFF', ' Off ']) {
      expect(ambientEnabled({ search: `?ambient=${v}` }), v).toBe(false);
    }
  });

  it('honours prefers-reduced-motion, which outranks the query', () => {
    // Ambient motion is decoration by definition, so it is precisely what that
    // setting exists to suppress. A viewer who asked their OS for stillness
    // should not have it overridden by a link someone sent them.
    expect(ambientEnabled({ reducedMotion: true })).toBe(false);
    expect(ambientEnabled({ search: '?ambient=on', reducedMotion: true })).toBe(false);
  });

  it('keeps other query parameters intact alongside it', () => {
    expect(ambientEnabled({ search: '?map=iron-basin&ambient=off&format=4v4' })).toBe(false);
    expect(ambientEnabled({ search: '?map=iron-basin&format=4v4' })).toBe(true);
  });
});

describe('the decision is pure, so it can be trusted before it is used', () => {
  it('reads nothing but what it is handed', () => {
    const env = { search: '?ambient=off', reducedMotion: false };
    expect(ambientEnabled(env)).toBe(ambientEnabled(env));
    expect(ambientEnabled({ ...env, search: '' })).toBe(true);
  });
});

describe('MODEL-FREEZE keeps the board suite on the renderer it was written for', () => {
  it('loads models by default — a player gets the characters', () => {
    expect(modelsEnabled()).toBe(true);
    expect(modelsEnabled({ search: '?map=iron-basin' })).toBe(true);
  });

  it('honours ?models=off, which the browser suite sets', () => {
    for (const v of ['off', 'none', '0', 'false', 'OFF']) {
      expect(modelsEnabled({ search: `?models=${v}` }), v).toBe(false);
    }
  });

  it('is independent of the ambient switch', () => {
    // Two different hazards: one is motion, one is an asset arriving late. A
    // test may well want to freeze one and not the other.
    expect(modelsEnabled({ search: '?ambient=off' })).toBe(true);
    expect(ambientEnabled({ search: '?models=off' })).toBe(true);
  });

  it('ignores reduced-motion — a still model is still a model', () => {
    // Unlike ambient motion, a character mesh is not decoration; suppressing it
    // for an accessibility preference would remove content, not calm it.
    expect(modelsEnabled({ reducedMotion: true })).toBe(true);
  });
});

describe('RENDER-ON-DEMAND is the default, and can be turned back off', () => {
  it('is on unless explicitly opted out of', () => {
    // Earned, not assumed. The first attempt at this default measured 17 idle
    // frames against always-render's 14 and was correctly left off; the ease in
    // `camera-ease.ts` was requesting those frames. With that fixed the number
    // is 0, and nine board-heavy browser tests run 5.6m -> 1.6m.
    expect(renderOnDemand()).toBe(true);
    expect(renderOnDemand({ search: '?map=iron-basin' })).toBe(true);
    expect(renderOnDemand({ search: '?render=ondemand' })).toBe(true);
  });

  it('opts out on ?render=always, which is how a missed markDirty is diagnosed', () => {
    expect(renderOnDemand({ search: '?render=always' })).toBe(false);
    expect(renderOnDemand({ search: '?map=duel-arena&render=always' })).toBe(false);
    // The `ambient=off` vocabulary, for consistency across the three flags.
    for (const value of ['off', 'none', '0', 'false']) {
      expect(renderOnDemand({ search: `?render=${value}` })).toBe(false);
    }
  });

  it('keeps the default on a value it does not recognise', () => {
    // A typo in a debug flag must not silently restore a 3.3 fps board.
    expect(renderOnDemand({ search: '?render=alwyas' })).toBe(true);
    expect(renderOnDemand({ search: '?render=' })).toBe(true);
  });

  it('ignores reduced-motion — skipping redundant frames is not motion', () => {
    expect(renderOnDemand({ reducedMotion: true })).toBe(true);
  });
});
