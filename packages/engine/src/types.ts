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
  /**
   * A **free action** (FREE1): may be declared *in addition to* a normal
   * ability, and never reduces the move budget or blocks Sprint. Absent/false is
   * today's behaviour.
   *
   * Which abilities may carry it is a rule, not a list (edge-cases): Prep phase
   * only, no immediate damage/heal/shield, payoff deferred or conditional — the
   * point is to make a setup play affordable without losing tempo. Two of those
   * three are machine-checkable and `validateAbility` enforces them: `free`
   * requires `phase === 'prep'` and `energyGain === 0`, as errors rather than
   * runtime special cases, so no future kit can quietly grant a free Blast or a
   * free action that is strictly better in every dimension.
   */
  free?: boolean;
  /**
   * A **catalyst** (CAT1): consumed on use and gone for the rest of the match,
   * rather than put on cooldown. Death does not refund one; unused catalysts
   * survive death and respawn.
   *
   * This is also what lets a catalyst be a free Dash or Blast action, which
   * `free` alone may not be: the reason `free` is Prep-only is that a repeatable
   * free attack is too strong, and a once-per-match one is self-limiting.
   */
  oncePerMatch?: boolean;
  /**
   * An **area of effect at takeoff and/or landing**, for `phase: "dash"` only
   * (DASH-IMPACT). Radii are **Euclidean** (AIM-METRIC) and expand through
   * `circleSquares`, so this adds no new geometry.
   *
   * `destination` is centred on the square the dasher comes to rest on (after
   * pass-through or an early stop for a `path` charge; the landing square for a
   * `square` teleport). `origin` is centred on the square it left. Both compose
   * with the existing dash models: a charge still hits the first body it crosses
   * *and* detonates where it stops.
   *
   * Absent = today's behaviour exactly. This is also what let the hardcoded
   * teleport-strike adjacency be deleted: it was a Manhattan-1 special case with
   * exactly one user, and `{ destination: 1 }` says the same thing in data.
   */
  impact?: { origin?: number; destination?: number };
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
  /**
   * The three catalysts this unit carries, one per phase (CAT1). Plain string
   * **arrays**, not Sets, on purpose: `structuredClone` and the determinism hash
   * both assume `GameState` is plain JSON, and a Set survives neither.
   */
  catalysts: string[];
  /** Catalyst ids already spent this match. Consumed, not cooled down. */
  catalystsUsed: string[];
}

export interface TrapState {
  id: string;
  owner: TeamId;
  /** The unit that placed it, and the ability that did — damage attribution (A0). */
  ownerUnitId: string;
  abilityId: string;
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
  /**
   * Meaning depends on shape: aimed square, direction endpoint, or path.
   * Optional because a `self` shape has nothing to aim at — a self-cast or a
   * self-centred catalyst should not have to carry an empty array to be legal.
   */
  target?: Vec2[];
  /**
   * Free-rotation aim for `line`/`cone` (AIM2): a QUANTIZED INTEGER direction in
   * [0, AIM_STEPS), never a float or a radian — the client does the mouse→step
   * conversion, and the engine's resolution path stays trig-free and identical
   * on every machine. Absent = derive the direction from `target`, i.e. the
   * original click-to-aim behaviour. Ignored by other shapes.
   */
  aimStep?: number;
}

export interface UnitOrders {
  unitId: string;
  ability?: AbilityOrder;
  /**
   * A **free action** declared alongside `ability` (FREE1) — it must name an
   * ability the unit owns that is `free: true` and off cooldown.
   *
   * This is a separate slot on purpose: a free action is additive, so putting it
   * in `ability` would make it compete with the normal one and defeat the whole
   * mechanic. At most one free action per unit per turn (edge-cases, the
   * conservative v1 reading), counting this and `catalyst` together.
   */
  freeAbility?: AbilityOrder;
  /**
   * A **catalyst** (CAT1) — one of the three this unit carries, not already
   * spent. Like `freeAbility` it is additive and never prices the turn; at most
   * one of the two per unit per turn (edge-cases, the conservative v1 reading).
   */
  catalyst?: AbilityOrder;
  /** Move-phase path, first square = first step. Empty/absent = hold. */
  movePath?: Vec2[];
  /** True = no ability, extended move range. A free action never blocks it. */
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
  // `sourceUnitId`/`abilityId` attribute the hit to whoever caused it (A0). Blast
  // emits every `abilityFired` before any `damage`, so log adjacency cannot say
  // which ability landed a hit — presentation (sequential Blast, "shooter in
  // frame" camera) reads these instead. Trap damage credits the trap's owner and
  // the ability that placed it; a delayed detonation credits its original caster.
  | { type: 'damage'; unitId: string; amount: number; absorbed: number; sourceUnitId: string; abilityId: string }
  // Healing and statuses carry their source too (A0-heal), so the combat log can
  // say "Aegis shielded Lumen for 30" rather than "Lumen gained 30 shield" — a
  // benefit has an author exactly as a hit does. Self-cast effects name the unit
  // itself; a trap's rider credits the unit that placed it and the placing ability.
  | { type: 'heal'; unitId: string; amount: number; sourceUnitId: string; abilityId: string }
  // `amount` carries the shield pool when `status === 'shield'` (undefined otherwise),
  // so the client can track shields from the log (edge-cases "Rendering contract").
  | { type: 'statusApplied'; unitId: string; status: EffectKind; duration: number; amount?: number; sourceUnitId: string; abilityId: string }
  | { type: 'moveStep'; unitId: string; from: Vec2; to: Vec2 }
  | { type: 'displaced'; unitId: string; from: Vec2; to: Vec2; kind: 'knockback' | 'pull' }
  | { type: 'trapPlaced'; trapId: string; pos: Vec2; owner: TeamId }
  // A catalyst is spent (CAT1) — playback and the HUD's spent-slot greying.
  | { type: 'catalystUsed'; unitId: string; catalystId: string }
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
