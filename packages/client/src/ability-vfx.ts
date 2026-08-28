/**
 * PER-ABILITY VFX — what a particular ability looks like, read from `data/vfx.json`.
 *
 * The point of this module is that adding or restyling an ability's effects is a
 * data edit. `vfx.ts` decides what *any* hit does — hitstop, flash, shake, the
 * things that are the same whoever threw the punch. This decides what *this*
 * ability does, and it is the seam a character's identity comes through: Aegis's
 * light is pale and effortful, and it says so in a JSON file rather than in a
 * colour constant somewhere in the renderer.
 *
 * Everything here is pure. What reaches the renderer is a list of outlines in
 * fractional board coordinates with a colour and an opacity each — the same kind
 * of thing `tracer.ts` produces — so the renderer stays a dumb applier and every
 * decision is checkable in Node.
 *
 * Presentation only: **skip == watch** holds. Nothing here can move the board.
 */

import type { Cue } from './choreograph.js';
import type { Vec2 } from '@cards/engine';
import type { Point } from './tracer.js';

/** Which of a character's three magic tones an effect is drawn in. */
export type Shade = 'core' | 'edge' | 'deep';

export interface AuraSpec {
  kind: 'ring' | 'none';
  /** Lifetime, in BEATS — the timeline's own unit, so this is frame-rate free. */
  beats: number;
  radiusTiles: number;
  shade: Shade;
}

/**
 * How a shot draws its flight.
 *
 * - `streak` — a short segment with a leading edge that crosses the gap; the
 *   default, legible for any projectile (`tracer.ts`).
 * - `beam` — a solid full-length line lit for the whole flight window: a laser.
 *   Drawn in the caster's own colour and at `beamHalfTiles` wide, so an ability
 *   can be a thin rail shot or a wide lance from data alone.
 * - `none` — a cone or a blink; nothing travels.
 */
export type TracerStyle = 'streak' | 'beam' | 'none';

export interface AbilityVfx {
  tracer: TracerStyle;
  /** Half-width of a `beam`, in tiles. Ignored for `streak`/`none`. */
  beamHalfTiles: number;
  cast: AuraSpec;
  impact: AuraSpec;
  /**
   * The flash of a DELAYED detonation (a grenade going off): drawn once at the
   * CENTRE of the ability's area, on the delayed `ability` cue — not per victim
   * (so it lands on empty ground too) and not on the throw turn (that cue is not
   * delayed). Separate from `impact` precisely so a grenade shows one blast at
   * the aim point instead of a ring on each unit it caught.
   */
  detonation: AuraSpec;
  /** Intercept: the caster does not travel, it is simply somewhere else. */
  blink: boolean;
}

export interface CharacterVfx {
  palette: Record<Shade, string>;
  warmthForbidden: boolean;
  abilities: Record<string, Partial<AbilityVfx> & {
    cast?: Partial<AuraSpec>;
    impact?: Partial<AuraSpec>;
    detonation?: Partial<AuraSpec>;
  }>;
}

/** The whole table, as it sits in `data/vfx.json`. */
export type VfxTable = Record<string, CharacterVfx>;

const NO_AURA: AuraSpec = { kind: 'none', beats: 0, radiusTiles: 0, shade: 'core' };

/**
 * What an ability with no entry in the table gets.
 *
 * **Auras default to nothing, and the tracer defaults to on.** The asymmetry is
 * the point. An aura is character identity — Aegis's pale, effortful light — and
 * a placeholder one on every unstyled ability would make the roster look
 * finished and hide which characters nobody has designed yet; absence should be
 * visible. A tracer is not identity, it is legibility: it says a shot crossed
 * the board, which is as true of Vex as of anyone, and it shipped for the whole
 * roster before this table existed. Defaulting it off would have quietly
 * deleted a feature from eight characters as the price of styling one.
 */
export const NO_VFX: AbilityVfx = { tracer: 'streak', beamHalfTiles: 0, cast: NO_AURA, impact: NO_AURA, detonation: NO_AURA, blink: false };

