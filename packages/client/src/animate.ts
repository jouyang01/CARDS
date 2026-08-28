/**
 * `sampleFrame()` — the pure half of the A1/A2/A3 re-spec: given the cue
 * timeline (A2) and a time in beats, say what the board should *look* like right
 * then.
 *
 * **Pure**: no DOM, no wall clock, no Three.js. The renderer is a dumb applier —
 * it takes a `Frame` and pushes it into scene objects — which is what keeps the
 * animated playback unit-testable even though the render output isn't.
 *
 * The two rules `choreograph` encodes in cue *times* become visible here:
 *
 * - **Death defers.** A unit stays solid until its death cue, which
 *   `choreograph` puts at the end of its phase — so a unit that died in the
 *   gather step is still standing while it plays its own shot.
 * - **Sequential vs simultaneous.** Prep and Blast spotlight one actor at a
 *   time; Dash lights every dasher at once; **Move is never dimmed** (owner
 *   directive) — dimming a simultaneous scramble hides the whole point of it.
 *
 * Crucially, a `Frame` carries only *presentation*: fractional positions, alpha,
 * which squares glow. It never carries HP, kills or aliveness — those come from
 * `ViewState`, folded by `applyEvent`, so **skip == watch** stays true by
 * construction. Dropping every frame of this file changes nothing about where
 * the board lands.
 */

import type { Phase, Vec2 } from '@cards/engine';
import type { Cue } from './choreograph.js';

/** Where a unit is drawn *right now* — fractional squares, plus a hop height. */
export interface UnitPose {
  x: number;
  y: number;
  /** World-units above the ground plane; a knockback arcs, a walk does not. */
  lift: number;
}

/**
 * A floating number over a unit during resolution (UI5). Damage, shield
 * absorption and healing are three DIFFERENT readouts, not three identical
 * white numbers — the whole point of the item is that you can tell at a glance
 * whether a shield ate the hit.
 *
 * Every value is read from the log and never recomputed: `damage.amount`,
 * `damage.absorbed`, `heal.amount`, and the shield pool on `statusApplied`.
 */
export interface Readout {
  unitId: string;
  kind: 'damage' | 'absorb' | 'heal' | 'shield';
  amount: number;
  /** 0 the instant it lands, 1 when it has finished rising and faded out. */
  age: number;
}

export interface Frame {
  /** The phase the corner label should read, or undefined before the first banner. */
  phase?: Phase;
  /** Units mid-tween, keyed by unitId. Absent = leave where `show()` put it. */
  poses: Map<string, UnitPose>;
  /** unitId → alpha in [0,1]. Absent = fully solid. */
  fades: Map<string, number>;
  /** Units to keep lit while everything else dims, or null for no spotlight. */
  spotlight: string[] | null;
  /** Squares the currently-playing ability covers. */
  areas: Vec2[];
  /** Units taking a hit this instant — a one-beat flash. */
  impacts: string[];
  /** Floating damage / absorb / heal / shield numbers currently on screen. */
  readouts: Readout[];
}

/** Alpha a unit fades *to* once its death cue has played (a visible corpse). */
export const DEAD_ALPHA = 0.3;
/**
 * How long a floating number stays up, in beats. Longer than the one-beat cue
 * that spawns it so a hit that kills is still legible: the death cue lands at
 * the end of the phase, and the number is still rising when it does (A2's
 * deferred-death rule, made visible).
 */
export const READOUT_BEATS = 2.2;

/**
 * The single pacing constant: one beat of `choreograph`'s timeline in
 * milliseconds. Everything animated is a multiple of a beat, so playback speed
 * is this number and nothing else.
 *
 * ANIM-SLOW — owner Dev Note: *"The resolution animations are hard to tell
 * what's going on. We should slow them down."* Four phases, up to eight units
 * and every knockback, heal and death land inside one resolution; at 460ms a
 * beat the whole turn was over before a player had finished reading the first
 * phase of it. Raised so Prep → Dash → Blast → Move reads as four things that
 * happened in an order rather than one event with a lot in it.
 *
 * Flat rather than per-phase on purpose. A quiet turn is *short* rather than
 * slow — the timeline has fewer beats in it — so the thing that drags is the
 * number of beats, which per-phase weighting would not fix and would make the
 * pacing two numbers instead of one. Skip is still the escape hatch, and
 * skip==watch holds because none of this touches the fold.
 */
