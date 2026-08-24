/**
 * AMBIENT-MOTION — the decorative motion the map runs when nothing is happening,
 * as arithmetic.
 *
 * Phase 5 of `docs/MAP_PIPELINE.md`, and the first thing on the board that moves
 * without a player moving it. Everything before this was still: a lit box, a
 * theme, a grain, a settled camera. A map with life is one that breathes when
 * the turn is being planned, and this is the smallest honest start on that.
 *
 * **Why this has no `three` import.** Same reason `sky.ts`, `grain.ts` and
 * `camera-ease.ts` stay dependency-free: the part that must never drift is the
 * curve, and a curve with no GL context is one a Vitest test can pin exactly.
 * The renderer imports this and applies the number to a material; the number
 * itself is decided here where it can be checked.
 *
 * **The one rule that makes it safe to ship at all.** `docs/MAP_PIPELINE.md` §4
 * ("Anything lit that stays on screen must be dim") records that every colour
 * family `e2e/pixels.ts` counts gates on a channel above 130, and that a bright
 * permanent fixture lands inside one of them and quietly satisfies a gameplay
 * assertion — worst of all the `isTeamRed === 0` hidden-information guard. The
 * arena rim is tuned to sit *under* that gate at its static intensity. So the
 * breath is built to never brighten past that static value: its lit extreme is
 * exactly today's tested-safe rim, and it only ever dips darker and returns.
 * The pulse cannot cross a gate the static rim already clears.
 *
 * That also makes the frozen state (`?ambient=off`, which every browser test
 * uses, and which a reduced-motion viewer gets) identical to today to the bit:
 * the curve is 1 at `elapsed = 0`, so a rim left un-animated and a rim on its
 * first ambient frame hold the same value, and there is no pop when motion
 * begins.
 */

/** The breath's shape, as the two numbers that decide how it reads. */
export const RIM_BREATH = {
  /** Seconds for one full dim-and-return. Slow enough to read as atmosphere,
   *  not as a signal — a status pip pulses in well under a second. */
  period: 5,
  /** How far the intensity dips below its base, as a fraction. At 0.28 the rim
   *  falls to 72% of full and comes back; visible as life, nowhere near dark. */
  depth: 0.28,
} as const;

/**
 * The rim's emissive intensity at `elapsed` seconds, given its static `base`.
 *
 * A raised cosine, phased so it starts at the top: `cos(0) = 1` puts the factor
 * at exactly 1, so the first frame equals `base` and equals the frozen rim.
 * From there it eases down to `base * (1 - depth)` at the half-period and back,
 * never above `base`. Never below zero either — `depth` is well under 1 — so a
 * caller can hand the result straight to a material without clamping.
 */
export const rimBreath = (base: number, elapsed: number): number => {
  const dip = (1 - Math.cos((2 * Math.PI * elapsed) / RIM_BREATH.period)) / 2; // 0..1
  return base * (1 - RIM_BREATH.depth * dip);
};
