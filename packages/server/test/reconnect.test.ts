import { describe, expect, it } from 'vitest';
import type { CharacterDef, MapDef, Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from '../src/protocol.js';
import { controlledUnits, createRoom, leave, reclaim } from '../src/room.js';

/**
 * M3-RECONNECT — coming back to a match you were already in.
 *
 * Three separable things, and the file is laid out as three:
 *
 * 1. **The seat is held.** A disconnect in a *lobby* deletes the seat, because a
 *    lobby seat is nothing but a socket. A disconnect in a *match* does not: the
 *    seat carries a team, a name and a control map the match still needs, and
 *    the ruling reserves it for its original occupant.
 * 2. **The reclaim is identity-matched.** Coming back means naming the seat you
 *    held. A stranger who guessed the room code still cannot get in, because
 *    `join` turns away every fresh socket to a started match and a ticket is the
 *    only other door.
 * 3. **The partial-team handoff**, the last OPEN in "Teams & control", decided
 *    here: after **one fully missed turn** a disconnected seat's characters pass
 *    to a connected teammate, and pass straight back when it returns. Derived
 *    rather than transferred, which is what makes the return free.
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
  closed: { code?: number; reason?: string } | undefined;
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage); }
  close(code?: number, reason?: string): void { this.closed = { code, reason }; }
  get last(): ServerMessage | undefined { return this.sent.at(-1); }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
  get decision(): Extract<ServerMessage, { type: 'decision' }> | undefined {
    return this.of('decision').at(-1);
  }
}

const joinFrame = (name?: string, seatId?: string): string =>
  JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name, seatId });
const submit = (orders: unknown[] = []): string => JSON.stringify({ type: 'submit', orders });

/** A running 2v2 with four seats, on a clock the test drives. */
const running = () => {
  const clock = { t: 0 };
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config, () => clock.t);
  const sockets: Record<string, FakeSocket> = {};
  for (const id of ['s0', 's1', 's2', 's3']) {
    const s = new FakeSocket();
    sockets[id] = s;
    hub.open(id, s);
    hub.receive(id, joinFrame(id));
  }
  hub.receive('s0', JSON.stringify({ type: 'start' }));
  return { hub, clock, sockets };
};

describe('M3-RECONNECT: a match seat is held, a lobby seat is freed', () => {
  it('leaving a started room marks the seat rather than removing it', () => {
    const { hub } = running();
    hub.close('s3');
    const held = hub.room.seats.find((s) => s.seatId === 's3');
    expect(held, 'still in the record').toBeDefined();
    expect(held?.connected).toBe(false);
    expect(held?.unitIds.length, 'and it still knows its characters').toBeGreaterThan(0);
  });

  it('leaving a lobby removes it — there is nothing to come back to', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    for (const id of ['a', 'b']) { hub.open(id, new FakeSocket()); hub.receive(id, joinFrame(id)); }
    hub.close('a');
    expect(hub.room.seats.map((s) => s.seatId)).toEqual(['b']);
  });

  it('the pure `leave` is where that split lives, not the hub', () => {
    const lobby = { ...createRoom('WXYZ', '2v2'), seats: [
      { seatId: 'a', team: 0 as const, name: 'a', unitIds: [], picks: [], ready: false, connected: true, missedTurns: 0 },
    ] };
    expect(leave(lobby, 'a').seats).toHaveLength(0);
    const { hub } = running();
    expect(leave(hub.room, 's0').seats, 'a started room keeps all four').toHaveLength(4);
  });

  it('an unknown seat id is a no-op in either — a double disconnect is not an error', () => {
    const { hub } = running();
    expect(leave(hub.room, 'nobody')).toEqual(hub.room);
    hub.close('s3');
    expect(() => { hub.close('s3'); }).not.toThrow();
  });
});

