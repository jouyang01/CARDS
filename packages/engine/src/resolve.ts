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
} from './combat.js';
import {
  PASSIVE_ENERGY,
  RESPAWN_TURNS,
  REVEAL_ON_ATTACK_TURNS,
  ULT_COST,
} from './constants.js';
import { getFormat } from './formats.js';
import { movementBudget, pathWithinBudget, stepCost, validateMovePath } from './movement.js';
import { aimInRange, circleSquares, direction8, expandShape, isAimStep } from './shapes.js';
import { applyStatus, hasStatus, isImmuneTo, isStatusKind, removeStatus, tickStatuses } from './status.js';
import type { CatalystPool } from './catalysts.js';
import type {
  AbilityDef,
  AbilityEffect,
  AbilityPhase,
  CharacterDef,
  DecoyState,
  EffectKind,
  GameState,
  AbilityOrder,
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

// ── Normalised, validated plans ─────────────────────────────────────────────

interface PlannedAbility {
  def: AbilityDef;
  aim: Vec2[];
  area: Vec2[];
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
]);
export const NEUTRAL_KINDS: ReadonlySet<EffectKind> = new Set<EffectKind>([
  'teleport',
  'decoy',
  'trap',
]);

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

  return {
    unit,
    ability,
    freeAbility,
    catalyst: spentCatalyst,
    shiftTo: freeAbility === undefined ? shiftTo : undefined,
    movePath,
    sprint,
  };
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
  return { def, aim, area: expandShape(board, def, unit.pos, aim, aimStep), isUlt: false };
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
function fireCatalyst(draft: GameState, board: Board, unit: UnitState, c: PlannedAbility, events: TurnEvent[]): void {
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
    teleport(draft, board, unit, c.aim[0], events);
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
function runCatalysts(draft: GameState, board: Board, plans: UnitPlan[], phase: AbilityPhase, events: TurnEvent[]): void {
  for (const plan of orderedPlans(draft, plans)) {
    const c = plan.catalyst;
    if (c !== undefined && c.def.phase === phase) fireCatalyst(draft, board, plan.unit, c, events);
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
  const { def, isUlt } = found;
  const aim = order.target ?? [];
  if ((unit.cooldowns[def.id] ?? 0) > 0) return undefined;
  if (isUlt && unit.energy < ULT_COST) return undefined;
  // An out-of-range aim step is rejected like any other illegal component (AIM2).
  const aimStep = order.aimStep;
  if (aimStep !== undefined && !isAimStep(aimStep)) return undefined;
  if (!aimIsLegal(board, unit, def, aim, aimStep)) return undefined;
  return { def, aim, area: expandShape(board, def, unit.pos, aim, aimStep), isUlt };
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
 * it re-enters. Returns true if the victim died.
 */
function triggerTrapsOnEntry(draft: GameState, board: Board, unit: UnitState, events: TurnEvent[]): boolean {
  if (!unit.alive) return false;
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
  }
  return false;
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
  // Free actions resolve next (FREE1). Validation pins them to Prep, so this is
  // the only phase that needs the pass — and going first is the ordering
  // catalysts will need, so there is one rule rather than two.
  for (const plan of orderedPlans(draft, plans)) {
    if (plan.freeAbility !== undefined) firePrep(draft, board, plan.unit, plan.freeAbility, events);
  }
  for (const plan of orderedPlans(draft, plans)) {
    const a = plan.ability;
    if (a === undefined || a.def.phase !== 'prep') continue;
    firePrep(draft, board, plan.unit, a, events);
  }
}

/** Resolve one Prep-phase ability for `unit`: traps place, everything else self-applies. */
function firePrep(draft: GameState, board: Board, unit: UnitState, a: PlannedAbility, events: TurnEvent[]): void {
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
    placeTraps(draft, unit, a, trapEffect, events);
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
 * Apply an ability's beneficial effects to every ally standing in its area,
 * **and to the caster exactly once** whether or not it is standing in it.
 *
 * The caster is unconditional because an ability's self-effects are not an area
 * question — Untargetable on a dash, Might on an ult, a shield the caster grants
 * itself — while the area half is FF1 polarity: beneficial effects reach your
 * own team only. Both meet in one pass so nobody is shielded twice.
 */
function applyAreaBoons(
  draft: GameState,
  caster: UnitState,
  a: PlannedAbility,
  source: Source,
  events: TurnEvent[],
): void {
  applySelfEffects(draft, caster, a.def.effects, source, events);
  const boons = a.def.effects.filter((e) => BENEFICIAL_KINDS.has(e.kind));
  if (boons.length === 0) return;
  const area = new Set(a.area.map(vecKey));
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
      applyStatus(unit, e.kind, e.duration ?? 1);
      events.push({ type: 'statusApplied', unitId: unit.unitId, status: e.kind, duration: e.duration ?? 1, sourceUnitId: source.unitId, abilityId: source.abilityId });
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
  for (const [i, pos] of planned.area.entries()) {
    const trap: TrapState = {
      id: `trap-${owner.unitId}-t${draft.turn}-${i}`,
      owner: owner.owner,
      ownerUnitId: owner.unitId,
      abilityId: planned.def.id,
      pos: { x: pos.x, y: pos.y },
      damage: trapEffect.amount ?? 0,
      onTrigger,
    };
    draft.traps.push(trap);
    events.push({ type: 'trapPlaced', trapId: trap.id, pos: trap.pos, owner: trap.owner });
  }
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
 * Dash phase: dashers move (charge path or teleport), damage-dealing dashes hit
 * the first enemy struck, and self-statuses (e.g. Untargetable) apply. Blast
 * immunity for the vacated square is emergent — Blast is resolved afterwards
 * against these new positions, so a dasher is simply no longer where it was
 * aimed at (edge-cases: dash immunity scope). Displacement from a dash is queued
 * for end of Blast (BACKLOG item 8); trap triggers attach here (item 9).
 */
function runDash(draft: GameState, board: Board, plans: UnitPlan[], pending: Displacement[], displaced: Set<string>, events: TurnEvent[]): void {
  events.push({ type: 'phaseStart', phase: 'dash' });
  // Shift resolves before a dash ability the same unit declared. Its Move cost
  // (CAT-DASH-COST) was already taken at plan time — `planUnit` drops the walk
  // for any unit spending a Dash catalyst — so nothing here needs to touch
  // `plan.movePath`.
  runCatalysts(draft, board, plans, 'dash', events);
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
      teleport(draft, board, plan.unit, a.aim[0], events);
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
        const behindCover = isBehindCover(board, from, victim.pos, a.def.range);
        const res = applyDamage(victim, computeDamage(dmg.amount ?? 0, plan.unit, behindCover));
        events.push({ type: 'damage', unitId: victim.unitId, amount: res.hpLost, absorbed: res.absorbed, sourceUnitId: plan.unit.unitId, abilityId: a.def.id });
        onDamageTaken(board, victim, a.def.id, events); // CAMO-REVEAL: + reveal if concealed
        if (victim.owner !== plan.unit.owner) hitEnemy = true; // energy is enemy-only
        if (res.died) killUnit(draft, victim, plan.unit.owner, events);
        // …unless this dash already shoved them out of its landing square, in
        // which case they have taken their displacement for this ability.
        else if (victim.unitId !== shovedAside?.unitId) {
          collectDisplacement(pending, a.def.effects, victim, from, plan.unit.unitId);
        }
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
    applySelfEffects(draft, plan.unit, a.def.effects, sourceOf(plan.unit, a.def.id), events);
    grantUseEnergy(plan.unit, a.def, hitEnemy, events);
    // CAMO-REVEAL: a dash that lands no damage still gives a concealed dasher
    // away if it carried a debuff or a shove. Measured from `origin` — the tile
    // it launched from is the one that hid it. The `hitEnemy` branch below is
    // the pre-existing unconditional reveal, left exactly as it was.
    if (!hitEnemy && isHarmfulUse(a.def)) revealIfConcealed(board, plan.unit, origin, a.def.id, events);
    if (hitEnemy) {
      breakStealth(plan.unit, events);
      applyStatus(plan.unit, 'reveal', REVEAL_ON_ATTACK_TURNS);
      events.push({ type: 'statusApplied', unitId: plan.unit.unitId, status: 'reveal', duration: REVEAL_ON_ATTACK_TURNS, sourceUnitId: plan.unit.unitId, abilityId: a.def.id });
    }
    if (!vecEq(plan.unit.pos, origin)) repositioned.push(plan.unit);
  }

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
    if (triggerTrapsOnEntry(draft, board, unit, events)) return crossed; // died mid-charge
  }
  return crossed;
}

/** Teleport to `dest` if it is an open, unoccupied square (walls may be crossed). */
function teleport(draft: GameState, board: Board, unit: UnitState, dest: Vec2 | undefined, events: TurnEvent[]): boolean {
  if (dest === undefined) return false;
  const t = terrainAt(board, dest);
  if (t === 'wall' || t === 'cover' || t === 'oob') return false;
  if (draft.units.some((u) => u.alive && u.unitId !== unit.unitId && vecEq(u.pos, dest))) return false;
  const from = unit.pos;
  unit.pos = { x: dest.x, y: dest.y };
  events.push({ type: 'moveStep', unitId: unit.unitId, from, to: unit.pos });
  triggerTrapsOnEntry(draft, board, unit, events);
  return true;
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
    let hitEnemy = false;
    for (const target of draft.units) {
      if (!target.alive || !area.has(vecKey(target.pos))) continue;
      const enemy = target.owner !== plan.unit.owner;
      const untargetable = isUntargetable(target); // UNTGT1
      for (const e of a.def.effects) {
        if (HARMFUL_KINDS.has(e.kind)) {
          if (untargetable) continue; // the whole harmful half is skipped, energy included
          // Energy stays enemy-only, so splashing an ally pays nothing.
          if (enemy) hitEnemy = true;
          if (e.kind === 'damage') hits.push({ attacker: plan.unit, victim: target, abilityId: a.def.id, raw: e.amount ?? 0, range: a.def.range });
          else if (e.kind === 'knockback' || e.kind === 'pull') displacers.push({ effects: [e], victim: target, source: plan.unit.pos, attackerId: plan.unit.unitId });
          else debuffs.push({ victim: target, effect: e, source: sourceOf(plan.unit, a.def.id) }); // weaken/slow/root/reveal
        } else if (BENEFICIAL_KINDS.has(e.kind)) {
          if (enemy) continue; // beneficial effects never touch enemies
          benefits.push({ target, effect: e, source: sourceOf(plan.unit, a.def.id) });
        }
      }
    }
    // A decoy in a damaging ability's area is destroyed (R2) — no energy, no
    // riders; it never counts as an enemy hit, so `hitEnemy` stays units-only.
    if (a.def.effects.some((e) => e.kind === 'damage')) {
      destroyDecoysInArea(draft, a.area, plan.unit.owner, events);
    }
    grantUseEnergy(plan.unit, a.def, hitEnemy, events);
  }

  // Apply all damage. Deaths happen here but every hit was gathered first, so a
  // unit that dies still dealt its damage (edge-cases: mutual damage).
  // Keyed by attacker, valued by the ability that landed — the reveal below is a
  // consequence of a specific attack, and A0-heal makes the log say which.
  const dealtDamage = new Map<string, string>();
  for (const hit of hits) {
    if (!hit.victim.alive) continue;
    const final =
      hit.fixedDamage ?? computeDamage(hit.raw, hit.attacker, isBehindCover(board, hit.attacker.pos, hit.victim.pos, hit.range));
    const res = applyDamage(hit.victim, final);
    events.push({ type: 'damage', unitId: hit.victim.unitId, amount: res.hpLost, absorbed: res.absorbed, sourceUnitId: hit.attacker.unitId, abilityId: hit.abilityId });
    onDamageTaken(board, hit.victim, hit.abilityId, events); // CAMO-REVEAL: + reveal if concealed
    if (!hit.delayed) dealtDamage.set(hit.attacker.unitId, hit.abilityId);
    if (res.died) killUnit(draft, hit.victim, hit.attacker.owner, events);
  }

  // Non-displacement debuffs on surviving enemies.
  for (const { victim, effect, source } of debuffs) {
    if (!victim.alive) continue;
    applyStatus(victim, effect.kind, effect.duration ?? 1);
    events.push({ type: 'statusApplied', unitId: victim.unitId, status: effect.kind, duration: effect.duration ?? 1, sourceUnitId: source.unitId, abilityId: source.abilityId });
  }

  // Beneficial effects (heal / shield / buffs) on surviving allies (item 14).
  for (const { target, effect, source } of benefits) {
    if (target.alive) applySelfEffects(draft, target, [effect], source, events);
  }

  // Queue displacement against survivors, to resolve at end of Blast (item 8).
  for (const { effects, victim, source, attackerId } of displacers) {
    if (victim.alive) collectDisplacement(pending, effects, victim, source, attackerId);
  }

  // A *damaging* attack reveals you and breaks your own Stealth (GAME_SPEC §6).
  // Unconditional — concealed or not — and unchanged by CAMO-REVEAL: dropping it
  // for open attackers would let a unit shoot from open ground and disappear
  // into brush the next turn with no penalty at all.
  for (const unit of draft.units) {
    const abilityId = dealtDamage.get(unit.unitId);
    if (abilityId === undefined) continue;
    breakStealth(unit, events);
    applyStatus(unit, 'reveal', REVEAL_ON_ATTACK_TURNS);
    events.push({ type: 'statusApplied', unitId: unit.unitId, status: 'reveal', duration: REVEAL_ON_ATTACK_TURNS, sourceUnitId: unit.unitId, abilityId });
  }

  // CAMO-REVEAL adds the case that loop cannot see: a concealed unit that USED
  // an offensive ability which dealt no damage — a pure debuff, a shove, or a
  // shot that whiffed. `dealtDamage` is keyed on damage actually landing, so
  // these units are absent from it; skipping them is what let a Bola fired out
  // of a thicket leave the thicket un-given-away.
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
    if (path.length > 0) movers.push({ unit: plan.unit, path, halted: false });
  }
  if (movers.length === 0) return;

  const maxLen = Math.max(...movers.map((m) => m.path.length));
  for (let step = 0; step < maxLen; step++) {
    stepMovers(draft, board, movers, step, events);
  }

  // A decoy is destroyed by an enemy that *ends a move* on its square (R2).
  destroyDecoysUnderEnemies(draft, movers.map((m) => m.unit), events);
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

/** Resolve one simultaneous step across all still-moving units. */
function stepMovers(draft: GameState, board: Board, movers: Mover[], step: number, events: TurnEvent[]): void {
  const active = movers.filter((m) => !m.halted && m.unit.alive && step < m.path.length);
  if (active.length === 0) return;

  const target = new Map<Mover, Vec2>();
  for (const m of active) target.set(m, m.path[step]!);

  // Static conflicts, computed once from the step-start positions.
  const success = new Map<Mover, boolean>();
  const targetCount = new Map<string, number>();
  for (const m of active) {
    const k = vecKey(target.get(m)!);
    targetCount.set(k, (targetCount.get(k) ?? 0) + 1);
  }
  for (const m of active) {
    const t = target.get(m)!;
    let ok = targetCount.get(vecKey(t))! === 1; // contested square → nobody enters
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

  for (const m of active) {
    if (success.get(m)) {
      const from = m.unit.pos;
      const to = target.get(m)!;
      m.unit.pos = { x: to.x, y: to.y };
      events.push({ type: 'moveStep', unitId: m.unit.unitId, from, to: m.unit.pos });
      if (triggerTrapsOnEntry(draft, board, m.unit, events)) m.halted = true; // died → path discarded
    } else {
      m.halted = true; // stops on the last square before the contested/blocked one
    }
  }
}

// ── End of turn ─────────────────────────────────────────────────────────────

function endOfTurn(draft: GameState, map: MapDef, deadAtStart: Set<string>, events: TurnEvent[]): void {
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
    const pending: Displacement[] = [];
    const displaced = new Set<string>();
    runPrep(draft, board, plans, events);
    runDash(draft, board, plans, pending, displaced, events);
    runBlast(draft, board, roster, plans, pending, events);
    applyDisplacements(draft, board, pending, displaced, events);
    runMove(draft, board, plans, displaced, events);
    endOfTurn(draft, map, deadAtStart, events);
    resolveOutcome(draft, events);
  }

  return { state: draft, events };
}
