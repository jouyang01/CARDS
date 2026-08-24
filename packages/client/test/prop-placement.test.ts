import { describe, expect, it } from 'vitest';
import { placeProp } from '../src/prop-placement.js';

describe('placeProp', () => {
  it('is deterministic — same tile, same answer, forever', () => {
    const a = placeProp('proving-floor', 5, 7, { yawSteps: 4, variants: 3 });
    const b = placeProp('proving-floor', 5, 7, { yawSteps: 4, variants: 3 });
    expect(a).toEqual(b);
  });

  it('differs by map, so two maps do not share a pillar layout', () => {
    const a = placeProp('proving-floor', 5, 7, { yawSteps: 4 });
    const b = placeProp('drained-works', 5, 7, { yawSteps: 4 });
    // Not a guarantee for every tile, but the map id must reach the hash — check
    // that *some* tile in a small block differs.
    const differs = Array.from({ length: 25 }, (_, i) =>
      placeProp('proving-floor', i % 5, (i / 5) | 0, { yawSteps: 4 }).yawTurns
        !== placeProp('drained-works', i % 5, (i / 5) | 0, { yawSteps: 4 }).yawTurns);
    expect(differs.some(Boolean), 'the map id must change the layout').toBe(true);
    void a; void b;
  });

  it('keeps yaw inside [0, yawSteps) and lands on exact equal turns', () => {
    for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) {
      const c = placeProp('proving-floor', x, y, { yawSteps: 4 });
      expect(c.yawTurns).toBeGreaterThanOrEqual(0);
      expect(c.yawTurns).toBeLessThan(4);
      expect(c.yawRadians).toBeCloseTo((c.yawTurns * Math.PI) / 2, 12);
    }
  });

  it('a fence takes only a half-turn — never edge-on', () => {
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) {
      const c = placeProp('proving-floor', x, y, { yawSteps: 2 });
      expect([0, 1]).toContain(c.yawTurns);
      expect([0, Math.PI]).toContainEqual(c.yawRadians);
    }
  });

  it('a fixed prop is never turned', () => {
    const c = placeProp('proving-floor', 3, 9, {});
    expect(c).toEqual({ variant: 0, yawTurns: 0, yawRadians: 0 });
  });

  it('degrades a nonsensical yawSteps/variants to 1 rather than dividing by zero', () => {
    for (const bad of [0, -3, NaN]) {
      const c = placeProp('m', 1, 1, { yawSteps: bad, variants: bad });
      expect(Number.isFinite(c.yawRadians)).toBe(true);
      expect(c.variant).toBe(0);
      expect(c.yawTurns).toBe(0);
    }
  });

  it('picks yaw and variant independently — orientation is not glued to variant', () => {
    // With shared factors (4 and 2) a naive single-hash split would correlate
    // them. Across a block, both should vary and not move in lockstep.
    const seenPairs = new Set<string>();
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
      const c = placeProp('proving-floor', x, y, { yawSteps: 4, variants: 2 });
      seenPairs.add(`${c.variant}:${c.yawTurns}`);
    }
    // 2 variants × 4 turns = 8 possible pairs; a correlated hash would produce
    // far fewer. Expect most of them to appear.
    expect(seenPairs.size).toBeGreaterThanOrEqual(6);
  });

  it('spreads turns roughly evenly across a board, not all one way', () => {
    const counts = [0, 0, 0, 0];
    for (let x = 0; x < 30; x++) for (let y = 0; y < 30; y++) {
      const t = placeProp('proving-floor', x, y, { yawSteps: 4 }).yawTurns;
      counts[t] = (counts[t] ?? 0) + 1;
    }
    // 900 tiles / 4 ≈ 225 each; a uniform hash stays well inside a loose band.
    for (const n of counts) expect(n).toBeGreaterThan(150);
  });
});
