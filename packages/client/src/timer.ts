/**
 * UI-TIMER (ar-parity §4.5) — the decision countdown, and the Time Bank.
 *
 * From the owner's screenshot: a large countdown next to LOCK IN, showing
 * tenths as it runs short, with the Time Bank charge rendered beside it. The
 * value it counts from is `DECISION_SECONDS` (TIMER-40); the charge and its
 * extension are `TIMEBANK_CHARGES` / `TIMEBANK_SECONDS`. All three are the
 * engine's constants — the client reads them and owns none of them.
 *
 * **Presentation only.** Nothing here ends a turn: enforcement is
 * server-authoritative and belongs to M3-TIMER, where a deadline can be the
 * same deadline for everybody. A hot-seat clock that resolved the turn by
 * itself would be a *different* rule from the one M3-TIMER will ship, and
 * writing it twice is how the two end up disagreeing.
 *
 * Pure and clock-free, like every other model in the client: it is handed a
 * remaining-milliseconds number and returns what to draw. The one place that
 * reads a wall clock is the loop in `app.ts` that feeds it, which is where a
 * wall clock belongs.
 */

import { DECISION_SECONDS, TIMEBANK_CHARGES, TIMEBANK_SECONDS } from '@cards/engine';

/** Below this many seconds the readout switches to tenths and turns urgent. */
export const URGENT_SECONDS = 10;

/** The full decision window, in milliseconds. */
export const DECISION_MS = DECISION_SECONDS * 1000;
/** What one Time Bank charge buys, in milliseconds. */
export const TIMEBANK_MS = TIMEBANK_SECONDS * 1000;

export interface TimerView {
  /** The readout: whole seconds, or seconds-with-tenths once urgent. */
  text: string;
  /**
   * Under `URGENT_SECONDS`. Drives both the tenths and the colour shift — one
   * flag, because they are one signal and splitting them would let the number
   * get precise while the colour stayed calm.
   */
  urgent: boolean;
  /** Remaining as a fraction of the full window, clamped — for a bar or ring. */
  fraction: number;
  /** Time Bank charges left. One pip each; we have one (AR shows two). */
  charges: number;
  /** A charge could be spent right now: one is left and the clock is running. */
  canExtend: boolean;
  /** The extension is currently animating, so its consumption is never silent. */
  extending: boolean;
  /** The clock has run out. Nothing here acts on it — M3-TIMER enforces. */
  expired: boolean;
}

/**
 * The countdown text.
 *
 * Whole seconds while there is time to think, tenths once there is not. The
 * switch is the point: a tenths readout at 38 seconds is noise you learn to
 * ignore, and the same readout at 6 seconds is the only thing on screen you are
 * looking at. Rounding **up** above the threshold so the display hits "1" and
 * then 0.9 rather than showing 0 for a whole second while a second remains.
 */
export function countdownText(remainingMs: number): string {
  const ms = Math.max(0, remainingMs);
  if (ms > URGENT_SECONDS * 1000) return String(Math.ceil(ms / 1000));
  return (Math.floor(ms / 100) / 10).toFixed(1);
}

/** How long the extension flash runs, in milliseconds. */
export const EXTEND_FLASH_MS = 900;

/**
 * The whole readout.
 *
 * `sinceExtendMs` is how long ago the bank was last spent (undefined if never),
 * which is what makes the extension **visible**: a +10 s that silently changed a
 * number would look like a bug or a miscount, and the one thing a player must
 * never wonder about is whether their own charge was consumed.
 */
export function timerView(
  remainingMs: number,
  charges: number,
  sinceExtendMs?: number,
): TimerView {
  const ms = Math.max(0, remainingMs);
  const expired = ms <= 0;
  return {
    text: countdownText(ms),
    urgent: ms <= URGENT_SECONDS * 1000,
    fraction: Math.max(0, Math.min(1, ms / DECISION_MS)),
    charges: Math.max(0, charges),
    canExtend: charges > 0 && !expired,
    extending: sinceExtendMs !== undefined && sinceExtendMs < EXTEND_FLASH_MS,
    expired,
  };
}

/** A fresh decision window: full time, and whatever charges the seat has left. */
export const freshTimer = (): { remainingMs: number; charges: number } =>
  ({ remainingMs: DECISION_MS, charges: TIMEBANK_CHARGES });

/**
 * Spend a charge, or refuse.
 *
 * Returns the new state and whether it took, rather than throwing or silently
 * no-oping: the caller needs to know, because a spend that took has to start
 * the flash and a spend that did not must not.
 */
export function spendBank(
  remainingMs: number,
  charges: number,
): { remainingMs: number; charges: number; spent: boolean } {
  if (charges <= 0) return { remainingMs, charges, spent: false };
  // Added to what is left rather than resetting the clock: the bank *extends* a
  // deadline, and a player who banks at 8 seconds should end up at 18, not 40.
  return { remainingMs: Math.max(0, remainingMs) + TIMEBANK_MS, charges: charges - 1, spent: true };
}
