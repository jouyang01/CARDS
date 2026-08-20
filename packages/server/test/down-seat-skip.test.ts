import { describe, expect, it } from 'vitest';
import { DECISION_SECONDS, type CharacterDef, type MapDef, type Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { createRoom } from '../src/room.js';

/**
 * DOWN-SEAT-SKIP — a seat with nothing alive is not waited on.
 *
 * Closes the Builder's own session-7 open question. DEATH-HANG left a downed
 * player holding *correctly*: the board says why it cannot act, and Lock In
 * stays live as "Hold Position" so they can let the turn go early. What it did
 * not fix is that the room still sat through the whole `DECISION_SECONDS` on a
 * turn that seat could not change — and the player least likely to be watching
 * the screen is exactly the one with nothing to do, so in practice the wait was
 * the full window every time.
 *
 * The fix is the argument `#answering` already makes about a **disconnected**
 * seat, one step along: there is nothing behind the seat to press Lock In with.
 * Its characters hold either way, so skipping it changes only how long everybody
 * else waits to find out. "No turn ever waits on a player", applied to a player
 * who cannot play.
 *
 * The line this file spends most of its assertions on is the one that is easy to
 * cross by accident: **a seat with SOME units alive is still waited on.** It has
 * a turn to take, and resolving without it would be the DEATH-HANG bug wearing a
 * different hat — the room answering for a player who was still deciding.
 */

const CLOSE: MapDef = {
  id: 'ds', name: 'ds', width: 11, height: 11, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 3, y: 4 }, { x: 3, y: 6 }],
    [{ x: 7, y: 4 }, { x: 7, y: 6 }],
  ],
};
const shot = {
  id: 'shot', name: 'shot', phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 40 }],
  description: 'shot',
};
/** 20 HP, so one `shot` downs it — the test's numbers, not the game's. */
const FRAIL: CharacterDef = {
  id: 'frail', name: 'F', archetype: 'firepower', maxHp: 20,
  abilities: [shot],
  ultimate: { ...shot, id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] },
};
const roster: Roster = { frail: FRAIL };

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
const submit = (orders: unknown[] = []): string => JSON.stringify({ type: 'submit', orders });

/** A started match on a clock the test moves by hand. */
const started = (format: '1v1' | '2v2', seats: number) => {
  const clock = { t: 1_000_000 };
  const teams = format === '1v1'
    ? [[FRAIL], [FRAIL]] as [CharacterDef[], CharacterDef[]]
    : [[FRAIL, FRAIL], [FRAIL, FRAIL]] as [CharacterDef[], CharacterDef[]];
  const config: MatchConfig = { map: CLOSE, roster, teams };
  const hub = new RoomHub(createRoom('DSKP', format), config, () => clock.t);
  const sockets: FakeSocket[] = [];
  for (let i = 0; i < seats; i += 1) {
    const s = new FakeSocket();
    hub.open(`s${i}`, s);
    hub.receive(`s${i}`, JOIN);
    sockets.push(s);
  }
  hub.receive('s0', START);
  return { hub, clock, sockets };
};

/** The unit ids one seat's own Decision view reports for `team`. */
const unitsOf = (s: FakeSocket, team: number): string[] =>
  (s.decision?.state.units ?? []).filter((u) => u.owner === team).map((u) => u.unitId);

/** Kill seat 1's only character: seat 0 shoots it, seat 1 holds. */
const downSeatOne = (hub: RoomHub, a: FakeSocket, b: FakeSocket): void => {
  const victim = unitsOf(b, 1)[0]!;
  const killer = unitsOf(a, 0)[0]!;
  const aimed = a.decision!.state.units.find((u) => u.unitId === victim)!.pos;
  hub.receive('s0', submit([{ unitId: killer, ability: { abilityId: 'shot', target: [aimed] } }]));
  hub.receive('s1', submit([]));
};

