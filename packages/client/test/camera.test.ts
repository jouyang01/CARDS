import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@cards/engine';
import { MIN_FRAME_SQUARES, boardRect, cameraTransform, frameContains, frameFor } from '../src/camera.js';
import { CELL } from '../src/render.js';

/**
 * A3 camera — the guarantee under test is CAUSALITY: for a Prep/Blast cue the
 * shooter and the ability's area are both in frame, so a player can see who fired
 * at what. Everything else (padding, min size, aspect, board clamp) exists to
 * serve that without the camera leaving the board or over-zooming.
 */

const MAP = { width: 18, height: 15 };
const VIEWPORT = { width: 800, height: 600 };
const sq = (x: number, y: number): Vec2 => ({ x, y });

describe('frameFor keeps the cue subjects in frame', () => {
  it('a shooter and its distant area are BOTH inside the frame', () => {
    const shooter = sq(2, 7);
    const area = [sq(6, 7), sq(7, 7), sq(8, 7), sq(9, 7)]; // a rail down the row
    const frame = frameFor([shooter, ...area], VIEWPORT, MAP);
    expect(frameContains(frame, shooter)).toBe(true);
    for (const a of area) expect(frameContains(frame, a)).toBe(true);
  });

  it('frames the union of all movers for a simultaneous phase', () => {
    const movers = [sq(1, 1), sq(16, 13)]; // opposite corners
    const frame = frameFor(movers, VIEWPORT, MAP);
    for (const m of movers) expect(frameContains(frame, m)).toBe(true);
  });

  it('never frames tighter than the minimum, so one unit is not a close-up', () => {
    const frame = frameFor([sq(9, 7)], VIEWPORT, MAP);
    expect(frame.width).toBeGreaterThanOrEqual(MIN_FRAME_SQUARES * CELL - 1e-6);
    expect(frame.height).toBeGreaterThanOrEqual(MIN_FRAME_SQUARES * CELL - 1e-6);
  });

  it('matches the viewport aspect ratio, so nothing is cropped when shown', () => {
    const frame = frameFor([sq(4, 4), sq(6, 5)], VIEWPORT, MAP);
    expect(frame.width / frame.height).toBeCloseTo(VIEWPORT.width / VIEWPORT.height, 6);
  });

  it('stays inside the board even when the subject hugs a corner', () => {
    const board = boardRect(MAP);
    for (const corner of [sq(0, 0), sq(17, 0), sq(0, 14), sq(17, 14)]) {
      const frame = frameFor([corner], VIEWPORT, MAP);
      expect(frameContains(frame, corner), `corner ${corner.x},${corner.y} not framed`).toBe(true);
      expect(frame.x).toBeGreaterThanOrEqual(board.x - 1e-6);
      expect(frame.y).toBeGreaterThanOrEqual(board.y - 1e-6);
      expect(frame.x + frame.width).toBeLessThanOrEqual(board.x + board.width + 1e-6);
      expect(frame.y + frame.height).toBeLessThanOrEqual(board.y + board.height + 1e-6);
    }
  });

  it('with no subjects it frames the whole board', () => {
    const frame = frameFor([], VIEWPORT, MAP);
    for (const p of [sq(0, 0), sq(17, 14), sq(9, 7)]) expect(frameContains(frame, p)).toBe(true);
  });

  it('is pure — the same subjects always give the same frame', () => {
    const subjects = [sq(2, 7), sq(9, 7)];
    expect(frameFor(subjects, VIEWPORT, MAP)).toEqual(frameFor(subjects, VIEWPORT, MAP));
  });
});

describe('cameraTransform maps the frame onto the viewport', () => {
  it('scales so the frame fills the viewport and centres it', () => {
    const frame = frameFor([sq(2, 7), sq(9, 7)], VIEWPORT, MAP);
    const t = cameraTransform(frame, VIEWPORT);
    // Renderer-consumable CSS transform, origin 0 0: translate then scale.
    expect(t).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\) scale\([\d.]+\)$/);

    const scale = Number(/scale\(([\d.]+)\)/.exec(t)![1]);
    expect(scale).toBeCloseTo(VIEWPORT.width / frame.width, 6);
    // The frame's centre lands on the viewport's centre.
    const [, txs, tys] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(t)!;
    const cx = Number(txs) + (frame.x + frame.width / 2) * scale;
    const cy = Number(tys) + (frame.y + frame.height / 2) * scale;
    expect(cx).toBeCloseTo(VIEWPORT.width / 2, 6);
    expect(cy).toBeCloseTo(VIEWPORT.height / 2, 6);
  });

  it('the scaled frame fits the viewport on both axes — nothing is cropped', () => {
    for (const subjects of [[], [sq(2, 7), sq(9, 7)], [sq(0, 0)]]) {
      const frame = frameFor(subjects, VIEWPORT, MAP);
      const scale = Number(/scale\(([\d.]+)\)/.exec(cameraTransform(frame, VIEWPORT))![1]);
      expect(scale).toBeGreaterThan(0);
      expect(frame.width * scale).toBeLessThanOrEqual(VIEWPORT.width + 1e-6);
      expect(frame.height * scale).toBeLessThanOrEqual(VIEWPORT.height + 1e-6);
    }
  });
});
