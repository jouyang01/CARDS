import { describe, expect, it } from 'vitest';
import { DECISION_SECONDS, type CharacterDef, type MapDef, type Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import {
  clearSubmissions, createRoom, detachAll, hasSubmitted, submissionsOf, withSubmission,
  withoutSubmission, type Room,
} from '../src/room.js';

/**
 * SUBMISSIONS-PERSIST — the turn survives an eviction, not just the clock.
 *
 * TIMER-PERSIST moved the deadline and the Time Bank onto the `Room` record.
 * This is the third thing that lived only in memory, and the one a player would
 * actually notice losing: a Durable Object evicted mid-turn came back with the
 * right window over a room where every seat read **unlocked** and had to decide
 * the whole turn again. The plan *is* the turn.
 *
 * Same shape of fix, and deliberately so: the record is the single copy, the DO
 * writes it after every frame, and rehydration is the constructor. What is new
 * here is that the value is nested — orders, not a number — so the JSON
 * round-trip is doing real work rather than only proving a `Map` was not used.
 *
 * Eviction is modelled the way `timer-persist.test.ts` models it, and for the
 * same reason: doing what the runtime does is the only honest simulation of it.
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
const config: MatchConfig = { map: OPEN, roster, teams: [[CHAR, CHAR], [CHAR, CHAR]] };

class FakeSocket implements Sink {
  readonly sent: ServerMessage[] = [];
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage); }
  close(): void {}
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
  get last(): ServerMessage | undefined { return this.sent.at(-1); }
  get decision(): Extract<ServerMessage, { type: 'decision' }> | undefined {
    return this.of('decision').at(-1);
  }
}

const JOIN = JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name: 'P' });
const RECLAIM = (seatId: string): string =>
  JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name: 'P', seatId });
const START = JSON.stringify({ type: 'start' });
const submit = (orders: unknown[] = []): string => JSON.stringify({ type: 'submit', orders });

/** A started 2v2 (four seats) on a clock the test drives. */
const started = () => {
  const clock = { t: 1_000_000 };
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config, () => clock.t);
  const sockets: Record<string, FakeSocket> = {};
  for (const id of ['s0', 's1', 's2', 's3']) {
    const s = new FakeSocket();
    sockets[id] = s;
    hub.open(id, s);
    hub.receive(id, JOIN);
  }
  hub.receive('s0', START);
  return { hub, clock, sockets };
};

/** The Durable Object's restore: through storage as JSON, and no live sockets. */
const evict = (hub: RoomHub, clock: { t: number }) => {
  const stored = JSON.parse(JSON.stringify(hub.room)) as Room;
  return { woken: new RoomHub(detachAll(stored), config, () => clock.t) };
};

/** The first character seat `seatId` controls, and a legal one-step move for it. */
const stepFor = (hub: RoomHub, seatId: string) => {
  const unitId = hub.room.seats.find((s) => s.seatId === seatId)!.unitIds[0]!;
  const from = hub.room.state!.units.find((u) => u.unitId === unitId)!.pos;
  return { unitId, to: { x: from.x + 1, y: from.y } };
};

