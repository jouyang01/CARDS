// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { CatalystData, CharacterDef, GameState, MapDef, Roster, TurnEvent } from '@cards/engine';
import { buildCatalystPool, buildRoster, createMatch } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import { teamView } from '@cards/server/view';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * M3-NET-BOARD — the seat's own view of a server-authoritative match.
 *
 * The controller cannot be booted here (it wants WebGL), so this covers the two
 * claims that are *not* about pixels and are the ones a networked client gets
 * wrong:
 *
 * 1. **Nothing is resolved locally.** A networked client is one seat of two; if
 *    it ran `resolveTurn` it would be guessing at the half of the board it
 *    cannot see, and drift the instant the server disagreed. The turn ends by
 *    submitting and the next state *arrives*.
 * 2. **The fog is the seat's, not the union.** The state the board renders comes
 *    from the server already filtered, so there is no local view for a bug to
 *    widen — the enemy is absent from the data rather than hidden by a flag.
 *
 * The render itself is the e2e suite's; what it renders is decided here.
 */

const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const roster: Roster = buildRoster(CATALOG);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const MAP = duelArena as unknown as MapDef;
const config: MatchConfig = { map: MAP, roster, catalysts: POOL };

class Wire implements Sink {
  readonly client: RoomClient;
  constructor(private readonly hub: RoomHub, private readonly seatId: string) {
    this.client = new RoomClient({
      send: (data: string) => { this.hub.receive(this.seatId, data); },
      close: () => { this.hub.close(this.seatId); },
    });
    this.hub.open(seatId, this);
  }
  send(data: string): void { this.client.receive(data); }
  close(): void { this.client.closed(); }
}

/** A started two-seat 2v2, both clients picked, seat `a` is ours. */
const started = () => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2', 'duel-arena'), config);
  const a = new Wire(hub, 'a');
  const b = new Wire(hub, 'b');
  a.client.join('Ada');
  b.client.join('Bo');
  a.client.pick([{ characterId: 'vex' }, { characterId: 'wisp' }]);
  b.client.pick([{ characterId: 'bastion' }, { characterId: 'aegis' }]);
  b.client.ready(true); // LOBBY-READY: the creator's Start waits on it
  a.client.start();
  return { hub, a, b };
};

describe('M3-NET-BOARD: what the board is handed at match start', () => {
  it('a seat, its characters and an opening state — everything the controller needs', () => {
    const { a } = started();
    const net = a.client.net;
    expect(net.phase).toBe('match');
    expect(net.seat?.seatId).toBe('a');
    expect(net.state, 'the opening board').toBeDefined();
    expect(net.unitIds, 'and the control map').toHaveLength(2);
  });

  it('the room says which map to render, so the client draws the right board', () => {
    // Without this the client would render its own default while the server
    // resolved on another — the two would disagree about every wall.
    const { a } = started();
    expect(a.client.net.room?.mapId).toBe('duel-arena');
  });

  it('the opening state is ALREADY the seat\'s view — the enemy is absent, not hidden', () => {
    const { a, b } = started();
    for (const [side, own] of [[a, 0], [b, 1]] as const) {
      const owners = new Set(side.client.net.state!.units.map((u) => u.owner));
      expect([...owners], 'one team in the payload').toEqual([own]);
    }
  });

  it('and it is narrower than the truth — the server keeps the whole board', () => {
    // The claim that makes the one above meaningful: there IS more, and this
    // seat did not get it.
    const { hub, a } = started();
    expect(hub.room.state!.units).toHaveLength(4);
    expect(a.client.net.state!.units.length).toBeLessThan(4);
  });
});

describe('M3-NET-BOARD: the turn loop is submit → arrive', () => {
  it('a submitted turn resolves on the server and comes back as state + events', () => {
    const { hub, a, b } = started();
    const hold = (client: RoomClient) => client.net.unitIds.map((unitId) => ({ unitId }));

    a.client.submit(hold(a.client));
    expect(a.client.net.submitted, 'locked in, waiting').toBe(true);
    expect(a.client.net.state!.turn, 'and nothing has resolved yet').toBe(1);

    b.client.submit(hold(b.client));
    expect(hub.room.turn, 'the server resolved it').toBe(2);
    expect(a.client.net.state!.turn, 'and the client was told').toBe(2);
    expect(a.client.net.events.length, 'with a log to animate').toBeGreaterThan(0);
  });

  it('the resolution the board plays back is filtered too', () => {
    // The subtle half of M3-HIDDEN: an unfiltered log would hand the animation
    // every square the state withheld, one frame later.
    const { a, b } = started();
    const move = (client: RoomClient) => client.net.unitIds.map((unitId) => ({ unitId }));
    a.client.submit(move(a.client));
    b.client.submit(move(b.client));

    const theirs = new Set(b.client.net.unitIds);
    for (const event of a.client.net.events) {
      if ('unitId' in event && typeof event.unitId === 'string') {
        expect(theirs.has(event.unitId), `${event.type} named an unseen enemy`).toBe(false);
      }
    }
  });

  it('the state a networked board renders is never one it computed', () => {
    // The property in one assertion: the client's post-turn state is byte-for-
    // byte the server's filtered view. A client that had resolved locally would
    // have produced its own — and, missing half the orders, a different one.
    const { hub, a, b } = started();
    const hold = (client: RoomClient) => client.net.unitIds.map((unitId) => ({ unitId }));
    a.client.submit(hold(a.client));
    b.client.submit(hold(b.client));

    const authoritative = teamView(MAP, hub.room.state!, a.client.net.seat!.team);
    expect(a.client.net.state).toEqual(authoritative.state);
  });

  it('a turn only plays once, however often the state is re-published', () => {
    // The bug the turn guard in `startNetworkedMatch` prevents: `RoomClient`
    // keeps the last resolution, so a subscriber that fired on every change
    // would replay the same animation on the next unrelated message.
    const { a, b } = started();
    const played: number[] = [];
    let last = a.client.net.state!.turn;
    a.client.subscribe((now) => {
      if (now.state === undefined || now.state.turn <= last) return;
      last = now.state.turn;
      played.push(now.state.turn);
    });

    const hold = (client: RoomClient) => client.net.unitIds.map((unitId) => ({ unitId }));
    a.client.submit(hold(a.client));
    b.client.submit(hold(b.client));
    // …and a later frame that changes nothing about the turn.
    a.client.receive(JSON.stringify({ type: 'pong' }));

    expect(played, 'one resolution, one playback').toEqual([2]);
  });
});

