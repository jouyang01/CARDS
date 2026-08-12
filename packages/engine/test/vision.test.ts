import { describe, expect, it } from 'vitest';
import { buildBoard, chebyshev } from '../src/board.js';
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

  it('a wall the line clips only at an edge does not block', () => {
    // Horizontal sight along row 2 with a wall on row 1: the line runs through
    // the centres of row 2 and never enters row 1.
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
  const symmetricOver = (map: MapDef): void => {
    const board = buildBoard(map);
    for (let ay = 0; ay < map.height; ay++) {
      for (let ax = 0; ax < map.width; ax++) {
        for (let by = 0; by < map.height; by++) {
          for (let bx = 0; bx < map.width; bx++) {
            const a: Vec2 = { x: ax, y: ay };
            const b: Vec2 = { x: bx, y: by };
            if (hasLineOfSight(board, a, b) !== hasLineOfSight(board, b, a)) {
              throw new Error(`asymmetric LoS between ${ax},${ay} and ${bx},${by}`);
            }
          }
        }
      }
    }
  };

  it('is mutual for every pair of squares on a cluttered board', () => {
    expect(() =>
      symmetricOver(
        makeMap([
          '..#....',
          '.#..o..',
          '....#..',
          '#..b..#',
          '..#....',
          '.o...#.',
          '....#..',
        ]),
      ),
    ).not.toThrow();
  });

  it('is mutual across the shipped Duel Arena', () => {
    const map = duelArena as unknown as MapDef;
    const board = buildBoard(map);
    const probes: Vec2[] = [
      { x: 1, y: 7 },
      { x: 13, y: 7 },
      { x: 7, y: 7 },
      { x: 7, y: 2 },
      { x: 0, y: 6 },
      { x: 14, y: 8 },
      { x: 4, y: 3 },
      { x: 10, y: 11 },
    ];
    for (const a of probes) {
      for (const b of probes) {
        expect(hasLineOfSight(board, a, b)).toBe(hasLineOfSight(board, b, a));
      }
    }
  });

  it('the central walls break the spawn-to-spawn sightline', () => {
    const board = buildBoard(duelArena as unknown as MapDef);
    // Spawns face each other down row 7, with cover (not walls) at 4,7 / 10,7
    // and walls at 3,7 / 11,7.
    expect(hasLineOfSight(board, { x: 1, y: 7 }, { x: 13, y: 7 })).toBe(false);
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
    const build = (): (number | undefined)[] => [...buildVision(buildBoard(twoPatchMap())).brushPatch];
    expect(brushPatchAt(buildVision(buildBoard(twoPatchMap())), { x: 1, y: 1 })).toBe(0);
    expect(brushPatchAt(buildVision(buildBoard(twoPatchMap())), { x: 5, y: 1 })).toBe(1);
    expect(build()).toEqual(build());
  });
});

describe('canSee — range and line of sight', () => {
  const open = buildVision(buildBoard(openMap(15)));

  it('reaches exactly VISION_RANGE squares, measured Chebyshev', () => {
    const a = seer({ x: 0, y: 0 });
    expect(VISION_RANGE).toBe(6);
    // A diagonal at Chebyshev 6 is *further* in Manhattan terms than a
    // straight line at 7, and only the diagonal is visible.
    expect(canSee(open, a, hider({ x: 6, y: 6 }))).toBe(true);
    expect(canSee(open, a, hider({ x: 6, y: 0 }))).toBe(true);
    expect(canSee(open, a, hider({ x: 7, y: 0 }))).toBe(false);
    expect(canSee(open, a, hider({ x: 7, y: 7 }))).toBe(false);
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

  it('adjacency defeats brush', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    // Orthogonally and diagonally adjacent both count.
    expect(canSee(vision, seer({ x: 4, y: 1 }), hider({ x: 5, y: 1 }))).toBe(true);
    expect(canSee(vision, seer({ x: 4, y: 0 }), hider({ x: 5, y: 1 }))).toBe(true);
  });

  it('sharing the patch defeats brush, even far apart inside it', () => {
    const vision = buildVision(buildBoard(oneStripMap()));
    const a = seer({ x: 1, y: 1 });
    const b = hider({ x: 7, y: 1 });
    expect(chebyshev(a.pos, b.pos)).toBe(6);
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
    const stealthed = withStatuses(hider({ x: 1, y: 1 }), status('stealth', 2));
    expect(chebyshev(watcher.pos, stealthed.pos)).toBe(1);
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
  it('returns only visible enemies, in state order', () => {
    const vision = buildVision(buildBoard(twoPatchMap()));
    const watcher = seer({ x: 2, y: 0 });
    const near = makeUnit('near', 1, { x: 4, y: 0 });
    const inBrush = makeUnit('inBrush', 1, { x: 6, y: 1 });
    const ally = makeUnit('ally', 0, { x: 0, y: 2 });
    const state = makeState([watcher, near, inBrush, ally]);
    expect(visibleEnemies(vision, state, watcher).map((u) => u.unitId)).toEqual(['near']);
  });
});

describe('visibleSquares', () => {
  it('covers the Chebyshev square around the viewer, clipped to the board', () => {
    const board = buildBoard(openMap(15));
    expect(visibleSquares(board, { x: 7, y: 7 }, 2)).toHaveLength(25);
    // Cornered: a quarter of the box, clipped by the board edges.
    expect(visibleSquares(board, { x: 0, y: 0 }, 2)).toHaveLength(9);
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
    expect(visibleSquares(board, { x: 7, y: 7 })).toHaveLength((2 * VISION_RANGE + 1) ** 2);
  });
});
