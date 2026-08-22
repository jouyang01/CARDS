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
 * status-kind → colour/order/**glyph** table plus the row-building rule, so the
 * part that decides *what* you see is testable without a WebGL context, and
 * `renderer3d` only has to draw the marks it is handed. STATUS-ICONS keeps that
 * boundary by shipping the icons as **path data** rather than as images: the
 * nameplate raster paints them onto its canvas, the HUD drops them into an
 * `<svg>`, and neither owns the vocabulary.
 *
 * Since NAMEPLATE-LAYOUT the row lives *on the plate*, beside the name, rather
 * than floating under it as its own quads — so the geometry that used to live
 * here (pip size, gap, wrap-at-six) is `nameplates.ts`'s `plateLayout` now. What
 * stays is the vocabulary: which statuses are drawable, in what order, in what
 * colour, and — new here — on whose side.
 *
 * It derives nothing. The kinds come straight off engine state during Decision,
 * and off the `statusApplied` / `statusRemoved` event pair during playback.
 */

import { BENEFICIAL_KINDS, HARMFUL_KINDS, type EffectKind } from '@cards/engine';

/**
 * Display order, and simultaneously the whitelist: only the twelve kinds that
 * live on `unit.statuses` (GAME_SPEC §6) are drawable, and each always occupies
 * the same slot in the row so the eye can learn a position rather than re-read
 * a colour. Debuffs lead — what is being done *to* you is the more urgent read.
 */
export const PIP_ORDER: readonly EffectKind[] = [
  // BURN-VISIBLE: `damageOverTime` and `healOverTime` join the row. They were
  // the only two kinds that live on `unit.statuses` and had no mark, which made
  // Cinder's burn a debuff you could feel and not see — "Cinder burn should be a
  // debuff that players can see". Burn leads the debuffs because it is the one
  // that is still taking HP off you while you plan; regen leads the buffs for
  // the same reason from the other side.
  'damageOverTime', 'root', 'slow', 'weaken', 'reveal', 'brushBroken',
  // INTERCEPT-GUARD: the guard leads the buffs, ahead of even regen — it is the
  // one mark on the row that tells you somebody ELSE is about to take your hits,
  // which changes what both players do this turn more than any other pip does.
  'guard',
  'healOverTime', 'shield', 'might', 'haste', 'energized', 'unstoppable', 'untargetable', 'stealth',
];

/**
 * One colour per kind, chosen so the two families read apart at a glance: cold
 * blue/violet/rust for what is being done to you, warm and pale for what is
 * protecting you. `shield` and `energized` deliberately reuse the existing bar
 * colours (`0x62d0e0`, `0xe0c04f`) — the bar shows the magnitude, the pip shows
 * the presence, and one thing should not have two colours.
 */
export const PIP_COLORS: Readonly<Record<string, number>> = {
  // BURN-VISIBLE: ember orange, hotter and more saturated than Root's brown so
  // the two do not read as one earthy pair; and a mint for regen, kept a step
  // cooler than Haste's leaf green because a unit can carry both.
  damageOverTime: 0xf2782b,
  healOverTime: 0x4fd6a8,
  root: 0x8a5a2b,
  slow: 0x4a7fc8,
  weaken: 0x6b5fa8,
  reveal: 0xff7fbf,
  // BRUSH-BREAK: a duller, leafier cousin of Reveal's pink — the same family of
  // "they can see you", a weaker version of it.
  brushBroken: 0xbf8f6a,
  // INTERCEPT-GUARD: a deeper blue than Shield's cyan — the same protective
  // family, because that is what it is, but unmistakably a different one.
  guard: 0x4f8ff0,
  shield: 0x62d0e0,
  might: 0xff6b4a,
  haste: 0x7de08a,
  energized: 0xe0c04f,
  unstoppable: 0xd0d6e0,
  untargetable: 0xc79bff,
  stealth: 0x9aa2c0,
};

