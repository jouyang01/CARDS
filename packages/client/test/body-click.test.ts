import { describe, expect, it } from 'vitest';
import {
  MOVE_RANGE, buildBoard, distance, movementBudget, reachableSquares,
  type GameState, type MapDef, type UnitState,
} from '@cards/engine';
import { movePreview, pathTo } from '../src/targeting.js';

/**
 * BODY-CLICK, the movement half — *"BUG: When moving to a location that another
 * character occupies … the character does not move at all."*
 *
 * Two separate things had to be true for that to happen, and only one of them
 * was a targeting bug. The first is `renderer3d`'s: a click on a body resolved
 * to the floor *behind* it, because the ray only ever met the ground plane —
 * fixed there, and pinned in the browser suite, which is the only place a real
 * raycast exists.
 *
 * The second is this one, and it is the half that decides whether the unit
 * *moves*: once the click does resolve to the occupied square, MOVE1 has to turn
 * that into a legal walk rather than into nothing. It does — these are the tests
 * that say so, because "clicking someone selects their tile" would be a hollow
 * fix if selecting an occupied tile then produced an empty path.
 *
 * MV2 is the rule underneath: a unit may be moved *through* but never *ended*
 * on, so an occupied square is reachable and simply not a legal stop.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 9, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 4 }], [{ x: 13, y: 4 }]],
};

const mkUnit = (unitId: string, owner: 0 | 1, x: number, y: number): UnitState => ({
  unitId, characterId: 'c', owner, pos: { x, y }, hp: 100, maxHp: 100, energy: 0,
  alive: true, respawnIn: 0, cooldowns: {}, statuses: [], catalysts: [], catalystsUsed: [],
});
const state = (units: UnitState[]): GameState => ({
  turn: 1, units, traps: [], delayed: [], decoys: [], powerups: [], lastKnown: [],
  kills: [0, 0], format: '2v2', status: 'active', suddenDeath: false,
});

/** The mover at (2,4) and somebody standing four squares east of it. */
const scene = (occupantOwner: 0 | 1) => {
  const mover = mkUnit('mover', 0, 2, 4);
  const s = state([mover, mkUnit('other', occupantOwner, 6, 4)]);
  return { s, mover, target: { x: 6, y: 4 } };
};

describe('BODY-CLICK: clicking an occupied tile still moves the unit', () => {
  it('an ENEMY-occupied target yields a non-empty path', () => {
    const { s, mover, target } = scene(1);
    const path = pathTo(OPEN, s, mover, target, movementBudget(mover, false));
    expect(path.length, 'the click produced no move at all — the owner\'s report').toBeGreaterThan(0);
  });

  it('an ALLY-occupied target yields one too', () => {
    // The likelier case in a 2v2: a seat controls two characters and clicks the
    // other one. Allies are pass-through, not walls.
    const { s, mover, target } = scene(0);
    expect(pathTo(OPEN, s, mover, target, movementBudget(mover, false)).length).toBeGreaterThan(0);
  });

  it('and it stops on the nearest legal square rather than on the body', () => {
    const { s, mover, target } = scene(1);
    const path = pathTo(OPEN, s, mover, target, movementBudget(mover, false));
    const end = path.at(-1)!;
    expect(end, 'ended on top of the occupant').not.toEqual(target);
    expect(distance(end, target), 'stopped further away than it had to').toBe(1);
  });

  it('the occupied square is reachable, just not a legal stop (MV2)', () => {
    // The distinction the whole item rests on. If an occupant made its square
    // *unreachable*, the route would bend around a body instead of stopping at
    // it, and no click could ever produce a sensible move toward one.
    const { s, mover, target } = scene(1);
    const squares = reachableSquares(buildBoard(OPEN), s, mover, movementBudget(mover, false));
    const tile = squares.find((r) => r.pos.x === target.x && r.pos.y === target.y);
    expect(tile, 'the occupied square dropped out of reach entirely').toBeDefined();
    expect(tile!.canStop).toBe(false);
  });

  it('the preview agrees with the commit — the tile is not offered as a stop', () => {
    // What the player is shown before the click has to match what the click
    // does, or the fix trades one confusion for another.
    const { s, mover, target } = scene(1);
    const { stops } = movePreview(OPEN, s, mover, false);
    expect(stops.some((p) => p.x === target.x && p.y === target.y)).toBe(false);
    expect(stops.some((p) => distance(p, target) === 1), 'nowhere beside it either').toBe(true);
  });

  it('a body out of reach still walks as far toward it as the budget allows', () => {
    // MOVE1's rule, applied to the new selection: clicking somebody across the
    // board is "go at them", not "do nothing".
    const mover = mkUnit('mover', 0, 2, 4);
    const s = state([mover, mkUnit('other', 1, 13, 4)]);
    const path = pathTo(OPEN, s, mover, { x: 13, y: 4 }, movementBudget(mover, false));
    expect(path).toHaveLength(MOVE_RANGE);
    expect(path.at(-1)).toEqual({ x: 2 + MOVE_RANGE, y: 4 });
  });

  it('clicking your OWN body is still a hold, not a move', () => {
    // The one click on a body that must not produce a path. It resolves to the
    // mover's own square now that bodies are pickable, and `pathTo` reads that
    // as the deliberate stand-still it has always been.
    const { s, mover } = scene(1);
    expect(pathTo(OPEN, s, mover, mover.pos, movementBudget(mover, false))).toEqual([]);
  });
});
