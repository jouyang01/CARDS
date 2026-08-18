/**
 * The decision-phase interaction state machine (UI1) — what a board click and a
 * board hover do to "what am I currently pointing at".
 *
 * **Pure**, and separated from `app.ts` for one reason: this is where the
 * commit/preview split lives, and the split is not obviously correct. Hover
 * paints a *hypothetical* order without touching the draft; a click writes the
 * draft and **disarms** the mode. Get the disarm wrong and the committed order
 * is stored but permanently painted over by the continuing hover — the action
 * looks like it never locked in, which is exactly the bug UI1-fix repairs.
 *
 * Keeping it here means the invariant is testable: commit, then hover, and the
 * painted aim must not move.
 */

import type { AbilityDef, GameState, MapDef, UnitState, Vec2 } from '@cards/engine';
import { movementBudget } from '@cards/engine';
import { commitAim, pathTo, type OrderDraft } from './targeting.js';

/**
 * What a board click will do. `idle` means the click does nothing to the board —
 * an ability or Move must be armed first, which is the "click the skill to set
 * the mode" half of the owner's note.
 */
export type Mode = 'idle' | 'aim' | 'move' | 'catalyst' | 'free' | 'chase';

/**
 * Purely presentational pointer state. **Nothing here is ever written into a
 * draft.** Hover shows what an action *would* do; only a click commits it.
 * Keeping the two apart is what lets the range envelope, the live cone and the
 * committed order all render at once without one overwriting another.
 */
export interface Hover {
  /** An ability control is under the pointer — paint its range envelope. */
  abilityId?: string;
  /** A move control is under the pointer — paint where the unit could walk. */
  move?: 'move' | 'sprint';
  /** The board square under the pointer, while a mode is armed. */
  square?: Vec2;
}

export interface Interaction {
  mode: Mode;
  hover: Hover;
}

/** Nothing armed, nothing hovered. */
export const IDLE: Interaction = { mode: 'idle', hover: {} };

/** Arm aiming (an ability was selected), or leave idle for a self-cast. */
export const arm = (mode: Mode): Interaction => ({ mode, hover: {} });

/**
 * The state after a **committing board click**.
 *
 * Disarming is the whole point. The click has already written the draft; if the
 * mode stayed armed, the very next `mousemove` would set `hover.square` again
 * and `previewAim` would go straight back to painting the pointer's aim over
 * the committed one. The player sees an action that will not stop following the
 * mouse and concludes it never locked in — because, visually, it did not.
 *
 * Re-aiming is by re-selecting the ability (UI1's "choosing another ability
 * before Lock In replaces it"), or by clicking again while a move is drawn.
 */
export const afterCommit = (): Interaction => ({ mode: 'idle', hover: {} });

/**
 * The state after the pointer moves over `square` (or off the board when
 * `undefined`). Returns `undefined` when nothing changed, so the caller can skip
 * a repaint — a mousemove fires on every pixel, and most of them land on the
 * same tile.
 *
 * An idle mode ignores the board entirely: with nothing armed there is no
 * hypothetical order to show, and — after a commit — nothing that should
 * disturb what is already on screen.
 */
export function hoverBoard(current: Interaction, square: Vec2 | undefined): Interaction | undefined {
  if (current.mode === 'idle') return undefined;
  const at = current.hover.square;
  if (square === undefined) return at === undefined ? undefined : { ...current, hover: {} };
  if (at !== undefined && at.x === square.x && at.y === square.y) return undefined;
  return { ...current, hover: { square: { x: square.x, y: square.y } } };
}

/** The state while an ability control is hovered — the range envelope (UI1). */
export const hoverAbility = (current: Interaction, abilityId: string | undefined): Interaction =>
  ({ mode: current.mode, hover: abilityId === undefined ? {} : { abilityId } });

/** The state while a move control is hovered. */
export const hoverMove = (current: Interaction, kind: 'move' | 'sprint' | undefined): Interaction =>
  ({ mode: current.mode, hover: kind === undefined ? {} : { move: kind } });

