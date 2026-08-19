/**
 * Targeting logic: turn a player's in-progress selections into a legal
 * `UnitOrders`, and derive the previews the UI paints. **Pure** and free of
 * game logic (Dev Note 1): every legality/shape question is delegated to the
 * engine (`expandShape`, `aimInRange`, `validateMovePath`, `movementBudget`,
 * `reachableSquares`, `findAbility`) — the client computes nothing itself.
 *
 * The DOM layer (`targeting-ui.ts`) owns clicks and rendering; it drives this
 * module and paints what it returns. Hidden information and per-player timers
 * are the M3 room layer's concern, not here.
 */

import {
  ULT_COST,
  aimInRange,
  axisSquares,
  buildBoard,
  abilityProfile,
  circleSquares,
  direction8,
  distance,
  dominantCardinal,
  expandShape,
  findAbility,
  innerSquares,
  isAimStep,
  stepToVector,
  movementBudget,
  reachableSquares,
  reconstructPath,
  stepCost,
  validateMovePath,
  vecEq,
  vectorToStep,
  type AbilityDef,
  type AbilityEffect,
  type Board,
  type CharacterDef,
  type GameState,
  type MapDef,
  type ReachableSquare,
  type UnitOrders,
  type UnitState,
  type Vec2,
} from '@cards/engine';

/**
 * A character's selection in progress. A non-dash `abilityId` and a `movePath`
 * may coexist — move *and* shoot in one turn (MS1). `sprint` is exclusive with
 * an ability (it is move-only), and a dash ability owns the move (no separate
 * `movePath`).
 */
export interface OrderDraft {
  unitId: string;
  /** Chosen ability (its ult included), or undefined for none. */
  abilityId?: string;
  /** Aim squares for the ability (meaning depends on its shape). */
  aim: Vec2[];
  /**
   * Free-rotation direction for `line`/`cone` (AIM2): the quantized integer step
   * a drag produced. The client owns the pointer maths; the engine only ever
   * sees this integer. Absent for click-to-aim and for other shapes.
   */
  aimStep?: number;
  /**
   * BASIC-MODES — which profile of a two-mode ability this draft aims with.
   *
   * An index, mirroring `AbilityOrder.mode`, and resolved in exactly one place
   * (`draftAbility`) so every preview, range envelope and legality check below
   * sees the ability the mode chose. Absent for every ability that has no modes,
   * which is all of them but one.
   */
  mode?: number;
  /**
   * A **catalyst** (CAT2) — a separate slot from `abilityId`, never a
   * replacement for it. Selecting one must not clear the normal ability, which
   * is the same mutual-exclusivity trap MS1 fixed for move-and-shoot: the two
   * are additive, and treating them as one choice makes the mechanic
   * unreachable. `catalystAim` is its target where the shape needs one.
   */
  catalystId?: string;
  catalystAim: Vec2[];
  /**
   * A **free ability** (FREE-UI) — its own slot, for exactly the same reason a
   * catalyst has one. The engine has accepted `order.freeAbility` since FREE1;
   * the client had no reference to it at all, so a `free: true` ability filled
   * the normal `abilityId` slot, went out as `order.ability`, and disabled
   * Sprint. The whole mechanic — "place the trap AND take your turn" — was
   * unreachable through the UI while the engine implemented it correctly.
   */
  freeAbilityId?: string;
  freeAim: Vec2[];
  /** Sprint = move-only, longer range. Ignored once an ability is chosen. */
  sprint: boolean;
  /** Move-phase path; coexists with a non-dash ability, dropped for a dash. */
  movePath: Vec2[];
  /**
   * A **chase target** (CHASE1) — an enemy unit id, declared instead of a
   * `movePath`. It occupies the same slot as the drawn path for the same reason
   * the engine treats it that way: both are the unit's Move, and one reposition
   * per turn is the rule. Coexists with a non-dash ability exactly as a walk
   * does, so "chase and shoot" works like "move and shoot".
   */
  chaseTargetId?: string;
}

/** A blank draft for a unit (holds position until the player chooses). */
export function emptyDraft(unitId: string): OrderDraft {
  return { unitId, aim: [], catalystAim: [], freeAim: [], sprint: false, movePath: [] };
}

export interface AbilityOption {
  def: AbilityDef;
  isUlt: boolean;
  /** False when on cooldown or (ult) under the energy cost. */
  available: boolean;
  reason?: 'cooldown' | 'energy';
  /** Turns left on cooldown (0 if ready). */
  cooldown: number;
}

/** Every ability + ultimate for a unit, with availability read from its state. */
export function abilityOptions(unit: UnitState, character: CharacterDef): AbilityOption[] {
  const rows: AbilityOption[] = character.abilities.map((def) => ({ def, isUlt: false }))
    .concat([{ def: character.ultimate, isUlt: true }])
    .map(({ def, isUlt }) => {
      const cooldown = unit.cooldowns[def.id] ?? 0;
      if (cooldown > 0) return { def, isUlt, available: false, reason: 'cooldown', cooldown };
      if (isUlt && unit.energy < ULT_COST) return { def, isUlt, available: false, reason: 'energy', cooldown: 0 };
      return { def, isUlt, available: true, cooldown: 0 };
    });
  return rows;
}

/** One effect rendered as `kind amount (durationt)`, e.g. `damage 26`, `shield 30 (2t)`. */
export function effectLabel(e: AbilityEffect): string {
  const amount = e.amount !== undefined ? ` ${e.amount}` : '';
  const duration = e.duration !== undefined ? ` (${e.duration}t)` : '';
  return `${e.kind}${amount}${duration}`;
}

/**
 * Tooltip lines for an ability, read straight off its `AbilityDef` (TT1) — no
 * game logic, just a formatting of the character JSON the hover panel prints.
 */
export function abilityTooltip(def: AbilityDef): string[] {
  const lines = [`${def.name} — ${def.phase} · ${def.shape}`];
  const reach = [`range ${def.range}`];
  if (def.radius !== undefined) reach.push(`radius ${def.radius}`);
  lines.push(reach.join(' · '));
  const econ = [`cooldown ${def.cooldown}`, `energy +${def.energyGain}`];
  if (def.delayTurns !== undefined) econ.push(`delay ${def.delayTurns}t`);
  lines.push(econ.join(' · '));
  // AUTO-PREVIEW: the numeric tell, above the raw effect list. It is the line
  // that says where an ability pays *differently* — an axis bonus, a core/ring
  // split, a heal riding a damage line — which the effect dump cannot, because
  // those differences live on the ability rather than in one effect.
  const tell = damageTell(def);
  if (tell !== '') lines.push(tell);
  if (def.effects.length > 0) lines.push(def.effects.map(effectLabel).join(', '));
  lines.push(def.description);
  return lines;
}

/** Is this a free action — additive, its own slot, never the turn's ability? */
export const isFreeAbility = (ability: AbilityDef): boolean => ability.free === true;

