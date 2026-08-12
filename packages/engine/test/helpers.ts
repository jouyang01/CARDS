/**
 * Test fixtures. Not a Vitest file (no `.test.` in the name) — helpers only.
 *
 * `makeMap` builds a map from an ASCII sketch so terrain in tests is readable:
 *   '.' open   '#' wall   'o' cover   'b' brush
 * Row 0 is the first string; x increases left→right, y increases top→bottom.
 */

import type { GameState, MapDef, TeamId, StatusInstance, UnitState, Vec2 } from '../src/types.js';

export function makeMap(rows: string[], overrides: Partial<MapDef> = {}): MapDef {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const walls: Vec2[] = [];
  const cover: Vec2[] = [];
  const brush: Vec2[] = [];
  for (const [y, row] of rows.entries()) {
    if (row.length !== width) throw new Error(`row ${y} has width ${row.length}, expected ${width}`);
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      if (ch === '#') walls.push({ x, y });
      else if (ch === 'o') cover.push({ x, y });
      else if (ch === 'b') brush.push({ x, y });
    }
  }
  return {
    id: 'test-map',
    name: 'Test Map',
    width,
    height,
    walls,
    cover,
    brush,
    spawns: [[{ x: 0, y: 0 }], [{ x: width - 1, y: height - 1 }]],
    ...overrides,
  };
}

export function makeUnit(
  unitId: string,
  owner: TeamId,
  pos: Vec2,
  overrides: Partial<UnitState> = {},
): UnitState {
  return {
    unitId,
    characterId: 'test-char',
    owner,
    pos,
    hp: 100,
    maxHp: 100,
    energy: 0,
    alive: true,
    respawnIn: 0,
    cooldowns: {},
    statuses: [],
    ...overrides,
  };
}

export function withStatuses(unit: UnitState, ...statuses: StatusInstance[]): UnitState {
  return { ...unit, statuses: [...unit.statuses, ...statuses] };
}

export function status(kind: StatusInstance['kind'], remaining = 1, amount?: number): StatusInstance {
  return amount === undefined ? { kind, remaining } : { kind, remaining, amount };
}

export function makeState(units: UnitState[], overrides: Partial<GameState> = {}): GameState {
  return {
    turn: 1,
    units,
    traps: [],
    delayed: [],
    kills: [0, 0],
    // Tests default to the 1v1 dev format (3 kills / turn 12) unless they override.
    format: '1v1',
    status: 'active',
    suddenDeath: false,
    ...overrides,
  };
}

/** Sorted "x,y" list — order-independent comparison of square sets. */
export function keys(squares: readonly { pos: Vec2 }[]): string[] {
  return squares.map((s) => `${s.pos.x},${s.pos.y}`).sort();
}

export function posKeys(squares: readonly Vec2[]): string[] {
  return squares.map((p) => `${p.x},${p.y}`).sort();
}
