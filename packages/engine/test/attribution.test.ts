import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, TeamId, TurnEvent, UnitOrders } from '../src/types.js';

/**
 * A0 — every `damage` event names its source. Blast emits every `abilityFired`
 * before any `damage`, so the log's adjacency cannot say which ability landed a
 * hit; presentation (sequential Blast, "shooter in frame" camera) reads
 * `sourceUnitId`/`abilityId` instead. Covers all four damage paths.
 */

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'square', range: 4, cooldown: 0, energyGain: 0, effects: [], description: over.id, ...over,
});

const char: CharacterDef = {
  id: 'test-char', name: 'Test', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shoot', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 4, energyGain: 8, effects: [{ kind: 'damage', amount: 15 }] }),
    ability({ id: 'mine', phase: 'prep', shape: 'square', range: 4, energyGain: 5, effects: [{ kind: 'trap', amount: 20 }] }),
    ability({ id: 'nade', shape: 'circle', range: 6, radius: 1, delayTurns: 1, energyGain: 10, effects: [{ kind: 'damage', amount: 25 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'square', range: 8, effects: [{ kind: 'damage', amount: 40 }] }),
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 9 }, () => '.'.repeat(9)));

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[], map = OPEN()) =>
  resolveTurn(s, map, [{ team: 0 as TeamId, units: u0 }, { team: 1 as TeamId, units: u1 }], roster);
const damages = (events: TurnEvent[]) => events.filter((e) => e.type === 'damage') as Extract<TurnEvent, { type: 'damage' }>[];

describe('A0: damage events carry their source', () => {
  it('a Blast hit names the shooter and the ability', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 3, y: 4 });
    const { events } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 8, y: 4 }] } }], []);
    const hits = damages(events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ unitId: 'e', sourceUnitId: 'u', abilityId: 'shoot' });
  });

  it('a dash strike names the charger and its ability', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 2, y: 0 });
    const { events } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } }], []);
    expect(damages(events)[0]).toMatchObject({ unitId: 'e', sourceUnitId: 'u', abilityId: 'charge' });
  });

  it('trap damage credits the unit that placed it and the placing ability', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 3, y: 4 });
    // Turn 1: u places a mine at (2,4). Turn 2: e walks onto it.
    const t1 = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'mine', target: [{ x: 2, y: 4 }] } }], []);
    const t2 = run(t1.state, [], [{ unitId: 'e', movePath: [{ x: 2, y: 4 }] }]);
    const hits = damages(t2.events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ unitId: 'e', sourceUnitId: 'u', abilityId: 'mine' });
  });

  it('a delayed detonation credits its original caster, even after the caster moved', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 4, y: 4 });
    // Turn 1: u arms a grenade on (4,4). Turn 2: it detonates while u walks away.
    const t1 = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'nade', target: [{ x: 4, y: 4 }] } }], []);
    expect(damages(t1.events)).toHaveLength(0); // armed, not detonated
    const t2 = run(t1.state, [{ unitId: 'u', movePath: [{ x: 0, y: 5 }] }], []);
    const hits = damages(t2.events);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ unitId: 'e', sourceUnitId: 'u', abilityId: 'nade' });
  });

  it('with two shooters firing at once, each damage names its own attacker', () => {
    // The presentation bug A0 fixes: both abilityFired events precede both damage
    // events, so only the carried source can pair a hit with its shooter.
    const a = makeUnit('a', 0, { x: 0, y: 4 });
    const b = makeUnit('b', 0, { x: 0, y: 6 });
    const e1 = makeUnit('e1', 1, { x: 3, y: 4 });
    const e2 = makeUnit('e2', 1, { x: 3, y: 6 });
    const { events } = run(makeState([a, b, e1, e2]), [
      { unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 8, y: 4 }] } },
      { unitId: 'b', ability: { abilityId: 'shoot', target: [{ x: 8, y: 6 }] } },
    ], []);
    const bySource = new Map(damages(events).map((d) => [d.unitId, d.sourceUnitId]));
    expect(bySource.get('e1')).toBe('a');
    expect(bySource.get('e2')).toBe('b');

    // Adjacency genuinely cannot do this: every abilityFired precedes every damage.
    const kinds = events.filter((e) => e.type === 'abilityFired' || e.type === 'damage').map((e) => e.type);
    expect(kinds).toEqual(['abilityFired', 'abilityFired', 'damage', 'damage']);
  });

  it('adds no outcome change — HP and kills match the pre-A0 expectations', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 3, y: 4 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 8, y: 4 }] } }], []);
    expect(state.units.find((x) => x.unitId === 'e')!.hp).toBe(80);
    expect(state.kills).toEqual([0, 0]);
  });
});