/** Resolve a draft's FREE ability id against the character (FREE-UI). */
export function draftFreeAbility(character: CharacterDef, draft: OrderDraft): AbilityDef | undefined {
  if (draft.freeAbilityId === undefined) return undefined;
  return findAbility({ [character.id]: character }, character.id, draft.freeAbilityId)?.def;
}

/** Shapes that can be freely rotated by a drag (AIM2). */
export const isRotatable = (ability: AbilityDef): boolean => ability.shape === 'line' || ability.shape === 'cone';

/**
 * Turn a pointer drag (in board squares, or any consistent units) into the
 * quantized aim step the engine consumes. The conversion is the engine's own
 * integer projection, so the client and engine can never disagree about which
 * direction a drag meant — and the client needs no trig either (AIM2).
 */
export function dragToAimStep(from: Vec2, to: Vec2): number {
  return vectorToStep(to.x - from.x, to.y - from.y);
}

/**
 * Is `sprint` currently selectable? Only when no ability is chosen
 * (GAME_SPEC §2) — and, since CAT-DASH-COST, only when no **Dash catalyst** is
 * armed either, because a Dash catalyst now spends the Move rather than riding
 * alongside it. A free *ability* still never blocks it (FREE1), and neither
 * does a Prep or Blast catalyst.
 *
 * `dashCatalystArmed` is passed in rather than read off the draft because a
 * draft stores ids, and only the caller holds the catalyst pool that says which
 * phase an id belongs to.
 */
export function sprintAllowed(draft: OrderDraft, dashCatalystArmed = false): boolean {
  return draft.abilityId === undefined && !dashCatalystArmed;
}

/**
 * CHASE-SPRINT — will this chase order run at sprint budget?
 *
 * The engine derives a chase's budget rather than reading `order.sprint`,
 * because a chase's route is picked at the end of Move and there is nothing for
 * a player to opt into at plan time. The client therefore cannot ask the draft
 * either: it has to apply the **same condition** the engine applies, or the
 * drawn route will promise a distance the resolution does not deliver.
 *
 * That condition is `sprintAllowed`'s — no normal ability, no Dash catalyst — so
 * this is deliberately a thin alias rather than a second rule. It exists to be
 * named and tested, not to decide anything new.
 */
export function chaseSprints(draft: OrderDraft, dashCatalystArmed = false): boolean {
  return sprintAllowed(draft, dashCatalystArmed);
}

/**
 * Is the ability hotbar usable at all right now? (CAT-DASH-FULL.)
 *
 * A Dash catalyst is the unit's whole active turn, so the hotbar goes dark with
 * Move and Sprint. Free abilities are exempt — they are a separate free action
 * and the ruling leaves them alone — so the caller applies this to the normal
 * slots only.
 */
export const abilitiesAllowed = (dashCatalystArmed: boolean): boolean => !dashCatalystArmed;

/**
 * Resolve a draft's ability id against the character (ult included).
 *
 * **And its mode** (BASIC-MODES): this is the client's mirror of the engine's
 * single funnel in `planAbility`, and it uses the engine's own `abilityProfile`
 * rather than a second overlay. That is what makes the preview the truth — a
 * client that merged the profile its own way could draw a cone the server
 * resolves as a line, which is the one class of bug a preview must not have.
 */
export function draftAbility(character: CharacterDef, draft: OrderDraft): AbilityDef | undefined {
  if (draft.abilityId === undefined) return undefined;
  const found = findAbility({ [character.id]: character }, character.id, draft.abilityId)?.def;
  return found === undefined ? undefined : abilityProfile(found, draft.mode);
}

/**
 * The two profiles of the armed ability, as a toggle would offer them — or an
 * empty list when the ability has none, which is the signal to draw no toggle.
 *
 * Labels fall back to the ability's own name, so a mode that did not bother
 * naming itself is still a button with words on it.
 */
export function modeOptions(ability: AbilityDef | undefined, chosen: number | undefined): ModeOption[] {
  if (ability?.modes === undefined) return [];
  return ability.modes.map((profile, index) => ({
    index,
    label: profile.name ?? `${ability.name} ${index + 1}`,
    selected: index === (chosen ?? DEFAULT_MODE),
  }));
}

/**
 * Which mode an ability is aimed with when the draft has not said.
 *
 * Zero, and stated as a constant rather than left implicit: the engine treats an
 * absent mode as the ability's own profile, and the client shows mode 0 as
 * selected, so the two agree only if the data's first mode *is* the ability's
 * own profile. That is a rule about content, and `validateCharacter` is where it
 * would be enforced if it ever needs to be — recorded here because the toggle's
 * initial highlight depends on it.
 */
export const DEFAULT_MODE = 0;

/** One profile of a two-mode ability, as the hotbar offers it. */
export interface ModeOption {
  index: number;
  label: string;
  selected: boolean;
}

/** Is an ability's aim geometrically legal (mirrors the engine's `aimIsLegal`)? */
export function aimLegal(unit: UnitState, ability: AbilityDef, aim: readonly Vec2[], aimStep?: number): boolean {
  const target = aim[0];
  switch (ability.shape) {
    case 'self':
      return true;
    case 'square':
    case 'circle':
      return target !== undefined && aimInRange(unit.pos, target, ability.range);
    case 'line':
    case 'cone':
      // A quantized step is a direction on its own — no target square needed (AIM2).
      if (isAimStep(aimStep)) return true;
      return target !== undefined && !(target.x === unit.pos.x && target.y === unit.pos.y);
    case 'path':
      return aim.length > 0 && aim.length <= ability.range;
  }
}

/**
 * Squares an ability's current aim would affect — exactly what the engine will
 * hit (`expandShape`). Empty when the aim is not yet legal, so the UI shows a
 * preview only for a valid aim.
 */
export function abilityPreview(map: MapDef, unit: UnitState, ability: AbilityDef, aim: readonly Vec2[], aimStep?: number): Vec2[] {
  if (!aimLegal(unit, ability, aim, aimStep)) return [];
  // Same call the engine makes, same step — so the preview is exactly the tile
  // set that will be hit, rotation included.
  return expandShape(buildBoard(map), ability, unit.pos, aim, aimStep);
}

/**
 * AUTO-PREVIEW — the subset of an aim's tiles that hits **harder** than the rest.
 *
 * Owner Dev Note: *"new auto attacks need new visual indicators in preview and
 * numerical descriptions for the damage differences."* Three of the reworked
 * basics changed their *footprint*, which `abilityPreview` already draws
 * correctly because it is `expandShape` — but two of them changed their
 * *interior*: Bastion's Crushing Slam pays a bonus along the cone's axis
 * (BASIC-AXIS) and Cinder's Ember Bolt pays a different number in the circle's
 * core (BASIC-INNER). Both were invisible, so the ability read as one flat
 * number over one flat shape.
 *
 * Engine-derived, never re-computed: `axisSquares` and `innerSquares` are the
 * same functions the resolver uses to decide which tiles take the different
 * amount, so the band drawn is exactly the band paid. A client that measured
 * "which tiles look like they are on the axis" would be a second geometry to
 * drift from the first.
 *
 * Empty for every ability without one of the two knobs, which is most of them.
 */
