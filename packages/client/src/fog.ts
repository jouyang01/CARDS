/**
 * Fog of war (VISION1) — what the seat on the clock is allowed to *see* while
 * it plans.
 *
 * The engine already models Atlas-Reactor-style vision in full: line of sight
 * through walls but not cover, a Manhattan sight radius, brush concealment with
 * its adjacency exception, Stealth and Reveal, and sight shared across a team.
 * None of that is re-derived here. This module asks the engine's own queries
 * (`visibleEnemiesForTeam`, `visibleSquaresForTeam`) and turns the answers into
 * the two things a renderer needs: which units to draw, and which squares to
 * darken. If the vision *rules* are ever wrong, they are wrong in the engine —
 * there is nowhere in this file for them to be wrong differently.
 *
 * **This is not a security boundary.** Hot-seat runs both teams in one browser
 * with the whole `GameState` in memory, so fog here is an honesty aid for
 * players sharing a screen, not secrecy. Real per-team hidden information —
 * orders and vision withheld server-side — is M3.
 */

import {
  buildBoard,
  buildVision,
  vecKey,
  visibleEnemiesForTeam,
  visibleSquaresForTeam,
  type GameState,
  type MapDef,
  type TeamId,
  type UnitState,
  type Vec2,
} from '@cards/engine';

/** What a renderer should draw for one viewer. */
export interface FogView {
  /** The units to draw — hidden enemies are simply absent. */
  units: UnitState[];
  /** Squares outside the team's sight, to darken. Empty when nothing is hidden. */
  fogged: Vec2[];
}

/**
 * The board as `team` sees it during the Decision phase.
 *
 * Own units are always drawn. Enemies are drawn only when the team can
 * collectively see them. **Corpses stay on the board**: a unit that died in
 * front of you was revealed when it died, and having its remains blink out on
 * the next turn's fog check would read as a rendering bug rather than as
 * information you lost (a judgment call — see docs/DECISIONS.md).
 */
export function fogView(map: MapDef, state: GameState, team: TeamId): FogView {
  const vision = buildVision(buildBoard(map));
  const seen = new Set(visibleEnemiesForTeam(vision, state, team).map((u) => u.unitId));
  const lit = new Set(visibleSquaresForTeam(vision, state, team).map(vecKey));
  const fogged: Vec2[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!lit.has(`${x},${y}`)) fogged.push({ x, y });
    }
  }
  return {
    units: state.units.filter((u) => u.owner === team || !u.alive || seen.has(u.unitId)),
    fogged,
  };
}

/**
 * The whole board, nothing hidden.
 *
 * Once both teams have locked in, the turn is history: everything that happened
 * is shown, including the enemy that was invisible while you were planning
 * against it. That reveal is the payoff for planning blind, and hiding it would
 * make a resolution impossible to read. Playback gets this for free — it draws
 * the turn player's folded view, which was never filtered — so this is the
 * explicit form, for the board states that are drawn straight from `GameState`.
 */
export function revealedView(state: GameState): FogView {
  return { units: [...state.units], fogged: [] };
}