/** A beam with no width declared: a rifle-shot laser, thin but unmistakably lit. */
export const DEFAULT_BEAM_HALF_TILES = 0.13;

const aura = (spec: Partial<AuraSpec> | undefined): AuraSpec =>
  spec === undefined ? NO_AURA : {
    kind: spec.kind ?? 'ring',
    beats: spec.beats ?? 0.7,
    radiusTiles: spec.radiusTiles ?? 1,
    shade: spec.shade ?? 'core',
  };

/** What this character's ability looks like, with every field filled in. */
export function vfxFor(table: VfxTable, characterId: string, abilityId: string): AbilityVfx {
  const entry = table[characterId]?.abilities[abilityId];
  if (entry === undefined) return NO_VFX;
  return {
    tracer: entry.tracer ?? NO_VFX.tracer,
    beamHalfTiles: entry.beamHalfTiles ?? DEFAULT_BEAM_HALF_TILES,
    cast: aura(entry.cast),
    impact: aura(entry.impact),
    detonation: entry.detonation === undefined ? NO_AURA : aura(entry.detonation),
    blink: entry.blink ?? false,
  };
}

/** Whether an ability blinks its caster instead of walking them. */
export function blinks(table: VfxTable, characterId: string, abilityId: string): boolean {
  return vfxFor(table, characterId, abilityId).blink;
}

/** `#rrggbb` to the number Three.js wants. Unparseable is a visible magenta. */
export function hexColour(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m === null ? 0xff00ff : Number.parseInt(m[1]!, 16);
}

/**
 * Whether a colour reads as warm — the constraint Aegis's art data states and
 * nothing has been able to enforce until now (`warmthForbidden`).
 *
 * Hue alone, and only once there is enough saturation for hue to mean anything:
 * his palette is desaturated green-grey, and a near-grey has a hue the maths
 * will happily report but the eye cannot see. Reds through yellows are warm;
 * greens, cyans, blues and violets are not.
 */
export function isWarm(hex: string): boolean {
  const n = hexColour(hex);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta < 0.06) return false; // grey: no hue worth judging
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.1) return false;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return hue < 75 || hue > 330;
}

/** A ring drawn on the board: an outline with its own colour and fade. */
export interface Aura {
  outline: Point[];
  /** The ring's empty middle. Absent for a solid shape. */
  hole?: Point[];
  color: number;
  opacity: number;
}

/** How many sides approximate a ring. Enough to read as round at board scale. */
const RING_SEGMENTS = 24;

/** A closed regular polygon standing in for a circle, in board coordinates. */
export function discOutline(centre: Point, radius: number, segments = RING_SEGMENTS): Point[] {
  if (!(radius > 0) || !Number.isFinite(centre.x) || !Number.isFinite(centre.y)) return [];
  const out: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push({ x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius });
  }
  return out;
}

/** How thick a ring's band is, as a fraction of its current radius. */
export const RING_THICKNESS = 0.45;

/**
 * A **ring**, not a disc, and the difference is what the effect is for. A filled
 * circle that expands and fades reads as a wash sitting under the unit; a band
 * with a hole in it reads as something leaving them, because the empty middle
 * says the energy has already passed that point. It also stops the aura from
 * greying out the character it is supposed to be drawing attention to.
 *
 * The hole is returned separately rather than traced into one outline. Folding
 * it in — outer circle, then the inner one back the other way — is the classic
 * keyhole trick, and it was tried here first: ear clipping fills it straight in,
 * and the ring came out a disc. Three has `Shape.holes` for exactly this.
 */
export function ringOutline(centre: Point, radius: number, segments = RING_SEGMENTS): {
  outline: Point[]; hole: Point[];
} {
  const outline = discOutline(centre, radius, segments);
  if (outline.length === 0) return { outline: [], hole: [] };
  return { outline, hole: discOutline(centre, radius * (1 - RING_THICKNESS), segments) };
}

/**
 * Peak opacity of an aura.
 *
 * Raised from 0.5 on the owner's read of it in the running game: only Warding
 * Halo registered, and the reason it did is that it is the one with a big
 * radius. Everything else was technically on screen and practically invisible.
 */
