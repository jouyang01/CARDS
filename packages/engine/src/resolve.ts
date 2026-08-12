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

import { type Board, buildBoard, vecEq, vecKey } from './board.js';
import {
  applyDamage,
  applyHeal,
  computeDamage,
  grantEnergy,
  isBehindCover,
} from './combat.js';
import {
  KILLS_TO_WIN,
  PASSIVE_ENERGY,
  RESPAWN_TURNS,
  REVEAL_ON_ATTACK_TURNS,
  TURN_LIMIT,
  ULT_COST,
} from './constants.js';
import { movementBudget, validateMovePath } from './movement.js';
import { aimInRange, expandShape } from './shapes.js';
import { applyStatus, hasStatus, isStatusKind, removeStatus, tickStatuses } from './status.js';
import type {
  AbilityDef,
  AbilityEffect,
  CharacterDef,
  GameState,
  MapDef,
  PlayerId,
  PlayerOrders,
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

/** Does using this ability grant its energy even without hitting an enemy? */
function isSelfOrUtility(def: AbilityDef): boolean {
  return (
    def.shape === 'self' ||
    def.effects.some((e) => e.kind === 'teleport' || e.kind === 'trap' || e.kind === 'decoy')
  );
}

/**
 * Validate a single unit's order against the current draft, dropping any illegal
 * component (an unusable ability, an illegal path) rather than the whole order —
 * deterministic rejection, never a throw. Returns `undefined` if the unit is not
 * this player's or is dead.
 */
function planUnit(
  board: Board,
  draft: GameState,
  roster: Roster,
  player: PlayerId,
  order: UnitOrders,
): UnitPlan | undefined {
  const unit = draft.units.find((u) => u.unitId === order.unitId);
  if (unit === undefined || unit.owner !== player || !unit.alive) return undefined;

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
      // A dash path: orthogonal in-bounds steps within range, no wall/cover.
      // Occupancy is not checked here — a charge stops at the first enemy during
      // Dash execution (BACKLOG item 7).
      if (aim.length === 0 || aim.length > def.range) return false;
      let prev = unit.pos;
      for (const p of aim) {
        if (Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) !== 1) return false;
        const t = board.terrain[p.y * board.width + p.x];
        if (p.x < 0 || p.y < 0 || p.x >= board.width || p.y >= board.height) return false;
        if (t === 'wall' || t === 'cover') return false;
        prev = p;
      }
      return true;
    }
  }
}

// ── Death ───────────────────────────────────────────────────────────────────

/** Mark a unit dead (mid-phase), tally the kill and clear its statuses. */
function killUnit(draft: GameState, victim: UnitState, killer: PlayerId, events: TurnEvent[]): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.hp = 0;
  victim.statuses = [];
  victim.respawnIn = RESPAWN_TURNS;
  draft.kills[killer] += 1;
  events.push({ type: 'death', unitId: victim.unitId, killer });
}

// ── Prep ────────────────────────────────────────────────────────────────────

/** Mark an ability as used: spend ult energy and start its cooldown. */
function markAbilityUsed(unit: UnitState, planned: PlannedAbility): void {
  if (planned.isUlt) unit.energy = 0;
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
    markAbilityUsed(plan.unit, a);

    const trapEffect = a.def.effects.find((e) => e.kind === 'trap');
    if (trapEffect !== undefined) {
      placeTraps(draft, plan.unit, a, trapEffect, events);
    } else {
      applySelfEffects(plan.unit, a.def.effects, events);
    }
    grantUseEnergy(plan.unit, a.def, false, events);
  }
}

