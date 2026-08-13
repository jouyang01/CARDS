import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import { reachableSquares, validateMovePath } from '../src/movement.js';
import { buildVision, canSee, teamCanSee, visibleEnemiesForTeam, visibleSquaresForTeam } from '../src/vision.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { GameState, Vec2 } from '../src/types.js';

const OPEN = (n: number) => makeMap(Array.from({ length: n }, () => '.'.repeat(n)));
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

describe('movement pass-through (MV2 — AR model)', () => {
  //  0123456
  // 1 mover u at 0; ally a at 1
  const board = () => buildBoard(makeMap(['#######', '.......', '#######']));
  const mover = makeUnit('u', 0, { x: 0, y: 1 });
  const ally = makeUnit('a', 0, { x: 1, y: 1 });

  it('a path may pass through an ally', () => {
    const check = validateMovePath(board(), makeState([mover, ally]), mover, [{ x: 1, y: 1 }, { x: 2, y: 1 }]);
    expect(check).toEqual({ valid: true, cost: 2 });
  });

  it('but may not end on an ally', () => {
    const check = validateMovePath(board(), makeState([mover, ally]), mover, [{ x: 1, y: 1 }]);
    expect(check).toEqual({ valid: false, error: { code: 'occupied', index: 0 } });
  });

  it('an enemy is now walk-through too (MV2): a path may cross it, not end on it', () => {
    const enemy = makeUnit('e', 1, { x: 1, y: 1 });
    // Crossing the enemy is legal…
    expect(validateMovePath(board(), makeState([mover, enemy]), mover, [{ x: 1, y: 1 }, { x: 2, y: 1 }])).toEqual({ valid: true, cost: 2 });
    // …ending on it is not.
    expect(validateMovePath(board(), makeState([mover, enemy]), mover, [{ x: 1, y: 1 }])).toEqual({ valid: false, error: { code: 'occupied', index: 0 } });
    // reachability now gets past the enemy (that square just isn't a legal stop)
    const out = reachableSquares(board(), makeState([mover, enemy]), mover, 4);
    expect(out.filter((s) => s.canStop).map((s) => `${s.pos.x},${s.pos.y}`).sort()).toEqual(['2,1', '3,1', '4,1']);
  });

  it('only walls/cover/edge block a path outright', () => {
    // mover boxed by walls above/below; a wall at the far end still blocks.
    const walled = () => buildBoard(makeMap(['#######', '....#..', '#######']));
    const m = makeUnit('u', 0, { x: 0, y: 1 });
    expect(reachableSquares(walled(), makeState([m]), m, 8).filter((s) => s.canStop).map((s) => `${s.pos.x},${s.pos.y}`).sort()).toEqual(['1,1', '2,1', '3,1']);
  });
});

describe('allied contested square (resolution)', () => {
  it('two allies moving to the same square both stop', () => {
    const a1 = makeUnit('a1', 0, { x: 0, y: 0 });
    const a2 = makeUnit('a2', 0, { x: 2, y: 0 });
    const { state } = resolveTurn(
      makeState([a1, a2]),
      OPEN(9),
      [{ team: 0, units: [{ unitId: 'a1', movePath: [{ x: 1, y: 0 }] }, { unitId: 'a2', movePath: [{ x: 1, y: 0 }] }] }, { team: 1, units: [] }],
      {} as Roster,
    );
    expect(unit(state, 'a1').pos).toEqual({ x: 0, y: 0 });
    expect(unit(state, 'a2').pos).toEqual({ x: 2, y: 0 });
  });
});

describe('team-shared vision', () => {
  it('a teammate grants the team vision of an enemy the other cannot see', () => {
    const board = buildBoard(OPEN(15));
    const vision = buildVision(board);
    const a1 = makeUnit('a1', 0, { x: 0, y: 0 });
    const a2 = makeUnit('a2', 0, { x: 10, y: 10 });
    const enemy = makeUnit('E', 1, { x: 12, y: 12 });
    const state = makeState([a1, a2, enemy]);

    expect(canSee(vision, a1, enemy)).toBe(false); // too far for a1 alone
    expect(canSee(vision, a2, enemy)).toBe(true); // a2 is within range
    expect(teamCanSee(vision, state, 0, enemy)).toBe(true); // shared across the team
    expect(teamCanSee(vision, state, 1, a1)).toBe(false); // enemy team sees neither of ours here
    expect(visibleEnemiesForTeam(vision, state, 0).map((u) => u.unitId)).toEqual(['E']);
  });

  it("the team's visible squares are the union of its members' fields of view", () => {
    const board = buildBoard(OPEN(15));
    const vision = buildVision(board);
    const a1 = makeUnit('a1', 0, { x: 0, y: 0 });
    const a2 = makeUnit('a2', 0, { x: 14, y: 14 });
    const state = makeState([a1, a2]);
    const squares = visibleSquaresForTeam(vision, state, 0);
    const has = (p: Vec2) => squares.some((s) => s.x === p.x && s.y === p.y);
    expect(has({ x: 1, y: 1 })).toBe(true); // near a1
    expect(has({ x: 13, y: 13 })).toBe(true); // near a2
    expect(has({ x: 7, y: 7 })).toBe(false); // middle — beyond either's 6-square range
  });
});
