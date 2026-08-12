import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit, status, withStatuses } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders } from '../src/types.js';

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'circle', range: 6, radius: 2, cooldown: 0, energyGain: 8,
  effects: [], description: over.id, ...over,
});
const char: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'support', maxHp: 100,
  abilities: [
    ability({ id: 'nova', effects: [{ kind: 'damage', amount: 20 }, { kind: 'heal', amount: 15 }] }),
    ability({ id: 'quake', effects: [{ kind: 'slow', duration: 2 }, { kind: 'knockback', amount: 2 }] }),
    ability({ id: 'mend', effects: [{ kind: 'heal', amount: 20 }] }),
    ability({ id: 'rally', effects: [{ kind: 'might', duration: 2 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'shield', amount: 1, duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 11 }, () => '.'.repeat(11)));
const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[]) =>
  resolveTurn(s, OPEN(), [{ player: 0, units: u0 }, { player: 1, units: u1 }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

describe('ally-aware AoE effects (no friendly fire)', () => {
  it('one AoE covering ally + enemy damages only the enemy and heals only the ally', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const ally = makeUnit('A2', 0, { x: 6, y: 5 }, { hp: 50 });
    const enemy = makeUnit('E', 1, { x: 4, y: 5 });
    const { state } = run(makeState([caster, ally, enemy]), [{ unitId: 'A1', ability: { abilityId: 'nova', target: [{ x: 5, y: 5 }] } }], []);
    expect(unit(state, 'E').hp).toBe(80); // enemy took 20 damage, no heal
    expect(unit(state, 'A2').hp).toBe(65); // ally healed 15, no damage
    expect(unit(state, 'A1').hp).toBe(100); // caster (ally) heal capped at full
    expect(unit(state, 'A1').energy).toBe(13); // hit an enemy → 8 on hit + 5 passive
  });

  it('harmful statuses and displacement skip allies, land on enemies', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const ally = makeUnit('A2', 0, { x: 5, y: 6 });
    const enemy = makeUnit('E', 1, { x: 5, y: 4 });
    const { state, events } = run(makeState([caster, ally, enemy]), [{ unitId: 'A1', ability: { abilityId: 'quake', target: [{ x: 5, y: 5 }] } }], []);
    expect(unit(state, 'A2').statuses.some((s) => s.kind === 'slow')).toBe(false); // ally not slowed
    expect(unit(state, 'A2').pos).toEqual({ x: 5, y: 6 }); // ally not knocked
    expect(unit(state, 'E').statuses.some((s) => s.kind === 'slow')).toBe(true); // enemy slowed
    expect(events.some((e) => e.type === 'displaced' && e.unitId === 'E')).toBe(true); // enemy knocked
  });

  it('a heal-only AoE grants energy on use even with no enemy in the area', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const ally = makeUnit('A2', 0, { x: 6, y: 5 }, { hp: 40 });
    const { state } = run(makeState([caster, ally, makeUnit('E', 1, { x: 0, y: 0 })]), [{ unitId: 'A1', ability: { abilityId: 'mend', target: [{ x: 5, y: 5 }] } }], []);
    expect(unit(state, 'A2').hp).toBe(60); // ally healed 20
    expect(unit(state, 'A1').energy).toBe(13); // support use pays energy: 8 on use + 5 passive
  });

  it('a beneficial buff AoE never lands on enemies', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const enemy = makeUnit('E', 1, { x: 6, y: 5 });
    const { state } = run(makeState([caster, enemy]), [{ unitId: 'A1', ability: { abilityId: 'rally', target: [{ x: 5, y: 5 }] } }], []);
    expect(unit(state, 'A1').statuses.some((s) => s.kind === 'might')).toBe(true); // self buffed
    expect(unit(state, 'E').statuses.some((s) => s.kind === 'might')).toBe(false); // enemy not buffed
  });
});
