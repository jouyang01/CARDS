/**
 * TRACERS — the flight between a shot and the thing it hits.
 *
 * A hit currently teleports. The ability plays, and a beat later the victim
 * flashes, with nothing crossing the gap: two events that the player has to
 * infer are connected. A tracer is that connection drawn — the line of travel
 * during the window the timeline already reserves between a cast and its impact.
 *
 * Nothing new is invented for it. `choreograph.ts` puts an `ability` cue at `t`
 * and binds its impacts to `sourceUnitId` at the end of that beat, precisely so
 * a hit belongs to the ability that caused it (A0). That binding is the flight
 * window; this module reads it rather than inventing a parallel schedule.
 *
 * The geometry is here, not in the renderer, and that is deliberate. What
 * reaches the renderer is a quad in fractional board coordinates — the same
 * thing `drawShape` already takes for an AoE footprint — so a tracer costs no
 * new drawing primitive, and every decision about where the streak is and how
 * long it should be is arithmetic a Node test can check.
 *
 * Presentation only, like the rest of `vfx.ts`: a tracer cannot move the board,
 * so **skip == watch** holds.
 */

import type { Cue } from './choreograph.js';
import type { Vec2 } from '@cards/engine';

/** A point on the board between squares — what `drawShape` consumes. */
export interface Point {
  x: number;
  y: number;
}

/** One shot in flight at a given moment. */
export interface Tracer {
  /** Stable per (source, victim, cue time), so a caller can key state off it. */
  key: string;
  fromUnitId: string;
  toUnitId: string;
  abilityId: string;
  /**
   * What is travelling. A hit and a heal cross the same distance and should not
   * look the same doing it; the per-ability VFX table will style them, and until
   * it exists this is what lets the two be told apart at all.
   */
  kind: 'impact' | 'benefit';
  /** How far along the flight, 0..1. */
  progress: number;
}

/**
 * The flight window for each impact and benefit: when its ability fired, and
 * when it lands.
 *
 * Bound by `sourceUnitId` **and** `abilityId`, and to the LATEST qualifying cast
 * rather than the first. A unit with two abilities in one phase has two windows,
 * and matching on the actor alone would draw the second shot leaving at the time
 * of the first — a tracer that starts before the gun does.
 *
 * A landing with no matching cast gets no window and no tracer, which is right:
 * a trap going off, or chip damage nobody fired, is not something that flew.
 */
function castOf(cues: readonly Cue[], sourceUnitId: string, abilityId: string, landsAt: number): number | undefined {
  let best: number | undefined;
  for (const cue of cues) {
    if (cue.kind !== 'ability') continue;
    if (cue.unitId !== sourceUnitId || cue.abilityId !== abilityId) continue;
    if (cue.t > landsAt) continue;
    if (best === undefined || cue.t > best) best = cue.t;
  }
  return best;
}

/**
 * Every tracer in flight at `t`.
 *
 * Half-open on both ends. At the moment of the cast there is nothing to see yet,
 * and at the moment of impact the tracer's job passes to the flash — leaving it
 * on for the landing frame would draw a line into a unit that is already lit,
 * which reads as the shot stopping short.
 */
export function tracersAt(cues: readonly Cue[], t: number): Tracer[] {
  const out: Tracer[] = [];
  for (const cue of cues) {
    if (cue.kind !== 'impact' && cue.kind !== 'benefit') continue;
    // Nothing travels from a unit to itself. Self-shields and self-heals are
    // real and common (Aegis's own kit), and a zero-length streak is a dot of
    // colour on top of the caster that says nothing.
    if (cue.sourceUnitId === cue.unitId) continue;
    const from = castOf(cues, cue.sourceUnitId, cue.abilityId, cue.t);
    if (from === undefined || cue.t <= from) continue;
    if (t <= from || t >= cue.t) continue;
    out.push({
      key: `${cue.sourceUnitId}>${cue.unitId}@${cue.t}`,
      fromUnitId: cue.sourceUnitId,
      toUnitId: cue.unitId,
      abilityId: cue.abilityId,
      kind: cue.kind,
      progress: (t - from) / (cue.t - from),
    });
  }
  return out;
}

