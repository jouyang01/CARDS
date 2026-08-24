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
import { hexColour, type Shade, type VfxTable } from './ability-vfx.js';

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
}

export const NO_PARTICLES: ParticleSpec = { count: 0, beats: 0, speedTiles: 0, size: 0, shade: 'core' };

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
  raw === undefined ? NO_PARTICLES : {
    count: raw.count ?? 10,
    beats: raw.beats ?? 0.7,
    speedTiles: raw.speedTiles ?? 1.6,
    size: raw.size ?? 0.09,
    shade: raw.shade ?? 'core',
  };

/** This character's particle spec for an ability, or none. */
export function particlesFor(table: VfxTable, characterId: string, abilityId: string): ParticleSpec {
  const entry = table[characterId]?.abilities[abilityId] as
    { particles?: Partial<ParticleSpec> } | undefined;
  return entry === undefined ? NO_PARTICLES : spec(entry.particles);
}

/**
 * Every fragment in the air at `t`.
 *
 * Hangs off `impact` cues only. A heal or a shield landing is not an impact —
 * nothing was broken — and the ring the aura throws is the right vocabulary for
 * it. Debris is specifically the language of damage.
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
    if (cue.kind !== 'impact') continue;
    const characterId = characterOf(cue.sourceUnitId);
    if (characterId === undefined) continue;
    const s = particlesFor(table, characterId, cue.abilityId);
    if (s.count <= 0) continue;
    const at = positionOf(cue.unitId);
    if (at === undefined) continue;
    const shade = table[characterId]?.palette[s.shade];
    if (shade === undefined) continue;
    out.push(...burstAt(
      s, at, seedOf(`${cue.unitId}@${cue.t}`), t - cue.t, weightOf(cue.amount), hexColour(shade),
    ));
  }
  return out;
}
