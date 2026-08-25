import { describe, expect, it } from 'vitest';
import {
  fofColour, fofFor, friendly, sideColour, sideFriendly, unitColour,
  type FofPalette, type Viewer,
} from '../src/fof.js';
import { MeshStandardMaterial } from 'three';
import { paintEdgeBar } from '../src/renderer3d.js';

/**
 * FOF-COLORS — the resolver, checked without a WebGL context.
 *
 * The whole point of pulling this out of `renderer3d.ts` is that the question
 * "is this unit friend or foe" is answerable on paper. The wiring — that the
 * renderer actually paints what this returns — is `fof-units.test.ts`'s job,
 * through the real controller.
 */

const PALETTE: FofPalette = { self: 0x4f8cff, ally: 0x5fd97a, foe: 0xff6b5e };

/** A viewer on `team`, driving `ids`. */
const seat = (team: 0 | 1, ...ids: string[]): Viewer =>
  ({ team, seatUnitIds: new Set(ids) });

describe('FOF-UNITS: the resolver decides from the viewer, not the team number', () => {
  it('THE BUG: a team-1 viewer sees themselves as self and team 0 as foe', () => {
    // The reported defect in one assertion. The old code was
    // `owner === 0 ? blue : red`, so this viewer saw their own character red
    // and the enemy blue — backwards, and unrecoverable in a mirror.
    const viewer = seat(1, 'u-mine');
    expect(fofFor({ unitId: 'u-mine', owner: 1 }, viewer)).toBe('self');
    expect(fofFor({ unitId: 'u-theirs', owner: 0 }, viewer)).toBe('foe');
  });

  it('and a team-0 viewer resolves the same board to the mirror image', () => {
    // The property that makes this correct rather than merely different: the
    // two seats disagree about every colour and neither is wrong.
    const board = [{ unitId: 'a', owner: 0 as const }, { unitId: 'b', owner: 1 as const }];
    const zero = board.map((u) => fofFor(u, seat(0, 'a')));
    const one = board.map((u) => fofFor(u, seat(1, 'b')));
    expect(zero).toEqual(['self', 'foe']);
    expect(one).toEqual(['foe', 'self']);
  });

  it('seat beats team: your own unit is self, your teammate is ally', () => {
    // Checking team first would paint the character you are ordering in the
    // ally colour — right about the side, wrong about the one that is yours.
    const viewer = seat(0, 'mine');
    expect(fofFor({ unitId: 'mine', owner: 0 }, viewer)).toBe('self');
    expect(fofFor({ unitId: 'partner', owner: 0 }, viewer)).toBe('ally');
  });

  it('one player driving both characters sees both as self', () => {
    // 2v2 with 2 players: the seat owns the whole team, so there is no ally.
    const viewer = seat(0, 'first', 'second');
    expect(fofFor({ unitId: 'first', owner: 0 }, viewer)).toBe('self');
    expect(fofFor({ unitId: 'second', owner: 0 }, viewer)).toBe('self');
  });

  it('THE MIRROR: identical characters on both sides still read self and foe', () => {
    // The owner's actual complaint. Same character id, same everything — the
    // only thing that separates them is who owns them, and that is exactly
    // what the colour has to encode.
    const viewer = seat(0, 'mine');
    expect(fofFor({ unitId: 'mine', owner: 0 }, viewer)).toBe('self');
    expect(fofFor({ unitId: 'theirs', owner: 1 }, viewer)).toBe('foe');
  });

  it('friendly() covers both of the viewer’s own identities', () => {
    expect(friendly('self')).toBe(true);
    expect(friendly('ally')).toBe(true);
    expect(friendly('foe')).toBe(false);
  });
});

