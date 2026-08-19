/**
 * The Worker entry point — the front door to the rooms.
 *
 * Two routes and no state of its own:
 *   POST /rooms            → mint a code, wake its Durable Object, return both
 *   GET  /rooms/:code/ws   → upgrade and hand the socket to that room's DO
 *   GET  /rooms/:code      → the room record, for a client checking a code
 *
 * The code *is* the routing key: `idFromName(code)` is deterministic, so every
 * request for `WXYZ` lands on the same object without a directory to keep in
 * step. Cloudflare's own placement then pins that object to one location, which
 * is what makes a room single-threaded and its in-memory state safe.
 */

import { DEFAULT_FORMAT, FORMATS, type FormatId } from '@cards/engine';
import { RoomDurableObject, isMapId } from './durable-object.js';
import { ROOM_CODE_LENGTH, isRoomCode, mintCode } from './room.js';

export { RoomDurableObject };

export interface Env {
  ROOMS: DurableObjectNamespace;
}

/** How many code collisions to ride out before giving up on a mint. */
const MINT_ATTEMPTS = 8;

const cryptoBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'access-control-allow-origin': '*' } });

/**
 * QUOTA-RUNAWAY: every response the browser reads needs the CORS header, the
 * failures most of all. The client is on Pages and the Worker on workers.dev,
 * and a cross-origin response without the header is one the browser refuses to
 * show — an outage surfaced as the unreadable "TypeError: Failed to fetch"
 * instead of the message that names it. A 101 is exempt: it is a WebSocket
 * upgrade, not a readable response, and rebuilding it would drop the socket.
 */
const withCors = (response: Response): Response => {
  if (response.status === 101) return response;
  const wrapped = new Response(response.body, response);
  wrapped.headers.set('access-control-allow-origin', '*');
  return wrapped;
};

/** `/rooms/WXYZ/ws` → `["WXYZ", "ws"]`; anything else → undefined. */
export function parseRoomPath(pathname: string): { code: string; rest: string } | undefined {
  const parts = pathname.split('/').filter((p) => p.length > 0);
  if (parts[0] !== 'rooms' || parts[1] === undefined) return undefined;
  return { code: parts[1].toUpperCase(), rest: parts[2] ?? '' };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Nothing may escape as an uncaught exception: the runtime would answer
    // with an error page that carries no CORS header, which a browser reports
    // as a bare "Failed to fetch" (how the storage-quota outage hid for a day).
    // Caught here instead, the real message reaches the client's error path.
    try {
      return await handle(request, env);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return json({ error: `server error: ${message}` }, 500);
    }
  },
};

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/rooms') {
    const requested = url.searchParams.get('format') ?? DEFAULT_FORMAT;
    if (!(requested in FORMATS)) return json({ error: `unknown format "${requested}"` }, 400);
    const format = requested as FormatId;

    // M3-ROOM-CREATE: the map is the **host's** choice, taken here because
    // map and format are room-level (ruled) — the seat screen picks characters
    // and catalysts, and neither belongs to a seat. Validated rather than
    // defaulted on a typo, for MAPTOGGLE's reason: silently creating a room on
    // a different board than the host asked for is the one outcome a chooser
    // must not have.
    const map = url.searchParams.get('map') ?? undefined;
    if (map !== undefined && !isMapId(map)) return json({ error: `unknown map "${map}"` }, 400);

    // Collisions are astronomically unlikely at 22^4 codes and one room per
    // party, but "unlikely" is not "handled": a second room minted onto a
    // live one would drop everybody already in it into somebody else's lobby.
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
      const code = mintCode(cryptoBytes);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const existing = await stub.fetch(`https://room/room`);
      if (existing.status !== 404) continue; // somebody is already in there
      const query = map === undefined ? '' : `&map=${encodeURIComponent(map)}`;
      await stub.fetch(`https://room/create?code=${code}&format=${format}${query}`);
      return json(map === undefined ? { code, format } : { code, format, map });
    }
    return json({ error: 'could not mint a free room code' }, 503);
  }

  const route = parseRoomPath(url.pathname);
  if (route === undefined) return new Response('not found', { status: 404 });
  if (!isRoomCode(route.code)) {
    return json({ error: `a room code is ${ROOM_CODE_LENGTH} letters` }, 400);
  }

  const stub = env.ROOMS.get(env.ROOMS.idFromName(route.code));
  if (route.rest === 'ws') return await stub.fetch(new Request('https://room/ws', request));
  // The record lookup is read by the browser cross-origin, so the DO's
  // response needs the CORS header stamped on the way through.
  if (route.rest === '') return withCors(await stub.fetch('https://room/room'));
  // (`POST /rooms/:code/start` used to live here — the dev affordance for a
  // short room while the client had no socket to send `start` down. Deleted
  // with M3-LOBBY-UI, which is the slice that gave the client a start button;
  // ruled to go in that same slice so a networked match is never left without
  // a reachable start. The socket `start` message is the only one now.)
  return new Response('not found', { status: 404 });
}
