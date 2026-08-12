/**
 * Move-phase movement: budgets, BFS reachability, and path validation.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1). Integer math only —
 * percentage modifiers are applied as `floor(base * pct / 100)`.
 *
 * Rules implemented here (GAME_SPEC §3, §6 and docs/design/edge-cases.md):
 * - up to MOVE_RANGE squares with an ability, SPRINT_RANGE when sprinting;
 * - Haste +50% / Slow −50% of the base budget, round down;
 * - Root forbids Move-phase movement entirely (it does not cancel a dash);
 * - orthogonal steps only, so diagonal corner-cutting cannot occur;
 * - walls, cover and *any* other living unit block both entry and
 *   pass-through (edge-cases: "Pass-through", allies included in v1).
 *
 * Dash movement, contested squares and trap triggers are later backlog items;
 * nothing here mutates game state.
 */

import {
  type Board,
  blocksMovement,
  inBounds,
  isOrthogonalStep,
  ORTHOGONAL_STEPS,
  terrainAt,
  vecEq,
  vecKey,
} from './board.js';
import { HASTE_PCT, MOVE_RANGE, SLOW_PCT, SPRINT_RANGE } from './constants.js';
import { hasStatus } from './status.js';
import type { GameState, TerrainKind, UnitState, Vec2 } from './types.js';

// ── Statuses that bear on movement ──────────────────────────────────────────

/**
 * How many squares this unit may walk in the Move phase.
 *
 * Haste and Slow are summed as percentage deltas before the single round-down,
 * mirroring the Might/Weaken rule: holding both nets out to the base budget
 * (4 → 6 hasted, 4 → 2 slowed, 4 → 4 with both). Rooted or dead units get 0.
 */
export function movementBudget(unit: UnitState, sprint = false): number {
  if (!unit.alive) return 0;
  if (hasStatus(unit, 'root')) return 0;
  const base = sprint ? SPRINT_RANGE : MOVE_RANGE;
  const pct = 100 + (hasStatus(unit, 'haste') ? HASTE_PCT : 0) - (hasStatus(unit, 'slow') ? SLOW_PCT : 0);
  if (pct <= 0) return 0;
  return Math.floor((base * pct) / 100);
}

// ── Occupancy ───────────────────────────────────────────────────────────────

/**
 * Squares occupied by living units, excluding `exceptUnitId` (the mover).
 * Dead units are off the board and block nothing.
 */
export function occupiedSquares(state: GameState, exceptUnitId?: string): Set<string> {
  const out = new Set<string>();
  for (const u of state.units) {
    if (!u.alive) continue;
    if (exceptUnitId !== undefined && u.unitId === exceptUnitId) continue;
    out.add(vecKey(u.pos));
  }
  return out;
}

/** A square a unit may stand on or walk through this phase. */
export function isPassable(board: Board, occupied: ReadonlySet<string>, p: Vec2): boolean {
  return !blocksMovement(board, p) && !occupied.has(vecKey(p));
}

// ── Reachability ────────────────────────────────────────────────────────────

export interface ReachableSquare {
  pos: Vec2;
  /** Steps from the unit's current square (1..budget). */
  cost: number;
  /** Square stepped from, for path reconstruction. Absent for the origin. */
  from?: Vec2;
}

/**
 * Breadth-first reachability from a unit's current square.
 *
 * Returns squares in BFS order (ascending cost, then fixed neighbour order),
 * excluding the origin. Every returned square has a legal path of exactly
 * `cost` steps — see `reconstructPath`.
 */
