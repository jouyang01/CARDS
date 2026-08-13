/**
 * Move-phase movement: budgets, cost-based reachability, and path validation.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1). Integer math only —
 * percentage modifiers are applied as `floor(base * pct / 100)`.
 *
 * Rules implemented here (GAME_SPEC §3, §6 and docs/design/edge-cases.md):
 * - up to MOVE_RANGE budget with an ability, SPRINT_RANGE when sprinting;
 * - Haste +50% / Slow −50% of the base budget, round down;
 * - Root forbids Move-phase movement entirely (it does not cancel a dash);
 * - **Manhattan movement (MET1):** the move set stays 8-directional (MV3), but an
 *   orthogonal step costs 1 and **every diagonal costs 2** — so a diagonal is
 *   never a shortcut, only a convenience, and a diagonally adjacent tile is
 *   distance 2. A diagonal may not cut the corner of a wall/cover square. Cost
 *   no longer depends on path history, so reachability is a plain integer
 *   Dijkstra (MV3's parity state is superseded);
 * - walls and cover block entry and pass-through; any other living unit is
 *   walk-through but not a legal *endpoint* (MV2, edge-cases "AR movement model").
 *
 * Nothing here mutates game state.
 */

import {
  type Board,
  blocksMovement,
  diagonalCornerBlocked,
  inBounds,
  isAdjacentStep,
  isDiagonalStep,
  MOVE_STEPS,
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

/**
 * Squares held by any living unit other than `mover`. Under the Atlas Reactor
 * movement model (MV2, edge-cases "AR movement model"), a unit — ally OR enemy —
 * may be moved *through* but never *ended* on; only walls/cover/edge block a
 * path outright. So this is the set of walk-through-not-endpoint squares.
 */
export function occupiedByOthers(state: GameState, mover: UnitState): Set<string> {
  const out = new Set<string>();
  for (const u of state.units) {
    if (!u.alive || u.unitId === mover.unitId) continue;
    out.add(vecKey(u.pos));
  }
  return out;
}

// ── Reachability ────────────────────────────────────────────────────────────

export interface ReachableSquare {
  pos: Vec2;
  /** Minimum movement cost from the unit's current square (1..budget). */
  cost: number;
  /** Square stepped from on the min-cost path, for reconstruction. Absent for the origin. */
  from?: Vec2;
  /**
   * Whether the unit may *stop* here. False for a unit-occupied square: the path
   * may pass through it (so it stays reachable for reconstruction) but it is not
   * a legal destination.
   */
  canStop: boolean;
}

/**
 * Cost of one step under the Manhattan metric (MET1): an orthogonal step costs
 * 1, a diagonal costs **2** — a diagonal is exactly two orthogonal steps' worth
 * of ground, which is what makes a diagonally adjacent tile distance 2.
 *
 * Diagonals remain *legal* (the 8-direction move set from MV3 stands); they are
 * simply never cheaper than going around, so this is a convenience, not a
 * shortcut. MV3's 1/2-alternation parity cost is superseded.
 */
export const stepCost = (dx: number, dy: number): number => (dx !== 0 && dy !== 0 ? 2 : 1);

/**
 * Reachability from a unit's current square under the Manhattan cost model.
 *
 * With every diagonal a flat 2, cost no longer depends on the path's history,
 * so MV3's `(square, parity)` search state collapses to plain `square` and this
 * is an ordinary Dijkstra over an integer bucket queue. Expansion follows the
 * fixed `MOVE_STEPS` order, so the result is deterministic.
 *
 * Returns one entry per reachable square (excluding the origin) in ascending
 * cost order; `from` links form a min-cost tree, so walking them back from any
 * square yields a legal path of exactly that `cost` — see `reconstructPath`.
 */
export function reachableSquares(
  board: Board,
  state: GameState,
  unit: UnitState,
  budget: number,
): ReachableSquare[] {
  const results: ReachableSquare[] = [];
  if (budget <= 0 || !inBounds(board, unit.pos)) return results;

  const occupied = occupiedByOthers(state, unit);
  const dist = new Map<string, number>([[vecKey(unit.pos), 0]]);
  const from = new Map<string, Vec2>(); // square → predecessor on its min-cost path

  const buckets: Vec2[][] = [];
  const enqueue = (p: Vec2, cost: number): void => {
    (buckets[cost] ??= []).push(p);
  };
  enqueue(unit.pos, 0);

  const recorded = new Set<string>([vecKey(unit.pos)]); // origin excluded from output

  for (let cost = 0; cost <= budget; cost++) {
    for (const node of buckets[cost] ?? []) {
      const key = vecKey(node);
      if (dist.get(key) !== cost) continue; // a cheaper relaxation superseded this entry

      // First finalisation of a non-origin square = its minimum cost.
      if (!recorded.has(key)) {
        recorded.add(key);
        results.push({ pos: node, cost, from: from.get(key), canStop: !occupied.has(key) });
      }

      for (const d of MOVE_STEPS) {
        const np: Vec2 = { x: node.x + d.x, y: node.y + d.y };
        if (blocksMovement(board, np)) continue; // walls/cover/edge block entry
        if (d.x !== 0 && d.y !== 0 && diagonalCornerBlocked(board, node, d.x, d.y)) continue;
        const nc = cost + stepCost(d.x, d.y);
        if (nc > budget) continue;
        const nkey = vecKey(np);
        const prior = dist.get(nkey);
        if (prior === undefined || nc < prior) {
          dist.set(nkey, nc);
          from.set(nkey, node);
          enqueue(np, nc);
        }
      }
    }
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
  | { code: 'notAdjacent'; index: number }
  | { code: 'cornerBlocked'; index: number }
  | { code: 'outOfBounds'; index: number }
  | { code: 'blockedTerrain'; index: number; terrain: TerrainKind }
  | { code: 'occupied'; index: number };

export type MovePathCheck = { valid: true; cost: number } | { valid: false; error: MovePathError };

/**
 * Validate a submitted Move-phase path against the board, other units, and the
 * unit's budget. An empty path is "hold position" and is always valid.
 *
 * Each entry in `path` is a square the unit steps onto, in order; the unit's
 * current square is not included. Steps may be orthogonal or diagonal; a
 * diagonal may not cut a wall/cover corner and costs 2 budget (MET1).
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
  const occupied = occupiedByOthers(state, unit);
  const last = path.length - 1;
  let prev = unit.pos;
  let cost = 0;
  for (const [i, p] of path.entries()) {
    if (!inBounds(board, p)) return { valid: false, error: { code: 'outOfBounds', index: i } };
    if (!isAdjacentStep(prev, p)) return { valid: false, error: { code: 'notAdjacent', index: i } };
    if (blocksMovement(board, p)) {
      return {
        valid: false,
        error: { code: 'blockedTerrain', index: i, terrain: terrainAt(board, p) as TerrainKind },
      };
    }
    if (isDiagonalStep(prev, p) && diagonalCornerBlocked(board, prev, p.x - prev.x, p.y - prev.y)) {
      return { valid: false, error: { code: 'cornerBlocked', index: i } };
    }
    cost += stepCost(p.x - prev.x, p.y - prev.y); // a diagonal costs 2 (MET1)
    if (cost > budget) return { valid: false, error: { code: 'exceedsBudget', budget, cost } };
    // Any unit — ally or enemy — may be passed through, but the path may not
    // *end* on an occupied square (MV2, edge-cases "AR movement model").
    if (occupied.has(vecKey(p)) && i === last) {
      return { valid: false, error: { code: 'occupied', index: i } };
    }
    prev = p;
  }
  return { valid: true, cost };
}

/**
 * The longest prefix of `path` whose cumulative movement cost fits `budget`
 * (Manhattan cost, MET1). Used to re-clamp a planned path at Move time when a
 * Blast-phase Slow shrank the budget after the path was validated.
 */
export function pathWithinBudget(path: readonly Vec2[], origin: Vec2, budget: number): Vec2[] {
  const out: Vec2[] = [];
  let prev = origin;
  let cost = 0;
  for (const p of path) {
    cost += stepCost(p.x - prev.x, p.y - prev.y);
    if (cost > budget) break;
    out.push(p);
    prev = p;
  }
  return out;
}
