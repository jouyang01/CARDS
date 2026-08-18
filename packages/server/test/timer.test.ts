import { describe, expect, it } from 'vitest';
import { DECISION_SECONDS, TIMEBANK_CHARGES, TIMEBANK_SECONDS, type CharacterDef, type MapDef, type Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from '../src/protocol.js';
import { createRoom } from '../src/room.js';

/**
 * M3-TIMER — the decision clock, and the Time Bank.
 *
 * The clock is the **server's**: one deadline per turn, the same one for
 * everybody, and the thing that acts on it when it runs out. That is why it is
 * tested here rather than in the client — a countdown each browser ran for
 * itself would be four different deadlines, and a simultaneous turn cannot have
 * four moments at which it resolves.
 *
 * The hub takes its clock as an argument (`now`), exactly as it takes its map
 * and roster, so every test below drives time by assignment instead of by
 * sleeping. Nothing here waits for a real second to pass.
 *
 * The ruling under test is **missed → hold**: a seat that never submits does not
 * forfeit, and its characters do nothing. That needs no code of its own —
 * `mergeSeatOrders` already contributes nothing for a seat that is not in the
 * map — which is the property the last describe block pins down, because a
 * timeout that grew its own resolve path is exactly how the two would drift.
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
  get last(): ServerMessage | undefined { return this.sent.at(-1); }
  /** The most recent Decision payload — what this seat is currently looking at. */
  get decision(): Extract<ServerMessage, { type: 'decision' }> | undefined {
    return this.of('decision').at(-1);
  }
}

const JOIN = JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name: 'P' });
const START = JSON.stringify({ type: 'start' });
const EXTEND = JSON.stringify({ type: 'extend' });
const submit = (orders: unknown[] = []): string => JSON.stringify({ type: 'submit', orders });

/** A started 1v1 on a clock the test moves by hand. */
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

describe('M3-TIMER: the window is the server\'s', () => {
  it('a started match opens one, and both seats are told the same length', () => {
    const { hub, a, b } = started();
    expect(hub.room.state, 'the match is running').toBeDefined();
    expect(a.decision?.remainingMs).toBe(DECISION_SECONDS * 1000);
    expect(b.decision?.remainingMs, 'one deadline, not one per seat').toBe(a.decision?.remainingMs);
  });

  it('and it is sent as a duration, so no client has to model clock skew', () => {
    // The regression this guards: an absolute deadline in the *server's* epoch,
    // which a browser five seconds fast would render as five seconds short.
    const { hub, clock, a } = started();
    clock.t += 12_000;
    hub.receive('s0', submit());
    expect(a.decision?.remainingMs, 'what is left, not when it ends')
      .toBe(DECISION_SECONDS * 1000 - 12_000);
  });

  it('the window does not restart when a teammate locks in', () => {
    // `#sendDecision` runs again on every submission, so a plain assignment
    // there would hand the room a fresh 40 seconds each time somebody pressed
    // a button — a clock that can never run out.
    const clock = { t: 0 };
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), { ...config, teams: [[CHAR, CHAR], [CHAR, CHAR]] }, () => clock.t);
    const sockets: FakeSocket[] = [];
    for (const id of ['s0', 's1', 's2', 's3']) {
      const s = new FakeSocket();
      hub.open(id, s);
      hub.receive(id, JOIN);
      sockets.push(s);
    }
    hub.receive('s0', START);
    const opened = hub.deadline;
    clock.t += 5_000;
    hub.receive('s0', submit());
    expect(hub.deadline, 'still the same deadline').toBe(opened);
    expect(sockets[1]!.decision?.remainingMs).toBe(DECISION_SECONDS * 1000 - 5_000);
  });

  it('a resolved turn closes its window and the next one opens fresh', () => {
    const { hub, clock, a } = started();
    clock.t += 30_000;
    hub.receive('s0', submit());
    hub.receive('s1', submit());
    expect(hub.room.turn, 'the turn resolved').toBe(2);
    expect(a.decision?.remainingMs, 'a whole new window').toBe(DECISION_SECONDS * 1000);
  });
});

