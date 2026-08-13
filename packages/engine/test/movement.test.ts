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

/**
 * The MV3 cost oracle: minimum movement cost to (dx, dy) on open ground.
 * Orthogonal steps cost 1; using `min(|dx|,|dy|)` diagonals (each 1,2,1,2…) is
 * always optimal, giving `max + floor(min / 2)`.
 */
const stepCost = (dx: number, dy: number): number => {
  const a = Math.abs(dx);
  const b = Math.abs(dy);
  return Math.max(a, b) + Math.floor(Math.min(a, b) / 2);
};

/** Every non-origin square of an open `w`×`h` map reachable within `budget` of (cx,cy). */
const openReach = (budget: number, cx: number, cy: number, w: number, h: number): string[] => {
  const out: string[] = [];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (x === cx && y === cy) continue;
      if (stepCost(x - cx, y - cy) <= budget) out.push(vecKey({ x, y }));
    }
  }
  return out.sort();
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

describe('reachableSquares on open ground (8-direction, MV3)', () => {
  it('covers exactly the cost oracle region on a 4-budget move', () => {
    const board = buildBoard(openMap(9));
    const unit = makeUnit('u', 0, { x: 4, y: 4 });
    const out = reachableSquares(board, makeState([unit]), unit, movementBudget(unit));

    expect(keys(out).sort()).toEqual(openReach(4, 4, 4, 9, 9));
    expect(keys(out)).not.toContain('4,4');
    expect(out.every((s) => s.cost >= 1 && s.cost <= 4)).toBe(true);
    // Reported cost is the true min movement cost to each square.
    for (const s of out) expect(s.cost).toBe(stepCost(s.pos.x - 4, s.pos.y - 4));
  });

  it('covers the cost oracle region when sprinting (budget 8)', () => {
    const board = buildBoard(openMap(17));
    const unit = makeUnit('u', 0, { x: 8, y: 8 });
    const out = reachableSquares(board, makeState([unit]), unit, movementBudget(unit, true));
    expect(keys(out).sort()).toEqual(openReach(8, 8, 8, 17, 17));
  });

  it('a single diagonal reaches Manhattan-5 on a 4-budget move ("5 instead of 4")', () => {
    const board = buildBoard(openMap(11));
    const unit = makeUnit('u', 0, { x: 5, y: 5 });
    const out = reachableSquares(board, makeState([unit]), unit, movementBudget(unit));
    const far = out.find((s) => vecKey(s.pos) === '6,1'); // dx 1, dy 4 → cost 4, Manhattan 5
    expect(far?.cost).toBe(4);
  });

  it('diagonal costs run 1, 2, 1, 2 along a path', () => {
    const board = buildBoard(openMap(11));
    const unit = makeUnit('u', 0, { x: 5, y: 5 });
    const out = reachableSquares(board, makeState([unit]), unit, movementBudget(unit, true));
    const cost = (k: string) => out.find((s) => vecKey(s.pos) === k)!.cost;
    expect(cost('6,6')).toBe(1); // 1 diagonal
    expect(cost('7,7')).toBe(3); // +2 for the 2nd diagonal
    expect(cost('8,8')).toBe(4); // +1 for the 3rd
    expect(cost('9,9')).toBe(6); // +2 for the 4th
  });

  it('is clipped by the map edge', () => {
    const board = buildBoard(openMap(9));
    const unit = makeUnit('u', 0, { x: 0, y: 0 });
    const out = reachableSquares(board, makeState([unit]), unit, 4);
    expect(keys(out).sort()).toEqual(openReach(4, 0, 0, 9, 9));
    expect(keys(out)).not.toContain('-1,0');
  });

  it('Haste and Slow change what is reachable', () => {
    const base = makeUnit('u', 0, { x: 7, y: 7 });
    const hasted = withStatuses(base, status('haste', 1));
    const slowed = withStatuses(base, status('slow', 1));
    const reach = (u: typeof base) =>
      keys(reachableSquares(buildBoard(openMap(15)), makeState([u]), u, movementBudget(u))).sort();
    expect(reach(base)).toEqual(openReach(4, 7, 7, 15, 15));
    expect(reach(hasted)).toEqual(openReach(6, 7, 7, 15, 15));
    expect(reach(slowed)).toEqual(openReach(2, 7, 7, 15, 15));
    expect(reachableSquares(buildBoard(openMap(15)), makeState([base]), base, 0)).toEqual([]);
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

describe('diagonal corner-cutting past solids is forbidden', () => {
  //  0123
  // 0....
  // 1.u#.
  // 2.#..
  // 3....
  const pocket = () => buildBoard(makeMap(['....', '..#.', '.#..', '....']));
  const origin: Vec2 = { x: 1, y: 1 };

  it('the corner-blocked diagonal neighbour costs a 6-step detour, not 1', () => {
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

  it('and a submitted corner-cutting diagonal step is rejected', () => {
    const unit = makeUnit('u', 0, origin);
    const check = validateMovePath(pocket(), makeState([unit]), unit, [{ x: 2, y: 2 }]);
    expect(check).toEqual({ valid: false, error: { code: 'cornerBlocked', index: 0 } });
  });

  it('a diagonal into an open square is still blocked if either flank is solid', () => {
    //  012
    // 0.#.   wall at (1,0) — one flank of the (0,0)→(1,1) diagonal
    // 1...
    // 2...
    const board = buildBoard(makeMap(['.#.', '...', '...']));
    const unit = makeUnit('u', 0, { x: 0, y: 0 });
    // Destination (1,1) is open, but the flank (1,0) is a wall → corner-cut blocked.
    expect(validateMovePath(board, makeState([unit]), unit, [{ x: 1, y: 1 }])).toEqual({
      valid: false,
      error: { code: 'cornerBlocked', index: 0 },
    });
    // The open orthogonal detour to (1,1) still works and costs 2.
    expect(validateMovePath(board, makeState([unit]), unit, [{ x: 0, y: 1 }, { x: 1, y: 1 }])).toEqual({
      valid: true,
      cost: 2,
    });
  });

  it('an open diagonal (no solid on either side) is legal and costs 1', () => {
    const board = buildBoard(openMap(5));
    const unit = makeUnit('u', 0, { x: 2, y: 2 });
    expect(validateMovePath(board, makeState([unit]), unit, [{ x: 3, y: 3 }])).toEqual({
      valid: true,
      cost: 1,
    });
  });
});

describe('units block each other', () => {
  //  0123456
  // 0#######
  // 1..E....   (E at x=2)
  // 2#######
  const corridor = () => buildBoard(makeMap(['#######', '.......', '#######']));
  const mover = makeUnit('u', 0, { x: 0, y: 1 });

  it('any unit — ally or enemy — may be passed through but not stopped on (MV2)', () => {
    for (const owner of [0, 1] as const) {
      const other = makeUnit('o', owner, { x: 2, y: 1 });
      const out = reachableSquares(corridor(), makeState([mover, other]), mover, 4);
      // Reaches past the unit; that square itself is not a legal stop.
      expect(keys(out)).toEqual(['1,1', '2,1', '3,1', '4,1']);
      const stoppable = out.filter((s) => s.canStop).map((s) => `${s.pos.x},${s.pos.y}`).sort();
      expect(stoppable).toEqual(['1,1', '3,1', '4,1']);
      expect(out.find((s) => s.pos.x === 2 && s.pos.y === 1)!.canStop).toBe(false);
    }
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

  it('accepts a legal 4-step orthogonal path and reports its cost', () => {
    expect(
      check([
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ]),
    ).toEqual({ valid: true, cost: 4 });
  });

  it('accepts a diagonal path and charges every second diagonal 2 (MV3)', () => {
    // Two diagonals then an orthogonal, over open ground: 1 + 2 + 1 = cost 4.
    expect(
      check([
        { x: 1, y: 1 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ]),
    ).toEqual({ valid: true, cost: 4 });
  });

  it('rejects a 5th orthogonal step without sprint but allows 8 with it', () => {
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
      error: { code: 'notAdjacent', index: 0 },
    });
    expect(check([{ x: 1, y: 0 }, { x: 3, y: 0 }])).toEqual({
      valid: false,
      error: { code: 'notAdjacent', index: 1 },
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
  it('every reported stop-square has a legal reconstructed path of exactly that cost', () => {
    const map = duelArena as unknown as MapDef;
    const board = buildBoard(map);
    const unit = makeUnit('u', 0, { x: 1, y: 7 });
    const enemy = makeUnit('e', 1, { x: 5, y: 7 });
    const state = makeState([unit, enemy]);
    const out = reachableSquares(board, state, unit, movementBudget(unit, true));

    expect(out.length).toBeGreaterThan(20);
    for (const square of out.filter((s) => s.canStop)) {
      // A legal endpoint (canStop) must have a reconstructed path whose validated
      // cost matches the reported reachable cost — the coherence guarantee. The
      // path may pass *through* the enemy square (MV2), just not end on it.
      const path = reconstructPath(out, unit.pos, square.pos);
      expect(path, `no path to ${vecKey(square.pos)}`).not.toBeNull();
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
