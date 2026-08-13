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
 * Shape rulings (judgment calls the spec left open — see docs/DECISIONS.md):
 * - **line** fires as a ray in ANY of the AIM_STEPS quantized directions (AIM2);
 *   without a step it falls back to the 8 compass directions derived from
 *   caster→aim. It pierces and stops at the first wall (cover does not stop it —
 *   cover blocks movement, not line of sight, GAME_SPEC §3).
 * - **cone** fires along its aim direction (quantized step, or the dominant
 *   cardinal of caster→aim) and widens by one square of half-width per step of
 *   depth (a ~45° wedge).
 * - **circle** is a true Euclidean disk (dx²+dy² ≤ r²) centred on the aimed
 *   square — round, not a Chebyshev block.
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

/**
 * Walk `d` tiles along a direction vector. Range for a directional shape is a
 * TILE COUNT along its axis (joint AIM2 x MET1 ruling), so rotating a shape
 * never changes how many tiles it reaches: metering is by the dominant axis,
 * and a tile is covered when its centre — a lattice point — is the nearest one
 * to the ideal position at that depth.
 */
function alongAxis(v: Vec2, d: number): Vec2 {
  const m = Math.max(Math.abs(v.x), Math.abs(v.y));
  return { x: divRound(d * v.x, m), y: divRound(d * v.y, m) };
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

/**
 * Squares along a ray, caster excluded, stopping before the first wall.
 *
 * `dir` may be any integer direction vector — a compass unit step (the old
 * 8-direction behaviour, unchanged) or a quantized aim vector from
 * `stepToVector`. `range` is a tile count along the axis, so a rotated line
 * reaches as far as an axis-aligned one.
 */
export function lineSquares(board: Board, from: Vec2, dir: Vec2, range: number): Vec2[] {
  const out: Vec2[] = [];
  const seen = new Set<string>();
  for (let d = 1; d <= range; d++) {
    const step = alongAxis(dir, d);
    const p: Vec2 = { x: from.x + step.x, y: from.y + step.y };
    const k = vecKey(p);
    if (seen.has(k)) continue; // a shallow angle can land twice; count it once
    if (!inBounds(board, p)) break;
    if (terrainAt(board, p) === 'wall') break;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * An expanding cone, caster excluded. At depth `d` the wedge spans a half-width
 * of `d − 1`, so depth 1 is a single square and each further step widens by one
 * square on each side. Wall squares in the wedge are dropped but do not occlude
 * squares behind them (v1 keeps cones simple; see DECISIONS.md).
 *
 * `dir` may be a cardinal (the original behaviour) or any quantized aim vector;
 * the wedge is built from the axis walk and its perpendicular, so a rotated cone
 * keeps the same depth and width as an axis-aligned one. Coverage is
 * centre-in/binary: a tile is either in the wedge and takes full damage, or it
 * is not in it at all (AIM2 — "half a tile" is a visual nuance, not a damage split).
 */
export function coneSquares(board: Board, from: Vec2, dir: Vec2, range: number): Vec2[] {
  const perp: Vec2 = { x: -dir.y, y: dir.x };
  const out: Vec2[] = [];
  const seen = new Set<string>();
  for (let d = 1; d <= range; d++) {
    const centre = alongAxis(dir, d);
    const w = d - 1;
    for (let k = -w; k <= w; k++) {
      const off = k === 0 ? { x: 0, y: 0 } : alongAxis(perp, k);
      const p: Vec2 = { x: from.x + centre.x + off.x, y: from.y + centre.y + off.y };
      const key = vecKey(p);
      if (seen.has(key)) continue;
      if (!inBounds(board, p)) continue;
      if (terrainAt(board, p) === 'wall') continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/**
 * A Euclidean disk (dx²+dy² ≤ radius²) centred on `center`, row-major order.
 * The comparison is integer so it is identical on every machine. Wall and
 * out-of-bounds squares are excluded.
 */
export function circleSquares(board: Board, center: Vec2, radius: number): Vec2[] {
  const out: Vec2[] = [];
  const r2 = radius * radius;
  for (let y = center.y - radius; y <= center.y + radius; y++) {
    for (let x = center.x - radius; x <= center.x + radius; x++) {
      const dx = x - center.x;
      const dy = y - center.y;
      if (dx * dx + dy * dy > r2) continue;
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