export function previewBands(
  map: MapDef,
  unit: UnitState,
  ability: AbilityDef,
  aim: readonly Vec2[],
  aimStep?: number,
): Vec2[] {
  if (!aimLegal(unit, ability, aim, aimStep)) return [];
  const board = buildBoard(map);
  return [
    ...axisSquares(board, ability, unit.pos, aim, aimStep),
    ...innerSquares(board, ability, aim),
  ];
}

/**
 * AUTO-PREVIEW — the one-line numeric tell for what an ability does, and where
 * it does something different.
 *
 * The second half of the Dev Note: *"numerical descriptions for the damage
 * differences."* A footprint says where; this says how much, and it is the only
 * place the *differences* are written down — an axis bonus, a core-versus-ring
 * split, a line that heals allies while it damages enemies (FF1 polarity, which
 * is why those two numbers cover the same tiles and cannot be told apart by
 * colour).
 *
 * Read entirely off the `AbilityDef`, so a Designer edit to a number or a knob
 * shows up here with no client change. Ordered damage-first because that is the
 * number a player checks against an enemy's HP.
 */
export function damageTell(def: AbilityDef): string {
  const parts: string[] = [];
  const amount = (kind: AbilityEffect['kind']): AbilityEffect | undefined =>
    def.effects.find((e) => e.kind === kind);
  const damage = amount('damage')?.amount;
  if (damage !== undefined) {
    // BASIC-INNER reads as a split rather than a base, because the core number
    // *replaces* the ring's — "22 core / 14 ring", not "14 and sometimes 22".
    if (def.innerAmount !== undefined) parts.push(`${def.innerAmount} core / ${damage} ring`);
    else parts.push(`${damage} dmg`);
    // BASIC-AXIS is genuinely additive, so it reads as a bonus on top.
    if (def.axisBonus !== undefined) parts.push(`+${def.axisBonus} on the axis`);
  }
  // PREVIEW-AUDIT — BASIC-BEAM. A `beamWidth` cone is a **constant-width lane**,
  // not the widening wedge every other cone draws, and the footprint is the only
  // place that showed: Aegis's Shield Bash read as a plain "20 dmg", which is
  // the "does not have anything special about it" the owner reported. Named
  // here because a shape is a thing you can say out loud.
  if (def.beamWidth !== undefined) parts.push(`${def.beamWidth}-wide lane`);
  // PREVIEW-AUDIT — DOT-HOT. A burn is damage the ability deals; leaving it out
  // made Solar Flare read as "30 dmg" when it is 30 and then 8 twice, which is
  // the wrong number for the only question the tell exists to answer.
  const burn = amount('damageOverTime');
  if (burn?.amount !== undefined) parts.push(`${burn.amount} burn ×${burn.duration ?? 1}`);
  const heal = amount('heal')?.amount;
  if (heal !== undefined) parts.push(`+${heal} heal to allies`);
  const regen = amount('healOverTime');
  if (regen?.amount !== undefined) parts.push(`+${regen.amount} regen ×${regen.duration ?? 1}`);
  const shield = amount('shield')?.amount;
  if (shield !== undefined) parts.push(`+${shield} shield`);
  // PREVIEW-AUDIT — the trap a shot leaves behind. Snare Bloom and Overwatch
  // Trap had **no tell at all** while burying a 12- and a 20-damage mine, and
  // Barbed Sling's said 15 while also seeding an 8. A preview that shows nothing
  // for an ability that does something is the worst reading of the three.
  const trap = amount('trap');
  if (trap?.amount !== undefined) parts.push(`${trap.amount} mine`);
  return parts.join(' · ');
}

/**
 * DASH-PREVIEW — the impact disc(s) a dash carrying `impact` would detonate.
 *
 * "Shadowstep Strike needs to show what boxes are being hit, not just the box of
 * arrival." DASH-IMPACT shipped the mechanic without the preview, so a dash with
 * a destination blast looked exactly like a dash that only moves you.
 *
 * Deliberately **not** folded into `expandShape`'s `a.area`. That field means
 * "the aimed area" at plan time, but the engine detonates from the square the
 * dasher actually comes to rest on — a charge stopped short blasts where it
 * stopped. Merging the two would make one of them lie. This is a plan-time
 * estimate at the *aimed* landing square, and resolution playback still shows
 * the true detonation.
 *
 * `origin` is the takeoff disc (Ravok's Bullrush shoves off the square it left),
 * `destination` the landing disc. Either is empty when the ability declares no
 * radius for it, so a dash with no `impact` previews nothing new.
 */
export interface ImpactPreview {
  origin: Vec2[];
  destination: Vec2[];
}

export function impactPreview(
  map: MapDef,
  unit: UnitState,
  ability: AbilityDef | undefined,
  aim: readonly Vec2[],
  aimStep?: number,
): ImpactPreview {
  const none: ImpactPreview = { origin: [], destination: [] };
  if (ability?.impact === undefined || ability.phase !== 'dash') return none;
  if (!aimLegal(unit, ability, aim, aimStep)) return none;
  // Where the dash is *aimed* to end: the last square of a charge's route, or
  // the teleport's target. `dashRoute` already makes that one decision.
  const route = dashRoute(unit, ability, aim);
  const landing = route[route.length - 1];
  if (landing === undefined) return none;

  const board = buildBoard(map);
  const disc = (centre: Vec2, radius: number | undefined): Vec2[] =>
    radius === undefined || radius < 1 ? [] : circleSquares(board, centre, radius);
  return {
    origin: disc(unit.pos, ability.impact.origin),
    destination: disc(landing, ability.impact.destination),
  };
}

/**
 * The **effective-range envelope**: every square this ability could be aimed at
 * or reach, before you have aimed it (UI1).
 *
 * This is a different question from `abilityPreview`, which answers "what does
 * *this* aim cover". A player deciding whether an ability is worth selecting
 * needs the first question answered on hover — "can I even reach them?" — and
 * the shape's footprint tells them nothing about that.
 *
 * The rules are the engine's own, not a client approximation:
 * - `path` (dashes/charges) — `range` is a **movement-cost budget** (MET1), so
 *   the envelope is `reachableSquares`, walls and units accounted for.
 * - everything else — `range` is a **Euclidean** radius (AIM-METRIC), so the
 *   envelope is the disc `aimInRange` accepts. Wall squares stay in: the engine
 *   lets you aim at one (a circle centred on a wall still catches its
 *   neighbours), and an envelope that quietly disagreed with legality would be
 *   a lie. It reads the engine's predicate, so the disc arrives for free.
 * - `self` — the caster's own square, which is exactly where it lands.
 */
export function rangeEnvelope(map: MapDef, state: GameState, unit: UnitState, ability: AbilityDef): Vec2[] {
  if (ability.shape === 'self') return [{ ...unit.pos }];
  if (ability.shape === 'path') {
    const board = buildBoard(map);
    return reachableSquares(board, state, unit, ability.range).map((s) => ({ ...s.pos }));
  }
  const out: Vec2[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const p = { x, y };
      if (aimInRange(unit.pos, p, ability.range)) out.push(p);
    }
  }
  return out;
}

