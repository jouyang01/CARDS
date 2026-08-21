import { describe, expect, it } from 'vitest';
import {
  ULT_COST, createMatch, resolveTurn,
  type CharacterDef, type GameState, type MapDef, type Roster, type TurnEvent, type UnitOrders,
} from '@cards/engine';
import {
  clock, endReasonText, foldTurn, initTotals, matchBreakdown, matchResult, scoreReadout, tally,
} from '../src/scoreboard.js';

/**
 * SCORE1 — the scoreboard, and the ledger behind it.
 *
 * The whole design claim is that **no engine change is needed for the useful
 * half**: kills, deaths, HP, energy and the clock are already in `GameState`,
 * and damage/healing are in the event log, which is the rendering contract. So
 * these tests drive real turns through `resolveTurn` and fold the real log —
 * asserting against a hand-built event array would prove the fold works on
 * events the engine may not actually emit.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }, { x: 1, y: 9 }], [{ x: 13, y: 7 }, { x: 13, y: 9 }]],
};
const ability = (id: string, over: Partial<CharacterDef['abilities'][number]> = {}) => ({
  id, name: id, phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 20 }],
  description: id, ...over,
});
const gunner: CharacterDef = {
  id: 'gunner', name: 'Vex', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability('shoot'),
    ability('leap', { phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] }),
  ],
  ultimate: ability('ult', { shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const medic: CharacterDef = {
  id: 'medic', name: 'Aegis', archetype: 'support', maxHp: 100,
  abilities: [
    ability('mend', { shape: 'circle', range: 6, radius: 1, effects: [{ kind: 'heal', amount: 20 }] }),
    ability('ward', { shape: 'circle', range: 6, radius: 1, effects: [{ kind: 'shield', amount: 30, duration: 2 }] }),
  ],
  ultimate: ability('sup-ult', { shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { gunner, medic };
const names = (id: string) => (id.startsWith('gunner') ? 'Vex' : 'Aegis');

const match = (): GameState => createMatch(OPEN, '2v2', [[gunner, medic], [gunner, medic]]);
const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = []) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const row = (totals: ReturnType<typeof initTotals>, id: string) => totals.get(id)!;

// Unit ids from `createMatch`: "<characterId>-t<team>-<i>".
const A_GUN = 'gunner-t0-0';
const A_MED = 'medic-t0-1';
const E_GUN = 'gunner-t1-0';

describe('SCORE1: the ledger is folded from the event log', () => {
  it('counts damage on both ledgers — dealt by one, taken by the other', () => {
    const s = match();
    unit(s, E_GUN).pos = { x: 6, y: 7 };
    unit(s, A_GUN).pos = { x: 2, y: 7 };
    const { events } = run(s, [{ unitId: A_GUN, ability: { abilityId: 'shoot', target: [{ x: 14, y: 7 }] } }]);
    const totals = foldTurn(initTotals(s), events);
    expect(row(totals, A_GUN).damageDealt).toBe(20);
    expect(row(totals, E_GUN).damageTaken).toBe(20);
  });

  it('counts the shielded portion as dealt — a shield does not un-throw the punch', () => {
    // `amount` is what reached HP and `absorbed` is what the shield ate. Both
    // were dealt, and adding only the first would make a support look like they
    // deleted damage from the match rather than absorbing it.
    let s = match();
    // The medic stands outside its own ward's radius, so the 30 on the ledger
    // is unambiguously the one it gave away.
    unit(s, A_MED).pos = { x: 4, y: 7 };
    unit(s, A_GUN).pos = { x: 6, y: 7 };
    unit(s, E_GUN).pos = { x: 6, y: 10 };
    let totals = initTotals(s);
    const warded = run(s, [{ unitId: A_MED, ability: { abilityId: 'ward', target: [{ x: 6, y: 7 }] } }]);
    totals = foldTurn(totals, warded.events);
    s = warded.state;
    const shot = run(s, [], [{ unitId: E_GUN, ability: { abilityId: 'shoot', target: [{ x: 6, y: 0 }] } }]);
    totals = foldTurn(totals, shot.events);
    expect(row(totals, E_GUN).damageDealt, 'the whole swing, shield or no shield').toBe(20);
    expect(row(totals, A_MED).supportGiven, 'and the ward is on the medic').toBe(30);
  });

  it('counts healing as support given, credited to the healer', () => {
    const s = match();
    unit(s, A_MED).pos = { x: 5, y: 7 };
    unit(s, A_GUN).pos = { x: 6, y: 7 };
    unit(s, A_GUN).hp = 50;
    const { events } = run(s, [{ unitId: A_MED, ability: { abilityId: 'mend', target: [{ x: 6, y: 7 }] } }]);
    const totals = foldTurn(initTotals(s), events);
    expect(row(totals, A_MED).supportGiven).toBe(20);
    expect(row(totals, A_GUN).supportGiven, 'the patient did not heal anybody').toBe(0);
  });

  it('a kill lands on the unit the log named, and the death on the victim', () => {
    const s = match();
    unit(s, A_GUN).pos = { x: 2, y: 7 };
    unit(s, E_GUN).pos = { x: 6, y: 7 };
    unit(s, E_GUN).hp = 5;
    const { events } = run(s, [{ unitId: A_GUN, ability: { abilityId: 'shoot', target: [{ x: 14, y: 7 }] } }]);
    const totals = foldTurn(initTotals(s), events);
    expect(row(totals, A_GUN).kills).toBe(1);
    expect(row(totals, E_GUN).deaths).toBe(1);
  });

  it('accumulates across turns', () => {
    let s = match();
    unit(s, A_GUN).pos = { x: 2, y: 7 };
    unit(s, E_GUN).pos = { x: 6, y: 7 };
    let totals = initTotals(s);
    for (let i = 0; i < 2; i++) {
      const res = run(s, [{ unitId: A_GUN, ability: { abilityId: 'shoot', target: [{ x: 14, y: 7 }] } }]);
      totals = foldTurn(totals, res.events);
      s = res.state;
    }
    expect(row(totals, A_GUN).damageDealt).toBe(40);
  });

  it('never mutates the ledger it was given', () => {
    const s = match();
    const before = initTotals(s);
    foldTurn(before, [{ type: 'damage', unitId: E_GUN, amount: 20, absorbed: 0, sourceUnitId: A_GUN, abilityId: 'shoot' }]);
    expect(row(before, A_GUN).damageDealt, 'the old ledger is still the old ledger').toBe(0);
  });

  it('credits nobody when the log names nobody', () => {
    // A death with no preceding damage — a kill the engine deliberately scores
    // for no team. Guessing a killer here would put a point on the board that
    // the engine's own tally does not have.
    const s = match();
    const totals = foldTurn(initTotals(s), [{ type: 'death', unitId: E_GUN, killer: 0 } as TurnEvent]);
    expect(row(totals, E_GUN).deaths).toBe(1);
    expect([...totals.values()].reduce((n, r) => n + r.kills, 0)).toBe(0);
  });

  it('does not credit a unit for killing itself', () => {
    const totals = foldTurn(initTotals(match()), [
      { type: 'damage', unitId: A_GUN, amount: 20, absorbed: 0, sourceUnitId: A_GUN, abilityId: 'shoot' },
      { type: 'death', unitId: A_GUN, killer: 1 },
    ]);
    expect(row(totals, A_GUN).kills).toBe(0);
    expect(row(totals, A_GUN).deaths).toBe(1);
  });

  it('a DoT tick lands on whoever lit it, turns later (DOT-HOT + A0)', () => {
    // The reason the fold reads `sourceUnitId` instead of tracking who acted:
    // an over-time tick has no acting unit at all.
    const totals = foldTurn(initTotals(match()), [
      { type: 'damage', unitId: E_GUN, amount: 10, absorbed: 0, sourceUnitId: A_GUN, abilityId: 'damageOverTime' },
    ]);
    expect(row(totals, A_GUN).damageDealt).toBe(10);
  });
});

describe('SCORE1: the in-match readout', () => {
  it('reads the tally against the format target and the clock', () => {
    const s = match();
    const readout = scoreReadout(s, names);
    expect(readout.killTarget, '2v2 is first to 4').toBe(4);
    expect(readout.turnLimit).toBe(20);
    expect(tally(readout.kills[0], readout.killTarget)).toBe('0 / 4');
    expect(clock(readout.turn, readout.turnLimit)).toBe('Turn 1 of 20');
  });

  it('gives one row per character, with HP and progress toward the ult', () => {
    const s = match();
    unit(s, A_GUN).energy = ULT_COST / 2;
    const rows = scoreReadout(s, names).rows;
    expect(rows).toHaveLength(4);
    const me = rows.find((r) => r.unitId === A_GUN)!;
    expect(me).toMatchObject({ alive: true, hp: 100, maxHp: 100, ultPct: 50, owner: 0, name: 'Vex' });
  });

  it('clamps the ult meter at 100 rather than reporting 140%', () => {
    const s = match();
    unit(s, A_GUN).energy = ULT_COST * 1.4;
    expect(scoreReadout(s, names).rows.find((r) => r.unitId === A_GUN)!.ultPct).toBe(100);
  });

  it('shows a downed character with its respawn countdown', () => {
    const s = match();
    unit(s, E_GUN).alive = false;
    unit(s, E_GUN).respawnIn = 1;
    const row0 = scoreReadout(s, names).rows.find((r) => r.unitId === E_GUN)!;
    expect(row0).toMatchObject({ alive: false, respawnIn: 1 });
  });

  it('carries sudden death, which is the one thing that changes how a turn is played', () => {
    const s = { ...match(), suddenDeath: true };
    expect(scoreReadout(s, names).suddenDeath).toBe(true);
  });
});

describe('SCORE1: the end-of-match breakdown', () => {
  const finished = (over: Partial<GameState>): GameState => ({ ...match(), status: 'finished', ...over });

  it('names the winner and how they got there — the kill target', () => {
    const result = matchResult(finished({ winner: 0, kills: [4, 2] }), names);
    expect(result.reason).toBe('killTarget');
    expect(endReasonText(result)).toBe('Team 1 wins on kills, 4–2.');
  });

  it('…the turn limit', () => {
    const result = matchResult(finished({ winner: 1, kills: [1, 3] }), names);
    expect(result.reason).toBe('turnLimit');
    expect(endReasonText(result)).toBe('Team 2 wins on the turn limit, 1–3.');
  });

  it('…and sudden death', () => {
    const result = matchResult(finished({ winner: 0, kills: [3, 2], suddenDeath: true }), names);
    expect(result.reason).toBe('suddenDeath');
    expect(endReasonText(result)).toContain('sudden death');
  });

  it('handles a Double KO as a draw with no winner at all', () => {
    const result = matchResult({ ...match(), status: 'draw', kills: [3, 3] }, names);
    expect(result.draw).toBe(true);
    expect(result.winner).toBeUndefined();
    expect(endReasonText(result)).toBe('Double KO — the match is a draw.');
  });

  it('attaches every character\'s totals, in state order', () => {
    let s = match();
    unit(s, A_GUN).pos = { x: 2, y: 7 };
    unit(s, E_GUN).pos = { x: 6, y: 7 };
    const res = run(s, [{ unitId: A_GUN, ability: { abilityId: 'shoot', target: [{ x: 14, y: 7 }] } }]);
    const totals = foldTurn(initTotals(s), res.events);
    s = { ...res.state, status: 'finished', winner: 0 };
    const breakdown = matchBreakdown(s, names, totals);
    expect(breakdown.rows.map((r) => r.unitId)).toEqual(s.units.map((u) => u.unitId));
    expect(breakdown.rows.find((r) => r.unitId === A_GUN)).toMatchObject({ damageDealt: 20, name: 'Vex' });
    expect(breakdown.rows.find((r) => r.unitId === E_GUN)).toMatchObject({ damageTaken: 20 });
  });

  it('a character who never appeared in the log still gets a row of zeroes', () => {
    const s = { ...match(), status: 'finished' as const, winner: 0 as const };
    const breakdown = matchBreakdown(s, names, initTotals(s));
    expect(breakdown.rows).toHaveLength(4);
    for (const r of breakdown.rows) expect(r.damageDealt).toBe(0);
  });
});

describe('SCORE1: a short match, end to end', () => {
  it('the readout and the totals both track a real sequence of turns', () => {
    let s = match();
    unit(s, A_GUN).pos = { x: 2, y: 7 };
    unit(s, E_GUN).pos = { x: 6, y: 7 };
    // Off the firing line: `shoot` is a line and friendly fire is on (FF1), so a
    // teammate standing in it would land on the shooter's ledger too — true, but
    // not what this case is measuring.
    unit(s, A_MED).pos = { x: 3, y: 9 };
    let totals = initTotals(s);

    // Turn 1: team 0 shoots, its medic wards the shooter.
    let res = run(s, [
      { unitId: A_GUN, ability: { abilityId: 'shoot', target: [{ x: 14, y: 7 }] } },
      { unitId: A_MED, ability: { abilityId: 'ward', target: [{ x: 2, y: 7 }] } },
    ]);
    totals = foldTurn(totals, res.events);
    s = res.state;

    // Turn 2: the same again, and this one finishes the enemy off.
    // Exactly lethal, so the second shot's full 20 lands — `damage.amount` is HP
    // actually lost, so overkill would quietly shrink the total.
    unit(s, E_GUN).hp = 20;
    res = run(s, [{ unitId: A_GUN, ability: { abilityId: 'shoot', target: [{ x: 14, y: 7 }] } }]);
    totals = foldTurn(totals, res.events);
    s = res.state;

    expect(row(totals, A_GUN).kills).toBe(1);
    expect(row(totals, A_GUN).damageDealt).toBe(40);
    expect(row(totals, A_MED).supportGiven).toBe(30);
    expect(row(totals, E_GUN).deaths).toBe(1);
    // …and the engine's own tally agrees, which is the point of not recomputing.
    expect(scoreReadout(s, names).kills[0]).toBe(1);
  });
});
