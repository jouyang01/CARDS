import { describe, expect, it } from 'vitest';
import { NORMAL_STRENGTH, heightToNormal } from '../src/normal-map.js';

/**
 * The grain was albedo-only: it changed what colour a pixel is and nothing
 * about how it faces the sun. These pin the conversion that gives it a
 * direction — read as a height field, bright is high, and the slope between is
 * something light can answer.
 */

const SIZE = 8;
const flat = (v: number): number[] => new Array(SIZE * SIZE).fill(v);
/** A ramp rising to the +x direction. */
const rampX = (): number[] => {
  const h: number[] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) h.push((x / (SIZE - 1)) * 255);
  return h;
};
const at = (out: Uint8ClampedArray, x: number, y: number) => ({
  r: out[(y * SIZE + x) * 4]!, g: out[(y * SIZE + x) * 4 + 1]!, b: out[(y * SIZE + x) * 4 + 2]!,
  a: out[(y * SIZE + x) * 4 + 3]!,
});

describe('heightToNormal', () => {
  it('NORMAL-SIZE: one RGBA texel out per texel in', () => {
    expect(heightToNormal(flat(128), SIZE, NORMAL_STRENGTH).length).toBe(SIZE * SIZE * 4);
  });

  it('NORMAL-FLAT-IS-FLAT: a featureless height field points straight up', () => {
    // 128,128,255 is the "no perturbation" normal every normal map encodes.
    const out = heightToNormal(flat(200), SIZE, NORMAL_STRENGTH);
    for (let i = 0; i < SIZE * SIZE; i++) {
      expect(out[i * 4]).toBe(128);
      expect(out[i * 4 + 1]).toBe(128);
      expect(out[i * 4 + 2]).toBe(255);
    }
  });

  it('NORMAL-SLOPE-LEANS: a surface rising toward +x leans its normal toward -x', () => {
    // The gradient points uphill; the surface normal tilts the other way. Get
    // this backwards and every lit surface is lit from the wrong side — which
    // looks *plausible* and is subtly, permanently wrong.
    const out = heightToNormal(rampX(), SIZE, NORMAL_STRENGTH);
    const mid = at(out, 3, 4);
    expect(mid.r).toBeLessThan(128);
    expect(mid.g).toBe(128); // nothing varies along y
  });

  it('NORMAL-UNIT-LENGTH: every normal is normalised', () => {
    const out = heightToNormal(rampX(), SIZE, NORMAL_STRENGTH);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const x = (out[i * 4]! / 255) * 2 - 1;
      const y = (out[i * 4 + 1]! / 255) * 2 - 1;
      const z = (out[i * 4 + 2]! / 255) * 2 - 1;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 1);
    }
  });

  it('NORMAL-Z-POSITIVE: nothing ever faces into the surface', () => {
    const noisy = Array.from({ length: SIZE * SIZE }, (_, i) => (i * 37) % 256);
    const out = heightToNormal(noisy, SIZE, NORMAL_STRENGTH * 4);
    for (let i = 0; i < SIZE * SIZE; i++) expect(out[i * 4 + 2]!).toBeGreaterThan(128);
  });

  it('NORMAL-OPAQUE: alpha is left alone', () => {
    const out = heightToNormal(rampX(), SIZE, NORMAL_STRENGTH);
    for (let i = 0; i < SIZE * SIZE; i++) expect(out[i * 4 + 3]).toBe(255);
  });

  it('NORMAL-WRAPS: the pattern tiles, so the edges are not a seam of false flat', () => {
    // Clamping instead of wrapping puts a band of "perfectly flat" along every
    // tile boundary — a visible grid, drawn precisely where the grain is trying
    // to hide one. A field that varies across the wrap must perturb at x=0.
    const stripe: number[] = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) stripe.push(x === 0 ? 255 : 0);
    const out = heightToNormal(stripe, SIZE, NORMAL_STRENGTH);
    expect(at(out, SIZE - 1, 3).r).not.toBe(128);
  });

  it('NORMAL-STRENGTH-SCALES: a harder push leans the normal further', () => {
    const soft = heightToNormal(rampX(), SIZE, 1);
    const hard = heightToNormal(rampX(), SIZE, 6);
    expect(at(hard, 3, 4).r).toBeLessThan(at(soft, 3, 4).r);
  });

  it('NORMAL-RESTRAINED: the shipped strength stays a whisper, not a relief carving', () => {
    // The grain's own amplitude is 4-12 out of 255. Cranking a normal map until
    // that becomes rivets invents detail the theme never described.
    expect(NORMAL_STRENGTH).toBeLessThan(6);
    expect(NORMAL_STRENGTH).toBeGreaterThan(0.5);
  });
});