/**
 * The aim to PAINT right now: the hovered square's aim while the pointer is over
 * the board in aim mode, else whatever the draft has committed.
 *
 * **AIM-PREVIEW-RANGE.** Owner Dev Note: *"Blink and Intercept are both 'blink'
 * dashes that appear to have no range limit. The range shown when mousing over
 * the board should be locked to the effective range of the skill."* They were,
 * and it was the preview lying rather than the ability misbehaving: this painted
 * whatever square the pointer was over, so a range-4 Blink drew its landing
 * marker and its yellow route ten squares away. AIM-RANGE had already taught the
 * *click* to refuse that, so the ability was never castable there — but a player
 * reads reach off the overlay, not off what happens when they click.
 *
 * So the hover branch goes through `commitAim`, the same gate the click uses,
 * and paints nothing when it refuses. Both branches now come from one resolver
 * rather than two, which is the stronger form of the promise this function
 * already made: a preview and the commit that follows it cannot describe
 * different orders, and cannot disagree about whether there is an order at all.
 *
 * A `line` or `cone` is unaffected — an aim past its range is still a legal
 * *direction*, and the shape clips itself.
 */
export function previewAim(
  map: MapDef,
  state: GameState,
  unit: UnitState,
  ability: AbilityDef | undefined,
  draft: OrderDraft,
  interaction: Interaction,
): { aim: Vec2[]; aimStep?: number } {
  if (ability !== undefined && interaction.mode === 'aim' && interaction.hover.square !== undefined) {
    return commitAim(map, state, unit, ability, interaction.hover.square) ?? { aim: [] };
  }
  return { aim: draft.aim, aimStep: draft.aimStep };
}

/**
 * AIM-RANGE-TELL — the square the pointer is over when the aim it would make is
 * **refused**, so "no" is something the board says rather than something it
 * withholds.
 *
 * Builder OQ 2026-09-10 #4. AIM-PREVIEW-RANGE stopped the overlay from
 * promising a reach the ability does not have, and did it by painting nothing —
 * which is correct and silent. Silence is indistinguishable from "the preview is
 * broken", especially for a blink, where the whole complaint that started this
 * was an ability that looked like it had no range.
 *
 * The same gate decides both, so the marker appears exactly where the aim
 * disappears: one square, under the pointer, for the caller to draw in a colour
 * that means no.
 */
export function refusedAim(
  map: MapDef,
  state: GameState,
  unit: UnitState,
  ability: AbilityDef | undefined,
  interaction: Interaction,
): Vec2[] {
  const square = interaction.hover.square;
  if (ability === undefined || interaction.mode !== 'aim' || square === undefined) return [];
  return commitAim(map, state, unit, ability, square) === undefined ? [{ ...square }] : [];
}

/**
 * The catalyst's aim to paint (CAT2) — its own mode and its own slot, so
 * aiming a Shift never disturbs the ability aim sitting next to it.
 */
export function previewCatalystAim(
  map: MapDef,
  state: GameState,
  unit: UnitState,
  def: AbilityDef | undefined,
  draft: OrderDraft,
  interaction: Interaction,
): Vec2[] {
  if (def !== undefined && interaction.mode === 'catalyst' && interaction.hover.square !== undefined) {
    // AIM-PREVIEW-RANGE, same gate: a Shift is a blink too.
    return commitAim(map, state, unit, def, interaction.hover.square)?.aim ?? [];
  }
  return draft.catalystAim;
}

/**
 * The free ability's aim to paint (FREE-UI) — its own mode and its own slot, so
 * aiming a trap never disturbs the attack sitting next to it.
 */
export function previewFreeAim(
  map: MapDef,
  state: GameState,
  unit: UnitState,
  def: AbilityDef | undefined,
  draft: OrderDraft,
  interaction: Interaction,
): Vec2[] {
  if (def !== undefined && interaction.mode === 'free' && interaction.hover.square !== undefined) {
    // AIM-PREVIEW-RANGE, same gate — a trap placed out of reach is not a plan.
    return commitAim(map, state, unit, def, interaction.hover.square)?.aim ?? [];
  }
  return draft.freeAim;
}

