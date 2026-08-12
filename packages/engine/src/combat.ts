/**
 * Combat primitives: outgoing damage scaling, shield-first damage application,
 * healing, shield grants, and energy gain (GAME_SPEC §5, §6).
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): every function returns a
 * fresh value and mutates nothing; all game values are integers and every
 * percentage modifier is a single `floor(base * pct / 100)` so two machines can
 * never round apart. These are the building blocks the turn pipeline (and later
 * the status system) compose; they know nothing about phases, targeting, or the
 * event log.
 *
 * Rounding order for a landed hit is fixed and documented in docs/DECISIONS.md:
 * outgoing modifiers (Might/Weaken) first, then the defender's cover reduction,
 * then shields, then real HP — each an independent floor.
 */

import { MIGHT_PCT, WEAKEN_PCT, ENERGIZED_PCT } from './constants.js';
import { hasStatus } from './movement.js';
import type { UnitState } from './types.js';

/**
 * A base damage figure scaled by the attacker's outgoing modifiers: Might
 * (+25%) and Weaken (−25%), summed as percentage deltas before one round-down
 * so holding both nets exactly back to base (the same shape as the Haste/Slow
 * movement rule). Never returns below 0.
 */
export function scaleDamage(base: number, attacker: UnitState): number {
  const pct = 100 + (hasStatus(attacker, 'might') ? MIGHT_PCT : 0) - (hasStatus(attacker, 'weaken') ? WEAKEN_PCT : 0);
  if (pct <= 0) return 0;
  return Math.floor((Math.max(0, base) * pct) / 100);
}

export interface DamageResult {
  /** A new unit with shields drained and HP reduced (floored at 0). */
  unit: UnitState;
  /** HP actually lost (what a `damage` event reports as `amount`). */
  hpDamage: number;
  /** Total soaked by shields (what a `damage` event reports as `absorbed`). */
  absorbed: number;
}

/**
 * Apply already-scaled, already-cover-reduced damage to a unit: shields absorb
 * first (in status order), then real HP takes the remainder, floored at 0
 * (GAME_SPEC §6 "Shields ... consumed before real HP"). Fully drained shields
 * are dropped; a partially drained shield keeps its remaining amount and its
 * duration. Death is not decided here — a unit reaching 0 HP is left at 0 for
 * the deaths/respawn system (BACKLOG item 10) to act on.
 */
export function applyDamage(unit: UnitState, amount: number): DamageResult {
  let remaining = Math.max(0, Math.floor(amount));
  let absorbed = 0;

  const statuses = unit.statuses.map((s) => ({ ...s }));
  for (const s of statuses) {
    if (remaining <= 0) break;
    if (s.kind !== 'shield') continue;
    const pool = s.amount ?? 0;
    if (pool <= 0) continue;
    const soak = Math.min(pool, remaining);
    s.amount = pool - soak;
    absorbed += soak;
    remaining -= soak;
  }
  const survivingStatuses = statuses.filter((s) => !(s.kind === 'shield' && (s.amount ?? 0) <= 0));

  const hp = Math.max(0, unit.hp - remaining);
  const hpDamage = unit.hp - hp; // actual HP lost, not overkill
  return { unit: { ...unit, hp, statuses: survivingStatuses }, hpDamage, absorbed };
}

export interface HealResult {
  unit: UnitState;
  /** HP actually restored (0 if already full). */
  healed: number;
}

/**
 * Heal a unit up to `maxHp` (its `CharacterDef.maxHp`, which live `UnitState`
 * does not carry). Never overheals and never exceeds the cap.
 */
export function applyHeal(unit: UnitState, amount: number, maxHp: number): HealResult {
  const healed = Math.max(0, Math.min(Math.floor(amount), maxHp - unit.hp));
  return { unit: { ...unit, hp: unit.hp + healed }, healed };
}

/**
 * Add a shield: a temporary-HP status of `amount` lasting `duration` turns.
 * Whether a fresh shield stacks with or refreshes an existing one is the status
 * system's call (BACKLOG item 6); this primitive simply appends one.
 */
export function addShield(unit: UnitState, amount: number, duration: number): UnitState {
  return {
    ...unit,
    statuses: [...unit.statuses, { kind: 'shield', remaining: duration, amount: Math.max(0, Math.floor(amount)) }],
  };
}

/**
 * The energy a unit actually banks from a `base` gain, after Energized (+50%,
 * round down). Applies to ability-granted energy — on-hit and self-buff-on-use;
 * the flat +5 passive drip is not "gained" energy and is not scaled (see
 * docs/DECISIONS.md).
 */
export function scaleEnergyGain(base: number, unit: UnitState): number {
  const pct = 100 + (hasStatus(unit, 'energized') ? ENERGIZED_PCT : 0);
  return Math.floor((Math.max(0, base) * pct) / 100);
}