/** The move/sprint equivalent of `rangeEnvelope` — where this unit could go. */
export function moveEnvelope(map: MapDef, state: GameState, unit: UnitState, sprint: boolean): Vec2[] {
  const { stops, through } = movePreview(map, state, unit, sprint);
  return [...stops, ...through];
}

export interface MovePreview {
  /** Legal destinations (BFS squares the unit may stop on). */
  stops: Vec2[];
  /** Ally squares walked *through* but not valid endpoints (edge-cases). */
  through: Vec2[];
}

/**
 * Reachable squares for a move/sprint, split into legal stops and walk-through
 * ally squares. A path through a *stationary* ally may halt early at
 * resolution (edge-cases) — the UI should hint that, but planning treats allies
 * as pass-through.
 */
export function movePreview(map: MapDef, state: GameState, unit: UnitState, sprint: boolean): MovePreview {
  const board = buildBoard(map);
  const squares = reachableSquares(board, state, unit, movementBudget(unit, sprint));
  const stops: Vec2[] = [];
  const through: Vec2[] = [];
  for (const s of squares) (s.canStop ? stops : through).push(s.pos);
  return { stops, through };
}

/**
 * A legal path from `unit` toward `target` within `budget` movement cost.
 *
 * **Clicking somewhere you cannot end never does nothing (MOVE1).** You may not
 * *stop* on an occupied square, and you may not reach past your budget or
 * through a wall — but silently dropping the whole move reads as "the game
 * ignored me", which is what the owner hit when clicking a teammate's tile.
 * Instead the unit goes **as far as legally possible toward** the click.
 *
 * Two distinct failures both land here: an occupied target is *reachable* and so
 * yields a path that ends where the unit may not stop (the engine then rejects
 * the whole order), while an unreachable target yields no path at all. Both
 * become "walk toward it".
 *
 * The engine rule is untouched — this is the client picking a legal destination.
 */
export function pathTo(map: MapDef, state: GameState, unit: UnitState, target: Vec2, budget: number): Vec2[] {
  // Clicking your own square is a deliberate hold, not a failed move.
  if (target.x === unit.pos.x && target.y === unit.pos.y) return [];

  const board = buildBoard(map);
  const squares = reachableSquares(board, state, unit, budget);
  const exact = squares.find((s) => s.pos.x === target.x && s.pos.y === target.y);
  const destination = exact?.canStop === true ? target : nearestLegalStop(squares, target)?.pos;
  if (destination === undefined) return []; // boxed in — there is nowhere legal to go
  return reconstructPath(squares, unit.pos, destination) ?? [];
}

/**
 * WAYPOINTS — what a hand-built path has cost so far (MET1: 1 orthogonal, 2
 * diagonal).
 *
 * `stepCost` is the engine's own, not a copy: the budget a player watches draw
 * down has to be the budget `validateMovePath` will charge them, or the readout
 * is a lie that only shows up when the order is refused.
 */
