/**
 * The room WebSocket protocol.
 *
 * Two discriminated unions, one per direction, versioned by a single
 * `PROTOCOL_VERSION` the client sends on connect. A mismatched client is turned
 * away with a message rather than left to desync — a stale tab reconnecting
 * after a deploy is the normal case, not an exotic one.
 *
 * **M3-ROOM is the lifecycle slice**, so the vocabulary here is joins, leaves
 * and errors. Order submission, resolution and per-team filtering are
 * M3-PROTOCOL and M3-HIDDEN; they extend these unions rather than replacing
 * them, which is why every message is tagged and nothing is positional.
 *
 * Nothing in this file may carry hidden information. That is not yet enforced
 * — the room does not hold a `GameState` at all — but the shape is chosen so
 * that when M3-HIDDEN arrives, "what does this seat get to see" is a question
 * about one message type rather than about the whole protocol.
 */

import type { FormatId, GameState, TurnEvent, UnitOrders, Vec2 } from '@cards/engine';
import type { JoinRejection, Pick, PickRejection, Room, Seat } from './room.js';

/** Bumped whenever a message's meaning changes. Clients send it on connect. */
export const PROTOCOL_VERSION = 1;

/** Everything a seat is allowed to know about the room, at M3-ROOM. */
export interface RoomView {
  code: string;
  format: FormatId;
  /**
   * The map this room plays on, chosen by the host at creation
   * (M3-ROOM-CREATE). Public: it is the board everybody is about to look at,
   * and M3-NET-BOARD needs it to render the right one. Absent means the
   * server's default.
   */
  mapId?: string;
  seats: Seat[];
  turn: number;
  /** Whether the room could start a match right now (M3-LOBBY acts on it). */
  canStart: boolean;
  /** True once the match is running — a lobby and a match are different screens. */
  started: boolean;
  /**
   * Seat ids locked in this turn, so a lobby can show who it is waiting for.
   *
   * **Pre-match only** (M3-LOCKLIST). A `RoomView` rides `joined`, `roomUpdated`
   * and `seatLeft`, all of which are *broadcast* — the same bytes to both teams
   * — so once a match is running this is empty and the per-seat `decision`
   * message is the only thing that says who has locked in. A broadcast lock list
   * mid-match would hand each team the other's seat ids for free, which is the
   * exact leak this item closes.
   */
  locked: string[];
}

/**
 * The lobby, as one seat's team may see it (M3-LOBBY).
 *
 * Per-seat for the same reason `decision` is: **character picks are blind across
 * teams**. The ruling that mirrors are legal ("blind-pick mirrors", edge-cases
 * R3) only means anything if neither side sees the other's picks while choosing
 * — a lobby that broadcast them would turn every pick after the first into a
 * counter-pick, which is a different game from the one that was ruled on.
 *
 * The split is M3-LOCKLIST's, applied to picks instead of locks: **own team in
 * full** (teammates coordinate — hidden information is team vs team, never
 * within one) and **the enemy as a bare count** of seats that have finished
 * choosing, which is all a waiting UI needs.
 */
export interface LobbyView {
  /** Own-team picks by seat id, teammates included. */
  picks: Record<string, Pick[]>;
  /** How many characters each own-team seat owes, by seat id (`charactersPerSeat`). */
  owed: Record<string, number>;
  /** Own-team seat ids that have picked everything they owe. */
  ready: string[];
  /** Enemy seats that have finished choosing — a count, never ids. */
  enemyReady: number;
  enemyOf: number;
  /** Whether the whole lobby could start now (`lobbyReady`). */
  canStart: boolean;
}

/** Client → server. */
export type ClientMessage =
  | { type: 'join'; version: number; name?: string }
  /**
   * Submit this seat's orders and lock in (M3-PROTOCOL). One message, not two:
   * a separate "lock" would let a seat lock with orders the server had not
   * received, and the only thing anybody can do after submitting is wait.
   */
  | { type: 'submit'; orders: UnitOrders[] }
  /**
   * Start a short room now (M3-START). The auto-trigger is a **full** room,
   * which a deliberately two-player 2v2 never becomes; this is the escape hatch,
   * and the message M3-LOBBY's start button will send.
   */
  | { type: 'start' }
  /**
   * Choose this seat's characters and their triads (M3-LOBBY). One message for
   * the whole seat rather than one per character: the rules being checked
   * (`wrongCount`, R3 across the team) are properties of the seat's *set* of
   * picks, so a per-character message could only ever be validated once they had
   * all arrived.
   *
   * Re-sendable until the match starts — changing your mind in a lobby is not an
   * error, and each send replaces the seat's picks wholesale.
   */
  | { type: 'pick'; picks: Pick[] }
  /** A liveness probe the client can send; the server answers `pong`. */
  | { type: 'ping' };

