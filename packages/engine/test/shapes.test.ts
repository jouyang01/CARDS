import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import {
  AIM_STEPS,
  aimInRange,
  circleSquares,
  coneSquares,
  direction8,
  dominantCardinal,
  expandShape,
  lineSquares,
  sign,
  stepToVector,
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

  it('HITBOX1: a beam through a tile corner does not hit it', () => {
    const b = openBoard(11);
    // A due-SE beam runs exactly through the shared corner of (5,6) and (6,5).
    // Nicking a corner is not a hit — their centres are 0.71 from the beam.
    const out = posKeys(lineSquares(b, { x: 5, y: 5 }, { x: 1, y: 1 }, 3));
    expect(out).toEqual(posKeys([{ x: 6, y: 6 }, { x: 7, y: 7 }, { x: 8, y: 8 }]));
  });
});

describe('coneSquares', () => {
  it('is a 45° wedge widened by the half-tile hitbox (east)', () => {
    const b = openBoard(11);
    const out = coneSquares(b, { x: 5, y: 5 }, { x: 1, y: 0 }, 2);
    // The wedge is 45° from the caster, so its half-width at depth d is d; the
    // hitbox catches the row that sits half a tile outside the edge.
    // depth 1: (6,4..6); depth 2: (7,3..7)
    expect(posKeys(out)).toEqual(
      posKeys([
        { x: 6, y: 4 },
        { x: 6, y: 5 },
        { x: 6, y: 6 },
        { x: 7, y: 3 },
        { x: 7, y: 4 },
        { x: 7, y: 5 },
        { x: 7, y: 6 },
        { x: 7, y: 7 },
      ]),
    );
  });

  it('points the wedge along its cardinal (north)', () => {
    const b = openBoard(11);
    const out = coneSquares(b, { x: 5, y: 5 }, { x: 0, y: -1 }, 2);
    expect(posKeys(out)).toEqual(
      posKeys([
        { x: 4, y: 4 },
        { x: 5, y: 4 },
        { x: 6, y: 4 },
        { x: 3, y: 3 },
        { x: 4, y: 3 },
        { x: 5, y: 3 },
        { x: 6, y: 3 },
        { x: 7, y: 3 },
      ]),
    );
  });

  it('drops wall and off-board squares from the wedge', () => {
    const b = openBoard(2); // 2x2; a range-2 cone from a corner mostly falls off
    const out = coneSquares(b, { x: 0, y: 0 }, { x: 1, y: 0 }, 2);
    expect(posKeys(out)).toEqual(posKeys([{ x: 1, y: 0 }, { x: 1, y: 1 }]));
  });

  it('HITBOX1: a tile the wedge only nicks does not take it', () => {
    const b = openBoard(15);
    const out = posKeys(coneSquares(b, { x: 7, y: 7 }, { x: 1, y: 0 }, 3));
    // At depth 3 the wedge's own edge is 2.5 tiles out. (10,10) is 3 out — half
    // a tile past the edge, exactly the hitbox radius, so it is hit.
    expect(out).toContain('10,10');
    // (10,11) is 4 out: the wedge crosses its corner but never reaches within
    // half a tile of its centre.
    expect(out).not.toContain('10,11');
  });
});

/**
 * CONE-B — a cone is a fixed Euclidean triangle that rotates, not a shape whose
 * size depends on which way you point it.
 *
 * Before this, a cone's depth was a *tile count* along its axis, so at 45° one
 * tile of depth was a diagonal step — √2 longer in real distance, and area goes
 * as the square. A range-8 cone covered 80 tiles pointed east and 150 pointed
 * north-east. Measuring every dimension in Euclidean tiles fixes that at the
 * source: the region can only rotate, so its area is constant and what is left
 * is the lattice sampling its boundary.
 */
