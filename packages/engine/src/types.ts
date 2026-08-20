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
  // WARDING-WALL / WALL-ROTATE: a freely placed segment of `wallLength` tiles,
  // ANCHORED at the aimed square and running along the aimed step. Unlike
  // `line` — which starts at the caster and runs away from them — a wall is put
  // *somewhere else*, and it is the one shape whose aim carries both a square
  // (where) and a direction (which way) as independent choices.
  'wall',
] as const;
export type TargetShape = (typeof TARGET_SHAPES)[number];

/**
 * WARDING-WALL — the ways a unit can arrive on a square, as far as a trap cares.
 *
 * A trap used to have one answer to "did that count as stepping on me": the v1
 * rule, *entry under the unit's own power* — a Move step, a charge step, or a
 * blink landing — with knockback and pull excluded.
 *
 * What made it a *list* is that a wall is a different kind of hazard from a
 * mine, and the owner said so in one sentence: it *"will hit dashes, moves, and
 * displacements, but not blinks."* Both readings are coherent and they disagree,
 * so the trap says which it wants rather than the engine holding one global
 * opinion.
 *
 * **TRAP-TRIGGER (2026-09-25) then moved the default itself.** The owner:
 * *"Traps should trigger if an enemy is knocked through the trap or if they blink
 * onto the trap or dash onto/through the trap"* — and, the other half, *"Trap
 * should not trigger if enemy blinks PAST the trap."* So the v1 carve-out for a
 * shove is gone: a mine now fires on a knock-through like everything else. What
 * survives is the sharper distinction underneath, and it is about **crossing**
 * rather than about whose idea it was: a shove drags you over every square
 * between here and there, so it crosses; a blink occupies only its landing square
 * and crosses nothing, which is why blinking *past* a mine leaves it armed while
 * blinking *onto* it sets it off. Pads already worked this way, and the two rules
 * now agree.
 */
export const TRAP_ENTRIES = ['move', 'dash', 'teleport', 'displacement'] as const;
export type TrapEntry = (typeof TRAP_ENTRIES)[number];

/**
 * TRAP-TRIGGER, as a list: **every** way of arriving on the square.
 *
 * All four, which is to say a trap with nothing authored catches whatever puts a
 * unit on its tile — walked onto, charged through, blinked onto, or shoved
 * across. A blink *past* it still fires nothing, and that falls out of the
 * mechanism rather than out of this list: a teleport calls
 * `triggerTrapsOnEntry` once, at its landing square, so a mine it flew over was
 * never offered the chance.
 *
 * It stays a named default rather than "no filter at all" because the list is
 * still *overridable* — `aegis.warding_wall` authors `['move','dash',
 * 'displacement']` to keep the owner's "a blink goes around it" exception.
 */
