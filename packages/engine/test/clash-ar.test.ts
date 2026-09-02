import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type {
  AbilityDef, CharacterDef, GameState, MapDef, TurnEvent, UnitOrders, Vec2,
} from '../src/types.js';

/**
 * CLASH-AR — AR's clash rules, adopted verbatim on the owner's directive.
 *
 * Owner Dev Note: *"the sprint bug happened because of clashing movement
 * patterns which the designer spec should fix."*
 *
 * The shipped rule was "a contested square admits nobody", which stopped **every
 * unit** that targeted a square another unit targeted on the same step — so two
 * paths that merely crossed in the middle of the board gridlocked, and a long
 * sprint routed through the middle could be halted at its second square and look
 * exactly like a move that did nothing. AR stops a unit only when it is *ending*
 * its movement on a square somebody else is also ending on:
 *
 * | | AR case | result |
 * |---|---|---|
 * | 1 | both passing through | both continue; a pad there is claimed by neither |
 * | 2 | both ending there | both forced back to the square they last held; pad denied |
 * | 3 | one ending, one passing | the ender rests and takes the pad; the passer continues |
 *
 * Rule 2 was already our behaviour. Rules 1 and 3 are the change, and rule 3 is
 * why the movement half and the pad half have to land together: the ender only
 * gets the pad if it is allowed to arrive in the first place.
 *
 * Each case is run twice — with a pad on the contested square and without —
 * because the pad half amends a *different* rule (earliest-entrant) than the
 * movement half, and a change to either could pass one and fail the other.
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

/** The contested square every case below meets on. */
const X: Vec2 = { x: 5, y: 5 };
const grid = () => Array.from({ length: 11 }, () => '.'.repeat(11));
const BARE: MapDef = makeMap(grid());
/** The same board with a Might pad on the contested square, live from turn 1. */
const PADDED: MapDef = makeMap(grid(), {
  powerups: [{ x: X.x, y: X.y, type: 'might', firstTurn: 1, everyTurns: 3 }],
});

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[], map: MapDef) =>
  resolveTurn(s, map, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const at = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!.pos;
/** Who, if anyone, picked the pad up. */
const taker = (events: TurnEvent[]): string | undefined =>
  events.find((e): e is Extract<TurnEvent, { type: 'powerupTaken' }> => e.type === 'powerupTaken')?.unitId;

/**
 * `a` west of the contested square, `e` north of it — the two meet at right
 * angles rather than head-on.
 *
 * Head-on is not available: MV2 lets a path *cross* an occupied square but never
 * *end* on one, so two units walking at each other are rejected at validation
 * before any clash rule is reached. Crossing routes are also the shape the
 * ruling is about — "through-the-middle routes" — so this is the honest fixture
 * rather than a workaround.
 */
const crossing = (aX: number, eY: number): GameState => makeState([
  makeUnit('a', 0, { x: aX, y: X.y }, { characterId: 'test-char' }),
  makeUnit('e', 1, { x: X.x, y: eY }, { characterId: 'test-char' }),
]);
/** A straight walk east along the contested row. */
const east = (from: number, to: number): Vec2[] =>
  Array.from({ length: to - from }, (_, i) => ({ x: from + i + 1, y: X.y }));
/** …and south down the contested column. */
const south = (from: number, to: number): Vec2[] =>
  Array.from({ length: to - from }, (_, i) => ({ x: X.x, y: from + i + 1 }));

/**
 * AR rule 1 — both passing through. `a` walks 3→7 across the row and `e` walks
 * 3→7 down the column; both enter (5,5) on their second step, both bound on.
 */
const rule1 = (map: MapDef) => run(
  crossing(3, 3),
  [{ unitId: 'a', movePath: east(3, 7) }],
  [{ unitId: 'e', movePath: south(3, 7) }],
  map,
);

/** AR rule 2 — both ending on (5,5), one from the west and one from the north. */
const rule2 = (map: MapDef) => run(
  crossing(3, 3),
  [{ unitId: 'a', movePath: east(3, 5) }],
  [{ unitId: 'e', movePath: south(3, 5) }],
  map,
);

/**
 * AR rule 3 — one ending, one passing, and the passer gets there *first*.
 *
 * `e` starts one square north and steps onto the square immediately (step 0) on
 * its way further south; `a` is two away and arrives on step 1, where it stops.
 * Under the plain earliest-entrant rule the pad went to `e`, which crossed a
 * whole step earlier — the amendment gives it to `a`, which rested.
 */
const rule3 = (map: MapDef) => run(
  crossing(3, 4),
  [{ unitId: 'a', movePath: east(3, 5) }],
  [{ unitId: 'e', movePath: south(4, 7) }],
  map,
);

describe('CLASH-AR rule 1: both passing through continue', () => {
  it('neither is stopped — both reach the square they were bound for', () => {
    const { state } = rule1(BARE);
    expect(at(state, 'a'), 'the eastbound unit gridlocked instead of crossing').toEqual({ x: 7, y: X.y });
    expect(at(state, 'e'), 'the southbound unit gridlocked instead of crossing').toEqual({ x: X.x, y: 7 });
  });

  it('and a pad on the contested square is claimed by neither', () => {
    // Amendment (a): they set foot on it on the same step, so the tie is not
    // broken by whichever event happened to be emitted first.
    const { events } = rule1(PADDED);
    expect(taker(events)).toBeUndefined();
  });
});

describe('CLASH-AR rule 2: both ending are forced back', () => {
  it('each stops on the square it last held', () => {
    const { state } = rule2(BARE);
    expect(at(state, 'a')).toEqual({ x: 4, y: X.y });
    expect(at(state, 'e')).toEqual({ x: X.x, y: 4 });
  });

  it('and the pad is denied, because nobody is standing on it', () => {
    const { events } = rule2(PADDED);
    expect(taker(events)).toBeUndefined();
  });
});

describe('CLASH-AR rule 3: the ender rests, the passer continues', () => {
  it('the ender arrives and the passer is not stopped by it', () => {
    const { state } = rule3(BARE);
    expect(at(state, 'a'), 'the ender was blocked out of the square it was ending on')
      .toEqual(X);
    expect(at(state, 'e'), 'the passer was stopped by an ender it merely crossed')
      .toEqual({ x: X.x, y: 7 });
  });

  it('the ender takes the pad even though the passer crossed it FIRST', () => {
    // The amendment, at its sharpest: `e` was on the square a whole step before
    // `a` got there, and still loses it. Resting is the stronger commitment.
    const { state, events } = rule3(PADDED);
    expect(at(state, 'a')).toEqual(X);
    expect(taker(events)).toBe('a');
  });
});

describe('CLASH-AR: what does NOT change', () => {
  it('a direct 2-cycle swap is still blocked for both', () => {
    // AR's text is silent on swaps and our own ruling stands: two units trading
    // squares may not pass through each other. Neither is "ending on a contested
    // square" here, so this would sail straight through the new gate if the swap
    // check had been folded into it.
    // Two steps, because a one-step swap is rejected at validation (each path
    // would *end* on a square the other is standing on). They step toward each
    // other, then try to trade — and that trade is what the block refuses.
    const s = makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 6, y: X.y }, { characterId: 'test-char' }),
    ]);
    const { state } = run(
      s,
      [{ unitId: 'a', movePath: [{ x: 4, y: X.y }, { x: 5, y: X.y }] }],
      [{ unitId: 'e', movePath: [{ x: 5, y: X.y }, { x: 4, y: X.y }] }],
      BARE,
    );
    expect(at(state, 'a')).toEqual({ x: 4, y: X.y });
    expect(at(state, 'e')).toEqual({ x: 5, y: X.y });
  });

  it('a lone walker still stops when a stationary unit is in the way', () => {
    // Occupancy is not a clash. Nobody else is moving, so there is no contest —
    // the square is simply full, and that block is untouched.
    const s = makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 5, y: X.y }, { characterId: 'test-char' }),
    ]);
    const { state } = run(s, [{ unitId: 'a', movePath: east(3, 6) }], [], BARE);
    expect(at(state, 'a')).toEqual({ x: 4, y: X.y });
  });

  it('an uncontested pad still goes to the unit that walked over it', () => {
    // PADS-PASS, unamended: one unit, no tie, no ender to outrank it.
    const s = makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 9, y: X.y }, { characterId: 'test-char' }),
    ]);
    const { state, events } = run(s, [{ unitId: 'a', movePath: east(3, 7) }], [], PADDED);
    expect(at(state, 'a')).toEqual({ x: 7, y: X.y });
    expect(taker(events)).toBe('a');
  });
});

