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
 * M3-PROTOCOL adds the match: starting it, and folding a turn's merged orders
 * through the engine's own `resolveTurn`. Nothing here reimplements a rule —
 * the resolution is one call, and the deal reuses the engine's `createMatch`
 * and `deriveSeats`. Per-team filtering is still M3-HIDDEN.
 */

import type {
  CatalystPicks, CatalystPool, CatalystTriad, CharacterDef, FormatId, GameState, MapDef,
  PlayerOrders, Roster, TeamId, TurnEvent, UnitOrders,
} from '@cards/engine';
import {
  createMatch, deriveSeats, getFormat, mergeSeatOrders, resolveTurn, validateCatalystTriad,
} from '@cards/engine';

/** Room codes are four letters — sayable down a phone, and 456 976 of them. */
export const ROOM_CODE_LENGTH = 4;

/**
 * The alphabet a code is minted from. `I`, `O`, `Q` and `U` are gone on
 * purpose: the first three are misread as 1/0/O over voice or in a sans-serif
 * font, and dropping U means no four-letter code can spell anything the owner
 * has to apologise for.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPRSTVWXYZ';

/**
 * GAME_SPEC §1: "a player controls **1 or 2 characters**". The cap is what makes
 * 4v4's "minimum 4 players" a consequence rather than a fourth number — a team
 * of `charactersPerTeam` characters needs at least half that many seats to be
 * coverable at all.
 */
export const MAX_CHARACTERS_PER_PLAYER = 2;

/**
 * One character a seat brings to the match, with the triad that character
 * carries (M3-LOBBY, the ruled pick model).
 *
 * **A pick is a character, not a player.** In a 2-player 2v2 each seat makes two
 * of these, and the catalyst triad hangs off the *character* rather than the
 * player — that is the ruling (edge-cases, "M3-LOBBY pick model"), and it is why
 * this is a record per character rather than a `characterIds: string[]` beside a
 * single triad.
 *
 * `catalysts` absent means "not chosen": a lobby mid-pick is the normal state of
 * a lobby, and `createMatch` already falls back to `DEFAULT_CATALYSTS` for a
 * hole, so an unchosen triad needs no placeholder invented for it here.
 */
export interface Pick {
  characterId: string;
  catalysts?: CatalystTriad;
}

/** A player occupying one seat in a room. */
export interface Seat {
  /** Stable per-connection id, minted by the DO. */
  seatId: string;
  team: TeamId;
  /** Display name, or the seat id when the player has not given one. */
  name: string;
  /**
   * The characters this seat orders (M3-PROTOCOL). Empty until the match
   * starts: **the DO owns the control map** (ARCHITECTURE §45), and until
   * M3-LOBBY lets players pick, `startMatch` fills it with a deterministic deal
   * so client and server seat the same characters the same way.
   */
  unitIds: string[];
  /**
   * What this seat has chosen in the lobby (M3-LOBBY), in pick order. Empty
   * until it picks; `charactersPerSeat` says how many it owes.
   *
   * Kept separate from `unitIds` on purpose: a pick is a *character id* the
   * player chose, a unit id is what `createMatch` minted from it. Collapsing the
   * two would make the lobby depend on the id scheme of a state that does not
   * exist yet.
   */
  picks: Pick[];
}

export interface Room {
  code: string;
  format: FormatId;
  /**
   * The map this room plays on, chosen by the **host at creation**
   * (M3-ROOM-CREATE; ruled "MAP/FORMAT are ROOM-level").
   *
   * An id rather than a `MapDef`, for the same reason `format` is an id: the
   * room record is persisted and shipped over the wire, and a whole board of
   * terrain in every `roomUpdated` would be paying to re-send something the
   * client already has. Absent means "the runtime's default" — every room
   * created before this field existed, and every test that does not care.
   */
  mapId?: string;
  /** Seats in join order — the order is the tie-break for team assignment. */
  seats: Seat[];
  /** The turn the match is on; 0 until it starts. */
  turn: number;
  /**
   * The authoritative match, once started (M3-PROTOCOL). `undefined` in the
   * lobby. This is the **only** copy that decides anything: a client's state is
   * a projection of it, never an input to it.
   */
  state?: GameState;
  /**
   * Every resolved turn's merged orders, oldest first.
   *
   * Kept alongside the current state rather than instead of it, which is the
   * ruling (Builder OQ 2026-08-16 #5): a reconnect re-syncs from `state` and is
   * cheap, while the history serves replay (ARCHITECTURE §77) without anyone
   * having to re-simulate to reach the present.
   */
  history: TurnRecord[];
}

