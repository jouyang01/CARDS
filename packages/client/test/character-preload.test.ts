// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * MODEL-PRELOAD — the controller actually asks for the models.
 *
 * Phase 8 shipped `preloadCharacters` on the renderer, `character-model.ts`
 * behind it and `applyClips` above it, and **nothing called the fetch**. Every
 * piece worked in isolation and the board drew boxes, silently, exactly as it
 * had before — the failure mode a fail-soft asset path is built to produce.
 *
 * So the call site gets its own spec: the one assertion that cannot be made by
 * testing either half on its own.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION, WISP, AEGIS]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

const match = (teams: [CharacterDef[], CharacterDef[]], format: '1v1' | '2v2') => {
  const ui = mountUI();
  const opening: GameState = createMatch(OPEN_MAP, format, teams);
  const players: [number, number] = [1, 1];
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, format, players, POOL, undefined, undefined, opening);
  return ui;
};

beforeEach(() => { document.body.replaceChildren(); });

describe('MODEL-PRELOAD: a match fetches the art it is about to draw', () => {
  it('asks for every character on the board', () => {
    const b = match([[VEX, BASTION], [WISP, AEGIS]], '2v2');
    expect(b.renderer.draw.preloads.length, 'exactly one preload per match').toBe(1);
    expect([...b.renderer.draw.preloads[0]!].sort())
      .toEqual([AEGIS.id, BASTION.id, VEX.id, WISP.id].sort());
  });

  it('asks once per character, not once per unit', () => {
    // A mirror match: the same two characters on both teams, four units. The
    // models are cached by character id, so fetching per unit would be four
    // requests for two files.
    const b = match([[VEX, BASTION], [VEX, BASTION]], '2v2');
    const ids = b.renderer.draw.preloads[0]!;
    expect(ids.length, 'deduplicated').toBe(2);
    expect([...ids].sort()).toEqual([BASTION.id, VEX.id].sort());
  });

  it('does not fetch the rest of the roster', () => {
    // Nine characters exist; a 1v1 draws two. Preloading the roster would pull
    // megabytes of meshes and atlases for characters nobody picked.
    const b = match([[VEX], [BASTION]], '1v1');
    expect(b.renderer.draw.preloads[0]).toEqual(expect.arrayContaining([VEX.id, BASTION.id]));
    expect(b.renderer.draw.preloads[0]!.length).toBe(2);
    expect(b.renderer.draw.preloads[0]).not.toContain(AEGIS.id);
  });
});