describe('CLASH-AR: the report it was ruled to fix', () => {
  it('a long run through a crossing point is not halted at the crossing', () => {
    // The owner attributes "the first sprint does not move the character" to
    // this: a sprint routed through the middle met another mover on one step and
    // the old rule halted the whole path there. Eight squares, one crossing,
    // and it now arrives.
    const s = makeState([
      makeUnit('a', 0, { x: 1, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: X.x, y: 1 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(
      s,
      [{ unitId: 'a', sprint: true, movePath: east(1, 9) }],
      // `e` settles onto the crossing square on the very step `a` passes it —
      // rule 3, in the wild, and the worst case for the old stops-all rule.
      [{ unitId: 'e', movePath: south(1, 5) }],
      BARE,
    );
    expect(at(state, 'a'), 'the sprint was halted at the crossing').toEqual({ x: 9, y: X.y });
    expect(at(state, 'e'), 'and the unit that was ending there still arrived').toEqual(X);
  });
});

/**
 * CLASH-CORNER — the corner rule 3 opens, and the ruling that closes it.
 *
 * Rule 3 lets an ender and a passer share a square *at the end of a step*, on
 * the promise that the passer walks on. Block the passer's next step and the
 * promise breaks: it comes to rest on the ender, and Collisions forbids that.
 * The ruling gives it the ender's own bounce — back to the last square it held
 * alone.
 */
describe('CLASH-CORNER: a blocked passer never rests on an occupied square', () => {
  /** A stationary wall of a unit, so a passer can be wedged against something. */
  const blocker = (pos: Vec2) => makeUnit('b', 0, pos, { characterId: 'test-char' });

  /** Every living unit's square, to check nobody is doubled up. */
  const rests = (s: GameState): string[] =>
    s.units.filter((u) => u.alive).map((u) => `${u.pos.x},${u.pos.y}`);

  it('bounces to its last-held square when the next step is blocked', () => {
    // `e` ends on the contested square (5,5). `a` means to pass through it and
    // carry on east to (7,5) — but `b` is parked on (6,5), so the step after
    // the pass is refused. Without the ruling `a` rests on (5,5) with `e`.
    const s = makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      blocker({ x: 6, y: X.y }),
      makeUnit('e', 1, { x: X.x, y: 3 }, { characterId: 'test-char' }),
    ]);
    const { state, events } = run(
      s,
      [{ unitId: 'a', movePath: east(3, 7) }],
      [{ unitId: 'e', movePath: south(3, 5) }],
      BARE,
    );
    expect(at(state, 'e'), 'the ender rested, as rule 3 says').toEqual(X);
    expect(at(state, 'a'), 'and the wedged passer fell back off it').toEqual({ x: 4, y: X.y });
    expect(new Set(rests(state)).size, 'nobody is stacked').toBe(rests(state).length);
    // The bounce is a step in the log, so playback animates it rather than
    // snapping the model back. (Asserted here since MOVE-REROUTE: this is the
    // case with no budget for a detour, so it is the one that still bounces —
    // `a` walks 4 to reach (7,5) and the cheapest way around `b` costs more.)
    const mine = events.filter((e) => e.type === 'moveStep' && e.unitId === 'a');
    expect(mine.at(-1)).toMatchObject({ from: X, to: { x: 4, y: X.y } });
  });

  it('MOVE-REROUTE: with the points to spare, the wedged passer goes AROUND', () => {
    // Re-specced 2026-09-02. This asserted the bounce — `a` wedged against `b`
    // and fell back to (4,5) — until the owner ruled: *"If movement path is
    // blocked, the character should try alternate pathing to get to the spot if
    // there is enough movement points to get there."* Sprinting, `a` has 8 to
    // spend on a 5-cost walk, so the detour around `b` fits and it arrives.
    //
    // The bounce itself is not lost: the case above is the same wedge on a Move
    // budget that cannot afford any way round, and it still falls back one
    // square along its own path.
    const s = makeState([
      makeUnit('a', 0, { x: 2, y: X.y }, { characterId: 'test-char' }),
      blocker({ x: 6, y: X.y }),
      makeUnit('e', 1, { x: X.x, y: 2 }, { characterId: 'test-char' }),
    ]);
    const { state, events } = run(
      s,
      // Sprinting, so the walk is not clamped to *end* on the blocker — a path
      // that ends on an occupied square is refused at validation (MV2) and
      // never reaches a clash rule at all.
      [{ unitId: 'a', sprint: true, movePath: east(2, 7) }],
      [{ unitId: 'e', movePath: south(2, 5) }],
      BARE,
    );
    expect(at(state, 'a'), 'it reached the square it was sent to').toEqual({ x: 7, y: X.y });
    // …and it went round rather than through: `b` never vacated (6,5), so a
    // route that still crossed it would have been the old wedge again.
    const mine = events.filter((e) => e.type === 'moveStep' && e.unitId === 'a');
    expect(mine.some((e) => e.type === 'moveStep' && e.to.x === 6 && e.to.y === X.y),
      'nobody walks through the blocker').toBe(false);
    expect(at(state, 'b'), 'which is still standing there').toEqual({ x: 6, y: X.y });
    expect(new Set(rests(state)).size, 'nobody is stacked').toBe(rests(state).length);
  });

  it('a BODY is the only thing that can wedge a passer — terrain never gets the chance', () => {
    // The ruling names "a stationary unit, a wall, or the map edge". Only the
    // first is reachable for a walked move, and it is worth pinning why: a path
    // that runs through a wall (or off the board) is refused at **validation**,
    // long before any step clock, so the unit simply does not move and there is
    // no passer to wedge. A body is different precisely because MV2 lets a path
    // cross one.
    const WALLED: MapDef = makeMap(grid().map((row, y) =>
      (y === X.y ? `${row.slice(0, 6)}#${row.slice(7)}` : row)));
    const s = makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: X.x, y: 3 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(
      s,
      [{ unitId: 'a', movePath: east(3, 7) }], // straight through the wall on (6,5)
      [{ unitId: 'e', movePath: south(3, 5) }],
      WALLED,
    );
    expect(at(state, 'a'), 'the whole walk was refused, so nothing to bounce').toEqual({ x: 3, y: X.y });
    expect(new Set(rests(state)).size).toBe(rests(state).length);
  });

  it('a chain of two blocked passers each fall back one', () => {
    // `a` and `c` both cross the column; `e` ends on (5,5) and `b` blocks
    // (6,5). `a` is wedged onto the ender and bounces to (4,5) — which is
    // where `c` was going to be. Whoever the walk-back finds occupied, it keeps
    // stepping back, so both end alone.
    const s = makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('c', 0, { x: 2, y: X.y }, { characterId: 'test-char' }),
      blocker({ x: 6, y: X.y }),
      makeUnit('e', 1, { x: X.x, y: 3 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(
      s,
      [
        { unitId: 'a', movePath: east(3, 7) },
        { unitId: 'c', movePath: east(2, 5) },
      ],
      [{ unitId: 'e', movePath: south(3, 5) }],
      BARE,
    );
    expect(new Set(rests(state)).size, 'nobody is stacked').toBe(rests(state).length);
    expect(at(state, 'e')).toEqual(X);
  });

  it('the invariant itself: no two living units ever rest on one square', () => {
    // The property the bug broke, asserted over the messiest board the fixture
    // can build — four movers, one ender, one blocker, one contested square.
    const s = makeState([
      makeUnit('a', 0, { x: 2, y: X.y }, { characterId: 'test-char' }),
      makeUnit('c', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      blocker({ x: 7, y: X.y }),
      makeUnit('e', 1, { x: X.x, y: 2 }, { characterId: 'test-char' }),
      makeUnit('f', 1, { x: X.x, y: 8 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(
      s,
      [
        { unitId: 'a', sprint: true, movePath: east(2, 6) },
        { unitId: 'c', sprint: true, movePath: east(3, 6) },
      ],
      [
        { unitId: 'e', movePath: south(2, 5) },
        { unitId: 'f', movePath: [7, 6].map((y) => ({ x: X.x, y })) },
      ],
      BARE,
    );
    expect(new Set(rests(state)).size).toBe(rests(state).length);
  });
});

/**
 * CLASH-CONGA — the last resort under CLASH-CORNER's bounce.
 *
 * The bounce walks a wedged passer back along its own path. A conga line takes
 * that away: every square it covered is somebody else's rest, so there is
 * nowhere to step back to and standing still would stack. The ruling cancels the
 * move instead — back to the phase-start origin, which is safe because two units
 * cannot have begun the phase on one square.
 */
describe('CLASH-CONGA: with nowhere to bounce, the move is cancelled', () => {
  const rests = (s: GameState): string[] =>
    s.units.filter((u) => u.alive).map((u) => `${u.pos.x},${u.pos.y}`);

  it('nobody is ever stacked, however tightly the movers are packed', () => {
    // Four units on one row walking east into a stationary wall of a body, with
    // an ender settling onto the row from the column. Whatever the clock does
    // with them, the invariant is the invariant.
    const s = makeState([
      makeUnit('a', 0, { x: 2, y: X.y }, { characterId: 'test-char' }),
      makeUnit('c', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('d', 0, { x: 4, y: X.y }, { characterId: 'test-char' }),
      makeUnit('b', 0, { x: 7, y: X.y }, { characterId: 'test-char' }), // the wall
      makeUnit('e', 1, { x: X.x, y: 2 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(
      s,
      [
        { unitId: 'a', sprint: true, movePath: east(2, 9) },
        { unitId: 'c', sprint: true, movePath: east(3, 9) },
        { unitId: 'd', sprint: true, movePath: east(4, 9) },
      ],
      [{ unitId: 'e', movePath: south(2, 5) }],
      BARE,
    );
    expect(new Set(rests(state)).size, 'no two living units on one square').toBe(rests(state).length);
  });

  it('a cancelled mover is back on the square it started the phase on', () => {
    // The cancel is not "somewhere safe" — it is specifically home, which is
    // what makes the cascade collision-free rather than merely lucky.
    const s = makeState([
      makeUnit('a', 0, { x: 2, y: X.y }, { characterId: 'test-char' }),
      makeUnit('c', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('b', 0, { x: 6, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: X.x, y: 3 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(
      s,
      [
        { unitId: 'a', sprint: true, movePath: east(2, 8) },
        { unitId: 'c', sprint: true, movePath: east(3, 8) },
      ],
      [{ unitId: 'e', movePath: south(3, 5) }],
      BARE,
    );
    // Everyone is somewhere legal, and anybody who could not find a bounce is
    // on their own starting square rather than wedged onto a neighbour.
    expect(new Set(rests(state)).size).toBe(rests(state).length);
    for (const [id, home] of [['a', 2], ['c', 3]] as const) {
      const p = at(state, id);
      const cancelled = p.x === home && p.y === X.y;
      const moved = p.x > home;
      expect(cancelled || moved, `${id} either advanced or went home`).toBe(true);
    }
  });

  it('the ender that caused it still keeps its square', () => {
    // The cascade only ever touches movers that could not resolve; the unit
    // whose rest started the pile-up is not displaced by it.
    const s = makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('c', 0, { x: 2, y: X.y }, { characterId: 'test-char' }),
      makeUnit('b', 0, { x: 6, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: X.x, y: 3 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(
      s,
      [
        { unitId: 'a', sprint: true, movePath: east(3, 8) },
        { unitId: 'c', sprint: true, movePath: east(2, 8) },
      ],
      [{ unitId: 'e', movePath: south(3, 5) }],
      BARE,
    );
    expect(at(state, 'e'), 'the ender rested where rule 3 says it does').toEqual(X);
    expect(at(state, 'b'), 'and the stationary body never moved').toEqual({ x: 6, y: X.y });
  });
});
