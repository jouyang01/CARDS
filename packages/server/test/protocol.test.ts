import { describe, expect, it } from 'vitest';
import {
  createMatch, resolveTurn,
  type CharacterDef, type MapDef, type Roster, type UnitOrders,
} from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { createRoom, resolveRoomTurn, seatFor, startMatch } from '../src/room.js';

/**
 * M3-PROTOCOL — per-player submission → per-team orders → resolve → broadcast.
 *
 * The assertion the whole item rests on is the **parity** one: a full turn
 * driven through the hub must land on exactly the state a direct `resolveTurn`
 * call produces from the same orders. If those ever differ, the server is
 * playing a different game from the client, and every other test here is
 * describing the wrong game carefully.
 *
 * Everything else is about *when* a turn resolves and *who* may order what,
 * which is the hub's own job — the rules are the engine's and are not retested.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }, { x: 1, y: 9 }], [{ x: 13, y: 7 }, { x: 13, y: 9 }]],
};
const ability = (id: string, over: Partial<CharacterDef['abilities'][number]> = {}) => ({
  id, name: id, phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 20 }],
  description: id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [ability('shot'), ability('hop', { phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] })],
  ultimate: ability('ult', { shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
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
  get last(): ServerMessage | undefined { return this.sent[this.sent.length - 1]; }
}

const joinFrame = (name?: string): string =>
  JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name });
const submitFrame = (orders: UnitOrders[]): string => JSON.stringify({ type: 'submit', orders });

/** A 2v2 room with `n` seats joined, wired to a live match config. */
const running = (n = 4) => {
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

describe('M3-PROTOCOL: the match starts and hands out the control map', () => {
  it('starts when the room fills, and tells everybody', () => {
    const { hub, sockets } = running(4);
    expect(hub.room.state, 'a match exists').toBeDefined();
    for (const s of sockets) expect(s.of('matchStarted')).toHaveLength(1);
  });

  it('does NOT start on a half-full room — a late joiner must not be stranded', () => {
    // Starting the moment both teams are present deals the characters before
    // the third and fourth players arrive, and seats them controlling nothing.
    const { hub, sockets } = running(2);
    expect(hub.room.state).toBeUndefined();
    expect(sockets[0]!.of('matchStarted')).toHaveLength(0);
  });

  it('…but a short room can be started explicitly', () => {
    // The escape hatch for a 2v2 two players intend to run with two characters
    // each — a legal configuration the fill trigger cannot detect. M3-LOBBY's
    // start button replaces the trigger with this.
    const { hub, sockets } = running(2);
    hub.start();
    expect(hub.room.state).toBeDefined();
    expect(sockets[0]!.of('matchStarted')[0]!.unitIds).toHaveLength(2);
  });

  it('tells each seat which characters are ITS to order', () => {
    // The one question a client cannot answer from the state alone.
    const { hub, sockets } = running(4);
    const mine = sockets.map((s) => s.of('matchStarted')[0]!.unitIds);
    expect(mine.every((ids) => ids.length > 0), 'every seat controls somebody').toBe(true);
    // Every character is dealt exactly once — no unit orphaned, none shared.
    const all = mine.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(hub.room.state!.units.map((u) => u.unitId)));
  });

  it('seats each character on its own team', () => {
    const { hub } = running(4);
    for (const seat of hub.room.seats) {
      for (const id of seat.unitIds) {
        expect(hub.room.state!.units.find((u) => u.unitId === id)!.owner, id).toBe(seat.team);
      }
    }
  });

  it('a 2v2 with two seats gives each player both of its team\'s characters', () => {
    const { hub } = running(2);
    hub.start();
    expect(hub.room.seats.map((s) => s.unitIds.length)).toEqual([2, 2]);
  });

  it('`seatFor` reads the control map backwards', () => {
    const { hub } = running(4);
    const room = hub.room;
    for (const unit of room.state!.units) {
      expect(seatFor(room, unit.unitId)?.unitIds, unit.unitId).toContain(unit.unitId);
    }
    expect(seatFor(room, 'nobody')).toBeUndefined();
  });

  it('starting twice is refused rather than restarting the match', () => {
    const { hub } = running(4);
    expect(startMatch(hub.room, OPEN, TEAMS)).toEqual({ ok: false, reason: 'cannotStart' });
  });
});

