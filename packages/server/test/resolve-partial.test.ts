import { describe, expect, it } from 'vitest';
import { DECISION_SECONDS, type CharacterDef, type MapDef, type Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { createRoom } from '../src/room.js';

/**
 * RESOLVE-PARTIAL — no turn ever waits on a player, and "who acted" is decided
 * **per character** (Dev Note #8, ruled 2026-08-16).
 *
 * When the Decision phase ends — every seat locked, or the timer expiring —
 * characters whose orders were locked act exactly as locked, and characters
 * never locked hold: no ability, no move, no free action, no catalyst.
 *
 * The ruling mostly falls out of two existing properties, and the point of this
 * file is to hold them to it rather than to add a third:
 *
 *   • the client sends one `UnitOrders` **per drafted character**, not one
 *     blob per seat, so a seat that drafted one of its two contributes one;
 *   • `mergeSeatOrders` contributes nothing for a seat that is not in the map,
 *     and a unit with no orders holds.
 *
 * Together those make a timed-out turn and a played turn the same resolve. The
 * failure mode they rule out is the tempting one: a hub that waits for a seat
 * to be "complete", or that drops a whole seat's orders because one of its
 * characters had none.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }, { x: 1, y: 9 }], [{ x: 13, y: 7 }, { x: 13, y: 9 }]],
};
const shot = {
  id: 'shot', name: 'shot', phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 2, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 20 }],
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
  get decision(): Extract<ServerMessage, { type: 'decision' }> | undefined {
    return this.of('decision').at(-1);
  }
}

const JOIN = JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name: 'P' });
const submit = (orders: unknown[]): string => JSON.stringify({ type: 'submit', orders });

/**
 * A started 2v2 with **one seat per team**, so each seat drives two characters
 * — the arrangement the ruling is actually about.
 */
const twoEach = () => {
  const clock = { t: 500_000 };
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config, () => clock.t);
  const sockets: FakeSocket[] = [];
  for (const id of ['s0', 's1']) {
    const s = new FakeSocket();
    hub.open(id, s);
    hub.receive(id, JOIN);
    sockets.push(s);
  }
  hub.receive('s0', JSON.stringify({ type: 'start' }));
  const a = sockets[0]!;
  const [first, second] = a.decision!.unitIds;
  return { hub, clock, a, b: sockets[1]!, first: first!, second: second! };
};

/** Where a unit is standing in the hub's authoritative state. */
const posOf = (hub: RoomHub, unitId: string) =>
  hub.room.state!.units.find((u) => u.unitId === unitId)!.pos;

describe('RESOLVE-PARTIAL: the seat is not the unit of resolution', () => {
  it('a seat controls two characters, which is what makes the question real', () => {
    const { a } = twoEach();
    expect(a.decision?.unitIds).toHaveLength(2);
  });

  it('locking one of them moves that one and holds the other', () => {
    // The AC, stated as one turn: same seat, same submission, two different
    // outcomes because only one character was in it.
    const { hub, first, second } = twoEach();
    const before = { first: { ...posOf(hub, first) }, second: { ...posOf(hub, second) } };
    hub.receive('s0', submit([{ unitId: first, movePath: [{ x: 2, y: 7 }, { x: 3, y: 7 }] }]));
    hub.receive('s1', submit([]));

    expect(posOf(hub, first), 'the locked one walked').not.toEqual(before.first);
    expect(posOf(hub, second), 'the unlocked one held').toEqual(before.second);
  });

  it('and the turn resolved rather than waiting for the other character', () => {
    const { hub, a, first } = twoEach();
    hub.receive('s0', submit([{ unitId: first, movePath: [{ x: 2, y: 7 }] }]));
    hub.receive('s1', submit([]));
    expect(hub.room.state?.turn, 'turn 2 is open').toBe(2);
    expect(a.of('turnResolved').length).toBe(1);
  });

  it('an unlocked character starts no cooldown, because it fired nothing', () => {
    // "Holds" is the whole order and not just the movement: the character that
    // was locked spent its ability and is on cooldown, and the one that was not
    // is untouched. Two units of the same character, one turn, one seat.
    const { hub, first, second } = twoEach();
    hub.receive('s0', submit([{ unitId: first, ability: { abilityId: 'shot', target: [{ x: 8, y: 7 }] } }]));
    hub.receive('s1', submit([]));
    const acted = hub.room.state!.units.find((u) => u.unitId === first)!;
    const held = hub.room.state!.units.find((u) => u.unitId === second)!;
    expect(acted.cooldowns['shot'], 'the locked one spent its shot').toBeGreaterThan(0);
    expect(held.cooldowns, 'the unlocked one spent nothing').toEqual({});
  });
});

describe('RESOLVE-PARTIAL: expiry is the same resolve, not a second one', () => {
  it('a seat that never submits holds both its characters, and the turn still runs', () => {
    const { hub, clock, first } = twoEach();
    const enemyBefore = hub.room.state!.units.filter((u) => u.owner === 1).map((u) => ({ ...u.pos }));
    hub.receive('s0', submit([{ unitId: first, movePath: [{ x: 2, y: 7 }] }]));

    clock.t += DECISION_SECONDS * 1000 + 1;
    hub.expire();

    expect(hub.room.state?.turn, 'nobody was waited for').toBe(2);
    expect(hub.room.state!.units.filter((u) => u.owner === 1).map((u) => ({ ...u.pos })))
      .toEqual(enemyBefore);
  });

  it('a partly-locked seat at expiry acts with what it locked', () => {
    // The two rules meeting: expiry does not discard the locked half of a seat
    // any more than a full room of lock-ins does.
    const { hub, clock, first, second } = twoEach();
    const before = { ...posOf(hub, second) };
    hub.receive('s0', submit([{ unitId: first, movePath: [{ x: 2, y: 7 }, { x: 3, y: 7 }] }]));
    clock.t += DECISION_SECONDS * 1000 + 1;
    hub.expire();

    expect(posOf(hub, first)).toEqual({ x: 3, y: 7 });
    expect(posOf(hub, second)).toEqual(before);
  });

  it('an empty submission is a lock-in, not a missing one', () => {
    // "I am doing nothing" and "I never answered" reach the same resolve, and
    // both have to end the window — a room that treated an empty array as
    // absent would hang until the timer on a deliberate hold.
    const { hub, a } = twoEach();
    hub.receive('s0', submit([]));
    hub.receive('s1', submit([]));
    expect(hub.room.state?.turn).toBe(2);
    expect(a.of('turnResolved').length).toBe(1);
  });
});
