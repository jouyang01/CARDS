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

  it('AIM-METRIC: a diagonal beam reaches `range` tile-WIDTHS, so fewer tiles', () => {
    const b = openBoard(11);
    // Range 2 on the diagonal is 2 tile-widths ≈ 1.41 diagonal steps, so it
    // covers one tile. Under the old step-count metering it covered two and
    // reached 2.83 tiles — the over-reach AIM-METRIC removes.
    expect(lineSquares(b, { x: 5, y: 5 }, { x: 1, y: 1 }, 2)).toEqual([{ x: 6, y: 6 }]);
    expect(lineSquares(b, { x: 5, y: 5 }, { x: 1, y: 1 }, 3)).toEqual([{ x: 6, y: 6 }, { x: 7, y: 7 }]);
    // …while the same range pointed east is unchanged: 3 tiles, reaching 3.
    expect(lineSquares(b, { x: 5, y: 5 }, { x: 1, y: 0 }, 3)).toHaveLength(3);
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
    expect(out).toEqual(posKeys([{ x: 6, y: 6 }, { x: 7, y: 7 }]));
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
 * Two things together, and the width ramp alone is **necessary but not
 * sufficient**: the inflation was in the *length*. A cone's depth used to be a
 * tile count along its axis, so at 45° one tile of depth was a diagonal step —
 * √2 longer in real distance, and area goes as the square. A range-4 cone
 * reached 4 tiles east and 7 north-east (24 tiles against 42).
 *
 *   1. **Euclidean axial range** (AIM-METRIC) kills the length inflation.
 *   2. **`halfWidth(d) = d`** — `perp² ≤ d²` — sets the width, and reproduces
 *      the owner-approved axis-aligned 3 / 8 / 15 / 24 exactly.
 *
 * The wedge is the continuous region; HITBOX1's tile-centre circle decides
 * which tiles it hits. That composition is what makes the *reach* check below
 * pass to within half a tile — the check that catches the length bug the tile
 * count alone hid.
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

  it('CONE-B: the reach is within half a tile-width of axis-aligned, at EVERY rotation', () => {
    // The acceptance check the tile count misses. A cone's reach is how far its
    // furthest covered tile sits ALONG THE AXIS — project onto the aim, do not
    // measure a radius (the far corner of an east cone is 5.66 away but only 4
    // deep). This is what went from 4-vs-7 to 4-vs-4.
    const axialReach = (dir: Vec2, range: number): number => {
      const len = Math.hypot(dir.x, dir.y);
      const squares = coneSquares(b, centre, dir, range);
      return Math.max(0, ...squares.map((p) =>
        ((p.x - centre.x) * dir.x + (p.y - centre.y) * dir.y) / len));
    };
    for (const range of [1, 2, 3, 4, 6, 8]) {
      const axis = axialReach({ x: 1, y: 0 }, range);
      expect(axis, `range ${range}`).toBe(range);
      for (let step = 0; step < AIM_STEPS; step++) {
        const got = axialReach(stepToVector(step), range);
        expect(Math.abs(got - axis), `range ${range} step ${step} reached ${got}`).toBeLessThanOrEqual(0.5);
      }
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
    // √2 further than an axis-aligned one. AIM-METRIC gives `line` the same
    // reading, so a diagonal range-4 beam is 2 tiles, not 4.
    const diagonal = coneSquares(b, centre, { x: 1, y: 1 }, 4);
    const deepest = Math.max(...diagonal.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y)));
    // Its far corner sits at range·√2, plus the half-tile hitbox — and no more.
    expect(deepest).toBeLessThanOrEqual(4 * Math.SQRT2 + 0.5);
    expect(lineSquares(b, centre, { x: 1, y: 1 }, 4)).toHaveLength(2);
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
    expect(signature()).toBe(271561358);
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

/**
 * AIM-METRIC — movement is measured in steps, aiming is measured in distance.
 *
 * Both of the geometry bugs this batch fixes had one root cause: lattice-step
 * metering applied to projected geometry. A step count is the right rule for
 * *walking*, where the step is the atom; it is the wrong rule for *aiming*,
 * where the shape has to describe the same thing whichever way it points.
 */
describe('AIM-METRIC: an aimed square is EUCLIDEAN, and the region is a disc', () => {
  const from = { x: 0, y: 0 };

  it('a tile exactly `range` away is in, one past it is out', () => {
    expect(aimInRange(from, { x: 4, y: 0 }, 4)).toBe(true);
    expect(aimInRange(from, { x: 0, y: -4 }, 4)).toBe(true);
    expect(aimInRange(from, { x: 5, y: 0 }, 4)).toBe(false);
  });

  it('the diagonal is a distance, not a step count — the diamond is gone', () => {
    // (3,3) is 4.24 away: Manhattan called it 6 and refused it, Euclidean
    // refuses it for the honest reason. (2,3) is 3.61 — inside, and Manhattan
    // called it 5 and refused it too.
    expect(aimInRange(from, { x: 2, y: 3 }, 4)).toBe(true);
    expect(aimInRange(from, { x: 3, y: 3 }, 4)).toBe(false);
    expect(aimInRange(from, { x: 2, y: 2 }, 4)).toBe(true);
  });

  it('the aimable region grows from a diamond to a disc, by the ruled figures', () => {
    const count = (range: number): number => {
      let n = 0;
      for (let dy = -range; dy <= range; dy++) {
        for (let dx = -range; dx <= range; dx++) if (aimInRange(from, { x: dx, y: dy }, range)) n += 1;
      }
      return n;
    };
    // The Designer's measured numbers (aoe-footprints §2.1): 85→113, 145→197.
    expect(count(6)).toBe(113);
    expect(count(8)).toBe(197);
  });

  it('is symmetric and integer-exact — no rounding to disagree about', () => {
    for (let dy = -9; dy <= 9; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        expect(aimInRange(from, { x: dx, y: dy }, 6)).toBe(aimInRange({ x: dx, y: dy }, from, 6));
      }
    }
  });
});

describe('AIM-METRIC: movement is untouched — steps for walking', () => {
  it('a directional shape reaches `range` tile-widths, not `range` steps', () => {
    const b = openBoard(41);
    const centre: Vec2 = { x: 20, y: 20 };
    const axialReach = (dir: Vec2, squares: readonly Vec2[]): number => {
      const len = Math.hypot(dir.x, dir.y);
      return Math.max(...squares.map((p) => ((p.x - centre.x) * dir.x + (p.y - centre.y) * dir.y) / len));
    };
    // East and south-east both stop at 8 tile-widths. The diagonal used to run
    // to 11.3 — a 41% longer shot for aiming at a corner.
    for (const dir of [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: -1, y: 1 }] as const) {
      expect(axialReach(dir, lineSquares(b, centre, dir, 8))).toBeLessThanOrEqual(8);
    }
    expect(lineSquares(b, centre, { x: 1, y: 1 }, 8).length).toBeLessThan(8);
  });
});
