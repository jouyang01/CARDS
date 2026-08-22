/**
 * Which way a character is looking — presentation only, like clip selection.
 *
 * The engine has no facing and must not grow one: it would be state that
 * changes outcomes, and nothing in `GAME_SPEC.md` turns on where a unit's nose
 * points. Cover, line of sight and cone coverage are all computed from squares.
 * So facing is derived here, from the same cue timeline the animations read,
 * and a client that got it wrong would look silly without desyncing.
 *
 * Directions are **board-space deltas**, not angles: the renderer owns the
 * conversion, because which way the mesh faces at rest is a property of the
 * asset (Blender's front is -Y, which `export_yup` turns into +Z, which is
 * board +y) rather than of the game.
 */

import type { Vec2 } from '@cards/engine';
import type { Cue } from './choreograph.js';

/** A board-space direction. Not normalised — the renderer only needs the angle. */
export interface Facing {
  x: number;
  y: number;
}

const centroid = (squares: readonly Vec2[]): Vec2 | undefined => {
  if (squares.length === 0) return undefined;
  let x = 0;
  let y = 0;
  for (const s of squares) {
    x += s.x;
    y += s.y;
  }
  return { x: x / squares.length, y: y / squares.length };
};

const delta = (from: Vec2, to: Vec2): Facing | undefined => {
  const f = { x: to.x - from.x, y: to.y - from.y };
  // A zero delta carries no direction. Returning it would snap the unit to
  // whatever atan2(0, 0) happens to be — which is 0, i.e. due south.
  return f.x === 0 && f.y === 0 ? undefined : f;
};

/**
 * Where `unitId` should be looking at time `t`, or undefined to keep facing.
 *
 * "Keep facing" is the common answer and deliberately so: a unit that has done
 * nothing this turn should not swing back to a default, and one that has just
 * finished a shot should still be looking down the barrel while the smoke
 * clears. The caller holds the last direction; this only reports changes.
 *
 * The LATEST qualifying cue at or before `t` wins, so a unit that shoots and
 * then walks ends the turn looking where it walked.
 */
export function selectFacing(
  cues: readonly Cue[],
  t: number,
  unitId: string,
  posOf: (unitId: string) => Vec2 | undefined,
): Facing | undefined {
  let best: { t: number; facing: Facing } | undefined;
  const offer = (cueT: number, facing: Facing | undefined): void => {
    if (facing === undefined) return;
    // `>=` so a later cue at the same instant wins: within one beat the array
    // order is the order things happen, and the last word should be the pose.
    if (best === undefined || cueT >= best.t) best = { t: cueT, facing };
  };

  for (const cue of cues) {
    if (cue.t > t) continue;
    if (cue.kind === 'move' && cue.unitId === unitId) {
      offer(cue.t, delta(cue.from, cue.to));
    } else if (cue.kind === 'ability' && cue.unitId === unitId) {
      // Face what the ability is aimed at. A self-cast has no meaningful
      // direction and its area is centred on the caster, so `delta` drops it.
      const aim = centroid(cue.area);
      const from = posOf(unitId);
      if (aim !== undefined && from !== undefined) offer(cue.t, delta(from, aim));
    }
    // Deliberately NOT displace: a unit that is knocked back is not choosing to
    // look anywhere, and spinning it to face its own flight path reads as if it
    // meant to go.
  }
  return best?.facing;
}

/**
 * The direction each unit looks at the opening, before anything has happened.
 *
 * Toward the enemy team's centre of mass, which is what a player would draw:
 * spawns face across the board, and on a map that spawns teams along `y` it
 * still comes out right — the alternative, a fixed "team 0 looks east", is
 * wrong the first time somebody builds a north/south map.
 */
export function openingFacings(
  units: readonly { unitId: string; owner: 0 | 1; pos: Vec2 }[],
): Map<string, Facing> {
  const out = new Map<string, Facing>();
  for (const owner of [0, 1] as const) {
    const foes = centroid(units.filter((u) => u.owner !== owner).map((u) => u.pos));
    if (foes === undefined) continue;
    for (const u of units.filter((u) => u.owner === owner)) {
      const f = delta(u.pos, foes);
      if (f !== undefined) out.set(u.unitId, f);
    }
  }
  return out;
}
