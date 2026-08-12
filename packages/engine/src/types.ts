/**
 * Core types for the Cards engine.
 *
 * GOLDEN RULE (see CLAUDE.md): everything in this package is pure and
 * deterministic. Integer math only for game values; no randomness APIs, no
 * clock reads, no I/O. `resolveTurn` is a pure function of (state, map, orders).
 */

// ── Geometry ────────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export type PlayerId = 0 | 1;

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
  /** spawns[playerId] = list of spawn squares (N units per side later). */
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
  owner: PlayerId;
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
  owner: PlayerId;
  pos: Vec2;
  damage: number;
  /** Applied to whoever triggers it. */
  onTrigger: AbilityEffect[];
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
  kills: [number, number];
  status: 'active' | 'finished' | 'draw';
  winner?: PlayerId;
  /** True once past TURN_LIMIT with tied kills. */
  suddenDeath: boolean;
}

// ── Orders (what a player submits each turn) ────────────────────────────────

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

export interface PlayerOrders {
  player: PlayerId;
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
  | { type: 'statusApplied'; unitId: string; status: EffectKind; duration: number }
  | { type: 'moveStep'; unitId: string; from: Vec2; to: Vec2 }
  | { type: 'displaced'; unitId: string; from: Vec2; to: Vec2; kind: 'knockback' | 'pull' }
  | { type: 'trapPlaced'; trapId: string; pos: Vec2; owner: PlayerId }
  | { type: 'trapTriggered'; trapId: string; unitId: string }
  | { type: 'death'; unitId: string; killer: PlayerId }
  | { type: 'respawn'; unitId: string; pos: Vec2 }
  | { type: 'energyGained'; unitId: string; amount: number }
  | { type: 'gameEnd'; result: 'win' | 'draw'; winner?: PlayerId };

export interface TurnResult {
  state: GameState;
  events: TurnEvent[];
}
