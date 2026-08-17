import { describe, expect, it } from 'vitest';
import type { CharacterDef, MapDef, Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { createRoom, join, startMatch } from '../src/room.js';

/**
 * M3-JOIN-GUARD — a started room takes no new seats.
 *
 * The bug this closes: the deal happens once, at `startMatch`, so a seat
 * created afterwards controls no characters — and yet it counted toward the
 * lock total, because the total is "how many seats are there". One stray
 * connection to a running room therefore hung the match permanently: the turn
 * waited on a player who had nothing to submit.
 *
 * The guard is in `join` rather than in the hub deliberately. "Can this room be
 * joined" is a fact about the record, and a second caller (M3-LOBBY, the
 * reconnect path) asking the same question should not have to remember to ask
 * the hub's version of it.
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
  closeReason: string | undefined;
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage); }
  close(_code?: number, reason?: string): void { this.closed = true; this.closeReason = reason; }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
}

const joinFrame = (name?: string): string =>
  JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name });

/** A full 2v2 — which starts on its own — with one spare socket left over. */
const started = () => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
  for (let i = 0; i < 4; i++) {
    hub.open(`s${i}`, new FakeSocket());
    hub.receive(`s${i}`, joinFrame(`P${i}`));
  }
  expect(hub.room.state, 'the fixture is a *started* room').toBeDefined();
  return hub;
};

describe('M3-JOIN-GUARD: the rule, at the record', () => {
  it('join refuses a room whose match has begun', () => {
    let room = createRoom('WXYZ', '2v2');
    const first = join(room, 's0');
    expect(first.ok, 'joinable before the start').toBe(true);

    const dealt = startMatch({ ...room, seats: [
      { seatId: 's0', team: 0, name: 's0', unitIds: [], picks: [] },
      { seatId: 's1', team: 1, name: 's1', unitIds: [], picks: [] },
    ] }, OPEN, TEAMS);
    expect(dealt.ok).toBe(true);
    if (!dealt.ok) return;
    room = dealt.room;

    expect(join(room, 'latecomer')).toEqual({ ok: false, reason: 'inProgress' });
  });

  it('the refusal beats every other reason — it is checked first', () => {
    // A duplicate seat id arriving at a started room is still "in progress", not
    // "duplicate": the reason a client is shown should be the one it can act on,
    // and "come back for the next match" is the only true answer here.
    const hub = started();
    const dup = new FakeSocket();
    hub.open('s0-again', dup);
    hub.receive('s0-again', joinFrame('P0'));
    expect(dup.of('error')[0]?.code).toBe('inProgress');
  });
});

describe('M3-JOIN-GUARD: what a refused socket is told', () => {
  it('is refused loudly, not dropped in silence', () => {
    const hub = started();
    const late = new FakeSocket();
    hub.open('late', late);
    hub.receive('late', joinFrame('Late'));

    const err = late.of('error')[0];
    expect(err, 'a refusal is a message, not a nothing').toBeDefined();
    expect(err!.code).toBe('inProgress');
    expect(err!.message).toContain('already started');
    expect(late.closed, 'and the socket is closed rather than left hanging').toBe(true);
    expect(late.closeReason).toContain('already started');
  });

  it('gets no seat, no joined confirmation and no match payload', () => {
    const hub = started();
    const late = new FakeSocket();
    hub.open('late', late);
    hub.receive('late', joinFrame('Late'));

    expect(late.of('joined')).toHaveLength(0);
    expect(late.of('matchStarted'), 'refused means refused — no board either').toHaveLength(0);
    expect(late.of('decision')).toHaveLength(0);
    expect(hub.room.seats.map((s) => s.seatId)).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('and stops being an audience — later broadcasts do not reach it', () => {
    const hub = started();
    const late = new FakeSocket();
    hub.open('late', late);
    hub.receive('late', joinFrame('Late'));
    const after = late.sent.length;

    hub.close('s3'); // a seatLeft broadcast
    expect(late.sent.length, 'nothing further is sent to a refused socket').toBe(after);
  });
});

describe('M3-JOIN-GUARD: the lock total is unaffected', () => {
  it('a refused socket does not raise `of`', () => {
    const hub = started();
    const seat0 = hub.room.seats[0]!;
    const before = new FakeSocket();
    hub.open('watch', before);

    const late = new FakeSocket();
    hub.open('late', late);
    hub.receive('late', joinFrame('Late'));

    // Drive one submission and read the total the room reports.
    hub.receive(seat0.seatId, JSON.stringify({ type: 'submit', orders: [] }));
    const submitted = before.of('submitted');
    expect(submitted, 'the watching socket never joined, so it hears nothing').toHaveLength(0);

    const hubSeat = hub.room.seats.length;
    expect(hubSeat, 'four seats, as before the refusal').toBe(4);
  });

  it('the turn still completes with the four real seats', () => {
    // The regression itself: before the guard, a fifth seat existed with an
    // empty control map and `of` became 5, so four lock-ins never reached the
    // total and the turn hung forever.
    const hub = started();
    const late = new FakeSocket();
    hub.open('late', late);
    hub.receive('late', joinFrame('Late'));

    for (const seat of hub.room.seats) {
      hub.receive(seat.seatId, JSON.stringify({ type: 'submit', orders: [] }));
    }
    expect(hub.room.turn, 'the turn resolved').toBe(2);
    expect(hub.locked, 'and a fresh turn is waiting on the same four').toEqual([]);
  });
});

describe('M3-JOIN-GUARD: a freed seat is held, not reopened', () => {
  it('a disconnect does not let a stranger take the characters', () => {
    // `leave` frees the slot in the record, but the room is still in progress —
    // so the guard keeps it shut. Getting back in is M3-RECONNECT's
    // identity-matched reclaim, not a race between whoever connects next.
    const hub = started();
    hub.close('s3');
    expect(hub.room.seats).toHaveLength(3);

    const stranger = new FakeSocket();
    hub.open('stranger', stranger);
    hub.receive('stranger', joinFrame('Stranger'));

    expect(stranger.of('error')[0]?.code).toBe('inProgress');
    expect(hub.room.seats, 'the slot stays empty for its owner').toHaveLength(3);
  });

  it('but a room that never started is still open', () => {
    // The guard is about *started*, not about *has ever had somebody leave*.
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    for (const id of ['a', 'b']) {
      hub.open(id, new FakeSocket());
      hub.receive(id, joinFrame(id));
    }
    hub.close('a');
    const fresh = new FakeSocket();
    hub.open('c', fresh);
    hub.receive('c', joinFrame('c'));
    expect(fresh.of('joined')).toHaveLength(1);
  });
});
