import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../src/resolve.js';
import { buildRoster, createInitialState, spawnUnit } from '../src/setup.js';
import { makeMap, makeState } from './helpers.js';
import type { CharacterDef, GameState, MapDef, PlayerOrders, TurnEvent } from '../src/types.js';

import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import duelArena from '../../../data/maps/duel-arena.json';

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const ARENA = duelArena as unknown as MapDef;
const roster = buildRoster([VEX, BASTION, WISP]);
const OPEN = () => makeMap(Array.from({ length: 15 }, () => '.'.repeat(15)));

const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const phaseOrder = (events: TurnEvent[]) => events.filter((e) => e.type === 'phaseStart').map((e) => (e as { phase: string }).phase);

describe('loading real characters', () => {
  it('createInitialState places each character at its spawn with full HP', () => {
    const state = createInitialState(ARENA, VEX, BASTION);
    expect(unit(state, 'vex-0').pos).toEqual({ x: 1, y: 7 });
    expect(unit(state, 'vex-0').hp).toBe(95);
    expect(unit(state, 'bastion-0').pos).toEqual({ x: 13, y: 7 });
    expect(unit(state, 'bastion-0').hp).toBe(130);
  });
});

describe("Vex's frag grenade (delayTurns: 1)", () => {
  it('arms this turn and detonates on the aimed area next turn', () => {
    const v = spawnUnit(VEX, 'vex-0', 0, { x: 5, y: 7 });
    const b = spawnUnit(BASTION, 'bastion-0', 1, { x: 7, y: 7 });
    const state = makeState([v, b]);

    const t1 = resolveTurn(state, OPEN(), [
      { team: 0, units: [{ unitId: 'vex-0', ability: { abilityId: 'frag_grenade', target: [{ x: 7, y: 7 }] } }] },
      { team: 1, units: [] },
    ], roster);
    expect(unit(t1.state, 'bastion-0').hp).toBe(130); // armed only, no damage yet
    expect(t1.state.delayed).toHaveLength(1);

    const t2 = resolveTurn(t1.state, OPEN(), [{ team: 0, units: [] }, { team: 1, units: [] }], roster);
    expect(unit(t2.state, 'bastion-0').hp).toBe(96); // 34 detonation on a Bastion that held its ground
    expect(t2.state.delayed).toHaveLength(0);
    expect(t2.events.some((e) => e.type === 'abilityFired' && e.abilityId === 'frag_grenade')).toBe(true);
  });

  it('misses if the target vacates the aimed square on the turn it is thrown', () => {
    // The grenade is aimed at Bastion's square and detonates in Blast next turn —
    // before Move — so the read is to leave now, the same turn Vex commits.
    const v = spawnUnit(VEX, 'vex-0', 0, { x: 5, y: 7 });
    const b = spawnUnit(BASTION, 'bastion-0', 1, { x: 7, y: 7 });
    const t1 = resolveTurn(makeState([v, b]), OPEN(), [
      { team: 0, units: [{ unitId: 'vex-0', ability: { abilityId: 'frag_grenade', target: [{ x: 7, y: 7 }] } }] },
      { team: 1, units: [{ unitId: 'bastion-0', sprint: true, movePath: [8, 9, 10, 11].map((x) => ({ x, y: 7 })) }] },
    ], roster);
    expect(unit(t1.state, 'bastion-0').pos).toEqual({ x: 11, y: 7 }); // walked clear
    const t2 = resolveTurn(t1.state, OPEN(), [{ team: 0, units: [] }, { team: 1, units: [] }], roster);
    expect(unit(t2.state, 'bastion-0').hp).toBe(130); // detonation at (7,7) finds nobody
  });
});

