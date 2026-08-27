// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type Roster, type Vec2,
} from '@cards/engine';
import { BEAT, holdCasts, type Cue } from '../src/choreograph.js';
import { phaseWindow } from '../src/animate.js';
import { selectClip, type ClipSet } from '../src/character-clips.js';
import { tracersAt } from '../src/tracer.js';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, aimAndCommit, armAbility, lockIn, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import wisp from '../../../data/characters/wisp.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * FOLLOW-THROUGH — **a cast plays to the end of its own animation.**
 *
 * Owner Dev Note (2026-10-08): *"Wisp's Dagger flurry animation does not finish
 * during blast phase if it doesn't hit anything, fix this."*
 *
 * The "if it doesn't hit anything" is the whole diagnosis. An `ability` cue is
 * one beat; `selectClip` drops the caster back to idle the moment that beat
 * ends; `wisp_flurry` is 3.1 s against a 0.76 s beat. Landing a hit added a
 * second beat to the actor's slot — the impact's — so a connected swing had
 * twice as long and read as finished. The whiff had one beat and got cut in
 * quarters. The cast was borrowing its follow-through from its victim.
 *
 * These are written against the timeline rather than against pixels because
 * every consumer of the fix is a pure function of it: `selectClip` decides what
 * the caster plays, `phaseWindow` decides how long the phase stays open, and
 * `tracersAt` decides how fast the shot crosses the gap. All three are asserted
 * here, the last of them because it is what a naive fix breaks.
 */

const CLIPS: ClipSet = {
  idle: 'wisp_idle',
  run: 'wisp_run',
  hit: 'wisp_hit',
  death: 'wisp_death',
  knockback: 'knocked_down',
  abilities: { dagger_flurry: 'wisp_flurry', bola: 'wisp_bola' },
};

/** `wisp_flurry` really is 3.1 s in the shipped `.glb`; at MS_PER_BEAT that is ~4.08 beats. */
const FLURRY_BEATS = 3.1 / 0.76;

/** A one-actor Blast: the banner, the cast, and optionally the hit it landed. */
const blast = (opts: { hits?: boolean; second?: boolean } = {}): Cue[] => {
  const cues: Cue[] = [
    { kind: 'phase', phase: 'blast', t: 0, dur: BEAT },
    { kind: 'ability', phase: 'blast', t: 1, dur: BEAT, unitId: 'wisp', abilityId: 'dagger_flurry', area: [{ x: 5, y: 5 }] },
  ];
  if (opts.hits === true) {
    cues.push({ kind: 'impact', t: 2, dur: BEAT, unitId: 'foe', amount: 22, absorbed: 0, sourceUnitId: 'wisp', abilityId: 'dagger_flurry' });
  }
  // The next actor's slot starts where this one finished — the sequential rule.
  const after = opts.hits === true ? 3 : 2;
  if (opts.second === true) {
    cues.push({ kind: 'ability', phase: 'blast', t: after, dur: BEAT, unitId: 'aegis', abilityId: 'bola', area: [] });
  }
  cues.push({ kind: 'phase', phase: 'move', t: opts.second === true ? after + 1 : after, dur: BEAT });
  return cues.sort((a, b) => a.t - b.t);
};

const beatsFor = (_unitId: string, abilityId: string): number | undefined =>
  (abilityId === 'dagger_flurry' ? FLURRY_BEATS : undefined);

const castIn = (cues: readonly Cue[], unitId: string): Extract<Cue, { kind: 'ability' }> =>
  cues.find((c): c is Extract<Cue, { kind: 'ability' }> => c.kind === 'ability' && c.unitId === unitId)!;