/** Why the server refused a connection or a message. */
export type ErrorCode =
  | JoinRejection
  | PickRejection
  | 'badVersion'
  | 'badMessage'
  | 'notJoined'
  | 'unknownRoom'
  /** Submitted before the match began, or after it finished. */
  | 'noMatch'
  /** Submitted twice in one turn. */
  | 'alreadyLocked'
  /** Ordered a character this seat does not control. */
  | 'notYours'
  /** Joined a room whose match has already begun (M3-JOIN-GUARD). */
  | 'inProgress'
  /** Asked to start a room that cannot start yet, or has already started. */
  | 'cannotStart';

/** Server → client. */
export type ServerMessage =
  /** Sent to the joiner: you are in, and this is who you are. */
  | { type: 'joined'; seat: Seat; room: RoomView }
  /** Sent to everybody else: the room changed. */
  | { type: 'roomUpdated'; room: RoomView }
  | { type: 'seatLeft'; seatId: string; room: RoomView }
  /**
   * The lobby, as this seat's team may see it (M3-LOBBY). Per-seat, never
   * broadcast — see {@link LobbyView}. Re-sent on every lobby change, because
   * what a seat owes moves when somebody joins or leaves.
   */
  | { type: 'lobby'; room: RoomView; lobby: LobbyView }
  /**
   * The match began: the board **as this seat's team may see it**, and who this
   * seat is ordering. Per-seat, never broadcast (M3-HIDDEN).
   */
  | { type: 'matchStarted'; room: RoomView; state: GameState; visibleSquares: Vec2[]; unitIds: string[] }
  /**
   * The Decision phase, as this seat may see it (M3-HIDDEN).
   *
   * `orders` is **its own team's submissions only**, keyed by seat — teammates
   * included, because hidden information is team-vs-team and a side that cannot
   * coordinate is a different game. The enemy's plans are simply not here.
   */
  | {
      type: 'decision';
      turn: number;
      state: GameState;
      visibleSquares: Vec2[];
      orders: Record<string, UnitOrders[]>;
      /**
       * **Own-team** seat ids that have locked in (M3-LOCKLIST). Per-seat
       * because a teammate's lock tick is exactly what UI-INTENT draws, and a
       * bare count could not say *which* teammate is still deciding.
       */
      locked: string[];
      /** How many seats this team has, so `locked.length / of` reads directly. */
      of: number;
      /**
       * The enemy team's readiness as a **bare count** — never seat ids
       * (M3-LOCKLIST, ruled in edge-cases). "2/2 enemies locked" is what a
       * waiting UI needs; which of them it was is not, and a seat id is a
       * durable handle on a specific opponent.
       */
      enemyLocked: number;
      enemyOf: number;
    }
  /** This seat's submission was accepted; `locked` is the count so far. */
  | { type: 'submitted'; locked: number; of: number }
  /**
   * A turn resolved (M3-HIDDEN). `state` and `events` are **filtered for this
   * seat's team**; `orders` is the reveal — both teams' submissions, which is
   * the whole point of locking in.
   */
  | { type: 'turnResolved'; turn: number; state: GameState; visibleSquares: Vec2[]; events: TurnEvent[]; orders: Record<string, UnitOrders[]> }
  | { type: 'pong' }
  | { type: 'error'; code: ErrorCode; message: string };

/** The public projection of a room. One place, so no handler improvises one. */
export function roomView(room: Room, canStart: boolean, locked: readonly string[] = []): RoomView {
  return {
    code: room.code,
    format: room.format,
    ...(room.mapId === undefined ? {} : { mapId: room.mapId }),
    // Picks are **stripped here** and delivered by the per-seat `lobby` message
    // instead (M3-LOBBY). A `RoomView` rides `joined`, `roomUpdated` and
    // `seatLeft`, all broadcast as the same bytes to both teams — carrying picks
    // in it would hand the enemy every choice as it was made, and blind-pick
    // mirrors would stop being blind. Same shape of fix as M3-LOCKLIST's.
    seats: room.seats.map((s) => ({ ...s, unitIds: [...s.unitIds], picks: [] })),
    turn: room.turn,
    canStart,
    started: room.state !== undefined,
    locked: [...locked],
  };
}

