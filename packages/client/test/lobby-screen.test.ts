// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { CatalystData, CharacterDef, MapDef, Roster, UnitOrders } from '@cards/engine';
import { buildCatalystPool, buildRoster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import { createLobbyScreen, type CatalystOption } from '../src/lobby-screen.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * M3-LOBBY-UI — the pick screen, driven against a **real** `RoomHub`.
 *
 * Nothing is faked between the buttons and the rules: a click calls
 * `RoomClient.pick`, the frame reaches a real hub, the hub validates it with the
 * same `setPicks` a production room uses, and the reply comes back through the
 * reducer into the DOM. So these are not "the button dispatched an action"
 * tests — a screen that composed a pick set the server would refuse fails here,
 * which is the AC's first bullet.
 *
 * The config carries **no `teams`**, exactly like the Durable Object's: this
 * room can only start from its lobby, so "picks → start → a turn resolves" is
 * proof the whole path works rather than proof the interim deal still does.
 */

const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const roster: Roster = buildRoster(CATALOG);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const CATALYSTS: CatalystOption[] = Object.values(POOL).map((c) => ({
  id: c.id, name: c.name, phase: c.phase, description: c.description,
}));
const config: MatchConfig = {
  map: duelArena as unknown as MapDef,
  roster,
  catalysts: POOL,
};

/** A `RoomClient` and a `Sink` glued back to back — the wire, both ends real. */
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

/** A two-seat 2v2 (two characters each) with a mounted screen for seat `a`. */
const mounted = () => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
  const a = new Wire(hub, 'a');
  const b = new Wire(hub, 'b');
  a.client.join('Ada');
  b.client.join('Bo');
  const root = document.createElement('div');
  const screen = createLobbyScreen({ root }, a.client, CATALOG, CATALYSTS);
  return { hub, a, b, root, screen };
};

const buttons = (root: HTMLElement, selector: string): HTMLButtonElement[] =>
  [...root.querySelectorAll<HTMLButtonElement>(selector)];
const characterButton = (root: HTMLElement, id: string): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`[data-character="${id}"]`)!;
const startButton = (root: HTMLElement): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>('[data-action="start"]')!;

describe('M3-LOBBY-UI: the screen composes a pick the server accepts', () => {
  it('two clicks fill a two-character seat, and the room agrees', () => {
    const { hub, root } = mounted();
    expect(buttons(root, '.lobby-slot'), 'a slot per character owed').toHaveLength(2);

    characterButton(root, 'vex').click();
    // One of two: not sendable yet, so the room has heard nothing.
    expect(hub.room.seats.find((s) => s.seatId === 'a')!.picks).toEqual([]);

    buttons(root, '.lobby-slot')[1]!.click();
    characterButton(root, 'wisp').click();
    expect(hub.room.seats.find((s) => s.seatId === 'a')!.picks.map((p) => p.characterId))
      .toEqual(['vex', 'wisp']);
  });

  it('a triad clicked through is what the unit ends up carrying', () => {
    const { hub, root } = mounted();
    characterButton(root, 'vex').click();
    for (const phase of ['prep', 'dash', 'blast'] as const) {
      const row = root.querySelector<HTMLElement>(`[data-phase="${phase}"]`)!;
      row.querySelector<HTMLButtonElement>('.lobby-catalyst')!.click();
    }
    buttons(root, '.lobby-slot')[1]!.click();
    characterButton(root, 'wisp').click();

    const picks = hub.room.seats.find((s) => s.seatId === 'a')!.picks;
    expect(picks[0]!.catalysts, 'one per phase, in phase order').toHaveLength(3);
  });

  it('a character a teammate holds is disabled, not merely refused after the click', () => {
    // R3 is a team rule, and the screen learns it from the server's own record
    // of accepted picks rather than from a local tally.
    const hub = new RoomHub(createRoom('WXYZ', '4v4'), config);
    const a = new Wire(hub, 'a');
    const b = new Wire(hub, 'b');
    const c = new Wire(hub, 'c');
    const d = new Wire(hub, 'd');
    for (const [wire, name] of [[a, 'Ada'], [b, 'Bo'], [c, 'Cy'], [d, 'Di']] as const) wire.client.join(name);
    const root = document.createElement('div');
    createLobbyScreen({ root }, a.client, CATALOG, CATALYSTS);

    // `c` is a's teammate (joins alternate), and takes both its characters.
    c.client.pick([{ characterId: 'wisp' }, { characterId: 'aegis' }]);
    expect(characterButton(root, 'wisp').disabled, "a teammate's pick is off the table").toBe(true);
    expect(characterButton(root, 'vex').disabled).toBe(false);
  });

  it('a refusal from the server is shown rather than swallowed', () => {
    const { a, root } = mounted();
    // A pick the screen cannot produce, sent under it: the wrong number.
    a.client.pick([{ characterId: 'vex' }]);
    expect(root.querySelector('.lobby-error')!.textContent).toMatch(/characters this seat plays/i);
  });
});

