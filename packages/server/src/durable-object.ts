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

import { DEFAULT_FORMAT, type FormatId } from '@cards/engine';
import { RoomHub, type Sink } from './hub.js';
import { createRoom, type Room } from './room.js';

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
      if (stored !== undefined) this.#hub = new RoomHub(stored);
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
        this.#hub = new RoomHub(createRoom(code, format));
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
