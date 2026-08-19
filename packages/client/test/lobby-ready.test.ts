// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalystData, CharacterDef, MapDef, Roster } from '@cards/engine';
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
 * LOBBY-READY, client half — seat 0 starts; everybody else readies up
 * (Dev Note #4).
 *
 * A seat gets exactly one of the two controls, and which one is the server's
 * answer rather than the screen's guess: `lobby.creator` names the host, so a
 * client that reconnected into a room listed in some other order still puts the
 * button under the right player.
 *
 * Driven against a real `RoomHub`, like the rest of the lobby suite — the point
 * is that clicking Ready reaches the room and comes back as a live Start on the
 * host's screen, which a mocked socket could not show.
 */

const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const roster: Roster = buildRoster(CATALOG);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const CATALYSTS: CatalystOption[] = Object.values(POOL).map((c) => ({
  id: c.id, name: c.name, phase: c.phase, description: c.description,
}));
const config: MatchConfig = { map: duelArena as unknown as MapDef, roster, catalysts: POOL };

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

/** A 2v2 with a screen mounted for each seat: `a` created the room, `b` joined. */
const both = () => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
  const a = new Wire(hub, 'a');
  const b = new Wire(hub, 'b');
  a.client.join('Ada');
  b.client.join('Bo');
  const hostRoot = document.createElement('div');
  const guestRoot = document.createElement('div');
  document.body.append(hostRoot, guestRoot);
  createLobbyScreen({ root: hostRoot }, a.client, CATALOG, CATALYSTS);
  createLobbyScreen({ root: guestRoot }, b.client, CATALOG, CATALYSTS);
  return { hub, a, b, hostRoot, guestRoot };
};

/** Both seats choose their two characters, so only the handshake is left. */
const picked = (f: ReturnType<typeof both>) => {
  f.a.client.pick([{ characterId: 'vex' }, { characterId: 'wisp' }]);
  f.b.client.pick([{ characterId: 'bastion' }, { characterId: 'aegis' }]);
  return f;
};

const startButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[data-action="start"]');
const readyButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[data-action="ready"]');

beforeEach(() => { document.body.replaceChildren(); });

describe('LOBBY-READY: one control per seat', () => {
  it('the host holds Start and the guest holds Ready — never both, never neither', () => {
    const { hostRoot, guestRoot } = both();
    expect(startButton(hostRoot), 'the host starts').toBeTruthy();
    expect(readyButton(hostRoot), 'and is not asked to ready as well').toBeNull();
    expect(readyButton(guestRoot), 'the guest readies').toBeTruthy();
    expect(startButton(guestRoot), 'and cannot start').toBeNull();
  });

  it('Start stays dead until the guest has both picked AND readied', () => {
    const f = both();
    expect(startButton(f.hostRoot)!.disabled, 'nobody has picked').toBe(true);
    picked(f);
    expect(startButton(f.hostRoot)!.disabled, 'picked, not readied').toBe(true);
    readyButton(f.guestRoot)!.click();
    expect(startButton(f.hostRoot)!.disabled, 'and now the host may go').toBe(false);
  });

  it('un-readying kills it again — the guest keeps the veto until the press', () => {
    const f = picked(both());
    readyButton(f.guestRoot)!.click();
    expect(startButton(f.hostRoot)!.disabled).toBe(false);
    readyButton(f.guestRoot)!.click();
    expect(startButton(f.hostRoot)!.disabled, 'taken back').toBe(true);
  });

  it('the Ready button says which way it is pointing', () => {
    // A toggle that looks the same in both states is a toggle nobody trusts.
    const f = picked(both());
    const before = readyButton(f.guestRoot)!;
    expect(before.dataset['ready']).toBe('false');
    expect(before.textContent).toMatch(/ready up/i);

    before.click();
    const after = readyButton(f.guestRoot)!;
    expect(after.dataset['ready']).toBe('true');
    expect(after.classList.contains('is-ready')).toBe(true);
  });

  it('and the host is told what the wait is for rather than just greyed out', () => {
    const f = picked(both());
    expect(f.hostRoot.querySelector('.lobby-wait')?.textContent).toMatch(/waiting/i);
    readyButton(f.guestRoot)!.click();
    expect(f.hostRoot.querySelector('.lobby-wait'), 'and the line goes when the wait does').toBeNull();
  });

  it('pressing Start once the room is ready actually starts it', () => {
    const f = picked(both());
    readyButton(f.guestRoot)!.click();
    expect(f.hub.room.state, 'still a lobby').toBeUndefined();
    startButton(f.hostRoot)!.click();
    expect(f.hub.room.state, 'and the match is on').toBeDefined();
  });

  it('the guest waits, and its screen says so', () => {
    const f = picked(both());
    readyButton(f.guestRoot)!.click();
    expect(f.guestRoot.querySelector('.lobby-wait')?.textContent).toMatch(/host/i);
    expect(f.hub.room.state, 'a ready guest has not started anything').toBeUndefined();
  });
});