/**
 * Parse a frame into a `ClientMessage`, or `undefined` if it is not one.
 *
 * Deliberately strict and deliberately silent about *why*: a frame that is not
 * valid JSON, not an object, or not a tagged message this version knows about
 * is simply not a message. The handler answers `badMessage` and moves on. The
 * alternative — trusting the shape because the client is "ours" — is how a
 * server ends up parsing whatever anyone puts on the socket.
 */
export function parseClientMessage(raw: unknown): ClientMessage | undefined {
  if (typeof raw !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const msg = parsed as Record<string, unknown>;
  if (msg['type'] === 'ping') return { type: 'ping' };
  if (msg['type'] === 'start') return { type: 'start' };
  // Picks are checked for *shape* only — whether the ids name real characters,
  // add up to what the seat owes, or clash under R3 is `setPicks`' business, and
  // a second copy of those rules here is a second copy to keep in step.
  if (msg['type'] === 'pick' && Array.isArray(msg['picks'])) {
    const picks = parsePicks(msg['picks']);
    return picks === undefined ? undefined : { type: 'pick', picks };
  }
  // Orders go straight to the engine's own validation, which drops any illegal
  // component deterministically (`planUnit`). What this checks is only that the
  // frame *is* a submission — re-implementing order legality here would be a
  // second rulebook to keep in step with the first.
  if (msg['type'] === 'submit' && Array.isArray(msg['orders'])) {
    const raw: unknown[] = msg['orders'];
    const orders = raw.filter(
      (o): o is UnitOrders =>
        typeof o === 'object' && o !== null && typeof (o as UnitOrders).unitId === 'string',
    );
    if (orders.length !== raw.length) return undefined;
    return { type: 'submit', orders };
  }
  if (msg['type'] === 'join' && typeof msg['version'] === 'number') {
    const name = typeof msg['name'] === 'string' ? msg['name'] : undefined;
    return name === undefined
      ? { type: 'join', version: msg['version'] }
      : { type: 'join', version: msg['version'], name };
  }
  return undefined;
}

/**
 * A frame's picks as `Pick[]`, or `undefined` if any of them is not one.
 *
 * All-or-nothing, like `submit`'s orders: a lobby that quietly kept the picks it
 * could parse would seat a player with a character they did not choose.
 */
function parsePicks(raw: readonly unknown[]): Pick[] | undefined {
  const picks: Pick[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const p = entry as Record<string, unknown>;
    if (typeof p['characterId'] !== 'string') return undefined;
    const triad: unknown = p['catalysts'];
    if (triad === undefined) {
      picks.push({ characterId: p['characterId'] });
      continue;
    }
    if (!Array.isArray(triad) || triad.some((id) => typeof id !== 'string')) return undefined;
    picks.push({ characterId: p['characterId'], catalysts: triad as string[] });
  }
  return picks;
}

/** Human text for an error code, so every handler says the same thing. */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  roomFull: 'this room is full',
  teamFull: 'that team already has a player for every character',
  duplicateSeat: 'that seat is already connected',
  badVersion: `this client speaks a different protocol version (server is ${PROTOCOL_VERSION})`,
  badMessage: 'unrecognised message',
  notJoined: 'send a join message first',
  unknownRoom: 'no room with that code',
  noMatch: 'the match has not started',
  alreadyLocked: 'this seat has already locked in this turn',
  notYours: 'that character belongs to another seat',
  inProgress: 'this match has already started',
  cannotStart: 'this room cannot start yet',
  unknownSeat: 'no such seat in this room',
  wrongCount: 'that is not the number of characters this seat plays',
  unknownCharacter: 'no such character',
  duplicateCharacter: 'a teammate already picked that character',
  badCatalysts: 'a triad is one Prep, one Dash and one Blast catalyst',
};

export const errorMessage = (code: ErrorCode): ServerMessage =>
  ({ type: 'error', code, message: ERROR_TEXT[code] });
