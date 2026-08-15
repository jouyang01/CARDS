/**
 * Power-up pads (PADS1, ar-parity §7.3): what each pad flavour actually grants.
 *
 * A pad is placed as **data** on a map (`MapDef.powerups`) — that is the part a
 * Designer tunes per map. What a `health` pad *does* is a rule, not a per-map
 * choice, so it lives here: one table, three entries, retuned by editing three
 * literals rather than by hunting through `resolve.ts`.
 *
 * Every entry reuses effect kinds the engine already has, so a pad is only a new
 * *trigger*, never a new mechanic. Integer amounts and durations, no randomness
 * — the pads are as deterministic as everything else (golden rule #1).
 */

import type { AbilityEffect, PowerupType } from './types.js';

/**
 * Pad → the effects granted to whoever takes it. Applied through the same
 * `applySelfEffects` path an ally-targeted heal or buff uses, so the pad's
 * events are the ordinary `heal`/`statusApplied` ones and nothing downstream
 * needs to learn a new shape.
 *
 * Health leads with an instant `heal` and follows with a `healOverTime` so the
 * pad is worth taking at full HP too — the reason PADS1 waited on DOT-HOT.
 */
export const POWERUP_EFFECTS: Readonly<Record<PowerupType, readonly AbilityEffect[]>> = {
  health: [
    { kind: 'heal', amount: 10 },
    { kind: 'healOverTime', amount: 10, duration: 2 },
  ],
  might: [{ kind: 'might', duration: 2 }],
  energy: [{ kind: 'energized', duration: 2 }],
};

/** The `abilityId` a pad's effects are attributed to (A0), one per flavour. */
export const powerupSourceId = (type: PowerupType): string => `powerup-${type}`;
