/**
 * CAMERA-PAN — dragging the view across the board plane, as arithmetic.
 *
 * The owner's ask (`BACKLOG.md` CAMERA-CONTROLS) is a camera the player can
 * push around. `renderer3d.ts` had orbit and wheel-zoom but no pan, and
 * BOARD_ZOOM made that matter: the frame is deliberately tighter than the
 * board, so parts of the map are off-screen by design and a player who cannot
 * pan simply cannot look at them.
 *
 * No `three` import, so the maths is testable without a GL context — the same
 * reason `sky.ts`, `grain.ts`, `themes.ts` and `camera-ease.ts` stay
 * dependency-free. That matters more here than usual, because a pan that is
 * subtly wrong (drifting off the cursor, or inverted at some yaw) is the kind
 * of thing that feels bad long before anyone can say why.
 *
 * ---
 *
 * **The rule a pan has to obey: the board sticks to the cursor.** Grab a tile,
 * move the mouse, and that tile stays under the pointer. Anything else reads as
 * a camera being *nudged* rather than a board being *moved*, and the difference
 * is obvious immediately.
 *
 * Under an orthographic camera that is exact rather than approximate, which is
 * what makes it worth deriving properly. The camera looks at `centre` from
 * yaw/pitch with world up, so its screen axes in world space are
 *
 * ```
 *   right = ( cos yaw, 0, −sin yaw )
 *   up    = ( −sin p · sin yaw, cos p, −sin p · cos yaw )
 * ```
 *
 * A pan may only move along the board plane (y = 0), so the question is not
 * "what is the screen axis" but "which **in-plane** displacement projects onto
 * one unit of that screen axis". For screen-right the two coincide: `right`
 * already lies in the plane. For screen-up they do not, and the answer picks up
 * the `1 / sin p` that makes a shallow camera pan further per pixel than a
 * top-down one — which is just foreshortening, and exactly what the eye
 * expects. Using the projected axis directly instead would make the board lag
 * the cursor at every pitch but 90°.
 *
 * Board squares and world XZ are the same units (`squareToWorldXZ` is a pure
 * translation), so the result is in squares with no scale factor.
 */

/** Degrees to radians, kept local so this module imports nothing. */
const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * The shallowest pitch the foreshortening is allowed to see.
 *
 * The orbit reaches ~8°, where `1 / sin p` is 7.2 and still sane, but the term
 * runs to infinity as the camera approaches the horizon and a clamp costs
 * nothing. Matches the floor `clampCentre` uses for the same term, so the pan
 * and the clamp that bounds it never disagree about how deep the view is.
 */
export const MIN_PITCH_SIN = 0.2;

export interface CameraBasis {
  yawDeg: number;
  pitchDeg: number;
  /** World height of the full canvas — the orthographic frustum's height. */
  span: number;
  /** Canvas height in CSS pixels. */
  heightPx: number;
}

/**
 * How far the camera centre moves, in board squares, for a drag of
 * `(dxPx, dyPx)` CSS pixels.
 *
 * `dyPx` is in client coordinates and therefore **positive downward**. The
 * centre moves *against* the drag: the player is pushing the board, not the
 * camera, so dragging right must carry the board right, which means the frame
 * travels left.
 *
 * Returns `{ x, y }` in board-square space (`y` is the board's depth axis,
 * which is world `z`).
 */
export const panDelta = (
  dxPx: number,
  dyPx: number,
  basis: CameraBasis,
): { x: number; y: number } => {
  const yaw = rad(basis.yawDeg);
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const sinPitch = Math.max(Math.sin(rad(basis.pitchDeg)), MIN_PITCH_SIN);
  // World units per pixel. The frustum is `span` tall over `heightPx` pixels,
  // and `span * aspect` wide over `width` — the same ratio, so one number does
  // both axes and the pan cannot be anisotropic.
  const perPx = basis.span / Math.max(basis.heightPx, 1);
  // In-plane displacement for one pixel of screen-right, and of screen-up.
  const rightX = cosYaw;
  const rightY = -sinYaw;
  const upX = -sinYaw / sinPitch;
  const upY = -cosYaw / sinPitch;
  // Screen-up is −dy, and the centre moves opposite the drag, so the two
  // negations on the vertical axis cancel and it reads `+dyPx`.
  return {
    x: perPx * (-dxPx * rightX + dyPx * upX),
    y: perPx * (-dxPx * rightY + dyPx * upY),
  };
};

/**
 * Pull a camera centre back so the board never leaves the frame.
 *
 * Shared by the auto-camera and the pan, which is the point: two clamps would
 * be two chances to disagree about where the edge is, and the player would find
 * the seam by panning to it.
 *
 * **The rule is about the centre, not the frame.** It used to require the whole
 * frustum to sit inside the board rectangle, and that quietly defeated the
 * owner's ask. Since BOARD_ZOOM the frame is deliberately *tighter* than the
 * board — about 15 columns of 21 — so a centre that had to keep the frame
 * inside could only travel ±3 columns from the middle. Pointing it at a
 * character on a spawn rank moved it by one square and left the character
 * against the frame edge: the camera was still framing the board, which is
 * precisely the complaint.
 *
 * The old rule's justification has also expired. It was written when the space
 * past the last rank was black nothing, and "a band of void next to half a
 * board" was fair. That space is now a lit platform under a sky gradient, and
 * showing some of it reads as the set rather than as an error.
 *
 * So the centre may reach any square on the board and no further. The square
 * under the middle of the screen is therefore always a board square, which is
 * `BACKLOG.md`'s clamp requirement — *the board never leaves the frame
 * entirely* — stated exactly, and it lets the camera actually centre on a
 * character standing anywhere.
 *
 * `margin` tightens it back up: it is the number of squares the frame is
 * additionally asked to keep on the board, capped so it can never pull the
 * centre past the middle. 0 leaves the centre free to reach the last rank; a
 * large value restores the old frame-inside-board behaviour. `Infinity` is the
 * honest spelling of "keep the whole frame on the board if you possibly can".
 */
export const clampCentre = (
  centre: { x: number; y: number },
  span: number,
  aspect: number,
  pitchDeg: number,
  extent: { width: number; height: number },
  margin = 0,
): { x: number; y: number } => {
  const halfW = (span / 2) * aspect;
  // Depth is foreshortened on screen, so the visible run of *squares* along the
  // board's y axis is larger than the visible height by 1 / sin(pitch).
  const halfD = span / 2 / Math.max(Math.sin(rad(pitchDeg)), MIN_PITCH_SIN);
  const axis = (v: number, size: number, half: number): number => {
    const middle = (size - 1) / 2;
    // How far in from the edge the centre must stay. Never past the middle:
    // that is what makes the range symmetrical and impossible to invert, so a
    // board smaller than the frame collapses to "sit in the middle" rather than
    // handing a backwards pair to a min/max.
    const inset = Math.min(Math.max(margin, 0), half - 0.5, middle);
    return Math.min(Math.max(v, inset), size - 1 - inset);
  };
  return {
    x: axis(centre.x, extent.width, halfW),
    y: axis(centre.y, extent.height, halfD),
  };
};
