/**
 * NET-E2E — **two real controllers, one real room, no sockets and no clock.**
 *
 * Not a Vitest file (no `.test.` in the name) — fixtures only.
 *
 * `app-harness.ts` reaches everything inside one `startHotSeat`. What it cannot
 * reach is the seam between *two* of them: orders leaving one client, crossing
 * the server, and coming back to both as a resolution. Every networked test
 * before this one stopped at one side of that seam — `recordingNet` is a fake
 * that records `submit` and never delivers it anywhere, and the server tests
 * drive `RoomHub` with no client attached at all. Both halves have been correct
 * for four sessions; the join between them has never once been executed in CI.
 *
 * That is the same "pure function passes, wiring broken" class that produced
 * DEATH-HANG — a downed seat froze the *client*, not the engine — and it is the
 * class the live playtest is about to walk straight into.
 *
 * Three seams are real here and one is not:
 *
 * - **Real:** `RoomHub` + `createRoom` (the actual server), `RoomClient` (the
 *   actual reducer and frame codec), and `watchForMatch` → `startNetworkedMatch`
 *   → `startHotSeat` (the actual controller, HUD and order builder).
 * - **Not real:** the transport. {@link Loopback} hands a frame straight to the
 *   other side's `receive`, synchronously. A WebSocket would add latency and a
 *   scheduler and buy nothing — the bugs this exists to catch are about *what*
 *   is sent, not about how long it takes to arrive.
 *
 * The clock is injected the way `hub.ts` documents and the timer tests already
 * use: a counter a test advances. Nothing here sleeps, so nothing here is flaky.
 */

