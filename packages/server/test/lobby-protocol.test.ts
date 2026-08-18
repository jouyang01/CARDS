import { describe, expect, it } from 'vitest';
import { buildCatalystPool, type CatalystData, type CatalystPool, type CharacterDef, type MapDef, type Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from '../src/protocol.js';
import { createRoom } from '../src/room.js';

/**
 * M3-LOBBY (protocol half) — picking over the socket, blind across teams.
 *
 * The rules themselves are `lobby.test.ts`'s. What is new here is who gets to
 * *see* a pick, and the answer is the one M3-LOCKLIST already gave for locks:
 * **a `RoomView` is broadcast, so nothing secret may ride it.** Picks go out in
 * a per-seat `lobby` message — own team in full, the enemy as a bare count.
 *
 * That is not a nicety. The R3 ruling calls cross-team mirrors "blind-pick
 * mirrors", which only means anything if neither side watches the other choose;
 * a lobby that broadcast picks would make every pick after the first a
 * counter-pick, and the ruling would be describing a game nobody was playing.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 1, y: 5 }, { x: 1, y: 7 }, { x: 1, y: 9 }, { x: 1, y: 11 }],
    [{ x: 13, y: 5 }, { x: 13, y: 7 }, { x: 13, y: 9 }, { x: 13, y: 11 }],
  ],
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
  ['ash', 'bry', 'cyn', 'dex', 'eir', 'fen', 'gil', 'hal'].map((id) => [id, character(id)]),
);
const cat = (id: string, phase: 'prep' | 'dash' | 'blast') => ({
  id, name: id, phase, shape: 'self' as const, range: 0, cooldown: 0, energyGain: 0,
  free: true, oncePerMatch: true, effects: [], description: id,
});
const POOL: CatalystPool = buildCatalystPool({
  prep: [cat('ward', 'prep')], dash: [cat('shift', 'dash')], blast: [cat('surge', 'blast')],
} as unknown as CatalystData);
const TRIAD = ['ward', 'shift', 'surge'];
const TEAMS: [CharacterDef[], CharacterDef[]] = [
  [roster['ash']!, roster['bry']!], [roster['cyn']!, roster['dex']!],
];
const config: MatchConfig = { map: OPEN, roster, teams: TEAMS, catalysts: POOL };

class FakeSocket implements Sink {
  readonly sent: ServerMessage[] = [];
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage); }
  close(): void { /* the lobby never closes a socket */ }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.of(type).at(-1);
  }
}

/**
 * A hub with `ids.length` joined seats, and each seat's socket.
 *
 * `format` matters more than it looks: a **full** room auto-starts (M3-START's
 * ruled trigger), so a four-seat 2v2 is a match, not a lobby. The four-seat
 * cases use 4v4, whose bound is eight.
 */
const room = (ids: string[], format: '2v2' | '4v4' = '2v2'): { hub: RoomHub; sock: Record<string, FakeSocket> } => {
  const hub = new RoomHub(createRoom('WXYZ', format), config);
  const sock: Record<string, FakeSocket> = {};
  for (const id of ids) {
    sock[id] = new FakeSocket();
    hub.open(id, sock[id]!);
    hub.receive(id, JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name: id }));
  }
  return { hub, sock };
};
const pickFrame = (...ids: string[]) =>
  JSON.stringify({ type: 'pick', picks: ids.map((characterId) => ({ characterId, catalysts: TRIAD })) });

