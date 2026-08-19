/**
 * The turn pipeline: `resolveTurn` runs one turn as Prep → Dash → Blast → Move
 * and returns the new state plus the ordered event log the client animates.
 *
 * PURE AND DETERMINISTIC (CLAUDE.md golden rule #1). The incoming state is deep
 * cloned once; everything below edits the clone, so the caller's objects are
 * never touched. No randomness, no clock, no I/O; integer game values only;
 * units are always iterated in `state.units` order so nothing depends on object
 * key order.
 *
 * Phase order is sacred (golden rule #4): Prep resolves fully before Dash, Dash
 * before Blast, Blast before Move. Dash immunity to Blast aimed at a vacated
 * square is automatic here — Blast is resolved against post-Dash positions, so a
 * unit that dashed away is simply no longer on the aimed square (free-aim does
 * not track). Deaths are mid-phase: a unit at 0 HP is marked dead the instant
 * damage applies and takes no part in later phases.
 *
 * This module wires together board/movement (BACKLOG 1), vision (2), cover (3),
 * combat (5), statuses (6) and shapes (5a). Dash execution (7), displacement (8)
 * and trap triggers (9) attach at the marked seams and grow in their own commits.
 */

import {
  type Board,
  blocksMovement,
  buildBoard,
  diagonalCornerBlocked,
  distance,
  inBounds,
  isAdjacentStep,
  isDiagonalStep,
  terrainAt,
  vecEq,
  vecKey,
} from './board.js';
import {
  applyDamage,
  applyHeal,
  computeDamage,
  grantEnergy,
  isBehindCover,
  outgoingDamagePct,
  scaleDamage,
} from './combat.js';
import {
  PASSIVE_ENERGY,
  RESPAWN_TURNS,
  REVEAL_ON_ATTACK_TURNS,
  TRAP_MAX_LIFETIME,
  ULT_COST,
} from './constants.js';
import { getFormat } from './formats.js';
import { movementBudget, pathWithinBudget, reachableSquares, reconstructPath, stepCost, validateMovePath } from './movement.js';
import { POWERUP_EFFECTS, powerupSourceId } from './powerups.js';
import { aimInRange, axisSquares, circleSquares, direction8, expandShape, innerSquares, isAimStep } from './shapes.js';
import { OVER_TIME_KINDS, applyStatus, hasStatus, isImmuneTo, isStatusKind, removeStatus, tickStatuses } from './status.js';
import { buildVision, teamCanSee, teamHasSightline, type Vision } from './vision.js';
import type { CatalystPool } from './catalysts.js';
import type {
  AbilityDef,
  AbilityEffect,
  AbilityProfile,
  AbilityPhase,
  CharacterDef,
  DecoyState,
  EffectKind,
  GameState,
  AbilityOrder,
  LastKnownPos,
  MapDef,
  PlayerOrders,
  TeamId,
  TrapState,
  TurnEvent,
  TurnResult,
  UnitOrders,
  UnitState,
  Vec2,
} from './types.js';

/** Character definitions the pipeline resolves ability ids against, by id. */
export type Roster = Readonly<Record<string, CharacterDef>>;

/** Look up an ability (including the ultimate) on a character. */
export function findAbility(
  roster: Roster,
  characterId: string,
  abilityId: string,
): { def: AbilityDef; isUlt: boolean } | undefined {
  const character = roster[characterId];
  if (character === undefined) return undefined;
  const ability = character.abilities.find((a) => a.id === abilityId);
  if (ability !== undefined) return { def: ability, isUlt: false };
  if (character.ultimate.id === abilityId) return { def: character.ultimate, isUlt: true };
  return undefined;
}

/**
 * BASIC-MODES — the ability as this order aims it.
 *
 * One function, applied once, at the single place an order becomes a plan. That
 * is the whole implementation: every consumer downstream — `expandShape`,
 * `aimIsLegal`, `axisSquares`, `innerSquares`, the client's preview — receives
 * an ordinary `AbilityDef` and never learns that modes exist. A knob that had to
 * be threaded through the geometry would be a knob every future shape has to
 * remember.
 *
 * The overlay is the profile's **own keys only** (`AbilityProfile` is spelled
 * out, so those keys are exactly the aim-time geometry), which means a mode that
 * omits `radius` inherits the ability's. `id` is untouched on purpose: cooldowns
 * and energy key off it, and a mode is the same ability aimed differently.
 *
 * An absent, non-integer or out-of-range `mode` returns the def unchanged. A
 * refusal would be the wrong answer to a number: the ability still exists and
 * still has a default profile, and an order that lost its mode should lose the
 * *mode*, not the turn.
 */
export function abilityProfile(def: AbilityDef, mode: number | undefined): AbilityDef {
  const modes = def.modes;
  if (modes === undefined || mode === undefined) return def;
  if (!Number.isInteger(mode) || mode < 0 || mode >= modes.length) return def;
  const { name, ...geometry } = modes[mode] as AbilityProfile;
  // Spread over the def rather than picked out of it: the profile's keys are the
  // override, and the ones it does not carry stay the ability's own.
  return { ...def, ...geometry, ...(name === undefined ? {} : { name }) };
}

// ── Normalised, validated plans ─────────────────────────────────────────────

interface PlannedAbility {
  def: AbilityDef;
  aim: Vec2[];
  area: Vec2[];
  /**
   * BASIC-AXIS — the covered tiles on a cone's central line, empty for every
   * other shape and for a cone without the knob.
   *
   * Computed here with the area rather than at Blast time for one reason: the
   * area is anchored at the caster's **planning** position, and an axis derived
   * later from a post-Dash position would name tiles the area does not contain.
   */
  axis: Vec2[];
  /**
   * BASIC-INNER — the covered tiles inside a circle's inner disc, empty for
   * every other shape and for a circle without the knob. Computed here beside
   * the area for the same anchoring reason the axis is.
   */
  inner: Vec2[];
  isUlt: boolean;
}

interface UnitPlan {
  unit: UnitState;
  ability?: PlannedAbility;
  /**
   * A free action (FREE1) declared **alongside** `ability`. Kept in its own
   * field for exactly the reason the mechanic exists: everything that reads
   * `ability` to decide what a turn costs — the Sprint exclusion above all —
   * must not see this one.
   */
  freeAbility?: PlannedAbility;
  /** A catalyst (CAT1), likewise additive and likewise invisible to pricing. */
  catalyst?: PlannedAbility;
  /**
   * A chase target's unit id (CHASE1) — the alternative to `movePath`, resolved
   * at the end of Move rather than planned as squares, because the point of a
   * chase is that it tracks where the target ends up.
   */
  chase?: string;
  /**
   * Where a Shift will drop this unit, when it declared one. Everything from
   * Dash onward was planned from that square, so if the teleport turns out to be
   * blocked those plans no longer describe anything and are discarded.
   */
  shiftTo?: Vec2;
  movePath: Vec2[];
  sprint: boolean;
}

/**
 * Effect allegiance (GAME_SPEC §1 / edge-cases "No friendly fire"): harmful
 * effects only ever apply to enemies, beneficial effects only to the caster's
 * own team. teleport/decoy/trap are neither — they are self/placement effects
 * handled by their own phase, not filtered by area allegiance.
 */
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
]);
export const NEUTRAL_KINDS: ReadonlySet<EffectKind> = new Set<EffectKind>([
  'teleport',
  'decoy',
  'trap',
]);

/**
 * CASTER-SAFE — the effects of an ability that may land on the unit that fired
 * it: everything except the harmful half.
 *
 * FF1 says a harmful effect reaches every unit standing in the area, "ally or
 * enemy". It was never meant to read *including yourself*: Ravok's Whirling
 * Cleave is a `circle` with `range: 0`, so its area is centred on him and he
 * took the full 22 off his own swing; Shockwave hit him for 12 and slowed him
 * as well. No kit wants accidental self-harm, so the rule is global rather
 * than a flag per ability — a unit is never a target of its own ability's
 * harmful effects (Dev Notes #16 + #18, `dev-notes-batch-3.md` §B).
 *
 * The one way back in is deliberate: `selfDamagePct` (RECOIL), which is priced
 * into the ability rather than suffered by accident. Note the asymmetry is
 * only about *harm* — a self-cast's shields, heals and buffs are untouched,
 * and an ALLY standing in your own area is still hit, because CASTER-SAFE
 * excludes the caster and nobody else (that is ALLY-SAFE, a separate item).
 */
function casterSafe(effects: readonly AbilityEffect[]): readonly AbilityEffect[] {
  return effects.filter((e) => !HARMFUL_KINDS.has(e.kind));
}

/**
 * UNTGT1 — Untargetable is "cannot be hit this phase/turn" (GAME_SPEC §6), and
 * until now it was the one status that changed no resolved outcome: Fade and
 * Shadowstep applied it, nothing read it back except `fireCatalyst`.
 *
 * A unit carrying it is skipped by the whole HARMFUL half of an aimed ability —
 * damage, displacement and debuffs alike, because a hit that lands its knockback
 * but not its damage is not "untargetable", it is "half targetable". Beneficial
 * effects still reach it: hiding from attacks is not hiding from your medic.
 *
 * Scope is aimed offence — Blast, Dash impact/charge, a delayed detonation and a
 * catalyst. Traps are placed hazards, which edge-cases already holds apart from
 * aimed attacks (they are team-safe and outside friendly fire), so stepping on
 * one still hurts; DECISIONS 2026-08-28 records that carve-out.
 */
const isUntargetable = (u: UnitState): boolean => hasStatus(u, 'untargetable');

/**
 * Stealth broken — by attacking, or by taking damage (GAME_SPEC §6). Logged as
 * well as applied: the client's status indicators are folded from the event log
 * during playback and are forbidden from deriving when a status went away, so a
 * removal that is silent in the log is a pip that stays lit over a unit that is
 * standing in plain sight.
 */
function breakStealth(unit: UnitState, events: TurnEvent[]): void {
  if (removeStatus(unit, 'stealth')) {
    events.push({ type: 'statusRemoved', unitId: unit.unitId, status: 'stealth', reason: 'broken' });
  }
}

/**
 * CAMO-REVEAL — is this unit hidden *right now*, for the purpose of the
 * camouflage penalty?
 *
 * Deliberately a property of the **tile**, not of any observer. `isConcealedFrom`
 * (vision.ts) takes an observer because the brush adjacency exception makes
 * concealment per-observer — a unit in brush is hidden from a distant enemy and
 * plainly visible to an adjacent one — so "am I concealed?" has no
 * observer-free answer there, and gating a reveal on it would reveal you to some
 * enemies and not others off a single action. The owner's rule is "*while inside
 * a camouflage zone*": a place you are standing.
 *
 * `at` is passed rather than read off the unit because a catalyst can move you
 * (Shift) before this is asked — the tile that matters is the one you acted from.
 */
function isConcealed(board: Board, unit: UnitState, at: Vec2): boolean {
  return terrainAt(board, at) === 'brush' || hasStatus(unit, 'stealth');
}

/** Apply the 2-turn Reveal and log it. The caller owns the "should I?" question. */
function applyReveal(unit: UnitState, abilityId: string, events: TurnEvent[]): void {
  applyStatus(unit, 'reveal', REVEAL_ON_ATTACK_TURNS);
  events.push({
    type: 'statusApplied', unitId: unit.unitId, status: 'reveal',
    duration: REVEAL_ON_ATTACK_TURNS, sourceUnitId: unit.unitId, abilityId,
  });
}

/**
 * CAMO-REVEAL — acting from concealment gives you away for this turn and the
 * next, and turns the camouflage tile red.
 *
 * **Additive.** Dealing damage already reveals you whether you were hidden or
 * not, and that stays exactly as it was — dropping it would let a unit shoot
 * from open ground and vanish into brush the next turn for free. What this adds
 * is the three triggers the owner named that were silent before: using a
 * catalyst, using a harmful ability that deals no damage, and taking a hit.
 *
 * Stealth breaks with it: GAME_SPEC §6 says Reveal only *masks* Stealth, so
 * leaning on the Reveal alone would re-hide the unit the moment it expired.
 */
function revealIfConcealed(
  board: Board, unit: UnitState, at: Vec2, abilityId: string, events: TurnEvent[],
): void {
  if (!unit.alive || !isConcealed(board, unit, at)) return;
  breakStealth(unit, events);
  applyReveal(unit, abilityId, events);
}

/**
 * Taking damage: Stealth always breaks (GAME_SPEC §6), and a unit that was
 * *concealed* when it was hit is additionally revealed (CAMO-REVEAL) — a
 * brush-hidden unit that takes a hit used to keep its concealment next turn,
 * which is the half of the owner's rule the engine was missing.
 *
 * Order matters: concealment is read **before** `breakStealth`, or a stealthed
 * unit standing in the open would have its own gate cleared out from under it.
 */
function onDamageTaken(
  board: Board, victim: UnitState, abilityId: string, events: TurnEvent[],
): void {
  const concealed = isConcealed(board, victim, victim.pos);
  breakStealth(victim, events);
  if (concealed) applyReveal(victim, abilityId, events);
}

/** Does this ability count as "an offensive ability" for CAMO-REVEAL? */
const isHarmfulUse = (def: AbilityDef): boolean =>
  def.effects.some((e) => HARMFUL_KINDS.has(e.kind));

/** Does using this ability grant its energy even without hitting an enemy? */
function isSelfOrUtility(def: AbilityDef): boolean {
  return (
    def.shape === 'self' ||
    def.effects.some((e) => NEUTRAL_KINDS.has(e.kind) || BENEFICIAL_KINDS.has(e.kind))
  );
}

/**
 * Validate a single unit's order against the current draft, dropping any illegal
 * component (an unusable ability, an illegal path) rather than the whole order —
 * deterministic rejection, never a throw. Returns `undefined` if the unit is not
 * this team's or is dead.
 */
