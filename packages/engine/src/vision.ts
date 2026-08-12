/**
 * Line of sight.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): exact integer geometry,
 * no randomness, no clock, no I/O, no floating point anywhere.
 *
 * Rules implemented here (GAME_SPEC §3 "Board"):
 * - **walls** block line of sight;
 * - **cover** does not (it blocks movement and grants damage reduction, but
 *   you can see and shoot over it);
 * - **brush** does not (it conceals whoever stands *in* it — that is a
 *   different question from whether the line is clear, and lives with the
 *   vision rules).
 *
 * Vision range, concealment and the Stealth/Reveal interactions build on this
 * and arrive with the rest of BACKLOG item 2.
 */

import { type Board, inBounds, terrainAt, vecEq } from './board.js';
import type { Vec2 } from './types.js';

/**
 * Does the segment between the centres of `from` and `to` clear every wall in
 * between?
 *
 * This is exact geometry rather than a rasterised ray. Square centres are
 * placed at odd coordinates in a grid scaled by two, so a square's interior
 * spans an even coordinate range and every comparison below is integer — there
 * is no epsilon and no rounding to disagree about across machines.
 *
 * A wall blocks only when the segment enters its **interior**. A line that
 * passes exactly through a wall's corner still sees through; see
 * `docs/DECISIONS.md` for why that permissive reading was chosen.
 *
 * The endpoints never block: you can always see the square you stand on and
 * the square you are looking at (so a wall is visible to the unit beside it).
 *
 * Symmetric by construction — the segment from A to B is the same point set as
 * the segment from B to A — which is what GAME_SPEC §3 "vision is mutual"
 * requires of this layer.
 */
export function hasLineOfSight(board: Board, from: Vec2, to: Vec2): boolean {
  if (!inBounds(board, from) || !inBounds(board, to)) return false;
  if (vecEq(from, to)) return true;

  const ax = 2 * from.x + 1;
  const ay = 2 * from.y + 1;
  const bx = 2 * to.x + 1;
  const by = 2 * to.y + 1;

  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);

  // Only squares in the segment's bounding box can be crossed. Row-major scan
  // keeps the walk order fixed; the result does not depend on it either way.
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if ((x === from.x && y === from.y) || (x === to.x && y === to.y)) continue;
      if (terrainAt(board, { x, y }) !== 'wall') continue;
      if (segmentEntersSquare(ax, ay, bx, by, x, y)) return false;
    }
  }
  return true;
}

/**
 * Does segment (ax,ay)→(bx,by) — in doubled coordinates — enter the open
 * interior of square (sx,sy)?
 *
 * Separating-axis test on the three candidate axes for a segment and an
 * axis-aligned box: x, y, and the segment's own normal. "Open interior" is
 * what makes corner grazes pass: touching the boundary is not entering.
 */
function segmentEntersSquare(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  sx: number,
  sy: number,
): boolean {
  const x0 = 2 * sx;
  const x1 = x0 + 2;
  const y0 = 2 * sy;
  const y1 = y0 + 2;

  // Axis-aligned separation: the segment's bounding box must overlap the
  // square's interior strictly, or the segment stops short of / beside it.
  if (Math.max(ax, bx) <= x0 || Math.min(ax, bx) >= x1) return false;
  if (Math.max(ay, by) <= y0 || Math.min(ay, by) >= y1) return false;

  // Separation along the segment's normal: the interior is entered only when
  // corners fall strictly on both sides of the infinite line. If every corner
  // is on one side — or merely touching (cross === 0) — the line grazes at
  // most an edge or a corner and the interior stays clear.
  const dx = bx - ax;
  const dy = by - ay;
  const corners: readonly (readonly [number, number])[] = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ];
  let positive = false;
  let negative = false;
  for (const [cx, cy] of corners) {
    const cross = dx * (cy - ay) - dy * (cx - ax);
    if (cross > 0) positive = true;
    else if (cross < 0) negative = true;
  }
  return positive && negative;
}