describe('M3-PROTOCOL: a turn resolves when the last seat locks in', () => {
  const orderFor = (hub: RoomHub, seatId: string): UnitOrders[] =>
    hub.room.seats.find((s) => s.seatId === seatId)!.unitIds
      .map((unitId) => ({ unitId, ability: { abilityId: 'shot', target: [{ x: 14, y: 7 }] } }));

  it('nothing resolves until every seat is in', () => {
    const { hub, sockets } = running(4);
    for (const id of ['s0', 's1', 's2']) hub.receive(id, submitFrame(orderFor(hub, id)));
    expect(sockets[0]!.of('turnResolved'), 'three of four').toHaveLength(0);
    expect(hub.room.turn).toBe(1);

    hub.receive('s3', submitFrame(orderFor(hub, 's3')));
    expect(sockets[0]!.of('turnResolved'), 'and the fourth resolves it').toHaveLength(1);
    expect(hub.room.turn).toBe(2);
  });

  it('every seat is told how many are locked in, as it happens', () => {
    const { hub, sockets } = running(4);
    hub.receive('s0', submitFrame(orderFor(hub, 's0')));
    expect(sockets[1]!.of('submitted')[0]).toEqual({ type: 'submitted', locked: 1, of: 4 });
    hub.receive('s1', submitFrame(orderFor(hub, 's1')));
    expect(sockets[1]!.of('submitted')[1]).toMatchObject({ locked: 2, of: 4 });
  });

  it('the resolved payload reaches every seat, with the state and the log', () => {
    const { hub, sockets } = running(4);
    for (const id of ['s0', 's1', 's2', 's3']) hub.receive(id, submitFrame(orderFor(hub, id)));
    for (const s of sockets) {
      const resolved = s.of('turnResolved')[0];
      expect(resolved?.turn).toBe(2);
      expect(resolved?.state.turn).toBe(2);
      expect(resolved?.events.length, 'the log to animate').toBeGreaterThan(0);
    }
  });

  it('the locks clear, so the next turn starts empty', () => {
    const { hub } = running(4);
    for (const id of ['s0', 's1', 's2', 's3']) hub.receive(id, submitFrame(orderFor(hub, id)));
    expect(hub.locked, 'a fresh turn waits on everybody again').toEqual([]);
    // …and the same seat may submit again for the new turn.
    hub.receive('s0', submitFrame(orderFor(hub, 's0')));
    expect(hub.locked).toEqual(['s0']);
  });

  it('a turn is appended to the history, not folded into the state', () => {
    // Ruled at Builder OQ 2026-08-16 #5: current state for a cheap reconnect,
    // an order log for replay. Both, because they answer different questions.
    const { hub } = running(4);
    for (const id of ['s0', 's1', 's2', 's3']) hub.receive(id, submitFrame(orderFor(hub, id)));
    expect(hub.room.history).toHaveLength(1);
    expect(hub.room.history[0]!.turn, 'the turn it was ordered on').toBe(1);
    expect(hub.room.history[0]!.orders.map((o) => o.team)).toEqual([0, 1]);
  });
});

describe('M3-PROTOCOL: the server plays the same game as the client', () => {
  it('a full 2v2 turn through the hub equals a direct resolveTurn', () => {
    // The parity assertion the whole item rests on. Same map, same roster, same
    // orders — the hub must not shape them differently on the way through, or
    // the client's local prediction and the server's authority diverge and
    // every other test here is describing the wrong game carefully.
    const { hub } = running(4);
    const before = hub.room;
    const orders = new Map(
      before.seats.map((s) => [
        s.seatId,
        s.unitIds.map((unitId) => ({ unitId, ability: { abilityId: 'shot', target: [{ x: 14, y: 7 }] } })),
      ]),
    );

    // The hub's route.
    for (const [seatId, o] of orders) hub.receive(seatId, submitFrame(o));

    // The direct route: the same merge the engine exposes, then `resolveTurn`.
    const direct = resolveRoomTurn(before, OPEN, roster, orders);
    expect(direct).toBeDefined();
    const plain = resolveTurn(before.state!, OPEN, direct!.orders, roster);

    expect(JSON.stringify(hub.room.state)).toEqual(JSON.stringify(plain.state));
  });

  it('and a hub match tracks a hand-run one over several turns', () => {
    const { hub } = running(2);
    hub.start(); // a two-seat 2v2 will never fill, so start it explicitly
    let mirror = createMatch(OPEN, '2v2', TEAMS);
    // The deal has to match too, or the mirror is ordering different units.
    expect(JSON.stringify(hub.room.state)).toEqual(JSON.stringify(mirror));

    for (let turn = 0; turn < 3; turn++) {
      const bySeat = new Map(
        hub.room.seats.map((s) => [
          s.seatId,
          s.unitIds.map((unitId) => ({ unitId, movePath: [] as never[] })),
        ]),
      );
      for (const [seatId, o] of bySeat) hub.receive(seatId, submitFrame(o));
      const unitsOf = (team: 0 | 1): UnitOrders[] =>
        hub.room.seats.filter((s) => s.team === team).flatMap((s) => bySeat.get(s.seatId)!);
      mirror = resolveTurn(mirror, OPEN, [
        { team: 0, units: unitsOf(0) },
        { team: 1, units: unitsOf(1) },
      ], roster).state;
      expect(JSON.stringify(hub.room.state), `turn ${turn + 1}`).toEqual(JSON.stringify(mirror));
    }
  });
});

