import { describe, expect, it } from 'vitest';
import { DECISION_SECONDS, type CharacterDef, type MapDef, type Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { RoomDurableObject } from '../src/durable-object.js';
import worker, { type Env } from '../src/worker.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { createRoom } from '../src/room.js';

/**
 * QUOTA-RUNAWAY — the outage of 2026-08-19, pinned so it cannot return.
 *
 * A match everyone abandoned used to reopen a decision window after every
 * timed-out resolve: the Durable Object's alarm resolved a hold-position turn,
 * `#sendDecision` opened the next window, `#arm` set the next alarm — forever,
 * because hold-position turns never score the kill that ends sudden death.
 * Every tick wrote storage rows, and rows written are a metered resource: the
 * free tier's daily allowance ran out and **every room in the account** failed
 * to create, surfacing in the browser as "TypeError: Failed to fetch" because
 * the runtime's error page carries no CORS header.
 *
 * Three layers, three suites below:
 *  1. the hub opens a window only while somebody is attached — no sinks, no
 *     clock, no alarm; a reclaim resumes it;
 *  2. the DO skips writes that change nothing — persisting an identical record
 *     and re-arming an unchanged alarm are no-ops;
 *  3. the Worker turns an exception into a CORS'd JSON error the client can
 *     actually display, instead of an uncorsed 1101.
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
}

const JOIN = JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name: 'P' });
const START = JSON.stringify({ type: 'start' });
const RECLAIM = (seatId: string): string =>
  JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name: 'P', seatId });

/** A started 1v1 on a clock the test drives. */
const started = () => {
  const clock = { t: 1_000_000 };
  const hub = new RoomHub(createRoom('WXYZ', '1v1'), config, () => clock.t);
  for (const id of ['s0', 's1']) {
    hub.open(id, new FakeSocket());
    hub.receive(id, JOIN);
  }
  hub.receive('s0', START);
  return { hub, clock };
};

describe('QUOTA-RUNAWAY: an abandoned match goes quiet', () => {
  it('closes the window when the last socket drops and never reopens it unattended', () => {
    const { hub, clock } = started();
    expect(hub.deadline).toBeDefined();

    hub.close('s0');
    expect(hub.deadline).toBeDefined(); // one player still attached — clock runs
    hub.close('s1');
    // The window that was open when the last socket dropped survives it, so
    // the alarm already armed fires once more...
    clock.t = hub.deadline! + 1;
    hub.expire();
    // ...resolves for nobody, and with no sinks attached opens no next window.
    expect(hub.deadline).toBeUndefined();

    // Hours of spurious alarm fires later: still no window, and the match is
    // frozen rather than grinding out empty turns.
    const frozenAt = hub.room.turn;
    for (let i = 0; i < 5; i++) {
      clock.t += DECISION_SECONDS * 1000 + 1;
      hub.expire();
    }
    expect(hub.deadline).toBeUndefined();
    expect(hub.room.turn).toBe(frozenAt);
  });

  it('an unattended timeout resolves the open window once, then stops', () => {
    const { hub, clock } = started();
    hub.close('s0');
    const openWindow = hub.deadline;
    expect(openWindow).toBeDefined();
    // s1's socket dies without a clean close event — the window it was given
    // stays open, so the alarm already armed for it fires once...
    hub.close('s1');
    if (hub.deadline !== undefined) {
      clock.t = hub.deadline + 1;
      hub.expire();
    }
    // ...and finds nobody to give the next turn to.
    expect(hub.deadline).toBeUndefined();
  });

  it('a reclaim reopens the clock exactly where a window would start', () => {
    const { hub, clock } = started();
    hub.close('s0');
    hub.close('s1');
    clock.t = hub.deadline! + 1; // the trailing window fires and goes quiet
    hub.expire();
    expect(hub.deadline).toBeUndefined();

    clock.t += 3_600_000;
    hub.open('n1', new FakeSocket());
    hub.receive('n1', RECLAIM('s0'));
    expect(hub.deadline).toBe(clock.t + DECISION_SECONDS * 1000);
  });
});

// ── The Durable Object writes only what changed ─────────────────────────────

class FakeStorage {
  puts = 0;
  alarmsSet: number[] = [];
  alarmsDeleted = 0;
  readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.data.get(key) as T | undefined; }
  async put(key: string, value: unknown): Promise<void> {
    this.puts++;
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
  async setAlarm(t: number): Promise<void> { this.alarmsSet.push(t); }
  async deleteAlarm(): Promise<void> { this.alarmsDeleted++; }
}

class FakeState {
  readonly storage = new FakeStorage();
  restored: Promise<void> = Promise.resolve();
  blockConcurrencyWhile(fn: () => Promise<void>): Promise<void> {
    this.restored = fn();
    return this.restored;
  }
}

const bootedRoom = async (): Promise<{ dobj: RoomDurableObject; state: FakeState }> => {
  const state = new FakeState();
  const dobj = new RoomDurableObject(state as unknown as DurableObjectState);
  await state.restored;
  await dobj.fetch(new Request('https://room/create?code=WXYZ&format=2v2'));
  return { dobj, state };
};

describe('QUOTA-RUNAWAY: the DO skips no-op writes', () => {
  it('persists a record once, not once per occasion', async () => {
    const { dobj, state } = await bootedRoom();
    expect(state.storage.puts).toBe(1); // the create itself

    // An alarm fire (or any frame) that changes nothing writes nothing.
    await dobj.alarm();
    await dobj.alarm();
    expect(state.storage.puts).toBe(1);
  });

  it('clears an unarmed alarm once, then leaves the storage alone', async () => {
    const { dobj, state } = await bootedRoom();
    await dobj.alarm(); // lobby: no deadline → the alarm is cleared...
    expect(state.storage.alarmsDeleted).toBe(1);
    await dobj.alarm(); // ...and a second fire knows it already is
    expect(state.storage.alarmsDeleted).toBe(1);
    expect(state.storage.alarmsSet).toEqual([]);
  });
});

// ── The Worker fails legibly ────────────────────────────────────────────────

/** A namespace whose rooms are broken the way the quota outage broke them. */
class ThrowingNamespace {
  idFromName(name: string): { name: string } { return { name }; }
  get() {
    return {
      fetch: async (): Promise<Response> => {
        throw new Error('Exceeded allowed rows written in Durable Objects free tier.');
      },
    };
  }
}

const env = (ns: unknown): Env => ({ ROOMS: ns as Env['ROOMS'] });

describe('QUOTA-RUNAWAY: a Worker exception reaches the browser as an answer', () => {
  it('turns a thrown error into CORS’d JSON naming the cause', async () => {
    const response = await worker.fetch(
      new Request('https://x/rooms?format=2v2', { method: 'POST' }),
      env(new ThrowingNamespace()),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Exceeded allowed rows written');
  });
});
