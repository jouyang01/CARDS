/**
 * Turn playback state machine — the part of A3 that owns *state*, kept free of
 * DOM and WAAPI so it can be tested.
 *
 * **The invariant this file exists to guarantee: skipping lands on exactly the
 * `ViewState` that watching lands on.** It holds by construction, not by
 * matching two code paths: both watching and skipping fold the *same* event list
 * in the *same* order through `applyEvent`, which stays the single source of
 * truth. Cues only decorate that fold — a renderer may drop every animation and
 * the resulting board is unchanged.
 *
 * Turn progression is deliberately decoupled from animation completion: the
 * caller advances phases, and how long (or whether) it animates is its business.
 * `app.ts` used to `await sleep()`, which becomes wrong the moment M3 owns the
 * decision clock.
 */

import { PHASES, type GameState, type Phase, type TurnEvent } from '@cards/engine';
import { applyEvent, initView, segmentByPhase, type ViewState } from './playback.js';
import { choreograph, type Cue } from './choreograph.js';

export interface TurnPlayer {
  /** The live view — mutated in place as phases are applied. */
  readonly view: ViewState;
  /** The whole turn's cue timeline (A2). */
  readonly cues: readonly Cue[];
  /** Phases not yet applied, in order. */
  remainingPhases(): Phase[];
  /** Apply the next phase's events; returns it, or undefined when the turn is done. */
  advancePhase(): { phase: Phase; events: TurnEvent[]; cues: Cue[] } | undefined;
  /** Apply every remaining event at once (the skip button). */
  skip(): void;
  done(): boolean;
}

/** Cues belonging to `phase`, i.e. from its banner up to the next phase's banner. */
export function cuesOfPhase(cues: readonly Cue[], phase: Phase): Cue[] {
  const start = cues.find((c) => c.kind === 'phase' && c.phase === phase);
  if (start === undefined) return [];
  const laterBanners = cues.filter((c) => c.kind === 'phase' && c.t > start.t).map((c) => c.t);
  const end = laterBanners.length > 0 ? Math.min(...laterBanners) : Infinity;
  return cues.filter((c) => c.t >= start.t && c.t < end);
}

/**
 * Build a player for one resolved turn. `prev` is the pre-turn state the log
 * applies to; nothing here mutates it (`initView` snapshots it).
 */
export function createTurnPlayer(prev: GameState, events: readonly TurnEvent[]): TurnPlayer {
  const view = initView(prev);
  const cues = choreograph(events);
  const segments = segmentByPhase(events);
  let next = 0;

  const applySegment = (index: number): void => {
    for (const e of segments[index]!.events) applyEvent(view, e);
  };

  return {
    view,
    cues,
    remainingPhases: () => segments.slice(next).map((s) => s.phase),
    advancePhase() {
      if (next >= segments.length) return undefined;
      const segment = segments[next]!;
      applySegment(next);
      next += 1;
      return { phase: segment.phase, events: segment.events, cues: cuesOfPhase(cues, segment.phase) };
    },
    skip() {
      while (next < segments.length) {
        applySegment(next);
        next += 1;
      }
    },
    done: () => next >= segments.length,
  };
}

/** Every phase in canonical order — re-exported so callers need not import PHASES. */
export const ALL_PHASES: readonly Phase[] = PHASES;
