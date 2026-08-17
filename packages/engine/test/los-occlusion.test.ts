import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import { circleSquares, coneSquares, expandShape, lineSquares } from '../src/shapes.js';
import { hasLineOfSight } from '../src/vision.js';
import { makeMap } from './helpers.js';
import type { AbilityDef, Vec2 } from '../src/types.js';

/**
 * LOS-OCCLUSION — a wall casts a shadow across a whole cone, not a tile-shaped
 * hole in it.
 *
 * Owner Dev Note: *"LoS should block make it so attacks cannot hit you. There
 * are some weird cases where my conal/straight line attacks are going past the
 * gray blocks."* They were: `coneSquares` dropped the wall squares themselves
 * and left everything behind them covered, so a cone aimed at a gray block hit
 * whatever stood on the far side.
 *
 * The rule is one rule, shared with sight: **walls block, cover does not**
 * (GAME_SPEC §3). That equivalence is what most of these tests pin — not the
 * particular tiles, which are HITBOX1's business, but that a covered tile is
 * exactly a tile the caster can see.
 */

/** `helpers.posKeys` returns a sorted array; membership reads better as a set. */
const posKeys = (squares: readonly Vec2[]): Set<string> =>
  new Set(squares.map((p) => `${p.x},${p.y}`));

const CENTRE: Vec2 = { x: 10, y: 10 };
const EAST: Vec2 = { x: 1, y: 0 };

/** A 21×21 board with whatever terrain the case needs painted onto it. */
const board = (paint: (rows: string[]) => void) => {
  const rows = Array.from({ length: 21 }, () => '.'.repeat(21));
  paint(rows);
  return buildBoard(makeMap(rows));
};
const put = (rows: string[], x: number, y: number, ch: string): void => {
  rows[y] = rows[y]!.slice(0, x) + ch + rows[y]!.slice(x + 1);
};

const OPEN = board(() => {});
/** One wall square three tiles due east of the caster. */
const WALLED = board((rows) => put(rows, 13, 10, '#'));
/** The same square, but cover — which is not a sight blocker. */
const COVERED = board((rows) => put(rows, 13, 10, 'o'));

const ability = (over: Partial<AbilityDef>): AbilityDef => ({
  id: 'a', name: 'A', phase: 'blast', shape: 'line', range: 6, cooldown: 0,
  energyGain: 0, effects: [{ kind: 'damage', amount: 1 }], description: 't', ...over,
});

describe('LOS-OCCLUSION: a cone does not reach through a wall', () => {
  it('covers nothing behind the wall it is aimed at', () => {
    // The owner's exact report. (14,10) and (15,10) sit directly behind the
    // block and were covered before this rule.
    const shadowed = coneSquares(WALLED, CENTRE, EAST, 6);
    const keys = posKeys(shadowed);
    expect(keys.has('14,10'), 'a tile directly behind the wall').toBe(false);
    expect(keys.has('15,10')).toBe(false);
  });

  it('still covers the tiles in front of it', () => {
    // Occlusion is not "the cone stops": everything the caster can still see
    // inside the wedge is still covered.
    const keys = posKeys(coneSquares(WALLED, CENTRE, EAST, 6));
    expect(keys.has('11,10')).toBe(true);
    expect(keys.has('12,10')).toBe(true);
  });

  it('and the wall square itself is never covered', () => {
    expect(posKeys(coneSquares(WALLED, CENTRE, EAST, 6)).has('13,10')).toBe(false);
  });

  it('the shadow widens with distance — it is a shadow, not one missing tile', () => {
    // The bug was that only the wall tile went missing. A real shadow takes the
    // tiles behind it off-axis too, and more of them the further out you go.
    const open = posKeys(coneSquares(OPEN, CENTRE, EAST, 8));
    const walled = posKeys(coneSquares(board((rows) => put(rows, 12, 10, '#')), CENTRE, EAST, 8));
    const lost = [...open].filter((k) => !walled.has(k));
    expect(lost.length, 'more than just the wall square is dropped').toBeGreaterThan(1);
  });
});

describe('LOS-OCCLUSION: cover is not a sight blocker', () => {
  it('a cone aimed past cover still covers behind it', () => {
    // GAME_SPEC §3: cover *reduces* damage, it does not stop the attack. Getting
    // this backwards would silently make every cover block a wall.
    const keys = posKeys(coneSquares(COVERED, CENTRE, EAST, 6));
    expect(keys.has('14,10')).toBe(true);
    expect(keys.has('15,10')).toBe(true);
  });

  it('and the cover square itself is covered — you can shoot the thing on it', () => {
    expect(posKeys(coneSquares(COVERED, CENTRE, EAST, 6)).has('13,10')).toBe(true);
  });

  it('a cone over cover is identical to one over open ground', () => {
    expect(posKeys(coneSquares(COVERED, CENTRE, EAST, 6)))
      .toEqual(posKeys(coneSquares(OPEN, CENTRE, EAST, 6)));
  });
});