function planUnit(
  board: Board,
  draft: GameState,
  roster: Roster,
  catalysts: CatalystPool,
  team: TeamId,
  order: UnitOrders,
): UnitPlan | undefined {
  const unit = draft.units.find((u) => u.unitId === order.unitId);
  if (unit === undefined || unit.owner !== team || !unit.alive) return undefined;

  // A Shift (CAT1) resolves at the START of Dash, so everything the unit does
  // from Dash onward happens at its landing square — a dash ability aimed from
  // where it used to stand would be nonsense, and the ruling that "a Shift
  // resolves before a dash ability the same unit declared" only means anything
  // if that ability can be aimed from where the Shift puts you. Prep is the
  // exception: it has already happened by then.
  const catalyst = planCatalyst(board, unit, catalysts, order.catalyst);
  const shiftTo = teleportDestination(catalyst);
  const after = shiftTo === undefined ? unit : { ...unit, pos: shiftTo };

  const declared = planAbility(board, unit, roster, order.ability);
  // What the player asked for, before CAT-DASH-FULL below decides whether they
  // are allowed to have it.
  const declaredAbility = declared?.def.phase === 'prep'
    ? declared
    : planAbility(board, after, roster, order.ability);

  // FREE1 — a free action is declared in addition to the normal one. It must
  // name an ability that is actually `free: true`, and it may not simply repeat
  // the normal slot: ordering the same trap twice would fire it twice off one
  // cooldown, which is the one way this slot could be abused.
  let freeAbility = planAbility(board, unit, roster, order.freeAbility);
  if (freeAbility?.def.free !== true || freeAbility.def.id === declaredAbility?.def.id) freeAbility = undefined;


  // **At most one free action per turn** (edge-cases, the conservative v1
  // reading) counts catalysts and free abilities together. The catalyst yields:
  // it is the scarcer resource, so burning one by accident on a turn that also
  // declared a free ability is the worse of the two mistakes. Resolved here
  // rather than in the return, because whether a catalyst is actually spent is
  // what decides the Move below.
  const spentCatalyst = freeAbility === undefined ? catalyst : undefined;

  // CAT-DASH-FULL — a **Dash catalyst is your whole active turn** (owner
  // directive 2026-09-01: "Dash Catalyst should count as your full action",
  // superseding CAT-DASH-COST's "it spends your Move").
  //
  // A free ≤3 teleport (Shift) or a 2-turn Untargetable (Fade) that cost only a
  // Move was still the strongest thing a turn could do; priced at the whole
  // action it reads like the once-per-match power it is. So a Dash-catalyst turn
  // carries no normal ability, no Move and no Sprint — exactly as if the
  // catalyst *were* the unit's ability-and-movement.
  //
  // Uniform across all three Dash catalysts, Fade and Unshackle included. The
  // directive names the colour, and "yellow is your turn" is one rule a player
  // can hold; "yellow is your turn unless it doesn't move you" is a footnote.
  // Prep and Blast catalysts are untouched — still free, still additive.
  const dashCatalyst = spentCatalyst?.def.phase === 'dash';

  // The ability slot goes with it. Dropped here rather than at the fire sites so
  // there is one answer to "did this unit act this turn" — the plan — and every
  // phase reads the same one.
  //
  // Safe to drop *after* the free-ability duplicate check above: a Dash catalyst
  // is only ever `spent` when no free ability was declared (the one-free-action
  // rule makes the catalyst yield), so in every branch that reaches here the
  // check had nothing to compare against anyway.
  const ability = dashCatalyst ? undefined : declaredAbility;

  // Sprint is "move only": it is ignored the moment a real ability is used —
  // and a free action is **not** one. Reading `ability` alone here was the whole
  // of FREE1's budget independence; a Dash catalyst joins it, because it is no
  // longer free. `movementBudget` still takes only the unit and this flag, so a
  // *free* action still cannot shrink a move or cancel a Sprint.
  const sprint = ability === undefined && !dashCatalyst && order.sprint === true;

  // A dash ability IS the unit's movement this turn; a separate Move path is
  // dropped (see docs/DECISIONS.md). A Dash catalyst costs the same, and now the
  // ability slot on top.
  let movePath: Vec2[] = [];
  const dashing = ability?.def.phase === 'dash';
  if (!dashing && !dashCatalyst && order.movePath !== undefined && order.movePath.length > 0) {
    // A Shift resolves in Dash, so a walk that followed it would start from
    // where it lands — validate from there, not from where the unit is standing
    // now. Unreachable while a Dash catalyst spends the Move, and kept because
    // `after` is the correct origin for any future non-Move-spending teleport.
    const check = validateMovePath(board, draft, after, order.movePath, sprint);
    if (check.valid) movePath = order.movePath.map((p) => ({ x: p.x, y: p.y }));
  }

  // CHASE1 — a chase is the *other* way to spend the Move, so everything that
  // takes the Move away takes it too: a dash ability, a Dash catalyst. The
  // ruling is explicit for the dash case ("the dash is the movement, so the
  // chase is dropped — one reposition per turn") and the catalyst follows from
  // CAT-DASH-FULL.
  //
  // A never-seen target is dropped here rather than at resolution, because "you
  // cannot chase a rumour" is a fact about the order, not about how it resolves:
  // if the team has no record of this enemy, there is nothing to chase toward.
  // Everything else — the target dying, the team losing sight of it — happens
  // during the turn and is answered at resolution.
  let chase: string | undefined;
  if (!dashing && !dashCatalyst && order.chase !== undefined) {
    const target = draft.units.find((u) => u.unitId === order.chase);
    const known = target !== undefined
      && (teamCanSee(buildVision(board), draft, team, target) || lastKnownFor(draft, team, target.unitId) !== undefined);
    if (target !== undefined && target.owner !== team && known) chase = target.unitId;
  }
  // Declared alongside a path, the chase is the more specific statement of
  // intent and the path yields — the same way a dash ability's reposition
  // supersedes a walk. A well-formed client never sends both.
  if (chase !== undefined) movePath = [];

  // CHASE-SPRINT — a chase that spends no normal ability runs at sprint budget.
  //
  // Owner Dev Note: "If I choose chase and haven't used an attack or only a free
  // action, I should get full sprinting chase." A chase *is* the unit's Move, so
  // it should cost and buy exactly what a Move does; there was no reason for the
  // same turn to close eight squares as a walk and four as a chase.
  //
  // Derived rather than taken from `order.sprint`, because the client cannot
  // draw a chase's route at plan time — the engine picks it at the end of Move,
  // after everyone else has finished — so there is nothing for a player to opt
  // into and a client that never sets the flag would silently get the short
  // budget. The condition is `sprint`'s own: no normal ability, no Dash
  // catalyst. A free action does not block it, which is the half of the note
  // that names Second Wind and Overwatch Trap.
  const chaseSprint = chase !== undefined && ability === undefined && !dashCatalyst;

  return {
    unit,
    ability,
    freeAbility,
    catalyst: spentCatalyst,
    shiftTo: freeAbility === undefined ? shiftTo : undefined,
    movePath,
    chase,
    sprint: sprint || chaseSprint,
  };
}

/** This team's memory of where `unitId` was, or `undefined` if never seen. */
function lastKnownFor(draft: GameState, team: TeamId, unitId: string): LastKnownPos | undefined {
  return draft.lastKnown.find((k) => k.team === team && k.unitId === unitId);
}

/** Where a teleport catalyst will put its caster, if it is one. */
function teleportDestination(catalyst: PlannedAbility | undefined): Vec2 | undefined {
  if (catalyst === undefined) return undefined;
  return catalyst.def.effects.some((e) => e.kind === 'teleport') ? catalyst.aim[0] : undefined;
}

/**
 * Validate a catalyst order. Unlike an ability it is looked up in the catalyst
 * pool rather than on the character, and it must be one of the three this unit
 * carries and still unspent.
 */
function planCatalyst(
  board: Board,
  unit: UnitState,
  catalysts: CatalystPool,
  order: AbilityOrder | undefined,
): PlannedAbility | undefined {
  if (order === undefined) return undefined;
  if (!unit.catalysts.includes(order.abilityId)) return undefined;
  if (unit.catalystsUsed.includes(order.abilityId)) return undefined;
  const def = catalysts[order.abilityId];
  if (def === undefined || def.oncePerMatch !== true) return undefined;
  // A range-0 shape can only ever be aimed at the caster's own square, so an
  // absent aim is filled in rather than rejected — otherwise Suppression, whose
  // circle is centred on its caster, would be silently undeclarable.
  const aim = order.target !== undefined && order.target.length > 0 ? order.target
    : def.range === 0 && def.shape !== 'self' ? [{ x: unit.pos.x, y: unit.pos.y }]
    : [];
  const aimStep = order.aimStep;
  if (aimStep !== undefined && !isAimStep(aimStep)) return undefined;
  if (!aimIsLegal(board, unit, def, aim, aimStep)) return undefined;
  return {
    def, aim, isUlt: false,
    area: expandShape(board, def, unit.pos, aim, aimStep),
    axis: axisSquares(board, def, unit.pos, aim, aimStep),
    inner: innerSquares(board, def, aim),
  };
}

/**
 * Fire a catalyst: mark it spent, then apply its effects.
 *
 * Spending happens **here**, when it resolves, not when it was ordered — a unit
 * killed in Prep keeps its Blast catalyst, because that catalyst never went off.
 *
 * The effect application is deliberately generic rather than a branch per
 * catalyst: a teleport moves the caster, everything beneficial or neutral lands
 * on the caster, and anything harmful lands on the enemies inside the area. All
 * nine of the shipped catalysts fall out of those three rules, and so will any
 * the Designer adds, because none of them needs a new `EFFECT_KIND`.
 */
function fireCatalyst(
  draft: GameState, board: Board, unit: UnitState, c: PlannedAbility, events: TurnEvent[],
  contested?: ReadonlySet<string>,
): void {
  if (!unit.alive) return;
  unit.catalystsUsed.push(c.def.id);
  events.push({ type: 'catalystUsed', unitId: unit.unitId, catalystId: c.def.id });
  events.push({ type: 'abilityFired', unitId: unit.unitId, abilityId: c.def.id, area: c.area });

  const source = sourceOf(unit, c.def.id);
  // CAMO-REVEAL: "used a catalyst … while inside a camouflage zone". Read the
  // tile BEFORE the teleport below — Shift moves you, and the square that gives
  // you away is the one you acted from, not the one you land on. Every catalyst
  // counts, harmful or not: the owner named catalyst use itself as the trigger,
  // and a once-per-match burst out of a thicket is exactly the tell.
  revealIfConcealed(board, unit, unit.pos, c.def.id, events);
  if (c.def.effects.some((e) => e.kind === 'teleport')) {
    teleport(draft, board, unit, c.aim[0], events, contested);
  }
  const onSelf = c.def.effects.filter((e) => BENEFICIAL_KINDS.has(e.kind) || e.kind === 'decoy');
  if (onSelf.length > 0) applySelfEffects(draft, unit, onSelf, source, events);

  const harmful = c.def.effects.filter((e) => HARMFUL_KINDS.has(e.kind) && isStatusKind(e.kind));
  if (harmful.length === 0) return;
  const area = new Set(c.area.map(vecKey));
  for (const victim of draft.units) {
    if (!victim.alive || victim.owner === unit.owner || !area.has(vecKey(victim.pos))) continue;
    if (isUntargetable(victim)) continue; // UNTGT1
    for (const e of harmful) {
      applyStatus(victim, e.kind, e.duration ?? 1);
      events.push({
        type: 'statusApplied', unitId: victim.unitId, status: e.kind,
        duration: e.duration ?? 1, sourceUnitId: source.unitId, abilityId: source.abilityId,
      });
    }
  }
}

/**
 * Every catalyst declared for `phase`, resolved before that phase's abilities.
 *
 * The ordering is the whole point (edge-cases): a Blast-phase Might that landed
 * *after* the Blast damage step would boost nothing until next turn, which makes
 * Adrenaline and Overdrive simply broken. Uniform across all three colours, so
 * there is one rule rather than three.
 */
function runCatalysts(
  draft: GameState, board: Board, plans: UnitPlan[], phase: AbilityPhase, events: TurnEvent[],
  contested?: ReadonlySet<string>,
): void {
  for (const plan of orderedPlans(draft, plans)) {
    const c = plan.catalyst;
    if (c !== undefined && c.def.phase === phase) fireCatalyst(draft, board, plan.unit, c, events, contested);
  }
}

/**
 * Validate one ability order into a plan, or `undefined` if any part of it is
 * illegal. Every rejection is a silent drop rather than a throw, so a malformed
 * order costs the player that component and nothing else — deterministically.
 */
function planAbility(
  board: Board,
  unit: UnitState,
  roster: Roster,
  order: AbilityOrder | undefined,
): PlannedAbility | undefined {
  if (order === undefined) return undefined;
  const found = findAbility(roster, unit.characterId, order.abilityId);
  if (found === undefined) return undefined;
  const { isUlt } = found;
  // BASIC-MODES: the one place a mode is applied. Everything below — the
  // cooldown check, the legality check, the three geometry expansions — sees an
  // ordinary ability, which is what keeps the knob from spreading.
  const def = abilityProfile(found.def, order.mode);
  const aim = order.target ?? [];
  if ((unit.cooldowns[def.id] ?? 0) > 0) return undefined;
  if (isUlt && unit.energy < ULT_COST) return undefined;
  // An out-of-range aim step is rejected like any other illegal component (AIM2).
  const aimStep = order.aimStep;
  if (aimStep !== undefined && !isAimStep(aimStep)) return undefined;
  if (!aimIsLegal(board, unit, def, aim, aimStep)) return undefined;
  return {
    def, aim, isUlt,
    area: expandShape(board, def, unit.pos, aim, aimStep),
    axis: axisSquares(board, def, unit.pos, aim, aimStep),
    inner: innerSquares(board, def, aim),
  };
}

/** Is an ability's aim geometrically legal for its shape and range? */
function aimIsLegal(board: Board, unit: UnitState, def: AbilityDef, aim: readonly Vec2[], aimStep?: number): boolean {
  switch (def.shape) {
    case 'self':
      return true;
    case 'square':
    case 'circle': {
      const target = aim[0];
      return target !== undefined && aimInRange(unit.pos, target, def.range);
    }
    case 'line':
    case 'cone': {
      // A quantized step is a direction in its own right, so it needs no target
      // square; without one, the aim must still point somewhere (AIM2).
      if (isAimStep(aimStep)) return true;
      const target = aim[0];
      return target !== undefined && !vecEq(unit.pos, target);
    }
    case 'path': {
      // A dash/charge path: adjacent in-bounds steps within range, no wall/cover.
      // Steps may be orthogonal OR diagonal (MV4), matching 8-direction movement;
      // a diagonal may not cut a wall/cover corner (same rule as `validateMovePath`).
      // Range is a movement COST budget, not a step count: a diagonal charge step
      // costs 2 like every other diagonal (MET1 re-rules MV4). Occupancy is not
      // checked here — a charge passes through and rests on the furthest free
      // square (MV1).
      if (aim.length === 0) return false;
      let prev = unit.pos;
      let cost = 0;
      for (const p of aim) {
        if (!inBounds(board, p)) return false;
        if (!isAdjacentStep(prev, p)) return false;
        if (blocksMovement(board, p)) return false;
        if (isDiagonalStep(prev, p) && diagonalCornerBlocked(board, prev, p.x - prev.x, p.y - prev.y)) return false;
        cost += stepCost(p.x - prev.x, p.y - prev.y);
        if (cost > def.range) return false;
        prev = p;
      }
      return true;
    }
  }
}

// ── Death ───────────────────────────────────────────────────────────────────

/** Mark a unit dead (mid-phase), tally the kill and clear its statuses. */
function killUnit(draft: GameState, victim: UnitState, killer: TeamId, events: TurnEvent[]): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.hp = 0;
  victim.statuses = [];
  victim.respawnIn = RESPAWN_TURNS;
  // A FRIENDLY kill scores for nobody (FF1): the ally dies and respawns as a
  // pure tempo loss, but no tally moves — otherwise a team could farm its own
  // respawning ally for the win. The death event still fires so the client
  // shows it.
  if (killer !== victim.owner) draft.kills[killer] += 1;
  events.push({ type: 'death', unitId: victim.unitId, killer });
}

/**
 * Who caused an effect: the acting unit and the ability that did it. `damage`
 * has carried this since A0; A0-heal extends it to `heal` and `statusApplied`,
 * so a benefit has an author exactly as a hit does and the combat log can name
 * both ends ("Aegis shielded Lumen for 30").
 *
 * A self-cast names the caster as its own source — that is not a degenerate
 * case, it is the true answer, and it keeps every consumer on one shape.
 */
interface Source {
  unitId: string;
  abilityId: string;
}

const sourceOf = (unit: UnitState, abilityId: string): Source => ({ unitId: unit.unitId, abilityId });

// ── Traps ───────────────────────────────────────────────────────────────────

/**
 * Trigger any enemy trap on the square `unit` just entered (edge-cases: traps
 * fire on entry in any phase). Trap damage is raw — Might/Weaken and cover do
 * not apply (see DECISIONS.md) — and the trap's non-trap effects (e.g. Reveal)
 * hit the victim. A trap is one-shot: it is consumed when it fires. A unit that
 * merely *starts* on a freshly-placed trap never calls this, so it is safe until
 * it re-enters.
 *
 * Returns **true when the unit's movement ends here** — because it died, or
 * because the trap was a halting one (TRAP-HALT, Dev Note #10b). Every caller
 * already treated the return value as "stop walking", so the two reasons need
 * only one channel: a Move step discards the rest of the path, a charge stops
 * where it stands. It is a stop, not a displacement — nothing is pushed and
 * nothing else about the turn is cancelled.
 *
 * **Unstoppable ignores the halt**, exactly as it already ignores the Slow these
 * traps carry: the damage still lands, the walk simply does not stop.
 */
function triggerTrapsOnEntry(draft: GameState, board: Board, unit: UnitState, events: TurnEvent[]): boolean {
  if (!unit.alive) return false;
  let halted = false;
  for (const trap of draft.traps.filter((t) => t.owner !== unit.owner && vecEq(t.pos, unit.pos))) {
    draft.traps = draft.traps.filter((t) => t.id !== trap.id); // consumed
    events.push({ type: 'trapTriggered', trapId: trap.id, unitId: unit.unitId });
    const res = applyDamage(unit, trap.damage);
    events.push({ type: 'damage', unitId: unit.unitId, amount: res.hpLost, absorbed: res.absorbed, sourceUnitId: trap.ownerUnitId, abilityId: trap.abilityId });
    onDamageTaken(board, unit, trap.abilityId, events); // CAMO-REVEAL: + reveal if concealed
    for (const e of trap.onTrigger) {
      if (isStatusKind(e.kind)) {
        applyStatus(unit, e.kind, e.duration ?? 1);
        // A trap's rider credits whoever placed it and the placing ability —
        // the same attribution its damage already carries.
        events.push({ type: 'statusApplied', unitId: unit.unitId, status: e.kind, duration: e.duration ?? 1, sourceUnitId: trap.ownerUnitId, abilityId: trap.abilityId });
      }
    }
    if (res.died) {
      killUnit(draft, unit, trap.owner, events);
      return true;
    }
    if (trap.halt === true && !hasStatus(unit, 'unstoppable')) halted = true;
  }
  return halted;
}

