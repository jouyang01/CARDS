/**
 * M3-HIDDEN — what one team is allowed to be told.
 *
 * This is the golden-rule-#5 boundary made real. Up to now the DO broadcast the
 * whole `GameState` to every seat and the *client* drew fog over it, which means
 * the hidden information was never hidden: it was on the wire, in the browser,
 * one devtools panel away. Everything below runs **server-side**, and the
 * payload a seat receives simply does not contain what its team cannot see.
 *
 * Two rules shape all of it:
 *
 * - **Hidden information is team-vs-team, never within a team** (edge-cases,
 *   Teams & control). A teammate's plans, traps and positions are always
 *   included; only the opposing team is filtered.
 * - **The server filters views; it never re-simulates.** Determinism is the
 *   engine's, and a second simulation is a second answer waiting to disagree
 *   with the first. Every question here is asked of `visibleEnemiesForTeam` /
 *   `visibleSquaresForTeam` — the same queries the hot-seat client asks.
 *
 * The shape returned is a `GameState` with things *removed*, not a new type.
 * A client already knows how to read a `GameState`; handing it a different
 * structure for the networked case would be a second rendering path to keep in
 * step with the first.
 */

import {
  buildBoard,
  buildVision,
  visibleEnemiesForTeam,
  visibleSquaresForTeam,
  type GameState,
  type MapDef,
  type TeamId,
  type TurnEvent,
  type UnitOrders,
  type Vec2,
} from '@cards/engine';

/** One team's view of the match: a filtered state plus the fog it was cut with. */
export interface TeamView {
  state: GameState;
  /**
   * Squares this team can currently see, so the client can darken the rest
   * without re-deriving vision. The engine's answer, not a second one.
   */
  visibleSquares: Vec2[];
}

const key = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * Everything `team` may know about `state`.
 *
 * Enemy units it cannot see are **absent from the array**, not blanked: a unit
 * with its fields nulled still says "somebody is out there", and the count
 * alone would tell a player how many enemies are hidden. Absence is the only
 * filtering that leaks nothing.
 */
export function teamView(map: MapDef, state: GameState, team: TeamId): TeamView {
  const vision = buildVision(buildBoard(map));
  const seen = new Set(visibleEnemiesForTeam(vision, state, team).map((u) => u.unitId));
  const squares = visibleSquaresForTeam(vision, state, team);
  const lit = new Set(squares.map(key));

  return {
    visibleSquares: squares,
    state: {
      ...state,
      units: state.units.filter((u) => u.owner === team || seen.has(u.unitId)),
      // A trap is a static object with no Stealth of its own, so square
      // visibility is the gate — the same one the hot-seat uses. Your own
      // minefield is always yours to see; you planted it.
      traps: state.traps.filter((t) => t.owner === team || lit.has(key(t.pos))),
      // Decoys likewise. Note the *filtering* is all that happens here: whether
      // a visible decoy is drawn as a convincing enemy or as its owner's purple
      // ghost is a rendering question, and the client already answers it.
      decoys: state.decoys.filter((d) => d.teamId === team || lit.has(key(d.pos))),
      // A pending delayed ability is an **enemy plan already locked in** — the
      // grenade that lands next turn. Sending the caster and the squares would
      // hand over the one piece of information a delayed ability trades on.
      delayed: state.delayed.filter((d) => {
        const caster = state.units.find((u) => u.unitId === d.casterUnitId);
        return caster !== undefined && caster.owner === team;
      }),
      // Each team remembers its own sightings and nothing about the enemy's.
      // Shipping the other side's `lastKnown` would say exactly where they
      // believe you are — which is worse than saying where you are.
      lastKnown: state.lastKnown.filter((k) => k.team === team),
      // Pads are public terrain (PADS-INDICATOR) and stay whole.
    },
  };
}

/**
 * The events `team` is allowed to be shown.
 *
 * An event is kept when it concerns one of this team's units, or an enemy the
 * team can see **in the post-turn state**. That second clause is what makes
 * "acting reveals" work without a special case: the engine already applies
 * `reveal` to a unit that attacks (CAMO-REVEAL), so an attacker is visible by
 * the time the log is filtered and its whole exchange survives. A unit that
 * merely walked around in the dark does not.
 *
 * Events with no unit attached — phase markers, the game-ending — are kept for
 * everyone: they carry no position and the client needs them to segment
 * playback at all.
 */
export function filterEvents(
  events: readonly TurnEvent[],
  state: GameState,
  team: TeamId,
  visibleUnitIds: ReadonlySet<string>,
): TurnEvent[] {
  const own = new Set(state.units.filter((u) => u.owner === team).map((u) => u.unitId));
  const maySee = (unitId: string): boolean => own.has(unitId) || visibleUnitIds.has(unitId);

  return events.filter((e) => {
    switch (e.type) {
      case 'moveStep':
      case 'displaced':
      case 'abilityFired':
      case 'energyGained':
      case 'energySpent':
      case 'respawn':
      case 'death':
      case 'trapTriggered':
      case 'powerupTaken':
        return maySee(e.unitId);
      case 'damage':
      case 'heal':
      case 'statusApplied':
        // Either end is enough: being hit by something you cannot see is a fact
        // about *you*, and hiding it would leave your own HP unexplained.
        return maySee(e.unitId) || maySee(e.sourceUnitId);
      case 'statusRemoved':
        return maySee(e.unitId);
      case 'chaseResolved':
        // A chase is your own order; the enemy never learns you made one.
        return own.has(e.unitId);
      case 'trapPlaced':
      case 'trapExpired':
        return e.owner === team;
      default:
        // `phaseStart`, `gameEnd`, decoy events and anything added later: kept.
        // Decoys are already filtered by `teamView`, and a phase marker with no
        // unit on it cannot leak a position.
        return true;
    }
  });
}

/** The visible-enemy set for a team, for callers that need it beside a view. */
export function visibleEnemyIds(map: MapDef, state: GameState, team: TeamId): Set<string> {
  const vision = buildVision(buildBoard(map));
  return new Set(visibleEnemiesForTeam(vision, state, team).map((u) => u.unitId));
}

/**
 * The orders a seat may see during the Decision phase: **its own team's, and
 * only its own team's**.
 *
 * Teammates included, deliberately — hidden information is team-vs-team, and a
 * 2v2 where the two players on a side cannot coordinate is a different game
 * (edge-cases, Teams & control). This is the whole of the plan-secrecy rule;
 * the reveal after lock-in simply stops calling it.
 */
export function ordersForTeam(
  submissions: ReadonlyMap<string, UnitOrders[]>,
  seatsOnTeam: readonly string[],
): Record<string, UnitOrders[]> {
  const out: Record<string, UnitOrders[]> = {};
  for (const seatId of seatsOnTeam) {
    const orders = submissions.get(seatId);
    if (orders !== undefined) out[seatId] = orders;
  }
  return out;
}