/** One resolved turn, as it was ordered. */
export interface TurnRecord {
  turn: number;
  orders: [PlayerOrders, PlayerOrders];
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
export function createRoom(code: string, format: FormatId, mapId?: string): Room {
  return mapId === undefined
    ? { code, format, seats: [], turn: 0, history: [] }
    : { code, format, mapId, seats: [], turn: 0, history: [] };
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

export type JoinRejection = 'roomFull' | 'duplicateSeat' | 'inProgress' | 'teamFull';

/**
 * SEAT-ZERO — would a player joining `team` be seated with **nothing**?
 *
 * `deriveSeats` hands a team's characters out at most two per player and gives
 * the leftovers `?? []`, so a team with more players than characters seats
 * somebody who has no character to pick in the lobby, no unit to order in the
 * match, and a lock the room still waits for. Ruled: refuse that join
 * (edge-cases, "SEAT-ZERO"). Derived from `teamSplit` rather than special-cased
 * to 1v1 — the new seat is its team's last, and the split hands the last seat 0
 * exactly when the team already has a player per character.
 *
 * **Currently unreachable through `join` alone, on purpose.** `nextTeam` always
 * fills the emptier side and `roomFull` caps a room at `2 × charactersPerTeam`,
 * so no sequence of joins can saturate one team while the room has space. This
 * is the invariant written down where the next lobby feature — letting a player
 * *choose* a team — will need it, which is why it is a named predicate rather
 * than three lines inlined in `join`. See the Builder's open questions.
 */
export function wouldSeatNobody(room: Room, team: TeamId): boolean {
  const seats = [...room.seats, { seatId: '', team, name: '', unitIds: [], picks: [] }];
  return teamSplit({ ...room, seats }, team).at(-1) === 0;
}

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
 *
 * **M3-JOIN-GUARD: a started room takes no new seats.** The deal happens once,
 * at `startMatch`, so a seat created after it controls nothing — and yet it
 * counted toward the lock total, which meant one late connection could hang a
 * match forever with a turn that could never complete. Refused loudly rather
 * than dropped: a joiner that is told nothing sits at a blank board wondering.
 *
 * A seat freed by a disconnect is **held**, not reopened. `leave` removes it
 * from the record and this guard keeps anyone else out, so the only way back
 * into a running match is M3-RECONNECT's identity-matched reclaim. Handing a
 * free slot to whoever connects next would give a stranger somebody's
 * characters mid-fight.
 */
export function join(room: Room, seatId: string, name?: string): JoinResult {
  if (room.state !== undefined) return { ok: false, reason: 'inProgress' };
  if (room.seats.some((s) => s.seatId === seatId)) return { ok: false, reason: 'duplicateSeat' };
  if (room.seats.length >= seatBounds(room.format).max) return { ok: false, reason: 'roomFull' };

  const team = nextTeam(room);
  if (wouldSeatNobody(room, team)) return { ok: false, reason: 'teamFull' };

  const seat: Seat = { seatId, team, name: name ?? seatId, unitIds: [], picks: [] };
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

/**
 * How many characters each seat on `team` picks, in that team's join order.
 *
 * This is `deriveSeats`' split, stated forwards. The engine deals a team's
 * character list across its players by giving the **first `doubles` players two
 * characters** and the rest one; the lobby has to ask for picks in exactly that
 * shape, because `teamsFromPicks` concatenates the seats' picks in this same
 * order and `deriveSeats` will slice them back apart at `startMatch`. Two
 * different answers to "how many does this seat run" is how a player ends up
 * picking a character nobody controls.
 *
 * A seat can be owed **0** — a team with more seats than characters (only
 * reachable in 1v1) — and a team can be **under-covered**, which is what
 * `teamCovered` is for. Neither is an error here; this function only reports the
 * split.
 */
export function teamSplit(room: Room, team: TeamId): number[] {
  const perTeam = getFormat(room.format).charactersPerTeam;
  const players = room.seats.filter((s) => s.team === team).length;
  const seated = Math.min(players, perTeam);
  const doubles = perTeam - seated; // this many seats run two, as in `deriveSeats`
  return Array.from({ length: players }, (_, pl) => {
    if (pl >= seated) return 0;
    return pl < doubles ? MAX_CHARACTERS_PER_PLAYER : 1;
  });
}

/** How many characters this seat picks. `0` for a seat that is not in the room. */
export function charactersPerSeat(room: Room, seatId: string): number {
  const seat = room.seats.find((s) => s.seatId === seatId);
  if (seat === undefined) return 0;
  const index = room.seats.filter((s) => s.team === seat.team).findIndex((s) => s.seatId === seatId);
  return teamSplit(room, seat.team)[index] ?? 0;
}

/**
 * Can this team's seats cover its characters at all?
 *
 * GAME_SPEC §1: a player runs at most two characters, so a 4v4 team needs two
 * players before its four characters have anyone to order them — which is where
 * the spec's "4v4 requires a minimum of 4 players" comes from. `canStart` only
 * asks whether both teams have *somebody*, which was enough while `startMatch`
 * dealt characters itself; a lobby that asks players to pick has to know that
 * the picks it collects will add up.
 */
export function teamCovered(room: Room, team: TeamId): boolean {
  const perTeam = getFormat(room.format).charactersPerTeam;
  return teamSplit(room, team).reduce((a, b) => a + b, 0) === perTeam;
}

export type PickRejection =
  /** No such seat in this room. */
  | 'unknownSeat'
  /** The match is already running; picks are a lobby thing. */
  | 'inProgress'
  /** Not the number of characters this seat runs (`charactersPerSeat`). */
  | 'wrongCount'
  /** A character id that is not in the roster. */
  | 'unknownCharacter'
  /** R3: the same character twice on one team, across all of its seats. */
  | 'duplicateCharacter'
  /** A triad that is not one Prep, one Dash and one Blast from the pool. */
  | 'badCatalysts';

export type PickResult =
  | { ok: true; room: Room }
  | { ok: false; reason: PickRejection; errors: string[] };

/**
 * Record a seat's lobby picks, validated. Returns a **new** room, like `join`.
 *
 * Every rule the ruled pick model names is checked here and nowhere else:
 *
 * - **Count** — a seat picks exactly the characters it will order. Fewer leaves
 *   a character unowned; more would silently drop one at `teamsFromPicks`.
 * - **Roster membership** — a character id nobody can spawn is caught in the
 *   lobby, where a player can pick again, rather than at `createMatch`, where it
 *   is an exception in the middle of starting a match.
 * - **R3 across the WHOLE team** — the ruling's sharpest edge: uniqueness is a
 *   property of the team's complement, not of one seat's picks, so this checks
 *   against *the other seats on the same team* too. Two players bringing the
 *   same character between them is precisely the case the rule exists for.
 *   Mirrors across teams stay legal and are not checked.
 * - **Triads** — delegated to the engine's `validateCatalystTriad`, so "one per
 *   phase" has one implementation. A pick with no triad is legal (a lobby
 *   mid-choice); it falls back to `DEFAULT_CATALYSTS` at match creation.
 *
 * Rejections are values with the offending detail attached, because a lobby has
 * to tell the player *which* pick it refused, not merely that it refused.
 */
export function setPicks(
  room: Room,
  seatId: string,
  picks: readonly Pick[],
  roster: Roster,
  catalysts: CatalystPool = {},
): PickResult {
  const seat = room.seats.find((s) => s.seatId === seatId);
  if (seat === undefined) return { ok: false, reason: 'unknownSeat', errors: [`no seat ${seatId}`] };
  if (room.state !== undefined) return { ok: false, reason: 'inProgress', errors: ['the match has started'] };

  const owed = charactersPerSeat(room, seatId);
  if (picks.length !== owed) {
    return { ok: false, reason: 'wrongCount', errors: [`seat ${seatId} picks ${owed}, got ${picks.length}`] };
  }

  const unknown = picks.filter((p) => roster[p.characterId] === undefined).map((p) => p.characterId);
  if (unknown.length > 0) {
    return { ok: false, reason: 'unknownCharacter', errors: unknown.map((id) => `"${id}" is not in the roster`) };
  }

  // R3 over the team's whole complement: this seat's picks plus every teammate's.
  const taken = new Set<string>();
  for (const other of room.seats) {
    if (other.team !== seat.team || other.seatId === seatId) continue;
    for (const p of other.picks) taken.add(p.characterId);
  }
  const dupes: string[] = [];
  for (const p of picks) {
    if (taken.has(p.characterId)) dupes.push(p.characterId);
    taken.add(p.characterId);
  }
  if (dupes.length > 0) {
    return {
      ok: false,
      reason: 'duplicateCharacter',
      errors: dupes.map((id) => `"${id}" is already on team ${seat.team}`),
    };
  }

  const badTriads = picks.flatMap((p) =>
    p.catalysts === undefined ? [] : validateCatalystTriad(p.catalysts, catalysts, p.characterId));
  if (badTriads.length > 0) return { ok: false, reason: 'badCatalysts', errors: badTriads };

  const stored = picks.map((p) => (p.catalysts === undefined
    ? { characterId: p.characterId }
    : { characterId: p.characterId, catalysts: [...p.catalysts] }));
  return {
    ok: true,
    room: { ...room, seats: room.seats.map((s) => (s.seatId === seatId ? { ...s, picks: stored } : s)) },
  };
}

/**
 * Is the lobby ready to start? Startable as a room, coverable as two teams, and
 * every seat has picked what it owes.
 *
 * Strictly stronger than `canStart`, which stays what it is: "could this room
 * ever play". A lobby needs the second half too, and `startFromPicks` is gated
 * on this rather than on `canStart`.
 */
export function lobbyReady(room: Room): boolean {
  if (room.state !== undefined || !canStart(room)) return false;
  if (!teamCovered(room, 0) || !teamCovered(room, 1)) return false;
  return room.seats.every((s) => s.picks.length === charactersPerSeat(room, s.seatId));
}

/**
 * The lobby's picks as `createMatch`'s two arguments.
 *
 * The order is team, then the team's seats in join order, then each seat's picks
 * in pick order — which is exactly the order `deriveSeats` slices back apart, so
 * a seat's own picks come back to it as its `unitIds`. `undefined` when the
 * lobby is not ready, because a half-picked team has no character list.
 */
export function teamsFromPicks(
  room: Room,
  roster: Roster,
): { teams: [CharacterDef[], CharacterDef[]]; picks: CatalystPicks } | undefined {
  if (!lobbyReady(room)) return undefined;
  const teams: [CharacterDef[], CharacterDef[]] = [[], []];
  const triads: [(CatalystTriad | undefined)[], (CatalystTriad | undefined)[]] = [[], []];
  for (const team of [0, 1] as const) {
    for (const seat of room.seats.filter((s) => s.team === team)) {
      for (const pick of seat.picks) {
        const character = roster[pick.characterId];
        if (character === undefined) return undefined;
        teams[team].push(character);
        triads[team].push(pick.catalysts);
      }
    }
  }
  return { teams, picks: [triads[0], triads[1]] };
}


/**
 * Start the match: create the authoritative `GameState` and deal characters to
 * seats.
 *
 * **The deal is an interim** (Analyzer ruling, review 2026-09-03). M3-LOBBY
 * replaces it with player picks; until then the seats have to hold *something*
 * or no order can name a character. It reuses the engine's own `createMatch`
 * and `deriveSeats`, so the server seats characters exactly the way the hot-seat
 * client does — two implementations of "who controls whom" is how a client ends
 * up ordering a unit the server thinks belongs to somebody else.
 *
 * Returns a rejection rather than throwing for a room that cannot start yet,
 * for the same reason `join` does: it is an ordinary thing to ask too early.
 */
export function startMatch(
  room: Room,
  map: MapDef,
  teams: [CharacterDef[], CharacterDef[]],
  picks?: CatalystPicks,
): { ok: true; room: Room } | { ok: false; reason: 'cannotStart' } {
  if (room.state !== undefined || !canStart(room)) return { ok: false, reason: 'cannotStart' };
  return { ok: true, room: dealSeats(room, createMatch(map, room.format, teams, picks)) };
}

/**
 * Start from the lobby's own picks (M3-LOBBY), rather than from a caller-supplied
 * roster deal.
 *
 * The one function that turns a finished lobby into a match: it is gated on
 * `lobbyReady` rather than `canStart`, and it seeds each unit's triad from the
 * character that picked it via CAT-SELECT's `picks` argument. `startMatch`'s
 * interim deal survives beside it only until the lobby protocol is wired — the
 * two share `dealSeats`, so "who controls whom" still has a single answer.
 */
export function startFromPicks(
  room: Room,
  map: MapDef,
  roster: Roster,
): { ok: true; room: Room } | { ok: false; reason: 'cannotStart' } {
  const chosen = teamsFromPicks(room, roster);
  if (chosen === undefined) return { ok: false, reason: 'cannotStart' };
  return startMatch(room, map, chosen.teams, chosen.picks);
}

/**
 * Hand each seat the characters it controls.
 *
 * `deriveSeats` splits each team's characters across that team's players; the
 * seats it returns are in the same team-then-join order as ours, so zipping them
 * is a positional match rather than a lookup by a name neither side has. It is
 * also the same split `teamSplit` reports to the lobby, which is what makes a
 * seat's picks come back to it as its own units.
 */
function dealSeats(room: Room, state: GameState): Room {
  const perTeam: [number, number] = [
    room.seats.filter((s) => s.team === 0).length,
    room.seats.filter((s) => s.team === 1).length,
  ];
  const dealt = deriveSeats(state, perTeam);
  const byTeam: [string[][], string[][]] = [[], []];
  for (const d of dealt) byTeam[d.team].push(d.unitIds);

  const taken: [number, number] = [0, 0];
  const seats = room.seats.map((seat) => ({
    ...seat,
    unitIds: byTeam[seat.team][taken[seat.team]++] ?? [],
  }));
  return { ...room, seats, state, turn: state.turn };
}

/** Which seat controls `unitId`, if any — the control map, read backwards. */
export function seatFor(room: Room, unitId: string): Seat | undefined {
  return room.seats.find((s) => s.unitIds.includes(unitId));
}

/**
 * Resolve one turn from the submitted per-seat orders and advance the room.
 *
 * The merge is `mergeSeatOrders` — the engine's, the same one the hot-seat
 * client calls — and the resolution is one `resolveTurn`. That is the whole
 * function, deliberately: a server that shaped orders its own way would produce
 * a match the client could not reproduce, and the point of a pure engine is
 * that both sides get the same answer from the same inputs.
 */
export function resolveRoomTurn(
  room: Room,
  map: MapDef,
  roster: Roster,
  ordersBySeat: ReadonlyMap<string, UnitOrders[]>,
  catalysts: CatalystPool = {},
): { room: Room; events: TurnEvent[]; orders: [PlayerOrders, PlayerOrders] } | undefined {
  if (room.state === undefined) return undefined;
  const orders = mergeSeatOrders(room.seats, ordersBySeat);
  const { state, events } = resolveTurn(room.state, map, orders, roster, catalysts);
  return {
    room: {
      ...room,
      state,
      turn: state.turn,
      // Appended, never replaced: the current state answers "where are we" and
      // the log answers "how did we get here", and a replay needs both.
      history: [...room.history, { turn: room.state.turn, orders }],
    },
    events,
    orders,
  };
}
