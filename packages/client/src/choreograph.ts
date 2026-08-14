/**
 * `choreograph()` — turn a resolved turn's `TurnEvent[]` into a timeline of
 * renderer-agnostic cues.
 *
 * **Pure**: no DOM, no wall clock, no randomness. Same log in, same cues out.
 * This is the layer a future 3D renderer reuses verbatim, which is why cues
 * describe WHAT happens, never HOW it looks: `{kind:'impact', unitId}` is a cue;
 * a colour, a pixel offset or an easing name is not, and must stay in the
 * renderer (A3).
 *
 * ## The presentation model (settled, from Atlas Reactor)
 *
 * Resolution in the engine is fully simultaneous. Only the *showing* is
 * serialized, so a player can read causality:
 *
 * | Phase | Shown |
 * |---|---|
 * | Prep  | SEQUENTIAL — one actor at a time |
 * | Dash  | SIMULTANEOUS — everyone at once |
 * | Blast | SEQUENTIAL — one actor at a time |
 * | Move  | SIMULTANEOUS — everyone at once |
 *
 * Two reconciling rules keep the serialized view faithful to simultaneous truth:
 *
 * - **Death defers.** A unit that died during the gather step remains standing
 *   until it has played its own action; every death cue lands at or after the end
 *   of that phase's action cues. Nobody is robbed of the shot they actually fired.
 * - **Displacement lands last.** Knockback/pull cues in Blast share one start at
 *   the end of the phase, mirroring the engine rule that displacement resolves
 *   after all damage.
 *
 * Attribution comes from the event, never from log adjacency: Blast emits every
 * `abilityFired` before any `damage`, so a damage cue is bound to its shooter by
 * `sourceUnitId` (A0). Ordering among actors is the log's own emission order
 * (deterministic via the engine's `orderedPlans`) — never unitId or team.
 *
 * Timing is one tunable constant (`BEAT`); everything is a multiple of it, so
 * pacing is a single number to turn at playtest and tests assert only ordering
 * and concurrency.
 */

import { PHASES, type Phase, type TurnEvent, type Vec2 } from '@cards/engine';
import { segmentByPhase } from './playback.js';

/** One beat of timeline. Unitless here; the renderer scales it to milliseconds. */
export const BEAT = 1;

interface CueBase {
  /** Start time, in beats from the top of the turn. */
  t: number;
  /** Duration in beats. */
  dur: number;
}

export type Cue =
  | (CueBase & { kind: 'phase'; phase: Phase })
  | (CueBase & { kind: 'ability'; phase: Phase; unitId: string; abilityId: string; area: Vec2[] })
  | (CueBase & { kind: 'move'; unitId: string; from: Vec2; to: Vec2 })
  | (CueBase & { kind: 'displace'; unitId: string; from: Vec2; to: Vec2; displaceKind: 'knockback' | 'pull' })
  | (CueBase & { kind: 'impact'; unitId: string; amount: number; absorbed: number; sourceUnitId: string; abilityId: string })
  // A benefit landing (UI5). Same shape as an impact and bound to its actor the
  // same way — by `sourceUnitId`, which A0-heal put on `heal`/`statusApplied`
  // precisely so a heal could be attributed like a hit.
  | (CueBase & { kind: 'benefit'; unitId: string; amount: number; benefit: 'heal' | 'shield'; sourceUnitId: string; abilityId: string })
  | (CueBase & { kind: 'death'; unitId: string })
  | (CueBase & { kind: 'respawn'; unitId: string; at: Vec2 })
  | (CueBase & { kind: 'decoy'; decoyId: string; at: Vec2; event: 'spawned' | 'destroyed' });

/** Phases whose actors are shown one at a time. The rest play everyone at once. */
const SEQUENTIAL: ReadonlySet<Phase> = new Set<Phase>(['prep', 'blast']);

const end = (c: Cue): number => c.t + c.dur;
const maxEnd = (cues: readonly Cue[], fallback: number): number =>
  cues.reduce((m, c) => Math.max(m, end(c)), fallback);

