import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit, status, withStatuses } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, TeamId, UnitOrders } from '../src/types.js';

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id,
  phase: 'blast',
  shape: 'square',
  range: 6,
  cooldown: 0,
  energyGain: 0,
  effects: [],
  description: over.id,
  ...over,
});

const char: CharacterDef = {
  id: 'test-char',
  name: 'Test',
  archetype: 'frontline',
  maxHp: 130,
  abilities: [
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 4, energyGain: 8, effects: [{ kind: 'damage', amount: 15 }, { kind: 'knockback', amount: 1 }] }),
    ability({ id: 'hook', phase: 'blast', shape: 'line', range: 6, energyGain: 10, effects: [{ kind: 'damage', amount: 10 }, { kind: 'pull', amount: 2 }] }),
    ability({ id: 'shove', phase: 'blast', shape: 'square', range: 4, energyGain: 5, effects: [{ kind: 'knockback', amount: 3 }] }),
    ability({ id: 'shoot', phase: 'blast', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'shield', amount: 1, duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 9 }, () => '.'.repeat(9)));

function run(state: GameState, u0: UnitOrders[], u1: UnitOrders[], map = OPEN()) {
  return resolveTurn(state, map, [{ team: 0 as TeamId, units: u0 }, { team: 1 as TeamId, units: u1 }], roster);
}
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

describe('knockback', () => {
  it('pushes the victim away from the source and cancels its Move', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 3, y: 4 });
    const { state, events } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }] } }],
      [{ unitId: 'e', movePath: [{ x: 3, y: 3 }] }], // e wants to move, but will be knocked
    );
    expect(unit(state, 'u').pos).toEqual({ x: 2, y: 4 }); // charger stops before e
    expect(unit(state, 'e').pos).toEqual({ x: 4, y: 4 }); // pushed one square further from the charger
    expect(events.some((ev) => ev.type === 'displaced' && ev.unitId === 'e' && ev.kind === 'knockback')).toBe(true);
    expect(events.some((ev) => ev.type === 'moveStep' && ev.unitId === 'e')).toBe(false); // Move cancelled
  });

  it('stops at a wall (last open square) but still cancels the Move', () => {
    //  0123456
    // 4..u.e#.   wall at x=5; e at (4,4) shoved east stops (5 is wall)
    const map = makeMap(['.......', '.......', '.......', '.......', '.....#.', '.......', '.......']);
    const u = makeUnit('u', 0, { x: 1, y: 4 });
    const e = makeUnit('e', 1, { x: 4, y: 4 });
    const { state, events } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'shove', target: [{ x: 4, y: 4 }] } }],
      [{ unitId: 'e', movePath: [{ x: 4, y: 3 }] }],
      map,
    );
    expect(unit(state, 'e').pos).toEqual({ x: 4, y: 4 }); // wall at (5,4) blocks; no travel
    expect(events.some((ev) => ev.type === 'displaced')).toBe(false); // did not actually move
    expect(events.some((ev) => ev.type === 'moveStep' && ev.unitId === 'e')).toBe(false); // Move still cancelled
  });

  it('pull drags the victim toward the source, never onto it', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 5, y: 4 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'hook', target: [{ x: 8, y: 4 }] } }], []);
    expect(unit(state, 'e').pos).toEqual({ x: 3, y: 4 }); // pulled 2 toward (0,4)
    expect(unit(state, 'e').hp).toBe(90); // 10 damage off the 100 test-unit HP
  });

  it('Unstoppable is immune to displacement and keeps its Move', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = withStatuses(makeUnit('e', 1, { x: 3, y: 4 }), status('unstoppable', 2));
    const { state, events } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }] } }],
      [{ unitId: 'e', movePath: [{ x: 3, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 1 }, { x: 3, y: 0 }] }],
    );
    expect(unit(state, 'e').pos).toEqual({ x: 3, y: 0 }); // not knocked; moved as ordered
    expect(unit(state, 'e').hp).toBe(85); // still takes the 15 charge damage
    expect(events.some((ev) => ev.type === 'displaced')).toBe(false);
  });

  it('two chargers pass through each other, both dealing their charge damage (MV1)', () => {
    // Head-on charges no longer stop in front of one another — they cross.
    const u = makeUnit('u', 0, { x: 2, y: 4 });
    const e = makeUnit('e', 1, { x: 5, y: 4 });
    const { state } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }] } }],
      [{ unitId: 'e', ability: { abilityId: 'charge', target: [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }] } }],
    );
    expect(unit(state, 'u').hp).toBe(85); // mutual 15 charge damage
    expect(unit(state, 'e').hp).toBe(85);
    expect(unit(state, 'u').alive && unit(state, 'e').alive).toBe(true);
    expect(unit(state, 'u').pos.x).toBeGreaterThan(unit(state, 'e').pos.x); // they crossed
  });
});
