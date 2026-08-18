import { describe, expect, it } from 'vitest';
import { DECISION_SECONDS, TIMEBANK_CHARGES, TIMEBANK_SECONDS, type CharacterDef, type MapDef, type Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { chargesFor, createRoom, detachAll, spendCharge, withDeadline, type Room } from '../src/room.js';

/**
 * TIMER-PERSIST — the decision window survives the Durable Object being evicted.
 *
 * A DO is reclaimed whenever the runtime feels like it, which locally is almost
 * never and in production is routine. Before this, `#deadline` and the Time Bank
 * charges were private fields: a room that came back from storage had a match, a
 * board and four seats, and **no open window** — so the turn waited for players
 * rather than for the clock, and everybody's bank was full again.
 *
 * The fix is not a save step, it is a **location**: both live on the `Room`
 * record, which the DO already writes after every frame. So "persisted" is done
 * by code that was already there, and a hub built from storage is rehydrated by
 * its constructor with nothing to remember.
 *
 * Eviction is modelled here the way the rest of this suite models the runtime —
 * by doing what the runtime does. `new RoomHub(JSON.parse(JSON.stringify(...)))`
 * is exactly a DO restart: the record round-trips through storage and every
 * in-memory field is gone. The JSON round-trip is deliberate rather than
 * decorative; it is what catches a field that is a `Map`.
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
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage); }
  close(): void {}
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
  get decision(): Extract<ServerMessage, { type: 'decision' }> | undefined {
    return this.of('decision').at(-1);
  }
}

const JOIN = JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name: 'P' });
const START = JSON.stringify({ type: 'start' });
const EXTEND = JSON.stringify({ type: 'extend' });
const submit = (orders: unknown[] = []): string => JSON.stringify({ type: 'submit', orders });
/** M3-RECONNECT's handshake: a join carrying the seat this client held. */
const RECLAIM = (seatId: string): string =>
  JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name: 'P', seatId });

/** A started 1v1 on a clock the test drives. */
const started = () => {
  const clock = { t: 1_000_000 };
  const hub = new RoomHub(createRoom('WXYZ', '1v1'), config, () => clock.t);
  const sockets: FakeSocket[] = [];
  for (const id of ['s0', 's1']) {
    const s = new FakeSocket();
    hub.open(id, s);
    hub.receive(id, JOIN);
    sockets.push(s);
  }
  hub.receive('s0', START);
  return { hub, clock, a: sockets[0]!, b: sockets[1]! };
};

/**
 * What the Durable Object does when it is evicted and asked for again: the
 * record goes to storage as JSON and a fresh hub is built from what comes back.
 * Everything not on the record is gone, which is the point.
 */
const evict = (hub: RoomHub, clock: { t: number }) => {
  const stored = JSON.parse(JSON.stringify(hub.room)) as Room;
  // `detachAll` is the DO's own restore step: the sockets did not survive, so no
  // seat is attached to anything. Applied here for the same reason it is applied
  // there — a record that still claimed everyone was present would refuse every
  // returning player's ticket as `seatTaken`.
  return { woken: new RoomHub(detachAll(stored), config, () => clock.t) };
};