describe('CONE-B: rotating a cone does not change its size', () => {
  const b = openBoard(41);
  const centre: Vec2 = { x: 20, y: 20 };
  const count = (dir: Vec2, range: number): number => coneSquares(b, centre, dir, range).length;

  it('the axis-aligned footprint is exactly what it was before CONE-B', () => {
    // The reach the damage numbers were tuned against. CONE-B moves off-axis
    // cones toward this, and must not move this itself.
    expect([1, 2, 3, 4].map((r) => count({ x: 1, y: 0 }, r))).toEqual([3, 8, 15, 24]);
    // …and it is the same wedge whichever way it is spelled: a compass unit
    // vector and the quantized step for the same direction agree.
    for (const [dir, step] of [[{ x: 1, y: 0 }, 0], [{ x: 0, y: 1 }, 64], [{ x: -1, y: 0 }, 128]] as const) {
      expect(count(dir, 4)).toBe(count(stepToVector(step), 4));
    }
  });

  it('every one of the 256 rotations lands within a boundary tile of the axis count', () => {
    // The covered set is the lattice points within half a tile of the region.
    // Its area is now rotation-invariant, so all that varies is how the lattice
    // samples the boundary band — an effect that scales with the perimeter, and
    // therefore with range. `axis + range + 1` is that bound; the axis-aligned
    // case sits at the bottom of it because the lattice lines up with the edges.
    for (const range of [2, 3, 4, 6, 8]) {
      const axis = count({ x: 1, y: 0 }, range);
      for (let step = 0; step < AIM_STEPS; step++) {
        const n = count(stepToVector(step), range);
        expect(n, `range ${range} step ${step}`).toBeGreaterThanOrEqual(axis - 1);
        expect(n, `range ${range} step ${step}`).toBeLessThanOrEqual(axis + range + 1);
      }
    }
  });

  it('the worst rotation is nowhere near the old inflation', () => {
    // Concretely: range 4 used to reach 42 tiles off-axis against 24 on-axis,
    // and range 8 reached 150 against 80. Those are the numbers this replaces.
    const worst = (range: number): number => {
      let most = 0;
      for (let step = 0; step < AIM_STEPS; step++) most = Math.max(most, count(stepToVector(step), range));
      return most;
    };
    expect(worst(4)).toBeLessThan(42);
    expect(worst(8)).toBeLessThan(150);
    // Not a vacuous bound — a rotated cone is still a real cone, not a sliver.
    expect(worst(4)).toBeGreaterThanOrEqual(count({ x: 1, y: 0 }, 4));
  });

  it('a cone reaches `range` tiles as a DISTANCE, so a diagonal one is shorter in steps', () => {
    // The trade CONE-B makes, stated out loud: a 45° cone no longer stretches
    // √2 further than an axis-aligned one. `line` keeps the tile-count reading.
    const diagonal = coneSquares(b, centre, { x: 1, y: 1 }, 4);
    const deepest = Math.max(...diagonal.map((p) => Math.abs(p.x - centre.x) + Math.abs(p.y - centre.y)));
    expect(deepest).toBeLessThanOrEqual(8); // 4 tiles of distance, not 4 diagonal steps
    expect(lineSquares(b, centre, { x: 1, y: 1 }, 4)).toHaveLength(4); // line unchanged
  });
});

