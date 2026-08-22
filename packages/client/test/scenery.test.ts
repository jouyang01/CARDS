import { describe, expect, it } from 'vitest';
import { SCENERY, shade, gridInk, spawnEdge } from '../src/renderer3d.js';
import { SKY_PX, onAnyRamp, onRamp, rampAt, rgbOf } from '../src/sky.js';
import { FALLBACK_THEME, SKY_RAMPS, THEMES, themeFor } from '../src/themes.js';
import type { MapDef } from '@cards/engine';
import duelArena from '../../../data/maps/duel-arena.json';
import ironBasin from '../../../data/maps/iron-basin.json';

/**
 * SCENE-DIORAMA / SKY-DOME — the arena around the board, and the void around
 * that. Neither needs a WebGL context to be wrong in a checkable way: the sky is
 * a colour ramp, the platform is arithmetic on the board's size, and the spawn
 * markers are a reading of `map.spawns`.
 */

const MAPS = [duelArena, ironBasin] as unknown as MapDef[];

/** The lit floor, measured off a real composite under BOARD-LIT. */
const LIT_FLOOR = { r: 18, g: 20, b: 27 };

/** The dark overcast ramp Iron Basin ships, and the fallback's — the same one. */
const SKY = FALLBACK_THEME.sky;
const skyAt = (t: number): { r: number; g: number; b: number } => rampAt(SKY, t);
const onSkyRamp = (px: { r: number; g: number; b: number }): boolean => onRamp(SKY, px);

describe('the sky is a ramp, not a flat field', () => {
  it('runs from the top colour to the bottom colour', () => {
    expect(skyAt(0)).toEqual(rgbOf(SKY.top));
    expect(skyAt(1)).toEqual(rgbOf(SKY.bottom));
  });

  it('clamps outside 0..1 rather than extrapolating off the palette', () => {
    expect(skyAt(-3)).toEqual(rgbOf(SKY.top));
    expect(skyAt(4)).toEqual(rgbOf(SKY.bottom));
  });

  it('gets lighter downward on every channel — a ramp with a direction', () => {
    let prev = skyAt(0);
    for (let i = 1; i <= 16; i++) {
      const next = skyAt(i / 16);
      expect(next.r).toBeGreaterThanOrEqual(prev.r);
      expect(next.g).toBeGreaterThanOrEqual(prev.g);
      expect(next.b).toBeGreaterThanOrEqual(prev.b);
      prev = next;
    }
  });

  it('stays blue-dominant, so the void never reads as warm haze', () => {
    for (let i = 0; i <= 8; i++) {
      const s = skyAt(i / 8);
      expect(s.b).toBeGreaterThan(s.r);
    }
  });
});

describe('the sky matcher can tell the void from the board', () => {
  // This is the whole reason the ramp is shared with `e2e/pixels.ts`. The old
  // flat background was `#12141a` and the lit floor composites at rgb(18,20,27)
  // — within one count on every channel, so `isSceneBackground` matched the
  // floor as readily as the sky and the "no rank is clipped" check proved much
  // less than it appeared to.
  it('rejects the lit floor at every point on the ramp', () => {
    expect(onSkyRamp(LIT_FLOOR)).toBe(false);
  });

  it('still rejects it once every shipped theme\'s sky is accepted', () => {
    // `isSceneBackground` widened from one ramp to all of them when themes
    // landed. A union of ramps is only an honest "is this the void?" check if
    // none of them wanders onto the board.
    expect(onAnyRamp(SKY_RAMPS, LIT_FLOOR)).toBe(false);
  });

  it('accepts both ends of its own ramp', () => {
    expect(onSkyRamp(rgbOf(SKY.top))).toBe(true);
    expect(onSkyRamp(rgbOf(SKY.bottom))).toBe(true);
  });

  it('accepts every step the rasteriser can actually emit', () => {
    for (let i = 0; i <= SKY_PX; i++) expect(onSkyRamp(skyAt(i / SKY_PX)), `step ${i}`).toBe(true);
  });

  it('rejects terrain, units and the aim overlay', () => {
    for (const [name, px] of [
      ['wall top', { r: 74, g: 81, b: 103 }],
      ['team blue', { r: 79, g: 140, b: 255 }],
      ['team red', { r: 255, g: 107, b: 94 }],
      ['aim orange', { r: 255, g: 154, b: 62 }],
      ['cover brown', { r: 107, g: 91, b: 62 }],
    ] as const) {
      expect(onSkyRamp(px), name).toBe(false);
    }
  });

  it('tolerates the couple of counts a composite drifts by', () => {
    const mid = skyAt(0.5);
    expect(onSkyRamp({ r: mid.r + 2, g: mid.g - 2, b: mid.b + 2 })).toBe(true);
  });
});

