/**
 * M3-END-SCREEN — how a decided match reads to the player who is looking at it.
 *
 * A resolved match already cleared the board, printed the reason
 * (`endReasonText`) and laid out SCORE1's breakdown. Two things were missing and
 * they are different in kind:
 *
 * 1. **Whose win it was.** "Team 2 wins on kills, 4–2" is the right sentence for
 *    a hot-seat, where one screen holds both sides. It is the wrong one for a
 *    networked seat, which needs to know whether Team 2 is *them*. So the
 *    per-seat headline exists only where a seat exists to have it.
 * 2. **A way out.** However the match ended, the player was left on it.
 *
 * Everything here reads the engine's own terminal `status`/`winner`
 * (`resolveOutcome`) and recomputes nothing — there is exactly one place that
 * decides who won, and it is not this file.
 */

import type { GameState, TeamId } from '@cards/engine';

/** The match's result from one team's point of view. `undefined` while it runs. */
export type Outcome = 'won' | 'lost' | 'draw';

/**
 * What `viewer` got. `undefined` for a match still in progress, which is the
 * signal the caller acts on: no outcome, no end screen.
 *
 * `status` is the engine's (`'active' | 'finished' | 'draw'`) and `winner` is
 * the engine's; the only thing added here is the point of view.
 */
export function outcomeFor(state: Pick<GameState, 'status' | 'winner'>, viewer: TeamId): Outcome | undefined {
  if (state.status === 'active') return undefined;
  if (state.status === 'draw' || state.winner === undefined) return 'draw';
  return state.winner === viewer ? 'won' : 'lost';
}

/** The one word a seat wants first. Kept blunt on purpose. */
export function endHeadline(outcome: Outcome): string {
  switch (outcome) {
    case 'won': return 'Victory';
    case 'lost': return 'Defeat';
    case 'draw': return 'Draw';
  }
}

/**
 * Where "back" goes.
 *
 * The front door rather than a rematch: a rematch needs a room both players
 * agree to re-enter, which is a protocol conversation nobody has specced. The
 * create form is one click from a new match and is already built, so the way out
 * is the way in.
 */
export const FRONT_DOOR = '?create';
export const HOT_SEAT_DOOR = '?';

/** The label on the way out, which differs by where it goes. */
export const exitLabel = (networked: boolean): string =>
  (networked ? 'Back to the lobby — create a room ▸' : 'New match ▸');