describe('TIMER-PERSIST: the window is on the record', () => {
  it('a started match writes its deadline where the DO already saves', () => {
    const { hub, clock } = started();
    expect(hub.room.deadline, 'and it is the absolute the alarm is set in')
      .toBe(clock.t + DECISION_SECONDS * 1000);
    expect(hub.deadline, 'the getter reads the record, not a field').toBe(hub.room.deadline);
  });

  it('and it round-trips through JSON, because storage does', () => {
    // The failure this rules out is a `Map` or a `Date`: both look fine in
    // memory and come back as `{}` from storage.
    const { hub } = started();
    const stored = JSON.parse(JSON.stringify(hub.room)) as Room;
    expect(stored.deadline).toBe(hub.deadline);
    expect(typeof stored.deadline).toBe('number');
  });

  it('a closed window is the ABSENCE of the key, not a key set to undefined', () => {
    // `{ deadline: undefined }` survives a JSON round-trip as no key at all, so
    // the two would agree by accident here and disagree under
    // `exactOptionalPropertyTypes` everywhere else. Stated so it stays true.
    const closed = withDeadline(createRoom('WXYZ', '1v1'), undefined);
    expect('deadline' in closed).toBe(false);
    const opened = withDeadline(closed, 5_000);
    expect(opened.deadline).toBe(5_000);
    expect('deadline' in withDeadline(opened, undefined)).toBe(false);
  });

  it('the charge count is a plain object, and defaults without an entry', () => {
    const room = createRoom('WXYZ', '1v1');
    expect(room.bank, 'nobody has spent one').toBeUndefined();
    expect(chargesFor(room, 's0')).toBe(TIMEBANK_CHARGES);
    const spent = spendCharge(room, 's0');
    expect(spent.bank).toEqual({ s0: TIMEBANK_CHARGES - 1 });
    expect(chargesFor(spent, 's1'), 'and only for the seat that spent it').toBe(TIMEBANK_CHARGES);
    expect(spendCharge(spent, 's0').bank, 'a spent bank cannot go negative').toEqual({ s0: 0 });
  });
});

describe('TIMER-PERSIST: a DO that reloads mid-decision resumes the same window', () => {
  it('the deadline is unchanged across an eviction', () => {
    const { hub, clock } = started();
    clock.t += 12_000;
    hub.receive('s0', submit());
    const before = hub.deadline;

    const { woken } = evict(hub, clock);
    expect(woken.deadline, 'the same instant, not a fresh 40 seconds').toBe(before);
    expect(woken.room.turn, 'and the same turn').toBe(hub.room.turn);
  });

  it('and the charges are unchanged too', () => {
    const { hub, clock } = started();
    clock.t += 30_000;
    hub.receive('s0', EXTEND);
    expect(hub.chargesFor('s0')).toBe(TIMEBANK_CHARGES - 1);

    const { woken } = evict(hub, clock);
    expect(woken.chargesFor('s0'), 'a spent bank stays spent').toBe(TIMEBANK_CHARGES - 1);
    expect(woken.chargesFor('s1'), 'and an unspent one stays unspent').toBe(TIMEBANK_CHARGES);
  });

  it('the woken room expires on the ORIGINAL deadline, not on a new one', () => {
    // The bug in one line: before this, a woken DO had no window, so the turn
    // sat there until somebody pressed a button.
    const { hub, clock } = started();
    clock.t += 39_000;
    const { woken } = evict(hub, clock);
    expect(woken.room.turn).toBe(1);

    woken.expire();
    expect(woken.room.turn, 'a second still to think').toBe(1);
    clock.t += 1_000;
    woken.expire();
    expect(woken.room.turn, 'and the original deadline is what fires').toBe(2);
  });

  it('an extension taken before the eviction is still in force after it', () => {
    // The two persisted facts together: the charge is gone AND the ten seconds
    // it bought are still on the clock.
    const { hub, clock } = started();
    hub.receive('s0', EXTEND);
    const { woken } = evict(hub, clock);

    clock.t += DECISION_SECONDS * 1000;
    woken.expire();
    expect(woken.room.turn, 'the un-extended deadline no longer applies').toBe(1);
    clock.t += TIMEBANK_SECONDS * 1000;
    woken.expire();
    expect(woken.room.turn, 'the extended one does').toBe(2);
    expect(woken.chargesFor('s0'), 'and it cannot be spent twice across a restart').toBe(0);
  });

  it('a seat cannot refill its bank by getting the room evicted', () => {
    const { hub, clock } = started();
    hub.receive('s0', EXTEND);
    const { woken } = evict(hub, clock);

    // The player comes back the way M3-RECONNECT says: a new socket presenting
    // the seat it held.
    const back = new FakeSocket();
    woken.open('sock-9', back);
    woken.receive('sock-9', RECLAIM('s0'));
    expect(back.of('matchStarted'), 'the reclaim landed').toHaveLength(1);

    woken.receive('sock-9', EXTEND);
    expect(back.of('error').at(-1)?.code, 'refused, exactly as before the restart').toBe('noBank');
  });

  it('and the restore is what lets that reclaim happen at all', () => {
    // The bug the restore closes: the record comes back saying every seat is
    // still connected, because nobody ran `close` — the DO holding the sockets
    // simply stopped existing. A returning player would then be told the seat
    // they are sitting in is taken, by themselves.
    const { hub, clock } = started();
    const naive = new RoomHub(JSON.parse(JSON.stringify(hub.room)) as Room, config, () => clock.t);
    expect(naive.room.seats.every((s) => s.connected), 'the raw record still says present').toBe(true);
    const refused = new FakeSocket();
    naive.open('sock-9', refused);
    naive.receive('sock-9', RECLAIM('s0'));
    expect(refused.of('error').at(-1)?.code, 'which is exactly the bug').toBe('seatTaken');

    const { woken } = evict(hub, clock);
    expect(woken.room.seats.every((s) => !s.connected), 'no socket survived, so no seat is attached')
      .toBe(true);
    const ok = new FakeSocket();
    woken.open('sock-9', ok);
    woken.receive('sock-9', RECLAIM('s0'));
    expect(ok.of('error'), 'and the ticket is honoured').toHaveLength(0);
    expect(woken.room.seats.find((s) => s.seatId === 's0')?.connected).toBe(true);
  });

  it('a room with no match carries no window to rehydrate', () => {
    const clock = { t: 7 };
    const hub = new RoomHub(createRoom('WXYZ', '1v1'), config, () => clock.t);
    expect(hub.room.deadline).toBeUndefined();
    const { woken } = evict(hub, clock);
    expect(woken.deadline, 'nothing to arm an alarm at').toBeUndefined();
  });

  it('a finished match leaves no window on the record either', () => {
    // Otherwise a woken DO would re-arm an alarm over a match that is over.
    const clock = { t: 0 };
    const CLOSE: MapDef = { ...OPEN, spawns: [[{ x: 6, y: 7 }], [{ x: 8, y: 7 }]] };
    const hub = new RoomHub(createRoom('WXYZ', '1v1'), { ...config, map: CLOSE }, () => clock.t);
    for (const id of ['s0', 's1']) { hub.open(id, new FakeSocket()); hub.receive(id, JOIN); }
    hub.receive('s0', START);
    for (let i = 0; i < 80 && hub.room.state!.status === 'active'; i++) {
      const shooter = hub.room.state!.units.find((u) => u.owner === 0)!;
      const target = hub.room.state!.units.find((u) => u.owner === 1)!;
      hub.receive('s0', target.alive
        ? submit([{ unitId: shooter.unitId, ability: { abilityId: 'shot', target: [{ ...target.pos }] } }])
        : submit());
      hub.receive('s1', submit());
      clock.t += 1_000;
    }
    expect(hub.room.state!.status).not.toBe('active');
    const { woken } = evict(hub, clock);
    expect(woken.deadline).toBeUndefined();
  });
});

