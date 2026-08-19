/**
 * The Durable Object: one instance per room, and nothing but plumbing.
 *
 * Every rule lives in `room.ts` and every message in `hub.ts`; this class turns
 * a `fetch` into a WebSocket pair, gives each socket an id, and forwards its
 * events. If a change to how a room behaves needs editing this file, something
 * has been put in the wrong place.
 *
 * `DurableObjectState.blockConcurrencyWhile` guarantees the constructor's
 * restore finishes before any request is served, which is what lets the room
 * live in memory: a DO is single-threaded and pinned to one location, so there
 * is no lock to take and no replica to reconcile.
 */

import { DEFAULT_FORMAT, buildCatalystPool, buildRoster, type CatalystData, type CharacterDef, type FormatId, type MapDef } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from './hub.js';
import { createRoom, detachAll, type Room } from './room.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import ironBasin from '../../../data/maps/iron-basin.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';
import cinder from '../../../data/characters/cinder.json';
import lumen from '../../../data/characters/lumen.json';
import ravok from '../../../data/characters/ravok.json';
import thorn from '../../../data/characters/thorn.json';
import kestrel from '../../../data/characters/kestrel.json';

/**
 * What every room can be played with — the **pickable roster**, not a deal.
 *
 * Bundled rather than fetched: `data/` is static content and a Worker that had
 * to fetch its own rules before it could start a turn would have a cold-start
 * failure mode for no benefit. It matches the client's default `CATALOG` — now
 * including Kestrel (BASIC-MODES) — so what a lobby offers is what the server
 * will accept. The two lists have to move together: a character the client
 * offers and the server does not is a pick refused at the last moment.
 *
 * **No `teams`** (M3-LOBBY-UI): the interim deal is gone from production, so a
 * networked room gets its characters from the lobby's picks and from nowhere
 * else. A config that still carried a deal would let a player press start and
 * be handed characters nobody chose.
 */
const CATALOG = [vex, bastion, wisp, aegis, cinder, lumen, ravok, thorn, kestrel] as unknown as CharacterDef[];

/**
 * The maps a room may be created on (M3-ROOM-CREATE). The first is the default,
 * for a room whose record carries no `mapId` — every room minted before the
 * host could choose one, and every test that does not care.
 */
export const MAPS = [duelArena, ironBasin] as unknown as MapDef[];
export const isMapId = (id: string): boolean => MAPS.some((m) => m.id === id);

/**
 * The config a room runs on. Built per room rather than once per module, because
 * the **map is now the host's choice** and lives on the record — the roster and
 * the catalyst pool are still the same for everybody.
 */
const matchConfig = (room: Room): MatchConfig => ({
  map: MAPS.find((m) => m.id === room.mapId) ?? MAPS[0]!,
  roster: buildRoster(CATALOG),
  catalysts: buildCatalystPool(catalystData as unknown as CatalystData),
});

/** Where the room record is kept between hibernations. */
const STORAGE_KEY = 'room';

/**
 * The real clock, handed to the hub (M3-TIMER).
 *
 * This is the runtime's job and nobody else's: the hub takes its clock as an
 * argument precisely so that a test can pass a counter, and `packages/engine`
 * may never read one at all. Same milliseconds the DO's alarm is set in, which
 * is what lets `hub.deadline` be passed straight to `setAlarm`.
 */
const NOW = (): number => Date.now();

/**
 * SOCKET-ID-STABLE — the shape of a minted socket id.
 *
 * A socket's id **becomes its seat id** when it joins (see `hub.open` /
 * `join`), so minting one that a seat already holds is not a cosmetic clash: it
 * is a join refused as `duplicateSeat` and a socket shown the door.
 */
const SOCKET_PREFIX = 'seat-';

/** A socket id from its index. One place, so the parse below cannot drift. */
export const socketIdFor = (index: number): string => `${SOCKET_PREFIX}${index}`;

/**
 * SOCKET-ID-STABLE — where the next socket index comes from: **the seats the
 * room already has**, not a counter in module scope.
 *
 * The counter used to be `let nextSocketId = 0` beside this function, which is
 * correct exactly as long as the isolate lives. A Durable Object is reclaimed
 * whenever the runtime feels like it — locally almost never, in production
 * routine — and the next instance started counting from zero again while the
 * room came back from storage still holding `seat-0` and `seat-1`. The first
 * player to reconnect was minted `seat-0`, `join` found that id already seated
 * and refused it as `duplicateSeat`, and their socket was closed. Every
 * subsequent attempt got the same id and the same refusal, so a room that
 * survived an eviction was **unjoinable** — which looks, from the outside,
 * exactly like the server being down.
 *
 * Derived rather than separately persisted, so there is one source of truth and
 * no second field to keep in step: the seats ARE the record of which ids are
 * spoken for, and they are already written after every frame. Monotonic within
 * an instance (the caller increments), and never below the highest id the room
 * has ever handed out and kept.
 *
 * Ids that are not ours — a test's `'a'`, a hand-written record — are skipped
 * rather than parsed into `NaN`, which would poison the maximum.
 */
export function nextSocketIndex(room: Room | undefined): number {
  let next = 0;
  for (const seat of room?.seats ?? []) {
    if (!seat.seatId.startsWith(SOCKET_PREFIX)) continue;
    const suffix = seat.seatId.slice(SOCKET_PREFIX.length);
    // `Number('')` is 0, not NaN, so a bare `seat-` would otherwise claim index
    // zero and reserve an id nothing holds.
    if (suffix === '') continue;
    const index = Number(suffix);
    if (Number.isSafeInteger(index) && index >= next) next = index + 1;
  }
  return next;
}

