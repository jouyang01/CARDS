import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../src/resolve.js';
import { buildRoster, spawnUnit } from '../src/setup.js';
import { makeMap, makeState } from './helpers.js';
import type { CharacterDef, GameState, PlayerOrders, TurnEvent } from '../src/types.js';

import vex from '../../../data/characters/vex.json';
import wisp from '../../../data/characters/wisp.json';
import bastion from '../../../data/characters/bastion.json';

const VEX = vex as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const roster = buildRoster([VEX, WISP, BASTION]);
const OPEN = () => makeMap(Array.from({ length: 15 }, () => '.'.repeat(15)));

const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const has = (evts: TurnEvent[], type: TurnEvent['type']) => evts.some((e) => e.type === type);
const hold: [PlayerOrders, PlayerOrders] = [{ team: 0, units: [] }, { team: 1, units: [] }];

/**
 * Wisp (at 5,7) places the decoy on (5,8) and steps aside to (6,7), isolating it.
 *
 * W1 moved the decoy from *the caster's square* to *an aimed square within 3*,
 * so the cast now carries an aim and the decoy lands at (5,8) rather than under
 * Wisp's feet. She still steps off the column afterwards, which is what every
 * test below needs — a decoy that can be shot at without hitting the real Wisp.
 * It cannot be aimed at (5,7) any more either: DECOY-PLACEMENT refuses an
 * occupied square, and at Prep she is standing on it.
 */
const DECOY_AT = { x: 5, y: 8 };
const castAndStepAside = (s: GameState) =>
  resolveTurn(s, OPEN(), [
    { team: 0, units: [{ unitId: 'wisp-0', ability: { abilityId: 'veil_decoy', target: [DECOY_AT] }, movePath: [{ x: 6, y: 7 }] }] },
    { team: 1, units: [] },
  ], roster);

describe('D1: Wisp decoy (R2)', () => {
  it('casting Veil & Decoy spawns a decoy at the AIMED square, out of units, with a render event', () => {
    // W1: *"She can place her decoy at a range of 3."* It used to appear under
    // her feet, which made the deception a coin flip — anyone who saw Wisp cast
    // knew which of the two was real by watching where she went next.
    const wispU = spawnUnit(WISP, 'wisp-0', 0, { x: 5, y: 7 });
    const { state, events } = resolveTurn(makeState([wispU]), OPEN(), [
      { team: 0, units: [{ unitId: 'wisp-0', ability: { abilityId: 'veil_decoy', target: [DECOY_AT] } }] },
      { team: 1, units: [] },
    ], roster);

    expect(state.decoys).toHaveLength(1);
    expect(state.decoys[0]).toMatchObject({ teamId: 0, pos: DECOY_AT, expiresOnTurn: 2 });
    expect(state.decoys[0]!.pos, 'and NOT under the caster').not.toEqual({ x: 5, y: 7 });
    expect(state.units.some((u) => u.unitId === state.decoys[0]!.id)).toBe(false); // never a unit
    const spawned = events.find((e) => e.type === 'decoySpawned');
    expect(spawned).toMatchObject({ type: 'decoySpawned', pos: DECOY_AT, teamId: 0 });
  });

  it('survives the cast turn and expires at the end of the next turn', () => {
    const t1 = resolveTurn(makeState([spawnUnit(WISP, 'wisp-0', 0, { x: 5, y: 7 })]), OPEN(), [
      { team: 0, units: [{ unitId: 'wisp-0', ability: { abilityId: 'veil_decoy', target: [DECOY_AT] } }] },
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
    // Turn 1: Wisp places the decoy at (5,8) and steps to (6,7).
    const t1 = castAndStepAside(start);
    expect(t1.state.decoys[0]!.pos).toEqual(DECOY_AT);

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
    expect(t1.state.decoys[0]!.pos).toEqual(DECOY_AT);

    // Turn 2: Vex walks onto the decoy's square (decoys block nothing).
    const t2 = resolveTurn(t1.state, OPEN(), [
      { team: 0, units: [] },
      { team: 1, units: [{ unitId: 'vex-0', movePath: [{ x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 }] }] },
    ], roster);
    expect(unit(t2.state, 'vex-0').pos).toEqual(DECOY_AT); // moved through/onto it
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
      { team: 1, units: [{ unitId: 'vex-0', movePath: [{ x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 }, { x: 5, y: 9 }] }] },
    ], roster);
    expect(unit(t2.state, 'vex-0').pos).toEqual({ x: 5, y: 9 }); // passed clean through
    expect(t2.state.kills).toEqual(before); // destroying a decoy is not a kill
  });
});

