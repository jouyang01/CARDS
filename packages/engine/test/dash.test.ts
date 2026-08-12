import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, PlayerId, TurnEvent, UnitOrders } from '../src/types.js';

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id,
  phase: 'dash',
  shape: 'square',
  range: 4,
  cooldown: 0,
  energyGain: 0,
  effects: [],
  description: over.id,
  ...over,
});

const char: CharacterDef = {
  id: 'test-char',
  name: 'Test',
  archetype: 'trickster',
  maxHp: 100,
  abilities: [
    ability({ id: 'blink', shape: 'square', range: 4, energyGain: 4, effects: [{ kind: 'teleport' }] }),
    ability({ id: 'charge', shape: 'path', range: 4, energyGain: 8, effects: [{ kind: 'damage', amount: 15 }, { kind: 'knockback', amount: 1 }] }),
    ability({ id: 'shoot', phase: 'blast', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'roll', shape: 'path', range: 3, energyGain: 4, effects: [{ kind: 'teleport' }] }),
  ],
  ultimate: ability({ id: 'shadowstep', shape: 'square', range: 7, energyGain: 0, effects: [{ kind: 'teleport' }, { kind: 'damage', amount: 40 }, { kind: 'untargetable', duration: 2 }] }),
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 9 }, () => '.'.repeat(9)));

function run(state: GameState, u0: UnitOrders[], u1: UnitOrders[], map = OPEN()) {
  return resolveTurn(state, map, [{ player: 0 as PlayerId, units: u0 }, { player: 1 as PlayerId, units: u1 }], roster);
}
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

describe('dash movement', () => {
  it('a blink teleports the caster to the aimed square', () => {
    const u = makeUnit('u', 0, { x: 1, y: 1 });
    const { state } = run(makeState([u, makeUnit('e', 1, { x: 7, y: 7 })]), [{ unitId: 'u', ability: { abilityId: 'blink', target: [{ x: 3, y: 3 }] } }], []);
    expect(unit(state, 'u').pos).toEqual({ x: 3, y: 3 });
    expect(unit(state, 'u').energy).toBe(9); // 4 utility on use + 5 passive
  });

  it('a blink into an occupied square fizzles (no move)', () => {
    const u = makeUnit('u', 0, { x: 1, y: 1 });
    const e = makeUnit('e', 1, { x: 2, y: 1 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'blink', target: [{ x: 2, y: 1 }] } }], []);
    expect(unit(state, 'u').pos).toEqual({ x: 1, y: 1 });
  });
});

describe('the signature test: dash immunity to Blast aimed at the vacated square', () => {
  it('a unit that blinks away is missed by a Blast line at its origin', () => {
    // u sits on (3,3); e aims a line down column 3. u blinks to (5,5) in Dash,
    // before Blast resolves, so the shot hits nobody.
    const u = makeUnit('u', 0, { x: 3, y: 3 });
    const e = makeUnit('e', 1, { x: 3, y: 0 });
    const { state } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'blink', target: [{ x: 5, y: 5 }] } }],
      [{ unitId: 'e', ability: { abilityId: 'shoot', target: [{ x: 3, y: 8 }] } }],
    );
    expect(unit(state, 'u').hp).toBe(100); // untouched — it dashed off the aimed line
    expect(unit(state, 'u').pos).toEqual({ x: 5, y: 5 });
  });

  it('but a Blast that covers the dash destination still hits', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 });
    const e = makeUnit('e', 1, { x: 5, y: 0 });
    const { state } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'blink', target: [{ x: 5, y: 5 }] } }],
      [{ unitId: 'e', ability: { abilityId: 'shoot', target: [{ x: 5, y: 8 }] } }], // line down column 5, through (5,5)
    );
    expect(unit(state, 'u').hp).toBe(80); // caught at the destination
  });
});

describe('charge dashes', () => {
  it('runs in a line, stops in front of the first enemy and damages it', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 3, y: 0 });
    const { state } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }] } }],
      [],
    );
    expect(unit(state, 'u').pos).toEqual({ x: 2, y: 0 }); // stopped before the enemy at (3,0)
    expect(unit(state, 'e').hp).toBe(85); // 15 charge damage
    expect(unit(state, 'u').energy).toBe(13); // 8 on hit + 5 passive
  });

  it('a charge that hits nobody grants utility energy and travels its path', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const { state } = run(makeState([u, makeUnit('e', 1, { x: 8, y: 8 })]), [{ unitId: 'u', ability: { abilityId: 'roll', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } }], []);
    expect(unit(state, 'u').pos).toEqual({ x: 3, y: 0 });
    expect(unit(state, 'u').energy).toBe(9); // 4 utility + 5 passive
  });
});

describe('teleport-strike ultimate', () => {
  it('appears at the aimed square, strikes adjacent enemies, and goes Untargetable', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 }, { energy: 100 });
    const e = makeUnit('e', 1, { x: 5, y: 5 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shadowstep', target: [{ x: 4, y: 5 }] } }], []);
    expect(unit(state, 'u').pos).toEqual({ x: 4, y: 5 });
    expect(unit(state, 'e').hp).toBe(60); // struck for 40 from the adjacent landing
    expect(unit(state, 'u').statuses.find((s) => s.kind === 'untargetable')?.remaining).toBe(1); // dur 2, ticked to 1
    expect(unit(state, 'u').energy).toBe(5); // ult reset to 0, then +5 passive
  });
});