export const MS_PER_BEAT = 760;

/**
 * How long a unit takes to cross one square, in milliseconds.
 *
 * NOT a pacing choice, which is why it sits beside `MS_PER_BEAT` rather than
 * replacing the "flat, not per-phase" rule above. Every other beat is a
 * rhythm — how long a thing should read for — and one number is right for all
 * of them. A move step is a **physical constraint**: the run clip's feet travel
 * a fixed distance per stride, and if the ground goes past at any other speed
 * the feet slide. There is one correct value and it is measured, not felt.
 *
 * Measured off `sword_and_shield_run` by walking the leg chain (Hips ->
 * RightUpLeg -> RightLeg -> RightFoot -> RightToeBase) through the clip:
 *
 *   foot travel per stride   0.836 tiles
 *   one stride               0.367 s   (a 0.733 s cycle, two strides)
 *   => ground speed          2.28 tiles/sec  ->  439 ms per tile
 *
 * At `MS_PER_BEAT` a tile took 760 ms, so a unit covered 0.48 tiles per stride
 * while its feet were built for 0.836 — it took 2.07 steps to cross one square
 * and skated the difference.
 *
 * This ties the whole roster to one ground speed, which the ruleset already
 * assumes ("the engine gives every move step the same duration"). A new
 * locomotion clip therefore has to match this stride length rather than the
 * other way round — `tools/art` measures it, and a clip that disagrees will
 * slide no matter what this number says.
 */
export const MS_PER_MOVE_STEP = 440;
/** Peak height of a knockback/pull arc, in world units. */
const ARC = 0.35;

/** easeInOutQuad — soft on both ends so a step reads as a step, not a teleport. */
const ease = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

/** Clamp to [0,1]; guards a zero-duration cue from producing NaN. */
const unit01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1);

type Leg = Extract<Cue, { kind: 'move' } | { kind: 'displace' }>;
const isLeg = (c: Cue): c is Leg => c.kind === 'move' || c.kind === 'displace';

/**
 * How far through the beat a blink lands. He casts, and then he is there.
 *
 * Not 0 and not 1. Landing immediately loses the cast — the animation plays to
 * an empty square and the arrival is over before the eye reaches it; landing at
 * the very end puts the arrival on the same frame as the next phase. Halfway
 * gives the wind-up a beat-half and the arrival a beat-half to be read in.
 */
export const BLINK_AT = 0.5;

/**
 * Whether a leg is a teleport rather than a step.
 *
 * **Geometric, because the engine does not say.** A teleport emits the same
 * `moveStep` event as a walk (`resolve.ts`), so the only thing separating them
 * on this side is that a walked step is always to a touching square — one
 * orthogonally or diagonally — and a teleport is generally not.
 *
 * The engine now says so directly: a `teleport` step (blink, Shift, Shadowstep
 * Strike's arrival) carries the flag from `moveStep`, so a blink that lands one
 * square away is still a blink and does not slide. The geometric test below is
 * kept as a fallback for a leg with no flag — a hand-built cue in a test, or a
 * future mover that forgets to set it — where a jump of more than one square
 * could only have been a teleport anyway.
 */
export function isBlink(leg: Leg): boolean {
  if (leg.kind !== 'move') return false; // a knockback is thrown, not teleported
  if (leg.teleport === true) return true;
  // An explicit `false` is trusted however long the leg: a combat roll collapsed
  // to one straight cross-board slide (STRAIGHT-DASH) is many tiles but must
  // slide, not jump. The geometric guess is only for a leg that set no flag.
  if (leg.teleport === false) return false;
  return Math.max(Math.abs(leg.to.x - leg.from.x), Math.abs(leg.to.y - leg.from.y)) > 1;
}

/** Phases that dim the board around their actor. Move is deliberately absent. */
const SPOTLIT: ReadonlySet<Phase> = new Set<Phase>(['prep', 'dash', 'blast']);
/** Phases whose actors play one at a time — the spotlight follows a single actor. */
const SEQUENTIAL: ReadonlySet<Phase> = new Set<Phase>(['prep', 'blast']);

/** The phase whose banner most recently started at or before `t`. */
export function phaseAt(cues: readonly Cue[], t: number): Phase | undefined {
  let phase: Phase | undefined;
  for (const c of cues) if (c.kind === 'phase' && c.t <= t) phase = c.phase;
  return phase;
}

