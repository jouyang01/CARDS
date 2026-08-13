/**
 * Core types for the Cards engine.
 *
 * GOLDEN RULE (see CLAUDE.md): everything in this package is pure and
 * deterministic. Integer math only for game values; no randomness APIs, no
 * clock reads, no I/O. `resolveTurn` is a pure function of (state, map, orders).
 */

import type { FormatId } from './formats.js';

// ── Geometry ────────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Which of the two teams a unit / order belongs to. The engine is team-based
 * and player-count-blind (GAME_SPEC §1); the room layer maps players to the
 * characters they control (ARCHITECTURE "Teams vs. players").
 */
export type TeamId = 0 | 1;

// ── Phases ──────────────────────────────────────────────────────────────────

/** Resolution order is sacred: prep → dash → blast → move. */
export const PHASES = ['prep', 'dash', 'blast', 'move'] as const;
export type Phase = (typeof PHASES)[number];

/** Phases an ability may be tagged with (normal movement is not an ability). */
export type AbilityPhase = 'prep' | 'dash' | 'blast';

// ── Abilities & effects (data-driven; see data/characters/*.json) ───────────

export const TARGET_SHAPES = [
  'line', // straight line from caster, length = range
  'cone', // cone from caster, length = range
  'circle', // circle of `radius` centered on an aimed square within `range`
  'path', // a movement path walked/charged by the caster (dashes)
  'square', // a single aimed square within `range` (incl. teleport destinations)
  'self', // the caster
] as const;
export type TargetShape = (typeof TARGET_SHAPES)[number];

export const EFFECT_KINDS = [
  'damage',
  'heal',
  'shield',
  'might',
  'weaken',
  'haste',
  'slow',
  'root',
  'reveal',
  'energized',
  'unstoppable',
  'knockback',
  'pull',
  'trap',
  'stealth',
  'decoy',
  'teleport',
  'untargetable',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface AbilityEffect {
  kind: EffectKind;
  /** Damage/heal/shield amount, or knockback/pull distance in squares. */
  amount?: number;
  /** Status duration in turns. */
  duration?: number;
}

export interface AbilityDef {
  id: string;
  name: string;
  phase: AbilityPhase;
  shape: TargetShape;
  /** Max distance in squares (0 for self). */
  range: number;
  /** For shape 'circle': area radius around the aimed square. */
  radius?: number;
  /** Turns before reusable. 0 = every turn. */
  cooldown: number;
  /** Energy granted on use (self-target) or on hitting ≥1 enemy. */
  energyGain: number;
  /** Resolves this many turns later, at the originally aimed squares. */
  delayTurns?: number;
  /**
   * For a damaging `path` dash only: which crossed enemies its effects hit.
   * `"first"` (default/absent) = the first enemy whose square it crosses (R1a);
   * `"all"` = every enemy crossed (R1b, e.g. Kestrel's Tempest Run). Rejected on
   * any non-`path` shape (validate.ts).
   */
  chargeHits?: 'first' | 'all';
  effects: AbilityEffect[];
  description: string;
}

export type Archetype = 'firepower' | 'frontline' | 'trickster' | 'support';

export interface CharacterDef {
  id: string;
  name: string;
  archetype: Archetype;
  maxHp: number;
  /** Exactly 4 in v1. */
  abilities: AbilityDef[];
  /** Costs ULT_COST energy; otherwise a normal phase-tagged ability. */
  ultimate: AbilityDef;
}

// ── Map ─────────────────────────────────────────────────────────────────────

export type TerrainKind = 'wall' | 'cover' | 'brush';

export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Blocks movement AND line of sight. */
  walls: Vec2[];
  /** Blocks movement, NOT LoS; grants directional 50% damage reduction. */
  cover: Vec2[];
  /** Concealment patches. */
  brush: Vec2[];
  /** spawns[teamId] = list of that team's spawn squares (one per character). */
  spawns: [Vec2[], Vec2[]];
}

// ── Live state ──────────────────────────────────────────────────────────────

export interface StatusInstance {
  kind: EffectKind;
  /** Turns remaining; ticks at end of turn. */
  remaining: number;
  /** For shields: remaining absorb amount. */
  amount?: number;
}

export interface UnitState {
  unitId: string;
  characterId: string;
  owner: TeamId;
  pos: Vec2;
  hp: number;
  /** Full HP for this character; heals cap here and respawn restores to it. */
  maxHp: number;
  energy: number;
  alive: boolean;
  /** Turns until respawn when dead (RESPAWN_TURNS at death). */
  respawnIn: number;
  /** abilityId → turns remaining. */
  cooldowns: Record<string, number>;
  statuses: StatusInstance[];
}

