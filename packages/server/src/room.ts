/**
 * The room record and its lifecycle — **pure**, and deliberately so.
 *
 * Everything a room is (who is in it, whether another player fits, what a join
 * does to it) lives here as plain functions over plain data. The Durable Object
 * next door owns sockets, storage and the runtime; it owns no rules. That split
 * is the same one the engine/client boundary already uses, and it buys the same
 * thing: the interesting logic is testable without a runtime, and the runtime
 * shell has nothing in it worth testing.
 *
 * **No game logic here** (M3-ROOM is a lifecycle shell). Resolution, orders and
 * per-team filtering arrive in M3-PROTOCOL and M3-HIDDEN; the DO will call the
 * engine's own `resolveTurn` for them rather than reimplementing anything.
 */

import { getFormat, type FormatId, type TeamId } from '@cards/engine';

/** Room codes are four letters — sayable down a phone, and 456 976 of them. */
export const ROOM_CODE_LENGTH = 4;

/**
 * The alphabet a code is minted from. `I`, `O`, `Q` and `U` are gone on
 * purpose: the first three are misread as 1/0/O over voice or in a sans-serif
 * font, and dropping U means no four-letter code can spell anything the owner
 * has to apologise for.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPRSTVWXYZ';

/** A player occupying one seat in a room. */
export interface Seat {
  /** Stable per-connection id, minted by the DO. */
  seatId: string;
  team: TeamId;
  /** Display name, or the seat id when the player has not given one. */
  name: string;
}

export interface Room {
  code: string;
  format: FormatId;
  /** Seats in join order — the order is the tie-break for team assignment. */
  seats: Seat[];
  /** The turn the match is on; 0 until it starts (M3-LOBBY starts it). */
  turn: number;
}

/**
 * Seat bounds for a format (GAME_SPEC §1): at least one player per team, at
 * most one per character.
 *
 * Derived from the format rather than tabulated, so 2v2's "2–4 players" and
 * 4v4's "4–8" are consequences of `charactersPerTeam` rather than two more
 * numbers to keep in step with it. The minimum is two because a match needs
 * both teams present — a room with one player is a lobby, not a game.
 */
export function seatBounds(format: FormatId): { min: number; max: number } {
  const perTeam = getFormat(format).charactersPerTeam;
  return { min: 2, max: perTeam * 2 };
}

/** A fresh, empty room. */
export function createRoom(code: string, format: FormatId): Room {
  return { code, format, seats: [], turn: 0 };
}

/**
 * Mint a room code from a source of bytes.
 *
 * The randomness is **injected** rather than reached for: the Worker passes
 * `crypto.getRandomValues`, and a test passes a counter. A module that called
 * `Math.random()` directly could only be tested by asserting the shape of its
 * output, which is the assertion that never catches anything.
 *
 * `bytes` is asked for exactly `ROOM_CODE_LENGTH` values and each is reduced
 * modulo the alphabet. The modulo bias is real and irrelevant: this picks a
 * memorable code, not a secret. Room codes are not an access control — that is
 * what M3-HIDDEN's per-team filtering is for.
 */
export function mintCode(bytes: (n: number) => Uint8Array): string {
  const source = bytes(ROOM_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[source[i]! % CODE_ALPHABET.length];
  }
  return code;
}

/** Is `code` shaped like a room code? Case-insensitive; callers upper-case. */
export function isRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

export type JoinRejection = 'roomFull' | 'duplicateSeat';

export type JoinResult =
  | { ok: true; room: Room; seat: Seat }
  | { ok: false; reason: JoinRejection };

/**
 * The team a new player should take: whichever side has fewer seats, and team 0
 * on a tie.
 *
 * Auto-balancing rather than letting the joiner pick, because picking is
 * M3-LOBBY's job and a room that fills 4–0 before the lobby opens is a room
 * nobody can start. The tie-break is fixed rather than arbitrary so the same
 * join order always produces the same seating — a room's state is a function of
 * what happened to it, not of when.
 */
export function nextTeam(room: Room): TeamId {
  const zero = room.seats.filter((s) => s.team === 0).length;
  const one = room.seats.length - zero;
  return zero <= one ? 0 : 1;
}

/**
 * Seat a player. Returns a **new** room; the caller swaps it in, so a rejected
 * join cannot half-mutate the record it was rejected from.
 *
 * Rejections are values, not throws: a full room is an ordinary thing that
 * happens to a popular room, and the socket handler has to turn it into a
 * message either way.
 */
export function join(room: Room, seatId: string, name?: string): JoinResult {
  if (room.seats.some((s) => s.seatId === seatId)) return { ok: false, reason: 'duplicateSeat' };
  if (room.seats.length >= seatBounds(room.format).max) return { ok: false, reason: 'roomFull' };
  const seat: Seat = { seatId, team: nextTeam(room), name: name ?? seatId };
  return { ok: true, room: { ...room, seats: [...room.seats, seat] }, seat };
}

/** Remove a seat. Unknown ids are a no-op — a double disconnect is not an error. */
export function leave(room: Room, seatId: string): Room {
  if (!room.seats.some((s) => s.seatId === seatId)) return room;
  return { ...room, seats: room.seats.filter((s) => s.seatId !== seatId) };
}

/**
 * Can this room start a match? Both teams need somebody, and the room needs at
 * least the format's minimum.
 *
 * Nothing calls this yet — M3-LOBBY does. It lives here because "is this room
 * playable" is a fact about the record, and the alternative is the lobby
 * growing its own copy of the seat rules.
 */
export function canStart(room: Room): boolean {
  const { min } = seatBounds(room.format);
  if (room.seats.length < min) return false;
  return [0, 1].every((team) => room.seats.some((s) => s.team === team));
}
