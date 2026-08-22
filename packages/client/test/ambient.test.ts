import { describe, expect, it } from 'vitest';
import { ambientEnabled } from '../src/ambient.js';

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
