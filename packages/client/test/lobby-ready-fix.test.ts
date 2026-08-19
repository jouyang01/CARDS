// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalystData, CharacterDef, MapDef, Roster } from '@cards/engine';
import { buildCatalystPool, buildRoster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import { createLobbyScreen, type CatalystOption } from '../src/lobby-screen.js';
import { ticketsFor, ticketsIn } from '../src/reconnect.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * LOBBY-READY-FIX — *"There is no 'ready' button. Both Seat 0 and seat 1 have a
 * 'start game' but it cannot be clicked."*
 *
 * The lobby's two controls were correct in isolation and had tests
 * (`lobby-ready.test.ts`) proving it — with two clients that each joined
 * **cleanly**. What nobody had driven was the thing the owner actually did:
 * open a second tab of the same browser.
 *
 * Two tabs share `localStorage`, and the reconnect ticket lived there
 * (`main.ts`), keyed by room code. So the second tab handed the server the
 * **first tab's seat id**, and the hub tries a ticket *instead of* an ordinary
 * join — deliberately, because a reclaim is about *which* seat it is. In a
 * lobby that reclaim cannot succeed (there are no held seats: `leave` deletes a
 * lobby seat outright), so the second tab was refused and **its socket closed**.
 * It never got a seat, never got a `lobby` frame, and therefore rendered from an
 * empty `NetState` — which is a screen with no ready button on it.
 *
 * Two things are wrong and both are fixed here:
 *
 * 1. **The ticket is per browsing context.** `sessionStorage`, not
 *    `localStorage` — a second tab is a second player, and a reload of *this*
 *    tab is the only thing a reclaim was ever for.
 * 2. **A ticket presented to a lobby is not a reclaim.** A lobby seat holds
 *    nothing worth reserving, so the ticket is ignored and the client is seated
 *    normally rather than shown the door. A *match* seat is untouched: a live
 *    one still refuses the ticket as `seatTaken` and a held one still comes back
 *    to its owner.
 *
 * The tests below drive two real `RoomClient`s over a real `RoomHub`, with real
 * lobby screens mounted on both — the wiring, not the pure helpers.
 */

const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const roster: Roster = buildRoster(CATALOG);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const CATALYSTS: CatalystOption[] = Object.values(POOL).map((c) => ({
  id: c.id, name: c.name, phase: c.phase, description: c.description,
}));
const config: MatchConfig = { map: duelArena as unknown as MapDef, roster, catalysts: POOL };

/** One browsing context's socket, with the door it was shown recorded. */
class Wire implements Sink {
  readonly client: RoomClient;
  /** Whether the hub closed this socket — the observable form of a refusal. */
  closed = false;
  constructor(private readonly hub: RoomHub, private readonly socketId: string) {
    this.client = new RoomClient({
      send: (data: string) => { this.hub.receive(this.socketId, data); },
      close: () => { this.hub.close(this.socketId); },
    });
    this.hub.open(socketId, this);
  }
  send(data: string): void { this.client.receive(data); }
  close(): void { this.closed = true; this.client.closed(); }
}

/** A room, and a way to walk a browsing context into it — ticket or not. */
const room = (format: '2v2' | '4v4' = '2v2') => {
  const hub = new RoomHub(createRoom('WXYZ', format), config);
  const tabs: Wire[] = [];
  const open = (name: string, ticket?: string) => {
    const wire = new Wire(hub, `sock-${tabs.length}`);
    tabs.push(wire);
    wire.client.join(name, ticket);
    return wire;
  };
  return { hub, open };
};

/** A screen over a client, mounted the way `main.ts` mounts it. */
const screenFor = (wire: Wire): HTMLElement => {
  const root = document.createElement('div');
  document.body.append(root);
  createLobbyScreen({ root }, wire.client, CATALOG, CATALYSTS);
  return root;
};

const startButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[data-action="start"]');
const readyButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[data-action="ready"]');
const seatRow = (root: HTMLElement, seatId: string) =>
  root.querySelector<HTMLElement>(`.lobby-seat[data-seat="${seatId}"]`);

beforeEach(() => { document.body.replaceChildren(); });

describe('LOBBY-READY-FIX: the second tab, which is what the owner opened', () => {
  it('is seated in its own chair even though it presents the first tab\'s ticket', () => {
    // The reported bug, at its source. `sock-1` hands over `sock-0` because the
    // two tabs shared one `localStorage`; before the fix the hub read that as a
    // reclaim, found nothing to reclaim in a lobby, and closed the socket.
    const { hub, open } = room();
    const host = open('Ada');
    const held = host.client.net.seat!.seatId;
    const guest = open('Bo', held);

    expect(guest.closed, 'the door was not shut on it').toBe(false);
    expect(guest.client.net.seat, 'and it has a seat of its own').toBeDefined();
    expect(guest.client.net.seat!.seatId).not.toBe(held);
    expect(hub.room.seats.map((s) => s.seatId), 'two players, two seats')
      .toEqual([held, guest.client.net.seat!.seatId]);
  });

  it('so one of them holds Start and the other holds Ready — never both', () => {
    // The symptom as the owner described it: two Start buttons, neither live.
    // A client with no seat renders exactly that, because `isCreator` is false
    // and `canStart` is false, so the screen it drew was the *unjoined* one.
    const { open } = room();
    const host = open('Ada');
    const guest = open('Bo', host.client.net.seat!.seatId);
    const hostRoot = screenFor(host);
    const guestRoot = screenFor(guest);

    expect(startButton(hostRoot), 'the host starts').toBeTruthy();
    expect(readyButton(hostRoot), 'and does not ready as well').toBeNull();
    expect(readyButton(guestRoot), 'the second tab readies').toBeTruthy();
    expect(readyButton(guestRoot)!.textContent).toMatch(/ready up/i);
    expect(startButton(guestRoot), 'and cannot start').toBeNull();
  });

  it('and readying from that second tab is what lights the host\'s Start', () => {
    // End to end over the wire: the click reaches the room and the room's answer
    // reaches the *other* client's button.
    const { hub, open } = room();
    const host = open('Ada');
    const guest = open('Bo', host.client.net.seat!.seatId);
    const hostRoot = screenFor(host);
    const guestRoot = screenFor(guest);
    host.client.pick([{ characterId: 'vex' }, { characterId: 'wisp' }]);
    guest.client.pick([{ characterId: 'bastion' }, { characterId: 'aegis' }]);

    expect(startButton(hostRoot)!.disabled, 'picked, not readied').toBe(true);
    readyButton(guestRoot)!.click();
    expect(startButton(hostRoot)!.disabled, 'and now the host may go').toBe(false);
    startButton(hostRoot)!.click();
    expect(hub.room.state, 'the match the owner could not start').toBeDefined();
  });

  it('a third tab with the same stale ticket is a third player, not a third refusal', () => {
    // The ticket is not consumed and not honoured; it is simply irrelevant to a
    // lobby. Whatever a browser has remembered, joining still works.
    const { hub, open } = room('4v4');
    const host = open('Ada');
    const held = host.client.net.seat!.seatId;
    open('Bo', held);
    open('Cy', held);
    open('Di', held);
    expect(hub.room.seats).toHaveLength(4);
    expect(new Set(hub.room.seats.map((s) => s.seatId)).size, 'four distinct seats').toBe(4);
  });
});

describe('LOBBY-READY-FIX: the ticket belongs to one browsing context', () => {
  /** A `Storage`-shaped thing, so two "tabs" can share one and not the other. */
  const fakeStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    };
  };

  it('two tabs of one browser share localStorage and must not share a ticket', () => {
    // The mechanism of the bug, isolated: one `localStorage`, two
    // `sessionStorage`s — which is exactly what a browser gives two tabs.
    const localStore = fakeStorage();
    const tabOne = { localStorage: localStore, sessionStorage: fakeStorage() };
    const tabTwo = { localStorage: localStore, sessionStorage: fakeStorage() };

    ticketsFor(tabOne).put('WXYZ', 'sock-0');
    expect(ticketsFor(tabTwo).get('WXYZ'), 'the second tab holds no ticket').toBeUndefined();
    expect(ticketsFor(tabOne).get('WXYZ'), 'and the first one still does').toBe('sock-0');
    expect(ticketsIn(localStore).get('WXYZ'), 'nothing was written where they collide')
      .toBeUndefined();
  });

  it('but a reload of the same tab still remembers, which is what a reclaim is for', () => {
    // `sessionStorage` survives a reload and dies with the tab — the exact
    // lifetime a reconnect ticket wants. Modelled by reading the same storage
    // through a second store, as a fresh page load would.
    const session = fakeStorage();
    ticketsFor({ sessionStorage: session }).put('WXYZ', 'sock-0');
    expect(ticketsFor({ sessionStorage: session }).get('WXYZ')).toBe('sock-0');
    ticketsFor({ sessionStorage: session }).clear('WXYZ');
    expect(ticketsFor({ sessionStorage: session }).get('WXYZ')).toBeUndefined();
  });

  it('and a context with no storage at all is simply ticketless, not broken', () => {
    expect(ticketsFor({}).get('WXYZ')).toBeUndefined();
    expect(() => { ticketsFor({}).put('WXYZ', 'sock-0'); }).not.toThrow();
  });
});

