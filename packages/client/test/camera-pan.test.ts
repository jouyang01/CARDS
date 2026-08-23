import { describe, expect, it } from 'vitest';
import { MIN_PITCH_SIN, clampCentre, panDelta, type CameraBasis } from '../src/camera-pan.js';

const basis = (over: Partial<CameraBasis> = {}): CameraBasis =>
  ({ yawDeg: 0, pitchDeg: 90, span: 20, heightPx: 800, ...over });

/**
 * Where a board point lands on screen, in pixels from the frame's centre.
 *
 * The inverse of what `panDelta` solves, written independently from it so the
 * round-trip below is a real check rather than the same expression twice. It is
 * the camera's screen basis (see `camera-pan.ts`) dotted with an in-plane
 * displacement.
 */
const project = (
  d: { x: number; y: number },
  b: CameraBasis,
): { x: number; y: number } => {
  const yaw = (b.yawDeg * Math.PI) / 180;
  const pitch = (b.pitchDeg * Math.PI) / 180;
  const perPx = b.span / b.heightPx;
  const right = { x: Math.cos(yaw), y: -Math.sin(yaw) };
  const up = { x: -Math.sin(pitch) * Math.sin(yaw), y: -Math.sin(pitch) * Math.cos(yaw) };
  return {
    x: (d.x * right.x + d.y * right.y) / perPx,
    // Screen up is negative client-y.
    y: -(d.x * up.x + d.y * up.y) / perPx,
  };
};

/** A handful of drags, as a typed list so destructuring keeps its numbers. */
const DRAGS = [
  { dx: 40, dy: 0 }, { dx: 0, dy: 40 }, { dx: -25, dy: 60 }, { dx: 13, dy: -47 },
];

describe('panDelta', () => {
  it('does nothing for no drag', () => {
    // By magnitude, not identity: the trig legitimately yields -0 on an axis
    // whose term is a negated zero, and -0 moves the camera exactly as far as 0.
    const d = panDelta(0, 0, basis());
    expect(Math.abs(d.x)).toBe(0);
    expect(Math.abs(d.y)).toBe(0);
  });

  /**
   * The rule the whole module exists for: the tile you grabbed stays under the
   * pointer. The camera centre moves by `panDelta`, so the board moves by the
   * opposite — and projecting that back must give the drag you made.
   */
  it('keeps the grabbed point under the cursor, at any yaw and pitch', () => {
    for (const yawDeg of [0, 37, 90, 180, 245, 359]) {
      for (const pitchDeg of [15, 35.264, 60, 90]) {
        for (const { dx, dy } of DRAGS) {
          const b = basis({ yawDeg, pitchDeg });
          const move = panDelta(dx, dy, b);
          // The board's apparent motion is the negative of the camera's.
          const seen = project({ x: -move.x, y: -move.y }, b);
          expect(seen.x, `dx at yaw ${yawDeg} pitch ${pitchDeg}`).toBeCloseTo(dx, 6);
          expect(seen.y, `dy at yaw ${yawDeg} pitch ${pitchDeg}`).toBeCloseTo(dy, 6);
        }
      }
    }
  });

  it('moves the frame against the drag, so the board follows the hand', () => {
    // Top-down at yaw 0: screen right is +x, screen up is −y.
    const right = panDelta(100, 0, basis());
    expect(right.x).toBeLessThan(0);
    const down = panDelta(0, 100, basis());
    expect(down.y).toBeLessThan(0);
  });

  it('is linear in the drag, so a fast drag covers what two slow ones do', () => {
    const b = basis({ yawDeg: 41, pitchDeg: 35 });
    const one = panDelta(30, 18, b);
    const half = panDelta(15, 9, b);
    expect(one.x).toBeCloseTo(half.x * 2, 12);
    expect(one.y).toBeCloseTo(half.y * 2, 12);
  });

  it('covers more board per pixel when zoomed out', () => {
    const near = panDelta(100, 0, basis({ span: 10 }));
    const far = panDelta(100, 0, basis({ span: 40 }));
    expect(Math.abs(far.x)).toBeCloseTo(Math.abs(near.x) * 4, 9);
  });

  it('covers more depth per pixel at a shallow pitch — that is foreshortening', () => {
    const flat = panDelta(0, 100, basis({ pitchDeg: 20 }));
    const overhead = panDelta(0, 100, basis({ pitchDeg: 90 }));
    expect(Math.abs(flat.y)).toBeGreaterThan(Math.abs(overhead.y));
  });

  it('cannot run away as the camera approaches the horizon', () => {
    // 1/sin(p) diverges at 0; the floor is what stops one pixel of drag from
    // teleporting the board.
    const grazing = panDelta(0, 100, basis({ pitchDeg: 0.0001 }));
    const floored = panDelta(0, 100, basis({ pitchDeg: (Math.asin(MIN_PITCH_SIN) * 180) / Math.PI }));
    expect(Math.abs(grazing.y)).toBeCloseTo(Math.abs(floored.y), 6);
    expect(Number.isFinite(grazing.y)).toBe(true);
  });

  it('survives a zero-height canvas instead of returning NaN', () => {
    // Boot order can hand the renderer a canvas before layout has run.
    const d = panDelta(10, 10, basis({ heightPx: 0 }));
    expect(Number.isFinite(d.x) && Number.isFinite(d.y)).toBe(true);
  });
});

