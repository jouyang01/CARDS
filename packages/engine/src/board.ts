/**
 * Board geometry and terrain queries.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): no randomness, no clock,
 * no I/O, integer math only. Terrain is indexed once from a `MapDef` so every
 * lookup is O(1) and iteration order never depends on object key order.
 *
 * Line of sight / vision deliberately live elsewhere, in `vision.ts`.
 */

import type { CoverFacing, MapDef, TerrainKind, Vec2 } from './types.js';
import { isCoverEdge } from './types.js';
import { centre, edgeCorners, FACING_VEC, segmentsIntersect } from './geometry.js';

/** What occupies a square. `oob` = outside the map rectangle. */
export type SquareKind = 'open' | TerrainKind | 'oob';

export interface Board {
  readonly map: MapDef;
  readonly width: number;
  readonly height: number;
  /**
   * Row-major terrain index (`y * width + x`); `undefined` means open ground.
   * A flat array keeps lookups O(1) and iteration order stable. Both full-block
   * and edge cover index as `'cover'` here (so a tile still reads as cover);
   * `solidCover` and `coverFacings` carry the distinction that changes movement.
   */
  readonly terrain: readonly (TerrainKind | undefined)[];
  /** Keys (`x,y`) of v1 full-block cover — impassable, unlike edge cover. */
  readonly solidCover: ReadonlySet<string>;
  /** For edge-cover tiles, the set of faced edges (COVER-EDGE). */
  readonly coverFacings: ReadonlyMap<string, ReadonlySet<CoverFacing>>;
}

// ── Vector helpers ──────────────────────────────────────────────────────────

/** Stable string key for a square. Used for sets/maps; never for ordering. */
export const vecKey = (p: Vec2): string => `${p.x},${p.y}`;

export const vecEq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

export const manhattan = (a: Vec2, b: Vec2): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const chebyshev = (a: Vec2, b: Vec2): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * **The** distance metric (MET1, 2026-08-20): Manhattan, as in Atlas Reactor.
 * Range, movement and vision are all counted orthogonally, so a diagonally
 * adjacent tile is distance **2** — which is also why a diagonal step costs 2.
 *
 * Use this rather than `manhattan` directly at call sites that mean "how far
 * apart are these, in game terms": the indirection is what makes the metric one
 * decision instead of a dozen. `chebyshev` survives only where a rule genuinely
 * means "the 8 surrounding squares" (nothing in the current ruleset does).
 */
export const distance = manhattan;

/**
 * The four orthogonal directions.
 *
 * Movement is 8-directional (GAME_SPEC §3, MV3), but *vision* and *cover*
 * adjacency stay orthogonal, so this set remains the basis for those queries.
 *
 * Fixed order (north, east, south, west) so expansion is deterministic.
 */
export const ORTHOGONAL_STEPS: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/**
 * The four diagonal directions, clockwise from north-east.
 */
export const DIAGONAL_STEPS: readonly Vec2[] = [
  { x: 1, y: -1 }, // NE
  { x: 1, y: 1 }, // SE
  { x: -1, y: 1 }, // SW
  { x: -1, y: -1 }, // NW
];

/**
 * The eight movement steps: four orthogonal, four diagonal, in a fixed clockwise
 * order (N, NE, E, SE, S, SW, W, NW) so the movement search expands
 * deterministically. Movement is 8-directional (GAME_SPEC §3, MV3); every second
 * diagonal step costs 2 (see `movement.ts`). Corner-cutting past a solid is
 * governed by `diagonalCornerBlocked`.
 */
export const MOVE_STEPS: readonly Vec2[] = [
  { x: 0, y: -1 }, // N
  { x: 1, y: -1 }, // NE
  { x: 1, y: 0 }, // E
  { x: 1, y: 1 }, // SE
  { x: 0, y: 1 }, // S
  { x: -1, y: 1 }, // SW
  { x: -1, y: 0 }, // W
  { x: -1, y: -1 }, // NW
];

/** True when `b` is exactly one orthogonal step from `a`. */
export const isOrthogonalStep = (a: Vec2, b: Vec2): boolean => manhattan(a, b) === 1;

/** True when `b` is exactly one step — orthogonal or diagonal — from `a`. */
export const isAdjacentStep = (a: Vec2, b: Vec2): boolean => chebyshev(a, b) === 1;

/** True when the step from `a` to `b` is a single diagonal (both axes move). */
export const isDiagonalStep = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) === 1;

