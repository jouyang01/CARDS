import { describe, expect, it } from 'vitest';
import {
  MOVE_RANGE,
  SPRINT_RANGE,
  buildBoard,
  createMatch,
  resolveTurn,
  validateMovePath,
  type CharacterDef,
  type GameState,
  type MapDef,
  type Roster,
  type UnitState,
  type Vec2,
} from '@cards/engine';
import { appendWaypoint, pathSpend, remainingMove } from '../src/targeting.js';
import { planningState } from '../src/fog.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * WAYPOINTS — building a move one tile at a time.
 *
 * Owner Dev Note: *"You should be able to manually set different waypoints to
 * move your unit around an enemy, a trap, or any obstacle … Hold down the Shift
 * key while executing a movement command on each tile you want to step on
 * sequentially … Every time you click on a tile, your effective movement range
 * should change (decrease typically), as you move on sequential tiles."*
 *
 * **The engine needed nothing** (ruled): `validateMovePath` already walks an
 * arbitrary ordered step list and `runMove` walks a `movePath` verbatim. So the
 * feature is one client function, and the property that makes it correct is that
 * it does not re-implement legality — it asks the engine, which is why the last
 * test here submits a hand-built path and watches the real resolver walk it.
 *
 * The one deliberate looseness is `occupied`: that verdict is about where a path
 * *ends*, not whether a step is legal, and refusing the intermediate click would
 * make "walk around an enemy" — the exact manoeuvre the note asks for —
 * impossible.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 7 }, { x: 2, y: 9 }], [{ x: 12, y: 7 }, { x: 12, y: 9 }]],
};
/** A wall stub jutting into the middle — the "obstacle" of the Dev Note. */
const WALLED: MapDef = { ...OPEN, walls: [{ x: 7, y: 7 }, { x: 7, y: 8 }] };

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const roster: Roster = { vex: VEX, bastion: BASTION };

/** A 2v2 with the mover parked mid-board and its teammate out of the way. */
const board = (map: MapDef = OPEN): { state: GameState; unit: UnitState } => {
  const state = createMatch(map, '2v2', [[VEX, VEX], [BASTION, BASTION]]);
  const unit = state.units[0]!;
  unit.pos = { x: 5, y: 7 };
  state.units[1]!.pos = { x: 1, y: 1 };
  state.units[2]!.pos = { x: 13, y: 13 };
  state.units[3]!.pos = { x: 13, y: 1 };
  return { state, unit };
};
const key = (p: Vec2) => `${p.x},${p.y}`;
/** Click a sequence of squares with Shift held; returns the path it built. */
const clicks = (
  map: MapDef, state: GameState, unit: UnitState, squares: Vec2[], sprint = false,
): { path: Vec2[]; refused: Vec2[] } => {
  let path: Vec2[] = [];
  const refused: Vec2[] = [];
  for (const square of squares) {
    const next = appendWaypoint(map, state, unit, path, square, sprint);
    if (next === undefined) refused.push(square);
    else path = next;
  }
  return { path, refused };
};

describe('WAYPOINTS: a click appends one step', () => {
  it('a sequence builds exactly the tiles that were clicked, in order', () => {
    const { state, unit } = board();
    const wanted = [{ x: 6, y: 7 }, { x: 6, y: 6 }, { x: 7, y: 6 }];
    const { path, refused } = clicks(OPEN, state, unit, wanted);
    expect(path.map(key)).toEqual(wanted.map(key));
    expect(refused).toEqual([]);
  });

  it('a NON-adjacent click is refused, not auto-connected', () => {
    // Ruled for v1: one adjacent step per click is what keeps "tile-by-tile"
    // literal. Auto-connecting would quietly re-introduce the auto-route the
    // player pressed Shift to escape.
    const { state, unit } = board();
    const { path, refused } = clicks(OPEN, state, unit, [{ x: 8, y: 7 }]);
    expect(path, 'nothing was appended').toEqual([]);
    expect(refused.map(key)).toEqual(['8,7']);
  });

  it('a wall is refused, and the path it was building survives', () => {
    // The refusal must not cost the player the waypoints they already placed —
    // a misclick that wiped the route would be worse than no waypoints at all.
    const { state, unit } = board(WALLED);
    const { path, refused } = clicks(WALLED, state, unit, [
      { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 6, y: 6 },
    ]);
    expect(refused.map(key), 'the wall').toEqual(['7,7']);
    expect(path.map(key), 'and the route carries on around it').toEqual(['6,7', '6,6']);
  });

  it('clicking the square you are already on is not a step', () => {
    const { state, unit } = board();
    expect(appendWaypoint(OPEN, state, unit, [], unit.pos, false)).toBeUndefined();
    const one = appendWaypoint(OPEN, state, unit, [], { x: 6, y: 7 }, false)!;
    expect(appendWaypoint(OPEN, state, unit, one, { x: 6, y: 7 }, false)).toBeUndefined();
  });

  it('the route walks AROUND a body, which is the whole point', () => {
    // The Dev Note's own example. Occupancy is not a refusal mid-path (it is a
    // rule about where a path *ends*), so a player can step past an enemy…
    const { state, unit } = board();
    state.units[2]!.pos = { x: 6, y: 7 }; // an enemy directly east
    const around = clicks(OPEN, state, unit, [{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 7, y: 7 }]);
    expect(around.refused, 'going round it is unobstructed').toEqual([]);
    expect(around.path.map(key)).toEqual(['6,6', '7,6', '7,7']);
  });
});

