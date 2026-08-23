import { describe, expect, it } from 'vitest';
import { CAMERA_EASE, CAMERA_SNAP, easeCamera, easeFactor, type CameraPose } from '../src/camera-ease.js';

const pose = (x: number, y: number, span: number): CameraPose => ({ x, y, span });

/** Run the ease to rest, returning how many frames and how long it took. */
const glide = (
  from: CameraPose,
  to: CameraPose,
  delta: number,
  limit = 100_000,
): { frames: number; seconds: number; final: CameraPose } => {
  let live = from;
  let frames = 0;
  for (;;) {
    const next = easeCamera(live, to, delta);
    if (next === undefined) break;
    live = next;
    frames += 1;
    if (frames > limit) throw new Error('ease did not converge');
  }
  return { frames, seconds: frames * delta, final: live };
};

describe('easeFactor', () => {
  it('is exactly the per-frame constant at 60fps', () => {
    expect(easeFactor(1 / 60)).toBeCloseTo(CAMERA_EASE, 12);
  });

  it('closes more distance on a longer frame', () => {
    expect(easeFactor(1 / 30)).toBeGreaterThan(easeFactor(1 / 60));
    expect(easeFactor(1 / 120)).toBeLessThan(easeFactor(1 / 60));
  });

  it('never closes more than all of it, even on a stalled frame', () => {
    for (const delta of [0.1, 1, 30]) {
      expect(easeFactor(delta)).toBeLessThanOrEqual(1);
      expect(easeFactor(delta)).toBeGreaterThan(0);
    }
  });

  it('falls back to one frame-s worth when there is no previous timestamp', () => {
    expect(easeFactor(0)).toBe(CAMERA_EASE);
    expect(easeFactor(-1)).toBe(CAMERA_EASE);
  });
});

describe('easeCamera', () => {
  it('reports nothing to do when already on target', () => {
    expect(easeCamera(pose(3, 4, 20), pose(3, 4, 20), 1 / 60)).toBeUndefined();
  });

  it('lands exactly on the target, so the settled test is exact', () => {
    const { final } = glide(pose(0, 0, 30), pose(7, 5, 12), 1 / 60);
    expect(final).toEqual(pose(7, 5, 12));
    // ...and the very next step is therefore a no-op, not another almost-step.
    expect(easeCamera(final, pose(7, 5, 12), 1 / 60)).toBeUndefined();
  });

  it('snaps rather than crawling once inside a quarter-pixel', () => {
    const near = pose(7 - CAMERA_SNAP / 2, 5, 12);
    expect(easeCamera(near, pose(7, 5, 12), 1 / 60)).toEqual(pose(7, 5, 12));
  });

  it('moves toward the target and never overshoots it', () => {
    let live = pose(0, 0, 30);
    const target = pose(7, 5, 12);
    for (let i = 0; i < 200; i++) {
      const next = easeCamera(live, target, 1 / 60);
      if (next === undefined) break;
      expect(next.x).toBeGreaterThan(live.x - 1e-9);
      expect(next.x).toBeLessThanOrEqual(target.x);
      expect(next.span).toBeLessThan(live.span + 1e-9);
      expect(next.span).toBeGreaterThanOrEqual(target.span);
      live = next;
    }
  });

  /**
   * The regression this module exists for. The ease used to close a fixed
   * fraction *per frame*, so a renderer running at a fifth of 60fps took five
   * times as long to settle — and under RENDER-ON-DEMAND every one of those
   * frames was a redraw the ease itself had requested. Measured on an idle
   * board under SwiftShader: 59 camera redraws across five seconds.
   */
  it('takes the same wall time to settle at any frame rate', () => {
    const from = pose(0, 0, 30);
    const to = pose(7, 5, 12);
    const fast = glide(from, to, 1 / 60);
    const slow = glide(from, to, 1 / 12);
    const crawl = glide(from, to, 0.1);

    expect(fast.seconds).toBeGreaterThan(0.4);
    expect(fast.seconds).toBeLessThan(1.6);
    for (const run of [slow, crawl]) {
      expect(run.seconds).toBeGreaterThan(fast.seconds * 0.6);
      expect(run.seconds).toBeLessThan(fast.seconds * 1.6);
    }
    // The frame *counts* differ by the frame-rate ratio; that is the point.
    expect(slow.frames).toBeLessThan(fast.frames / 2);
    expect(crawl.frames).toBeLessThan(20);
  });

  it('settles a typical focusOn in far fewer frames than the old ease did', () => {
    // The old form: a constant fraction per frame down to a 0.002 threshold.
    let d = 20;
    let oldFrames = 0;
    while (Math.abs(d) >= 0.002) {
      d *= 1 - CAMERA_EASE;
      oldFrames += 1;
    }
    expect(oldFrames).toBeGreaterThan(55); // ~62 — the measured 59 marks

    const slow = glide(pose(0, 0, 30), pose(0, 0, 10), 1 / 12);
    expect(slow.frames).toBeLessThan(oldFrames / 3);
  });
});
