/**
 * M3-NET-BOARD's handoff: the lobby is finished, the board takes over.
 *
 * Extracted from `main.ts` for HARNESS-LOBBY-MATCH. `main.ts` runs its whole
 * boot on import — it reads `window.location`, mounts into `#app`, and starts a
 * hot-seat if no query says otherwise — so nothing in it could ever be reached
 * by a test. This transition is the one piece of that file worth reaching: it is
 * the moment the pick screen is destroyed and the controller is handed a state
 * it did not build, which is precisely the "pure function passes, wiring broken"
 * class that produced the ready-button bug.
 *
 * The module has **no side effects on import** and takes everything it needs as
 * arguments, including the renderer factory — the same seam `startHotSeat` grew
 * for KESTREL-CONE, threaded one level further so a headless test can drive the
 * handoff without a GPU.
 */

import {
  buildCatalystPool,
  buildRoster,
  type CatalystData,
  type CharacterDef,
  type GameState,
  type MapDef,
  type TurnEvent,
  type UnitOrders,
} from '@cards/engine';
import { startHotSeat, type HotSeatUI } from './app.js';
import type { RoomClient, NetState } from './net.js';
import { connectionLabel, waitingLabel } from './waiting.js';
import { NO_PRESENCE, coverNotice, presenceOf, type Presence } from './presence.js';
import type { createRenderer } from './renderer3d.js';

/**
 * What a networked match needs that the room does not carry: the maps it could
 * be on and the content it is played with. Passed rather than imported so this
 * module has no opinion about which build it is in — and so a test can hand it
 * two characters on an empty field.
 */
export interface NetBootConfig {
  maps: readonly MapDef[];
  catalog: readonly CharacterDef[];
  catalysts: CatalystData;
  /** The renderer seam. Absent in production, where the real one is built. */
  createRenderer?: typeof createRenderer;
  /** Where the board mounts. Absent in production, where `main.ts` owns the ids. */
  ui?: HotSeatUI;
}

/**
 * Watch a lobby for the moment it becomes a match, and hand over exactly once.
 *
 * `inMatch` is the whole of the guard, and it has to be: the server re-sends a
 * `matchStarted` to a **reclaiming** seat (M3-RECONNECT), so a handoff that ran
 * on every `match` frame would tear down a board mid-turn and rebuild it.
 */
export function watchForMatch(
  client: RoomClient,
  screen: { destroy(): void },
  board: HTMLElement,
  config: NetBootConfig,
): () => void {
  let inMatch = false;
  return client.subscribe((net) => {
    if (net.phase !== 'match' || inMatch) return;
    inMatch = true;
    screen.destroy();
    board.replaceChildren();
    startNetworkedMatch(client, net, config);
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
export function startNetworkedMatch(
  client: RoomClient,
  started: NetState,
  config: NetBootConfig,
): void {
  const seat = started.seat;
  const opening = started.state;
  if (seat === undefined || opening === undefined) return;

  // The page's own nodes in production; a test hands its own in, along with the
  // renderer factory, so the handoff can be driven headlessly.
  const ui: HotSeatUI = config.ui ?? {
    board: document.getElementById('board')!,
    status: document.getElementById('status')!,
    controls: document.getElementById('controls')!,
    log: document.getElementById('log') ?? undefined,
    ...(config.createRenderer === undefined ? {} : { createRenderer: config.createRenderer }),
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
  /**
   * TEAMMATE-PLAN-VISIBLE — the orders this seat's TEAMMATES have locked in.
   *
   * The server has relayed a team's own submissions since M3-HIDDEN (golden
   * rule #5: hidden information is team vs team); nothing here widens what
   * arrives. Forwarded on change like the control map and presence, and for the
   * same reason — it moves when somebody locks in, not on every frame, and a
   * repaint per frame would throw away the draft the player is composing.
   *
   * This seat's OWN entry is dropped: the board already draws local drafts, and
   * echoing them back would fight with the live one the player is editing.
   */
  let onTeamOrders: ((orders: UnitOrders[]) => void) | undefined;
  let teamOrders = '';
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
    const mine = now.seat?.seatId;
    const relayed = Object.entries(now.orders)
      .filter(([seatId]) => seatId !== mine)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flatMap(([, orders]) => orders);
    const relayedKey = JSON.stringify(relayed);
    if (relayedKey !== teamOrders) {
      teamOrders = relayedKey;
      onTeamOrders?.(relayed);
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
    config.maps.find((m) => m.id === started.room?.mapId) ?? config.maps[0]!,
    buildRoster(config.catalog),
    [[], []], // unused: the opening state is handed in, not created here
    opening.format,
    [1, 1],
    buildCatalystPool(config.catalysts),
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
      onTeamOrders: (handler) => { onTeamOrders = handler; },
      extend: () => { client.extend(); },
    },
    opening,
  );
}
