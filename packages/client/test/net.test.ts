import { describe, expect, it } from 'vitest';
import type { CharacterDef, MapDef, Roster, UnitOrders } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient, applyServerMessage, initialNet, type NetState } from '../src/net.js';

/**
 * M3-LOBBY (client half) — the network client, driven by a real server.
 *
 * Two halves, and they are different kinds of test:
 *
 * 1. **The reducer.** `applyServerMessage` is pure, so the cases that matter are
 *    the ones where a frame means *forget* something — a resolution clearing
 *    last turn's plans, a match start leaving the lobby behind, a refusal
 *    changing nothing. Those are the bugs that survive a happy-path demo.
 * 2. **The wire, end to end.** Two `RoomClient`s wired to one real `RoomHub`,
 *    with nothing faked in between. This is the AC's proof that the client
 *    consumes a `decision` and a filtered `turnResolved` — and, because the hub
 *    is the real one, it is also M3-HIDDEN demonstrated rather than asserted: if
 *    the filtering broke, an enemy position would appear in a client's state
 *    here, in this file, without anybody having to remember to check.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 9 }, { x: 1, y: 11 }], [{ x: 19, y: 9 }, { x: 19, y: 11 }]],
};
const shot = {
  id: 'shot', name: 'shot', phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 20 }],
  description: 'shot',
};
const character = (id: string): CharacterDef => ({
  id, name: id, archetype: 'firepower', maxHp: 100,
  abilities: [shot],
  ultimate: { ...shot, id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] },
});
const roster: Roster = Object.fromEntries(
  ['ash', 'bry', 'cyn', 'dex'].map((id) => [id, character(id)]),
);
const config: MatchConfig = {
  map: OPEN, roster, teams: [[roster['ash']!, roster['bry']!], [roster['cyn']!, roster['dex']!]],
};

/**
 * A `RoomClient` and a `Sink` glued back to back: what the hub sends, the client
 * receives, with no transport in the middle. The socket is the seam, and both
 * sides of it are the real implementations.
 */
class Wire implements Sink {
  readonly client: RoomClient;
  readonly frames: string[] = [];
  constructor(private readonly hub: RoomHub, private readonly seatId: string) {
    this.client = new RoomClient({
      send: (data: string) => { this.hub.receive(this.seatId, data); },
      close: () => { this.hub.close(this.seatId); },
    });
    this.hub.open(seatId, this);
  }
  send(data: string): void {
    this.frames.push(data);
    this.client.receive(data);
  }
  close(): void { this.client.closed(); }
  get net(): NetState { return this.client.net; }
}

/** A started 1-seat-per-team 2v2, both clients joined and picked. */
const started = (): { hub: RoomHub; a: Wire; b: Wire } => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
  const a = new Wire(hub, 'a');
  const b = new Wire(hub, 'b');
  a.client.join('A');
  b.client.join('B');
  a.client.pick([{ characterId: 'ash' }, { characterId: 'bry' }]);
  b.client.pick([{ characterId: 'cyn' }, { characterId: 'dex' }]);
  a.client.start();
  return { hub, a, b };
};

describe('the network client folds a lobby', () => {
  it('a join makes it a lobby, and the seat is its own', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    const a = new Wire(hub, 'a');
    expect(a.net.phase, 'nothing has happened yet').toBe('connecting');
    a.client.join('A');
    expect(a.net.phase).toBe('lobby');
    expect(a.net.seat?.seatId).toBe('a');
    expect(a.net.seat?.name).toBe('A');
  });

  it('a pick comes back through the lobby payload, and the enemy is a count', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    const a = new Wire(hub, 'a');
    const b = new Wire(hub, 'b');
    a.client.join();
    b.client.join();
    a.client.pick([{ characterId: 'ash' }, { characterId: 'bry' }]);

    expect(a.net.lobby?.picks['a']?.map((p) => p.characterId)).toEqual(['ash', 'bry']);
    expect(b.net.lobby?.picks['a'], 'the enemy never receives it').toBeUndefined();
    expect(b.net.lobby?.enemyReady, 'only that they are done').toBe(1);
    expect(a.net.lobby?.canStart, 'and we are not, until they pick').toBe(false);
  });

  it('a refused pick surfaces the code and changes nothing else', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    const a = new Wire(hub, 'a');
    new Wire(hub, 'b').client.join();
    a.client.join();
    a.client.pick([{ characterId: 'ash' }, { characterId: 'bry' }]);
    const before = a.net.lobby;

    a.client.pick([{ characterId: 'ash' }]); // one short
    expect(a.net.error?.code).toBe('wrongCount');
    expect(a.net.lobby, 'the accepted picks are untouched').toBe(before);
  });

  it('and starting leaves the lobby behind for a board', () => {
    const { a } = started();
    expect(a.net.phase).toBe('match');
    expect(a.net.lobby, 'no pick screen over the match').toBeUndefined();
    expect(a.net.state).toBeDefined();
    expect(a.net.unitIds, 'the control map arrived with it').toHaveLength(2);
  });
});

