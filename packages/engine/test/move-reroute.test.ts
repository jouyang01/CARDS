import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type {
  AbilityDef, CharacterDef, GameState, MapDef, TurnEvent, UnitOrders, Vec2,
} from '../src/types.js';

/**
 * MOVE-REROUTE — **a blocked mover goes around, if it can still afford to.**
 *
 * Owner Dev Note (2026-09-02): *"If movement path is blocked, the character
 * should try alternate pathing to get to the spot if there is enough movement
 * points to get there."*
 *
 * This amends the standing ruling that a blocked or contested unit *"stops for
 * the rest of the phase (remaining path dropped)"*. Planning already routes
 * around everything it can see — `pathTo` is a Dijkstra over the same board the
 * engine walks — so the only way a player meets a blocked path is the one the
 * ruling describes: the turn is simultaneous, somebody stepped into the corridor
 * after the orders were written, and the walk stops dead on its second square.
 *
 * The note's two halves are both load-bearing and both asserted below: **go
 * around**, and **only if the points are there**. A unit that cannot afford the
 * detour still halts exactly as it did, which is what keeps this from being
 * "movement is free now".
 */

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [ability({ id: 'noop' })],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const FIELD: MapDef = makeMap(Array.from({ length: 11 }, () => '.'.repeat(11)));

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = []) =>
  resolveTurn(s, FIELD, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const at = (s: GameState, id: string): Vec2 => s.units.find((u) => u.unitId === id)!.pos;
const unit = (id: string, owner: 0 | 1, x: number, y: number) =>
  makeUnit(id, owner, { x, y }, { characterId: 'test-char' });
/** Every square `id` was recorded stepping onto. */
const walked = (events: TurnEvent[], id: string): string[] => events
  .filter((e): e is Extract<TurnEvent, { type: 'moveStep' }> => e.type === 'moveStep' && e.unitId === id)
  .map((e) => `${e.to.x},${e.to.y}`);

/** A straight eastward walk along row 5, from `x0` (exclusive) to `x1`. */
const east = (x0: number, x1: number): Vec2[] =>
  Array.from({ length: x1 - x0 }, (_, i) => ({ x: x0 + 1 + i, y: 5 }));

/**
 * THE SCENARIO, shared by most of the file.
 *
 * `a` walks east along row 5 from (1,5) to its spot at (5,5). `b` starts north
 * of the corridor at (3,4) and steps **into** (3,5) — legal for both of them
 * when the orders were written, because `a`'s path was validated against a board
 * where (3,5) was empty. `a` meets a body on its third square.
 *
 * ```
 *      1  2  3  4  5
 *  4   .  .  b  .  .      b drops south into the corridor
 *  5   a  .  ↓  .  ✳      a is walking to (5,5)
 * ```
 */
const corridor = (): GameState => makeState([unit('a', 0, 1, 5), unit('b', 1, 3, 4)]);
const cutOff = (sprint = false): ReturnType<typeof run> => run(
  corridor(),
  [{ unitId: 'a', sprint, movePath: east(1, 5) }],
  [{ unitId: 'b', movePath: [{ x: 3, y: 5 }] }],
);

describe('MOVE-REROUTE: the note', () => {
  it('THE NOTE: cut off mid-walk, the unit paths around and still arrives', () => {
    // Move budget 4; the walk is 4 straight. Going around costs 5 — one
    // orthogonal step out, along, and back — which does not fit... so this case
    // uses the sprint that does. The Move-budget version is the next test, and
    // the pair is the whole rule.
    const { state } = cutOff(true);
    expect(at(state, 'a'), 'it reached the square it was sent to').toEqual({ x: 5, y: 5 });
  });

  it('…and it really went AROUND — it never stood on the blocked square', () => {
    // The half that makes the arrival about re-routing rather than about the
    // blocker having moved on. `b` ends its move on (3,5) and stays there, so a
    // route still crossing it would have been blocked a second time.
    const { state, events } = cutOff(true);
    expect(at(state, 'b'), 'the blocker is still in the corridor').toEqual({ x: 3, y: 5 });
    expect(walked(events, 'a'), 'no step onto the occupied square').not.toContain('3,5');
  });

  it('THE OTHER HALF: without the points for a detour it halts, as it always did', () => {
    // *"if there is enough movement points to get there."* On the plain Move
    // budget of 4 the four straight squares are the whole allowance, so there is
    // nothing left to spend going round and the old behaviour stands.
    const { state } = cutOff(false);
    expect(at(state, 'a')).toEqual({ x: 2, y: 5 });
  });

  it('the points are what is LEFT, not the whole allowance', () => {
    // The budget is spent, not waived — and it has to be measured from the
    // squares already walked, which is the half a "does the detour fit" check
    // can quietly get wrong.
    //
    // `a` sprints 8 from (1,5) to (8,5), seven squares. The wall along row 4
    // (x = 4..7) means the only way round a block on row 5 is south. `b` steps
    // into (5,5) after `a` has walked three squares, so 3 of the 8 are gone and
    // the way round from (4,5) costs 6 — more than the 5 that are left, and less
    // than the 8 it started with. Measuring against the full allowance walks it
    // all the way to (8,5) on movement it never had.
    const WALLED = makeMap(Array.from({ length: 11 }, (_, y) =>
      (y === 4 ? '....####...' : '.'.repeat(11))));
    const { state } = resolveTurn(
      makeState([unit('a', 0, 1, 5), unit('b', 1, 5, 6)]), WALLED,
      [
        { team: 0, units: [{ unitId: 'a', sprint: true, movePath: east(1, 8) }] },
        { team: 1, units: [{ unitId: 'b', movePath: [{ x: 5, y: 5 }] }] },
      ], roster,
    );
    expect(at(state, 'a'), 'halted where it was cut off').toEqual({ x: 4, y: 5 });
  });
});

describe('MOVE-REROUTE: what it will not do', () => {
  it('it will not re-route onto a square somebody is standing on', () => {
    // "Get to the spot" cannot mean stacking on it. `b` ends its own move ON
    // `a`'s destination, so there is no legal arrival and `a` halts.
    const { state } = run(
      makeState([unit('a', 0, 1, 5), unit('b', 1, 5, 4)]),
      [{ unitId: 'a', sprint: true, movePath: east(1, 5) }],
      [{ unitId: 'b', movePath: [{ x: 5, y: 5 }] }],
    );
    expect(at(state, 'b')).toEqual({ x: 5, y: 5 });
    expect(at(state, 'a'), 'stopped one square short rather than sharing the tile')
      .toEqual({ x: 4, y: 5 });
  });

  it('it will not settle for a different square — the spot is the spot', () => {
    // A one-tile corridor with a body parked in it: the destination (5,5) is
    // free and affordable, and there is simply no way to it. The unit halts on
    // the square it was cut off at rather than wandering to the nearest tile it
    // *can* reach. MOVE1 already gives the player that forgiveness at **planning**
    // time, where they can see it happen and click again; doing it silently at
    // resolution would put a unit somewhere nobody chose.
    const CORRIDOR = makeMap(Array.from({ length: 11 }, (_, y) =>
      (y === 5 ? '.'.repeat(11) : '#'.repeat(11))));
    const { state } = resolveTurn(
      makeState([unit('a', 0, 1, 5), unit('b', 1, 3, 5)]), CORRIDOR,
      [
        { team: 0, units: [{ unitId: 'a', sprint: true, movePath: east(1, 5) }] },
        { team: 1, units: [] },
      ], roster,
    );
    expect(at(state, 'a'), 'stopped at the body, not re-homed').toEqual({ x: 2, y: 5 });
  });

  it('the way round avoids EVERY body, not just the one that blocked it', () => {
    // `b` cuts the corridor and `c` is parked on (4,4), which is on the natural
    // detour north. The re-route treats both as walls — the original path was
    // allowed to bank on somebody moving aside, a re-route is not, because it
    // exists precisely because that bet failed — so the unit swings south
    // instead and still arrives.
    const { state, events } = run(
      makeState([unit('a', 0, 1, 5), unit('b', 1, 3, 4), unit('c', 1, 4, 4)]),
      [{ unitId: 'a', sprint: true, movePath: east(1, 5) }],
      [{ unitId: 'b', movePath: [{ x: 3, y: 5 }] }],
    );
    expect(at(state, 'a'), 'arrived by the other side').toEqual({ x: 5, y: 5 });
    expect(walked(events, 'a'), 'never through the parked body').not.toContain('4,4');
    const squares = state.units.filter((u) => u.alive).map((u) => `${u.pos.x},${u.pos.y}`);
    expect(new Set(squares).size, 'nobody is stacked').toBe(squares.length);
  });
});

describe('MOVE-REROUTE: determinism', () => {
  it('the same cut-off resolves identically twice, and never edits the input', () => {
    // Golden rule #1, on the one change in this file that adds a pathfind to the
    // middle of a simultaneous phase.
    const before = JSON.stringify(corridor());
    const s = corridor();
    const orders: [UnitOrders[], UnitOrders[]] = [
      [{ unitId: 'a', sprint: true, movePath: east(1, 5) }],
      [{ unitId: 'b', movePath: [{ x: 3, y: 5 }] }],
    ];
    const one = run(s, ...orders);
    const two = run(s, ...orders);
    expect(JSON.stringify(one.state)).toBe(JSON.stringify(two.state));
    expect(JSON.stringify(one.events)).toBe(JSON.stringify(two.events));
    expect(JSON.stringify(s), 'the draft was not mutated').toBe(before);
  });
});
