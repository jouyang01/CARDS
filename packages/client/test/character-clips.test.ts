import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { BEAT, type Cue } from '../src/choreograph.js';
import { selectClip, strideTimeScale, type ClipSet } from '../src/character-clips.js';

/**
 * Clip selection is pure, so it is tested the same way `sampleFrame` is: by
 * ORDERING and PRIORITY, never by absolute times.
 *
 * The invariant worth stating out loud: nothing here can move the board. These
 * assertions are about what a character LOOKS like, never where it stands, which
 * is why clip selection cannot break **skip == watch**.
 */

const CLIPS: ClipSet = {
  idle: 'aegis_idle',
  run: 'sword_and_shield_run',
  hit: 'sword_and_shield_impact',
  death: 'sword_and_shield_death',
  knockback: 'knocked_down',
  abilities: { shield_bash: 'aegis_smash', barrier_pulse: 'warding_wall_cast' },
};

const move = (t: number, unitId = 'a'): Cue =>
  ({ kind: 'move', t, dur: BEAT, unitId, from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }) as Cue;
const impact = (t: number, unitId = 'a'): Cue =>
  ({ kind: 'impact', t, dur: BEAT, unitId, amount: 10, absorbed: 0,
     sourceUnitId: 'b', abilityId: 'shield_bash' }) as Cue;
const ability = (t: number, abilityId: string, unitId = 'a'): Cue =>
  ({ kind: 'ability', t, dur: BEAT, phase: 'blast', unitId, abilityId, area: [] }) as Cue;
const death = (t: number, unitId = 'a'): Cue => ({ kind: 'death', t, dur: BEAT, unitId }) as Cue;
const respawn = (t: number, unitId = 'a'): Cue =>
  ({ kind: 'respawn', t, dur: BEAT, unitId, at: { x: 0, y: 0 } }) as Cue;
const displace = (t: number, unitId = 'a'): Cue =>
  ({ kind: 'displace', t, dur: BEAT, unitId, from: { x: 0, y: 0 }, to: { x: 2, y: 0 },
     displaceKind: 'knockback' }) as Cue;

describe('selectClip', () => {
  it('idles when nothing is happening', () => {
    expect(selectClip([], 0, 'a', CLIPS)).toMatchObject({ clip: 'aegis_idle', loop: true });
  });

  it('runs while moving, and loops so a multi-square move does not hitch', () => {
    const cues = [move(0), move(BEAT), move(BEAT * 2)];
    for (const t of [0.1, BEAT + 0.1, BEAT * 2 + 0.1]) {
      expect(selectClip(cues, t, 'a', CLIPS)).toMatchObject({
        clip: 'sword_and_shield_run',
        loop: true,
      });
    }
  });

  it('plays the ability clip named for that ability, not a generic attack', () => {
    expect(selectClip([ability(0, 'shield_bash')], 0.1, 'a', CLIPS).clip).toBe('aegis_smash');
    expect(selectClip([ability(0, 'barrier_pulse')], 0.1, 'a', CLIPS).clip)
      .toBe('warding_wall_cast');
  });

  it('falls back to idle for an ability with no clip mapped', () => {
    expect(selectClip([ability(0, 'not_in_the_glb')], 0.1, 'a', CLIPS).clip).toBe('aegis_idle');
  });

  // ── priority: the whole design ──────────────────────────────────────────
  it('shows the hit, not the move, when a unit is struck mid-move', () => {
    const cues = [move(0), impact(0)];
    expect(selectClip(cues, 0.1, 'a', CLIPS).clip).toBe('sword_and_shield_impact');
  });

  it('shows knockback over a plain impact', () => {
    const cues = [impact(0), displace(0)];
    expect(selectClip(cues, 0.1, 'a', CLIPS).clip).toBe('knocked_down');
  });

  it('death beats everything else happening in the same beat', () => {
    const cues = [move(0), impact(0), displace(0), ability(0, 'shield_bash'), death(0)];
    expect(selectClip(cues, 0.1, 'a', CLIPS).clip).toBe('sword_and_shield_death');
  });

  it('holds the death clip long after its cue has ended', () => {
    const cues = [death(0)];
    const late = selectClip(cues, BEAT * 40, 'a', CLIPS);
    expect(late).toMatchObject({ clip: 'sword_and_shield_death', loop: false });
    expect(late.since).toBeGreaterThan(BEAT * 39);
  });

  it('does not loop the death clip — a corpse must not stand back up', () => {
    expect(selectClip([death(0)], BEAT * 5, 'a', CLIPS).loop).toBe(false);
  });

  it('returns to idle after a respawn that follows the death', () => {
    const cues = [death(0), respawn(BEAT * 2)];
    expect(selectClip(cues, BEAT * 3, 'a', CLIPS).clip).toBe('aegis_idle');
  });

  it('stays dead when the respawn is EARLIER than the death', () => {
    // A unit that respawned, then died again, is dead.
    const cues = [respawn(0), death(BEAT * 2)];
    expect(selectClip(cues, BEAT * 3, 'a', CLIPS).clip).toBe('sword_and_shield_death');
  });

  it('ignores cues belonging to other units', () => {
    const cues = [move(0, 'b'), impact(0, 'b'), death(0, 'b')];
    expect(selectClip(cues, 0.1, 'a', CLIPS).clip).toBe('aegis_idle');
  });

  it('ignores cues that have not started yet', () => {
    expect(selectClip([ability(BEAT * 5, 'shield_bash')], 0, 'a', CLIPS).clip).toBe('aegis_idle');
  });

  it('reports time since the trigger, so the renderer can seek rather than restart', () => {
    const choice = selectClip([ability(BEAT * 2, 'shield_bash')], BEAT * 2 + 0.4, 'a', CLIPS);
    expect(choice.since).toBeCloseTo(0.4);
  });
});