export const AURA_PEAK_OPACITY = 0.85;

/**
 * How far through its life an aura stays at full strength before fading.
 *
 * The first version faded linearly from the moment it was born, which put the
 * ring at its brightest when it was at its *smallest* — a bright dot and a
 * broad ghost, and never both bright and broad. Holding the level through the
 * first half means the ring is fully lit while it is actually large enough to
 * see, and the fade then reads as it dissipating rather than as it never having
 * been there.
 */
export const AURA_HOLD = 0.55;

/**
 * The fraction of its full radius an aura is born at.
 *
 * Starting at zero spends the opening frames on something too small to register
 * — at 30fps a 0.6-beat ring is 14 frames, and the first four of them were a
 * few pixels across. Starting part-grown means it arrives already readable.
 */
export const AURA_BIRTH_RADIUS = 0.4;

/**
 * Every aura alive at `t`.
 *
 * A ring expands and fades over its `beats`, which is the cheapest shape that
 * reads as *emitted* rather than *placed* — a static disc under a unit looks
 * like a status marker, and the board already has those.
 *
 * Cast auras hang off `ability` cues and impact auras off `impact`/`benefit`
 * cues, which is the same pairing tracers use, so an ability's two ends are
 * always the two ends of one event rather than two independent effects that
 * happen to be near each other.
 */
/**
 * The centre of an ability's area, in board coordinates — the mean of its
 * squares. For a circle that is the aimed square; for any footprint it is the
 * middle of the blast. Empty area → undefined (nothing to centre on).
 */
export function areaCentre(area: readonly Vec2[] | undefined): Vec2 | undefined {
  if (area === undefined || area.length === 0) return undefined;
  let sx = 0;
  let sy = 0;
  for (const p of area) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / area.length, y: sy / area.length };
}

export function aurasAt(
  cues: readonly Cue[],
  t: number,
  table: VfxTable,
  characterOf: (unitId: string) => string | undefined,
  positionOf: (unitId: string) => Vec2 | undefined,
): Aura[] {
  const out: Aura[] = [];
  const add = (spec: AuraSpec, characterId: string, at: Vec2 | undefined, age: number): void => {
    if (spec.kind !== 'ring' || at === undefined) return;
    if (!(spec.beats > 0) || age < 0 || age >= spec.beats) return;
    const p = age / spec.beats;
    const radius = spec.radiusTiles * (AURA_BIRTH_RADIUS + (1 - AURA_BIRTH_RADIUS) * p);
    const { outline, hole } = ringOutline(at, radius);
    if (outline.length === 0) return;
    const shade = table[characterId]?.palette[spec.shade];
    if (shade === undefined) return;
    const fade = p < AURA_HOLD ? 1 : (1 - p) / (1 - AURA_HOLD);
    out.push({ outline, hole, color: hexColour(shade), opacity: AURA_PEAK_OPACITY * fade });
  };

  for (const cue of cues) {
    if (cue.kind === 'ability') {
      const characterId = characterOf(cue.unitId);
      if (characterId === undefined) continue;
      const vfx = vfxFor(table, characterId, cue.abilityId);
      if (cue.delayed === true) {
        // AoE-CENTRE: a delayed detonation flashes ONCE at the centre of its
        // area — the aim point — not at the caster and not per victim.
        add(vfx.detonation, characterId, areaCentre(cue.area), t - cue.t);
      } else {
        add(vfx.cast, characterId, positionOf(cue.unitId), t - cue.t);
      }
    } else if (cue.kind === 'impact' || cue.kind === 'benefit') {
      // Styled by the ABILITY that caused it, which means by the caster's
      // character — a heal from Aegis is Aegis's colour wherever it lands.
      const characterId = characterOf(cue.sourceUnitId);
      if (characterId === undefined) continue;
      add(vfxFor(table, characterId, cue.abilityId).impact, characterId, positionOf(cue.unitId), t - cue.t);
    }
  }
  return out;
}