/**
 * How much of the flight the streak covers behind its leading edge.
 *
 * Tuned against a filmed Blast rather than guessed. At 0.9 tiles and a half
 * width of 0.055 the streak measured 9x46 screen pixels — legible in a
 * difference image and essentially invisible to a player watching the board.
 */
export const STREAK_TILES = 1.35;
/** Half-width of the streak, in tiles. A shot, not a road — but a visible one. */
export const STREAK_HALF_WIDTH = 0.11;
/**
 * How far from the caster the streak begins.
 *
 * A unit is about a tile wide on the board and stands a good deal taller, so a
 * line starting at its centre spends its first half-tile *inside* the model —
 * filmed, the tracer emerged from Aegis's waist and was cut in half by his own
 * legs. Starting clear of the body makes the shot look like it left him.
 */
export const MUZZLE_TILES = 0.42;
/**
 * Below this separation, nothing is drawn at all.
 *
 * A swing at the unit standing next to you did not *travel*, and once the muzzle
 * offset is taken off both ends there is a sixth of a tile left to draw it in —
 * a dot appearing beside two units, which reads as a rendering fault rather than
 * as a blow. Orthogonal neighbours are 1 tile apart and diagonal ones about 1.41,
 * so this excludes both and keeps anything that genuinely crossed a gap.
 *
 * A stand-in for what the per-ability VFX table will say properly: melee
 * abilities should declare that they have no projectile, rather than being
 * filtered out by how far apart the two units happened to end up.
 */
export const MIN_FLIGHT_TILES = 1.6;

/**
 * The quad for one tracer, in fractional board coordinates.
 *
 * A streak rather than a full line from caster to target. A line that grows
 * until it touches reads as a beam being extended — a sustained thing — where
 * what happened is that a discrete something crossed the gap. A short segment
 * with a leading edge at `progress` reads as travel, and it is also what makes
 * the flight legible at a glance: the player can see how far along it is.
 *
 * The tail is clamped at the muzzle rather than allowed behind it, so a shot
 * that has only just left does not appear to emerge from inside the caster.
 *
 * Returns an empty array when the two ends coincide: a quad needs a direction,
 * and units standing on the same square give none. Callers get "nothing to
 * draw" rather than a NaN polygon that would silently poison the whole layer.
 */
export function streakQuad(from: Point, to: Point, progress: number): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (!(distance >= MIN_FLIGHT_TILES) || !Number.isFinite(progress)) return [];

  const ux = dx / distance;
  const uy = dy / distance;
  const clamped = Math.max(0, Math.min(1, progress));
  // The muzzle, and the same distance held back at the far end. A streak that
  // runs all the way to the target's centre buries its head in the victim on
  // the last frames, which is the moment the flash is trying to own.
  const muzzle = Math.min(MUZZLE_TILES, distance / 2);
  const travel = distance - muzzle * 2;
  if (!(travel > 0)) return [];
  const head = muzzle + clamped * travel;
  const tail = Math.max(muzzle, head - STREAK_TILES);

  // Perpendicular in board space. Which way round does not matter — the quad is
  // symmetric about the line, so a flipped normal draws the same shape.
  const nx = -uy * STREAK_HALF_WIDTH;
  const ny = ux * STREAK_HALF_WIDTH;
  const at = (d: number): Point => ({ x: from.x + ux * d, y: from.y + uy * d });
  const a = at(tail);
  const b = at(head);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

/**
 * Every tracer quad to draw at `t`, given a way to locate a unit.
 *
 * `positionOf` rather than positions baked into the cue, for the same reason
 * `applyFrame` takes one: a cue says *who*, and where that unit is at this
 * instant is the timeline's business, not the cue's. A unit that cannot be
 * located — a decoy that has already popped, a unit killed earlier in the phase
 * — contributes nothing instead of throwing.
 */
export function tracerQuads(
  cues: readonly Cue[],
  t: number,
  positionOf: (unitId: string) => Vec2 | undefined,
): Point[][] {
  const out: Point[][] = [];
  for (const tracer of tracersAt(cues, t)) {
    const from = positionOf(tracer.fromUnitId);
    const to = positionOf(tracer.toUnitId);
    if (from === undefined || to === undefined) continue;
    const quad = streakQuad(from, to, tracer.progress);
    if (quad.length > 0) out.push(quad);
  }
  return out;
}
