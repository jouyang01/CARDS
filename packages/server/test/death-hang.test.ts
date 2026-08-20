import { describe, expect, it } from 'vitest';
import type { CharacterDef, MapDef, Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { createRoom } from '../src/room.js';

/**
 * DEATH-HANG, the server's half — *"the lock-in is not possible and the timer
 * bar goes away."*
 *
 * The fault was the client's (`openSeat` answering the turn for a downed seat),
 * but the Spec Notes name a second suspect worth ruling out rather than
 * assuming: does the room still **open a window** on the turn after a kill?
 *
 * `#sendDecision` opens one whenever `state.status === 'active'` and somebody is
 * attached, and a death is not a status change — so it does, and this file is
 * why we know. It is a regression test rather than a fix: the guard that could
 * quietly break it is the QUOTA-RUNAWAY `??=`, and a room that stopped clocking
 * turns after the first casualty would present to a player as exactly the
 * reported bug, from the other end of the wire.
 */

const CLOSE: MapDef = {
  id: 'dh', name: 'dh', width: 9, height: 9, walls: [], cover: [], brush: [],
  spawns: [[{ x: 3, y: 4 }], [{ x: 5, y: 4 }]],
};
/** Enough damage to finish the frail character below in one blast. */
const shot = {
  id: 'shot', name: 'shot', phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 40 }],
  description: 'shot',
};
/** 20 HP, so one `shot` downs it — the numbers are the test's, not the game's. */
const FRAIL: CharacterDef = {
  id: 'frail', name: 'F', archetype: 'firepower', maxHp: 20,
  abilities: [shot],
  ultimate: { ...shot, id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] },
};
const roster: Roster = { frail: FRAIL };
const config: MatchConfig = { map: CLOSE, roster, teams: [[FRAIL], [FRAIL]] };

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

const started = () => {
  const clock = { t: 1_000_000 };
  const hub = new RoomHub(createRoom('DHNG', '1v1'), config, () => clock.t);
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

/** The unit ids as each seat's own Decision view reports them. */
const mine = (s: FakeSocket, team: number): string[] =>
  (s.decision?.state.units ?? []).filter((u) => u.owner === team).map((u) => u.unitId);

describe('DEATH-HANG: the room keeps clocking turns after a kill', () => {
  it('a resolution that downs a unit still opens the next window', () => {
    const { hub, a, b } = started();
    const victim = mine(b, 1)[0]!;
    const killer = mine(a, 0)[0]!;
    const aimed = a.decision!.state.units.find((u) => u.unitId === victim)!.pos;

    hub.receive('s0', submit([{ unitId: killer, ability: { abilityId: 'shot', target: [aimed] } }]));
    hub.receive('s1', submit([]));

    // Read the corpse from `b`'s own view, not the killer's: a downed unit is
    // out of sight, so `a`'s fogged state does not carry it at all.
    const resolved = b.of('turnResolved').at(-1)!;
    expect(resolved.state.units.find((u) => u.unitId === victim)?.alive, 'downed').toBe(false);
    expect(resolved.state.status, 'and the match is still running').toBe('active');

    // The point of the file: both seats — the bereaved one included — are given
    // a window on the next turn, not silence.
    expect(a.decision?.turn, 'the killer sees the new turn').toBe(resolved.turn);
    expect(b.decision?.turn, 'and so does the seat that lost a character').toBe(resolved.turn);
    expect(a.decision?.remainingMs, 'a live clock').toBeGreaterThan(0);
    expect(b.decision?.remainingMs, 'on both sides').toBeGreaterThan(0);
  });

  it('and the window is a fresh one, not the spent turn\'s leftovers', () => {
    // `resolveNow` clears the deadline so `#sendDecision`'s `??=` opens a new
    // one. If it ever stopped clearing, this is the assertion that notices: the
    // seat that spent 30s deciding would be handed 10s to plan the next turn.
    const { hub, clock, a, b } = started();
    const opening = a.decision!.remainingMs!;
    clock.t += 30_000;

    const victim = mine(b, 1)[0]!;
    const killer = mine(a, 0)[0]!;
    const aimed = a.decision!.state.units.find((u) => u.unitId === victim)!.pos;
    hub.receive('s0', submit([{ unitId: killer, ability: { abilityId: 'shot', target: [aimed] } }]));
    hub.receive('s1', submit([]));

    expect(b.decision?.remainingMs, 'the full window again').toBe(opening);
  });
});
