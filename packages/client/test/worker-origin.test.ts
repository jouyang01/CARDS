import { describe, expect, it } from 'vitest';
import { roomSocketUrl, workerBase, workerUrl } from '../src/room-url.js';

/**
 * M3-DEPLOY-PREP — where the client thinks the server is.
 *
 * Development and production disagree, and that is the whole item. Locally the
 * Worker and the page are the same origin because Vite proxies `/rooms` to a
 * `wrangler dev`; deployed, the client is a static site on Pages and the Worker
 * is on `workers.dev`. A client that derived the server from `window.location`
 * would ask a static host for a WebSocket.
 *
 * So the origin is configuration, and these are the two things a configuration
 * has to get right: **absent means unchanged** (local play must not move because
 * a deploy exists), and **present means absolute** (so nothing is left resolving
 * against the page).
 */

const PAGES = { protocol: 'https:', host: 'jouyang01.github.io' };
const LOCAL = { protocol: 'http:', host: '127.0.0.1:5173' };
const WORKER = 'cards-rooms.lockstepcards.workers.dev';

describe('M3-DEPLOY-PREP: no configured origin means the page is the server', () => {
  it('the socket is same-origin, scheme-matched, exactly as before', () => {
    expect(roomSocketUrl({ protocol: 'https:', host: 'cards.example' }, 'WXYZ'))
      .toBe('wss://cards.example/rooms/WXYZ/ws');
    expect(roomSocketUrl(LOCAL, 'WXYZ')).toBe('ws://127.0.0.1:5173/rooms/WXYZ/ws');
  });

  it('and an HTTP path stays RELATIVE, so the dev proxy still sees it', () => {
    // The point of returning the path untouched: Vite's proxy matches on the
    // request path, and an absolutised `http://127.0.0.1:5173/rooms` would go
    // straight back to the dev server instead of through it.
    expect(workerUrl(LOCAL, '/rooms?format=2v2')).toBe('/rooms?format=2v2');
    expect(workerUrl(LOCAL, '/rooms?format=2v2', '')).toBe('/rooms?format=2v2');
    expect(workerUrl(LOCAL, '/rooms?format=2v2', '   '), 'whitespace is not a config')
      .toBe('/rooms?format=2v2');
  });

  it('an empty config leaves the base as the page', () => {
    expect(workerBase(PAGES)).toEqual(PAGES);
    expect(workerBase(PAGES, undefined)).toEqual(PAGES);
  });
});

describe('M3-DEPLOY-PREP: a configured origin is where the socket and the API go', () => {
  it('a bare host is taken as https, because workers.dev is TLS-only', () => {
    // Guessing http would build a URL an https page is not allowed to open at
    // all — a silent failure rather than a working default.
    expect(workerBase(PAGES, WORKER)).toEqual({ protocol: 'https:', host: WORKER });
    expect(roomSocketUrl(PAGES, 'WXYZ', WORKER)).toBe(`wss://${WORKER}/rooms/WXYZ/ws`);
    expect(workerUrl(PAGES, '/rooms?format=2v2', WORKER)).toBe(`https://${WORKER}/rooms?format=2v2`);
  });

  it('a full origin is honoured as written', () => {
    expect(roomSocketUrl(PAGES, 'WXYZ', `https://${WORKER}`)).toBe(`wss://${WORKER}/rooms/WXYZ/ws`);
    expect(workerUrl(PAGES, '/rooms', `https://${WORKER}`)).toBe(`https://${WORKER}/rooms`);
  });

  it('a ws:// or wss:// origin is normalised, because that is what people paste', () => {
    expect(roomSocketUrl(PAGES, 'WXYZ', `wss://${WORKER}`)).toBe(`wss://${WORKER}/rooms/WXYZ/ws`);
    expect(workerUrl(PAGES, '/rooms', `wss://${WORKER}`), 'and an API call over it is https')
      .toBe(`https://${WORKER}/rooms`);
    expect(roomSocketUrl(PAGES, 'WXYZ', 'ws://localhost:8787'))
      .toBe('ws://localhost:8787/rooms/WXYZ/ws');
  });

  it('the page origin no longer decides anything once one is configured', () => {
    // The regression this rules out: a Pages build that quietly kept talking to
    // github.io because the socket was still derived from the page.
    const fromPages = roomSocketUrl(PAGES, 'WXYZ', WORKER);
    const fromLocal = roomSocketUrl(LOCAL, 'WXYZ', WORKER);
    expect(fromPages).toBe(fromLocal);
    expect(fromPages).not.toContain(PAGES.host);
  });

  it('a port survives, so a second local Worker is configurable', () => {
    expect(roomSocketUrl(LOCAL, 'WXYZ', 'http://127.0.0.1:8787'))
      .toBe('ws://127.0.0.1:8787/rooms/WXYZ/ws');
  });

  it('the code is still upper-cased, whatever the origin', () => {
    expect(roomSocketUrl(PAGES, 'wxyz', WORKER)).toBe(`wss://${WORKER}/rooms/WXYZ/ws`);
  });
});
