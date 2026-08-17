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
 * `closed` is terminal: the server closes a socket it refused, and a client that
 * kept showing a lobby after that would be showing a room it is not in.
 */
export type NetPhase = 'connecting' | 'lobby' | 'match' | 'closed';

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
    events: [], revealed: {},
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
        lobby: undefined,
        state: msg.state,
        visibleSquares: msg.visibleSquares,
        unitIds: msg.unitIds,
        submitted: false,
      };
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
  join: (name?: string): ClientMessage =>
    (name === undefined
      ? { type: 'join', version: CLIENT_PROTOCOL_VERSION }
      : { type: 'join', version: CLIENT_PROTOCOL_VERSION, name }),
  pick: (picks: Pick[]): ClientMessage => ({ type: 'pick', picks }),
  start: (): ClientMessage => ({ type: 'start' }),
  submit: (orders: UnitOrders[]): ClientMessage => ({ type: 'submit', orders }),
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

  constructor(private readonly socket: ClientSocket) {}

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
    this.socket.send(JSON.stringify(message));
  }

  join(name?: string): void { this.send(frames.join(name)); }
  pick(picks: Pick[]): void { this.send(frames.pick(picks)); }
  start(): void { this.send(frames.start()); }
  submit(orders: UnitOrders[]): void { this.send(frames.submit(orders)); }

  /** The socket went away. Terminal — a closed client shows no room. */
  closed(): void {
    this.#set({ ...this.#net, phase: 'closed' });
  }

  #set(next: NetState): void {
    this.#net = next;
    for (const listener of this.#listeners) listener(next);
  }
}
