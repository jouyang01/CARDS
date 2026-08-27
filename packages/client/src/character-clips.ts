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
  /** WALKED-DASH: time-scale the clip to fill this many beats (a combat roll fits
   *  its whole traversal, so it completes exactly on arrival). Absent = authored rate. */
  fitBeats?: number;
}

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
    // A delayed detonation (a frag grenade going off a turn after the throw)
    // lights its area and plays its blast VFX from this same cue, but the caster
    // must NOT replay the throw — they threw it last turn. Skipping it here drops
    // the caster through to whatever they are actually doing now (a move, or idle).
    if (cue.kind === 'ability' && cue.delayed !== true && active(cue, t, unitId)) {
      return {
        clip: clips.abilities[cue.abilityId] ?? clips.idle,
        loop: false,
        since: t - cue.t,
        // WALKED-DASH: a stretched cue (a combat roll) fits its clip to the whole
        // traversal so it plays the entire way and finishes on arrival.
        ...(cue.stretch === true ? { fitBeats: cue.dur } : {}),
      };
    }
  }
  for (const cue of cues) {
    if (cue.kind === 'move' && active(cue, t, unitId)) {
      // Loops: a multi-square move is several consecutive `move` cues, and
      // restarting the run on each step would produce a visible hitch per tile.
      return { clip: clips.run, loop: true, since: t - cue.t };
    }
  }
  return { clip: clips.idle, loop: true, since: 0 };
}
