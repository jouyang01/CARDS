/**
 * CAMO-SEED — dev-only starting arrangements, reachable as `?scenario=<id>`.
 *
 * Some board states are ordinary in a match and very expensive to *drive* to
 * from the opening frame. CAMO-REVEAL is the case that forced this: the red
 * thicket only lights when a unit ends a turn inside brush and attacks, and a
 * browser test that walks blindly toward the middle hunting for that costs two
 * minutes and then usually has nothing to assert.
 *
 * So this is a **named seed, not a scenario DSL**. Each entry nudges starting
 * positions and nothing else — no scripted orders, no injected state, no
 * rewriting of the match. Everything after turn 1 is the same engine playing
 * the same rules, which is what keeps the seed honest as a playtest aid too.
 *
 * Pure: it takes a state and returns a new one, so the caller decides when it
 * applies and a normal match never calls it at all.
 */

import { distance, terrainAt, type Board, type GameState, type Vec2 } from '@cards/engine';

/** Every seed there is. `?scenario=` accepts exactly these. */
export const SCENARIOS = ['in-brush'] as const;
export type ScenarioId = (typeof SCENARIOS)[number];

export const isScenarioId = (s: string): s is ScenarioId =>
  (SCENARIOS as readonly string[]).includes(s);

/** What each seed is for, so `?scenario=nope` can list the alternatives. */
export const SCENARIO_TEXT: Record<ScenarioId, string> = {
  'in-brush': 'each team\'s first character starts inside brush (CAMO-REVEAL)',
};

/**
 * The brush square nearest `from` that nobody has claimed.
 *
 * Nearest by the game's own metric (`distance`, Manhattan per MET1), tie-broken
 * by the board's own scan order rather than by anything clever — a seed has to
 * put the same unit on the same square every run or the e2e it exists for is
 * flakier than the drive it replaced.
 */
function nearestBrush(board: Board, from: Vec2, taken: ReadonlySet<string>): Vec2 | undefined {
  let best: Vec2 | undefined;
  let bestDist = Infinity;
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (terrainAt(board, { x, y }) !== 'brush') continue;
      if (taken.has(`${x},${y}`)) continue;
      const d = distance(from, { x, y });
      if (d < bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * Apply a seed to a freshly created match.
 *
 * Returns a new state; a seed that cannot be satisfied (a map with no brush,
 * say) returns the state unchanged rather than throwing. A dev hook that breaks
 * the page when a map does not suit it is worse than one that quietly does
 * nothing — the e2e asserting on the seeded condition will fail loudly anyway,
 * which is the right place for that failure.
 */
export function applyScenario(id: ScenarioId, board: Board, state: GameState): GameState {
  if (id !== 'in-brush') return state;

  // Every occupied square is off limits, plus each square this seed claims as
  // it goes — two units cannot share one (Collisions), and a seed that stacked
  // them would produce a state the engine never would.
  const taken = new Set(state.units.map((u) => `${u.pos.x},${u.pos.y}`));
  const moved = new Map<string, Vec2>();

  for (const team of [0, 1] as const) {
    const unit = state.units.find((u) => u.owner === team);
    if (unit === undefined) continue;
    const spot = nearestBrush(board, unit.pos, taken);
    if (spot === undefined) continue;
    taken.delete(`${unit.pos.x},${unit.pos.y}`);
    taken.add(`${spot.x},${spot.y}`);
    moved.set(unit.unitId, spot);
  }

  if (moved.size === 0) return state;
  return {
    ...state,
    units: state.units.map((u) => {
      const spot = moved.get(u.unitId);
      return spot === undefined ? u : { ...u, pos: { x: spot.x, y: spot.y } };
    }),
  };
}
