/**
 * STATUS-AUDIT (client half) — the visual vocabulary for "this unit is carrying
 * a status", and nothing else.
 *
 * The Dev Note was "Stealth and Slow are not working". They were: the engine's
 * status math has been right the whole time. What was missing is that a landed
 * debuff was **invisible** — the only way to answer "am I slowed?" was to read a
 * state dump. So a player reasonably concludes the status does nothing.
 *
 * This module is deliberately free of Three.js and of the DOM: it is a pure
 * status-kind → colour/order table plus the row-building rule, so the part that
 * decides *what* you see is testable without a WebGL context, and `renderer3d`
 * only has to draw the quads it is handed.
 *
 * It derives nothing. The kinds come straight off engine state during Decision,
 * and off the `statusApplied` / `statusRemoved` event pair during playback.
 */

import type { EffectKind } from '@cards/engine';

/**
 * Display order, and simultaneously the whitelist: only the eleven kinds that
 * live on `unit.statuses` (GAME_SPEC §6) are drawable, and each always occupies
 * the same slot in the row so the eye can learn a position rather than re-read
 * a colour. Debuffs lead — what is being done *to* you is the more urgent read.
 */
export const PIP_ORDER: readonly EffectKind[] = [
  'root', 'slow', 'weaken', 'reveal',
  'shield', 'might', 'haste', 'energized', 'unstoppable', 'untargetable', 'stealth',
];

/**
 * One colour per kind, chosen so the two families read apart at a glance: cold
 * blue/violet/rust for what is being done to you, warm and pale for what is
 * protecting you. `shield` and `energized` deliberately reuse the existing bar
 * colours (`0x62d0e0`, `0xe0c04f`) — the bar shows the magnitude, the pip shows
 * the presence, and one thing should not have two colours.
 */
export const PIP_COLORS: Readonly<Record<string, number>> = {
  root: 0x8a5a2b,
  slow: 0x4a7fc8,
  weaken: 0x6b5fa8,
  reveal: 0xff7fbf,
  shield: 0x62d0e0,
  might: 0xff6b4a,
  haste: 0x7de08a,
  energized: 0xe0c04f,
  unstoppable: 0xd0d6e0,
  untargetable: 0xc79bff,
  stealth: 0x9aa2c0,
};

/** Debuffs, for anything that wants to tint rather than enumerate. */
export const HARMFUL_PIPS: ReadonlySet<EffectKind> = new Set<EffectKind>(['root', 'slow', 'weaken', 'reveal']);

export interface StatusPip {
  kind: EffectKind;
  color: number;
}

/**
 * The pip row for one unit, in `PIP_ORDER`, deduped, unknown kinds dropped.
 *
 * Order is imposed rather than taken from `unit.statuses` on purpose: the array
 * order there is application order, so a re-applied buff would make the row
 * shuffle between turns and every pip would have to be re-read. Deduping
 * matters because refresh-not-stack means a kind can legitimately appear once —
 * but a client folding the event log has no such guarantee.
 */
export function statusPips(statuses: readonly { kind: EffectKind }[]): StatusPip[] {
  const present = new Set(statuses.map((s) => s.kind));
  return PIP_ORDER.filter((kind) => present.has(kind)).map((kind) => ({ kind, color: PIP_COLORS[kind] ?? 0xffffff }));
}

/** Pip geometry, in world units — square, tight, above the shield bar. */
export const PIP_SIZE = 0.09;
export const PIP_GAP = 0.025;

/**
 * Where each pip's centre sits along the row's local X, centred on the unit.
 *
 * Lives here rather than in `renderer3d` because it is the one part of the row
 * that can be wrong in a way nothing catches: an off-centre row still draws, and
 * a WebGL context is not available to the unit suite. The arithmetic is
 * therefore testable on its own.
 */
export function pipOffsets(count: number): number[] {
  const span = count * PIP_SIZE + Math.max(0, count - 1) * PIP_GAP;
  return Array.from({ length: count }, (_, i) => -span / 2 + PIP_SIZE / 2 + i * (PIP_SIZE + PIP_GAP));
}