/** Apply a self-targeted ability's effects to its caster (shields, heals, buffs). */
function applySelfEffects(unit: UnitState, effects: readonly AbilityEffect[], events: TurnEvent[]): void {
  for (const e of effects) {
    if (e.kind === 'heal') {
      const healed = applyHeal(unit, e.amount ?? 0);
      if (healed > 0) events.push({ type: 'heal', unitId: unit.unitId, amount: healed });
    } else if (e.kind === 'shield') {
      applyStatus(unit, 'shield', e.duration ?? 1, e.amount ?? 0);
      events.push({ type: 'statusApplied', unitId: unit.unitId, status: 'shield', duration: e.duration ?? 1 });
    } else if (e.kind === 'decoy') {
      // Decoy is an OPEN ruling (edge-cases.md) — not implemented in v1.
      continue;
    } else if (isStatusKind(e.kind)) {
      applyStatus(unit, e.kind, e.duration ?? 1);
      events.push({ type: 'statusApplied', unitId: unit.unitId, status: e.kind, duration: e.duration ?? 1 });
    }
  }
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
      pos: { x: pos.x, y: pos.y },
      damage: trapEffect.amount ?? 0,
      onTrigger,
    };
    draft.traps.push(trap);
    events.push({ type: 'trapPlaced', trapId: trap.id, pos: trap.pos, owner: trap.owner });
  }
}

// ── Blast ───────────────────────────────────────────────────────────────────

interface Hit {
  attacker: UnitState;
  victim: UnitState;
  raw: number;
  range: number;
}

function runBlast(draft: GameState, board: Board, plans: UnitPlan[], events: TurnEvent[]): void {
  events.push({ type: 'phaseStart', phase: 'blast' });

  const hits: Hit[] = [];
  const debuffs: { victim: UnitState; effect: AbilityEffect }[] = [];
  const attackersThatHit = new Set<string>();

  for (const plan of orderedPlans(draft, plans)) {
    const a = plan.ability;
    if (a === undefined || a.def.phase !== 'blast' || !plan.unit.alive) continue;
    events.push({ type: 'abilityFired', unitId: plan.unit.unitId, abilityId: a.def.id, area: a.area });
    markAbilityUsed(plan.unit, a);

    // Gather against post-Dash positions so mutual damage is simultaneous.
    const area = new Set(a.area.map(vecKey));
    let hitEnemy = false;
    for (const enemy of draft.units) {
      if (enemy.owner === plan.unit.owner || !enemy.alive) continue;
      if (!area.has(vecKey(enemy.pos))) continue;
      hitEnemy = true;
      for (const e of a.def.effects) {
        if (e.kind === 'damage') {
          hits.push({ attacker: plan.unit, victim: enemy, raw: e.amount ?? 0, range: a.def.range });
        } else if (e.kind === 'knockback' || e.kind === 'pull') {
          // Displacement resolves simultaneously at end of Blast — BACKLOG item 8.
        } else if (isStatusKind(e.kind)) {
          debuffs.push({ victim: enemy, effect: e });
        }
      }
    }
    if (hitEnemy) attackersThatHit.add(plan.unit.unitId);
    grantUseEnergy(plan.unit, a.def, hitEnemy, events);
  }

  // Apply all damage. Deaths happen here but every hit was gathered first, so a
  // unit that dies still dealt its damage (edge-cases: mutual damage).
  for (const hit of hits) {
    if (!hit.victim.alive) continue;
    const behindCover = isBehindCover(board, hit.attacker.pos, hit.victim.pos, hit.range);
    const final = computeDamage(hit.raw, hit.attacker, behindCover);
    const res = applyDamage(hit.victim, final);
    events.push({ type: 'damage', unitId: hit.victim.unitId, amount: res.hpLost, absorbed: res.absorbed });
    removeStatus(hit.victim, 'stealth'); // taking damage breaks Stealth
    if (res.died) killUnit(draft, hit.victim, hit.attacker.owner, events);
  }

  // Non-displacement debuffs on survivors.
  for (const { victim, effect } of debuffs) {
    if (!victim.alive) continue;
    applyStatus(victim, effect.kind, effect.duration ?? 1);
    events.push({ type: 'statusApplied', unitId: victim.unitId, status: effect.kind, duration: effect.duration ?? 1 });
  }

  // Attacking reveals you and breaks your own Stealth (GAME_SPEC §6 / edge-cases).
  for (const unit of draft.units) {
    if (!attackersThatHit.has(unit.unitId)) continue;
    removeStatus(unit, 'stealth');
    applyStatus(unit, 'reveal', REVEAL_ON_ATTACK_TURNS);
    events.push({ type: 'statusApplied', unitId: unit.unitId, status: 'reveal', duration: REVEAL_ON_ATTACK_TURNS });
  }
}

