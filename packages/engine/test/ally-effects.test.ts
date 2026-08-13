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
    ability({ id: 'timer', delayTurns: 1, effects: [{ kind: 'damage', amount: 20 }, { kind: 'slow', duration: 2 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'shield', amount: 1, duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 11 }, () => '.'.repeat(11)));
const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[]) =>
  resolveTurn(s, OPEN(), [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

describe('FF1: friendly fire — harmful hits everyone, beneficial stays own-team', () => {
  it('one AoE covering ally + enemy DAMAGES BOTH, and heals only the ally', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const ally = makeUnit('A2', 0, { x: 6, y: 5 }, { hp: 50 });
    const enemy = makeUnit('E', 1, { x: 4, y: 5 });
    const { state } = run(makeState([caster, ally, enemy]), [{ unitId: 'A1', ability: { abilityId: 'nova', target: [{ x: 5, y: 5 }] } }], []);
    expect(unit(state, 'E').hp).toBe(80); // enemy took 20 damage, no heal
    // The ally is now hit by the same AoE: 50 - 20 damage + 15 heal = 45.
    expect(unit(state, 'A2').hp).toBe(45);
    expect(unit(state, 'A1').hp).toBe(95); // the caster splashes itself too: 100 - 20 damage + 15 heal
    expect(unit(state, 'A1').energy).toBe(13); // hit an enemy → 8 on hit + 5 passive
  });

  it('harmful riders ride along onto allies too — slow and knockback', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const ally = makeUnit('A2', 0, { x: 5, y: 6 });
    const enemy = makeUnit('E', 1, { x: 5, y: 4 });
    const { state, events } = run(makeState([caster, ally, enemy]), [{ unitId: 'A1', ability: { abilityId: 'quake', target: [{ x: 5, y: 5 }] } }], []);
    expect(unit(state, 'A2').statuses.some((s) => s.kind === 'slow')).toBe(true); // ally slowed now
    expect(events.some((e) => e.type === 'displaced' && e.unitId === 'A2')).toBe(true); // and knocked
    expect(unit(state, 'E').statuses.some((s) => s.kind === 'slow')).toBe(true); // enemy still slowed
    expect(events.some((e) => e.type === 'displaced' && e.unitId === 'E')).toBe(true);
  });

  it('an ally-only hit grants NO energy — same as hitting nobody', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const ally = makeUnit('A2', 0, { x: 6, y: 5 });
    const farEnemy = makeUnit('E', 1, { x: 0, y: 10 });
    const splash = run(makeState([caster, ally, farEnemy]), [{ unitId: 'A1', ability: { abilityId: 'quake', target: [{ x: 5, y: 5 }] } }], []);
    expect(unit(splash.state, 'A2').statuses.some((s) => s.kind === 'slow')).toBe(true); // the ally WAS hit

    // Control: the same ability aimed at empty ground. Energy must match.
    const whiff = run(makeState([caster, ally, farEnemy]), [{ unitId: 'A1', ability: { abilityId: 'quake', target: [{ x: 9, y: 9 }] } }], []);
    expect(unit(splash.state, 'A1').energy).toBe(unit(whiff.state, 'A1').energy);
    expect(unit(splash.state, 'A1').energy).toBe(5); // passive only
  });

  it('a FRIENDLY KILL moves no team tally, but the ally still dies and respawns', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const ally = makeUnit('A2', 0, { x: 6, y: 5 }, { hp: 5 }); // dies to the 20 damage
    const enemy = makeUnit('E', 1, { x: 0, y: 10 });
    const { state, events } = run(makeState([caster, ally, enemy]), [{ unitId: 'A1', ability: { abilityId: 'nova', target: [{ x: 6, y: 5 }] } }], []);
    expect(unit(state, 'A2').alive).toBe(false);
    expect(unit(state, 'A2').respawnIn).toBeGreaterThan(0); // respawns normally
    expect(state.kills).toEqual([0, 0]); // nobody scores — no farming your own ally
    expect(events.some((e) => e.type === 'death' && e.unitId === 'A2')).toBe(true);
  });

  it('an enemy kill still scores normally', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const enemy = makeUnit('E', 1, { x: 6, y: 5 }, { hp: 5 });
    const { state } = run(makeState([caster, enemy]), [{ unitId: 'A1', ability: { abilityId: 'nova', target: [{ x: 6, y: 5 }] } }], []);
    expect(unit(state, 'E').alive).toBe(false);
    expect(state.kills).toEqual([1, 0]);
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

describe('FF1-delayed: a detonation catches everyone standing in it', () => {
  /** Arm a delayed blast on turn 1, then let turn 2 detonate it. */
  const armThenDetonate = (units: GameState['units'], at: { x: number; y: number }) => {
    const t1 = run(makeState(units), [{ unitId: 'A1', ability: { abilityId: 'timer', target: [at] } }], []);
    expect(t1.state.delayed).toHaveLength(1); // armed, not yet fired
    return run(t1.state, [], []);
  };

  it('damages the ally standing in the locked area, not just the enemy', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const ally = makeUnit('A2', 0, { x: 8, y: 5 });
    const enemy = makeUnit('E', 1, { x: 9, y: 5 });
    const t2 = armThenDetonate([caster, ally, enemy], { x: 9, y: 5 });
    expect(unit(t2.state, 'A2').hp).toBe(80); // a grenade does not check tags
    expect(unit(t2.state, 'E').hp).toBe(80);
  });

  it('harmful riders land on the ally too', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const ally = makeUnit('A2', 0, { x: 8, y: 5 });
    const t2 = armThenDetonate([caster, ally, makeUnit('E', 1, { x: 9, y: 5 })], { x: 9, y: 5 });
    expect(unit(t2.state, 'A2').statuses.some((s) => s.kind === 'slow')).toBe(true);
  });

  it('an ally-only detonation grants the caster no energy', () => {
    const cast = () => [makeUnit('A1', 0, { x: 5, y: 5 }), makeUnit('A2', 0, { x: 8, y: 5 }), makeUnit('E', 1, { x: 0, y: 10 })];
    const onAlly = armThenDetonate(cast(), { x: 8, y: 5 });
    expect(unit(onAlly.state, 'A2').hp).toBe(80); // the ally really was caught

    // Control: detonate on empty ground, still within the ability's Manhattan
    // range of the caster (MET1) so it actually arms. Energy must match.
    const onNobody = armThenDetonate(cast(), { x: 5, y: 10 });
    expect(unit(onAlly.state, 'A1').energy).toBe(unit(onNobody.state, 'A1').energy);
  });

  it('a friendly detonation kill scores for nobody', () => {
    const caster = makeUnit('A1', 0, { x: 5, y: 5 });
    const ally = makeUnit('A2', 0, { x: 8, y: 5 }, { hp: 5 });
    const t2 = armThenDetonate([caster, ally, makeUnit('E', 1, { x: 0, y: 10 })], { x: 8, y: 5 });
    expect(unit(t2.state, 'A2').alive).toBe(false);
    expect(t2.state.kills).toEqual([0, 0]);
  });
});
