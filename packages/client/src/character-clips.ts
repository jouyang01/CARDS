/**
 * `selectClip()` — the pure half of Phase 8: given the cue timeline and a time,
 * say which animation a unit should be playing right now.
 *
 * **Pure**: no DOM, no Three.js, no wall clock. Same contract as `animate.ts` —
 * the renderer is a dumb applier that takes the answer and pushes it into an
 * `AnimationMixer`. That is what keeps clip selection unit-testable even though
 * the animation itself is not, and it is why this does NOT live inside
 * `sampleFrame()`: a `Frame` carries board presentation, and adding animation
 * state to it would widen a contract whose narrowness is load-bearing.
 *
 * Nothing here can move the board. Dropping every call changes only what the
 * character looks like, never where it stands — so **skip == watch** survives
 * by construction.
 */

import type { Cue } from './choreograph.js';

/** Which animation a unit plays, and how. */
export interface ClipChoice {
  /** Clip name as it appears in the .glb, e.g. `sword_and_shield_run`. */
  clip: string;
  /** Loop forever (idle, run) or play once and hold the last frame (death). */
  loop: boolean;
  /** Beats since the clip's trigger, so the renderer can seek rather than restart. */
  since: number;
  /**
   * Strides in one cycle of this clip, for locomotion only.
   *
   * Present means "this clip's feet are on the ground and must keep up with the
   * board": the renderer time-scales it so a cycle covers exactly this many
   * tiles. Absent means play at the authored rate — a cast or a death has no
   * ground speed to match.
   */
  stride?: number;
}

/**
 * Strides in a Mixamo locomotion cycle: left foot, right foot.
 *
 * The default rather than a constant, because a clip from somewhere else may be
 * a single-stride cycle — `stridesPerCycle` in the art data overrides it.
 */
export const STRIDES_PER_CYCLE = 2;

/**
 * The clip names a character's `.glb` actually contains, from
 * `data/art/<id>.json`. Names are per character — Aegis's attack is
 * `aegis_smash`, not a generic `attack` — so the mapping is data, not code.
 */
export interface ClipSet {
  idle: string;
  /** One locomotion clip. The engine gives every move step the same duration,
   *  so there is exactly one ground speed and a second clip would foot-slide. */
  run: string;
  hit: string;
  death: string;
  knockback: string;
  /** abilityId → clip. Missing ids fall back to `idle`. */
  abilities: Readonly<Record<string, string>>;
  /** Strides in one cycle of `run`. Defaults to `STRIDES_PER_CYCLE`. */
  stridesPerCycle?: number;
}

/** Does this cue concern this unit, and is `t` inside it? */
const active = (cue: Cue, t: number, unitId: string): boolean => {
  if (!('unitId' in cue) || cue.unitId !== unitId) return false;
  return t >= cue.t && t < cue.t + cue.dur;
};

/**
 * What `unitId` should be playing at time `t`.
 *
 * Priority is the whole design, and it is deliberately NOT "most recent wins".
 * A unit hit during its own move must show the hit; a unit that dies mid-anything
 * must show the death. So the order is by narrative weight, not by cue order:
 *
 *   death > knockback > impact > ability > movement > idle
 *
 * Death is checked against every death cue at or before `t` rather than only
 * active ones, because a corpse stays a corpse after its one-beat cue ends.
 */
export function selectClip(
  cues: readonly Cue[],
  t: number,
  unitId: string,
  clips: ClipSet,
): ClipChoice {
  // Death holds past its own cue. A respawn after it returns the unit to idle,
  // so the latest of the two wins.
  let deadAt: number | undefined;
  let respawnAt: number | undefined;
  for (const cue of cues) {
    if (cue.t > t) continue;
    if (cue.kind === 'death' && cue.unitId === unitId) {
      deadAt = deadAt === undefined ? cue.t : Math.max(deadAt, cue.t);
    }
    if (cue.kind === 'respawn' && cue.unitId === unitId) {
      respawnAt = respawnAt === undefined ? cue.t : Math.max(respawnAt, cue.t);
    }
  }
  if (deadAt !== undefined && (respawnAt === undefined || respawnAt < deadAt)) {
    return { clip: clips.death, loop: false, since: t - deadAt };
  }

  for (const cue of cues) {
    if (cue.kind === 'displace' && active(cue, t, unitId)) {
      return { clip: clips.knockback, loop: false, since: t - cue.t };
    }
  }
  for (const cue of cues) {
    if (cue.kind === 'impact' && active(cue, t, unitId)) {
      return { clip: clips.hit, loop: false, since: t - cue.t };
    }
  }
  for (const cue of cues) {
    if (cue.kind === 'ability' && active(cue, t, unitId)) {
      return {
        clip: clips.abilities[cue.abilityId] ?? clips.idle,
        loop: false,
        since: t - cue.t,
      };
    }
  }
  for (const cue of cues) {
    if (cue.kind === 'move' && active(cue, t, unitId)) {
      // Loops: a multi-square move is several consecutive `move` cues, and
      // restarting the run on each step would produce a visible hitch per tile.
      // `stride` is what stops him sprinting on the spot. The engine gives one
      // tile per beat; the clip runs at whatever rate it was authored at, and
      // those two have no reason to agree — Aegis's 0.733s cycle against a
      // 0.76s beat came out at 2.07 steps per tile, a frantic little shuffle.
      return {
        clip: clips.run,
        loop: true,
        since: t - cue.t,
        stride: clips.stridesPerCycle ?? STRIDES_PER_CYCLE,
      };
    }
  }
  return { clip: clips.idle, loop: true, since: 0 };
}

/**
 * Playback rate that makes a locomotion clip's stride match the ground.
 *
 * The engine moves a unit one square per beat, always. A clip authored at some
 * other speed will foot-slide unless it is time-scaled to match — subtly wrong
 * forever, and hard to attribute after the fact.
 *
 * `clipSeconds` is the clip's own duration; `stridesPerCycle` how many squares
 * one loop of it would cover on the ground it was authored for (a run cycle is
 * two steps, so 2). `beatSeconds` is how long the engine gives one square.
 */
export function strideTimeScale(
  clipSeconds: number,
  stridesPerCycle: number,
  beatSeconds: number,
): number {
  if (clipSeconds <= 0 || stridesPerCycle <= 0 || beatSeconds <= 0) return 1;
  // One cycle must take exactly `stridesPerCycle` beats of ground time.
  return clipSeconds / (stridesPerCycle * beatSeconds);
}
