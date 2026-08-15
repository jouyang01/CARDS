/**
 * Status system: apply, refresh, tick and query the statuses in GAME_SPEC §6.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): integer durations, no
 * randomness, no clock, no I/O. These helpers mutate a unit that is already part
 * of a cloned turn draft — `resolveTurn` deep-copies the incoming state once and
 * everything downstream edits the copy, so the caller's state is never touched.
 *
 * Model (GAME_SPEC §6):
 * - a status is a `{ kind, remaining, amount? }` instance on `unit.statuses`;
 * - **shields are statuses too** — kind `shield`, `amount` = absorb left,
 *   `remaining` = turns left — so one tick path expires everything;
 * - durations are in turns and tick at **end of turn**; a duration-1 status is
 *   applied during resolution and removed by that same turn's end-of-turn tick,
 *   so it covers exactly the turn it was cast;
 * - same-kind applications **refresh, do not stack** (GAME_SPEC §6); refreshing
 *   resets the countdown and, for amount-bearing statuses, replaces the amount;
 * - **Unstoppable** grants immunity to knockback, pull, root and slow.
 */

import type { EffectKind, StatusInstance, UnitState } from './types.js';

/** Effects that Unstoppable makes a unit immune to (GAME_SPEC §6). */
export const UNSTOPPABLE_BLOCKS: ReadonlySet<EffectKind> = new Set<EffectKind>([
  'knockback',
  'pull',
  'root',
  'slow',
]);

/** Statuses represented as timed instances (everything in §6 except shields). */
const STATUS_KINDS: ReadonlySet<EffectKind> = new Set<EffectKind>([
  'might',
  'weaken',
  'haste',
  'slow',
  'root',
  'reveal',
  'energized',
  'unstoppable',
  'stealth',
  'untargetable',
  'shield',
]);

/** Is `kind` something that lives on `unit.statuses` (vs. an instant effect)? */
export function isStatusKind(kind: EffectKind): boolean {
  return STATUS_KINDS.has(kind);
}

/** The active instance of `kind`, or `undefined`. "Active" means remaining > 0. */
export function getStatus(unit: UnitState, kind: EffectKind): StatusInstance | undefined {
  return unit.statuses.find((s) => s.kind === kind && s.remaining > 0);
}

/** Does `unit` currently carry an active `kind` status? */
export function hasStatus(unit: UnitState, kind: EffectKind): boolean {
  return getStatus(unit, kind) !== undefined;
}

/** True when `unit` is Unstoppable and therefore immune to `kind`. */
export function isImmuneTo(unit: UnitState, kind: EffectKind): boolean {
  return UNSTOPPABLE_BLOCKS.has(kind) && hasStatus(unit, 'unstoppable');
}

/**
 * Apply (or refresh) a status. Refresh-not-stack (GAME_SPEC §6): a same-kind
 * instance has its `remaining` reset to `duration` and, when `amount` is given,
 * its `amount` replaced. Otherwise a fresh instance is pushed.
 *
 * `duration` must be ≥ 1; a non-positive duration is a no-op (nothing to apply).
 */
export function applyStatus(
  unit: UnitState,
  kind: EffectKind,
  duration: number,
  amount?: number,
): void {
  if (duration <= 0) return;
  const existing = unit.statuses.find((s) => s.kind === kind);
  if (existing !== undefined) {
    existing.remaining = duration;
    if (amount !== undefined) existing.amount = amount;
    return;
  }
  unit.statuses.push(amount === undefined ? { kind, remaining: duration } : { kind, remaining: duration, amount });
}

/**
 * Remove every instance of `kind` outright (e.g. Stealth broken by attacking).
 * Returns whether anything was actually there, so the caller can log a
 * `statusRemoved` event only when a status really left (STATUS-AUDIT: the
 * client folds those events and must not be told about removals that did not
 * happen).
 */
export function removeStatus(unit: UnitState, kind: EffectKind): boolean {
  const before = unit.statuses.length;
  unit.statuses = unit.statuses.filter((s) => s.kind !== kind);
  return unit.statuses.length !== before;
}

/**
 * End-of-turn tick: every status loses one turn; those that reach zero are
 * dropped. Shields expire the same way (their `amount` is irrelevant once the
 * duration runs out). Called once per unit at end of turn.
 *
 * Returns the kinds that expired, in `unit.statuses` order — stable, so the
 * event log stays deterministic.
 */
export function tickStatuses(unit: UnitState): EffectKind[] {
  const survivors: StatusInstance[] = [];
  const expired: EffectKind[] = [];
  for (const s of unit.statuses) {
    const remaining = s.remaining - 1;
    if (remaining > 0) survivors.push({ ...s, remaining });
    else expired.push(s.kind);
  }
  unit.statuses = survivors;
  return expired;
}
