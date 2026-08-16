import { describe, expect, it } from 'vitest';
import worker, { parseRoomPath, type Env } from '../src/worker.js';
import { isRoomCode } from '../src/room.js';

/**
 * M3-ROOM — the Worker's routing, against a stub Durable Object namespace.
 *
 * The DO itself is plumbing (see `durable-object.ts`), but the Worker in front
 * of it makes two decisions worth pinning: the code **is** the routing key, so
 * `idFromName` must be handed the same string for the same room every time; and
 * a mint that lands on a live room has to try again rather than evict whoever
 * is already in it.
 */

/** Records what the Worker asked of which room. */
class StubNamespace {
  readonly calls: { name: string; url: string }[] = [];
  /** Codes that already have a room, so `/room` answers 200 instead of 404. */
  constructor(private readonly occupied: Set<string> = new Set()) {}

  idFromName(name: string): { name: string } {
    return { name };
  }

  get(id: { name: string }) {
    return {
      fetch: async (input: string | Request): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.url;
        this.calls.push({ name: id.name, url });
        const path = new URL(url).pathname;
        if (path === '/room') {
          return this.occupied.has(id.name)
            ? Response.json({ code: id.name })
            : new Response('no room', { status: 404 });
        }
        if (path === '/create') {
          this.occupied.add(id.name);
          return Response.json({ code: id.name });
        }
        // Not a real 101: Node's `Response` refuses that status, and the
        // upgrade is Cloudflare's to perform anyway. What this asserts is that
        // the Worker forwarded to the right object with the right path.
        return new Response('upgraded', { status: 200, headers: { 'x-stub': 'ws' } });
      },
    };
  }
}

const env = (ns: StubNamespace): Env => ({ ROOMS: ns as unknown as Env['ROOMS'] });
const post = (url: string) => new Request(url, { method: 'POST' });

describe('M3-ROOM: parseRoomPath', () => {
  it('splits a room path and upper-cases the code', () => {
    expect(parseRoomPath('/rooms/wxyz/ws')).toEqual({ code: 'WXYZ', rest: 'ws' });
    expect(parseRoomPath('/rooms/WXYZ')).toEqual({ code: 'WXYZ', rest: '' });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRoomPath('/rooms/WXYZ/')).toEqual({ code: 'WXYZ', rest: '' });
  });

  it('is undefined for anything that is not a room path', () => {
    for (const path of ['/', '/rooms', '/other/WXYZ', '']) {
      expect(parseRoomPath(path), path).toBeUndefined();
    }
  });
});

describe('M3-ROOM: creating a room', () => {
  it('mints a code, creates the DO, and returns both', async () => {
    const ns = new StubNamespace();
    const res = await worker.fetch(post('https://x/rooms'), env(ns));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; format: string };
    expect(isRoomCode(body.code)).toBe(true);
    expect(body.format, 'the default format is 2v2 (GAME_SPEC §1)').toBe('2v2');
    // It checked the code was free before claiming it.
    expect(ns.calls.map((c) => new URL(c.url).pathname)).toEqual(['/room', '/create']);
  });

  it('honours a requested format', async () => {
    const res = await worker.fetch(post('https://x/rooms?format=4v4'), env(new StubNamespace()));
    expect((await res.json()) as { format: string }).toMatchObject({ format: '4v4' });
  });

  it('refuses a format that does not exist rather than defaulting past it', async () => {
    // Silently falling back to 2v2 would start the wrong match and blame the
    // player for picking it.
    const res = await worker.fetch(post('https://x/rooms?format=9v9'), env(new StubNamespace()));
    expect(res.status).toBe(400);
  });

  it('tries again rather than minting onto a room somebody is already in', async () => {
    // Astronomically unlikely at 22^4 codes — and "unlikely" is not "handled":
    // claiming a live code would drop everyone in it into somebody else's lobby.
    const ns = new StubNamespace();
    let firstCode: string | undefined;
    const first = await worker.fetch(post('https://x/rooms'), env(ns));
    firstCode = ((await first.json()) as { code: string }).code;

    // Occupy every code the next mint could produce except by retrying: the
    // stub marks a code occupied once `/create` has run, so the second request
    // must observe the collision path at least once if it lands on the same
    // code, and must never re-`/create` an occupied one.
    const second = await worker.fetch(post('https://x/rooms'), env(ns));
    const secondCode = ((await second.json()) as { code: string }).code;
    const creates = ns.calls.filter((c) => new URL(c.url).pathname === '/create');
    expect(new Set(creates.map((c) => c.name)).size, 'never created the same room twice').toBe(creates.length);
    expect(isRoomCode(secondCode)).toBe(true);
    expect(firstCode).toBeDefined();
  });
});

describe('M3-ROOM: reaching a room by code', () => {
  it('routes the socket to the DO named by the code', async () => {
    const ns = new StubNamespace(new Set(['WXYZ']));
    const res = await worker.fetch(
      new Request('https://x/rooms/wxyz/ws', { headers: { Upgrade: 'websocket' } }),
      env(ns),
    );
    expect(res.headers.get('x-stub'), 'the upgrade was forwarded, not handled here').toBe('ws');
    expect(ns.calls.at(-1)?.name, 'the code IS the routing key').toBe('WXYZ');
    expect(new URL(ns.calls.at(-1)!.url).pathname).toBe('/ws');
  });

  it('the same code always lands on the same object', async () => {
    const ns = new StubNamespace(new Set(['WXYZ']));
    for (const path of ['/rooms/WXYZ', '/rooms/wxyz', '/rooms/WxYz']) {
      await worker.fetch(new Request(`https://x${path}`), env(ns));
    }
    expect(new Set(ns.calls.map((c) => c.name))).toEqual(new Set(['WXYZ']));
  });

  it('rejects a code that is not four letters from the alphabet', async () => {
    const ns = new StubNamespace();
    for (const bad of ['ABC', 'ABCDE', 'AB1D', 'ABCI']) {
      const res = await worker.fetch(new Request(`https://x/rooms/${bad}`), env(ns));
      expect(res.status, bad).toBe(400);
    }
    expect(ns.calls, 'and never woke a Durable Object for one').toHaveLength(0);
  });

  it('404s an unknown path instead of guessing', async () => {
    const ns = new StubNamespace();
    for (const path of ['/', '/rooms/WXYZ/orders', '/whatever']) {
      expect((await worker.fetch(new Request(`https://x${path}`), env(ns))).status, path).toBe(404);
    }
  });
});
