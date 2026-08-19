/**
 * The network client — the socket layer, as a **pure reducer** plus a very thin
 * shell (M3-LOBBY).
 *
 * Everything a connected client knows is one `NetState`, and every server frame
 * is folded into it by `applyServerMessage`, which touches nothing but its two
 * arguments. That is the same split the server made between `room.ts` and the
 * Durable Object, for the same reason: the interesting part (what a `decision`
 * does to my board, what a `turnResolved` replaces, what a refusal leaves
 * behind) is testable without a socket, and the shell that remains has nothing
 * in it worth testing.
 *
 * **Nothing here re-derives a rule.** The server's payloads are already filtered
 * for this seat's team (M3-HIDDEN), so the client's job is to *hold* what it was
 * given, not to work out what it should have been given. In particular the state
 * in a `decision` is the fogged one: a client that "helpfully" merged in
 * remembered enemy positions would undo the filtering one frame later.
 *
 * The protocol types are imported from `@cards/server` **as types only** — one
 * definition of the wire, checked on both ends, and nothing of the server in the
 * bundle.
 */

import { TIMEBANK_CHARGES } from '@cards/engine';
import type { GameState, TurnEvent, UnitOrders, Vec2 } from '@cards/engine';
import type {
  ClientMessage, ErrorCode, LobbyView, RoomView, ServerMessage,
} from '@cards/server/protocol';
import type { Pick, Seat } from '@cards/server/room';

export type { LobbyView, Pick, RoomView, Seat };

/** The protocol version this client speaks. Sent on `join`. */
export const CLIENT_PROTOCOL_VERSION = 1;

/**
 * Where the connection is in its life.
 *
 * `lobby` and `match` are different screens rather than different degrees of the
 * same one — the lobby has no board and the match has no picking — so the phase
 * is explicit instead of being inferred from whether `state` happens to be set.
 * `reconnecting` is a socket that dropped and is being replaced
 * (M3-RECONNECT) — distinct from `closed` because the two are different
 * sentences to the player: one is "hold on", the other is "that is that".
 * `closed` is terminal: the server closes a socket it refused, and a client that
 * kept showing a lobby after that would be showing a room it is not in.
 */
export type NetPhase = 'connecting' | 'lobby' | 'match' | 'reconnecting' | 'closed';

/** Everything a connected client knows. One object, folded by one function. */
export interface NetState {
  phase: NetPhase;
  /** This client's own seat, once the server has said who we are. */
  seat?: Seat;
  room?: RoomView;
  /** The lobby as this team may see it — own picks in full, enemy as a count. */
  lobby?: LobbyView;
  /** The board **as filtered for this team**. Never reconstructed locally. */
  state?: GameState;
  visibleSquares: Vec2[];
  /** The characters this seat orders. The control map, from the server. */
  unitIds: string[];
  /** Own-team submissions this turn, by seat id — teammates included. */
  orders: Record<string, UnitOrders[]>;
  /** Own-team seat ids locked in; the enemy's readiness is a count only. */
  locked: string[];
  of: number;
  enemyLocked: number;
  enemyOf: number;
  /** Whether this client has locked in this turn — drives the Lock In button. */
  submitted: boolean;
  /**
   * M3-TIMER — how long was left in the decision window when the server sent it.
   *
   * Held exactly as received and never counted down here: the reducer is pure
   * and has no clock, so the countdown is the caller's job (it knows when this
   * arrived). `undefined` means no window is open — a finished match — which is
   * the signal to draw no countdown rather than a zero.
   */
  remainingMs?: number;
  /** This seat's Time Bank charges left, from the server. */
  bank: number;
  /**
   * TIMER-EVERY-PHASE — how many Decision payloads have arrived. Bumped by
   * `decision` and by nothing else.
   *
   * The countdown must re-anchor whenever the server sends a fresh measurement,
   * and "a fresh measurement arrived" is an **event**, not a change of value:
   * turn 2 opens with exactly the same `remainingMs` and `bank` as turn 1 did,
   * because both are a full window measured the instant it opened. A controller
   * watching those two numbers for a change therefore never heard about turn 2
   * — which is the whole of the reported bug (Dev Note #5, "lock-in timer
   * disappears after turn 1"): the timer is stopped for playback, and nothing
   * ever started it again.
   *
   * A counter says the thing the values cannot: *this frame carried a window*.
   */
  windowSeq: number;
  /** The last resolved turn's filtered event log, for playback. */
  events: TurnEvent[];
  /** Both teams' orders, revealed with the resolution. */
  revealed: Record<string, UnitOrders[]>;
  /** The last refusal, if any. Cleared by the next message that succeeds. */
  error?: { code: ErrorCode; message: string };
}

