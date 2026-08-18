/**
 * NET-PRESENCE-UI — who is actually here, and whose characters you are holding.
 *
 * Two facts the server has been sending for a while and no screen drew:
 *
 * 1. **`RoomView.seats[].connected`.** A player whose socket dropped keeps their
 *    seat (M3-RECONNECT holds it for them), so the room still lists them — and
 *    every screen listed them exactly as if they were sitting there.
 * 2. **The handoff.** After one fully missed turn a disconnected player's
 *    characters become orderable by a teammate (HANDOFF, ruled). Server-correct,
 *    and completely silent: a stand-in's board simply grew two more characters.
 *
 * Both are display gaps, so this is a display module: it **reads** `connected`
 * and the control map the server already sends and derives nothing about the
 * rule itself. In particular it never works out *who should be* covering — that
 * is the server's `controlledUnits`, and a client that recomputed it would be a
 * second implementation of a rule that exists to be agreed on.
 *
 * The one thing it does compute is set arithmetic on ids the server sent: "which
 * of the characters I am ordering are not on my own seat".
 */

import type { Seat } from '@cards/server/room';

/** What the presence read needs. All of it arrives in ordinary payloads. */
export interface PresenceInput {
  /** The room's seats, as `RoomView` carries them. */
  seats: readonly Seat[];
  /** This client's seat id, so "mine" and "theirs" can be told apart. */
  mySeatId: string;
  /**
   * The characters this seat may order **this turn** — the server's derived
   * control map, from `decision`/`matchStarted`. Never recomputed here.
   */
  controls: readonly string[];
}

export interface Presence {
  /** Seat ids with no socket attached, in room order. */
  awaySeatIds: string[];
  /** Their display names, for a sentence. */
  awayNames: string[];
  /** Unit ids belonging to a seat that is away — the plates to mark. */
  awayUnitIds: string[];
  /**
   * Characters this seat is ordering that belong to somebody else's seat.
   *
   * Set arithmetic on what the server sent, not a re-derivation of the handoff:
   * if the server has handed them over they are in `controls` and not in my own
   * seat's `unitIds`, and that difference is the whole definition.
   */
  borrowedUnitIds: string[];
  /** The teammates whose characters those are, by name. */
  coveringFor: string[];
}

/**
 * Everybody present, nothing on loan — a hot-seat, and the state a networked
 * match is in until something goes wrong. Exported so the board controller has
 * a value to start from rather than an `undefined` to keep checking.
 */
export const NO_PRESENCE: Presence = {
  awaySeatIds: [], awayNames: [], awayUnitIds: [], borrowedUnitIds: [], coveringFor: [],
};

/**
 * Read the room's presence from this seat's point of view.
 *
 * Whole-room rather than own-team for the away list: a disconnected *opponent*
 * is not hidden information — the lobby has always shown how many people are in
 * the room — and a match that quietly continued against an empty chair would be
 * the most confusing version of all. What stays own-team is `coveringFor`, and
 * only because the enemy's control map is not something this client has.
 */
export function presenceOf(input: PresenceInput): Presence {
  const mine = input.seats.find((s) => s.seatId === input.mySeatId);
  if (mine === undefined) return NO_PRESENCE;
  const away = input.seats.filter((s) => !s.connected);
  const own = new Set(mine.unitIds);
  const borrowedUnitIds = input.controls.filter((id) => !own.has(id));
  const borrowed = new Set(borrowedUnitIds);
  return {
    awaySeatIds: away.map((s) => s.seatId),
    awayNames: away.map((s) => s.name),
    awayUnitIds: away.flatMap((s) => [...s.unitIds]),
    borrowedUnitIds,
    // Named from the seats the borrowed characters came from, so the sentence
    // says a person rather than a unit id. A character whose owning seat is not
    // in the room any more is simply not attributed — better an unexplained
    // extra character than a confident wrong name.
    coveringFor: input.seats
      .filter((s) => s.seatId !== input.mySeatId && s.unitIds.some((id) => borrowed.has(id)))
      .map((s) => s.name),
  };
}

/** Is this character's player gone? Drives the mark on a plate or portrait. */
export const isAway = (presence: Presence, unitId: string): boolean =>
  presence.awayUnitIds.includes(unitId);

/** Is this character on loan to the viewer (HANDOFF)? */
export const isBorrowed = (presence: Presence, unitId: string): boolean =>
  presence.borrowedUnitIds.includes(unitId);

/**
 * The sentence that explains the extra characters, or `undefined` when there is
 * nothing to explain.
 *
 * Names the teammate rather than counting units: "you have 2 more characters" is
 * a fact the player can already see, and "Bo dropped, you have their characters"
 * is the one they cannot.
 */
export function coverNotice(presence: Presence): string | undefined {
  if (presence.coveringFor.length === 0) return undefined;
  const who = presence.coveringFor.join(' and ');
  return `${who} disconnected — you are covering for them.`;
}

/**
 * What a lobby or a plate puts next to an absent player's name.
 *
 * Deliberately says the seat is **held** rather than empty: the ruled behaviour
 * is that it waits for its owner, and "disconnected" alone reads like somebody
 * left for good.
 */
export const AWAY_MARK = '⚠';
export const AWAY_LABEL = 'disconnected — seat held';
