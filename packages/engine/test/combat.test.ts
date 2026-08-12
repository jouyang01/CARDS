import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import {
  applyDamage,
  applyHeal,
  computeDamage,
  energyGainPct,
  grantEnergy,
  isBehindCover,
  outgoingDamagePct,
  scaleDamage,
} from '../src/combat.js';
import { makeMap, makeUnit, status, withStatuses } from './helpers.js';
import type { Vec2 } from '../src/types.js';

describe('damage scaling — Might/Weaken', () => {
  const at = (pos: Vec2, ...st: Parameters<typeof withStatuses>[1][]) =>
    withStatuses(makeUnit('a', 0, pos), ...st);

  it('base is unchanged', () => {
    expect(outgoingDamagePct(makeUnit('a', 0, { x: 0, y: 0 }))).toBe(100);
    expect(computeDamage(26, makeUnit('a', 0, { x: 0, y: 0 }), false)).toBe(26);
  });

  it('Might is +25% round down', () => {
    const a = at({ x: 0, y: 0 }, status('might', 1));
    expect(outgoingDamagePct(a)).toBe(125);
    expect(computeDamage(26, a, false)).toBe(32); // floor(26*1.25) = 32
  });

  it('Weaken is −25% round down', () => {
    const a = at({ x: 0, y: 0 }, status('weaken', 1));
    expect(computeDamage(26, a, false)).toBe(19); // floor(26*0.75) = 19
  });

  it('Might and Weaken together net to base (single round-down)', () => {
    const a = at({ x: 0, y: 0 }, status('might', 1), status('weaken', 1));
    expect(outgoingDamagePct(a)).toBe(100);
    expect(computeDamage(26, a, false)).toBe(26);
  });

  it('scaleDamage never goes negative', () => {
    expect(scaleDamage(10, 0)).toBe(0);
    expect(scaleDamage(0, 125)).toBe(0);
  });
});

describe('applyDamage — shields first, then HP', () => {
  it('consumes a shield before HP and drops it when depleted', () => {
    const u = withStatuses(makeUnit('u', 0, { x: 0, y: 0 }), status('shield', 1, 20));
    const res = applyDamage(u, 30);
    expect(res).toEqual({ hpLost: 10, absorbed: 20, died: false });
    expect(u.hp).toBe(90);
    expect(u.statuses.some((s) => s.kind === 'shield')).toBe(false);
  });

  it('a shield that overflows survives with the remainder', () => {
    const u = withStatuses(makeUnit('u', 0, { x: 0, y: 0 }), status('shield', 2, 50));
    const res = applyDamage(u, 30);
    expect(res).toEqual({ hpLost: 0, absorbed: 30, died: false });
    expect(u.hp).toBe(100);
    expect(u.statuses.find((s) => s.kind === 'shield')).toEqual({ kind: 'shield', remaining: 2, amount: 20 });
  });

  it('reports actual (clamped) HP lost and death on a lethal hit', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 }, { hp: 10 });
    const res = applyDamage(u, 30);
    expect(res).toEqual({ hpLost: 10, absorbed: 0, died: true });
    expect(u.hp).toBe(0);
  });

  it('exactly-lethal damage counts as death', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 }, { hp: 24 });
    expect(applyDamage(u, 24).died).toBe(true);
    expect(u.hp).toBe(0);
  });
});

describe('applyHeal', () => {
  it('restores up to maxHp and no further', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 }, { hp: 80, maxHp: 95 });
    expect(applyHeal(u, 30)).toBe(15);
    expect(u.hp).toBe(95);
  });

  it('does not heal the dead', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 }, { hp: 0, alive: false });
    expect(applyHeal(u, 30)).toBe(0);
    expect(u.hp).toBe(0);
  });
});

describe('energy', () => {
  it('grants the base amount, uncapped', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 }, { energy: 98 });
    expect(grantEnergy(u, 5)).toBe(5);
    expect(u.energy).toBe(103);
  });

  it('Energized is +50% round down and applies to any gain', () => {
    const u = withStatuses(makeUnit('u', 0, { x: 0, y: 0 }), status('energized', 2));
    expect(energyGainPct(u)).toBe(150);
    expect(grantEnergy(u, 5)).toBe(7); // floor(5*1.5) = 7
    expect(grantEnergy(u, 8)).toBe(12); // floor(8*1.5) = 12
  });
});

describe('cover — directional 50% reduction', () => {
  // cover 'o' at (2,2); a defender sits orthogonally adjacent on one side.
  //  01234
  // 0.....
  // 1.....
  // 2..o..
  // 3.....
  // 4.....
  const board = buildBoard(makeMap(['.....', '.....', '..o..', '.....', '.....']));

  it('reduces from the covered side, all four directions', () => {
    // defender north of cover -> cover is SOUTH of defender
    expect(isBehindCover(board, { x: 2, y: 0 }, { x: 2, y: 1 }, 5)).toBe(false); // attack from north, cover south: no
    expect(isBehindCover(board, { x: 2, y: 4 }, { x: 2, y: 1 }, 5)).toBe(true); // attack from south, cover south: yes
    // defender west of cover -> cover EAST of defender
    expect(isBehindCover(board, { x: 4, y: 2 }, { x: 1, y: 2 }, 5)).toBe(true); // attack from east
    expect(isBehindCover(board, { x: 0, y: 2 }, { x: 1, y: 2 }, 5)).toBe(false); // attack from west
    // defender east of cover -> cover WEST of defender
    expect(isBehindCover(board, { x: 0, y: 2 }, { x: 3, y: 2 }, 5)).toBe(true); // attack from west
    // defender south of cover -> cover NORTH of defender
    expect(isBehindCover(board, { x: 2, y: 0 }, { x: 2, y: 3 }, 5)).toBe(true); // attack from north
  });

  it('a diagonal attack line that crosses the covered edge still counts', () => {
    // defender (2,3), cover NORTH at (2,2); attacker up-and-left at (0,0)
    expect(isBehindCover(board, { x: 0, y: 0 }, { x: 2, y: 3 }, 8)).toBe(true);
  });

  it('melee (range <= 1) ignores cover entirely', () => {
    expect(isBehindCover(board, { x: 2, y: 4 }, { x: 2, y: 1 }, 1)).toBe(false);
    expect(isBehindCover(board, { x: 0, y: 2 }, { x: 3, y: 2 }, 1)).toBe(false);
  });

  it('no adjacent cover means no reduction', () => {
    // defender far from any cover
    expect(isBehindCover(board, { x: 0, y: 0 }, { x: 0, y: 4 }, 8)).toBe(false);
  });

  it('computeDamage halves (round down) when behind cover', () => {
    const a = makeUnit('a', 0, { x: 0, y: 0 });
    expect(computeDamage(26, a, true)).toBe(13); // floor(26*0.5)
    expect(computeDamage(25, a, true)).toBe(12); // floor(25*0.5) = 12
  });

  it('cover stacks after Might: floor(floor(26*1.25)*0.5)', () => {
    const a = withStatuses(makeUnit('a', 0, { x: 0, y: 0 }), status('might', 1));
    expect(computeDamage(26, a, true)).toBe(16); // floor(32*0.5) = 16
  });
});
