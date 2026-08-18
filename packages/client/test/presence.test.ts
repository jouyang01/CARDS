// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { CharacterDef, MapDef, Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import type { Seat } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import {
  AWAY_LABEL, AWAY_MARK, NO_PRESENCE, coverNotice, isAway, isBorrowed, presenceOf,
} from '../src/presence.js';
import { seatRows } from '../src/lobby.js';
import { createLobbyScreen } from '../src/lobby-screen.js';
import { scoreReadout, topbar } from '../src/scoreboard.js';
import { createMatch } from '@cards/engine';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * NET-PRESENCE-UI — the two things the server has been saying and no screen drew.
 *
 * 1. `RoomView.seats[].connected`: a dropped player keeps their seat
 *    (M3-RECONNECT holds it), so every screen listed them looking exactly like
 *    somebody who was there and slow.
 * 2. The handoff: after one fully missed turn a teammate's board silently grew
 *    the absent player's characters.
 *
 * Both are display gaps, so what is pinned here is that the client **reads** the
 * server's answers and computes no rule of its own. The sharpest version of that
 * is the last test in the first block: `coveringFor` is derived from the control
 * map the server sent, so a client that guessed the handoff rule instead would
 * get a *different* answer the moment the two disagreed.
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
const roster: Roster = Object.fromEntries(['ash', 'bry', 'cyn', 'dex'].map((id) => [id, character(id)]));
const config: MatchConfig = {
  map: OPEN, roster, teams: [[roster['ash']!, roster['bry']!], [roster['cyn']!, roster['dex']!]],
};

const seat = (over: Partial<Seat> & { seatId: string }): Seat => ({
  team: 0, name: over.seatId, unitIds: [], picks: [], connected: true, missedTurns: 0, ...over,
});

describe('NET-PRESENCE-UI: reading presence off what the server sent', () => {
  it('an absent seat is named, and its characters are the ones to mark', () => {
    const presence = presenceOf({
      seats: [
        seat({ seatId: 'a', name: 'Ada', unitIds: ['u1'] }),
        seat({ seatId: 'b', name: 'Bo', unitIds: ['u2'], connected: false }),
      ],
      mySeatId: 'a',
      controls: ['u1'],
    });
    expect(presence.awaySeatIds).toEqual(['b']);
    expect(presence.awayNames, 'a person, not an id').toEqual(['Bo']);
    expect(presence.awayUnitIds).toEqual(['u2']);
    expect(isAway(presence, 'u2')).toBe(true);
    expect(isAway(presence, 'u1'), 'and mine is not').toBe(false);
  });

  it('an absent OPPONENT is shown too — an empty chair is not hidden information', () => {
    // A match that quietly continued against nobody is the most confusing
    // version of all, and how many people are in the room has always been public.
    const presence = presenceOf({
      seats: [
        seat({ seatId: 'a', team: 0, unitIds: ['u1'] }),
        seat({ seatId: 'z', team: 1, name: 'Zed', unitIds: ['u9'], connected: false }),
      ],
      mySeatId: 'a',
      controls: ['u1'],
    });
    expect(presence.awayNames).toEqual(['Zed']);
    expect(presence.borrowedUnitIds, 'but nobody covers for the other side').toEqual([]);
  });

  it('borrowed is set arithmetic on ids the server sent, not a re-derived rule', () => {
    // "In my control map and not on my own seat" is the whole definition. The
    // client never asks *whether* the handoff should have happened.
    const presence = presenceOf({
      seats: [
        seat({ seatId: 'a', name: 'Ada', unitIds: ['u1'] }),
        seat({ seatId: 'b', name: 'Bo', unitIds: ['u2', 'u3'], connected: false }),
      ],
      mySeatId: 'a',
      controls: ['u1', 'u2', 'u3'],
    });
    expect(presence.borrowedUnitIds).toEqual(['u2', 'u3']);
    expect(isBorrowed(presence, 'u2')).toBe(true);
    expect(isBorrowed(presence, 'u1'), 'my own are not borrowed').toBe(false);
    expect(presence.coveringFor).toEqual(['Bo']);
  });

  it('and it follows the server even when the server has not handed over yet', () => {
    // The turn of the drop: `connected` is false, `missedTurns` is 0, and the
    // control map still has only my own. A client that had guessed the rule
    // would already be showing me somebody else's characters.
    const presence = presenceOf({
      seats: [
        seat({ seatId: 'a', name: 'Ada', unitIds: ['u1'] }),
        seat({ seatId: 'b', name: 'Bo', unitIds: ['u2'], connected: false }),
      ],
      mySeatId: 'a',
      controls: ['u1'],
    });
    expect(presence.awaySeatIds, 'they are still away').toEqual(['b']);
    expect(presence.borrowedUnitIds, 'and I am still not covering').toEqual([]);
    expect(coverNotice(presence)).toBeUndefined();
  });

  it('the notice names the teammate; nothing to explain means nothing said', () => {
    expect(coverNotice(NO_PRESENCE)).toBeUndefined();
    const two = presenceOf({
      seats: [
        seat({ seatId: 'a', unitIds: ['u1'] }),
        seat({ seatId: 'b', name: 'Bo', unitIds: ['u2'], connected: false }),
        seat({ seatId: 'c', name: 'Cy', unitIds: ['u3'], connected: false }),
      ],
      mySeatId: 'a',
      controls: ['u1', 'u2', 'u3'],
    });
    expect(coverNotice(two)).toMatch(/Bo and Cy/);
    expect(coverNotice(two)).toMatch(/covering/i);
  });

  it('a borrowed character whose seat has gone is unexplained rather than misattributed', () => {
    const presence = presenceOf({
      seats: [seat({ seatId: 'a', unitIds: ['u1'] })],
      mySeatId: 'a',
      controls: ['u1', 'ghost'],
    });
    expect(presence.borrowedUnitIds, 'still marked as not mine').toEqual(['ghost']);
    expect(presence.coveringFor, 'but no name invented for it').toEqual([]);
  });

  it('a seat that is not in the room reads as nothing at all', () => {
    expect(presenceOf({ seats: [], mySeatId: 'a', controls: ['u1'] })).toEqual(NO_PRESENCE);
  });
});

