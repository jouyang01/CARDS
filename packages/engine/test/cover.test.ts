import { describe, expect, it } from 'vitest';
import { type Board, buildBoard } from '../src/board.js';
import { coverReducedDamage, isBehindCover } from '../src/cover.js';
import { COVER_REDUCTION_PCT } from '../src/constants.js';
import { makeMap } from './helpers.js';
import type { Vec2 } from '../src/types.js';

/**
 * A 5×5 open arena with a single cover square placed at `cover`. The defender in
 * every test stands dead centre at (2,2); attackers are positioned around it.
 */
function boardWithCover(cover: Vec2): Board {
  const rows = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => '.'));
  rows[cover.y]![cover.x] = 'o';
  return buildBoard(makeMap(rows.map((r) => r.join(''))));
}

const DEFENDER: Vec2 = { x: 2, y: 2 };
/** Anything above melee range exercises the geometry; 1 (and 0) short-circuits. */
const RANGED = 5;

describe('isBehindCover — the four covered sides', () => {
  // For each side: cover hugs the defender there, a shot from beyond that side
  // crosses it (covered), and a shot from the opposite side does not.
  const cases = [
    { side: 'north', cover: { x: 2, y: 1 }, beyond: { x: 2, y: 0 }, opposite: { x: 2, y: 4 } },
    { side: 'east', cover: { x: 3, y: 2 }, beyond: { x: 4, y: 2 }, opposite: { x: 0, y: 2 } },
    { side: 'south', cover: { x: 2, y: 3 }, beyond: { x: 2, y: 4 }, opposite: { x: 2, y: 0 } },
    { side: 'west', cover: { x: 1, y: 2 }, beyond: { x: 0, y: 2 }, opposite: { x: 4, y: 2 } },
  ] as const;

  for (const { side, cover, beyond, opposite } of cases) {
    it(`${side} cover reduces a shot crossing that side`, () => {
      const board = boardWithCover(cover);
      expect(isBehindCover(board, beyond, DEFENDER, RANGED)).toBe(true);
    });

    it(`${side} cover does nothing against a shot from the opposite side`, () => {
      const board = boardWithCover(cover);
      expect(isBehindCover(board, opposite, DEFENDER, RANGED)).toBe(false);
    });
  }
});

describe('isBehindCover — diagonal attack lines pick out the exact side', () => {
  // Attackers offset diagonally so the sightline enters the defender through one
  // specific edge; only cover on THAT edge protects. This is the case the
  // segment geometry exists for — a half-plane "shot came from the north-ish"
  // test would wrongly credit the west/east cover below.
  it('a north-west shot that crosses the north edge is stopped only by north cover', () => {
    const attacker: Vec2 = { x: 1, y: 0 }; // enters (2,2) through its north edge
    expect(isBehindCover(boardWithCover({ x: 2, y: 1 }), attacker, DEFENDER, RANGED)).toBe(true);
    expect(isBehindCover(boardWithCover({ x: 1, y: 2 }), attacker, DEFENDER, RANGED)).toBe(false);
    expect(isBehindCover(boardWithCover({ x: 3, y: 2 }), attacker, DEFENDER, RANGED)).toBe(false);
    expect(isBehindCover(boardWithCover({ x: 2, y: 3 }), attacker, DEFENDER, RANGED)).toBe(false);
  });

  it('the mirror north-east shot also crosses the north edge', () => {
    const attacker: Vec2 = { x: 3, y: 0 };
    expect(isBehindCover(boardWithCover({ x: 2, y: 1 }), attacker, DEFENDER, RANGED)).toBe(true);
    expect(isBehindCover(boardWithCover({ x: 3, y: 2 }), attacker, DEFENDER, RANGED)).toBe(false);
  });

  it('a shot grazing the corner shared by defender and cover does not count (corner-permissive)', () => {
    // (0,0)→(2,2) is the pure diagonal; it touches the defender's north-west
    // corner exactly, entering neither the north nor the west cover interior.
    // Same convention line-of-sight uses for corner grazes. See docs/DECISIONS.md.
    const attacker: Vec2 = { x: 0, y: 0 };
    expect(isBehindCover(boardWithCover({ x: 2, y: 1 }), attacker, DEFENDER, RANGED)).toBe(false);
    expect(isBehindCover(boardWithCover({ x: 1, y: 2 }), attacker, DEFENDER, RANGED)).toBe(false);
  });
});

describe('isBehindCover — melee exception (GAME_SPEC §3)', () => {
  const board = boardWithCover({ x: 2, y: 1 }); // north cover, would otherwise apply
  const attacker: Vec2 = { x: 2, y: 0 };

  it('a range-1 ability ignores cover', () => {
    expect(isBehindCover(board, attacker, DEFENDER, 1)).toBe(false);
  });

  it('a range-0 (self) ability ignores cover', () => {
    expect(isBehindCover(board, attacker, DEFENDER, 0)).toBe(false);
  });

  it('but a range-2 ability across the identical line is reduced', () => {
    expect(isBehindCover(board, attacker, DEFENDER, 2)).toBe(true);
  });
});

describe('isBehindCover — adjacency requirement', () => {
  it('no cover on the board means no reduction', () => {
    const board = buildBoard(makeMap(['.....', '.....', '.....', '.....', '.....']));
    expect(isBehindCover(board, { x: 2, y: 0 }, DEFENDER, RANGED)).toBe(false);
  });

  it('a diagonally adjacent cover square shares no side and grants nothing', () => {
    // Cover at (1,1) hugs the defender only at a corner. Even a shot from the
    // north-west that sails past it is unprotected: no shared side to cross.
    const board = boardWithCover({ x: 1, y: 1 });
    expect(isBehindCover(board, { x: 0, y: 0 }, DEFENDER, RANGED)).toBe(false);
    expect(isBehindCover(board, { x: 1, y: 0 }, DEFENDER, RANGED)).toBe(false);
  });

  it('cover two squares away (not adjacent) grants nothing', () => {
    const board = boardWithCover({ x: 2, y: 0 });
    expect(isBehindCover(board, { x: 2, y: 4 }, DEFENDER, RANGED)).toBe(false);
  });
});

describe('coverReducedDamage — 50% round down', () => {
  it('halves even damage exactly', () => {
    expect(COVER_REDUCTION_PCT).toBe(50);
    expect(coverReducedDamage(100)).toBe(50);
    expect(coverReducedDamage(24)).toBe(12);
  });

  it('rounds the surviving damage down on odd values', () => {
    expect(coverReducedDamage(15)).toBe(7); // not 8
    expect(coverReducedDamage(1)).toBe(0);
  });

  it('leaves zero at zero', () => {
    expect(coverReducedDamage(0)).toBe(0);
  });
});
