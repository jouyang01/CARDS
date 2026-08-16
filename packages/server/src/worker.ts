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
import { RoomDurableObject } from './durable-object.js';
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

/** `/rooms/WXYZ/ws` → `["WXYZ", "ws"]`; anything else → undefined. */
export function parseRoomPath(pathname: string): { code: string; rest: string } | undefined {
  const parts = pathname.split('/').filter((p) => p.length > 0);
  if (parts[0] !== 'rooms' || parts[1] === undefined) return undefined;
  return { code: parts[1].toUpperCase(), rest: parts[2] ?? '' };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/rooms') {
      const requested = url.searchParams.get('format') ?? DEFAULT_FORMAT;
      if (!(requested in FORMATS)) return json({ error: `unknown format "${requested}"` }, 400);
      const format = requested as FormatId;

      // Collisions are astronomically unlikely at 22^4 codes and one room per
      // party, but "unlikely" is not "handled": a second room minted onto a
      // live one would drop everybody already in it into somebody else's lobby.
      for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
        const code = mintCode(cryptoBytes);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const existing = await stub.fetch(`https://room/room`);
        if (existing.status !== 404) continue; // somebody is already in there
        await stub.fetch(`https://room/create?code=${code}&format=${format}`);
        return json({ code, format });
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
    if (route.rest === '') return await stub.fetch('https://room/room');
    // M3-START, over HTTP: the dev affordance for a short room, until the
    // client has a socket to send the `start` message down (M3-LOBBY). POST
    // rather than GET because it changes the room — a link preview fetcher
    // must not be able to start somebody's match.
    if (route.rest === 'start' && request.method === 'POST') {
      return await stub.fetch('https://room/start', { method: 'POST' });
    }
    return new Response('not found', { status: 404 });
  },
};
