export * from './types.js';
export * from './constants.js';
export * from './validate.js';
export * from './board.js';
export * from './status.js';
export * from './movement.js';
export * from './vision.js';
export * from './shapes.js';

import type { GameState, MapDef, PlayerOrders, TurnResult } from './types.js';

/**
 * Resolve one full turn: Prep → Dash → Blast → Move.
 *
 * NOT YET IMPLEMENTED — this is the M1 milestone. See docs/BACKLOG.md items 1–12.
 * Must remain a pure, deterministic function (CLAUDE.md golden rule #1).
 */
export function resolveTurn(
  _state: GameState,
  _map: MapDef,
  _orders: [PlayerOrders, PlayerOrders],
): TurnResult {
  throw new Error('resolveTurn is not implemented yet — see docs/BACKLOG.md (M1)');
}
