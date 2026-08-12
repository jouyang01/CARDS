/**
 * Cover: directional damage reduction (GAME_SPEC §3 "Cover", §7 constants).
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): exact integer geometry,
 * no randomness, no clock, no I/O, no floating point.
 *
 * The rule, restated: a defender is behind cover against a given attack when
 *
 *   1. the defender's square is **orthogonally adjacent** to a `cover` square,
 *   2. the straight line from the attacker's square-centre to the defender's
 *      square-centre **crosses the side those two squares share** (cover is
 *      directional — a wall of sandbags to your north does nothing about a shot
 *      from the east), and
 *   3. the attack is not melee: abilities of `range <= 1` ignore cover.
 *
 * When all three hold, the hit's damage is reduced by `COVER_REDUCTION_PCT`,
 * rounded down (`coverReducedDamage`). Applying that reduction to real damage is
 * the damage system's job (BACKLOG item 5); this module only answers *whether*
 * cover applies and *by how much*, so both are unit-testable in isolation.
 *
 * The "crosses the covered side" test is not re-derived here: it reuses
 * `segmentCrossesSquare` from `vision.ts`, the same doubled-coordinate segment
 * kernel line-of-sight is built on. A line that merely grazes the corner shared
 * by the defender and its cover does not count as crossing the side — the same
 * permissive corner convention line of sight uses. See docs/DECISIONS.md.
 *
 * Nothing here mutates game state.
 */

import { type Board, ORTHOGONAL_STEPS, terrainAt } from './board.js';
import { COVER_REDUCTION_PCT } from './constants.js';
import type { Vec2 } from './types.js';
import { segmentCrossesSquare } from './vision.js';

/**
 * Is `defender` behind cover against an attack fired from `attacker` by an
 * ability of the given `abilityRange`?
 *
 * `abilityRange` is the ability's declared reach, not the distance actually
 * flown: a melee ability (`range <= 1`) always ignores cover, even when the two
 * units happen to be far apart on a free-aimed line.
 *
 * Cover is granted by *any* qualifying adjacent cover square; the reduction is a
 * flat 50% either way, so a defender hugging two cover squares is not doubly
 * protected. Only orthogonal neighbours are considered — a cover square touching
 * the defender only at a corner shares no side to shoot across.
 */
export function isBehindCover(
  board: Board,
  attacker: Vec2,
  defender: Vec2,
  abilityRange: number,
): boolean {
  if (abilityRange <= 1) return false; // melee ignores cover (GAME_SPEC §3)
  for (const d of ORTHOGONAL_STEPS) {
    const coverSquare: Vec2 = { x: defender.x + d.x, y: defender.y + d.y };
    if (terrainAt(board, coverSquare) !== 'cover') continue;
    // The segment ends inside the defender's square, so entering the cover
    // square's interior is exactly crossing the side the two of them share.
    if (segmentCrossesSquare(attacker, defender, coverSquare)) return true;
  }
  return false;
}

/**
 * Damage remaining after cover's reduction: `floor(damage * (100 - PCT) / 100)`.
 *
 * Round-down on the surviving damage, matching the house rule for every other
 * percentage modifier in the engine (Might/Weaken/Haste/Slow apply `floor` to
 * the outgoing value, not to the delta) — so 15 → 7, not 8. Integer in, integer
 * out; callers only invoke this once `isBehindCover` is true.
 */
export function coverReducedDamage(damage: number): number {
  return Math.floor((damage * (100 - COVER_REDUCTION_PCT)) / 100);
}
