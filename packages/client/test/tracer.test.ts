import { describe, expect, it } from 'vitest';
import { MUZZLE_TILES, STREAK_HALF_WIDTH, STREAK_TILES, beamQuad, streakQuad, tracerQuads, tracersAt } from '../src/tracer.js';
import type { Cue } from '../src/choreograph.js';
import type { Vec2 } from '@cards/engine';

const BEAT = 1;

const ability = (t: number, unitId: string, abilityId: string): Cue =>
  ({ kind: 'ability', phase: 'blast', t, dur: BEAT, unitId, abilityId, area: [] }) as Cue;

const impact = (t: number, unitId: string, sourceUnitId: string, abilityId: string, amount = 20): Cue =>
  ({ kind: 'impact', t, dur: BEAT, unitId, amount, absorbed: 0, sourceUnitId, abilityId }) as Cue;

const benefit = (t: number, unitId: string, sourceUnitId: string, abilityId: string): Cue =>
  ({ kind: 'benefit', t, dur: BEAT, unitId, amount: 15, benefit: 'shield', sourceUnitId, abilityId }) as Cue;

/** The shape `choreograph` actually produces: cast at t, landing a beat later. */
const shot = (t = 0): Cue[] => [ability(t, 'a', 'shield_bash'), impact(t + BEAT, 'v', 'a', 'shield_bash')];

describe('tracersAt', () => {
  it('TRACER-IN-FLIGHT: a shot is travelling between its cast and its landing', () => {
    const cues = shot();
    const mid = tracersAt(cues, 0.5);
    expect(mid).toHaveLength(1);
    expect(mid[0]!.fromUnitId).toBe('a');
    expect(mid[0]!.toUnitId).toBe('v');
    expect(mid[0]!.progress).toBeCloseTo(0.5, 9);
  });

  it('TRACER-PROGRESS: progress runs 0 to 1 across the window', () => {
    const cues = shot();
    expect(tracersAt(cues, 0.25)[0]!.progress).toBeCloseTo(0.25, 9);
    expect(tracersAt(cues, 0.75)[0]!.progress).toBeCloseTo(0.75, 9);
  });

  it('TRACER-NOT-BEFORE: nothing is in the air at or before the cast', () => {
    const cues = shot();
    expect(tracersAt(cues, 0)).toEqual([]);
    expect(tracersAt(cues, -1)).toEqual([]);
  });

  it('TRACER-NOT-AFTER: the tracer is gone by the landing frame, where the flash takes over', () => {
    const cues = shot();
    expect(tracersAt(cues, BEAT)).toEqual([]);
    expect(tracersAt(cues, BEAT + 0.5)).toEqual([]);
  });

  it('TRACER-NEEDS-A-CAST: damage nobody fired — a trap, chip — flies from nowhere', () => {
    // No `ability` cue: there is no muzzle, so there is nothing to draw a line from.
    expect(tracersAt([impact(1, 'v', 'a', 'spike_trap')], 0.5)).toEqual([]);
  });

  it('TRACER-NOT-SELF: a self-shield does not draw a streak onto its own caster', () => {
    const cues = [ability(0, 'a', 'guard'), benefit(BEAT, 'a', 'a', 'guard')];
    expect(tracersAt(cues, 0.5)).toEqual([]);
  });

  it('TRACER-LATEST-CAST: a second ability leaves from its own cast, not the first', () => {
    // One actor, two abilities in the phase. Matching on the actor alone would
    // date the second shot to the first cast — a tracer that starts before the
    // gun does, and travels for twice as long as the flight it depicts.
    const cues: Cue[] = [
      ability(0, 'a', 'first'),
      impact(1, 'v', 'a', 'first'),
      ability(1, 'a', 'second'),
      impact(2, 'w', 'a', 'second'),
    ];
    const inFlight = tracersAt(cues, 1.5);
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0]!.toUnitId).toBe('w');
    expect(inFlight[0]!.progress).toBeCloseTo(0.5, 9);
  });

  it('TRACER-MANY-VICTIMS: one cast at three targets draws three streaks', () => {
    const cues: Cue[] = [
      ability(0, 'a', 'slam'),
      impact(1, 'v', 'a', 'slam'),
      impact(1, 'w', 'a', 'slam'),
      impact(1, 'x', 'a', 'slam'),
    ];
    expect(tracersAt(cues, 0.5).map((s) => s.toUnitId).sort()).toEqual(['v', 'w', 'x']);
  });

  it('TRACER-KINDS: a heal and a hit are distinguishable', () => {
    const cues: Cue[] = [ability(0, 'a', 'pulse'), impact(1, 'v', 'a', 'pulse'), benefit(1, 'ally', 'a', 'pulse')];
    const kinds = tracersAt(cues, 0.5).map((s) => s.kind).sort();
    expect(kinds).toEqual(['benefit', 'impact']);
  });

  it('TRACER-KEYED: the key is stable and distinguishes victims of one cast', () => {
    const cues: Cue[] = [ability(0, 'a', 'slam'), impact(1, 'v', 'a', 'slam'), impact(1, 'w', 'a', 'slam')];
    const keys = tracersAt(cues, 0.5).map((s) => s.key);
    expect(new Set(keys).size).toBe(2);
    expect(tracersAt(cues, 0.6).map((s) => s.key)).toEqual(keys);
  });

  it('TRACER-ZERO-WINDOW: a landing on its own cast frame has no flight to show', () => {
    const cues: Cue[] = [ability(0, 'a', 'instant'), impact(0, 'v', 'a', 'instant')];
    expect(tracersAt(cues, 0)).toEqual([]);
  });
});

