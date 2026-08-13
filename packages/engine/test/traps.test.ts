import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, TeamId, TrapState, UnitOrders } from '../src/types.js';

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
  archetype: 'firepower',
  maxHp: 100,
  abilities: [
    ability({ id: 'trap', phase: 'prep', shape: 'square', range: 4, cooldown: 3, energyGain: 5, effects: [{ kind: 'trap', amount: 20 }, { kind: 'reveal', duration: 2 }] }),
    ability({ id: 'blink', phase: 'dash', shape: 'square', range: 4, energyGain: 4, effects: [{ kind: 'teleport' }] }),
    ability({ id: 'shoot', phase: 'blast', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'noop', phase: 'prep', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'shield', amount: 1, duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 9 }, () => '.'.repeat(9)));

function run(state: GameState, u0: UnitOrders[], u1: UnitOrders[], map = OPEN()) {
  return resolveTurn(state, map, [{ team: 0 as TeamId, units: u0 }, { team: 1 as TeamId, units: u1 }], roster);
}
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const trapAt = (x: number, y: number, owner: TeamId): TrapState => ({ id: `pre-${x}-${y}`, owner, ownerUnitId: `pre-owner-${owner}`, abilityId: 'trap', pos: { x, y }, damage: 20, onTrigger: [{ kind: 'reveal', duration: 2 }] });

describe('trap placement', () => {
  it('placing a trap in Prep emits trapPlaced and stores it hidden', () => {
    const u = makeUnit('u', 0, { x: 4, y: 4 });
    const { state, events } = run(makeState([u, makeUnit('e', 1, { x: 8, y: 8 })]), [{ unitId: 'u', ability: { abilityId: 'trap', target: [{ x: 5, y: 4 }] } }], []);
    expect(state.traps).toHaveLength(1);
    expect(state.traps[0]!.pos).toEqual({ x: 5, y: 4 });
    expect(events.some((ev) => ev.type === 'trapPlaced')).toBe(true);
    expect(unit(state, 'u').energy).toBe(10); // 5 on use + 5 passive
  });
});

describe('trap triggers on entry, any phase', () => {
  it('move-through: an enemy walking onto it takes damage, is Revealed, and consumes it', () => {
    const u = makeUnit('u', 0, { x: 8, y: 8 });
    const e = makeUnit('e', 1, { x: 0, y: 0 });
    const { state, events } = run(
      makeState([u, e], { traps: [trapAt(2, 0, 0)] }),
      [],
      [{ unitId: 'e', movePath: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] }],
    );
    const eAfter = unit(state, 'e');
    expect(eAfter.hp).toBe(80); // 20 trap damage
    expect(eAfter.statuses.find((s) => s.kind === 'reveal')?.remaining).toBe(1); // dur 2, ticked to 1
    expect(eAfter.pos).toEqual({ x: 3, y: 0 }); // survived, kept walking
    expect(state.traps).toHaveLength(0); // consumed
    expect(events.some((ev) => ev.type === 'trapTriggered')).toBe(true);
  });

  it('dash-through: a blink onto the trap triggers it', () => {
    const u = makeUnit('u', 0, { x: 8, y: 8 });
    const e = makeUnit('e', 1, { x: 0, y: 0 });
    const { state } = run(makeState([u, e], { traps: [trapAt(3, 3, 0)] }), [], [{ unitId: 'e', ability: { abilityId: 'blink', target: [{ x: 3, y: 3 }] } }]);
    expect(unit(state, 'e').hp).toBe(80);
    expect(state.traps).toHaveLength(0);
  });

  it('a lethal trap ends the crosser and awards the owner the kill', () => {
    const u = makeUnit('u', 0, { x: 8, y: 8 });
    const e = makeUnit('e', 1, { x: 0, y: 0 }, { hp: 15 });
    const { state } = run(
      makeState([u, e], { traps: [trapAt(1, 0, 0)] }),
      [],
      [{ unitId: 'e', movePath: [{ x: 1, y: 0 }, { x: 2, y: 0 }] }],
    );
    expect(unit(state, 'e').alive).toBe(false);
    expect(unit(state, 'e').pos).toEqual({ x: 1, y: 0 }); // stopped where it died
    expect(state.kills).toEqual([1, 0]);
  });

  it('standing on a freshly-placed trap does not trigger it until re-entry', () => {
    // e stands where u drops the trap; e holds, so no entry, no trigger.
    const u = makeUnit('u', 0, { x: 4, y: 4 });
    const e = makeUnit('e', 1, { x: 5, y: 4 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'trap', target: [{ x: 5, y: 4 }] } }], []);
    expect(unit(state, 'e').hp).toBe(100); // untouched
    expect(state.traps).toHaveLength(1); // still armed
  });

  it("does not trigger on the owner's own units", () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const { state } = run(
      makeState([u, makeUnit('e', 1, { x: 8, y: 8 })], { traps: [trapAt(1, 0, 0)] }),
      [{ unitId: 'u', movePath: [{ x: 1, y: 0 }] }],
      [],
    );
    expect(unit(state, 'u').hp).toBe(100); // own trap is safe
    expect(state.traps).toHaveLength(1);
  });
});
