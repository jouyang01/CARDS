/**
 * Line of sight, vision range and concealment.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): exact integer geometry,
 * no randomness, no clock, no I/O, no floating point anywhere.
 *
 * Rules implemented here (GAME_SPEC §3 "Board", §6 Reveal/Stealth):
 * - **walls** block line of sight;
 * - **cover** does not (it blocks movement and grants damage reduction, but
 *   you can see and shoot over it);
 * - **brush** does not block the line — it conceals whoever stands *in* it,
 *   which is a separate question answered by `isConcealedFrom`;
 * - sight reaches `VISION_RANGE` squares, measured as MANHATTAN distance (MET1);
 * - a unit in brush is hidden from enemies that are neither standing in the
 *   same brush patch nor adjacent to *the unit itself* (standing beside the
 *   thicket is not the same as standing beside whoever is in it);
 * - Stealth hides a unit anywhere; Reveal defeats both brush and Stealth;
 * - **brush-break** (BRUSH-BREAK) defeats brush alone: a unit hit while a
 *   thicket was hiding it is drawn for two turns wherever it stands, but
 *   Stealth still covers it.
 *
 * GAME_SPEC §3 "vision is mutual" is implemented at the range + line-of-sight
 * layer, both of which are symmetric by construction. Concealment is
 * deliberately one-way: a unit in brush sees out while staying hidden, which
 * is the entire point of brush and of Stealth. See docs/DECISIONS.md.
 *
 * Nothing here mutates game state.
 */

import {
  type Board,
  distance,
  inBounds,
  ORTHOGONAL_STEPS,
  terrainAt,
  vecEq,
} from './board.js';
import { VISION_RANGE } from './constants.js';
import { hasStatus } from './status.js';
import type { GameState, TeamId, UnitState, Vec2 } from './types.js';

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

// ── Brush patches ───────────────────────────────────────────────────────────

/**
 * A board plus its brush connectivity, built once and reused for every
 * concealment query.
 */
export interface Vision {
  readonly board: Board;
  /**
   * Row-major brush patch id (`y * width + x`); `undefined` off brush. Ids are
   * assigned in row-major scan order, so the same map always yields the same
   * numbering.
   */
  readonly brushPatch: readonly (number | undefined)[];
}

/**
 * Flood-fill brush into connected patches.
 *
 * Connectivity is orthogonal, matching movement: two brush squares touching
 * only at a corner are separate patches, so a unit cannot claim to share
 * cover with brush it could not step into. See docs/DECISIONS.md.
 */
export function buildVision(board: Board): Vision {
  const brushPatch = new Array<number | undefined>(board.width * board.height).fill(undefined);
  let nextId = 0;

  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const start = y * board.width + x;
      if (brushPatch[start] !== undefined) continue;
      if (terrainAt(board, { x, y }) !== 'brush') continue;

      const id = nextId++;
      brushPatch[start] = id;
      const stack: Vec2[] = [{ x, y }];
      while (stack.length > 0) {
        const cur = stack.pop() as Vec2;
        for (const d of ORTHOGONAL_STEPS) {
          const p: Vec2 = { x: cur.x + d.x, y: cur.y + d.y };
          if (!inBounds(board, p)) continue;
          const i = p.y * board.width + p.x;
          if (brushPatch[i] !== undefined) continue;
          if (terrainAt(board, p) !== 'brush') continue;
          brushPatch[i] = id;
          stack.push(p);
        }
      }
    }
  }

  return { board, brushPatch };
}

/** Patch id of the brush at `p`, or `undefined` if `p` is not brush. */
export function brushPatchAt(vision: Vision, p: Vec2): number | undefined {
  if (!inBounds(vision.board, p)) return undefined;
  return vision.brushPatch[p.y * vision.board.width + p.x];
}

/** True when both squares are brush belonging to the same connected patch. */
export function inSameBrushPatch(vision: Vision, a: Vec2, b: Vec2): boolean {
  const patch = brushPatchAt(vision, a);
  return patch !== undefined && patch === brushPatchAt(vision, b);
}

// ── Concealment ─────────────────────────────────────────────────────────────

/**
 * Adjacency for perception is MANHATTAN-<=1 — the four orthogonal neighbours
 * (MET1, owner directive 2026-08-21). It used to be the eight surrounding
 * squares; under a Manhattan world a diagonal neighbour is distance 2, so
 * standing corner-to-corner with a hidden unit no longer reveals it.
 */