describe('TIMER-PERSIST: the live behaviour is unchanged', () => {
  it('the window still does not restart when a teammate locks in', () => {
    const clock = { t: 0 };
    const hub = new RoomHub(
      createRoom('WXYZ', '2v2'), { ...config, teams: [[CHAR, CHAR], [CHAR, CHAR]] }, () => clock.t,
    );
    const sockets: FakeSocket[] = [];
    for (const id of ['s0', 's1', 's2', 's3']) {
      const s = new FakeSocket();
      sockets.push(s);
      hub.open(id, s);
      hub.receive(id, JOIN);
    }
    hub.receive('s0', START);
    const opened = hub.deadline;
    clock.t += 5_000;
    hub.receive('s0', submit());
    expect(hub.deadline).toBe(opened);
    expect(sockets[1]!.decision?.remainingMs).toBe(DECISION_SECONDS * 1000 - 5_000);
  });

  it('and a resolved turn still opens a fresh one', () => {
    const { hub, clock, a } = started();
    clock.t += 30_000;
    hub.receive('s0', submit());
    hub.receive('s1', submit());
    expect(hub.deadline).toBe(clock.t + DECISION_SECONDS * 1000);
    expect(a.decision?.remainingMs).toBe(DECISION_SECONDS * 1000);
  });
});