/**
 * Debuffs, for anything that wants to tint rather than enumerate.
 *
 * NAMEPLATE-LAYOUT: **derived from the engine's FF1 table, not restated.** This
 * used to be its own literal set — the same four kinds, written out a second
 * time — which is a polarity table the engine cannot keep honest. A status that
 * changed sides, or a new harmful kind that became drawable, would have had to
 * be remembered here. Now it cannot: the members are whatever `PIP_ORDER` and
 * `HARMFUL_KINDS` agree on.
 */
export const HARMFUL_PIPS: ReadonlySet<EffectKind> =
  new Set<EffectKind>(PIP_ORDER.filter((kind) => HARMFUL_KINDS.has(kind)));

/**
 * NAMEPLATE-LAYOUT — **polarity is the colour** (ar-parity §4.8).
 *
 * The owner's directive: buffs blue, debuffs red. Two channels, one read — the
 * glyph carries *identity* (sword, eye, wing) and the tint carries *whose side
 * it is on*, which is the question a player asks first and answers from across
 * the board. `PIP_COLORS` still exists and still does its job in the HUD strip
 * and the inspect panel, where there is room to name a status and eleven hues
 * are a legend rather than a guess; over a unit's head there is room for one
 * bit, and this is that bit.
 *
 * Two colours only, deliberately. A third for "neutral" would be a hue nobody
 * has a meaning for, and the FF1 table's neutral row (`teleport`, `decoy`,
 * `trap`) contains no status a unit can carry — those are placements, not
 * things on a body — so the case does not arise for anything `PIP_ORDER` draws.
 */
export const PIP_TINT = { harmful: 0xff6b5e, beneficial: 0x6ba8ff } as const;

/**
 * The tint for one status kind, straight off the engine's polarity table.
 *
 * Beneficial is the fallback rather than a third state: every kind in
 * `PIP_ORDER` is in one of the engine's two rows (a content test asserts the
 * rows partition `EFFECT_KINDS` exactly), so the branch is total for everything
 * that can be drawn, and a kind that somehow arrived from neither would rather
 * read as "something is on this unit" than as an alarm.
 */
export const pipTint = (kind: EffectKind): number =>
  HARMFUL_KINDS.has(kind) ? PIP_TINT.harmful : PIP_TINT.beneficial;

/** Beneficial statuses, the other half of the same engine table. */
export const BENEFICIAL_PIPS: ReadonlySet<EffectKind> =
  new Set<EffectKind>(PIP_ORDER.filter((kind) => BENEFICIAL_KINDS.has(kind)));

/**
 * STATUS-ICONS — statuses that are **the owning team's business only**.
 *
 * Stealth is the whole set and the reason the set exists (ar-parity §4.2): a
 * Stealth marker an enemy can see is a contradiction in terms. The engine
 * already hides a stealthed unit from enemy vision, so this only matters in the
 * window where a stealthed unit *is* visible — revealed, adjacent, or standing
 * in your own team's sight — and there the icon would still announce "this one
 * is trying to hide", which is exactly the information Stealth buys.
 */
export const OWNER_ONLY_PIPS: ReadonlySet<EffectKind> = new Set<EffectKind>(['stealth']);

/**
 * The statuses a viewer on `viewerOwns`-or-not may be shown for this unit.
 *
 * One gate, applied before both the plate's icon row and the HUD strip, so the
 * two can never disagree about what an enemy is allowed to see. Everything else
 * about a visible unit is public: if you can see them, you can see that they
 * are Rooted.
 */
export function viewableStatuses<T extends { kind: EffectKind }>(
  statuses: readonly T[],
  viewerOwnsUnit: boolean,
): T[] {
  return viewerOwnsUnit ? [...statuses] : statuses.filter((s) => !OWNER_ONLY_PIPS.has(s.kind));
}