describe('M3-RECONNECT: the reclaim is identity-matched', () => {
  it('the ticket parses off the join frame, and is optional', () => {
    expect(parseClientMessage(joinFrame('A', 'seat-7')))
      .toEqual({ type: 'join', version: PROTOCOL_VERSION, name: 'A', seatId: 'seat-7' });
    expect(parseClientMessage(joinFrame('A')), 'a fresh joiner sends none')
      .toEqual({ type: 'join', version: PROTOCOL_VERSION, name: 'A' });
  });

  it('a dropped seat rejoins and is re-synced with its filtered view', () => {
    const { hub } = running();
    const before = hub.room.seats.find((s) => s.seatId === 's3')!.unitIds;
    hub.close('s3');

    const back = new FakeSocket();
    hub.open('sock-9', back);
    hub.receive('sock-9', joinFrame('Back', 's3'));

    const resync = back.of('matchStarted').at(-1);
    expect(resync, 'the board came back with it').toBeDefined();
    expect(resync?.unitIds, 'and the same characters').toEqual(before);
    expect(resync?.state.turn).toBe(hub.room.state!.turn);
    expect(hub.room.seats.find((s) => s.seatId === 's3')?.connected).toBe(true);
    // The re-sync is filtered like every other per-seat payload (M3-HIDDEN):
    // the visible squares are this team's, not the whole board.
    expect(resync!.visibleSquares.length).toBeGreaterThan(0);
    expect(resync!.visibleSquares.length).toBeLessThan(OPEN.width * OPEN.height);
  });

  it('and it is speaking as the old seat from then on, not as its new socket', () => {
    // The reason the hub binds socket → seat instead of renaming: the Durable
    // Object hands it the id *it* minted on every frame and knows nothing about
    // a reclaim.
    const { hub } = running();
    hub.close('s3');
    const back = new FakeSocket();
    hub.open('sock-9', back);
    hub.receive('sock-9', joinFrame('Back', 's3'));
    const mine = back.of('matchStarted').at(-1)!.unitIds;
    hub.receive('sock-9', submit([{ unitId: mine[0]!, movePath: [] }]));
    expect(hub.locked, 'the submission landed on s3').toContain('s3');
  });

  it('the lock total counts the reclaimed seat again', () => {
    const { hub, sockets } = running();
    hub.close('s3');
    expect(sockets['s0']!.decision?.enemyOf, 'three seats are answering').toBe(1);

    const back = new FakeSocket();
    hub.open('sock-9', back);
    hub.receive('sock-9', joinFrame('Back', 's3'));
    expect(sockets['s0']!.decision?.enemyOf, 'and four again once it is back').toBe(2);
  });

  it('a stranger still cannot take a started seat (M3-JOIN-GUARD holds)', () => {
    const { hub } = running();
    hub.close('s3');
    const stranger = new FakeSocket();
    hub.open('stranger', stranger);
    hub.receive('stranger', joinFrame('Stranger'));
    expect(stranger.of('error').at(-1)?.code).toBe('inProgress');
    expect(hub.room.seats.find((s) => s.seatId === 's3')?.connected, 'still held').toBe(false);
  });

  it('and cannot take an occupied one by naming it', () => {
    // The whole access rule: a ticket is a claim on a *vacant* seat.
    const { hub } = running();
    const thief = new FakeSocket();
    hub.open('thief', thief);
    hub.receive('thief', joinFrame('Thief', 's3'));
    expect(thief.of('error').at(-1)?.code).toBe('seatTaken');
    expect(thief.closed, 'and the socket is shown the door').toBeDefined();
  });

  it('a ticket for a seat that never existed is refused, not seated elsewhere', () => {
    // The failure mode this guards: falling back to an ordinary join would put
    // a returning player in somebody else's chair, which is worse than a refusal.
    const { hub } = running();
    hub.close('s3');
    const lost = new FakeSocket();
    hub.open('lost', lost);
    hub.receive('lost', joinFrame('Lost', 'seat-from-another-room'));
    expect(lost.of('error').at(-1)?.code).toBe('unknownSeat');
    expect(hub.room.seats, 'nobody was seated').toHaveLength(4);
  });

  it('a ticket before the match has started is ignored, and the client is seated', () => {
    // **Reversed by LOBBY-READY-FIX** (was: refused with `noMatch`, socket
    // closed). A lobby holds no seat for anybody — `leave` deletes a lobby seat
    // outright — so a ticket presented to one is a claim on nothing rather than
    // a claim that failed, and the refusal it used to earn was how a second tab
    // of the same browser (one `localStorage`, one ticket) ended up with no seat
    // at all. The *match* rules above are untouched.
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    const s = new FakeSocket();
    hub.open('a', s);
    hub.receive('a', joinFrame('A', 'stale-ticket-from-a-dead-room'));
    expect(s.of('error'), 'no refusal').toEqual([]);
    expect(s.closed, 'and no closed door').toBeUndefined();
    expect(hub.room.seats.map((seat) => seat.seatId), 'seated under its own socket id')
      .toEqual(['a']);
  });

  it('the rules are the pure `reclaim`\'s, not the hub\'s', () => {
    const { hub } = running();
    expect(reclaim(hub.room, 's3'), 'occupied').toEqual({ ok: false, reason: 'seatTaken' });
    const dropped = leave(hub.room, 's3');
    const taken = reclaim(dropped, 's3');
    expect(taken.ok).toBe(true);
    if (taken.ok) expect(taken.seat.connected).toBe(true);
    expect(reclaim(createRoom('WXYZ', '2v2'), 's3')).toEqual({ ok: false, reason: 'noMatch' });
  });
});