export function reachableSquares(
  board: Board,
  state: GameState,
  unit: UnitState,
  budget: number,
): ReachableSquare[] {
  const results: ReachableSquare[] = [];
  if (budget <= 0 || !inBounds(board, unit.pos)) return results;

  const occupied = occupiedSquares(state, unit.unitId);
  const seen = new Set<string>([vecKey(unit.pos)]);
  let frontier: ReachableSquare[] = [{ pos: unit.pos, cost: 0 }];

  while (frontier.length > 0) {
    const next: ReachableSquare[] = [];
    for (const cur of frontier) {
      if (cur.cost >= budget) continue;
      for (const d of ORTHOGONAL_STEPS) {
        const p: Vec2 = { x: cur.pos.x + d.x, y: cur.pos.y + d.y };
        const k = vecKey(p);
        if (seen.has(k)) continue;
        if (!isPassable(board, occupied, p)) continue;
        seen.add(k);
        const square: ReachableSquare = { pos: p, cost: cur.cost + 1, from: cur.pos };
        results.push(square);
        next.push(square);
      }
    }
    frontier = next;
  }
  return results;
}

/** Index a reachability result by square key. */
export function reachableIndex(squares: readonly ReachableSquare[]): Map<string, ReachableSquare> {
  const m = new Map<string, ReachableSquare>();
  for (const s of squares) m.set(vecKey(s.pos), s);
  return m;
}

/**
 * Shortest legal path (first square = first step, origin excluded) to `target`,
 * or `null` when it is not reachable. Deterministic: BFS neighbour order fixes
 * the choice among equal-length paths.
 */
export function reconstructPath(
  squares: readonly ReachableSquare[],
  origin: Vec2,
  target: Vec2,
): Vec2[] | null {
  const index = reachableIndex(squares);
  let node = index.get(vecKey(target));
  if (node === undefined) return vecEq(origin, target) ? [] : null;
  const reversed: Vec2[] = [];
  while (node !== undefined) {
    reversed.push(node.pos);
    if (node.from === undefined || vecEq(node.from, origin)) break;
    node = index.get(vecKey(node.from));
  }
  return reversed.reverse();
}

// ── Path validation ─────────────────────────────────────────────────────────

export type MovePathError =
  | { code: 'rooted' }
  | { code: 'notMovable' }
  | { code: 'exceedsBudget'; budget: number; cost: number }
  | { code: 'notOrthogonal'; index: number }
  | { code: 'outOfBounds'; index: number }
  | { code: 'blockedTerrain'; index: number; terrain: TerrainKind }
  | { code: 'occupied'; index: number };

export type MovePathCheck = { valid: true; cost: number } | { valid: false; error: MovePathError };

/**
 * Validate a submitted Move-phase path against the board, other units, and the
 * unit's budget. An empty path is "hold position" and is always valid.
 *
 * Each entry in `path` is a square the unit steps onto, in order; the unit's
 * current square is not included. Steps must be orthogonal, so a path around a
 * wall corner costs one budget point per square — corner-cutting is impossible
 * rather than merely forbidden.
 */
export function validateMovePath(
  board: Board,
  state: GameState,
  unit: UnitState,
  path: readonly Vec2[],
  sprint = false,
): MovePathCheck {
  if (path.length === 0) return { valid: true, cost: 0 };
  if (!unit.alive) return { valid: false, error: { code: 'notMovable' } };
  if (hasStatus(unit, 'root')) return { valid: false, error: { code: 'rooted' } };

  const budget = movementBudget(unit, sprint);
  if (path.length > budget) {
    return { valid: false, error: { code: 'exceedsBudget', budget, cost: path.length } };
  }

  const occupied = occupiedSquares(state, unit.unitId);
  let prev = unit.pos;
  for (const [i, p] of path.entries()) {
    if (!inBounds(board, p)) return { valid: false, error: { code: 'outOfBounds', index: i } };
    if (!isOrthogonalStep(prev, p)) {
      return { valid: false, error: { code: 'notOrthogonal', index: i } };
    }
    if (blocksMovement(board, p)) {
      return {
        valid: false,
        error: { code: 'blockedTerrain', index: i, terrain: terrainAt(board, p) as TerrainKind },
      };
    }
    if (occupied.has(vecKey(p))) return { valid: false, error: { code: 'occupied', index: i } };
    prev = p;
  }
  return { valid: true, cost: path.length };
}