export const DEFAULT_TRAP_ENTRIES: readonly TrapEntry[] = [...TRAP_ENTRIES];

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
  // DOT-HOT (ar-parity §7.1): amount-per-turn effects. They ride the status
  // machinery — same refresh-not-stack, same end-of-turn tick — because
  // "something that lasts N turns" already has one implementation here.
  'damageOverTime',
  'healOverTime',
  // BRUSH-BREAK (Dev Note #19): the marker a unit gets for being hit while a
  // thicket was hiding it. Engine-applied only — no ability authors it — but it
  // lives on `unit.statuses` and ticks like everything else there, because
  // "something that lasts N turns" already has one implementation.
  'brushBroken',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface AbilityEffect {
  kind: EffectKind;
  /** Damage/heal/shield amount, or knockback/pull distance in squares. */
  amount?: number;
  /** Status duration in turns. */
  duration?: number;
  /**
   * `trap` only — turns a placed trap survives unfired, counted like a status
   * `duration`: `lifetime: 2` covers the turn it was placed and the next.
   * Capped at `TRAP_MAX_LIFETIME` by validation, and defaulted to it when the
   * data omits it, so no trap can outlive the cap by being under-specified.
   */
  lifetime?: number;
  /**
   * TRAP-HALT — `trap` only. A unit that **enters** this trap ends its movement
   * on that square: the rest of its path, or the rest of its charge, is simply
   * dropped.
   *
   * It is a stop, not a displacement — nothing is pushed, nothing is cancelled
   * beyond the steps that never happened, so a halted unit keeps whatever else
   * its turn had. **Unstoppable ignores it**, exactly as it already ignores the
   * Slow such traps carry (Dev Note #10b).
   */
  halt?: boolean;
  /**
   * WARDING-WALL — `trap` only. Which arrivals set this trap off. Omitted means
   * {@link DEFAULT_TRAP_ENTRIES}, which since TRAP-TRIGGER is all four; every
   * mine leaves it unset.
   *
   * Authored rather than inferred from the shape: "a wall does not bite a blink"
   * is a statement about *this hazard*, not about hazards laid in lines. It is
   * now a way of taking arrivals **away** rather than adding them, which is the
   * only shipped use — the wall's `['move','dash','displacement']`.
   */
  triggers?: readonly TrapEntry[];
  /**
   * WARDING-WALL — `trap` only. Place a trap on **every tile the ability
   * covers**, instead of the single one TRAP-CENTRE puts at the aimed square.
   *
   * The generalisation TRAP-CENTRE deliberately left out. That ruling exists
   * because an *area* shape burying a mine under each of its thirteen tiles is a
   * minefield nobody authored — the count fell out of the radius. A wall is the
   * case where the count IS the authored thing: four tiles because the ability
   * says four. So the difference is a field on the effect rather than a rule
   * about shapes, and any future hazard that wants a footprint asks for one.
   */
  perTile?: boolean;
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
  /**
   * WARDING-WALL — for shape `wall`: how many tiles long the segment is.
   *
   * `range` says how far away the anchor may be put and this says how far the
   * wall runs from it. Authored, because the owner authored it: *"a 4 tile long
   * wall"*.
   */
  wallLength?: number;
  /**
   * BASIC-AXIS — for shape `cone`: extra damage on the wedge's **central line**
   * (Designer §3.1, adopted from AR's Titus).
   *
   * The axis is not new geometry: CONE-B already measures every tile's
   * perpendicular distance from it to decide coverage, so "on the axis" is that
   * same integer, compared against half a tile instead of the wedge's width. A
   * hammer that rewards the straight-on read, rather than a second shape.
   *
   * Added to the ability's damage *before* Might, Weaken and cover, exactly as a
   * larger authored number would be — one multiplier path, not two.
   */
  axisBonus?: number;
  /**
   * BASIC-INNER — a circle that hits harder at its heart.
   *
   * `innerRadius` is the radius of the inner disc, measured the same way the
   * circle itself is (`dx² + dy² ≤ r²`, CIRCLE-FIX), and `innerAmount` is what a
   * tile inside it takes **instead of** the ability's own `amount` — a
   * replacement, not a bonus, because "22 in the centre, 14 in the ring" is how
   * the falloff is authored and read.
   *
   * `innerRadius: 0` is the common case and means the centre tile alone.
   *
   * Not new geometry: the disc is the same integer comparison the area already
   * makes, against a smaller number.
   */
  innerRadius?: number;
  /** The damage a tile inside `innerRadius` takes instead of `amount`. */
  innerAmount?: number;
  /**
   * BASIC-BEAM — a `cone` that keeps one width instead of fanning out.
   *
   * **`beamWidth` is the TOTAL width of the lane in tiles, and must be odd**
   * (Designer, `clashes-and-basics.md` §3.4). `beamWidth: 3` is a lane three
   * tiles across, centred on the aim axis, at every depth — CONE-B's
   * `halfWidth(d) = d` ramp replaced by a constant `halfWidth = (n − 1) / 2`.
   *
   * Total width rather than half, because a number in `data/` means the
   * footprint you get: a designer writing `3` should get a 3-wide beam, not a
   * 7-wide one. **Even is a validation error** — an even lane has no centre
   * axis to rotate around — as are values below 1 and the field on any shape
   * but `cone`.
   *
   * Not new geometry: the wedge already measures every tile's perpendicular
   * offset to decide coverage, and this compares that same integer against a
   * constant instead of against the depth.
   */
  beamWidth?: number;
  /**
   * A **melee** strike (MELEE-COVER): cover does not reduce it, whatever its
   * range.
   *
   * A flag rather than a range threshold because under Manhattan (MET1) a melee
   * ability that reaches a diagonal neighbour is authored at **range 2**, so the
   * old `range <= 1` heuristic missed exactly the abilities it was meant to
   * catch — a point-blank strike still ate the cover reduction, which is the
   * owner's report. Walls still stop it (LOS-OCCLUSION): "ignores cover" is not
   * "ignores vision".
   */
  melee?: boolean;
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
  /**
   * BASIC-MODES — two **aim-time profiles** on one ability; the order carries
   * which (Designer §3.2, adopted from AR's Elle; Kestrel's Twin Bolts).
   *
   * Each entry overrides the ability's own **targeting geometry** and nothing
   * else, so a mode is a shape of attack rather than a second ability: same
   * damage, same cooldown, same energy, same id — which is what makes the choice
   * a *positioning* decision instead of a strictly-better button. A wide cone at
   * range 2 and a thin line at range 6 are two answers to "how far away is
   * this fight", and the Skirmisher picks one every turn.
   *
   * Exactly two, because that is what the ask is and what a toggle is: a third
   * profile wants a different control and a different design conversation.
   * `AbilityProfile` names the fields a mode may move, so the type — not a
   * convention — is what stops a mode changing a number the shape does not own.
   *
   * The **index is the identity**: mode 0 is the first entry, always. Order in
   * `data/` is meaning, so reordering the array reinterprets every order in
   * flight and every replay. Absent = today's behaviour exactly.
   */
  modes?: [AbilityProfile, AbilityProfile];
  /**
   * RECOIL — the caster takes `floor(amount × selfDamagePct / 100)` of this
   * ability's damage (Designer §B #17; Ravok's Seismic Rupture carries 50).
   *
   * The **deliberate exception** to CASTER-SAFE, which is why it is opt-in data
   * rather than a rule: no kit wants accidental self-harm, but shattering the
   * earth under your own feet should cost something, and it prices a 38-damage
   * radius-3 ult honestly.
   *
   * **Bypasses cover** — there is no taking cover from the ground you are
   * standing on — and equally bypasses Might and Weaken: the recoil is the
   * ability's authored number scaled, not an attack the caster aimed at itself,
   * so a buff that sharpens your blows does not sharpen the ground. **Shields
   * absorb it normally**, because a shield is a thing between you and harm
   * whatever the harm's direction.
   *
   * Meaningless without damage to take a fraction of, so `validateAbility`
   * rejects it on an ability with none.
   */
  selfDamagePct?: number;
  /**
   * ALLY-SAFE — this ability's **harmful** effects skip the caster's own team
   * (Dev Note #11).
   *
   * FF1 stays the global default: an attack endangers whoever is standing in
   * it, and that is the positioning tax the whole game is built around. This is
   * the per-ability exception, for the kits where the default is simply wrong —
   * Lumen's Radiant Lash is a beam that damages enemies and heals allies along
   * the same line, so a Mender whose healing beam friendly-fires was
   * self-contradictory.
   *
   * Beneficial effects are untouched (they were own-team-only already), and so
   * is CASTER-SAFE, which excludes the caster from every ability. ALLY-SAFE is
   * the team-scoped, opt-in version of the same idea. `validateAbility` rejects
   * it on an ability with no harmful effect to skip.
   */
  noFriendlyFire?: boolean;
  /**
   * FRAG-SELF — this ability's harmful **area** effects treat the caster as just
   * another unit standing in it, so CASTER-SAFE does not exempt them.
   *
   * Owner Dev Note: *"Vex Frag grenade should hurt yourself too."* CASTER-SAFE
   * (RULED) says you are never a target of your own ability, and it is right
   * about nearly everything — Ravok's whirl is centred on him, Aegis's halo is
   * centred on him, and both would be unusable otherwise. A grenade is the case
   * it is wrong about: you *threw* it somewhere else, and standing in the blast
   * you threw is a mistake the game should let you make.
   *
   * Distinct from {@link selfDamagePct}, and the difference is the whole reason
   * this is a second field rather than a reuse of that one. RECOIL is a **cost
   * of firing**: charged whether or not you are in the area, scaled from the
   * authored number, bypassing cover and Might/Weaken. This is **presence**: you
   * take what anyone standing there takes, and only if you are standing there.
   * An ability wanting both would be charging twice for one blast, so validation
   * refuses the pair.
   *
   * Riders come with it. The caster is treated as a unit in the area, not as a
   * unit in the area for damage and exempt for everything else — one rule.
   */
  selfHarm?: boolean;
  effects: AbilityEffect[];
  description: string;
}

