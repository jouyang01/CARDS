import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import { validateOrders, type OrderErrorCode } from '../src/orders.js';
import { ULT_COST } from '../src/constants.js';
import { dummyRoster, makeDummy, makeMap, makeState } from './helpers.js';
import type { GameState, PlayerOrders, UnitOrders, Vec2 } from '../src/types.js';

const board = buildBoard(makeMap(Array.from({ length: 9 }, () => '.'.repeat(9))));
const roster = dummyRoster();

/** Player 0 owns u0 at (0,0); player 1 owns u1 at (8,8). */
function scene(over0: Partial<GameState> = {}): GameState {
  return makeState(
    [makeDummy('u0', 0, { x: 0, y: 0 }), makeDummy('u1', 1, { x: 8, y: 8 })],
    over0,
  );
}

function orders(p0: UnitOrders[], p1: UnitOrders[] = []): [PlayerOrders, PlayerOrders] {
  return [
    { player: 0, units: p0 },
    { player: 1, units: p1 },
  ];
}

const codes = (state: GameState, o: [PlayerOrders, PlayerOrders]): OrderErrorCode[] =>
  validateOrders(board, state, roster, o).map((e) => e.code);

describe('validateOrders — legal orders', () => {
  it('accepts an ability plus a move within budget', () => {
    const o = orders([
      { unitId: 'u0', ability: { abilityId: 'blast_shot', target: [{ x: 3, y: 0 }] }, movePath: [{ x: 1, y: 0 }, { x: 2, y: 0 }] },
    ]);
    expect(validateOrders(board, scene(), roster, o)).toEqual([]);
  });

  it('accepts a sprint with no ability', () => {
    const path: Vec2[] = [1, 2, 3, 4, 5, 6, 7, 8].map((x) => ({ x, y: 0 })); // 8 = SPRINT_RANGE
    const o = orders([{ unitId: 'u0', sprint: true, movePath: path }]);
    expect(validateOrders(board, scene(), roster, o)).toEqual([]);
  });

  it('accepts a self ability with no target', () => {
    const o = orders([{ unitId: 'u0', ability: { abilityId: 'prep_stance', target: [] } }]);
    expect(validateOrders(board, scene(), roster, o)).toEqual([]);
  });

  it('accepts a hold (no ability, no move)', () => {
    expect(validateOrders(board, scene(), roster, orders([{ unitId: 'u0' }]))).toEqual([]);
  });
});

describe('validateOrders — ownership and identity', () => {
  it('rejects an unknown unit', () => {
    expect(codes(scene(), orders([{ unitId: 'ghost' }]))).toEqual(['unknownUnit']);
  });

  it("rejects ordering the opponent's unit", () => {
    expect(codes(scene(), orders([{ unitId: 'u1' }]))).toEqual(['notYourUnit']);
  });

  it('rejects the same unit ordered twice by one player', () => {
    expect(codes(scene(), orders([{ unitId: 'u0' }, { unitId: 'u0' }]))).toEqual(['duplicateOrder']);
  });

  it('rejects a dead unit that is told to act', () => {
    const state = makeState([makeDummy('u0', 0, { x: 0, y: 0 }, { alive: false }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    expect(codes(state, orders([{ unitId: 'u0', movePath: [{ x: 1, y: 0 }] }]))).toEqual(['deadUnit']);
  });
});

describe('validateOrders — abilities', () => {
  it('rejects an ability the character does not have', () => {
    expect(codes(scene(), orders([{ unitId: 'u0', ability: { abilityId: 'nope', target: [{ x: 1, y: 0 }] } }]))).toEqual(['unknownAbility']);
  });

  it('rejects sprint combined with an ability', () => {
    const o = orders([{ unitId: 'u0', sprint: true, ability: { abilityId: 'blast_shot', target: [{ x: 3, y: 0 }] } }]);
    expect(codes(scene(), o)).toEqual(['sprintWithAbility']);
  });

  it('rejects an ability still on cooldown', () => {
    const state = makeState([makeDummy('u0', 0, { x: 0, y: 0 }, { cooldowns: { slow_bomb: 2 } }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    expect(codes(state, orders([{ unitId: 'u0', ability: { abilityId: 'slow_bomb', target: [{ x: 2, y: 0 }] } }]))).toEqual(['abilityOnCooldown']);
  });

  it('rejects the ultimate below full energy, accepts it at ULT_COST', () => {
    const ult = orders([{ unitId: 'u0', ability: { abilityId: 'ult_beam', target: [{ x: 4, y: 0 }] } }]);
    const poor = makeState([makeDummy('u0', 0, { x: 0, y: 0 }, { energy: ULT_COST - 1 }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    const rich = makeState([makeDummy('u0', 0, { x: 0, y: 0 }, { energy: ULT_COST }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    expect(codes(poor, ult)).toEqual(['notEnoughEnergy']);
    expect(validateOrders(board, rich, roster, ult)).toEqual([]);
  });

  it('rejects a non-self ability with a missing or out-of-bounds target', () => {
    expect(codes(scene(), orders([{ unitId: 'u0', ability: { abilityId: 'blast_shot', target: [] } }]))).toEqual(['badTarget']);
    expect(codes(scene(), orders([{ unitId: 'u0', ability: { abilityId: 'blast_shot', target: [{ x: 99, y: 0 }] } }]))).toEqual(['badTarget']);
  });
});

describe('validateOrders — move paths', () => {
  it('rejects a path that exceeds the move budget, carrying the underlying code', () => {
    // 5 squares with an ability present > MOVE_RANGE (4).
    const path: Vec2[] = [1, 2, 3, 4, 5].map((x) => ({ x, y: 0 }));
    const errors = validateOrders(board, scene(), roster, orders([{ unitId: 'u0', movePath: path }]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'badMovePath', detail: 'exceedsBudget' });
  });

  it('rejects a non-orthogonal step', () => {
    const errors = validateOrders(board, scene(), roster, orders([{ unitId: 'u0', movePath: [{ x: 1, y: 1 }] }]));
    expect(errors[0]).toMatchObject({ code: 'badMovePath', detail: 'notOrthogonal' });
  });
});

describe('validateOrders — determinism and completeness', () => {
  it('reports every independent problem across both players, in scan order', () => {
    const o = orders(
      [{ unitId: 'ghost' }, { unitId: 'u0', ability: { abilityId: 'nope', target: [{ x: 1, y: 0 }] } }],
      [{ unitId: 'u1', sprint: true, ability: { abilityId: 'blast_shot', target: [{ x: 7, y: 8 }] } }],
    );
    const errors = validateOrders(board, scene(), roster, o);
    expect(errors.map((e) => `${e.player}:${e.unitId}:${e.code}`)).toEqual([
      '0:ghost:unknownUnit',
      '0:u0:unknownAbility',
      '1:u1:sprintWithAbility',
    ]);
  });

  it('is a pure function of its inputs — identical calls, identical result', () => {
    const o = orders([{ unitId: 'u0', ability: { abilityId: 'nope', target: [{ x: 1, y: 0 }] } }]);
    expect(validateOrders(board, scene(), roster, o)).toEqual(validateOrders(board, scene(), roster, o));
  });
});
