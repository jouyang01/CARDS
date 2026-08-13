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
  buildBoard,
  expandShape,
  findAbility,
  isAimStep,
  movementBudget,
  reachableSquares,
  reconstructPath,
  validateMovePath,
  vectorToStep,
  type AbilityDef,
  type AbilityEffect,
  type Board,
  type CharacterDef,
  type GameState,
  type MapDef,
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
  /** Sprint = move-only, longer range. Ignored once an ability is chosen. */
  sprint: boolean;
  /** Move-phase path; coexists with a non-dash ability, dropped for a dash. */
  movePath: Vec2[];
}

/** A blank draft for a unit (holds position until the player chooses). */
export function emptyDraft(unitId: string): OrderDraft {
  return { unitId, aim: [], sprint: false, movePath: [] };
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
  if (def.effects.length > 0) lines.push(def.effects.map(effectLabel).join(', '));
  lines.push(def.description);
  return lines;
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

/** Is `sprint` currently selectable? Only when no ability is chosen (GAME_SPEC §2). */
export function sprintAllowed(draft: OrderDraft): boolean {
  return draft.abilityId === undefined;
}

/** Resolve a draft's ability id against the character (ult included). */
export function draftAbility(character: CharacterDef, draft: OrderDraft): AbilityDef | undefined {
  if (draft.abilityId === undefined) return undefined;
  return findAbility({ [character.id]: character }, character.id, draft.abilityId)?.def;
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
 * - everything else — `range` is a Manhattan radius, so the envelope is the
 *   diamond `aimInRange` accepts. Wall squares stay in: the engine lets you aim
 *   at one (a circle centred on a wall still catches its neighbours), and an
 *   envelope that quietly disagreed with legality would be a lie.
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

/** A legal path from `unit` to `target` within `budget` movement cost, or []. */
export function pathTo(map: MapDef, state: GameState, unit: UnitState, target: Vec2, budget: number): Vec2[] {
  const board = buildBoard(map);
  return reconstructPath(reachableSquares(board, state, unit, budget), unit.pos, target) ?? [];
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
      return { aim: pathTo(map, state, unit, target, ability.range) };
    case 'circle':
    case 'square':
      return { aim: [{ ...target }] };
  }
}

/** Does this draft carry an actual order, or is the character holding? */
export function draftHasOrder(draft: OrderDraft): boolean {
  return draft.abilityId !== undefined || draft.sprint || draft.movePath.length > 0;
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
  if (ability !== undefined) {
    order.ability = { abilityId: ability.id, target: draft.aim.map((p) => ({ x: p.x, y: p.y })) };
    // Only directional shapes rotate; sending a step for a circle would be noise
    // the engine ignores anyway (AIM2).
    if (isRotatable(ability) && isAimStep(draft.aimStep)) order.ability.aimStep = draft.aimStep;
    if (ability.phase !== 'dash' && draft.movePath.length > 0) order.movePath = draft.movePath.map((p) => ({ x: p.x, y: p.y }));
    return order; // sprint dropped: an ability is in play
  }
  if (draft.sprint) order.sprint = true;
  if (draft.movePath.length > 0) order.movePath = draft.movePath.map((p) => ({ x: p.x, y: p.y }));
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
  | { type: 'selectMove' }
  | { type: 'selectSprint' }
  | { type: 'clear' };

export function nextDraft(draft: OrderDraft, action: DraftAction, currentIsDash: boolean): OrderDraft {
  switch (action.type) {
    case 'selectAbility':
      // Choosing an ability clears sprint and re-aims; a dash owns the movement
      // so it drops any drawn move, a non-dash ability keeps it (move AND shoot).
      return { ...draft, abilityId: action.abilityId, sprint: false, aim: [], movePath: action.isDash ? [] : draft.movePath };
    case 'selectMove':
      // "Draw move" keeps a non-dash ability; a dash (or no ability) is replaced.
      return draft.abilityId !== undefined && !currentIsDash
        ? { ...draft, sprint: false, movePath: [] }
        : { ...draft, abilityId: undefined, aim: [], sprint: false, movePath: [] };
    case 'selectSprint':
      // Sprint is move-only (8) and clears any ability.
      return { ...draft, abilityId: undefined, aim: [], sprint: true, movePath: [] };
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
