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

import type { FormatId } from '@cards/engine';
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
}

/** Client → server. */
export type ClientMessage =
  | { type: 'join'; version: number; name?: string }
  /** A liveness probe the client can send; the server answers `pong`. */
  | { type: 'ping' };

/** Why the server refused a connection or a message. */
export type ErrorCode =
  | JoinRejection
  | 'badVersion'
  | 'badMessage'
  | 'notJoined'
  | 'unknownRoom';

/** Server → client. */
export type ServerMessage =
  /** Sent to the joiner: you are in, and this is who you are. */
  | { type: 'joined'; seat: Seat; room: RoomView }
  /** Sent to everybody else: the room changed. */
  | { type: 'roomUpdated'; room: RoomView }
  | { type: 'seatLeft'; seatId: string; room: RoomView }
  | { type: 'pong' }
  | { type: 'error'; code: ErrorCode; message: string };

/** The public projection of a room. One place, so no handler improvises one. */
export function roomView(room: Room, canStart: boolean): RoomView {
  return {
    code: room.code,
    format: room.format,
    seats: room.seats.map((s) => ({ ...s })),
    turn: room.turn,
    canStart,
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
};

export const errorMessage = (code: ErrorCode): ServerMessage =>
  ({ type: 'error', code, message: ERROR_TEXT[code] });
