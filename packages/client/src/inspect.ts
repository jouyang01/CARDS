/**
 * UI-INSPECT (ar-parity §4.3) — everything about a unit you can see.
 *
 * The owner's directive: *"Player can see cooldowns of other characters and the
 * buffs/debuffs/energy/hp status when they have vision of the character."*
 *
 * All of it is state the client already holds, so this is a **reading**, not a
 * new mechanic: no engine change, nothing derived, nothing remembered. The one
 * rule it must not break is the vision gate — the panel is the most detailed
 * thing on screen, and a panel that opened over a fogged square would undo
 * every other gate in the UI batch at a stroke.
 *
 * Which is why the gate is not implemented here at all. The caller hands in the
 * unit it is already drawing, which came from `fogView`; if the pointer is over
 * a square with no drawn unit, there is nothing to inspect and no branch that
 * could decide otherwise.
 */

import {
  ULT_COST,
  type AbilityDef, type CatalystPool, type CharacterDef, type Roster, type TeamId, type UnitState,
} from '@cards/engine';
import type { DecoySnapshot } from './nameplates.js';
import { statusChips, viewableStatuses, type StatusChip } from './status-pips.js';

/** One ability slot as the panel shows it. */
export interface InspectSlot {
  id: string;
  name: string;
  /** The phase it resolves in — the same colour language the hotbar uses. */
  phase: string;
  isUlt: boolean;
  /** Turns until it can be used again; 0 means ready. */
  cooldown: number;
  /**
   * Usable right now — cooldown clear, and for the ultimate, charged. This is
   * the read the owner asked for: *can that character do the thing to me on
   * this turn*, which is not the same question as "is it off cooldown".
   */
  ready: boolean;
}

/** One catalyst slot: carried, and whether it has been spent (CAT2). */
export interface InspectCatalyst {
  id: string;
  name: string;
  phase: string;
  spent: boolean;
}

/** The whole panel. Presentation data only — no engine types leak out. */
export interface InspectPanel {
  name: string;
  archetype: string;
  /** Which team owns it, so the panel can wear the right colour. */
  team: TeamId;
  hp: number;
  maxHp: number;
  shield: number;
  energy: number;
  ult: boolean;
  abilities: InspectSlot[];
  catalysts: InspectCatalyst[];
  statuses: StatusChip[];
  /**
   * A **decoy's** panel: frozen at the cast, and marked so nothing downstream
   * treats it as live. Never shown to the team being fooled as anything other
   * than an ordinary panel — the flag is for the client, not for the player.
   */
  frozen: boolean;
}

const slotsOf = (character: CharacterDef): { def: AbilityDef; isUlt: boolean }[] => [
  ...character.abilities.map((def) => ({ def, isUlt: false })),
  { def: character.ultimate, isUlt: true },
];

const slot = (
  def: AbilityDef,
  isUlt: boolean,
  cooldowns: Readonly<Record<string, number>>,
  energy: number,
): InspectSlot => {
  const cooldown = cooldowns[def.id] ?? 0;
  return {
    id: def.id,
    name: def.name,
    phase: def.phase,
    isUlt,
    cooldown,
    ready: cooldown <= 0 && (!isUlt || energy >= ULT_COST),
  };
};

const catalystSlots = (
  ids: readonly string[],
  used: readonly string[],
  pool: CatalystPool,
): InspectCatalyst[] => ids.map((id) => {
  const def = pool[id];
  return {
    id,
    name: def?.name ?? id,
    phase: def?.phase ?? '',
    // Spent slots stay listed and go grey rather than disappearing: "what did
    // they already burn" is half the read, and an empty row cannot answer it.
    spent: used.includes(id),
  };
});

/**
 * Inspect a live unit.
 *
 * `viewer` only reaches the status row, through the same `viewableStatuses`
 * gate the icons and the nameplate use — the panel must not become the one
 * place an enemy's Stealth is spelled out in words.
 */
export function inspectUnit(
  unit: UnitState,
  roster: Roster,
  pool: CatalystPool,
  viewer: TeamId,
): InspectPanel | undefined {
  const character = roster[unit.characterId];
  if (character === undefined) return undefined;
  const live = unit.statuses.filter((s) => s.remaining > 0);
  return {
    name: character.name,
    archetype: character.archetype,
    team: unit.owner,
    hp: unit.hp,
    maxHp: unit.maxHp,
    shield: live.filter((s) => s.kind === 'shield').reduce((sum, s) => sum + (s.amount ?? 0), 0),
    energy: unit.energy,
    ult: unit.energy >= ULT_COST,
    abilities: slotsOf(character).map((s) => slot(s.def, s.isUlt, unit.cooldowns, unit.energy)),
    catalysts: catalystSlots(unit.catalysts, unit.catalystsUsed, pool),
    statuses: statusChips(viewableStatuses(live, unit.owner === viewer)),
    frozen: false,
  };
}

/**
 * Inspect a decoy: the impersonated character's kit **at the cast**.
 *
 * Never live and never a refusal — either would un-disguise it instantly, and a
 * refusal would be the louder of the two ("this one won't open" is a perfect
 * tell). Cooldowns are the snapshot's, so a decoy's panel keeps saying what the
 * real Wisp's said at the moment it was placed while the real one moves on.
 *
 * The status row is empty for the same reason the nameplate's is: real buffs
 * would leak, invented ones would be the client making up game state.
 */
export function inspectDecoy(
  snapshot: DecoySnapshot,
  roster: Roster,
  pool: CatalystPool,
  team: TeamId,
): InspectPanel | undefined {
  const character = roster[snapshot.characterId];
  if (character === undefined) return undefined;
  return {
    name: character.name,
    archetype: character.archetype,
    team,
    hp: snapshot.hp,
    maxHp: snapshot.maxHp,
    shield: 0,
    energy: snapshot.energy,
    ult: snapshot.energy >= ULT_COST,
    abilities: slotsOf(character).map((s) => slot(s.def, s.isUlt, snapshot.cooldowns, snapshot.energy)),
    catalysts: catalystSlots(snapshot.catalysts, snapshot.catalystsUsed, pool),
    statuses: [],
    frozen: true,
  };
}
