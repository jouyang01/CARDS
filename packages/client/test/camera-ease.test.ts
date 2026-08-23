import { describe, expect, it } from 'vitest';
import { cameraEaseFor } from '../src/renderer3d.js';

/**
 * The auto-camera settles in a number of SECONDS, not a number of frames.
 *
 * It used to close a fixed fraction of the remaining distance per frame, which
 * makes the settling time a function of the frame rate: ~0.7s at 60fps, and
 * ~30s at the ~3.3fps this scene manages under SwiftShader. A camera still
 * creeping is a scene still changing, so the board redrew continuously, and
 * every `page.screenshot` in the browser suite waited ~2.2s for a frame instead
 * of ~0.17s. Seventeen of thirty-four tests timed out on that alone.
 */
describe('cameraEaseFor', () => {
  const FRAME_60 = 1 / 60;
  /** The per-frame constant the ease is authored against. */
  const AUTHORED = 0.14;

  it('EASE-60FPS-UNCHANGED: one frame at 60fps is exactly the authored constant', () => {
    expect(cameraEaseFor(FRAME_60)).toBeCloseTo(AUTHORED, 12);
  });

  it('EASE-SAME-SECONDS: the same elapsed time closes the same distance at any frame rate', () => {
    // A second of easing, taken in one lump, in 60 steps, and in 3 steps.
    const remainingAfter = (steps: number): number => {
      const dt = 1 / steps;
      let left = 1;
      for (let i = 0; i < steps; i++) left *= 1 - cameraEaseFor(dt);
      return left;
    };
    const oneShot = remainingAfter(1);
    expect(remainingAfter(60)).toBeCloseTo(oneShot, 9);
    expect(remainingAfter(3)).toBeCloseTo(oneShot, 9);
    expect(remainingAfter(240)).toBeCloseTo(oneShot, 9);
  });

  it('EASE-SETTLES-IN-SECONDS: a 3fps scene is inside the deadband in about a second', () => {
    // The regression: at 3.3fps the old per-frame ease needed ~100 frames — half
    // a minute — to cross 0.002 of its starting distance. Sixteen tests never
    // waited that long, so the board never stopped redrawing under them.
    const dt = 1 / 3.3;
    let left = 1;
    let seconds = 0;
    while (left > 0.002 && seconds < 10) {
      left *= 1 - cameraEaseFor(dt);
      seconds += dt;
    }
    expect(seconds, 'a 3.3fps camera must settle in seconds, not half a minute').toBeLessThan(2);
  });

  it('EASE-60FPS-STILL-SETTLES-IN-SECONDS: and 60fps is unchanged in wall-clock terms', () => {
    let left = 1;
    let seconds = 0;
    while (left > 0.002 && seconds < 10) {
      left *= 1 - cameraEaseFor(FRAME_60);
      seconds += FRAME_60;
    }
    expect(seconds).toBeLessThan(2);
  });

  it('EASE-NEVER-OVERSHOOTS: a long stall lands on the target rather than past it', () => {
    // A backgrounded tab or a paused debugger hands back a huge delta. Closing
    // more than all of the distance would sail past and ease back.
    for (const dt of [0.5, 1, 10, 600]) expect(cameraEaseFor(dt)).toBeLessThanOrEqual(1);
    expect(cameraEaseFor(600)).toBeGreaterThan(0.99);
  });

  it('EASE-NO-TIME-NO-MOVE: a zero or absent delta moves the camera not at all', () => {
    expect(cameraEaseFor(0)).toBe(0);
    expect(cameraEaseFor(-1)).toBe(0);
    expect(cameraEaseFor(Number.NaN)).toBe(0);
  });

  it('EASE-MONOTONIC: more elapsed time never closes less distance', () => {
    let previous = 0;
    for (const dt of [0.001, 0.005, FRAME_60, 0.05, 0.1, 0.3, 1]) {
      const k = cameraEaseFor(dt);
      expect(k).toBeGreaterThanOrEqual(previous);
      previous = k;
    }
  });
});
