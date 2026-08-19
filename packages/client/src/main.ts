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
  type GameState,
  type MapDef,
  type TurnEvent,
} from '@cards/engine';
import { startHotSeat, type HotSeatUI } from './app.js';
import { describeSetup, parseSetup } from './match-setup.js';
import { RoomClient, type NetState } from './net.js';
import { lobbyStatus } from './lobby.js';
import { createLobbyScreen, type CatalystOption } from './lobby-screen.js';
import { parseRoomLink, roomSocketUrl, workerUrl, type RoomLink } from './room-url.js';
import { createCreateScreen } from './create-screen.js';
import { connectionLabel, waitingLabel } from './waiting.js';
import { reconnectDelayMs, shouldReconnect, ticketsFor } from './reconnect.js';
import { NO_PRESENCE, coverNotice, presenceOf, type Presence } from './presence.js';
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
import kestrel from '../../../data/characters/kestrel.json';

/** The first map is the default; the rest are reachable via `?map=<id>`. */
const MAPS = [duelArena, ironBasin] as unknown as MapDef[];

/**
 * The dev draft order. Dealt alternately (`dealTeams`), so the first four give
 * the 2v2 demo this file has always shipped — Vex + Wisp against Bastion +
 * Aegis — and the first eight give a 4v4 with a comparable archetype mix on
 * each side.
 *
 * **Kestrel is back (BASIC-MODES)** and is deliberately **last**. She was held
 * out while Twin Bolts had no toggle to aim it with; now that it has one she is
 * pickable in the lobby, which is what the roster is for. Appended rather than
 * slotted in because `dealTeams` takes the first `perTeam * 2` entries: at the
 * end she joins the pool a lobby picks from without moving anybody in the
 * hot-seat's 2v2 or 4v4 deal.
 */
const CATALOG = [vex, bastion, wisp, aegis, cinder, lumen, ravok, thorn, kestrel] as unknown as CharacterDef[];

/** The nine catalysts (CAT1). Validated here for the same reason the map is. */
const CATALYSTS = catalystData as unknown as CatalystData;

/**
 * M3-DEPLOY-PREP — where the Worker is, read once, here.
 *
 * The **only** place this build's environment is consulted. Everything that
 * needs it takes it as an argument, which is what keeps `room-url.ts` testable
 * without a bundler and what stopped the socket URL being a `localhost` constant
 * somebody would have to remember to change.
 *
 * Empty in development and in the hot-seat, where the page *is* the server.
 */
const WORKER_ORIGIN = import.meta.env.VITE_WORKER_ORIGIN ?? '';

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
} else if (new URLSearchParams(window.location.search).has('create')) {
  // M3-ROOM-CREATE: `?create` is the host's entry. Its own query rather than a
  // control on the hot-seat board, because creating a room replaces the screen
  // — and because the hot-seat is still the default with no query at all.
  bootCreateRoom();
} else {
  bootHotSeat();
}

/**
 * CREATE-LINK is the hot-seat's front door and nothing else's: on the create
 * form it points at the page you are already on, and in a room it is a way to
 * walk out of a match by accident.
 */
function hideCreateLink(): void {
  const link = document.getElementById('create-link');
  if (link !== null) link.style.display = 'none';
}

/** The create form: choose a map and a format, get a code, follow it in. */
function bootCreateRoom(): void {
  hideCreateLink();
  const board = document.getElementById('board')!;
  const status = document.getElementById('status')!;
  status.textContent = 'Create a room';
  const root = document.createElement('div');
  root.className = 'lobby';
  board.replaceChildren(root);
  createCreateScreen({ root }, MAPS, {
    // The Worker's origin rather than the page's: on Pages the two differ, and
    // a relative POST would ask a static host to mint a room.
    post: (path) => fetch(workerUrl(window.location, path, WORKER_ORIGIN), { method: 'POST' }),
    navigate: (href) => { window.location.search = href; },
  });
}

/**
 * Join a room: one socket, one `RoomClient`, one pick screen over it.
 *
 * The screen is torn down the moment the match starts — a lobby left mounted
 * over a running board is a pick screen you can still click.
 */
