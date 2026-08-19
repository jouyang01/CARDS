import { describe, expect, it } from 'vitest';
import type { CharacterDef, MapDef, Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { createRoom, detachAll, type Room } from '../src/room.js';
import { nextSocketIndex, socketIdFor } from '../src/durable-object.js';

/**
 * SOCKET-ID-STABLE — a socket id must not collide with a seat the room already
 * has (Builder OQ 2026-09-20 #2).
 *
 * A socket's id **becomes its seat id** when it joins, so the DO's minting is
 * not bookkeeping — it decides whether a player gets in. It used to come from
 * `let nextSocketId = 0` in module scope, which is correct exactly as long as
 * the isolate lives. A Durable Object is reclaimed whenever the runtime feels
 * like it; the next instance counted from zero again while the room came back
 * from storage still holding `seat-0` and `seat-1`. So the first player to
 * reconnect was minted `seat-0`, `join` found that id already seated and refused
 * it as `duplicateSeat`, and the socket was closed — every time, for every
 * player. A room that survived an eviction was **unjoinable**, which from the
 * outside is indistinguishable from the server being down.
 *
 * Eviction is modelled the way the rest of this suite models it (TIMER-PERSIST,
 * SUBMISSIONS-PERSIST): by doing what the runtime does — round-trip the record
 * through JSON, `detachAll`, build a fresh hub. That is a DO restart with the
 * Workers runtime left out of it, and it is the same shape the constructor
 * runs. The one thing added here is the id source, which is where the bug was.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }, { x: 1, y: 9 }], [{ x: 13, y: 7 }, { x: 13, y: 9 }]],
};
const shot = {
  id: 'shot', name: 'shot', phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 20 }],
  description: 'shot',
};
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [shot],
  ultimate: { ...shot, id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] },
};
const roster: Roster = { 'test-char': CHAR };
const config: MatchConfig = { map: OPEN, roster, teams: [[CHAR], [CHAR]] };

class FakeSocket implements Sink {
  readonly sent: ServerMessage[] = [];
  closed: { code?: number; reason?: string } | undefined;
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage); }
  close(code?: number, reason?: string): void { this.closed = { code, reason }; }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
}

const joinFrame = (name: string, seatId?: string): string =>
  JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name, ...(seatId === undefined ? {} : { seatId }) });

/**
 * A DO instance, as the class composes it: a counter seeded off the room it
 * restored, and a hub over that room. Everything the real one does about ids.
 */
const instance = (stored?: Room, format: '1v1' | '2v2' = '2v2') => {
  const room = stored === undefined ? createRoom('WXYZ', format) : detachAll(stored);
  const hub = new RoomHub(room, config);
  let counter = nextSocketIndex(stored);
  return {
    hub,
    /** Open one socket the way `fetch` does, and hand it a join frame. */
    connect(name: string, ticket?: string): FakeSocket {
      const socket = new FakeSocket();
      const id = socketIdFor(counter++);
      hub.open(id, socket);
      hub.receive(id, joinFrame(name, ticket));
      return socket;
    },
    get room(): Room { return hub.room; },
  };
};

/** What the runtime does to a DO: the record survives, everything else does not. */
const evict = (room: Room): Room => JSON.parse(JSON.stringify(room)) as Room;

describe('SOCKET-ID-STABLE: a restored room is still joinable', () => {
  it('the bug, in one assertion: a fresh socket after a restart is not refused', () => {
    // The AC. Two players are in a lobby, the DO is evicted, and one of them
    // comes back. Before the fix this socket was minted `seat-0`, collided with
    // the seat still on the record, and was closed.
    const first = instance();
    first.connect('Ada');
    first.connect('Bo');
    expect(first.room.seats.map((s) => s.seatId)).toEqual(['seat-0', 'seat-1']);

    const restarted = instance(evict(first.room));
    const returning = restarted.connect('Ada again');
    expect(returning.of('error'), 'no refusal').toEqual([]);
    expect(returning.closed, 'and no closed door').toBeUndefined();
    expect(returning.of('joined').at(-1)?.seat.seatId, 'seated under a new id').toBe('seat-2');
  });

  it('and the room grows rather than fighting itself', () => {
    const first = instance();
    first.connect('Ada');
    const restarted = instance(evict(first.room));
    restarted.connect('Bo');
    expect(restarted.room.seats.map((s) => s.seatId)).toEqual(['seat-0', 'seat-1']);
    expect(new Set(restarted.room.seats.map((s) => s.seatId)).size, 'all distinct').toBe(2);
  });

  it('across two restarts, because eviction is not a one-off', () => {
    // The counter is derived every time rather than carried, so a room that has
    // been evicted twice is no different from one evicted once.
    let live = instance();
    live.connect('Ada');
    for (const name of ['Bo', 'Cy']) {
      live = instance(evict(live.room));
      const socket = live.connect(name);
      expect(socket.of('error'), name).toEqual([]);
    }
    expect(live.room.seats.map((s) => s.seatId)).toEqual(['seat-0', 'seat-1', 'seat-2']);
  });

  it('a reclaim across a restart still lands on its own seat', () => {
    // The other half of what a restart is for (M3-RECONNECT): the returning
    // player's ticket must still name a seat that is theirs. A colliding mint
    // used to close the socket before the ticket was ever considered.
    // 1v1 here, because this one actually starts a match and the interim deal
    // is a 1v1 deal.
    const first = instance(undefined, '1v1');
    first.connect('Ada');
    first.connect('Bo');
    first.hub.receive('seat-0', JSON.stringify({ type: 'start' }));
    expect(first.room.state, 'a match to come back to').toBeDefined();

    const restarted = instance(evict(first.room));
    const back = restarted.connect('Ada', 'seat-0');
    expect(back.of('error'), 'the ticket was honoured').toEqual([]);
    expect(back.of('matchStarted').at(-1)?.seat.seatId).toBe('seat-0');
  });
});

describe('SOCKET-ID-STABLE: the Durable Object itself, not a stand-in for it', () => {
  /**
   * The block above composes `nextSocketIndex` with a hub the way the DO does,
   * which proves the *rule* and not the *wiring* — a `durable-object.ts` that
   * went back to a module-level counter would leave every one of those tests
   * green. The bug was in the wiring, so this drives the real class.
   *
   * The Workers runtime is faked down to what the constructor and `/ws` touch:
   * a storage map, `blockConcurrencyWhile` (which the real one uses to finish
   * the restore before any request is served), and a `WebSocketPair`.
   */
  class FakeServerSocket {
    readonly frames: string[] = [];
    readonly listeners = new Map<string, (event: { data: string }) => void>();
    accept(): void {}
    addEventListener(type: string, fn: (event: { data: string }) => void): void {
      this.listeners.set(type, fn);
    }
    send(data: string): void { this.frames.push(data); }
    close(): void {}
    /** Deliver a client frame, as the runtime would. */
    deliver(data: string): void { this.listeners.get('message')?.({ data }); }
    get messages(): ServerMessage[] {
      return this.frames.map((f) => JSON.parse(f) as ServerMessage);
    }
  }

  const sockets: FakeServerSocket[] = [];
  const globals = globalThis as Record<string, unknown>;

  /**
   * `WebSocketPair`, and a `Response` that tolerates a 101.
   *
   * The upgrade response is the one place the Workers runtime is genuinely
   * more permissive than Node: `new Response(null, { status: 101 })` throws
   * here and is the normal reply there. Shimmed rather than caught, so the
   * DO's `fetch` runs to its end the way it does in production instead of
   * being asserted against from inside a rejected promise.
   */
  const withFakeRuntime = async <T>(run: () => Promise<T>): Promise<T> => {
    const realResponse = globals['Response'] as typeof Response;
    const saved = { WebSocketPair: globals['WebSocketPair'], Response: realResponse };
    globals['WebSocketPair'] = function WebSocketPair(this: unknown) {
      const server = new FakeServerSocket();
      sockets.push(server);
      return { 0: {}, 1: server };
    };
    globals['Response'] = class ShimResponse {
      readonly status: number;
      constructor(readonly body: unknown, init?: { status?: number }) {
        this.status = init?.status ?? 200;
      }
      static json(data: unknown): Response { return realResponse.json(data); }
    };
    try {
      return await run();
    } finally {
      globals['WebSocketPair'] = saved.WebSocketPair;
      globals['Response'] = saved.Response;
    }
  };

  /** A DO over a storage map, with its restore awaited. */
  const boot = async (stored?: Room) => {
    const storage = new Map<string, unknown>();
    if (stored !== undefined) storage.set('room', JSON.parse(JSON.stringify(stored)));
    let restore: Promise<unknown> = Promise.resolve();
    const state = {
      storage: {
        get: (key: string) => Promise.resolve(storage.get(key)),
        put: (key: string, value: unknown) => { storage.set(key, value); return Promise.resolve(); },
        setAlarm: () => Promise.resolve(),
        deleteAlarm: () => Promise.resolve(),
      },
      blockConcurrencyWhile: (fn: () => Promise<unknown>) => { restore = fn(); return restore; },
    };
    const { RoomDurableObject } = await import('../src/durable-object.js');
    const object = new RoomDurableObject(state as never);
    await restore;
    return { object, storage };
  };

  const upgrade = (): Request =>
    new Request('https://room/ws', { headers: { Upgrade: 'websocket' } });

  it('mints an id past the seats the restored room came back with', async () => {
    // The bug end to end, through the class: a room with `seat-0` and `seat-1`
    // on the record, a brand-new instance, and a player connecting. Before the
    // fix this socket was minted `seat-0` and closed as `duplicateSeat`.
    const seeded = instance();
    seeded.connect('Ada');
    seeded.connect('Bo');

    await withFakeRuntime(async () => {
      sockets.length = 0;
      const { object } = await boot(seeded.room);
      await object.fetch(upgrade());
      const socket = sockets.at(-1)!;
      socket.deliver(joinFrame('Ada again'));

      const errors = socket.messages.filter((m) => m.type === 'error');
      expect(errors, 'the restored room refused a fresh player').toEqual([]);
      const joined = socket.messages.find((m) => m.type === 'joined');
      expect(joined?.type === 'joined' ? joined.seat.seatId : undefined).toBe('seat-2');
    });
  });

  it('and a fresh room still starts at seat-0', async () => {
    // The control: the seeding must not have pushed a brand-new room's first
    // socket off zero, which would make every existing test's expectations lies.
    await withFakeRuntime(async () => {
      sockets.length = 0;
      const { object } = await boot();
      await object.fetch(new Request('https://room/create?code=WXYZ&format=2v2'));
      await object.fetch(upgrade());
      const socket = sockets.at(-1)!;
      socket.deliver(joinFrame('Ada'));
      const joined = socket.messages.find((m) => m.type === 'joined');
      expect(joined?.type === 'joined' ? joined.seat.seatId : undefined).toBe('seat-0');
    });
  });
});

describe('SOCKET-ID-STABLE: where the next index comes from', () => {
  const roomWith = (...seatIds: string[]): Room => ({
    ...createRoom('WXYZ', '2v2'),
    seats: seatIds.map((seatId, i) => ({
      seatId, team: (i % 2) as 0 | 1, name: seatId, unitIds: [], picks: [],
      ready: false, connected: false, missedTurns: 0,
    })),
  });

  it('an empty or missing room starts at zero', () => {
    expect(nextSocketIndex(undefined), 'a DO with nothing in storage').toBe(0);
    expect(nextSocketIndex(roomWith())).toBe(0);
  });

  it('one past the highest id the room holds', () => {
    expect(nextSocketIndex(roomWith('seat-0', 'seat-1'))).toBe(2);
    expect(nextSocketIndex(roomWith('seat-7'))).toBe(8);
  });

  it('the HIGHEST, not the count — a lobby loses seats when players leave', () => {
    // `leave` deletes a lobby seat outright, so the seat list is not a dense
    // range. Counting them would re-mint an id still in use by the survivor.
    expect(nextSocketIndex(roomWith('seat-3'))).toBe(4);
    expect(nextSocketIndex(roomWith('seat-0', 'seat-4'))).toBe(5);
  });

  it('and ids that are not ours are skipped, not parsed into NaN', () => {
    // Every test in this suite seats sockets called `s0`, `a`, `thief`. One
    // `Number('x') === NaN` in the maximum would silently return 0 and put the
    // collision straight back.
    expect(nextSocketIndex(roomWith('a', 'thief', 'seat-2'))).toBe(3);
    // `Number('')` is 0 rather than NaN, so a bare `seat-` is the one that gets
    // through a naive guard and reserves index zero for nobody.
    expect(nextSocketIndex(roomWith('seat-', 'seat-oops'))).toBe(0);
  });

  it('the id it builds is the id it reads', () => {
    // The prefix lives in one place; this is the round trip that keeps it there.
    for (const n of [0, 1, 9, 42]) {
      expect(nextSocketIndex(roomWith(socketIdFor(n)))).toBe(n + 1);
    }
  });
});
