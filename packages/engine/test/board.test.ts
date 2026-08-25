import { describe, expect, it } from 'vitest';
import {
  blocksMovement,
  buildBoard,
  chebyshev,
  inBounds,
  isOrthogonalStep,
  manhattan,
  neighbors,
  ORTHOGONAL_STEPS,
  terrainAt,
  vecEq,
  vecKey,
} from '../src/board.js';
import { makeMap, posKeys } from './helpers.js';
import type { MapDef } from '../src/types.js';
import duelArena from '../../../data/maps/duel-arena.json';

describe('vector helpers', () => {
  it('keys, equality and distances are integer and symmetric', () => {
    expect(vecKey({ x: 3, y: 4 })).toBe('3,4');
    expect(vecEq({ x: 3, y: 4 }, { x: 3, y: 4 })).toBe(true);
    expect(vecEq({ x: 3, y: 4 }, { x: 4, y: 3 })).toBe(false);
    expect(manhattan({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(7);
    expect(manhattan({ x: 4, y: 5 }, { x: 1, y: 1 })).toBe(7);
    expect(chebyshev({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(4);
  });

  it('only orthogonal neighbours count as a step', () => {
    const o = { x: 5, y: 5 };
    expect(isOrthogonalStep(o, { x: 5, y: 4 })).toBe(true);
    expect(isOrthogonalStep(o, { x: 6, y: 5 })).toBe(true);
    // diagonals are never a single step (GAME_SPEC §3: orthogonal steps only)
    expect(isOrthogonalStep(o, { x: 6, y: 6 })).toBe(false);
    expect(isOrthogonalStep(o, { x: 4, y: 4 })).toBe(false);
    // standing still is not a step either
    expect(isOrthogonalStep(o, o)).toBe(false);
    expect(isOrthogonalStep(o, { x: 5, y: 7 })).toBe(false);
  });

  it('ORTHOGONAL_STEPS is exactly the four unit directions in a fixed order', () => {
    expect(ORTHOGONAL_STEPS).toEqual([
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ]);
  });
});

describe('buildBoard / terrainAt', () => {
  const board = buildBoard(
    makeMap([
      '.....',
      '.#o..',
      '..b..',
      '.....',
      '.....',
    ]),
  );

  it('indexes each terrain kind at the right square', () => {
    expect(terrainAt(board, { x: 1, y: 1 })).toBe('wall');
    expect(terrainAt(board, { x: 2, y: 1 })).toBe('cover');
    expect(terrainAt(board, { x: 2, y: 2 })).toBe('brush');
    expect(terrainAt(board, { x: 0, y: 0 })).toBe('open');
  });

  it('reports out-of-bounds squares as oob, including non-integer coords', () => {
    expect(terrainAt(board, { x: -1, y: 0 })).toBe('oob');
    expect(terrainAt(board, { x: 5, y: 0 })).toBe('oob');
    expect(terrainAt(board, { x: 0, y: 5 })).toBe('oob');
    expect(terrainAt(board, { x: 1.5, y: 2 })).toBe('oob');
    expect(inBounds(board, { x: 4, y: 4 })).toBe(true);
    expect(inBounds(board, { x: 4, y: 5 })).toBe(false);
  });

  it('walls take precedence over overlapping brush', () => {
    const overlapped = buildBoard(
      makeMap(['...'], {
        walls: [{ x: 1, y: 0 }],
        brush: [{ x: 1, y: 0 }],
        cover: [],
      }),
    );
    expect(terrainAt(overlapped, { x: 1, y: 0 })).toBe('wall');
  });

  it('walls and cover block movement; brush and open ground do not', () => {
    expect(blocksMovement(board, { x: 1, y: 1 })).toBe(true); // wall
    expect(blocksMovement(board, { x: 2, y: 1 })).toBe(true); // cover
    expect(blocksMovement(board, { x: 2, y: 2 })).toBe(false); // brush
    expect(blocksMovement(board, { x: 0, y: 0 })).toBe(false); // open
    expect(blocksMovement(board, { x: -1, y: 0 })).toBe(true); // off the map
  });

  it('neighbours are the in-bounds orthogonal squares only', () => {
    expect(posKeys(neighbors(board, { x: 2, y: 2 }))).toEqual(['1,2', '2,1', '2,3', '3,2']);
    // corner: two neighbours, no diagonals, nothing off-map
    expect(posKeys(neighbors(board, { x: 0, y: 0 }))).toEqual(['0,1', '1,0']);
  });
});

describe('the shipped duel-arena map', () => {
  const board = buildBoard(duelArena as unknown as MapDef);

  it('indexes to the same terrain the JSON declares', () => {
    expect(board.width).toBe(17);
    expect(board.height).toBe(11);
    expect(terrainAt(board, { x: 6, y: 5 })).toBe('wall'); // central pinwheel
    expect(terrainAt(board, { x: 3, y: 4 })).toBe('cover'); // spawn step-out post
    expect(terrainAt(board, { x: 7, y: 4 })).toBe('brush'); // centre concealment
    expect(terrainAt(board, { x: 1, y: 4 })).toBe('open'); // team 0 spawn
  });

  it('both spawn squares are stand-able', () => {
    for (const list of (duelArena as unknown as MapDef).spawns) {
      for (const p of list) expect(blocksMovement(board, p)).toBe(false);
    }
  });
});