describe('SUBMISSIONS-PERSIST: the plan is on the record', () => {
  it('a lock-in writes it where storage already looks', () => {
    const { hub } = started();
    const { unitId, to } = stepFor(hub, 's0');
    hub.receive('s0', submit([{ unitId, movePath: [to] }]));
    expect(hub.room.submissions?.['s0']).toEqual([{ unitId, movePath: [to] }]);
    expect(hub.locked, 'and the lock list agrees').toEqual(['s0']);
  });

  it('and it round-trips through JSON with the orders intact', () => {
    // The nested value is what is new here: a number surviving storage proves
    // little, an order with a path in it proves the shape.
    const { hub } = started();
    const { unitId, to } = stepFor(hub, 's0');
    hub.receive('s0', submit([{ unitId, movePath: [to] }]));
    const stored = JSON.parse(JSON.stringify(hub.room)) as Room;
    expect(stored.submissions).toEqual(hub.room.submissions);
    expect(stored.submissions?.['s0']?.[0]?.movePath).toEqual([to]);
  });

  it('a room with nothing submitted has NO key, not an empty object', () => {
    // Same rule as the closed decision window: `{}` and absent round-trip the
    // same way and only one of them is the shape a fresh room has.
    const fresh = createRoom('WXYZ', '2v2');
    expect('submissions' in fresh).toBe(false);
    const one = withSubmission(fresh, 's0', [{ unitId: 'u1' }]);
    expect(one.submissions).toEqual({ s0: [{ unitId: 'u1' }] });
    expect('submissions' in clearSubmissions(one), 'and the turn ending removes it').toBe(false);
    expect(clearSubmissions(fresh), 'clearing nothing changes nothing').toBe(fresh);
  });

  it('the helpers are the whole vocabulary, and none of them mutate', () => {
    const room = createRoom('WXYZ', '2v2');
    const a = withSubmission(room, 's0', [{ unitId: 'u1' }]);
    const b = withSubmission(a, 's1', [{ unitId: 'u2' }]);
    expect(room.submissions, 'the room handed in is untouched').toBeUndefined();
    expect(hasSubmitted(b, 's0')).toBe(true);
    expect(hasSubmitted(b, 's2')).toBe(false);
    expect([...submissionsOf(b).keys()]).toEqual(['s0', 's1']);
    expect(hasSubmitted(withoutSubmission(b, 's0'), 's0')).toBe(false);
    expect(hasSubmitted(withoutSubmission(b, 's0'), 's1'), 'and only that one').toBe(true);
    expect(withoutSubmission(b, 'nobody'), 'dropping a seat that never submitted is a no-op').toBe(b);
  });

  it('the stored orders are a copy — a caller cannot edit a locked plan', () => {
    const orders = [{ unitId: 'u1', movePath: [{ x: 1, y: 1 }] }];
    const room = withSubmission(createRoom('WXYZ', '2v2'), 's0', orders);
    orders[0]!.unitId = 'somebody-else';
    expect(room.submissions?.['s0']?.[0]?.unitId).toBe('u1');
  });
});