describe('FOF-UNITS: identity to colour', () => {
  it('three identities, three colours', () => {
    expect(fofColour('self', PALETTE)).toBe(PALETTE.self);
    expect(fofColour('ally', PALETTE)).toBe(PALETTE.ally);
    expect(fofColour('foe', PALETTE)).toBe(PALETTE.foe);
  });

  it('unitColour is the two steps in one, and agrees with them', () => {
    const viewer = seat(1, 'x');
    for (const u of [{ unitId: 'x', owner: 1 as const }, { unitId: 'y', owner: 0 as const }]) {
      expect(unitColour(u, viewer, PALETTE)).toBe(fofColour(fofFor(u, viewer), PALETTE));
    }
  });

  it('the ally colour is its own hue, not a shade of the self colour', () => {
    // If green collapsed into blue the 2v2 read would be "my side / their side"
    // again, which is the thing that already worked.
    expect(PALETTE.ally).not.toBe(PALETTE.self);
    expect(PALETTE.ally).not.toBe(PALETTE.foe);
  });
});

describe('FOF-UNITS: a side is two colours, not three', () => {
  it('THE DEV NOTE: your end of the map is blue, theirs is red, from either seat', () => {
    // *"The colored bars on each side of the map should be blue for ally and
    // red for enemy side. This should change depending on player perspective."*
    // Both seats, both bars — the whole note is these four assertions.
    const zero = seat(0, 'a');
    const one = seat(1, 'b');
    expect(sideColour(0, zero, PALETTE)).toBe(PALETTE.self);
    expect(sideColour(1, zero, PALETTE)).toBe(PALETTE.foe);
    expect(sideColour(0, one, PALETTE)).toBe(PALETTE.foe);
    expect(sideColour(1, one, PALETTE)).toBe(PALETTE.self);
  });

  it('a side never takes the ally green — half an arena is not "with you"', () => {
    // `self` for the friendly side is deliberate: green means "on your team but
    // not yours to order", and an end of the map is neither.
    for (const viewer of [seat(0, 'a'), seat(1, 'b')]) {
      for (const team of [0, 1] as const) {
        expect(sideColour(team, viewer, PALETTE)).not.toBe(PALETTE.ally);
      }
    }
  });

  it('sideFriendly ignores the seat, because a side has no seat', () => {
    // Deliberately asserted with a viewer whose seat drives nothing: the side
    // question is answerable from the team alone, and a seat-empty viewer (a
    // spectator, a downed player) must still get a coloured board.
    const spectatorish: Viewer = { team: 1, seatUnitIds: new Set() };
    expect(sideFriendly(1, spectatorish)).toBe(true);
    expect(sideFriendly(0, spectatorish)).toBe(false);
  });
});

// ── The edge bars: the owner's third note ───────────────────────────────────

/**
 * *"The color bars on the 'blue side' and 'red side' are both white."*
 *
 * The colour was being resolved correctly and then thrown away: an edge bar is
 * built glowing, and the repaint set `color` while the *emissive* — the half
 * actually on screen at that intensity — kept the white it was constructed
 * with. Pinned here rather than in a browser because the defect is arithmetic,
 * not pixels: a material is constructible without a GL context, and "did both
 * properties move" is exactly the question that was answered wrongly.
 */
describe('FOF-UNITS: an edge bar takes its colour in both places', () => {
  it('THE PLAYTEST BUG: repainting sets the emissive too, not just the colour', () => {
    const material = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff });
    paintEdgeBar(material, 0x4f8cff);
    expect(material.color.getHex(), 'the diffuse colour').toBe(0x4f8cff);
    expect(material.emissive.getHex(), 'and the glow, which is what shows').toBe(0x4f8cff);
  });

  it('and both sides end up different colours from one viewer', () => {
    // The whole of the note in one check: two bars, one repaint each, and they
    // must not agree — a board where both ends read the same says nothing about
    // which way is home.
    const viewer = seat(0, 'a');
    const west = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff });
    const east = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff });
    paintEdgeBar(west, sideColour(0, viewer, PALETTE));
    paintEdgeBar(east, sideColour(1, viewer, PALETTE));
    expect(west.emissive.getHex()).toBe(PALETTE.self);
    expect(east.emissive.getHex()).toBe(PALETTE.foe);
    expect(west.emissive.getHex()).not.toBe(east.emissive.getHex());
  });
});
