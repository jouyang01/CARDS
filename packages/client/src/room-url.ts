/**
 * How a browser gets into a room — the URL half, kept pure so it is testable
 * without a page.
 *
 * `?room=WXYZ` is the whole entry point: the Worker mints a code, the player
 * shares the link, and the client opens a socket to that room. Without it the
 * client boots the local hot-seat exactly as before, so the networked path is
 * strictly additive and MAPTOGGLE's dev query keeps working.
 *
 * A malformed code is an **error, not a fallback** — the same rule
 * `match-setup.ts` follows. Quietly dropping into the hot-seat because the code
 * was mistyped would leave a player wondering why nobody else ever joined.
 */

import { ROOM_CODE_LENGTH, isRoomCode } from '@cards/server/room';

export interface RoomLink {
  /** Always upper-case: codes are minted upper-case and links get typed by hand. */
  code: string;
  /** The display name to join under, when the link carries one. */
  name?: string;
}

export type RoomLinkResult =
  | { link: RoomLink }
  | { errors: string[] }
  /** No `?room=` at all — boot the hot-seat, which is not an error. */
  | undefined;

/** Read `?room=…&name=…`, or `undefined` when the link is not a room link. */
export function parseRoomLink(search: string): RoomLinkResult {
  const params = new URLSearchParams(search);
  const raw = params.get('room');
  if (raw === null) return undefined;
  const code = raw.trim().toUpperCase();
  if (!isRoomCode(code)) {
    return { errors: [`room: "${raw}" is not a ${ROOM_CODE_LENGTH}-letter room code`] };
  }
  const name = params.get('name')?.trim();
  return { link: name === undefined || name === '' ? { code } : { code, name } };
}

/** Just enough of `window.location` to say where the page came from. */
export interface PageOrigin {
  protocol: string;
  host: string;
}

/**
 * M3-DEPLOY-PREP — where the Worker lives, when it is not where the page does.
 *
 * In development the two are the same origin: `vite dev` proxies `/rooms` to a
 * local `wrangler dev`, so a relative path and a same-origin socket are exactly
 * right. **In production they are not.** The client is a static site (GitHub
 * Pages) and the Worker is on `workers.dev`, so a client that derived the server
 * from `window.location` would ask a static host for a WebSocket.
 *
 * So the origin is **configuration**, read once by the shell in `main.ts` from
 * `VITE_WORKER_ORIGIN` and threaded in. An empty or absent value means "the page
 * is the server", which is the development behaviour unchanged — the networked
 * path stays additive rather than the deploy rewriting how local play works.
 *
 * A configured value with no scheme is taken as **https**: the only thing that
 * is ever configured here is a `workers.dev` (or custom-domain) host, and those
 * are TLS-only. Guessing `http` for one would produce a URL that a TLS page is
 * not allowed to open at all — a silent failure instead of a working default.
 */
export function workerBase(page: PageOrigin, configured?: string): PageOrigin {
  const trimmed = configured?.trim() ?? '';
  if (trimmed === '') return { protocol: page.protocol, host: page.host };
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  // `ws://` / `wss://` are accepted and normalised, because "the socket URL" is
  // the shape somebody will naturally paste in.
  const protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol;
  return { protocol, host: url.host };
}

/**
 * The room's WebSocket URL.
 *
 * `ws`/`wss` matched to `http`/`https` — a page served over TLS cannot open a
 * plaintext socket, and hard-coding either scheme breaks one of the two
 * deployments. The path mirrors the Worker's own route.
 */
export function roomSocketUrl(page: PageOrigin, code: string, configured?: string): string {
  const base = workerBase(page, configured);
  const scheme = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${base.host}/rooms/${code.toUpperCase()}/ws`;
}

/**
 * An HTTP path on the Worker — `POST /rooms`, and the room lookup.
 *
 * Returns the path **unchanged** when no origin is configured, so a same-origin
 * deployment keeps issuing relative requests and nothing about local play moves.
 */
export function workerUrl(page: PageOrigin, path: string, configured?: string): string {
  const trimmed = configured?.trim() ?? '';
  if (trimmed === '') return path;
  const base = workerBase(page, trimmed);
  return `${base.protocol}//${base.host}${path}`;
}
