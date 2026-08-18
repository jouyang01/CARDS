import { describe, expect, it } from 'vitest';
import type { CharacterDef, MapDef, Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient, frames, type NetState } from '../src/net.js';
import {
  RECONNECT_ATTEMPTS, reconnectDelayMs, shouldReconnect, ticketKey, ticketsIn,
  type TicketStorage,
} from '../src/reconnect.js';
import { connectionLabel } from '../src/waiting.js';

/**
 * M3-RECONNECT (client half) — getting back into a match you were already in.
 *
 * The server holds the seat and lets its occupant back in by name; everything
 * here is about the three decisions that leaves the client:
 *
 * 1. **Remember which seat you were**, per room code, and forget it when the
 *    server refuses to honour it — a ticket the room will not take is what a
 *    retry loop spins on forever.
 * 2. **Say which of the two things is happening.** "Reconnecting…" and
 *    "reload to rejoin" are different instructions, and a single sentence for
 *    both leaves a player reloading over a rejoin that was about to land.
 * 3. **Survive the socket.** The seat, board and room a reclaim is *for* live in
 *    the client, so the client outlives the connection and only the transport is
 *    replaced.
 *
 * The end-to-end cases drive a real `RoomHub`, so "the seat came back" is
 * demonstrated rather than asserted against a fake.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 9 }, { x: 1, y: 11 }], [{ x: 19, y: 9 }, { x: 19, y: 11 }]],
};
const shot = {
  id: 'shot', name: 'shot', phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 20 }],
  description: 'shot',
};
const character = (id: string): CharacterDef => ({
  id, name: id, archetype: 'firepower', maxHp: 100,
  abilities: [shot],
  ultimate: { ...shot, id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] },
});
const roster: Roster = Object.fromEntries(['ash', 'bry', 'cyn', 'dex'].map((id) => [id, character(id)]));
const config: MatchConfig = {
  map: OPEN, roster, teams: [[roster['ash']!, roster['bry']!], [roster['cyn']!, roster['dex']!]],
};

/** A `RoomClient` glued back to back with a hub socket, no transport between. */
class Wire implements Sink {
  constructor(
    readonly client: RoomClient,
    private readonly hub: RoomHub,
    private readonly socketId: string,
  ) {
    this.hub.open(socketId, this);
  }
  /** What the client would send down this socket. */
  sink(): { send(data: string): void; close(): void } {
    return {
      send: (data: string) => { this.hub.receive(this.socketId, data); },
      close: () => { this.hub.close(this.socketId); },
    };
  }
  send(data: string): void { this.client.receive(data); }
  close(): void { this.client.closed(); }
}

/** A started 2v2, one seat per team, both clients real. */
const started = () => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
  const clients: RoomClient[] = [];
  const wires: Wire[] = [];
  for (const id of ['a', 'b']) {
    const client = new RoomClient({ send: () => {}, close: () => {} });
    const wire = new Wire(client, hub, id);
    client.attach(wire.sink());
    clients.push(client);
    wires.push(wire);
  }
  clients[0]!.join('A');
  clients[1]!.join('B');
  clients[0]!.pick([{ characterId: 'ash' }, { characterId: 'bry' }]);
  clients[1]!.pick([{ characterId: 'cyn' }, { characterId: 'dex' }]);
  clients[0]!.start();
  return { hub, a: clients[0]!, b: clients[1]! };
};