describe('streakQuad', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 10, y: 0 };

  it('STREAK-CLOSED-QUAD: four corners, so `drawShape` gets a polygon', () => {
    expect(streakQuad(from, to, 0.5)).toHaveLength(4);
  });

  it('STREAK-LEADS-AT-PROGRESS: the leading edge sits where the shot has got to', () => {
    // Halfway along the *travel*, which runs muzzle-to-muzzle rather than
    // centre-to-centre.
    const quad = streakQuad(from, to, 0.5);
    expect(Math.max(...quad.map((p) => p.x))).toBeCloseTo(5, 9);
  });

  it('STREAK-IS-A-STREAK: it trails behind the leading edge rather than filling the line', () => {
    const quad = streakQuad(from, to, 1);
    const behind = Math.max(...quad.map((p) => p.x)) - Math.min(...quad.map((p) => p.x));
    expect(behind).toBeCloseTo(STREAK_TILES, 9);
  });

  it('STREAK-LEAVES-THE-MUZZLE: it starts clear of the caster, not inside them', () => {
    // Filmed at MUZZLE_TILES = 0, the streak came out of Aegis's waist and his
    // own legs cut it in half.
    const quad = streakQuad(from, to, 0.01);
    expect(Math.min(...quad.map((p) => p.x))).toBeCloseTo(MUZZLE_TILES, 9);
  });

  it('STREAK-STOPS-SHORT: it does not bury its head in the victim, where the flash lives', () => {
    const quad = streakQuad(from, to, 1);
    expect(Math.max(...quad.map((p) => p.x))).toBeCloseTo(10 - MUZZLE_TILES, 9);
  });

  it('STREAK-TOO-CLOSE: adjacent units leave no room for a flight, so nothing is drawn', () => {
    // A melee swing between neighbouring squares. Whatever happened there, it
    // did not travel, and a streak crammed into the gap reads as a glitch.
    expect(streakQuad({ x: 4, y: 4 }, { x: 4.5, y: 4 }, 0.5)).toEqual([]);
  });

  it('STREAK-WIDTH: thin, and symmetric about the line of travel', () => {
    const quad = streakQuad(from, to, 0.5);
    const ys = quad.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-STREAK_HALF_WIDTH, 9);
    expect(ys[3]).toBeCloseTo(STREAK_HALF_WIDTH, 9);
  });

  it('STREAK-DIAGONAL: the width stays perpendicular on a diagonal shot', () => {
    const quad = streakQuad({ x: 0, y: 0 }, { x: 8, y: 8 }, 1);
    // Every corner is exactly half a width off the y = x line it travels along.
    for (const p of quad) {
      expect(Math.abs(p.x - p.y) / Math.SQRT2).toBeCloseTo(STREAK_HALF_WIDTH, 9);
    }
  });

  it('STREAK-COINCIDENT: two units on one square give nothing, not NaN', () => {
    // A quad needs a direction. Returning a degenerate polygon full of NaN would
    // poison the whole shape layer rather than dropping this one streak.
    expect(streakQuad({ x: 3, y: 3 }, { x: 3, y: 3 }, 0.5)).toEqual([]);
    for (const p of streakQuad(from, to, Number.NaN)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it('STREAK-CLAMPS-PROGRESS: out-of-range progress stays on the segment', () => {
    expect(Math.max(...streakQuad(from, to, 5).map((p) => p.x))).toBeCloseTo(10 - MUZZLE_TILES, 9);
    expect(Math.min(...streakQuad(from, to, -5).map((p) => p.x))).toBeCloseTo(MUZZLE_TILES, 9);
  });
});

describe('beamQuad', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 10, y: 0 };

  it('BEAM-FULL-LENGTH: it spans the whole flight, not a trailing streak', () => {
    // A laser is the whole line at once. muzzle-to-(distance-muzzle), so it is
    // far longer than a STREAK_TILES segment.
    const quad = beamQuad(from, to, 0.2);
    const span = Math.max(...quad.map((p) => p.x)) - Math.min(...quad.map((p) => p.x));
    expect(span).toBeCloseTo(10 - MUZZLE_TILES * 2, 9);
    expect(span).toBeGreaterThan(STREAK_TILES);
  });

  it('BEAM-LEAVES-AND-STOPS: clear of the muzzle, short of the victim', () => {
    const quad = beamQuad(from, to, 0.2);
    expect(Math.min(...quad.map((p) => p.x))).toBeCloseTo(MUZZLE_TILES, 9);
    expect(Math.max(...quad.map((p) => p.x))).toBeCloseTo(10 - MUZZLE_TILES, 9);
  });

  it('BEAM-WIDTH: as wide as it is told to be, symmetric about the line', () => {
    const quad = beamQuad(from, to, 0.34);
    const ys = quad.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-0.34, 9);
    expect(ys[3]).toBeCloseTo(0.34, 9);
  });

  it('BEAM-TOO-CLOSE: adjacent units leave no room for a beam either', () => {
    expect(beamQuad({ x: 4, y: 4 }, { x: 4.5, y: 4 }, 0.2)).toEqual([]);
  });

  it('BEAM-NO-WIDTH: a zero or negative width draws nothing, not a line', () => {
    expect(beamQuad(from, to, 0)).toEqual([]);
    expect(beamQuad(from, to, -0.2)).toEqual([]);
  });

  it('BEAM-COINCIDENT: two units on one square give nothing, not NaN', () => {
    expect(beamQuad({ x: 3, y: 3 }, { x: 3, y: 3 }, 0.2)).toEqual([]);
  });
});