/**
 * STATUS-ICONS — one drawn glyph per status (ar-parity §4.2).
 *
 * **Path data, not pictures.** The vocabulary lives here as SVG path strings in
 * a fixed 24×24 box because two very different consumers need the same mark:
 * `textures.ts` paints it onto the nameplate canvas, and the HUD strip drops it
 * straight into an `<svg>`. Shipping an image would mean two
 * assets to keep in step, or a texture the DOM cannot use; shipping geometry
 * means one source and no files.
 *
 * The owner named two of them — **Might is a sword, Revealed is an eye** — and
 * the rest extend that so the set is total. Weaken is a *broken* sword and Root
 * is a *chained* boot against Haste's wing, deliberately: the counter-relation
 * should be legible from the silhouette before the colour is read at all.
 *
 * Kept schematic on purpose. Even at NAMEPLATE-LAYOUT's size these are small
 * marks over a unit's head; fine detail there is noise, and silhouette is the
 * thing that survives.
 */
export const GLYPH_BOX = 24;

/** One stroked or filled path in the 24×24 glyph box. */
export interface GlyphPart {
  d: string;
  /** Filled rather than stroked. Strokes are `GLYPH_STROKE` wide, round-capped. */
  fill?: boolean;
}

/** Stroke width for un-filled parts, in glyph-box units. */
export const GLYPH_STROKE = 2;

export const STATUS_GLYPHS: Readonly<Record<string, readonly GlyphPart[]>> = {
  // BURN-VISIBLE — flame. Filled, because a burn should read as a solid mass at
  // pip size where an outline would close up into a blob anyway.
  damageOverTime: [
    { d: 'M13 2 c1 4 5 6 5 11 a6 6 0 0 1 -12 0 c0 -3 2 -4 3 -6 c1 2 2 2 2 -1 c0 -2 1 -3 2 -4 z', fill: true },
  ],
  // BURN-VISIBLE — a cross over a rising arc: the cross says heal, the arc says
  // it keeps happening. Deliberately not a second leaf; Haste already owns the
  // wing and two organic silhouettes in one row would be one silhouette.
  healOverTime: [
    { d: 'M9.5 2 h5 v5 h5 v5 h-5 v5 h-5 v-5 h-5 V7 h5 z', fill: true },
    { d: 'M3 21 c5 -4 13 -4 18 0' },
  ],
  // Chained boot — the sole and upper as one silhouette, with a shackle ring.
  root: [
    { d: 'M8 3 h4.5 v10 H19 v5 H8 z', fill: true },
    { d: 'M14.5 3.5 a3 3 0 1 1 0 6 a3 3 0 1 1 0 -6' },
  ],
  // Hourglass — the two rails cross at the waist, so it reads at any size.
  slow: [
    { d: 'M6 3 h12 M6 21 h12' },
    { d: 'M7.5 3 L12 12 L7.5 21 M16.5 3 L12 12 L16.5 21' },
  ],
  // Broken sword — Might's blade with the top third snapped off and floating.
  weaken: [
    { d: 'M12 2 l3 4 v3 h-6 V6 z', fill: true },
    { d: 'M9 13 h6 v3 h-6 z', fill: true },
    { d: 'M6 16 h12 M12 16 v6' },
  ],
  // Eye — the owner's word for Revealed.
  reveal: [
    { d: 'M2 12 c4 -6 16 -6 20 0 c-4 6 -16 6 -20 0 z' },
    { d: 'M15 12 a3 3 0 1 1 -6 0 a3 3 0 1 1 6 0', fill: true },
  ],
  // Bubble — the remaining absorption is drawn inside it as a numeral.
  shield: [
    { d: 'M12 2 l8 3.5 v6 c0 5.5 -3.6 8.6 -8 10.5 c-4.4 -1.9 -8 -5 -8 -10.5 v-6 z' },
  ],
  // Sword, whole — the owner's word for Might.
  might: [
    { d: 'M12 2 l3 4 v8 h-6 V6 z', fill: true },
    { d: 'M6 15 h12 M12 15 v7' },
  ],
  // Wing — Root's opposite, and the only glyph that leans.
  haste: [
    { d: 'M2 16 c7 -9 14 -11 20 -11 c-3 8 -10 12 -20 11 z', fill: true },
    { d: 'M6 16 c4 -4 8 -6 12 -8' },
  ],
  energized: [
    { d: 'M13 2 L5 13 h5 l-1 9 L19 10 h-6 z', fill: true },
  ],
  // Battering ram — a log with a head, pointing where it will not be stopped.
  unstoppable: [
    { d: 'M2 9 h13 v6 H2 z', fill: true },
    { d: 'M15 7 l6 5 -6 5 z', fill: true },
  ],
  untargetable: [
    { d: 'M5 21 V11 a7 7 0 0 1 14 0 v10 l-3.5 -2.5 -3.5 2.5 -3.5 -2.5 z' },
    { d: 'M10.7 11 a1.3 1.3 0 1 1 -2.6 0 a1.3 1.3 0 1 1 2.6 0', fill: true },
    { d: 'M15.9 11 a1.3 1.3 0 1 1 -2.6 0 a1.3 1.3 0 1 1 2.6 0', fill: true },
  ],
  // Snapped branch — a leafy stem with a break through it. The bush, and the
  // fact that it is no longer working.
  brushBroken: [
    { d: 'M4 21 C7 14 11 9 19 4' },
    { d: 'M9 14 C9 10 11 8 14 7' },
    { d: 'M13 18 C14 15 16 13 19 12' },
    { d: 'M17 3 l4 6 M21 3 l-4 6' },
  ],
  // INTERCEPT-GUARD — a shield with a figure standing behind it: somebody is in
  // front of you. The design asked for exactly this glyph.
  guard: [
    { d: 'M12 2.5 L20 5.5 v6 c0 5 -3.5 8.5 -8 10 -4.5 -1.5 -8 -5 -8 -10 v-6 z' },
    { d: 'M12 8 a1.8 1.8 0 1 1 0 3.6 a1.8 1.8 0 1 1 0 -3.6', fill: true },
    { d: 'M8.5 17.5 c0 -2.5 1.6 -4 3.5 -4 s3.5 1.5 3.5 4' },
  ],
  // Domino mask — drawn to the owning team only (`OWNER_ONLY_PIPS`).
  stealth: [
    { d: 'M2.5 8.5 h19 v3 c0 4 -4.5 5 -7.5 2.5 L12 12.5 l-2 1.5 C7 16.5 2.5 15.5 2.5 11.5 z' },
    { d: 'M9 11 a1.6 1.6 0 1 1 -3.2 0 a1.6 1.6 0 1 1 3.2 0', fill: true },
    { d: 'M18.2 11 a1.6 1.6 0 1 1 -3.2 0 a1.6 1.6 0 1 1 3.2 0', fill: true },
  ],
};

