import { describe, expect, it } from 'vitest';
import { resolveTurn, type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster, type UnitOrders } from '@cards/engine';
import { playEvents, phaseSequence, segmentByPhase } from '../src/playback.js';

const OPEN: MapDef = { id: 't', name: 't', width: 11, height: 11, walls: [], cover: [], brush: [], spawns: [[{ x: 1, y: 5 }], [{ x: 9, y: 5 }]] };
const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'square', range: 8, cooldown: 0, energyGain: 0, effects: [], description: over.id, ...over,
});
const char: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'support', maxHp: 100,
  abilities: [
    ability({ id: 'shoot', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'nova', shape: 'circle', range: 6, radius: 2, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }, { kind: 'heal', amount: 15 }] }),
    ability({ id: 'a3', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
    ability({ id: 'a4', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'shield', amount: 1, duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };

function mkUnit(unitId: string, owner: 0 | 1, x: number, y: number, over: Partial<GameState['units'][number]> = {}) {
  return { unitId, characterId: 'test-char', owner, pos: { x, y }, hp: 100, maxHp: 100, energy: 0, alive: true, respawnIn: 0, cooldowns: {}, statuses: [], ...over };
}
function mkState(units: GameState['units'], over: Partial<GameState> = {}): GameState {
  return { turn: 1, units, traps: [], delayed: [], kills: [0, 0], format: '1v1', status: 'active', suddenDeath: false, ...over };
}
const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[]) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);

describe('playback reproduces the engine board from events only (item 19 AC)', () => {
  it('final positions, HP, alive and kills match the resolved state', () => {
    const a = mkUnit('a', 0, 3, 5, { hp: 30 });
    const e = mkUnit('e', 1, 5, 5, { hp: 30 });
    const { state, events } = run(
      mkState([a, e]),
      [{ unitId: 'a', movePath: [{ x: 3, y: 4 }] }], // moves
      [{ unitId: 'e', ability: { abilityId: 'shoot', target: [{ x: 0, y: 5 }] } }], // shoots a (misses — a moved)
    );
    const view = playEvents(mkState([a, e]), events);
    for (const u of state.units) {
      const v = view.units.get(u.unitId)!;
      expect(v.pos, `${u.unitId} pos`).toEqual(u.pos);
      expect(v.hp, `${u.unitId} hp`).toBe(u.hp);
      expect(v.alive, `${u.unitId} alive`).toBe(u.alive);
    }
    expect(view.kills).toEqual(state.kills);
  });

  it('reproduces a death + kill tally', () => {
    const a = mkUnit('a', 0, 3, 5);
    const e = mkUnit('e', 1, 5, 5, { hp: 10 });
    const { state, events } = run(mkState([a, e]), [{ unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 9, y: 5 }] } }], []);
    const view = playEvents(mkState([a, e]), events);
    expect(view.units.get('e')!.alive).toBe(state.units.find((u) => u.unitId === 'e')!.alive);
    expect(view.units.get('e')!.alive).toBe(false);
    expect(view.kills).toEqual(state.kills);
    expect(view.kills[0]).toBe(1);
  });
});

describe('phase ordering', () => {
  it('plays the four phases in the sacred order', () => {
    const { events } = run(mkState([mkUnit('a', 0, 1, 5), mkUnit('e', 1, 9, 5)]), [], []);
    expect(phaseSequence(events)).toEqual(['prep', 'dash', 'blast', 'move']);
    expect(segmentByPhase(events).map((s) => s.phase)).toEqual(['prep', 'dash', 'blast', 'move']);
  });
});

describe('a team AoE shows enemy damage and ally heal from one abilityFired', () => {
  it('the same cast produces both a damage (enemy) and a heal (ally) event in Blast', () => {
    const caster = mkUnit('A1', 0, 5, 5);
    const ally = mkUnit('A2', 0, 6, 5, { hp: 50 });
    const enemy = mkUnit('E', 1, 4, 5);
    const { events } = run(mkState([caster, ally, enemy]), [{ unitId: 'A1', ability: { abilityId: 'nova', target: [{ x: 5, y: 5 }] } }], []);
    const blast = segmentByPhase(events).find((s) => s.phase === 'blast')!.events;
    const fired = blast.findIndex((e) => e.type === 'abilityFired' && e.unitId === 'A1');
    expect(fired).toBeGreaterThanOrEqual(0);
    const after = blast.slice(fired);
    expect(after.some((e) => e.type === 'damage' && e.unitId === 'E')).toBe(true);
    expect(after.some((e) => e.type === 'heal' && e.unitId === 'A2')).toBe(true);
  });
});