describe('D1-dash: a Dash ending on a decoy destroys it; a knockback does not', () => {
  /** Index of the first event of `type`, or -1. Used to place a destroy in the phase order. */
  const idxOf = (evts: TurnEvent[], pred: (e: TurnEvent) => boolean) => evts.findIndex(pred);
  const phaseIdx = (evts: TurnEvent[], phase: string) =>
    idxOf(evts, (e) => e.type === 'phaseStart' && (e as { phase: string }).phase === phase);

  it('an enemy Dash ending on the decoy square destroys it, during the Dash phase', () => {
    const start = makeState([
      spawnUnit(WISP, 'wisp-0', 0, { x: 5, y: 7 }),
      spawnUnit(VEX, 'vex-0', 1, { x: 5, y: 5 }),
    ]);
    const t1 = castAndStepAside(start);
    expect(t1.state.decoys[0]!.pos).toEqual(DECOY_AT);

    // Vex combat-rolls (dash, path) onto the decoy square.
    const t2 = resolveTurn(t1.state, OPEN(), [
      { team: 0, units: [] },
      { team: 1, units: [{ unitId: 'vex-0', ability: { abilityId: 'combat_roll', target: [{ x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 }] } }] },
    ], roster);

    expect(unit(t2.state, 'vex-0').pos).toEqual(DECOY_AT); // dash ended on it
    expect(t2.state.decoys).toHaveLength(0);
    const destroyed = idxOf(t2.events, (e) => e.type === 'decoyDestroyed');
    expect(destroyed).toBeGreaterThan(-1);
    // Destroyed by the dash, not by end-of-turn expiry: it fires before Blast starts.
    expect(destroyed).toBeLessThan(phaseIdx(t2.events, 'blast'));
  });

  it('an involuntary knockback onto the decoy square does NOT destroy it', () => {
    // This one does NOT use `castAndStepAside`: the shove is a row-7 line
    // (Bastion → Vex → the decoy square), so the decoy has to be *on* row 7
    // rather than at the shared helper's (5,8). W1 makes that easy and is
    // exactly why — Wisp stands a couple of squares clear at (5,9) and places
    // the decoy on the square Vex is about to be shoved onto.
    const start = makeState([
      spawnUnit(WISP, 'wisp-0', 0, { x: 5, y: 9 }),
      spawnUnit(BASTION, 'bastion-0', 0, { x: 2, y: 7 }),
      spawnUnit(VEX, 'vex-0', 1, { x: 4, y: 7 }),
    ]);
    const t1 = resolveTurn(start, OPEN(), [
      { team: 0, units: [{ unitId: 'wisp-0', ability: { abilityId: 'veil_decoy', target: [{ x: 5, y: 7 }] } }] },
      { team: 1, units: [] },
    ], roster);
    expect(t1.state.decoys[0]!.pos).toEqual({ x: 5, y: 7 });

    // Bastion rams from (2,7): it rests at (3,7) (Vex blocks (4,7)) and knocks Vex
    // one square along the charge, from (4,7) onto the decoy at (5,7).
    const t2 = resolveTurn(t1.state, OPEN(), [
      { team: 0, units: [{ unitId: 'bastion-0', ability: { abilityId: 'ram_charge', target: [{ x: 3, y: 7 }, { x: 4, y: 7 }] } }] },
      { team: 1, units: [] },
    ], roster);

    expect(unit(t2.state, 'vex-0').pos).toEqual({ x: 5, y: 7 }); // shoved onto the decoy
    expect(unit(t2.state, 'bastion-0').pos).toEqual({ x: 3, y: 7 }); // charger did not end on it
    // The decoy survived the knockback and only went away at end-of-turn expiry,
    // so its single destroy event comes after the Move phase started.
    const destroyed = idxOf(t2.events, (e) => e.type === 'decoyDestroyed');
    expect(destroyed).toBeGreaterThan(phaseIdx(t2.events, 'move'));
  });
});
