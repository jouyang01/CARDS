/**
 * JITTER — the small wrongness that stops a board looking stamped.
 *
 * Every full terrain block is centred on its tile, axis-aligned, and exactly
 * 0.96 tiles wide. A run of them is the same shape repeated at a fixed pitch,
 * and the eye is extremely good at spotting that: it reads as *tiling*, which
 * is a property of software, not of places. Real walls are laid by someone and
 * nothing is quite square.
 *
 * Deliberately tiny, and that is the whole design. This is a *readability*
 * surface: a player has to be able to tell at a glance which squares are walls,
 * because that decides where they can walk and what blocks line of sight. A
 * block rotated far enough to be obviously off-grid buys texture at the cost of
 * the one thing the board must never be ambiguous about. A couple of degrees
 * reads as "laid by hand" without ever making a tile's membership a question.
 *
 * Deterministic from the tile's own coordinates: the same board looks the same
 * on every machine and on every reload, which matters because the browser suite
 * compares frames and because a wall that shuffled when you panned would be
 * worse than one that never moved.
 *
 * Cover with a `facing` is excluded by its caller — that placement is exact and
 * load-bearing (COVER-EDGE), and nudging a barricade off the boundary it guards
 * would misreport which side is protected.
 */

/** Largest yaw, in degrees. Two: felt, not seen. */
export const JITTER_DEGREES = 2.2;
/** Largest offset, as a fraction of a tile. */
export const JITTER_OFFSET = 0.022;

/**
 * A stable value in `[-1, 1]` for a tile and a channel.
 *
 * Its own hash rather than a shared counter: neighbouring tiles must not get
 * neighbouring values, or a wall run tilts progressively like a fan instead of
 * varying.
 */
export function jitterNoise(x: number, y: number, channel: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (((h ^ (h >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}

export interface Jitter {
  /** Yaw about the vertical axis, in radians. */
  yaw: number;
  /** Offsets in tiles, on the board's two axes. */
  dx: number;
  dy: number;
}

/** The nudge for one tile. */
export function jitterFor(x: number, y: number): Jitter {
  return {
    yaw: jitterNoise(x, y, 0) * (JITTER_DEGREES * Math.PI) / 180,
    dx: jitterNoise(x, y, 1) * JITTER_OFFSET,
    dy: jitterNoise(x, y, 2) * JITTER_OFFSET,
  };
}
