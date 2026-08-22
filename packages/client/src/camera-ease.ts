/**
 * CAMERA-EASE — the auto-camera's glide, as arithmetic.
 *
 * Split out of `renderer3d.ts` for two reasons. It needs no `three`, so it is
 * testable without a GL context; and it is the single largest source of
 * redraws on an idle board, so it is the piece that most needs a test pinning
 * its behaviour.
 *
 * **Why it mattered.** Under RENDER-ON-DEMAND the frame loop only draws when
 * something marked the scene dirty, and moving the camera marks it dirty. The
 * original ease multiplied the remaining distance by a constant *per frame*
 * and stopped at a 0.002-square threshold. That is ~60 frames of travel for a
 * typical `focusOn`, which is a fine 1.0s glide at 60fps and a **5 second**
 * one under SwiftShader at 12fps — where it was measured marking the scene
 * dirty 59 times across five seconds of an otherwise idle board. The glide was
 * not broken; it was denominated in the wrong unit.
 *
 * So the ease is **time-based**: `EASE` is still the fraction closed per
 * 1/60s, but a frame that took four times as long closes four 60ths' worth of
 * distance. A glide now takes the same wall-clock time on any machine, which
 * is both what a player wants and what stops a slow renderer from paying for
 * its own slowness twice over.
 *
 * And it **snaps**. The old threshold returned without assigning, so the
 * camera parked a hair off its target forever and the next comparison had to
 * re-derive that it was close enough. Landing exactly on the target means the
 * settled test is an exact-zero one, and a settled camera returns `undefined`
 * — no pose, no redraw, no dirty flag.
 */

/** Fraction of the remaining distance closed per 1/60 s. */
export const CAMERA_EASE = 0.14;

/**
 * Distance at which the ease stops easing and lands.
 *
 * In board squares. A square is roughly 28 screen pixels at the default
 * framing, so this is a quarter of a pixel — invisible, and it trims about ten
 * frames off the asymptotic tail where the camera is provably not moving on
 * screen but is still redrawing to prove it.
 */
export const CAMERA_SNAP = 0.01;

/** The camera state the ease acts on: where it looks, and how much it sees. */
export interface CameraPose {
  x: number;
  y: number;
  span: number;
}

/**
 * The fraction of the remaining distance to close for a frame of `delta`
 * seconds.
 *
 * `1 - (1 - EASE)^(delta * 60)` is the exponential decay that the per-frame
 * form was approximating: at exactly 60fps it returns `EASE` and the feel is
 * unchanged, and at any other rate it returns the amount that lands the camera
 * in the same place at the same moment.
 *
 * A non-positive delta (the first frame, where there is no previous timestamp)
 * falls back to one 60th's worth rather than zero, so an ease that begins on
 * frame one still begins.
 */
export const easeFactor = (delta: number): number =>
  delta > 0 ? 1 - Math.pow(1 - CAMERA_EASE, Math.min(delta, 0.1) * 60) : CAMERA_EASE;

/**
 * One frame of glide from `from` toward `to`.
 *
 * Returns the new pose, or `undefined` when the camera is already exactly on
 * target — which is the caller's signal that there is nothing to redraw. Any
 * pose it does return is one the caller must apply and mark dirty for.
 */
export const easeCamera = (
  from: CameraPose,
  to: CameraPose,
  delta: number,
): CameraPose | undefined => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ds = to.span - from.span;
  // Exact zero, not "small": `easeCamera` assigns the target on its last step,
  // so a settled camera is settled to the bit and this test cannot drift.
  if (dx === 0 && dy === 0 && ds === 0) return undefined;
  if (Math.abs(dx) < CAMERA_SNAP && Math.abs(dy) < CAMERA_SNAP && Math.abs(ds) < CAMERA_SNAP) {
    return { x: to.x, y: to.y, span: to.span };
  }
  const k = easeFactor(delta);
  return { x: from.x + dx * k, y: from.y + dy * k, span: from.span + ds * k };
};
