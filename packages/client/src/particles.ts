/**
 * IMPACT PARTICLES — the debris a hit throws off.
 *
 * The last of the impact effects. Hitstop says a hit had *force*, the flash says
 * *who* took it, the shake says the room felt it — and none of them says
 * anything left the body. A burst of fragments does, and it is also the piece
 * that makes a big hit look different from a small one at a glance, because the
 * count and the speed scale with the damage.
 *
 * **Deterministic, seeded by the impact's own key.** No `Math.random` anywhere
 * near presentation: the same replay throws the same debris on every machine,
 * which is what lets the film harness photograph it at all and what keeps two
 * clients watching the same turn from disagreeing about what they saw. The seed
 * is the same `${unitId}@${t}` the flash and the shake already use, so all three
 * effects of one impact are siblings rather than three independent accidents.
 *
 * Pure, like `tracer.ts` and `ability-vfx.ts`. What reaches the renderer is a
 * list of positions with a size, a colour and an opacity; the renderer turns
 * them into camera-facing quads and knows nothing about why.
 */

import type { Cue } from './choreograph.js';
import type { Vec2 } from '@cards/engine';
import { seedOf } from './vfx.js';
import { areaCentre, hexColour, type Shade, type VfxTable } from './ability-vfx.js';

/** One fragment, mid-flight. */
export interface Particle {
  /** Board position, fractional. */
  x: number;
  y: number;
  /** Height above the floor, in tiles. */
  lift: number;
  /** Half-extent of the quad, in tiles. */
  size: number;
  color: number;
  opacity: number;
}

export interface ParticleSpec {
  count: number;
  /** Lifetime in BEATS, the timeline's own unit. */
  beats: number;
  /** How far a fragment travels per beat, in tiles. */
  speedTiles: number;
  size: number;
  shade: Shade;
  /**
   * How the particles MOVE, and where they are allowed to fire.
   *
   * `debris` (the default) is the ballistic hit-spray: it launches, falls under
   * gravity, and only an `impact` throws it — the language of damage.
   *
   * `drift` is cold weightless smoke (brief §5): no launch, no gravity, a slow
   * ease outward that settles and lingers. It also fires on a CAST, not only an
   * impact, so a vanish or a blink can leave smoke where the caster WAS — the
   * signature a ring cannot draw. Wisp's whole kit is drift.
   *
   * `burst` is the same ballistic spray as `debris`, but fired once at the
   * CENTRE of a DELAYED detonation's area (a grenade going off) rather than at a
   * victim — so the blast throws its fragments from the aim point, on empty
   * ground too, and never per unit it caught.
   */
  style?: 'debris' | 'drift' | 'burst';
}

/**
 * An ability that explicitly throws nothing.
 *
 * Reachable by writing `"particles": { "count": 0 }` in the table. Kept as a
 * named value because "this one deals damage and deliberately shows no debris"
 * is a real design position, and it should be sayable.
 */
export const NO_PARTICLES: ParticleSpec = { count: 0, beats: 0, speedTiles: 0, size: 0, shade: 'core', style: 'debris' };

/**
 * What every landed hit throws when the table says nothing.
 *
 * **Debris exists because something got hit, not because of who hit it.** That
 * is the same line the tracer default sits on, and for the same reason: an aura
 * is a character's identity, so absence should be visible and an unstyled
 * character gets none; debris is legibility, and "something broke here" is a
 * fact about the blow rather than about the caster's aesthetic. Defaulting it
 * off meant Vex railgunning somebody produced a flash, a shake, hitstop and a
 * tracer — and no debris — while Aegis hitting the same target for the same
 * damage threw fragments. Same event, different feedback, purely by author.
 *
 * What stays per-character is the TINT, not the existence: Aegis's fragments
 * come out in his pale, sickly green, and a character with no palette yet gets
 * a neutral one. The table's job is to override this, not to enable it.
 */
export const DEFAULT_PARTICLES: ParticleSpec = {
  count: 11, beats: 0.7, speedTiles: 1.7, size: 0.08, shade: 'core', style: 'debris',
};

/**
 * Debris for a character with no palette of their own.
 *
 * Deliberately a dull, unsaturated grit rather than anything that reads as a
 * choice. It should look like the absence of a decision — because it is one —
 * without looking like a bug.
 */
