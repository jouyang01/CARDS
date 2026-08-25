import { describe, expect, it } from 'vitest';
import { buildBoard, blocksMovement, coverEdgeBlocks } from '../src/board.js';
import { isBehindCover } from '../src/combat.js';
import { hasLineOfSight } from '../src/vision.js';
import { reachableIndex, reachableSquares } from '../src/movement.js';
import { makeState, makeUnit } from './helpers.js';
import type { MapDef, Vec2 } from '../src/types.js';

const reachFrom = (board: ReturnType<typeof buildBoard>, pos: Vec2, budget: number) => {
  const u = makeUnit('u', 0, pos);
  return reachableIndex(reachableSquares(board, makeState([u]), u, budget));
};

/**
 * COVER-EDGE — directional (edge-mounted) cover, the Atlas Reactor half-wall.
 * A barricade on one edge of a tile: walk onto the tile to take cover, but you
 * cannot cross that one edge; the occupant is shielded from attacks crossing it;
 * you can still see over it. A bare {x,y} cover entry stays the v1 full block.
 */
const map = (cover: MapDef['cover']): MapDef => ({
  id: 'edge', name: 'edge', width: 8, height: 8,
  walls: [], cover, brush: [],
  spawns: [[{ x: 0, y: 0 }], [{ x: 7, y: 7 }]],
});
const K = (p: Vec2) => `${p.x},${p.y}`;

describe('COVER-EDGE: movement', () => {
  it('you can walk ONTO an edge-cover tile (unlike full-block cover)', () => {
    const board = buildBoard(map([{ x: 4, y: 4, facing: 'E' }]));
    expect(blocksMovement(board, { x: 4, y: 4 })).toBe(false);
    expect(reachFrom(board, { x: 3, y: 4 }, 4).has('4,4'), 'the covered tile is reachable').toBe(true);
  });

  it('a bare {x,y} cover entry is still the v1 full block — no entry', () => {
    const board = buildBoard(map([{ x: 4, y: 4 }]));
    expect(blocksMovement(board, { x: 4, y: 4 })).toBe(true);
  });

  it('cannot cross the faced edge — East-facing blocks the step to the east', () => {
    const board = buildBoard(map([{ x: 4, y: 4, facing: 'E' }]));
    // (4,4) faces East, so the (4,4)<->(5,4) edge is closed, both directions.
    expect(coverEdgeBlocks(board, { x: 4, y: 4 }, { x: 5, y: 4 })).toBe(true);
    expect(coverEdgeBlocks(board, { x: 5, y: 4 }, { x: 4, y: 4 })).toBe(true);
    // …but the other three edges are open.
    expect(coverEdgeBlocks(board, { x: 4, y: 4 }, { x: 3, y: 4 })).toBe(false); // west
    expect(coverEdgeBlocks(board, { x: 4, y: 4 }, { x: 4, y: 3 })).toBe(false); // north
    expect(coverEdgeBlocks(board, { x: 4, y: 4 }, { x: 4, y: 5 })).toBe(false); // south
  });

  it('reachability routes around the faced edge, not through it', () => {
    const board = buildBoard(map([{ x: 4, y: 4, facing: 'E' }]));
    const reach = reachFrom(board, { x: 4, y: 4 }, 1);
    expect(reach.has('5,4'), 'one orthogonal step east is blocked by the barricade').toBe(false);
    expect(reach.has('3,4'), 'west is open').toBe(true);
  });
});

describe('COVER-EDGE: line of sight and reduction', () => {
  it('does NOT block line of sight — you see over the barricade', () => {
    const board = buildBoard(map([{ x: 4, y: 4, facing: 'E' }]));
    expect(hasLineOfSight(board, { x: 6, y: 4 }, { x: 4, y: 4 })).toBe(true);
  });

  it('shields the occupant from the faced side only', () => {
    const board = buildBoard(map([{ x: 4, y: 4, facing: 'E' }]));
    // Attacker to the east (the faced side) → reduced.
    expect(isBehindCover(board, { x: 7, y: 4 }, { x: 4, y: 4 }, 6)).toBe(true);
    // Attacker to the west → not reduced.
    expect(isBehindCover(board, { x: 1, y: 4 }, { x: 4, y: 4 }, 6)).toBe(false);
  });

  it('melee (range ≤ 1) ignores it', () => {
    const board = buildBoard(map([{ x: 4, y: 4, facing: 'E' }]));
    expect(isBehindCover(board, { x: 5, y: 4 }, { x: 4, y: 4 }, 1)).toBe(false);
  });

  it('an adjacent edge-cover tile does NOT shelter a neighbour (only its own occupant)', () => {
    // v1 full-block cover shelters an adjacent defender; edge cover does not.
    const board = buildBoard(map([{ x: 5, y: 4, facing: 'W' }]));
    expect(isBehindCover(board, { x: 0, y: 4 }, { x: 4, y: 4 }, 6)).toBe(false);
  });
});