import type { CatalystData, CharacterDef, FormatId, GameState, MapDef, Roster, Vec2 } from '@cards/engine';
import { buildRoster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import { watchForMatch } from '../src/net-boot.js';
import { stubRenderer, type StubRenderer } from './app-harness.js';
import type { RenderUnit } from '../src/renderer3d.js';
import catalystData from '../../../data/catalysts.json';

/**
 * One connection, both directions, in process.
 *
 * `send` on the client side is `hub.receive`; `send` on the hub side is
 * `client.receive`. A real socket is exactly this with a network in the middle.
 */
export class Loopback implements Sink {
  readonly client: RoomClient;
  #open = true;
  constructor(private readonly hub: RoomHub, readonly socketId: string) {
    this.client = new RoomClient({
      send: (data: string) => { if (this.#open) this.hub.receive(this.socketId, data); },
      close: () => { this.hub.close(this.socketId); },
    });
    this.hub.open(socketId, this);
  }
  send(data: string): void { this.client.receive(data); }
  close(): void { this.client.closed(); }
  /**
   * Pull the plug the way a dropped connection does: the hub notices the socket
   * is gone, and nothing this client sends afterwards reaches it. Deliberately
   * *not* a clean `leave` — a seat that says goodbye is released, and the whole
   * point of a reconnect is the seat that did not get to.
   */
  drop(): void {
    this.#open = false;
    this.hub.close(this.socketId);
    this.client.closed();
  }
}

/** One player: a connection, the DOM its board is mounted in, and its renderer. */
export interface NetSeat {
  name: string;
  wire: Loopback;
  client: RoomClient;
  root: HTMLElement;
  board: HTMLElement;
  status: HTMLElement;
  controls: HTMLElement;
  log: HTMLElement;
  renderer: StubRenderer;
}

export interface NetRoomOptions {
  format: FormatId;
  map: MapDef;
  catalog: readonly CharacterDef[];
  /** One entry per seat, in join order: the character ids that seat picks. */
  picks: readonly (readonly string[])[];
  catalysts?: CatalystData;
  /** A fixed deal, for a room that should start without anybody picking. */
  teams?: [CharacterDef[], CharacterDef[]];
}

export interface NetRoom {
  hub: RoomHub;
  seats: NetSeat[];
  /** The injected clock, in ms. Advance it; nothing advances it on its own. */
  now: { ms: number };
  /** Everybody picks, everybody but the creator readies, the creator starts. */
  start(): void;
  /** Bring a dropped seat back on a fresh socket, reclaiming by seat id. */
  rejoin(index: number, socketId: string): NetSeat;
}

/**
 * A room with `picks.length` connected players, each with its own board mounted
 * and its own recording renderer.
 *
 * Each seat gets a **separate DOM subtree**, because two controllers on one
 * document is precisely the arrangement a `document.querySelector` in a test
 * would silently get wrong — every helper here takes the seat's own `controls`.
 */
export function netRoom(opts: NetRoomOptions): NetRoom {
  const now = { ms: 0 };
  const roster: Roster = buildRoster([...opts.catalog]);
  const config: MatchConfig = {
    map: opts.map,
    roster,
    ...(opts.teams === undefined ? {} : { teams: opts.teams }),
  };
  const hub = new RoomHub(createRoom('WXYZ', opts.format), config, () => now.ms);

  const mount = (name: string, wire: Loopback): NetSeat => {
    const root = document.createElement('div');
    const board = document.createElement('div');
    const status = document.createElement('div');
    const controls = document.createElement('div');
    const log = document.createElement('div');
    root.append(board, status, controls, log);
    document.body.appendChild(root);
    const renderer = stubRenderer();
    // The lobby screen is a stub: this harness is about the *match*, and the
    // real pick screen has its own end-to-end test (HARNESS-LOBBY-MATCH).
    // `watchForMatch` only ever calls `destroy` on it.
    watchForMatch(wire.client, { destroy: () => {} }, board, {
      maps: [opts.map],
      catalog: [...opts.catalog],
      // Defaults to the shipped pool: the controller builds a real one at boot.
      catalysts: opts.catalysts ?? (catalystData as unknown as CatalystData),
      ui: { board, status, controls, log, createRenderer: () => renderer },
    });
    return { name, wire, client: wire.client, root, board, status, controls, log, renderer };
  };

  const seats: NetSeat[] = opts.picks.map((_, i) => {
    const wire = new Loopback(hub, `sock-${i}`);
    const seat = mount(String.fromCharCode(65 + i), wire);
    seat.client.join(seat.name);
    return seat;
  });

  return {
    hub,
    seats,
    now,
    start(): void {
      opts.picks.forEach((ids, i) => {
        seats[i]!.client.pick(ids.map((characterId) => ({ characterId })));
      });
      // LOBBY-READY: everyone but the creator readies, then the creator starts.
      for (const seat of seats.slice(1)) seat.client.ready(true);
      seats[0]!.client.start();
    },
    rejoin(index: number, socketId: string): NetSeat {
      const old = seats[index]!;
      const seatId = old.client.net.seat?.seatId;
      if (seatId === undefined) throw new Error(`seat ${index} never had a seat id`);
      const wire = new Loopback(hub, socketId);
      const seat = mount(old.name, wire);
      seat.client.join(old.name, seatId);
      seats[index] = seat;
      return seat;
    },
  };
}

/** The board this seat is currently looking at, by unit id. */
export const boardOf = (seat: NetSeat): Map<string, RenderUnit> =>
  new Map(seat.renderer.draw.board.units.map((u) => [u.unitId, u]));

/**
 * What two clients must agree about, given that they are **not** sent the same
 * thing.
 *
 * M3-HIDDEN filters every payload to the receiving team, so "both clients reach
 * the same state" cannot mean "the same object" — a seat that could see the
 * whole board would be the bug. What it means is that where their views
 * *overlap*, they overlap exactly: any unit both clients can see has the same
 * position and the same HP on both.
 *
 * The overlap is never empty in practice (each seat always sees its own units,
 * and the other sees them the moment they are in vision), so a test asserts on
 * this **and** on the overlap being non-trivial — otherwise a client that drew
 * nothing at all would agree with everybody.
 */
export function agreement(a: NetSeat, b: NetSeat): {
  shared: string[];
  disagreements: string[];
} {
  const left = boardOf(a);
  const right = boardOf(b);
  const shared: string[] = [];
  const disagreements: string[] = [];
  for (const [unitId, mine] of left) {
    const theirs = right.get(unitId);
    if (theirs === undefined) continue;
    shared.push(unitId);
    if (mine.hp !== theirs.hp) {
      disagreements.push(`${unitId}: hp ${mine.hp} vs ${theirs.hp}`);
    }
    if (mine.pos.x !== theirs.pos.x || mine.pos.y !== theirs.pos.y) {
      disagreements.push(`${unitId}: at ${key(mine.pos)} vs ${key(theirs.pos)}`);
    }
  }
  return { shared: shared.sort(), disagreements };
}

const key = (p: Vec2): string => `${p.x},${p.y}`;

/** The turn each client believes it is on, read off the server state it holds. */
export const turnOf = (seat: NetSeat): number | undefined => seat.client.net.state?.turn;

/** The server's own authoritative state — the thing both clients are views of. */
export const serverState = (room: NetRoom): GameState | undefined => room.hub.room.state;