/**
 * One aim-time profile of a two-mode ability (BASIC-MODES).
 *
 * Deliberately a **subset of `AbilityDef`'s geometry**, spelled out rather than
 * `Partial<AbilityDef>`: a mode may change where an ability reaches and what
 * footprint it leaves, and may not change what it costs, what it does or how
 * often. `Partial<AbilityDef>` would permit `modes: [{ cooldown: 0 }, …]`, which
 * is not a mode — it is two abilities sharing a slot.
 *
 * `name` is the only non-geometric field, and it is for the toggle: "Spread" and
 * "Focus" say more on a button than "mode 1" and "mode 2".
 */
export interface AbilityProfile {
  /** What the toggle calls this mode. Falls back to the ability's own name. */
  name?: string;
  shape: TargetShape;
  range: number;
  radius?: number;
  axisBonus?: number;
  beamWidth?: number;
  innerRadius?: number;
  innerAmount?: number;
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

/** The three power-up pad flavours (PADS1, ar-parity §7.3). */
export const POWERUP_TYPES = ['health', 'might', 'energy'] as const;
export type PowerupType = (typeof POWERUP_TYPES)[number];

/**
 * A power-up pad as authored on a map (PADS1). Flat `x`/`y` rather than a
 * `Vec2` because that is the authored shape the backlog fixed, and a pad is a
 * map *feature* rather than a square with attributes.
 *
 * The pad's square is its identity: two pads may not share one, so validation
 * rejects duplicates and the live state keys off the position.
 */
export interface PowerupPad {
  x: number;
  y: number;
  type: PowerupType;
  /** The first turn it may be taken. */
  firstTurn: number;
  /** Turns from being taken to being takeable again. */
  everyTurns: number;
}

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
  /**
   * Power-up pads (PADS1). Optional: a map with no pads is a legal map, and
   * every fixture that predates them stays valid rather than being forced to
   * declare an empty array it does not care about.
   */
  powerups?: PowerupPad[];
}

