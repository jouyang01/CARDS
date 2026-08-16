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
import { createRoom, type Room } from './room.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * The match every room runs, until M3-LOBBY lets players choose.
 *
 * Bundled rather than fetched: `data/` is static content and a Worker that had
 * to fetch its own rules before it could start a turn would have a cold-start
 * failure mode for no benefit. The deal mirrors the client's dev default (Vex +
 * Wisp against Bastion + Aegis) so a hot-seat player and a networked one are
 * looking at the same match.
 */
const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const MATCH: MatchConfig = {
  map: duelArena as unknown as MapDef,
  roster: buildRoster(CATALOG),
  teams: [[CATALOG[0]!, CATALOG[2]!], [CATALOG[1]!, CATALOG[3]!]],
  catalysts: buildCatalystPool(catalystData as unknown as CatalystData),
};

/** Where the room record is kept between hibernations. */
const STORAGE_KEY = 'room';

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
      if (stored !== undefined) this.#hub = new RoomHub(stored, MATCH);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Called once by the Worker when the code is minted. Idempotent: a retried
    // create must not wipe a room somebody has already joined.
    if (url.pathname === '/create') {
      const code = url.searchParams.get('code') ?? '';
      const format = (url.searchParams.get('format') ?? DEFAULT_FORMAT) as FormatId;
      if (this.#hub === undefined) {
        this.#hub = new RoomHub(createRoom(code, format), MATCH);
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

    // M3-START's dev affordance. The in-match `start` message is the real path
    // and M3-LOBBY's button will send it, but the client has no socket layer
    // yet — so until it does, a short room is startable with one HTTP call
    // (`POST /rooms/WXYZ/start`) and M3-HIDDEN becomes exercisable on two
    // players instead of four. `start()` is a no-op on a room that cannot
    // start, hence the room record as the answer: the caller reads back
    // whether it took.
    if (url.pathname === '/start') {
      this.#hub.start();
      await this.#persist();
      return Response.json(this.#hub.room);
    }

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
    });
    const drop = (): void => {
      hub.close(seatId);
      void this.#persist();
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
