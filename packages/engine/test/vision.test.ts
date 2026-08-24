import { describe, expect, it } from 'vitest';
import { buildBoard, manhattan } from '../src/board.js';
import {
  brushPatchAt,
  buildVision,
  canSee,
  hasLineOfSight,
  inSameBrushPatch,
  visibleEnemies,
  visibleSquares,
} from '../src/vision.js';
import { VISION_RANGE } from '../src/constants.js';
import { makeMap, makeState, makeUnit, posKeys, status, withStatuses } from './helpers.js';
import type { MapDef, UnitState, Vec2 } from '../src/types.js';
import duelArena from '../../../data/maps/duel-arena.json';

/** An n×n arena with no terrain. */
const openMap = (n: number): MapDef => makeMap(Array.from({ length: n }, () => '.'.repeat(n)));

describe('hasLineOfSight — terrain', () => {
  it('sees clear across open ground', () => {
    const board = buildBoard(openMap(7));
    expect(hasLineOfSight(board, { x: 0, y: 3 }, { x: 6, y: 3 })).toBe(true);
    expect(hasLineOfSight(board, { x: 0, y: 0 }, { x: 6, y: 6 })).toBe(true);
  });

  it('a wall between two units blocks sight', () => {
    const board = buildBoard(
      makeMap([
        '.......',
        '.......',
        '.......',
        '...#...',
        '.......',
        '.......',
        '.......',
      ]),
    );
    expect(hasLineOfSight(board, { x: 0, y: 3 }, { x: 6, y: 3 })).toBe(false);
  });

  it('cover blocks movement but NOT sight (GAME_SPEC §3)', () => {
    const board = buildBoard(
      makeMap([
        '.......',
        '.......',
        '.......',
        '...o...',
        '.......',
        '.......',
        '.......',
      ]),
    );
    expect(hasLineOfSight(board, { x: 0, y: 3 }, { x: 6, y: 3 })).toBe(true);
  });

  it('brush conceals its occupant but does not block sight through it', () => {
    const board = buildBoard(
      makeMap([
        '.......',
        '.......',
        '.......',
        '...b...',
        '.......',
        '.......',
        '.......',
      ]),
    );
    expect(hasLineOfSight(board, { x: 0, y: 3 }, { x: 6, y: 3 })).toBe(true);
  });

  it('sees the square it stands on and the square it looks at', () => {
    const board = buildBoard(makeMap(['...', '.#.', '...']));
    // A wall never hides itself from the unit beside it.
    expect(hasLineOfSight(board, { x: 1, y: 0 }, { x: 1, y: 1 })).toBe(true);
    expect(hasLineOfSight(board, { x: 1, y: 1 }, { x: 1, y: 1 })).toBe(true);
  });

  it('rejects out-of-bounds endpoints', () => {
    const board = buildBoard(openMap(5));
    expect(hasLineOfSight(board, { x: -1, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(hasLineOfSight(board, { x: 0, y: 0 }, { x: 5, y: 2 })).toBe(false);
  });
});

describe('hasLineOfSight — geometry', () => {
  it('blocks when the line passes through a wall interior, not merely near it', () => {
    const board = buildBoard(makeMap(['...', '.#.', '...']));
    // (0,0)→(2,2) runs corner-to-corner straight through (1,1).
    expect(hasLineOfSight(board, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });

  it('a wall off the line does not block', () => {
    const board = buildBoard(makeMap(['..#', '...', '...']));
    expect(hasLineOfSight(board, { x: 0, y: 2 }, { x: 2, y: 2 })).toBe(true);
  });

  it('grazing a wall corner exactly still sees through (documented ruling)', () => {
    // The diagonal (0,0)→(2,2) touches the grid corner shared by (1,0) and
    // (0,1) without entering either square. See docs/DECISIONS.md.
    const graze = buildBoard(makeMap(['.#.', '...', '...']));
    expect(hasLineOfSight(graze, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);

    const bothCorners = buildBoard(makeMap(['.#.', '#..', '...']));
    expect(hasLineOfSight(bothCorners, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);
  });

  it('a wall on the neighbouring row never blocks a straight sightline', () => {
    // Centres sit at odd coordinates and square edges at even ones, so a
    // sightline can never run *along* an edge: the corner graze above is the
    // only boundary case the geometry can produce.
    const board = buildBoard(makeMap(['.....', '.###.', '.....']));
    expect(hasLineOfSight(board, { x: 0, y: 2 }, { x: 4, y: 2 })).toBe(true);
  });

  it('a long wall still blocks a shallow diagonal that crosses it', () => {
    const board = buildBoard(
      makeMap([
        '.......',
        '.......',
        '.......',
        '#######',
        '.......',
        '.......',
        '.......',
      ]),
    );
    expect(hasLineOfSight(board, { x: 0, y: 0 }, { x: 6, y: 6 })).toBe(false);
    expect(hasLineOfSight(board, { x: 0, y: 2 }, { x: 6, y: 4 })).toBe(false);
  });
});

describe('hasLineOfSight — symmetry', () => {
  interface Tally {
    clear: number;
    blocked: number;
    asymmetric: number;
  }

  const sweep = (map: MapDef, probes?: readonly Vec2[]): Tally => {
    const board = buildBoard(map);
    const squares =
      probes ??
      Array.from({ length: map.width * map.height }, (_, i) => ({
        x: i % map.width,
        y: Math.floor(i / map.width),
      }));
    const tally: Tally = { clear: 0, blocked: 0, asymmetric: 0 };
    for (const a of squares) {
      for (const b of squares) {
        const ab = hasLineOfSight(board, a, b);
        if (ab !== hasLineOfSight(board, b, a)) tally.asymmetric++;
        if (ab) tally.clear++;
        else tally.blocked++;
      }
    }
    return tally;
  };

  it('is mutual for every pair of squares on a cluttered board', () => {
    const tally = sweep(
      makeMap([
        '..#....',
        '.#..o..',
        '....#..',
        '#..b..#',
        '..#....',
        '.o...#.',
        '....#..',
      ]),
    );
    expect(tally.asymmetric).toBe(0);
    // Anchor both outcomes: a constant-true or constant-false LoS is symmetric
    // too, and would otherwise sail through this sweep.
    expect(tally).toMatchObject({ clear: 1403, blocked: 998 });
  });

  it('is mutual across the shipped Proving Grounds', () => {
    const probes: Vec2[] = [
      { x: 1, y: 4 }, // team 0 spawn
      { x: 15, y: 4 }, // team 1 spawn
      { x: 8, y: 5 }, // centre Might pad
      { x: 8, y: 1 }, // north Health pad
      { x: 0, y: 5 },
      { x: 16, y: 6 },
      { x: 3, y: 4 }, // step-out cover
      { x: 9, y: 9 }, // south brush corridor
    ];
    const tally = sweep(duelArena as unknown as MapDef, probes);
    expect(tally.asymmetric).toBe(0);
    // Non-degenerate in both directions (the point of the anchor).
    expect(tally.clear).toBeGreaterThan(0);
    expect(tally.blocked).toBeGreaterThan(0);
    expect(tally).toMatchObject({ clear: 22, blocked: 42 });
  });

  it('the central walls break the spawn-to-spawn sightline', () => {
    const board = buildBoard(duelArena as unknown as MapDef);
    // M1: the 2v2 spawns face each other head-on down rows 4 and 6, broken by
    // the pinwheel walls at (10,4) and (6,6). The brush and cover around the
    // Might pad do not block sight — only walls do.
    expect(hasLineOfSight(board, { x: 1, y: 4 }, { x: 15, y: 4 })).toBe(false);
    expect(hasLineOfSight(board, { x: 1, y: 6 }, { x: 15, y: 6 })).toBe(false);
  });
});

// ── Vision range, concealment, visibility ───────────────────────────────────

/** Two brush patches separated by a one-square gap on row 1. */
const twoPatchMap = (): MapDef => makeMap(['.........', '.bbb.bbb.', '.........']);

/** A single seven-square brush strip on row 1. */
const oneStripMap = (): MapDef => makeMap(['.........', '.bbbbbbb.', '.........']);

const seer = (pos: Vec2, overrides: Partial<UnitState> = {}): UnitState =>
  makeUnit('seer', 0, pos, overrides);
const hider = (pos: Vec2, overrides: Partial<UnitState> = {}): UnitState =>
  makeUnit('hider', 1, pos, overrides);

describe('buildVision — brush patches', () => {
  it('groups orthogonally connected brush and separates the gap', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    expect(inSameBrushPatch(vision, { x: 1, y: 1 }, { x: 3, y: 1 })).toBe(true);
    expect(inSameBrushPatch(vision, { x: 5, y: 1 }, { x: 7, y: 1 })).toBe(true);
    expect(inSameBrushPatch(vision, { x: 3, y: 1 }, { x: 5, y: 1 })).toBe(false);
  });

  it('reports no patch off brush', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    expect(brushPatchAt(vision, { x: 4, y: 1 })).toBeUndefined();
    expect(brushPatchAt(vision, { x: 0, y: 0 })).toBeUndefined();
    expect(brushPatchAt(vision, { x: -1, y: 1 })).toBeUndefined();
  });

  it('treats diagonally touching brush as separate patches', () => {
    const vision = buildVision(buildBoard(makeMap(['.b..', '..b.', '....'])));
    expect(inSameBrushPatch(vision, { x: 1, y: 0 }, { x: 2, y: 1 })).toBe(false);
  });

  it('numbers patches in row-major order, so the index is reproducible', () => {
    // Both patches must sit on different rows *and* in reversed column order,
    // or a column-major scan would produce the same numbering and this would
    // assert nothing.
    const vision = buildVision(buildBoard(makeMap(['.....b', 'b.....'])));
    expect(brushPatchAt(vision, { x: 5, y: 0 })).toBe(0);
    expect(brushPatchAt(vision, { x: 0, y: 1 })).toBe(1);
  });
});

describe('canSee — range and line of sight', () => {
  const open = buildVision(buildBoard(openMap(15)));

  it('reaches exactly VISION_RANGE squares, measured MANHATTAN (MET1)', () => {
    const a = seer({ x: 0, y: 0 });
    expect(VISION_RANGE).toBe(6);
    expect(canSee(open, a, hider({ x: 6, y: 0 }))).toBe(true); // straight out, exactly 6
    expect(canSee(open, a, hider({ x: 3, y: 3 }))).toBe(true); // 3+3 = 6
    expect(canSee(open, a, hider({ x: 7, y: 0 }))).toBe(false);
    // The far diagonal the old Chebyshev radius included is distance 12 now.
    expect(canSee(open, a, hider({ x: 6, y: 6 }))).toBe(false);
  });

  it('is mutual: a wall hides each unit from the other equally', () => {
    const vision = buildVision(
      buildBoard(makeMap(['.....', '.....', '#####', '.....', '.....'])),
    );
    const a = seer({ x: 2, y: 0 });
    const b = hider({ x: 2, y: 4 });
    expect(canSee(vision, a, b)).toBe(false);
    expect(canSee(vision, b, a)).toBe(false);

    const c = seer({ x: 0, y: 1 });
    const d = hider({ x: 4, y: 1 });
    expect(canSee(vision, c, d)).toBe(true);
    expect(canSee(vision, d, c)).toBe(true);
  });

  it('cover does not hide the unit standing behind it', () => {
    const vision = buildVision(buildBoard(makeMap(['.....', '..o..', '.....'])));
    expect(canSee(vision, seer({ x: 0, y: 1 }), hider({ x: 4, y: 1 }))).toBe(true);
  });

  it('dead units neither see nor are seen', () => {
    const a = seer({ x: 0, y: 0 });
    const b = hider({ x: 2, y: 0 });
    expect(canSee(open, a, { ...b, alive: false })).toBe(false);
    expect(canSee(open, { ...a, alive: false }, b)).toBe(false);
  });

  it('a player always sees their own units, at any distance', () => {
    const a = seer({ x: 0, y: 0 });
    const ally = makeUnit('ally', 0, { x: 14, y: 14 });
    expect(canSee(open, a, ally)).toBe(true);
  });
});

describe('canSee — brush concealment', () => {
  it('hides a unit in brush from an enemy outside the patch', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    expect(canSee(vision, seer({ x: 2, y: 0 }), hider({ x: 6, y: 1 }))).toBe(false);
  });

  it('but the hidden unit still sees out — concealment is one-way', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    const watcher = seer({ x: 2, y: 0 });
    const inBrush = hider({ x: 6, y: 1 });
    expect(canSee(vision, watcher, inBrush)).toBe(false);
    expect(canSee(vision, inBrush, watcher)).toBe(true);
  });

  it('adjacency defeats brush, and stops dead at MANHATTAN 1 (MET1)', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    const inBrush = hider({ x: 5, y: 1 });
    // Only the four ORTHOGONAL neighbours count now: a diagonal neighbour is
    // distance 2, so standing corner-to-corner no longer reveals a hidden unit.
    expect(canSee(vision, seer({ x: 4, y: 1 }), inBrush)).toBe(true);
    expect(canSee(vision, seer({ x: 4, y: 0 }), inBrush)).toBe(false); // was true pre-MET1
    // One square further out and the exception is gone. Without this the
    // adjacency radius is unpinned and any distance ≥1 would satisfy the suite.
    expect(manhattan({ x: 3, y: 1 }, inBrush.pos)).toBe(2);
    expect(canSee(vision, seer({ x: 3, y: 1 }), inBrush)).toBe(false);
  });

  it('adjacency is measured to the hidden unit, not to its brush patch', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    // (4,0) touches patch square (5,1) but is three squares from the unit at
    // the far end of the same patch — standing beside the thicket is not the
    // same as standing beside whoever is in it.
    const farEnd = hider({ x: 7, y: 1 });
    expect(inSameBrushPatch(vision, { x: 5, y: 1 }, farEnd.pos)).toBe(true);
    expect(manhattan({ x: 4, y: 0 }, farEnd.pos)).toBe(4);
    expect(canSee(vision, seer({ x: 4, y: 0 }), farEnd)).toBe(false);
  });

  it('sharing the patch defeats brush, even far apart inside it', () => {
    const vision = buildVision(buildBoard(oneStripMap()));
    const a = seer({ x: 1, y: 1 });
    const b = hider({ x: 7, y: 1 });
    expect(manhattan(a.pos, b.pos)).toBe(6);
    expect(canSee(vision, a, b)).toBe(true);
  });

  it('brush-edge: a different patch does not count as sharing cover', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    // Both units stand in brush, four squares apart, in *separate* patches.
    expect(canSee(vision, seer({ x: 2, y: 1 }), hider({ x: 6, y: 1 }))).toBe(false);
  });

  it('leaving the brush ends the concealment', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    const watcher = seer({ x: 2, y: 0 });
    expect(canSee(vision, watcher, hider({ x: 6, y: 1 }))).toBe(false);
    expect(canSee(vision, watcher, hider({ x: 6, y: 2 }))).toBe(true);
  });
});

