/**
 * Shared integer edge geometry (GEOM1).
 *
 * Both cover reduction (combat) and directional-cover movement (board/movement)
 * ask the same question — does a straight line between two tile centres cross a
 * given tile edge? — so the primitives live here rather than being duplicated,
 * and stay pure integer math so the answer is identical on every machine.
 *
 * Coordinates are **doubled**: a tile centre is `2*p+1`, a tile edge runs
 * between corners at even coordinates. That keeps every centre and every edge on
 * integer points with no shared coordinates, so an intersection is exact.
 */
import type { Vec2 } from './types.js';
import type { CoverFacing } from './types.js';

/** Unit step for each cover facing (N is −y, matching the board's y-down grid). */
export const FACING_VEC: Record<CoverFacing, Vec2> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};

/** A tile centre in doubled coordinates. */
export const centre = (p: Vec2): Vec2 => ({ x: 2 * p.x + 1, y: 2 * p.y + 1 });

/**
 * Integer test: does segment [p1,p2] share any point with segment [p3,p4]?
 * Standard orientation method; collinear-overlap and endpoint touches count as
 * intersecting, which makes a shot through a square's corner graze both flanking
 * edges (a corner-tucked defender gets cover from either side).
 */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const onSeg = (o: Vec2, a: Vec2, b: Vec2) =>
    Math.min(a.x, b.x) <= o.x && o.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= o.y && o.y <= Math.max(a.y, b.y);
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSeg(p1, p3, p4)) return true;
  if (d2 === 0 && onSeg(p2, p3, p4)) return true;
  if (d3 === 0 && onSeg(p3, p1, p2)) return true;
  if (d4 === 0 && onSeg(p4, p1, p2)) return true;
  return false;
}

/** The two corners of `tile`'s square on the `dir` side, in doubled coords. */
export function edgeCorners(tile: Vec2, dir: Vec2): [Vec2, Vec2] {
  const x0 = 2 * tile.x;
  const y0 = 2 * tile.y;
  const x1 = x0 + 2;
  const y1 = y0 + 2;
  if (dir.x === 1) return [{ x: x1, y: y0 }, { x: x1, y: y1 }]; // east edge
  if (dir.x === -1) return [{ x: x0, y: y0 }, { x: x0, y: y1 }]; // west edge
  if (dir.y === 1) return [{ x: x0, y: y1 }, { x: x1, y: y1 }]; // south edge
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }]; // north edge
}