describe('LOBBY-READY-FIX: the seat list marks who has readied', () => {
  /** A 4-player 2v2, so the host has a **teammate** whose row it can see. */
  const team = () => {
    const { hub, open } = room();
    const host = open('Ada'); // team 0
    const guest = open('Bo'); // team 1
    const mate = open('Cy'); // team 0, beside the host
    const other = open('Di'); // team 1
    for (const [w, id] of [[host, 'vex'], [guest, 'bastion'], [mate, 'wisp'], [other, 'aegis']] as const) {
      w.client.pick([{ characterId: id }]);
    }
    return { hub, host, guest, mate, other };
  };

  it('a seat that has picked is not yet a seat that is ready', () => {
    // The bug in one line: `is-ready` read `lobby.ready`, which is the list of
    // seats that have finished **picking**. Every teammate looked ready the
    // moment they chose a character, so the mark said nothing about the
    // handshake the host is actually waiting on.
    const { host, mate } = team();
    const hostRoot = screenFor(host);
    const row = seatRow(hostRoot, mate.client.net.seat!.seatId)!;
    expect(row, 'the teammate is listed').toBeTruthy();
    expect(row.classList.contains('is-ready'), 'picked, not readied').toBe(false);
  });

  it('and turns into one the moment they ready up', () => {
    const { host, mate } = team();
    const hostRoot = screenFor(host);
    const mateRoot = screenFor(mate);
    readyButton(mateRoot)!.click();
    expect(seatRow(hostRoot, mate.client.net.seat!.seatId)!.classList.contains('is-ready')).toBe(true);
  });

  it('and back again when they take it back', () => {
    const { host, mate } = team();
    const hostRoot = screenFor(host);
    const mateRoot = screenFor(mate);
    readyButton(mateRoot)!.click();
    readyButton(mateRoot)!.click();
    expect(seatRow(hostRoot, mate.client.net.seat!.seatId)!.classList.contains('is-ready')).toBe(false);
  });

  it('the host\'s own row is never marked — pressing Start is their readiness', () => {
    // `everyoneReady` excludes the creator on purpose, so a mark over their row
    // would be a promise the room never asked them to make.
    const { host, guest, mate, other } = team();
    const hostRoot = screenFor(host);
    for (const w of [guest, mate, other]) w.client.ready(true);
    expect(seatRow(hostRoot, host.client.net.seat!.seatId)!.classList.contains('is-ready')).toBe(false);
    expect(startButton(hostRoot)!.disabled, 'and Start is live all the same').toBe(false);
  });
});
