import { describe, expect, it } from 'vitest';
import { getFormat, type FormatId } from '@cards/engine';
import {
  CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  canStart,
  createRoom,
  isRoomCode,
  join,
  leave,
  mintCode,
  nextTeam,
  seatBounds,
} from '../src/room.js';

/**
 * M3-ROOM — the room record and its lifecycle.
 *
 * All of it is plain functions over plain data, which is the point: the seat
 * bounds, the rejection paths and the team balance are the parts that decide
 * whether a lobby works, and none of them should need a Workers runtime to
 * exercise.
 */

const FORMATS: FormatId[] = ['1v1', '2v2', '4v4'];

/** A deterministic byte source, so a minted code is a fact and not a shape. */
const counting = (start = 0) => (n: number) =>
  Uint8Array.from({ length: n }, (_, i) => start + i);

describe('M3-ROOM: seat bounds come from the format', () => {
  it('derives 2-4 for 2v2 and 4-8 for 4v4 (GAME_SPEC §1)', () => {
    expect(seatBounds('2v2')).toEqual({ min: 2, max: 4 });
    expect(seatBounds('4v4')).toEqual({ min: 2, max: 8 });
  });

  it('is derived, not tabulated — every format agrees with its own roster size', () => {
    // The bound that matters is "one seat per character", and duplicating it as
    // a table is how it drifts the first time a format changes.
    for (const format of FORMATS) {
      expect(seatBounds(format).max, format).toBe(getFormat(format).charactersPerTeam * 2);
    }
  });

  it('needs two players even in 1v1 — a room with one is a lobby, not a game', () => {
    expect(seatBounds('1v1')).toEqual({ min: 2, max: 2 });
  });
});

describe('M3-ROOM: joining', () => {
  const fill = (format: FormatId, n: number) => {
    let room = createRoom('WXYZ', format);
    for (let i = 0; i < n; i++) {
      const result = join(room, `s${i}`);
      expect(result.ok, `seat ${i} should fit`).toBe(true);
      if (result.ok) room = result.room;
    }
    return room;
  };

  it('seats a player and hands back a new room', () => {
    const room = createRoom('WXYZ', '2v2');
    const result = join(room, 's0', 'Ada');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seat).toEqual({ seatId: 's0', team: 0, name: 'Ada' });
    expect(result.room.seats).toHaveLength(1);
    expect(room.seats, 'the room it was given is untouched').toHaveLength(0);
  });

  it('falls back to the seat id when no name is given', () => {
    const result = join(createRoom('WXYZ', '2v2'), 's0');
    expect(result.ok && result.seat.name).toBe('s0');
  });

  it('alternates teams so a room cannot fill 4-0 before the lobby opens', () => {
    const room = fill('2v2', 4);
    expect(room.seats.map((s) => s.team)).toEqual([0, 1, 0, 1]);
  });

  it('sends the next player to whichever side is short', () => {
    let room = createRoom('WXYZ', '4v4');
    const first = join(room, 'a');
    if (first.ok) room = first.room;
    const second = join(room, 'b');
    if (second.ok) room = second.room;
    // Drop the team-1 player: the next join must rebalance, not carry on
    // alternating from where the count happens to be.
    room = leave(room, 'b');
    expect(nextTeam(room)).toBe(1);
  });

  it('rejects the join past the format bound rather than growing the room', () => {
    const full = fill('2v2', 4);
    const overflow = join(full, 's4');
    expect(overflow).toEqual({ ok: false, reason: 'roomFull' });
  });

  it('4v4 takes eight, and refuses the ninth', () => {
    const full = fill('4v4', 8);
    expect(full.seats).toHaveLength(8);
    expect(join(full, 's8').ok).toBe(false);
  });

  it('rejects a seat id that is already in the room', () => {
    const room = fill('2v2', 1);
    expect(join(room, 's0')).toEqual({ ok: false, reason: 'duplicateSeat' });
  });

  it('a rejection is a value, not a throw — a full room is an ordinary event', () => {
    expect(() => join(fill('1v1', 2), 'late')).not.toThrow();
  });
});

describe('M3-ROOM: leaving', () => {
  it('frees the seat, so the room can be rejoined', () => {
    let room = createRoom('WXYZ', '1v1');
    for (const id of ['a', 'b']) {
      const r = join(room, id);
      if (r.ok) room = r.room;
    }
    expect(join(room, 'c').ok, 'full').toBe(false);
    room = leave(room, 'a');
    expect(join(room, 'c').ok, 'and open again once somebody leaves').toBe(true);
  });

  it('an unknown seat id is a no-op — a double disconnect is not an error', () => {
    const room = createRoom('WXYZ', '2v2');
    expect(leave(room, 'nobody')).toEqual(room);
  });
});

describe('M3-ROOM: can the room start', () => {
  const seat = (room: ReturnType<typeof createRoom>, id: string) => {
    const r = join(room, id);
    return r.ok ? r.room : room;
  };

  it('needs both teams present', () => {
    let room = createRoom('WXYZ', '2v2');
    room = seat(room, 'a');
    expect(canStart(room), 'one player').toBe(false);
    room = seat(room, 'b');
    expect(canStart(room), 'one each').toBe(true);
  });

  it('a room whose second player left cannot start again', () => {
    let room = createRoom('WXYZ', '2v2');
    room = seat(room, 'a');
    room = seat(room, 'b');
    expect(canStart(leave(room, 'b'))).toBe(false);
  });
});

describe('M3-ROOM: room codes', () => {
  it('is four letters from the alphabet', () => {
    const code = mintCode(counting());
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(isRoomCode(code)).toBe(true);
  });

  it('is a function of its byte source, so a test can name the code it expects', () => {
    // Randomness is injected rather than reached for. A module calling
    // `Math.random()` could only be tested by asserting the shape of its
    // output, which is the assertion that never catches anything.
    expect(mintCode(counting(0))).toBe(CODE_ALPHABET.slice(0, 4));
    expect(mintCode(counting(0))).toBe(mintCode(counting(0)));
    expect(mintCode(counting(5))).not.toBe(mintCode(counting(0)));
  });

  it('wraps past the end of the alphabet instead of running off it', () => {
    const code = mintCode(() => Uint8Array.from([255, 254, 253, 252]));
    expect(isRoomCode(code), 'every character is still in the alphabet').toBe(true);
  });

  it('leaves out the characters that get misread aloud or in print', () => {
    // I/O/Q are read as 1/0/O; U is gone so no four-letter code can spell
    // something the owner has to apologise for.
    for (const ch of 'IOQU') expect(CODE_ALPHABET).not.toContain(ch);
  });

  it('rejects the wrong length and characters outside the alphabet', () => {
    expect(isRoomCode('ABC')).toBe(false);
    expect(isRoomCode('ABCDE')).toBe(false);
    expect(isRoomCode('ABCI'), 'I is not in the alphabet').toBe(false);
    expect(isRoomCode('abcd'), 'callers upper-case before checking').toBe(false);
  });
});