type Damage = Extract<TurnEvent, { type: 'damage' }>;
type Fired = Extract<TurnEvent, { type: 'abilityFired' }>;
type Heal = Extract<TurnEvent, { type: 'heal' }>;
type Status = Extract<TurnEvent, { type: 'statusApplied' }>;

/**
 * Heals and shields worth a floating number (UI5). A shield is only news when
 * it is granted with a pool; other statuses have no magnitude to show.
 */
function benefitEvents(events: readonly TurnEvent[]): { unitId: string; amount: number; benefit: 'heal' | 'shield'; sourceUnitId: string; abilityId: string }[] {
  const out: { unitId: string; amount: number; benefit: 'heal' | 'shield'; sourceUnitId: string; abilityId: string }[] = [];
  for (const e of events) {
    if (e.type === 'heal') {
      const h = e as Heal;
      out.push({ unitId: h.unitId, amount: h.amount, benefit: 'heal', sourceUnitId: h.sourceUnitId, abilityId: h.abilityId });
    } else if (e.type === 'statusApplied') {
      const s = e as Status;
      if (s.status === 'shield' && (s.amount ?? 0) > 0) {
        out.push({ unitId: s.unitId, amount: s.amount ?? 0, benefit: 'shield', sourceUnitId: s.sourceUnitId, abilityId: s.abilityId });
      }
    }
  }
  return out;
}

/**
 * Build the cue timeline for one resolved turn.
 *
 * Cues are returned sorted by start time (ties keep insertion order), so a
 * renderer can walk them in order or index them by `t`.
 */
export function choreograph(events: readonly TurnEvent[]): Cue[] {
  const cues: Cue[] = [];
  let t = 0;

  for (const segment of segmentByPhase(events)) {
    const { phase } = segment;
    cues.push({ kind: 'phase', phase, t, dur: BEAT });
    t += BEAT; // the banner reads before the phase acts

    const phaseCues: Cue[] = SEQUENTIAL.has(phase)
      ? sequentialPhase(phase, segment.events, t)
      : simultaneousPhase(phase, segment.events, t);

    // Displacement lands after every action cue, all victims together.
    const actionEnd = maxEnd(phaseCues, t);
    const displaced = segment.events.filter((e) => e.type === 'displaced');
    for (const e of displaced) {
      phaseCues.push({ kind: 'displace', t: actionEnd, dur: BEAT, unitId: e.unitId, from: e.from, to: e.to, displaceKind: e.kind });
    }

    // Deaths defer to the very end of the phase: a unit that died in the gather
    // step has, by now, played its own action.
    const deathT = maxEnd(phaseCues, actionEnd);
    for (const e of segment.events) {
      if (e.type === 'death') phaseCues.push({ kind: 'death', t: deathT, dur: BEAT, unitId: e.unitId });
      if (e.type === 'respawn') phaseCues.push({ kind: 'respawn', t: deathT, dur: BEAT, unitId: e.unitId, at: e.pos });
    }

    cues.push(...phaseCues);
    t = maxEnd(phaseCues, t);
  }

  return cues.sort((a, b) => a.t - b.t);
}

/**
 * One actor at a time: each actor's cues occupy a time range that does not
 * overlap any other actor's. Actor order is the log's emission order — the order
 * `abilityFired` appears, then any source that only shows up as damage (a delayed
 * detonation fires no ability this turn but still deserves its own beat).
 */