describe('M3-TIMER: expiry resolves the turn, and a missed seat holds', () => {
  it('a seat that never submits does not stop the turn resolving', () => {
    const { hub, clock } = started();
    hub.receive('s0', submit());
    expect(hub.room.turn, 'still waiting on s1').toBe(1);
    clock.t += DECISION_SECONDS * 1000;
    hub.expire();
    expect(hub.room.turn, 'the clock resolved it').toBe(2);
  });

  it('and its characters held — no orders, not a forfeit', () => {
    const { hub, clock, a, b } = started();
    const before = hub.room.state!.units.map((u) => ({ ...u.pos }));
    // s0 orders nothing either, so the only thing that could have moved a unit
    // is the timeout inventing an order — which is precisely what must not
    // happen.
    clock.t += DECISION_SECONDS * 1000;
    hub.expire();
    const after = hub.room.state!.units;
    expect(after.map((u) => u.pos)).toEqual(before);
    expect(after.every((u) => u.alive), 'nobody forfeited').toBe(true);
    // The reveal names only the seat that actually submitted — an empty one is
    // not the same as a submission of nothing.
    expect(a.of('turnResolved').at(-1)?.orders).toEqual({});
    expect(b.of('turnResolved').at(-1)?.orders).toEqual({});
  });

  it('a seat that did submit is honoured at expiry, the other still holds', () => {
    const { hub, clock } = started();
    const state = hub.room.state!;
    const mover = state.units.find((u) => u.owner === 0)!;
    const from = { ...mover.pos };
    hub.receive('s0', submit([{
      unitId: mover.unitId,
      movePath: [{ x: from.x + 1, y: from.y }, { x: from.x + 2, y: from.y }],
    }]));
    clock.t += DECISION_SECONDS * 1000;
    hub.expire();
    const after = hub.room.state!.units.find((u) => u.unitId === mover.unitId)!;
    expect(after.pos, 'the submitted order ran').not.toEqual(from);
    const held = hub.room.state!.units.find((u) => u.owner === 1)!;
    expect(held.pos, 'the silent seat held').toEqual({ x: 13, y: 7 });
  });

  it('an alarm that fires early does nothing — the window is still open', () => {
    const { hub, clock } = started();
    clock.t += DECISION_SECONDS * 1000 - 1;
    hub.expire();
    expect(hub.room.turn, 'a second still to think').toBe(1);
  });

  it('an alarm that fires after the turn already resolved does nothing', () => {
    // Idempotence, and the reason it matters: the runtime may deliver a stale
    // alarm, and a second `resolveNow` would burn a whole turn nobody played.
    const { hub, clock } = started();
    hub.receive('s0', submit());
    hub.receive('s1', submit());
    expect(hub.room.turn).toBe(2);
    const at = hub.room.turn;
    clock.t += 1_000; // long before the *new* window closes
    hub.expire();
    expect(hub.room.turn, 'nothing skipped').toBe(at);
  });

  it('expiry before a match has started is not a turn', () => {
    const clock = { t: 0 };
    const hub = new RoomHub(createRoom('WXYZ', '1v1'), config, () => clock.t);
    clock.t += 10_000_000;
    expect(() => { hub.expire(); }).not.toThrow();
    expect(hub.room.state).toBeUndefined();
  });

  it('a finished match has no window at all', () => {
    // Nothing left to decide, so nothing to count. A live deadline over a
    // finished match would keep re-arming the DO's alarm forever, and would put
    // a running countdown on the end screen.
    //
    // Spawns face each other inside the shot's range, so this is a handful of
    // turns of one seat shooting the other rather than a march across the board.
    const clock = { t: 0 };
    const CLOSE: MapDef = { ...OPEN, spawns: [[{ x: 6, y: 7 }], [{ x: 8, y: 7 }]] };
    const hub = new RoomHub(createRoom('WXYZ', '1v1'), { ...config, map: CLOSE }, () => clock.t);
    for (const id of ['s0', 's1']) {
      hub.open(id, new FakeSocket());
      hub.receive(id, JOIN);
    }
    hub.receive('s0', START);
    // 1v1's kill target is 3 and the character has 100 HP against a 20-damage
    // shot, so a bounded loop is plenty.
    for (let i = 0; i < 80 && hub.room.state!.status === 'active'; i++) {
      const shooter = hub.room.state!.units.find((u) => u.owner === 0)!;
      const target = hub.room.state!.units.find((u) => u.owner === 1)!;
      hub.receive('s0', target.alive
        ? submit([{ unitId: shooter.unitId, ability: { abilityId: 'shot', target: [{ ...target.pos }] } }])
        : submit());
      hub.receive('s1', submit());
      clock.t += 1_000;
    }
    expect(hub.room.state!.status, 'the match ended').not.toBe('active');
    expect(hub.deadline, 'no window over a finished match').toBeUndefined();
  });
});

