import { describe, expect, it } from 'vitest';
import type { CharacterDef, MapDef, Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from '../src/protocol.js';
import { createRoom } from '../src/room.js';
import worker, { type Env } from '../src/worker.js';

/**
 * M3-START — "start now", for a room that will never fill.
 *
 * The auto-trigger is a **full** room, and that is correct: starting the moment
 * both teams have somebody deals the characters before the third and fourth
 * players arrive and seats them controlling nothing. But it leaves a legal
 * configuration with no trigger at all — a 2v2 that two players intend to run
 * with two characters each. This is the escape hatch, and the reason M3-HIDDEN
 * is exercisable over the network on two browsers instead of four.
 *
 * M3-LOBBY's start button sends the same message; nothing here is throwaway
 * except the HTTP route, which exists only because the client has no socket
 * layer yet.
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
const TEAMS: [CharacterDef[], CharacterDef[]] = [[CHAR, CHAR], [CHAR, CHAR]];
const config: MatchConfig = { map: OPEN, roster, teams: TEAMS };

class FakeSocket implements Sink {
  readonly sent: ServerMessage[] = [];
  closed = false;
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage); }
  close(): void { this.closed = true; }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
}

const joinFrame = (name?: string): string =>
  JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name });
const START = JSON.stringify({ type: 'start' });

/** A 2v2 with `n` seats joined — under four, so nothing auto-starts. */
const room = (n: number) => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
  const sockets: FakeSocket[] = [];
  for (let i = 0; i < n; i++) {
    const s = new FakeSocket();
    hub.open(`s${i}`, s);
    hub.receive(`s${i}`, joinFrame(`P${i}`));
    sockets.push(s);
  }
  return { hub, sockets };
};

describe('M3-START: the message', () => {
  it('parses, and needs no version — it is an in-room message', () => {
    // `join` carries the version because it is the handshake; everything after
    // it is on a socket whose version was already checked.
    expect(parseClientMessage(START)).toEqual({ type: 'start' });
  });

  it('a two-player 2v2 starts when a seated player sends it', () => {
    const { hub, sockets } = room(2);
    expect(hub.room.state, 'no auto-start on a short room').toBeUndefined();

    hub.receive('s0', START);

    expect(hub.room.state, 'the match began').toBeDefined();
    for (const s of sockets) expect(s.of('matchStarted')).toHaveLength(1);
  });

  it('and the short room deals every character to the players present', () => {
    // Two seats, four characters: nobody is left holding an empty control map,
    // which is the whole difference between this and a post-start join.
    const { hub, sockets } = room(2);
    hub.receive('s0', START);

    const unitIds = hub.room.seats.flatMap((s) => s.unitIds);
    expect(unitIds).toHaveLength(4);
    expect(new Set(unitIds).size, 'and no character is dealt twice').toBe(4);
    for (const s of sockets) expect(s.of('matchStarted')[0]!.unitIds).toHaveLength(2);
  });

  it('the deal is deterministic — the same joins give the same seating', () => {
    const a = room(2);
    a.hub.receive('s0', START);
    const b = room(2);
    b.hub.receive('s1', START);
    expect(b.hub.room.seats).toEqual(a.hub.room.seats);
  });

  it('a match started this way runs a turn like any other', () => {
    const { hub } = room(2);
    hub.receive('s0', START);
    for (const seat of hub.room.seats) {
      hub.receive(seat.seatId, JSON.stringify({ type: 'submit', orders: [] }));
    }
    expect(hub.room.turn).toBe(2);
  });

  it('and it is fogged from the first Decision, like any other', () => {
    // The point of the item: M3-HIDDEN, exercisable on two players.
    const { hub, sockets } = room(2);
    hub.receive('s0', START);
    const idx = hub.room.seats.findIndex((s) => s.team === 0);
    const decision = sockets[idx]!.of('decision')[0]!;
    expect(decision.state.units.every((u) => u.owner === 0)).toBe(true);
  });
});

describe('M3-START: when it is refused', () => {
  it('a socket that never joined cannot start the room', () => {
    // Not in the room, no standing to decide the room is ready.
    const { hub } = room(2);
    const lurker = new FakeSocket();
    hub.open('lurker', lurker);
    hub.receive('lurker', START);
    expect(lurker.of('error')[0]?.code).toBe('notJoined');
    expect(hub.room.state).toBeUndefined();
  });

  it('a room below the format minimum is refused, not silently ignored', () => {
    // One player is not a match. A start button that does nothing visible is
    // worse than one that says why.
    const { hub, sockets } = room(1);
    hub.receive('s0', START);
    expect(sockets[0]!.of('error')[0]?.code).toBe('cannotStart');
    expect(sockets[0]!.of('error')[0]?.message).toContain('cannot start');
    expect(hub.room.state).toBeUndefined();
  });

  it('a second start on a running match is refused too', () => {
    const { hub, sockets } = room(2);
    hub.receive('s0', START);
    hub.receive('s0', START);
    expect(sockets[0]!.of('error')[0]?.code).toBe('cannotStart');
    expect(sockets[0]!.of('matchStarted'), 'and nothing is re-dealt').toHaveLength(1);
  });

  it('a refusal does not close the socket — the room is still joinable', () => {
    const { hub, sockets } = room(1);
    hub.receive('s0', START);
    expect(sockets[0]!.closed).toBe(false);

    const second = new FakeSocket();
    hub.open('s1', second);
    hub.receive('s1', joinFrame('P1'));
    expect(second.of('joined')).toHaveLength(1);
    hub.receive('s0', START);
    expect(hub.room.state, 'and now it starts').toBeDefined();
  });
});

/**
 * The HTTP affordance. The `start` message above is the real path; this exists
 * because the client has no socket layer until M3-LOBBY, and a short room that
 * can only be started by a client that does not exist is not startable at all.
 */
describe('M3-START: POST /rooms/:code/start', () => {
  class StubNamespace {
    readonly calls: { name: string; url: string; method: string }[] = [];
    idFromName(name: string) { return { name }; }
    get(id: { name: string }) {
      return {
        fetch: async (input: string | Request, init?: RequestInit): Promise<Response> => {
          const url = typeof input === 'string' ? input : input.url;
          const method = init?.method ?? (typeof input === 'string' ? 'GET' : input.method);
          this.calls.push({ name: id.name, url, method });
          return Response.json({ code: id.name, started: true });
        },
      };
    }
  }
  const env = (ns: StubNamespace): Env => ({ ROOMS: ns as unknown as Env['ROOMS'] });

  it('routes to the room\'s object with POST', async () => {
    const ns = new StubNamespace();
    const res = await worker.fetch(new Request('https://x/rooms/wxyz/start', { method: 'POST' }), env(ns));
    expect(res.status).toBe(200);
    expect(ns.calls).toEqual([{ name: 'WXYZ', url: 'https://room/start', method: 'POST' }]);
  });

  it('is POST-only — a link preview must not start somebody\'s match', async () => {
    const ns = new StubNamespace();
    const res = await worker.fetch(new Request('https://x/rooms/WXYZ/start'), env(ns));
    expect(res.status).toBe(404);
    expect(ns.calls, 'the room was never woken').toHaveLength(0);
  });

  it('still validates the code', async () => {
    const ns = new StubNamespace();
    const res = await worker.fetch(new Request('https://x/rooms/nope1/start', { method: 'POST' }), env(ns));
    expect(res.status).toBe(400);
  });
});