// ── Displacement (knockback / pull) ─────────────────────────────────────────

interface Displacement {
  victim: UnitState;
  kind: 'knockback' | 'pull';
  amount: number;
  /** The attacker square the push is measured from. */
  source: Vec2;
  /**
   * The displacing attacker's unitId. Its own body is not an obstacle to the
   * victim's displacement path — a charge that passed *through* the victim and
   * settled beyond it "isn't a wall, it just passed through" (edge-cases: MV1-fix,
   * 2026-08-17). The victim may cross the attacker's square but, like every unit,
   * may not *end* on it (co-occupancy invariant is golden-rule-level).
   */
  attackerId?: string;
}

/** Collect a hit ability's knockback/pull effects against a victim. */
function collectDisplacement(pending: Displacement[], effects: readonly AbilityEffect[], victim: UnitState, source: Vec2, attackerId?: string): void {
  for (const e of effects) {
    if (e.kind === 'knockback' || e.kind === 'pull') {
      pending.push({ victim, kind: e.kind, amount: e.amount ?? 0, source: { x: source.x, y: source.y }, attackerId });
    }
  }
}

/**
 * DASH-OCCUPIED — the knockback exception.
 *
 * A dash may not end on a square another character is standing on ("you should
 * not be able to dash onto the same square as another character unless there's a
 * knockback associated with the skill"). The exception is that a dash carrying
 * its **own** knockback clears the square first: the shove resolves **inside the
 * Dash phase, before the dasher settles**, rather than being queued for the
 * end-of-Blast displacement pass. Queued, the occupant would still be standing
 * when the teleport tried to land and the dash would fizzle — the exception
 * would exist only on paper.
 *
 * Returns the unit it cleared, so the caller can skip queueing a *second*
 * displacement against it when the damage loop comes round.
 *
 * **No shipped ability reaches this yet** — every roster teleport is
 * knockback-free and charges carry their shove as an area `impact` — so it
 * changes no current behaviour. It is here so the ruling is executable rather
 * than a note, and so the first skill that wants it works the day it is authored.
 */
function clearLandingWithKnockback(
  draft: GameState, board: Board, dasher: UnitState, a: PlannedAbility,
  displaced: Set<string>, events: TurnEvent[],
): UnitState | undefined {
  const dest = a.aim[0];
  if (dest === undefined) return undefined;
  const shove = a.def.effects.find((e) => e.kind === 'knockback');
  if (shove === undefined) return undefined;
  const occupant = draft.units.find((u) => u.alive && u.unitId !== dasher.unitId && vecEq(u.pos, dest));
  if (occupant === undefined) return undefined;

  // Pushed along the line the dasher travelled — away from where it came from,
  // the only direction a body arriving at speed could send them.
  applyDisplacements(
    draft, board,
    [{ victim: occupant, kind: 'knockback', amount: shove.amount ?? 0, source: { ...dasher.pos }, attackerId: dasher.unitId }],
    displaced, events,
  );
  return occupant;
}

/**
 * Resolve all displacement at the end of Blast (golden rule #4): each victim is
 * pushed away from (knockback) or toward (pull) its source, stopping on the last
 * open square before a wall, cover, edge or unit (edge-cases: knockback into
 * wall). Unstoppable victims are immune. A displaced unit loses its Move this
 * turn whether or not it actually travelled (its intent is disrupted). Processed
 * in collection order — dash before blast — which is deterministic.
 */
function applyDisplacements(
  draft: GameState,
  board: Board,
  pending: Displacement[],
  displaced: Set<string>,
  events: TurnEvent[],
): void {
  for (const d of pending) {
    if (!d.victim.alive || isImmuneTo(d.victim, d.kind)) continue;
    displaced.add(d.victim.unitId); // loses Move (edge-cases: knockback + Move)
    const dir = d.kind === 'knockback' ? direction8(d.source, d.victim.pos) : direction8(d.victim.pos, d.source);
    if (dir.x === 0 && dir.y === 0) continue;

    // A square is solid (blocks a resting displacement) if it is terrain or held
    // by any living unit other than the victim; `exceptId` also lets the
    // displacer's own body be crossed (MV1-fix: a charge that passed *through* the
    // victim and settled beyond it isn't a wall).
    const solidFor = (p: Vec2, exceptId?: string): boolean => {
      const t = terrainAt(board, p);
      if (t === 'wall' || t === 'cover' || t === 'oob') return true;
      return draft.units.some((u) => u.alive && u.unitId !== d.victim.unitId && u.unitId !== exceptId && vecEq(u.pos, p));
    };
    const isDisplacer = (p: Vec2): boolean =>
      d.attackerId !== undefined && draft.units.some((u) => u.alive && u.unitId === d.attackerId && vecEq(u.pos, p));

    // Walk the line the nominal distance; the displacer's body is transparent, so
    // `cur` may land on it.
    let cur = d.victim.pos;
    for (let step = 0; step < d.amount; step++) {
      const nxt: Vec2 = { x: cur.x + dir.x, y: cur.y + dir.y };
      if (d.kind === 'pull' && vecEq(nxt, d.source)) break; // never land on the puller
      if (solidFor(nxt, d.attackerId)) break;
      cur = nxt;
    }
    // Carry-through (R1c): a unit may never *end* on another's square. If the
    // victim came to rest on the displacer's own square, skip *past* it — advance
    // one more along the line (repeat while still on the displacer's square). If
    // the square beyond is blocked (wall/cover/edge/third unit), fall back to the
    // last free square before it — the documented net-zero.
    while (isDisplacer(cur)) {
      const nxt: Vec2 = { x: cur.x + dir.x, y: cur.y + dir.y };
      if (!solidFor(nxt) && !(d.kind === 'pull' && vecEq(nxt, d.source))) {
        cur = nxt; // carried past the displacer
      } else {
        cur = { x: cur.x - dir.x, y: cur.y - dir.y }; // last free square before it
        break;
      }
    }
    if (!vecEq(cur, d.victim.pos)) {
      const from = d.victim.pos;
      d.victim.pos = { x: cur.x, y: cur.y };
      events.push({ type: 'displaced', unitId: d.victim.unitId, from, to: d.victim.pos, kind: d.kind });
      // Traps do not trigger on knockback in v1 (edge-cases list dash/move only).
    }
  }
}

// ── Prep ────────────────────────────────────────────────────────────────────

/** Mark an ability as used: spend ult energy (emitting `energySpent`) and start cooldown. */
function markAbilityUsed(unit: UnitState, planned: PlannedAbility, events: TurnEvent[]): void {
  if (planned.isUlt && unit.energy > 0) {
    const spent = unit.energy;
    unit.energy = 0;
    events.push({ type: 'energySpent', unitId: unit.unitId, amount: spent });
  }
  if (planned.def.cooldown > 0) unit.cooldowns[planned.def.id] = planned.def.cooldown;
}

function grantUseEnergy(unit: UnitState, def: AbilityDef, hitEnemy: boolean, events: TurnEvent[]): void {
  if (!hitEnemy && !isSelfOrUtility(def)) return;
  const gained = grantEnergy(unit, def.energyGain);
  if (gained > 0) events.push({ type: 'energyGained', unitId: unit.unitId, amount: gained });
}

function runPrep(draft: GameState, board: Board, plans: UnitPlan[], events: TurnEvent[]): void {
  events.push({ type: 'phaseStart', phase: 'prep' });
  runCatalysts(draft, board, plans, 'prep', events);
  // PHASE-STATUS-FIRST: Prep's two sub-steps. Prep lands no damage of its own —
  // its only damage-shaped act is **arming a trap**, whose number is stamped
  // from the owner's Might/Weaken at placement. So the traps wait: every Prep
  // status in the phase lands first, and a Might an ally threw you a moment ago
  // is in the mine you just buried. Heals need no such treatment here, having
  // nothing in this phase to be simultaneous with.
  const arming: (() => void)[] = [];
  // Free actions resolve next (FREE1). Validation pins them to Prep, so this is
  // the only phase that needs the pass — and going first is the ordering
  // catalysts will need, so there is one rule rather than two.
  for (const plan of orderedPlans(draft, plans)) {
    if (plan.freeAbility !== undefined) firePrep(draft, board, plan.unit, plan.freeAbility, events, arming);
  }
  for (const plan of orderedPlans(draft, plans)) {
    const a = plan.ability;
    if (a === undefined || a.def.phase !== 'prep') continue;
    firePrep(draft, board, plan.unit, a, events, arming);
  }
  for (const arm of arming) arm();
}

/** Resolve one Prep-phase ability for `unit`: traps arm (deferred), everything else self-applies. */
function firePrep(draft: GameState, board: Board, unit: UnitState, a: PlannedAbility, events: TurnEvent[], arming: (() => void)[]): void {
  if (!unit.alive) return;
  events.push({ type: 'abilityFired', unitId: unit.unitId, abilityId: a.def.id, area: a.area });
  markAbilityUsed(unit, a, events);

  // CAMO-REVEAL: firing an offensive ability from a camouflage tile gives you
  // away. Prep's harmful content is placement (traps are `trap`, a NEUTRAL kind,
  // so a laid mine is not "using an offensive ability") — but a Prep debuff
  // would be, so the check is on the effects rather than on the phase.
  if (isHarmfulUse(a.def)) revealIfConcealed(board, unit, unit.pos, a.def.id, events);

  const trapEffect = a.def.effects.find((e) => e.kind === 'trap');
  if (trapEffect !== undefined) {
    arming.push(() => placeTraps(draft, unit, a, trapEffect, events));
  } else {
    // PREP-AOE: a beneficial AREA ability reaches every ally standing in it,
    // not just the caster. This branch used to apply the effects to `unit`
    // alone and ignore `a.area` entirely, so Aegis's Barrier Pulse — a `circle`
    // radius 1 — only ever shielded Aegis. A self-cast still lands on the
    // caster because `a.area` for a `self` shape *is* the caster's square, so
    // there is no special case here and no way for the two to disagree.
    applyAreaBoons(draft, unit, a, sourceOf(unit, a.def.id), events);
  }
  grantUseEnergy(unit, a.def, false, events);
}

/**
 * Apply an ability's beneficial effects to every ally standing in its area —
 * **the caster included, on the same terms as anybody else** (MENDING-RANGE).
 *
 * The caster used to be unconditional, on the argument that a self-effect is
 * "not an area question". It is: Mending Light is a `circle` aimed up to 5 away,
 * and Lumen was healed by it from anywhere on the board — the owner's report
 * that it "heals outside its range" (Dev Note #12). The aim gate was working
 * perfectly; the caster was simply never asked to be inside the area it aimed.
 *
 * Every case the old exception defended still works, because the caster is
 * genuinely in the area for all of them: a `self` shape's area **is** the
 * caster's square, a dash's area is the path or the landing square it ends on,
 * and a `circle` with `range: 0` (Warding Halo) is centred on the caster. What
 * changes is exactly the abilities aimed *away* — and there the boon is now a
 * targeting decision rather than a freebie, which is what the area was for.
 */
function applyAreaBoons(
  draft: GameState,
  caster: UnitState,
  a: PlannedAbility,
  source: Source,
  events: TurnEvent[],
): void {
  const area = new Set(a.area.map(vecKey));
  // Non-beneficial effects on this path are the caster's own business (a `decoy`
  // spawns at its feet; a self-cast's statuses), so they are applied whenever
  // the caster is in its own area — which for a self-cast is always. Minus the
  // harmful ones: CASTER-SAFE means your own Weaken or Root never lands on you,
  // however faithfully the area covers your square.
  if (area.has(vecKey(caster.pos))) applySelfEffects(draft, caster, casterSafe(a.def.effects), source, events);
  const boons = a.def.effects.filter((e) => BENEFICIAL_KINDS.has(e.kind));
  if (boons.length === 0) return;
  for (const ally of draft.units) {
    if (!ally.alive || ally.owner !== caster.owner || ally.unitId === caster.unitId) continue;
    if (!area.has(vecKey(ally.pos))) continue;
    applySelfEffects(draft, ally, boons, source, events);
  }
}

/**
 * Apply a beneficial ability's effects to a recipient (shields, heals, buffs,
 * decoy). `source` is who caused them: the caster themself for a self-cast, or
 * the caster of the AoE that reached an ally. The recipient is `unit`, which is
 * why the two are separate arguments — a support ability's log line needs both.
 */
function applySelfEffects(draft: GameState, unit: UnitState, effects: readonly AbilityEffect[], source: Source, events: TurnEvent[]): void {
  for (const e of effects) {
    if (e.kind === 'heal') {
      const healed = applyHeal(unit, e.amount ?? 0);
      if (healed > 0) events.push({ type: 'heal', unitId: unit.unitId, amount: healed, sourceUnitId: source.unitId, abilityId: source.abilityId });
    } else if (e.kind === 'shield') {
      applyStatus(unit, 'shield', e.duration ?? 1, e.amount ?? 0);
      events.push({ type: 'statusApplied', unitId: unit.unitId, status: 'shield', duration: e.duration ?? 1, amount: e.amount ?? 0, sourceUnitId: source.unitId, abilityId: source.abilityId });
    } else if (e.kind === 'decoy') {
      spawnDecoy(draft, unit, events); // R2: a static fake at the caster's square
    } else if (isStatusKind(e.kind)) {
      // DOT-HOT rides here too: the amount is per-turn rather than a shield
      // pool, and the author is carried so a tick that kills can credit a team.
      // Only for the over-time kinds — every other status instance stays the
      // exact `{kind, remaining}` shape it has always been, so nothing about
      // `structuredClone`, the determinism hash or an equality assertion moves.
      applyStatus(unit, e.kind, e.duration ?? 1, e.amount, authorOf(e.kind, source));
      events.push({ type: 'statusApplied', unitId: unit.unitId, status: e.kind, duration: e.duration ?? 1, amount: e.amount, sourceUnitId: source.unitId, abilityId: source.abilityId });
    }
  }
}

/**
 * Spawn a Wisp decoy (edge-cases R2) at the caster's square. Kept out of
 * `state.units`; expires at the end of the *next* turn (`castTurn + 1`) unless
 * destroyed first. Deterministic id from caster + turn (one cast per unit/turn).
 */
function spawnDecoy(draft: GameState, caster: UnitState, events: TurnEvent[]): void {
  const decoy: DecoyState = {
    id: `decoy-${caster.unitId}-t${draft.turn}`,
    teamId: caster.owner,
    pos: { x: caster.pos.x, y: caster.pos.y },
    expiresOnTurn: draft.turn + 1,
  };
  draft.decoys.push(decoy);
  events.push({ type: 'decoySpawned', decoyId: decoy.id, pos: decoy.pos, teamId: decoy.teamId });
}

/**
 * Destroy every enemy decoy whose square lies in `area` (R2: any damage destroys
 * a decoy; damaging it grants no energy — the caller never counts it as an enemy
 * hit). `attackerTeam` is the damaging unit's team; own-team decoys are untouched.
 */
function destroyDecoysInArea(draft: GameState, area: readonly Vec2[], attackerTeam: TeamId, events: TurnEvent[]): void {
  if (draft.decoys.length === 0) return;
  const areaKeys = new Set(area.map(vecKey));
  draft.decoys = draft.decoys.filter((d) => {
    if (d.teamId !== attackerTeam && areaKeys.has(vecKey(d.pos))) {
      events.push({ type: 'decoyDestroyed', decoyId: d.id, pos: d.pos });
      return false;
    }
    return true;
  });
}

