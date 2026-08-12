/**
 * Resolution playback: fold a `TurnEvent[]` into a view-model and group it by
 * phase so the UI can step Prep→Dash→Blast→Move. **Zero game logic** (Dev Note 1
 * — "the engine emits an event log so a 3D renderer can be swapped in later
 * without touching game logic"): this reads events and applies their stated
 * deltas; it never recomputes an outcome. A 3D renderer drops in behind the same
 * `applyEvent` stream.
 *
 * Known event-schema gaps (report, don't recompute): `statusApplied` carries no
 * shield `amount`, and there is no event for an ultimate's energy reset — so
 * shield pools and post-ult energy cannot be reconstructed from the log alone.
 * Positions, HP, alive/dead and kills are fully reproducible and are what
 * "reproduces the engine's final board" means here.
 */

import { PHASES, type GameState, type Phase, type TurnEvent, type Vec2 } from '@cards/engine';

export interface ViewUnit {
  unitId: string;
  owner: 0 | 1;
  pos: Vec2;
  hp: number;
  maxHp: number;
  energy: number;
  alive: boolean;
}

export interface ViewState {
  units: Map<string, ViewUnit>;
  kills: [number, number];
  status: GameState['status'];
  winner?: 0 | 1;
}

/** A view-model snapshot of the pre-turn state, ready to fold events into. */
export function initView(state: GameState): ViewState {
  const units = new Map<string, ViewUnit>();
  for (const u of state.units) {
    units.set(u.unitId, { unitId: u.unitId, owner: u.owner, pos: { ...u.pos }, hp: u.hp, maxHp: u.maxHp, energy: u.energy, alive: u.alive });
  }
  return { units, kills: [state.kills[0], state.kills[1]], status: state.status, winner: state.winner };
}

/** Apply one event's stated delta to the view. Never derives new game logic. */
export function applyEvent(view: ViewState, event: TurnEvent): void {
  switch (event.type) {
    case 'moveStep':
    case 'displaced': {
      const u = view.units.get(event.unitId);
      if (u) u.pos = { ...event.to };
      break;
    }
    case 'damage': {
      const u = view.units.get(event.unitId);
      if (u) u.hp = Math.max(0, u.hp - event.amount);
      break;
    }
    case 'heal': {
      const u = view.units.get(event.unitId);
      if (u) u.hp = Math.min(u.maxHp, u.hp + event.amount);
      break;
    }
    case 'energyGained': {
      const u = view.units.get(event.unitId);
      if (u) u.energy += event.amount;
      break;
    }
    case 'death': {
      const u = view.units.get(event.unitId);
      if (u) { u.alive = false; u.hp = 0; }
      view.kills[event.killer] += 1;
      break;
    }
    case 'respawn': {
      const u = view.units.get(event.unitId);
      if (u) { u.alive = true; u.hp = u.maxHp; u.pos = { ...event.pos }; }
      break;
    }
    case 'gameEnd': {
      view.status = event.result === 'draw' ? 'draw' : 'finished';
      if (event.result === 'win') view.winner = event.winner;
      break;
    }
    // phaseStart / abilityFired / statusApplied / trapPlaced / trapTriggered:
    // no board delta (HUD/animation cues only).
    default:
      break;
  }
}

/** Fold the whole log onto the pre-turn state, yielding the final view. */
export function playEvents(state: GameState, events: readonly TurnEvent[]): ViewState {
  const view = initView(state);
  for (const e of events) applyEvent(view, e);
  return view;
}

/** The phaseStart order in the log — always Prep→Dash→Blast→Move. */
export function phaseSequence(events: readonly TurnEvent[]): Phase[] {
  return events.filter((e) => e.type === 'phaseStart').map((e) => (e as { phase: Phase }).phase);
}

export interface PhaseSegment {
  phase: Phase;
  /** Events belonging to this phase (everything up to the next phaseStart). */
  events: TurnEvent[];
}

/**
 * Split the log into per-phase segments for stepped playback. Events before the
 * first `phaseStart` (there are none in practice) are dropped. Every phase in
 * `PHASES` gets a segment even if empty, in the canonical order.
 */
export function segmentByPhase(events: readonly TurnEvent[]): PhaseSegment[] {
  const segments: PhaseSegment[] = [];
  let current: PhaseSegment | undefined;
  for (const e of events) {
    if (e.type === 'phaseStart') {
      current = { phase: e.phase, events: [] };
      segments.push(current);
    } else if (current) {
      current.events.push(e);
    }
  }
  // Guarantee canonical order/coverage for a well-formed log.
  const byPhase = new Map(segments.map((s) => [s.phase, s]));
  return PHASES.map((p) => byPhase.get(p) ?? { phase: p, events: [] });
}