describe('tracerQuads', () => {
  const at = (positions: Record<string, Vec2>) => (id: string): Vec2 | undefined => positions[id];

  it('QUADS-DRAWN: an in-flight shot between two located units yields one quad', () => {
    const quads = tracerQuads(shot(), 0.5, at({ a: { x: 0, y: 0 }, v: { x: 6, y: 0 } }));
    expect(quads).toHaveLength(1);
    expect(quads[0]).toHaveLength(4);
  });

  it('QUADS-NEED-BOTH-ENDS: a unit that cannot be located drops its streak, not the frame', () => {
    expect(tracerQuads(shot(), 0.5, at({ a: { x: 0, y: 0 } }))).toEqual([]);
    expect(tracerQuads(shot(), 0.5, at({ v: { x: 6, y: 0 } }))).toEqual([]);
  });

  it('QUADS-EMPTY-OUT-OF-WINDOW: nothing to draw before the cast or after the landing', () => {
    const positions = at({ a: { x: 0, y: 0 }, v: { x: 6, y: 0 } });
    expect(tracerQuads(shot(), 0, positions)).toEqual([]);
    expect(tracerQuads(shot(), BEAT, positions)).toEqual([]);
  });

  it('QUADS-STACKED-UNITS: two units on one square contribute no quad', () => {
    expect(tracerQuads(shot(), 0.5, at({ a: { x: 4, y: 4 }, v: { x: 4, y: 4 } }))).toEqual([]);
  });

  it('QUADS-MELEE: neighbours produce no tracer, because nothing crossed a gap', () => {
    expect(tracerQuads(shot(), 0.5, at({ a: { x: 4, y: 4 }, v: { x: 5, y: 4 } }))).toEqual([]);
  });
});
