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

/**
 * A decoy as one viewer sees it (DECOY-RENDER). `asEnemy` is the whole point:
 * a decoy exists to be mistaken for Wisp, so to the other team it must render
 * *as a normal enemy unit* — same model, same colour — and to Wisp's own team
 * it must be obviously fake, or its owner cannot plan around it.
 */
export interface FogDecoy {
  id: string;
  pos: Vec2;
  /** The team that placed it — an impersonated enemy has to wear *their* colour. */
  owner: TeamId;
  /** True for the team being fooled: draw it exactly like an enemy unit. */
  asEnemy: boolean;
}

/**
 * A placed trap as one viewer sees it (TRAP-INDICATOR). `own` decides the
 * styling: your own minefield is something you must route around knowingly —
 * traps are team-safe, so you need to see yours — while an enemy trap is a
 * threat you only learn about by looking at its square.
 */
export interface FogTrap {
  id: string;
  pos: Vec2;
  owner: TeamId;
  /** True when this trap belongs to the viewing team. */
  own: boolean;
}

/** What a renderer should draw for one viewer. */
export interface FogView {
  /**
   * Camouflage squares lit **red** because the unit standing on them gave
   * itself away (CAMO-REVEAL). The owner's tell: acting from a thicket turns
   * the thicket red for the reveal's duration.
   */
  camoTiles: Vec2[];
  /** The units to draw — hidden enemies are simply absent. */
  units: UnitState[];
  /** The decoys to draw, styled for this viewer. Hidden ones are absent. */
  decoys: FogDecoy[];
  /** The traps to draw, styled for this viewer. Hidden ones are absent. */
  traps: FogTrap[];
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
  const units = state.units.filter((u) => u.owner === team || !u.alive || seen.has(u.unitId));
  return {
    units,
    decoys: visibleDecoys(state, team, lit),
    traps: visibleTraps(state, team, lit),
    // Only over units this viewer can already see. A red tile is a *tell*, and a
    // tell you could read through fog would be a better tracker than the fog it
    // sits under — you would learn a hidden unit's exact square from the glow.
    camoTiles: camoTiles(map, units.map((u) => ({
      pos: u.pos,
      alive: u.alive,
      revealed: u.statuses.some((st) => st.kind === 'reveal' && st.remaining > 0),
    }))),
    fogged,
  };
}

/** The minimum a camouflage-tile check needs to know about a unit. */
export interface CamoCandidate {
  pos: Vec2;
  alive: boolean;
  revealed: boolean;
}

/**
 * The brush squares that should burn red: a living unit carrying `reveal`,
 * standing on brush (CAMO-REVEAL).
 *
 * Read straight off whatever the caller is already drawing — no memory, no
 * derivation. The engine decides who is revealed and for how long; this only
 * asks which of them are still standing in the thicket that gave them away. A
 * unit that walks out of the brush takes the red with it, which is the honest
 * reading of "the tile you were standing on": the client is never told which
 * square the reveal fired from, and inventing a memory for it is LAST-KNOWN's
 * kind of problem, not this one's.
 *
 * Shape-agnostic on purpose. Decision draws from `GameState` units and playback
 * from folded `ViewUnit`s, and the rule must not be written twice.
 */
export function camoTiles(map: MapDef, units: Iterable<CamoCandidate>): Vec2[] {
  const brush = new Set(map.brush.map(vecKey));
  const out: Vec2[] = [];
  for (const u of units) {
    if (u.alive && u.revealed && brush.has(vecKey(u.pos))) out.push({ ...u.pos });
  }
  return out;
}

/**
 * The traps this team may see (TRAP-INDICATOR).
 *
 * **Your own, always** — you planted them, they are team-safe, and a minefield
 * you cannot see is one you will plan a walk straight over. An **enemy** trap
 * only when a unit has vision of its square, which is the same
 * `visibleSquaresForTeam` gate everything else uses: a trap is a hidden threat
 * until somebody looks at it.
 *
 * Square visibility rather than `visibleEnemiesForTeam`, for the same reason
 * decoys use it: a trap is a static object on the ground with no Stealth to
 * check, no brush concealment of its own and nothing to reveal.
 */
function visibleTraps(state: GameState, team: TeamId, lit: ReadonlySet<string>): FogTrap[] {
  return state.traps
    .filter((t) => t.owner === team || lit.has(vecKey(t.pos)))
    .map((t) => ({ id: t.id, pos: { ...t.pos }, owner: t.owner, own: t.owner === team }));
}

/**
 * The decoys this team may see, tagged with how to draw them.
 *
 * An enemy decoy is fogged **exactly like an enemy unit**: a decoy visible
 * through the fog on an otherwise dark square would announce itself as fake by
 * being the only thing you could see, which is the opposite of its job. A
 * decoy's own team always sees its own.
 *
 * The decoy list is not `state.units`, so it has no `canSee` of its own — a
 * decoy is a static object with no Stealth, no brush concealment and nothing to
 * reveal, so plain square visibility is the whole question. That is a narrower
 * rule than `visibleEnemiesForTeam`, and deliberately so.
 */
function visibleDecoys(state: GameState, team: TeamId, lit: ReadonlySet<string>): FogDecoy[] {
  return state.decoys
    .filter((d) => d.teamId === team || lit.has(vecKey(d.pos)))
    .map((d) => ({ id: d.id, pos: { ...d.pos }, owner: d.teamId, asEnemy: d.teamId !== team }));
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
export function revealedView(state: GameState, team: TeamId): FogView {
  return {
    units: [...state.units],
    // Even revealed, a decoy is still drawn from a viewpoint — "everyone sees
    // it" is not the same as "everyone sees it as the same thing".
    decoys: state.decoys.map((d) => ({ id: d.id, pos: { ...d.pos }, owner: d.teamId, asEnemy: d.teamId !== team })),
    // Likewise still viewpoint-styled: "revealed" means everyone sees it, not
    // that everyone sees it as theirs.
    traps: state.traps.map((t) => ({ id: t.id, pos: { ...t.pos }, owner: t.owner, own: t.owner === team })),
    // No camouflage tells once everything is revealed: the tile is a warning to
    // an enemy who cannot see you, and here everyone can. (`revealedView` has no
    // `map` to test brush against either — it is the game-over/flat view.)
    camoTiles: [],
    fogged: [],
  };
}