export const NEUTRAL_DEBRIS = 0xb9bcc2;

/**
 * Where a burst is thrown from, in tiles above the floor.
 *
 * Chest height rather than the ground: a hit lands on a body, and fragments
 * that start at the feet read as something coming up out of the floor.
 */
export const BURST_LIFT = 0.55;
/** How hard fragments are thrown upward, in tiles per beat. */
const LAUNCH = 1.15;
/** Downward pull, in tiles per beat squared. Tuned so debris lands, not floats. */
const GRAVITY = 2.6;

/**
 * One deterministic value in [0, 1) from a seed and an index.
 *
 * A second round of hashing rather than reusing the seed's low bits directly:
 * consecutive particle indices differ in one bit, and the raw multiply leaves
 * neighbouring fragments launching at nearly the same angle — a burst that
 * comes out as a comb rather than a spray.
 */
function unitRandom(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** How the count and speed of a burst scale with the damage that caused it. */
const REFERENCE_HIT = 30;
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
export const weightOf = (amount: number): number => clamp01(amount / REFERENCE_HIT);

/**
 * The fragments of one burst at `age` beats after it was struck.
 *
 * Exported on its own so the arc can be tested without a cue timeline. Each
 * fragment gets its own direction, its own speed and its own launch, all from
 * the seed — a burst where every piece flies at the same rate reads as a ring
 * expanding, which is what the aura already does.
 */
export function burstAt(
  spec: ParticleSpec, at: Vec2, seed: number, age: number, weight: number, color: number,
): Particle[] {
  if (spec.count <= 0 || !(spec.beats > 0)) return [];
  if (age < 0 || age >= spec.beats) return [];
  const p = age / spec.beats;
  // Fewer fragments for a graze, the full spray for a heavy hit — but never
  // none, or a shield eating most of a blow would look like nothing happened.
  const count = Math.max(1, Math.round(spec.count * (0.35 + 0.65 * weight)));
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = unitRandom(seed, i * 3) * Math.PI * 2;
    const speed = spec.speedTiles * (0.55 + 0.75 * unitRandom(seed, i * 3 + 1)) * (0.5 + 0.5 * weight);
    const launch = LAUNCH * (0.5 + unitRandom(seed, i * 3 + 2));
    const lift = BURST_LIFT + launch * age - GRAVITY * age * age;
    out.push({
      x: at.x + Math.cos(angle) * speed * age,
      y: at.y + Math.sin(angle) * speed * age,
      // Fragments stop at the floor rather than sinking through it.
      lift: Math.max(0, lift),
      size: spec.size * (1 - 0.45 * p),
      color,
      opacity: 1 - p * p,
    });
  }
  return out;
}

const spec = (raw: Partial<ParticleSpec> | undefined): ParticleSpec =>
  raw === undefined ? DEFAULT_PARTICLES : {
    count: raw.count ?? DEFAULT_PARTICLES.count,
    beats: raw.beats ?? DEFAULT_PARTICLES.beats,
    speedTiles: raw.speedTiles ?? DEFAULT_PARTICLES.speedTiles,
    size: raw.size ?? DEFAULT_PARTICLES.size,
    shade: raw.shade ?? DEFAULT_PARTICLES.shade,
    style: raw.style ?? DEFAULT_PARTICLES.style,
  };

/** How high drifting smoke hovers, in tiles — low and weightless, not chest-high. */
export const DRIFT_LIFT = 0.32;

/**
 * A slow, weightless drift of smoke — the `drift` counterpart to `burstAt`.
 *
 * The opposite motion to debris: no launch and no gravity, so nothing rises and
 * falls. Each puff eases OUTWARD and settles (fast then slowing), swells soft as
 * it thins, and lingers rather than popping — cold weightless smoke (brief §5).
 * Deterministic from the same seed, so a replay drifts identically on every
 * machine, exactly like the burst it stands in for.
 */