function joinRoom(link: RoomLink): void {
  hideCreateLink();
  const board = document.getElementById('board')!;
  const status = document.getElementById('status')!;
  status.textContent = `Connecting to room ${link.code}…`;

  // M3-RECONNECT: the ticket is a seat id remembered per room code. Read before
  // the first connection, because the first connection may *be* the reconnect —
  // a reload after a drop is exactly the case this exists for.
  //
  // LOBBY-READY-FIX: **per browsing context** (`ticketsFor` → `sessionStorage`).
  // This was `localStorage`, which two tabs of one browser share — so opening a
  // room in a second tab handed the server the *first* tab's seat id, and
  // same-browser two-seat testing could not seat a second player at all.
  const tickets = ticketsFor(window);
  let attempt = 0;
  let client!: RoomClient;

  /**
   * Open a socket and hand it to the client.
   *
   * One function for the first connection and every reclaim after it: the only
   * difference between them is whether a ticket goes out with the handshake,
   * and letting them diverge is how a reconnect ends up on a code path the
   * first connect never exercises.
   */
  const connect = (): void => {
    const socket = new WebSocket(roomSocketUrl(window.location, link.code, WORKER_ORIGIN));
    const sink = {
      send: (data: string) => { socket.send(data); },
      close: () => { socket.close(); },
    };
    if (client === undefined) client = new RoomClient(sink);
    else client.attach(sink);

    socket.addEventListener('open', () => {
      attempt = 0; // a socket that opened is a fresh budget for the next drop
      client.join(link.name, tickets.get(link.code));
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => { client.receive(event.data); });
    socket.addEventListener('close', () => {
      client.closed();
      // A refusal closes the socket too, and retrying one is an endless loop of
      // the same refusal — so the ticket is what decides, and the server clears
      // it by refusing the reclaim (see the subscription below).
      attempt += 1;
      const delay = shouldReconnect(client.net.phase, tickets.get(link.code), attempt)
        ? reconnectDelayMs(attempt)
        : undefined;
      if (delay === undefined) return;
      client.attach(sink); // says "reconnecting" now, so the banner does not read as dead
      window.setTimeout(connect, delay);
    });
  };
  connect();
  const catalystOptions: CatalystOption[] = Object.values(buildCatalystPool(CATALYSTS))
    .map((c) => ({ id: c.id, name: c.name, phase: c.phase, description: c.description }));

  const root = document.createElement('div');
  root.className = 'lobby';
  board.replaceChildren(root);
  const screen = createLobbyScreen({ root }, client, CATALOG, catalystOptions);

  let inMatch = false;
  client.subscribe((net) => {
    status.textContent = net.error?.message ?? lobbyStatus(net);
    // M3-RECONNECT: remember the seat the moment the server names it, and forget
    // it the moment the server refuses to honour it. A ticket the room will not
    // take is worse than none — it is what a retry loop would spin on.
    if (net.seat !== undefined) tickets.put(link.code, net.seat.seatId);
    if (net.error?.code === 'unknownSeat' || net.error?.code === 'seatTaken') tickets.clear(link.code);
    if (net.phase !== 'match' || inMatch) return;
    inMatch = true;
    screen.destroy();
    board.replaceChildren();
    startNetworkedMatch(client, net);
  });
}

/**
 * M3-NET-BOARD — hand the started match to the board controller.
 *
 * The seat, its characters and the opening state all come from `matchStarted`,
 * which is already filtered for this team; the controller renders that and
 * **never resolves anything**. Lock-in calls `submit`, and the server's
 * `turnResolved` — which `RoomClient` has already folded, filtered — is fed back
 * through `onResolved` into the same playback the hot-seat uses.
 */
function startNetworkedMatch(client: RoomClient, started: NetState): void {
  const seat = started.seat;
  const opening = started.state;
  if (seat === undefined || opening === undefined) return;

  const ui: HotSeatUI = {
    board: document.getElementById('board')!,
    status: document.getElementById('status')!,
    controls: document.getElementById('controls')!,
    log: document.getElementById('log') ?? undefined,
  };

  let onResolved: ((state: GameState, events: TurnEvent[]) => void) | undefined;
  let onStatus: ((banner: string | undefined) => void) | undefined;
  let onTimer: ((remainingMs: number | undefined, charges: number) => void) | undefined;
  // M3-TIMER: only a frame that actually carried a window is forwarded. The
  // reducer keeps the last `remainingMs` across every other message type, so
  // re-sending it on (say) a `pong` would silently rewind the countdown to
  // whatever it was when the last `decision` arrived.
  // TIMER-EVERY-PHASE: the countdown re-anchors on every Decision payload, and
  // `windowSeq` is what identifies one. This used to compare `remainingMs` and
  // `bank` for a change — but turn 2 opens with the *same* full window and the
  // same charge count as turn 1, so the comparison was false and turn 2's clock
  // was never started after playback stopped turn 1's.
  let windowSeq = -1;
  let onControl: ((unitIds: string[]) => void) | undefined;
  // M3-RECONNECT: the control map, forwarded only when it actually moved. It
  // changes rarely (a teammate dropping, a teammate returning) and rebuilding a
  // seat on every frame would throw away the drafts the player is mid-way
  // through composing.
  let control = started.unitIds.join(',');
  // Only *this* turn's resolution counts: the reducer keeps the last one, so a
  // repaint for some other reason must not replay a turn already animated.
  let played = opening.turn;
  let shown: string | undefined;
  let onPresence: ((presence: Presence) => void) | undefined;
  // NET-PRESENCE-UI: forwarded on change, like the control map and for the same
  // reason — it moves only when somebody drops or returns, and the topbar is
  // rebuilt wholesale when it does.
  let presence = NO_PRESENCE;
  const key = (p: Presence): string => `${p.awaySeatIds.join(',')}|${p.borrowedUnitIds.join(',')}`;
  client.subscribe((now) => {
    const seen = now.seat === undefined || now.room === undefined
      ? NO_PRESENCE
      : presenceOf({ seats: now.room.seats, mySeatId: now.seat.seatId, controls: now.unitIds });
    if (key(seen) !== key(presence)) {
      presence = seen;
      onPresence?.(seen);
    }
    // M3-CONN-STATE first: a dead socket outranks whose turn it is, and the
    // reason it outranks it is that nothing else is going to arrive. The cover
    // notice is last of the three: it explains a *standing* situation, so it is
    // the one worth saying while nothing more urgent is happening — and the
    // portrait marks say it too, and they are always on screen.
    const next = connectionLabel(now.phase) ?? waitingLabel(
      now.seat === undefined ? undefined : {
        seatId: now.seat.seatId,
        own: now.locked,
        ownOf: now.of,
        enemyReady: now.enemyLocked,
        enemyOf: now.enemyOf,
      },
    ) ?? coverNotice(seen);
    if (next !== shown) {
      shown = next;
      onStatus?.(next);
    }
    if (now.unitIds.join(',') !== control) {
      control = now.unitIds.join(',');
      onControl?.([...now.unitIds]);
    }
    if (now.windowSeq !== windowSeq) {
      windowSeq = now.windowSeq;
      onTimer?.(now.remainingMs, now.bank);
    }
    if (now.state === undefined || now.state.turn <= played) return;
    played = now.state.turn;
    onResolved?.(now.state, now.events);
  });

  startHotSeat(
    ui,
    // The map is the room's, and the room is the server's — the format comes
    // from the state it sent rather than from anything this client chose.
    MAPS.find((m) => m.id === started.room?.mapId) ?? MAPS[0]!,
    buildRoster(CATALOG),
    [[], []], // unused: the opening state is handed in, not created here
    opening.format,
    [1, 1],
    buildCatalystPool(CATALYSTS),
    undefined,
    {
      seatId: seat.seatId,
      team: seat.team,
      unitIds: started.unitIds,
      submit: (orders) => { client.submit(orders); },
      onResolved: (handler) => { onResolved = handler; },
      onStatus: (handler) => { onStatus = handler; },
      onTimer: (handler) => { onTimer = handler; },
      onControl: (handler) => { onControl = handler; },
      onPresence: (handler) => { onPresence = handler; },
      extend: () => { client.extend(); },
    },
    opening,
  );
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
