import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, FORMATS, getFormat, type FormatId } from '../src/formats.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders } from '../src/types.js';

const lethal: AbilityDef = {
  id: 'nuke', name: 'Nuke', phase: 'blast', shape: 'square', range: 9, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 100 }], description: 'lethal',
};
const char: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [lethal, lethal, lethal, lethal], ultimate: lethal,
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 9 }, () => '.'.repeat(9)));
const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[]) =>
  resolveTurn(s, OPEN(), [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);

describe('format table', () => {
  it('matches GAME_SPEC §1', () => {
    expect(FORMATS['2v2']).toEqual({ id: '2v2', charactersPerTeam: 2, killsToWin: 4, turnLimit: 16 });
    expect(FORMATS['4v4']).toEqual({ id: '4v4', charactersPerTeam: 4, killsToWin: 5, turnLimit: 20 });
    expect(FORMATS['1v1']).toEqual({ id: '1v1', charactersPerTeam: 1, killsToWin: 3, turnLimit: 12 });
    expect(DEFAULT_FORMAT).toBe('2v2');
    expect(getFormat(undefined)).toBe(FORMATS['2v2']);
  });
});

/** A lethal blast bringing team 0 one kill closer, from `kills`, at `format`. */
function killTurn(format: FormatId, kills: [number, number]) {
  const u = makeUnit('u', 0, { x: 3, y: 3 });
  const e = makeUnit('e', 1, { x: 3, y: 5 }, { hp: 10 });
  return run(makeState([u, e], { format, kills }), [{ unitId: 'u', ability: { abilityId: 'nuke', target: [{ x: 3, y: 5 }] } }], []);
}

describe('per-format kill target', () => {
  it('1v1 wins at 3 kills, not before', () => {
    expect(killTurn('1v1', [1, 0]).state.status).toBe('active'); // → 2, keep playing
    const win = killTurn('1v1', [2, 0]);
    expect(win.state.kills).toEqual([3, 0]);
    expect(win.state.status).toBe('finished');
    expect(win.state.winner).toBe(0);
  });

  it('2v2 needs 4 kills — a 3rd kill does not win', () => {
    expect(killTurn('2v2', [2, 0]).state.status).toBe('active'); // → 3, still short of 4
    expect(killTurn('2v2', [3, 0]).state.status).toBe('finished'); // → 4, wins
  });

  it('4v4 needs 5 kills', () => {
    expect(killTurn('4v4', [3, 0]).state.status).toBe('active'); // → 4
    expect(killTurn('4v4', [4, 0]).state.status).toBe('finished'); // → 5
  });
});

describe('per-format turn limit', () => {
  const holdTurn = (format: FormatId, turn: number, kills: [number, number]) =>
    run(makeState([makeUnit('u', 0, { x: 1, y: 1 }), makeUnit('e', 1, { x: 7, y: 7 })], { format, turn, kills }), [], []);

  it('2v2 decides on the leader after turn 16 (not 12)', () => {
    const at12 = holdTurn('2v2', 12, [1, 0]);
    expect(at12.state.status).toBe('active'); // still playing — 2v2 runs to 16
    expect(at12.state.turn).toBe(13);
    const at16 = holdTurn('2v2', 16, [1, 0]);
    expect(at16.state.status).toBe('finished');
    expect(at16.state.winner).toBe(0);
  });

  it('4v4 runs to turn 20; a tie at the limit enters sudden death', () => {
    expect(holdTurn('4v4', 19, [2, 2]).state.status).toBe('active');
    const tie = holdTurn('4v4', 20, [2, 2]);
    expect(tie.state.status).toBe('active');
    expect(tie.state.suddenDeath).toBe(true);
    expect(tie.state.turn).toBe(21);
  });
});