export function driftAt(
  spec: ParticleSpec, at: Vec2, seed: number, age: number, weight: number, color: number,
): Particle[] {
  if (spec.count <= 0 || !(spec.beats > 0)) return [];
  if (age < 0 || age >= spec.beats) return [];
  const p = age / spec.beats;
  const count = Math.max(1, Math.round(spec.count * (0.5 + 0.5 * weight)));
  const eased = 1 - (1 - p) * (1 - p);          // ease-out: quick, then settling
  const opacity = Math.min(1, p * 6) * (1 - p) * 0.8;   // appears fast, long soft fade
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = unitRandom(seed, i * 3) * Math.PI * 2;
    const reach = spec.speedTiles * spec.beats * (0.25 + 0.35 * unitRandom(seed, i * 3 + 1));
    out.push({
      x: at.x + Math.cos(angle) * reach * eased,
      y: at.y + Math.sin(angle) * reach * eased,
      // No buoyancy: it hovers low, each puff at a slightly different height, and
      // stays there — never the launch-and-fall arc a burst draws.
      lift: DRIFT_LIFT * (0.5 + unitRandom(seed, i * 3 + 2)),
      size: spec.size * (0.9 + 1.1 * p),        // swells as it dissipates
      color,
      opacity,
    });
  }
  return out;
}

/**
 * This character's particle spec for an ability.
 *
 * Falls back to `DEFAULT_PARTICLES` rather than to nothing — see the note there.
 * An ability that genuinely wants no debris says so with `count: 0`.
 */
export function particlesFor(table: VfxTable, characterId: string, abilityId: string): ParticleSpec {
  const entry = table[characterId]?.abilities[abilityId] as
    { particles?: Partial<ParticleSpec> } | undefined;
  if (entry?.particles === undefined) return DEFAULT_PARTICLES;
  return spec(entry.particles);
}

/**
 * Every fragment in the air at `t`.
 *
 * DEBRIS hangs off `impact` cues only. A heal or a shield landing is not an
 * impact — nothing was broken — and the ring the aura throws is the right
 * vocabulary for it. Debris is specifically the language of damage.
 *
 * DRIFT (`style: 'drift'`) also fires on an `ability` CAST, not only an impact:
 * a vanish or a blink leaves smoke where the caster WAS, which no ring can draw.
 * The cast is keyed and tinted by its caster (`unitId`) at full weight; an impact
 * is tinted by its caster (`sourceUnitId`) and scaled by the damage, as before.
 */
export function particlesAt(
  cues: readonly Cue[],
  t: number,
  table: VfxTable,
  characterOf: (unitId: string) => string | undefined,
  positionOf: (unitId: string) => Vec2 | undefined,
): Particle[] {
  const out: Particle[] = [];
  for (const cue of cues) {
    let characterId: string | undefined;
    let at: Vec2 | undefined;
    let weight: number;
    if (cue.kind === 'impact') {
      // The CASTER decides the tint, but not whether there is any: a hit from a
      // unit nothing is known about still broke something.
      characterId = characterOf(cue.sourceUnitId);
      at = positionOf(cue.unitId);
      weight = weightOf(cue.amount);
    } else if (cue.kind === 'ability') {
      characterId = characterOf(cue.unitId);
      at = positionOf(cue.unitId);
      weight = 1;
    } else {
      continue;
    }
    const s = characterId === undefined
      ? DEFAULT_PARTICLES
      : particlesFor(table, characterId, cue.abilityId);
    if (s.count <= 0) continue;
    const drift = s.style === 'drift';
    const burst = s.style === 'burst';
    if (cue.kind === 'ability') {
      // On a cast: smoke drifts from the caster; a burst throws from the CENTRE
      // of a delayed detonation; plain debris does neither (impacts only).
      if (drift) { /* at stays the caster */ }
      else if (burst && cue.delayed === true) at = areaCentre(cue.area);
      else continue;
    }
    if (at === undefined) continue;
    const shade = characterId === undefined ? undefined : table[characterId]?.palette[s.shade];
    const color = shade === undefined ? NEUTRAL_DEBRIS : hexColour(shade);
    // A burst is ballistic like debris — only drift eases weightlessly.
    const emit = drift ? driftAt : burstAt;
    out.push(...emit(s, at, seedOf(`${cue.unitId}@${cue.t}`), t - cue.t, weight, color));
  }
  return out;
}