describe('M3-LOBBY: a pick is answered to its own team and nobody else', () => {
  it('the picker and its teammate see the pick; the enemy sees only a count', () => {
    // Four seats: a,c on team 0 and b,d on team 1 (join auto-balances). 4v4, so
    // each seat runs two and the room is not full at four.
    const { hub, sock } = room(['a', 'b', 'c', 'd'], '4v4');
    hub.receive('a', pickFrame('ash', 'bry'));

    const mine = sock['c']!.last('lobby')!;
    expect(mine.lobby.picks['a'], 'a teammate coordinates, so it sees the pick')
      .toEqual([{ characterId: 'ash', catalysts: TRIAD }, { characterId: 'bry', catalysts: TRIAD }]);

    const theirs = sock['b']!.last('lobby')!;
    expect(theirs.lobby.picks['a'], "the enemy's payload does not contain it").toBeUndefined();
    expect(Object.keys(theirs.lobby.picks), 'nor any other enemy seat').toEqual(['b', 'd']);
    expect(theirs.lobby.enemyReady, 'only that one of them is done').toBe(1);
    expect(theirs.lobby.enemyOf).toBe(2);
  });

  it('and no broadcast carries a pick — the RoomView is stripped', () => {
    // The leak this shape exists to prevent: `roomUpdated` and `seatLeft` go to
    // both teams as the same bytes, so a pick riding a seat in a RoomView would
    // reach the enemy however careful the `lobby` message was.
    const { hub, sock } = room(['a', 'b']);
    hub.receive('a', pickFrame('ash', 'bry'));
    for (const socket of Object.values(sock)) {
      for (const msg of socket.sent) {
        const seats = 'room' in msg ? msg.room.seats : [];
        for (const seat of seats) {
          expect(seat.picks, `${msg.type} leaked a pick`).toEqual([]);
        }
      }
    }
  });

  it('a refused pick tells the picker why, and tells nobody else anything', () => {
    const { hub, sock } = room(['a', 'b', 'c', 'd'], '4v4');
    hub.receive('a', pickFrame('ash', 'bry'));
    const before = sock['c']!.of('lobby').length;
    hub.receive('c', pickFrame('ash', 'cyn')); // R3: a teammate already has it

    expect(sock['c']!.of('error').map((e) => e.code)).toEqual(['duplicateCharacter']);
    expect(sock['c']!.of('lobby').length, 'a refusal changed nothing to re-send').toBe(before);
    expect(sock['b']!.of('error'), 'and the enemy hears nothing at all').toEqual([]);
  });

  it('a wrong-sized pick is refused with the code that names it', () => {
    const { hub, sock } = room(['a', 'b']); // one seat per team: two characters each
    hub.receive('a', pickFrame('ash'));
    expect(sock['a']!.of('error').map((e) => e.code)).toEqual(['wrongCount']);
  });

  it('a socket that never joined may not pick', () => {
    const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
    const lurker = new FakeSocket();
    hub.open('lurker', lurker);
    hub.receive('lurker', pickFrame('ash', 'bry'));
    expect(lurker.of('error').map((e) => e.code)).toEqual(['notJoined']);
  });

  it('re-picking replaces, because changing your mind in a lobby is not an error', () => {
    const { hub, sock } = room(['a', 'b']);
    hub.receive('a', pickFrame('ash', 'bry'));
    hub.receive('a', pickFrame('cyn', 'dex'));
    expect(sock['a']!.last('lobby')!.lobby.picks['a']!.map((p) => p.characterId)).toEqual(['cyn', 'dex']);
    expect(sock['a']!.of('error'), 'no refusal for the second one').toEqual([]);
  });
});

describe('M3-LOBBY: what the lobby payload tells a seat', () => {
  it('how many characters each of its own seats owes', () => {
    const { sock } = room(['a', 'b']);
    expect(sock['a']!.last('lobby')!.lobby.owed).toEqual({ a: 2 });
  });

  it('the owed count is re-priced when somebody joins', () => {
    const { hub, sock } = room(['a', 'b']);
    expect(sock['a']!.last('lobby')!.lobby.owed['a']).toBe(2);
    hub.open('c', new FakeSocket());
    hub.receive('c', JSON.stringify({ type: 'join', version: PROTOCOL_VERSION }));
    expect(sock['a']!.last('lobby')!.lobby.owed['a'], 'a teammate arrived; a now runs one').toBe(1);
  });

  it('…and when somebody leaves', () => {
    // Three seats in a 2v2: a and c share team 0, b runs team 1 alone.
    const { hub, sock } = room(['a', 'b', 'c']);
    expect(sock['a']!.last('lobby')!.lobby.owed['a']).toBe(1);
    hub.close('c');
    expect(sock['a']!.last('lobby')!.lobby.owed['a'], 'the survivor runs both').toBe(2);
  });

  it('whether the whole lobby could start — including the enemy half it cannot see', () => {
    // `canStart` is the one thing a seat needs to know about the other team's
    // progress, and it is a boolean: it says "we could go", never who chose what.
    const { hub, sock } = room(['a', 'b']);
    hub.receive('a', pickFrame('ash', 'bry'));
    expect(sock['a']!.last('lobby')!.lobby.canStart, 'the enemy has not picked').toBe(false);
    hub.receive('b', pickFrame('cyn', 'dex'));
    expect(sock['a']!.last('lobby')!.lobby.canStart).toBe(true);
  });

  it('and nothing at all once the match is running — there is no lobby then', () => {
    const { hub, sock } = room(['a', 'b']);
    hub.receive('a', pickFrame('ash', 'bry'));
    hub.receive('b', pickFrame('cyn', 'dex'));
    const before = sock['a']!.of('lobby').length;
    hub.receive('a', JSON.stringify({ type: 'start' }));
    expect(sock['a']!.of('matchStarted').length).toBe(1);
    expect(sock['a']!.of('lobby').length).toBe(before);
  });
});

