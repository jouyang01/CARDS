import { describe, expect, it } from 'vitest';
import { resolveTurn, type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster, type UnitOrders } from '@cards/engine';
import { deriveSeats, mergeSeatOrders, seatsForTeam, type Seat } from '../src/hotseat.js';

const OPEN: MapDef = { id: 't', name: 't', width: 11, height: 11, walls: [], cover: [], brush: [], spawns: [[{ x: 1, y: 5 }, { x: 1, y: 3 }], [{ x: 9, y: 5 }, { x: 9, y: 7 }]] };
const lethal: AbilityDef = { id: 'nuke', name: 'Nuke', phase: 'blast', shape: 'square', range: 12, cooldown: 0, energyGain: 0, effects: [{ kind: 'damage', amount: 200 }], description: 'x' };
const char: CharacterDef = { id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100, abilities: [lethal, lethal, lethal, lethal], ultimate: lethal };
const roster: Roster = { 'test-char': char };

function mkUnit(unitId: string, owner: 0 | 1, x: number, y: number) {
  return { unitId, characterId: 'test-char', owner, pos: { x, y }, hp: 100, maxHp: 100, energy: 0, alive: true, respawnIn: 0, cooldowns: {}, statuses: [] };
}
function mkState(units: GameState['units'], over: Partial<GameState> = {}): GameState {
  return { turn: 1, units, traps: [], delayed: [], kills: [0, 0], format: '2v2', status: 'active', suddenDeath: false, ...over };
}

describe('seat model — player ↔ character control', () => {
  it('splits a 2v2 across 3 players (the 3-player split: 1+1 vs 2)', () => {
    const state = mkState([mkUnit('a0', 0, 1, 5), mkUnit('a1', 0, 1, 3), mkUnit('b0', 1, 9, 5), mkUnit('b1', 1, 9, 7)]);
    const seats = deriveSeats(state, [2, 1]);
    expect(seatsForTeam(seats, 0).map((s) => s.unitIds)).toEqual([['a0'], ['a1']]); // two players, one char each
    expect(seatsForTeam(seats, 1).map((s) => s.unitIds)).toEqual([['b0', 'b1']]); // one player, both chars
  });

  it('splits a 4-unit team across 3 players as 2+1+1', () => {
    const units = [0, 1, 2, 3].map((i) => mkUnit(`a${i}`, 0, 1, i));
    const seats = deriveSeats(mkState(units, { format: '4v4' }), [3, 3]);
    expect(seatsForTeam(seats, 0).map((s) => s.unitIds)).toEqual([['a0', 'a1'], ['a2'], ['a3']]);
  });
});

describe('merging per-player orders into per-team PlayerOrders', () => {
  it('collects every seat on a team into one order set, in order', () => {
    const seats: Seat[] = [
      { seatId: 's0', team: 0, unitIds: ['a0'] },
      { seatId: 's1', team: 0, unitIds: ['a1'] },
      { seatId: 's2', team: 1, unitIds: ['b0', 'b1'] },
    ];
    const ordersBySeat = new Map<string, UnitOrders[]>([
      ['s0', [{ unitId: 'a0', sprint: true }]],
      ['s1', [{ unitId: 'a1' }]],
      ['s2', [{ unitId: 'b0' }, { unitId: 'b1' }]],
    ]);
    const [t0, t1] = mergeSeatOrders(seats, ordersBySeat);
    expect(t0).toEqual({ team: 0, units: [{ unitId: 'a0', sprint: true }, { unitId: 'a1' }] });
    expect(t1).toEqual({ team: 1, units: [{ unitId: 'b0' }, { unitId: 'b1' }] });
  });

  it('a seat that submits nothing lets its characters hold', () => {
    const seats: Seat[] = [{ seatId: 's0', team: 0, unitIds: ['a0'] }];
    const [t0, t1] = mergeSeatOrders(seats, new Map());
    expect(t0.units).toEqual([]);
    expect(t1.units).toEqual([]);
  });
});

describe('a full scripted 2v2 hot-seat match plays to a winner (item 20 AC)', () => {
  it('reaches a gameEnd with a winner via per-seat order entry', () => {
    let state = mkState([mkUnit('a0', 0, 1, 5), mkUnit('a1', 0, 1, 3), mkUnit('b0', 1, 9, 5), mkUnit('b1', 1, 9, 7)]);
    const seats = deriveSeats(state, [2, 1]); // team 0: two players; team 1: one player running both

    let guard = 0;
    while (state.status === 'active' && guard++ < 30) {
      // Each team-0 player targets a living enemy where it currently stands
      // (orders entered one player/seat at a time, then merged).
      const enemies = state.units.filter((u) => u.owner === 1 && u.alive);
      const ordersBySeat = new Map<string, UnitOrders[]>();
      seatsForTeam(seats, 0).forEach((seat, i) => {
        const target = enemies[i % Math.max(1, enemies.length)];
        if (target) ordersBySeat.set(seat.seatId, seat.unitIds.map((uid) => ({ unitId: uid, ability: { abilityId: 'nuke', target: [{ ...target.pos }] } })));
      });
      // Team 1 holds.
      const orders = mergeSeatOrders(seats, ordersBySeat);
      state = resolveTurn(state, OPEN, orders, roster).state;
    }

    expect(state.status).toBe('finished');
    expect(state.winner).toBe(0);
    expect(state.kills[0]).toBeGreaterThanOrEqual(4); // 2v2 kill target
  });
});
