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
 * SCOPE — grows one backlog item at a time. Item 4 built order validation,
 * phase bucketing, the execution loop, and Move resolution. Item 5 adds combat
 * economy: Blast-phase damage (Might/Weaken → cover → shields → HP), on-hit and
 * passive (+5, end of turn) energy, and the ultimate's on-use energy reset.
 *
 * Still deferred to their own items: statuses apply/refresh/tick and cooldown
 * ticking (6), dash movement (7), knockback (8), traps (9), and deaths/respawn/
 * win plus the turn-counter advance (10). A unit reduced to 0 HP is left at 0
 * here — nothing yet removes it or awards a kill. Non-damage ability effects
 * (buffs, shields, heals) are logged as `abilityFired` but not yet applied.
 */

import { type Board, buildBoard, vecKey } from './board.js';
import { applyDamage, scaleDamage, scaleEnergyGain } from './combat.js';
import { PASSIVE_ENERGY } from './constants.js';
import { coverReducedDamage, isBehindCover } from './cover.js';
import { validateOrders } from './orders.js';
import { type MovePlan, resolveMovePhase } from './movement.js';
import { abilityOf, isUltimate, type Roster } from './roster.js';
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
    // Spending the ultimate's energy is an "on use" cost, so it happens here for
    // whatever phase the ult is tagged with. Non-damage effects (buffs, shields,
    // heals, dash movement, knockback, traps) are still later items — the shot
    // is logged, and in Blast its damage lands (below).
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
      if (isUltimate(roster, unit.characterId, fired.order.abilityId)) unit.energy = 0;
    }

    // Blast damage resolves after every shot in the phase is fired, so it reads
    // as "everyone shoots, then all damage lands simultaneously" (GAME_SPEC §2).
    if (phase === 'blast') resolveBlastDamage(board, next, abilityByUnit, roster, events);
  }

  // End of turn: the passive energy drip (GAME_SPEC §5). Living units only —
  // the dead retain energy but do not gain (see docs/DECISIONS.md). Turn-counter
  // advance, cooldown/status ticks, respawn and the win check are items 6/10.
  for (const unit of next.units) {
    if (!unit.alive) continue;
    unit.energy += PASSIVE_ENERGY;
    events.push({ type: 'energyGained', unitId: unit.unitId, amount: PASSIVE_ENERGY });
  }

  return { state: next, events };
}

/**
 * Apply Blast-phase damage. For each attacker that fired a damaging Blast
 * ability, every living enemy standing on an aimed square takes
 * `scaleDamage` (attacker Might/Weaken) → cover reduction (item 3) → shields →
 * HP. An ability that lands on ≥1 enemy grants its `energyGain` once
 * (Energized-scaled) to the caster (GAME_SPEC §4, edge-cases "Energy on
 * multi-hit"). Mutates `next` and appends `damage`/`energyGained` events.
 *
 * Interim targeting contract (until shape expansion exists): the "aimed squares"
 * are the order's raw target squares — line/cone/circle are not yet expanded, so
 * a hit is an enemy standing exactly on a targeted square. Applying attacks in
 * caster order is deterministic and simultaneity-faithful: an attacker's damage
 * depends only on its own statuses and the defender's fixed position/cover, and
 * cumulative damage to one defender is order-independent.
 */
function resolveBlastDamage(
  board: Board,
  next: GameState,
  abilityByUnit: ReadonlyMap<string, { def: AbilityDef; order: AbilityOrder }>,
  roster: Roster,
  events: TurnEvent[],
): void {
  for (const attacker of next.units) {
    if (!attacker.alive) continue;
    const fired = abilityByUnit.get(attacker.unitId);
    if (fired === undefined || fired.def.phase !== 'blast') continue;
    const damage = fired.def.effects.find((e) => e.kind === 'damage');
    if (damage?.amount === undefined) continue;

    const aimed = new Set(fired.order.target.map(vecKey));
    let hitEnemy = false;
    for (const target of next.units) {
      if (target.owner === attacker.owner || !target.alive) continue;
      if (!aimed.has(vecKey(target.pos))) continue;
      const scaled = scaleDamage(damage.amount, attacker);
      const dealt = isBehindCover(board, attacker.pos, target.pos, fired.def.range)
        ? coverReducedDamage(scaled)
        : scaled;
      const result = applyDamage(target, dealt);
      target.hp = result.unit.hp;
      target.statuses = result.unit.statuses;
      events.push({ type: 'damage', unitId: target.unitId, amount: result.hpDamage, absorbed: result.absorbed });
      hitEnemy = true;
    }

    if (hitEnemy && fired.def.energyGain > 0) {
      const gained = scaleEnergyGain(fired.def.energyGain, attacker);
      attacker.energy += gained;
      events.push({ type: 'energyGained', unitId: attacker.unitId, amount: gained });
    }
  }
}