/** Place a hidden trap on each aimed square. Damage + non-trap effects fire on entry. */
function placeTraps(
  draft: GameState,
  owner: UnitState,
  planned: PlannedAbility,
  trapEffect: AbilityEffect,
  events: TurnEvent[],
): void {
  const onTrigger = planned.def.effects.filter((e) => e.kind !== 'trap');
  // TRAP-CENTRE (Dev Note #9): **one** trap, at the square the ability was aimed
  // at. This used to walk `planned.area` and bury a mine under every tile it
  // covered, which turned a radius-1 disc into five traps and a radius-2 disc
  // into thirteen — a minefield from one cast, and an ability whose trap count
  // was a function of its shape rather than of anything anybody authored.
  //
  // A `square` or `self` shape lands in exactly the same place it always did:
  // for those the area *is* the aimed square (or the caster's own), so this is
  // one rule with no special case rather than a carve-out for area shapes.
  const pos = planned.aim[0] ?? owner.pos;
  const trap: TrapState = {
    // The ability is part of the id because a unit can now arm two traps in
    // one turn — Thorn's auto-mine in Blast beside a free Snare Bloom in Prep
    // — and two traps sharing an id would make the consumed-trap filter in
    // `triggerTrapsOnEntry` sweep away the one that did not fire.
    id: `trap-${owner.unitId}-t${draft.turn}-${planned.def.id}`,
    owner: owner.owner,
    ownerUnitId: owner.unitId,
    abilityId: planned.def.id,
    pos: { x: pos.x, y: pos.y },
    // PHASE-STATUS-FIRST: the number is stamped now, from the Might or Weaken
    // the owner is carrying as the mine goes in the ground — including one
    // applied earlier in this same phase, which is why arming is the phase's
    // second sub-step. A trap that detonates three turns later is not
    // re-measured against whatever the owner happens to be feeling then; the
    // charge was set when it was buried.
    damage: scaleDamage(trapEffect.amount ?? 0, outgoingDamagePct(owner)),
    // TRAP-LIFETIME: stamped at placement, measured exactly like a status
    // `duration` — `lifetime: 2` covers this turn and the next. An omitted
    // lifetime lands on the cap rather than living forever, so a trap can only
    // be *shorter* than the rule by being under-specified, never longer.
    expiresOnTurn: draft.turn + (trapEffect.lifetime ?? TRAP_MAX_LIFETIME) - 1,
    // TRAP-HALT: carried from the effect, like the lifetime beside it.
    ...(trapEffect.halt === true ? { halt: true } : {}),
    onTrigger,
  };
  draft.traps.push(trap);
  events.push({ type: 'trapPlaced', trapId: trap.id, pos: trap.pos, owner: trap.owner });
}

/** `"x,y"` back to a `Vec2` — the inverse of `vecKey`, for blast bookkeeping. */
function unkey(key: string): Vec2 {
  const [x, y] = key.split(',');
  return { x: Number(x), y: Number(y) };
}

/**
 * The squares an `impact` covers (DASH-IMPACT), one entry per blast so each
 * victim can be pushed away from the centre that actually caught it.
 *
 * Radii are Euclidean and expand through `circleSquares`, so this reuses the
 * fixed circle rather than adding geometry. `destination` is the square the
 * dasher came to rest on — the real one, not the aimed one, so a charge stopped
 * early detonates where it stopped.
 */
function impactBlasts(
  board: Board,
  def: AbilityDef,
  origin: Vec2,
  restedAt: Vec2,
): { centre: Vec2; area: Set<string> }[] {
  if (def.impact === undefined) return [];
  const out: { centre: Vec2; area: Set<string> }[] = [];
  const add = (centre: Vec2, radius: number | undefined): void => {
    if (radius === undefined || radius < 1) return;
    out.push({ centre, area: new Set(circleSquares(board, centre, radius).map(vecKey)) });
  };
  add(restedAt, def.impact.destination);
  add(origin, def.impact.origin);
  return out;
}

// ── Dash ────────────────────────────────────────────────────────────────────

/**
 * BLINK-CLASH — the destinations two or more blinks aim at on the same turn.
 *
 * Owner Dev Note: *"if two characters try to end their movement or dash/blink on
 * the exact same square, a collision occurs … Right now in CARDS, blinks do not
 * work like that. If Veil and Aegis try to blink to the same spot, only one of
 * them makes it to the square, the other one does not move at all."*
 *
 * That was exactly it, and the asymmetry was an accident of iteration order: a
 * teleport refuses an occupied square, so whichever blink the loop reached first
 * landed and the second found a body in the way. Two identical orders, two
 * different outcomes, decided by nothing a player can see.
 *
 * The claims are therefore counted **before anything moves**, and a contested
 * square is refused to every unit that aimed at it — which is CLASH-AR rule 2's
 * shape ("both ending on the square → both forced back to the square they last
 * held") applied to a movement with no path: a blink's last-held square is the
 * one it started on, so both stay put.
 *
 * **This is the minimal compliant reading, and it is narrower than the note.**
 * AR stops the conflicting characters "on the square immediately before their
 * intended final destination" — but a blink has no squares between origin and
 * destination to stop on (that is what makes it a blink; the note says so
 * itself, "blinks typically bypass obstacles mid-journey"). Inventing a
 * traversal for it would be inventing geometry and an unlisted ruling, so this
 * fixes the half that is unambiguously wrong — the coin-flip — and leaves "does
 * a blocked blink land adjacent along the line?" to the Designer.
 *
 * Both kinds of blink count: a dash **ability** that is not a `path` charge, and
 * a Shift-style dash **catalyst**. They resolve in the same phase onto the same
 * board, so a rule that saw only one of them would just move the coin flip.
 */
function contestedBlinks(plans: readonly UnitPlan[]): ReadonlySet<string> {
  const claims = new Map<string, number>();
  const claim = (p: Vec2 | undefined): void => {
    if (p === undefined) return;
    const k = vecKey(p);
    claims.set(k, (claims.get(k) ?? 0) + 1);
  };
  for (const plan of plans) {
    if (!plan.unit.alive) continue;
    const a = plan.ability;
    if (a !== undefined && a.def.phase === 'dash' && a.def.shape !== 'path') claim(a.aim[0]);
    claim(plan.shiftTo);
  }
  const out = new Set<string>();
  for (const [k, n] of claims) if (n > 1) out.add(k);
  return out;
}

/**
 * Dash phase: dashers move (charge path or teleport), damage-dealing dashes hit
 * the first enemy struck, and self-statuses (e.g. Untargetable) apply. Blast
 * immunity for the vacated square is emergent — Blast is resolved afterwards
 * against these new positions, so a dasher is simply no longer where it was
 * aimed at (edge-cases: dash immunity scope). Displacement from a dash is queued
 * for end of Blast (BACKLOG item 8); trap triggers attach here (item 9).
 */
/**
 * One blow a Dash-phase ability landed, gathered before any of it is applied
 * (PHASE-STATUS-FIRST). `raw` is the ability's authored number; the attacker's
 * Might/Weaken is read at apply time, so a buff that landed in this same Dash
 * is already counted.
 */
interface DashHit {
  attacker: UnitState;
  victim: UnitState;
  def: AbilityDef;
  raw: number;
  behindCover: boolean;
  /** The square the blow came from — where a shove that follows it is measured. */
  from: Vec2;
  /** DASH-OCCUPIED already shoved this victim out of the landing square. */
  alreadyShoved: boolean;
}

/**
 * Apply the Dash phase's damage, all of it at once, after every dash has moved
 * and every Dash-phase status has landed (PHASE-STATUS-FIRST, Dev Note #21).
 *
 * The batch is what makes the phase simultaneous rather than sequential. Two
 * charges that kill each other now both connect, because neither victim is dead
 * while the hits are being gathered; a shield thrown by a bodyguard's dive
 * absorbs the dive it was thrown in front of, whichever plan the ordering
 * happened to reach first. Nothing here depends on the order of `hits` beyond
 * which attacker is credited with an overkill, and that order is the fixed
 * `orderedPlans` walk.
 */
function applyDashHits(
  draft: GameState,
  board: Board,
  hits: readonly DashHit[],
  pending: Displacement[],
  events: TurnEvent[],
): void {
  for (const h of hits) {
    if (!h.victim.alive) continue;
    const res = applyDamage(h.victim, computeDamage(h.raw, h.attacker, h.behindCover));
    events.push({ type: 'damage', unitId: h.victim.unitId, amount: res.hpLost, absorbed: res.absorbed, sourceUnitId: h.attacker.unitId, abilityId: h.def.id });
    onDamageTaken(board, h.victim, h.def.id, events); // CAMO-REVEAL: + reveal if concealed
    if (res.died) killUnit(draft, h.victim, h.attacker.owner, events);
    // …unless this dash already shoved them out of its landing square, in which
    // case they have taken their displacement for this ability.
    else if (!h.alreadyShoved) {
      collectDisplacement(pending, h.def.effects, h.victim, h.from, h.attacker.unitId);
    }
  }
}

function runDash(draft: GameState, board: Board, plans: UnitPlan[], pending: Displacement[], displaced: Set<string>, events: TurnEvent[]): void {
  events.push({ type: 'phaseStart', phase: 'dash' });
  // Shift resolves before a dash ability the same unit declared. Its Move cost
  // (CAT-DASH-COST) was already taken at plan time — `planUnit` drops the walk
  // for any unit spending a Dash catalyst — so nothing here needs to touch
  // `plan.movePath`.
  // BLINK-CLASH: settled before anything moves, so it cannot depend on which
  // blink the loop below reaches first.
  const contested = contestedBlinks(plans);
  runCatalysts(draft, board, plans, 'dash', events, contested);
  // A blocked Shift leaves the unit where it started, and everything it planned
  // from the landing square now describes nothing. Dropping those is the safe
  // reading — a plan is never allowed to act from a square its owner is not on.
  for (const plan of plans) {
    if (plan.shiftTo !== undefined && !vecEq(plan.unit.pos, plan.shiftTo)) {
      plan.ability = plan.ability?.def.phase === 'prep' ? plan.ability : undefined;
      plan.movePath = [];
    }
  }
  const repositioned: UnitState[] = []; // units that actually moved under their own power (D1-dash)
  // PHASE-STATUS-FIRST: every blow the phase lands, gathered while the loop
  // below moves units and applies the phase's statuses, and applied afterwards
  // in one batch. See `applyDashHits`.
  const dashHits: DashHit[] = [];
  const arming: (() => void)[] = []; // TRAP-CENTRE, buried after the phase's statuses
  for (const plan of orderedPlans(draft, plans)) {
    const a = plan.ability;
    if (a === undefined || a.def.phase !== 'dash' || !plan.unit.alive) continue;
    events.push({ type: 'abilityFired', unitId: plan.unit.unitId, abilityId: a.def.id, area: a.area });
    markAbilityUsed(plan.unit, a, events);

    // Move: a `path` charge walks until blocked; anything else teleports.
    // Capture the origin: a charge now passes THROUGH its target (MV1), so
    // knockback is measured from where the charge began (push along the charge),
    // not the post-pass-through position — combat semantics stay as today.
    const origin: Vec2 = { x: plan.unit.pos.x, y: plan.unit.pos.y };
    let crossed: UnitState[] = [];
    let shovedAside: UnitState | undefined;
    if (a.def.shape === 'path') crossed = walkCharge(draft, board, plan.unit, a.aim, events);
    else {
      // DASH-OCCUPIED: a dash carrying its own knockback clears the landing
      // square before it settles. Without this the shove would be queued for
      // end-of-Blast, the occupant would still be there, and the teleport would
      // simply fizzle — the exception the owner asked for would never fire.
      shovedAside = clearLandingWithKnockback(draft, board, plan.unit, a, displaced, events);
      teleport(draft, board, plan.unit, a.aim[0], events, contested);
    }

    // DASH-IMPACT: an optional AoE at takeoff and/or landing, expanded from the
    // square the dasher actually came to rest on rather than the one it aimed
    // at — a charge that is stopped early detonates where it stopped.
    const blasts = impactBlasts(board, a.def, origin, plan.unit.pos);

    // Damage. A charge hits the UNITS it crossed — the first only (R1a's shape,
    // now "first unit" under FF1-charge) or every one (`chargeHits: "all"`, e.g.
    // Tempest Run) — and those include allies, because a directly aimed attack
    // does not filter by team (FF1). An `impact` is an **area**, so FF1 polarity
    // does apply to it: harmful effects reach enemies only.
    //
    // A `square` dash has no crossed units at all now. Its old Manhattan-1
    // teleport-strike adjacency was a hardcoded special case with exactly one
    // user; Shadowstep's `impact: { destination: 1 }` says the same thing in
    // data, so the branch is gone (closes MET1-tp).
    const dmg = a.def.effects.find((e) => e.kind === 'damage');
    let hitEnemy = false;
    const struck = new Set<string>(); // each unit is affected at most once
    if (dmg !== undefined) {
      const crossedVictims = a.def.shape === 'path'
        ? (a.def.chargeHits === 'all' ? crossed : crossed.slice(0, 1)).map((u) => ({ unit: u, from: origin }))
        : [];
      const blasted = blasts.flatMap(({ centre, area }) =>
        draft.units
          .filter((u) => u.alive && u.owner !== plan.unit.owner && area.has(vecKey(u.pos)))
          .map((u) => ({ unit: u, from: centre })));
      for (const { unit: victim, from } of [...crossedVictims, ...blasted]) {
        if (struck.has(victim.unitId)) continue;
        struck.add(victim.unitId);
        if (isUntargetable(victim)) continue; // UNTGT1 — no damage, no rider, no energy
        // MELEE-COVER: a melee strike is not reduced by cover at any range. The
        // wall check is elsewhere and unaffected — you still cannot reach
        // through one.
        const behindCover = a.def.melee === true
          ? false
          : isBehindCover(board, from, victim.pos, a.def.range);
        // PHASE-STATUS-FIRST: gathered, not applied. The Dash phase's statuses
        // — a bodyguard's shield, a dive's buff — all land in the loop this is
        // inside; the damage waits for the batch below so that every blow in
        // the phase is measured against the same finished state.
        dashHits.push({ attacker: plan.unit, victim, def: a.def, raw: dmg.amount ?? 0, behindCover, from, alreadyShoved: victim.unitId === shovedAside?.unitId });
        if (victim.owner !== plan.unit.owner) hitEnemy = true; // energy is enemy-only
      }
    }

    // Beneficial effects reach ALLIES standing in the blast — the half of
    // `impact` that makes Aegis's Intercept a bodyguard tool rather than a
    // teleport that arrives with nothing for the person being dived. The caster
    // is excluded here and picked up by `applySelfEffects` below, so nobody is
    // shielded twice.
    const boons = a.def.effects.filter((e) => BENEFICIAL_KINDS.has(e.kind));
    if (boons.length > 0) {
      const helped = new Set<string>();
      for (const { area } of blasts) {
        for (const ally of draft.units) {
          if (!ally.alive || ally.owner !== plan.unit.owner || ally.unitId === plan.unit.unitId) continue;
          if (!area.has(vecKey(ally.pos)) || helped.has(ally.unitId)) continue;
          helped.add(ally.unitId);
          applySelfEffects(draft, ally, boons, sourceOf(plan.unit, a.def.id), events);
        }
      }
    }

    // A decoy in a damaging dash's area/path — or its blast — is destroyed too
    // (R2), no energy.
    if (dmg !== undefined) {
      destroyDecoysInArea(draft, a.area, plan.unit.owner, events);
      for (const { area } of blasts) {
        destroyDecoysInArea(draft, [...area].map(unkey), plan.unit.owner, events);
      }
    }

    // Self-statuses (Untargetable, etc.); movement/damage/displacement are skipped.
    //
    // MENDING-RANGE gates this on the area too, for the same reason as Prep's:
    // a dash ends inside its own path or on its landing square, and a `self`
    // shape's area is the caster's square, so every self-buff that was meant to
    // land still lands — but a `line` never covers the square it was fired from,
    // so Lumen no longer heals herself off a beam aimed at somebody else.
    // CASTER-SAFE trims the harmful half here as it does in Prep: a dash's own
    // Slow is for whoever it ran through, not for the unit that ran.
    if (a.area.some((p) => vecEq(p, plan.unit.pos))) {
      applySelfEffects(draft, plan.unit, casterSafe(a.def.effects), sourceOf(plan.unit, a.def.id), events);
    }
    grantUseEnergy(plan.unit, a.def, hitEnemy, events);
    // CAMO-REVEAL / REVEAL-FIX: a dash gives a *concealed* dasher away, whether
    // it landed damage or merely carried a debuff or a shove — and gives an open
    // one away not at all. Measured from `origin`: the tile it launched from is
    // the one that hid it, not the one it arrived on. One gate for both cases
    // now that the damaging branch is no longer unconditional.
    if (hitEnemy || isHarmfulUse(a.def)) revealIfConcealed(board, plan.unit, origin, a.def.id, events);
    if (!vecEq(plan.unit.pos, origin)) repositioned.push(plan.unit);
    // TRAP-CENTRE: a dash may arm a mine too. No shipped kit does, but a trap
    // effect that silently did nothing on one phase out of three would be a
    // content trap of its own.
    const dashTrap = a.def.effects.find((e) => e.kind === 'trap');
    if (dashTrap !== undefined) arming.push(() => placeTraps(draft, plan.unit, a, dashTrap, events));
  }

  for (const arm of arming) arm();
  applyDashHits(draft, board, dashHits, pending, events);

  // A decoy is destroyed by an enemy ending a *voluntary* reposition on its
  // square — Dash as well as Move (D1-dash, edge-cases 2026-08-20). Only units
  // that actually travelled count, so an enemy parked on the square by an earlier
  // knockback (which must NOT destroy it) is never swept up by a fizzled dash.
  destroyDecoysUnderEnemies(draft, repositioned, events);
}