describe('strideTimeScale', () => {
  it('leaves a clip alone when its cycle already matches the ground', () => {
    // 2 strides per cycle, 0.76s per stride on the ground, clip is 1.52s.
    expect(strideTimeScale(1.52, 2, 0.76)).toBeCloseTo(1);
  });

  it('speeds up a clip whose cycle is slower than the ground', () => {
    expect(strideTimeScale(3.04, 2, 0.76)).toBeCloseTo(2);
  });

  it('slows down a clip whose cycle is faster than the ground', () => {
    expect(strideTimeScale(0.76, 2, 0.76)).toBeCloseTo(0.5);
  });

  it('refuses to divide by zero or invert on nonsense input', () => {
    expect(strideTimeScale(0, 2, 0.76)).toBe(1);
    expect(strideTimeScale(1.5, 0, 0.76)).toBe(1);
    expect(strideTimeScale(1.5, 2, 0)).toBe(1);
    expect(strideTimeScale(-1, 2, 0.76)).toBe(1);
  });
});

/**
 * Drift guard between `data/art/*.json` and `data/characters/*.json`.
 *
 * These two files are edited by different roles for different reasons — Designer
 * changes a clip, Analyzer or the owner rebalances an ability — and nothing
 * otherwise connects them. This caught a real drift on its first run: Aegis's
 * `grounding_strike` had been replaced by `warding_wall` on main while the clip
 * mapping still named the old id, which would have silently played `idle` for a
 * whole ability.
 */
describe('clip mappings match the shipped roster', () => {
  const root = new URL('../../../', import.meta.url);
  const read = (rel: string): Record<string, unknown> =>
    JSON.parse(readFileSync(new URL(rel, root), 'utf8')) as Record<string, unknown>;

  const artFiles = readdirSync(new URL('data/art/', root)).filter((f) => f.endsWith('.json'));

  it('has at least one character with clips defined', () => {
    const withClips = artFiles.filter((f) => 'clips' in read(`data/art/${f}`));
    expect(withClips.length).toBeGreaterThan(0);
  });

  for (const file of artFiles) {
    const art = read(`data/art/${file}`);
    const clips = art['clips'] as { abilities?: Record<string, string> } | undefined;
    if (clips?.abilities === undefined) continue;
    const id = art['id'] as string;

    it(`${id}: every ability has a clip, and no clip names a missing ability`, () => {
      const character = read(`data/characters/${id}.json`) as {
        abilities: { id: string }[];
        ultimate: { id: string };
      };
      // The ULTIMATE counts. Leaving it out is how `warding_halo` went unmapped
      // while this spec stayed green: Aegis's ultimate played his idle, and the
      // clip downloaded as `aegis_ultimate` sat on a different ability.
      const shipped = new Set([...character.abilities.map((a) => a.id), character.ultimate.id]);
      const mapped = new Set(Object.keys(clips.abilities ?? {}));

      expect([...shipped].filter((a) => !mapped.has(a))).toEqual([]);
      expect([...mapped].filter((a) => !shipped.has(a))).toEqual([]);
    });
  }
});
