/**
 * Board geometry and terrain queries.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): no randomness, no clock,
 * no I/O, integer math only. Terrain is indexed once from a `MapDef` so every
 * lookup is O(1) and iteration order never depends on object key order.
 *
 * Line of sight / vision deliberately live elsewhere (BACKLOG item 2).
 */

import type { MapDef, TerrainKind, Vec2 } from './types.js';

/** What occupies a square. `oob` = outside the map rectangle. */
export type SquareKind = 'open' | TerrainKind | 'oob';

export interface Board {
  readonly map: MapDef;
  readonly width: number;
  readonly height: number;
  /**
   * Row-major terrain index (`y * width + x`); `undefined` means open ground.
   * A flat array keeps lookups O(1) and iteration order stable.
   */
  readonly terrain: readonly (TerrainKind | undefined)[];
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
 * The only legal movement steps: four orthogonal directions.
 *
 * Movement is strictly orthogonal (GAME_SPEC §3), so diagonal corner-cutting
 * past a wall or cover square is structurally impossible — a unit must walk
 * around the corner and pay for both steps.
 *
 * Fixed order (north, east, south, west) so BFS expansion is deterministic.
 */
export const ORTHOGONAL_STEPS: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** True when `b` is exactly one orthogonal step from `a`. */
export const isOrthogonalStep = (a: Vec2, b: Vec2): boolean => manhattan(a, b) === 1;

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
  for (const p of map.brush) put(p, 'brush', true);
  for (const p of map.cover) put(p, 'cover', true);
  for (const p of map.walls) put(p, 'wall', true);
  return { map, width: map.width, height: map.height, terrain };
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
  return t === 'oob' || t === 'wall' || t === 'cover';
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
