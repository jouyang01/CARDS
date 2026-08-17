import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBoard } from '../src/board.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { innerSquares } from '../src/shapes.js';
import { validateAbility } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, UnitOrders } from '../src/types.js';

/**
 * BASIC-INNER — a circle that hits harder at its heart (Designer §3, AR's Orion).
 *
 * One authored pair, no new geometry: the inner disc is the same integer test
 * (`dx² + dy² ≤ r²`, CIRCLE-FIX) the area already makes, against a smaller
 * number. A tile inside it takes `innerAmount` **instead of** the ability's own
 * `amount` — a replacement rather than a bonus, because "22 in the centre, 14 in
 * the ring" is how a falloff is authored and how a player reads it.
 *
 * Contrast with BASIC-AXIS, which is deliberately additive: a cone's axis is a
 * *bonus* on top of the wedge's damage, and a circle's centre is a *different*
 * number. Both fold into `raw` before Might, Weaken and cover, so there is still
 * one multiplier path.
 */

const CENTRE = { x: 5, y: 5 };
const OPEN: MapDef = makeMap(Array.from({ length: 11 }, () => '.'.repeat(11)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'circle', range: 8, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 14 }], description: over.id, ...over,
});
/** r2 with a centre-only heart: 22 on the middle tile, 14 on everything else. */
const BOMB = ability({ id: 'bomb', radius: 2, innerRadius: 0, innerAmount: 22 });
/** …and one with a *disc* rather than a point, to prove the radius is read. */
const WIDE = ability({ id: 'wide', radius: 2, innerRadius: 1, innerAmount: 30 });
const PLAIN = ability({ id: 'plain', radius: 2 });

const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [BOMB, WIDE, PLAIN],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

/** One attacker well out of the blast, and victims wherever the case wants them. */
const board = (victims: { id: string; x: number; y: number }[]): GameState => makeState([
  makeUnit('a', 0, { x: 0, y: 0 }, { characterId: 'test-char' }),
  ...victims.map((v) => makeUnit(v.id, 1, { x: v.x, y: v.y }, { characterId: 'test-char' })),
]);
const fire = (s: GameState, abilityId: string): GameState =>
  resolveTurn(s, OPEN, [
    { team: 0, units: [{ unitId: 'a', ability: { abilityId, target: [CENTRE] } }] satisfies UnitOrders[] },
    { team: 1, units: [] },
  ], roster).state;
const hp = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!.hp;

describe('BASIC-INNER: the centre hits harder than the ring', () => {
  it('a tile in the inner disc takes innerAmount, the ring takes the base', () => {
    // The whole feature, in two numbers on one cast.
    const s = fire(board([
      { id: 'core', ...CENTRE },
      { id: 'edge', x: CENTRE.x + 2, y: CENTRE.y },
    ]), 'bomb');
    expect(100 - hp(s, 'core'), 'the heart of the blast').toBe(22);
    expect(100 - hp(s, 'edge'), 'the ring').toBe(14);
  });

  it('the boundary is the same integer test the circle itself uses', () => {
    // `innerRadius: 1` covers the four orthogonal neighbours (d² = 1) and not
    // the diagonals (d² = 2) — CIRCLE-FIX's rule, not a second one. A float
    // radius would have swept the diagonal in.
    const s = fire(board([
      { id: 'orth', x: CENTRE.x + 1, y: CENTRE.y },
      { id: 'diag', x: CENTRE.x + 1, y: CENTRE.y + 1 },
    ]), 'wide');
    expect(100 - hp(s, 'orth'), 'd² = 1, inside').toBe(30);
    expect(100 - hp(s, 'diag'), 'd² = 2, outside').toBe(14);
  });

  it('a circle without the knob is untouched — every tile takes the base', () => {
    const s = fire(board([
      { id: 'core', ...CENTRE },
      { id: 'edge', x: CENTRE.x + 2, y: CENTRE.y },
    ]), 'plain');
    expect(100 - hp(s, 'core')).toBe(14);
    expect(100 - hp(s, 'edge')).toBe(14);
  });

  it('the inner tiles are a subset of the area, by construction', () => {
    // The property that makes this safe: the disc is built from the same
    // `circleSquares` at a smaller radius, so it can never name a tile the
    // ability does not actually cover.
    const boardObj = buildBoard(OPEN);
    const inner = innerSquares(boardObj, WIDE, [CENTRE]).map((p) => `${p.x},${p.y}`);
    expect(inner).toHaveLength(5); // centre + four orthogonals
    expect(inner).toContain(`${CENTRE.x},${CENTRE.y}`);
    expect(new Set(inner).size).toBe(inner.length);
  });

  it('and every other shape gets nothing to pay for', () => {
    const boardObj = buildBoard(OPEN);
    expect(innerSquares(boardObj, ability({ id: 'l', shape: 'line' }), [CENTRE])).toEqual([]);
    expect(innerSquares(boardObj, PLAIN, [CENTRE]), 'a circle without the knob').toEqual([]);
  });
});

describe('BASIC-INNER: the knob is validated, not silently ignored', () => {
  const errs = (over: Partial<AbilityDef>) => validateAbility(ability({ id: 'x', ...over }), 'x').join(' ');

  it('rejects it on any shape but a circle', () => {
    expect(errs({ shape: 'cone', range: 3, innerRadius: 0, innerAmount: 20 }))
      .toMatch(/only meaningful on a circle/);
  });

  it('rejects half a pair — a radius with no amount, or an amount with no disc', () => {
    expect(errs({ radius: 2, innerRadius: 0 })).toMatch(/must be given together/);
    expect(errs({ radius: 2, innerAmount: 20 })).toMatch(/must be given together/);
  });

  it('rejects an inner disc that swallows the ring', () => {
    // Two numbers for one footprint is a data mistake, not a design.
    expect(errs({ radius: 1, innerRadius: 1, innerAmount: 20 })).toMatch(/no ring left/);
  });

  it('rejects non-integers and nonsense magnitudes', () => {
    expect(errs({ radius: 2, innerRadius: -1, innerAmount: 20 })).toMatch(/innerRadius/);
    expect(errs({ radius: 2, innerRadius: 0, innerAmount: 0 })).toMatch(/innerAmount/);
  });

  it('accepts the shipped pair', () => {
    expect(validateAbility(BOMB, 'x')).toEqual([]);
  });
});

describe('BASIC-INNER: Cinder ships it', () => {
  const cinder = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../data/characters/cinder.json'), 'utf8'),
  ) as CharacterDef;
  const bolt = cinder.abilities.find((a) => a.id === 'ember_bolt')!;

  it("Ember Bolt is a falloff circle, 22 at the heart and 14 around it", () => {
    // The data edit the item ships with. Asserted here rather than trusted,
    // because the knob doing nothing and the data not carrying it look the same
    // from a distance.
    expect(bolt.shape).toBe('circle');
    expect(bolt.radius).toBe(1);
    expect(bolt.innerRadius).toBe(0);
    expect(bolt.innerAmount).toBe(22);
    expect(bolt.effects[0]).toMatchObject({ kind: 'damage', amount: 14 });
  });

  it('and its old top-end number survived the shape change', () => {
    // It was a line for 22. A player who lands the centre still gets 22; what
    // changed is that missing by one now costs 8 instead of everything.
    expect(bolt.innerAmount).toBe(22);
    expect(bolt.range, 'the authored reach is not a balance lever here').toBe(7);
  });
});
