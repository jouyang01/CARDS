import { describe, expect, it } from 'vitest';
import { RoomHub, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { createRoom } from '../src/room.js';

/**
 * M3-ROOM — the DO's message handling, driven through the `Sink` seam.
 *
 * This is the "DO unit harness" the spec allows in place of a Workers runtime.
 * A fake socket is two functions and an array, and everything worth asserting —
 * who gets told what, which joins are refused, whether a dropped connection
 * frees its seat — is visible in that array. Booting miniflare would test
 * Cloudflare's WebSocket implementation instead, which is not ours to test and
 * needs an account this sandbox does not have.
 */

/** A socket that records what the hub said to it. */
class FakeSocket implements Sink {
  readonly sent: ServerMessage[] = [];
  closed: { code?: number; reason?: string } | undefined;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  /** The last message, which is what a handler's behaviour usually comes down to. */
  get last(): ServerMessage | undefined {
    return this.sent[this.sent.length - 1];
  }

  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
}

const joinFrame = (name?: string, version = PROTOCOL_VERSION): string =>
  JSON.stringify(name === undefined ? { type: 'join', version } : { type: 'join', version, name });

/** A hub with `n` sockets attached and joined, plus their fakes. */
const seated = (format: '1v1' | '2v2' | '4v4', n: number) => {
  const hub = new RoomHub(createRoom('WXYZ', format));
  const sockets: FakeSocket[] = [];
  for (let i = 0; i < n; i++) {
    const socket = new FakeSocket();
    hub.open(`s${i}`, socket);
    hub.receive(`s${i}`, joinFrame(`P${i}`));
    sockets.push(socket);
  }
  return { hub, sockets };
};

describe('M3-ROOM: create → join', () => {
  it('a joiner is told who it is and what the room looks like', () => {
    const { hub, sockets } = seated('2v2', 1);
    const joined = sockets[0]!.of('joined')[0];
    expect(joined?.seat).toEqual({ seatId: 's0', team: 0, name: 'P0', unitIds: [] });
    expect(joined?.room).toMatchObject({ code: 'WXYZ', format: '2v2', turn: 0, canStart: false });
    expect(hub.room.seats).toHaveLength(1);
  });

  it('everybody already in the room hears about the new arrival', () => {
    const { sockets } = seated('2v2', 2);
    const update = sockets[0]!.of('roomUpdated')[0];
    expect(update?.room.seats.map((s) => s.seatId)).toEqual(['s0', 's1']);
  });

  it('the joiner does not also get a roomUpdated for its own join', () => {
    // It just received the same room inside `joined`. Sending both makes the
    // client apply one state twice and, worse, makes "did I get in?" ambiguous.
    const { sockets } = seated('2v2', 2);
    expect(sockets[1]!.of('roomUpdated')).toHaveLength(0);
    expect(sockets[1]!.of('joined')).toHaveLength(1);
  });

  it('reports canStart once both teams have somebody', () => {
    const { sockets } = seated('2v2', 2);
    expect(sockets[0]!.of('joined')[0]?.room.canStart, 'alone').toBe(false);
    expect(sockets[1]!.of('joined')[0]?.room.canStart, 'one each').toBe(true);
  });
});

describe('M3-ROOM: a join past the bound is refused', () => {
  it('the fifth player into a 2v2 is told the room is full and closed', () => {
    const { hub, sockets } = seated('2v2', 4);
    const late = new FakeSocket();
    hub.open('late', late);
    hub.receive('late', joinFrame('Late'));

    expect(late.last).toEqual({ type: 'error', code: 'roomFull', message: 'this room is full' });
    expect(late.closed?.code, 'a policy close, not a protocol error').toBe(1008);
    expect(hub.room.seats, 'and the room did not grow').toHaveLength(4);
    // Nobody inside hears about a join that did not happen.
    for (const s of sockets) expect(s.of('roomUpdated').length).toBeLessThanOrEqual(3);
  });

  it('4v4 takes eight before it refuses', () => {
    const { hub } = seated('4v4', 8);
    expect(hub.room.seats).toHaveLength(8);
    const late = new FakeSocket();
    hub.open('late', late);
    hub.receive('late', joinFrame());
    expect(late.last).toMatchObject({ code: 'roomFull' });
  });

  it('an open socket that never joins occupies no seat', () => {
    // Otherwise opening connections would be enough to fill a room, and a
    // half-loaded client would lock everybody else out.
    const { hub } = seated('1v1', 2);
    for (let i = 0; i < 5; i++) hub.open(`idle-${i}`, new FakeSocket());
    expect(hub.room.seats, 'still two').toHaveLength(2);
    expect(hub.connections, 'but seven sockets').toBe(7);
  });

  it('a second join from a seat that is already in is refused', () => {
    const { hub, sockets } = seated('2v2', 1);
    hub.receive('s0', joinFrame('again'));
    expect(sockets[0]!.last).toMatchObject({ code: 'duplicateSeat' });
    expect(hub.room.seats).toHaveLength(1);
  });
});

describe('M3-ROOM: leaving', () => {
  it('frees the seat and tells the room', () => {
    const { hub, sockets } = seated('2v2', 2);
    hub.close('s1');
    expect(hub.room.seats.map((s) => s.seatId)).toEqual(['s0']);
    const left = sockets[0]!.of('seatLeft')[0];
    expect(left?.seatId).toBe('s1');
    expect(left?.room.canStart, 'a one-sided room cannot start').toBe(false);
  });

  it('the freed seat can be taken by somebody new', () => {
    const { hub } = seated('1v1', 2);
    hub.close('s0');
    const replacement = new FakeSocket();
    hub.open('s9', replacement);
    hub.receive('s9', joinFrame('New'));
    expect(replacement.of('joined')).toHaveLength(1);
    expect(hub.room.seats).toHaveLength(2);
  });

  it('closing twice is a no-op — a close after an error close is ordinary', () => {
    const { hub, sockets } = seated('2v2', 2);
    hub.close('s1');
    hub.close('s1');
    expect(hub.room.seats).toHaveLength(1);
    expect(sockets[0]!.of('seatLeft'), 'and the room is told once').toHaveLength(1);
  });

  it('closing a socket that never joined tells nobody', () => {
    const { hub, sockets } = seated('2v2', 1);
    hub.open('lurker', new FakeSocket());
    hub.close('lurker');
    expect(sockets[0]!.of('seatLeft')).toHaveLength(0);
  });
});

describe('M3-ROOM: the protocol refuses what it does not understand', () => {
  it('a wrong protocol version is closed rather than left to diverge', () => {
    // A stale tab after a deploy is the normal case for this. Leaving it
    // connected means a client that cannot be understood quietly disagreeing
    // about the room.
    const hub = new RoomHub(createRoom('WXYZ', '2v2'));
    const socket = new FakeSocket();
    hub.open('s0', socket);
    hub.receive('s0', joinFrame('Old', PROTOCOL_VERSION + 1));
    expect(socket.last).toMatchObject({ code: 'badVersion' });
    expect(socket.closed?.code).toBe(1008);
    expect(hub.room.seats).toHaveLength(0);
  });

  it('a frame that is not a message earns one error and no seat', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'));
    const socket = new FakeSocket();
    hub.open('s0', socket);
    for (const junk of ['not json', '"a string"', '{"type":"nope"}', '{"type":"join"}', '[]']) {
      hub.receive('s0', junk);
    }
    expect(socket.of('error').every((e) => e.code === 'badMessage')).toBe(true);
    expect(socket.of('error')).toHaveLength(5);
    expect(hub.room.seats, 'and none of it got anybody in').toHaveLength(0);
  });

  it('a non-string frame is not a message either', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'));
    const socket = new FakeSocket();
    hub.open('s0', socket);
    hub.receive('s0', new ArrayBuffer(8));
    expect(socket.last).toMatchObject({ code: 'badMessage' });
  });

  it('ping is answered before a join, because that is what a probe is for', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'));
    const socket = new FakeSocket();
    hub.open('s0', socket);
    hub.receive('s0', JSON.stringify({ type: 'ping' }));
    expect(socket.last).toEqual({ type: 'pong' });
    expect(hub.room.seats).toHaveLength(0);
  });

  it('a frame from a socket the hub already dropped is ignored', () => {
    const { hub, sockets } = seated('2v2', 1);
    hub.close('s0');
    const before = sockets[0]!.sent.length;
    hub.receive('s0', JSON.stringify({ type: 'ping' }));
    expect(sockets[0]!.sent).toHaveLength(before);
  });
});

describe('M3-ROOM: the hub owns no game logic yet', () => {
  it('a fresh room is on turn 0 — nothing has started', () => {
    const { hub } = seated('2v2', 2);
    expect(hub.room.turn).toBe(0);
  });

  it('hands out a copy of the room, so a caller cannot edit history', () => {
    const { hub } = seated('2v2', 2);
    const snapshot = hub.room;
    snapshot.seats.length = 0;
    snapshot.turn = 99;
    expect(hub.room.seats).toHaveLength(2);
    expect(hub.room.turn).toBe(0);
  });
});
