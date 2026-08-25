import { describe, expect, it } from 'vitest';
import { JITTER_DEGREES, JITTER_OFFSET, jitterFor, jitterNoise } from '../src/jitter.js';

/**
 * The board must never be ambiguous about which square is a wall.
 *
 * Jitter buys "laid by hand" at the cost of exactness, and the exchange rate
 * has to stay heavily in readability's favour: where a player can walk and what
 * blocks line of sight are read off these tiles. These specs are mostly bounds.
 */
describe('jitterFor', () => {
  it('JITTER-BOUNDED: never enough to make a tile\'s membership a question', () => {
    const maxYaw = (JITTER_DEGREES * Math.PI) / 180;
    for (let x = -40; x < 40; x++) {
      for (let y = -40; y < 40; y++) {
        const j = jitterFor(x, y);
        expect(Math.abs(j.yaw)).toBeLessThanOrEqual(maxYaw + 1e-12);
        expect(Math.abs(j.dx)).toBeLessThanOrEqual(JITTER_OFFSET + 1e-12);
        expect(Math.abs(j.dy)).toBeLessThanOrEqual(JITTER_OFFSET + 1e-12);
      }
    }
  });

  it('JITTER-STAYS-SMALL: the shipped limits are a nudge, not a rearrangement', () => {
    // A block rotated far enough to look obviously off-grid trades the one
    // thing this board may not be vague about for texture.
    expect(JITTER_DEGREES).toBeLessThan(5);
    expect(JITTER_OFFSET).toBeLessThan(0.05);
  });

  it('JITTER-DETERMINISTIC: the same board looks the same every reload', () => {
    // The browser suite compares frames, and a wall that shuffled when you
    // panned would be worse than one that never moved.
    expect(jitterFor(3, 7)).toEqual(jitterFor(3, 7));
  });

  it('JITTER-VARIES: neighbours are not nudged alike', () => {
    const a = jitterFor(4, 4);
    const b = jitterFor(5, 4);
    const c = jitterFor(4, 5);
    expect(a.yaw).not.toBeCloseTo(b.yaw, 4);
    expect(a.yaw).not.toBeCloseTo(c.yaw, 4);
  });

  it('JITTER-NOT-A-FAN: a run of blocks does not tilt progressively', () => {
    // A shared counter, or a hash that carries its input's ordering, tilts a
    // wall like a fan instead of varying it. The yaws along a run must not be
    // monotonic.
    const yaws = Array.from({ length: 10 }, (_, i) => jitterFor(i, 6).yaw);
    const rising = yaws.every((v, i) => i === 0 || v > yaws[i - 1]!);
    const falling = yaws.every((v, i) => i === 0 || v < yaws[i - 1]!);
    expect(rising || falling).toBe(false);
  });

  it('JITTER-AXES-INDEPENDENT: yaw, dx and dy do not move together', () => {
    // One channel reused for all three gives every block a nudge along its own
    // diagonal, which reads as a systematic skew rather than as randomness.
    const j = jitterFor(9, 2);
    expect(j.dx).not.toBeCloseTo(j.dy, 6);
  });

  it('JITTER-SPREADS: over a board, the nudges use most of their range', () => {
    const yaws: number[] = [];
    for (let x = 0; x < 18; x++) for (let y = 0; y < 15; y++) yaws.push(jitterFor(x, y).yaw);
    const maxYaw = (JITTER_DEGREES * Math.PI) / 180;
    expect(Math.max(...yaws)).toBeGreaterThan(maxYaw * 0.8);
    expect(Math.min(...yaws)).toBeLessThan(-maxYaw * 0.8);
  });

  it('JITTER-NEGATIVE-COORDS: off-board tiles do not produce NaN', () => {
    const j = jitterFor(-3, -9);
    expect(Number.isFinite(j.yaw) && Number.isFinite(j.dx) && Number.isFinite(j.dy)).toBe(true);
  });

  it('JITTER-NOISE-RANGE: the underlying noise stays in [-1, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = jitterNoise(i % 17, (i * 7) % 13, i % 3);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