/**
 * `[start, end)` of a phase in beats: its banner up to the next banner, with
 * `end` pulled in to where the phase's own cues actually finish. The turn's last
 * phase has no next banner, so its end comes from its cues alone.
 */
export function phaseWindow(cues: readonly Cue[], phase: Phase): { start: number; end: number } {
  const banner = cues.find((c) => c.kind === 'phase' && c.phase === phase);
  if (banner === undefined) return { start: 0, end: 0 };
  const later = cues.filter((c) => c.kind === 'phase' && c.t > banner.t).map((c) => c.t);
  const nextBanner = later.length > 0 ? Math.min(...later) : Infinity;
  const end = cues.reduce(
    (m, c) => (c.t >= banner.t && c.t < nextBanner ? Math.max(m, c.t + c.dur) : m),
    banner.t + banner.dur,
  );
  return { start: banner.t, end: Math.min(end, nextBanner) };
}

/** Cues that start inside a phase's window — its banner up to the next banner. */
const cuesIn = (cues: readonly Cue[], phase: Phase): Cue[] => {
  const banner = cues.find((c) => c.kind === 'phase' && c.phase === phase);
  if (banner === undefined) return [];
  const later = cues.filter((c) => c.kind === 'phase' && c.t > banner.t).map((c) => c.t);
  const nextBanner = later.length > 0 ? Math.min(...later) : Infinity;
  return cues.filter((c) => c.t >= banner.t && c.t < nextBanner);
};

/**
 * Where one unit is drawn at `t`, given its own movement legs in time order.
 * Before its first leg it waits at the origin square; after its last it stands
 * at the destination; in between it eases along the current leg.
 */
function poseFrom(legs: readonly Leg[], t: number): UnitPose | undefined {
  const first = legs[0];
  if (first === undefined) return undefined;
  if (t < first.t) return { x: first.from.x, y: first.from.y, lift: 0 };

  let last = first;
  for (const leg of legs) {
    if (t < leg.t) break;
    last = leg;
    if (t < leg.t + leg.dur) {
      const p = unit01((t - leg.t) / leg.dur);
      // A WALK IS LINEAR; only a throw eases.
      //
      // `easeInOutQuad` begins and ends at zero velocity, and a walk is a run
      // of back-to-back one-tile legs — so easing each one made the unit
      // accelerate from a standstill and brake back to one on *every square*.
      // Several steps in a tile, a slide to the next, several more: the stutter
      // was one leg's ease meeting the next leg's.
      //
      // Linear also happens to be the only speed profile that does not slide.
      // The feet cycle at a constant rate (MS_PER_MOVE_STEP is measured from
      // them), so any easing moves the ground past them at the wrong speed —
      // an ease-in-out peaks at twice its own average, which would skate the
      // middle of every run.
      //
      // Displacement keeps its ease: a knockback is thrown rather than walked,
      // it arcs, and it is always a leg on its own.
      //
      // A BLINK does neither: it holds, then it is elsewhere. Intercept is a
      // teleport, and sliding a unit across five squares of open board is the
      // one reading of it that is definitely wrong — it says he ran.
      if (isBlink(leg)) {
        const there = p >= BLINK_AT ? 1 : 0;
        return {
          x: leg.from.x + (leg.to.x - leg.from.x) * there,
          y: leg.from.y + (leg.to.y - leg.from.y) * there,
          lift: 0,
        };
      }
      const u = leg.kind === 'displace' ? ease(p) : p;
      return {
        x: leg.from.x + (leg.to.x - leg.from.x) * u,
        y: leg.from.y + (leg.to.y - leg.from.y) * u,
        // A knockback is thrown, so it arcs; a walked step stays on the floor.
        lift: leg.kind === 'displace' ? Math.sin(Math.PI * u) * ARC : 0,
      };
    }
  }
  return { x: last.to.x, y: last.to.y, lift: 0 };
}

/**
 * The actor holding the stage at `t` in a sequential phase: the last ability or
 * impact cue to have started. Impacts count so a delayed detonation — which
 * fires no ability this turn — still gets its own lit beat.
 */
function actorAt(phaseCues: readonly Cue[], t: number): string | undefined {
  let actor: string | undefined;
  for (const c of phaseCues) {
    if (c.t > t) continue;
    if (c.kind === 'ability') actor = c.unitId;
    else if (c.kind === 'impact') actor = c.sourceUnitId;
  }
  return actor;
}

