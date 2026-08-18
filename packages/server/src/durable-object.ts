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

/**
 * What every room can be played with — the **pickable roster**, not a deal.
 *
 * Bundled rather than fetched: `data/` is static content and a Worker that had
 * to fetch its own rules before it could start a turn would have a cold-start
 * failure mode for no benefit. It matches the client's default `CATALOG`
 * (Kestrel excluded until BASIC-MODES), so what a lobby offers is what the
 * server will accept.
 *
 * **No `teams`** (M3-LOBBY-UI): the interim deal is gone from production, so a
 * networked room gets its characters from the lobby's picks and from nowhere
 * else. A config that still carried a deal would let a player press start and
 * be handed characters nobody chose.
 */
const CATALOG = [vex, bastion, wisp, aegis, cinder, lumen, ravok, thorn] as unknown as CharacterDef[];

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

/** A monotonic per-DO counter, so two sockets never share a seat id. */
let nextSocketId = 0;

export class RoomDurableObject {
  #hub: RoomHub | undefined;
  readonly #state: DurableObjectState;

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
    const deadline = this.#hub?.deadline;
    if (deadline === undefined) return void await this.#state.storage.deleteAlarm();
    await this.#state.storage.setAlarm(deadline);
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
    const seatId = `seat-${nextSocketId++}`;
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
    await this.#state.storage.put(STORAGE_KEY, this.#hub.room);
  }
}
