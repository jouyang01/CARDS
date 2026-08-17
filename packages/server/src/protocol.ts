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
import type { JoinRejection, Room, Seat } from './room.js';

/** Bumped whenever a message's meaning changes. Clients send it on connect. */
export const PROTOCOL_VERSION = 1;

/** Everything a seat is allowed to know about the room, at M3-ROOM. */
export interface RoomView {
  code: string;
  format: FormatId;
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
  /** A liveness probe the client can send; the server answers `pong`. */
  | { type: 'ping' };

/** Why the server refused a connection or a message. */
export type ErrorCode =
  | JoinRejection
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
    seats: room.seats.map((s) => ({
      ...s,
      unitIds: [...s.unitIds],
      picks: s.picks.map((p) => ({ ...p })),
    })),
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

/** Human text for an error code, so every handler says the same thing. */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  roomFull: 'this room is full',
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
};

export const errorMessage = (code: ErrorCode): ServerMessage =>
  ({ type: 'error', code, message: ERROR_TEXT[code] });
