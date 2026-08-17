import { describe, expect, it } from 'vitest';
import {
  VISION_RANGE,
  type CharacterDef, type MapDef, type Roster, type UnitOrders,
} from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { createRoom } from '../src/room.js';
import { filterEvents, teamView } from '../src/view.js';

/**
 * M3-HIDDEN — the golden-rule-#5 boundary, enforced server-side.
 *
 * The tests that matter here are **negative**: what is *not* in a payload. A
 * positive assertion ("the client draws fog") passed for the whole of
 * M3-PROTOCOL while the enemy's exact positions sat on the wire, one devtools
 * panel away. So every case below asks the same question — is the hidden thing
 * absent from the bytes — and the reveal cases prove the boundary opens again
 * when it should, rather than being a filter nobody ever turns off.
 */

/** Spawns 12 apart on a 15-wide board: further than VISION_RANGE, so fogged. */
const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }, { x: 1, y: 9 }], [{ x: 13, y: 7 }, { x: 13, y: 9 }]],
};
const BRUSHY: MapDef = { ...OPEN, brush: [{ x: 6, y: 7 }, { x: 7, y: 7 }] };

const ability = (id: string, over: Partial<CharacterDef['abilities'][number]> = {}) => ({
  id, name: id, phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 20 }],
  description: id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability('shot'),
    ability('hop', { phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] }),
    ability('trap', { phase: 'prep', shape: 'square', range: 4, effects: [{ kind: 'trap', amount: 20 }] }),
  ],
  ultimate: ability('ult', { shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };
const TEAMS: [CharacterDef[], CharacterDef[]] = [[CHAR, CHAR], [CHAR, CHAR]];
const config = (map: MapDef = OPEN): MatchConfig => ({ map, roster, teams: TEAMS });

class FakeSocket implements Sink {
  readonly sent: ServerMessage[] = [];
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage); }
  close(): void { /* not under test here */ }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
  /** The most recent message of a type — what a client would currently be showing. */
  latest<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.of(type).at(-1);
  }
}

const joinFrame = (name: string): string =>
  JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name });
const submitFrame = (orders: UnitOrders[]): string => JSON.stringify({ type: 'submit', orders });

/**
 * A full 2v2: seats s0/s2 on team 0, s1/s3 on team 1 (joins alternate).
 *
 * **Started by pressing start** (LOBBY-START, ruled 2026-09-11). Filling the
 * room used to be the trigger; it is not any more, because a full room is
 * exactly the moment a lobby has *not* been filled in yet. Nothing about
 * M3-HIDDEN changed — these seats never pick, so the config's interim deal is
 * what they play, as before.
 */
const running = (map: MapDef = OPEN) => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config(map));
  const sockets: Record<string, FakeSocket> = {};
  for (let i = 0; i < 4; i++) {
    const s = new FakeSocket();
    sockets[`s${i}`] = s;
    hub.open(`s${i}`, s);
    hub.receive(`s${i}`, joinFrame(`P${i}`));
  }
  hub.receive('s0', JSON.stringify({ type: 'start' }));
  return { hub, sockets };
};

const teamOf = (hub: RoomHub, seatId: string) =>
  hub.room.seats.find((s) => s.seatId === seatId)!.team;
const unitsOfTeam = (hub: RoomHub, team: 0 | 1) =>
  hub.room.state!.units.filter((u) => u.owner === team).map((u) => u.unitId);
const holdFor = (hub: RoomHub, seatId: string): UnitOrders[] =>
  hub.room.seats.find((s) => s.seatId === seatId)!.unitIds.map((unitId) => ({ unitId }));

