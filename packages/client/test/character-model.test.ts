import { describe, expect, it } from 'vitest';
import { postureRotations, type PostureSpec } from '../src/character-model.js';

/**
 * Posture is the pure, testable part of the Three.js half.
 *
 * Mixamo's auto-rigger requires a symmetric T-pose, so a character's hunch and
 * dropped shoulder cannot be baked into the mesh. Applying them as bone offsets
 * on top of the mixer is better anyway: the posture then survives idle, run,
 * dash *and* death, instead of being one pose every clip overwrites.
 */
describe('postureRotations', () => {
  const deg = (rad: number): number => (rad * 180) / Math.PI;

  it('is empty when a character declares no posture', () => {
    expect(postureRotations(undefined).size).toBe(0);
    expect(postureRotations({}).size).toBe(0);
  });

  it('spreads the hunch across the spine chain rather than creasing one joint', () => {
    const r = postureRotations({ hunchDeg: 20 });
    expect([...r.keys()]).toEqual(['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2']);
    // Each vertebra takes a share, and the shares sum to the requested angle.
    const total = [...r.values()].reduce((a, b) => a + b, 0);
    expect(deg(total)).toBeCloseTo(20);
    // Lower spine bends most — a curve, not a kink.
    expect(r.get('mixamorigSpine')!).toBeGreaterThan(r.get('mixamorigSpine2')!);
  });

  it('drops the shoulder the character actually names', () => {
    expect([...postureRotations({ dropShoulder: 'left', dropShoulderDeg: 9 }).keys()])
      .toEqual(['mixamorigLeftShoulder']);
    expect([...postureRotations({ dropShoulder: 'right', dropShoulderDeg: 9 }).keys()])
      .toEqual(['mixamorigRightShoulder']);
  });

  it('defaults to the left shoulder when a side is not given', () => {
    expect([...postureRotations({ dropShoulderDeg: 5 }).keys()]).toEqual(['mixamorigLeftShoulder']);
  });

  it('converts degrees to radians', () => {
    expect(deg(postureRotations({ headForwardDeg: 7 }).get('mixamorigNeck')!)).toBeCloseTo(7);
  });

  it('omits any part the character left at zero', () => {
    const r = postureRotations({ hunchDeg: 0, headForwardDeg: 0, dropShoulderDeg: 0 });
    expect(r.size).toBe(0);
  });

  it("builds Aegis's full posture", () => {
    const aegis: PostureSpec = {
      dropShoulder: 'left', dropShoulderDeg: 9, hunchDeg: 13, headForwardDeg: 7,
    };
    const r = postureRotations(aegis);
    expect([...r.keys()].sort()).toEqual([
      'mixamorigLeftShoulder', 'mixamorigNeck',
      'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
    ]);
    for (const v of r.values()) expect(v).toBeGreaterThan(0);
  });
});
