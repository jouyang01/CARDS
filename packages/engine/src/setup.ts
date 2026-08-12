/**
 * Match setup: turn character data (data/characters/*.json) and a map into the
 * initial `GameState` and `Roster` the pipeline runs on.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): no I/O here — the caller
 * imports the JSON (client at build time, server bundled) and hands it in.
 * Written for N units per side (GAME_SPEC §1): one character per player produces
 * one unit at that player's first spawn, but the shape generalises.
 */

import type { CharacterDef, GameState, MapDef, PlayerId, UnitState } from './types.js';
import type { Roster } from './resolve.js';

/** Index characters by id for the pipeline's ability lookups. */
export function buildRoster(characters: readonly CharacterDef[]): Roster {
  const roster: Record<string, CharacterDef> = {};
  for (const c of characters) roster[c.id] = c;
  return roster;
}

/** A fresh unit for `character`, at `pos`, full HP, no energy/statuses. */
export function spawnUnit(character: CharacterDef, unitId: string, owner: PlayerId, pos: { x: number; y: number }): UnitState {
  return {
    unitId,
    characterId: character.id,
    owner,
    pos: { x: pos.x, y: pos.y },
    hp: character.maxHp,
    maxHp: character.maxHp,
    energy: 0,
    alive: true,
    respawnIn: 0,
    cooldowns: {},
    statuses: [],
  };
}

/**
 * A turn-1 `GameState` for a 1v1: player 0 gets `p0`, player 1 gets `p1`, each
 * placed on their first spawn square. Unit ids are `"<characterId>-0"`.
 */
export function createInitialState(map: MapDef, p0: CharacterDef, p1: CharacterDef): GameState {
  return {
    turn: 1,
    units: [
      spawnUnit(p0, `${p0.id}-0`, 0, map.spawns[0][0]!),
      spawnUnit(p1, `${p1.id}-0`, 1, map.spawns[1][0]!),
    ],
    traps: [],
    delayed: [],
    kills: [0, 0],
    status: 'active',
    suddenDeath: false,
  };
}
