import { describe, expect, it } from 'vitest';
import { RIM_COLOUR, RIM_POWER, RIM_STRENGTH, isAchromatic, rimFactor } from '../src/rim.js';

describe('RIM — the unit edge light', () => {
  /**
   * The load-bearing test in this file.
   *
   * BACKLOG FOF-UNITS gives hue on a unit a job: viewer-relative friend-or-foe,
   * **self blue / ally green / foe red**, carried on a foot ring, an outline and
   * the nameplate so a mirror matchup stays readable. The rim sits in exactly
   * the place the FoF outline sits — the silhouette — so a tinted rim would be a
   * fourth colour competing for a channel that now means "whose side are they
   * on". Value only; hue is not ours to spend.
   */
  it('RIM-ACHROMATIC: carries no hue, because FoF owns hue on a unit', () => {
    expect(isAchromatic(RIM_COLOUR)).toBe(true);
  });

  it('RIM-ACHROMATIC: and the predicate can actually tell the difference', () => {
    expect(isAchromatic(0x000000)).toBe(true);
    expect(isAchromatic(0x7f7f7f)).toBe(true);
    // The three FoF hues, which is what this is guarding against.
    expect(isAchromatic(0x4f8cff)).toBe(false); // self blue
    expect(isAchromatic(0x4fd18b)).toBe(false); // ally green
    expect(isAchromatic(0xff5b4f)).toBe(false); // foe red
    // A near-miss: one channel out by one is still a tint.
    expect(isAchromatic(0x808081)).toBe(false);
  });

  it('RIM-OFF-FACING: a surface square to the viewer gets nothing', () => {
    expect(rimFactor(1)).toBe(0);
  });

  it('RIM-MAX-AT-GRAZING: a surface turned fully away gets the full strength', () => {
    expect(rimFactor(0)).toBeCloseTo(RIM_STRENGTH, 10);
  });

  it('RIM-MONOTONIC: the closer to grazing, the stronger — no bumps', () => {
    let previous = -1;
    for (let n = 1; n >= 0; n -= 0.05) {
      const v = rimFactor(n);
      expect(v).toBeGreaterThanOrEqual(previous);
      previous = v;
    }
  });

  /**
   * The exponent is the difference between an edge light and a glow, so it gets
   * a number rather than a description. At 2.8, a face within ~40° of the viewer
   * (nDotV ≈ 0.77) keeps under 8% of the rim — the front of a character is
   * untouched and only the turning edge lights.
   */
  it('RIM-STAYS-OFF-THE-BODY: under 8% of strength across the facing surface', () => {
    expect(rimFactor(Math.cos(40 * Math.PI / 180))).toBeLessThan(RIM_STRENGTH * 0.08);
    // ...and it has genuinely arrived by the time the surface is edge-on.
    expect(rimFactor(Math.cos(80 * Math.PI / 180))).toBeGreaterThan(RIM_STRENGTH * 0.5);
  });

  it('RIM-CLAMPED: nonsense dot products cannot produce nonsense light', () => {
    expect(rimFactor(2)).toBe(0);
    expect(rimFactor(-1)).toBeCloseTo(RIM_STRENGTH, 10);
    expect(Number.isFinite(rimFactor(0.5))).toBe(true);
  });

  it('RIM-SUBTLE: strength stays in the range where it separates without announcing itself', () => {
    expect(RIM_STRENGTH).toBeGreaterThan(0.1);
    expect(RIM_STRENGTH).toBeLessThan(0.6);
    expect(RIM_POWER).toBeGreaterThan(1.5);
  });
});

describe('RIM — the shader and the curve are the same curve', () => {
  /**
   * `rimFactor` is pinned above, but `rimFactor` is not what runs on screen: the
   * GPU runs `RIM_GLSL`. Nothing stops the two drifting except this — which is
   * the exact failure mode `docs/CHARACTER_PLAYBOOK.md` §5 names, a pure module
   * that is perfectly correct and not what ships.
   */
  it('RIM-GLSL-FROM-CONSTANTS: the emitted shader carries rim.ts numbers, not literals', async () => {
    const { RIM_GLSL } = await import('../src/renderer3d.js');
    expect(RIM_GLSL).toContain(RIM_POWER.toFixed(4));
    expect(RIM_GLSL).toContain(RIM_STRENGTH.toFixed(4));
    // White, as three channels of 1.0 — the achromaticity, as it reaches the GPU.
    expect(RIM_GLSL).toContain('vec3( 1.0000, 1.0000, 1.0000 )');
    // And it reads the two things the injection point actually provides.
    expect(RIM_GLSL).toContain('vViewPosition');
    expect(RIM_GLSL).toContain('normal');
    expect(RIM_GLSL).toContain('totalEmissiveRadiance +=');
  });
});