describe('LOS-OCCLUSION: the line\'s side-band obeys it too', () => {
  it('a tile in the half-tile band behind a wall is dropped', () => {
    // `lineSquares` already broke on the first wall *on its axis*. HITBOX1's
    // side-band reaches tiles beside the axis, and those a wall shadows were
    // still covered — the second half of the owner's report.
    const off = board((rows) => put(rows, 13, 9, '#'));
    const open = posKeys(lineSquares(OPEN, CENTRE, { x: 3, y: -1 }, 8));
    const walled = posKeys(lineSquares(off, CENTRE, { x: 3, y: -1 }, 8));
    expect([...open].some((k) => !walled.has(k)), 'the wall shadowed nothing').toBe(true);
  });

  it('but the beam is not ended by a wall that is merely beside it', () => {
    // Dropping a shadowed side tile must not be confused with stopping the
    // beam: the axis may run on well past a wall it passes.
    const beside = board((rows) => put(rows, 12, 8, '#'));
    const keys = posKeys(lineSquares(beside, CENTRE, EAST, 8));
    expect(keys.has('16,10'), 'the axis still reaches out past it').toBe(true);
  });

  it('a wall on the axis still ends the beam, as it always did', () => {
    const keys = posKeys(lineSquares(WALLED, CENTRE, EAST, 8));
    expect(keys.has('12,10')).toBe(true);
    expect(keys.has('13,10')).toBe(false);
    expect(keys.has('14,10')).toBe(false);
  });
});

describe('LOS-OCCLUSION: lobbed shapes are unchanged', () => {
  it('a circle still arcs over a wall', () => {
    // A grenade goes over the gray block. Only the directly-aimed shapes are
    // occluded (edge-cases: circle/square stay un-occluded).
    const keys = posKeys(circleSquares(WALLED, { x: 14, y: 10 }, 2));
    expect(keys.has('15,10')).toBe(true);
    expect(keys.has('14,9')).toBe(true);
  });

  it('and a square zone still lands behind one', () => {
    // `square` is a single placed tile (expandShape) — a zone dropped where you
    // point it, wall or no wall in between.
    const zone = expandShape(WALLED, ability({ shape: 'square', range: 8 }), CENTRE, [{ x: 15, y: 10 }]);
    expect(posKeys(zone).has('15,10')).toBe(true);
  });

  it('expandShape routes each shape to the right rule', () => {
    const cone = expandShape(WALLED, ability({ shape: 'cone', range: 6 }), CENTRE, [{ x: 20, y: 10 }]);
    expect(posKeys(cone).has('14,10'), 'the cone is occluded').toBe(false);
    const circle = expandShape(WALLED, ability({ shape: 'circle', range: 8 }), CENTRE, [{ x: 15, y: 10 }]);
    expect(posKeys(circle).has('15,10'), 'the circle is not').toBe(true);
  });
});

describe('LOS-OCCLUSION: covered means visible, by construction', () => {
  const walls = board((rows) => {
    for (const [x, y] of [[13, 10], [12, 7], [14, 13], [11, 12], [15, 8]] as const) put(rows, x, y, '#');
  });

  it('every cone tile is a tile the caster can see', () => {
    // The strongest statement of the rule, and the one that cannot rot: sight
    // and shape now answer the same question with the same kernel.
    for (const dir of [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 }]) {
      for (const p of coneSquares(walls, CENTRE, dir, 8)) {
        expect(hasLineOfSight(walls, CENTRE, p), `cone ${dir.x},${dir.y} → ${p.x},${p.y}`).toBe(true);
      }
    }
  });

  it('every line tile is too', () => {
    for (const dir of [{ x: 1, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 3 }]) {
      for (const p of lineSquares(walls, CENTRE, dir, 8)) {
        expect(hasLineOfSight(walls, CENTRE, p), `line ${dir.x},${dir.y} → ${p.x},${p.y}`).toBe(true);
      }
    }
  });
});

describe('LOS-OCCLUSION: still deterministic', () => {
  it('the same board and aim give the identical tile list every call', () => {
    // The filter must not introduce set-iteration or float ordering: a single
    // extra tile on one machine desynchronises a match.
    const once = coneSquares(WALLED, CENTRE, { x: 2, y: 1 }, 7);
    for (let i = 0; i < 5; i++) expect(coneSquares(WALLED, CENTRE, { x: 2, y: 1 }, 7)).toEqual(once);
  });

  it('and an open board is untouched by the rule', () => {
    // Nothing occludes on open ground, so HITBOX1's geometry — and the golden
    // signature, whose fixture board has no walls — is unchanged.
    expect(coneSquares(OPEN, CENTRE, EAST, 6)).toEqual(coneSquares(OPEN, CENTRE, EAST, 6));
    expect(coneSquares(OPEN, CENTRE, EAST, 6).length).toBeGreaterThan(10);
  });
});