describe('NET-PRESENCE-UI: the topbar marks the portraits', () => {
  const VEX = vex as unknown as CharacterDef;
  const BASTION = bastion as unknown as CharacterDef;
  const names = (id: string): string => id;

  it('a hot-seat passes no marks and nothing is marked', () => {
    // One machine has no sockets to be absent from, so the argument is optional
    // and the default is "everybody is here".
    const state = createMatch(OPEN, '1v1', [[VEX], [BASTION]]);
    const bar = topbar(scoreReadout(state, names), 0);
    expect([...bar.friendly, ...bar.enemy].every((p) => !p.away && !p.borrowed)).toBe(true);
  });

  it('an away player dims their character; a borrowed one is outlined', () => {
    const state = createMatch(OPEN, '2v2', [[VEX, BASTION], [VEX, BASTION]]);
    const mine = state.units.filter((u) => u.owner === 0);
    const theirs = mine[1]!.unitId;
    const bar = topbar(scoreReadout(state, names), 0, {
      awayUnitIds: [theirs],
      borrowedUnitIds: [theirs],
    });
    const marked = bar.friendly.find((p) => p.unitId === theirs)!;
    expect(marked.away, 'their player is gone').toBe(true);
    expect(marked.borrowed, 'and I am ordering them').toBe(true);
    const own = bar.friendly.find((p) => p.unitId === mine[0]!.unitId)!;
    expect(own.away || own.borrowed, 'my own character is neither').toBe(false);
  });

  it('the two marks are independent — away without borrowed is the turn of the drop', () => {
    const state = createMatch(OPEN, '2v2', [[VEX, BASTION], [VEX, BASTION]]);
    const theirs = state.units.filter((u) => u.owner === 0)[1]!.unitId;
    const bar = topbar(scoreReadout(state, names), 0, { awayUnitIds: [theirs], borrowedUnitIds: [] });
    const marked = bar.friendly.find((p) => p.unitId === theirs)!;
    expect(marked.away).toBe(true);
    expect(marked.borrowed, 'not yet handed over').toBe(false);
  });

  it('an enemy portrait can be away, and is never borrowed', () => {
    const state = createMatch(OPEN, '1v1', [[VEX], [BASTION]]);
    const enemy = state.units.find((u) => u.owner === 1)!.unitId;
    const bar = topbar(scoreReadout(state, names), 0, { awayUnitIds: [enemy], borrowedUnitIds: [] });
    expect(bar.enemy[0]?.away).toBe(true);
    expect(bar.enemy[0]?.borrowed).toBe(false);
  });
});

/** A `RoomClient` glued back to back with a hub socket, no transport between. */
class Wire implements Sink {
  constructor(
    readonly client: RoomClient,
    private readonly hub: RoomHub,
    private readonly socketId: string,
  ) {
    this.hub.open(socketId, this);
  }
  sink(): { send(data: string): void; close(): void } {
    return {
      send: (data: string) => { this.hub.receive(this.socketId, data); },
      close: () => { this.hub.close(this.socketId); },
    };
  }
  send(data: string): void { this.client.receive(data); }
  close(): void { this.client.closed(); }
}

