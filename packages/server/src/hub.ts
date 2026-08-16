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
 * M3-PROTOCOL adds the turn loop: seats submit, the hub counts locks, and when
 * the last one lands it calls `resolveRoomTurn` — which is `mergeSeatOrders`
 * plus one `resolveTurn`, both the engine's. The hub decides *when* a turn
 * resolves; it never decides *what* a turn does.
 *
 * M3-HIDDEN makes every outgoing match payload **per-seat**. There is no
 * `broadcast(state)` left: `#sendMatch` builds a separate, team-filtered message
 * for each seat, and the filtering lives in `view.ts` where it can be read as
 * one rule rather than found in five call sites. That is deliberate — the moment
 * one shared payload exists again, somebody will put a position in it.
 */

import type { CatalystPool, CharacterDef, MapDef, Roster, UnitOrders } from '@cards/engine';
import {
  ERROR_TEXT,
  PROTOCOL_VERSION,
  errorMessage,
  parseClientMessage,
  roomView,
  type ServerMessage,
} from './protocol.js';
import { canStart, join, leave, resolveRoomTurn, seatBounds, startMatch, type Room } from './room.js';
import { filterEvents, ordersForTeam, teamView, visibleEnemyIds } from './view.js';

/**
 * What the hub needs to run a match: the board, the characters and the
 * catalyst pool. Handed in rather than imported, because `data/` belongs to the
 * caller (the Worker bundles it) and a test wants to hand in two units on an
 * empty field instead.
 */