describe('M3-TIMER: the Time Bank', () => {
  it('parses as a bare message — what a charge buys is the engine\'s constant', () => {
    expect(parseClientMessage(EXTEND)).toEqual({ type: 'extend' });
  });

  it('a seat starts with TIMEBANK_CHARGES and the Decision payload says so', () => {
    const { hub, a } = started();
    expect(hub.chargesFor('s0')).toBe(TIMEBANK_CHARGES);
    expect(a.decision?.bank).toBe(TIMEBANK_CHARGES);
  });

  it('spending one pushes the deadline out by TIMEBANK_SECONDS — added, not reset', () => {
    // Banking at 8 seconds must leave 18, not 40: the bank *extends* a window.
    const { hub, clock, a } = started();
    clock.t += 32_000;
    hub.receive('s0', EXTEND);
    expect(a.decision?.remainingMs).toBe(8_000 + TIMEBANK_SECONDS * 1000);
    expect(a.decision?.bank, 'and the charge is gone').toBe(TIMEBANK_CHARGES - 1);
  });

  it('and the extension is the whole room\'s, because the turn is', () => {
    // One deadline governs one turn. A per-seat extension would give a
    // simultaneous turn two different moments at which it resolved.
    const { hub, clock, b } = started();
    clock.t += 30_000;
    hub.receive('s0', EXTEND);
    expect(b.decision?.remainingMs, 'the opponent got the time too')
      .toBe(10_000 + TIMEBANK_SECONDS * 1000);
    expect(b.decision?.bank, 'but not the charge — it is per seat').toBe(TIMEBANK_CHARGES);
  });

  it('a second extension is refused, and costs nothing', () => {
    const { hub, a } = started();
    hub.receive('s0', EXTEND);
    const after = hub.deadline;
    hub.receive('s0', EXTEND);
    expect(a.last).toEqual({ type: 'error', code: 'noBank', message: 'no Time Bank charge left' });
    expect(hub.deadline, 'the refused ask moved nothing').toBe(after);
    expect(hub.chargesFor('s0'), 'and burnt nothing').toBe(0);
  });

  it('the extended window is what expiry then honours', () => {
    // The claim the whole feature rests on: the bank does not just redraw a
    // number, it moves the moment the server resolves.
    const { hub, clock } = started();
    hub.receive('s0', EXTEND);
    clock.t += DECISION_SECONDS * 1000;
    hub.expire();
    expect(hub.room.turn, 'the original deadline no longer applies').toBe(1);
    clock.t += TIMEBANK_SECONDS * 1000;
    hub.expire();
    expect(hub.room.turn, 'the extended one does').toBe(2);
  });

  it('the charge is per match, not per turn', () => {
    const { hub, clock } = started();
    hub.receive('s0', EXTEND);
    hub.receive('s0', submit());
    hub.receive('s1', submit());
    expect(hub.room.turn).toBe(2);
    expect(hub.chargesFor('s0'), 'a new turn does not refill it').toBe(0);
    const before = hub.deadline;
    clock.t += 100;
    hub.receive('s0', EXTEND);
    expect(hub.deadline, 'and cannot be spent again').toBe(before);
  });

  it('extending before the match, or without a seat, is refused rather than banked', () => {
    const clock = { t: 0 };
    const hub = new RoomHub(createRoom('WXYZ', '1v1'), config, () => clock.t);
    const s = new FakeSocket();
    hub.open('s0', s);
    hub.receive('s0', EXTEND);
    expect(s.last, 'a socket that never joined is not in the room')
      .toEqual({ type: 'error', code: 'notJoined', message: 'send a join message first' });
    hub.receive('s0', JOIN);
    hub.receive('s0', EXTEND);
    expect(s.last?.type).toBe('error');
    expect((s.last as { code?: string }).code, 'no match, no window').toBe('noMatch');
    expect(hub.chargesFor('s0'), 'and no charge spent on either refusal').toBe(TIMEBANK_CHARGES);
  });
});