describe('DOWN-SEAT-SKIP: a seat with nothing alive is not waited on', () => {
  it('the setup really does down the seat', () => {
    // The fixture, asserted before anything is concluded from it. A shot that
    // stopped killing would make every claim below pass for free.
    const { hub, sockets: [a, b] } = started('1v1', 2);
    downSeatOne(hub, a!, b!);
    const mine = b!.decision!.state.units.filter((u) => u.owner === 1);
    expect(mine.every((u) => !u.alive), 'seat 1 has nothing standing').toBe(true);
    expect(b!.decision!.state.status, 'and the match is still running').toBe('active');
  });

  it('the turn resolves as soon as the seat that CAN act locks in', () => {
    // The item. One submission, from the only seat with a character, and the
    // turn goes — no second lock, no clock, no 40 seconds of nothing.
    const { hub, sockets: [a, b] } = started('1v1', 2);
    downSeatOne(hub, a!, b!);
    const before = a!.of('turnResolved').length;

    const killer = unitsOf(a!, 0)[0]!;
    hub.receive('s0', submit([{ unitId: killer, movePath: [] }]));

    expect(a!.of('turnResolved').length, 'resolved on one lock').toBe(before + 1);
  });

  it('and the downed seat is not in the count the other player is shown', () => {
    // M3-LOCKLIST's waiting line reads off these numbers, so "waiting for 1
    // opponent(s)" over a seat that cannot answer is the same lie in words.
    const { hub, sockets: [a, b] } = started('1v1', 2);
    downSeatOne(hub, a!, b!);
    expect(a!.decision?.enemyOf, 'the payload carries the counts').toBeDefined();
    expect(a!.decision!.enemyOf, 'nobody to wait for on that side').toBe(0);
    expect(a!.decision!.of, 'and this seat still counts itself').toBe(1);
  });

  it('the downed seat may still hold, and that does not break the count', () => {
    // "Hold Position" stays live and stays harmless: a seat that submits is
    // counted again whether or not it could act, exactly as a disconnected seat
    // is counted while its own submission stands.
    const { hub, sockets: [a, b] } = started('1v1', 2);
    downSeatOne(hub, a!, b!);
    const before = a!.of('turnResolved').length;
    hub.receive('s1', submit([]));           // the downed player holds first
    expect(a!.of('turnResolved').length, 'still waiting for the live seat').toBe(before);
    const killer = unitsOf(a!, 0)[0]!;
    hub.receive('s0', submit([{ unitId: killer, movePath: [] }]));
    expect(a!.of('turnResolved').length, 'and now it goes').toBe(before + 1);
  });

  it('the downed seat still gets a window, so it is not cut out of the match', () => {
    // Skipping a seat in the LOCK COUNT is not the same as ignoring it. It still
    // receives the Decision phase, still sees the board, and still has a clock —
    // which is what DEATH-HANG's banner sits next to.
    const { hub, sockets: [a, b] } = started('1v1', 2);
    downSeatOne(hub, a!, b!);
    expect(b!.decision, 'a Decision phase reached it').toBeDefined();
    expect(b!.decision!.remainingMs, 'with a live clock').toBeGreaterThan(0);
  });
});

describe('DOWN-SEAT-SKIP: a seat with SOME units alive is still waited on', () => {
  it('losing one of two characters does not answer the turn for you', () => {
    // The line that is easy to cross by accident, and the reason `#canAct` asks
    // "any living unit" rather than "all of them". A 2v2 seat that lost one
    // character still has a turn to take, and resolving without it would be the
    // DEATH-HANG bug wearing a different hat.
    const { hub, sockets: [a, b] } = started('2v2', 2);
    const foes = unitsOf(b!, 1);
    expect(foes, 'seat 1 runs two characters').toHaveLength(2);
    const killers = unitsOf(a!, 0);
    const aimed = a!.decision!.state.units.find((u) => u.unitId === foes[0]!)!.pos;
    hub.receive('s0', submit([{ unitId: killers[0]!, ability: { abilityId: 'shot', target: [aimed] } }]));
    hub.receive('s1', submit([]));

    const alive = b!.decision!.state.units.filter((u) => u.owner === 1 && u.alive);
    expect(alive, 'one down, one standing').toHaveLength(1);

    const before = a!.of('turnResolved').length;
    hub.receive('s0', submit([]));
    expect(a!.of('turnResolved').length, 'the half-strength seat is still owed an answer')
      .toBe(before);
    hub.receive('s1', submit([]));
    expect(a!.of('turnResolved').length, 'and the turn goes once it answers').toBe(before + 1);
  });
});

describe('DOWN-SEAT-SKIP: nothing else about the lock count moved', () => {
  it('an ordinary turn with both seats up still needs both locks', () => {
    // The guard on the whole change: `#canAct` must not be quietly true-ing or
    // false-ing its way through a normal turn.
    const { hub, sockets: [a] } = started('1v1', 2);
    const before = a!.of('turnResolved').length;
    hub.receive('s0', submit([]));
    expect(a!.of('turnResolved').length, 'one lock is not enough').toBe(before);
    hub.receive('s1', submit([]));
    expect(a!.of('turnResolved').length).toBe(before + 1);
  });

  it('and the timer still bounds a turn nobody answers', () => {
    // The seat can act and simply has not. `expire` is untouched, so "missed
    // submission → hold position" still arrives on the clock rather than never.
    const { hub, clock, sockets: [a] } = started('1v1', 2);
    const before = a!.of('turnResolved').length;
    clock.t += DECISION_SECONDS * 1000 + 1;
    hub.expire();
    expect(a!.of('turnResolved').length, 'the window ran out and the turn resolved')
      .toBe(before + 1);
  });
});