export function initialNet(): NetState {
  return {
    phase: 'connecting', visibleSquares: [], unitIds: [], orders: {},
    locked: [], of: 0, enemyLocked: 0, enemyOf: 0, submitted: false,
    events: [], revealed: {}, bank: TIMEBANK_CHARGES, windowSeq: 0,
  };
}

/**
 * Fold one server frame into the client's state. Pure: a new object, always.
 *
 * The tricky cases are the ones where a frame means "forget something":
 * - `turnResolved` clears `submitted` and the per-seat `orders`, because the
 *   next Decision phase is a fresh secret. Keeping last turn's plans on screen
 *   is how a player locks in a move they already made.
 * - `matchStarted` leaves the lobby behind entirely — there is no going back to
 *   picking, and a stale `lobby` would keep a pick screen alive over the board.
 * - an `error` never clears anything. A refused message did not happen, so the
 *   state it was refused from is still the truth.
 */
export function applyServerMessage(net: NetState, msg: ServerMessage): NetState {
  const clean = { ...net, error: undefined };
  switch (msg.type) {
    case 'joined':
      return { ...clean, phase: 'lobby', seat: msg.seat, room: msg.room };
    case 'roomUpdated':
    case 'seatLeft':
      return { ...clean, room: msg.room };
    case 'lobby':
      return { ...clean, phase: 'lobby', room: msg.room, lobby: msg.lobby };
    case 'matchStarted':
      return {
        ...clean,
        phase: 'match',
        room: msg.room,
        // The seat comes from this message rather than being kept from
        // `joined`, because a **reclaimed** seat never saw a `joined`: the
        // resync is the first thing it hears, and it has to say who you are.
        seat: msg.seat,
        lobby: undefined,
        state: msg.state,
        visibleSquares: msg.visibleSquares,
        unitIds: msg.unitIds,
        submitted: false,
      };
    // (`matchStarted` is also the **resync** a reclaimed seat gets — same
    // message, deliberately, because a rejoining client needs exactly what a
    // starting one needs. Folding it the same way is what makes a reconnect
    // land the client on a board rather than on a fifth code path.)
    case 'decision':
      return {
        ...clean,
        phase: 'match',
        state: msg.state,
        visibleSquares: msg.visibleSquares,
        orders: msg.orders,
        locked: msg.locked,
        of: msg.of,
        enemyLocked: msg.enemyLocked,
        enemyOf: msg.enemyOf,
        // The server is the authority on whether we are locked in, and it says
        // so by naming our seat. Trusting our own optimistic flag instead would
        // survive a rejected submit and leave the button stuck.
        submitted: net.seat !== undefined && msg.locked.includes(net.seat.seatId),
        // M3-TIMER: the window is the server's, and this is the only message
        // that carries it. `remainingMs` is spread rather than assigned so the
        // field is *absent* when the server sent none — `undefined` and "no
        // window" have to stay the same thing under `exactOptionalPropertyTypes`.
        ...(msg.remainingMs === undefined ? { remainingMs: undefined } : { remainingMs: msg.remainingMs }),
        bank: msg.bank,
        // M3-RECONNECT: the control map can change mid-match now — a teammate
        // who misses a whole turn hands their characters over, and takes them
        // back on return — so it is re-read from every Decision phase rather
        // than kept from `matchStarted`.
        unitIds: msg.unitIds,
        // TIMER-EVERY-PHASE: the one place this is bumped. Every other frame
        // carries the last window's numbers forward unchanged, which is exactly
        // why a value comparison could not tell a new window from an old one.
        windowSeq: net.windowSeq + 1,
      };
    case 'submitted':
      return { ...clean, submitted: true };
    case 'turnResolved':
      return {
        ...clean,
        phase: 'match',
        state: msg.state,
        visibleSquares: msg.visibleSquares,
        events: msg.events,
        revealed: msg.orders,
        orders: {},
        locked: [],
        enemyLocked: 0,
        submitted: false,
      };
    case 'error':
      return { ...net, error: { code: msg.code, message: msg.message } };
    case 'pong':
      return clean;
  }
}

