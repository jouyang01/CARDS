import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import { hasLineOfSight } from '../src/vision.js';
import { makeMap } from './helpers.js';
import type { MapDef, Vec2 } from '../src/types.js';
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