describe('NET-PRESENCE-UI: the lobby lists a held seat as held', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  /** Two seats on one team, in a lobby, with a real hub behind them. */
  const lobbyOfTwo = () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    const clients: RoomClient[] = [];
    for (const id of ['a', 'b', 'c']) {
      const client = new RoomClient({ send: () => {}, close: () => {} });
      const wire = new Wire(client, hub, id);
      client.attach(wire.sink());
      client.join(id === 'a' ? 'Ada' : id === 'b' ? 'Bo' : 'Cy');
      clients.push(client);
    }
    return { hub, ada: clients[0]!, bo: clients[1]! };
  };

  it('a lobby seat that leaves is gone, so there is nothing to mark', () => {
    // The split `leave` makes: a lobby seat is nothing but a socket. This is the
    // *contrast* case for the marking — it exists so the mark is not asserted
    // against a state that could never happen.
    const { hub, ada } = lobbyOfTwo();
    hub.close('c');
    expect(ada.net.room?.seats.map((s) => s.seatId)).toEqual(['a', 'b']);
    expect(seatRows(ada.net, []).every((r) => r.connected)).toBe(true);
  });

  it('every seat reads connected while everyone is present', () => {
    const { ada } = lobbyOfTwo();
    const rows = seatRows(ada.net, []);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.connected)).toBe(true);
  });

  it('a held seat renders marked, with what it is waiting for instead of its picks', () => {
    // Built by hand rather than driven through the hub, because a *lobby* seat is
    // deleted on disconnect — a held seat only exists in a started match, and the
    // lobby screen has to render one correctly if it is ever shown one.
    const held: Seat[] = [
      seat({ seatId: 'a', name: 'Ada', team: 0 }),
      seat({ seatId: 'b', name: 'Bo', team: 0, connected: false }),
    ];
    const room = {
      code: 'WXYZ', format: '2v2' as const, seats: held, turn: 0,
      canStart: false, started: false, locked: [],
    };
    // Driven through the real reducer with real frames, so the row the screen
    // draws is the row the wire produces.
    const client = new RoomClient({ send: () => {}, close: () => {} });
    const screen = createLobbyScreen({ root }, client, [], []);
    client.receive(JSON.stringify({ type: 'joined', seat: held[0], room }));
    client.receive(JSON.stringify({
      type: 'lobby',
      room,
      lobby: { picks: {}, owed: { a: 1, b: 1 }, ready: [], enemyReady: 0, enemyOf: 1, canStart: false },
    }));

    const rows = seatRows(client.net, []);
    expect(rows.map((r) => r.connected)).toEqual([true, false]);

    screen.update();
    const line = root.querySelector<HTMLElement>('[data-seat="b"]')!;
    expect(line.dataset['away'], 'marked as a datum, not only as a colour').toBe('true');
    expect(line.className).toContain('is-away');
    expect(line.textContent).toContain(AWAY_MARK);
    expect(line.textContent, 'held, not empty').toContain(AWAY_LABEL);
    expect(line.textContent, 'and not still "choosing"').not.toContain('choosing');

    const present = root.querySelector<HTMLElement>('[data-seat="a"]')!;
    expect(present.dataset['away'], 'the seat that is here is untouched').toBeUndefined();
    expect(present.className).not.toContain('is-away');
  });
});

describe('NET-PRESENCE-UI: end to end, a drop the client can see', () => {
  it('the room says who left, and the stand-in is told what it is holding', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    const clients: RoomClient[] = [];
    for (const id of ['s0', 's1', 's2', 's3']) {
      const client = new RoomClient({ send: () => {}, close: () => {} });
      const wire = new Wire(client, hub, id);
      client.attach(wire.sink());
      client.join(id);
      clients.push(client);
    }
    for (const [i, client] of clients.entries()) {
      client.pick([{ characterId: ['ash', 'bry', 'cyn', 'dex'][i]! }]);
    }
    clients[0]!.start();

    const gone = clients[3]!;
    const goneSeat = gone.net.seat!.seatId;
    const abandoned = [...gone.net.unitIds];
    const mate = clients.find((c) => c.net.seat!.team === gone.net.seat!.team && c !== gone)!;

    const view = (c: RoomClient) => presenceOf({
      seats: c.net.room!.seats, mySeatId: c.net.seat!.seatId, controls: c.net.unitIds,
    });
    expect(view(mate), 'everybody is here to begin with').toEqual(NO_PRESENCE);

    hub.close(goneSeat);
    gone.closed();
    const dropped = view(mate);
    expect(dropped.awaySeatIds, 'the room says they are gone').toEqual([goneSeat]);
    expect(dropped.borrowedUnitIds, 'but the handoff has not happened yet').toEqual([]);
    expect(coverNotice(dropped)).toBeUndefined();

    // One whole turn without them — the ruled trigger.
    for (const client of clients) {
      if (client === gone) continue;
      client.submit([]);
    }
    const covering = view(mate);
    expect(covering.borrowedUnitIds).toEqual(abandoned);
    expect(coverNotice(covering)).toMatch(/covering/i);
    expect(covering.awayUnitIds, 'and the plates to dim are theirs').toEqual(abandoned);

    // …and the marks the topbar would draw follow the same two lists.
    const bar = topbar(scoreReadout(mate.net.state!, (id) => id), mate.net.seat!.team, covering);
    const borrowed = bar.friendly.filter((p) => p.borrowed).map((p) => p.unitId);
    expect(borrowed).toEqual(abandoned);
    expect(bar.friendly.filter((p) => p.away).map((p) => p.unitId)).toEqual(abandoned);
  });
});
