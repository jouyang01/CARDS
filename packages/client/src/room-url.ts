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

/**
 * The room's WebSocket URL, derived from where the page itself came from.
 *
 * Same origin, `ws`/`wss` matched to `http`/`https` — a page served over TLS
 * cannot open a plaintext socket, and hard-coding either scheme breaks one of
 * the two deployments. The path mirrors the Worker's own route.
 */
export function roomSocketUrl(origin: { protocol: string; host: string }, code: string): string {
  const scheme = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${origin.host}/rooms/${code.toUpperCase()}/ws`;
}
