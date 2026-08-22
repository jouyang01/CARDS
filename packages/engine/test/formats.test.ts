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
    expect(FORMATS['2v2']).toEqual({ id: '2v2', charactersPerTeam: 2, killsToWin: 4, turnLimit: 20 });
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

  it('2v2 decides on the leader after turn 20 (not 16)', () => {
    // TTK-TURN-LIMIT raised the 2v2 limit 16 → 20. The assertion keeps its
    // shape — still running at the OLD boundary, finished at the new one — so
    // it goes on proving that the limit is read per format rather than that a
    // particular number is written down somewhere.
    const at16 = holdTurn('2v2', 16, [1, 0]);
    expect(at16.state.status).toBe('active'); // still playing — 2v2 runs to 20
    expect(at16.state.turn).toBe(17);
    const at20 = holdTurn('2v2', 20, [1, 0]);
    expect(at20.state.status).toBe('finished');
    expect(at20.state.winner).toBe(0);
  });

  it('4v4 runs to turn 20; a tie at the limit enters sudden death', () => {
    expect(holdTurn('4v4', 19, [2, 2]).state.status).toBe('active');
    const tie = holdTurn('4v4', 20, [2, 2]);
    expect(tie.state.status).toBe('active');
    expect(tie.state.suddenDeath).toBe(true);
    expect(tie.state.turn).toBe(21);
  });
});

describe('SUDDEN-DEATH: at the limit, the next kill wins', () => {
  /**
   * The owner's ruling, verbatim: *"in Sudden Death, the next kill wins."*
   *
   * The behaviour **already ships** — `resolveOutcome` re-runs its
   * `turn >= turnLimit` comparison every turn, so the first turn that produces a
   * kill differential ends the match for the leader. What did not exist was a
   * test: `per-format turn limit` above proves sudden death is *entered* and
   * then stops, which leaves the half that actually decides matches unpinned.
   *
   * Test-only by construction. If any assertion here had needed a production
   * change to pass, the ruling and the code would have diverged and that would
   * have been a finding rather than a test edit — none did.
   */

  /** A 2v2 already past the limit, tied, with Sudden Death live. */
  const inSuddenDeath = (kills: [number, number]): GameState => makeState(
    [makeUnit('u', 0, { x: 3, y: 3 }, { hp: 10 }), makeUnit('e', 1, { x: 3, y: 5 }, { hp: 10 })],
    { format: '2v2', turn: 21, kills, suddenDeath: true },
  );
  const nuke = (unitId: string, at: { x: number; y: number }): UnitOrders =>
    ({ unitId, ability: { abilityId: 'nuke', target: [{ ...at }] } });

  it('(a) a kill differential ends it, and the leader wins', () => {
    // The ruling itself, and the thing no existing test asked. Note the kills
    // are 2–2, nowhere near the format's target of 4: past the limit it is the
    // LEAD that decides, not the target.
    const out = run(inSuddenDeath([2, 2]), [nuke('u', { x: 3, y: 5 })], []);
    expect(out.state.kills, 'one team pulled ahead').toEqual([3, 2]);
    expect(out.state.status).toBe('finished');
    expect(out.state.winner).toBe(0);
  });

  it('…and it is the LEADER who wins, whichever side that is', () => {
    // A guard against a tiebreak that quietly favours team 0 — the same shape
    // of bug as a tie broken by iteration order.
    const out = run(inSuddenDeath([2, 2]), [], [nuke('e', { x: 3, y: 3 })]);
    expect(out.state.kills).toEqual([2, 3]);
    expect(out.state.winner).toBe(1);
  });

  it('(b) a turn that stays tied continues — still active, still sudden death', () => {
    // No kill, no decision. The flag survives and the turn counter moves, which
    // is what makes "unbounded" real rather than a footnote: play simply goes on
    // until somebody lands one.
    const out = run(inSuddenDeath([2, 2]), [], []);
    expect(out.state.status).toBe('active');
    expect(out.state.suddenDeath).toBe(true);
    expect(out.state.kills, 'nobody scored').toEqual([2, 2]);
    expect(out.state.turn, 'and the match moved on').toBe(22);
  });

  it('(c) a Double KO that carries BOTH teams to the target is the one draw', () => {
    // The single genuine tie the game keeps (RULED — Mutual damage): all Blast
    // damage resolves simultaneously, a unit that dies this phase still deals
    // its full locked damage, and if that puts both teams on `killsToWin` at
    // once nobody got "the next kill". 3–3 → 4–4 at a target of 4.
    const both = makeState(
      [makeUnit('u', 0, { x: 3, y: 3 }, { hp: 10 }), makeUnit('e', 1, { x: 3, y: 5 }, { hp: 10 })],
      { format: '2v2', turn: 21, kills: [3, 3], suddenDeath: true },
    );
    const out = run(both, [nuke('u', { x: 3, y: 5 })], [nuke('e', { x: 3, y: 3 })]);
    expect(out.state.kills, 'both scored, in the same phase').toEqual([4, 4]);
    expect(out.state.status).toBe('draw');
    expect(out.state.winner, 'nobody won it').toBeUndefined();
  });

  it('(d) a Double KO BELOW the target stays tied, and play continues', () => {
    // The other side of (c), and the reason it is worth two tests: a mutual
    // trade is not a decision unless it reaches the target. 2–2 → 3–3 at a
    // target of 4 is still Sudden Death.
    const out = run(inSuddenDeath([2, 2]), [nuke('u', { x: 3, y: 5 })], [nuke('e', { x: 3, y: 3 })]);
    expect(out.state.kills).toEqual([3, 3]);
    expect(out.state.status, 'nobody pulled ahead').toBe('active');
    expect(out.state.suddenDeath).toBe(true);
  });

  it('and Sudden Death has no cap — it is still going many turns later', () => {
    // Ruled unbounded: no artificial turn limit, no alternate tiebreak (not
    // total damage, not first blood). BOTPLAY found ~6% of bot brawls still
    // tied at 3x the limit; that is a bot artifact — bots do not focus-fire —
    // and explicitly not a reason to invent a tiebreak nobody asked for.
    let s = inSuddenDeath([2, 2]);
    for (let i = 0; i < 30; i++) s = run(s, [], []).state;
    expect(s.status, 'still playing').toBe('active');
    expect(s.suddenDeath).toBe(true);
    expect(s.turn, 'thirty turns past the limit').toBe(51);
  });
});