describe("Bastion's kit through the pipeline", () => {
  it('Ram Charge passes through and strikes the first enemy (MV1)', () => {
    // Post-MV1 the charge crosses Vex and rests on the far side. Vex still takes
    // the charge damage. Its 1-square knockback would land exactly on the square
    // Bastion settled on: the charger's body is not an obstacle to cross (MV1-fix),
    // but a unit may never *end* on another's square, so Vex stays put rather than
    // co-occupying. Fully landing Vex beyond the charger needs the Designer's
    // charge-combat ruling / vector-sum displacement (edge-cases ENGINE ASK / CL2).
    const b = spawnUnit(BASTION, 'bastion-0', 0, { x: 2, y: 7 });
    const v = spawnUnit(VEX, 'vex-0', 1, { x: 5, y: 7 });
    const { state } = resolveTurn(makeState([b, v]), OPEN(), [
      { team: 0, units: [{ unitId: 'bastion-0', ability: { abilityId: 'ram_charge', target: [{ x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 }] } }] },
      { team: 1, units: [] },
    ], roster);
    expect(unit(state, 'bastion-0').pos).toEqual({ x: 6, y: 7 }); // charged through Vex to the far side
    expect(unit(state, 'vex-0').hp).toBe(80); // 15 charge damage off Vex's 95
    expect(unit(state, 'vex-0').pos).not.toEqual(unit(state, 'bastion-0').pos); // no co-occupation
  });

  it('Bulwark shield in Prep soaks a Blast the same turn', () => {
    const b = spawnUnit(BASTION, 'bastion-0', 0, { x: 5, y: 7 });
    const v = spawnUnit(VEX, 'vex-0', 1, { x: 5, y: 2 });
    const { state } = resolveTurn(makeState([b, v]), OPEN(), [
      { team: 0, units: [{ unitId: 'bastion-0', ability: { abilityId: 'bulwark', target: [] } }] },
      { team: 1, units: [{ unitId: 'vex-0', ability: { abilityId: 'rail_shot', target: [{ x: 5, y: 14 }] } }] },
    ], roster);
    expect(unit(state, 'bastion-0').hp).toBe(130); // 26 rail fully soaked by the 30 shield
  });
});

describe('a decisive turn yields a winner and a coherent event log', () => {
  it('a killing blow at match point ends the game for player 0', () => {
    const v = spawnUnit(VEX, 'vex-0', 0, { x: 3, y: 7 });
    const b = spawnUnit(BASTION, 'bastion-0', 1, { x: 5, y: 7 }, );
    b.hp = 20;
    const state = makeState([v, b], { kills: [2, 0] });
    const { state: next, events } = resolveTurn(state, OPEN(), [
      { team: 0, units: [{ unitId: 'vex-0', ability: { abilityId: 'rail_shot', target: [{ x: 14, y: 7 }] } }] },
      { team: 1, units: [] },
    ], roster);
    expect(next.kills).toEqual([3, 0]);
    expect(next.status).toBe('finished');
    expect(next.winner).toBe(0);
    expect(events.some((e) => e.type === 'death' && e.unitId === 'bastion-0')).toBe(true);
    expect(events.some((e) => e.type === 'gameEnd' && e.result === 'win')).toBe(true);
    expect(phaseOrder(events).slice(0, 4)).toEqual(['prep', 'dash', 'blast', 'move']);
  });
});

describe('a full scripted Vex-vs-Bastion match on the real arena', () => {
  it('runs many turns of real orders with a sane, well-formed event log', () => {
    let state = createInitialState(ARENA, VEX, BASTION);
    // Both close to mid-lane, then trade their kits turn after turn.
    const vexTurn = (t: number): PlayerOrders => ({
      team: 0,
      units: [
        t === 0
          ? { unitId: 'vex-0', sprint: true, movePath: [{ x: 2, y: 7 }, { x: 2, y: 6 }, { x: 2, y: 5 }] }
          : t % 3 === 1
            ? { unitId: 'vex-0', ability: { abilityId: 'frag_grenade', target: [{ x: 7, y: 5 }] } }
            : { unitId: 'vex-0', ability: { abilityId: 'overwatch_trap', target: [{ x: 3, y: 5 }] } },
      ],
    });
    const bastionTurn = (t: number): PlayerOrders => ({
      team: 1,
      units: [
        t === 0
          ? { unitId: 'bastion-0', sprint: true, movePath: [{ x: 12, y: 7 }, { x: 12, y: 6 }, { x: 12, y: 5 }] }
          : { unitId: 'bastion-0', ability: { abilityId: 'bulwark', target: [] } },
      ],
    });

    let abilityFired = 0;
    for (let t = 0; t < 14; t++) {
      const { state: next, events } = resolveTurn(state, ARENA, [vexTurn(t), bastionTurn(t)], roster);
      expect(phaseOrder(events)).toEqual(['prep', 'dash', 'blast', 'move']); // sacred order every turn
      abilityFired += events.filter((e) => e.type === 'abilityFired').length;
      // Every unit stays within sane bounds throughout.
      for (const u of next.units) {
        expect(u.hp).toBeGreaterThanOrEqual(0);
        expect(u.hp).toBeLessThanOrEqual(u.maxHp);
        expect(u.energy).toBeGreaterThanOrEqual(0);
      }
      state = next;
    }
    expect(abilityFired).toBeGreaterThanOrEqual(10); // both acted most turns
    expect(state.turn).toBe(15); // 14 turns advanced from turn 1
  });
});