describe('M3-HIDDEN: the Decision payload contains no enemy at all', () => {
  it('a team-0 seat is not sent team-1 positions', () => {
    // The whole item in one assertion. The spawns are twelve apart on a board
    // whose vision range is six, so every enemy is fogged — and "fogged" now
    // means *absent from the message*, not "present but drawn dark".
    const { hub, sockets } = running();
    const seat = hub.room.seats.find((s) => s.team === 0)!;
    const decision = sockets[seat.seatId]!.latest('decision')!;
    const enemies = unitsOfTeam(hub, 1);

    expect(decision.state.units.map((u) => u.unitId)).toEqual(unitsOfTeam(hub, 0));
    for (const id of enemies) {
      expect(JSON.stringify(decision), `enemy ${id} leaked into the payload`).not.toContain(id);
    }
  });

  it('a blanked-out enemy is not good enough — the array is short', () => {
    // A unit with its fields nulled still says "somebody is out there", and the
    // count alone tells you how many. Absence is the only filtering that leaks
    // nothing, so the length is asserted, not just the contents.
    const { hub, sockets } = running();
    const seat = hub.room.seats.find((s) => s.team === 0)!;
    expect(sockets[seat.seatId]!.latest('decision')!.state.units).toHaveLength(2);
    expect(hub.room.state!.units, 'the authoritative state still has four').toHaveLength(4);
  });

  it('both sides are filtered — this is not a team-0 privilege', () => {
    const { hub, sockets } = running();
    for (const seat of hub.room.seats) {
      const decision = sockets[seat.seatId]!.latest('decision')!;
      const theirs = decision.state.units.map((u) => u.owner);
      expect(new Set(theirs), `seat ${seat.seatId}`).toEqual(new Set([seat.team]));
    }
  });

  it('and it carries the fog itself, so the client need not re-derive it', () => {
    const { hub, sockets } = running();
    const seat = hub.room.seats.find((s) => s.team === 0)!;
    const decision = sockets[seat.seatId]!.latest('decision')!;
    expect(decision.visibleSquares.length).toBeGreaterThan(0);
    // Every lit square really is within sight of one of this team's units.
    const own = hub.room.state!.units.filter((u) => u.owner === 0);
    for (const p of decision.visibleSquares) {
      const near = own.some((u) => Math.abs(u.pos.x - p.x) + Math.abs(u.pos.y - p.y) <= VISION_RANGE);
      expect(near, `${p.x},${p.y} is lit but nobody can see it`).toBe(true);
    }
  });
});

describe('M3-HIDDEN: plans are team-vs-team, never within a team', () => {
  it('a teammate\'s submitted orders ARE in the payload', () => {
    // The other half of the rule, and the one a naive "hide everything" would
    // break: a 2v2 whose two players cannot see each other's plans is a
    // different game (edge-cases, Teams & control).
    const { hub, sockets } = running();
    const [mine, mate] = hub.room.seats.filter((s) => s.team === 0);
    hub.receive(mate!.seatId, submitFrame(holdFor(hub, mate!.seatId)));

    const decision = sockets[mine!.seatId]!.latest('decision')!;
    expect(Object.keys(decision.orders)).toEqual([mate!.seatId]);
  });

  it('the enemy\'s submitted orders are NOT', () => {
    const { hub, sockets } = running();
    const mine = hub.room.seats.find((s) => s.team === 0)!;
    const enemy = hub.room.seats.find((s) => s.team === 1)!;
    hub.receive(enemy.seatId, submitFrame(holdFor(hub, enemy.seatId)));

    const decision = sockets[mine.seatId]!.latest('decision')!;
    expect(decision.orders[enemy.seatId], 'the enemy plan is not there').toBeUndefined();
    // Not merely absent from the map: the enemy seat is nowhere in the orders
    // or the state at all — and since M3-LOCKLIST, nowhere in the message at
    // all, `locked` included. The whole payload is scanned.
    expect(JSON.stringify(decision)).not.toContain(enemy.seatId);
  });

  it('but the enemy lock COUNT is shared — you may know they are ready', () => {
    // M3-LOCKLIST: knowing somebody has locked in is not knowing what they
    // locked in, and a client with no idea what it is waiting for cannot show a
    // waiting state at all. A count says that; a seat id says more.
    const { hub, sockets } = running();
    const mine = hub.room.seats.find((s) => s.team === 0)!;
    const enemy = hub.room.seats.find((s) => s.team === 1)!;
    hub.receive(enemy.seatId, submitFrame([]));
    const decision = sockets[mine.seatId]!.latest('decision')!;
    expect(decision).toMatchObject({ enemyLocked: 1, enemyOf: 2 });
    expect(decision.locked, 'and my own team has not').toEqual([]);
  });

  it('while my own team\'s lock state stays per-seat — UI-INTENT needs it', () => {
    // A tick over the teammate who is ready is the whole point, and a count
    // cannot say which one that is.
    const { hub, sockets } = running();
    const [mine, mate] = hub.room.seats.filter((s) => s.team === 0);
    hub.receive(mate!.seatId, submitFrame(holdFor(hub, mate!.seatId)));
    const decision = sockets[mine!.seatId]!.latest('decision')!;
    expect(decision.locked).toEqual([mate!.seatId]);
    expect(decision.of, 'out of my own team, not the room').toBe(2);
  });
});

