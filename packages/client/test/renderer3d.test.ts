import { describe, expect, it } from 'vitest';
import { LAYER_LIFT, PITCH, SHAPE_LIFT, TERRAIN_HEIGHT, onBoard, squareToWorldXZ, worldXZToSquare } from '../src/renderer3d.js';
import type { Vec2 } from '@cards/engine';

/**
 * RND1 — the renderer itself needs a WebGL context, but the part picking depends
 * on is the board↔world mapping, and that is pure. A wrong mapping is exactly
 * the bug the SVG `squareFromPoint` had: everything looks fine until you click.
 */

const MAP = { width: 18, height: 15 };
const sq = (x: number, y: number): Vec2 => ({ x, y });

describe('board ↔ world mapping round-trips', () => {
  it('every square maps to world XZ and back to itself', () => {
    for (let x = 0; x < MAP.width; x++) {
      for (let y = 0; y < MAP.height; y++) {
        const { x: wx, z } = squareToWorldXZ(MAP, sq(x, y));
        expect(worldXZToSquare(MAP, wx, z), `square ${x},${y}`).toEqual(sq(x, y));
      }
    }
  });

  it('the board is centred on the origin, so the camera can just look at 0,0', () => {
    const centre = squareToWorldXZ(MAP, sq((MAP.width - 1) / 2, (MAP.height - 1) / 2));
    expect(centre.x).toBeCloseTo(0, 9);
    expect(centre.z).toBeCloseTo(0, 9);
  });

  it('a point anywhere inside a tile snaps to that tile', () => {
    const { x, z } = squareToWorldXZ(MAP, sq(4, 6));
    for (const [dx, dz] of [[0, 0], [0.45, 0.45], [-0.45, -0.45], [0.49, -0.2]] as const) {
      expect(worldXZToSquare(MAP, x + dx, z + dz)).toEqual(sq(4, 6));
    }
  });

  it('one tile apart in world space is one square apart on the board', () => {
    const a = squareToWorldXZ(MAP, sq(3, 3));
    const b = squareToWorldXZ(MAP, sq(4, 3));
    expect(b.x - a.x).toBe(1);
    expect(b.z - a.z).toBe(0);
  });

  it('onBoard rejects everything outside the grid', () => {
    expect(onBoard(MAP, sq(0, 0))).toBe(true);
    expect(onBoard(MAP, sq(17, 14))).toBe(true);
    expect(onBoard(MAP, sq(-1, 0))).toBe(false);
    expect(onBoard(MAP, sq(18, 0))).toBe(false);
    expect(onBoard(MAP, sq(0, 15))).toBe(false);
  });
});

describe('projection is a runtime parameter, not a rewrite', () => {
  it('ships top-down and true isometric as two pitches of one camera', () => {
    expect(PITCH.top).toBe(90);
    // arctan(1/√2) in degrees — the true isometric angle, not an eyeballed 30°.
    expect(PITCH.isometric).toBeCloseTo((Math.atan(1 / Math.SQRT2) * 180) / Math.PI, 3);
  });
});

/**
 * FOG-ZORDER — an overlay layer that sits *below* the terrain it is drawn over
 * loses the depth test and vanishes. That is a numeric relationship between two
 * constants, so it is checkable here; only whether the pixels then arrive needs
 * the browser (RENDER-VERIFY covers that half).
 */
describe('tile overlays clear the terrain they are drawn over', () => {
  const LAYERS = Object.keys(LAYER_LIFT) as (keyof typeof LAYER_LIFT)[];

  it('every layer sits above the brush lid — the reported bug, as a number', () => {
    for (const layer of LAYERS) {
      expect(LAYER_LIFT[layer], `${layer} is buried under brush`).toBeGreaterThan(TERRAIN_HEIGHT.brush);
    }
  });

  it('with enough clearance that a float wobble cannot z-fight it', () => {
    for (const layer of LAYERS) {
      expect(LAYER_LIFT[layer] - TERRAIN_HEIGHT.brush).toBeGreaterThanOrEqual(0.004);
    }
  });

  it('keeps its bottom-up stacking order, which is the draw order', () => {
    const order: (keyof typeof LAYER_LIFT)[] =
      ['fog', 'camo', 'range', 'reach', 'aim', 'impact', 'free', 'catalyst', 'select'];
    expect(LAYERS.length).toBe(order.length); // a new layer must be placed deliberately
    for (let i = 1; i < order.length; i++) {
      expect(LAYER_LIFT[order[i]!], `${order[i]} must sit above ${order[i - 1]}`)
        .toBeGreaterThan(LAYER_LIFT[order[i - 1]!]);
    }
  });

  it('and UI2 draws its continuous shape above every tile layer', () => {
    for (const layer of LAYERS) expect(SHAPE_LIFT).toBeGreaterThan(LAYER_LIFT[layer]);
  });

  it('leaves the whole band well under a unit, so nothing floats over a body', () => {
    expect(SHAPE_LIFT).toBeLessThan(0.1);
  });
});