// ── Live state ──────────────────────────────────────────────────────────────

export interface StatusInstance {
  kind: EffectKind;
  /** Turns remaining; ticks at end of turn. */
  remaining: number;
  /** For shields: remaining absorb amount. For DoT/HoT: the per-turn amount. */
  amount?: number;
  /**
   * Who applied it, for the over-time kinds (DOT-HOT). A DoT that kills has to
   * credit somebody's team — the same problem a trap has, solved the same way —
   * and the `damage`/`heal` events it emits carry A0 attribution like any other.
   * Absent on the ordinary statuses, which need no author to tick.
   */
  sourceUnitId?: string;
  abilityId?: string;
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
  /**
   * The last turn on which it is still live (TRAP-LIFETIME). Removed unfired at
   * the **end** of this turn — `placedTurn + lifetime - 1`, the same arithmetic
   * a `duration: N` status is measured by.
   */
  expiresOnTurn: number;
  /** TRAP-HALT: entering it ends the mover's movement (Unstoppable excepted). */
  halt?: boolean;
  /**
   * WARDING-WALL: which arrivals set it off, stamped at placement from the
   * ability's `triggers`. Omitted means {@link DEFAULT_TRAP_ENTRIES}.
   */
  triggers?: readonly TrapEntry[];
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

/**
 * A power-up pad that has been taken at least once (PADS1). The pad itself
 * lives on the map; all the live state needs to remember is when it comes back.
 *
 * Append-on-take rather than seeded-at-match-start: a pad nobody has contested
 * has nothing to say, and this way `powerups` is a record of what happened in
 * the match rather than a copy of the map. Absent from the list = live from the
 * pad's `firstTurn`.
 */
export interface PowerupState {
  /** The pad's square — the key back into `MapDef.powerups`. */
  pos: Vec2;
  /** The first turn it may be taken again (`takenOn + everyTurns`). */
  availableOnTurn: number;
}

/**
 * Where a team last *saw* an enemy (CHASE1). Recorded at each turn boundary for
 * every enemy that team could see at the time, and left stale otherwise — which
 * is the whole point: a chase against a target you have lost heads here, not to
 * where the target actually is.
 *
 * A flat array rather than a nested record because `GameState` must survive
 * `structuredClone` and the determinism hash as plain JSON, and because object
 * key order must never be able to affect an outcome (golden rule #1). Entries
 * are appended in team-then-`units` order and updated in place, so the list
 * order is a function of the match, not of iteration.
 */
export interface LastKnownPos {
  /** The team doing the remembering. */
  team: TeamId;
  /** The enemy unit remembered. */
  unitId: string;
  pos: Vec2;
  /** The turn the sighting was recorded — for a client wanting to age a ghost. */
  turn: number;
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
  /** Respawn timers for power-up pads already taken this match (PADS1). */
  powerups: PowerupState[];
  /**
   * Per-team last-known enemy positions (CHASE1). The authoritative copy, kept
   * engine-side because chase resolution is engine logic and must never reach
   * for a target's true fogged square (golden rule #5).
   */
  lastKnown: LastKnownPos[];
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
  /**
   * BASIC-MODES — which of a two-mode ability's profiles this order aims with.
   *
   * An **index**, because the index is the identity: `modes[0]` is mode 0 in
   * `data/`, in the order, in the log and in a replay. Absent, out of range or
   * on an ability with no `modes` all mean the same thing — the ability's own
   * profile — so an old client, a hand-written order and a mistyped number all
   * land on the default rather than on a refusal or an exception.
   */
  mode?: number;
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
  /**
   * A chase order (CHASE1): an **enemy** unit id to close on, declared *instead
   * of* `movePath`. The engine picks the route at the end of Move, once
   * everybody else has finished moving, so a chase tracks its target rather than
   * a square guessed at plan time.
   *
   * It never uses the target's true position when the chaser's team cannot see
   * it — a chase into fog goes to the team's last-known square and stops there.
   */
  chase?: string;
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
  // …and its counterpart: a status has left, either broken early (Stealth, on
  // attacking or on taking damage) or expired at the end-of-turn tick. Emitted
  // only when a status really was there. Without it the client would have to
  // *derive* when a buff wore off, which the rendering contract forbids —
  // status indicators (STATUS-AUDIT) are folded from these two events alone.
  | { type: 'statusRemoved'; unitId: string; status: EffectKind; reason: 'broken' | 'expired' }
  | { type: 'moveStep'; unitId: string; from: Vec2; to: Vec2 }
  | { type: 'displaced'; unitId: string; from: Vec2; to: Vec2; kind: 'knockback' | 'pull' }
  | { type: 'trapPlaced'; trapId: string; pos: Vec2; owner: TeamId }
  // …and its counterpart: the trap ran out its life without anyone stepping on
  // it (TRAP-LIFETIME). Distinct from `trapTriggered`, which means somebody did.
  // Without it a client folding the log keeps a marker over a square that is no
  // longer dangerous — the same failure `statusRemoved` exists to prevent.
  | { type: 'trapExpired'; trapId: string; pos: Vec2; owner: TeamId }
  // A chase resolved (CHASE1). `to` is the square the chaser actually set off
  // for — the target's real square when its team could see it, the team's
  // last-known square when it could not — so the client can draw the route the
  // engine took without re-deriving vision, and without ever being told where an
  // unseen target really is. Absent entirely when the chase was dropped.
  | { type: 'chaseResolved'; unitId: string; targetUnitId: string; to: Vec2; seen: boolean }
  // A power-up pad was picked up (PADS1). The effects it grants arrive as the
  // ordinary `heal`/`statusApplied` events immediately before this one, so the
  // only thing the client learns here is that the pad went dark.
  | { type: 'powerupTaken'; unitId: string; pos: Vec2; powerup: PowerupType }
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
