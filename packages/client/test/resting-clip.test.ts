// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, aimAndCommit, click, lockIn, mountUI, moveButton } from './app-harness.js';
import type { ClipSet } from '../src/character-clips.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * RESTING-CLIP — what a character does when no turn is playing.
 *
 * The bug this pins: clips were only ever selected from the playback timeline,
 * so the moment a turn finished resolving every model reverted to its BIND
 * POSE — arms straight out, the T-pose Mixamo requires for rigging — and stayed
 * there for the whole Decision phase, which is most of a match. It shipped, and
 * it was the first thing visible on the board.
 *
 * Decision has no cues and no timeline, so no timeline-driven spec can catch
 * it. This one asserts the resting pose directly.
 */

const VEX = vex as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, AEGIS]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

const CLIPS: ClipSet = {
  idle: 'aegis_idle',
  run: 'sword_and_shield_run',
  hit: 'sword_and_shield_impact',
  death: 'sword_and_shield_death',
  knockback: 'knocked_down',
  abilities: { shield_bash: 'aegis_smash' },
};

/**
 * A 2v2 where Aegis has a model and Vex does not — today's real mix, and both
 * of them on the viewer's own team so neither is fogged out of the assertion.
 */
const TEAMS: [CharacterDef[], CharacterDef[]] = [[AEGIS, VEX], [VEX, AEGIS]];
const match = (killOwn = false) => {
  const ui = mountUI();
  ui.renderer.withClips({ aegis: CLIPS });
  const opening: GameState = createMatch(OPEN_MAP, '2v2', TEAMS);
  if (killOwn) {
    const victim = opening.units.find((u) => u.owner === 0 && u.characterId === 'aegis')!;
    victim.hp = 0;
    victim.alive = false;
  }
  startHotSeat(ui.ui, OPEN_MAP, roster, TEAMS, '2v2', [1, 1], POOL,
    undefined, undefined, opening);
  return ui;
};

/** A 1v1, so one Lock In per seat resolves the turn. */
const duel = () => {
  const ui = mountUI();
  ui.renderer.withClips({ aegis: CLIPS });
  const teams: [CharacterDef[], CharacterDef[]] = [[AEGIS], [VEX]];
  const opening: GameState = createMatch(OPEN_MAP, '1v1', teams);
  const own = opening.units.find((u) => u.owner === 0)!;
  const foe = opening.units.find((u) => u.owner === 1)!;
  own.pos = { x: 8, y: 9 };
  foe.pos = { x: 9, y: 9 }; // adjacent, so Shield Bash has something to hit
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, '1v1', [1, 1], POOL,
    undefined, undefined, opening);
  return ui;
};