export function pathSpend(origin: Vec2, path: readonly Vec2[]): number {
  let spent = 0;
  let prev = origin;
  for (const p of path) {
    spent += stepCost(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return spent;
}

/**
 * WAYPOINT-DASH-CLEAR — the waypoint marks that still mean something.
 *
 * A mark records a square the player *clicked* while composing a move. It is
 * only meaningful while the route it belongs to is still the route: `nextDraft`
 * already drops `movePath` the moment a dash (or a Dash catalyst) is armed,
 * because **a dash IS the movement** — so marks left over from the discarded
 * route would draw a path the turn will not walk, and would reappear beside a
 * fresh one if the player armed Move again.
 *
 * Filtering rather than remembering to clear: the marks are derived from the
 * path on every render, so there is no second piece of state to keep in step and
 * no code path that can forget. A cleared route yields no marks by arithmetic.
 */
export function liveWaypointMarks(marks: readonly Vec2[], movePath: readonly Vec2[]): Vec2[] {
  if (movePath.length === 0) return [];
  const onPath = new Set(movePath.map((p) => `${p.x},${p.y}`));
  return marks.filter((m) => onPath.has(`${m.x},${m.y}`)).map((m) => ({ x: m.x, y: m.y }));
}

/** Movement left after walking `path` — the number the Move button shows. */
export function remainingMove(unit: UnitState, sprint: boolean, path: readonly Vec2[]): number {
  return Math.max(0, movementBudget(unit, sprint) - pathSpend(unit.pos, path));
}

/**
 * WAYPOINTS — append one clicked square to a hand-built path, or refuse it.
 *
 * Owner Dev Note: *"You should be able to manually set different waypoints to
 * move your unit around an enemy, a trap, or any obstacle … Hold down the Shift
 * key while executing a movement command on each tile you want to step on
 * sequentially … Every time you click on a tile, your effective movement range
 * should change."*
 *
 * **The engine imposes nothing new** (ruled): `validateMovePath` already walks
 * an arbitrary ordered step list and `runMove` walks a given `movePath`
 * verbatim, so a hand-built path is an ordinary `movePath`. This function is the
 * whole feature, and it delegates the legality question straight back to the
 * engine rather than re-implementing adjacency, terrain, the diagonal-corner
 * rule or the budget — a second copy of those is a second copy to keep in step.
 *
 * One click is **one adjacent step** (ruled, v1): a non-adjacent click is
 * refused rather than auto-connected, which is what keeps "tile-by-tile"
 * literal. Refusal is `undefined`, so a caller cannot mistake it for a path.
 *
 * The one engine verdict deliberately **not** treated as a refusal is
 * `occupied`, which is about where a path *ends* rather than whether a step is
 * legal. A player routing around a body naturally clicks past it; refusing the
 * intermediate click would make the exact manoeuvre the note asks for
 * impossible. Whether the finished path ends somewhere legal is settled when the
 * order is submitted — by the engine, as it always was.
 *
 * MOVE-FOG still holds, and holds *here* by not being this function's business:
 * callers pass the `planningState` they already use for `pathTo`, so a fogged
 * enemy is not on the board this validates against and cannot be felt as an
 * obstacle.
 */
export function appendWaypoint(
  map: MapDef,
  state: GameState,
  unit: UnitState,
  path: readonly Vec2[],
  square: Vec2,
  sprint: boolean,
): Vec2[] | undefined {
  const previous = path.at(-1) ?? unit.pos;
  if (vecEq(previous, square)) return undefined; // clicking where you already are
  const candidate = [...path.map((p) => ({ x: p.x, y: p.y })), { x: square.x, y: square.y }];
  const check = validateMovePath(buildBoard(map), state, unit, candidate, sprint);
  if (!check.valid && check.error.code !== 'occupied') return undefined;
  return candidate;
}

/**
 * WAYPOINTS-FIX — drop a waypoint at **any** clicked tile and route the segment
 * to it.
 *
 * Owner Dev Note: *"WAYPOINTS is not working. I cannot hold shift + click to
 * move to a waypoint."*
 *
 * The v1 above takes **one adjacent step per click** and answers a bare
 * `undefined` to anything else, so the natural gesture — select a unit,
 * Shift-click a tile a few squares away — produced nothing at all. The ruling
 * reverses that (edge-cases, "WAYPOINTS-FIX"): a click lands a waypoint
 * wherever it points, and the client **routes** from the previous waypoint (or
 * the unit's own square) to it.
 *
 * The router is `pathTo` — the same one a plain move click uses — so a segment
 * goes around walls and bodies exactly as the auto-route does, honours MOVE1's
 * nearest-legal forgiveness, and inherits MOVE-FOG for free (the caller hands in
 * the `planningState` it already built, so a fogged enemy is not on the board
 * this walks). What changes per segment is only *where you start* and *how much
 * budget is left*: the unit is re-based on the last waypoint, and the budget is
 * what the earlier segments did not spend.
 *
 * **An adjacent click is just a one-step segment**, so the tile-by-tile control
 * v1 offered survives intact — drop a waypoint on each corner and you have
 * threaded the obstacle by hand.
 *
 * `undefined` means "nothing legal to append", which is the caller's cue to show
 * the refusal tell rather than to do nothing quietly.
 */
export function appendWaypointRouted(
  map: MapDef,
  state: GameState,
  unit: UnitState,
  path: readonly Vec2[],
  square: Vec2,
  sprint: boolean,
): Vec2[] | undefined {
  const from = path.at(-1) ?? unit.pos;
  if (vecEq(from, square)) return undefined; // the waypoint you are already on
  const left = remainingMove(unit, sprint, path);
  if (left <= 0) return undefined;
  // Re-based on the last waypoint: the segment starts where the drawn route
  // has got to, not where the unit is still standing. `pathTo` excludes the
  // unit itself from the obstacles, which is right — it is vacating anyway.
  const segment = pathTo(map, state, { ...unit, pos: from }, square, left);
  if (segment.length === 0) return undefined;
  return [...path.map((p) => ({ x: p.x, y: p.y })), ...segment];
}

/**
 * The strict resolver: the clicked square's own path, or nothing.
 *
 * **Dash aims use this, not `pathTo`.** MOVE1's forgiving re-route is a ruling
 * about the *move* command; a dash is an ability, and walking a charge to a
 * different square than the player clicked would silently change who it rams.
 * An unreachable dash target therefore still previews as illegal — which is the
 * honest answer — rather than quietly becoming a shorter charge.
 */
export function pathToExact(map: MapDef, state: GameState, unit: UnitState, target: Vec2, budget: number): Vec2[] {
  const board = buildBoard(map);
  return reconstructPath(reachableSquares(board, state, unit, budget), unit.pos, target) ?? [];
}

/**
 * The reachable square a unit should settle for when the clicked one is not a
 * legal stop: closest to the target, then cheapest, then a fixed scan order.
 *
 * All three keys are needed for determinism. Distance alone ties constantly on a
 * grid; cost breaks most of those and prefers not overshooting; the final
 * `(y, x)` comparison makes the answer independent of the order
 * `reachableSquares` happens to return, so a future BFS change cannot silently
 * move where players end up.
 */
function nearestLegalStop(squares: readonly ReachableSquare[], target: Vec2): ReachableSquare | undefined {
  let best: ReachableSquare | undefined;
  for (const square of squares) {
    if (!square.canStop) continue;
    if (best === undefined || rank(square, target) < rank(best, target)) best = square;
  }
  return best;
}

/** Lexicographic (distance, cost, y, x) packed into one comparable number. */
function rank(square: ReachableSquare, target: Vec2): number {
  // Grid coordinates and costs are small integers, so packing is exact; the
  // widths are generous enough that no field can bleed into the next.
  return ((distance(square.pos, target) * 1024 + square.cost) * 1024 + square.pos.y) * 1024 + square.pos.x;
}

/**
 * Resolve "the player pointed at this square" into the aim an order carries —
 * the single place that decision is made, so hover-preview and click-to-commit
 * can never disagree about what a square means for a given shape (UI1).
 *
 * `line`/`cone` become a quantized direction (AIM2) with no target square;
 * `path` becomes a walked route; everything else is just the square.
 */
export function aimFor(
  map: MapDef,
  state: GameState,
  unit: UnitState,
  ability: AbilityDef,
  target: Vec2,
): { aim: Vec2[]; aimStep?: number } {
  switch (ability.shape) {
    case 'self':
      return { aim: [{ ...unit.pos }] };
    case 'line':
    case 'cone':
      return { aim: [], aimStep: dragToAimStep(unit.pos, target) };
    case 'path':
      return { aim: pathToExact(map, state, unit, target, ability.range) };
    case 'circle':
    case 'square':
      return { aim: [{ ...target }] };
  }
}

/**
 * What a catalyst costs to use (CAT-COST-LABEL).
 *
 * One place, because two parts of the client act on it: the HUD tag a player
 * reads before spending the slot, and the draft rules that clear the move when a
 * Dash catalyst is armed. Those disagreeing would be worse than either being
 * wrong — the label would promise something the reducer then took away.
 *
 * `'action'` is CAT-DASH-FULL: a Dash catalyst is the unit's **whole active
 * turn** — no ability, no Move, no Sprint. (It was `'move'` under CAT-DASH-COST,
 * which priced only the movement; the owner ruled that too cheap.) Prep and
 * Blast catalysts never touched either, so they stayed free.
 */
export type CatalystCost = 'free' | 'action';

export const catalystCost = (def: AbilityDef): CatalystCost =>
  (def.phase === 'dash' ? 'action' : 'free');

/**
 * AIM-RANGE — the aim a board click should **commit**, or `undefined` when the
 * click is not a legal aim for this ability.
 *
 * The engine has always enforced range (`aimIsLegal` → `aimInRange`) and simply
 * dropped an out-of-range order. The client never asked, so `square`/`circle`
 * abilities — Blink, Intercept, a lobbed grenade — accepted any click anywhere,
 * committed it, showed it as ordered, and then did nothing at resolution. That
 * reads as "the skill works wherever I click, but sometimes it just fails",
 * which is a far worse bug than "the skill refused the click".
 *
 * One gate for every slot, so the normal ability, the free ability and the
 * catalyst cannot drift apart — and it is the *engine's* rule via `aimLegal`,
 * not a second copy of the range maths. A `path` dash already behaved this way
 * (`pathToExact` yields an empty route for an unreachable target); this makes
 * every other shape agree.
 */
export function commitAim(
  map: MapDef,
  state: GameState,
  unit: UnitState,
  ability: AbilityDef,
  target: Vec2,
): { aim: Vec2[]; aimStep?: number } | undefined {
  // DASH-OCCUPIED (4): a `line`/`cone` click on your own square is a no-op.
  // `dragToAimStep(pos, pos)` quantizes (0,0) to step 0, which `isAimStep`
  // accepts — so clicking yourself used to commit an eastward shot you never
  // asked for. There is no direction in a zero-length drag; refuse it.
  const directional = ability.shape === 'line' || ability.shape === 'cone';
  if (directional && vecEq(target, unit.pos)) return undefined;

  // BLINK-ADJ removed the veto that used to sit here. A teleporting dash aimed
  // at an occupied square no longer fizzles at resolution — it lands on the
  // nearest legal square — so refusing the click would now block an order the
  // engine will happily carry out, which is the same bug in the other
  // direction. `isBlockedDashLanding` survives as the *tell* the preview draws
  // (the landing will not be exactly here), not as a gate.

  const resolved = aimFor(map, state, unit, ability, target);
  return aimLegal(unit, ability, resolved.aim, resolved.aimStep) ? resolved : undefined;
}

/**
 * Would this dash be aimed at a square a living character already holds, with no
 * knockback of its own to clear it?
 *
 * Since BLINK-ADJ this is **not** a reason to refuse the order — the engine
 * lands the blink on the nearest legal square instead of fizzling. It is kept
 * because it is exactly the condition under which the drawn landing marker and
 * the real one differ, which is a thing worth telling the player.
 *
 * Teleporting dashes only. A `path` charge is *allowed* to be drawn through and
 * at bodies — it rests on the furthest free square — so it was never in scope.
 */
export function isBlockedDashLanding(
  state: GameState,
  unit: UnitState,
  ability: AbilityDef,
  target: Vec2,
): boolean {
  const teleporting = ability.effects.some((e) => e.kind === 'teleport');
  if (!teleporting || ability.shape === 'path') return false;
  if (ability.effects.some((e) => e.kind === 'knockback')) return false; // it clears its own way
  return state.units.some((u) => u.alive && u.unitId !== unit.unitId && vecEq(u.pos, target));
}

/**
 * The squares a drafted **dash** travels through (UI4), so it can be drawn with
 * the same line-and-marker indicator a move gets — a dash is still a route, and
 * the owner asked for the same indicator in yellow rather than for nothing.
 *
 * A `path` dash carries its whole route in the aim. A teleporting dash carries
 * only a destination, and a straight segment to it is still the honest
 * statement: you end up there. Empty only when no dash is drafted, which is the
 * one case where the line should be suppressed.
 */
export function dashRoute(unit: UnitState, ability: AbilityDef | undefined, aim: readonly Vec2[]): Vec2[] {
  if (ability === undefined || ability.phase !== 'dash') return [];
  if (ability.shape === 'path') return aim.map((p) => ({ ...p }));
  const target = aim[0];
  if (target === undefined) return [];
  // A dash aimed at your own square is a hold, not a route.
  return target.x === unit.pos.x && target.y === unit.pos.y ? [] : [{ ...target }];
}

/**
 * A closed polygon in **board coordinates** (fractional squares) outlining the
 * continuous geometric shape an ability projects — UI2's Layer 1.
 *
 * Layer 2 is the truth (`expandShape`'s tiles, binary). Layer 1 is the fiction:
 * the smooth cone/beam/disk the tiles approximate. Drawing only the tiles makes
 * a clipped corner read as a bug; drawing only the shape hides which squares
 * actually take the hit. So both, and **from the same numbers** — every
 * dimension below is the engine's own rule, not an eyeballed silhouette.
 *
 * Under HITBOX1 a tile is covered when the ability's area comes within half a
 * tile of its centre, so each outline is that area pushed out by half a tile —
 * which makes Layer 1 exactly the boundary Layer 2 is testing against:
 *
 * - a **line** is a ray `range` **tile-widths** along its axis (AIM-METRIC), so
 *   the beam draws as a band half a tile to each side of it. The far end is a
 *   plain step along the unit axis — `alongAxis`'s dominant-axis metering is
 *   what used to make a diagonal beam 41% too long.
 * - a **cone** is a 45° wedge from the caster, `range` **tiles** deep (CONE-B —
 *   a distance, not a tile count, which is what stops a rotated cone growing).
 *   Pushing its edges out half a tile widens each row by 0.71 (½ / cos 45°) and
 *   pulls the drawn apex that far back behind the caster.
 * - a **circle** reaches exactly its authored `radius` (CIRCLE-FIX), so `r + 0.5`
 *   is the outer edge of the outermost covered tile — the tile whose centre sits
 *   exactly `r` out.
 *
 * `path` and `self` return no outline: a route already draws as a line (AIM1),
 * and a self-cast has no projected shape.
 */
export function shapeOutline(
  unit: UnitState,
  ability: AbilityDef,
  aim: readonly Vec2[],
  aimStep: number | undefined,
  covered: readonly Vec2[],
): Vec2[] {
  const from = unit.pos;
  const target = aim[0];
  const dir = directionOf(from, ability, aim, aimStep);
  // A directional shape is truncated to what it ACTUALLY reached. `lineSquares`
  // stops at the first wall, so an untruncated beam would carry on through it —
  // which reads as "the shot goes through walls", the exact disagreement between
  // the two layers this item exists to prevent. A disk is different: the engine
  // drops wall tiles from it without shortening it, so the disk stays whole and
  // the missing tiles beneath it are the point.
  // Nothing covered means nothing to outline. Asking "is the reach at least a
  // tile" instead would be wrong now that reach is a projected distance: a beam
  // that covers exactly one tile can project to 0.9995 of a tile-width.
  const reach = dir === undefined ? 0 : Math.min(ability.range, depthReached(from, dir, covered));

  switch (ability.shape) {
    case 'square':
      return target === undefined ? [] : tileOutline(target);
    case 'circle':
      return target === undefined ? [] : diskOutline(target, (ability.radius ?? 1) + HALF_TILE);
    case 'line': {
      if (dir === undefined || covered.length === 0) return [];
      // The far end reaches the OUTER EDGE of the last covered tile, not its
      // centre — a beam that stopped at the centre would leave the tile it hits
      // half outside the shape that is supposed to explain it.
      const axis = unitVector(dir);
      const far = reach + HALF_TILE;
      const end = { x: axis.x * far, y: axis.y * far };
      const n = perpUnit(dir);
      // A band, not a hairline: the beam covers the tiles whose centres it runs
      // through, so it is drawn a tile wide.
      return [
        { x: from.x - n.x * HALF_TILE, y: from.y - n.y * HALF_TILE },
        { x: from.x + end.x - n.x * HALF_TILE, y: from.y + end.y - n.y * HALF_TILE },
        { x: from.x + end.x + n.x * HALF_TILE, y: from.y + end.y + n.y * HALF_TILE },
        { x: from.x + n.x * HALF_TILE, y: from.y + n.y * HALF_TILE },
      ];
    }
    case 'cone': {
      if (dir === undefined || covered.length === 0) return [];
      const axis = unitVector(dir);
      const n = perpUnit(dir);
      // The engine's wedge (CONE-B) starts at the caster with 45° edges and is
      // capped `reach` tiles out — all of it measured in **tiles**, which is why
      // the far end is a plain step along the unit axis and not `alongAxis`'s
      // dominant-axis metering. Under HITBOX1 a tile is covered when that wedge
      // comes within half a tile of its centre, so the silhouette is the wedge
      // pushed out by half a tile: sliding a 45° edge sideways by ½ moves it
      // ½/cos 45° = 0.71 across, widening every row by that much and dragging
      // the drawn apex that far back behind the caster.
      const grow = HALF_TILE * Math.SQRT2;
      const apex = { x: from.x - axis.x * grow, y: from.y - axis.y * grow };
      const far = reach + HALF_TILE;
      const half = far + grow;
      return [
        apex,
        { x: from.x + axis.x * far - n.x * half, y: from.y + axis.y * far - n.y * half },
        { x: from.x + axis.x * far + n.x * half, y: from.y + axis.y * far + n.y * half },
      ];
    }
    case 'path':
    case 'self':
      return [];
  }
}

/**
 * How far a directional shape actually got, in **tile-widths along its axis**
 * (AIM-METRIC). Truncation is the only reason to ask: a beam stopped by a wall
 * must not be drawn carrying on through it.
 *
 * Projecting onto the axis is the honest measure now that reach is a distance —
 * `max(|dx|, |dy|)` was right only while depth was metered on the dominant
 * component, and would over-report a rotated shape's reach by up to √2.
 */
function depthReached(from: Vec2, dir: Vec2, covered: readonly Vec2[]): number {
  const len = Math.hypot(dir.x, dir.y);
  if (len === 0) return 0;
  let deepest = 0;
  for (const p of covered) {
    deepest = Math.max(deepest, ((p.x - from.x) * dir.x + (p.y - from.y) * dir.y) / len);
  }
  return deepest;
}

/** Half a board square, in board units — the distance from tile centre to edge. */
const HALF_TILE = 0.5;
/** Segments used to approximate a disk. Enough that the seams do not read. */
const DISK_SEGMENTS = 48;

/**
 * The direction a directional shape points, resolved exactly as the engine
 * resolves it: a quantized step wins, otherwise the caster→target fallback,
 * which differs between line (`direction8`) and cone (`dominantCardinal`).
 */
function directionOf(from: Vec2, ability: AbilityDef, aim: readonly Vec2[], aimStep?: number): Vec2 | undefined {
  if (ability.shape !== 'line' && ability.shape !== 'cone') return undefined;
  if (isAimStep(aimStep)) return stepToVector(aimStep);
  const target = aim[0];
  if (target === undefined) return undefined;
  const v = ability.shape === 'line' ? direction8(from, target) : dominantCardinal(from, target);
  return v.x === 0 && v.y === 0 ? undefined : v;
}

/** `d` tiles along `v`, measured on the dominant axis — the engine's metering. */
function alongAxis(v: Vec2, d: number): Vec2 {
  const m = Math.max(Math.abs(v.x), Math.abs(v.y));
  return m === 0 ? { x: 0, y: 0 } : { x: (d * v.x) / m, y: (d * v.y) / m };
}

/** `v` scaled to length 1 — for the apex offset, where direction alone matters. */
function unitVector(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/** The unit normal to `v` — the width direction of a beam or wedge. */
function perpUnit(v: Vec2): Vec2 {
  const u = unitVector(v);
  return { x: -u.y, y: u.x };
}

/** The four corners of one tile. */
function tileOutline(p: Vec2): Vec2[] {
  return [
    { x: p.x - HALF_TILE, y: p.y - HALF_TILE },
    { x: p.x + HALF_TILE, y: p.y - HALF_TILE },
    { x: p.x + HALF_TILE, y: p.y + HALF_TILE },
    { x: p.x - HALF_TILE, y: p.y + HALF_TILE },
  ];
}

/** A regular polygon standing in for a disk of `radius` around `centre`. */
function diskOutline(centre: Vec2, radius: number): Vec2[] {
  return Array.from({ length: DISK_SEGMENTS }, (_, i) => {
    const a = (i / DISK_SEGMENTS) * Math.PI * 2;
    return { x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius };
  });
}

/** Does this draft carry an actual order, or is the character holding? */
export function draftHasOrder(draft: OrderDraft): boolean {
  return draft.abilityId !== undefined || draft.catalystId !== undefined
    || draft.freeAbilityId !== undefined || draft.sprint || draft.movePath.length > 0;
}

/** Is a drawn move path legal right now (delegates to the engine)? */
export function pathValid(map: MapDef, state: GameState, unit: UnitState, path: readonly Vec2[], sprint: boolean): boolean {
  return validateMovePath(buildBoard(map), state, unit, path, sprint).valid;
}

/**
 * Assemble the engine `UnitOrders` from a draft. Enforces the same shape as the
 * engine's `planUnit`: sprint is dropped when an ability is chosen, and a dash
 * ability's separate move path is dropped (the dash is the movement).
 */
export function toUnitOrders(character: CharacterDef, draft: OrderDraft): UnitOrders {
  const ability = draftAbility(character, draft);
  const order: UnitOrders = { unitId: draft.unitId };
  // A catalyst rides alongside whatever else the turn does — it is additive, so
  // it is written first and never gates any of the branches below (CAT2).
  if (draft.catalystId !== undefined) {
    order.catalyst = { abilityId: draft.catalystId, target: draft.catalystAim.map((p) => ({ x: p.x, y: p.y })) };
  }
  // A free ability rides alongside everything else — it is written before the
  // branches below and gates none of them, which is the whole mechanic.
  if (draft.freeAbilityId !== undefined) {
    order.freeAbility = { abilityId: draft.freeAbilityId, target: draft.freeAim.map((p) => ({ x: p.x, y: p.y })) };
  }
  if (ability !== undefined) {
    order.ability = { abilityId: ability.id, target: draft.aim.map((p) => ({ x: p.x, y: p.y })) };
    // BASIC-MODES: sent only when the ability actually has modes, so an ordinary
    // order stays exactly the bytes it was before this existed.
    if (draft.mode !== undefined && ability.modes !== undefined) order.ability.mode = draft.mode;
    // Only directional shapes rotate; sending a step for a circle would be noise
    // the engine ignores anyway (AIM2).
    if (isRotatable(ability) && isAimStep(draft.aimStep)) order.ability.aimStep = draft.aimStep;
    if (ability.phase !== 'dash') {
      // A dash owns the movement, so neither the walk nor the chase goes out
      // with it — the engine would drop both anyway, and sending them would put
      // a promise in the order that resolution does not keep.
      if (draft.chaseTargetId !== undefined) order.chase = draft.chaseTargetId;
      else if (draft.movePath.length > 0) order.movePath = draft.movePath.map((p) => ({ x: p.x, y: p.y }));
    }
    return order; // sprint dropped: an ability is in play
  }
  if (draft.sprint) order.sprint = true;
  if (draft.chaseTargetId !== undefined) order.chase = draft.chaseTargetId;
  else if (draft.movePath.length > 0) order.movePath = draft.movePath.map((p) => ({ x: p.x, y: p.y }));
  return order;
}

/**
 * The order UI's draft toggle (MS1), as a pure reducer so the mutual-exclusivity
 * is testable without the DOM. A non-dash ability and a move coexist; Sprint and
 * a dash are each exclusive with an ability. `currentIsDash` is whether the
 * draft's *existing* ability is a dash (so `selectMove` knows to replace it).
 */
export type DraftAction =
  | { type: 'selectAbility'; abilityId: string; isDash: boolean }
  // `isDash` mirrors `selectAbility`'s: since CAT-DASH-COST a Dash catalyst
  // spends the Move, so it has the same exclusivity a dash ability does.
  | { type: 'selectCatalyst'; catalystId: string; isDash?: boolean }
  | { type: 'selectFreeAbility'; abilityId: string }
  | { type: 'selectMove' }
  // CHASE1 — picking an enemy to follow. Re-picking the same one deselects, so
  // the Move slot can be handed back without clearing the rest of the turn.
  | { type: 'selectChase'; targetUnitId: string }
  | { type: 'selectSprint' }
  // BASIC-MODES — flip the armed ability's aim-time profile.
  | { type: 'selectMode'; mode: number }
  | { type: 'clear' };

/** Hand a Dash catalyst's slot back when the player chooses to move instead. */
const releaseDashCatalyst = (draft: OrderDraft, isDash: boolean): OrderDraft =>
  isDash ? { ...draft, catalystId: undefined, catalystAim: [] } : draft;

export function nextDraft(
  draft: OrderDraft,
  action: DraftAction,
  currentIsDash: boolean,
  /** Whether the draft's *existing* catalyst is a Dash one (CAT-DASH-COST). */
  currentCatalystIsDash = false,
): OrderDraft {
  switch (action.type) {
    case 'selectMode': {
      // The aim is **cleared**, and that is the point: the two modes have
      // different shapes and different ranges, so a square that was a legal
      // aim for one is very often not one for the other. Keeping it would
      // leave a preview drawn for a target the order would be refused for —
      // the worst of the three outcomes, because it looks like it worked.
      //
      // The move is kept: a mode is a targeting choice, and the walk beside it
      // is a separate decision the player already made (MS1).
      return { ...draft, mode: action.mode, aim: [], aimStep: undefined };
    }
    case 'selectAbility': {
      // Choosing an ability clears sprint and re-aims; a dash owns the movement
      // so it drops any drawn move, a non-dash ability keeps it (move AND shoot).
      //
      // It also hands back an armed Dash catalyst (CAT-DASH-FULL): the two are
      // now bidding for the same turn, so picking one must release the other
      // rather than silently voiding it at resolution.
      const freed = releaseDashCatalyst(draft, currentCatalystIsDash);
      return {
        ...freed, abilityId: action.abilityId, sprint: false, aim: [],
        // BASIC-MODES: a new ability starts on its own default profile. Carrying
        // the last one's mode over would arm mode 1 of an ability the player has
        // never seen a toggle for.
        mode: undefined,
        // A dash owns the movement, and a chase is movement (CHASE1) — so it
        // goes with the drawn path rather than surviving as a dead promise.
        movePath: action.isDash ? [] : freed.movePath,
        chaseTargetId: action.isDash ? undefined : freed.chaseTargetId,
      };
    }
    case 'selectCatalyst':
      // A catalyst is a SEPARATE slot: everything else in the draft survives,
      // including the chosen ability and its aim. Re-picking the same one
      // deselects it, so the slot can be given back without clearing the turn.
      if (draft.catalystId === action.catalystId) return { ...draft, catalystId: undefined, catalystAim: [] };
      return {
        ...draft,
        catalystId: action.catalystId,
        catalystAim: [],
        // The other side of "one free action per turn": a catalyst drops an
        // armed free ability, symmetrically.
        freeAbilityId: undefined,
        freeAim: [],
        // …and a DASH catalyst additionally clears the whole active turn, because
        // it *is* the active turn (CAT-DASH-FULL): the ability, its aim, the
        // drawn move and Sprint all go. Leaving any of them drafted beside it
        // would promise something the engine is going to throw away. Prep and
        // Blast catalysts still change nothing.
        ...(action.isDash === true
          ? { sprint: false, movePath: [], abilityId: undefined, aim: [], aimStep: undefined }
          : {}),
      };
    case 'selectFreeAbility':
      // A separate slot, exactly like a catalyst: the chosen ability, its aim,
      // its rotation and any drawn move all survive. Re-picking deselects.
      // **At most one free action per turn** (edge-cases), counting free
      // abilities and catalysts together — so arming one drops the other rather
      // than sending an order the engine will silently reject half of.
      return draft.freeAbilityId === action.abilityId
        ? { ...draft, freeAbilityId: undefined, freeAim: [] }
        : { ...draft, freeAbilityId: action.abilityId, freeAim: [], catalystId: undefined, catalystAim: [] };
    case 'selectMove': {
      // Choosing to move gives back whatever was holding the Move: a dash
      // ability, or (since CAT-DASH-COST) a Dash catalyst. A non-dash ability
      // keeps its slot — move AND shoot is the point of MS1.
      const freed = releaseDashCatalyst(draft, currentCatalystIsDash);
      // Drawing a path is the other way to spend the Move, so it takes the slot
      // back off a chase (CHASE1).
      return draft.abilityId !== undefined && !currentIsDash
        ? { ...freed, sprint: false, movePath: [], chaseTargetId: undefined }
        : { ...freed, abilityId: undefined, aim: [], sprint: false, movePath: [], chaseTargetId: undefined };
    }
    case 'selectChase': {
      // The Move slot, spent on a unit instead of a square. Re-picking the same
      // target hands it back. A non-dash ability and its aim survive — chase and
      // shoot is move and shoot; a dash ability does not, because the dash and
      // the chase are both the reposition.
      const freed = releaseDashCatalyst(draft, currentCatalystIsDash);
      if (draft.chaseTargetId === action.targetUnitId) return { ...freed, chaseTargetId: undefined };
      const keepsAbility = freed.abilityId !== undefined && !currentIsDash;
      return {
        ...freed,
        chaseTargetId: action.targetUnitId,
        movePath: [],
        sprint: false,
        ...(keepsAbility ? {} : { abilityId: undefined, aim: [], aimStep: undefined }),
      };
    }
    case 'selectSprint':
      // Sprint is move-only (8) and clears any ability. A Prep or Blast catalyst
      // rides along untouched — those never price the turn (FREE1 budget
      // independence) — but a Dash catalyst is given back, because it and Sprint
      // are now bidding for the same Move.
      return {
        ...releaseDashCatalyst(draft, currentCatalystIsDash),
        abilityId: undefined, aim: [], sprint: true, movePath: [], chaseTargetId: undefined,
      };
    case 'clear':
      return emptyDraft(draft.unitId);
  }
}

/** Convenience: build `UnitOrders` for every character a player controls. */
export function toUnitOrdersFor(
  characters: ReadonlyMap<string, CharacterDef>,
  drafts: readonly OrderDraft[],
): UnitOrders[] {
  return drafts.map((d) => {
    const c = characters.get(d.unitId);
    if (c === undefined) throw new Error(`no character for unit ${d.unitId}`);
    return toUnitOrders(c, d);
  });
}

export type { Board };