describe('M3-HIDDEN: concealment, not just distance', () => {
  it('a stealthed enemy standing next to you is still absent', () => {
    // Not a range test: the unit is adjacent. `visibleEnemiesForTeam` hides it,
    // and the filter inherits that without knowing what Stealth is.
    const { hub } = running();
    const state = structuredClone(hub.room.state!);
    const enemy = state.units.find((u) => u.owner === 1)!;
    enemy.pos = { x: 2, y: 7 }; // right beside a team-0 spawn
    enemy.statuses = [{ kind: 'stealth', remaining: 2 }];

    const view = teamView(OPEN, state, 0);
    expect(view.state.units.some((u) => u.unitId === enemy.unitId)).toBe(false);
  });

  it('an enemy in brush is absent, and the same enemy in the open is not', () => {
    const { hub } = running(BRUSHY);
    const state = structuredClone(hub.room.state!);
    const enemy = state.units.find((u) => u.owner === 1)!;
    const watcher = state.units.find((u) => u.owner === 0)!;
    watcher.pos = { x: 3, y: 7 };

    enemy.pos = { x: 6, y: 7 }; // in the thicket, three away
    expect(teamView(BRUSHY, state, 0).state.units.some((u) => u.unitId === enemy.unitId)).toBe(false);

    enemy.pos = { x: 5, y: 7 }; // one square out of it
    expect(teamView(BRUSHY, state, 0).state.units.some((u) => u.unitId === enemy.unitId)).toBe(true);
  });
});

describe('M3-HIDDEN: everything else a state carries is filtered too', () => {
  const stateWith = (hub: RoomHub) => structuredClone(hub.room.state!);

  it('an enemy trap on a square you cannot see is absent; your own never is', () => {
    const { hub } = running();
    const state = stateWith(hub);
    const trap = (owner: 0 | 1, x: number) => ({
      id: `t${owner}`, owner, ownerUnitId: `u${owner}`, abilityId: 'trap',
      pos: { x, y: 7 }, damage: 20, expiresOnTurn: 99, onTrigger: [],
    });
    state.traps = [trap(1, 12), trap(0, 12)];

    const view = teamView(OPEN, state, 0);
    expect(view.state.traps.map((t) => t.id), 'yours travels, theirs does not').toEqual(['t0']);
  });

  it('a delayed enemy ability is absent — it is a plan already locked in', () => {
    // The grenade that lands next turn. Shipping the caster and the squares
    // hands over the one thing a delayed ability trades on.
    const { hub } = running();
    const state = stateWith(hub);
    const mine = state.units.find((u) => u.owner === 0)!;
    const theirs = state.units.find((u) => u.owner === 1)!;
    state.delayed = [
      { casterUnitId: theirs.unitId, abilityId: 'boom', phase: 'blast', area: [{ x: 2, y: 7 }], turnsRemaining: 1 },
      { casterUnitId: mine.unitId, abilityId: 'boom', phase: 'blast', area: [{ x: 9, y: 7 }], turnsRemaining: 1 },
    ];
    const view = teamView(OPEN, state, 0);
    expect(view.state.delayed.map((d) => d.casterUnitId)).toEqual([mine.unitId]);
  });

  it('the enemy\'s last-known record is absent — it says what they believe', () => {
    // Worse than saying where you are: it says where they think you are, which
    // is the whole of what a chase into fog is guessing at.
    const { hub } = running();
    const state = stateWith(hub);
    state.lastKnown = [
      { team: 0, unitId: 'e1', pos: { x: 9, y: 7 }, turn: 1 },
      { team: 1, unitId: 'a1', pos: { x: 2, y: 7 }, turn: 1 },
    ];
    expect(teamView(OPEN, state, 0).state.lastKnown.map((k) => k.team)).toEqual([0]);
  });

  it('power-up pads survive whole — they are public terrain', () => {
    const padded: MapDef = { ...OPEN, powerups: [{ x: 7, y: 7, type: 'health', firstTurn: 1, everyTurns: 3 }] };
    const { hub } = running(padded);
    const view = teamView(padded, hub.room.state!, 0);
    expect(view.state.powerups, 'a pad is a feature of the map, not a secret').toEqual(hub.room.state!.powerups);
  });
});

