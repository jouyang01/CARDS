import { describe, expect, it } from 'vitest';
import { SPRINT_RANGE, VISION_RANGE } from '../src/constants.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders, Vec2 } from '../src/types.js';

/**
 * CHASE-AUDIT — *"Chase needs to follow better, sometimes the character chases
 * directly to the tile the last character was on even if we know where the
 * chase target went. Audit Chasing."*
 *
 * The audit found one cause, and it is not in the chase at all: `lastKnown` —
 * the square a fogged chase falls back to — was written **only at the turn
 * boundary** (`recordLastKnown`, called from `endOfTurn`). So the fallback a
 * chase reached for during Move was always the board as it stood at the end of
 * the PREVIOUS turn, no matter what the team had watched happen since.
 *
 * The gap that opens is the report. An enemy the team could not see at the last
 * turn boundary is brought into view during this one — a teammate dashes up and
 * spots it; it is on their screen, it is the thing they are shooting at — and
 * then it steps into cover during Move. The chase asks "where did we last see
 * it?" and is handed a square from turns ago, sometimes in the opposite
 * direction. The chaser walks away from the enemy it just watched.
 *
 * The fix is one call at the top of `runMove`: record what each team can see
 * against the post-Blast board — the board the client has just finished playing
 * back to them. Nothing about the chase itself changes, and golden rule #5 is
 * untouched, because a team still only ever remembers a square it was shown.
 *
 * **The other suspect was examined and left alone.** The chase snapshot is the
 * post-*normal*-move board, so a target that is itself chasing is pursued to its
 * pre-chase tile. That is not a bug, it is CHASE1's convergence design: every
 * chaser reads one frozen board, so A-chases-B and B-chases-A cannot depend on
 * which of them the loop visits first. Making the snapshot live would make a
 * mutual chase order-dependent, which is a worse fault than the one it fixes.
 */

const rows = (h: number, w: number): string[] =>
  Array.from({ length: h }, () => '.'.repeat(w));