/**
 * Walk a charge along its path (MV1 / edge-cases "AR movement model"): it passes
 * *through* any character — ally or enemy — but may not *end* on an occupied
 * square, so it rests on the furthest path square that is free (or holds if none
 * is). Walls/cover never appear in the path (validated). Returns every UNIT whose
 * square lies on the path, in path order — allies included (FF1-charge) — and the
 * caller applies `chargeHits` to take the first or all of them.
 */
function walkCharge(draft: GameState, board: Board, unit: UnitState, path: readonly Vec2[], events: TurnEvent[]): UnitState[] {
  const occupiedAt = (p: Vec2) => draft.units.some((u) => u.alive && u.unitId !== unit.unitId && vecEq(u.pos, p));
  // Furthest square the charger may rest on (last free square in the path).
  let restIndex = -1;
  for (let i = 0; i < path.length; i++) if (!occupiedAt(path[i]!)) restIndex = i;

  // Every enemy whose square lies on the path, in path order: crossed while
  // passing through, or run into at the occupied destination. `chargeHits` in the
  // caller selects the first (R1a) or all of them (R1b).
  const crossed: UnitState[] = [];
  for (const step of path) {
    // Every UNIT on the path, ally or enemy (FF1-charge): a charge is a directly
    // aimed attack, so it hits whoever is standing in it. The caller's
    // `chargeHits` then takes the first or all of them.
    const hit = draft.units.find((u) => u.alive && u.unitId !== unit.unitId && vecEq(u.pos, step));
    if (hit !== undefined) crossed.push(hit);
  }

  // Move square-by-square to the rest square, triggering traps on each entry.
  for (let i = 0; i <= restIndex; i++) {
    const step = path[i]!;
    const from = unit.pos;
    unit.pos = { x: step.x, y: step.y };
    events.push({ type: 'moveStep', unitId: unit.unitId, from, to: unit.pos });
    if (triggerTrapsOnEntry(draft, board, unit, events)) return crossed; // died or halted (TRAP-HALT)
  }
  return crossed;
}

/**
 * Teleport to `dest` if it is an open, unoccupied, **uncontested** square (walls
 * may be crossed).
 *
 * `contested` is BLINK-CLASH: the destinations two or more blinks aimed at this
 * phase. See {@link contestedBlinks} for why they are refused to everybody
 * rather than to whoever the loop reached second.
 */
function teleport(
  draft: GameState, board: Board, unit: UnitState, dest: Vec2 | undefined, events: TurnEvent[],
  contested?: ReadonlySet<string>,
): boolean {
  if (dest === undefined) return false;
  const landing = blinkLanding(draft, board, unit, dest, contested);
  if (landing === undefined) return false; // boxed in on every side — nowhere to go
  if (vecEq(landing, unit.pos)) return false; // already there; no step to emit
  const from = unit.pos;
  unit.pos = { x: landing.x, y: landing.y };
  events.push({ type: 'moveStep', unitId: unit.unitId, from, to: unit.pos });
  triggerTrapsOnEntry(draft, board, unit, events);
  return true;
}

/** Can this unit come to rest here? Terrain, bodies and the contested set. */
function blinkSquareFree(
  draft: GameState, board: Board, unit: UnitState, p: Vec2, contested?: ReadonlySet<string>,
): boolean {
  if (contested?.has(vecKey(p)) === true) return false;
  const t = terrainAt(board, p);
  if (t === 'wall' || t === 'cover' || t === 'oob') return false;
  return !draft.units.some((u) => u.alive && u.unitId !== unit.unitId && vecEq(u.pos, p));
}

/**
 * BLINK-ADJ — where a blink actually arrives.
 *
 * Owner Dev Note: *"Blocked blink should land adjacent instead of not at all."*
 *
 * A blink's destination can be unavailable three ways — **blocked terrain**
 * (wall, cover, edge), **occupied** by a unit resting there, or **contested** by
 * another blink aimed at the same square (the case PR #64 resolved as "neither
 * lands"). The owner rules all three the same: land on the nearest legal square
 * rather than failing. It is AR's "stop on the square immediately before the
 * destination", made precise for a movement that has no squares in between —
 * *nearest* is the well-defined version of *before* when there is no path to
 * walk back along.
 *
 * Nearest is **Manhattan** (MET1, the movement metric), scanned in expanding
 * rings so the first ring searched is the adjacent one — which is what makes a
 * blink onto a body land beside it. Within a ring the scan is row-major, so ties
 * break the same way on every machine.
 *
 * **Contested blinks both land.** The shared square is refused to everyone, so
 * each falls to its own nearest ring; and because teleports resolve in the
 * plans' fixed order, whoever goes first takes the square and is *standing*
 * there when the next one scans — so the second sees it occupied and moves on to
 * its next-nearest. The ordering rule the ruling asks for falls out of the
 * sequence rather than needing a tiebreak of its own, and Collisions holds.
 */
function blinkLanding(
  draft: GameState, board: Board, unit: UnitState, dest: Vec2, contested?: ReadonlySet<string>,
): Vec2 | undefined {
  if (blinkSquareFree(draft, board, unit, dest, contested)) return dest;
  // Rings of constant Manhattan distance, nearest first. The cap is the board's
  // own span: beyond it every square is out of bounds, so the search is finite
  // and a genuinely boxed-in blink returns nothing rather than looping.
  const span = board.width + board.height;
  for (let r = 1; r <= span; r++) {
    let best: Vec2 | undefined;
    for (let y = dest.y - r; y <= dest.y + r; y++) {
      for (let x = dest.x - r; x <= dest.x + r; x++) {
        if (Math.abs(x - dest.x) + Math.abs(y - dest.y) !== r) continue; // this ring only
        const p: Vec2 = { x, y };
        if (!blinkSquareFree(draft, board, unit, p, contested)) continue;
        best ??= p; // row-major: the first one found in this ring wins the tie
      }
    }
    if (best !== undefined) return best;
  }
  return undefined;
}

// ── Blast ───────────────────────────────────────────────────────────────────

interface Hit {
  attacker: UnitState;
  victim: UnitState;
  /** The ability that caused it — carried onto the `damage` event (A0). */
  abilityId: string;
  raw: number;
  range: number;
  /** Pre-computed damage, bypassing Might/Weaken and cover (delayed detonations). */
  fixedDamage?: number;
  /** Delayed detonations do not reveal or break the caster's Stealth. */
  delayed?: boolean;
  /** MELEE-COVER: skip the cover reduction for this hit. */
  melee?: boolean;
}

function runBlast(
  draft: GameState,
  board: Board,
  roster: Roster,
  plans: UnitPlan[],
  pending: Displacement[],
  events: TurnEvent[],
): void {
  events.push({ type: 'phaseStart', phase: 'blast' });

  const hits: Hit[] = [];
  // Debuffs and benefits carry their source alongside the effect (A0-heal), so
  // the `statusApplied`/`heal` they eventually emit can name who did it — the
  // gather step is the only place that still knows.
  const debuffs: { victim: UnitState; effect: AbilityEffect; source: Source }[] = [];
  const benefits: { target: UnitState; effect: AbilityEffect; source: Source }[] = [];
  const displacers: { effects: readonly AbilityEffect[]; victim: UnitState; source: Vec2; attackerId: string }[] = [];

  // Adrenaline and Overdrive have to land BEFORE the damage below is computed —
  // a Might applied after the fact would boost nothing until next turn.
  runCatalysts(draft, board, plans, 'blast', events);

  // Grenades and other delayed blasts locked on an earlier turn detonate now, at
  // their locked squares, folded into this turn's simultaneous damage.
  detonateDelayedBlasts(draft, roster, hits, debuffs, benefits, events);

  // TRAP-CENTRE + PHASE-STATUS-FIRST: mines armed by this phase's abilities,
  // buried after the status batch so the charge carries the Might that landed
  // beside it. Same shape as Prep's arming list.
  const arming: (() => void)[] = [];

  // CAMO-REVEAL: who *used* an offensive ability this phase, whether or not it
  // landed. Recorded during the gather loop and applied after the damage pass,
  // so a caster that did land damage takes the unconditional reveal instead and
  // nobody is revealed twice off one action.
  const harmfulUse = new Map<string, string>(); // unitId → abilityId

  for (const plan of orderedPlans(draft, plans)) {
    const a = plan.ability;
    if (a === undefined || a.def.phase !== 'blast' || !plan.unit.alive) continue;
    events.push({ type: 'abilityFired', unitId: plan.unit.unitId, abilityId: a.def.id, area: a.area });
    markAbilityUsed(plan.unit, a, events);
    if (isHarmfulUse(a.def)) harmfulUse.set(plan.unit.unitId, a.def.id);

    // A delayed ability (e.g. a grenade) is armed now and detonates on a later
    // turn at these locked squares (GAME_SPEC §2); no immediate effect.
    if (a.def.delayTurns !== undefined && a.def.delayTurns > 0) {
      draft.delayed.push({
        casterUnitId: plan.unit.unitId,
        abilityId: a.def.id,
        phase: 'blast',
        area: a.area.map((p) => ({ x: p.x, y: p.y })),
        turnsRemaining: a.def.delayTurns,
      });
      continue;
    }

    // Gather against post-Dash positions so mutual damage is simultaneous.
    // FRIENDLY FIRE IS ON (FF1): harmful effects apply to EVERY unit in the area,
    // ally or enemy — stand a teammate in your own AoE and you hit them, riders
    // included. Beneficial effects still only reach your own team: friendly fire
    // means your attacks endanger allies, not that you heal enemies.
    const area = new Set(a.area.map(vecKey));
    // BASIC-AXIS: the wedge's central line hits harder. Added to the ability's
    // own damage before Might, Weaken and cover, exactly as a larger authored
    // number would be — the bonus is part of the blow, not a second one.
    const axis = new Set(a.axis.map(vecKey));
    const axisBonus = a.def.axisBonus ?? 0;
    // BASIC-INNER: a tile inside the disc takes `innerAmount` **instead of** the
    // ability's own number — a replacement, because "22 in the centre, 14 in the
    // ring" is how the falloff is authored. Still before Might, Weaken and
    // cover: it is which blow landed, not a second one.
    const inner = new Set(a.inner.map(vecKey));
    const innerAmount = a.def.innerAmount;
    let hitEnemy = false;
    for (const target of draft.units) {
      if (!target.alive || !area.has(vecKey(target.pos))) continue;
      const enemy = target.owner !== plan.unit.owner;
      const self = target.unitId === plan.unit.unitId; // CASTER-SAFE
      const untargetable = isUntargetable(target); // UNTGT1
      for (const e of a.def.effects) {
        if (HARMFUL_KINDS.has(e.kind)) {
          if (self) continue; // CASTER-SAFE — see `casterSafe`; RECOIL is below
          if (untargetable) continue; // the whole harmful half is skipped, energy included
          // Energy stays enemy-only, so splashing an ally pays nothing.
          if (enemy) hitEnemy = true;
          if (e.kind === 'damage') {
            const key = vecKey(target.pos);
            const base = innerAmount !== undefined && inner.has(key) ? innerAmount : (e.amount ?? 0);
            const raw = base + (axis.has(key) ? axisBonus : 0);
            hits.push({ attacker: plan.unit, victim: target, abilityId: a.def.id, raw, range: a.def.range, melee: a.def.melee === true });
          }
          else if (e.kind === 'knockback' || e.kind === 'pull') displacers.push({ effects: [e], victim: target, source: plan.unit.pos, attackerId: plan.unit.unitId });
          else debuffs.push({ victim: target, effect: e, source: sourceOf(plan.unit, a.def.id) }); // weaken/slow/root/reveal
        } else if (BENEFICIAL_KINDS.has(e.kind)) {
          if (enemy) continue; // beneficial effects never touch enemies
          benefits.push({ target, effect: e, source: sourceOf(plan.unit, a.def.id) });
        }
      }
    }
    // TRAP-CENTRE: an ability arms its mine whatever phase it fires in — Thorn's
    // Barbed Sling leaves one on the square every shot lands on. Deferred with
    // the rest of the arming so the charge is stamped after this phase's
    // statuses (PHASE-STATUS-FIRST), exactly as Prep's is.
    const blastTrap = a.def.effects.find((e) => e.kind === 'trap');
    if (blastTrap !== undefined) arming.push(() => placeTraps(draft, plan.unit, a, blastTrap, events));

    // RECOIL — the one deliberate way back through CASTER-SAFE. `selfDamagePct`
    // charges the caster a fraction of the ability's own damage, gathered into
    // the same simultaneous list as everything else so a caster the recoil kills
    // still dealt every blow it swung.
    //
    // Three properties, each load-bearing:
    //   • `fixedDamage` — the recoil bypasses cover (there is none between you
    //     and the ground under your feet) and, for the same reason, Might and
    //     Weaken: it is the authored number scaled, not an attack you aimed at
    //     yourself. Shields still absorb it, because `applyDamage` is where the
    //     shield pool lives and a shield is a shield whatever broke it.
    //   • It is a **cost of firing**, not an area effect. Ravok's own Seismic
    //     Rupture is a `range: 0` circle so the distinction never shows on live
    //     content, but an ability aimed away from its caster would still recoil
    //     — you paid for the earthquake either way (DECISIONS 2026-09-18).
    //   • `killUnit` credits nobody when the killer owns the victim, so blowing
    //     yourself up hands the enemy team no point.
    const recoilPct = a.def.selfDamagePct;
    if (recoilPct !== undefined) {
      const base = a.def.effects.find((e) => e.kind === 'damage')?.amount ?? 0;
      const recoil = Math.floor((base * recoilPct) / 100);
      if (recoil > 0) {
        hits.push({ attacker: plan.unit, victim: plan.unit, abilityId: a.def.id, raw: recoil, range: a.def.range, fixedDamage: recoil });
      }
    }

    // A decoy in a damaging ability's area is destroyed (R2) — no energy, no
    // riders; it never counts as an enemy hit, so `hitEnemy` stays units-only.
    if (a.def.effects.some((e) => e.kind === 'damage')) {
      destroyDecoysInArea(draft, a.area, plan.unit.owner, events);
    }
    grantUseEnergy(plan.unit, a.def, hitEnemy, events);
  }

  // ── Sub-step 1: every status in the phase, both teams at once ──────────────
  //
  // PHASE-STATUS-FIRST (Dev Note #21). Statuses used to be applied *after* the
  // damage, which made a Blast-phase Weaken a promise about next turn: Dazzling
  // Ray weakened its victim, and the victim's own attack — fired in the same
  // Blast — landed at full strength anyway. The owner wants it to blunt that
  // attack. So the phase resolves as two batches: all statuses, then all damage
  // computed against the state those statuses left behind.
  //
  // Both batches are order-independent by construction. `debuffs` and
  // `benefits` were gathered from every plan before either loop runs, so no
  // team is privileged by going first, and applying a status is idempotent with
  // respect to the other statuses landing beside it.
  //
  // Beneficial effects split here: a **shield** is a status and lands in this
  // batch, which is what lets Aegis's shield absorb the very volley he threw it
  // in front of, regardless of plan order. A **heal** is not — the AC groups it
  // with damage, and it stays after the damage below so that a heal arriving in
  // the same phase as a lethal blow is still too late, exactly as today.
  for (const { victim, effect, source } of debuffs) {
    if (!victim.alive) continue;
    applyStatus(victim, effect.kind, effect.duration ?? 1, effect.amount, authorOf(effect.kind, source));
    events.push({ type: 'statusApplied', unitId: victim.unitId, status: effect.kind, duration: effect.duration ?? 1, amount: effect.amount, sourceUnitId: source.unitId, abilityId: source.abilityId });
  }
  for (const { target, effect, source } of benefits) {
    if (effect.kind === 'heal' || !target.alive) continue;
    applySelfEffects(draft, target, [effect], source, events);
  }
  for (const arm of arming) arm();

  // ── Sub-step 2: every damage and heal, both teams at once ─────────────────
  //
  // Deaths happen here but every hit was gathered first, so a unit that dies
  // still dealt its damage (edge-cases: mutual damage) and mutual kills land in
  // full. `computeDamage` reads the attacker's statuses live, which is the whole
  // point of the ordering above: a Weaken applied moments ago is already in the
  // number.
  //
  // Keyed by attacker, valued by the ability that landed — the reveal below is a
  // consequence of a specific attack, and A0-heal makes the log say which.
  const dealtDamage = new Map<string, string>();
  for (const hit of hits) {
    if (!hit.victim.alive) continue;
    const final =
      hit.fixedDamage ?? computeDamage(
        hit.raw,
        hit.attacker,
        hit.melee === true ? false : isBehindCover(board, hit.attacker.pos, hit.victim.pos, hit.range),
      );
    const res = applyDamage(hit.victim, final);
    events.push({ type: 'damage', unitId: hit.victim.unitId, amount: res.hpLost, absorbed: res.absorbed, sourceUnitId: hit.attacker.unitId, abilityId: hit.abilityId });
    onDamageTaken(board, hit.victim, hit.abilityId, events); // CAMO-REVEAL: + reveal if concealed
    if (!hit.delayed) dealtDamage.set(hit.attacker.unitId, hit.abilityId);
    if (res.died) killUnit(draft, hit.victim, hit.attacker.owner, events);
  }

  // The other half of sub-step 2: heals, on allies who survived the damage.
  for (const { target, effect, source } of benefits) {
    if (effect.kind === 'heal' && target.alive) applySelfEffects(draft, target, [effect], source, events);
  }

  // Queue displacement against survivors, to resolve at end of Blast (item 8).
  for (const { effects, victim, source, attackerId } of displacers) {
    if (victim.alive) collectDisplacement(pending, effects, victim, source, attackerId);
  }

  // REVEAL-FIX: a damaging attack reveals you **iff you were concealed when you
  // made it** — the same `revealIfConcealed` gate CAMO-REVEAL uses, rather than
  // the unconditional reveal this loop used to apply.
  //
  // Reverses the 2026-08-31 correction, owner-directed: *"when a character
  // attacks from an area where enemies lack line of sight or vision, attack and
  // movement remain completely hidden."* The old rule was a no-op for a
  // positionally-hidden attacker (`canSee` tests range and line of sight before
  // it ever asks about `reveal`) and pointless for an already-visible one — but
  // since NAMEPLATE-LAYOUT it *shows*, as a red debuff over a unit that was
  // standing in plain sight, which reads as a punishment for attacking.
  //
  // `breakStealth` is not lost with it. Stealth alone satisfies `isConcealed`
  // whatever the tile, so every stealthed attacker still goes through the gate;
  // the only units it now skips are ones with no Stealth to break.
  for (const unit of draft.units) {
    const abilityId = dealtDamage.get(unit.unitId);
    if (abilityId === undefined) continue;
    revealIfConcealed(board, unit, unit.pos, abilityId, events);
  }

  // CAMO-REVEAL's other case: a concealed unit that USED an offensive ability
  // which dealt no damage — a pure debuff, a shove, or a shot that whiffed.
  // `dealtDamage` is keyed on damage actually landing, so these units are absent
  // from it; skipping them is what let a Bola fired out of a thicket leave the
  // thicket un-given-away.
  for (const unit of draft.units) {
    if (dealtDamage.has(unit.unitId)) continue; // already revealed above
    const def = harmfulUse.get(unit.unitId);
    if (def !== undefined) revealIfConcealed(board, unit, unit.pos, def, events);
  }
}

