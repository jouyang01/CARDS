import { describe, expect, it } from 'vitest';
import { COVER_REDUCTION_PCT } from '../src/constants.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { validateAbility } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, UnitOrders } from '../src/types.js';

/**
 * MELEE-COVER — cover does not reduce a melee strike, whatever its range.
 *
 * Owner Dev Note: *"Melee attacks should ignore COVER, but not the full
 * vision."* `isBehindCover` already exempted `range <= 1`, but under Manhattan
 * (MET1) a melee ability that reaches a **diagonal** neighbour is authored at
 * range 2 — so the heuristic missed exactly the abilities it existed for, and a
 * point-blank strike still ate the reduction.
 *
 * The fix keys off an explicit `melee: true` flag instead of a range threshold.
 * The second half of the note is the half worth guarding hardest: "ignores
 * cover" is not "ignores vision". A melee attack still cannot reach through a
 * wall.
 */

/** A board with one cover square between the attacker and the target. */
const COVERED: MapDef = makeMap([
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
  '....o......',
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
]);
/** The same, with a wall in that square instead. */
const WALLED: MapDef = makeMap([
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
  '....#......',
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
]);

const RAW = 40;
const strike = (over: Partial<AbilityDef>): AbilityDef => ({
  id: 'strike', name: 'Strike', phase: 'blast', shape: 'line', range: 4,
  cooldown: 0, energyGain: 0, effects: [{ kind: 'damage', amount: RAW }],
  description: 'strike', ...over,
});

const character = (ability: AbilityDef): CharacterDef => ({
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 200,
  abilities: [ability],
  ultimate: { ...strike({ id: 'ult', shape: 'self', range: 0 }), effects: [{ kind: 'might', duration: 1 }] },
});

/**
 * Attacker west of the cover, target east of it, so the attack line crosses the
 * covered edge. Returns the HP the target lost.
 */
const hpLost = (map: MapDef, ability: AbilityDef): number => {
  const CHAR = character(ability);
  const roster: Roster = { 'test-char': CHAR };
  const state: GameState = makeState([
    makeUnit('a', 0, { x: 3, y: 5 }, { characterId: 'test-char', maxHp: 200, hp: 200 }),
    makeUnit('e', 1, { x: 5, y: 5 }, { characterId: 'test-char', maxHp: 200, hp: 200 }),
  ]);
  const orders: UnitOrders[] = [{ unitId: 'a', ability: { abilityId: ability.id, target: [{ x: 10, y: 5 }] } }];
  const { state: after } = resolveTurn(state, map, [{ team: 0, units: orders }, { team: 1, units: [] }], roster);
  return 200 - after.units.find((u) => u.unitId === 'e')!.hp;
};

describe('MELEE-COVER: the flag, not the range', () => {
  it('a non-melee attack into cover is reduced, as it always was', () => {
    const dealt = hpLost(COVERED, strike({}));
    expect(dealt).toBe(Math.floor((RAW * (100 - COVER_REDUCTION_PCT)) / 100));
    expect(dealt).toBeLessThan(RAW);
  });

  it('a melee attack into the same cover deals full damage', () => {
    expect(hpLost(COVERED, strike({ melee: true }))).toBe(RAW);
  });

  it('and it does so at range 2 — the case the old heuristic missed', () => {
    // Under Manhattan a melee ability reaching a diagonal neighbour is authored
    // at range 2, so `range <= 1` never fired for it. This is the owner's bug.
    expect(hpLost(COVERED, strike({ melee: true, range: 2 }))).toBe(RAW);
    expect(hpLost(COVERED, strike({ range: 2 }))).toBeLessThan(RAW);
  });

  it('a long-ranged ability marked melee is still exempt — the flag is the rule', () => {
    // Deliberately not re-deriving "is this really melee" from the range. The
    // Designer marks the strikers; the engine obeys the mark.
    expect(hpLost(COVERED, strike({ melee: true, range: 8 }))).toBe(RAW);
  });

  it('melee: false is the same as saying nothing', () => {
    expect(hpLost(COVERED, strike({ melee: false }))).toBe(hpLost(COVERED, strike({})));
  });
});

describe('MELEE-COVER: ignoring cover is not ignoring vision', () => {
  it('a melee attack cannot reach through a wall', () => {
    // The owner's own qualifier — "but not the full vision". LOS-OCCLUSION
    // stops the shape; this only removes the *reduction*.
    expect(hpLost(WALLED, strike({ melee: true }))).toBe(0);
  });

  it('and neither can a normal one', () => {
    expect(hpLost(WALLED, strike({}))).toBe(0);
  });

  it('on open ground both deal full damage — cover is the only difference', () => {
    const OPEN = makeMap(Array.from({ length: 11 }, () => '.'.repeat(11)));
    expect(hpLost(OPEN, strike({ melee: true }))).toBe(RAW);
    expect(hpLost(OPEN, strike({}))).toBe(RAW);
  });
});

describe('MELEE-COVER: the flag is content, so validation knows it', () => {
  it('accepts melee: true', () => {
    expect(validateAbility(strike({ melee: true }), 'x')).toEqual([]);
  });

  it('accepts its absence', () => {
    expect(validateAbility(strike({}), 'x')).toEqual([]);
  });

  it('still rejects a typo of it', () => {
    // The whole point of VALIDATE-KEYS: `melee` spelled wrong is a silent
    // nothing without this, and the ability quietly keeps eating cover.
    const typo = { ...strike({}), meele: true } as unknown as AbilityDef;
    expect(validateAbility(typo, 'x').join(' ')).toMatch(/unknown key "meele"/);
  });
});
