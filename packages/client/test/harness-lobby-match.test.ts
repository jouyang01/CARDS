// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalystData, CharacterDef, MapDef, Roster } from '@cards/engine';
import { buildCatalystPool, buildRoster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import { createLobbyScreen, type CatalystOption } from '../src/lobby-screen.js';
import { watchForMatch } from '../src/net-boot.js';
import { stubRenderer } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * HARNESS-LOBBY-MATCH — the lobby→match handoff, driven end to end
 * (Builder OQ 2026-09-21 #6).
 *
 * The harness reaches everything inside `startHotSeat`. The one wiring surface
 * it could not reach was the handoff: the subscribe callback that notices the
 * room has started, tears the pick screen down and hands the controller a state
 * it did not build. It lived in `main.ts`, which runs its whole boot on import,
 * so nothing in it was reachable from a test at all.
 *
 * That is the same class of surface that produced the ready-button bug — every
 * piece correct on its own, the join between them never exercised — and it is
 * the last one left. `net-boot.ts` is that piece, extracted; this drives it
 * against a **real** `RoomHub`, with a real lobby screen mounted over a real
 * `RoomClient`, and asserts the three things the AC asks for: the lobby goes,
 * the board comes up, and it comes up on the state the **server** sent for this
 * seat rather than one the client invented.
 */

const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const roster: Roster = buildRoster(CATALOG);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const CATALYSTS: CatalystOption[] = Object.values(POOL).map((c) => ({
  id: c.id, name: c.name, phase: c.phase, description: c.description,
}));
const MAP = duelArena as unknown as MapDef;
const config: MatchConfig = { map: MAP, roster, catalysts: POOL };

class Wire implements Sink {
  readonly client: RoomClient;
  constructor(private readonly hub: RoomHub, private readonly socketId: string) {
    this.client = new RoomClient({
      send: (data: string) => { this.hub.receive(this.socketId, data); },
      close: () => { this.hub.close(this.socketId); },
    });
    this.hub.open(socketId, this);
  }
  send(data: string): void { this.client.receive(data); }
  close(): void { this.client.closed(); }
}

/**
 * A 2v2 room with two players, a lobby screen over the first, and the handoff
 * armed — exactly the arrangement `joinRoom` builds, minus the page.
 */
const room = () => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
  const host = new Wire(hub, 'sock-0');
  const guest = new Wire(hub, 'sock-1');
  host.client.join('Ada');
  guest.client.join('Bo');

  // The nodes `main.ts` would have found by id, plus the renderer seam.
  const board = document.createElement('div');
  const status = document.createElement('div');
  const controls = document.createElement('div');
  const log = document.createElement('div');
  document.body.append(board, status, controls, log);

  const lobbyRoot = document.createElement('div');
  lobbyRoot.className = 'lobby';
  board.appendChild(lobbyRoot);
  const screen = createLobbyScreen({ root: lobbyRoot }, host.client, CATALOG, CATALYSTS);

  const renderer = stubRenderer();
  watchForMatch(host.client, screen, board, {
    maps: [MAP],
    catalog: CATALOG,
    catalysts: catalystData as unknown as CatalystData,
    ui: { board, status, controls, log, createRenderer: () => renderer },
  });
  return { hub, host, guest, board, status, controls, lobbyRoot, renderer };
};

/** Both seats pick, the guest readies, the host starts — the whole handshake. */
const startMatch = (r: ReturnType<typeof room>): void => {
  r.host.client.pick([{ characterId: 'vex' }, { characterId: 'wisp' }]);
  r.guest.client.pick([{ characterId: 'bastion' }, { characterId: 'aegis' }]);
  r.guest.client.ready(true);
  r.host.client.start();
};

beforeEach(() => { document.body.replaceChildren(); });

describe('HARNESS-LOBBY-MATCH: the lobby hands over to the board', () => {
  it('the lobby is up and the board is not, before anything starts', () => {
    const r = room();
    expect(r.lobbyRoot.querySelectorAll('[data-character]').length, 'a pick screen')
      .toBeGreaterThan(0);
    expect(r.controls.querySelectorAll('.hud-ability'), 'no hotbar yet').toHaveLength(0);
    expect(r.hub.room.state, 'and no match').toBeUndefined();
  });

  it('starting the match tears the pick screen down', () => {
    // "A lobby left mounted over a running board is a pick screen you can still
    // click." The screen's own `destroy` empties its root; the handoff also
    // clears the board node the lobby was mounted into.
    const r = room();
    startMatch(r);
    expect(r.hub.room.state, 'the room really did start').toBeDefined();
    expect(r.lobbyRoot.querySelectorAll('[data-character]'), 'no characters left to pick')
      .toHaveLength(0);
    expect(document.body.querySelector('.lobby-detail'), 'and the kit panel went with it')
      .toBeNull();
  });

  it('and the board comes up in its place', () => {
    const r = room();
    startMatch(r);
    expect(r.controls.querySelectorAll('.hud-ability').length, 'a live hotbar')
      .toBeGreaterThan(0);
    expect(r.controls.querySelector('.hud-lockrow .hud-lock'), 'and a Lock In').toBeTruthy();
  });

  it('on the seat\'s own characters, from the server\'s payload', () => {
    // The half that matters most: the controller renders a state it did not
    // build. `matchStarted` carries this seat's control map, so the hotbar has
    // to be the host's picks — not the guest's, and not a local deal.
    const r = room();
    startMatch(r);
    const names = [...r.controls.querySelectorAll('.hud-chip')].map((n) => n.textContent ?? '');
    const shown = names.join(' ');
    expect(shown, 'the host ordered Vex and Wisp').toContain('Vex');
    expect(shown).toContain('Wisp');
    expect(shown, 'and never the other side\'s').not.toContain('Bastion');
  });

  it('the board it draws is the FILTERED one — the enemy is fogged, not absent', () => {
    // M3-HIDDEN: the server sends each seat a team-filtered state. The handoff
    // must render that, so a fog layer is the proof it did not quietly ask the
    // engine for the whole board.
    const r = room();
    startMatch(r);
    const fog = r.renderer.draw.highlights.get('fog') ?? [];
    expect(fog.length, 'the board came up fogged').toBeGreaterThan(0);
  });

  it('and it happens exactly once, however many match frames arrive', () => {
    // The guard is load-bearing: the server re-sends `matchStarted` to a
    // reclaiming seat (M3-RECONNECT), so a handoff that fired on every `match`
    // frame would tear down a board mid-turn and rebuild it.
    const r = room();
    startMatch(r);
    const first = r.controls.querySelector('.hud-ability');
    expect(first).toBeTruthy();
    // Another Decision phase for the same seat: a second `match`-phase frame.
    r.guest.client.submit([]);
    expect(r.controls.querySelector('.hud-ability'), 'the same node, not a rebuild')
      .toBe(first);
  });

  it('a seat that never joined never hands over', () => {
    // The control: the transition is driven by the phase the server put this
    // client in, not by the room having started somewhere.
    const r = room();
    const spectatorBoard = document.createElement('div');
    document.body.appendChild(spectatorBoard);
    const idle = new Wire(r.hub, 'sock-2');
    let destroyed = false;
    watchForMatch(idle.client, { destroy: () => { destroyed = true; } }, spectatorBoard, {
      maps: [MAP], catalog: CATALOG, catalysts: catalystData as unknown as CatalystData,
    });
    startMatch(r);
    expect(destroyed, 'it was never in the match').toBe(false);
    expect(spectatorBoard.children, 'and nothing was mounted for it').toHaveLength(0);
  });
});