beforeEach(() => {
  document.body.replaceChildren();
  // happy-dom does not drive `requestAnimationFrame`, and playback's tick loop
  // is scheduled on it — so without this the timeline never advances and a
  // resolving turn looks, from a test, exactly like a turn that never resolved.
  vi.stubGlobal('requestAnimationFrame',
    (cb: FrameRequestCallback) => setTimeout(() => { cb(performance.now()); }, 16) as unknown as number);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('RESTING-CLIP: nobody stands in bind pose', () => {
  it('idles on the opening frame, before a single turn has played', () => {
    const b = match();
    const idles = b.renderer.draw.clips.filter((c) => c.clip === CLIPS.idle);
    expect(idles.length, 'the opening paint asks for idle').toBeGreaterThan(0);
    expect(idles[0]!.loop, 'idle loops, or he freezes on frame one').toBe(true);
  });

  it('asks only for characters that have a model', () => {
    // Vex is still a box. Requesting a clip for a box is harmless but wrong,
    // and it would mask a missing model behind a clip nobody can play.
    const b = match();
    const byId = new Map(b.renderer.draw.board.units.map((u) => [u.unitId, u.characterId]));
    const vexUnit = b.renderer.draw.board.units.find((u) => u.characterId === 'vex');
    expect(vexUnit, 'a modelless character is on the board').toBeDefined();
    expect(b.renderer.draw.clips.some((c) => c.unitId === vexUnit!.unitId)).toBe(false);
    // And nothing was asked for a ghost, which carries no characterId at all.
    for (const c of b.renderer.draw.clips) expect(byId.get(c.unitId)).toBe('aegis');
  });

  it('holds a corpse in its death pose rather than standing it back up', () => {
    const b = match(true);
    const dead = b.renderer.draw.board.units.find((u) => !u.alive);
    expect(dead, 'a dead unit is on the board').toBeDefined();
    const forDead = b.renderer.draw.clips.filter((c) => c.unitId === dead!.unitId);
    expect(forDead.length).toBeGreaterThan(0);
    expect(forDead.at(-1)!.clip).toBe(CLIPS.death);
    expect(forDead.at(-1)!.loop, 'a death that looped would be a twitching corpse').toBe(false);
  });
});

/**
 * And the other half: a resting pose that never yields is the same bug wearing
 * the opposite mask. Playback drives clips off the cue timeline, and nothing
 * asserted that the drive actually reaches the renderer — `selectClip` is
 * covered in isolation, `applyClips` was not covered at all.
 */
describe('RESTING-CLIP: a resolving turn takes the pose back', () => {


  it('runs when the unit moves, instead of sliding along in its idle', async () => {
    // A move rather than an ability: every turn with a move produces `move`
    // cues, so this asserts the timeline reaches the renderer without depending
    // on an ability's aim being legal from wherever the spawn happens to be.
    const b = duel();
    click(moveButton(b.controls, 'Move'));
    aimAndCommit(b.board, { x: 6, y: 9 });
    lockIn(b.controls);
    lockIn(b.controls); // the opposing seat, which orders nothing

    await vi.waitFor(() => {
      const played = b.renderer.draw.clips.map((c) => c.clip);
      expect(played, 'the move never reached the renderer').toContain(CLIPS.run);
    }, { timeout: 15000 });

    const run = b.renderer.draw.clips.find((c) => c.clip === CLIPS.run)!;
    // It loops: a multi-square move is several consecutive cues, and a one-shot
    // run would restart — a visible hitch at every tile.
    expect(run.loop).toBe(true);
    // And it carries a stride count, which is what tells the renderer to
    // time-scale it to the board. Without this the clip plays at whatever rate
    // it was authored at: Aegis's 0.733s cycle against a 0.76s beat came out at
    // 2.07 steps per tile. `strideTimeScale` was written and tested in the same
    // commit that failed to call it.
    expect(run.stride, 'the run reached the renderer with no ground speed').toBe(2);
  }, 25000);
});

/**
 * And the wiring: a pure `selectFacing` that nothing calls is the same shape of
 * bug as a `preloadCharacters` nobody called.
 */
describe('FACING: the controller actually turns units', () => {
  it('faces the enemy before a turn is played', () => {
    const b = match();
    const aegis = b.renderer.draw.board.units.find((u) => u.characterId === 'aegis')!;
    const f = b.renderer.draw.facing.get(aegis.unitId);
    expect(f, 'nobody told the renderer which way to look').toBeDefined();
    expect(Math.abs(f!.dx) + Math.abs(f!.dy), 'and it is a real direction').toBeGreaterThan(0);
  });

  it('turns to face the way it walks', async () => {
    const b = duel();
    const aegis = b.renderer.draw.board.units.find((u) => u.characterId === 'aegis')!;
    const before = b.renderer.draw.facing.get(aegis.unitId)!;
    expect(before.dx, 'opens facing the enemy, who is to the east').toBeGreaterThan(0);

    click(moveButton(b.controls, 'Move'));
    aimAndCommit(b.board, { x: 6, y: 9 }); // west, away from the enemy
    lockIn(b.controls);
    lockIn(b.controls);

    await vi.waitFor(() => {
      expect(b.renderer.draw.facing.get(aegis.unitId)!.dx, 'walked west, looking west').toBeLessThan(0);
    }, { timeout: 15000 });
  }, 25000);
});