describe('M3-PROTOCOL: a seat may only order its own characters', () => {
  it('refuses an order naming a teammate\'s character outright', () => {
    // Refused, not filtered: silently dropping it would let a client believe it
    // had ordered a unit and watch the turn resolve as though it had chosen not
    // to — indistinguishable from the engine ignoring a legal order.
    const { hub, sockets } = running(4);
    const mine = hub.room.seats.find((s) => s.seatId === 's0')!;
    const theirs = hub.room.seats.find((s) => s.seatId !== 's0' && s.unitIds.length > 0)!;
    hub.receive('s0', submitFrame([{ unitId: theirs.unitIds[0]!, movePath: [] }]));
    expect(sockets[0]!.last).toMatchObject({ code: 'notYours' });
    expect(hub.locked, 'and it did not lock in').toEqual([]);
    expect(mine.unitIds.length).toBeGreaterThan(0);
  });

  it('refuses a second submission in the same turn', () => {
    const { hub, sockets } = running(4);
    hub.receive('s0', submitFrame([]));
    hub.receive('s0', submitFrame([]));
    expect(sockets[0]!.last).toMatchObject({ code: 'alreadyLocked' });
    expect(hub.locked).toEqual(['s0']);
  });

  it('refuses a submission before the match has started', () => {
    const { hub, sockets } = running(1); // one seat: the room has not filled
    hub.receive('s0', submitFrame([]));
    expect(sockets[0]!.last).toMatchObject({ code: 'noMatch' });
  });

  it('refuses a submission from a socket that never joined', () => {
    const { hub } = running(4);
    const lurker = new FakeSocket();
    hub.open('lurker', lurker);
    hub.receive('lurker', submitFrame([]));
    expect(lurker.last).toMatchObject({ code: 'notJoined' });
  });

  it('an empty submission is legal — holding position is a plan', () => {
    const { hub, sockets } = running(4);
    hub.receive('s0', submitFrame([]));
    expect(sockets[0]!.of('error')).toHaveLength(0);
    expect(hub.locked).toEqual(['s0']);
  });

  it('a malformed orders array is not a submission at all', () => {
    const { hub, sockets } = running(4);
    hub.receive('s0', JSON.stringify({ type: 'submit', orders: ['nope'] }));
    expect(sockets[0]!.last).toMatchObject({ code: 'badMessage' });
    expect(hub.locked).toEqual([]);
  });
});

describe('M3-PROTOCOL: a seat that leaves does not hang the turn', () => {
  it('the room resolves once the remaining seats are all in', () => {
    // Not the disconnect *rule* — that is M3-TIMER's to write. This only stops
    // a room waiting forever on a socket that is gone.
    const { hub, sockets } = running(4);
    for (const id of ['s0', 's1', 's2']) {
      hub.receive(id, submitFrame([]));
    }
    expect(sockets[0]!.of('turnResolved')).toHaveLength(0);
    hub.close('s3');
    expect(sockets[0]!.of('turnResolved'), 'the missing seat left, so the turn is complete').toHaveLength(1);
  });

  it('a leaver takes its own submission with it', () => {
    const { hub } = running(4);
    hub.receive('s0', submitFrame([]));
    expect(hub.locked).toEqual(['s0']);
    hub.close('s0');
    expect(hub.locked).toEqual([]);
  });
});

describe('M3-PROTOCOL: the room view says what a client needs to draw', () => {
  it('reports started and the turn', () => {
    const { hub, sockets } = running(4);
    const started = sockets[0]!.of('matchStarted')[0]!.room;
    expect(started).toMatchObject({ started: true, turn: 1, locked: [] });
    hub.receive('s1', submitFrame([]));
    hub.close('s2'); // any room-shaped message will do to re-read the view
    expect(sockets[0]!.of('seatLeft')[0]!.room).toMatchObject({ started: true });
  });

  it('but a room view carries NO lock list once the match is running (M3-LOCKLIST)', () => {
    // `RoomView` rides `joined`, `roomUpdated` and `seatLeft` — all broadcast,
    // the same bytes to both teams. A lock list there would hand each team the
    // other's seat ids one message after the per-seat `decision` withheld them.
    const { hub, sockets } = running(4);
    hub.receive('s1', submitFrame([]));
    hub.close('s2');
    expect(sockets[0]!.of('seatLeft')[0]!.room.locked).toEqual([]);
  });

  it('…while a lobby view still names who is ready, because nothing is secret yet', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    const watcher = new FakeSocket();
    hub.open('a', watcher);
    hub.receive('a', joinFrame('A'));
    expect(watcher.of('joined')[0]!.room.locked).toEqual([]);
    expect(watcher.of('joined')[0]!.room.started).toBe(false);
  });

  it('a lobby that has not started says so', () => {
    const { sockets } = running(1);
    expect(sockets[0]!.of('joined')[0]!.room).toMatchObject({ started: false, turn: 0 });
  });
});
