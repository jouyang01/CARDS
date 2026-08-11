import { describe, expect, it } from 'vitest';
import { buildBoard, vecKey } from '../src/board.js';
import {
  movementBudget,
  occupiedSquares,
  reachableSquares,
  reconstructPath,
  validateMovePath,
} from '../src/movement.js';
import { MOVE_RANGE, SPRINT_RANGE } from '../src/constants.js';
import { keys, makeMap, makeState, makeUnit, status, withStatuses } from './helpers.js';
import type { MapDef, Vec2 } from '../src/types.js';
import duelArena from '../../../data/maps/duel-arena.json';

/** An n×n arena with no terrain. */
const openMap = (n: number): MapDef => makeMap(Array.from({ length: n }, () => '.'.repeat(n)));

/** Squares strictly within `r` orthogonal steps of centre, excluding centre. */
const diamondCount = (r: number): number => {
  let total = 0;
  for (let d = 1; d <= r; d++) total += 4 * d;
  return total;
};

describe('movementBudget', () => {
  const unit = makeUnit('u', 0, { x: 0, y: 0 });

  it('is 4 with an ability and 8 when sprinting', () => {
    expect(movementBudget(unit)).toBe(MOVE_RANGE);
    expect(movementBudget(unit, false)).toBe(4);
    expect(movementBudget(unit, true)).toBe(SPRINT_RANGE);
    expect(movementBudget(unit, true)).toBe(8);
  });

  it('Haste is +50% round down: 4→6, 8→12', () => {
    const hasted = withStatuses(unit, status('haste', 2));
    expect(movementBudget(hasted)).toBe(6);
    expect(movementBudget(hasted, true)).toBe(12);
  });

  it('Slow is −50% round down: 4→2, 8→4', () => {
    const slowed = withStatuses(unit, status('slow', 2));
    expect(movementBudget(slowed)).toBe(2);
    expect(movementBudget(slowed, true)).toBe(4);
  });

  it('Haste and Slow together net out to the base budget (single round-down)', () => {
    const both = withStatuses(unit, status('haste', 1), status('slow', 1));
    expect(movementBudget(both)).toBe(4);
    expect(movementBudget(both, true)).toBe(8);
  });

  it('expired statuses (remaining 0) do not modify the budget', () => {
    expect(movementBudget(withStatuses(unit, status('haste', 0)))).toBe(4);
    expect(movementBudget(withStatuses(unit, status('root', 0)))).toBe(4);
  });

  it('Root removes Move-phase movement entirely', () => {
    const rooted = withStatuses(unit, status('root', 1));
    expect(movementBudget(rooted)).toBe(0);
    expect(movementBudget(rooted, true)).toBe(0);
  });

  it('dead units have no movement', () => {
    expect(movementBudget({ ...unit, alive: false }, true)).toBe(0);
  });

  it('returns integers for every status combination', () => {
    for (const haste of [false, true]) {
      for (const slow of [false, true]) {
        for (const sprint of [false, true]) {
          const s = [
            ...(haste ? [status('haste', 1)] : []),
            ...(slow ? [status('slow', 1)] : []),
          ];
          expect(Number.isInteger(movementBudget(withStatuses(unit, ...s), sprint))).toBe(true);
        }
      }
    }
  });
});