describe('WAYPOINTS: the budget draws down as you click', () => {
  it('one orthogonal step costs 1, a diagonal costs 2 (MET1)', () => {
    const { state, unit } = board();
    expect(pathSpend(unit.pos, [{ x: 6, y: 7 }])).toBe(1);
    expect(pathSpend(unit.pos, [{ x: 6, y: 8 }]), 'a diagonal is two steps of ground').toBe(2);
    expect(pathSpend(unit.pos, [{ x: 6, y: 7 }, { x: 7, y: 8 }])).toBe(3);
  });

  it('the readout is exactly `movementBudget − Σ step costs`', () => {
    const { state, unit } = board();
    expect(remainingMove(unit, false, [])).toBe(MOVE_RANGE);
    const { path } = clicks(OPEN, state, unit, [{ x: 6, y: 7 }, { x: 7, y: 7 }]);
    expect(remainingMove(unit, false, path)).toBe(MOVE_RANGE - 2);
    expect(remainingMove(unit, true, path), 'and a sprint has more of it').toBe(SPRINT_RANGE - 2);
  });

  it('a diagonal leg takes two off the readout, not one', () => {
    const { state, unit } = board();
    const { path } = clicks(OPEN, state, unit, [{ x: 6, y: 8 }]);
    expect(remainingMove(unit, false, path)).toBe(MOVE_RANGE - 2);
  });

  it('the click that would overspend is refused, and the budget is unchanged', () => {
    // MOVE_RANGE is 4, so four orthogonal steps exhaust it and the fifth is not
    // a legal step at all. The refusal has to leave the readout where it was —
    // a budget that ticked down on a refused click would be lying.
    const { state, unit } = board();
    const four = [{ x: 6, y: 7 }, { x: 7, y: 7 }, { x: 8, y: 7 }, { x: 9, y: 7 }];
    const { path } = clicks(OPEN, state, unit, four);
    expect(remainingMove(unit, false, path)).toBe(0);

    const over = appendWaypoint(OPEN, state, unit, path, { x: 10, y: 7 }, false);
    expect(over, 'over budget').toBeUndefined();
    expect(remainingMove(unit, false, path), 'still zero, not negative').toBe(0);
  });

  it('a sprint buys more waypoints, by exactly the sprint budget', () => {
    const { state, unit } = board();
    const eight = Array.from({ length: SPRINT_RANGE }, (_, i) => ({ x: 6 + i, y: 7 }));
    const { path, refused } = clicks(OPEN, state, unit, eight, true);
    expect(refused, 'all eight fit').toEqual([]);
    expect(remainingMove(unit, true, path)).toBe(0);
    expect(appendWaypoint(OPEN, state, unit, path, { x: 14, y: 7 }, true), 'and no more').toBeUndefined();
  });
});

describe('WAYPOINTS: the hand-built path is an ordinary order', () => {
  it('the engine accepts it — no new field, no new rule', () => {
    const { state, unit } = board(WALLED);
    const { path } = clicks(WALLED, state, unit, [
      { x: 6, y: 7 }, { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 },
    ]);
    const check = validateMovePath(buildBoard(WALLED), state, unit, path, false);
    expect(check.valid, 'the engine validates what the client built').toBe(true);
  });

  it('and `resolveTurn` walks it verbatim, around the wall', () => {
    // The end-to-end claim: a route no auto-router would have chosen is walked
    // exactly as clicked, and the unit ends where the last waypoint said.
    const { state, unit } = board(WALLED);
    const { path } = clicks(WALLED, state, unit, [
      { x: 6, y: 7 }, { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 },
    ]);
    const { state: after } = resolveTurn(
      state, WALLED,
      [{ team: 0, units: [{ unitId: unit.unitId, movePath: path }] }, { team: 1, units: [] }],
      roster,
    );
    expect(after.units.find((u) => u.unitId === unit.unitId)!.pos).toEqual({ x: 8, y: 6 });
  });

  it('MOVE-FOG holds: an invisible enemy is not felt as an obstacle', () => {
    // The leak MOVE-FOG closed stays closed, and it closes *here* by this
    // function not being the one that decides what is on the board — the caller
    // passes the same `planningState` the auto-route uses. An enemy the team
    // cannot see is simply not in it, so a waypoint over its tile behaves
    // exactly like a waypoint over empty ground.
    const { state, unit } = board();
    const hidden = state.units[2]!;
    hidden.pos = { x: 6, y: 7 };
    const visibleToMover = state.units.filter((u) => u.owner === unit.owner);
    const planned = planningState(state, visibleToMover);

    const blind = appendWaypoint(OPEN, planned, unit, [], { x: 6, y: 7 }, false);
    expect(blind, 'no tell that somebody is standing there').toEqual([{ x: 6, y: 7 }]);
    // …and the same square with the enemy visible behaves the same way, because
    // occupancy is never a step-legality question in the first place.
    expect(appendWaypoint(OPEN, state, unit, [], { x: 6, y: 7 }, false)).toEqual([{ x: 6, y: 7 }]);
  });
});
