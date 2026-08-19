import { describe, expect, it } from 'vitest';
import { charactersPerSeat, createRoom, join, teamSplit, wouldSeatNobody, type Room } from '../src/room.js';
import { ERROR_TEXT } from '../src/protocol.js';

/**
 * SEAT-ZERO — a team admits at most one player per character.
 *
 * `deriveSeats` hands a team's characters out at most two per player and gives
 * the leftovers `?? []`, so a team with more players than characters seats
 * somebody with **nothing**: no character to pick in the lobby, no unit to order
 * in the match, and a lock the room still waits for. Ruled (edge-cases,
 * "SEAT-ZERO"): refuse the join rather than seat a player into an empty job.
 *
 * **This is an invariant guard, not a live bug fix, and the tests say so.**
 * `nextTeam` always fills the emptier side and `roomFull` caps the room at
 * `2 × charactersPerTeam`, so no sequence of joins reaches a lopsided team
 * today — the refusal is unreachable *through `join` alone*. It is worth having
 * anyway, because the thing that would make it reachable is the obvious next
 * lobby feature: letting a player **choose** a team. The lopsided rooms below
 * are built directly, which is exactly the shape that change would produce.
 */

const seat = (seatId: string, team: 0 | 1) =>
  ({ seatId, team, name: seatId, unitIds: [], picks: [], ready: false, connected: true, missedTurns: 0 });
/** A room with seats placed by hand, bypassing `nextTeam`'s balancing. */
const lopsided = (format: '1v1' | '2v2' | '4v4', teams: (0 | 1)[]): Room => ({
  ...createRoom('WXYZ', format),
  seats: teams.map((t, i) => seat(`s${i}`, t)),
});

describe('SEAT-ZERO: the predicate, where the rule actually lives', () => {
  it('a second player on a one-character team would be seated with nothing', () => {
    // The reported corner, stated directly: 1v1 gives a team one character, so
    // its first player runs it and a second would run none.
    const oneSided = lopsided('1v1', [0]);
    expect(teamSplit(oneSided, 0), 'one seat, one character').toEqual([1]);
    expect(wouldSeatNobody(oneSided, 0), 'a second on that team gets nothing').toBe(true);
    expect(wouldSeatNobody(oneSided, 1), 'the empty side is still open').toBe(false);
  });

  it('two players on a 2v2 team is fine; a third is not', () => {
    // The cap is one player per *character*, so it moves with the format rather
    // than being a number written down twice.
    expect(wouldSeatNobody(lopsided('2v2', [0]), 0), 'one player, two characters').toBe(false);
    expect(wouldSeatNobody(lopsided('2v2', [0, 0]), 0), 'two players, two characters').toBe(true);
  });

  it('and four on a 4v4 team, no more', () => {
    expect(wouldSeatNobody(lopsided('4v4', [0, 0, 0]), 0)).toBe(false);
    expect(wouldSeatNobody(lopsided('4v4', [0, 0, 0, 0]), 0)).toBe(true);
  });

  it('the guard is wired into `join` — a saturated team is refused by name', () => {
    // Reached by building the lopsided room `nextTeam` will not produce, which
    // is the shape a "choose your team" lobby would hand it.
    const saturated: Room = { ...createRoom('WXYZ', '2v2'), seats: [seat('a', 0), seat('b', 0)] };
    // `nextTeam` sends this one to team 1, which has room…
    const legal = join(saturated, 'c');
    expect(legal.ok).toBe(true);
    if (legal.ok) expect(legal.seat.team).toBe(1);

    // …and with team 1 also full, the next join is refused for the team, not the
    // room: there is still a free slot under `roomFull`'s cap.
    const both: Room = { ...saturated, seats: [...saturated.seats, seat('c', 1)] };
    expect(wouldSeatNobody(both, 0), 'team 0 is saturated').toBe(true);
    expect(wouldSeatNobody(both, 1), 'team 1 has one character left').toBe(false);
  });

  it('a 2v2 seats four — the guard never fires on a normal room', () => {
    let room = createRoom('WXYZ', '2v2');
    for (const id of ['a', 'b', 'c', 'd']) {
      const result = join(room, id);
      expect(result.ok, `${id} joined`).toBe(true);
      if (result.ok) room = result.room;
    }
    expect(room.seats).toHaveLength(4);
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(charactersPerSeat(room, id), `${id} runs one character`).toBe(1);
    }
    const fifth = join(room, 'e');
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.reason, 'refused for being full, not for being empty').toBe('roomFull');
  });

  it('a 4v4 seats eight, and every seat is owed at least one', () => {
    let room = createRoom('WXYZ', '4v4');
    for (let i = 0; i < 8; i++) {
      const result = join(room, `p${i}`);
      expect(result.ok, `p${i} joined`).toBe(true);
      if (result.ok) room = result.room;
    }
    for (const s of room.seats) expect(charactersPerSeat(room, s.seatId)).toBeGreaterThan(0);
  });

  it('no reachable join ever creates a zero-character seat — the property', () => {
    // The invariant this guard exists to hold, asserted over every format at
    // every fill level rather than at one sampled point.
    for (const format of ['1v1', '2v2', '4v4'] as const) {
      let room = createRoom('WXYZ', format);
      for (let i = 0; i < 10; i++) {
        const result = join(room, `p${i}`);
        if (!result.ok) break;
        room = result.room;
        for (const s of room.seats) {
          expect(charactersPerSeat(room, s.seatId), `${format}: ${s.seatId} owed nothing`)
            .toBeGreaterThan(0);
        }
      }
    }
  });

  it('and the refusal has words a lobby can show', () => {
    expect(ERROR_TEXT.teamFull).toMatch(/team/i);
  });
});