describe('M3-HIDDEN: the event log is filtered, or the animation undoes the fog', () => {
  const state = () => running().hub.room.state!;

  it('an unseen enemy walking around produces no events for you', () => {
    const s = state();
    const theirs = s.units.find((u) => u.owner === 1)!;
    const events = filterEvents(
      [{ type: 'moveStep', unitId: theirs.unitId, from: { x: 13, y: 7 }, to: { x: 12, y: 7 } }],
      s, 0, new Set(),
    );
    expect(events, 'a client folding this would learn exactly where they went').toEqual([]);
  });

  it('…but an enemy you CAN see is animated normally', () => {
    const s = state();
    const theirs = s.units.find((u) => u.owner === 1)!;
    const events = filterEvents(
      [{ type: 'moveStep', unitId: theirs.unitId, from: { x: 13, y: 7 }, to: { x: 12, y: 7 } }],
      s, 0, new Set([theirs.unitId]),
    );
    expect(events).toHaveLength(1);
  });

  it('damage TO you survives even from a source you cannot see', () => {
    // Being shot by something invisible is a fact about you. Hiding it would
    // leave your own HP bar unexplained, which is a worse lie than the fog.
    const s = state();
    const mine = s.units.find((u) => u.owner === 0)!;
    const theirs = s.units.find((u) => u.owner === 1)!;
    const events = filterEvents(
      [{ type: 'damage', unitId: mine.unitId, amount: 20, absorbed: 0, sourceUnitId: theirs.unitId, abilityId: 'shot' }],
      s, 0, new Set(),
    );
    expect(events).toHaveLength(1);
  });

  it('a phase marker is kept for everybody — it carries no position', () => {
    const s = state();
    expect(filterEvents([{ type: 'phaseStart', phase: 'blast' }], s, 0, new Set())).toHaveLength(1);
  });

  it('your own chase is yours alone — the enemy never learns you made one', () => {
    const s = state();
    const mine = s.units.find((u) => u.owner === 0)!;
    const chase: Parameters<typeof filterEvents>[0] = [
      { type: 'chaseResolved', unitId: mine.unitId, targetUnitId: 'x', to: { x: 5, y: 5 }, seen: true },
    ];
    expect(filterEvents(chase, s, 0, new Set())).toHaveLength(1);
    expect(filterEvents(chase, s, 1, new Set([mine.unitId])), 'not even when they can see you').toHaveLength(0);
  });
});

describe('M3-HIDDEN: locking in is what opens the boundary', () => {
  it('the resolution reveals BOTH teams\' orders', () => {
    // The reveal is the payoff for planning blind. A filter nobody ever turns
    // off is not a hidden-information rule, it is a broken game.
    const { hub, sockets } = running();
    for (const seat of hub.room.seats) hub.receive(seat.seatId, submitFrame(holdFor(hub, seat.seatId)));

    const seat0 = hub.room.seats.find((s) => s.team === 0)!;
    const resolved = sockets[seat0.seatId]!.latest('turnResolved')!;
    expect(Object.keys(resolved.orders).sort(), 'every seat, both teams')
      .toEqual(hub.room.seats.map((s) => s.seatId).sort());
  });

  it('…and nothing was revealed one message earlier', () => {
    const { hub, sockets } = running();
    const seat0 = hub.room.seats.find((s) => s.team === 0)!;
    const enemy = hub.room.seats.find((s) => s.team === 1)!;

    // Three of four in: still the Decision phase, still secret.
    for (const seat of hub.room.seats.slice(0, 3)) {
      hub.receive(seat.seatId, submitFrame(holdFor(hub, seat.seatId)));
    }
    const before = sockets[seat0.seatId]!.latest('decision')!;
    expect(before.orders[enemy.seatId]).toBeUndefined();
    expect(sockets[seat0.seatId]!.of('turnResolved'), 'nothing resolved yet').toHaveLength(0);
  });

  it('the post-turn state is still fogged — the reveal is the log, not the board', () => {
    // Otherwise every turn would end by handing both teams the whole board, and
    // the next Decision phase would start from perfect knowledge.
    const { hub, sockets } = running();
    for (const seat of hub.room.seats) hub.receive(seat.seatId, submitFrame(holdFor(hub, seat.seatId)));
    const seat0 = hub.room.seats.find((s) => s.team === 0)!;
    const resolved = sockets[seat0.seatId]!.latest('turnResolved')!;
    expect(resolved.state.units.map((u) => u.owner)).toEqual([0, 0]);
  });

  it('and the next Decision phase opens already filtered', () => {
    const { hub, sockets } = running();
    for (const seat of hub.room.seats) hub.receive(seat.seatId, submitFrame(holdFor(hub, seat.seatId)));
    const seat0 = hub.room.seats.find((s) => s.team === 0)!;
    const next = sockets[seat0.seatId]!.latest('decision')!;
    expect(next.turn, 'turn 2').toBe(2);
    expect(next.orders, 'and nobody has submitted yet').toEqual({});
    expect(next.state.units.map((u) => u.owner)).toEqual([0, 0]);
  });
});

describe('M3-HIDDEN: the server filters views and never re-simulates', () => {
  it('the authoritative state is untouched by the filtering', () => {
    // A filter that mutated the room would be a second simulation, and a second
    // simulation is a second answer waiting to disagree with the first.
    const { hub } = running();
    const before = JSON.stringify(hub.room.state);
    for (const team of [0, 1] as const) teamView(OPEN, hub.room.state!, team);
    expect(JSON.stringify(hub.room.state)).toEqual(before);
  });

  it('two seats on one team receive the same view', () => {
    const { hub, sockets } = running();
    const [a, b] = hub.room.seats.filter((s) => s.team === 0);
    const va = sockets[a!.seatId]!.latest('decision')!;
    const vb = sockets[b!.seatId]!.latest('decision')!;
    expect(JSON.stringify(va.state)).toEqual(JSON.stringify(vb.state));
  });
});
