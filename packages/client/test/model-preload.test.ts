// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
 * MODEL-PRELOAD — *"Aegis does not render if he is on the opposing team. I only
 * see a red block."*
 *
 * A rigged character that never gets fetched draws the box fallback, and the
 * box wears the unit's FoF colour — so an unfetched enemy is, precisely, a red
 * block. The fetch list used to come from `state.units`, and a **networked**
 * client's state is team-filtered by the server: enemy units it cannot see are
 * *absent from the array* rather than blanked (`server/src/view.ts`). So the
 * client asked for its own characters only, and when the enemy finally walked
 * into vision there was nothing loaded to build it from — permanently, because
 * `staleUnitGroups` swaps a box for a model only once that character IS loaded.
 *
 * Invisible in hot-seat, where `state` is the whole match. These tests are
 * written the other way round on purpose: the fogged opening is the case that
 * was broken, so it is the one that has to be stated.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION, WISP, AEGIS]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

/** `matchMedia` is absent in happy-dom; `browserModels` reads the query only. */
beforeEach(() => { document.body.replaceChildren(); });

/**
 * A match whose opening state has already been through the server's team
 * filter — team 1's units are simply not in it, which is what a networked
 * client actually receives on turn 1.
 */
const foggedOpening = (): { ui: ReturnType<typeof mountUI>; teams: [CharacterDef[], CharacterDef[]] } => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[VEX, BASTION], [WISP, AEGIS]];
  const full: GameState = createMatch(OPEN_MAP, '2v2', teams);
  const opening: GameState = { ...full, units: full.units.filter((u) => u.owner === 0) };
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, '2v2', [1, 1], POOL, undefined, undefined, opening);
  return { ui, teams };
};

describe('MODEL-PRELOAD: every character in the match is fetched, not every one on screen', () => {
  it('THE BUG: the enemy’s characters are preloaded even though the state hides them', () => {
    const { ui } = foggedOpening();
    const asked = ui.renderer.draw.preloads.flat();
    expect(asked, 'the opening state carries no team-1 unit at all').not.toEqual([]);
    // Aegis is team 1's, and is exactly the character the owner could not see.
    expect(asked, 'the enemy Aegis must be fetched before he is ever visible')
      .toContain('aegis');
    expect(asked, 'and his teammate').toContain('wisp');
  });

  it('and the viewer’s own characters are still fetched', () => {
    // The fix must not trade one half of the board for the other.
    const asked = foggedOpening().ui.renderer.draw.preloads.flat();
    expect(asked).toContain('vex');
    expect(asked).toContain('bastion');
  });

  it('every character in the match, and nothing beyond it', () => {
    // The reason this reads `teams` rather than the whole catalog: preloading
    // the roster would fetch megabytes of art for characters nobody picked.
    const { ui, teams } = foggedOpening();
    const asked = ui.renderer.draw.preloads.flat();
    expect([...asked].sort()).toEqual([...new Set(teams.flat().map((c) => c.id))].sort());
  });

  it('asked for once, and each character only once', () => {
    // The fetch is fired unawaited on boot; asking twice for one character
    // would be two network round trips for one `.glb`.
    const asked = foggedOpening().ui.renderer.draw.preloads.flat();
    expect(asked.length, 'no duplicates').toBe(new Set(asked).size);
  });
});
