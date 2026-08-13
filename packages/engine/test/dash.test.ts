import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, TeamId, TurnEvent, UnitOrders } from '../src/types.js';

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
    ability({ id: 'ram', shape: 'path', range: 3, energyGain: 8, effects: [{ kind: 'damage', amount: 15 }, { kind: 'knockback', amount: 2 }] }),
    ability({ id: 'shoot', phase: 'blast', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'roll', shape: 'path', range: 3, energyGain: 4, effects: [{ kind: 'teleport' }] }),
  ],
  ultimate: ability({ id: 'shadowstep', shape: 'square', range: 7, energyGain: 0, effects: [{ kind: 'teleport' }, { kind: 'damage', amount: 40 }, { kind: 'untargetable', duration: 2 }] }),
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 9 }, () => '.'.repeat(9)));

function run(state: GameState, u0: UnitOrders[], u1: UnitOrders[], map = OPEN()) {
  return resolveTurn(state, map, [{ team: 0 as TeamId, units: u0 }, { team: 1 as TeamId, units: u1 }], roster);
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
  it('passes through the first enemy and rests on the far side, still striking it (MV1)', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 3, y: 0 });
    const { state } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }] } }],
      [],
    );
    expect(unit(state, 'u').pos).toEqual({ x: 4, y: 0 }); // charged through the enemy to the last free square
    expect(unit(state, 'e').hp).toBe(85); // still the first enemy struck: 15 charge damage
    expect(unit(state, 'u').energy).toBe(13); // 8 on hit + 5 passive
  });

  it('a charge that hits nobody grants utility energy and travels its path', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const { state } = run(makeState([u, makeUnit('e', 1, { x: 8, y: 8 })]), [{ unitId: 'u', ability: { abilityId: 'roll', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } }], []);
    expect(unit(state, 'u').pos).toEqual({ x: 3, y: 0 });
    expect(unit(state, 'u').energy).toBe(9); // 4 utility + 5 passive
  });
});

describe('MV1-fix: displacement ignores the displacing charger\'s own body', () => {
  it('a charge knockback carries the victim THROUGH the charger\'s settled square', () => {
    // u charges through e, passing over it and resting one square beyond. e is
    // then knocked back 2 along the charge line — its first step lands on the
    // charger's own square, which is no longer an obstacle (the charger "just
    // passed through"), so e crosses it and rests on the free square beyond.
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 2, y: 0 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'ram', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } }], []);
    expect(unit(state, 'u').pos).toEqual({ x: 3, y: 0 }); // charged through e, settled beyond
    expect(unit(state, 'e').hp).toBe(85); // 15 charge damage
    expect(unit(state, 'e').pos).toEqual({ x: 4, y: 0 }); // knocked 2, crossing the charger's square
  });

  it('a 1-square knockback into the charger\'s exact square does not co-occupy', () => {
    // The charger settles exactly one square beyond e and e's 1-square knockback
    // would land on that square. The charger isn't a wall (e may cross it) but a
    // unit may never *end* on another's square — so e stays put rather than
    // stacking. (Ram Charge's geometry: the residual the Designer must rule on.)
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 2, y: 0 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } }], []);
    expect(unit(state, 'u').pos).toEqual({ x: 3, y: 0 });
    expect(unit(state, 'e').pos).toEqual({ x: 2, y: 0 }); // not displaced onto the charger
    expect(unit(state, 'u').pos).not.toEqual(unit(state, 'e').pos); // co-occupancy invariant holds
  });
});

describe('MV1: dashes pass through characters', () => {
  it('a dash over an ally no longer halts — it rests beyond', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const ally = makeUnit('ally', 0, { x: 2, y: 0 }); // teammate mid-path
    const { state } = run(makeState([u, ally, makeUnit('e', 1, { x: 8, y: 8 })]), [{ unitId: 'u', ability: { abilityId: 'roll', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } }], []);
    expect(unit(state, 'u').pos).toEqual({ x: 3, y: 0 }); // charged through the ally
    expect(unit(state, 'ally').pos).toEqual({ x: 2, y: 0 }); // ally undisturbed
    expect(unit(state, 'ally').hp).toBe(100); // no friendly fire
  });

  it('a charge whose destination is occupied stops on the last free square', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const ally = makeUnit('ally', 0, { x: 2, y: 0 }); // sits on the charge destination
    const { state } = run(makeState([u, ally, makeUnit('e', 1, { x: 8, y: 8 })]), [{ unitId: 'u', ability: { abilityId: 'roll', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }] } }], []);
    expect(unit(state, 'u').pos).toEqual({ x: 1, y: 0 }); // last free square before the occupied destination
  });

  it('a charge crosses a mid-path enemy, continues past it, and strikes it', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 2, y: 0 }); // mid-path enemy
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } }], []);
    expect(unit(state, 'u').pos).toEqual({ x: 3, y: 0 }); // continued past the crossed enemy
    expect(unit(state, 'e').hp).toBe(85); // first enemy crossed still takes the charge damage
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

describe('MV4: diagonal charge paths', () => {
  it('a diagonal charge validates, passes through, and strikes the crossed enemy', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 2, y: 2 });
    const { state } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] } }],
      [],
    );
    expect(unit(state, 'u').pos).toEqual({ x: 3, y: 3 }); // charged diagonally through e to the far side
    expect(unit(state, 'e').hp).toBe(85); // 15 charge damage on the crossed enemy
    expect(unit(state, 'e').pos).toEqual({ x: 2, y: 2 }); // 1-square knockback onto the charger nets zero (MV1-fix interim)
  });

  it('a diagonal charge that cuts a wall corner is rejected (the ability is dropped, unit holds)', () => {
    // Wall at (1,0) is a flank of the (0,0)→(1,1) diagonal → corner-cut illegal.
    const map = makeMap(['.#.......', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 5, y: 5 });
    const { state } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 1, y: 1 }, { x: 2, y: 2 }] } }],
      [],
      map,
    );
    expect(unit(state, 'u').pos).toEqual({ x: 0, y: 0 }); // illegal charge dropped → no dash
    expect(unit(state, 'e').hp).toBe(100); // never struck
  });
});
