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
 * - **8-direction movement (MV3):** orthogonal steps cost 1; diagonal steps cost
 *   1, 2, 1, 2… — every *second* diagonal along a path costs 2 (AR cost model).
 *   A diagonal may not cut the corner of a wall/cover square. The reachable set
 *   is a shortest-cost search whose state carries the parity of diagonals used
 *   so far (the only bit that decides the next diagonal's cost) — integer and
 *   deterministic, no floats;
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
 * Cost of a diagonal step given how many diagonals were already taken along the
 * path. AR model: the 1st, 3rd, 5th… diagonal costs 1; the 2nd, 4th, 6th… costs
 * 2. So the cost depends only on `priorDiagonals % 2` — the search's parity bit.
 */
const diagonalStepCost = (priorDiagonals: number): number => (priorDiagonals % 2 === 0 ? 1 : 2);

/**
 * Reachability from a unit's current square under the 8-direction cost model
 * (MV3). A shortest-cost search (Dijkstra with a small integer bucket queue)
 * over states `(square, parity-of-diagonals-used)`; parity is the only history
 * the next diagonal's cost depends on, so it keeps the state space finite and
 * the result deterministic.
 *
 * Returns one entry per reachable square (excluding the origin), in ascending
 * cost order. `from` links form a coherent min-cost tree: within each cost
 * bucket the cheap-next-diagonal parity (0) is finalised first, so following
 * `from` back from any square yields a legal path of exactly that `cost` — see
 * `reconstructPath`.
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
  const stateKey = (p: Vec2, parity: number): string => `${p.x},${p.y},${parity}`;
  const dist = new Map<string, number>([[stateKey(unit.pos, 0), 0]]);
  const from = new Map<string, Vec2>(); // state → predecessor square

  // Bucket queue: buckets[cost][parity] preserves ascending-cost order, then
  // parity 0 before 1, then insertion order (fixed MOVE_STEPS expansion).
  const buckets: { pos: Vec2; parity: number }[][][] = [];
  const enqueue = (p: Vec2, parity: number, cost: number): void => {
    (buckets[cost] ??= [[], []])[parity]!.push({ pos: p, parity });
  };
  enqueue(unit.pos, 0, 0);

  const recorded = new Set<string>([vecKey(unit.pos)]); // origin excluded from output

  for (let cost = 0; cost <= budget; cost++) {
    const bucket = buckets[cost];
    if (bucket === undefined) continue;
    for (let parity = 0; parity <= 1; parity++) {
      for (const node of bucket[parity]!) {
        const key = stateKey(node.pos, node.parity);
        if (dist.get(key) !== cost) continue; // a cheaper relaxation superseded this entry

        // First finalisation of a non-origin square = its minimum cost.
        const sk = vecKey(node.pos);
        if (!recorded.has(sk)) {
          recorded.add(sk);
          results.push({ pos: node.pos, cost, from: from.get(key), canStop: !occupied.has(sk) });
        }

        for (const d of MOVE_STEPS) {
          const np: Vec2 = { x: node.pos.x + d.x, y: node.pos.y + d.y };
          if (blocksMovement(board, np)) continue; // walls/cover/edge block entry
          const diagonal = d.x !== 0 && d.y !== 0;
          if (diagonal && diagonalCornerBlocked(board, node.pos, d.x, d.y)) continue;
          const nc = cost + (diagonal ? diagonalStepCost(node.parity) : 1);
          if (nc > budget) continue;
          const nparity = diagonal ? node.parity ^ 1 : node.parity;
          const nkey = stateKey(np, nparity);
          const prior = dist.get(nkey);
          if (prior === undefined || nc < prior) {
            dist.set(nkey, nc);
            from.set(nkey, node.pos);
            enqueue(np, nparity, nc);
          }
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
 * current square is not included. Steps may be orthogonal or diagonal (MV3);
 * a diagonal may not cut a wall/cover corner, and every second diagonal along
 * the path costs 2 budget instead of 1.
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
  let diagonals = 0;
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
    if (isDiagonalStep(prev, p)) {
      if (diagonalCornerBlocked(board, prev, p.x - prev.x, p.y - prev.y)) {
        return { valid: false, error: { code: 'cornerBlocked', index: i } };
      }
      diagonals += 1;
      cost += diagonalStepCost(diagonals - 1); // every 2nd diagonal costs 2
    } else {
      cost += 1;
    }
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
 * The longest prefix of `path` whose cumulative movement cost fits `budget`,
 * under the MV3 diagonal cost model. Used to re-clamp a planned path at Move
 * time when a Blast-phase Slow shrank the budget after the path was validated.
 */
export function pathWithinBudget(path: readonly Vec2[], origin: Vec2, budget: number): Vec2[] {
  const out: Vec2[] = [];
  let prev = origin;
  let diagonals = 0;
  let cost = 0;
  for (const p of path) {
    if (isDiagonalStep(prev, p)) {
      diagonals += 1;
      cost += diagonalStepCost(diagonals - 1);
    } else {
      cost += 1;
    }
    if (cost > budget) break;
    out.push(p);
    prev = p;
  }
  return out;
}
