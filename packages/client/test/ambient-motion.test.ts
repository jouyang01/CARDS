import { describe, expect, it } from 'vitest';
import { RIM_BREATH, rimBreath } from '../src/ambient-motion.js';

describe('rimBreath', () => {
  const base = 0.85; // SCENERY.rim.emissive

  it('equals the base at t=0, so the frozen rim and the first ambient frame match', () => {
    // The whole safety argument rests on this: ?ambient=off leaves the material
    // at `base`, and the first animated frame must be `base` too or there is a
    // visible pop the moment motion is allowed.
    expect(rimBreath(base, 0)).toBeCloseTo(base, 12);
  });

  it('never rises above the base — the lit extreme is exactly the tested rim', () => {
    // MAP_PIPELINE §4: the static rim is tuned under the e2e's 130 brightness
    // gate. A breath that peaked above `base` could cross it; this one cannot.
    for (let t = 0; t <= 3 * RIM_BREATH.period; t += RIM_BREATH.period / 97) {
      expect(rimBreath(base, t)).toBeLessThanOrEqual(base + 1e-9);
    }
  });

  it('dips to exactly base*(1-depth) at the half-period and returns', () => {
    expect(rimBreath(base, RIM_BREATH.period / 2)).toBeCloseTo(base * (1 - RIM_BREATH.depth), 12);
    expect(rimBreath(base, RIM_BREATH.period)).toBeCloseTo(base, 12);
  });

  it('stays strictly positive, so a material never needs clamping', () => {
    for (let t = 0; t <= 2 * RIM_BREATH.period; t += 0.05) {
      expect(rimBreath(base, t)).toBeGreaterThan(0);
    }
  });

  it('is periodic with `period`', () => {
    for (const t of [0.3, 1.1, 2.7, 4.9]) {
      expect(rimBreath(base, t)).toBeCloseTo(rimBreath(base, t + RIM_BREATH.period), 10);
    }
  });

  it('scales with the base, so a dimmer rim breathes proportionally', () => {
    expect(rimBreath(0.4, RIM_BREATH.period / 2)).toBeCloseTo(0.4 * (1 - RIM_BREATH.depth), 12);
    expect(rimBreath(0, 1.3)).toBe(0);
  });
});
