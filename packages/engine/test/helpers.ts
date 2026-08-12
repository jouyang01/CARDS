/**
 * Test fixtures. Not a Vitest file (no `.test.` in the name) — helpers only.
 *
 * `makeMap` builds a map from an ASCII sketch so terrain in tests is readable:
 *   '.' open   '#' wall   'o' cover   'b' brush
 * Row 0 is the first string; x increases left→right, y increases top→bottom.
 */

import { buildRoster, type Roster } from '../src/roster.js';
import type {
  AbilityDef,
  CharacterDef,
  GameState,
  MapDef,
  PlayerId,
  StatusInstance,
  UnitState,
  Vec2,
} from '../src/types.js';

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
  owner: PlayerId,
  pos: Vec2,
  overrides: Partial<UnitState> = {},
): UnitState {
  return {
    unitId,
    characterId: 'test-char',
    owner,
    pos,
    hp: 100,
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

// ── Pipeline fixtures (BACKLOG item 4) ──────────────────────────────────────

function ability(id: string, over: Partial<AbilityDef>): AbilityDef {
  return {
    id,
    name: id,
    phase: 'blast',
    shape: 'self',
    range: 0,
    cooldown: 0,
    energyGain: 0,
    effects: [{ kind: 'damage', amount: 1 }],
    description: id,
    ...over,
  };
}

/**
 * A test dummy character with one ability tagged in each resolution phase plus a
 * cooldown ability and an ultimate, so pipeline tests can exercise phase
 * bucketing and every validation branch without depending on shipped content.
 */
export const DUMMY_CHARACTER: CharacterDef = {
  id: 'dummy',
  name: 'Dummy',
  archetype: 'firepower',
  maxHp: 100,
  abilities: [
    ability('prep_stance', { phase: 'prep', shape: 'self' }),
    ability('dash_roll', { phase: 'dash', shape: 'path', range: 3, effects: [{ kind: 'teleport' }] }),
    ability('blast_shot', { phase: 'blast', shape: 'line', range: 5 }),
    ability('slow_bomb', { phase: 'blast', shape: 'square', range: 4, cooldown: 3 }),
  ],
  ultimate: ability('ult_beam', { phase: 'blast', shape: 'line', range: 9, effects: [{ kind: 'damage', amount: 40 }] }),
};

/** Roster over the dummy (plus any extra characters a test needs). */
export function dummyRoster(...extra: CharacterDef[]): Roster {
  return buildRoster([DUMMY_CHARACTER, ...extra]);
}

/** A dummy-character unit (its abilities resolve against `dummyRoster`). */
export function makeDummy(
  unitId: string,
  owner: PlayerId,
  pos: Vec2,
  overrides: Partial<UnitState> = {},
): UnitState {
  return makeUnit(unitId, owner, pos, { characterId: 'dummy', ...overrides });
}