describe('M3-RECONNECT: the ticket', () => {
  const memory = (): TicketStorage => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    };
  };

  it('is namespaced per room, and case-insensitive like the code a player types', () => {
    expect(ticketKey('wxyz')).toBe(ticketKey('WXYZ'));
    expect(ticketKey('WXYZ')).not.toBe(ticketKey('ABCD'));
  });

  it('remembers one seat per room and hands it back', () => {
    const tickets = ticketsIn(memory());
    expect(tickets.get('WXYZ')).toBeUndefined();
    tickets.put('WXYZ', 'seat-3');
    tickets.put('ABCD', 'seat-9');
    expect(tickets.get('WXYZ')).toBe('seat-3');
    expect(tickets.get('ABCD'), 'two rooms cannot collide').toBe('seat-9');
    tickets.clear('WXYZ');
    expect(tickets.get('WXYZ')).toBeUndefined();
    expect(tickets.get('ABCD'), 'clearing one leaves the other').toBe('seat-9');
  });

  it('survives storage that throws, because private browsing does', () => {
    // A match that dies on `localStorage` throwing is a worse outcome than one
    // whose reconnect is simply not offered.
    const hostile: TicketStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    const tickets = ticketsIn(hostile);
    expect(() => { tickets.put('WXYZ', 's'); }).not.toThrow();
    expect(tickets.get('WXYZ')).toBeUndefined();
    expect(() => { tickets.clear('WXYZ'); }).not.toThrow();
    expect(ticketsIn(undefined).get('WXYZ'), 'and no storage at all').toBeUndefined();
  });

  it('rides the join frame, and a fresh joiner sends none', () => {
    expect(frames.join('A', 'seat-3')).toMatchObject({ type: 'join', name: 'A', seatId: 'seat-3' });
    expect(frames.join('A')).not.toHaveProperty('seatId');
  });
});

describe('M3-RECONNECT: how hard to try', () => {
  it('backs off, and stops', () => {
    const delays = Array.from({ length: RECONNECT_ATTEMPTS }, (_, i) => reconnectDelayMs(i + 1));
    expect(delays.every((d) => d !== undefined)).toBe(true);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!, `attempt ${i + 1} waits longer`).toBeGreaterThan(delays[i - 1]!);
    }
    expect(reconnectDelayMs(RECONNECT_ATTEMPTS + 1), 'and then gives up').toBeUndefined();
    expect(reconnectDelayMs(0), 'attempts are 1-based').toBeUndefined();
  });

  it('needs a ticket and a dropped socket — never a refusal', () => {
    // The loop this guards: a refused join (full room, bad code) also closes the
    // socket, and retrying it is the same refusal forever.
    expect(shouldReconnect('closed', 'seat-3', 1)).toBe(true);
    expect(shouldReconnect('reconnecting', 'seat-3', 3)).toBe(true);
    expect(shouldReconnect('closed', undefined, 1), 'no seat to reclaim').toBe(false);
    expect(shouldReconnect('match', 'seat-3', 1), 'still connected').toBe(false);
    expect(shouldReconnect('lobby', 'seat-3', 1)).toBe(false);
    expect(shouldReconnect('closed', 'seat-3', RECONNECT_ATTEMPTS + 1), 'spent').toBe(false);
  });

  it('and the banner says which of the two is happening', () => {
    expect(connectionLabel('reconnecting')).toMatch(/reconnecting/i);
    expect(connectionLabel('reconnecting'), 'not an instruction to reload').not.toMatch(/reload/i);
    expect(connectionLabel('closed'), 'this one is').toMatch(/reload/i);
    for (const live of ['connecting', 'lobby', 'match'] as const) {
      expect(connectionLabel(live), live).toBeUndefined();
    }
  });
});

describe('M3-RECONNECT: the client outlives its socket', () => {
  it('attaching a new one says "reconnecting" and keeps everything else', () => {
    const { a } = started();
    const before: NetState = a.net;
    expect(before.phase).toBe('match');
    a.closed();
    expect(a.net.phase).toBe('closed');
    a.attach({ send: () => {}, close: () => {} });
    expect(a.net.phase).toBe('reconnecting');
    expect(a.net.seat, 'the seat is what the reclaim is for').toEqual(before.seat);
    expect(a.net.state, 'and the board is still on screen').toBe(before.state);
  });

  it('and sends down the new socket, not the dead one', () => {
    const dead: string[] = [];
    const live: string[] = [];
    const client = new RoomClient({ send: (d) => dead.push(d), close: () => {} });
    client.attach({ send: (d) => live.push(d), close: () => {} });
    client.join('A', 'seat-3');
    expect(dead, 'nothing down the closed socket').toHaveLength(0);
    expect(JSON.parse(live[0]!)).toMatchObject({ type: 'join', seatId: 'seat-3' });
  });
});

