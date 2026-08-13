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
}

/** Alpha a unit fades *to* once its death cue has played (a visible corpse). */
export const DEAD_ALPHA = 0.3;
/** Peak height of a knockback/pull arc, in world units. */
const ARC = 0.35;

/** easeInOutQuad — soft on both ends so a step reads as a step, not a teleport. */
const ease = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

/** Clamp to [0,1]; guards a zero-duration cue from producing NaN. */
const unit01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1);

type Leg = Extract<Cue, { kind: 'move' } | { kind: 'displace' }>;
const isLeg = (c: Cue): c is Leg => c.kind === 'move' || c.kind === 'displace';

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
      const u = ease(unit01((t - leg.t) / leg.dur));
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
  const frame: Frame = { phase, poses: new Map(), fades: new Map(), spotlight: null, areas: [], impacts: [] };

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
