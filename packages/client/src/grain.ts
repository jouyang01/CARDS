/**
 * GRAIN — procedural surface texture, as arithmetic.
 *
 * Phase 3 of `docs/MAP_PIPELINE.md`, and the last step that needs no art. Phase
 * 1 lit the board so surfaces could have form, phase 2 gave each map its own
 * materials; both left every surface perfectly uniform, which is what makes a
 * lit box still read as plastic.
 *
 * **Two scales, because one does not do the job at this zoom.** A tile is about
 * 37 screen pixels at the default framing, so fine noise aliases into mush and
 * buys nothing. What reads is:
 *
 * 1. **Per-tile variation** — each square a shade lighter or darker than its
 *    neighbours. This is the one that stops a floor looking like a single
 *    painted plane, and it is nearly free: a hash per square, no texture at all.
 * 2. **Within-tile grain** — coarse mottle or brushing, drawn once into one
 *    tile's worth of canvas and repeated. Stone gets blotches; plate gets
 *    streaks.
 *
 * **The variation is achromatic, always.** Grain moves brightness and never hue,
 * which is not an aesthetic preference — every colour predicate in
 * `e2e/pixels.ts` that survived MAP-THEMES did so by testing a *hue*
 * relationship (`isRangeWash` is `b − r`, `isTeamRed` is `r − g`). Achromatic
 * grain leaves all of them untouched by construction. Grain that tinted would
 * put every one of them back in play.
 *
 * **No `three` import**, so the hash is testable without a GL context — and the
 * hash is the part that must never drift, since it is what makes the board look
 * identical to both teams and identical across runs.
 */

/**
 * A 2D integer hash. Deterministic, and deliberately not `Math.random()`.
 *
 * `docs/ART_PIPELINE.md` §"Seed the randomness" sets this rule for character
 * art and it applies here for the same three reasons: both teams must see the
 * same board, a screenshot must be reproducible, and the 32 Playwright pixel
 * tests compare frames. A board that reshuffled its grain per load would fail
 * all three, and the third one loudly.
 *
 * Two rounds of xorshift-multiply (the finalizer shape used by MurmurHash3),
 * which is far more mixing than a value in 0..1 needs, but costs nothing and
 * removes any question of visible structure in the output.
 */
export const hash2 = (seed: number, x: number, y: number): number => {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  return (h ^ (h >>> 16)) >>> 0;
};

/** The same hash, as a fraction in `[0, 1)`. */
export const hashUnit = (seed: number, x: number, y: number): number =>
  hash2(seed, x, y) / 4294967296;

/** A stable seed from a string, so a theme's grain follows its id. */
export const seedOf = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** How a surface is grained within one tile. */
export type GrainStyle = 'mottle' | 'brushed' | 'block';

export interface GrainSpec {
  style: GrainStyle;
  /** Per-tile brightness swing, in 0–255 counts. */
  tint: number;
  /** Within-tile grain amplitude, in 0–255 counts. */
  speckle: number;
}

/**
 * Ceilings on both amplitudes.
 *
 * Grain rides *under* every overlay the player reads, so past a point it stops
 * being surface and starts being noise competing with the marks that carry
 * meaning. The number is also what keeps the measured constants in `themes.ts`
 * inside their tolerances: `foggedColour` is a two-point fit with a ±14 slack in
 * `isFogged`, and a floor swinging by more than this would eat it.
 */
export const GRAIN_MAX = { tint: 16, speckle: 16 } as const;

/**
 * The canvas value a grain texture is centred on.
 *
 * A `map` in three **multiplies** the material colour, so a mid-grey texture
 * would halve every albedo in the theme. Centring near white keeps the authored
 * colour as the colour, with grain as a slight darkening either side of it — the
 * theme stays the source of truth and the texture only perturbs it. The residual
 * is a uniform ~3% darkening, well inside the tolerances above.
 */
export const GRAIN_BASE = 246;

/**
 * A tile's brightness multiplier — the per-tile half of the effect.
 *
 * Returns a value around 1, so it composes with an albedo by multiplication and
 * a `tint` of 0 is exactly "no variation" rather than "some variation of zero
 * width", which matters for a theme that wants a surface left alone.
 */
export const tileTint = (seed: number, x: number, y: number, tint: number): number => {
  if (tint <= 0) return 1;
  const swing = (hashUnit(seed, x, y) - 0.5) * 2 * tint;
  return Math.max(0, 1 + swing / 255);
};

/** Clamp a spec to the ceilings, so bad data degrades instead of shouting. */
export const clampGrain = (spec: GrainSpec): GrainSpec => ({
  style: spec.style,
  tint: Math.max(0, Math.min(GRAIN_MAX.tint, spec.tint)),
  speckle: Math.max(0, Math.min(GRAIN_MAX.speckle, spec.speckle)),
});