describe('M3-RECONNECT: end to end against a real room', () => {
  it('a dropped seat rejoins and receives its filtered state', () => {
    const { hub, a } = started();
    const seatId = a.net.seat!.seatId;
    const mine = [...a.net.unitIds];
    hub.close(seatId);
    a.closed();

    // A new socket, a new id from the runtime's point of view, and the ticket.
    const back = new RoomClient({ send: () => {}, close: () => {} });
    const wire = new Wire(back, hub, 'sock-9');
    back.attach(wire.sink());
    back.join('A', seatId);

    expect(back.net.phase, 'on a board again').toBe('match');
    expect(back.net.seat?.seatId, 'and in the seat it held').toBe(seatId);
    expect(back.net.unitIds, 'with the same characters').toEqual(mine);
    // M3-HIDDEN survives the reconnect: the resync is this team's view, not the
    // whole board.
    const owners = new Set(back.net.state!.units.map((u) => u.owner));
    expect([...owners]).toEqual([a.net.seat!.team]);
  });

  it('and can lock in again — the lock total counts it', () => {
    const { hub, a, b } = started();
    const seatId = a.net.seat!.seatId;
    hub.close(seatId);
    a.closed();

    const back = new RoomClient({ send: () => {}, close: () => {} });
    const wire = new Wire(back, hub, 'sock-9');
    back.attach(wire.sink());
    back.join('A', seatId);

    expect(b.net.enemyOf, 'the enemy is a whole seat again').toBe(1);
    back.submit([{ unitId: back.net.unitIds[0]!, movePath: [{ x: 2, y: 9 }] }]);
    expect(back.net.submitted).toBe(true);
    expect(b.net.enemyLocked).toBe(1);
  });

  it('a ticket the room will not honour comes back as a refusal, not a seat', () => {
    // What `main.ts` clears the stored ticket on — a client that kept it would
    // spend its whole retry budget being told the same thing.
    const { hub } = started();
    const lost = new RoomClient({ send: () => {}, close: () => {} });
    const wire = new Wire(lost, hub, 'sock-9');
    lost.attach(wire.sink());
    lost.join('Lost', 'seat-from-another-room');
    expect(lost.net.error?.code).toBe('unknownSeat');
    expect(lost.net.seat, 'and it was not seated anywhere else').toBeUndefined();
  });

  it('a seat somebody is still sitting in is refused by name', () => {
    const { hub, a } = started();
    const thief = new RoomClient({ send: () => {}, close: () => {} });
    const wire = new Wire(thief, hub, 'thief');
    thief.attach(wire.sink());
    thief.join('Thief', a.net.seat!.seatId);
    expect(thief.net.error?.code).toBe('seatTaken');
    expect(a.net.phase, 'and the sitting client is untouched').toBe('match');
  });

  it('the control map follows a teammate\'s absence, and comes back with them', () => {
    // The partial-team handoff, seen from the client: `unitIds` is re-read from
    // every Decision phase precisely so this is visible without a reload.
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    const clients: RoomClient[] = [];
    for (const id of ['s0', 's1', 's2', 's3']) {
      const client = new RoomClient({ send: () => {}, close: () => {} });
      const wire = new Wire(client, hub, id);
      client.attach(wire.sink());
      client.join(id);
      clients.push(client);
    }
    for (const [i, client] of clients.entries()) {
      client.pick([{ characterId: ['ash', 'bry', 'cyn', 'dex'][i]! }]);
    }
    clients[0]!.start();

    const gone = clients[3]!;
    const goneSeat = gone.net.seat!.seatId;
    const abandoned = [...gone.net.unitIds];
    const mate = clients.find((c) => c.net.seat!.team === gone.net.seat!.team && c !== gone)!;
    const mineBefore = [...mate.net.unitIds];

    hub.close(goneSeat);
    gone.closed();
    // One whole turn without them.
    for (const client of clients) {
      if (client === gone) continue;
      client.submit([]);
    }
    expect(mate.net.unitIds, 'the stand-in was told').toEqual([...mineBefore, ...abandoned]);

    const back = new RoomClient({ send: () => {}, close: () => {} });
    const wire = new Wire(back, hub, 'sock-9');
    back.attach(wire.sink());
    back.join('Back', goneSeat);
    expect(back.net.unitIds, 'and hands them straight back').toEqual(abandoned);
    expect(mate.net.unitIds).toEqual(mineBefore);
  });
});
