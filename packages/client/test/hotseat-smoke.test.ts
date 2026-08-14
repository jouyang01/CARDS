import { describe, expect, it } from 'vitest';
import { resolveTurn, type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster, type UnitOrders } from '@cards/engine';
import { deriveSeats, mergeSeatOrders } from '../src/hotseat.js';
import { emptyDraft, toUnitOrders, type OrderDraft } from '../src/targeting.js';
import { playEvents } from '../src/playback.js';

/**
 * C1 — headless one-turn hot-seat smoke test. Drives the whole client chain a
 * real turn goes through — build orders (targeting) → merge per seat (hotseat) →
 * resolveTurn (engine) → playback fold (playback) — and asserts the reconstructed
 * board (what render.ts draws) matches the engine's returned state exactly. No
 * DOM/browser needed; render.ts is a pure function of this view.
 */

const OPEN: MapDef = { id: 't', name: 't', width: 11, height: 11, walls: [], cover: [], brush: [], spawns: [[{ x: 1, y: 5 }, { x: 1, y: 3 }], [{ x: 5, y: 5 }, { x: 5, y: 3 }]] };
const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'square', range: 8, cooldown: 0, energyGain: 0, effects: [], description: over.id, ...over,
});
const char: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shoot', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'a2', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
    ability({ id: 'a3', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
    ability({ id: 'a4', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };

const mkUnit = (unitId: string, owner: 0 | 1, x: number, y: number) =>
  ({ unitId, characterId: 'test-char', owner, pos: { x, y }, hp: 100, maxHp: 100, energy: 0, alive: true, respawnIn: 0, cooldowns: {}, statuses: [], catalysts: [], catalystsUsed: [] });

describe('C1: a full hot-seat turn, playback board == engine board', () => {
  it('builds orders per seat, resolves, and the reconstructed view matches the engine', () => {
    const state: GameState = {
      turn: 1,
      units: [mkUnit('A0', 0, 1, 5), mkUnit('A1', 0, 1, 3), mkUnit('B0', 1, 5, 5), mkUnit('B1', 1, 5, 3)],
      traps: [], delayed: [], decoys: [], kills: [0, 0], format: '2v2', status: 'active', suddenDeath: false,
    };
    const seats = deriveSeats(state, [2, 1]); // team 0: two players; team 1: one player, both chars

    // One player per seat builds a draft for each character they control.
    const draftsByUnit = new Map<string, OrderDraft>([
      ['A0', { ...emptyDraft('A0'), abilityId: 'shoot', aim: [{ x: 10, y: 5 }] }], // rail east into B0
      ['A1', { ...emptyDraft('A1'), sprint: true, movePath: [{ x: 2, y: 3 }, { x: 3, y: 3 }] }], // sprint in
      ['B0', emptyDraft('B0')], // hold
      ['B1', { ...emptyDraft('B1'), movePath: [{ x: 5, y: 2 }] }], // step up
    ]);
    const ordersBySeat = new Map<string, UnitOrders[]>();
    for (const seat of seats) ordersBySeat.set(seat.seatId, seat.unitIds.map((uid) => toUnitOrders(char, draftsByUnit.get(uid)!)));

    const { state: next, events } = resolveTurn(state, OPEN, mergeSeatOrders(seats, ordersBySeat), roster);
    const view = playEvents(state, events);

    // Something actually happened this turn (order-building + resolve worked).
    expect(next.units.find((u) => u.unitId === 'B0')!.hp).toBe(80); // rail landed
    expect(events.length).toBeGreaterThan(4);

    // The rendered board (view) matches the engine's state, unit for unit.
    for (const u of next.units) {
      const v = view.units.get(u.unitId)!;
      expect(v.pos, `${u.unitId} pos`).toEqual(u.pos);
      expect(v.hp, `${u.unitId} hp`).toBe(u.hp);
      expect(v.alive, `${u.unitId} alive`).toBe(u.alive);
      expect(v.energy, `${u.unitId} energy`).toBe(u.energy);
    }
    expect(view.kills).toEqual(next.kills);
  });
});