/**
 * Sample the timeline at `t` beats. `cues` is the whole turn's timeline (not one
 * phase's), so the phase label and window come out of the same list.
 */
export function sampleFrame(cues: readonly Cue[], t: number): Frame {
  const phase = phaseAt(cues, t);
  const frame: Frame = { phase, poses: new Map(), fades: new Map(), spotlight: null, areas: [], impacts: [], readouts: [] };

  // ── Positions: every leg a unit has played so far, across the whole turn ────
  const legsByUnit = new Map<string, Leg[]>();
  for (const c of cues) {
    if (!isLeg(c)) continue;
    const list = legsByUnit.get(c.unitId);
    if (list === undefined) legsByUnit.set(c.unitId, [c]);
    else list.push(c);
  }
  for (const [unitId, legs] of legsByUnit) {
    const pose = poseFrom([...legs].sort((a, b) => a.t - b.t), t);
    if (pose !== undefined) frame.poses.set(unitId, pose);
  }

  // ── Deferred death fade, undone by a respawn ───────────────────────────────
  for (const c of cues) {
    if (c.t > t) continue;
    if (c.kind === 'death') {
      const u = unit01((t - c.t) / c.dur);
      frame.fades.set(c.unitId, 1 - (1 - DEAD_ALPHA) * u);
    } else if (c.kind === 'respawn') {
      frame.fades.delete(c.unitId);
    }
  }

  // ── Floating readouts (UI5) ────────────────────────────────────────────────
  // Gathered across the WHOLE timeline, not just the current phase: a number is
  // still rising for a couple of beats after its cue, and phases butt up
  // against each other, so a phase-local scan would cut them off at the seam.
  for (const c of cues) {
    if (c.t > t || t >= c.t + READOUT_BEATS) continue;
    const age = unit01((t - c.t) / READOUT_BEATS);
    if (c.kind === 'impact') {
      // Two numbers when a shield ate part of it — "26 damage" and "18 absorbed"
      // tell a different story from "8 damage", and both are in the log.
      if (c.amount > 0) frame.readouts.push({ unitId: c.unitId, kind: 'damage', amount: c.amount, age });
      if (c.absorbed > 0) frame.readouts.push({ unitId: c.unitId, kind: 'absorb', amount: c.absorbed, age });
    } else if (c.kind === 'benefit') {
      frame.readouts.push({ unitId: c.unitId, kind: c.benefit, amount: c.amount, age });
    }
  }

  if (phase === undefined) return frame;
  const phaseCues = cuesIn(cues, phase);

  // ── Impacts: a single beat's flash ─────────────────────────────────────────
  for (const c of phaseCues) {
    if (c.kind === 'impact' && c.t <= t && t < c.t + c.dur) frame.impacts.push(c.unitId);
  }

  // ── Spotlight + the lit ability area ───────────────────────────────────────
  if (!SPOTLIT.has(phase)) return frame;

  if (SEQUENTIAL.has(phase)) {
    const actor = actorAt(phaseCues, t);
    if (actor === undefined) return frame; // still on the banner beat: no dim yet
    const lit = new Set<string>([actor]);
    for (const c of phaseCues) {
      if (c.kind === 'impact' && c.sourceUnitId === actor && c.t <= t) lit.add(c.unitId);
      if (c.kind === 'ability' && c.unitId === actor && c.t <= t) frame.areas.push(...c.area);
    }
    frame.spotlight = [...lit];
    return frame;
  }

  // Dash is simultaneous: everyone who dashed is lit together, or nobody is.
  const lit = new Set<string>();
  for (const c of phaseCues) {
    if (c.kind === 'ability' && c.t <= t) { lit.add(c.unitId); frame.areas.push(...c.area); }
    if (isLeg(c) && c.t <= t) lit.add(c.unitId);
  }
  if (lit.size > 0) frame.spotlight = [...lit];
  return frame;
}

/** Squares the camera should keep in frame at `t`: the lit area ∪ the lit units. */
export function focusSquares(frame: Frame, posOf: (unitId: string) => Vec2 | undefined): Vec2[] {
  const out: Vec2[] = [...frame.areas];
  for (const unitId of frame.spotlight ?? []) {
    const pose = frame.poses.get(unitId);
    if (pose !== undefined) out.push({ x: Math.round(pose.x), y: Math.round(pose.y) });
    else {
      const p = posOf(unitId);
      if (p !== undefined) out.push(p);
    }
  }
  return out;
}
