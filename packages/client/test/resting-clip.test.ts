// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, mountUI } from './app-harness.js';
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

beforeEach(() => { document.body.replaceChildren(); });

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
