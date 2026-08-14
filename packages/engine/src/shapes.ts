/**
 * Ability shape expansion: turn an aimed order into the exact set of board
 * squares an ability covers.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): integer geometry only, no
 * randomness, no clock, no I/O, no floating point. Given the same
 * `(board, ability, casterPos, aim)` the affected-square list is always the
 * same, in the same order.
 *
 * Free-aim (GAME_SPEC §2): the player picks squares/directions during Decision;
 * abilities do not track. This module answers "given that aim, which squares are
 * hit" — it does not decide who is standing there. Nothing here mutates state.
 *
 * Coverage rule (HITBOX1, Atlas Reactor): every tile carries a **circular
 * hitbox of radius half a tile at its centre**, and a tile is hit **iff the
 * ability's geometric area intersects that circle**. Nicking a tile's corner
 * therefore does nothing, while an area that cuts an edge at or past its
 * midpoint is guaranteed to hit. Coverage stays binary — a covered tile takes
 * the full effect, there is no partial damage. This supersedes the older
 * centre-in rule (AIM2), which asked only whether the tile's centre lay inside.
 *
 * Shape rulings (judgment calls the spec left open — see docs/DECISIONS.md):
 * - **line** is a ray in ANY of the AIM_STEPS quantized directions (AIM2);
 *   without a step it falls back to the 8 compass directions derived from
 *   caster→aim. It pierces and stops at the first wall (cover does not stop it —
 *   cover blocks movement, not line of sight, GAME_SPEC §3).
 * - **cone** is a 45° wedge from the caster along its aim direction (quantized
 *   step, or the dominant cardinal of caster→aim), with **every dimension
 *   measured in Euclidean tiles** (CONE-B) so rotating it cannot change its
 *   area.
 * - **circle** is a true Euclidean disk of the ability's radius centred on the
 *   aimed square — round, not a Chebyshev block.
 * - **every ability range is a EUCLIDEAN tile distance** (AIM-METRIC): the axial
 *   depth of a `line`/`cone`, the aim range of a `square`/`circle`, and a
 *   `circle`'s radius. Movement, sprint, `path` dash length and vision stay
 *   MANHATTAN (MET1) — steps for walking, distance for aiming.
 * Walls and out-of-bounds squares are excluded from every area.
 */

import {
  type Board,
  distance,
  inBounds,
  terrainAt,
  vecKey,
} from './board.js';
import type { AbilityDef, Vec2 } from './types.js';

