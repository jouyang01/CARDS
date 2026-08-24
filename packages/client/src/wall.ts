/**
 * WARDING WALL — a barrier that actually stands on the board.
 *
 * A wall was drawn like every other trap: flat markers on four squares, which
 * says "these tiles are dangerous" and not "there is a thing here". What Aegis
 * raises is a *barrier*, and a barrier is vertical. It has to be see-through,
 * because the board behind it is information the player needs and a solid slab
 * would hide a unit; and it is walked through rather than around, because that
 * is what the ability is — anyone who charges through takes 25 and is Slowed.
 * The wall stops nobody. It taxes them.
 *
 * Two sources, because they cover different windows and neither covers both:
 *
 *  - **While it is cast**, from the `ability` cue's own `area`. The squares are
 *    right there on the cue, and this is the moment the wall goes up.
 *  - **Once it is standing**, from the traps on the board. `TrapState` carries
 *    the `abilityId` that laid it, so a wall's tiles are identifiable — but only
 *    in a view built from a state snapshot. The `trapPlaced` event does not
 *    carry it, which is why the first source exists at all.
 *
 * Geometry only, in fractional board coordinates, like `tracer.ts` and
 * `ability-vfx.ts`. The renderer raises the panel; every decision about where
 * it stands is arithmetic a Node test can check.
 */

import type { Cue } from './choreograph.js';
import type { Vec2 } from '@cards/engine';

/** One standing panel: a segment on the floor, raised into a vertical face. */
export interface WallPanel {
  /** Endpoints of the panel's footprint, in fractional board coordinates. */
  from: Vec2;
  to: Vec2;
}

/** The ability whose traps are a barrier rather than a minefield. */
export const WALL_ABILITY = 'warding_wall';

const key = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * Order a set of squares into a run, and return the line through them.
 *
 * A Warding Wall is a straight four-tile barrier, so its squares are collinear
 * and contiguous — but they arrive as an unordered set, and drawing a panel
 * between them in arbitrary order would zigzag. Sorting along the run's own axis
 * puts them back in order whichever way the wall was turned.
 *
 * The panel runs from the OUTER edge of the first square to the outer edge of
 * the last, not centre to centre: a wall covering four tiles blocks all four,
 * and a face that stops at the middle of the end squares leaves half a tile of
 * gap at each end that the player would reasonably read as a way past.
 */
export function panelThrough(squares: readonly Vec2[]): WallPanel | undefined {
  if (squares.length === 0) return undefined;
  const xs = squares.map((s) => s.x);
  const ys = squares.map((s) => s.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  if (squares.length === 1) {
    // A one-tile wall still has a facing to pick. Along x is the arbitrary but
    // stable choice; nothing in the kit produces one today.
    const only = squares[0]!;
    return { from: { x: only.x - 0.5, y: only.y }, to: { x: only.x + 0.5, y: only.y } };
  }
  const alongX = spanX >= spanY;
  const sorted = [...squares].sort((a, b) => (alongX ? a.x - b.x : a.y - b.y));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return alongX
    ? { from: { x: first.x - 0.5, y: first.y }, to: { x: last.x + 0.5, y: last.y } }
    : { from: { x: first.x, y: first.y - 0.5 }, to: { x: last.x, y: last.y + 0.5 } };
}

/**
 * Split squares into contiguous runs before making panels of them.
 *
 * Two walls can stand at once — the same Aegis on consecutive turns, or two of
 * him in 4v4 — and treating every wall tile on the board as one set would draw a
 * single panel stretching between them, straight through whatever is in the way.
 * Neighbours here means orthogonally touching, which is what a wall is made of.
 */
export function runsOf(squares: readonly Vec2[]): Vec2[][] {
  const remaining = new Map(squares.map((s) => [key(s), s]));
  const runs: Vec2[][] = [];
  while (remaining.size > 0) {
    const [firstKey, start] = [...remaining.entries()][0]!;
    remaining.delete(firstKey);
    const run = [start];
    const queue = [start];
    while (queue.length > 0) {
      const at = queue.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = `${at.x + dx},${at.y + dy}`;
        const next = remaining.get(nk);
        if (next === undefined) continue;
        remaining.delete(nk);
        run.push(next);
        queue.push(next);
      }
    }
    runs.push(run);
  }
  return runs;
}

/** Panels for a set of wall squares, one per contiguous run. */
export function panelsFor(squares: readonly Vec2[]): WallPanel[] {
  const out: WallPanel[] = [];
  for (const run of runsOf(squares)) {
    const panel = panelThrough(run);
    if (panel !== undefined) out.push(panel);
  }
  return out;
}

/** A trap as presentation sees it — only the parts a wall cares about. */
export interface WallTrap {
  pos: Vec2;
  abilityId?: string;
}

/** Panels for every Warding Wall standing on the board right now. */
export function panelsFromTraps(traps: readonly WallTrap[]): WallPanel[] {
  return panelsFor(traps.filter((t) => t.abilityId === WALL_ABILITY).map((t) => t.pos));
}

/**
 * Panels for a wall being cast at `t`.
 *
 * Alive for the length of the cue rather than a moment, so the barrier is up
 * for the whole beat that raises it and hands over to the trap-driven panels
 * once the turn's state carries them.
 */
export function panelsFromCues(cues: readonly Cue[], t: number): WallPanel[] {
  const squares: Vec2[] = [];
  for (const cue of cues) {
    if (cue.kind !== 'ability' || cue.abilityId !== WALL_ABILITY) continue;
    if (t < cue.t) continue;
    squares.push(...cue.area);
  }
  return panelsFor(squares);
}