export class RoomDurableObject {
  #hub: RoomHub | undefined;
  readonly #state: DurableObjectState;
  /**
   * QUOTA-RUNAWAY: rows written are a metered resource (the free tier caps
   * them per day, and exhausting the cap breaks every room in the account), so
   * a write that changes nothing is not free — it is the budget. These two
   * fields let `#persist` and `#arm` skip the no-op case: the serialized form
   * of the last record written, and the alarm time last armed (`null` = known
   * clear, `undefined` = a fresh instance that has not asked yet).
   */
  #saved: string | undefined;
  #armedFor: number | null | undefined;
  /**
   * A monotonic counter, so two sockets never share a seat id — **seeded from
   * the restored room**, so it does not restart at zero under a room that has
   * already used the low numbers (SOCKET-ID-STABLE).
   */
  #nextSocketId = 0;

  constructor(state: DurableObjectState) {
    this.#state = state;
    // Nothing serves a request until the restore lands, so `#hub` is defined by
    // the time `fetch` runs — but the field is optional rather than asserted,
    // because a DO woken by an alarm before any fetch is a real path.
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<Room>(STORAGE_KEY);
      if (stored === undefined) return;
      // The sockets did not survive whatever ended the last instance, so no seat
      // is attached to anything (M3-RECONNECT's `connected` means exactly that).
      // Saying so here is what lets each player's ticket be honoured when they
      // come back — a record that still claimed they were present would refuse
      // every one of them as `seatTaken`.
      this.#hub = new RoomHub(detachAll(stored), matchConfig(stored), NOW);
      // SOCKET-ID-STABLE: pick the counter back up where the last instance left
      // it. Read off the restored seats rather than from a stored number — the
      // seats are what a new id has to avoid, so asking them directly is the
      // one form of the question that cannot go stale.
      this.#nextSocketId = nextSocketIndex(stored);
      // TIMER-PERSIST: re-aim the alarm at the window the record came back with.
      // The alarm itself survives hibernation, so this is belt-and-braces rather
      // than the whole fix — but a restore triggered some other way (a fetch, a
      // fresh socket) would otherwise leave the wake time and the room's own
      // deadline agreeing only by luck.
      await this.#arm();
    });
  }

  /**
   * M3-TIMER — the decision window ran out.
   *
   * The alarm is the only wall clock in the system that can *act*; everything it
   * knows about deadlines it asks the hub for. `expire()` is idempotent and
   * checks the time itself, so an alarm that fires early (the runtime is allowed
   * to) or late (the turn already resolved) is harmless.
   */
  async alarm(): Promise<void> {
    this.#hub?.expire();
    await this.#persist();
    await this.#arm();
  }

  /**
   * Point the alarm at the hub's current deadline, or clear it if there is none.
   *
   * Idempotent and cheap to call after every frame: a lock-in can close a window
   * early, and a Time Bank charge can push one out, so "when should I wake" is
   * re-asked rather than remembered.
   */
  async #arm(): Promise<void> {
    const deadline = this.#hub?.deadline ?? null;
    if (deadline === this.#armedFor) return; // already aimed exactly there
    if (deadline === null) await this.#state.storage.deleteAlarm();
    else await this.#state.storage.setAlarm(deadline);
    this.#armedFor = deadline;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Called once by the Worker when the code is minted. Idempotent: a retried
    // create must not wipe a room somebody has already joined.
    if (url.pathname === '/create') {
      const code = url.searchParams.get('code') ?? '';
      const format = (url.searchParams.get('format') ?? DEFAULT_FORMAT) as FormatId;
      // The Worker has already validated both; an unknown map id would fall back
      // to the default above rather than failing, which is the safe direction.
      const mapId = url.searchParams.get('map') ?? undefined;
      if (this.#hub === undefined) {
        const room = createRoom(code, format, mapId);
        this.#hub = new RoomHub(room, matchConfig(room), NOW);
        await this.#persist();
      }
      return Response.json(this.#hub.room);
    }

    if (this.#hub === undefined) {
      return new Response('no room with that code', { status: 404 });
    }

    if (url.pathname === '/room') {
      return Response.json(this.#hub.room);
    }

    // (`/start` used to be here, behind the Worker's `POST /rooms/:code/start`.
    // It existed only because the client had no socket to send the `start`
    // message down; M3-LOBBY-UI gave it one, and both were deleted in that same
    // slice — the socket message is the only way to start a match now.)

    if (url.pathname !== '/ws') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const seatId = socketIdFor(this.#nextSocketId++);
    server.accept();

    const hub = this.#hub;
    const sink: Sink = {
      send: (data) => server.send(data),
      close: (code, reason) => server.close(code, reason),
    };
    hub.open(seatId, sink);

    server.addEventListener('message', (event: MessageEvent) => {
      hub.receive(seatId, event.data);
      // Persisted after every frame that can change the record. A room is a few
      // hundred bytes and a turn is seconds long, so the write is free next to
      // losing a lobby to an eviction.
      void this.#persist();
      // …and re-aimed, because a frame can open a window (start), close one
      // early (the last lock-in) or push one out (the Time Bank).
      void this.#arm();
    });
    const drop = (): void => {
      hub.close(seatId);
      void this.#persist();
      void this.#arm();
    };
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  async #persist(): Promise<void> {
    if (this.#hub === undefined) return;
    const room = this.#hub.room;
    // A record identical to the one already in storage is not written again —
    // pings and other no-op frames used to cost a row write each. Serializing
    // to compare is the cheap side of the trade: a room is a few hundred bytes,
    // a row write is the metered resource.
    const serialized = JSON.stringify(room);
    if (serialized === this.#saved) return;
    await this.#state.storage.put(STORAGE_KEY, room);
    this.#saved = serialized;
  }
}