/** Sign of a number as a unit step component. */
export function sign(n: number): -1 | 0 | 1 {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

// ── Free-rotation aiming (AIM2) ─────────────────────────────────────────────
//
// `line` and `cone` may point in any of AIM_STEPS directions, not just the 8
// compass points. Determinism is non-negotiable (golden rule #1), so the
// direction crosses into the engine as a **quantized integer step** and there is
// **no trig anywhere in this package** — a standing test asserts that.
//
// The trick that removes trig from *both* sides: quantize onto a DIAMOND rather
// than a circle. Step `s` maps to the lattice point on |x| + |y| = AIM_R, which
// is plain integer arithmetic, and the inverse (a mouse delta → the nearest
// step) is the same projection run backwards. The client can therefore agree
// with the engine exactly, using integers, instead of doing its own atan2 and
// hoping the rounding matches. A diamond is also the natural shape for a
// Manhattan world (MET1).

/** Quantization of a full turn. A power of two keeps the arithmetic exact. */
export const AIM_STEPS = 256;
/** Manhattan radius of the quantization diamond; AIM_STEPS / 4 per quadrant. */
const AIM_R = AIM_STEPS / 4;

/** Integer round-half-up of `a / b` for `b > 0`, correct for negative `a`. */
function divRound(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/** Is `step` a legal quantized aim direction? */
export function isAimStep(step: unknown): step is number {
  return typeof step === 'number' && Number.isInteger(step) && step >= 0 && step < AIM_STEPS;
}

/**
 * The integer direction vector for a quantized step: the lattice point on the
 * diamond |x| + |y| = AIM_R. Step 0 points +x (east) and steps run clockwise in
 * screen coordinates (y grows downward), so 64 is south, 128 west, 192 north.
 */
export function stepToVector(step: number): Vec2 {
  const s = ((step % AIM_STEPS) + AIM_STEPS) % AIM_STEPS;
  const q = Math.floor(s / AIM_R);
  const t = s % AIM_R;
  // `|| 0` normalises negative zero: -0 is a JS artifact that has no place in a
  // value the whole engine compares and serialises.
  const v = (n: number): number => n || 0;
  switch (q) {
    case 0: return { x: v(AIM_R - t), y: v(t) };
    case 1: return { x: v(-t), y: v(AIM_R - t) };
    case 2: return { x: v(-(AIM_R - t)), y: v(-t) };
    default: return { x: v(t), y: v(-(AIM_R - t)) };
  }
}

/**
 * The quantized step nearest to a raw delta — the inverse of `stepToVector`,
 * and the function a client uses to turn a drag into an aim. Integer only.
 * A zero delta has no direction and yields step 0.
 */
export function vectorToStep(dx: number, dy: number): number {
  const len = Math.abs(dx) + Math.abs(dy);
  if (len === 0) return 0;
  if (dx > 0 && dy >= 0) return divRound(dy * AIM_R, len) % AIM_STEPS;
  if (dx <= 0 && dy > 0) return AIM_R + divRound(-dx * AIM_R, len);
  if (dx < 0 && dy <= 0) return 2 * AIM_R + divRound(-dy * AIM_R, len);
  return 3 * AIM_R + divRound(dx * AIM_R, len);
}

/** Unit step toward `to`, each component in {-1,0,1} (one of the 8 dirs, or 0). */
export function direction8(from: Vec2, to: Vec2): Vec2 {
  return { x: sign(to.x - from.x), y: sign(to.y - from.y) };
}

/**
 * The cardinal (N/E/S/W) that best matches `from`→`to`. Ties on the diagonal
 * resolve to the horizontal axis, deterministically. Cones snap to this so their
 * geometry stays integer and grid-aligned.
 */
export function dominantCardinal(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: sign(dx), y: 0 };
  return { x: 0, y: sign(dy) };
}

// ── The half-tile hitbox, in integers (HITBOX1) ─────────────────────────────
//
// "Does this area come within half a tile of that tile's centre?" is a question
// about distances, and distances want square roots — which floats answer
// slightly differently on different machines. So nothing here ever takes one.
// Every test below is a comparison of two *squared* quantities, scaled by a
// common integer factor that cancels out, which makes the answer exact and
// identical everywhere (golden rule #1).
//
// The frame each directional shape is measured in: `m` is the dominant
// component of `dir`, so one tile step along the axis is `dir / m`; `d2` is
// |dir|². For a tile offset `(dx, dy)` from the caster,
//
//   dot   = dir · (dx, dy)          how far along the axis it lies
//   cross = dir × (dx, dy)          how far off the axis it lies (signed)
//
// and a perpendicular distance of `|cross| / |dir|` is within half a tile
// exactly when `4·cross² ≤ d2` — no square root, no float.

/**
 * Squares a ray covers, caster excluded, stopping at the first wall.
 *
 * The area is the segment from the caster's centre out to `range` **tile-widths**
 * along the axis (AIM-METRIC); a tile is covered when that segment passes within
 * half a tile of its centre, so the beam reads as a one-tile-wide band. `dir` may
 * be a compass unit step or a quantized aim vector from `stepToVector`.
 *
 * Because the reach is a distance rather than a step count, a diagonal beam
 * covers fewer *tiles* than an axis-aligned one of the same range — its tiles
 * are √2 apart. That is the nerf, not a bug: a range-8 line used to reach 11.3
 * tiles on the diagonal and now reaches 8 whichever way it points.
 */
export function lineSquares(board: Board, from: Vec2, dir: Vec2, range: number): Vec2[] {
  const d2 = dir.x * dir.x + dir.y * dir.y;
  if (d2 === 0 || range < 1) return [];
  // The beam ends `range` tile-widths out, so nothing beyond that box can be in
  // it; +1 for the half-tile band, +1 for headroom.
  const reach = range + 2;
  const hits: { readonly p: Vec2; readonly depth: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx === 0 && dy === 0) continue; // the caster's own square is never hit
      const dot = dir.x * dx + dir.y * dy;
      if (dot <= 0) continue; // level with or behind the caster
      const cross = dir.x * dy - dir.y * dx;
      // Alongside the beam (within half a tile of the axis, HITBOX1) and inside
      // its **Euclidean** reach (AIM-METRIC). Both sides squared: `dot / |dir|`
      // is the axial distance in tiles, so `dot² ≤ range²·|dir|²` is "within
      // `range` tile-widths" with no square root. Metering this in lattice steps
      // is what used to let a range-8 line reach 11.3 tiles on the diagonal.
      const covered = 4 * cross * cross <= d2 && dot * dot <= range * range * d2;
      if (covered) hits.push({ p: { x: from.x + dx, y: from.y + dy }, depth: dot });
    }
  }
  // Depth order, so "stops at the first wall" means what it says. Ties (two
  // tiles the beam grazes at the same depth) settle on y then x — arbitrary,
  // but fixed, which is what determinism asks for.
  hits.sort((a, b) => a.depth - b.depth || a.p.y - b.p.y || a.p.x - b.p.x);
  const out: Vec2[] = [];
  for (const hit of hits) {
    if (!inBounds(board, hit.p)) continue; // a ray that leaves the board never returns
    if (terrainAt(board, hit.p) === 'wall') break;
    out.push(hit.p);
  }
  return out;
}