function sequentialPhase(phase: Phase, events: readonly TurnEvent[], start: number): Cue[] {
  const fired = events.filter((e): e is Fired => e.type === 'abilityFired');
  const damage = events.filter((e): e is Damage => e.type === 'damage');
  const benefits = benefitEvents(events);

  const order: string[] = [];
  for (const e of fired) if (!order.includes(e.unitId)) order.push(e.unitId);
  for (const d of damage) if (!order.includes(d.sourceUnitId)) order.push(d.sourceUnitId);
  for (const b of benefits) if (!order.includes(b.sourceUnitId)) order.push(b.sourceUnitId);

  const cues: Cue[] = [];
  let t = start;
  for (const actor of order) {
    const slot: Cue[] = [];
    for (const e of fired.filter((f) => f.unitId === actor)) {
      slot.push({ kind: 'ability', phase, t, dur: BEAT, unitId: e.unitId, abilityId: e.abilityId, area: e.area });
    }
    // Hits land after the ability that caused them — bound by sourceUnitId (A0),
    // never by where the damage event happens to sit in the log.
    const impactT = maxEnd(slot, t);
    for (const d of damage.filter((x) => x.sourceUnitId === actor)) {
      slot.push({ kind: 'impact', t: impactT, dur: BEAT, unitId: d.unitId, amount: d.amount, absorbed: d.absorbed, sourceUnitId: d.sourceUnitId, abilityId: d.abilityId });
    }
    for (const b of benefits.filter((x) => x.sourceUnitId === actor)) {
      slot.push({ kind: 'benefit', t: impactT, dur: BEAT, ...b });
    }
    cues.push(...slot);
    t = maxEnd(slot, t); // next actor starts where this one finished — disjoint ranges
  }
  cueDecoys(events, cues, start);
  return cues;
}

/** Everyone at once: every unit's first cue shares `start`; a unit's own steps follow in sequence. */
function simultaneousPhase(phase: Phase, events: readonly TurnEvent[], start: number): Cue[] {
  const cues: Cue[] = [];

  for (const e of events) {
    if (e.type === 'abilityFired') {
      cues.push({ kind: 'ability', phase, t: start, dur: BEAT, unitId: e.unitId, abilityId: e.abilityId, area: e.area });
    }
  }

  // Movement: step k of every mover plays at the same beat, so a simultaneous
  // Move phase reads as simultaneous. The engine emits Move step-major and Dash
  // unit-major; counting per unit gives the right beat under both.
  const stepsSoFar = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'moveStep') continue;
    const k = stepsSoFar.get(e.unitId) ?? 0;
    stepsSoFar.set(e.unitId, k + 1);
    cues.push({ kind: 'move', t: start + k * BEAT, dur: BEAT, unitId: e.unitId, from: e.from, to: e.to });
  }

  const impactT = maxEnd(cues, start);
  for (const e of events) {
    if (e.type === 'damage') {
      cues.push({ kind: 'impact', t: impactT, dur: BEAT, unitId: e.unitId, amount: e.amount, absorbed: e.absorbed, sourceUnitId: e.sourceUnitId, abilityId: e.abilityId });
    }
  }
  for (const b of benefitEvents(events)) cues.push({ kind: 'benefit', t: impactT, dur: BEAT, ...b });
  cueDecoys(events, cues, start);
  return cues;
}

/** Decoy appear/vanish, shown with the phase's action rather than on its own beat. */
function cueDecoys(events: readonly TurnEvent[], cues: Cue[], start: number): void {
  for (const e of events) {
    if (e.type === 'decoySpawned') cues.push({ kind: 'decoy', t: start, dur: BEAT, decoyId: e.decoyId, at: e.pos, event: 'spawned' });
    if (e.type === 'decoyDestroyed') cues.push({ kind: 'decoy', t: maxEnd(cues, start), dur: BEAT, decoyId: e.decoyId, at: e.pos, event: 'destroyed' });
  }
}

/** Total length of a timeline in beats (0 for an empty one). */
export function timelineLength(cues: readonly Cue[]): number {
  return cues.reduce((m, c) => Math.max(m, c.t + c.dur), 0);
}

/** The cues of one phase, in start order — handy for a renderer stepping phase by phase. */
export function cuesByPhase(cues: readonly Cue[]): Map<Phase, Cue[]> {
  const out = new Map<Phase, Cue[]>(PHASES.map((p) => [p, [] as Cue[]]));
  const bounds = PHASES.map((p) => ({ phase: p, t: cues.find((c) => c.kind === 'phase' && c.phase === p)?.t ?? Infinity }));
  for (const cue of cues) {
    // A cue belongs to the last phase banner at or before its start.
    let owner: Phase | undefined;
    for (const b of bounds) if (b.t <= cue.t) owner = b.phase;
    if (owner !== undefined) out.get(owner)!.push(cue);
  }
  return out;
}
