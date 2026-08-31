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

/**
 * Beats a combat roll spends per straight-line tile (STRAIGHT-DASH / ROLL-SPEED).
 * Below one beat because a roll is a quick dash, not a walk — and it is counted
 * against Chebyshev distance, so a diagonal roll is not slowed by the orthogonal
 * staircase the engine paths it along.
 */
export const ROLL_TILE_BEATS = 0.6;

interface CueBase {
  /** Start time, in beats from the top of the turn. */
  t: number;
  /** Duration in beats. */
  dur: number;
}

export type Cue =
  | (CueBase & { kind: 'phase'; phase: Phase })
  // `delayed` (a grenade detonation replays no throw) and `stretch` (a walked
  // dash time-scales its clip to the whole traversal) are presentation flags.
  | (CueBase & { kind: 'ability'; phase: Phase; unitId: string; abilityId: string; area: Vec2[]; delayed?: boolean; stretch?: boolean })
  // `teleport` rides through from the engine's `moveStep`: the caster arrives
  // rather than crosses, so `animate.ts` jumps it instead of sliding it. A blink
  // that lands one tile away is still a blink — the flag says so where geometry
  // (an adjacent square looks exactly like a walk) cannot.
  | (CueBase & { kind: 'move'; unitId: string; from: Vec2; to: Vec2; teleport?: boolean })
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
    // The banner reads before the phase acts — EXCEPT in Move.
    //
    // Prep, Dash and Blast are announcements: the banner names what is about to
    // happen and then it happens, and the beat of stillness is what makes the
    // naming land. Move announces nothing. Everyone goes at once, the board
    // already shows where, and a beat of everybody standing under a MOVE label
    // is dead air — on a one-tile move it was half the phase, which read as
    // characters hesitating before they walked. Owner's call (2026-08-22).
    if (phase !== 'move') t += BEAT;

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
      slot.push({ kind: 'ability', phase, t, dur: BEAT, unitId: e.unitId, abilityId: e.abilityId, area: e.area, delayed: e.delayed });
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
      cues.push({ kind: 'ability', phase, t: start, dur: BEAT, unitId: e.unitId, abilityId: e.abilityId, area: e.area, delayed: e.delayed });
    }
  }

  // Movement: step k of every mover plays at the same beat, so a simultaneous
  // Move phase reads as simultaneous. The engine emits Move step-major and Dash
  // unit-major; counting per unit gives the right beat under both.
  //
  // TRAP-INSTANT: a trap fires the moment the walker steps onto it, not when the
  // whole move settles. The engine emits `moveStep(onto trap) → trapTriggered →
  // damage` in order and the walker keeps going (a non-halting trap), so all of
  // its damage would otherwise land at the phase end (`impactT` below), reading
  // as "it went off when they reached their destination". Instead, remember the
  // beat the walker ARRIVES on the trap (its step count so far), and time that
  // trap's damage there rather than at the phase end.
  const stepsSoFar = new Map<string, number>();
  const trapArrival = new Map<string, number>(); // victim -> beat their damage fires, if a trap fired it
  const damageTimes: (number | undefined)[] = []; // per damage event, in order; undefined = phase end
  for (const e of events) {
    if (e.type === 'moveStep') {
      const k = stepsSoFar.get(e.unitId) ?? 0;
      stepsSoFar.set(e.unitId, k + 1);
      cues.push({ kind: 'move', t: start + k * BEAT, dur: BEAT, unitId: e.unitId, from: e.from, to: e.to, teleport: e.teleport });
    } else if (e.type === 'trapTriggered') {
      // Arrival on the trap = end of the step that entered it = step count * BEAT.
      trapArrival.set(e.unitId, start + (stepsSoFar.get(e.unitId) ?? 0) * BEAT);
    } else if (e.type === 'damage') {
      const at = trapArrival.get(e.unitId);
      if (at !== undefined) trapArrival.delete(e.unitId); // one trap, one hit — consume it
      damageTimes.push(at);
    }
  }

  // WALKED-DASH — a combat roll traverses its squares (walked moveSteps), and its
  // own ability cue is only one beat, so `selectClip` (ability > movement) played
  // the roll for the first tile and the RUN clip for the rest, and on a one-tile
  // roll the ~1.5 s clip was cut off after 0.76 s. Grow the dash ability cue to
  // span the whole traversal so the roll is what plays the entire way, and mark it
  // `stretch` so the renderer time-scales the clip to finish exactly on arrival —
  // a short roll reads quick, a long one reads longer.
  //
  // Only WALKED steps count. A teleport dash (Blink) arrives rather than crosses
  // (`teleport: true`); it has no walked traversal to span and is `holdCasts`'s
  // job (its clip is held to length, not fitted to a walk). Counting only the
  // walked steps keeps the two mechanisms disjoint: roll here, blink there.
  if (phase === 'dash') {
    const walked = new Map<string, number>();
    for (const c of cues) {
      if (c.kind === 'move' && c.teleport !== true) walked.set(c.unitId, (walked.get(c.unitId) ?? 0) + 1);
    }
    for (const c of cues) {
      if (c.kind !== 'ability') continue;
      const steps = walked.get(c.unitId) ?? 0;
      if (steps > 0) {
        c.dur = steps * BEAT;
        c.stretch = true;
      }
    }
  }

  const impactT = maxEnd(cues, start);
  let di = 0;
  for (const e of events) {
    if (e.type === 'damage') {
      // A trap hit fires on arrival (TRAP-INSTANT); everything else lands at the
      // phase end, where the shot's flight and the blast have finished.
      const t = damageTimes[di++] ?? impactT;
      cues.push({ kind: 'impact', t, dur: BEAT, unitId: e.unitId, amount: e.amount, absorbed: e.absorbed, sourceUnitId: e.sourceUnitId, abilityId: e.abilityId });
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

/**
 * FOLLOW-THROUGH — give a cast the room its own animation needs.
 *
 * Owner (2026-10-08): *"Wisp's Dagger flurry animation does not finish during
 * blast phase if it doesn't hit anything."*
 *
 * An `ability` cue is one beat long, and `selectClip` drops the caster back to
 * idle the instant that beat is over — so a 3.1 s flurry was crossfaded away
 * after 0.76 s. **Landing a hit hid it**: the impact it caused adds a second
 * beat to the actor's slot, so a connected swing had twice the room and read as
 * finished. A whiff had one beat and read as cut off. The bug was never about
 * hitting; it was about the cast borrowing its follow-through from its victim.
 *
 * `beatsFor` is the caller's, because clip lengths are art, not choreography —
 * `choreograph()` itself still knows nothing about a `.glb`. A character with no
 * model answers `undefined` and its timeline comes back byte-identical.
 *
 * What moves and what does not:
 *
 * - The cast's **`dur`** grows to the clip's length, which is all `selectClip`
 *   and `phaseWindow` read. That alone keeps the swing on screen and the phase
 *   open for it.
 * - The cast's **`t`** does not move, and neither do the impacts it caused —
 *   they sit at the end of the *original* beat. So the hit lands when it always
 *   did, and the tracer, whose flight window is `[cast.t, impact.t)`, flies at
 *   the speed it always flew. Stretching the cast into its own impact would have
 *   turned every bola into a four-second crawl.
 * - Everything at or after the **hold boundary** shifts by the difference. What
 *   the boundary is depends on the phase, and it is the whole of the difference
 *   between a sequential hold and a dash hold:
 *
 *   - **Sequential** (prep, blast): the boundary is the actor's own slot end.
 *     Actors own disjoint ranges, so shifting from there just makes the next one
 *     wait — the existing rule. The cast plus the landings bound to it (A0, by
 *     `sourceUnitId`) is the slot, and the landings must not move or the hit
 *     drifts off the swing that caused it.
 *   - **Dash**: the boundary is the end of the *whole phase*, not the caster's
 *     slot. Dash is simultaneous — step *k* of every mover shares a beat — so
 *     shifting from the caster's slot would open a hole in the middle of somebody
 *     else's charge. Shifting from the phase end instead leaves every in-phase
 *     step where it was (they all start before the end) and only pushes Blast and
 *     everything after it out, so a blink whose clip runs four beats gets those
 *     beats while the other dashers simply finish and wait. Held only when the
 *     caster does not *walk* this phase — a `teleport` step or no step at all —
 *     because a path-charge dasher's story is the run, not a cast clip pinned
 *     over it (`selectClip` ranks ability over movement).
 *
 * Move is never held: nothing casts in it.
 */
export function holdCasts(
  cues: readonly Cue[],
  beatsFor: (unitId: string, abilityId: string) => number | undefined,
): Cue[] {
  const out: Cue[] = cues.map((c) => ({ ...c }));
  const casts = out
    .filter((c): c is Extract<Cue, { kind: 'ability' }> =>
      c.kind === 'ability' && c.delayed !== true && (SEQUENTIAL.has(c.phase) || c.phase === 'dash'))
    .sort((a, b) => a.t - b.t);

  /** `[banner, nextBanner)` of the cast's phase — recomputed per cast, as earlier holds move later banners. */
  const phaseSpan = (phase: Phase): { start: number; end: number } => {
    const banner = out.find((c) => c.kind === 'phase' && c.phase === phase);
    if (banner === undefined) return { start: 0, end: Infinity };
    const later = out.filter((c) => c.kind === 'phase' && c.t > banner.t).map((c) => c.t);
    return { start: banner.t, end: later.length > 0 ? Math.min(...later) : Infinity };
  };

  for (const cast of casts) {
    const need = beatsFor(cast.unitId, cast.abilityId);
    if (need === undefined || !(need > cast.dur)) continue;

    let boundary: number;
    if (SEQUENTIAL.has(cast.phase)) {
      // The actor's own slot: the cast plus the landings bound to it (A0 again —
      // by `sourceUnitId`, never by log adjacency).
      boundary = out.reduce(
        (m, c) => ((c.kind === 'impact' || c.kind === 'benefit')
          && c.sourceUnitId === cast.unitId && c.t >= cast.t ? Math.max(m, end(c)) : m),
        end(cast),
      );
    } else {
      // Dash. Do not hold a caster that is charging on foot this phase.
      const span = phaseSpan(cast.phase);
      const inPhase = (c: Cue): boolean => c.t >= span.start && c.t < span.end;
      const walks = out.some((c) => c.kind === 'move' && c.unitId === cast.unitId && c.teleport !== true && inPhase(c));
      if (walks) continue;
      // The whole phase's action end — every in-phase step is before it.
      boundary = out.reduce((m, c) => (inPhase(c) ? Math.max(m, end(c)) : m), end(cast));
    }

    const delta = cast.t + need - boundary;
    cast.dur = need;
    if (delta <= 0) continue; // the room is already there
    for (const c of out) if (c !== cast && c.t >= boundary) c.t += delta;
  }

  return out.sort((a, b) => a.t - b.t);
}

/**
 * STRAIGHT-DASH — a combat roll rolls in a straight line to its end square.
 *
 * The engine paths a dash along an orthogonal staircase (right, up, right, up on
 * a diagonal), because cover and reach are square counts. Played step by step
 * that zig-zags — the unit lurches and, worse, the roll clip tumbles a new
 * direction every tile. A roll is one committed movement, so here its walked
 * dash steps are collapsed into ONE straight move from origin to destination.
 * Position and facing both read these cues, so both go straight.
 *
 * Only a unit with a **stretched dash ability** (the roll marks its cue
 * `stretch`; see the dash block above) is collapsed — a normal walk keeps its
 * path, and a `teleport` dash never had steps to straighten. The single leg is
 * flagged `teleport: false` so the renderer slides it however long it is, rather
 * than reading a multi-tile leap as a blink (`isBlink`). The walked-step COUNT
 * that set the ability's stretched duration was taken earlier, in `choreograph`,
 * so shortening the path here does not shorten the clip.
 */
export function straightenDashes(cues: readonly Cue[]): Cue[] {
  const rollers = new Map<string, { t: number; end: number }>();
  for (const c of cues) {
    if (c.kind === 'ability' && c.stretch === true && c.phase === 'dash') {
      rollers.set(c.unitId, { t: c.t, end: c.t + c.dur });
    }
  }
  if (rollers.size === 0) return [...cues];

  const rollStep = (c: Cue): c is Extract<Cue, { kind: 'move' }> => {
    if (c.kind !== 'move' || c.teleport === true) return false;
    const win = rollers.get(c.unitId);
    return win !== undefined && c.t >= win.t - 1e-6 && c.t < win.end + 1e-6;
  };

  const stepsByUnit = new Map<string, Extract<Cue, { kind: 'move' }>[]>();
  const out: Cue[] = [];
  for (const c of cues) {
    if (rollStep(c)) {
      const list = stepsByUnit.get(c.unitId) ?? [];
      list.push(c);
      stepsByUnit.set(c.unitId, list);
    } else {
      out.push(c);
    }
  }
  for (const [unitId, steps] of stepsByUnit) {
    steps.sort((a, b) => a.t - b.t);
    const first = steps[0]!;
    const last = steps[steps.length - 1]!;
    // One step is already straight and one beat long; keep it.
    if (steps.length === 1) { out.push(first); continue; }
    // ROLL-SPEED: time the roll by the STRAIGHT-LINE tile count, not the
    // orthogonal staircase the engine paths — the staircase over-counts a
    // diagonal (Manhattan ≥ Chebyshev), so a straight diagonal roll would crawl
    // across its short line over too many beats. `ROLL_TILE_BEATS < 1` also makes
    // the dash quicker than a walk, which is what a combat roll should read as.
    const tiles = Math.max(Math.abs(last.to.x - first.from.x), Math.abs(last.to.y - first.from.y));
    const span = last.t + last.dur - first.t;
    const dur = Math.min(span, Math.max(ROLL_TILE_BEATS, tiles * ROLL_TILE_BEATS));
    out.push({ kind: 'move', t: first.t, dur, unitId, from: first.from, to: last.to, teleport: false });
    // Fit the roll clip to the same (shorter) traversal so it plays that fast and
    // still finishes exactly on arrival.
    for (const c of out) {
      if (c.kind === 'ability' && c.unitId === unitId && c.stretch === true && c.phase === 'dash') c.dur = dur;
    }
  }
  return out.sort((a, b) => a.t - b.t);
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