/**
 * Detonate delayed blast abilities that came due this turn, appending their hits
 * and debuffs to the simultaneous Blast lists. They resolve at their locked
 * squares regardless of whether the caster moved or died (edge-cases: delayed
 * abilities). Damage is the locked base amount — no Might/Weaken, no cover (an
 * area detonation has no attack line); knockback/pull are not carried by any v1
 * delayed content and are skipped. Energy is granted to a living caster on hit.
 */
function detonateDelayedBlasts(
  draft: GameState,
  roster: Roster,
  hits: Hit[],
  debuffs: { victim: UnitState; effect: AbilityEffect; source: Source }[],
  benefits: { target: UnitState; effect: AbilityEffect; source: Source }[],
  events: TurnEvent[],
): void {
  const due = draft.delayed.filter((d) => d.turnsRemaining <= 0 && d.phase === 'blast');
  draft.delayed = draft.delayed.filter((d) => !(d.turnsRemaining <= 0 && d.phase === 'blast'));
  for (const d of due) {
    const caster = draft.units.find((u) => u.unitId === d.casterUnitId);
    if (caster === undefined) continue;
    const found = findAbility(roster, caster.characterId, d.abilityId);
    if (found === undefined) continue;
    const def = found.def;
    events.push({ type: 'abilityFired', unitId: caster.unitId, abilityId: def.id, area: d.area });

    // Same polarity as the direct-Blast loop (FF1-delayed): a detonation is an
    // aimed area, so harmful effects catch EVERY unit standing in it, ally or
    // enemy — a grenade does not check tags on its way off. Beneficial effects
    // still reach only the caster's own team.
    const area = new Set(d.area.map(vecKey));
    let hitEnemy = false;
    for (const target of draft.units) {
      if (!target.alive || !area.has(vecKey(target.pos))) continue;
      const enemy = target.owner !== caster.owner;
      const untargetable = isUntargetable(target); // UNTGT1
      for (const e of def.effects) {
        if (HARMFUL_KINDS.has(e.kind)) {
          // CASTER-SAFE reaches here too: a grenade you armed two turns ago is
          // still your own ability, and standing on it should not blow you up.
          if (target.unitId === caster.unitId) continue;
          if (untargetable) continue;
          if (enemy) hitEnemy = true; // energy stays enemy-only
          if (e.kind === 'damage') hits.push({ attacker: caster, victim: target, abilityId: def.id, raw: e.amount ?? 0, range: def.range, fixedDamage: e.amount ?? 0, delayed: true });
          else if (isStatusKind(e.kind)) debuffs.push({ victim: target, effect: e, source: sourceOf(caster, def.id) });
        } else if (BENEFICIAL_KINDS.has(e.kind)) {
          if (!enemy) benefits.push({ target, effect: e, source: sourceOf(caster, def.id) });
        }
      }
    }
    if (hitEnemy && caster.alive) {
      const gained = grantEnergy(caster, def.energyGain);
      if (gained > 0) events.push({ type: 'energyGained', unitId: caster.unitId, amount: gained });
    }
  }
}

// ── Move ────────────────────────────────────────────────────────────────────

interface Mover {
  unit: UnitState;
  path: Vec2[];
  halted: boolean;
  /**
   * Where this mover stood before step 0 — CLASH-CORNER's last fallback when a
   * blocked passer has to walk back off a square somebody else is resting on.
   * Captured at construction because `unit.pos` is live and has moved on by the
   * time the walk-back needs it.
   */
  origin: Vec2;
}

function runMove(draft: GameState, board: Board, plans: UnitPlan[], displaced: ReadonlySet<string>, events: TurnEvent[]): void {
  events.push({ type: 'phaseStart', phase: 'move' });

  const movers: Mover[] = [];
  for (const plan of orderedPlans(draft, plans)) {
    if (plan.movePath.length === 0 || !plan.unit.alive) continue;
    if (displaced.has(plan.unit.unitId)) continue; // knocked back/pulled → loses Move
    if (hasStatus(plan.unit, 'root')) continue; // rooted (incl. in Blast) loses Move
    // The path may have been validated from a Shift's landing square (CAT1); if
    // that teleport was blocked the unit is still standing where it started, and
    // the walk no longer connects. Dropping it is the safe reading — a Move is
    // never allowed to become a second teleport.
    if (!isAdjacentStep(plan.unit.pos, plan.movePath[0]!)) continue;
    const budget = movementBudget(plan.unit, plan.sprint);
    // Re-clamp by *cost* (a Blast-phase Slow may have shrunk the budget since the
    // path was validated in Prep); diagonals cost 1/2/1/2… (MV3).
    const path = pathWithinBudget(plan.movePath, plan.unit.pos, budget);
    if (path.length > 0) movers.push({ unit: plan.unit, path, halted: false, origin: { ...plan.unit.pos } });
  }

  // CLASH-AR (a): one collector for the whole Move phase — normal movers and
  // chasers run on two clocks, and a tie only ever happens inside one of them.
  const coEntries: VoidedClaims = new Set();
  runSteps(draft, board, movers, events, coEntries);

  // CHASE1 — chasers go after the normal movers, against the board they leave
  // behind, so a chase closes on where its target actually finished rather than
  // on a square guessed when orders were written.
  const chasers = planChases(draft, board, plans, displaced, events);
  runSteps(draft, board, chasers, events, coEntries);

  // A decoy is destroyed by an enemy that *ends a move* on its square (R2) —
  // and a chaser ends a move like anyone else.
  const arrived = [...movers, ...chasers].map((m) => m.unit);
  if (arrived.length > 0) destroyDecoysUnderEnemies(draft, arrived, events);

  // Power-up pads settle last, at one fixed point after everything has moved
  // (PADS1) — and unconditionally, not only when somebody moved: a unit knocked
  // onto a pad, or one standing on a pad the moment it respawns, has just as
  // much claim to it as one that walked there. Since PADS-PASS the claim is
  // "was on the square at any point this turn", read off the turn's own events,
  // so the settlement point is unchanged and only the eligibility widened.
  resolvePowerups(draft, board, events, coEntries);
}

/** Advance a set of movers on one shared clock until every path is spent. */
function runSteps(
  draft: GameState, board: Board, movers: Mover[], events: TurnEvent[], coEntries?: VoidedClaims,
): void {
  if (movers.length === 0) return;
  const maxLen = Math.max(...movers.map((m) => m.path.length));
  for (let step = 0; step < maxLen; step++) stepMovers(draft, board, movers, step, events, coEntries);
}

/**
 * CHASE1 — turn every surviving chase order into a path, against the **frozen
 * post-Move snapshot**: every chaser reads the same board, the one left after
 * normal movement, so A-chases-B and B-chases-A see each other where they
 * finished walking rather than one seeing the other mid-chase. Symmetric,
 * convergent, and independent of the order the chasers are visited in.
 *
 * The load-bearing rule is the one about fog (owner ruling 2026-09-01, golden
 * rule #5): **a chase never uses a position its team cannot see.** If the
 * chaser's team can see the target now, the goal is the target's real square.
 * If it cannot, the goal is the team's last-known square for that target — and
 * the chase stops there rather than continuing toward the true position, which
 * is exactly the leak fog exists to prevent.
 */
function planChases(
  draft: GameState,
  board: Board,
  plans: UnitPlan[],
  displaced: ReadonlySet<string>,
  events: TurnEvent[],
): Mover[] {
  const chasing = orderedPlans(draft, plans).filter((p) => p.chase !== undefined);
  if (chasing.length === 0) return [];

  const vision = buildVision(board);
  // One snapshot, read by every chaser: taking each chaser's goal from the live
  // board would let the first one to resolve move the second one's target.
  const snapshot = new Map(draft.units.map((u) => [u.unitId, { x: u.pos.x, y: u.pos.y }]));

  const chasers: Mover[] = [];
  for (const plan of chasing) {
    const chaser = plan.unit;
    if (!chaser.alive) continue;
    if (displaced.has(chaser.unitId)) continue;          // knocked back → loses Move
    if (hasStatus(chaser, 'root')) continue;             // rooted → loses Move

    const target = draft.units.find((u) => u.unitId === plan.chase);
    // A target that died this turn is dropped: a corpse has no square to chase.
    if (target === undefined || !target.alive) continue;

    const pursuit = walkChase(board, vision, draft, snapshot, chaser, target, movementBudget(chaser, plan.sprint));
    if (pursuit === undefined) continue;                 // never seen → nothing to chase

    events.push({
      type: 'chaseResolved',
      unitId: chaser.unitId,
      targetUnitId: target.unitId,
      to: { x: pursuit.goal.x, y: pursuit.goal.y },
      seen: pursuit.seen,
    });
    if (pursuit.path.length > 0) chasers.push({ unit: chaser, path: pursuit.path, halted: false, origin: { ...chaser.pos } });
  }
  return chasers;
}

/**
 * CHASE-FOLLOW — walk the pursuit one square at a time, asking again each step
 * whether the target is in sight.
 *
 * Owner Dev Note: *"Chasing still isn't working as intended. You should follow
 * the character that you're chasing all the way until you lose line of sight or
 * you run out of movement."*
 *
 * The chase used to judge visibility **once, from the square the chaser had not
 * moved off yet**. A target that outran the *stationary* chaser's sight was
 * therefore treated as fully fogged, and the pursuit halted on the last-known
 * square — even when walking there would have restored sight with budget to
 * spare. The reported case: a chaser at (5,10) after a target that ran to
 * (12,10) stopped at (9,10) with `seen:false`, three squares short of catching
 * something it could see the whole way.
 *
 * So the goal is re-derived from the chaser's **live** square on every step.
 * Nothing else moves while this runs — the target and every teammate are frozen
 * at their post-Move squares — so team vision can change for exactly one reason,
 * that the chaser moved, which is what makes stepping and re-asking meaningful
 * rather than circular.
 *
 * **Golden rule #5 still holds at every step.** The goal is the target's true
 * square only while the team can see it; otherwise it is the last-known square,
 * which is a square this team was already shown. No step is ever taken toward a
 * position the fog is hiding.
 *
 * Stopping is not a fourth rule — it is what happens when there is nothing left
 * to do: `pathToward` improves on the current square or returns nothing, so
 * "caught it" (adjacent, target's square occupied), "arrived at the last-known
 * square and it is still not there" (already at the goal) and "walled off" are
 * one branch. The budget is the only other exit, and it strictly decreases —
 * every step costs at least 1 — so this terminates even if sight flickers.
 */
function walkChase(
  board: Board,
  vision: Vision,
  draft: GameState,
  snapshot: ReadonlyMap<string, Vec2>,
  chaser: UnitState,
  target: UnitState,
  budget: number,
): { path: Vec2[]; goal: Vec2; seen: boolean } | undefined {
  /**
   * CHASE-LOS: a **sightline** from the chaser standing at `at`, everyone else
   * frozen — line of sight and concealment, no range cap. A pursuer does not
   * stop looking at something in the open because it got seven tiles away; it
   * loses it when the quarry breaks the line, behind a wall or into brush.
   */
  const seenFrom = (at: Vec2): boolean => teamHasSightline(
    vision,
    { ...draft, units: draft.units.map((u) => (u.unitId === chaser.unitId ? { ...u, pos: at } : u)) },
    chaser.owner,
    target,
  );
  /** What this chaser is allowed to walk at, from `at`. */
  const goalFrom = (at: Vec2): { goal: Vec2; seen: boolean } | undefined => {
    const seen = seenFrom(at);
    const goal = seen ? snapshot.get(target.unitId) : lastKnownFor(draft, chaser.owner, target.unitId)?.pos;
    return goal === undefined ? undefined : { goal, seen };
  };

  const first = goalFrom(chaser.pos);
  if (first === undefined) return undefined;

  const solid = chaseObstacles(draft, chaser);
  const path: Vec2[] = [];
  let at = chaser.pos;
  let left = budget;
  let current = first;
  while (left > 0) {
    // Re-route from here rather than stepping greedily: a single-square hop
    // toward the goal would walk into walls the reachability search routes
    // around, and the chase would be worse at pathfinding than a plain Move.
    const route = pathToward(board, draft, { ...chaser, pos: at }, current.goal, left, solid);
    const next = route[0];
    if (next === undefined) break; // caught it, arrived, or boxed in
    left -= stepCost(next.x - at.x, next.y - at.y);
    path.push(next);
    at = next;
    const now = goalFrom(at);
    if (now === undefined) break; // the memory it was chasing is gone
    current = now;
  }

  // Report the pursuit as it ended: what the chaser can see from where it
  // stopped, and the goal that reading implies. A chase that gained sight on the
  // way says so, which is the whole point of the tell.
  return { path, goal: current.goal, seen: current.seen };
}

