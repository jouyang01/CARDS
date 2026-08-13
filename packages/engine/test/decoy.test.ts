import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../src/resolve.js';
import { buildRoster, spawnUnit } from '../src/setup.js';
import { makeMap, makeState } from './helpers.js';
import type { CharacterDef, GameState, PlayerOrders, TurnEvent } from '../src/types.js';

import vex from '../../../data/characters/vex.json';
import wisp from '../../../data/characters/wisp.json';

const VEX = vex as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const roster = buildRoster([VEX, WISP]);
const OPEN = () => makeMap(Array.from({ length: 15 }, () => '.'.repeat(15)));

const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const has = (evts: TurnEvent[], type: TurnEvent['type']) => evts.some((e) => e.type === type);
const hold: [PlayerOrders, PlayerOrders] = [{ team: 0, units: [] }, { team: 1, units: [] }];

/** Wisp casts Veil & Decoy (Prep) at (5,7) and steps aside to (6,7), isolating the decoy. */
const castAndStepAside = (s: GameState) =>
  resolveTurn(s, OPEN(), [
    { team: 0, units: [{ unitId: 'wisp-0', ability: { abilityId: 'veil_decoy', target: [] }, movePath: [{ x: 6, y: 7 }] }] },
    { team: 1, units: [] },
  ], roster);

describe('D1: Wisp decoy (R2)', () => {
  it('casting Veil & Decoy spawns a decoy at the caster square, out of units, with a render event', () => {
    const wispU = spawnUnit(WISP, 'wisp-0', 0, { x: 5, y: 7 });
    const { state, events } = resolveTurn(makeState([wispU]), OPEN(), [
      { team: 0, units: [{ unitId: 'wisp-0', ability: { abilityId: 'veil_decoy', target: [] } }] },
      { team: 1, units: [] },
    ], roster);

    expect(state.decoys).toHaveLength(1);
    expect(state.decoys[0]).toMatchObject({ teamId: 0, pos: { x: 5, y: 7 }, expiresOnTurn: 2 });
    expect(state.units.some((u) => u.unitId === state.decoys[0]!.id)).toBe(false); // never a unit
    const spawned = events.find((e) => e.type === 'decoySpawned');
    expect(spawned).toMatchObject({ type: 'decoySpawned', pos: { x: 5, y: 7 }, teamId: 0 });
  });

  it('survives the cast turn and expires at the end of the next turn', () => {
    const t1 = resolveTurn(makeState([spawnUnit(WISP, 'wisp-0', 0, { x: 5, y: 7 })]), OPEN(), [
      { team: 0, units: [{ unitId: 'wisp-0', ability: { abilityId: 'veil_decoy', target: [] } }] },
      { team: 1, units: [] },
    ], roster);
    expect(t1.state.decoys).toHaveLength(1); // lives through the cast turn

    const t2 = resolveTurn(t1.state, OPEN(), hold, roster);
    expect(t2.state.decoys).toHaveLength(0); // gone at the end of the next turn
    expect(has(t2.events, 'decoyDestroyed')).toBe(true);
  });

  it('any damage destroys a decoy, hits nobody real, and grants the attacker no energy', () => {
    const start = makeState([
      spawnUnit(WISP, 'wisp-0', 0, { x: 5, y: 7 }),
      spawnUnit(VEX, 'vex-0', 1, { x: 5, y: 2 }),
    ]);
    // Turn 1: Wisp spawns the decoy at (5,7) and steps to (6,7).
    const t1 = castAndStepAside(start);
    expect(t1.state.decoys[0]!.pos).toEqual({ x: 5, y: 7 });

    // Turn 2: Vex rails down column 5 through the decoy (Wisp is off the line at (6,7)).
    const rail: [PlayerOrders, PlayerOrders] = [
      { team: 0, units: [] },
      { team: 1, units: [{ unitId: 'vex-0', ability: { abilityId: 'rail_shot', target: [{ x: 5, y: 14 }] } }] },
    ];
    const t2 = resolveTurn(t1.state, OPEN(), rail, roster);
    expect(t2.state.decoys).toHaveLength(0); // destroyed
    expect(has(t2.events, 'decoyDestroyed')).toBe(true);
    expect(has(t2.events, 'damage')).toBe(false); // hit nobody real
    expect(unit(t2.state, 'wisp-0').hp).toBe(WISP.maxHp); // Wisp untouched

    // Control: same post-cast state, but Vex rails *away* from the decoy (up
    // column 5, hitting nothing). Energy must match the decoy-hit run — hitting
    // only a decoy grants exactly what hitting nothing grants.
    const miss: [PlayerOrders, PlayerOrders] = [
      { team: 0, units: [] },
      { team: 1, units: [{ unitId: 'vex-0', ability: { abilityId: 'rail_shot', target: [{ x: 5, y: 0 }] } }] },
    ];
    const control = resolveTurn(t1.state, OPEN(), miss, roster);
    expect(unit(t2.state, 'vex-0').energy).toBe(unit(control.state, 'vex-0').energy);
  });

  it('an enemy that ends a move on the decoy square destroys it (and is not blocked by it)', () => {
    const start = makeState([
      spawnUnit(WISP, 'wisp-0', 0, { x: 5, y: 7 }),
      spawnUnit(VEX, 'vex-0', 1, { x: 5, y: 5 }),
    ]);
    const t1 = castAndStepAside(start);
    expect(t1.state.decoys[0]!.pos).toEqual({ x: 5, y: 7 });

    // Turn 2: Vex walks onto the decoy's square (decoys block nothing).
    const t2 = resolveTurn(t1.state, OPEN(), [
      { team: 0, units: [] },
      { team: 1, units: [{ unitId: 'vex-0', movePath: [{ x: 5, y: 6 }, { x: 5, y: 7 }] }] },
    ], roster);
    expect(unit(t2.state, 'vex-0').pos).toEqual({ x: 5, y: 7 }); // moved through/onto it
    expect(t2.state.decoys).toHaveLength(0);
    expect(has(t2.events, 'decoyDestroyed')).toBe(true);
  });

  it('a decoy blocks no movement and is never a unit (no kill on destruction)', () => {
    const start = makeState([
      spawnUnit(WISP, 'wisp-0', 0, { x: 5, y: 7 }),
      spawnUnit(VEX, 'vex-0', 1, { x: 5, y: 5 }),
    ]);
    const t1 = castAndStepAside(start);
    const before = [...t1.state.kills];
    // Vex walks straight through the decoy square and past it — never blocked.
    const t2 = resolveTurn(t1.state, OPEN(), [
      { team: 0, units: [] },
      { team: 1, units: [{ unitId: 'vex-0', movePath: [{ x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 }] }] },
    ], roster);
    expect(unit(t2.state, 'vex-0').pos).toEqual({ x: 5, y: 8 }); // passed clean through
    expect(t2.state.kills).toEqual(before); // destroying a decoy is not a kill
  });
});
