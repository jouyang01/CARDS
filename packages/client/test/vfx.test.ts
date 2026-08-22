import { describe, expect, it } from 'vitest';
import {
  FLASH_SECONDS, HITSTOP_MAX_MS, HITSTOP_MIN_MS, SHAKE_SECONDS,
  hitstopMs, newImpacts, seedOf, shakeAmplitude, shakeOffset,
} from '../src/vfx.js';
import type { Cue } from '../src/choreograph.js';

/**
 * VFX step 1, the pure half. All of this is presentation — nothing here can
 * move the board, which is what keeps skip == watch true.
 */

const impact = (unitId: string, t: number, amount: number): Cue => ({
  kind: 'impact', t, dur: 1, unitId, amount, absorbed: 0,
  sourceUnitId: 'src', abilityId: 'shoot',
});

describe('newImpacts: each hit reacts once, not every frame', () => {
  const cues = [impact('a', 1, 20), impact('b', 1, 5), impact('a', 3, 20)];

  it('reports nothing before the hit is due', () => {
    expect(newImpacts(cues, 0.5, new Set())).toEqual([]);
  });

  it('reports the hits that have landed', () => {
    expect(newImpacts(cues, 1, new Set()).map((h) => h.unitId)).toEqual(['a', 'b']);
  });

  it('and never reports one twice', () => {
    // The bug this prevents is severe rather than cosmetic: an impact cue stays
    // in its window for a whole beat, so reacting to "is an impact showing"
    // would re-freeze playback every frame and hang the turn.
    const fired = new Set(newImpacts(cues, 1, new Set()).map((h) => h.key));
    expect(newImpacts(cues, 1.5, fired)).toEqual([]);
  });

  it('but the same unit hit twice is two hits', () => {
    const fired = new Set(newImpacts(cues, 1, new Set()).map((h) => h.key));
    expect(newImpacts(cues, 3, fired).map((h) => h.unitId)).toEqual(['a']);
  });
});

describe('hitstopMs: harder hits stop harder', () => {
  it('scales with damage, between its two bounds', () => {
    expect(hitstopMs(5)).toBeGreaterThanOrEqual(HITSTOP_MIN_MS);
    expect(hitstopMs(20)).toBeGreaterThan(hitstopMs(5));
    expect(hitstopMs(30)).toBeGreaterThan(hitstopMs(20));
  });

  it('saturates, so one huge number cannot stall the turn', () => {
    expect(hitstopMs(200)).toBe(HITSTOP_MAX_MS);
    expect(hitstopMs(1e9)).toBe(HITSTOP_MAX_MS);
  });

  it('still stops a little for a fully absorbed hit', () => {
    // A shot soaked by a shield is not nothing — it is the shield working.
    expect(hitstopMs(0)).toBe(HITSTOP_MIN_MS);
  });

  it('is short enough that a four-shooter Blast is not a slideshow', () => {
    expect(hitstopMs(30) * 4).toBeLessThan(400);
  });
});

describe('shakeOffset: a rattle that always puts the camera back', () => {
  const seed = seedOf('a@1');

  it('decays to exactly nothing', () => {
    // Not "close to" nothing: the offset is added to the camera target every
    // frame, so anything left over is a permanent drift that accumulates with
    // every hit of the match.
    expect(shakeOffset(seed, SHAKE_SECONDS, SHAKE_SECONDS, 0.09)).toEqual({ x: 0, z: 0 });
    expect(shakeOffset(seed, 5, SHAKE_SECONDS, 0.09)).toEqual({ x: 0, z: 0 });
  });

  it('shrinks as it goes', () => {
    const early = shakeOffset(seed, 0.01, SHAKE_SECONDS, 0.09);
    const late = shakeOffset(seed, 0.11, SHAKE_SECONDS, 0.09);
    expect(Math.abs(late.x) + Math.abs(late.z)).toBeLessThan(Math.abs(early.x) + Math.abs(early.z));
  });

  it('never exceeds the amplitude it was given', () => {
    for (let i = 0; i <= 60; i++) {
      const o = shakeOffset(seed, (SHAKE_SECONDS * i) / 60, SHAKE_SECONDS, 0.09);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(0.09);
      expect(Math.abs(o.z)).toBeLessThanOrEqual(0.09);
    }
  });

  it('is repeatable, so watching a turn twice looks the same', () => {
    // Renderer randomness is legal; UNSEEDED randomness is not. A replay that
    // shakes differently is the same class of lie as one that resolves
    // differently (ART_PIPELINE §13).
    expect(shakeOffset(seed, 0.05, SHAKE_SECONDS, 0.09))
      .toEqual(shakeOffset(seed, 0.05, SHAKE_SECONDS, 0.09));
  });

  it('and differs between hits, so a volley is not one metronome', () => {
    const other = seedOf('b@1');
    expect(seedOf('a@1')).not.toBe(other);
    expect(shakeOffset(seed, 0.05, SHAKE_SECONDS, 0.09))
      .not.toEqual(shakeOffset(other, 0.05, SHAKE_SECONDS, 0.09));
  });

  it('does nothing at all for a zero-amplitude shake', () => {
    expect(shakeOffset(seed, 0.01, SHAKE_SECONDS, 0)).toEqual({ x: 0, z: 0 });
  });
});

describe('shakeAmplitude: a nudge, not an earthquake', () => {
  it('grows with damage and stays small', () => {
    expect(shakeAmplitude(5)).toBeLessThan(shakeAmplitude(30));
    expect(shakeAmplitude(1e9)).toBeLessThan(0.12); // tiles
  });

  it('a hit that did nothing does not move the camera', () => {
    expect(shakeAmplitude(0)).toBe(0);
  });
});

describe('the flash is a flash', () => {
  it('is over in well under a beat, so it reads as an event', () => {
    expect(FLASH_SECONDS).toBeGreaterThan(0.03);
    expect(FLASH_SECONDS).toBeLessThan(0.2);
  });
});
