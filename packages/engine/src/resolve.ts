/**
 * The turn pipeline: `resolveTurn` runs one full turn through the four sacred
 * phases and returns the new state plus the `TurnEvent[]` the client animates.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): a structural clone of the
 * input state is mutated and returned, so the caller's state is never touched;
 * no randomness, no clock, no I/O; iteration is over arrays and string-keyed
 * maps in fixed order.
 *
 * Phase order is sacred (CLAUDE.md golden rule #4): Prep → Dash → Blast → Move,
 * exactly `PHASES`. Every phase emits a `phaseStart` even when nobody acts, so
 * the event log always carries the full four-phase skeleton for playback.
 *
 * SCOPE — BACKLOG item 4, "turn pipeline skeleton, no abilities yet beyond a
 * test dummy": this wires up order validation, phase bucketing, and the
 * execution loop. Prep/Dash/Blast abilities are *fired* — an `abilityFired`
 * event is logged at the ability's tagged phase — but their effects are not yet
 * resolved. Damage, shields, statuses, dash movement, knockback, traps, deaths
 * and the end-of-turn economy (energy tick, cooldown tick, respawn, win check)
 * are their own backlog items (5–10) and are intentionally absent; the turn
 * counter is therefore left untouched here. Only the Move phase changes state,
 * via `resolveMovePhase`.
 */

import { buildBoard } from './board.js';
import { validateOrders } from './orders.js';
import { type MovePlan, resolveMovePhase } from './movement.js';
import { abilityOf, type Roster } from './roster.js';
import {
  type AbilityDef,
  type AbilityOrder,
  type GameState,
  type MapDef,
  PHASES,
  type PlayerOrders,
  type TurnEvent,
  type TurnResult,
  type Vec2,
} from './types.js';

/**
 * Resolve one turn. Throws if any order is invalid, listing every problem —
 * `resolveTurn` assumes pre-validated orders and refuses to guess (the M3
 * server sanitises timed-out players to "hold" before calling in; see
 * `validateOrders`). The throw is deterministic: same bad orders, same message.
 */
export function resolveTurn(
  state: GameState,
  map: MapDef,
  orders: readonly [PlayerOrders, PlayerOrders],
  roster: Roster,
): TurnResult {
  const board = buildBoard(map);

  const errors = validateOrders(board, state, roster, orders);
  if (errors.length > 0) {
    const detail = errors
      .map((e) => `[p${e.player} ${e.unitId}] ${e.code}${e.detail ? `(${e.detail})` : ''}`)
      .join('; ');
    throw new Error(`resolveTurn: invalid orders: ${detail}`);
  }

  // Work on a clone so the caller's state is never mutated (determinism/replay).
  const next: GameState = structuredClone(state) as GameState;
  const events: TurnEvent[] = [];

  // Index the validated orders by unitId once, then drive the phase loop off the
  // unit array so emission order is the (stable) state.units order.
  const abilityByUnit = new Map<string, { def: AbilityDef; order: AbilityOrder }>();
  const pathByUnit = new Map<string, readonly Vec2[]>();
  for (const p of orders) {
    for (const o of p.units) {
      if (o.ability !== undefined) {
        const unit = next.units.find((u) => u.unitId === o.unitId);
        // Validation guaranteed the unit exists, is alive, and owns this ability.
        const def = unit && abilityOf(roster, unit.characterId, o.ability.abilityId);
        if (def) abilityByUnit.set(o.unitId, { def, order: o.ability });
      }
      if (o.movePath && o.movePath.length > 0) pathByUnit.set(o.unitId, o.movePath);
    }
  }

  for (const phase of PHASES) {
    events.push({ type: 'phaseStart', phase });

    if (phase === 'move') {
      const plans: MovePlan[] = [];
      for (const unit of next.units) {
        const path = pathByUnit.get(unit.unitId);
        if (path && unit.alive) plans.push({ unitId: unit.unitId, path });
      }
      events.push(...resolveMovePhase(board, next, plans));
      continue;
    }

    // Prep / Dash / Blast: fire abilities tagged for this phase, in unit order.
    // Effects are resolved by later backlog items; the skeleton only logs the
    // shot and the squares it was aimed at.
    for (const unit of next.units) {
      const fired = abilityByUnit.get(unit.unitId);
      if (fired === undefined || fired.def.phase !== phase) continue;
      const area: Vec2[] =
        fired.def.shape === 'self'
          ? [{ x: unit.pos.x, y: unit.pos.y }]
          : fired.order.target.map((q) => ({ x: q.x, y: q.y }));
      events.push({
        type: 'abilityFired',
        unitId: unit.unitId,
        abilityId: fired.order.abilityId,
        area,
      });
    }
  }

  return { state: next, events };
}