export function isAdjacent(a: Vec2, b: Vec2): boolean {
  return !vecEq(a, b) && distance(a, b) <= 1;
}

/**
 * Is `target` hidden from someone standing at `observerPos`?
 *
 * Concealment is about the target's own state and terrain, not about distance
 * or walls — `canSee` composes the three. Precedence, highest first:
 *
 * 1. **Reveal** beats everything (GAME_SPEC §6: "visible through brush/stealth").
 *    Note that it *masks* Stealth rather than ending it: GAME_SPEC §6 also says
 *    Stealth is "broken by attacking or taking damage", so whichever code
 *    applies those (BACKLOG item 6) must clear the Stealth status itself, not
 *    lean on the Reveal it grants — otherwise a unit that attacks reappears
 *    stealthed the moment Reveal expires. Called out in docs/DECISIONS.md.
 * 2. **Stealth** hides the unit anywhere, including in the open. The brush
 *    adjacency exception does *not* apply to it — GAME_SPEC ties adjacency to
 *    brush specifically, so standing next to a stealthed unit does not find
 *    them. See docs/DECISIONS.md; flagged for playtest.
 * 3. **Brush** hides the unit from observers who are neither in the same
 *    patch nor adjacent.
 */
export function isConcealedFrom(vision: Vision, target: UnitState, observerPos: Vec2): boolean {
  if (hasStatus(target, 'reveal')) return false;
  if (hasStatus(target, 'stealth')) return true;
  // BRUSH-BREAK (Dev Note #19): a unit that was hit while a thicket was hiding
  // it is drawn for the enemy even while it stands in one, for this turn and
  // the next. Below the Stealth check on purpose — brush-break removes one
  // veil, not both, so a unit that has since gone Stealthed is hidden again.
  // Unit-scoped rather than patch-scoped: walking into a *fresh* thicket next
  // turn does not help either, because the marker travels with the unit.
  if (hasStatus(target, 'brushBroken')) return false;
  if (brushPatchAt(vision, target.pos) === undefined) return false;
  if (inSameBrushPatch(vision, observerPos, target.pos)) return false;
  return !isAdjacent(observerPos, target.pos);
}

// ── Visibility ──────────────────────────────────────────────────────────────

/**
 * Can `observer` see `target`?
 *
 * Dead units neither see nor are seen — they are off the board until respawn,
 * the same rule that makes them block nothing during movement.
 *
 * A player always sees their own units, however concealed they are from the
 * enemy: the engine is written for N units per side (GAME_SPEC §1) and a team
 * never loses track of itself.
 */
export function canSee(vision: Vision, observer: UnitState, target: UnitState): boolean {
  if (!observer.alive || !target.alive) return false;
  if (observer.owner === target.owner) return true;
  if (distance(observer.pos, target.pos) > VISION_RANGE) return false; // Manhattan radius (MET1)
  if (!hasLineOfSight(vision.board, observer.pos, target.pos)) return false;
  return !isConcealedFrom(vision, target, observer.pos);
}

/**
 * Enemy units `observer` can currently see, in `state.units` order.
 *
 * This is the filter the server applies before sending state to a client:
 * hidden information stays server-side (CLAUDE.md golden rule #5).
 */
export function visibleEnemies(
  vision: Vision,
  state: GameState,
  observer: UnitState,
): UnitState[] {
  return state.units.filter((u) => u.owner !== observer.owner && canSee(vision, observer, u));
}

// ── Team-shared vision (2v2 default — GAME_SPEC §3) ──────────────────────────

/**
 * Can any living member of `team` see `target`? Vision is shared within a team
 * (GAME_SPEC §3): a square seen by one teammate is seen by all. A team always
 * sees its own units.
 */
export function teamCanSee(vision: Vision, state: GameState, team: TeamId, target: UnitState): boolean {
  if (!target.alive) return false;
  if (target.owner === team) return true;
  return state.units.some((u) => u.alive && u.owner === team && canSee(vision, u, target));
}

