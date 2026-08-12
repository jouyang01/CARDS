import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import {
  aimInRange,
  circleSquares,
  coneSquares,
  direction8,
  dominantCardinal,
  expandShape,
  lineSquares,
  sign,
} from '../src/shapes.js';
import { makeMap, posKeys } from './helpers.js';
import type { AbilityDef, Vec2 } from '../src/types.js';

const openBoard = (n: number) => buildBoard(makeMap(Array.from({ length: n }, () => '.'.repeat(n))));

/** Minimal ability stub; only the fields a shape reads need to be real. */
const ability = (over: Partial<AbilityDef>): AbilityDef => ({
  id: 'a',
  name: 'A',
  phase: 'blast',
  shape: 'line',
  range: 4,
  cooldown: 0,
  energyGain: 0,
  effects: [{ kind: 'damage', amount: 1 }],
  description: 'test',
  ...over,
});

describe('direction helpers', () => {
  it('sign is -1/0/1', () => {
    expect([sign(-9), sign(0), sign(9)]).toEqual([-1, 0, 1]);
  });

  it('direction8 yields the 8 compass unit steps', () => {
    const from = { x: 5, y: 5 };
    expect(direction8(from, { x: 9, y: 5 })).toEqual({ x: 1, y: 0 });
    expect(direction8(from, { x: 9, y: 9 })).toEqual({ x: 1, y: 1 });
    expect(direction8(from, { x: 2, y: 9 })).toEqual({ x: -1, y: 1 });
    expect(direction8(from, from)).toEqual({ x: 0, y: 0 });
  });

  it('dominantCardinal snaps to the larger axis, ties go horizontal', () => {
    const from = { x: 5, y: 5 };
    expect(dominantCardinal(from, { x: 9, y: 6 })).toEqual({ x: 1, y: 0 });
    expect(dominantCardinal(from, { x: 6, y: 1 })).toEqual({ x: 0, y: -1 });
    // |dx| == |dy| resolves to horizontal, deterministically
    expect(dominantCardinal(from, { x: 8, y: 8 })).toEqual({ x: 1, y: 0 });
  });
});

describe('lineSquares', () => {
  it('is a straight ray of exactly `range` squares, caster excluded', () => {
    const b = openBoard(11);
    const out = lineSquares(b, { x: 5, y: 5 }, { x: 1, y: 0 }, 3);
    expect(out).toEqual([
      { x: 6, y: 5 },
      { x: 7, y: 5 },
      { x: 8, y: 5 },
    ]);
  });

  it('walks diagonals too', () => {
    const b = openBoard(11);
    const out = lineSquares(b, { x: 5, y: 5 }, { x: 1, y: 1 }, 2);
    expect(out).toEqual([
      { x: 6, y: 6 },
      { x: 7, y: 7 },
    ]);
  });

  it('stops before the first wall but passes over cover', () => {
    //  0123456
    // 0..o#... wall at x=3, cover at x=2 on row 0
    const b = buildBoard(makeMap(['..o#...']));
    const out = lineSquares(b, { x: 0, y: 0 }, { x: 1, y: 0 }, 6);
    expect(posKeys(out)).toEqual(posKeys([{ x: 1, y: 0 }, { x: 2, y: 0 }])); // stops at wall x=3
  });

  it('is clipped by the board edge', () => {
    const b = openBoard(5);
    const out = lineSquares(b, { x: 3, y: 0 }, { x: 1, y: 0 }, 8);
    expect(out).toEqual([{ x: 4, y: 0 }]);
  });
});

describe('coneSquares', () => {
  it('expands by one square of half-width per depth step (east)', () => {
    const b = openBoard(11);
    const out = coneSquares(b, { x: 5, y: 5 }, { x: 1, y: 0 }, 2);
    // depth 1: (6,5); depth 2: (7,4),(7,5),(7,6)
    expect(posKeys(out)).toEqual(
      posKeys([
        { x: 6, y: 5 },
        { x: 7, y: 4 },
        { x: 7, y: 5 },
        { x: 7, y: 6 },
      ]),
    );
  });

  it('points the wedge along its cardinal (north)', () => {
    const b = openBoard(11);
    const out = coneSquares(b, { x: 5, y: 5 }, { x: 0, y: -1 }, 2);
    expect(posKeys(out)).toEqual(
      posKeys([
        { x: 5, y: 4 },
        { x: 4, y: 3 },
        { x: 5, y: 3 },
        { x: 6, y: 3 },
      ]),
    );
  });

  it('drops wall and off-board squares from the wedge', () => {
    const b = openBoard(2); // 2x2; a range-2 cone from a corner mostly falls off
    const out = coneSquares(b, { x: 0, y: 0 }, { x: 1, y: 0 }, 2);
    expect(posKeys(out)).toEqual(posKeys([{ x: 1, y: 0 }]));
  });
});

