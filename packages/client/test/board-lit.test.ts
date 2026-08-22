import { describe, expect, it } from 'vitest';
import {
  LIGHTING, SURFACE, TERRAIN_HEIGHT, gridInk, gridPositions, shadowFrustum, squareToWorldXZ,
} from '../src/renderer3d.js';

/**
 * BOARD-LIT / GRID-SEAMS — the renderer needs a WebGL context, but everything
 * this change actually decides is data: how bright each light is, how each
 * surface answers them, how big the shadow camera has to be, and where the
 * seams fall. Those are pure and testable, in the same spirit as the existing
 * board↔world mapping suite.
 */

const MAPS = [
  { width: 18, height: 15 }, // duel-arena
  { width: 22, height: 19 }, // iron-basin
] as const;

describe('the rig is directional-dominant, not ambient-dominant', () => {
  it('ambient is a floor, well under the light that models the scene', () => {
    // The regression this whole change exists to prevent: an ambient term that
    // rivals the sun flattens every face to the same value, and no colour or
    // texture put on top can bring the form back.
    expect(LIGHTING.ambient.intensity).toBeLessThan(LIGHTING.sun.intensity / 2);
  });

  it('keeps enough ambient that a shadowed face is still readable', () => {
    expect(LIGHTING.ambient.intensity).toBeGreaterThan(0);
  });

  it('splits sky from ground so tops and sides differ in hue, not just value', () => {
    expect(LIGHTING.hemisphere.sky).not.toBe(LIGHTING.hemisphere.ground);
  });

  it('keeps the fill subordinate to the sun, so the modelling direction reads', () => {
    expect(LIGHTING.fill.intensity).toBeLessThan(LIGHTING.sun.intensity);
  });

  it('puts the sun above the board, or it cannot cast onto it', () => {
    expect(LIGHTING.sun.position[1]).toBeGreaterThan(0);
  });

  it('puts the fill opposite the sun, which is the only reason it exists', () => {
    expect(Math.sign(LIGHTING.fill.position[0])).toBe(-Math.sign(LIGHTING.sun.position[0]));
    expect(Math.sign(LIGHTING.fill.position[2])).toBe(-Math.sign(LIGHTING.sun.position[2]));
  });
});

describe('surfaces say what they are made of', () => {
  it('gives every drawn surface a distinct answer to the light', () => {
    const answers = new Set(Object.values(SURFACE).map((s) => `${s.roughness}|${s.metalness}`));
    expect(answers.size).toBe(Object.keys(SURFACE).length);
  });

  it('keeps brush fully matte — foliage that catches a highlight reads as glass', () => {
    expect(SURFACE.brush.roughness).toBe(1);
    expect(SURFACE.brush.metalness).toBe(0);
  });

  it('makes cover the most metallic thing on the board — it is a barricade', () => {
    for (const [name, surface] of Object.entries(SURFACE)) {
      if (name === 'cover') continue;
      expect(surface.metalness, name).toBeLessThan(SURFACE.cover.metalness);
    }
  });

  it('stays in the physical 0..1 range three expects', () => {
    for (const [name, surface] of Object.entries(SURFACE)) {
      expect(surface.roughness, name).toBeGreaterThanOrEqual(0);
      expect(surface.roughness, name).toBeLessThanOrEqual(1);
      expect(surface.metalness, name).toBeGreaterThanOrEqual(0);
      expect(surface.metalness, name).toBeLessThanOrEqual(1);
    }
  });
});

describe('the shadow camera covers the whole board', () => {
  // A DirectionalLight shadows through a ±5 orthographic box by default. Every
  // shipped map is bigger than that in both axes, so the default shadows a patch
  // in the middle and leaves the rest unshadowed — which reads as a broken
  // renderer rather than as lighting.
  it.each(MAPS)('reaches every corner of $width×$height', (map) => {
    const { radius } = shadowFrustum(map);
    const corner = squareToWorldXZ(map, { x: map.width - 1, y: map.height - 1 });
    expect(Math.hypot(corner.x, corner.z)).toBeLessThan(radius);
  });

  it.each(MAPS)('leaves margin past the last row for the shadow a wall throws', (map) => {
    const { radius } = shadowFrustum(map);
    expect(radius).toBeGreaterThan(Math.hypot(map.width, map.height) / 2);
  });

  it.each(MAPS)('puts the whole board inside the near..far slab', (map) => {
    const { near, far } = shadowFrustum(map);
    const sun = LIGHTING.sun.position;
    const lightToFarCorner = Math.hypot(sun[0], sun[1], sun[2]) + Math.hypot(map.width, map.height) / 2;
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(lightToFarCorner);
  });
});

describe('seam ink is a shade of the floor it sits on', () => {
  it('darkens every channel without leaving the byte range', () => {
    for (const floor of [0x20242f, 0xffffff, 0x000000, 0x6b5b3e]) {
      const ink = gridInk(floor);
      for (const shift of [16, 8, 0]) {
        const inkCh = (ink >> shift) & 0xff;
        const floorCh = (floor >> shift) & 0xff;
        expect(inkCh).toBeLessThanOrEqual(floorCh);
        expect(inkCh).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is visibly darker than the board palette floor, not a no-op', () => {
    expect(gridInk(0x20242f)).toBeLessThan(0x20242f);
  });
});

describe('the seams agree with the board↔world mapping', () => {
  // A grid that disagrees with `squareToWorldXZ` is the old SVG click-target bug
  // wearing a new coat: everything looks fine until you try to count squares.
  it.each(MAPS)('draws one line per gap plus both edges on $width×$height', (map) => {
    const lines = (map.width + 1) + (map.height + 1);
    expect(gridPositions(map).length).toBe(lines * 2 * 3);
  });

  it.each(MAPS)('lands every seam on a tile boundary, half a tile off centre', (map) => {
    const pos = gridPositions(map);
    const centre = squareToWorldXZ(map, { x: 0, y: 0 });
    // The first vertical seam is the outer edge of square 0.
    expect(pos[0]).toBeCloseTo(centre.x - 0.5, 9);
  });

  it.each(MAPS)('spans exactly the ground plane on $width×$height', (map) => {
    const pos = gridPositions(map);
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      xs.push(pos[i] as number);
      zs.push(pos[i + 2] as number);
    }
    expect(Math.min(...xs)).toBeCloseTo(-map.width / 2, 9);
    expect(Math.max(...xs)).toBeCloseTo(map.width / 2, 9);
    expect(Math.min(...zs)).toBeCloseTo(-map.height / 2, 9);
    expect(Math.max(...zs)).toBeCloseTo(map.height / 2, 9);
  });

  it.each(MAPS)('keeps every seam flat on the ground plane', (map) => {
    const pos = gridPositions(map);
    for (let i = 1; i < pos.length; i += 3) expect(pos[i]).toBe(0);
  });

  it('leaves the seams under the brush lid, so overlays never fight them', () => {
    // FOG-ZORDER: the seams are floor decoration, below everything the player
    // is asked to read.
    expect(TERRAIN_HEIGHT.brush).toBeGreaterThan(0);
  });
});