/**
 * CHASE-COLLIDE — what a chase may not walk into or through.
 *
 * Owner Dev Notes: *"When Chasing Veil after she uses Veil & Decoy, it moves the
 * character onto the decoy space. This should not be possible."* and *"Chasing
 * should still follow collision rules — no phasing through units."*
 *
 * Two reports, one cause: the chase's router could not see either kind of
 * obstacle.
 *
 * **Bodies.** `reachableSquares` marks an occupied square `canStop: false` but
 * still expands *through* it, because a player drawing a path is allowed to plan
 * through an ally (edge-cases, "Ally pass-through is a planning affordance").
 * A chase is not a player drawing a line: it routes and walks in the same
 * instant, against a board where every other unit has already finished moving.
 * So a route through a body is a route that `stepMovers` halts on its first
 * step — and it did: a chaser at (5,10) with an enemy at (6,10) and its target
 * at (8,10) planned straight through and moved **nothing**, when walking around
 * would have caught it. Treating bodies as walls *for this router only* is what
 * "follow collision rules" means for a path nobody gets to draw.
 *
 * **Decoys.** A Wisp decoy is deliberately kept out of `state.units` and
 * "blocks nothing" (R2), which is right for a real move — walking onto one is
 * how you prove it fake, and R2 destroys it on exactly that. But the chase is
 * not a player choosing to test it: Wisp veils, the chaser loses the sightline,
 * the goal falls back to the last-known square, and the decoy is *standing on
 * that square* — so the chase walked onto the fake and popped it for free, which
 * is the report, verbatim. The decoy is rendered to the enemy team as a Wisp, so
 * to the team being fooled it is a body, and this router treats it as one.
 *
 * **Own-team decoys are transparent**, matching R2's own asymmetry (own-team
 * decoys are untouched by damage): a team is not fooled by its own illusion, and
 * blocking it on one would be a tell nobody asked for. No fog is leaked either
 * way — an enemy decoy is *shown* to this team, so routing around it uses only
 * what the team can already see (golden rule #5).
 */
function chaseObstacles(draft: GameState, chaser: UnitState): ReadonlySet<string> {
  const solid = new Set<string>();
  for (const u of draft.units) {
    if (u.alive && u.unitId !== chaser.unitId) solid.add(vecKey(u.pos));
  }
  for (const d of draft.decoys) {
    if (d.teamId !== chaser.owner) solid.add(vecKey(d.pos));
  }
  return solid;
}

/**
 * The best legal route `unit` can take toward `goal` on `budget`: the goal
 * itself when it is reachable and standable, otherwise the reachable square
 * that gets closest to it. Empty when the unit cannot improve on where it
 * stands — including when it is already there.
 *
 * Closest-to-goal is what keeps "go to the last-known square and STOP" honest:
 * every square past the goal is *further* from it, so a chase can never
 * overshoot into the fog beyond.
 *
 * Deterministic: `reachableSquares` returns squares in ascending cost under a
 * fixed expansion order, and the scan below keeps the first strict improvement,
 * so equal candidates resolve the same way on every machine.
 */
function pathToward(
  board: Board, draft: GameState, unit: UnitState, goal: Vec2, budget: number,
  impassable?: ReadonlySet<string>,
): Vec2[] {
  if (budget <= 0) return [];
  const squares = reachableSquares(board, draft, unit, budget, impassable);
  let best: Vec2 | undefined;
  let bestDist = distance(unit.pos, goal);
  for (const sq of squares) {
    if (!sq.canStop) continue;
    const d = distance(sq.pos, goal);
    if (d < bestDist) {
      bestDist = d;
      best = sq.pos;
    }
  }
  if (best === undefined) return [];
  return reconstructPath(squares, unit.pos, best) ?? [];
}

/**
 * Who has a claim on each square this turn, and how early (PADS-PASS).
 *
 * A pad is taken by **being on its square at any point in the turn**, not by
 * finishing there: a unit that runs, dashes, charges, chases or is knocked
 * across a pad picks it up on the way past. Landing on it is no longer the
 * price of taking it.
 *
 * The claim times are event indices, which is what makes the tie-break both
 * deterministic and meaningful. Events are emitted in phase order and, inside
 * Move, on one shared step clock — so "earliest claim" reads as *the first unit
 * to set foot on it*, and a Dash beats a Move for the same reason Dash resolves
 * before Move. A unit already standing there when the turn began claims at −1:
 * it was there before anybody set out.
 *
 * Only units alive at settlement claim. A charger that crossed a Health pad in
 * Dash and died in Blast takes nothing — pads still settle at one fixed point
 * at the end of Move, and that point is after the dying.
 *
 * **CLASH-AR amends the earliest-entrant rule twice**, leaving the rest of it
 * (entry-based pickup, Dash-beats-Move by phase order, the dead claiming
 * nothing) exactly as it was:
 *
 * (a) **A simultaneous entry claims nothing.** Two units that set foot on the
 *     square on the same step of the same clock are tied, and the tie used to
 *     fall to event-emission order — deterministic, but arbitrary in the way a
 *     player cannot predict from the planning screen. `voided` carries those
 *     (unit, square) pairs out of `stepMovers`, which is the only place that
 *     knows the step clock.
 *
 * (b) **An ender outranks a passer.** A unit that *rests* on the square takes
 *     the pad even if somebody crossed it earlier in the turn: resting is the
 *     stronger commitment, and AR rewards it. "Rests" needs no bookkeeping — it
 *     is simply where the unit is standing when pads settle.
 *
 * The two compose in the one corner where they meet: a unit whose only claim was
 * voided by (a) has no claim to promote, so a tie it was part of is not undone
 * by then getting stuck on the square.
 */
function claimsBySquare(
  draft: GameState,
  events: readonly TurnEvent[],
  voided: ReadonlySet<string> = new Set(),
): Map<string, { unitId: string; seq: number }> {
  const alive = new Set(draft.units.filter((u) => u.alive).map((u) => u.unitId));
  // Every claimant per square, not just the best — (b) has to be able to promote
  // a resting unit over an earlier passer, which means knowing it claimed at all.
  const claimants = new Map<string, Map<string, number>>();
  const claim = (p: Vec2, unitId: string, seq: number): void => {
    if (!alive.has(unitId)) return;
    const k = `${p.x},${p.y}`;
    if (voided.has(`${unitId}|${k}`)) return; // (a) tied on the same step
    const perSquare = claimants.get(k) ?? new Map<string, number>();
    const cur = perSquare.get(unitId);
    if (cur === undefined || seq < cur) perSquare.set(unitId, seq);
    claimants.set(k, perSquare);
  };

  // Where everybody stood before anything moved: the `from` of a unit's first
  // movement event, or — for a unit that never moved — where it stands now.
  const moved = new Set<string>();
  for (const e of events) {
    if (e.type !== 'moveStep' && e.type !== 'displaced') continue;
    if (moved.has(e.unitId)) continue;
    moved.add(e.unitId);
    claim(e.from, e.unitId, -1);
  }
  for (const u of draft.units) if (!moved.has(u.unitId)) claim(u.pos, u.unitId, -1);

  for (const [i, e] of events.entries()) {
    if (e.type === 'moveStep') {
      // One event per square entered, so `to` is the whole story — and a
      // teleport's `to` is its landing square, which is right: it crossed
      // nothing on the way.
      claim(e.to, e.unitId, i);
    } else if (e.type === 'displaced') {
      // A push is emitted once for the whole slide, along a straight
      // `direction8` line, so the squares between the ends have to be walked
      // back out. Being shoved across a pad is still being on it.
      const dx = Math.sign(e.to.x - e.from.x);
      const dy = Math.sign(e.to.y - e.from.y);
      let p: Vec2 = { x: e.from.x + dx, y: e.from.y + dy };
      for (let guard = 0; guard < MAX_DISPLACEMENT_STEPS; guard++) {
        claim(p, e.unitId, i);
        if (vecEq(p, e.to)) break;
        p = { x: p.x + dx, y: p.y + dy };
      }
    }
  }

  // Reduce each square to its one winner: the unit resting there if it has a
  // surviving claim (b), otherwise the earliest claimant.
  const restingAt = new Map<string, string>();
  for (const u of draft.units) if (u.alive) restingAt.set(`${u.pos.x},${u.pos.y}`, u.unitId);

  const best = new Map<string, { unitId: string; seq: number }>();
  for (const [k, perSquare] of claimants) {
    const resting = restingAt.get(k);
    if (resting !== undefined && perSquare.has(resting)) {
      best.set(k, { unitId: resting, seq: perSquare.get(resting)! });
      continue;
    }
    let winner: { unitId: string; seq: number } | undefined;
    for (const [unitId, seq] of perSquare) {
      if (winner === undefined || seq < winner.seq) winner = { unitId, seq };
    }
    if (winner !== undefined) best.set(k, winner);
  }
  return best;
}

/**
 * CLASH-AR (a) — `unitId|x,y` pairs whose claim a simultaneous entry voided.
 * A plain `Set` of strings so the whole thing stays JSON-shaped and ordered by
 * insertion, which is to say deterministic.
 */
type VoidedClaims = Set<string>;

/**
 * The longest slide `claimsBySquare` will walk before giving up. A displacement
 * is a straight line of at most a few squares, so this only exists so that a
 * malformed `displaced` event can never spin forever.
 */
const MAX_DISPLACEMENT_STEPS = 64;

/**
 * Award every live power-up pad to its earliest claimant (PADS1 / PADS-PASS),
 * at the single fixed point at the end of Move.
 *
 * Contested pads are now ordinary rather than impossible: before PADS-PASS the
 * only claim was occupancy and Collisions forbid two units on one square, so
 * there was nothing to break. Now two units can cross the same pad in one turn,
 * and the earlier one takes it — see {@link claimsBySquare}.
 */
function resolvePowerups(
  draft: GameState, board: Board, events: TurnEvent[], voided: ReadonlySet<string> = new Set(),
): void {
  const pads = board.map.powerups ?? [];
  if (pads.length === 0) return;
  const claims = claimsBySquare(draft, events, voided);
  for (const pad of pads) {
    const pos = { x: pad.x, y: pad.y };
    const record = draft.powerups.find((p) => vecEq(p.pos, pos));
    // Dormant until `firstTurn`, then dark until `everyTurns` after being taken.
    if (draft.turn < pad.firstTurn) continue;
    if (record !== undefined && draft.turn < record.availableOnTurn) continue;

    const claimant = claims.get(`${pos.x},${pos.y}`);
    const taker = claimant === undefined
      ? undefined
      : draft.units.find((u) => u.alive && u.unitId === claimant.unitId);
    if (taker === undefined) continue;

    applySelfEffects(draft, taker, POWERUP_EFFECTS[pad.type], { unitId: taker.unitId, abilityId: powerupSourceId(pad.type) }, events);
    events.push({ type: 'powerupTaken', unitId: taker.unitId, pos, powerup: pad.type });

    const availableOnTurn = draft.turn + pad.everyTurns;
    if (record !== undefined) record.availableOnTurn = availableOnTurn;
    else draft.powerups.push({ pos, availableOnTurn });
  }
}

/** Destroy any decoy an enemy of its team currently stands on (R2 move-onto). */
function destroyDecoysUnderEnemies(draft: GameState, units: readonly UnitState[], events: TurnEvent[]): void {
  if (draft.decoys.length === 0) return;
  draft.decoys = draft.decoys.filter((d) => {
    const enemyOnIt = units.some((u) => u.alive && u.owner !== d.teamId && vecEq(u.pos, d.pos));
    if (enemyOnIt) {
      events.push({ type: 'decoyDestroyed', decoyId: d.id, pos: d.pos });
      return false;
    }
    return true;
  });
}

/**
 * CLASH-CORNER — a blocked passer bounces off a square somebody else is resting
 * on, rather than coming to rest on top of them.
 *
 * CLASH-AR rule 3 lets an ender and a passer share a square *at the end of a
 * step*: the ender rests, the passer walks on next step, and nothing is wrong
 * because nothing rests together. That promise is only good while the passer can
 * actually walk on. Wedge it against a stationary unit, a wall or the map edge
 * and it stops where it stands — which is the ender's square, and Collisions
 * forbids two units resting on one.
 *
 * The ruling is the ender's own bounce (rule 2, already shipped) applied to the
 * unit that turned out to be an ender after all: **step back to the last square
 * it held alone.** Passing was never promised to complete; when it does not, the
 * pass was a stop, and stopping before the block is what a stop has always meant.
 *
 * The walk-back runs along the mover's **own path**, newest first, ending at the
 * origin — so it only ever retreats over ground this unit actually covered, and
 * it terminates. A square another unit has since taken is skipped, which is the
 * chain case: two blocked passers each fall back one.
 */
function bounceOffOccupied(
  draft: GameState, movers: readonly Mover[], m: Mover, step: number, events: TurnEvent[],
): void {
  const sharing = (p: Vec2): boolean =>
    draft.units.some((u) => u.alive && u.unitId !== m.unit.unitId && vecEq(u.pos, p));
  if (!sharing(m.unit.pos)) return; // resting alone — the ordinary case, nothing to undo

  // Everything this unit stood on before here, newest first. It failed to leave
  // `path[step - 1]`, so the retreat starts one before that; the origin is the
  // floor, and a unit always has one.
  const behind: Vec2[] = [];
  for (let i = step - 2; i >= 0; i--) behind.push(m.path[i]!);
  behind.push(m.origin);

  for (const p of behind) {
    if (sharing(p)) continue; // somebody else came to rest here too — keep walking back
    const from = m.unit.pos;
    m.unit.pos = { x: p.x, y: p.y };
    // Emitted as an ordinary step so the renderer animates the bounce instead of
    // teleporting the model. No stack is ever shown: the unit is off the shared
    // square within the same step it entered it.
    events.push({ type: 'moveStep', unitId: m.unit.unitId, from, to: m.unit.pos });
    return;
  }
  // CLASH-CONGA: every square it covered is somebody else's rest — a conga line
  // — so there is nothing to bounce *to*. The move is cancelled instead.
  cancelMove(movers, m, events);
}

/**
 * CLASH-CONGA — send a mover back to the square it started the phase on, and
 * anybody squatting there after it.
 *
 * The last resort under CLASH-CORNER's bounce: when a wedged passer finds every
 * square on its own path taken as well, walking back is not available and
 * standing still would stack. Cancelling is, because **origins are pairwise
 * distinct** — two units cannot have begun the phase on one square — so a board
 * where everyone is home is collision-free by construction.
 *
 * The cascade terminates for the same reason. Each call sends one more unit to
 * its own origin and a unit already home returns immediately, so at worst every
 * mover is cancelled once. A unit standing on somebody else's origin is by
 * definition not on its own, so each step of the chain finds a fresh unit.
 *
 * Only movers in this phase's own set are cancellable, and that is enough: a
 * mover cannot come to rest on a *chaser's* origin (the chaser was a stationary
 * body while the movers ran, so the occupancy check refused it), and vice versa.
 */
function cancelMove(movers: readonly Mover[], m: Mover, events: TurnEvent[]): void {
  m.halted = true;
  if (vecEq(m.unit.pos, m.origin)) return; // already home — nothing to undo
  const from = m.unit.pos;
  m.unit.pos = { x: m.origin.x, y: m.origin.y };
  events.push({ type: 'moveStep', unitId: m.unit.unitId, from, to: m.unit.pos });
  // Whoever walked onto the square this unit just reclaimed goes home too.
  const squatter = movers.find((x) => x !== m && x.unit.alive && vecEq(x.unit.pos, m.origin));
  if (squatter !== undefined) cancelMove(movers, squatter, events);
}

