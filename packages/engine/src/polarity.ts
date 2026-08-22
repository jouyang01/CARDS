/**
 * Effect polarity — which side of the board each `EffectKind` is allowed to
 * reach (edge-cases: no-friendly-fire + R7).
 *
 * Its own module rather than a corner of the resolver, because `validate.ts`
 * needs the same table (ALLY-SAFE asks "does this ability have anything harmful
 * to spare an ally from?") and the resolver is downstream of the validator by
 * way of the catalysts. A shared fact, in a file with no dependencies but the
 * types.
 */

import type { EffectKind } from './types.js';

// Effect polarity (edge-cases: no-friendly-fire + R7). The three sets partition
// EFFECT_KINDS exactly — every kind sits in one row, so the table is total (a
// content guardrail test asserts it). Harmful → enemies only; beneficial → own
// team only; neutral → self/placement, unfiltered by area allegiance.
export const HARMFUL_KINDS: ReadonlySet<EffectKind> = new Set<EffectKind>([
  'damage',
  'weaken',
  'slow',
  'root',
  'knockback',
  'pull',
  'reveal',
  'damageOverTime', // DOT-HOT: it damages, so FF1 reaches allies in the area too
  'brushBroken', // BRUSH-BREAK: having your cover blown is done *to* you
]);
export const BENEFICIAL_KINDS: ReadonlySet<EffectKind> = new Set<EffectKind>([
  'heal',
  'shield',
  'might',
  'haste',
  'energized',
  'unstoppable',
  'stealth',
  'untargetable', // R7 (2026-08-19): concealing/protecting a unit is friendly
  'healOverTime', // DOT-HOT: a heal is a heal, own team only
  // INTERCEPT-GUARD: taking somebody's hits for them is the most friendly thing
  // in the game. Own team only, like every other protection here.
  'guard',
]);
export const NEUTRAL_KINDS: ReadonlySet<EffectKind> = new Set<EffectKind>([
  'teleport',
  'decoy',
  'trap',
]);