describe('reachableSquares on open ground', () => {
  it('covers exactly the 4-step diamond, origin excluded', () => {
    const board = buildBoard(openMap(9));
    const unit = makeUnit('u', 0, { x: 4, y: 4 });
    const state = makeState([unit]);
    const out = reachableSquares(board, state, unit, movementBudget(unit));

    expect(out).toHaveLength(diamondCount(4)); // 4+8+12+16 = 40
    expect(keys(out)).not.toContain('4,4');
    expect(out.every((s) => s.cost >= 1 && s.cost <= 4)).toBe(true);
    // cost is the true step distance
    for (const s of out) {
      expect(s.cost).toBe(Math.abs(s.pos.x - 4) + Math.abs(s.pos.y - 4));
    }
  });

  it('covers the 8-step diamond when sprinting', () => {
    const board = buildBoard(openMap(17));
    const unit = makeUnit('u', 0, { x: 8, y: 8 });
    const state = makeState([unit]);
    const out = reachableSquares(board, state, unit, movementBudget(unit, true));
    expect(out).toHaveLength(diamondCount(8)); // 144
  });

  it('is clipped by the map edge', () => {
    const board = buildBoard(openMap(9));
    const unit = makeUnit('u', 0, { x: 0, y: 0 });
    const state = makeState([unit]);
    const out = reachableSquares(board, state, unit, 4);
    expect(out).toHaveLength(14); // one quadrant of the diamond
    expect(keys(out)).not.toContain('-1,0');
  });

  it('Haste and Slow change what is reachable', () => {
    const board = buildBoard(openMap(15));
    const base = makeUnit('u', 0, { x: 7, y: 7 });
    const hasted = withStatuses(base, status('haste', 1));
    const slowed = withStatuses(base, status('slow', 1));
    const count = (u: typeof base) =>
      reachableSquares(buildBoard(openMap(15)), makeState([u]), u, movementBudget(u)).length;
    expect(count(base)).toBe(diamondCount(4));
    expect(count(hasted)).toBe(diamondCount(6));
    expect(count(slowed)).toBe(diamondCount(2));
    expect(reachableSquares(board, makeState([base]), base, 0)).toEqual([]);
  });

  it('a rooted unit can reach nothing', () => {
    const board = buildBoard(openMap(9));
    const rooted = withStatuses(makeUnit('u', 0, { x: 4, y: 4 }), status('root', 1));
    expect(reachableSquares(board, makeState([rooted]), rooted, movementBudget(rooted))).toEqual([]);
  });

  it('is deterministic: identical inputs give an identical ordered result', () => {
    const build = () => {
      const board = buildBoard(duelArena as unknown as MapDef);
      const unit = makeUnit('u', 0, { x: 1, y: 7 });
      const enemy = makeUnit('e', 1, { x: 13, y: 7 });
      return reachableSquares(board, makeState([unit, enemy]), unit, 8);
    };
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe('terrain blocks movement and pass-through', () => {
  //  0123456
  // 0#######
  // 1.......
  // 2#######
  const corridor = () => buildBoard(makeMap(['#######', '.......', '#######']));

  it('walls confine a unit to the open corridor', () => {
    const unit = makeUnit('u', 0, { x: 0, y: 1 });
    const out = reachableSquares(corridor(), makeState([unit]), unit, 4);
    expect(keys(out)).toEqual(['1,1', '2,1', '3,1', '4,1']);
  });

  it('cover blocks movement and pass-through just like a wall', () => {
    const board = buildBoard(makeMap(['#######', '..o....', '#######']));
    const unit = makeUnit('u', 0, { x: 0, y: 1 });
    const out = reachableSquares(board, makeState([unit]), unit, 4);
    expect(keys(out)).toEqual(['1,1']);
  });

  it('brush is walkable', () => {
    const board = buildBoard(makeMap(['#######', '..b....', '#######']));
    const unit = makeUnit('u', 0, { x: 0, y: 1 });
    const out = reachableSquares(board, makeState([unit]), unit, 4);
    expect(keys(out)).toEqual(['1,1', '2,1', '3,1', '4,1']);
  });
});

describe('no diagonal corner-cutting', () => {
  //  0123
  // 0....
  // 1.u#.
  // 2.#..
  // 3....
  const pocket = () => buildBoard(makeMap(['....', '..#.', '.#..', '....']));
  const origin: Vec2 = { x: 1, y: 1 };

  it('the diagonally adjacent square costs 6 steps, not 1', () => {
    const unit = makeUnit('u', 0, origin);
    const sprintReach = reachableSquares(pocket(), makeState([unit]), unit, 8);
    const corner = sprintReach.find((s) => vecKey(s.pos) === '2,2');
    expect(corner?.cost).toBe(6);
  });

  it('so it is out of reach on a normal 4-square move', () => {
    const unit = makeUnit('u', 0, origin);
    const out = reachableSquares(pocket(), makeState([unit]), unit, movementBudget(unit));
    expect(keys(out)).not.toContain('2,2');
  });

  it('and a submitted diagonal step is rejected outright', () => {
    const unit = makeUnit('u', 0, origin);
    const check = validateMovePath(pocket(), makeState([unit]), unit, [{ x: 2, y: 2 }]);
    expect(check).toEqual({ valid: false, error: { code: 'notOrthogonal', index: 0 } });
  });
});

describe('units block each other', () => {
  //  0123456
  // 0#######
  // 1..E....   (E at x=2)
  // 2#######
  const corridor = () => buildBoard(makeMap(['#######', '.......', '#######']));
  const mover = makeUnit('u', 0, { x: 0, y: 1 });

  it('an enemy blocks entry and pass-through', () => {
    const enemy = makeUnit('e', 1, { x: 2, y: 1 });
    const out = reachableSquares(corridor(), makeState([mover, enemy]), mover, 4);
    expect(keys(out)).toEqual(['1,1']);
  });

  it('an ally blocks too (edge-cases: no pass-through in v1)', () => {
    const ally = makeUnit('a', 0, { x: 2, y: 1 });
    const out = reachableSquares(corridor(), makeState([mover, ally]), mover, 4);
    expect(keys(out)).toEqual(['1,1']);
  });

  it('a dead unit blocks nothing', () => {
    const corpse = makeUnit('e', 1, { x: 2, y: 1 }, { alive: false, hp: 0 });
    const out = reachableSquares(corridor(), makeState([mover, corpse]), mover, 4);
    expect(keys(out)).toEqual(['1,1', '2,1', '3,1', '4,1']);
  });

  it('the mover never blocks itself', () => {
    expect(occupiedSquares(makeState([mover]), mover.unitId).size).toBe(0);
    expect(occupiedSquares(makeState([mover])).has('0,1')).toBe(true);
  });
});

describe('validateMovePath', () => {
  const board = buildBoard(makeMap(['.....', '.....', '..#..', '..o..', '.....']));
  const unit = makeUnit('u', 0, { x: 0, y: 0 });
  const state = makeState([unit]);
  const check = (path: Vec2[], sprint = false) =>
    validateMovePath(board, state, unit, path, sprint);

  it('accepts an empty path as holding position', () => {
    expect(check([])).toEqual({ valid: true, cost: 0 });
  });

  it('accepts a legal 4-step path and reports its cost', () => {
    expect(
      check([
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ]),
    ).toEqual({ valid: true, cost: 4 });
  });

  it('rejects a 5th step without sprint but allows 8 with it', () => {
    const five: Vec2[] = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
    ];
    expect(check(five)).toEqual({
      valid: false,
      error: { code: 'exceedsBudget', budget: 4, cost: 5 },
    });
    const eight: Vec2[] = [...five, { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 }];
    expect(check(eight, true)).toEqual({ valid: true, cost: 8 });
    expect(check([...eight, { x: 3, y: 4 }], true)).toEqual({
      valid: false,
      error: { code: 'exceedsBudget', budget: 8, cost: 9 },
    });
  });

  it('rejects a teleporting (non-adjacent) step', () => {
    expect(check([{ x: 0, y: 2 }])).toEqual({
      valid: false,
      error: { code: 'notOrthogonal', index: 0 },
    });
    expect(check([{ x: 1, y: 0 }, { x: 3, y: 0 }])).toEqual({
      valid: false,
      error: { code: 'notOrthogonal', index: 1 },
    });
  });

  it('rejects stepping off the map', () => {
    expect(check([{ x: 0, y: -1 }])).toEqual({
      valid: false,
      error: { code: 'outOfBounds', index: 0 },
    });
  });

  it('rejects walking into a wall or into cover, naming the terrain', () => {
    const toWall: Vec2[] = [
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ];
    expect(check(toWall)).toEqual({
      valid: false,
      error: { code: 'blockedTerrain', index: 3, terrain: 'wall' },
    });
    const toCover: Vec2[] = [
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
    ];
    expect(check(toCover, true)).toEqual({
      valid: false,
      error: { code: 'blockedTerrain', index: 4, terrain: 'cover' },
    });
  });

  it('rejects walking onto another unit', () => {
    const enemy = makeUnit('e', 1, { x: 2, y: 0 });
    const withEnemy = makeState([unit, enemy]);
    expect(validateMovePath(board, withEnemy, unit, [{ x: 1, y: 0 }, { x: 2, y: 0 }])).toEqual({
      valid: false,
      error: { code: 'occupied', index: 1 },
    });
  });

  it('rejects any path from a rooted or dead unit', () => {
    const rooted = withStatuses(unit, status('root', 1));
    expect(validateMovePath(board, makeState([rooted]), rooted, [{ x: 1, y: 0 }])).toEqual({
      valid: false,
      error: { code: 'rooted' },
    });
    const dead = { ...unit, alive: false, hp: 0 };
    expect(validateMovePath(board, makeState([dead]), dead, [{ x: 1, y: 0 }])).toEqual({
      valid: false,
      error: { code: 'notMovable' },
    });
    // holding position is still fine
    expect(validateMovePath(board, makeState([rooted]), rooted, [])).toEqual({
      valid: true,
      cost: 0,
    });
  });

  it('honours a Haste-extended budget', () => {
    const hasted = withStatuses(unit, status('haste', 1));
    const six: Vec2[] = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 4, y: 2 },
    ];
    expect(validateMovePath(board, makeState([hasted]), hasted, six)).toEqual({
      valid: true,
      cost: 6,
    });
  });
});

describe('reachability and path validation agree', () => {
  it('every square BFS reports has a legal reconstructed path of exactly that cost', () => {
    const map = duelArena as unknown as MapDef;
    const board = buildBoard(map);
    const unit = makeUnit('u', 0, { x: 1, y: 7 });
    const enemy = makeUnit('e', 1, { x: 5, y: 7 });
    const state = makeState([unit, enemy]);
    const out = reachableSquares(board, state, unit, movementBudget(unit, true));

    expect(out.length).toBeGreaterThan(20);
    for (const square of out) {
      const path = reconstructPath(out, unit.pos, square.pos);
      expect(path, `no path to ${vecKey(square.pos)}`).not.toBeNull();
      expect(path).toHaveLength(square.cost);
      expect(validateMovePath(board, state, unit, path!, true)).toEqual({
        valid: true,
        cost: square.cost,
      });
      expect(path![path!.length - 1]).toEqual(square.pos);
    }
  });

  it('reconstructPath returns [] for the origin and null for an unreachable square', () => {
    const board = buildBoard(makeMap(['#######', '.......', '#######']));
    const unit = makeUnit('u', 0, { x: 0, y: 1 });
    const out = reachableSquares(board, makeState([unit]), unit, 4);
    expect(reconstructPath(out, unit.pos, unit.pos)).toEqual([]);
    expect(reconstructPath(out, unit.pos, { x: 6, y: 1 })).toBeNull();
    expect(reconstructPath(out, unit.pos, { x: 0, y: 0 })).toBeNull(); // wall
  });
});