// ── The cone wedge, metered in Euclidean tiles (CONE-B) ─────────────────────
//
// A cone is the triangle with its apex at the caster's centre, edges at 45°,
// capped `range` tiles out — and **every one of those measurements is a
// Euclidean distance in tiles**. That is the whole of CONE-B. Under the older
// reading, a cone's depth was a *tile count* along its axis, so at 45° one tile
// of depth was a diagonal step: √2 longer in real distance, and since area goes
// as the square, a rotated cone quietly covered up to 88% more tiles than the
// same cone pointed east. Measuring in tiles instead makes the region a fixed
// shape that merely rotates, so its area cannot breathe with the aim.
//
// The axis-aligned footprint is deliberately unchanged, tile for tile — that is
// the reach the damage numbers were tuned against. What moves is off-axis.
//
// The ramp is fixed at **one tile of half-width per tile of axial depth** (the
// 45° edges). That value is what reproduces the axis-aligned footprint exactly;
// changing it is an ENGINE ASK, not a data tweak, because the edge direction is
// baked into the integer predicate below.
//
// **The frame.** For a tile offset P and aim vector V, write
//
//   a = P · V     (axial, × |V|)      b = V × P     (lateral, × |V|)
//
// Both carry the *same* scale factor |V|, so `(a, b)` is tile space rotated and
// uniformly scaled — which is exactly why the test is rotation-invariant. The
// triangle becomes `{ |b| ≤ a ≤ range·|V| }`. `|V|` is irrational, so every
// comparison against it is resolved by a sign guard plus a squared comparison:
// still integers, still no `Math.sqrt`, still identical on every machine.

/**
 * The squares a cone covers, caster excluded, in row-major order.
 *
 * A tile is covered when the wedge comes within half a tile of its centre
 * (HITBOX1) — the wedge is the region, the hitbox decides which tiles it takes.
 * Wall squares in the wedge are dropped but do not occlude squares behind them
 * (v1 keeps cones simple; see DECISIONS.md).
 */
export function coneSquares(board: Board, from: Vec2, dir: Vec2, range: number): Vec2[] {
  const d2 = dir.x * dir.x + dir.y * dir.y;
  if (d2 === 0 || range < 1) return [];
  // The far corners sit `range` tiles out and as far again to the side, so no
  // covered tile is more than range·√2 away; +2 for the hitbox and headroom.
  const reach = 2 * range + 2;
  const out: Vec2[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx === 0 && dy === 0) continue; // the caster's own square is never hit
      const p: Vec2 = { x: from.x + dx, y: from.y + dy };
      if (!inBounds(board, p)) continue;
      if (terrainAt(board, p) === 'wall') continue;
      if (wedgeCovers(dir.x * dx + dir.y * dy, dir.x * dy - dir.y * dx, d2, range)) out.push(p);
    }
  }
  return out;
}

/** Sum of two squares — the one place this module spells out |v|². */
function sqLen(x: number, y: number): number {
  return x * x + y * y;
}

/**
 * Is the tile at `(a, b)` inside the wedge, or within half a tile of it?
 *
 * Inside is two comparisons. Outside, it is the distance to the nearest of the
 * triangle's three edges — the two 45° sides and the flat cap — each of which
 * is its own segment-distance case.
 */
function wedgeCovers(a: number, b: number, d2: number, range: number): boolean {
  if (a <= 0) return false; // level with or behind the caster
  const far = range * range * d2; // (range · |V|)²
  if (b * b <= a * a && a * a <= far) return true;
  // `b` and `-b` are the same point reflected across the axis, so one edge test
  // run twice covers both sides.
  return nearEdge(a, b, d2, range) || nearEdge(a, -b, d2, range) || nearCap(a, b, d2, range);
}

/**
 * Within half a tile of the side running from the apex `(0,0)` out to the far
 * corner `(range, range)`?
 */
function nearEdge(a: number, b: number, d2: number, range: number): boolean {
  const t = a + b; // twice the projection along the edge's (1,1) direction, × |V|
  if (t <= 0) return 4 * sqLen(a, b) <= d2; // nearest point is the apex
  if (t * t >= 4 * range * range * d2) {
    // Nearest point is the far corner C = range·(û + n̂). Expanding |P − C|² ≤ ¼
    // and clearing denominators leaves one term carrying |V|; `t > 0` above is
    // the sign guard that makes squaring it safe.
    const lhs = 4 * sqLen(a, b) + d2 * (8 * range * range - 1);
    return lhs <= 0 || lhs * lhs <= 64 * range * range * t * t * d2;
  }
  // Nearest point is the edge itself: distance = |b − a| / (|V|·√2).
  return 2 * (b - a) * (b - a) <= d2;
}