/**
 * AOE-LoS — can any living member of `team` see the **square** `at`?
 *
 * `teamCanSee` answers the question for a *unit*, and a unit is more than the
 * tile it stands on: brush and Stealth conceal the occupant without dimming the
 * floor. A square has nothing to hide behind, so this is the same shared-vision
 * rule with the concealment gate removed — range and walls only.
 *
 * It exists because **aiming an area is a question about ground, not about
 * people** (AOE-LoS): a grenade is thrown at a square the team can see, whether
 * or not anybody is standing there and whether or not whoever is has ducked
 * into a thicket. Asking `teamCanSee` of a phantom unit would have imported
 * concealment into that answer and made a lobbed shot refuse the exact tile a
 * hidden enemy is standing on — which is the tile you most want to hit.
 *
 * By construction this is membership of `visibleSquaresForTeam`, which builds
 * the same union eagerly for the fog renderer; `vision.test.ts` pins the two
 * against each other so the aim gate and the fog a player looked at can never
 * drift apart.
 */
export function teamCanSeeSquare(
  vision: Vision,
  state: GameState,
  team: TeamId,
  at: Vec2,
  range: number = VISION_RANGE,
): boolean {
  if (!inBounds(vision.board, at)) return false;
  return state.units.some((u) => u.alive && u.owner === team
    && distance(u.pos, at) <= range
    && hasLineOfSight(vision.board, u.pos, at));
}

/**
 * CHASE-LOS — can any living member of `team` draw a **sightline** to `target`,
 * ignoring how far away it is?
 *
 * `canSee` composes three independent gates: **range** (a 6-tile Manhattan
 * radius), **line of sight** (walls), and **concealment** (brush, Stealth,
 * Reveal). This is the same predicate with the first one removed, and it exists
 * because a chase asks a different question from a fog-of-war render.
 *
 * Owner Dev Note: *"If a character is one tile away, it will only chase 1 tile
 * even if the target sprints 8 tiles away … The chase should get the chasing
 * character AS CLOSE to the target as possible … assuming they have vision of
 * the character. If they lose vision of the chase target, it should get the
 * chasing character as close to the last place the chase target was seen."*
 * "Lose vision" there means the quarry **broke the sightline** — ducked behind a
 * wall, into brush, into Stealth — not that it simply outran an arbitrary
 * radius. A pursuer locked onto something in the open does not stop looking at
 * it because it got seven tiles away.
 *
 * **Only the chase uses this.** `canSee`, `recordLastKnown` and every render
 * path keep the range cap, so the team's persistent memory and the fog a player
 * looks at are untouched: this widens what a pursuit may *follow*, never what a
 * team may *know*.
 */
export function teamHasSightline(vision: Vision, state: GameState, team: TeamId, target: UnitState): boolean {
  if (!target.alive) return false;
  if (target.owner === team) return true;
  return state.units.some((u) => u.alive && u.owner === team
    && hasLineOfSight(vision.board, u.pos, target.pos)
    && !isConcealedFrom(vision, target, u.pos));
}

/** Enemy units the `team` can collectively see, in `state.units` order. */
export function visibleEnemiesForTeam(vision: Vision, state: GameState, team: TeamId): UnitState[] {
  return state.units.filter((u) => u.owner !== team && teamCanSee(vision, state, team, u));
}

/**
 * The union of every living `team` member's field of view — the team's shared
 * fog-of-war, deduplicated, in row-major order. This is what a client renders as
 * "lit" for the whole team (a teammate's position grants vision of its
 * surroundings).
 */
export function visibleSquaresForTeam(
  vision: Vision,
  state: GameState,
  team: TeamId,
  range: number = VISION_RANGE,
): Vec2[] {
  const seen = new Set<string>();
  const out: Vec2[] = [];
  for (const u of state.units) {
    if (!u.alive || u.owner !== team) continue;
    for (const p of visibleSquares(vision.board, u.pos, range)) {
      const k = `${p.x},${p.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

/**
 * Squares within `range` of `from` with a clear line to them, in row-major
 * order. Terrain is included — you can see the wall in front of you.
 *
 * This is the fog-of-war query for rendering; it deliberately says nothing
 * about units, which `canSee` answers per unit.
 */
export function visibleSquares(board: Board, from: Vec2, range: number = VISION_RANGE): Vec2[] {
  const out: Vec2[] = [];
  if (!inBounds(board, from)) return out;
  for (let y = from.y - range; y <= from.y + range; y++) {
    for (let x = from.x - range; x <= from.x + range; x++) {
      const p: Vec2 = { x, y };
      if (!inBounds(board, p)) continue;
      if (distance(from, p) > range) continue; // Manhattan radius (MET1)
      if (!hasLineOfSight(board, from, p)) continue;
      out.push(p);
    }
  }
  return out;
}
