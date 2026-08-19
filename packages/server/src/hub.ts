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
 * `broadcast(state)` left: `start`, `#sendDecision` and `resolveNow` each build
 * a separate, team-filtered message per seat, and the filtering itself lives in
 * `view.ts` where it can be read as one rule rather than found in three call
 * sites. That is deliberate — the moment one shared payload exists again,
 * somebody will put a position in it.
 */

import type { CatalystPool, CharacterDef, MapDef, Roster, UnitOrders } from '@cards/engine';
import { DECISION_SECONDS, TIMEBANK_SECONDS } from '@cards/engine';
import {
  ERROR_TEXT,
  PROTOCOL_VERSION,
  errorMessage,
  parseClientMessage,
  roomView,
  type ServerMessage,
} from './protocol.js';
import {
  canStart, charactersPerSeat, chargesFor, clearSubmissions, controlledUnits, creatorSeatId,
  everyoneReady, hasSubmitted, join,
  leave, lobbyReady, reclaim, resolveRoomTurn, setPicks, setReady, spendCharge, startFromPicks, startMatch,
  submissionsOf, withDeadline, withSubmission, withoutSubmission,
  type Pick, type Room,
} from './room.js';
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
  /**
   * The **interim deal** — a fixed pair of teams to start with when no lobby
   * has been filled in (M3-START's short-room escape hatch, and every test that
   * predates picking).
   *
   * **Optional, and absent in production** (M3-LOBBY-UI). A room whose config
   * carries no deal can only start from its lobby, which is what makes the pick
   * screen the single way into a networked match: a room that could deal
   * characters itself would let a player press start and be handed somebody
   * else's choices. The DO omits it; a test that does not care about picking
   * passes one.
   */
  teams?: [CharacterDef[], CharacterDef[]];
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
   * Socket id → the seat it speaks for (M3-RECONNECT).
   *
   * The two were the same thing until a reconnect could exist, and mostly still
   * are: `open` binds a socket to itself, so a fresh connection's socket id *is*
   * its seat id. A reclaim is the one case where they part — the DO mints a new
   * socket id for the new connection, and the seat it takes over is the old one,
   * with the old one's team, name, characters and submission still attached.
   *
   * Kept as an explicit map rather than by renaming the socket, because the DO
   * hands us the id it minted on every frame and has no idea a reclaim happened.
   */
  readonly #bound = new Map<string, string>();
  readonly #config: MatchConfig | undefined;
  /**
   * M3-TIMER — the clock, **injected**, exactly like `mintCode`'s randomness.
   *
   * The hub is otherwise a pure function of its messages, and a module that
   * called `Date.now()` could only be tested by sleeping. A test passes a
   * counter; the Durable Object passes the real clock.
   */
  readonly #now: () => number;

  constructor(room: Room, config?: MatchConfig, now: () => number = () => 0) {
    this.#room = room;
    this.#config = config;
    this.#now = now;
  }

  /**
   * When the current decision window closes, or `undefined` if none is open.
   * The Durable Object reads this to set its alarm — the hub owns *when*, the
   * runtime owns *how it is woken*.
   *
   * **Read off the room record** (TIMER-PERSIST), not off a field of this
   * object. That is the whole of the persistence: the DO already writes the
   * record after every frame, so a window that lives on it is saved by code
   * that was already there, and a hub reconstructed from storage is rehydrated
   * by its constructor with nothing to remember. A private field alongside the
   * record would be a second copy, and one of two copies is always the stale one.
   */
  get deadline(): number | undefined {
    return this.#room.deadline;
  }

  /** Time Bank charges left for a seat. Persisted with the window, and why. */
  chargesFor(seatId: string): number {
    return chargesFor(this.#room, seatId);
  }

  /**
   * M3-TIMER — the decision window expired: resolve with whatever is in hand.
   *
   * **Missed submission → hold position** (ruled), and that needs no code of its
   * own: `mergeSeatOrders` already contributes nothing for a seat with no
   * submission, and a unit with no orders holds. So the timeout is the *same*
   * resolve the last lock-in would have triggered, which is what keeps a timed
   * turn and a played turn from being two different code paths.
   *
   * Idempotent and safe to call late: an alarm that fires after the turn already
   * resolved finds no open window and does nothing.
   */
  expire(): void {
    const deadline = this.deadline;
    if (deadline === undefined || this.#room.state === undefined) return;
    if (this.#now() < deadline) return; // woken early; the window is still open
    this.resolveNow();
  }

  /** Seat ids that have locked in this turn, in join order. */
  get locked(): string[] {
    return this.#room.seats.filter((s) => hasSubmitted(this.#room, s.seatId)).map((s) => s.seatId);
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
  open(socketId: string, sink: Sink): void {
    this.#sinks.set(socketId, sink);
    this.#bound.set(socketId, socketId);
  }

  /** The seat a socket speaks for. Itself, until a reclaim says otherwise. */
  #seatOf(socketId: string): string {
    return this.#bound.get(socketId) ?? socketId;
  }

  /** Handle one frame from the socket `socketId`. */
  receive(socketId: string, raw: unknown): void {
    const seatId = this.#seatOf(socketId);
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

    if (msg.type === 'pick') return this.#receivePick(seatId, msg.picks);

    if (msg.type === 'extend') return this.#receiveExtend(seatId);

    if (msg.type === 'ready') {
      // LOBBY-READY: a seated player only. Silently ignored for anyone else —
      // an unseated socket has nothing to be ready with, and there is no useful
      // sentence to say back to it.
      if (!this.#joined.has(seatId)) return this.#send(seatId, errorMessage('notJoined'));
      const before = this.#room;
      this.#room = setReady(this.#room, seatId, msg.ready);
      if (this.#room !== before) this.#sendLobby();
      return;
    }

    if (msg.type === 'start') {
      // LOBBY-START: pressing start is now the **only** way into a match, so a
      // refusal has to say so rather than being ignored — a start button that
      // silently does nothing is the worst of the two failures. Only a seated
      // player may press it: a socket that never joined is not in the room and
      // has no standing to decide it is ready.
      if (!this.#joined.has(seatId)) return this.#send(seatId, errorMessage('notJoined'));
      // LOBBY-READY: the creator holds the button. Everybody else says they are
      // ready and waits — a lobby where any seat can start is a lobby where the
      // last person to finish picking decides for everyone.
      const creator = creatorSeatId(this.#room);
      if (creator !== undefined && seatId !== creator) {
        return this.#send(seatId, errorMessage('cannotStart'));
      }
      if (!this.start()) return this.#send(seatId, errorMessage('cannotStart'));
      return;
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

    // M3-RECONNECT: a ticket is a claim on a specific held seat, so it is tried
    // *instead of* an ordinary join rather than after one — a ticket that failed
    // must not quietly seat the client somewhere else, because the whole point
    // of a reclaim is which seat it is.
    //
    // LOBBY-READY-FIX narrows that to what it was always about: **a match**. A
    // lobby holds no seat for anybody — `leave` deletes a lobby seat outright —
    // so there is nothing here a ticket could be a claim on, and the reasoning
    // above simply does not apply: there is no chair to be put in by mistake.
    // Treating it as a reclaim anyway refused the client and closed its socket,
    // which is how a second tab of the same browser (one `localStorage`, one
    // ticket) ended up with no seat and no ready button at all. In a lobby the
    // ticket is ignored and the client is seated normally.
    if (msg.seatId !== undefined && this.#room.state !== undefined) {
      return this.#reclaim(socketId, sink, msg.seatId);
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
    // …and everybody's lobby moved, including the joiner's: what each seat owes
    // is a function of how many players its team has, so a join re-prices it.
    this.#sendLobby();
  }

  /**
   * Take back a held seat and re-sync the client (M3-RECONNECT).
   *
   * Three things happen, in this order, and the order is the point:
   *
   * 1. **The seat is reclaimed** (`reclaim`, which owns the rules) and this
   *    socket is bound to it, so every later frame from this connection speaks
   *    as the old seat — including a submission it had not sent yet.
   * 2. **The client is re-synced** with `matchStarted`. Deliberately the *same*
   *    message the first start sends rather than a `resumed` of its own: a
   *    rejoining client needs precisely what a starting one needs — the board as
   *    its team may see it, and the characters it controls — and a second
   *    message saying the same thing is a second one to keep in step.
   * 3. **The room is told**, so a teammate's "disconnected" mark clears, and
   *    the Decision phase is re-sent to everybody: the returning seat needs this
   *    turn's window and lock list, and a stand-in teammate needs a control map
   *    that no longer includes the characters just handed back.
   *
   * A refusal closes the socket, exactly as a refused join does. A client
   * holding a ticket the room does not honour has nothing to wait for, and
   * leaving it connected would leave it staring at a lobby it is not in.
   */
  #reclaim(socketId: string, sink: Sink, held: string): void {
    const result = reclaim(this.#room, held);
    if (!result.ok) {
      this.#send(this.#seatOf(socketId), errorMessage(result.reason));
      sink.close(CLOSE_POLICY, ERROR_TEXT[result.reason]);
      this.#sinks.delete(this.#seatOf(socketId));
      this.#bound.delete(socketId);
      return;
    }

    this.#room = result.room;
    this.#sinks.delete(this.#seatOf(socketId));
    this.#bound.set(socketId, held);
    this.#sinks.set(held, sink);
    this.#joined.add(held);

    const config = this.#config;
    const state = this.#room.state;
    if (config === undefined || state === undefined) return; // `reclaim` already refused this
    const view = teamView(config.map, state, result.seat.team);
    this.#send(held, {
      type: 'matchStarted',
      room: this.#view(),
      seat: { ...result.seat, picks: [...result.seat.picks], unitIds: [...result.seat.unitIds] },
      state: view.state,
      visibleSquares: view.visibleSquares,
      unitIds: controlledUnits(this.#room, held),
    });
    this.#broadcast({ type: 'roomUpdated', room: this.#view() }, held);
    this.#sendDecision();
  }

  /**
   * Record a seat's lobby picks (M3-LOBBY).
   *
   * Every rule lives in `setPicks`; this is the transport. A refusal is answered
   * to the picker alone with the code that names it — a lobby that said only
   * "no" would leave a player re-clicking the same illegal pick — and nothing is
   * broadcast, because a refused pick did not change the room.
   */
  #receivePick(seatId: string, picks: Pick[]): void {
    if (!this.#joined.has(seatId)) return this.#send(seatId, errorMessage('notJoined'));
    const roster = this.#config?.roster ?? {};
    const result = setPicks(this.#room, seatId, picks, roster, this.#config?.catalysts ?? {});
    if (!result.ok) return this.#send(seatId, errorMessage(result.reason));
    this.#room = result.room;
    this.#sendLobby();
  }

  /**
   * Spend a Time Bank charge on the open decision window (M3-TIMER).
   *
   * The extension is **the whole room's**, not the spender's: one deadline
   * governs one turn, so a charge bought by one seat buys everybody the same ten
   * seconds. A per-seat deadline would mean a turn had four different moments at
   * which it resolved, which is not a thing a simultaneous turn can have.
   *
   * The charge is per seat and per match (`TIMEBANK_CHARGES`), and it is spent
   * **only when it takes** — a refusal costs nothing, so a second click on a
   * spent bank is an error message rather than a silently burnt resource.
   */
  #receiveExtend(seatId: string): void {
    if (!this.#joined.has(seatId)) return this.#send(seatId, errorMessage('notJoined'));
    if (this.#room.state === undefined) return this.#send(seatId, errorMessage('noMatch'));
    const deadline = this.deadline;
    if (deadline === undefined) return this.#send(seatId, errorMessage('noBank'));
    if (this.chargesFor(seatId) <= 0) return this.#send(seatId, errorMessage('noBank'));
    this.#room = spendCharge(this.#room, seatId);
    // Added to what is left rather than resetting the window: the bank *extends*
    // a deadline, so banking at 8 seconds leaves 18, not 40.
    this.#room = withDeadline(this.#room, deadline + TIMEBANK_SECONDS * 1000);
    // Everyone is re-sent their Decision view, because everyone's clock moved.
    this.#sendDecision();
  }

  /**
   * Send every seat the lobby as **its** team may see it (M3-LOBBY).
   *
   * Per-seat and never broadcast, exactly like `#sendDecision`: own-team picks in
   * full (teammates coordinate), the enemy as a bare count of seats that have
   * finished choosing. Silent once the match is running — there is no lobby then.
   */
  #sendLobby(): void {
    if (this.#room.state !== undefined) return;
    for (const seat of this.#room.seats) {
      const mine = this.#room.seats.filter((s) => s.team === seat.team);
      const theirs = this.#room.seats.filter((s) => s.team !== seat.team);
      const done = (s: (typeof mine)[number]) => s.picks.length === charactersPerSeat(this.#room, s.seatId);
      this.#send(seat.seatId, {
        type: 'lobby',
        room: this.#view(),
        lobby: {
          picks: Object.fromEntries(mine.map((s) => [s.seatId, s.picks.map((p) => ({ ...p }))])),
          owed: Object.fromEntries(mine.map((s) => [s.seatId, charactersPerSeat(this.#room, s.seatId)])),
          ready: mine.filter(done).map((s) => s.seatId),
          enemyReady: theirs.filter(done).length,
          enemyOf: theirs.length,
          // LOBBY-READY: `canStart` is the whole gate now — the lobby being
          // complete AND every other occupied seat having readied — so the
          // Start button reads one boolean rather than re-deriving the
          // handshake on the client.
          canStart: everyoneReady(this.#room),
          readied: mine.filter((s) => s.ready).map((s) => s.seatId),
          ...(creatorSeatId(this.#room) === undefined ? {} : { creator: creatorSeatId(this.#room)! }),
        },
      });
    }
  }

  /**
   * Start the match. Returns whether it actually began.
   *
   * **LOBBY-START: this is the only way in.** The full-room auto-start is gone
   * (ruled 2026-09-11, edge-cases "LOBBY-START"): "start when the room is FULL"
   * predates there being anything to pick, and with a lobby in the protocol a
   * four-player 2v2 fills on the fourth join *before anybody has chosen a
   * character* — so the trigger fired straight over the empty pick screen,
   * unreachable in exactly the room that most wants one. Being full is no
   * longer a trigger; pressing start is.
   *
   * Gated on `lobbyReady` — every seat's picks complete, both teams coverable.
   * The config's `teams` is the **interim deal**, and it applies only to a room
   * that has not started picking at all: M3-START's short-room hatch and the
   * tests that predate the lobby. **Once one seat has picked, `lobbyReady` is
   * the only door** — dealing over a half-filled lobby would throw away choices
   * a player is still making, which is the one outcome worse than waiting.
   * Production omits `teams` entirely, so there the picks are the only way a
   * match ever gets its characters.
   *
   * Returns `false` rather than throwing for a room that cannot start yet: the
   * handler has to turn that into a message either way, and pressing start too
   * early is an ordinary thing a player does.
   */
  start(): boolean {
    if (this.#config === undefined || this.#room.state !== undefined) return false;
    const picking = this.#room.seats.some((s) => s.picks.length > 0);
    const deal = picking ? undefined : this.#config.teams;
    // LOBBY-READY gates the lobby door on the handshake as well as on the
    // picks. The interim deal below is untouched: a room that never started
    // picking has nobody to ready, and holding M3-START's short-room hatch to a
    // handshake nobody in it can perform would close the hatch.
    const started = everyoneReady(this.#room)
      ? startFromPicks(this.#room, this.#config.map, this.#config.roster)
      : deal === undefined
        ? { ok: false as const }
        : startMatch(this.#room, this.#config.map, deal);
    if (!started.ok) return false;
    this.#room = started.room;
    // Each seat is told the board **and its own characters** — the control map,
    // delivered per-seat because "which of these am I ordering" is the one
    // question a client cannot answer from the state alone.
    for (const seat of this.#room.seats) {
      const view = teamView(this.#config.map, this.#room.state!, seat.team);
      this.#send(seat.seatId, {
        type: 'matchStarted',
        room: this.#view(),
        seat: { ...seat, picks: [...seat.picks], unitIds: [...seat.unitIds] },
        state: view.state,
        visibleSquares: view.visibleSquares,
        unitIds: controlledUnits(this.#room, seat.seatId),
      });
    }
    this.#sendDecision();
    return true;
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
    // M3-TIMER: a decision window opens with the phase it belongs to. Set here
    // rather than at the resolve, so the one place that says "everybody may now
    // decide" is also the one that says how long for.
    //
    // `??=`, because this method also runs when a *teammate* locks in and when
    // the bank is spent — a plain assignment would hand the room a fresh 40
    // seconds every time somebody pressed a button, which is a clock that never
    // runs out. `resolveNow` is the only thing that clears it, so exactly one
    // window exists per turn. A finished match has nothing to decide and so has
    // no window at all.
    //
    // QUOTA-RUNAWAY: a window opens only while somebody is *attached*. A match
    // everyone has abandoned used to reopen a window after every timed-out
    // resolve, so the DO's alarm ticked hold-position turns forever (sudden
    // death has no exit without a kill) — each tick a storage write, until the
    // free tier's daily row-write allowance was gone and every room in the
    // account failed to create. With no sinks the match simply freezes with no
    // window and no alarm; the next connect runs this method again (`#reclaim`
    // and `start` both do) and the clock resumes.
    if (state.status !== 'active') this.#room = withDeadline(this.#room, undefined);
    else if (this.deadline === undefined && this.#sinks.size > 0) {
      this.#room = withDeadline(this.#room, this.#now() + DECISION_SECONDS * 1000);
    }
    const open = this.deadline;
    const remainingMs = open === undefined ? undefined : Math.max(0, open - this.#now());
    // M3-RECONNECT: the readiness counts are over the seats this turn is still
    // owed an answer by, so "1/1 locked" is true on a team whose other player
    // has dropped — a denominator that counted an empty chair would leave the
    // waiting line permanently one short of the number that ends it.
    const answering = new Set(this.#answering());
    for (const seat of this.#room.seats) {
      const view = teamView(this.#config.map, state, seat.team);
      const mine = this.#room.seats.filter((s) => s.team === seat.team && answering.has(s.seatId));
      const theirs = this.#room.seats.filter((s) => s.team !== seat.team && answering.has(s.seatId));
      this.#send(seat.seatId, {
        type: 'decision',
        turn: state.turn,
        state: view.state,
        visibleSquares: view.visibleSquares,
        orders: ordersForTeam(submissionsOf(this.#room), mine.map((s) => s.seatId)),
        // M3-LOCKLIST. Own team per-seat — UI-INTENT draws a tick over the
        // teammate who is ready, and a count cannot say which one that is.
        locked: mine.filter((s) => hasSubmitted(this.#room, s.seatId)).map((s) => s.seatId),
        of: mine.length,
        // The enemy's readiness is a number and nothing else. "2/2 enemies
        // locked" is what a waiting UI needs; *which* of them it was is not,
        // and a seat id is a durable handle on one specific opponent.
        enemyLocked: theirs.filter((s) => hasSubmitted(this.#room, s.seatId)).length,
        enemyOf: theirs.length,
        // M3-TIMER. A duration rather than an instant, so no client has to
        // reason about the skew between its clock and the server's; and the
        // bank is per seat, so it rides the per-seat message rather than the
        // broadcast one.
        ...(remainingMs === undefined ? {} : { remainingMs }),
        bank: this.chargesFor(seat.seatId),
        // M3-RECONNECT: the control map rides every Decision phase, because it
        // can now change mid-match — a seat that misses a whole turn hands its
        // characters to a teammate, and gets them back when it returns.
        unitIds: controlledUnits(this.#room, seat.seatId),
      });
    }
  }

  /**
   * The seats this turn is still owed an answer by (M3-RECONNECT).
   *
   * A **disconnected** seat is not one of them — there is nobody behind it to
   * press Lock In, and waiting on it would make every turn after a permanent
   * drop take the full `DECISION_SECONDS` before it could resolve. It is still
   * counted while its own submission stands, because a player who locked in and
   * *then* dropped answered this turn: their orders run, and the room is not
   * pretending they are absent.
   *
   * This is also the ruled "hold" arriving early rather than differently — the
   * absent seat contributes nothing to the merge either way, so the only thing
   * that changes is how long everybody else waits to find out.
   */
  #answering(): string[] {
    return this.#room.seats
      .filter((s) => s.connected || hasSubmitted(this.#room, s.seatId))
      .map((s) => s.seatId);
  }

  /** Has every seat that can still answer, answered? */
  #allIn(): boolean {
    const answering = this.#answering();
    return answering.length > 0 && answering.every((id) => hasSubmitted(this.#room, id));
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
    if (hasSubmitted(this.#room, seatId)) return this.#send(seatId, errorMessage('alreadyLocked'));

    // Checked against what this seat **controls**, not against the characters it
    // was dealt: a stand-in holding an abandoned teammate's units is entitled to
    // order them, and the original seat is not while it is away.
    const controls = controlledUnits(this.#room, seatId);
    if (orders.some((o) => !controls.includes(o.unitId))) {
      return this.#send(seatId, errorMessage('notYours'));
    }

    this.#room = withSubmission(this.#room, seatId, orders);
    const of = this.#answering().length;
    this.#broadcast({ type: 'submitted', locked: this.locked.length, of });
    if (this.#allIn()) return this.resolveNow();
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
      this.#room, this.#config.map, this.#config.roster, submissionsOf(this.#room), this.#config.catalysts,
    );
    if (resolved === undefined) return;
    this.#room = resolved.room;
    // Cleared before the broadcast, so a client that submits the moment it sees
    // the result is submitting into an empty turn rather than a stale one.
    // The reveal: both teams' submissions, which is what locking in buys. Taken
    // before the clear, because the clear is what makes the *next* turn secret.
    const revealed: Record<string, UnitOrders[]> = {};
    for (const [seatId, o] of submissionsOf(this.#room)) revealed[seatId] = o;
    this.#room = clearSubmissions(this.#room);
    // M3-TIMER: this window is spent. Cleared here rather than re-set, because
    // `#sendDecision` is what opens one — and it is about to run. Clearing is
    // also what makes `expire()` idempotent: an alarm that fires after the turn
    // already resolved finds no window and does nothing.
    this.#room = withDeadline(this.#room, undefined);

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
   *
   * **In a lobby the seat goes; in a match it is held** — `leave` owns that
   * split (M3-RECONNECT). The submission is **kept** for a match seat: a player
   * who locked in and then dropped had already taken their turn, and binning it
   * would punish them for a socket closing after the decision was made. In a
   * lobby there is nothing to keep.
   */
  close(socketId: string): void {
    const seatId = this.#seatOf(socketId);
    this.#bound.delete(socketId);
    this.#sinks.delete(seatId);
    if (!this.#joined.delete(seatId)) return; // never joined — no seat to free
    const inMatch = this.#room.state !== undefined;
    this.#room = leave(this.#room, seatId);
    if (!inMatch) this.#room = withoutSubmission(this.#room, seatId);
    this.#broadcast({ type: 'seatLeft', seatId, room: this.#view() });
    // A departure re-prices the lobby: the survivors on that team now owe more
    // characters than they picked, so their pick screens have to be told.
    this.#sendLobby();
    if (!inMatch) return;
    // The room may have been waiting on exactly this seat. It is not owed an
    // answer any more (`#answering`), so the turn can now be complete — and
    // everybody else's Decision view has a smaller denominator either way.
    if (this.#allIn()) return this.resolveNow();
    this.#sendDecision();
  }

  /**
   * The room as a broadcast payload.
   *
   * The lock list is **pre-match only** (M3-LOCKLIST): a `RoomView` rides
   * `joined`, `roomUpdated` and `seatLeft`, all of which go to every seat as the
   * same bytes. Once a match is running, handing both teams the full lock list
   * there would undo the per-seat `decision` message one broadcast later.
   */
  #view() {
    const started = this.#room.state !== undefined;
    return roomView(this.#room, canStart(this.#room), started ? [] : this.locked);
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
