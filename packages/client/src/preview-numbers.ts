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
 * PREVIEW-MODIFIERS — the damage number is what the hit would **actually deal**.
 *
 * Owner Dev Note: *"Should account for Might + Cover + Weakness."* A nominal 20
 * over a target in cover is wrong by half, and a player who plans around it
 * learns the preview lies. The number now runs through the engine's own
 * `computeDamage` and `isBehindCover` — the ruled composition, outgoing
 * Might/Weaken then cover reduction — because a second implementation of the
 * damage math is a second answer waiting to disagree with the resolution.
 *
 * What it still cannot know is a status that lands **this turn**: Adrenaline's
 * Might resolves at the start of Blast, after the plan is locked. So the preview
 * reflects **current** state and does not try to predict post-lock buffs. That
 * is the same honest limit PREVIEW-FOG lives with, and the alternative — a
 * confident guess about what the enemy is about to do — is worse than a number
 * that is occasionally conservative.
 *
 * Shields are deliberately not folded in (edge-cases: flagged, not required):
 * the number is the post-cover damage, and the nameplate shows the shield pool
 * separately. Heals and shields keep their authored amounts — the owner named
 * Might, Cover and Weaken, all of which are outgoing-damage rules.
 *
 * PREVIEW-NUMBERS-AUDIT — *"AUDIT ALL DAMAGE PREVIEWS TO ENSURE THEY ARE
 * CORRECT."*
 *
 * PREVIEW-MODIFIERS got the *modifiers* right and still previewed the wrong
 * number, because it took `effect.amount` as **the** damage. It is not: the
 * engine composes a per-tile figure before any modifier runs, and four rules
 * were missing from this file entirely.
 *
 * - **BASIC-INNER** — a tile in the disc's core takes `innerAmount` *instead
 *   of* the ring's number. Cinder's Ember Bolt is 22 in the middle and 14
 *   around it, and every tile previewed 14 (Dev Note #2, named exactly).
 * - **BASIC-AXIS** — a tile on the wedge's centre line takes `axisBonus` on top
 *   (Bastion, +8).
 * - **CASTER-SAFE** — the caster is not a target of its own harmful effects, but
 *   Ravok stands inside every one of his `range: 0` discs, so his own square
 *   previewed the enemies' full 22.
 * - **RECOIL** — and now that RAVOK-RECOIL priced the whirl, that same square
 *   genuinely takes **11**. Dev Note #3 spells the whole table out: "11 to
 *   himself, 22 to enemies for whirling cleave … 12 to enemies for shockwave and
 *   nothing on Ravok … seismic rupture should show 19 damage to ravok and 38 to
 *   others."
 *
 * ALLY-SAFE (`noFriendlyFire`) and UNTGT1 (`untargetable`) join them for the
 * same reason: both make the engine skip a target this file was still drawing a
 * number over.
 *
 * The composition below is `runBlast`'s, in the same order — inner *replaces*,
 * axis *adds*, then Might/Weaken/cover — and the axis and inner tile sets are
 * handed in from the engine's own `axisSquares`/`innerSquares` rather than
 * re-derived here. That is the whole discipline of the item: a client that
 * worked out for itself which tiles look like the core would be a second
 * geometry, and the previewed number would drift from the dealt one the first
 * time the shapes changed.
 */

import {
  computeDamage, hasStatus, isBehindCover,
  type AbilityDef, type Board, type GameState, type TeamId, type UnitState, type Vec2,
} from '@cards/engine';

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
  /**
   * RAM-LINE-PREVIEW-FIX — for a `path` charge, the units the charge actually
   * damages, from the engine's own `chargeVictims`.
   *
   * A charge is the one shape where standing in the area is **not** enough to be
   * hit: `hits` decides whether it is the first crossed unit or all of
   * them, and the area is the whole route either way. Kestrel's Skim is
   * first-only, and the preview was numbering *every* enemy on the route for 12
   * — promising two hits where one lands.
   *
   * Absent means "the area is the answer", which is true of every other shape.
   */
  victims?: readonly string[];
  /**
   * PREVIEW-NUMBERS-AUDIT — the two interior bands, straight from the engine's
   * `axisSquares` / `innerSquares` (via `previewBandSets`).
   *
   * Optional because most abilities have neither, and absent means "no band",
   * not "unknown": an ability that declares `axisBonus` or `innerAmount` and is
   * handed no bands simply previews its flat number, which is the pre-audit
   * behaviour rather than a crash. Callers that draw the bands already compute
   * these — `previewBands` is the same pair concatenated — so passing them in
   * costs nothing and keeps the number and the highlight derived from one
   * source.
   */
  axis?: readonly Vec2[];
  inner?: readonly Vec2[];
  /**
   * AOE-LoS — the square this action's **cover** is measured from, when it is
   * not the caster's own: for a `circle`, the aimed centre.
   *
   * Passed in rather than derived because `squares` is the *expanded* area and a
   * disc clipped by a wall has no recoverable centre. Callers get it from the
   * engine's `coverOrigin`, which is the same function `runBlast` uses, so the
   * previewed number and the resolved one cannot disagree about which side of a
   * barricade the explosion was on.
   *
   * Absent means "the caster", which is right for every direct-fire shape.
   */
  coverFrom?: Vec2;
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
  /**
   * The board, for `isBehindCover` (PREVIEW-MODIFIERS). Cover is pure geometry
   * and knowable at plan time, so there is no excuse for the preview not to
   * know it.
   */
  board: Board,
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
  const key = (p: Vec2): string => `${p.x},${p.y}`;
  for (const { def, squares, axis, inner, victims, coverFrom } of actions) {
    if (squares.length === 0) continue;
    // RAM-LINE-PREVIEW-FIX: a charge names its victims; every other shape lets
    // the area name them.
    const hitList = victims === undefined ? undefined : new Set(victims);
    const area = new Set(squares.map(key));
    // BASIC-AXIS / BASIC-INNER, engine-derived. Sets rather than lists because
    // the question asked per target is membership.
    const axisTiles = new Set((axis ?? []).map(key));
    const innerTiles = new Set((inner ?? []).map(key));
    const axisBonus = def.axisBonus ?? 0;
    // ALLY-SAFE (Dev Note #11): an ability may opt out of friendly fire, and one
    // shipped ability does — Lumen's Radiant Lash damages enemies in the line
    // and heals allies in the same line. A red number over the ally it is
    // healing is the reading this closes.
    const allySafe = def.noFriendlyFire === true;

    for (const effect of def.effects) {
      const kind = effect.kind;
      if (!isPreviewKind(kind)) continue;
      const amount = effect.amount ?? 0;
      // `innerAmount` can carry the whole blow on a tile where `amount` is 0,
      // so the "does this effect do anything" gate has to see both.
      if (Math.max(amount, kind === 'damage' ? def.innerAmount ?? 0 : 0) <= 0) continue;
      /**
       * `runBlast`'s composition, in `runBlast`'s order.
       *
       * Inner **replaces** the ring's number (a falloff is authored as two
       * numbers, not a number and a discount); axis **adds** on top (the bonus
       * is part of the blow); and only then do Might, Weaken and cover apply —
       * because both bands are "which blow landed", not a second one.
       */
      const dealt = (at: Vec2): number => {
        if (kind !== 'damage') return amount;
        const here = key(at);
        const base = def.innerAmount !== undefined && innerTiles.has(here) ? def.innerAmount : amount;
        const raw = base + (axisTiles.has(here) ? axisBonus : 0);
        // MELEE-COVER: a melee strike is not reduced by cover, so the preview
        // must not reduce it either — the whole point of routing through the
        // engine is that the two cannot disagree.
        // AOE-LoS: a blast's cover is measured from its centre, not from the
        // thrower — `coverFrom` carries that, and its absence means the caster.
        return computeDamage(raw, caster, def.melee === true
          ? false
          : isBehindCover(board, coverFrom ?? caster.pos, at, def.range));
      };

      for (const target of state.units) {
        if (!target.alive || !area.has(key(target.pos))) continue;
        // A charge's damage reaches only the units `hits` selected — but
        // its beneficial half, and anything an `impact` disc covers, is an area
        // effect like any other, so the list gates the damage alone.
        if (hitList !== undefined && kind === 'damage' && !hitList.has(target.unitId)) continue;
        if (OWN_TEAM_ONLY.has(kind) && target.owner !== caster.owner) continue;
        // PREVIEW-FOG. Own units are always visible to their own team, so this
        // only ever removes enemies — and it asks the fog view rather than
        // re-deriving sight, exactly like every other client consumer.
        if (target.owner !== caster.owner && !visible.has(target.unitId)) continue;
        if (kind === 'damage') {
          // CASTER-SAFE: you are never a target of your own harmful effects.
          // Ravok stands inside every one of his `range: 0` discs, so without
          // this his own square previewed the enemies' full number. What he
          // actually pays is the recoil, added below.
          //
          // FRAG-SELF is the exception the engine now carries, so the preview
          // carries it too: an ability that opts out numbers its caster like
          // anyone else standing in the blast. Keeping quiet about the 34 you
          // are about to take is the exact failure PREVIEW-NUMBERS-AUDIT exists
          // to prevent — the rule changed, the preview did not, and the player
          // finds out by dying.
          if (target.unitId === caster.unitId && def.selfHarm !== true) continue;
          if (allySafe && target.owner === caster.owner) continue;
          // UNTGT1: the whole harmful half is skipped for an untargetable unit.
          if (hasStatus(target, 'untargetable')) continue;
        }
        totals.set(`${target.unitId}:${kind}`,
          (totals.get(`${target.unitId}:${kind}`) ?? 0) + dealt(target.pos));
      }
      // Decoys take the same polarity rule off the same `owner` field, so a
      // decoy in your AoE reads exactly like the unit it is pretending to be.
      // No vision check: the list is the fogged one. Cover applies to them too:
      // a decoy that previewed full damage from behind a wall the real unit
      // would be reduced by is a tell, and this fiction has to be seamless.
      for (const decoy of decoys) {
        if (!area.has(key(decoy.pos))) continue;
        if (OWN_TEAM_ONLY.has(kind) && decoy.owner !== caster.owner) continue;
        if (kind === 'damage' && allySafe && decoy.owner === caster.owner) continue;
        totals.set(`${decoy.id}:${kind}`,
          (totals.get(`${decoy.id}:${kind}`) ?? 0) + dealt(decoy.pos));
      }
    }

    /**
     * RECOIL — the caster's own square, which CASTER-SAFE just excluded.
     *
     * `selfDamagePct` is a **cost of firing**, so it is outside the target loop:
     * it is charged whether or not the caster stands in the area, and whether or
     * not the swing hit anybody. The engine scales the ability's plain `damage`
     * amount — not the inner number, not the axis bonus — and the result bypasses
     * cover, Might and Weaken (it is the authored number scaled, not an attack
     * aimed at yourself), so `computeDamage` is deliberately not called here.
     *
     * 11 for Whirling Cleave, 19 for Seismic Rupture, and nothing at all for
     * Shockwave, which carries no `selfDamagePct` — the table from Dev Note #3.
     */
    const recoilPct = def.selfDamagePct;
    if (recoilPct !== undefined && caster.alive) {
      const base = def.effects.find((e) => e.kind === 'damage')?.amount ?? 0;
      const recoil = Math.floor((base * recoilPct) / 100);
      if (recoil > 0) {
        totals.set(`${caster.unitId}:damage`, (totals.get(`${caster.unitId}:damage`) ?? 0) + recoil);
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