/** A thicket at x=13..16 on row 10 — somewhere to disappear into, in the open. */
const BRUSHY = makeMap(rows(21, 21).map((row, y) =>
  (y === 10 ? `${row.slice(0, 13)}bbbb${row.slice(17)}` : row)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 20 }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shot' }),
    ability({ id: 'leap', phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = []) =>
  resolveTurn(s, BRUSHY, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const at = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!.pos;
const remembered = (s: GameState, team: 0 | 1, id: string): Vec2 | undefined =>
  s.lastKnown.find((k) => k.team === team && k.unitId === id)?.pos;

/**
 * The reported shape, laid out so the two answers point in opposite directions.
 *
 * Team 0 is `a`, the chaser, back at (3,10), and `spotter`, off at (3,12).
 * `e` stands at (11,10) — eight squares from both of them, so the turn opens
 * with team 0 genuinely unable to see it, and team 0's memory of `e` is an old
 * square **north** at (5,4).
 *
 * `spotter` leaps to (7,12), six squares from `e` and looking straight at it:
 * team 0 spends this turn watching the enemy. Then `e` walks **east** into the
 * thicket at (13,10) and is gone again.
 *
 * So "the tile the last character was on" is north, and "where we know it went"
 * is east. A chaser cannot accidentally satisfy both.
 */
const board = (): GameState => {
  const s = makeState([
    makeUnit('a', 0, { x: 3, y: 10 }, { characterId: 'test-char' }),
    makeUnit('spotter', 0, { x: 3, y: 12 }, { characterId: 'test-char' }),
    makeUnit('e', 1, { x: 11, y: 10 }, { characterId: 'test-char' }),
  ]);
  s.turn = 4;
  s.lastKnown.push({ team: 0, unitId: 'e', pos: { x: 5, y: 4 }, turn: 1 });
  return s;
};

/** The teammate who dashes up and puts eyes on the enemy. */
const spot: UnitOrders = { unitId: 'spotter', ability: { abilityId: 'leap', target: [{ x: 7, y: 12 }] } };
/** `e` slips east into the brush. */
const slip: UnitOrders[] = [{ unitId: 'e', movePath: [{ x: 12, y: 10 }, { x: 13, y: 10 }] }];

describe('CHASE-AUDIT: the fixture sets the two answers against each other', () => {
  it('nobody can see the enemy at the start, or at the end', () => {
    // Asserted before anything is concluded from it. If `e` were visible when
    // the chase resolves, the fallback would never be consulted and every test
    // below would be about something else.
    expect(VISION_RANGE, 'six reaches (11,10) from (7,12), and not from (3,10)').toBe(6);
    const { state } = run(board(), [], slip);
    expect(at(state, 'e'), 'it slipped into the thicket').toEqual({ x: 13, y: 10 });
    // With no spotter the turn teaches team 0 nothing, at either end of it.
    expect(remembered(state, 0, 'e'), 'the stale square survives').toEqual({ x: 5, y: 4 });
  });

  it('the spotter is what makes the enemy visible, and only mid-turn', () => {
    // The other half of the fixture: with the leap, team 0 sees `e` in Dash and
    // Blast — and still cannot see where it finished, because the thicket
    // conceals from anyone not standing next to it.
    const { state } = run(board(), [spot], slip);
    expect(at(state, 'spotter'), 'it got its eyes up').toEqual({ x: 7, y: 12 });
    expect(remembered(state, 0, 'e'), 'and never saw the square it ended on')
      .not.toEqual({ x: 13, y: 10 });
  });
});

describe('CHASE-AUDIT: a chase follows what the team watched, not last turn’s record', () => {
  it('THE BUG: the chaser goes east after the enemy, not north to a stale tile', () => {
    // On `main` this ends on (5,4): the chaser turns its back on the enemy its
    // team spent the turn looking at and walks eight squares to a tile that has
    // been empty since turn 1. That is the report, verbatim.
    const { state } = run(board(), [{ unitId: 'a', chase: 'e' }, spot], slip);
    expect(at(state, 'a'), 'not north, to where it was three turns ago')
      .not.toEqual({ x: 5, y: 4 });
    expect(at(state, 'a').x, 'east, toward where it went').toBeGreaterThan(3);
  });

  it('and it runs the whole way to the last square anybody actually saw', () => {
    // The pursuit stated in full: the refreshed memory sends the chaser at
    // (11,10), CHASE-FOLLOW re-asks on every step, and the thicket keeps `e`
    // hidden right up to the end — so the chase stops on the memory, as ruled,
    // but on the RIGHT memory.
    const { state, events } = run(board(), [{ unitId: 'a', chase: 'e' }, spot], slip);
    expect(at(state, 'a'), 'the square team 0 last saw the enemy on').toEqual({ x: 11, y: 10 });
    expect(events).toContainEqual({
      type: 'chaseResolved', unitId: 'a', targetUnitId: 'e', to: { x: 11, y: 10 }, seen: false,
    });
    // Eight squares of pursuit needs the budget a bare chase gets (CHASE-SPRINT);
    // without it this would be a different test.
    expect(SPRINT_RANGE).toBe(8);
  });

  it('the memory itself is refreshed mid-turn, and only with what was seen', () => {
    // The mechanism, asserted where it lives. (11,10) is the square team 0
    // watched `e` occupy through Blast; (13,10) is the one it never saw.
    const { state } = run(board(), [{ unitId: 'a', chase: 'e' }, spot], slip);
    expect(remembered(state, 0, 'e'), 'the last square team 0 actually saw')
      .toEqual({ x: 11, y: 10 });
  });

  it('golden rule #5 holds: an enemy seen by NOBODY leaves the memory alone', () => {
    // The half that must not move. Without the spotter's leap team 0 is shown
    // nothing all turn, so the chase still heads for the old square — a chase
    // that reached for the true position here would leak precisely what the fog
    // exists to hide.
    const { state } = run(board(), [{ unitId: 'a', chase: 'e' }], slip);
    expect(remembered(state, 0, 'e'), 'nothing was learned').toEqual({ x: 5, y: 4 });
    expect(at(state, 'a'), 'so the chase went to the memory, as ruled').toEqual({ x: 5, y: 4 });
  });
});

describe('CHASE-AUDIT: the mid-turn refresh is symmetric and leaks nothing', () => {
  it('each team only ever gains a square it could see for itself', () => {
    // Both directions in one turn. Team 1 is watching `e`'s pursuers arrive, so
    // its record of them moves; team 0's record of `e` gains the square `e`
    // stood on in the open and nothing past it.
    const { state } = run(board(), [{ unitId: 'a', chase: 'e' }, spot], slip);
    expect(remembered(state, 0, 'e'), 'team 0 saw only the square in the open')
      .toEqual({ x: 11, y: 10 });
    expect(remembered(state, 1, 'a'), 'team 1 watched the chaser come in')
      .toEqual({ x: 11, y: 10 });
    // And nobody keeps a record of their own units — `lastKnown` is about enemies.
    expect(state.lastKnown.some((k) => k.team === 0 && k.unitId === 'a')).toBe(false);
  });

  it('and the turn replays identically, memory included', () => {
    const first = run(board(), [{ unitId: 'a', chase: 'e' }, spot], slip);
    const again = run(board(), [{ unitId: 'a', chase: 'e' }, spot], slip);
    expect(again.state.lastKnown).toEqual(first.state.lastKnown);
    expect(again.state.units.map((u) => u.pos)).toEqual(first.state.units.map((u) => u.pos));
  });
});