/**
 * Resolve one simultaneous step across all still-moving units.
 *
 * **CLASH-AR — only an ender is stopped.** The rule used to be "a contested
 * square admits nobody", which gridlocked two units whose paths merely crossed
 * in the middle. AR's, which the owner supplied verbatim and has ruled we adopt:
 *
 * 1. both **passing through** → both continue to their destinations;
 * 2. both **ending** there → all are forced back to the square they last held
 *    (already the shipped behaviour, and unchanged);
 * 3. one ending, one passing → the ender **rests** there, the passer continues.
 *
 * So the test is not "is this square contested" but "is somebody else *also*
 * ending here" — a passer never blocks anyone, including itself. Rule 3 makes
 * this load-bearing rather than cosmetic: the ender has to actually arrive, or
 * it could not take the pad the pad half of CLASH-AR hands it.
 *
 * The **2-cycle swap block is untouched** — AR's text is silent on direct swaps
 * and our own ruling stands. Two units trading squares are each *entering* a
 * square the other is standing on, which is a different thing from two units
 * arriving at one square.
 *
 * `coEntries` collects the squares two or more units entered on this same step,
 * which is exactly the "simultaneous entry claims no pad" case the pad half
 * needs; it is recorded here because this is the only place the step clock and
 * the successful entrants are both in scope.
 */
function stepMovers(
  draft: GameState,
  board: Board,
  movers: Mover[],
  step: number,
  events: TurnEvent[],
  coEntries?: VoidedClaims,
): void {
  const active = movers.filter((m) => !m.halted && m.unit.alive && step < m.path.length);
  if (active.length === 0) return;

  const target = new Map<Mover, Vec2>();
  for (const m of active) target.set(m, m.path[step]!);

  // Static conflicts, computed once from the step-start positions.
  const success = new Map<Mover, boolean>();
  // CLASH-AR: count **enders** per square, not arrivals. A square two passers
  // cross is not contested at all; a square two units settle on is.
  const enderCount = new Map<string, number>();
  for (const m of active) {
    if (step !== m.path.length - 1) continue; // passing through
    const k = vecKey(target.get(m)!);
    enderCount.set(k, (enderCount.get(k) ?? 0) + 1);
  }
  for (const m of active) {
    const t = target.get(m)!;
    // Stopped only if this step is the end of *this* unit's path and somebody
    // else is ending on the same square (rule 2). Rules 1 and 3 both continue.
    let ok = !(step === m.path.length - 1 && enderCount.get(vecKey(t))! > 1);
    if (ok) {
      // Swap: two units trading squares may not pass through each other (3a).
      for (const other of active) {
        if (other === m) continue;
        if (vecEq(target.get(other)!, m.unit.pos) && vecEq(t, other.unit.pos)) {
          ok = false;
          break;
        }
      }
    }
    success.set(m, ok);
  }

  // Occupancy fixpoint: a mover is blocked if its target square holds a unit that
  // is not itself vacating that square this step. Blocking only ever propagates,
  // so this converges regardless of visiting order (determinism).
  for (;;) {
    let changed = false;
    for (const m of active) {
      if (!success.get(m)) continue;
      const t = target.get(m)!;
      const occupant = draft.units.find((u) => u.alive && vecEq(u.pos, t));
      if (occupant === undefined) continue;
      const vacating = active.find((x) => x.unit === occupant && success.get(x));
      if (vacating === undefined) {
        success.set(m, false);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const entered = new Map<string, Mover[]>();
  for (const m of active) {
    if (success.get(m)) {
      const from = m.unit.pos;
      const to = target.get(m)!;
      m.unit.pos = { x: to.x, y: to.y };
      const k = vecKey(to);
      entered.set(k, [...(entered.get(k) ?? []), m]);
      events.push({ type: 'moveStep', unitId: m.unit.unitId, from, to: m.unit.pos });
      if (triggerTrapsOnEntry(draft, board, m.unit, events)) m.halted = true; // died or halted → rest of the path dropped
    } else {
      m.halted = true; // stops on the last square before the contested/blocked one
      bounceOffOccupied(draft, movers, m, step, events);
    }
  }

  // (CLASH-CORNER's walk-back runs inline above, on the mover that just halted,
  // so a bounced unit is off the shared square before the next step reads the
  // board — and in the movers' fixed order, so the outcome is the same on every
  // machine.)

  // CLASH-AR pad amendment (a): a square two or more units entered on this very
  // step is claimed by none of them. Recorded per (unit, square) rather than per
  // square, so a *later* arrival that rests there is still eligible — the pad is
  // denied to the units that tied for it, not retired for the turn.
  if (coEntries === undefined) return;
  for (const [k, ms] of entered) {
    if (ms.length < 2) continue;
    for (const m of ms) coEntries.add(`${m.unit.unitId}|${k}`);
  }
}

// ── End of turn ─────────────────────────────────────────────────────────────

/**
 * The author to stamp on a status instance — only the over-time kinds need one
 * (DOT-HOT), because only they act on their own later and can kill.
 *
 * Deliberately narrow: stamping every status would widen `StatusInstance` for
 * the ten kinds that have no use for it, and a `might` carrying an `abilityId`
 * is state that exists only to be serialised, hashed and compared.
 */
const authorOf = (kind: EffectKind, source: Source): Source | undefined =>
  (OVER_TIME_KINDS.has(kind) ? source : undefined);

/**
 * DOT-HOT — apply every damage/heal-over-time instance for one turn.
 *
 * Runs at end of turn and **before** `tickStatuses`, so a `duration: 2` effect
 * ticks twice: the turn it landed and the turn after. Ticking after the duration
 * decrement would quietly cost every over-time effect its first turn, which is
 * the kind of off-by-one nobody notices until a burn reads a tick short.
 *
 * A DoT that kills credits the team of whoever applied it — the same problem a
 * trap has, solved the same way — and both kinds emit the ordinary `damage` /
 * `heal` events, so playback, the combat log and SCORE1's totals need to know
 * nothing about over-time at all.
 *
 * Deterministic: `draft.units` order (fixed), integer amounts, no float.
 */
function tickOverTime(draft: GameState, events: TurnEvent[]): void {
  for (const unit of draft.units) {
    if (!unit.alive) continue;
    // Snapshot: a kill inside the loop can mutate `statuses` (death clears them),
    // and iterating a list while it is being emptied is how a tick goes missing.
    for (const s of [...unit.statuses]) {
      if (!OVER_TIME_KINDS.has(s.kind) || s.remaining <= 0) continue;
      const amount = s.amount ?? 0;
      if (amount <= 0) continue;
      const sourceUnitId = s.sourceUnitId ?? unit.unitId;
      const abilityId = s.abilityId ?? s.kind;

      if (s.kind === 'healOverTime') {
        const healed = applyHeal(unit, amount);
        if (healed > 0) events.push({ type: 'heal', unitId: unit.unitId, amount: healed, sourceUnitId, abilityId });
        continue;
      }
      // Not routed through `computeDamage`: an over-time tick is not an outgoing
      // hit, so Might/Weaken and cover do not apply (ar-parity §7.1 flags the
      // Might/Weaken half for playtest rather than deciding it here).
      const res = applyDamage(unit, amount);
      events.push({ type: 'damage', unitId: unit.unitId, amount: res.hpLost, absorbed: res.absorbed, sourceUnitId, abilityId });
      if (res.died) {
        const killer = draft.units.find((u) => u.unitId === sourceUnitId);
        killUnit(draft, unit, killer?.owner ?? unit.owner, events);
        break; // dead units stop ticking
      }
    }
  }
}

/**
 * CHASE1 — record, per team, where each enemy is *right now* if that team can
 * see it; leave the previous record alone if it cannot.
 *
 * Run at the turn boundary so "last known" means "as of the most recent turn we
 * could see you", which is the granularity a chase order is written at. A dead
 * enemy is skipped rather than erased: the record is where you last saw them,
 * and a chase against a corpse is dropped on its own account anyway.
 *
 * Iterates teams then `draft.units`, so entries are appended in a fixed order
 * and the serialised state is a function of the match, not of iteration.
 */
function recordLastKnown(draft: GameState, board: Board): void {
  const vision = buildVision(board);
  for (const team of [0, 1] as const) {
    for (const u of draft.units) {
      if (u.owner === team || !u.alive) continue;
      if (!teamCanSee(vision, draft, team, u)) continue;
      const existing = lastKnownFor(draft, team, u.unitId);
      if (existing === undefined) {
        draft.lastKnown.push({ team, unitId: u.unitId, pos: { x: u.pos.x, y: u.pos.y }, turn: draft.turn });
      } else {
        existing.pos = { x: u.pos.x, y: u.pos.y };
        existing.turn = draft.turn;
      }
    }
  }
}

function endOfTurn(draft: GameState, map: MapDef, board: Board, deadAtStart: Set<string>, events: TurnEvent[]): void {
  // Before anything expires or respawns: what each team can see at this turn's
  // end is what they get to remember (CHASE1).
  recordLastKnown(draft, board);

  // Passive energy for the living (a corpse does not build charge). The flat
  // drip is NOT boosted by Energized (E1) — pass scale:false.
  for (const u of draft.units) {
    if (!u.alive) continue;
    const gained = grantEnergy(u, PASSIVE_ENERGY, false);
    if (gained > 0) events.push({ type: 'energyGained', unitId: u.unitId, amount: gained });
  }
  // Cooldowns tick for everyone, alive or dead (edge-cases: cooldowns tick while dead).
  for (const u of draft.units) {
    for (const id of Object.keys(u.cooldowns)) {
      u.cooldowns[id] = Math.max(0, (u.cooldowns[id] ?? 0) - 1);
    }
  }
  // DOT-HOT: over-time effects resolve **before** the duration tick, so a
  // `duration: 2` DoT ticks the turn it lands and the turn after — the same
  // "covers exactly N turns" arithmetic every other duration uses. Ticking after
  // would silently cost every over-time effect its first turn.
  //
  // In `draft.units` order, which is fixed, so two units burning to death in the
  // same turn always resolve in the same order and credit the same teams.
  tickOverTime(draft, events);

  // Status durations tick for the living. What expired is logged, in
  // `unit.statuses` order, so the client can retire an indicator without
  // re-deriving durations of its own.
  for (const u of draft.units) {
    if (!u.alive) continue;
    for (const kind of tickStatuses(u)) {
      events.push({ type: 'statusRemoved', unitId: u.unitId, status: kind, reason: 'expired' });
    }
  }
  // Delayed abilities count down (resolution attaches at BACKLOG item 12).
  for (const d of draft.delayed) d.turnsRemaining -= 1;

  // Traps expire unfired at the end of their `expiresOnTurn` (TRAP-LIFETIME),
  // so a minefield cannot accrete across a match. The event is what lets a
  // client folding the log clear the marker — a marker over a square that is no
  // longer dangerous is worse than none. Turn has not advanced yet, so compare
  // directly, exactly as the decoy sweep below does.
  draft.traps = draft.traps.filter((t) => {
    if (draft.turn >= t.expiresOnTurn) {
      events.push({ type: 'trapExpired', trapId: t.id, pos: t.pos, owner: t.owner });
      return false;
    }
    return true;
  });

  // Decoys expire at the end of their `expiresOnTurn` (cast turn + 1), unless
  // already destroyed (R2). Turn has not yet advanced here, so compare directly.
  draft.decoys = draft.decoys.filter((d) => {
    if (draft.turn >= d.expiresOnTurn) {
      events.push({ type: 'decoyDestroyed', decoyId: d.id, pos: d.pos });
      return false;
    }
    return true;
  });

  // Respawn: only units that were already dead at the start of this turn count a
  // turn down, so a unit that died THIS turn misses a full turn before returning.
  for (const u of draft.units) {
    if (u.alive || !deadAtStart.has(u.unitId)) continue;
    u.respawnIn -= 1;
    if (u.respawnIn <= 0) reviveUnit(draft, map, u, events);
  }
}

function reviveUnit(draft: GameState, map: MapDef, unit: UnitState, events: TurnEvent[]): void {
  // Respawn on the first team spawn square (map order) no living unit holds
  // (edge-cases "Respawn square"). Map validation guarantees enough squares.
  const spawns = map.spawns[unit.owner];
  const occupied = new Set(
    draft.units.filter((u) => u.alive && u.owner === unit.owner).map((u) => vecKey(u.pos)),
  );
  const spawn = spawns.find((s) => !occupied.has(vecKey(s))) ?? spawns[0]!;
  unit.alive = true;
  unit.hp = unit.maxHp;
  unit.statuses = [];
  unit.respawnIn = 0;
  unit.pos = { x: spawn.x, y: spawn.y };
  events.push({ type: 'respawn', unitId: unit.unitId, pos: unit.pos });
}

/** Win check + turn advance, per the match format (GAME_SPEC §1, edge-cases tiebreak). */
function resolveOutcome(draft: GameState, events: TurnEvent[]): void {
  if (draft.status !== 'active') return;
  const { killsToWin, turnLimit } = getFormat(draft.format);
  const [k0, k1] = draft.kills;
  const reached = k0 >= killsToWin || k1 >= killsToWin;
  if (reached) {
    if (k0 >= killsToWin && k1 >= killsToWin) {
      draft.status = 'draw';
      events.push({ type: 'gameEnd', result: 'draw' });
    } else {
      draft.status = 'finished';
      draft.winner = k0 > k1 ? 0 : 1;
      events.push({ type: 'gameEnd', result: 'win', winner: draft.winner });
    }
    return;
  }
  if (draft.turn >= turnLimit) {
    if (k0 !== k1) {
      draft.status = 'finished';
      draft.winner = k0 > k1 ? 0 : 1;
      events.push({ type: 'gameEnd', result: 'win', winner: draft.winner });
      return;
    }
    draft.suddenDeath = true; // tied at the limit → sudden death continues
  }
  draft.turn += 1;
}

// ── Ordering helper ─────────────────────────────────────────────────────────

/** Plans in `state.units` order — the single deterministic processing order. */
function orderedPlans(draft: GameState, plans: UnitPlan[]): UnitPlan[] {
  const byId = new Map(plans.map((p) => [p.unit.unitId, p]));
  const out: UnitPlan[] = [];
  for (const u of draft.units) {
    const p = byId.get(u.unitId);
    if (p !== undefined) out.push(p);
  }
  return out;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Resolve one full turn. Pure: `(state, map, orders, roster)` deterministically
 * yields the same `{ state, events }` on every machine, forever.
 */
export function resolveTurn(
  state: GameState,
  map: MapDef,
  orders: readonly [PlayerOrders, PlayerOrders],
  roster: Roster,
  catalysts: CatalystPool = {},
): TurnResult {
  const draft: GameState = structuredClone(state) as GameState;
  const board = buildBoard(map);
  const events: TurnEvent[] = [];

  const deadAtStart = new Set(draft.units.filter((u) => !u.alive).map((u) => u.unitId));

  // Validate every order up front so rejection is deterministic and phase
  // execution only ever sees legal plans.
  const plans: UnitPlan[] = [];
  for (const po of orders) {
    for (const uo of po.units) {
      const plan = planUnit(board, draft, roster, catalysts, po.team, uo);
      if (plan !== undefined) plans.push(plan);
    }
  }

  if (draft.status === 'active') {
    // CHASE1 — take each team's view at the **turn boundary**, before anything
    // moves. That is the granularity a chase order is written at, and it is what
    // makes the ruled case work: a target seen when orders were locked but lost
    // during resolution is chased to "the last square the team saw it", which at
    // turn granularity is its start-of-turn square.
    //
    // After turn 1 this agrees with the record `endOfTurn` left behind, since
    // nothing moves between turns. It runs anyway rather than being special-cased
    // to turn 1, because "the boundary view is recorded at the boundary" is one
    // rule, and "…except on the first turn, where chases silently drop" is a bug
    // waiting to be rediscovered.
    recordLastKnown(draft, board);

    const pending: Displacement[] = [];
    const displaced = new Set<string>();
    runPrep(draft, board, plans, events);
    runDash(draft, board, plans, pending, displaced, events);
    runBlast(draft, board, roster, plans, pending, events);
    applyDisplacements(draft, board, pending, displaced, events);
    runMove(draft, board, plans, displaced, events);
    endOfTurn(draft, map, board, deadAtStart, events);
    resolveOutcome(draft, events);
  }

  return { state: draft, events };
}
