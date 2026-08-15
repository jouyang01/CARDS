/**
 * Resolution playback: fold a `TurnEvent[]` into a view-model and group it by
 * phase so the UI can step Prep→Dash→Blast→Move. **Zero game logic** (Dev Note 1
 * — "the engine emits an event log so a 3D renderer can be swapped in later
 * without touching game logic"): this reads events and applies their stated
 * deltas; it never recomputes an outcome. A 3D renderer drops in behind the same
 * `applyEvent` stream.
 *
 * The schema is complete for the HUD (S1, edge-cases "Rendering contract"):
 * `statusApplied` carries the shield pool as `amount`, `damage` carries the shield
 * `absorbed`, and `energySpent` mirrors `energyGained` — so positions, HP, alive/dead,
 * kills, shields and energy are all reproducible from the log alone, no recomputation.
 */

import { PHASES, type EffectKind, type GameState, type Phase, type TurnEvent, type Vec2 } from '@cards/engine';

export interface ViewUnit {
  unitId: string;
  owner: 0 | 1;
  pos: Vec2;
  hp: number;
  maxHp: number;
  energy: number;
  alive: boolean;
  /** Remaining shield pool, tracked from statusApplied(shield).amount − damage.absorbed. */
  shield: number;
  /**
   * Live statuses, folded from the `statusApplied` / `statusRemoved` pair
   * (STATUS-AUDIT). Set, not array: refresh-not-stack means presence is the only
   * question a pip asks, and a re-application must not double the row.
   */
  statuses: Set<EffectKind>;
}

/** A placed trap in the view (TRAP-INDICATOR) — folded from the log like a decoy. */
export interface ViewTrap {
  id: string;
  owner: 0 | 1;
  pos: Vec2;
}

/** A Wisp decoy in the view (rendered to the enemy team as Wisp — R2). */
export interface ViewDecoy {
  id: string;
  teamId: 0 | 1;
  pos: Vec2;
}

export interface ViewState {
  units: Map<string, ViewUnit>;
  /** Live decoys, keyed by id — spawned/removed straight from the event log. */
  decoys: Map<string, ViewDecoy>;
  /** Live traps, keyed by id — placed and consumed straight from the event log. */
  traps: Map<string, ViewTrap>;
  kills: [number, number];
  status: GameState['status'];
  winner?: 0 | 1;
}

/** A view-model snapshot of the pre-turn state, ready to fold events into. */
export function initView(state: GameState): ViewState {
  const units = new Map<string, ViewUnit>();
  for (const u of state.units) {
    const shield = u.statuses.filter((s) => s.kind === 'shield' && s.remaining > 0).reduce((sum, s) => sum + (s.amount ?? 0), 0);
    const statuses = new Set<EffectKind>(u.statuses.filter((s) => s.remaining > 0).map((s) => s.kind));
    units.set(u.unitId, { unitId: u.unitId, owner: u.owner, pos: { ...u.pos }, hp: u.hp, maxHp: u.maxHp, energy: u.energy, alive: u.alive, shield, statuses });
  }
  const decoys = new Map<string, ViewDecoy>();
  for (const d of state.decoys) decoys.set(d.id, { id: d.id, teamId: d.teamId, pos: { ...d.pos } });
  const traps = new Map<string, ViewTrap>();
  for (const t of state.traps) traps.set(t.id, { id: t.id, owner: t.owner, pos: { ...t.pos } });
  return { units, decoys, traps, kills: [state.kills[0], state.kills[1]], status: state.status, winner: state.winner };
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
      if (u) {
        u.shield = Math.max(0, u.shield - event.absorbed);
        u.hp = Math.max(0, u.hp - event.amount);
      }
      break;
    }
    case 'statusApplied': {
      const u = view.units.get(event.unitId);
      if (u === undefined) break;
      if (event.status === 'shield' && event.amount !== undefined) u.shield = event.amount;
      u.statuses.add(event.status);
      break;
    }
    case 'statusRemoved': {
      // Broken early or expired at the tick — either way the engine said so, so
      // the view drops it rather than working out durations for itself.
      view.units.get(event.unitId)?.statuses.delete(event.status);
      break;
    }
    case 'energySpent': {
      const u = view.units.get(event.unitId);
      if (u) u.energy = Math.max(0, u.energy - event.amount);
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
      if (u) { u.alive = false; u.hp = 0; u.shield = 0; u.statuses.clear(); }
      view.kills[event.killer] += 1;
      break;
    }
    case 'respawn': {
      const u = view.units.get(event.unitId);
      if (u) { u.alive = true; u.hp = u.maxHp; u.shield = 0; u.statuses.clear(); u.pos = { ...event.pos }; }
      break;
    }
    case 'trapPlaced': {
      view.traps.set(event.trapId, { id: event.trapId, owner: event.owner, pos: { ...event.pos } });
      break;
    }
    case 'trapTriggered':
    case 'trapExpired': {
      // Two ways a trap leaves the board — somebody stepped on it, or it ran out
      // its life (TRAP-LIFETIME) — and the marker goes with it either way. A
      // marker over a square that is no longer dangerous is worse than none.
      view.traps.delete(event.trapId);
      break;
    }
    case 'decoySpawned': {
      view.decoys.set(event.decoyId, { id: event.decoyId, teamId: event.teamId, pos: { ...event.pos } });
      break;
    }
    case 'decoyDestroyed': {
      view.decoys.delete(event.decoyId);
      break;
    }
    case 'gameEnd': {
      view.status = event.result === 'draw' ? 'draw' : 'finished';
      if (event.result === 'win') view.winner = event.winner;
      break;
    }
    // phaseStart / abilityFired: no board delta.
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
