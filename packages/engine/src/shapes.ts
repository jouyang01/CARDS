/**
 * Ability shape expansion: turn an aimed order into the exact set of board
 * squares an ability covers.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): integer geometry only, no
 * randomness, no clock, no I/O, no floating point. Given the same
 * `(board, ability, casterPos, aim)` the affected-square list is always the
 * same, in the same order.
 *
 * Free-aim (GAME_SPEC §2): the player picks squares/directions during Decision;
 * abilities do not track. This module answers "given that aim, which squares are
 * hit" — it does not decide who is standing there. Nothing here mutates state.
 *
 * Shape rulings (judgment calls the spec left open — see docs/DECISIONS.md):
 * - **line** fires as a straight ray in one of the 8 compass directions derived
 *   from caster→aim; it pierces and stops at the first wall (cover does not stop
 *   it — cover blocks movement, not line of sight, GAME_SPEC §3).
 * - **cone** fires along the dominant cardinal of caster→aim and widens by one
 *   square of half-width per step of depth (a ~45° wedge).
 * - **circle** is a true Euclidean disk (dx²+dy² ≤ r²) centred on the aimed
 *   square — round, not a Chebyshev block.
 * - aimed-square reach (square/circle centre) is measured in Chebyshev squares,
 *   matching the vision metric in GAME_SPEC §3.
 * Walls and out-of-bounds squares are excluded from every area.
 */

import {
  type Board,
  chebyshev,
  inBounds,
  terrainAt,
  vecKey,
} from './board.js';
import type { AbilityDef, Vec2 } from './types.js';

/** Sign of a number as a unit step component. */
export function sign(n: number): -1 | 0 | 1 {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** Unit step toward `to`, each component in {-1,0,1} (one of the 8 dirs, or 0). */
export function direction8(from: Vec2, to: Vec2): Vec2 {
  return { x: sign(to.x - from.x), y: sign(to.y - from.y) };
}

/**
 * The cardinal (N/E/S/W) that best matches `from`→`to`. Ties on the diagonal
 * resolve to the horizontal axis, deterministically. Cones snap to this so their
 * geometry stays integer and grid-aligned.
 */
export function dominantCardinal(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: sign(dx), y: 0 };
  return { x: 0, y: sign(dy) };
}

/** Squares along a compass ray, caster excluded, stopping before the first wall. */
export function lineSquares(board: Board, from: Vec2, dir: Vec2, range: number): Vec2[] {
  const out: Vec2[] = [];
  for (let d = 1; d <= range; d++) {
    const p: Vec2 = { x: from.x + dir.x * d, y: from.y + dir.y * d };
    if (!inBounds(board, p)) break;
    if (terrainAt(board, p) === 'wall') break;
    out.push(p);
  }
  return out;
}

/**
 * An expanding cardinal cone, caster excluded. At depth `d` the wedge spans a
 * half-width of `d − 1`, so depth 1 is a single square and each further step
 * widens by one square on each side. Wall squares in the wedge are dropped but
 * do not occlude squares behind them (v1 keeps cones simple; see DECISIONS.md).
 */
export function coneSquares(board: Board, from: Vec2, cardinal: Vec2, range: number): Vec2[] {
  const perp: Vec2 = { x: -cardinal.y, y: cardinal.x };
  const out: Vec2[] = [];
  for (let d = 1; d <= range; d++) {
    const w = d - 1;
    for (let k = -w; k <= w; k++) {
      const p: Vec2 = {
        x: from.x + cardinal.x * d + perp.x * k,
        y: from.y + cardinal.y * d + perp.y * k,
      };
      if (!inBounds(board, p)) continue;
      if (terrainAt(board, p) === 'wall') continue;
      out.push(p);
    }
  }
  return out;
}

/**
 * A Euclidean disk (dx²+dy² ≤ radius²) centred on `center`, row-major order.
 * The comparison is integer so it is identical on every machine. Wall and
 * out-of-bounds squares are excluded.
 */
export function circleSquares(board: Board, center: Vec2, radius: number): Vec2[] {
  const out: Vec2[] = [];
  const r2 = radius * radius;
  for (let y = center.y - radius; y <= center.y + radius; y++) {
    for (let x = center.x - radius; x <= center.x + radius; x++) {
      const dx = x - center.x;
      const dy = y - center.y;
      if (dx * dx + dy * dy > r2) continue;
      const p: Vec2 = { x, y };
      if (!inBounds(board, p)) continue;
      if (terrainAt(board, p) === 'wall') continue;
      out.push(p);
    }
  }
  return out;
}

/**
 * Expand an ability's aim into the squares it affects.
 *
 * `aim` is the order's target array (GAME_SPEC §2): the aimed square for
 * `square`/`circle`, an endpoint indicating direction for `line`/`cone`, and the
 * traversed path itself for `path` (dashes). `self` ignores the aim. The result
 * excludes walls and out-of-bounds squares and is deterministically ordered.
 *
 * This says nothing about legality (range checks, passability) — the turn
 * pipeline validates the order before calling this. Missing aims yield an empty
 * area rather than throwing, so a malformed order simply hits nothing.
 */
export function expandShape(
  board: Board,
  ability: AbilityDef,
  casterPos: Vec2,
  aim: readonly Vec2[],
): Vec2[] {
  const target = aim[0];
  switch (ability.shape) {
    case 'self':
      return [{ x: casterPos.x, y: casterPos.y }];
    case 'square':
      return target !== undefined && inBounds(board, target) ? [target] : [];
    case 'circle': {
      if (target === undefined) return [];
      return circleSquares(board, target, ability.radius ?? 1);
    }
    case 'line': {
      if (target === undefined) return [];
      const dir = direction8(casterPos, target);
      if (dir.x === 0 && dir.y === 0) return [];
      return lineSquares(board, casterPos, dir, ability.range);
    }
    case 'cone': {
      if (target === undefined) return [];
      const card = dominantCardinal(casterPos, target);
      if (card.x === 0 && card.y === 0) return [];
      return coneSquares(board, casterPos, card, ability.range);
    }
    case 'path': {
      // The aim is the traversed path; only in-bounds squares survive. Dash
      // damage/first-target logic (BACKLOG item 7) reads the path itself.
      const seen = new Set<string>();
      const out: Vec2[] = [];
      for (const p of aim) {
        if (!inBounds(board, p)) continue;
        const k = vecKey(p);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(p);
      }
      return out;
    }
  }
}

/** Chebyshev reach of an aimed square from the caster (GAME_SPEC §3 metric). */
export function aimInRange(casterPos: Vec2, target: Vec2, range: number): boolean {
  return chebyshev(casterPos, target) <= range;
}
