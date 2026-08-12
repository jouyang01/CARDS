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
  movementBudget,
  reachableSquares,
  validateMovePath,
  type AbilityDef,
  type Board,
  type CharacterDef,
  type GameState,
  type MapDef,
  type UnitOrders,
  type UnitState,
  type Vec2,
} from '@cards/engine';

/** A character's selection in progress. `abilityId` and `sprint` are exclusive. */
export interface OrderDraft {
  unitId: string;
  /** Chosen ability (its ult included), or undefined for none. */
  abilityId?: string;
  /** Aim squares for the ability (meaning depends on its shape). */
  aim: Vec2[];
  /** Sprint = move-only, longer range. Ignored once an ability is chosen. */
  sprint: boolean;
  /** Move-phase path (dropped when the chosen ability is a dash). */
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
export function aimLegal(unit: UnitState, ability: AbilityDef, aim: readonly Vec2[]): boolean {
  const target = aim[0];
  switch (ability.shape) {
    case 'self':
      return true;
    case 'square':
    case 'circle':
      return target !== undefined && aimInRange(unit.pos, target, ability.range);
    case 'line':
    case 'cone':
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
export function abilityPreview(map: MapDef, unit: UnitState, ability: AbilityDef, aim: readonly Vec2[]): Vec2[] {
  if (!aimLegal(unit, ability, aim)) return [];
  return expandShape(buildBoard(map), ability, unit.pos, aim);
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
    if (ability.phase !== 'dash' && draft.movePath.length > 0) order.movePath = draft.movePath.map((p) => ({ x: p.x, y: p.y }));
    return order; // sprint dropped: an ability is in play
  }
  if (draft.sprint) order.sprint = true;
  if (draft.movePath.length > 0) order.movePath = draft.movePath.map((p) => ({ x: p.x, y: p.y }));
  return order;
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