describe('the network client consumes a decision and a filtered resolution', () => {
  it('the decision arrives fogged — the enemy is simply not in it', () => {
    // M3-HIDDEN, end to end and unfaked: the spawns are 18 squares apart, well
    // outside VISION_RANGE, so a client that could see an enemy unit here could
    // only have got it from the wire.
    const { a, b } = started();
    for (const [side, own] of [[a, 0], [b, 1]] as const) {
      const owners = new Set(side.net.state!.units.map((u) => u.owner));
      expect([...owners], 'only its own team').toEqual([own]);
    }
    expect(a.net.of, 'and it knows what it is waiting for').toBe(1);
    expect(a.net.enemyOf).toBe(1);
  });

  it('submitting locks this client in, and the server is what says so', () => {
    const { a } = started();
    expect(a.net.submitted).toBe(false);
    const orders: UnitOrders[] = [{ unitId: a.net.unitIds[0]!, movePath: [{ x: 2, y: 9 }] }];
    a.client.submit(orders);
    expect(a.net.submitted).toBe(true);
  });

  it('a turn resolves into events, a reveal, and a cleared plan', () => {
    const { a, b } = started();
    a.client.submit([{ unitId: a.net.unitIds[0]!, movePath: [{ x: 2, y: 9 }] }]);
    b.client.submit([{ unitId: b.net.unitIds[0]!, movePath: [{ x: 18, y: 9 }] }]);

    expect(a.net.events.length, 'a log to animate').toBeGreaterThan(0);
    expect(Object.keys(a.net.revealed).sort(), 'both teams, revealed at last').toEqual(['a', 'b']);
    expect(a.net.submitted, 'and a fresh turn to plan').toBe(false);
    expect(a.net.orders, 'last turn`s plans are not this turn`s').toEqual({});
    expect(a.net.state!.turn).toBe(2);
  });

  it('the resolved log is filtered too, or the fog would be undone by the replay', () => {
    // The subtle half of M3-HIDDEN: a client that folded an unfiltered event log
    // would learn every square the state withheld, one animation later.
    const { a, b } = started();
    a.client.submit([{ unitId: a.net.unitIds[0]!, movePath: [{ x: 2, y: 9 }] }]);
    b.client.submit([{ unitId: b.net.unitIds[0]!, movePath: [{ x: 18, y: 9 }] }]);

    const theirs = new Set(b.net.unitIds);
    for (const event of a.net.events) {
      if ('unitId' in event && typeof event.unitId === 'string') {
        expect(theirs.has(event.unitId), `${event.type} named an unseen enemy`).toBe(false);
      }
    }
  });

  it('an order for a character this seat does not control is refused, not dropped', () => {
    const { a, b } = started();
    a.client.submit([{ unitId: b.net.unitIds[0]!, movePath: [{ x: 18, y: 9 }] }]);
    expect(a.net.error?.code).toBe('notYours');
    expect(a.net.submitted, 'and the seat is still un-locked').toBe(false);
  });
});

describe('the reducer, on the frames that mean "forget something"', () => {
  const seatOf = (net: NetState) => net.seat!.seatId;

  it('an error clears nothing — a refused message did not happen', () => {
    const before: NetState = { ...initialNet(), phase: 'lobby', unitIds: ['u'], submitted: true };
    const after = applyServerMessage(before, { type: 'error', code: 'notYours', message: 'no' });
    expect(after.error?.code).toBe('notYours');
    expect(after.phase).toBe('lobby');
    expect(after.unitIds).toEqual(['u']);
    expect(after.submitted, 'especially not the lock state').toBe(true);
  });

  it('the next successful frame clears the error', () => {
    const errored = applyServerMessage(initialNet(), { type: 'error', code: 'roomFull', message: 'x' });
    expect(applyServerMessage(errored, { type: 'pong' }).error).toBeUndefined();
  });

  it('a decision trusts the server`s lock list over any local optimism', () => {
    // The bug this closes: an optimistic `submitted` that a refusal never
    // cleared would leave the Lock In button dead for the rest of the turn.
    const joined = applyServerMessage(initialNet(), {
      type: 'joined',
      seat: { seatId: 'a', team: 0, name: 'a', unitIds: [], picks: [] },
      room: { code: 'WXYZ', format: '2v2', seats: [], turn: 0, canStart: false, started: false, locked: [] },
    });
    expect(seatOf(joined)).toBe('a');
    const optimistic: NetState = { ...joined, submitted: true };
    const decision = applyServerMessage(optimistic, {
      type: 'decision', turn: 1, state: { turn: 1, units: [] } as never, visibleSquares: [],
      orders: {}, locked: [], of: 1, enemyLocked: 0, enemyOf: 1, bank: 1,
    });
    expect(decision.submitted, 'the server did not list us').toBe(false);
  });

  it('a close is terminal — a client that is out shows no room', () => {
    const client = new RoomClient({ send: () => {}, close: () => {} });
    client.closed();
    expect(client.net.phase).toBe('closed');
  });

  it('a malformed frame is ignored rather than crashing the client', () => {
    const client = new RoomClient({ send: () => {}, close: () => {} });
    for (const raw of ['not json', '[]', 'null', '{"nope":1}']) client.receive(raw);
    expect(client.net).toEqual(initialNet());
  });

  it('subscribers see every change, and can unsubscribe', () => {
    const client = new RoomClient({ send: () => {}, close: () => {} });
    const seen: NetState[] = [];
    const off = client.subscribe((n) => seen.push(n));
    client.receive(JSON.stringify({ type: 'pong' }));
    off();
    client.receive(JSON.stringify({ type: 'pong' }));
    expect(seen).toHaveLength(1);
  });
});