/** The frames a client sends. Serialised in one place, so no caller improvises. */
export const frames = {
  /**
   * The handshake. `seatId` is M3-RECONNECT's **reclaim ticket** — the seat this
   * client held here before its socket went away. Omitted by a fresh joiner.
   */
  join: (name?: string, seatId?: string): ClientMessage => ({
    type: 'join',
    version: CLIENT_PROTOCOL_VERSION,
    ...(name === undefined ? {} : { name }),
    ...(seatId === undefined ? {} : { seatId }),
  }),
  pick: (picks: Pick[]): ClientMessage => ({ type: 'pick', picks }),
  start: (): ClientMessage => ({ type: 'start' }),
  ready: (ready: boolean): ClientMessage => ({ type: 'ready', ready }),
  submit: (orders: UnitOrders[]): ClientMessage => ({ type: 'submit', orders }),
  extend: (): ClientMessage => ({ type: 'extend' }),
  ping: (): ClientMessage => ({ type: 'ping' }),
};

/** The two things the client ever does to a connection. A `WebSocket` satisfies it. */
export interface ClientSocket {
  send(data: string): void;
  close(): void;
}

/**
 * The shell: a socket, the reducer, and a subscription.
 *
 * Deliberately small. It owns no rules — `receive` is one `applyServerMessage`
 * call — so the only thing that could be wrong here is the plumbing, and the
 * plumbing is four lines long.
 */
export class RoomClient {
  #net = initialNet();
  #listeners: ((net: NetState) => void)[] = [];
  #socket: ClientSocket;

  constructor(socket: ClientSocket) {
    this.#socket = socket;
  }

  /**
   * Swap in a fresh socket after a drop (M3-RECONNECT).
   *
   * The **client survives the connection**, which is the whole shape of a
   * reconnect: the seat, the board and the room it holds are what the reclaim is
   * for, and throwing them away to build a new client would mean re-deriving
   * everything the server is about to re-send anyway. Only the transport is
   * replaced, and the phase says so.
   */
  attach(socket: ClientSocket): void {
    this.#socket = socket;
    this.#set({ ...this.#net, phase: 'reconnecting' });
  }

  get net(): NetState {
    return this.#net;
  }

  /** Called on every state change, including the one that closes the socket. */
  subscribe(listener: (net: NetState) => void): () => void {
    this.#listeners.push(listener);
    return () => { this.#listeners = this.#listeners.filter((l) => l !== listener); };
  }

  /**
   * Fold a raw frame. A frame that is not a `ServerMessage` is **ignored** rather
   * than crashing the client: the server is ours, so a malformed frame means a
   * version skew, and a blank screen is a worse answer to that than a stale one.
   */
  receive(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') return;
    this.#set(applyServerMessage(this.#net, msg));
  }

  send(message: ClientMessage): void {
    this.#socket.send(JSON.stringify(message));
  }

  join(name?: string, seatId?: string): void { this.send(frames.join(name, seatId)); }
  pick(picks: Pick[]): void { this.send(frames.pick(picks)); }
  start(): void { this.send(frames.start()); }
  /**
   * LOBBY-READY — say this seat is happy to start, or take it back.
   *
   * Carries the value rather than toggling, so a re-sent frame is idempotent
   * and two clicks racing each other cannot land on the wrong answer.
   */
  ready(ready: boolean): void { this.send(frames.ready(ready)); }
  submit(orders: UnitOrders[]): void { this.send(frames.submit(orders)); }
  /**
   * Ask for the Time Bank (M3-TIMER). Nothing is applied locally: the charge is
   * the server's to spend, and the client learns it took when the next
   * `decision` arrives with more time on it. An optimistic +10 that the server
   * then refused would be the one lie a clock must never tell.
   */
  extend(): void { this.send(frames.extend()); }

  /**
   * The socket went away.
   *
   * Terminal *as a connection*: nothing else will arrive on it. Whether that is
   * terminal for the **client** is the caller's call — `attach` puts it into
   * `reconnecting` and the reclaim carries on from there (M3-RECONNECT). What
   * survives either way is everything the reducer holds, because a dropped
   * socket did not change the room.
   */
  closed(): void {
    this.#set({ ...this.#net, phase: 'closed' });
  }

  #set(next: NetState): void {
    this.#net = next;
    for (const listener of this.#listeners) listener(next);
  }
}
