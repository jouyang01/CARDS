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
 * - **cone** is a 45° wedge along its aim direction (quantized step, or the
 *   dominant cardinal of caster→aim) whose apex sits half a tile in front of the
 *   caster — the geometry the old "half-width = depth − 1" rule approximated.
 * - **circle** is a true Euclidean disk of the ability's radius centred on the
 *   aimed square — round, not a Chebyshev block.
 * - directional reach (`line`/`cone`) is a TILE COUNT along the axis, so a
 *   rotated shape reaches as far as an axis-aligned one; aimed-square reach
 *   (`square`/`circle` centre) is MANHATTAN (MET1, GAME_SPEC §3).
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
 * The area is the segment from the caster's centre out to `range` tiles along
 * the axis; a tile is covered when that segment passes within half a tile of
 * its centre, so the beam reads as a one-tile-wide band. `dir` may be a compass
 * unit step or a quantized aim vector from `stepToVector`; `range` is a tile
 * count along the axis, so a rotated line reaches as far as an axis-aligned one.
 */
export function lineSquares(board: Board, from: Vec2, dir: Vec2, range: number): Vec2[] {
  const m = Math.max(Math.abs(dir.x), Math.abs(dir.y));
  if (m === 0 || range < 1) return [];
  const d2 = dir.x * dir.x + dir.y * dir.y;
  // The far end sits `range` tiles along the dominant axis, so no covered tile
  // is further than that on either axis; +1 for the hitbox, +1 for headroom.
  const reach = range + 2;
  const hits: { readonly p: Vec2; readonly depth: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx === 0 && dy === 0) continue; // the caster's own square is never hit
      const dot = dir.x * dx + dir.y * dy;
      if (dot <= 0) continue; // level with or behind the caster
      const cross = dir.x * dy - dir.y * dx;
      const covered = dot * m <= range * d2
        // Alongside the beam: within half a tile of the axis.
        ? 4 * cross * cross <= d2
        // Past its end: within half a tile of the endpoint itself. This is what
        // lets a rotated line reach its full tile count — the endpoint rarely
        // lands on a lattice point, and the tile it lands *in* still takes it.
        : sqLen(2 * m * dx - 2 * range * dir.x, 2 * m * dy - 2 * range * dir.y) <= m * m;
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

/**
 * The squares a cone covers, caster excluded, in row-major order.
 *
 * The area is a 45° wedge with its apex half a tile in front of the caster,
 * capped `range` tiles along the axis — the continuous shape the old
 * "half-width = depth − 1" rule was approximating. A tile is covered when that
 * wedge comes within half a tile of its centre, which widens each row by one
 * tile on each side compared with the old centre-in rule. Wall squares in the
 * wedge are dropped but do not occlude squares behind them (v1 keeps cones
 * simple; see DECISIONS.md).
 */
export function coneSquares(board: Board, from: Vec2, dir: Vec2, range: number): Vec2[] {
  const m = Math.max(Math.abs(dir.x), Math.abs(dir.y));
  if (m === 0 || range < 1) return [];
  const d2 = dir.x * dir.x + dir.y * dir.y;
  // Working frame: shift the origin to the apex and scale by 2m, so the wedge
  // becomes the triangle (0,0) → (cap, ±cap) in (along-axis, off-axis) units.
  const cap = (2 * range - 1) * d2;
  // Half a tile, squared and doubled, in that same frame.
  const hitbox = 2 * m * m * d2;
  // The far corners sit `range` tiles out and nearly as far to the side, and a
  // rotated wedge spreads that across both axes; 2·range+2 covers every case.
  const reach = 2 * range + 2;
  const out: Vec2[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx === 0 && dy === 0) continue;
      const p: Vec2 = { x: from.x + dx, y: from.y + dy };
      if (!inBounds(board, p)) continue;
      if (terrainAt(board, p) === 'wall') continue;
      const along = 2 * m * (dir.x * dx + dir.y * dy) - d2;
      const off = 2 * m * (dir.x * dy - dir.y * dx);
      if (wedgeCovers(along, off, cap, hitbox)) out.push(p);
    }
  }
  return out;
}

/** Sum of two squares — the one place this module spells out |v|². */
function sqLen(x: number, y: number): number {
  return x * x + y * y;
}

/**
 * Does a tile at `(along, off)` fall inside the wedge triangle, or within half
 * a tile of it? Inside is a pair of comparisons; outside is the nearest of the
 * triangle's three edges. Distances are carried as **2× the squared distance**
 * so the 45° edges — whose direction is (1, 1) — stay integral.
 */
function wedgeCovers(along: number, off: number, cap: number, hitbox: number): boolean {
  if (along >= Math.abs(off) && along <= cap) return true;
  const nearest = Math.min(
    edgeDist2(along, off, cap), // apex → far corner, one side…
    edgeDist2(along, -off, cap), // …and the mirror of it, the other side
    capDist2(along, off, cap), // the flat far end
  );
  return nearest <= hitbox;
}

/** 2× the squared distance to the wedge edge from (0,0) to (cap, cap). */
function edgeDist2(along: number, off: number, cap: number): number {
  const t = along + off; // twice the projection along the edge's (1,1) direction
  if (t <= 0) return 2 * sqLen(along, off); // nearest point is the apex
  if (t >= 2 * cap) return 2 * sqLen(along - cap, off - cap); // …the far corner
  const perp = off - along;
  return perp * perp; // …the edge itself: 2·(perp/√2)² = perp²
}

/** 2× the squared distance to the flat cap, from (cap, −cap) to (cap, cap). */
function capDist2(along: number, off: number, cap: number): number {
  if (off <= -cap) return 2 * sqLen(along - cap, off + cap);
  if (off >= cap) return 2 * sqLen(along - cap, off - cap);
  return 2 * (along - cap) * (along - cap);
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
 * Reach of an *aimed square* from the caster: MANHATTAN (MET1, GAME_SPEC §3).
 * This is the target-square rule, used by `circle`/`square`. Directional shapes
 * (`line`/`cone`) measure range as a tile count along their axis instead, so
 * rotating one does not change how far it reaches (joint AIM2 x MET1 ruling).
 */
export function aimInRange(casterPos: Vec2, target: Vec2, range: number): boolean {
  return distance(casterPos, target) <= range;
}