describe('M3-LOBBY-UI: BLIND-PICK, at the screen', () => {
  it('an enemy who has picked shows as a count, and their pick leaves no other trace', () => {
    // The *catalogue* is public — every character is in the grid, and has to be,
    // since a mirror across teams is legal (R3). What must not leak is which of
    // them the other side took, and the tell that would leak it is the grid
    // greying out: a character the enemy holds must look exactly as free as one
    // nobody has touched.
    const { b, root } = mounted();
    const before = characterButton(root, 'bastion').className;
    b.client.pick([{ characterId: 'bastion' }, { characterId: 'aegis' }]);

    expect(root.querySelector('.lobby-enemy-count')!.textContent).toBe('1 of 1 ready');
    expect(characterButton(root, 'bastion').disabled, 'still selectable — mirrors are legal').toBe(false);
    expect(characterButton(root, 'bastion').className, 'and looks no different').toBe(before);
    expect(root.querySelector('.lobby-enemy')!.textContent, 'the enemy section names nobody')
      .not.toMatch(/bastion|aegis/i);
  });

  it('the enemy seat is not listed among the rows at all', () => {
    const { root } = mounted();
    const seats = [...root.querySelectorAll<HTMLElement>('[data-seat]')].map((n) => n.dataset['seat']);
    expect(seats, 'own team only').toEqual(['a']);
  });
});

describe('M3-LOBBY-UI: the start button', () => {
  it('is dead until every seat has picked', () => {
    const { root, a, b } = mounted();
    expect(startButton(root).disabled, 'nobody has picked').toBe(true);

    a.client.pick([{ characterId: 'vex' }, { characterId: 'wisp' }]);
    expect(startButton(root).disabled, 'the other side has not').toBe(true);

    b.client.pick([{ characterId: 'bastion' }, { characterId: 'aegis' }]);
    expect(startButton(root).disabled, 'now it is live').toBe(false);
  });

  it('pressing it starts the match — and being full never did', () => {
    // LOBBY-START: the room is complete before the press and stays a lobby.
    const { hub, root, a, b } = mounted();
    a.client.pick([{ characterId: 'vex' }, { characterId: 'wisp' }]);
    b.client.pick([{ characterId: 'bastion' }, { characterId: 'aegis' }]);
    expect(hub.room.state, 'complete, and still not started').toBeUndefined();

    startButton(root).click();
    expect(hub.room.state, 'the press is what starts it').toBeDefined();
    expect(a.client.net.phase).toBe('match');
  });

  it('and the match is made of what was picked', () => {
    const { hub, root, a, b } = mounted();
    a.client.pick([{ characterId: 'vex' }, { characterId: 'wisp' }]);
    b.client.pick([{ characterId: 'bastion' }, { characterId: 'aegis' }]);
    startButton(root).click();
    expect(hub.room.state!.units.map((u) => u.characterId).sort())
      .toEqual(['aegis', 'bastion', 'vex', 'wisp']);
  });
});

describe('M3-LOBBY-UI: picks → start → a turn, over the socket', () => {
  it('the whole path, with no interim deal anywhere in it', () => {
    // The AC's last bullet. This config has no `teams`, so if the picks had not
    // reached the server there would be no match to resolve at all.
    const { hub, root, a, b } = mounted();
    a.client.pick([{ characterId: 'vex' }, { characterId: 'wisp' }]);
    b.client.pick([{ characterId: 'bastion' }, { characterId: 'aegis' }]);
    startButton(root).click();

    // A decision arrived, fogged for each side (M3-HIDDEN).
    for (const side of [a, b]) {
      const owners = new Set(side.client.net.state!.units.map((u) => u.owner));
      expect(owners.size, 'only its own team is in the payload').toBe(1);
    }

    const hold = (client: RoomClient): UnitOrders[] =>
      client.net.unitIds.map((unitId) => ({ unitId }));
    a.client.submit(hold(a.client));
    b.client.submit(hold(b.client));

    expect(hub.room.turn, 'the turn resolved server-side').toBe(2);
    expect(a.client.net.state!.turn).toBe(2);
    expect(Object.keys(a.client.net.revealed).sort(), 'and both sides were revealed').toEqual(['a', 'b']);
  });

  it('a room with no lobby filled in cannot start at all', () => {
    // The interim deal is gone from a production-shaped config, so pressing
    // start on an unpicked room is refused rather than dealing something.
    const { hub, root, a } = mounted();
    startButton(root).disabled = false; // the screen would not allow this; the server must
    startButton(root).click();
    expect(hub.room.state).toBeUndefined();
    expect(a.client.net.error?.code).toBe('cannotStart');
  });
});