// ── Move ────────────────────────────────────────────────────────────────────

interface Mover {
  unit: UnitState;
  path: Vec2[];
  halted: boolean;
}

function runMove(draft: GameState, board: Board, plans: UnitPlan[], events: TurnEvent[]): void {
  events.push({ type: 'phaseStart', phase: 'move' });

  const movers: Mover[] = [];
  for (const plan of orderedPlans(draft, plans)) {
    if (plan.movePath.length === 0 || !plan.unit.alive) continue;
    if (hasStatus(plan.unit, 'root')) continue; // rooted (incl. in Blast) loses Move
    const budget = movementBudget(plan.unit, plan.sprint);
    const path = plan.movePath.slice(0, budget);
    if (path.length > 0) movers.push({ unit: plan.unit, path, halted: false });
  }
  if (movers.length === 0) return;

  const maxLen = Math.max(...movers.map((m) => m.path.length));
  for (let step = 0; step < maxLen; step++) {
    stepMovers(draft, movers, step, events);
  }
}

/** Resolve one simultaneous step across all still-moving units. */
function stepMovers(draft: GameState, movers: Mover[], step: number, events: TurnEvent[]): void {
  const active = movers.filter((m) => !m.halted && step < m.path.length);
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
      // Trap triggers on entry attach here — BACKLOG item 9.
    } else {
      m.halted = true; // stops on the last square before the contested/blocked one
    }
  }
}

// ── End of turn ─────────────────────────────────────────────────────────────

function endOfTurn(draft: GameState, map: MapDef, deadAtStart: Set<string>, events: TurnEvent[]): void {
  // Passive energy for the living (a corpse does not build charge).
  for (const u of draft.units) {
    if (!u.alive) continue;
    const gained = grantEnergy(u, PASSIVE_ENERGY);
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

  // Respawn: only units that were already dead at the start of this turn count a
  // turn down, so a unit that died THIS turn misses a full turn before returning.
  for (const u of draft.units) {
    if (u.alive || !deadAtStart.has(u.unitId)) continue;
    u.respawnIn -= 1;
    if (u.respawnIn <= 0) reviveUnit(draft, map, u, events);
  }
}

function reviveUnit(draft: GameState, map: MapDef, unit: UnitState, events: TurnEvent[]): void {
  const team = draft.units.filter((u) => u.owner === unit.owner);
  const idx = team.indexOf(unit);
  const spawns = map.spawns[unit.owner];
  const spawn = spawns[idx] ?? spawns[0]!;
  unit.alive = true;
  unit.hp = unit.maxHp;
  unit.statuses = [];
  unit.respawnIn = 0;
  unit.pos = { x: spawn.x, y: spawn.y };
  events.push({ type: 'respawn', unitId: unit.unitId, pos: unit.pos });
}

/** Win check + turn advance (GAME_SPEC §1, edge-cases turn-12 tiebreak). */
function resolveOutcome(draft: GameState, events: TurnEvent[]): void {
  if (draft.status !== 'active') return;
  const [k0, k1] = draft.kills;
  const reached = k0 >= KILLS_TO_WIN || k1 >= KILLS_TO_WIN;
  if (reached) {
    if (k0 >= KILLS_TO_WIN && k1 >= KILLS_TO_WIN) {
      draft.status = 'draw';
      events.push({ type: 'gameEnd', result: 'draw' });
    } else {
      draft.status = 'finished';
      draft.winner = k0 > k1 ? 0 : 1;
      events.push({ type: 'gameEnd', result: 'win', winner: draft.winner });
    }
    return;
  }
  if (draft.turn >= TURN_LIMIT) {
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
      const plan = planUnit(board, draft, roster, po.player, uo);
      if (plan !== undefined) plans.push(plan);
    }
  }

  if (draft.status === 'active') {
    runPrep(draft, board, plans, events);
    events.push({ type: 'phaseStart', phase: 'dash' }); // dash execution — BACKLOG item 7
    runBlast(draft, board, plans, events);
    runMove(draft, board, plans, events);
    endOfTurn(draft, map, deadAtStart, events);
    resolveOutcome(draft, events);
  }

  return { state: draft, events };
}