describe('circleSquares', () => {
  it('is a Euclidean disk, grown by the half-tile hitbox', () => {
    const b = openBoard(11);
    const out = circleSquares(b, { x: 5, y: 5 }, 2);
    // A tile is hit when its centre is within r + ½ = 2.5: 21 squares. The
    // corners (±2,±2) are 2.83 away and still excluded.
    expect(out).toHaveLength(21);
    expect(posKeys(out)).not.toContain('7,7');
    expect(posKeys(out)).toContain('7,6'); // dist² = 5 ≤ 6.25
    expect(posKeys(out)).toContain('5,7');
    expect(posKeys(out)).toContain('6,6');
  });

  it('HITBOX1: overlapping a tile is not enough — the hitbox must be reached', () => {
    const b = openBoard(15);
    const out = posKeys(circleSquares(b, { x: 7, y: 7 }, 3));
    // (10,8) is 3.16 from the centre — the disk stops 0.16 short of it, well
    // inside the half-tile hitbox, so it takes the hit.
    expect(out).toContain('10,8');
    // (10,9) is 3.61 away. The disk still spills over that tile's near corner
    // (2.92 < 3), but it never gets within half a tile of the centre.
    expect(out).not.toContain('10,9');
  });

  it('excludes wall squares and clips at the edge', () => {
    //  01234
    // 0.....
    // 1..#..  wall at (2,1) is dropped from the disk
    const b = buildBoard(makeMap(['.....', '..#..', '.....', '.....', '.....']));
    const out = circleSquares(b, { x: 2, y: 2 }, 1);
    // A radius-1 disk now covers the full 3x3 block (the diagonals are 1.41
    // away, inside r + ½), minus the wall at (2,1).
    expect(posKeys(out)).toEqual(
      posKeys([
        { x: 1, y: 1 }, { x: 3, y: 1 },
        { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 },
        { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 },
      ]),
    );
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
    expect(posKeys(out)).toEqual(
      posKeys([
        { x: 7, y: 4 }, { x: 8, y: 4 }, { x: 9, y: 4 },
        { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 },
        { x: 7, y: 6 }, { x: 8, y: 6 }, { x: 9, y: 6 },
      ]),
    );
  });

  it('line derives its direction from caster→aim', () => {
    const out = expandShape(b, ability({ shape: 'line', range: 2 }), caster, [{ x: 10, y: 5 }]);
    expect(out).toEqual([{ x: 6, y: 5 }, { x: 7, y: 5 }]);
  });

  it('cone snaps to the dominant cardinal of the aim', () => {
    const out = expandShape(b, ability({ shape: 'cone', range: 2 }), caster, [{ x: 9, y: 6 }]);
    expect(posKeys(out)).toEqual(
      posKeys([
        { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 6, y: 6 },
        { x: 7, y: 3 }, { x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 },
      ]),
    );
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

/**
 * HITBOX1 asks the geometry a distance question, and distances are where
 * engines drift: a square root or a float compare can round differently on
 * another CPU, another Node, another browser — and a shape that covers one
 * extra tile on one machine desynchronises a match. Every test above pins one
 * case; this pins the whole surface at once, so a "harmless" refactor of the
 * predicates cannot quietly move a single tile anywhere.
 */
describe('HITBOX1: cross-engine determinism', () => {
  /**
   * Fold every covered tile of every shape at every aim into one 32-bit
   * number. `Math.imul` is exact 32-bit integer multiplication — no float
   * intermediate — so this value is the same on every JS engine, forever.
   */
  function signature(): number {
    const b = openBoard(41);
    const centre: Vec2 = { x: 20, y: 20 };
    let h = 0x811c9dc5 | 0;
    const fold = (n: number): void => {
      h = Math.imul(h ^ (n | 0), 0x01000193) | 0;
    };
    const feed = (squares: readonly Vec2[]): void => {
      fold(squares.length);
      for (const p of squares) {
        fold(p.x);
        fold(p.y);
      }
    };
    for (let step = 0; step < AIM_STEPS; step++) {
      const dir = stepToVector(step);
      for (let range = 1; range <= 8; range++) {
        feed(lineSquares(b, centre, dir, range));
        feed(coneSquares(b, centre, dir, range));
      }
    }
    for (const dir of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }]) {
      for (let range = 1; range <= 8; range++) {
        feed(lineSquares(b, centre, dir, range));
        feed(coneSquares(b, centre, dir, range));
      }
    }
    for (let radius = 0; radius <= 6; radius++) feed(circleSquares(b, centre, radius));
    return h;
  }

  it('every shape, every aim step, every range folds to a fixed value', () => {
    expect(signature()).toBe(-736229090);
  });

  it('is stable across repeated calls (no hidden state, no ordering drift)', () => {
    expect(signature()).toBe(signature());
  });

  it('pins one aim exactly, so a signature change can be read', () => {
    const b = openBoard(41);
    // step 40 of 256 points south-south-east — a genuinely rotated aim, where
    // rounding differences would show up first.
    expect(posKeys(coneSquares(b, { x: 20, y: 20 }, stepToVector(40), 3))).toEqual([
      '19,22', '19,23', '19,24', '20,21', '20,22', '20,23', '20,24', '21,20',
      '21,21', '21,22', '21,23', '22,20', '22,21', '22,22', '23,21', '23,22',
      '24,21',
    ]);
  });
});

describe('aimInRange', () => {
  it('measures MANHATTAN distance to the aimed square (MET1)', () => {
    expect(aimInRange({ x: 0, y: 0 }, { x: 4, y: 0 }, 4)).toBe(true); // straight out
    expect(aimInRange({ x: 0, y: 0 }, { x: 2, y: 2 }, 4)).toBe(true); // 2+2 = 4
    expect(aimInRange({ x: 0, y: 0 }, { x: 5, y: 0 }, 4)).toBe(false);
    // The diagonal corner the old Chebyshev metric allowed is now distance 8.
    expect(aimInRange({ x: 0, y: 0 }, { x: 4, y: 4 }, 4)).toBe(false);
  });
});