/**
 * The glyph for a status, or an empty list for a kind with none.
 *
 * Empty rather than a fallback shape: a missing glyph should look missing, and
 * a generic square would be a colour pip again with extra steps.
 */
export const statusGlyph = (kind: EffectKind): readonly GlyphPart[] => STATUS_GLYPHS[kind] ?? [];

/**
 * The glyph as SVG markup, for the DOM consumers (the HUD strip, the inspect
 * panel). `colour` is applied to both fill and stroke, so one status is one
 * colour whichever way its parts are drawn.
 *
 * A string rather than nodes because this module stays DOM-free — the caller
 * decides whether that becomes `innerHTML` or a parsed fragment. Nothing here
 * is user-authored, so there is no interpolation to escape: `kind` indexes a
 * fixed table and `colour` is written by the caller from `PIP_COLORS`.
 */
export function glyphSvg(kind: EffectKind, colour: string): string {
  const parts = statusGlyph(kind).map((p) => p.fill === true
    ? `<path d="${p.d}" fill="${colour}"/>`
    : `<path d="${p.d}" fill="none" stroke="${colour}" stroke-width="${GLYPH_STROKE}"`
      + ' stroke-linecap="round" stroke-linejoin="round"/>').join('');
  return `<svg viewBox="0 0 ${GLYPH_BOX} ${GLYPH_BOX}" aria-hidden="true">${parts}</svg>`;
}