describe('M3-LOBBY: the start button plays what was picked', () => {
  it('the match is the lobby\'s characters, with the lobby\'s triads', () => {
    const { hub, sock } = room(['a', 'b']);
    hub.receive('a', JSON.stringify({
      type: 'pick',
      picks: [{ characterId: 'ash', catalysts: TRIAD }, { characterId: 'bry' }],
    }));
    hub.receive('b', pickFrame('cyn', 'dex'));
    hub.receive('a', JSON.stringify({ type: 'start' }));

    // The authoritative state, not the seat's copy — `matchStarted.state` is
    // already fogged for its team (M3-HIDDEN), so the enemy's characters are
    // legitimately missing from it.
    const units = hub.room.state!.units;
    expect(units.map((u) => u.characterId).sort()).toEqual(['ash', 'bry', 'cyn', 'dex']);
    expect(units.find((u) => u.characterId === 'ash')!.catalysts, 'seeded from the pick (CAT-SELECT)')
      .toEqual(TRIAD);
    expect(units.find((u) => u.characterId === 'bry')!.catalysts, 'and an unchosen triad falls back')
      .toEqual(['second_wind', 'shift', 'adrenaline']);
    expect(sock['a']!.last('matchStarted')!.unitIds, 'the picker controls what it picked')
      .toEqual(units.filter((u) => u.owner === 0).map((u) => u.unitId));
  });

  it('a room that never picked still starts on the interim deal', () => {
    // M3-START's escape hatch is untouched: the lobby is an addition, not a
    // precondition, until the client has a pick screen.
    const { hub, sock } = room(['a', 'b']);
    hub.receive('a', JSON.stringify({ type: 'start' }));
    expect(sock['a']!.of('matchStarted').length).toBe(1);
  });

  it('a FULL room does not start itself — being full is not a trigger any more', () => {
    // LOBBY-START, ruled 2026-09-11 and the reason the auto-start is gone: a
    // four-player 2v2 fills on the fourth join, which is *before* anybody has
    // chosen a character. The old trigger fired straight over the empty pick
    // screen, so the lobby was unreachable in exactly the room that wants one.
    const { hub, sock } = room(['a', 'b', 'c', 'd']);
    expect(sock['a']!.of('matchStarted'), 'full, and still in the lobby').toEqual([]);
    expect(hub.room.state).toBeUndefined();
  });

  it('…not even once every seat has finished picking — somebody must press it', () => {
    // Completing the lobby *enables* start; it does not perform it. The last
    // pick is not a decision to begin.
    const { hub, sock } = room(['a', 'b', 'c', 'd']);
    for (const [seat, id] of [['a', 'ash'], ['c', 'bry'], ['b', 'cyn'], ['d', 'dex']] as const) {
      hub.receive(seat, pickFrame(id));
    }
    expect(sock['a']!.last('lobby')!.lobby.canStart, 'the button lights up').toBe(true);
    expect(sock['a']!.of('matchStarted'), 'and waits to be pressed').toEqual([]);

    hub.receive('a', JSON.stringify({ type: 'start' }));
    expect(sock['a']!.of('matchStarted').length).toBe(1);
  });

  it('start is refused while a seat is still choosing', () => {
    const { hub, sock } = room(['a', 'b', 'c', 'd']);
    hub.receive('a', pickFrame('ash'));
    hub.receive('a', JSON.stringify({ type: 'start' }));

    expect(sock['a']!.of('error').map((e) => e.code)).toEqual(['cannotStart']);
    expect(hub.room.state, 'and nothing began').toBeUndefined();
  });
});

describe('M3-LOBBY: the pick frame is parsed for shape only', () => {
  it('a well-formed pick, with and without a triad', () => {
    expect(parseClientMessage(JSON.stringify({
      type: 'pick', picks: [{ characterId: 'ash', catalysts: TRIAD }, { characterId: 'bry' }],
    }))).toEqual({ type: 'pick', picks: [{ characterId: 'ash', catalysts: TRIAD }, { characterId: 'bry' }] });
  });

  it('an empty pick list parses — a seat that owes nothing is a legal seat', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'pick', picks: [] })))
      .toEqual({ type: 'pick', picks: [] });
  });

  it('a character id that is not a string is not a message', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'pick', picks: [{ characterId: 7 }] })))
      .toBeUndefined();
    expect(parseClientMessage(JSON.stringify({ type: 'pick', picks: ['ash'] }))).toBeUndefined();
    expect(parseClientMessage(JSON.stringify({ type: 'pick', picks: [null] }))).toBeUndefined();
  });

  it('a triad that is not a list of strings is not a message either', () => {
    expect(parseClientMessage(JSON.stringify({
      type: 'pick', picks: [{ characterId: 'ash', catalysts: 'ward' }],
    }))).toBeUndefined();
    expect(parseClientMessage(JSON.stringify({
      type: 'pick', picks: [{ characterId: 'ash', catalysts: ['ward', 3] }],
    }))).toBeUndefined();
  });

  it('one bad pick rejects the whole frame — a partial lobby pick is a wrong lobby', () => {
    expect(parseClientMessage(JSON.stringify({
      type: 'pick', picks: [{ characterId: 'ash' }, { characterId: null }],
    }))).toBeUndefined();
  });

  it('and an unparseable frame reaches the hub as badMessage, not as a pick', () => {
    const { hub, sock } = room(['a', 'b']);
    hub.receive('a', JSON.stringify({ type: 'pick', picks: 'ash' }));
    expect(sock['a']!.of('error').map((e) => e.code)).toEqual(['badMessage']);
  });
});