describe('M3-RECONNECT: the turn does not wait on an empty chair', () => {
  it('the remaining seats resolve the turn between them', () => {
    const { hub, sockets } = running();
    hub.close('s3');
    for (const id of ['s0', 's1', 's2']) hub.receive(id, submit());
    expect(hub.room.turn, 'nobody waited 40 seconds for a socket that is gone').toBe(2);
    expect(sockets['s0']!.of('turnResolved')).toHaveLength(1);
  });

  it('a seat that locked in and then dropped still counts, and its orders run', () => {
    const { hub } = running();
    const s3 = hub.room.seats.find((s) => s.seatId === 's3')!;
    const unitId = s3.unitIds[0]!;
    const from = hub.room.state!.units.find((u) => u.unitId === unitId)!.pos;
    const to = { x: from.x - 1, y: from.y };
    hub.receive('s3', submit([{ unitId, movePath: [to] }]));
    hub.close('s3');
    expect(hub.locked, 'the answer stands').toContain('s3');
    for (const id of ['s0', 's1', 's2']) hub.receive(id, submit());
    expect(hub.room.turn).toBe(2);
    const moved = hub.room.state!.units.find((u) => u.unitId === unitId);
    expect(moved?.pos, 'the orders it left behind ran').toEqual(to);
  });
});

