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
  chebyshev,
  diagonalCornerBlocked,
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
import { aimInRange, direction8, expandShape } from './shapes.js';
import { applyStatus, hasStatus, isImmuneTo, isStatusKind, removeStatus, tickStatuses } from './status.js';
import type {
  AbilityDef,
  AbilityEffect,
  CharacterDef,
  DecoyState,
  EffectKind,
  GameState,
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
  team: TeamId,
  order: UnitOrders,
): UnitPlan | undefined {
  const unit = draft.units.find((u) => u.unitId === order.unitId);
  if (unit === undefined || unit.owner !== team || !unit.alive) return undefined;

  let ability: PlannedAbility | undefined;
  const found = order.ability !== undefined ? findAbility(roster, unit.characterId, order.ability.abilityId) : undefined;
  if (order.ability !== undefined && found !== undefined) {
    const { def, isUlt } = found;
    const aim = order.ability.target ?? [];
    const onCooldown = (unit.cooldowns[def.id] ?? 0) > 0;
    const canAfford = !isUlt || unit.energy >= ULT_COST;
    if (!onCooldown && canAfford && aimIsLegal(board, unit, def, aim)) {
      ability = { def, aim, area: expandShape(board, def, unit.pos, aim), isUlt };
    }
  }

  // Sprint is "move only": it is ignored the moment a real ability is used.
  const sprint = ability === undefined && order.sprint === true;

  // A dash ability IS the unit's movement this turn; a separate Move path is
  // dropped (see docs/DECISIONS.md).
  let movePath: Vec2[] = [];
  const dashing = ability?.def.phase === 'dash';
  if (!dashing && order.movePath !== undefined && order.movePath.length > 0) {
    const check = validateMovePath(board, draft, unit, order.movePath, sprint);
    if (check.valid) movePath = order.movePath.map((p) => ({ x: p.x, y: p.y }));
  }

  return { unit, ability, movePath, sprint };
}