/**
 * A diagonal step may not cut the corner of a solid: it is blocked when either
 * of the two squares it passes between — the orthogonal neighbours shared by the
 * origin and destination — is a wall or cover (GAME_SPEC §3, edge-cases MV3).
 * Only terrain blocks a corner; units never do (they are walk-through anyway).
 */
export function diagonalCornerBlocked(board: Board, from: Vec2, dx: number, dy: number): boolean {
  return (
    blocksMovement(board, { x: from.x + dx, y: from.y }) ||
    blocksMovement(board, { x: from.x, y: from.y + dy })
  );
}

// ── Board construction & queries ────────────────────────────────────────────

/**
 * Index a map's terrain. Precedence when squares overlap: wall > cover > brush
 * (`validateMap` already rejects wall/cover overlap; brush over solid is
 * resolved here rather than trusted).
 */
export function buildBoard(map: MapDef): Board {
  const terrain = new Array<TerrainKind | undefined>(map.width * map.height).fill(undefined);
  const put = (p: Vec2, kind: TerrainKind, overwrite: boolean): void => {
    if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return;
    const i = p.y * map.width + p.x;
    if (!overwrite && terrain[i] !== undefined) return;
    terrain[i] = kind;
  };
  const solidCover = new Set<string>();
  const coverFacings = new Map<string, Set<CoverFacing>>();
  for (const p of map.brush) put(p, 'brush', true);
  for (const c of map.cover) {
    put(c, 'cover', true);
    const k = `${c.x},${c.y}`;
    if (isCoverEdge(c)) {
      const set = coverFacings.get(k) ?? new Set<CoverFacing>();
      set.add(c.facing);
      coverFacings.set(k, set);
    } else {
      solidCover.add(k);
    }
  }
  for (const p of map.walls) put(p, 'wall', true);
  return { map, width: map.width, height: map.height, terrain, solidCover, coverFacings };
}

/**
 * True when the step from `from` to `to` is blocked by a directional cover
 * barricade (COVER-EDGE) — the centre-to-centre line crosses a faced edge of
 * `from`, `to`, or (for a diagonal) either corner tile between them. Reuses the
 * same integer edge geometry as cover reduction, so a barricade you cannot shoot
 * a defender across is a barricade you cannot walk across either.
 */
export function coverEdgeBlocks(board: Board, from: Vec2, to: Vec2): boolean {
  if (board.coverFacings.size === 0) return false;
  const a = centre(from);
  const b = centre(to);
  const tiles: Vec2[] = [from, to];
  if (from.x !== to.x && from.y !== to.y) {
    tiles.push({ x: to.x, y: from.y }, { x: from.x, y: to.y });
  }
  for (const t of tiles) {
    const facings = board.coverFacings.get(`${t.x},${t.y}`);
    if (!facings) continue;
    for (const f of facings) {
      const [e1, e2] = edgeCorners(t, FACING_VEC[f]);
      if (segmentsIntersect(a, b, e1, e2)) return true;
    }
  }
  return false;
}

export function inBounds(board: Board, p: Vec2): boolean {
  return (
    Number.isInteger(p.x) &&
    Number.isInteger(p.y) &&
    p.x >= 0 &&
    p.y >= 0 &&
    p.x < board.width &&
    p.y < board.height
  );
}

export function terrainAt(board: Board, p: Vec2): SquareKind {
  if (!inBounds(board, p)) return 'oob';
  return board.terrain[p.y * board.width + p.x] ?? 'open';
}

/**
 * Walls and cover block movement and pass-through (GAME_SPEC §3); brush does
 * not. Out-of-bounds squares block too. Units are handled by the movement
 * module, which knows the game state.
 */
export function blocksMovement(board: Board, p: Vec2): boolean {
  const t = terrainAt(board, p);
  if (t === 'oob' || t === 'wall') return true;
  // Full-block (v1) cover stops entry; directional edge cover is walk-on and
  // only blocks the crossing of its faced edge (see `coverEdgeBlocks`).
  return t === 'cover' && board.solidCover.has(`${p.x},${p.y}`);
}

/** In-bounds orthogonal neighbours in fixed ORTHOGONAL_STEPS order. */
export function neighbors(board: Board, p: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (const d of ORTHOGONAL_STEPS) {
    const n = { x: p.x + d.x, y: p.y + d.y };
    if (inBounds(board, n)) out.push(n);
  }
  return out;
}
