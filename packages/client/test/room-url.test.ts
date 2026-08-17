import { describe, expect, it } from 'vitest';
import { parseRoomLink, roomSocketUrl } from '../src/room-url.js';

/**
 * M3-LOBBY-UI — the way into a room, as a URL.
 *
 * `?room=WXYZ` is the whole entry point, so the two things worth pinning are
 * that it is **additive** (no `?room=`, no change — MAPTOGGLE's dev query still
 * boots the hot-seat) and that a bad code is an **error rather than a fallback**,
 * the rule `match-setup.ts` already follows. Dropping quietly into a hot-seat
 * because the code was mistyped leaves a player waiting for opponents who were
 * never going to arrive, and nothing on screen says why.
 */

describe('parseRoomLink', () => {
  it('no ?room= is not an error — it is the hot-seat', () => {
    expect(parseRoomLink('')).toBeUndefined();
    expect(parseRoomLink('?map=iron-basin&format=4v4')).toBeUndefined();
  });

  it('a code becomes a link, upper-cased and trimmed', () => {
    // Codes are minted upper-case and links get typed by hand, so a lower-case
    // one is the same room rather than a different one.
    expect(parseRoomLink('?room=WXYZ')).toEqual({ link: { code: 'WXYZ' } });
    expect(parseRoomLink('?room=wxyz')).toEqual({ link: { code: 'WXYZ' } });
    expect(parseRoomLink('?room=%20wxyz%20')).toEqual({ link: { code: 'WXYZ' } });
  });

  it('a name rides along when the link carries one', () => {
    expect(parseRoomLink('?room=WXYZ&name=Ada')).toEqual({ link: { code: 'WXYZ', name: 'Ada' } });
    expect(parseRoomLink('?room=WXYZ&name='), 'blank is no name at all').toEqual({ link: { code: 'WXYZ' } });
  });

  it('a malformed code is refused, and says what was wrong', () => {
    for (const bad of ['?room=ABC', '?room=ABCDE', '?room=AB1Z', '?room=AIOU']) {
      const result = parseRoomLink(bad);
      expect(result, bad).toBeDefined();
      expect(result !== undefined && 'errors' in result, `${bad} is refused`).toBe(true);
    }
    // `I`, `O`, `Q` and `U` are not in the alphabet — misread over voice, and U
    // keeps four letters from spelling anything regrettable.
    const result = parseRoomLink('?room=QQQQ');
    expect(result !== undefined && 'errors' in result && result.errors[0]).toMatch(/room code/);
  });

  it('coexists with MAPTOGGLE\'s query rather than replacing it', () => {
    expect(parseRoomLink('?map=iron-basin&room=WXYZ&format=4v4'))
      .toEqual({ link: { code: 'WXYZ' } });
  });
});

describe('roomSocketUrl', () => {
  it('matches the socket scheme to the page\'s own', () => {
    // A page served over TLS cannot open a plaintext socket, and hard-coding
    // either scheme breaks one of the two deployments.
    expect(roomSocketUrl({ protocol: 'https:', host: 'cards.example' }, 'WXYZ'))
      .toBe('wss://cards.example/rooms/WXYZ/ws');
    expect(roomSocketUrl({ protocol: 'http:', host: '127.0.0.1:5173' }, 'WXYZ'))
      .toBe('ws://127.0.0.1:5173/rooms/WXYZ/ws');
  });

  it('upper-cases the code, so a hand-typed link reaches the same room', () => {
    expect(roomSocketUrl({ protocol: 'http:', host: 'x' }, 'wxyz')).toBe('ws://x/rooms/WXYZ/ws');
  });
});