describe('SUBMISSIONS-PERSIST: a DO evicted mid-turn resumes a locked seat', () => {
  it('the seat is still locked, with the orders it sent', () => {
    const { hub, clock } = started();
    const { unitId, to } = stepFor(hub, 's0');
    hub.receive('s0', submit([{ unitId, movePath: [to] }]));

    const { woken } = evict(hub, clock);
    expect(woken.locked, 'still locked in').toEqual(['s0']);
    expect(woken.room.submissions?.['s0']).toEqual([{ unitId, movePath: [to] }]);
  });

  it('and re-locking is refused, so nobody plans the same turn twice', () => {
    // Before this, an evicted DO forgot the lock and cheerfully took a second
    // submission — the seat would decide the turn again, from a board it had
    // already committed against.
    const { hub, clock } = started();
    hub.receive('s0', submit());
    const { woken } = evict(hub, clock);

    const back = new FakeSocket();
    woken.open('sock-9', back);
    woken.receive('sock-9', RECLAIM('s0'));
    woken.receive('sock-9', submit());
    expect(back.of('error').at(-1)?.code).toBe('alreadyLocked');
  });

  it('the returning seat is TOLD it is locked, and gets its own orders back', () => {
    // The resync has to say so, or a client that reconnected would draw an armed
    // board over a turn it has already committed.
    const { hub, clock } = started();
    const { unitId, to } = stepFor(hub, 's0');
    hub.receive('s0', submit([{ unitId, movePath: [to] }]));
    const { woken } = evict(hub, clock);

    const back = new FakeSocket();
    woken.open('sock-9', back);
    woken.receive('sock-9', RECLAIM('s0'));
    const decision = back.decision!;
    expect(decision.locked, 'the server names us').toContain('s0');
    expect(decision.orders['s0'], 'and hands back what we sent').toEqual([{ unitId, movePath: [to] }]);
  });

  it('the orders it left behind are what actually resolve', () => {
    // The claim the whole item rests on: a persisted submission is not just a
    // flag that says "locked", it is the plan the engine runs.
    const { hub, clock } = started();
    const { unitId, to } = stepFor(hub, 's0');
    hub.receive('s0', submit([{ unitId, movePath: [to] }]));
    const { woken } = evict(hub, clock);

    clock.t += DECISION_SECONDS * 1000;
    woken.expire();
    expect(woken.room.turn, 'the clock resolved it').toBe(2);
    expect(woken.room.state!.units.find((u) => u.unitId === unitId)?.pos, 'the move ran').toEqual(to);
  });

  it('an eviction after every seat locked leaves a resolved turn, not a stuck one', () => {
    // Four locks resolve the turn *before* the eviction, so the record that
    // reaches storage carries a fresh empty turn. Stated because the opposite
    // — persisting a full set of submissions the resolve had already spent —
    // would replay them into the next turn.
    const { hub, clock } = started();
    for (const id of ['s0', 's1', 's2', 's3']) hub.receive(id, submit());
    expect(hub.room.turn).toBe(2);
    expect(hub.room.submissions, 'the spent plans are gone').toBeUndefined();
    const { woken } = evict(hub, clock);
    expect(woken.locked, 'and the woken room is deciding afresh').toEqual([]);
  });

  it('a partially-locked room keeps counting only the seats that answered', () => {
    const { hub, clock } = started();
    hub.receive('s0', submit());
    hub.receive('s2', submit());
    const { woken } = evict(hub, clock);
    expect(woken.locked).toEqual(['s0', 's2']);
    expect(woken.room.turn, 'two of four is not a turn').toBe(1);
  });

  it('the deadline, the bank and the plans all come back together', () => {
    // The three persisted facts are one story: the turn you were in the middle
    // of. Asserted together so a future change cannot quietly restore two.
    const { hub, clock } = started();
    clock.t += 30_000;
    hub.receive('s0', JSON.stringify({ type: 'extend' }));
    hub.receive('s0', submit());
    const deadline = hub.deadline;

    const { woken } = evict(hub, clock);
    expect(woken.deadline).toBe(deadline);
    expect(woken.chargesFor('s0')).toBe(0);
    expect(woken.locked).toEqual(['s0']);
  });
});

describe('SUBMISSIONS-PERSIST: nothing about the live turn changed', () => {
  it('the last lock-in still resolves the turn', () => {
    const { hub, sockets } = started();
    for (const id of ['s0', 's1', 's2']) hub.receive(id, submit());
    expect(hub.room.turn).toBe(1);
    hub.receive('s3', submit());
    expect(hub.room.turn).toBe(2);
    expect(sockets['s0']!.of('turnResolved')).toHaveLength(1);
  });

  it('the reveal still carries both teams, and the next turn is a fresh secret', () => {
    const { hub, sockets } = started();
    for (const id of ['s0', 's1', 's2', 's3']) hub.receive(id, submit());
    expect(Object.keys(sockets['s0']!.of('turnResolved').at(-1)!.orders).sort())
      .toEqual(['s0', 's1', 's2', 's3']);
    expect(sockets['s0']!.decision?.orders, 'and the new turn starts empty').toEqual({});
    expect(hub.locked).toEqual([]);
  });

  it('a LOBBY seat that leaves still takes its submission with it', () => {
    // The one place `withoutSubmission` is called. A lobby seat is nothing but a
    // socket, so nothing about it is held.
    const lobby = new RoomHub(createRoom('WXYZ', '2v2'), config);
    for (const id of ['a', 'b']) { lobby.open(id, new FakeSocket()); lobby.receive(id, JOIN); }
    expect(lobby.room.seats).toHaveLength(2);
    lobby.close('a');
    expect(lobby.room.seats).toHaveLength(1);
    expect(hasSubmitted(lobby.room, 'a')).toBe(false);
  });

  it('a MATCH seat that drops keeps the plan it already sent (M3-RECONNECT)', () => {
    const { hub } = started();
    hub.receive('s3', submit());
    hub.close('s3');
    expect(hub.locked, 'the answer stands').toContain('s3');
    expect(hub.room.submissions?.['s3']).toEqual([]);
  });
});