describe('canSee — Stealth and Reveal', () => {
  const open = buildVision(buildBoard(openMap(9)));
  const watcher = seer({ x: 0, y: 0 });

  it('Stealth hides a unit standing in the open', () => {
    expect(canSee(open, watcher, withStatuses(hider({ x: 3, y: 0 }), status('stealth', 2)))).toBe(
      false,
    );
  });

  it('Stealth is not broken by adjacency (documented ruling)', () => {
    // Orthogonally adjacent, so this is genuinely adjacent under MET1's
    // Manhattan-≤1 rule (the old diagonal neighbour is now distance 2 and would
    // no longer exercise the exception at all).
    const stealthed = withStatuses(hider({ x: 1, y: 0 }), status('stealth', 2));
    expect(manhattan(watcher.pos, stealthed.pos)).toBe(1);
    expect(canSee(open, watcher, stealthed)).toBe(false);
  });

  it('Reveal defeats Stealth', () => {
    const revealed = withStatuses(hider({ x: 3, y: 0 }), status('stealth', 2), status('reveal', 1));
    expect(canSee(open, watcher, revealed)).toBe(true);
  });

  it('Reveal defeats brush', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    const revealed = withStatuses(hider({ x: 6, y: 1 }), status('reveal', 1));
    expect(canSee(vision, seer({ x: 2, y: 0 }), revealed)).toBe(true);
  });

  it('an expired status conceals nothing', () => {
    const expired = withStatuses(hider({ x: 3, y: 0 }), status('stealth', 0));
    expect(canSee(open, watcher, expired)).toBe(true);
  });

  it('Reveal does not let you see through a wall or past the range limit', () => {
    const vision = buildVision(buildBoard(makeMap(['.....', '#####', '.....'])));
    const revealed = withStatuses(hider({ x: 2, y: 2 }), status('reveal', 1));
    expect(canSee(vision, seer({ x: 2, y: 0 }), revealed)).toBe(false);
    expect(
      canSee(open, watcher, withStatuses(hider({ x: 8, y: 8 }), status('reveal', 1))),
    ).toBe(false);
  });
});

