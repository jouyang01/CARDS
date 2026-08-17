/**
 * Client entry: launch a local hot-seat duel driven entirely by `@cards/engine`.
 * Order entry, turn resolution + event-log playback, and per-player→per-team
 * seating all live in the tested pure modules; this file picks the match setup
 * and mounts the controller.
 *
 * MAPTOGGLE: the setup is no longer hard-coded. `?map=…&format=…&players=…`
 * chooses it, `parseSetup` validates it, and the default is the 2v2 demo this
 * file used to spell out inline. The real lobby is M3.
 *
 * CAMO-SEED adds `?scenario=…` to the same family: a dev-only named starting
 * arrangement for board states that are ordinary in a match and expensive to
 * drive to from the opening frame.
 */
import {
  buildCatalystPool,
  buildRoster,
  validateCatalysts,
  type CatalystData,
  type CharacterDef,
  type MapDef,
} from '@cards/engine';
import { startHotSeat, type HotSeatUI } from './app.js';
import { describeSetup, parseSetup } from './match-setup.js';
import { RoomClient } from './net.js';
import { lobbyStatus } from './lobby.js';
import { createLobbyScreen, type CatalystOption } from './lobby-screen.js';
import { parseRoomLink, roomSocketUrl, type RoomLink } from './room-url.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import ironBasin from '../../../data/maps/iron-basin.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';
import cinder from '../../../data/characters/cinder.json';
import lumen from '../../../data/characters/lumen.json';
import ravok from '../../../data/characters/ravok.json';
import thorn from '../../../data/characters/thorn.json';

/** The first map is the default; the rest are reachable via `?map=<id>`. */
const MAPS = [duelArena, ironBasin] as unknown as MapDef[];

/**
 * The dev draft order. Dealt alternately (`dealTeams`), so the first four give
 * the 2v2 demo this file has always shipped — Vex + Wisp against Bastion +
 * Aegis — and all eight give a 4v4 with a comparable archetype mix on each
 * side. Kestrel is left out: 4v4 needs exactly eight, and picking who plays is
 * the M3 lobby's job, not a constant's.
 */
const CATALOG = [vex, bastion, wisp, aegis, cinder, lumen, ravok, thorn] as unknown as CharacterDef[];

/** The nine catalysts (CAT1). Validated here for the same reason the map is. */
const CATALYSTS = catalystData as unknown as CatalystData;

const app = document.getElementById('app')!;

// M3-LOBBY-UI — `?room=WXYZ` is the networked path: open a socket to that room
// and put up the pick screen. Checked before the hot-seat setup because the two
// are alternatives, and strictly additive: no `?room=`, no change to anything.
const roomLink = parseRoomLink(window.location.search);
if (roomLink !== undefined) {
  if ('errors' in roomLink) {
    app.innerHTML = `<pre style="color:#ff6b5e;white-space:pre-wrap">${roomLink.errors.join('\n')}</pre>`;
    throw new Error('invalid room link');
  }
  joinRoom(roomLink.link);
} else {
  bootHotSeat();
}

/**
 * Join a room: one socket, one `RoomClient`, one pick screen over it.
 *
 * The screen is torn down the moment the match starts — a lobby left mounted
 * over a running board is a pick screen you can still click.
 */
function joinRoom(link: RoomLink): void {
  const board = document.getElementById('board')!;
  const status = document.getElementById('status')!;
  status.textContent = `Connecting to room ${link.code}…`;

  const socket = new WebSocket(roomSocketUrl(window.location, link.code));
  const client = new RoomClient({
    send: (data) => { socket.send(data); },
    close: () => { socket.close(); },
  });
  const catalystOptions: CatalystOption[] = Object.values(buildCatalystPool(CATALYSTS))
    .map((c) => ({ id: c.id, name: c.name, phase: c.phase, description: c.description }));

  const root = document.createElement('div');
  root.className = 'lobby';
  board.replaceChildren(root);
  const screen = createLobbyScreen({ root }, client, CATALOG, catalystOptions);

  let inMatch = false;
  client.subscribe((net) => {
    status.textContent = net.error?.message ?? lobbyStatus(net);
    if (net.phase !== 'match' || inMatch) return;
    inMatch = true;
    screen.destroy();
    // The networked **board** is the one piece of M3-LOBBY-UI still to land:
    // `app.ts` resolves turns locally, and pointing it at a server-authoritative
    // stream is a controller change, not a wiring one. Everything under it is
    // already here and tested — `RoomClient` folds the fogged `decision` and the
    // filtered `turnResolved`, and `client.submit` sends the orders back.
    board.replaceChildren();
    const waiting = document.createElement('p');
    waiting.className = 'lobby-status';
    waiting.textContent = `Match started — turn ${net.state?.turn ?? 1}, `
      + `you are ordering ${net.unitIds.length} character(s).`;
    board.append(waiting);
  });

  socket.addEventListener('open', () => { client.join(link.name); });
  socket.addEventListener('message', (event: MessageEvent<string>) => { client.receive(event.data); });
  socket.addEventListener('close', () => { client.closed(); });
}

/** The local hot-seat, unchanged: MAPTOGGLE's query, `startHotSeat`, no socket. */
function bootHotSeat(): void {
  const setupResult = parseSetup(window.location.search, MAPS, CATALOG);
  const catalystErrors = validateCatalysts(CATALYSTS);
  const result = catalystErrors.length > 0
    ? { errors: [...('errors' in setupResult ? setupResult.errors : []), ...catalystErrors] }
    : setupResult;

  if ('errors' in result) {
    const lines = result.errors.join('\n');
    app.innerHTML = `<pre style="color:#ff6b5e;white-space:pre-wrap">Setup failed:\n${lines}</pre>`;
    throw new Error('invalid setup');
  }

  const { setup } = result;
  const ui: HotSeatUI = {
    board: document.getElementById('board')!,
    status: document.getElementById('status')!,
    controls: document.getElementById('controls')!,
    log: document.getElementById('log') ?? undefined,
  };

  // Name the loaded setup in the title bar: a dev toggle nobody can see is a
  // trap, and "am I actually on iron-basin?" is the first question a playtester
  // asks. The status line is rewritten by the controller every render.
  const title = document.querySelector('#app h1');
  if (title !== null) title.setAttribute('title', describeSetup(setup));
  ui.status.textContent = `Loading ${describeSetup(setup)}…`;

  startHotSeat(
    ui,
    setup.map,
    buildRoster(setup.teams.flat()),
    setup.teams,
    setup.format,
    setup.playersPerTeam,
    buildCatalystPool(CATALYSTS),
    setup.scenario,
  );
}
