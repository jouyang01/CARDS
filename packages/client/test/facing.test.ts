import { describe, expect, it } from 'vitest';
import { openingFacings, selectFacing } from '../src/facing.js';
import type { Cue } from '../src/choreograph.js';
import type { Vec2 } from '@cards/engine';

/**
 * FACING — which way a character looks, derived rather than stored.
 *
 * The engine has no facing and must not grow one: nothing in the ruleset turns
 * on where a unit's nose points (cover, sight and cone coverage are all square
 * arithmetic), so a facing field would be state that cannot change an outcome —
 * dead weight in a structure whose whole contract is that it determines them.
 * It is derived here from the same cue timeline the animations read, which is
 * also why a client that got it wrong would look silly without desyncing.
 */

const BEAT = 1;
const at = (t: number): { t: number; dur: number } => ({ t, dur: BEAT });
const pos = (units: Record<string, Vec2>) => (id: string): Vec2 | undefined => units[id];

describe('selectFacing', () => {
  const posOf = pos({ a: { x: 5, y: 5 }, b: { x: 9, y: 5 } });

  it('keeps facing when the unit does nothing', () => {
    expect(selectFacing([], 3, 'a', posOf)).toBeUndefined();
  });

  it('looks where it walks', () => {
    const cues: Cue[] = [{ ...at(1), kind: 'move', unitId: 'a', from: { x: 5, y: 5 }, to: { x: 6, y: 5 } }];
    expect(selectFacing(cues, 2, 'a', posOf)).toEqual({ x: 1, y: 0 });
  });

  it('does not turn before the cue is due', () => {
    const cues: Cue[] = [{ ...at(4), kind: 'move', unitId: 'a', from: { x: 5, y: 5 }, to: { x: 6, y: 5 } }];
    expect(selectFacing(cues, 2, 'a', posOf), 'still one beat away').toBeUndefined();
  });

  it('looks at what it aims at', () => {
    const cues: Cue[] = [{
      ...at(1), kind: 'ability', phase: 'blast', unitId: 'a', abilityId: 'shield_bash',
      area: [{ x: 5, y: 8 }, { x: 5, y: 10 }],
    }];
    // Centroid of the area is (5,9); the caster is at (5,5).
    expect(selectFacing(cues, 2, 'a', posOf)).toEqual({ x: 0, y: 4 });
  });

  it('ignores a self-cast, which has no direction to give', () => {
    const cues: Cue[] = [{
      ...at(1), kind: 'ability', phase: 'prep', unitId: 'a', abilityId: 'second_wind',
      area: [{ x: 5, y: 5 }],
    }];
    expect(selectFacing(cues, 2, 'a', posOf)).toBeUndefined();
  });

  it('ends the turn looking where it last acted', () => {
    // Shoot, then walk somewhere else: the walk is the last word.
    const cues: Cue[] = [
      { ...at(1), kind: 'ability', phase: 'blast', unitId: 'a', abilityId: 'x', area: [{ x: 9, y: 5 }] },
      { ...at(3), kind: 'move', unitId: 'a', from: { x: 5, y: 5 }, to: { x: 5, y: 2 } },
    ];
    expect(selectFacing(cues, 1.5, 'a', posOf), 'mid-shot, down the barrel').toEqual({ x: 4, y: 0 });
    expect(selectFacing(cues, 4, 'a', posOf), 'and then where it walked').toEqual({ x: 0, y: -3 });
  });

  it('does not turn a unit that is being knocked around', () => {
    // Displacement is not a choice, and spinning to face the flight path reads
    // as if the victim meant to go there.
    const cues: Cue[] = [{
      ...at(1), kind: 'displace', unitId: 'a', from: { x: 5, y: 5 }, to: { x: 5, y: 8 },
      displaceKind: 'knockback',
    }];
    expect(selectFacing(cues, 2, 'a', posOf)).toBeUndefined();
  });

  it('minds its own business — one unit does not turn for another', () => {
    const cues: Cue[] = [{ ...at(1), kind: 'move', unitId: 'b', from: { x: 9, y: 5 }, to: { x: 8, y: 5 } }];
    expect(selectFacing(cues, 2, 'a', posOf)).toBeUndefined();
  });
});

describe('openingFacings', () => {
  it('faces the enemy across the board', () => {
    const f = openingFacings([
      { unitId: 'a', owner: 0, pos: { x: 2, y: 5 } },
      { unitId: 'b', owner: 1, pos: { x: 12, y: 5 } },
    ]);
    expect(f.get('a')).toEqual({ x: 10, y: 0 });
    expect(f.get('b')).toEqual({ x: -10, y: 0 });
  });

  it('works on a north/south map too, which a fixed default would not', () => {
    const f = openingFacings([
      { unitId: 'a', owner: 0, pos: { x: 5, y: 1 } },
      { unitId: 'b', owner: 1, pos: { x: 5, y: 14 } },
    ]);
    expect(f.get('a')!.y).toBeGreaterThan(0);
    expect(f.get('b')!.y).toBeLessThan(0);
  });

  it('aims at the enemy centre of mass, not at one of them', () => {
    const f = openingFacings([
      { unitId: 'a', owner: 0, pos: { x: 0, y: 4 } },
      { unitId: 'x', owner: 1, pos: { x: 8, y: 0 } },
      { unitId: 'y', owner: 1, pos: { x: 8, y: 8 } },
    ]);
    expect(f.get('a'), 'straight down the middle').toEqual({ x: 8, y: 0 });
  });

  it('says nothing about a team with nobody to face', () => {
    expect(openingFacings([{ unitId: 'a', owner: 0, pos: { x: 1, y: 1 } }]).size).toBe(0);
  });
});