describe('visibleEnemies', () => {
  it('drops allies and concealed enemies', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    const watcher = seer({ x: 2, y: 0 });
    const near = makeUnit('near', 1, { x: 4, y: 0 });
    const inBrush = makeUnit('inBrush', 1, { x: 6, y: 1 });
    const ally = makeUnit('ally', 0, { x: 0, y: 2 });
    const state = makeState([watcher, near, inBrush, ally]);
    expect(visibleEnemies(vision, state, watcher).map((u) => u.unitId)).toEqual(['near']);
  });

  it('preserves state.units order rather than any incidental sort', () => {
    const vision = buildVision(buildBoard(openMap(9)));
    const watcher = seer({ x: 0, y: 0 });
    // Reverse-alphabetical on purpose: a sorted implementation would flip these.
    const state = makeState([
      watcher,
      makeUnit('zeta', 1, { x: 1, y: 0 }),
      makeUnit('alpha', 1, { x: 2, y: 0 }),
    ]);
    expect(visibleEnemies(vision, state, watcher).map((u) => u.unitId)).toEqual(['zeta', 'alpha']);
  });
});

describe('visibleSquares', () => {
  it('covers the MANHATTAN diamond around the viewer, clipped to the board (MET1)', () => {
    const board = buildBoard(openMap(15));
    expect(visibleSquares(board, { x: 7, y: 7 }, 2)).toHaveLength(13); // diamond, not the 25-square box
    // Cornered: the quarter of the diamond that stays on the board.
    expect(visibleSquares(board, { x: 0, y: 0 }, 2)).toHaveLength(6);
  });

  it('includes the viewer and the walls it can see, but not what they hide', () => {
    const board = buildBoard(makeMap(['.....', '.###.', '.....']));
    const seen = posKeys(visibleSquares(board, { x: 2, y: 0 }, 2));
    expect(seen).toContain('2,0'); // itself
    expect(seen).toContain('2,1'); // the wall in front of it
    expect(seen).not.toContain('2,2'); // the square the wall hides
  });

  it('defaults to VISION_RANGE', () => {
    const board = buildBoard(openMap(15));
    // The Manhattan diamond of radius r holds 2r(r+1)+1 squares (MET1).
    expect(visibleSquares(board, { x: 7, y: 7 })).toHaveLength(2 * VISION_RANGE * (VISION_RANGE + 1) + 1);
  });

  it('returns squares in row-major order (a rendering and hashing contract)', () => {
    const board = buildBoard(openMap(3));
    // The radius-1 Manhattan diamond, scanned row by row (MET1: the corners of
    // the old 3x3 box are distance 2 and no longer included).
    expect(visibleSquares(board, { x: 1, y: 1 }, 1).map((p) => `${p.x},${p.y}`)).toEqual([
      '1,0',
      '0,1',
      '1,1',
      '2,1',
      '1,2',
    ]);
  });
});
