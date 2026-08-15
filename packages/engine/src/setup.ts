/**
 * Match setup: turn character data (data/characters/*.json) and a map into the
 * initial `GameState` and `Roster` the pipeline runs on.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): no I/O here — the caller
 * imports the JSON (client at build time, server bundled) and hands it in.
 * Written for N units per side (GAME_SPEC §1): one character per player produces
 * one unit at that player's first spawn, but the shape generalises.
 */

import type { CharacterDef, GameState, MapDef, TeamId, UnitState } from './types.js';
import { type Format, type FormatId, getFormat } from './formats.js';
import { DEFAULT_CATALYSTS } from './catalysts.js';
import type { Roster } from './resolve.js';

/** Index characters by id for the pipeline's ability lookups. */
export function buildRoster(characters: readonly CharacterDef[]): Roster {
  const roster: Record<string, CharacterDef> = {};
  for (const c of characters) roster[c.id] = c;
  return roster;
}

/** A fresh unit for `character`, at `pos`, full HP, no energy/statuses. */
export function spawnUnit(character: CharacterDef, unitId: string, owner: TeamId, pos: { x: number; y: number }): UnitState {
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
    // Until the M3 lobby lets players pick, everyone gets the neutral triad
    // (edge-cases: "Catalysts are chosen, not fixed to a character").
    catalysts: [...DEFAULT_CATALYSTS],
    catalystsUsed: [],
  };
}

/**
 * A turn-1 `GameState` for any format. `teams[t]` lists team `t`'s characters,
 * placed on that team's spawn squares in map order (edge-cases "Respawn square"
 * placement, applied at match start too). Unit ids are `"<characterId>-t<team>-<i>"`,
 * unique even when both teams field the same character.
 *
 * Throws if a team has more characters than the map has spawn squares — call
 * `validateMapForFormat` first to surface that as data, not an exception.
 */
export function createMatch(map: MapDef, format: FormatId, teams: [CharacterDef[], CharacterDef[]]): GameState {
  const units: UnitState[] = [];
  for (const team of [0, 1] as const) {
    const spawns = map.spawns[team];
    teams[team].forEach((character, i) => {
      const spawn = spawns[i];
      if (spawn === undefined) throw new Error(`map ${map.id}: team ${team} has no spawn square for character ${i}`);
      units.push(spawnUnit(character, `${character.id}-t${team}-${i}`, team, spawn));
    });
  }
  return { turn: 1, units, traps: [], delayed: [], decoys: [], powerups: [], kills: [0, 0], format, status: 'active', suddenDeath: false };
}

/**
 * A turn-1 1v1 `GameState`: team 0 gets `p0`, team 1 gets `p1`, each on their
 * first spawn square. Unit ids are `"<characterId>-0"`. Convenience wrapper over
 * {@link createMatch} for the dev/testing format.
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
    decoys: [],
    powerups: [],
    kills: [0, 0],
    format: '1v1',
    status: 'active',
    suddenDeath: false,
  };
}

/**
 * Errors if `map` cannot host `format`: each team needs at least
 * `charactersPerTeam` spawn squares (edge-cases "Respawn square"). Empty = OK.
 */
export function validateMapForFormat(map: MapDef, format: FormatId): string[] {
  const f: Format = getFormat(format);
  const errs: string[] = [];
  for (const team of [0, 1] as const) {
    const have = map.spawns[team]?.length ?? 0;
    if (have < f.charactersPerTeam) {
      errs.push(`map ${map.id}: team ${team} has ${have} spawn square(s), needs ${f.charactersPerTeam} for ${format}`);
    }
  }
  return errs;
}

/** Format ids `map` can host (spawns-per-team ≥ characters-per-team for both). */
export function formatsSupportedByMap(map: MapDef, formats: readonly FormatId[]): FormatId[] {
  return formats.filter((f) => validateMapForFormat(map, f).length === 0);
}
