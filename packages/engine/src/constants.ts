/** Baseline tunables — see docs/GAME_SPEC.md §7. Integer values only. */

export const MOVE_RANGE = 4;
export const SPRINT_RANGE = 8;
export const VISION_RANGE = 6;
/**
 * Range ceiling for non-ultimate abilities (M2). Map spawn separation is sized
 * against max turn-1 threat (move + ability range), so raising an ability past
 * this would silently reintroduce the turn-1 spawn hit. Ultimates are exempt.
 */
export const MAX_ABILITY_RANGE = 8;
/** Percent damage reduction behind cover (applied round-down). */
export const COVER_REDUCTION_PCT = 50;
export const PASSIVE_ENERGY = 5;
export const ULT_COST = 100;
// KILLS_TO_WIN and TURN_LIMIT are per-format now — see `formats.ts` / GAME_SPEC §1.
export const RESPAWN_TURNS = 1;
export const DECISION_SECONDS = 30;
export const TIMEBANK_CHARGES = 1;
export const TIMEBANK_SECONDS = 10;
/**
 * Turns of Reveal a unit gets for using a damaging ability. 2 = "until the end
 * of the next turn" (GAME_SPEC §6 / edge-cases): applied during resolution, it
 * survives this turn's end-of-turn tick and the next one.
 */
export const REVEAL_ON_ATTACK_TURNS = 2;
/** Percent modifiers (round down when applied). */
export const MIGHT_PCT = 25;
export const WEAKEN_PCT = 25;
export const HASTE_PCT = 50;
export const SLOW_PCT = 50;
export const ENERGIZED_PCT = 50;