/** Within half a tile of the flat cap, the segment `(range, ±range)`? */
function nearCap(a: number, b: number, d2: number, range: number): boolean {
  const far = range * range * d2;
  if (a * a <= far) return false; // short of the cap — a side is nearer
  if (b * b > far) return false; // out past a corner — `nearEdge` owns that case
  return 4 * a * a <= (2 * range + 1) * (2 * range + 1) * d2;
}

/**
 * A Euclidean disk of `radius` centred on `center`, row-major order. Under the
 * half-tile hitbox a tile is covered when its centre is within `radius + ½` —
 * i.e. `4·(dx² + dy²) ≤ (2·radius + 1)²`, integer on both sides, so it is
 * identical on every machine. Wall and out-of-bounds squares are excluded.
 */
export function circleSquares(board: Board, center: Vec2, radius: number): Vec2[] {
  const out: Vec2[] = [];
  const span = radius + 1; // the hitbox reaches half a tile past the disk
  const limit = (2 * radius + 1) * (2 * radius + 1);
  for (let y = center.y - span; y <= center.y + span; y++) {
    for (let x = center.x - span; x <= center.x + span; x++) {
      const dx = x - center.x;
      const dy = y - center.y;
      if (4 * sqLen(dx, dy) > limit) continue;
      const p: Vec2 = { x, y };
      if (!inBounds(board, p)) continue;
      if (terrainAt(board, p) === 'wall') continue;
      out.push(p);
    }
  }
  return out;
}

/**
 * Expand an ability's aim into the squares it affects.
 *
 * `aim` is the order's target array (GAME_SPEC §2): the aimed square for
 * `square`/`circle`, an endpoint indicating direction for `line`/`cone`, and the
 * traversed path itself for `path` (dashes). `self` ignores the aim. The result
 * excludes walls and out-of-bounds squares and is deterministically ordered.
 *
 * This says nothing about legality (range checks, passability) — the turn
 * pipeline validates the order before calling this. Missing aims yield an empty
 * area rather than throwing, so a malformed order simply hits nothing.
 */
export function expandShape(
  board: Board,
  ability: AbilityDef,
  casterPos: Vec2,
  aim: readonly Vec2[],
  aimStep?: number,
): Vec2[] {
  const target = aim[0];
  /**
   * The direction a `line`/`cone` points. A quantized step (AIM2) wins when the
   * order carries one; otherwise the direction is derived from caster→target, so
   * click-to-aim orders keep working exactly as before.
   */
  const aimVector = (fallback: (from: Vec2, to: Vec2) => Vec2): Vec2 | undefined => {
    if (isAimStep(aimStep)) return stepToVector(aimStep);
    if (target === undefined) return undefined;
    const v = fallback(casterPos, target);
    return v.x === 0 && v.y === 0 ? undefined : v;
  };
  switch (ability.shape) {
    case 'self':
      return [{ x: casterPos.x, y: casterPos.y }];
    case 'square':
      return target !== undefined && inBounds(board, target) ? [target] : [];
    case 'circle': {
      if (target === undefined) return [];
      return circleSquares(board, target, ability.radius ?? 1);
    }
    case 'line': {
      const dir = aimVector(direction8);
      return dir === undefined ? [] : lineSquares(board, casterPos, dir, ability.range);
    }
    case 'cone': {
      const dir = aimVector(dominantCardinal);
      return dir === undefined ? [] : coneSquares(board, casterPos, dir, ability.range);
    }
    case 'path': {
      // The aim is the traversed path; only in-bounds squares survive. Dash
      // damage/first-target logic (BACKLOG item 7) reads the path itself.
      const seen = new Set<string>();
      const out: Vec2[] = [];
      for (const p of aim) {
        if (!inBounds(board, p)) continue;
        const k = vecKey(p);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(p);
      }
      return out;
    }
  }
}

/**
 * Reach of an *aimed square* from the caster: **EUCLIDEAN** (AIM-METRIC).
 *
 * Movement is measured in steps, aiming is measured in distance. This is the
 * target-square rule (`circle`/`square`), and it makes the aimable region a
 * **disc, not a diamond** — the arbitrary Manhattan restriction is what made a
 * shot down the row reach further than the same shot on the diagonal. Squared
 * on both sides, so it stays exact integer arithmetic with no square root, and
 * a tile exactly `range` away is included.
 *
 * Supersedes MET1's circle/square clause. Movement, sprint, `path` dash length
 * and vision are untouched — MET1 still governs everything that walks, and
 * vision is perception rather than aiming (a separate owner call).
 */
export function aimInRange(casterPos: Vec2, target: Vec2, range: number): boolean {
  const dx = target.x - casterPos.x;
  const dy = target.y - casterPos.y;
  return dx * dx + dy * dy <= range * range;
}