/** Likewise for the drawn move: the hovered route while drawing, else committed. */
export function previewMovePath(
  map: MapDef,
  state: GameState,
  unit: UnitState,
  draft: OrderDraft,
  interaction: Interaction,
): Vec2[] {
  if (interaction.mode === 'move' && interaction.hover.square !== undefined) {
    return pathTo(map, state, unit, interaction.hover.square, movementBudget(unit, draft.sprint));
  }
  return draft.movePath;
}

/**
 * WAYPOINTS-FIX — what a **Shift-click** on the board means, given what is
 * currently armed.
 *
 * Owner Dev Note: *"WAYPOINTS is not working. I cannot hold shift + click to
 * move to a waypoint."*
 *
 * This is the half that was actually broken. `appendWaypoint` had unit tests and
 * passed them; the feature still did nothing, because the Shift branch lived
 * *inside* the "move is already armed" arm of the click handler. A player who
 * selects a unit and Shift-clicks has armed nothing, so the branch never ran and
 * there was no feedback to say why. The gate is therefore pulled out here, where
 * it can be tested as the rule it is rather than inferred from a nesting level.
 *
 * The rule (ruled, edge-cases "WAYPOINTS-FIX"):
 * - No Shift, or an immovable unit → not a waypoint click; the caller does
 *   whatever it did before.
 * - **Aiming wins.** A Shift-click while an ability, free action, catalyst or
 *   chase is mid-commit is not a waypoint — those modes own the click, and
 *   stealing it would drop the aim the player is halfway through.
 * - Move already armed (or a sprint drafted) → append to the drawn path.
 * - Otherwise → **arm move and append**, so the first Shift-click starts the
 *   route without the player hunting for the Move button first.
 */
export type WaypointClick = 'ignore' | 'append' | 'armAndAppend';

export function waypointClick(
  interaction: Interaction,
  draft: OrderDraft,
  shiftKey: boolean,
  movable: boolean,
): WaypointClick {
  if (!shiftKey || !movable) return 'ignore';
  if (interaction.mode === 'aim' || interaction.mode === 'free'
    || interaction.mode === 'catalyst' || interaction.mode === 'chase') {
    return 'ignore';
  }
  return interaction.mode === 'move' || draft.sprint ? 'append' : 'armAndAppend';
}

/**
 * What the shared **impact layer** shows, and in which of its two meanings.
 *
 * Three things want that layer and none of them can be wanted at once: a dash's
 * landing discs (DASH-PREVIEW), the square an *aim* was refused at
 * (AIM-RANGE-TELL), and the square a *waypoint* was refused at (WAYPOINTS-FIX).
 * A refusal has no landing to preview and a landing is not a refusal, so one
 * layer carries all three and the colour says which.
 *
 * Pulled out of the render loop because the alternative was not testable, and
 * that mattered: the AIM-RANGE-TELL commit deleted the layer's `highlight` call
 * while adding its own and shipped **neither** — the dash discs silently stopped
 * drawing and the refusal marker never appeared, through a green suite and a
 * green render e2e. A pure function cannot fix a caller that forgets to call it,
 * but it can make the decision itself something a test can hold.
 */
export interface ImpactLayer {
  squares: Vec2[];
  /** True when these are refusals rather than a landing — draw them in the "no" colour. */
  refused: boolean;
}

export function impactLayer(
  discs: readonly Vec2[],
  aimRefused: readonly Vec2[],
  waypointRefused: Vec2 | undefined,
): ImpactLayer {
  if (discs.length > 0) return { squares: discs.map((p) => ({ ...p })), refused: false };
  const squares = [
    ...aimRefused.map((p) => ({ ...p })),
    ...(waypointRefused === undefined ? [] : [{ ...waypointRefused }]),
  ];
  return { squares, refused: true };
}
