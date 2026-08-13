/**
 * Camera framing — pure geometry, no DOM.
 *
 * The camera's job is CAUSALITY, not spectacle: for a Prep/Blast cue the
 * SHOOTER and the ability's AREA must both be in frame, so a player can see who
 * fired at what. `frameFor` turns a set of subject squares into a board-space
 * rectangle; `cameraTransform` turns that rectangle into the scale/translate a
 * renderer applies to the world group.
 *
 * Accepted tradeoff (deliberate, do not "fix"): with range 6–8 abilities the
 * shooter∪area bbox already spans 7–9 squares, so the result reads as a tracking
 * shot with mild zoom rather than a dramatic push-in. Causality was chosen over
 * spectacle.
 */

import type { Vec2 } from '@cards/engine';
import { CELL, PAD } from './render.js';

/** A rectangle in board space (SVG user units). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Squares of padding kept around the subjects. */
export const FRAME_PAD_SQUARES = 1.5;
/** The camera never frames tighter than this, so a single unit is not a close-up. */
export const MIN_FRAME_SQUARES = 7;

const squareRect = (p: Vec2): Rect => ({ x: PAD + p.x * CELL, y: PAD + p.y * CELL, width: CELL, height: CELL });

/** The board's full extent in SVG user units. */
export const boardRect = (map: { width: number; height: number }): Rect => ({
  x: 0, y: 0, width: map.width * CELL + PAD * 2, height: map.height * CELL + PAD * 2,
});

/** Smallest rectangle covering every square. */
export function bboxOf(squares: readonly Vec2[]): Rect | undefined {
  if (squares.length === 0) return undefined;
  const rects = squares.map(squareRect);
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const pad = (r: Rect, amount: number): Rect => ({
  x: r.x - amount, y: r.y - amount, width: r.width + amount * 2, height: r.height + amount * 2,
});

/** Grow to at least `min` on both axes, keeping the centre. */
function atLeast(r: Rect, min: number): Rect {
  const width = Math.max(r.width, min);
  const height = Math.max(r.height, min);
  return { x: r.x + (r.width - width) / 2, y: r.y + (r.height - height) / 2, width, height };
}

/** Grow (never crop) to the viewport's aspect ratio, keeping the centre. */
function toAspect(r: Rect, viewport: { width: number; height: number }): Rect {
  const aspect = viewport.width / viewport.height;
  const width = Math.max(r.width, r.height * aspect);
  const height = Math.max(r.height, r.width / aspect);
  return { x: r.x + (r.width - width) / 2, y: r.y + (r.height - height) / 2, width, height };
}

/**
 * Slide (never shrink) the frame back inside the board. A frame larger than the
 * board on an axis is centred on it instead.
 */
function clampToBoard(r: Rect, board: Rect): Rect {
  const slide = (pos: number, size: number, boardPos: number, boardSize: number): number => {
    if (size >= boardSize) return boardPos + (boardSize - size) / 2;
    return Math.max(boardPos, Math.min(pos, boardPos + boardSize - size));
  };
  return { ...r, x: slide(r.x, r.width, board.x, board.width), y: slide(r.y, r.height, board.y, board.height) };
}

/**
 * The frame for a cue's subjects: bbox → pad → minimum size → viewport aspect →
 * clamped to the board. With no subjects the whole board is framed.
 */
export function frameFor(
  subjects: readonly Vec2[],
  viewport: { width: number; height: number },
  map: { width: number; height: number },
): Rect {
  const board = boardRect(map);
  const box = bboxOf(subjects);
  if (box === undefined) return clampToBoard(toAspect(board, viewport), board);
  const padded = pad(box, FRAME_PAD_SQUARES * CELL);
  const floored = atLeast(padded, MIN_FRAME_SQUARES * CELL);
  return clampToBoard(toAspect(floored, viewport), board);
}

/**
 * The world-group transform that shows `frame` in `viewport`. Assumes
 * `transform-origin: 0 0`, so scale then translate composes as written.
 */
export function cameraTransform(frame: Rect, viewport: { width: number; height: number }): string {
  const scale = Math.min(viewport.width / frame.width, viewport.height / frame.height);
  // Centre the frame in the viewport once scaled.
  const tx = (viewport.width - frame.width * scale) / 2 - frame.x * scale;
  const ty = (viewport.height - frame.height * scale) / 2 - frame.y * scale;
  return `translate(${tx}px, ${ty}px) scale(${scale})`;
}

/** True when `square` is inside `frame` — the property the camera exists to guarantee. */
export function frameContains(frame: Rect, square: Vec2): boolean {
  const r = squareRect(square);
  return r.x >= frame.x - 1e-6 && r.y >= frame.y - 1e-6
    && r.x + r.width <= frame.x + frame.width + 1e-6
    && r.y + r.height <= frame.y + frame.height + 1e-6;
}