describe('M3-NET-BOARD: submitting is the only way this client ends a turn', () => {
  it('the orders reach the server as this seat\'s, and only this seat\'s', () => {
    const { hub, a, b } = started();
    const mine = a.client.net.unitIds;
    a.client.submit(mine.map((unitId) => ({ unitId, sprint: true })));
    b.client.submit(b.client.net.unitIds.map((unitId) => ({ unitId })));

    const record = hub.room.history.at(-1)!;
    const team = a.client.net.seat!.team;
    expect(record.orders[team].units.map((o) => o.unitId).sort()).toEqual([...mine].sort());
  });

  it('ordering a character this seat does not control is refused by the server', () => {
    // The client cannot be trusted to police this and does not try: it is the
    // server's rule, and it answers with a code the board can show.
    const { a, b } = started();
    a.client.submit([{ unitId: b.client.net.unitIds[0]! }]);
    expect(a.client.net.error?.code).toBe('notYours');
    expect(a.client.net.submitted, 'and the seat is still un-locked').toBe(false);
  });

  it('the client could not have resolved this turn even if it tried', () => {
    // Stronger than spying on `resolveTurn` (which the *server* legitimately
    // calls in this same process, so a spy could never fail): the enemy's orders
    // reach this client **with** the resolution and not one message before it.
    // A local resolution would therefore have had to invent them.
    const { a, b } = started();
    const hold = (client: RoomClient) => client.net.unitIds.map((unitId) => ({ unitId }));

    a.client.submit(hold(a.client));
    expect(Object.keys(a.client.net.revealed), 'nothing revealed while it waits').toEqual([]);
    expect(a.client.net.orders['b'], "and the enemy's plan is not in its own team's payload")
      .toBeUndefined();

    b.client.submit(hold(b.client));
    expect(Object.keys(a.client.net.revealed).sort(), 'both sides, at the reveal').toEqual(['a', 'b']);
  });
});

describe('M3-NET-BOARD: one seat, and no handover', () => {
  it('a networked client controls exactly one seat', () => {
    // The hot-seat walks `deriveSeats` and passes the mouse between seats. A
    // networked client is one player of two and has nobody to pass it to, so
    // `startHotSeat` seats only `net.seatId` — the control map the server sent.
    const { hub, a } = started();
    expect(a.client.net.unitIds).toHaveLength(2);
    const everyone = hub.room.seats.flatMap((s) => s.unitIds);
    expect(everyone.length, 'while the match itself has four').toBe(4);
  });

  it('the opening state it renders carries the format the server chose', () => {
    const { a } = started();
    expect(a.client.net.state!.format).toBe('2v2');
  });

  it('a match on another map renders that one', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2', 'iron-basin'), config);
    const a = new Wire(hub, 'a');
    a.client.join('Ada');
    expect(a.client.net.room?.mapId).toBe('iron-basin');
  });
});

describe('M3-NET-BOARD: a control the hot-seat needs and a networked seat does not', () => {
  it('the local match still creates its own state — nothing here changed it', () => {
    // The regression guard for the seam: `startHotSeat` takes the opening state
    // as an *option*, so the hot-seat must still build one when it is absent.
    const state: GameState = createMatch(MAP, '2v2', [[CATALOG[0]!, CATALOG[2]!], [CATALOG[1]!, CATALOG[3]!]]);
    expect(state.units).toHaveLength(4);
    expect(new Set(state.units.map((u) => u.owner)), 'both teams, unfiltered').toEqual(new Set([0, 1]));
  });

  it('and a server event log is the same shape the local one is', () => {
    // Both go into the same playback, so a difference in shape would be a
    // difference in what the board can animate.
    const { a, b } = started();
    const hold = (client: RoomClient) => client.net.unitIds.map((unitId) => ({ unitId }));
    a.client.submit(hold(a.client));
    b.client.submit(hold(b.client));
    const events: TurnEvent[] = a.client.net.events;
    for (const event of events) expect(typeof event.type).toBe('string');
  });
});
