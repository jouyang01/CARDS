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
import { aimFor, pathTo, type OrderDraft } from './targeting.js';

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
 * Both branches ultimately come from `aimFor`, so a preview and the commit that
 * follows it can never describe different orders.
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
    return aimFor(map, state, unit, ability, interaction.hover.square);
  }
  return { aim: draft.aim, aimStep: draft.aimStep };
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
    return aimFor(map, state, unit, def, interaction.hover.square).aim;
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
    return aimFor(map, state, unit, def, interaction.hover.square).aim;
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