describe('M3-RECONNECT: the partial-team handoff (the last OPEN, decided)', () => {
  /** Drop `seatId` and play `turns` whole turns without it. */
  const without = (seatId: string, turns: number) => {
    const r = running();
    r.hub.close(seatId);
    for (let i = 0; i < turns; i++) {
      for (const s of r.hub.room.seats) {
        if (s.seatId === seatId) continue;
        r.hub.receive(s.seatId, submit());
      }
    }
    return r;
  };

  it('nothing moves during the turn the drop happened in', () => {
    // "After one fully missed turn" means exactly that: the seat may still come
    // back inside the window it dropped in, and taking its characters away the
    // instant a socket blinked would be a handoff triggered by a bad wifi
    // moment rather than by an absence.
    const { hub } = running();
    hub.close('s3');
    const mate = hub.room.seats.find((s) => s.team === 1 && s.seatId !== 's3')!;
    expect(controlledUnits(hub.room, mate.seatId)).toEqual(mate.unitIds);
  });

  it('after one fully missed turn a teammate holds the abandoned characters', () => {
    const { hub } = without('s3', 1);
    const gone = hub.room.seats.find((s) => s.seatId === 's3')!;
    const mate = hub.room.seats.find((s) => s.team === gone.team && s.seatId !== 's3')!;
    expect(gone.missedTurns).toBe(1);
    expect(controlledUnits(hub.room, mate.seatId))
      .toEqual([...mate.unitIds, ...gone.unitIds]);
    expect(controlledUnits(hub.room, 's3'), 'and the absent seat controls nothing').toEqual([]);
  });

  it('and the server will accept orders for them from the stand-in', () => {
    // The claim that makes the handoff real rather than cosmetic: before it, the
    // same submission is refused as `notYours`.
    const { hub, sockets } = without('s3', 1);
    const gone = hub.room.seats.find((s) => s.seatId === 's3')!;
    const mate = hub.room.seats.find((s) => s.team === gone.team && s.seatId !== 's3')!;
    hub.receive(mate.seatId, submit([{ unitId: gone.unitIds[0]!, movePath: [] }]));
    expect(hub.locked).toContain(mate.seatId);
    expect(sockets[mate.seatId]!.of('error'), 'not refused').toHaveLength(0);
  });

  it('a teammate is TOLD, because the control map rides every Decision phase', () => {
    const { hub, sockets } = without('s3', 1);
    const gone = hub.room.seats.find((s) => s.seatId === 's3')!;
    const mate = hub.room.seats.find((s) => s.team === gone.team && s.seatId !== 's3')!;
    expect(sockets[mate.seatId]!.decision?.unitIds)
      .toEqual([...mate.unitIds, ...gone.unitIds]);
  });

  it('the characters go straight back on reclaim — nothing is handed over', () => {
    // Why the handoff is *derived* rather than a transfer: reclaiming clears the
    // conditions it was derived from, so there is no unwinding step to get wrong.
    const { hub } = without('s3', 1);
    const gone = hub.room.seats.find((s) => s.seatId === 's3')!;
    const mate = hub.room.seats.find((s) => s.team === gone.team && s.seatId !== 's3')!;
    const back = new FakeSocket();
    hub.open('sock-9', back);
    hub.receive('sock-9', joinFrame('Back', 's3'));
    expect(controlledUnits(hub.room, 's3')).toEqual(gone.unitIds);
    expect(controlledUnits(hub.room, mate.seatId), 'the loan is over').toEqual(mate.unitIds);
    expect(back.of('matchStarted').at(-1)?.unitIds).toEqual(gone.unitIds);
  });

  it('a seat that locked in and dropped has missed nothing', () => {
    // `missedTurns` counts *fully* missed turns. Dropping after your orders are
    // in is not an absence — the turn was played.
    const { hub } = running();
    const s3 = hub.room.seats.find((s) => s.seatId === 's3')!;
    hub.receive('s3', submit());
    hub.close('s3');
    for (const id of ['s0', 's1', 's2']) hub.receive(id, submit());
    expect(hub.room.seats.find((s) => s.seatId === 's3')?.missedTurns).toBe(0);
    const mate = hub.room.seats.find((s) => s.team === s3.team && s.seatId !== 's3')!;
    expect(controlledUnits(hub.room, mate.seatId), 'no handoff yet').toEqual(mate.unitIds);
  });

  it('the stand-in is deterministic — the first connected seat on that team', () => {
    // Not "a teammate", which would leave two clients disagreeing about who is
    // holding what. The room's own join order decides it, on the server and on
    // every client alike.
    const { hub } = without('s3', 1);
    const gone = hub.room.seats.find((s) => s.seatId === 's3')!;
    const team = hub.room.seats.filter((s) => s.team === gone.team);
    const holders = team.filter((s) => controlledUnits(hub.room, s.seatId).includes(gone.unitIds[0]!));
    expect(holders.map((s) => s.seatId), 'exactly one holder')
      .toEqual([team.find((s) => s.connected)!.seatId]);
  });

  it('a whole team dropping leaves its characters with nobody, not with the enemy', () => {
    const { hub } = running();
    for (const s of hub.room.seats.filter((x) => x.team === 1)) hub.close(s.seatId);
    for (const id of ['s0', 's1']) hub.receive(id, submit());
    for (const s of hub.room.seats) {
      const controls = controlledUnits(hub.room, s.seatId);
      if (s.team === 1) expect(controls, 'nobody is left to hold them').toEqual([]);
      else expect(controls, 'and the other side gained nothing').toEqual(s.unitIds);
    }
  });
});
