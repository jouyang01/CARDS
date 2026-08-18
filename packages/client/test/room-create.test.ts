// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { MapDef } from '@cards/engine';
import {
  createRoomPath,
  defaultRequest,
  formatsFor,
  mapOptions,
  requestRoom,
  roomLinkFor,
} from '../src/room-create.js';
import { createCreateScreen } from '../src/create-screen.js';
import duelArena from '../../../data/maps/duel-arena.json';
import ironBasin from '../../../data/maps/iron-basin.json';

/**
 * M3-ROOM-CREATE — minting a room from the UI.
 *
 * `?room=CODE` has booted into a lobby since M3-LOBBY-UI and nothing ever called
 * `POST /rooms`, so the only way to get a code was `curl`. This is the last
 * thing between the lobby and two people actually playing.
 *
 * **Map and format are the room's** (ruled: "MAP/FORMAT are ROOM-level"), which
 * is why they are chosen here and not on the seat screen: a board one player
 * could change under another mid-pick needs a conflict rule nobody wants to
 * write. The interesting constraint is that the pair must be *seatable* — a
 * two-spawn map cannot hold a 4v4, and offering that combination would mint a
 * room that throws the moment somebody pressed start.
 */

const MAPS = [duelArena, ironBasin] as unknown as MapDef[];
/** A deliberately small map: two spawns a side, so 4v4 is impossible on it. */
const TINY: MapDef = {
  id: 'tiny', name: 'Tiny', width: 9, height: 9, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 4 }, { x: 1, y: 6 }], [{ x: 7, y: 4 }, { x: 7, y: 6 }]],
};

const okResponse = (body: unknown): Response =>
  ({ status: 200, json: async () => body }) as unknown as Response;

describe('the request the Worker is asked for', () => {
  it('carries the format, and the map when one is chosen', () => {
    expect(createRoomPath({ format: '2v2', mapId: 'iron-basin' }))
      .toBe('/rooms?format=2v2&map=iron-basin');
    expect(createRoomPath({ format: '4v4' }), 'no map means the server default')
      .toBe('/rooms?format=4v4');
  });

  it('and the code comes back as the link that boots the lobby', () => {
    expect(roomLinkFor('wxyz')).toBe('?room=WXYZ');
  });
});

describe('what a host may choose', () => {
  it('a format is offered only when the map has spawns for it', () => {
    // Derived from the map's own spawn lists, not tabulated — a map that grew a
    // third spawn per side would start offering 4v4 without anyone editing this.
    const options = mapOptions([TINY]);
    expect(formatsFor(options, 'tiny')).toEqual(['2v2', '1v1']);
    expect(formatsFor(options, 'tiny'), 'two spawns cannot seat four').not.toContain('4v4');
  });

  it('the shipped maps offer what their spawns support', () => {
    const options = mapOptions(MAPS);
    expect(options.map((o) => o.id)).toEqual(['duel-arena', 'iron-basin']);
    for (const option of options) {
      expect(option.formats, `${option.id} must at least play its default`).toContain('2v2');
    }
  });

  it('the opening choice is the first map and a format it can seat', () => {
    expect(defaultRequest(mapOptions([TINY]))).toEqual({ format: '2v2', mapId: 'tiny' });
    expect(defaultRequest([]), 'no maps at all still yields something sendable')
      .toEqual({ format: '2v2' });
  });

  it('an unknown map has no formats rather than throwing', () => {
    expect(formatsFor(mapOptions(MAPS), 'nope')).toEqual([]);
  });
});

describe('asking for a room', () => {
  it('returns the code the server minted', async () => {
    const seen: string[] = [];
    const result = await requestRoom(async (path) => { seen.push(path); return okResponse({ code: 'WXYZ', format: '2v2' }); },
      { format: '2v2', mapId: 'iron-basin' });
    expect(seen).toEqual(['/rooms?format=2v2&map=iron-basin']);
    expect(result).toEqual({ code: 'WXYZ' });
  });

  it('a refusal is a value, shown rather than thrown', async () => {
    const result = await requestRoom(async () => okResponse({ error: 'unknown map "nope"' }), { format: '2v2' });
    expect(result).toEqual({ error: 'unknown map "nope"' });
  });

  it('a dead network is a value too — a button that throws does nothing visible', async () => {
    const result = await requestRoom(async () => { throw new Error('offline'); }, { format: '2v2' });
    expect('error' in result && result.error).toMatch(/could not reach the server/);
  });

  it('and so is a response that is not JSON at all', async () => {
    const broken = { status: 502, json: async () => { throw new Error('not json'); } } as unknown as Response;
    const result = await requestRoom(async () => broken, { format: '2v2' });
    expect('error' in result && result.error).toMatch(/502/);
  });

  it('a 200 with no code is refused rather than navigating nowhere', async () => {
    const result = await requestRoom(async () => okResponse({ format: '2v2' }), { format: '2v2' });
    expect('error' in result && result.error).toMatch(/without a room code/);
  });
});

describe('the create screen', () => {
  const mounted = (post: (path: string) => Promise<Response>) => {
    const root = document.createElement('div');
    const navigated: string[] = [];
    createCreateScreen({ root }, MAPS, { post, navigate: (href) => navigated.push(href) });
    return { root, navigated };
  };
  const select = (root: HTMLElement, field: string): HTMLSelectElement =>
    root.querySelector<HTMLSelectElement>(`[data-field="${field}"]`)!;
  const createButton = (root: HTMLElement): HTMLButtonElement =>
    root.querySelector<HTMLButtonElement>('[data-action="create"]')!;

  it('posts the chosen config and navigates to the returned code — the AC', async () => {
    const seen: string[] = [];
    const { root, navigated } = mounted(async (path) => { seen.push(path); return okResponse({ code: 'WXYZ' }); });

    select(root, 'map').value = 'iron-basin';
    select(root, 'map').dispatchEvent(new Event('change'));
    select(root, 'format').value = '4v4';
    select(root, 'format').dispatchEvent(new Event('change'));
    createButton(root).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual(['/rooms?format=4v4&map=iron-basin']);
    expect(navigated, 'straight into the lobby boot').toEqual(['?room=WXYZ']);
  });

  it('changing to a map that cannot seat the chosen format re-picks one it can', () => {
    // The pair must stay seatable. Leaving 4v4 selected on a two-spawn map would
    // mint a room that throws at `createMatch`.
    const { root } = mounted(async () => okResponse({ code: 'WXYZ' }));
    const formats = select(root, 'format');
    expect([...formats.options].map((o) => o.value), 'duel-arena seats four a side')
      .toContain('4v4');
  });

  it('a refusal is shown and the browser stays put', async () => {
    const { root, navigated } = mounted(async () => okResponse({ error: 'unknown format "9v9"' }));
    createButton(root).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.create-error')!.textContent).toContain('9v9');
    expect(navigated, 'nowhere to go').toEqual([]);
  });

  it('the button disables while a create is in flight — never two rooms', async () => {
    // A double-click that minted two rooms would leave the host in the second
    // and the link they shared pointing at the first.
    let resolveIt: (r: Response) => void = () => {};
    const posts: string[] = [];
    const { root } = mounted((path) => {
      posts.push(path);
      return new Promise<Response>((resolve) => { resolveIt = resolve; });
    });
    createButton(root).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createButton(root).disabled).toBe(true);

    createButton(root).click();
    expect(posts, 'the second click did nothing').toHaveLength(1);
    resolveIt(okResponse({ code: 'WXYZ' }));
  });
});