export interface MatchConfig {
  map: MapDef;
  roster: Roster;
  teams: [CharacterDef[], CharacterDef[]];
  catalysts?: CatalystPool;
}

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
  /**
   * This turn's submissions, by seat. Cleared the instant a turn resolves, so
   * "has this seat locked in" and "for which turn" can never disagree.
   */
  readonly #submissions = new Map<string, UnitOrders[]>();
  readonly #config: MatchConfig | undefined;

  constructor(room: Room, config?: MatchConfig) {
    this.#room = room;
    this.#config = config;
  }

  /** Seat ids that have locked in this turn, in join order. */
  get locked(): string[] {
    return this.#room.seats.filter((s) => this.#submissions.has(s.seatId)).map((s) => s.seatId);
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

    if (msg.type === 'submit') return this.#receiveSubmit(seatId, msg.orders);

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
    this.#startIfReady();
  }

  /**
   * Start the match when the room is **full** (M3-PROTOCOL interim).
   *
   * Full, not merely "both teams have somebody". Starting the moment two
   * players are in strands everyone who arrives after: the deal has already
   * happened, so a third joiner is seated into a running match controlling
   * nothing. Waiting for the format's seat bound means every character has an
   * owner and nobody is left holding an empty control map.
   *
   * The cost is that a **short room never starts on its own** — a 2v2 that two
   * players intend to run with two characters each is a legal configuration
   * with no trigger here. That is what `start()` is for, and what M3-LOBBY's
   * explicit start button replaces this whole method with.
   */
  #startIfReady(): void {
    if (this.#room.seats.length < seatBounds(this.#room.format).max) return;
    this.start();
  }

  /**
   * Start now, whoever is in. The lobby's button (M3-LOBBY) and the escape
   * hatch for a short room that will never fill.
   */
  start(): void {
    if (this.#config === undefined || this.#room.state !== undefined) return;
    const started = startMatch(this.#room, this.#config.map, this.#config.teams);
    if (!started.ok) return;
    this.#room = started.room;
    // Each seat is told the board **and its own characters** — the control map,
    // delivered per-seat because "which of these am I ordering" is the one
    // question a client cannot answer from the state alone.
    for (const seat of this.#room.seats) {
      const view = teamView(this.#config.map, this.#room.state!, seat.team);
      this.#send(seat.seatId, {
        type: 'matchStarted',
        room: this.#view(),
        state: view.state,
        visibleSquares: view.visibleSquares,
        unitIds: [...seat.unitIds],
      });
    }
    this.#sendDecision();
  }

  /**
   * Send every seat the Decision phase as **its** team may see it (M3-HIDDEN).
   *
   * Per-seat and never broadcast: the whole point is that no two teams receive
   * the same bytes. `orders` carries this team's submissions — teammates
   * included — and the enemy's are simply not in the message. There is nothing
   * for a client to be trusted with, because there is nothing there.
   */
  #sendDecision(): void {
    if (this.#config === undefined || this.#room.state === undefined) return;
    const state = this.#room.state;
    for (const seat of this.#room.seats) {
      const view = teamView(this.#config.map, state, seat.team);
      const mine = this.#room.seats.filter((s) => s.team === seat.team).map((s) => s.seatId);
      this.#send(seat.seatId, {
        type: 'decision',
        turn: state.turn,
        state: view.state,
        visibleSquares: view.visibleSquares,
        orders: ordersForTeam(this.#submissions, mine),
        locked: this.locked,
        of: this.#room.seats.length,
      });
    }
  }

  /**
   * Accept a seat's orders and lock it in; resolve when the last seat lands.
   *
   * Orders naming a character this seat does not control are **refused outright
   * rather than filtered**. Silently dropping them would let a client believe it
   * had ordered a teammate's unit and watch the turn resolve as though it had
   * simply chosen not to — a bug that looks exactly like the engine ignoring a
   * legal order.
   */
  #receiveSubmit(seatId: string, orders: UnitOrders[]): void {
    if (!this.#joined.has(seatId)) return this.#send(seatId, errorMessage('notJoined'));
    if (this.#room.state === undefined) return this.#send(seatId, errorMessage('noMatch'));
    if (this.#submissions.has(seatId)) return this.#send(seatId, errorMessage('alreadyLocked'));

    const seat = this.#room.seats.find((s) => s.seatId === seatId)!;
    if (orders.some((o) => !seat.unitIds.includes(o.unitId))) {
      return this.#send(seatId, errorMessage('notYours'));
    }

    this.#submissions.set(seatId, orders);
    const of = this.#room.seats.length;
    this.#broadcast({ type: 'submitted', locked: this.#submissions.size, of });
    if (this.#submissions.size >= of) return this.resolveNow();
    // A teammate's plan is not hidden information, so the side that just gained
    // one is re-sent its Decision view. The enemy's `decision` message is
    // rebuilt too and still contains none of this.
    this.#sendDecision();
  }

  /**
   * Resolve the turn from whatever has been submitted.
   *
   * Public because **the timer fires it too** (M3-TIMER): a seat that never
   * submits contributes nothing and its characters hold, which is what
   * `mergeSeatOrders` already does with a missing seat. Here it is only ever
   * called with every seat in, so the two paths share one implementation
   * instead of the timer growing its own.
   */
  resolveNow(): void {
    if (this.#config === undefined || this.#room.state === undefined) return;
    const resolved = resolveRoomTurn(
      this.#room, this.#config.map, this.#config.roster, this.#submissions, this.#config.catalysts,
    );
    if (resolved === undefined) return;
    this.#room = resolved.room;
    // Cleared before the broadcast, so a client that submits the moment it sees
    // the result is submitting into an empty turn rather than a stale one.
    // The reveal: both teams' submissions, which is what locking in buys. Taken
    // before the clear, because the clear is what makes the *next* turn secret.
    const revealed: Record<string, UnitOrders[]> = {};
    for (const [seatId, o] of this.#submissions) revealed[seatId] = o;
    this.#submissions.clear();

    const state = resolved.room.state!;
    for (const seat of this.#room.seats) {
      const view = teamView(this.#config.map, state, seat.team);
      this.#send(seat.seatId, {
        type: 'turnResolved',
        turn: resolved.room.turn,
        state: view.state,
        visibleSquares: view.visibleSquares,
        // The log is filtered too, or the fog would be undone by the animation:
        // a client folding an unfiltered log learns every position the state
        // withheld. Acting reveals, so an attacker's whole exchange survives.
        events: filterEvents(resolved.events, state, seat.team, visibleEnemyIds(this.#config.map, state, seat.team)),
        orders: revealed,
      });
    }
    // …and the next Decision phase opens, already fogged.
    this.#sendDecision();
  }

  /**
   * Drop a socket. Idempotent: a close event after an error close is ordinary,
   * and a room that double-removed a seat would leak capacity.
   */
  close(seatId: string): void {
    this.#sinks.delete(seatId);
    if (!this.#joined.delete(seatId)) return; // never joined — no seat to free
    this.#room = leave(this.#room, seatId);
    // A seat that leaves takes its submission with it, and may have been the one
    // everybody was waiting for — so the turn can now be complete. Handling the
    // disconnect-mid-turn *rule* (hold, or forfeit) is M3-TIMER's; all this does
    // is stop the room waiting forever on a socket that is gone.
    this.#submissions.delete(seatId);
    this.#broadcast({ type: 'seatLeft', seatId, room: this.#view() });
    if (this.#room.state !== undefined && this.#room.seats.length > 0
      && this.#submissions.size >= this.#room.seats.length) {
      this.resolveNow();
    }
  }

  #view() {
    return roomView(this.#room, canStart(this.#room), this.locked);
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