describe('circleSquares', () => {
  it('is a Euclidean disk, not a Chebyshev block', () => {
    const b = openBoard(11);
    const out = circleSquares(b, { x: 5, y: 5 }, 2);
    // radius-2 disk = 13 squares; the four corners (±2,±2) are excluded (8 > 4)
    expect(out).toHaveLength(13);
    expect(posKeys(out)).not.toContain('7,7');
    expect(posKeys(out)).toContain('5,7');
    expect(posKeys(out)).toContain('6,6'); // dist² = 2 ≤ 4
  });

  it('excludes wall squares and clips at the edge', () => {
    //  01234
    // 0.....
    // 1..#..  wall at (2,1) is centre-excluded
    const b = buildBoard(makeMap(['.....', '..#..', '.....', '.....', '.....']));
    const out = circleSquares(b, { x: 2, y: 2 }, 1);
    // radius-1 disk around (2,2) = 5 squares, minus the wall at (2,1)
    expect(posKeys(out)).toEqual(posKeys([{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }]));
  });
});

describe('expandShape', () => {
  const b = openBoard(11);
  const caster: Vec2 = { x: 5, y: 5 };

  it('self ignores the aim and returns the caster square', () => {
    expect(expandShape(b, ability({ shape: 'self', range: 0 }), caster, [])).toEqual([caster]);
  });

  it('square returns the single aimed square when in bounds', () => {
    expect(expandShape(b, ability({ shape: 'square', range: 4 }), caster, [{ x: 7, y: 5 }])).toEqual([
      { x: 7, y: 5 },
    ]);
    expect(expandShape(b, ability({ shape: 'square', range: 4 }), caster, [{ x: 99, y: 0 }])).toEqual([]);
  });

  it('circle uses the ability radius around the aimed centre', () => {
    const out = expandShape(b, ability({ shape: 'circle', range: 6, radius: 1 }), caster, [{ x: 8, y: 5 }]);
    expect(posKeys(out)).toEqual(posKeys([{ x: 8, y: 5 }, { x: 7, y: 5 }, { x: 9, y: 5 }, { x: 8, y: 4 }, { x: 8, y: 6 }]));
  });

  it('line derives its direction from caster→aim', () => {
    const out = expandShape(b, ability({ shape: 'line', range: 2 }), caster, [{ x: 10, y: 5 }]);
    expect(out).toEqual([{ x: 6, y: 5 }, { x: 7, y: 5 }]);
  });

  it('cone snaps to the dominant cardinal of the aim', () => {
    const out = expandShape(b, ability({ shape: 'cone', range: 2 }), caster, [{ x: 9, y: 6 }]);
    expect(posKeys(out)).toEqual(posKeys([{ x: 6, y: 5 }, { x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }]));
  });

  it('path returns the traversed squares, de-duplicated and in order', () => {
    const path = [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }];
    expect(expandShape(b, ability({ shape: 'path', range: 3 }), caster, path)).toEqual([
      { x: 6, y: 5 },
      { x: 7, y: 5 },
      { x: 8, y: 5 },
    ]);
  });

  it('a zero-length aim (aim == caster) hits nothing for directional shapes', () => {
    expect(expandShape(b, ability({ shape: 'line', range: 4 }), caster, [caster])).toEqual([]);
    expect(expandShape(b, ability({ shape: 'cone', range: 4 }), caster, [caster])).toEqual([]);
  });
});

describe('aimInRange', () => {
  it('measures Chebyshev distance', () => {
    expect(aimInRange({ x: 0, y: 0 }, { x: 4, y: 4 }, 4)).toBe(true);
    expect(aimInRange({ x: 0, y: 0 }, { x: 5, y: 0 }, 4)).toBe(false);
  });
});