export interface TrapState {
  id: string;
  owner: TeamId;
  pos: Vec2;
  damage: number;
  /** Applied to whoever triggers it. */
  onTrigger: AbilityEffect[];
}

/**
 * A Wisp decoy (edge-cases R2): a static fake unit kept *out* of `state.units`
 * so no phase loop / vision union / spawn picker / win check needs an "is this
 * real?" guard. It blocks nothing, triggers nothing, and dies to any damage or
 * to an enemy ending a move on its square. Rendered to the enemy team as Wisp.
 */
export interface DecoyState {
  id: string;
  /** The owning (Wisp's) team. */
  teamId: TeamId;
  pos: Vec2;
  /** Turn number at whose end it expires (matching the 1-turn Stealth). */
  expiresOnTurn: number;
}

export interface PendingDelayedAbility {
  casterUnitId: string;
  abilityId: string;
  phase: AbilityPhase;
  /** Squares locked at cast time. */
  area: Vec2[];
  turnsRemaining: number;
}

export interface GameState {
  turn: number;
  units: UnitState[];
  traps: TrapState[];
  delayed: PendingDelayedAbility[];
  /** Wisp decoys (edge-cases R2), kept out of `units`. */
  decoys: DecoyState[];
  /** Per-team kill tally, `kills[teamId]`. */
  kills: [number, number];
  /** Match format id (GAME_SPEC §1) — sets kill target and turn limit. */
  format: FormatId;
  status: 'active' | 'finished' | 'draw';
  winner?: TeamId;
  /** True once past the format's turn limit with tied kills. */
  suddenDeath: boolean;
}

// ── Orders (the per-team order set resolveTurn consumes) ────────────────────

export interface AbilityOrder {
  abilityId: string;
  /** Meaning depends on shape: aimed square, direction endpoint, or path. */
  target: Vec2[];
}

export interface UnitOrders {
  unitId: string;
  ability?: AbilityOrder;
  /** Move-phase path, first square = first step. Empty/absent = hold. */
  movePath?: Vec2[];
  /** True = no ability, extended move range. */
  sprint?: boolean;
}

/**
 * One team's orders for a turn. The room layer merges each player's 1–2
 * `UnitOrders` into their team's set before calling `resolveTurn`; the engine
 * itself is player-count-blind (ARCHITECTURE "Teams vs. players").
 */
export interface PlayerOrders {
  team: TeamId;
  units: UnitOrders[];
}

// ── Resolution output ───────────────────────────────────────────────────────

/**
 * The event log is the rendering contract: the client animates exactly these
 * events, in order, and never re-derives game logic.
 */
export type TurnEvent =
  | { type: 'phaseStart'; phase: Phase }
  | { type: 'abilityFired'; unitId: string; abilityId: string; area: Vec2[] }
  | { type: 'damage'; unitId: string; amount: number; absorbed: number }
  | { type: 'heal'; unitId: string; amount: number }
  // `amount` carries the shield pool when `status === 'shield'` (undefined otherwise),
  // so the client can track shields from the log (edge-cases "Rendering contract").
  | { type: 'statusApplied'; unitId: string; status: EffectKind; duration: number; amount?: number }
  | { type: 'moveStep'; unitId: string; from: Vec2; to: Vec2 }
  | { type: 'displaced'; unitId: string; from: Vec2; to: Vec2; kind: 'knockback' | 'pull' }
  | { type: 'trapPlaced'; trapId: string; pos: Vec2; owner: TeamId }
  | { type: 'trapTriggered'; trapId: string; unitId: string }
  // A decoy appears (rendered to the enemy team as Wisp) / is revealed & removed.
  | { type: 'decoySpawned'; decoyId: string; pos: Vec2; teamId: TeamId }
  | { type: 'decoyDestroyed'; decoyId: string; pos: Vec2 }
  | { type: 'death'; unitId: string; killer: TeamId }
  | { type: 'respawn'; unitId: string; pos: Vec2 }
  | { type: 'energyGained'; unitId: string; amount: number }
  // Energy removed by an ability (the ultimate's reset-to-0); delta-based like
  // energyGained so the client does `energy -= amount` (edge-cases "Rendering contract").
  | { type: 'energySpent'; unitId: string; amount: number }
  | { type: 'gameEnd'; result: 'win' | 'draw'; winner?: TeamId };

export interface TurnResult {
  state: GameState;
  events: TurnEvent[];
}
