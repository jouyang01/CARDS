/**
 * The room's message handling, over an abstract socket.
 *
 * This is the layer the Durable Object *is*, minus the runtime. `Sink` is the
 * two things the hub ever does to a connection — send it a frame, close it — so
 * a test drives a whole room with objects that push strings into an array, and
 * the DO next door is left with nothing but plumbing.
 *
 * That is the point. A DO that owned this logic could only be tested by booting
 * a Workers runtime, which the sandbox has no account for and CI should not
 * need; and the parts most worth testing (seat bounds, rejection paths,
 * broadcast fan-out) have nothing to do with sockets.
 *
 * **No game logic** — M3-ROOM is lifecycle only.
 */

import {
  ERROR_TEXT,
  PROTOCOL_VERSION,
  errorMessage,
  parseClientMessage,
  roomView,
  type ServerMessage,
} from './protocol.js';
import { canStart, join, leave, type Room } from './room.js';

/** The two things the hub does to a connection. Real sockets satisfy it. */
export interface Sink {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** WebSocket close code for a policy refusal (RFC 6455 §7.4.1). */
const CLOSE_POLICY = 1008;

export class RoomHub {
  #room: Room;
  /** Connected sockets by seat id — including ones that have not joined yet. */
  readonly #sinks = new Map<string, Sink>();
  /** Seat ids that have completed a `join`. A socket is not a seat. */
  readonly #joined = new Set<string>();

  constructor(room: Room) {
    this.#room = room;
  }

  /** The room as it stands. A copy, so a caller cannot edit history. */
  get room(): Room {
    return { ...this.#room, seats: this.#room.seats.map((s) => ({ ...s })) };
  }

  /** How many sockets are attached, joined or not — for the DO's bookkeeping. */
  get connections(): number {
    return this.#sinks.size;
  }

  /**
   * Attach a socket. It is **not** a seat yet: a connection that never sends
   * `join` occupies no seat and counts against no bound, so opening sockets
   * cannot fill a room.
   */
  open(seatId: string, sink: Sink): void {
    this.#sinks.set(seatId, sink);
  }

  /** Handle one frame from `seatId`. */
  receive(seatId: string, raw: unknown): void {
    const sink = this.#sinks.get(seatId);
    if (sink === undefined) return; // frame from a socket we already dropped

    const msg = parseClientMessage(raw);
    if (msg === undefined) return this.#send(seatId, errorMessage('badMessage'));

    if (msg.type === 'ping') {
      // Answered whether or not the sender has joined: a liveness probe that
      // required a seat could not tell you the socket was alive before one.
      return this.#send(seatId, { type: 'pong' });
    }

    if (msg.version !== PROTOCOL_VERSION) {
      // A stale tab after a deploy is the normal case for this, so it closes
      // the socket rather than leaving a client that cannot be understood
      // connected and quietly diverging.
      this.#send(seatId, errorMessage('badVersion'));
      sink.close(CLOSE_POLICY, ERROR_TEXT.badVersion);
      this.#sinks.delete(seatId);
      return;
    }

    const result = join(this.#room, seatId, msg.name);
    if (!result.ok) {
      this.#send(seatId, errorMessage(result.reason));
      sink.close(CLOSE_POLICY, ERROR_TEXT[result.reason]);
      this.#sinks.delete(seatId);
      return;
    }

    this.#room = result.room;
    this.#joined.add(seatId);
    this.#send(seatId, { type: 'joined', seat: result.seat, room: this.#view() });
    // Everyone else learns the room changed. The joiner is excluded because it
    // just got the same room inside `joined` — sending both would have the
    // client apply one state twice and, worse, make "did I join?" ambiguous.
    this.#broadcast({ type: 'roomUpdated', room: this.#view() }, seatId);
  }

  /**
   * Drop a socket. Idempotent: a close event after an error close is ordinary,
   * and a room that double-removed a seat would leak capacity.
   */
  close(seatId: string): void {
    this.#sinks.delete(seatId);
    if (!this.#joined.delete(seatId)) return; // never joined — no seat to free
    this.#room = leave(this.#room, seatId);
    this.#broadcast({ type: 'seatLeft', seatId, room: this.#view() });
  }

  #view() {
    return roomView(this.#room, canStart(this.#room));
  }

  #send(seatId: string, message: ServerMessage): void {
    this.#sinks.get(seatId)?.send(JSON.stringify(message));
  }

  /** To every joined seat except `except`. Unjoined sockets are not an audience. */
  #broadcast(message: ServerMessage, except?: string): void {
    const frame = JSON.stringify(message);
    for (const seatId of this.#joined) {
      if (seatId === except) continue;
      this.#sinks.get(seatId)?.send(frame);
    }
  }
}