describe('shade scales a colour without leaving the byte range', () => {
  it('darkens toward black and never past it', () => {
    expect(shade(0xffffff, 0)).toBe(0x000000);
    expect(shade(0x808080, 0.5)).toBe(0x404040);
  });

  it('clamps rather than overflowing into the next channel', () => {
    expect(shade(0xffffff, 4)).toBe(0xffffff);
    expect(shade(0x408040, 8)).toBe(0xffffff);
  });

  it('still backs the grid ink it was extracted from', () => {
    expect(gridInk(0x20242f)).toBe(shade(0x20242f, 0.55));
  });
});

describe('the platform is an object the board sits on', () => {
  it('extends past every rank, so the board never ends in mid-air', () => {
    expect(SCENERY.margin).toBeGreaterThan(0);
  });

  it('keeps its top under the floor, so the two cannot z-fight', () => {
    expect(SCENERY.top).toBeLessThan(0);
  });

  it.each(Object.values(THEMES))('$name darkens its slab below its own floor', (theme) => {
    // The board is the lit thing; the platform carrying it must not compete.
    expect(theme.arena.shade).toBeLessThan(1);
    expect(shade(theme.terrain.open, theme.arena.shade)).toBeLessThan(theme.terrain.open);
  });

  it('lights the rim rather than relying on the sun to find it', () => {
    // The orbit runs yaw with no clamp, so any surface that only catches the sun
    // loses its edge for half of every turn.
    expect(SCENERY.rim.emissive).toBeGreaterThan(0);
    expect(SCENERY.spawnEmissive).toBeGreaterThan(0);
  });

  it('keeps the markers quieter than the rim that frames them', () => {
    expect(SCENERY.spawnEmissive).toBeLessThan(SCENERY.rim.emissive);
    expect(SCENERY.spawnShade).toBeLessThan(1);
  });

  it('keeps every permanent fixture under the colour-family gate', () => {
    // `e2e/pixels.ts` counts colour families, and isTeamBlue/isTeamRed/
    // isAimOrange all gate on a channel above 130 — those marks are things a
    // player looks *at*. A bright fixture that never leaves the screen lands
    // inside one of those families whatever hue it is given, and then "team 0's
    // units are on screen" is satisfied by the furniture. isTeamRed is asserted
    // *equal to zero* to prove the unseen enemy is not drawn, so a saturated red
    // fixture would break a hidden-information guard outright.
    const brightest = (hex: number): number =>
      Math.max((hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff);
    for (const theme of [...Object.values(THEMES), FALLBACK_THEME]) {
      expect(brightest(theme.arena.rim), `${theme.id} rim`).toBeLessThan(130);
    }
    for (const team of [0x4f8cff, 0xff6b5e]) {
      expect(brightest(shade(team, SCENERY.spawnShade))).toBeLessThan(130);
    }
  });

  it('keeps a spawn marker a fraction of its edge, not the whole rim', () => {
    expect(SCENERY.spawnSpan).toBeGreaterThan(0);
    expect(SCENERY.spawnSpan).toBeLessThan(1);
  });
});

describe('spawn markers land on the edge the team actually enters from', () => {
  it.each(MAPS)('puts the two teams on opposite edges of $name', (map) => {
    expect(spawnEdge(map, 0)).not.toBe(spawnEdge(map, 1));
  });

  it.each(MAPS)('reads west/east off the spawn columns of $name', (map) => {
    // Both shipped maps spawn on the short axis, facing each other across it.
    expect(spawnEdge(map, 0)).toBe('west');
    expect(spawnEdge(map, 1)).toBe('east');
  });

  it('follows the data when a map spawns on the long axis instead', () => {
    // A marker painted on an assumed edge would tell the player their back is
    // somewhere it is not, which is worse than drawing no marker at all.
    const northSouth = {
      width: 18, height: 15,
      spawns: [[{ x: 8, y: 1 }, { x: 9, y: 1 }], [{ x: 8, y: 13 }, { x: 9, y: 13 }]],
    } as unknown as MapDef;
    expect(spawnEdge(northSouth, 0)).toBe('north');
    expect(spawnEdge(northSouth, 1)).toBe('south');
  });

  it('is stable for a spawn sitting dead centre rather than iteration-dependent', () => {
    const centred = {
      width: 11, height: 11,
      spawns: [[{ x: 5, y: 5 }], [{ x: 5, y: 5 }]],
    } as unknown as MapDef;
    expect(spawnEdge(centred, 0)).toBe(spawnEdge(centred, 0));
    expect(spawnEdge(centred, 0)).toBe('west');
  });

  it('falls back to a side rather than throwing on a map with no spawns', () => {
    const empty = { width: 8, height: 8, spawns: [[], []] } as unknown as MapDef;
    expect(spawnEdge(empty, 0)).toBe('west');
    expect(spawnEdge(empty, 1)).toBe('east');
  });
});
