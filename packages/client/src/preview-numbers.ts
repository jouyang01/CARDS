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
 * It is also gated on **vision** (PREVIEW-FOG): a number over a unit the acting
 * team cannot see would hand the player the one thing fog exists to withhold —
 * a fogged enemy's exact square, readable by sweeping an aim past it. You may
 * still aim into the dark; you just are not told what is standing there.
 *
 * The amounts are **nominal**: the ability's authored effect value, before
 * Might/Weaken, cover, shields or Untargetable. A plan-time preview cannot know
 * what buffs will be standing at resolution — Adrenaline resolves at the start of
 * Blast, after the plan is locked — so a "precise" number would be confidently
 * wrong. Nominal is the honest promise: this is what the ability hits for.
 */

import type { AbilityDef, GameState, TeamId, UnitState, Vec2 } from '@cards/engine';

/** Red, green, blue — the three the owner asked for, and nothing else. */
export type PreviewKind = 'damage' | 'heal' | 'shield';

export interface PreviewNumber {
  /** The unit **or decoy** the number belongs to. */
  targetId: string;
  kind: PreviewKind;
  amount: number;
  /**
   * Where to anchor it. Carried rather than looked up, because half the targets
   * are decoys and a decoy is deliberately not in `state.units` (edge-cases R2).
   */
  pos: Vec2;
}

/**
 * A decoy as a preview target (PREVIEW-DECOY).
 *
 * Structurally what `FogView.decoys` already hands out, so the caller passes
 * that list straight in — which is also the **fog gate**: a decoy the viewer
 * cannot see is simply absent from it, exactly as a hidden enemy is absent from
 * the fogged unit list.
 */
export interface PreviewDecoy {
  id: string;
  pos: Vec2;
  /** The team that placed it. Polarity reads this exactly as it reads a unit's. */
  owner: TeamId;
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
  /**
   * Unit ids the acting seat's team can currently see — `fogView().units`,
   * the same answer the board is already drawn from, so a number can never
   * appear over a unit the player is not being shown.
   *
   * Required rather than defaulted: a default of "everyone" is the leak this
   * parameter exists to close, and it would fail silently.
   */
  visible: ReadonlySet<string>,
  /**
   * Decoys the viewer can see, per PREVIEW-DECOY. **A client-side fiction on
   * purpose:** the engine gives a decoy no heals and no shields and kills it
   * with any damage (edge-cases R2). What the number shows is what the action
   * would do to *the character the viewer believes is standing there* — because
   * the absence of a number is itself a tell, and a decoy that previews
   * differently from a real Wisp outs itself for free.
   */
  decoys: readonly PreviewDecoy[] = [],
): PreviewNumber[] {
  const totals = new Map<string, number>(); // `${targetId}:${kind}` → amount
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
        // PREVIEW-FOG. Own units are always visible to their own team, so this
        // only ever removes enemies — and it asks the fog view rather than
        // re-deriving sight, exactly like every other client consumer.
        if (target.owner !== caster.owner && !visible.has(target.unitId)) continue;
        const key = `${target.unitId}:${kind}`;
        totals.set(key, (totals.get(key) ?? 0) + amount);
      }
      // Decoys take the same polarity rule off the same `owner` field, so a
      // decoy in your AoE reads exactly like the unit it is pretending to be.
      // No vision check: the list is the fogged one.
      for (const decoy of decoys) {
        if (!area.has(`${decoy.pos.x},${decoy.pos.y}`)) continue;
        if (OWN_TEAM_ONLY.has(kind) && decoy.owner !== caster.owner) continue;
        const key = `${decoy.id}:${kind}`;
        totals.set(key, (totals.get(key) ?? 0) + amount);
      }
    }
  }

  // Ordered by the targets' own order — units as they sit in state, then decoys
  // as the fog view listed them — and by kind within each. Deterministic, and it
  // keeps a target's three colours in the same sequence every repaint.
  const out: PreviewNumber[] = [];
  const emit = (targetId: string, pos: Vec2): void => {
    for (const kind of KIND_ORDER) {
      const amount = totals.get(`${targetId}:${kind}`);
      if (amount !== undefined) out.push({ targetId, kind, amount, pos: { x: pos.x, y: pos.y } });
    }
  };
  for (const unit of state.units) emit(unit.unitId, unit.pos);
  for (const decoy of decoys) emit(decoy.id, decoy.pos);
  return out;
}
