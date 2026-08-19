import { describe, expect, it } from 'vitest';
import type { CatalystData, CharacterDef, MapDef } from '@cards/engine';
import { buildCatalystPool, buildRoster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '../src/hub.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/protocol.js';
import { createRoom, creatorSeatId, everyoneReady, setReady } from '../src/room.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * LOBBY-READY — seat 0 starts; everybody else readies up (Dev Note #4).
 *
 * The room used to start on `lobbyReady` alone: everybody seated, everybody
 * picked, both teams coverable. That answers "are we all here" and not "are we
 * all happy with this", and any seat could press the button — so the last
 * person to finish choosing decided for the room, often before a teammate had
 * looked at what they had been dealt.
 *
 * Two rules, and they are separate on purpose:
 *
 *   • **the creator holds Start.** Anyone else pressing it is refused.
 *   • **Start is live only once every other occupied seat has readied**, and
 *     readying is revocable right up to the press.
 *
 * The creator is excluded from the handshake rather than implicitly ready:
 * pressing Start *is* their answer, and asking for it twice would be a button
 * that disables itself until you press a different button. Disconnected seats
 * are excluded too — a held seat cannot ready, and waiting on one would let a
 * dropped player freeze the lobby, which is the opposite of the rule the match
 * itself runs under.
 */

const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const config: MatchConfig = {
  map: duelArena as unknown as MapDef,
  roster: buildRoster(CATALOG),
  catalysts: buildCatalystPool(catalystData as unknown as CatalystData),
};

class FakeSocket implements Sink {
  readonly sent: ServerMessage[] = [];
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage); }
  close(): void {}
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.of(type).at(-1);
  }
}

const JOIN = JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, name: 'P' });
const START = JSON.stringify({ type: 'start' });
const readyFrame = (ready: boolean): string => JSON.stringify({ type: 'ready', ready });
const pickFrame = (...ids: string[]): string =>
  JSON.stringify({ type: 'pick', picks: ids.map((characterId) => ({ characterId })) });

/** A 2v2 with two seats, both joined and picked — one press away from a match. */
const picked = () => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
  const sock: Record<string, FakeSocket> = {};
  for (const id of ['a', 'b']) {
    sock[id] = new FakeSocket();
    hub.open(id, sock[id]!);
    hub.receive(id, JOIN);
  }
  hub.receive('a', pickFrame('vex', 'wisp'));
  hub.receive('b', pickFrame('bastion', 'aegis'));
  return { hub, a: sock['a']!, b: sock['b']! };
};

describe('LOBBY-READY: the handshake', () => {
  it('a complete lobby is not a startable one until the other seat readies', () => {
    const { hub } = picked();
    expect(hub.room.state, 'still a lobby').toBeUndefined();
    hub.receive('a', START);
    expect(hub.room.state, 'the creator pressed too early').toBeUndefined();

    hub.receive('b', readyFrame(true));
    hub.receive('a', START);
    expect(hub.room.state, 'and now it goes').toBeDefined();
  });

  it('un-readying puts the room back where it was', () => {
    // Revocable until the press, which is the reason it is a stored flag and
    // not a one-way latch.
    const { hub, a } = picked();
    hub.receive('b', readyFrame(true));
    expect(a.last('lobby')!.lobby.canStart).toBe(true);

    hub.receive('b', readyFrame(false));
    expect(a.last('lobby')!.lobby.canStart, 'taken back').toBe(false);
    hub.receive('a', START);
    expect(hub.room.state, 'and the button is dead again').toBeUndefined();
  });

  it('only the creator may press Start', () => {
    const { hub, b } = picked();
    hub.receive('b', readyFrame(true));
    hub.receive('b', START);
    expect(hub.room.state, 'a ready seat is not a host').toBeUndefined();
    expect(b.last('error')?.code, 'and it is told why').toBe('cannotStart');

    hub.receive('a', START);
    expect(hub.room.state).toBeDefined();
  });

  it('the creator is not asked to ready — pressing Start is the answer', () => {
    // Otherwise the button disables itself until you press a different button.
    const { hub } = picked();
    hub.receive('b', readyFrame(true));
    expect(everyoneReady(hub.room), 'the creator has said nothing').toBe(true);
    expect(hub.room.seats.find((s) => s.seatId === 'a')!.ready).toBe(false);
  });

  it('the lobby payload names the host and lists who has readied', () => {
    // The screen picks which control to show from this rather than from "seat 0
    // is the first row I was sent", which is a guess that goes wrong exactly
    // when somebody has just dropped.
    const { hub, a } = picked();
    expect(a.last('lobby')!.lobby.creator).toBe('a');
    expect(a.last('lobby')!.lobby.readied).toEqual([]);
    hub.receive('a', readyFrame(true));
    expect(a.last('lobby')!.lobby.readied, 'own team only').toEqual(['a']);
  });

  it('a ready frame re-sends the lobby, so the room sees the handshake fill in', () => {
    const { hub, a } = picked();
    const before = a.of('lobby').length;
    hub.receive('b', readyFrame(true));
    expect(a.of('lobby').length).toBeGreaterThan(before);
  });

  it('an unseated socket is refused rather than counted', () => {
    const { hub } = picked();
    const stranger = new FakeSocket();
    hub.open('x', stranger);
    hub.receive('x', readyFrame(true));
    expect(stranger.last('error')?.code).toBe('notJoined');
    expect(hub.room.seats.some((s) => s.seatId === 'x')).toBe(false);
  });
});

describe('LOBBY-READY: the predicate, where the rule lives', () => {
  it('a held seat is not waited on', () => {
    // A disconnected seat cannot ready, and a lobby that waited on one could be
    // frozen by a dropped player — the opposite of the rule the match runs
    // under. Asserted on the predicate: a *lobby* close frees the seat rather
    // than holding it, so the held case only exists as a room shape.
    const { hub } = picked();
    const held = {
      ...hub.room,
      seats: hub.room.seats.map((s) => (s.seatId === 'b' ? { ...s, connected: false } : s)),
    };
    expect(everyoneReady(held), 'nobody is waiting for the seat that left').toBe(true);
  });

  it('an un-readied connected seat IS waited on — the control that proves it', () => {
    const { hub } = picked();
    expect(everyoneReady(hub.room), 'b is here and has said nothing').toBe(false);
  });

  it('setReady is a no-op for an id the room does not have', () => {
    const room = picked().hub.room;
    expect(setReady(room, 'nobody', true)).toBe(room);
  });

  it('and once the match is running there is nothing left to be ready for', () => {
    const { hub } = picked();
    hub.receive('b', readyFrame(true));
    hub.receive('a', START);
    const running = hub.room;
    expect(setReady(running, 'b', false), 'a late frame changes nothing').toBe(running);
    expect(everyoneReady(running), 'and the lobby gate is shut').toBe(false);
  });

  it('the creator is the first seat, and an empty room has none', () => {
    const { hub } = picked();
    expect(creatorSeatId(hub.room)).toBe('a');
    expect(creatorSeatId(createRoom('WXYZ', '2v2'))).toBeUndefined();
  });
});
