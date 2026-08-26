/**
 * PROP-PLACEMENT — which prop variant sits on a tile, and how it is turned.
 *
 * Phase 5 of `docs/MAP_PIPELINE.md`, the "selection is deterministic" half. A
 * terrain tile that carries a prop (a wall → a stone pillar, cover → a wooden
 * barricade) needs to pick, per square, which variant to show and which way to
 * face it — and that pick has to be **hashed from `(mapId, x, y)`, never
 * `Math.random()`**, for the same three reasons the grain is (`grain.ts`): both
 * teams must see the identical board, a screenshot must reproduce, and the
 * Playwright pixel tests compare frames. A board that reshuffled its pillars per
 * load would fail all three.
 *
 * It reuses `grain.ts`'s hash rather than growing a second one, so there is a
 * single source of determinism on the board and no chance of two of them
 * drifting. No `three` import — this is arithmetic, and it is the arithmetic the
 * pixel tests most need pinned, so it is a Vitest test rather than something
 * only a GL context can check.
 *
 * **The read must survive the turn (§5).** Variety here is yaw and variant
 * choice, never footprint or height — those are fixed by the generator so a prop
 * is exactly as tall and wide as the box it replaces. And yaw is quantised, not
 * free: `yawSteps` says how many quarter/half turns a prop may take. A pillar is
 * radially near-symmetric so it takes any quarter-turn (`yawSteps: 4`); a
 * barricade is a fence with a facing, so it takes only a half-turn (`yawSteps:
 * 2`) or it would stand edge-on to the camera and stop reading as cover.
 */

import { hash2, seedOf } from './grain.js';

/** A salt that decorrelates the variant hash from the yaw hash, so a prop's
 *  orientation and its variant are chosen independently even when `yawSteps`
 *  and `variants` share a common factor. */
const VARIANT_SALT = 0x9e3779b9;

export interface PropPlacementOptions {
  /** Distinct meshes to choose between for this role. Defaults to 1. */
  variants?: number;
  /** How many equal turns the prop may take: 1 = fixed, 2 = 0°/180°,
   *  4 = any quarter-turn. Defaults to 1. */
  yawSteps?: number;
}

export interface PropChoice {
  /** Which variant mesh, in `[0, variants)`. */
  variant: number;
  /** Which turn, in `[0, yawSteps)` — the integer, for anyone who wants it. */
  yawTurns: number;
  /** The yaw to apply, in radians: `yawTurns * 2π / yawSteps`. */
  yawRadians: number;
}

/**
 * The deterministic prop choice for one tile.
 *
 * Pure and total: any integer tile, any options, always the same answer for the
 * same `(mapId, x, y)`. `yawSteps` and `variants` are floored at 1, so a
 * missing or nonsensical option degrades to "one mesh, never turned" rather
 * than dividing by zero.
 */
export const placeProp = (
  mapId: string,
  x: number,
  y: number,
  opts: PropPlacementOptions = {},
): PropChoice => {
  // Floor at 1, and catch NaN/±∞ too: `Math.max(1, NaN)` is NaN, which would
  // poison the modulo, so a nonsensical option must fall back to "one, fixed".
  const atLeastOne = (n: number | undefined): number =>
    Number.isFinite(n) && (n as number) >= 1 ? Math.floor(n as number) : 1;
  const seed = seedOf(mapId);
  const steps = atLeastOne(opts.yawSteps);
  const variants = atLeastOne(opts.variants);
  const yawTurns = hash2(seed, x, y) % steps;
  const variant = hash2((seed ^ VARIANT_SALT) >>> 0, x, y) % variants;
  return {
    variant,
    yawTurns,
    yawRadians: (yawTurns * 2 * Math.PI) / steps,
  };
};


/**
 * PROP-FADE — how see-through a prop is at a given camera pitch.
 *
 * The orbit reaches ~8° (`PITCH_LIMITS.min`), where a tall pillar stands
 * between the camera and half the board. Atlas Reactor solved the same problem
 * the same way: at a low angle the scenery ghosts, so a wall never hides the
 * unit behind it. This is pitch-based rather than per-occluder — the whole ask
 * is "when the camera is low, make the props transparent" — which is cheap
 * (one opacity on a shared material) and never surprises the player by fading a
 * prop they are looking straight down at.
 *
 * Opaque at and above the isometric default (35.3°) so the normal view is
 * untouched; eases to `PROP_FADE.min` — a faint ghost, not gone, so the tile
 * still reads as blocked — as the pitch drops toward the floor.
 */
export const PROP_FADE = { hi: 32, lo: 12, min: 0.18 } as const;

/** A prop's opacity at `pitchDeg`, in `[PROP_FADE.min, 1]`. */
export const propOpacity = (pitchDeg: number): number => {
  if (!(pitchDeg < PROP_FADE.hi)) return 1;          // also catches NaN → opaque
  if (pitchDeg <= PROP_FADE.lo) return PROP_FADE.min;
  const t = (pitchDeg - PROP_FADE.lo) / (PROP_FADE.hi - PROP_FADE.lo);
  return PROP_FADE.min + (1 - PROP_FADE.min) * t;
};