export interface StatusPip {
  kind: EffectKind;
  color: number;
  /**
   * NAMEPLATE-LAYOUT's polarity ink — red for a debuff, blue for a buff.
   *
   * Carried alongside `color` rather than replacing it because the two answer
   * different questions for different consumers: the nameplate has room for
   * polarity and nothing else, while the HUD strip and the inspect panel name
   * the status and can afford its own hue. One `statusPips` call feeds both, so
   * they can never disagree about *which* statuses are on a unit.
   */
  tint: number;
  /**
   * The numeral drawn on the glyph: turns left, or — for `shield` — the
   * absorption remaining, which is the number a player actually plans against.
   * Absent when there is nothing worth stamping.
   */
  numeral?: number;
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
export function statusPips(
  statuses: readonly { kind: EffectKind; remaining?: number; amount?: number }[],
): StatusPip[] {
  const present = new Set(statuses.map((s) => s.kind));
  return PIP_ORDER.filter((kind) => present.has(kind)).map((kind) => {
    const mine = statuses.filter((s) => s.kind === kind);
    // Shield stamps what is left to absorb, everything else stamps turns left —
    // "two more turns of Slow" and "twenty more damage of shield" are the two
    // different questions a player is actually asking. Playback folds the event
    // log, which carries neither, so the numeral is simply absent there rather
    // than invented.
    const numeral = kind === 'shield'
      ? mine.reduce((sum, s) => sum + (s.amount ?? 0), 0)
      : Math.max(0, ...mine.map((s) => s.remaining ?? 0));
    return {
      kind,
      color: PIP_COLORS[kind] ?? 0xffffff,
      tint: pipTint(kind),
      ...(numeral > 0 ? { numeral } : {}),
    };
  });
}

/**
 * BUFF-UI — the pip row says *something is on you*; this says **what, and for
 * how long**.
 *
 * The Dev Note was "UI for buffs needs to be more clear". The pips were the
 * whole of the buff UI: eleven 0.09-unit squares floating over a model, told
 * apart only by colour. That is enough to notice a status and not nearly enough
 * to play around one — "am I slowed, and does it wear off before I commit to
 * this move?" was unanswerable without a state dump. Colour alone also asks the
 * player to memorise eleven of them, and gives a colour-blind player nothing.
 *
 * So the same table gains a **name**, a **plain-language line about what it
 * does**, and the row below carries the **remaining turns**. Same source, same
 * order, same colours — this is the pip vocabulary spelled out, not a second
 * one to keep in step.
 */
export const STATUS_LABELS: Readonly<Record<string, string>> = {
  damageOverTime: 'Burning',
  healOverTime: 'Regenerating',
  root: 'Rooted',
  slow: 'Slowed',
  weaken: 'Weakened',
  reveal: 'Revealed',
  brushBroken: 'Cover Blown',
  guard: 'Guarded',
  shield: 'Shielded',
  might: 'Might',
  haste: 'Hasted',
  energized: 'Energized',
  unstoppable: 'Unstoppable',
  untargetable: 'Untargetable',
  stealth: 'Stealthed',
};

/**
 * What each status *does*, in one line, as the tooltip.
 *
 * Deliberately about the effect and not about the numbers: the magnitudes are
 * the engine's constants and a UI that restated them would be a second place to
 * get them wrong. "Moves fewer squares" survives a balance pass; "−2 movement"
 * does not.
 */
export const STATUS_BLURBS: Readonly<Record<string, string>> = {
  // BURN-VISIBLE: the fallback wording, used when the amount is not known — the
  // playback fold has the kind and not the instance. `overTimeBlurb` replaces it
  // with the per-turn figure wherever there is one, which is the half of the AC
  // that says "hovering it names the per-turn amount".
  damageOverTime: 'Takes damage at the end of each turn.',
  healOverTime: 'Heals at the end of each turn.',
  root: 'Cannot move or dash this turn.',
  slow: 'Moves fewer squares.',
  weaken: 'Deals less damage.',
  reveal: 'Visible to the enemy team even in cover or brush.',
  brushBroken: 'Brush no longer hides this unit — any brush, until it expires.',
  guard: 'A bodyguard is standing in: enemy damage aimed at this unit is dealt to them instead.',
  shield: 'Absorbs damage before health does.',
  might: 'Deals more damage.',
  haste: 'Moves further.',
  energized: 'Gains extra ultimate energy.',
  unstoppable: 'Immune to knockback and pulls.',
  untargetable: 'Cannot be picked as a target.',
  stealth: 'Hidden from the enemy team until it acts or is revealed.',
};

/** One row in the HUD's status strip: what it is, how long, and which family. */
export interface StatusChip {
  kind: EffectKind;
  /** Display name — `STATUS_LABELS`, falling back to the raw kind. */
  label: string;
  /** The pip colour, as a CSS hex string, so the HUD needs no palette. */
  colour: string;
  /**
   * The STATUS-ICONS glyph as SVG markup, so the strip shows the *same mark*
   * that floats over the unit. A coloured dot beside a named row was already
   * legible; carrying the icon is what makes the two readings teach each other.
   */
  glyph: string;
  /** Turns left, including this one. */
  remaining: number;
  /** Shield only: how much is left to absorb. */
  amount?: number;
  harmful: boolean;
  blurb: string;
}

const cssHex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/**
 * BURN-VISIBLE — the over-time blurb, with the number in it.
 *
 * *"Hovering it names the per-turn amount."* This is the one place a blurb may
 * carry a figure, and the reason it is allowed to is that the figure is **not a
 * client constant**: it is `status.amount`, the per-turn number the engine
 * itself ticks with. The rule the other blurbs follow — describe the effect,
 * never restate a magnitude — exists so a balance pass cannot leave a lie
 * behind, and a number read off the instance cannot.
 *
 * `undefined` for every other kind, and for an over-time instance with no
 * amount, so the caller falls back to the static wording rather than showing
 * "0 damage".
 */
export function overTimeBlurb(kind: EffectKind, amount: number): string | undefined {
  if (amount <= 0) return undefined;
  if (kind === 'damageOverTime') return `Takes ${amount} damage at the end of each turn.`;
  return kind === 'healOverTime' ? `Heals ${amount} at the end of each turn.` : undefined;
}

/**
 * The HUD's status strip for one unit: `PIP_ORDER`, deduped, unknown kinds
 * dropped — the same rule as {@link statusPips}, so the strip and the pips can
 * never disagree about what is on a unit or in what order.
 *
 * Where a kind appears more than once (shield does: two casters, two
 * instances), the chip carries the **longest remaining** and the **summed
 * amount**. Longest because that is when the player stops having it, and summed
 * because two shields absorb as one pool — which is what the HP bar already
 * shows.
 */
export function statusChips(
  statuses: readonly { kind: EffectKind; remaining: number; amount?: number }[],
): StatusChip[] {
  const live = statuses.filter((s) => s.remaining > 0);
  return PIP_ORDER.filter((kind) => live.some((s) => s.kind === kind)).map((kind) => {
    const mine = live.filter((s) => s.kind === kind);
    const amount = mine.reduce((sum, s) => sum + (s.amount ?? 0), 0);
    return {
      kind,
      label: STATUS_LABELS[kind] ?? kind,
      colour: cssHex(PIP_COLORS[kind] ?? 0xffffff),
      glyph: glyphSvg(kind, cssHex(PIP_COLORS[kind] ?? 0xffffff)),
      remaining: Math.max(...mine.map((s) => s.remaining)),
      ...(amount > 0 ? { amount } : {}),
      harmful: HARMFUL_PIPS.has(kind),
      blurb: overTimeBlurb(kind, amount) ?? STATUS_BLURBS[kind] ?? '',
    };
  });
}