describe('clampCentre', () => {
  const map = { width: 20, height: 16 };
  const clamp = (c: { x: number; y: number }, margin = 0): { x: number; y: number } =>
    clampCentre(c, 8, 1.6, 90, map, margin);

  it('leaves a centre that is already inside alone', () => {
    const middle = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
    expect(clamp(middle)).toEqual(middle);
  });

  /**
   * The rule, and the reason CAMERA-CONTROLS needed it changed: the camera has
   * to be able to look *at* a character standing on a spawn rank. Requiring the
   * whole frame to stay on the board could not do that — since BOARD_ZOOM the
   * frame is tighter than the board, so the centre could only travel a few
   * columns from the middle and "centre on the character" moved it one square.
   */
  it('lets the centre reach any square on the board', () => {
    expect(clamp({ x: 500, y: 500 })).toEqual({ x: map.width - 1, y: map.height - 1 });
    expect(clamp({ x: -500, y: -500 })).toEqual({ x: 0, y: 0 });
  });

  it('never lets the centre leave the board, so the board is always in frame', () => {
    for (const wild of [{ x: 1e9, y: -1e9 }, { x: -3, y: 40 }]) {
      const c = clamp(wild);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(map.width - 1);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(map.height - 1);
    }
  });

  it('tightens toward keeping the frame on the board as the margin grows', () => {
    const loose = clamp({ x: 500, y: 500 }).x;
    const mid = clamp({ x: 500, y: 500 }, 3).x;
    const tight = clamp({ x: 500, y: 500 }, Infinity).x;
    expect(mid).toBeLessThan(loose);
    expect(tight).toBeLessThan(mid);
  });

  it('an infinite margin is exactly the old frame-inside-board rule', () => {
    // halfW = (8 / 2) * 1.6 = 6.4, so the frame fits with 6.4 − 0.5 to spare.
    expect(clampCentre({ x: 500, y: 0 }, 8, 1.6, 90, map, Infinity).x)
      .toBeCloseTo(map.width - 0.5 - 6.4, 9);
    expect(clampCentre({ x: -500, y: 0 }, 8, 1.6, 90, map, Infinity).x)
      .toBeCloseTo(6.4 - 0.5, 9);
  });

  it('collapses to the middle rather than inverting when the board is tiny', () => {
    // A margin that wants more inset than there are squares must not hand a
    // backwards pair to a min/max.
    const tiny = { width: 3, height: 3 };
    for (const start of [{ x: -40, y: 90 }, { x: 1, y: 1 }]) {
      expect(clampCentre(start, 40, 1.6, 90, tiny, Infinity)).toEqual({ x: 1, y: 1 });
    }
  });

  it('is symmetrical: the two bounds sit the same distance from each edge', () => {
    for (const margin of [0, 2, 5, Infinity]) {
      const lo = clampCentre({ x: -999, y: 0 }, 8, 1.6, 90, map, margin).x;
      const hi = clampCentre({ x: 999, y: 0 }, 8, 1.6, 90, map, margin).x;
      expect(lo).toBeCloseTo(map.width - 1 - hi, 9);
    }
  });
});
