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
  direction8,
  distance,
  dominantCardinal,
  expandShape,
  findAbility,
  isAimStep,
  stepToVector,
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
 * Layer 2 is the truth (`expandShape`'s tiles, centre-in binary). Layer 1 is the
 * fiction: the smooth cone/beam/disk the tiles approximate. Drawing only the
 * tiles makes a clipped corner read as a bug; drawing only the shape hides which
 * squares actually take the hit. So both, and **from the same numbers** — every
 * dimension below is the engine's own rule, not an eyeballed silhouette:
 *
 * - a **line** reaches `range` tiles along its axis (`alongAxis`), and covers a
 *   tile whose centre is nearest the ray — so the beam is a half-tile-wide band.
 * - a **cone**'s half-width at depth `d` is `d − 1` tiles, i.e. `d − 0.5` from
 *   centre to outer tile edge. That line hits zero at `d = 0.5`, so the true
 *   apex sits half a tile in front of the caster. Not an approximation — it is
 *   where the engine's own widening rule starts.
 * - a **circle** is `dx² + dy² ≤ r²`, a genuine disk; `r + 0.5` reaches the
 *   outer edge of the last covered tile.
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
  const reach = Math.min(ability.range, depthReached(from, covered));

  switch (ability.shape) {
    case 'square':
      return target === undefined ? [] : tileOutline(target);
    case 'circle':
      return target === undefined ? [] : diskOutline(target, (ability.radius ?? 1) + HALF_TILE);
    case 'line': {
      if (dir === undefined || reach < 1) return [];
      // The far end reaches the OUTER EDGE of the last covered tile, not its
      // centre — a beam that stopped at the centre would leave the tile it hits
      // half outside the shape that is supposed to explain it.
      const end = alongAxis(dir, reach + HALF_TILE);
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
      if (dir === undefined || reach < 1) return [];
      const axis = unitVector(dir);
      const n = perpUnit(dir);
      // Half-width grows as `d − 0.5` (the engine's `d − 1` tiles, plus the half
      // tile out to the edge), so the wedge is the exact triangle through
      // (0.5, 0) and (range + 0.5, range): apex half a tile ahead of the
      // caster, far edge past the last covered row.
      const apex = { x: from.x + axis.x * HALF_TILE, y: from.y + axis.y * HALF_TILE };
      const far = alongAxis(dir, reach + HALF_TILE);
      const half = reach;
      return [
        apex,
        { x: from.x + far.x - n.x * half, y: from.y + far.y - n.y * half },
        { x: from.x + far.x + n.x * half, y: from.y + far.y + n.y * half },
      ];
    }
    case 'path':
    case 'self':
      return [];
  }
}

/**
 * How far a directional shape got, in tiles along its axis. `alongAxis` divides
 * by the dominant component, so a covered tile at depth `d` always sits exactly
 * `d` away on that component — `max(|dx|, |dy|)` recovers the depth exactly,
 * for any rotation, with no trig and no projection error.
 */
function depthReached(from: Vec2, covered: readonly Vec2[]): number {
  let deepest = 0;
  for (const p of covered) deepest = Math.max(deepest, Math.abs(p.x - from.x), Math.abs(p.y - from.y));
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
