/**
 * VFX — the pure half. What a hit does to the picture, as arithmetic.
 *
 * Mixamo supplies the gesture and nothing that leaves the body, so all of this
 * is code (ART_PIPELINE §13). It is also entirely presentation: none of it can
 * move the board, which is what keeps **skip == watch** true — a skipped turn
 * and a watched one differ in what you saw, never in where anything ended up.
 *
 * Kept pure and separate from the renderer for the usual reason in this
 * codebase: the decisions are testable without a WebGL context, and the wiring
 * that carries them is then the only thing that can be missing.
 */

import type { Cue } from './choreograph.js';

/** A hit that has just landed and has not been reacted to yet. */
export interface Landing {
  /** Stable identity for one impact cue, so it fires exactly once. */
  key: string;
  unitId: string;
  amount: number;
}

/**
 * Impacts that have become due at `t` and are not in `fired` yet.
 *
 * Keyed by unit and cue time rather than counted, because an impact cue stays
 * inside its window for a whole beat — reacting to "is an impact showing" would
 * re-trigger every frame and freeze playback permanently.
 */
export function newImpacts(cues: readonly Cue[], t: number, fired: ReadonlySet<string>): Landing[] {
  const out: Landing[] = [];
  for (const cue of cues) {
    if (cue.kind !== 'impact' || cue.t > t) continue;
    const key = `${cue.unitId}@${cue.t}`;
    if (fired.has(key)) continue;
    out.push({ key, unitId: cue.unitId, amount: cue.amount });
  }
  return out;
}

/** Damage that reads as "a solid hit" — the top of the scale, not the maximum. */
const REFERENCE_HIT = 30;
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
/** How hard this hit landed, 0..1, saturating so a 200 does not break the scale. */
const weight = (amount: number): number => clamp01(amount / REFERENCE_HIT);

export const HITSTOP_MIN_MS = 35;
export const HITSTOP_MAX_MS = 85;

/**
 * How long playback freezes on a hit.
 *
 * The single cheapest thing that sells an impact: the eye reads the pause as
 * force. Two to three frames at 60fps for a graze, closer to five for a heavy
 * hit — long enough to feel, short enough that a four-shooter Blast does not
 * turn into a slideshow.
 *
 * A zero-damage event still stops a little. A shot that is fully absorbed by a
 * shield is not nothing; it is the shield doing its job, and it should land.
 */
export function hitstopMs(amount: number): number {
  return Math.round(HITSTOP_MIN_MS + (HITSTOP_MAX_MS - HITSTOP_MIN_MS) * weight(amount));
}

/**
 * Seconds the victim stays lit. Constant: a flash is a flash — it says "this
 * unit is the one that got hit", and that sentence is the same length whoever
 * threw the punch.
 *
 * Raised from 0.08s on the owner's read of it in the running game: five frames
 * at 60fps is long enough to register only if you already know to look, and the
 * whole job of the flash is to catch an eye that is somewhere else on the board.
 * At 0.18s it is ~11 frames — still an event rather than a glow, and still well
 * inside a beat, so a four-shooter Blast reads as four distinct hits.
 */
export const FLASH_SECONDS = 0.18;

export const SHAKE_SECONDS = 0.12;
/** Peak camera displacement for a reference hit, in world units (tiles). */
const SHAKE_MAX_TILES = 0.09;

/** Peak shake for a hit, in tiles. Small on purpose — a nudge, not an earthquake. */
export function shakeAmplitude(amount: number): number {
  return SHAKE_MAX_TILES * weight(amount);
}

/**
 * A deterministic seed from a cue's identity.
 *
 * Golden rule #1 permits renderer randomness, but unseeded randomness would
 * make a replayed turn shake differently every time — and a turn that looks
 * different on every watch is the same class of lie as one that resolves
 * differently. FNV-1a over the key: cheap, and stable across machines.
 */
export function seedOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** One deterministic value in [-1, 1] from a seed and a step. */
const noise = (seed: number, step: number): number => {
  let h = (seed ^ Math.imul(step + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x7fffffff - 1;
};

/**
 * Where the camera sits at `elapsed` into a shake, relative to where it would
 * otherwise be. Decays linearly to nothing, so the camera always lands back
 * exactly where the auto-camera put it rather than drifting.
 */
export function shakeOffset(
  seed: number, elapsed: number, duration: number, amplitude: number,
): { x: number; z: number } {
  if (elapsed >= duration || duration <= 0 || amplitude <= 0) return { x: 0, z: 0 };
  const remaining = 1 - elapsed / duration;
  // Step the noise so the camera jitters rather than sliding: ~60Hz of distinct
  // offsets, which reads as a rattle at any frame rate.
  const step = Math.floor(elapsed * 60);
  return {
    x: noise(seed, step) * amplitude * remaining,
    z: noise(seed, step + 977) * amplitude * remaining,
  };
}