describe('FOLLOW-THROUGH: a whiffed cast gets the room its clip needs', () => {
  it('THE NOTE: the flurry that hits nothing is held for the whole animation', () => {
    const held = holdCasts(blast(), beatsFor);
    expect(castIn(held, 'wisp').dur).toBeCloseTo(FLURRY_BEATS, 6);
  });

  it('…and `selectClip` therefore still has her swinging three beats in', () => {
    // The consumer, and the owner's actual complaint: at t = 4 the unheld
    // timeline has already crossfaded her to idle mid-slash.
    const cues = blast();
    expect(selectClip(cues, 4, 'wisp', CLIPS).clip, 'before the fix').toBe('wisp_idle');
    expect(selectClip(holdCasts(cues, beatsFor), 4, 'wisp', CLIPS).clip).toBe('wisp_flurry');
  });

  it('…and the Blast phase stays open for it instead of closing on the swing', () => {
    // Holding the clip is worth nothing if the phase ends underneath it:
    // `animatePhase` stops at `phaseWindow(...).end` and `finish()` snaps
    // everybody to their resting pose.
    const cues = blast();
    expect(phaseWindow(cues, 'blast').end, 'before the fix').toBe(2);
    expect(phaseWindow(holdCasts(cues, beatsFor), 'blast').end).toBeCloseTo(1 + FLURRY_BEATS, 6);
  });

  it('THE COMPARISON THE NOTE MAKES: a landed flurry is held to the same length', () => {
    // "if it doesn't hit anything" is about a difference between two cases, so
    // the fix has to close it rather than move it. Both now run the clip.
    const whiff = castIn(holdCasts(blast(), beatsFor), 'wisp');
    const landed = castIn(holdCasts(blast({ hits: true }), beatsFor), 'wisp');
    expect(landed.dur).toBeCloseTo(whiff.dur, 6);
  });
});

describe('FOLLOW-THROUGH: what the hold must NOT move', () => {
  it('the hit still lands on the beat it always did', () => {
    // Stretching the cast *into* its own impact was the obvious fix and the
    // wrong one: the damage would drift a full three beats away from the swing.
    const held = holdCasts(blast({ hits: true }), beatsFor);
    const impact = held.find((c) => c.kind === 'impact')!;
    expect(impact.t).toBe(2);
  });

  it('so the tracer still crosses the gap at the speed it always crossed it', () => {
    // The flight window is `[cast.t, impact.t)` — read off the two cue times,
    // never off the cast's duration. Half way through that window is half way
    // across, held or not, and a bola that took four seconds to arrive would be
    // this fix's own regression.
    const before = tracersAt(blast({ hits: true }), 1.5)[0];
    const after = tracersAt(holdCasts(blast({ hits: true }), beatsFor), 1.5)[0];
    expect(before?.progress).toBeCloseTo(0.5, 6);
    expect(after?.progress).toBeCloseTo(before!.progress, 6);
  });

  it('the next actor waits — the sequential phase stays disjoint', () => {
    const held = holdCasts(blast({ second: true }), beatsFor);
    const wisp = castIn(held, 'wisp');
    expect(castIn(held, 'aegis').t).toBeGreaterThanOrEqual(wisp.t + wisp.dur);
  });

  it('and so does every later phase — MOVE does not start under the swing', () => {
    const held = holdCasts(blast(), beatsFor);
    const wisp = castIn(held, 'wisp');
    const move = held.find((c) => c.kind === 'phase' && c.phase === 'move')!;
    expect(move.t).toBeGreaterThanOrEqual(wisp.t + wisp.dur);
  });
});

