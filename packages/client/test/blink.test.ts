import { describe, expect, it } from 'vitest';
import { BLINK_AT, isBlink, sampleFrame } from '../src/animate.js';
import type { Cue } from '../src/choreograph.js';

/**
 * INTERCEPT IS A TELEPORT, and it used to slide.
 *
 * `resolve.ts` moves the caster and emits a plain `moveStep` — the identical
 * event a walk emits — so playback interpolated it, and Aegis crossed five
 * squares of open board at walking pace. The one reading of a teleport that is
 * definitely wrong is the one that says he ran.
 */

const BEAT = 1;
const move = (t: number, unitId: string, from: [number, number], to: [number, number]): Cue =>
  ({ kind: 'move', t, dur: BEAT, unitId, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] } }) as Cue;
const displace = (t: number, unitId: string, from: [number, number], to: [number, number]): Cue =>
  ({
    kind: 'displace', t, dur: BEAT, unitId, displaceKind: 'knockback',
    from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] },
  }) as Cue;

const legOf = (c: Cue): Parameters<typeof isBlink>[0] => c as Parameters<typeof isBlink>[0];

describe('isBlink', () => {
  it('BLINK-IS-A-JUMP: a step to a square you could not walk to is a teleport', () => {
    expect(isBlink(legOf(move(0, 'a', [2, 2], [7, 2])))).toBe(true);
    expect(isBlink(legOf(move(0, 'a', [2, 2], [2, 6])))).toBe(true);
    expect(isBlink(legOf(move(0, 'a', [2, 2], [5, 5])))).toBe(true);
  });

  it('BLINK-NOT-A-STEP: orthogonal and diagonal neighbours are walked', () => {
    expect(isBlink(legOf(move(0, 'a', [2, 2], [3, 2])))).toBe(false);
    expect(isBlink(legOf(move(0, 'a', [2, 2], [2, 3])))).toBe(false);
    expect(isBlink(legOf(move(0, 'a', [2, 2], [3, 3])))).toBe(false);
  });

  it('BLINK-NOT-A-THROW: a knockback is thrown across the gap, not teleported', () => {
    // It already has its own arc and ease, and it is a thing happening TO the
    // unit rather than something they did.
    expect(isBlink(legOf(displace(0, 'a', [2, 2], [8, 2])))).toBe(false);
  });
});

describe('a blink holds, then arrives', () => {
  const cues = [move(0, 'a', [2, 5], [8, 5])];
  const where = (t: number): { x: number; y: number } => {
    const pose = sampleFrame(cues, t).poses.get('a')!;
    return { x: pose.x, y: pose.y };
  };

  it('BLINK-HOLDS: he is still at the origin while the cast plays', () => {
    expect(where(0.05)).toEqual({ x: 2, y: 5 });
    expect(where(BLINK_AT - 0.01)).toEqual({ x: 2, y: 5 });
  });

  it('BLINK-ARRIVES: and simply at the destination after', () => {
    expect(where(BLINK_AT + 0.01)).toEqual({ x: 8, y: 5 });
    expect(where(0.99)).toEqual({ x: 8, y: 5 });
  });

  it('BLINK-NEVER-BETWEEN: he is never drawn in the space he did not cross', () => {
    // The regression, stated as the thing a slide would violate: sample the
    // whole beat and assert he was only ever at one end or the other.
    for (let i = 0; i <= 100; i++) {
      const p = where(i / 100);
      expect(p.x === 2 || p.x === 8, `drawn mid-flight at x=${p.x}`).toBe(true);
    }
  });

  it('BLINK-NO-ARC: he does not hop — a teleport has no trajectory to arc along', () => {
    for (let i = 0; i <= 20; i++) expect(sampleFrame(cues, i / 20).poses.get('a')!.lift).toBe(0);
  });

  it('BLINK-ENDS-THERE: after the beat he stands at the destination', () => {
    expect(where(2)).toEqual({ x: 8, y: 5 });
  });
});

describe('a walk is untouched by any of this', () => {
  const cues = [move(0, 'a', [2, 5], [3, 5]), move(BEAT, 'a', [3, 5], [4, 5])];

  it('WALK-STILL-SLIDES: a one-tile step still interpolates, linearly', () => {
    const half = sampleFrame(cues, 0.5).poses.get('a')!;
    expect(half.x).toBeCloseTo(2.5, 9);
    const quarter = sampleFrame(cues, 0.25).poses.get('a')!;
    expect(quarter.x).toBeCloseTo(2.25, 9);
  });

  it('WALK-CONTINUOUS: consecutive steps join without a jump', () => {
    expect(sampleFrame(cues, 0.99).poses.get('a')!.x).toBeCloseTo(2.99, 6);
    expect(sampleFrame(cues, 1.01).poses.get('a')!.x).toBeCloseTo(3.01, 6);
  });
});
