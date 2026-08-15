/**
 * PREVIEW-NUMBERS — what an aimed action would do, shown before you lock it in.
 *
 * "Players should know what their action is going to do." Until now the only way
 * to find out was to lock in and watch: the aim overlay says *which squares* are
 * covered and nothing at all about *how much*, so choosing between two aims was
 * a memory test on the ability tooltips.
 *
 * Pure, and separate from `app.ts`, because the interesting part is not the
 * arithmetic — it is the **polarity**, and polarity is a rule (FF1) rather than
 * a rendering decision:
 *
 * - **Harmful** effects reach every unit in the area, ally or enemy. Friendly
 *   fire is on, so an ally standing in your own AoE gets a red number and that
 *   is exactly the warning the feature exists to give.
 * - **Beneficial** effects reach your own team only. A heal aimed over an enemy
 *   shows them nothing, because it would do nothing.
 *
 * The amounts are **nominal**: the ability's authored effect value, before
 * Might/Weaken, cover, shields or Untargetable. A plan-time preview cannot know
 * what buffs will be standing at resolution — Adrenaline resolves at the start of
 * Blast, after the plan is locked — so a "precise" number would be confidently
 * wrong. Nominal is the honest promise: this is what the ability hits for.
 */

import type { AbilityDef, GameState, UnitState, Vec2 } from '@cards/engine';

/** Red, green, blue — the three the owner asked for, and nothing else. */
export type PreviewKind = 'damage' | 'heal' | 'shield';

export interface PreviewNumber {
  unitId: string;
  kind: PreviewKind;
  amount: number;
}

/** One armed action: its definition and the squares it currently covers. */
export interface AimedAction {
  def: AbilityDef;
  squares: readonly Vec2[];
}

/** Beneficial kinds are own-team only; `damage` is the one that crosses teams. */
const OWN_TEAM_ONLY: ReadonlySet<PreviewKind> = new Set<PreviewKind>(['heal', 'shield']);
/** Stable output order, so a repaint never reshuffles numbers on one unit. */
const KIND_ORDER: readonly PreviewKind[] = ['damage', 'heal', 'shield'];

const isPreviewKind = (kind: string): kind is PreviewKind =>
  kind === 'damage' || kind === 'heal' || kind === 'shield';

/**
 * The floating numbers to show for every armed action at once.
 *
 * Several actions can be armed on one turn — an ability, a free action and a
 * catalyst are three separate slots — and they are summed per (unit, kind), so a
 * unit standing in two of your areas shows one number per colour rather than a
 * stack the eye has to add up. That sum answers the question a player is
 * actually asking: what does *my turn* do to that unit.
 */
export function previewNumbers(
  state: GameState,
  caster: UnitState,
  actions: readonly AimedAction[],
): PreviewNumber[] {
  const totals = new Map<string, number>(); // `${unitId}:${kind}` → amount
  for (const { def, squares } of actions) {
    if (squares.length === 0) continue;
    const area = new Set(squares.map((p) => `${p.x},${p.y}`));
    for (const effect of def.effects) {
      const kind = effect.kind;
      if (!isPreviewKind(kind)) continue;
      const amount = effect.amount ?? 0;
      if (amount <= 0) continue;
      for (const target of state.units) {
        if (!target.alive || !area.has(`${target.pos.x},${target.pos.y}`)) continue;
        if (OWN_TEAM_ONLY.has(kind) && target.owner !== caster.owner) continue;
        const key = `${target.unitId}:${kind}`;
        totals.set(key, (totals.get(key) ?? 0) + amount);
      }
    }
  }

  // Ordered by the units' own order in state, then by kind — deterministic, and
  // it keeps a unit's three colours in the same sequence every repaint.
  const out: PreviewNumber[] = [];
  for (const unit of state.units) {
    for (const kind of KIND_ORDER) {
      const amount = totals.get(`${unit.unitId}:${kind}`);
      if (amount !== undefined) out.push({ unitId: unit.unitId, kind, amount });
    }
  }
  return out;
}