describe('FOLLOW-THROUGH: scope', () => {
  it('a character with no model changes nothing — the timeline comes back identical', () => {
    // The default path for eight of the nine characters, and the reason
    // `beatsFor` may answer undefined rather than a guess.
    const cues = blast({ hits: true, second: true });
    expect(holdCasts(cues, () => undefined)).toEqual(cues);
  });

  it('a clip SHORTER than its beat is not shrunk to fit', () => {
    // The hold only ever adds room. A 0.4 s clip in a 0.76 s beat is a cast with
    // a moment of stillness after it, which is fine; speeding the timeline up to
    // meet it would make pacing a function of which file someone exported.
    const cues = blast();
    expect(castIn(holdCasts(cues, () => 0.5), 'wisp').dur).toBe(BEAT);
  });

  it('a cast whose character has no clip for it is left alone', () => {
    // A `.glb` that is missing an ability clip falls back to idle
    // (`character-clips.ts`), and idling for four beats is not follow-through.
    const cues = blast();
    expect(holdCasts(cues, (_u, a) => (a === 'bola' ? 5 : undefined))).toEqual(cues);
  });

  it('DASH: a blink cast is held — but from the phase end, so no concurrent run gets a hole', () => {
    // Dash is simultaneous: step *k* of every mover shares a beat, so shifting
    // from the CASTER'S slot (the sequential rule) would open a hole in the
    // middle of somebody else's charge. A dash blink shifts from the PHASE end
    // instead — every in-phase step is already before it — so the blink gets its
    // whole clip while the other dashers keep every step and simply wait.
    const BLINK_BEATS = 4.6;
    const cues: Cue[] = [
      { kind: 'phase', phase: 'dash', t: 0, dur: BEAT },
      // Wisp blinks: a TELEPORT step plus the cast, both at the dash start.
      { kind: 'ability', phase: 'dash', t: 1, dur: BEAT, unitId: 'wisp', abilityId: 'blink', area: [] },
      { kind: 'move', t: 1, dur: BEAT, unitId: 'wisp', from: { x: 5, y: 5 }, to: { x: 9, y: 5 }, teleport: true },
      // Aegis charges three tiles on foot, one step per beat, straight through.
      { kind: 'move', t: 1, dur: BEAT, unitId: 'aegis', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
      { kind: 'move', t: 2, dur: BEAT, unitId: 'aegis', from: { x: 2, y: 1 }, to: { x: 3, y: 1 } },
      { kind: 'move', t: 3, dur: BEAT, unitId: 'aegis', from: { x: 3, y: 1 }, to: { x: 4, y: 1 } },
      { kind: 'phase', phase: 'move', t: 4, dur: BEAT },
    ];
    const held = holdCasts(cues, (_u, a) => (a === 'blink' ? BLINK_BEATS : undefined));
    // The blink got its whole clip…
    expect(castIn(held, 'wisp').dur).toBeCloseTo(BLINK_BEATS, 6);
    // …every one of Aegis's steps is exactly where it was — no hole mid-charge…
    const steps = held.filter((c) => c.kind === 'move' && c.unitId === 'aegis').map((c) => c.t).sort((a, b) => a - b);
    expect(steps).toEqual([1, 2, 3]);
    // …and Move waited for the blink instead of starting underneath it.
    const move = held.find((c) => c.kind === 'phase' && c.phase === 'move')!;
    expect(move.t).toBeCloseTo(1 + BLINK_BEATS, 6);
  });

  it('DASH: a caster charging on foot is left alone — the run is the story, not a cast clip', () => {
    // `selectClip` ranks ability over movement, so holding a foot-charger's cast
    // would pin a cast clip over the run it should be playing. Held only when the
    // caster teleports or does not move; a walked step this phase opts out.
    const cues: Cue[] = [
      { kind: 'phase', phase: 'dash', t: 0, dur: BEAT },
      { kind: 'ability', phase: 'dash', t: 1, dur: BEAT, unitId: 'wisp', abilityId: 'charge', area: [] },
      { kind: 'move', t: 1, dur: BEAT, unitId: 'wisp', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
      { kind: 'move', t: 2, dur: BEAT, unitId: 'wisp', from: { x: 2, y: 1 }, to: { x: 3, y: 1 } },
    ];
    expect(holdCasts(cues, () => 5)).toEqual(cues);
  });
});

/**
 * The other end of the wire.
 *
 * `holdCasts` is pure and takes the clip lengths as an argument, so every
 * assertion above would pass in full with the controller never calling it. This
 * is the half that says the running game asks — and asks with the right clip
 * name, which is the one thing the app has to get right: the ability id is
 * `dagger_flurry` and the clip in the `.glb` is `wisp_flurry`, and reading the
 * length under the wrong key would silently answer undefined forever.
 */
describe('FOLLOW-THROUGH: the controller asks the renderer how long the swing is', () => {
  const WISP = wisp as unknown as CharacterDef;
  const BASTION = bastion as unknown as CharacterDef;
  const roster: Roster = buildRoster([WISP, BASTION]);
  const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
  const WISP_AT: Vec2 = { x: 5, y: 10 };

  beforeEach(() => { document.body.replaceChildren(); });

  it('THE WIRE: a whiffed Dagger Flurry queries `wisp_flurry`’s length', () => {
    const ui = mountUI();
    ui.renderer.withClips({ wisp: CLIPS });
    ui.renderer.withClipLengths({ wisp: { wisp_flurry: 3.1 } });
    const teams: [CharacterDef[], CharacterDef[]] = [[WISP], [BASTION]];
    const opening = createMatch(OPEN_MAP, '1v1', teams);
    opening.units.find((u) => u.owner === 0)!.pos = { ...WISP_AT };
    opening.units.find((u) => u.owner === 1)!.pos = { x: 17, y: 3 }; // nowhere near the cone
    startHotSeat(ui.ui, OPEN_MAP, roster, teams, '1v1', [1, 1], POOL, undefined, undefined, opening);

    armAbility(ui.controls, 'Dagger Flurry');
    aimAndCommit(ui.board, { x: WISP_AT.x + 2, y: WISP_AT.y }); // at empty floor
    for (let i = 0; i < 4; i += 1) lockIn(ui.controls);

    expect(ui.renderer.draw.clipQueries).toContainEqual({ characterId: 'wisp', clip: 'wisp_flurry' });
  });
});
