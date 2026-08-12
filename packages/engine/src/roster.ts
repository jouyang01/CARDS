/**
 * Roster: the read-only lookup from a unit's `characterId` to its ability
 * definitions, so the turn pipeline can find an order's phase, range and
 * cooldown without the live `GameState` having to carry content.
 *
 * Content is data, not code (CLAUDE.md golden rule #2): the definitions come
 * from `data/characters/*.json`. Item 12 wires the shipped roster; until then
 * tests build a dummy one. Nothing here mutates state, reads a clock, or
 * iterates object keys in an outcome-affecting way — the index is built once in
 * array order and queried by string key.
 */

import type { AbilityDef, CharacterDef } from './types.js';

export interface Roster {
  /** characterId → definition. */
  readonly characters: ReadonlyMap<string, CharacterDef>;
  /** `${characterId} ${abilityId}` → definition, ultimates included. */
  readonly abilities: ReadonlyMap<string, AbilityDef>;
}

/**
 * Space-joined. Character and ability ids are validated slugs (no spaces), so a
 * single separator can never let one `(characterId, abilityId)` pair alias
 * another.
 */
const abilityKey = (characterId: string, abilityId: string): string =>
  `${characterId} ${abilityId}`;

/**
 * Index characters for O(1) ability lookup. Later definitions for a repeated
 * `characterId` overwrite earlier ones; content validation (`validateCharacter`)
 * is the gate that keeps ids unique, so this stays a plain last-wins build.
 */
export function buildRoster(characters: readonly CharacterDef[]): Roster {
  const charMap = new Map<string, CharacterDef>();
  const abilityMap = new Map<string, AbilityDef>();
  for (const c of characters) {
    charMap.set(c.id, c);
    for (const a of c.abilities) abilityMap.set(abilityKey(c.id, a.id), a);
    abilityMap.set(abilityKey(c.id, c.ultimate.id), c.ultimate);
  }
  return { characters: charMap, abilities: abilityMap };
}

/** The ability `abilityId` belonging to `characterId`, or `undefined`. */
export function abilityOf(
  roster: Roster,
  characterId: string,
  abilityId: string,
): AbilityDef | undefined {
  return roster.abilities.get(abilityKey(characterId, abilityId));
}

/** Is `abilityId` the ultimate of `characterId` (the one that costs energy)? */
export function isUltimate(roster: Roster, characterId: string, abilityId: string): boolean {
  const c = roster.characters.get(characterId);
  return c !== undefined && c.ultimate.id === abilityId;
}
