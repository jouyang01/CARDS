/**
 * Order validation: is a submitted set of `PlayerOrders` legal against the
 * current state, board and roster?
 *
 * Pure and deterministic (CLAUDE.md golden rule #1). Like `validate.ts` for
 * content, this returns a list of structured errors in a fixed scan order
 * (players in the order given, then each player's units in order) — the same
 * bad orders always produce the same errors. `resolveTurn` rejects a turn when
 * this is non-empty; the M3 server will instead use it to sanitise a timed-out
 * player down to "hold" (GAME_SPEC §2), which is why validation is separated
 * from resolution.
 *
 * Scope note (BACKLOG item 4, "no abilities yet beyond a test dummy"): this
 * checks the *structural* legality of an order — who may act, whether the
 * ability exists and is available, whether the move path is walkable. It does
 * not yet check an ability's shape/range geometry against its target beyond
 * bounds; that lands when abilities actually resolve (items 5+).
 */

import { type Board, inBounds } from './board.js';
import { ULT_COST } from './constants.js';
import { validateMovePath } from './movement.js';
import { abilityOf, isUltimate, type Roster } from './roster.js';
import type { GameState, PlayerId, PlayerOrders } from './types.js';

export type OrderErrorCode =
  | 'unknownUnit' // no unit with this id
  | 'notYourUnit' // unit belongs to the other player
  | 'duplicateOrder' // the same unit ordered twice by one player
  | 'deadUnit' // a dead unit was given something to do
  | 'sprintWithAbility' // sprint is move-only (GAME_SPEC §2/§3)
  | 'unknownAbility' // the character has no such ability
  | 'abilityOnCooldown' // ability's cooldown has not elapsed
  | 'notEnoughEnergy' // ultimate used below ULT_COST
  | 'badTarget' // missing / out-of-bounds aim for a non-self ability
  | 'badMovePath'; // move path fails validateMovePath (detail = its code)

export interface OrderError {
  player: PlayerId;
  unitId: string;
  code: OrderErrorCode;
  /** For badMovePath: the underlying MovePathError code. For ability codes: the abilityId. */
  detail?: string;
}

/**
 * Validate every order in `orders`. Empty result = all legal. A malformed order
 * short-circuits its own remaining checks (an unknown unit is not also checked
 * for cooldowns) but never stops other orders from being reported, so one call
 * surfaces every independent problem.
 */
export function validateOrders(
  board: Board,
  state: GameState,
  roster: Roster,
  orders: readonly PlayerOrders[],
): OrderError[] {
  const errs: OrderError[] = [];
  const unitById = new Map(state.units.map((u) => [u.unitId, u] as const));

  for (const p of orders) {
    const orderedThisPlayer = new Set<string>();
    for (const o of p.units) {
      const fail = (code: OrderErrorCode, detail?: string): void => {
        errs.push({ player: p.player, unitId: o.unitId, code, detail });
      };

      const unit = unitById.get(o.unitId);
      if (unit === undefined) {
        fail('unknownUnit');
        continue;
      }
      if (unit.owner !== p.player) {
        fail('notYourUnit');
        continue;
      }
      if (orderedThisPlayer.has(o.unitId)) {
        fail('duplicateOrder');
        continue;
      }
      orderedThisPlayer.add(o.unitId);

      const hasAbility = o.ability !== undefined;
      const hasMove = (o.movePath?.length ?? 0) > 0;

      if (!unit.alive) {
        // A dead unit holds; anything else is a mistake, not a silent no-op.
        if (hasAbility || hasMove || o.sprint === true) fail('deadUnit');
        continue;
      }

      if (hasAbility) {
        const ability = o.ability!;
        if (o.sprint === true) fail('sprintWithAbility');
        const def = abilityOf(roster, unit.characterId, ability.abilityId);
        if (def === undefined) {
          fail('unknownAbility', ability.abilityId);
        } else {
          if ((unit.cooldowns[ability.abilityId] ?? 0) > 0) {
            fail('abilityOnCooldown', ability.abilityId);
          }
          if (isUltimate(roster, unit.characterId, ability.abilityId) && unit.energy < ULT_COST) {
            fail('notEnoughEnergy', ability.abilityId);
          }
          if (def.shape !== 'self') {
            const target = ability.target ?? [];
            if (target.length === 0 || target.some((q) => !inBounds(board, q))) fail('badTarget');
          }
        }
      }

      if (hasMove) {
        const check = validateMovePath(board, state, unit, o.movePath!, o.sprint === true);
        if (!check.valid) fail('badMovePath', check.error.code);
      }
    }
  }
  return errs;
}
