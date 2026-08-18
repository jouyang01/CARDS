/**
 * M3-ROOM-CREATE — minting a room from the client, pure half.
 *
 * `?room=CODE` has booted into a lobby since M3-LOBBY-UI, but nothing in the UI
 * ever called `POST /rooms`, so the only way to get a code was `curl`. This is
 * the missing call: pick a map and a format, ask the Worker for a code, and go
 * to the link it hands back.
 *
 * **Map and format are the room's, not a seat's** (ruled: "MAP/FORMAT are
 * ROOM-level"). The seat screen picks characters and catalysts; a board that one
 * player could change under another mid-pick needs a conflict rule nobody wants
 * to write. So they are chosen once, here, by whoever creates the room.
 *
 * The transport is injected rather than reached for, like every other seam in
 * this codebase: a test hands in a function that returns a canned response, and
 * nothing here needs a network to be checked.
 */

import { DEFAULT_FORMAT, FORMATS, type FormatId, type MapDef } from '@cards/engine';

/** What the host chose, before it is sent. */
export interface RoomRequest {
  format: FormatId;
  /** Absent means "the server's default map" — a legal choice, not a missing one. */
  mapId?: string;
}

export type CreateResult =
  | { code: string }
  /** The Worker refused, or the network did. Shown, never swallowed. */
  | { error: string };

/** The query the Worker expects. Built here so no caller spells it twice. */
export function createRoomPath(request: RoomRequest): string {
  const params = new URLSearchParams({ format: request.format });
  if (request.mapId !== undefined) params.set('map', request.mapId);
  return `/rooms?${params.toString()}`;
}

/** Where the browser goes once a code comes back — the existing lobby boot. */
export const roomLinkFor = (code: string): string => `?room=${code.toUpperCase()}`;

/**
 * Ask the Worker for a room.
 *
 * Every failure is a *value*: a refused format, a 500, a dead network and a
 * response that is not JSON all come back as `{ error }` for the caller to
 * show. A create button that throws leaves the host looking at a page that did
 * nothing, which is the same failure this whole item exists to fix.
 */
export async function requestRoom(
  post: (path: string) => Promise<Response>,
  request: RoomRequest,
): Promise<CreateResult> {
  let response: Response;
  try {
    response = await post(createRoomPath(request));
  } catch (cause) {
    return { error: `could not reach the server (${String(cause)})` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { error: `the server answered ${response.status} with something that is not JSON` };
  }
  const payload = body as { code?: unknown; error?: unknown };
  if (typeof payload.error === 'string') return { error: payload.error };
  if (typeof payload.code !== 'string') return { error: `the server answered ${response.status} without a room code` };
  return { code: payload.code };
}

/** One option in the host's map list. */
export interface MapOption {
  id: string;
  name: string;
  /** Which formats this map has enough spawn squares for. */
  formats: FormatId[];
}

/**
 * The maps a host may create on, annotated with the formats each supports.
 *
 * Derived from the map's own spawn lists rather than tabulated: a map with two
 * spawns per team cannot seat a 4v4, and `validateMapForFormat` says so at match
 * creation. Offering the combination anyway would mint a room that throws the
 * moment somebody pressed start.
 */
export function mapOptions(maps: readonly MapDef[]): MapOption[] {
  return maps.map((map) => ({
    id: map.id,
    name: map.name,
    formats: (Object.keys(FORMATS) as FormatId[])
      .filter((id) => map.spawns.every((team) => team.length >= FORMATS[id].charactersPerTeam)),
  }));
}

/**
 * The formats offered for a chosen map. Empty is impossible for a valid map (1v1
 * needs one spawn), so an empty list means the map data is broken rather than
 * the choice being unlucky.
 */
export function formatsFor(options: readonly MapOption[], mapId: string): FormatId[] {
  return options.find((o) => o.id === mapId)?.formats ?? [];
}

/**
 * The host's opening choice: the first map, and the default format if that map
 * supports it. Never a combination the map cannot seat.
 */
export function defaultRequest(options: readonly MapOption[]): RoomRequest {
  const first = options[0];
  if (first === undefined) return { format: DEFAULT_FORMAT };
  const format = first.formats.includes(DEFAULT_FORMAT) ? DEFAULT_FORMAT : first.formats[0] ?? DEFAULT_FORMAT;
  return { format, mapId: first.id };
}