/** Is an ability's aim geometrically legal for its shape and range? */
function aimIsLegal(board: Board, unit: UnitState, def: AbilityDef, aim: readonly Vec2[]): boolean {
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

// ── Traps ───────────────────────────────────────────────────────────────────

/**
 * Trigger any enemy trap on the square `unit` just entered (edge-cases: traps
 * fire on entry in any phase). Trap damage is raw — Might/Weaken and cover do
 * not apply (see DECISIONS.md) — and the trap's non-trap effects (e.g. Reveal)
 * hit the victim. A trap is one-shot: it is consumed when it fires. A unit that
 * merely *starts* on a freshly-placed trap never calls this, so it is safe until
 * it re-enters. Returns true if the victim died.
 */
function triggerTrapsOnEntry(draft: GameState, unit: UnitState, events: TurnEvent[]): boolean {
  if (!unit.alive) return false;
  for (const trap of draft.traps.filter((t) => t.owner !== unit.owner && vecEq(t.pos, unit.pos))) {
    draft.traps = draft.traps.filter((t) => t.id !== trap.id); // consumed
    events.push({ type: 'trapTriggered', trapId: trap.id, unitId: unit.unitId });
    const res = applyDamage(unit, trap.damage);
    events.push({ type: 'damage', unitId: unit.unitId, amount: res.hpLost, absorbed: res.absorbed, sourceUnitId: trap.ownerUnitId, abilityId: trap.abilityId });
    removeStatus(unit, 'stealth'); // taking damage breaks Stealth
    for (const e of trap.onTrigger) {
      if (isStatusKind(e.kind)) {
        applyStatus(unit, e.kind, e.duration ?? 1);
        events.push({ type: 'statusApplied', unitId: unit.unitId, status: e.kind, duration: e.duration ?? 1 });
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
  for (const plan of orderedPlans(draft, plans)) {
    const a = plan.ability;
    if (a === undefined || a.def.phase !== 'prep' || !plan.unit.alive) continue;
    events.push({ type: 'abilityFired', unitId: plan.unit.unitId, abilityId: a.def.id, area: a.area });
    markAbilityUsed(plan.unit, a, events);

    const trapEffect = a.def.effects.find((e) => e.kind === 'trap');
    if (trapEffect !== undefined) {
      placeTraps(draft, plan.unit, a, trapEffect, events);
    } else {
      applySelfEffects(draft, plan.unit, a.def.effects, events);
    }
    grantUseEnergy(plan.unit, a.def, false, events);
  }
}

/** Apply a self-targeted ability's effects to its caster (shields, heals, buffs, decoy). */
function applySelfEffects(draft: GameState, unit: UnitState, effects: readonly AbilityEffect[], events: TurnEvent[]): void {
  for (const e of effects) {
    if (e.kind === 'heal') {
      const healed = applyHeal(unit, e.amount ?? 0);
      if (healed > 0) events.push({ type: 'heal', unitId: unit.unitId, amount: healed });
    } else if (e.kind === 'shield') {
      applyStatus(unit, 'shield', e.duration ?? 1, e.amount ?? 0);
      events.push({ type: 'statusApplied', unitId: unit.unitId, status: 'shield', duration: e.duration ?? 1, amount: e.amount ?? 0 });
    } else if (e.kind === 'decoy') {
      spawnDecoy(draft, unit, events); // R2: a static fake at the caster's square
    } else if (isStatusKind(e.kind)) {
      applyStatus(unit, e.kind, e.duration ?? 1);
      events.push({ type: 'statusApplied', unitId: unit.unitId, status: e.kind, duration: e.duration ?? 1 });
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

// ── Dash ────────────────────────────────────────────────────────────────────

/**
 * Dash phase: dashers move (charge path or teleport), damage-dealing dashes hit
 * the first enemy struck, and self-statuses (e.g. Untargetable) apply. Blast
 * immunity for the vacated square is emergent — Blast is resolved afterwards
 * against these new positions, so a dasher is simply no longer where it was
 * aimed at (edge-cases: dash immunity scope). Displacement from a dash is queued
 * for end of Blast (BACKLOG item 8); trap triggers attach here (item 9).
 */
function runDash(draft: GameState, board: Board, plans: UnitPlan[], pending: Displacement[], events: TurnEvent[]): void {
  events.push({ type: 'phaseStart', phase: 'dash' });
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
    if (a.def.shape === 'path') crossed = walkCharge(draft, plan.unit, a.aim, events);
    else teleport(draft, board, plan.unit, a.aim[0], events);

    // Damage: a charge hits the enemies it crossed — the first only (R1a, default)
    // or every one (R1b, `chargeHits: "all"`, e.g. Tempest Run); a teleport-strike
    // hits everyone adjacent to where it landed, ALLIES INCLUDED (FF1: a directly
    // aimed area does not filter by team). The charge's "first enemy crossed" is
    // R1a's *selection* rule, not an area filter, and FF1 did not re-rule it, so
    // a charge still picks its victims from enemies only — flagged for the
    // Analyzer (DECISIONS 2026-08-21).
    const dmg = a.def.effects.find((e) => e.kind === 'damage');
    let hitEnemy = false;
    if (dmg !== undefined) {
      const victims =
        a.def.shape === 'path'
          ? a.def.chargeHits === 'all'
            ? crossed
            : crossed.slice(0, 1)
          // Adjacency here stays CHEBYSHEV (edge-cases "Walked dash vs teleport").
          // Deliberately left by MET1: that ruling named vision and movement and
          // did not name this one, and narrowing it to the 4 orthogonal
          // neighbours would rebalance Wisp's ult. Also flagged for the Analyzer.
          : draft.units.filter((u) => u.alive && u.unitId !== plan.unit.unitId && chebyshev(plan.unit.pos, u.pos) === 1);
      const source = a.def.shape === 'path' ? origin : plan.unit.pos;
      for (const victim of victims) {
        const behindCover = isBehindCover(board, source, victim.pos, a.def.range);
        const res = applyDamage(victim, computeDamage(dmg.amount ?? 0, plan.unit, behindCover));
        events.push({ type: 'damage', unitId: victim.unitId, amount: res.hpLost, absorbed: res.absorbed, sourceUnitId: plan.unit.unitId, abilityId: a.def.id });
        removeStatus(victim, 'stealth');
        if (victim.owner !== plan.unit.owner) hitEnemy = true; // energy is enemy-only
        if (res.died) killUnit(draft, victim, plan.unit.owner, events);
        else collectDisplacement(pending, a.def.effects, victim, source, plan.unit.unitId);
      }
    }

    // A decoy in a damaging dash's area/path is destroyed too (R2) — no energy.
    if (dmg !== undefined) destroyDecoysInArea(draft, a.area, plan.unit.owner, events);

    // Self-statuses (Untargetable, etc.); movement/damage/displacement are skipped.
    applySelfEffects(draft, plan.unit, a.def.effects, events);
    grantUseEnergy(plan.unit, a.def, hitEnemy, events);
    if (hitEnemy) {
      removeStatus(plan.unit, 'stealth');
      applyStatus(plan.unit, 'reveal', REVEAL_ON_ATTACK_TURNS);
      events.push({ type: 'statusApplied', unitId: plan.unit.unitId, status: 'reveal', duration: REVEAL_ON_ATTACK_TURNS });
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
 * is). Walls/cover never appear in the path (validated). Returns every enemy
 * whose square lies on the path, in path order; the caller applies `chargeHits`.
 */
function walkCharge(draft: GameState, unit: UnitState, path: readonly Vec2[], events: TurnEvent[]): UnitState[] {
  const occupiedAt = (p: Vec2) => draft.units.some((u) => u.alive && u.unitId !== unit.unitId && vecEq(u.pos, p));
  // Furthest square the charger may rest on (last free square in the path).
  let restIndex = -1;
  for (let i = 0; i < path.length; i++) if (!occupiedAt(path[i]!)) restIndex = i;

  // Every enemy whose square lies on the path, in path order: crossed while
  // passing through, or run into at the occupied destination. `chargeHits` in the
  // caller selects the first (R1a) or all of them (R1b).
  const crossed: UnitState[] = [];
  for (const step of path) {
    const enemy = draft.units.find((u) => u.alive && u.owner !== unit.owner && vecEq(u.pos, step));
    if (enemy !== undefined) crossed.push(enemy);
  }

  // Move square-by-square to the rest square, triggering traps on each entry.
  for (let i = 0; i <= restIndex; i++) {
    const step = path[i]!;
    const from = unit.pos;
    unit.pos = { x: step.x, y: step.y };
    events.push({ type: 'moveStep', unitId: unit.unitId, from, to: unit.pos });
    if (triggerTrapsOnEntry(draft, unit, events)) return crossed; // died mid-charge
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
  triggerTrapsOnEntry(draft, unit, events);
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
  const debuffs: { victim: UnitState; effect: AbilityEffect }[] = [];
  const benefits: { target: UnitState; effect: AbilityEffect }[] = [];
  const displacers: { effects: readonly AbilityEffect[]; victim: UnitState; source: Vec2; attackerId: string }[] = [];

  // Grenades and other delayed blasts locked on an earlier turn detonate now, at
  // their locked squares, folded into this turn's simultaneous damage.
  detonateDelayedBlasts(draft, roster, hits, debuffs, events);

  for (const plan of orderedPlans(draft, plans)) {
    const a = plan.ability;
    if (a === undefined || a.def.phase !== 'blast' || !plan.unit.alive) continue;
    events.push({ type: 'abilityFired', unitId: plan.unit.unitId, abilityId: a.def.id, area: a.area });
    markAbilityUsed(plan.unit, a, events);

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
      for (const e of a.def.effects) {
        if (HARMFUL_KINDS.has(e.kind)) {
          // Energy stays enemy-only, so splashing an ally pays nothing.
          if (enemy) hitEnemy = true;
          if (e.kind === 'damage') hits.push({ attacker: plan.unit, victim: target, abilityId: a.def.id, raw: e.amount ?? 0, range: a.def.range });
          else if (e.kind === 'knockback' || e.kind === 'pull') displacers.push({ effects: [e], victim: target, source: plan.unit.pos, attackerId: plan.unit.unitId });
          else debuffs.push({ victim: target, effect: e }); // weaken/slow/root/reveal
        } else if (BENEFICIAL_KINDS.has(e.kind)) {
          if (enemy) continue; // beneficial effects never touch enemies
          benefits.push({ target, effect: e });
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
  const dealtDamage = new Set<string>();
  for (const hit of hits) {
    if (!hit.victim.alive) continue;
    const final =
      hit.fixedDamage ?? computeDamage(hit.raw, hit.attacker, isBehindCover(board, hit.attacker.pos, hit.victim.pos, hit.range));
    const res = applyDamage(hit.victim, final);
    events.push({ type: 'damage', unitId: hit.victim.unitId, amount: res.hpLost, absorbed: res.absorbed, sourceUnitId: hit.attacker.unitId, abilityId: hit.abilityId });
    removeStatus(hit.victim, 'stealth'); // taking damage breaks Stealth
    if (!hit.delayed) dealtDamage.add(hit.attacker.unitId);
    if (res.died) killUnit(draft, hit.victim, hit.attacker.owner, events);
  }

  // Non-displacement debuffs on surviving enemies.
  for (const { victim, effect } of debuffs) {
    if (!victim.alive) continue;
    applyStatus(victim, effect.kind, effect.duration ?? 1);
    events.push({ type: 'statusApplied', unitId: victim.unitId, status: effect.kind, duration: effect.duration ?? 1 });
  }

  // Beneficial effects (heal / shield / buffs) on surviving allies (item 14).
  for (const { target, effect } of benefits) {
    if (target.alive) applySelfEffects(draft, target, [effect], events);
  }

  // Queue displacement against survivors, to resolve at end of Blast (item 8).
  for (const { effects, victim, source, attackerId } of displacers) {
    if (victim.alive) collectDisplacement(pending, effects, victim, source, attackerId);
  }

  // A *damaging* attack reveals you and breaks your own Stealth (GAME_SPEC §6).
  for (const unit of draft.units) {
    if (!dealtDamage.has(unit.unitId)) continue;
    removeStatus(unit, 'stealth');
    applyStatus(unit, 'reveal', REVEAL_ON_ATTACK_TURNS);
    events.push({ type: 'statusApplied', unitId: unit.unitId, status: 'reveal', duration: REVEAL_ON_ATTACK_TURNS });
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
  debuffs: { victim: UnitState; effect: AbilityEffect }[],
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

    const area = new Set(d.area.map(vecKey));
    let hitEnemy = false;
    for (const enemy of draft.units) {
      if (enemy.owner === caster.owner || !enemy.alive || !area.has(vecKey(enemy.pos))) continue;
      hitEnemy = true;
      for (const e of def.effects) {
        if (e.kind === 'damage') hits.push({ attacker: caster, victim: enemy, abilityId: def.id, raw: e.amount ?? 0, range: def.range, fixedDamage: e.amount ?? 0, delayed: true });
        else if (isStatusKind(e.kind)) debuffs.push({ victim: enemy, effect: e });
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
    const budget = movementBudget(plan.unit, plan.sprint);
    // Re-clamp by *cost* (a Blast-phase Slow may have shrunk the budget since the
    // path was validated in Prep); diagonals cost 1/2/1/2… (MV3).
    const path = pathWithinBudget(plan.movePath, plan.unit.pos, budget);
    if (path.length > 0) movers.push({ unit: plan.unit, path, halted: false });
  }
  if (movers.length === 0) return;

  const maxLen = Math.max(...movers.map((m) => m.path.length));
  for (let step = 0; step < maxLen; step++) {
    stepMovers(draft, movers, step, events);
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
function stepMovers(draft: GameState, movers: Mover[], step: number, events: TurnEvent[]): void {
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
      if (triggerTrapsOnEntry(draft, m.unit, events)) m.halted = true; // died → path discarded
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
  // Status durations tick for the living.
  for (const u of draft.units) {
    if (u.alive) tickStatuses(u);
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
      const plan = planUnit(board, draft, roster, po.team, uo);
      if (plan !== undefined) plans.push(plan);
    }
  }

  if (draft.status === 'active') {
    const pending: Displacement[] = [];
    const displaced = new Set<string>();
    runPrep(draft, board, plans, events);
    runDash(draft, board, plans, pending, events);
    runBlast(draft, board, roster, plans, pending, events);
    applyDisplacements(draft, board, pending, displaced, events);
    runMove(draft, board, plans, displaced, events);
    endOfTurn(draft, map, deadAtStart, events);
    resolveOutcome(draft, events);
  }

  return { state: draft, events };
}
