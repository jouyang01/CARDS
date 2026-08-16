/**
 * UI-INTENT (ar-parity §4.6) — what your teammates have queued, on the board.
 *
 * CARDS has ruled since the Teams batch that teammates see each other's planned
 * orders (edge-cases, "Teammate information"), and until now that ruling had no
 * UI at all: the information was legal, available, and invisible. 2v2 is the
 * default format, so a duo that cannot see each other's plan is not playing a
 * team turn — they are playing two solo turns on one board.
 *
 * In the screenshot AR floats small numbered action tiles above an allied
 * character. That is what this builds: the **slot number** of the queued
 * ability, a marker when a free action or a catalyst is also declared, and a
 * tick once that seat has locked in.
 *
 * **Enemies get nothing, ever.** Not a redacted tile, not a "planning" dot —
 * nothing, because the existence of a marker is itself information about
 * whether they have decided. Hidden information is team-vs-team, and this is
 * the one module whose whole job is to draw plans.
 */

import type { CharacterDef, Roster, TeamId, UnitState } from '@cards/engine';
import type { OrderDraft } from './targeting.js';

/** What floats above one allied unit during Decision. */
export interface IntentBadge {
  unitId: string;
  /**
   * The hotbar position of the queued ability, 1-based, matching the number a
   * player would press. The ultimate is the slot after the last ability.
   * Undefined when the plan is a move, a chase, or nothing.
   */
  slot?: number;
  /** A free action is declared as well — additive, so it gets its own mark. */
  free: boolean;
  /** A catalyst is declared as well. */
  catalyst: boolean;
  /** The Move-phase intent, shown when no ability is queued. */
  move?: 'move' | 'sprint' | 'chase';
  /** That seat has locked in. */
  locked: boolean;
  /** The short string the board draws. Empty means draw nothing. */
  label: string;
}

/** Marks, kept here so the renderer has no vocabulary of its own. */
const FREE_MARK = '+';
const CATALYST_MARK = '✦'; // ✦
const LOCK_MARK = '✓';     // ✓

/**
 * The 1-based hotbar position of an ability on a character, ultimate included.
 *
 * Position rather than id because the number is the point: a teammate glancing
 * at the board is matching it against their own hotbar, and "3" travels where
 * "vex_pierce" does not.
 */
export function abilitySlot(character: CharacterDef, abilityId: string): number | undefined {
  const index = character.abilities.findIndex((a) => a.id === abilityId);
  if (index >= 0) return index + 1;
  return character.ultimate.id === abilityId ? character.abilities.length + 1 : undefined;
}

/**
 * The badge for one unit's draft, or undefined when there is nothing to say.
 *
 * A unit with no order at all is a unit holding position, and holding is not a
 * plan worth a tile — until the seat locks it in, at which point "they are done
 * and they chose to stand still" is exactly what a teammate needs to know.
 */
export function intentBadge(
  unit: UnitState,
  character: CharacterDef,
  draft: OrderDraft | undefined,
  locked: boolean,
): IntentBadge | undefined {
  const slot = draft?.abilityId === undefined ? undefined : abilitySlot(character, draft.abilityId);
  const free = draft?.freeAbilityId !== undefined;
  const catalyst = draft?.catalystId !== undefined;
  const move = draft === undefined ? undefined
    : draft.chaseTargetId !== undefined ? 'chase' as const
    : draft.movePath.length > 0 ? (draft.sprint ? 'sprint' as const : 'move' as const)
    : undefined;

  const parts: string[] = [];
  if (slot !== undefined) parts.push(String(slot));
  else if (move === 'chase') parts.push('Chase');
  else if (move === 'sprint') parts.push('Sprint');
  else if (move === 'move') parts.push('Move');
  if (free) parts.push(FREE_MARK);
  if (catalyst) parts.push(CATALYST_MARK);
  if (locked) parts.push(LOCK_MARK);

  if (parts.length === 0) return undefined;
  return {
    unitId: unit.unitId,
    ...(slot !== undefined ? { slot } : {}),
    free,
    catalyst,
    ...(move !== undefined ? { move } : {}),
    locked,
    label: parts.join(' '),
  };
}

/**
 * Every badge the viewing team may see.
 *
 * The filter is `owner === viewer` and nothing else — not "visible", not "in
 * range". A teammate's plan is yours to see wherever they are standing, and an
 * enemy's is never yours however clearly you can see them.
 */
export function intentBadges(
  units: readonly UnitState[],
  roster: Roster,
  drafts: ReadonlyMap<string, OrderDraft>,
  locked: ReadonlySet<string>,
  viewer: TeamId,
): IntentBadge[] {
  const out: IntentBadge[] = [];
  for (const unit of units) {
    if (unit.owner !== viewer || !unit.alive) continue;
    const character = roster[unit.characterId];
    if (character === undefined) continue;
    const badge = intentBadge(unit, character, drafts.get(unit.unitId), locked.has(unit.unitId));
    if (badge !== undefined) out.push(badge);
  }
  return out;
}
