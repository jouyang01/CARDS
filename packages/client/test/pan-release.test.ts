// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, lockIn, mountUI, playbackRow, skipPlayback } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * PAN-RELEASE-PLAYBACK — Builder session-16 OQ #1, ruled.
 *
 * Pan was specced against free orbit, and free orbit does not release. Copying
 * that left the camera frozen wherever the player had dragged it while the turn
 * resolved somewhere else — so the one moment the auto-camera exists for was
 * the one moment it was stood down.
 *
 * The ruling: a pan is a *planning* gesture ("let me look over there while I
 * decide"), so it releases when the deciding ends. Orbit rotation and zoom are
 * not planning gestures and persist.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION, WISP, AEGIS]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

const match = () => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[VEX, BASTION], [WISP, AEGIS]];
  const opening: GameState = createMatch(OPEN_MAP, '2v2', teams);
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, '2v2', [1, 1], POOL, undefined, undefined, opening);
  return { ...ui, opening };
};

/**
 * Lock every character in, then let the resolution finish.
 *
 * `playResolution` is async and `lockIn` is not, so a synchronous drive returns
 * while the playback is still a pending promise — the pan releases (that part
 * is synchronous, at the top of the transition) but nothing has framed anything
 * yet. Skipping and waiting for the playback row to close is the same idiom
 * `death-hang-3` uses, and it is what makes "the camera followed the action"
 * an observation rather than a race.
 */
const resolveTurn = async (b: ReturnType<typeof match>): Promise<void> => {
  for (let i = 0; i < 6; i++) lockIn(b.controls);
  skipPlayback(b.controls);
  await vi.waitFor(() => {
    expect(playbackRow(b.controls).style.display).toBe('none');
  });
};

beforeEach(() => { document.body.replaceChildren(); });

describe('PAN-RELEASE-PLAYBACK: a planning pan does not survive the resolution', () => {
  it('THE ITEM: panning stands the auto-camera down, and resolving hands it back', async () => {
    const b = match();
    b.renderer.panBy(160, 90);
    expect(b.renderer.panned(), 'the player has the camera while planning').toBe(true);

    await resolveTurn(b);
    expect(b.renderer.panned(), 'and the resolution takes it back').toBe(false);
  });

  it('and the camera actually follows the action once it is released', async () => {
    // Not just "the latch cleared" — the point of clearing it is that `focusOn`
    // starts driving the centre again. The stub declines focus requests while
    // panned exactly as the real renderer does, so a release that happened too
    // late would show up here as a playback that framed nothing.
    const b = match();
    b.renderer.panBy(200, -120);
    const framedWhilePanned = b.renderer.draw.focus.length;

    await resolveTurn(b);
    expect(
      b.renderer.draw.focus.length,
      'the playback framed the action',
    ).toBeGreaterThan(framedWhilePanned);
  });

  it('a pan issued while planning is ignored by the framing until it releases', async () => {
    // The other half of the same mechanism, asserted on its own so a change
    // that stopped honouring the pan at all would not read as this test passing.
    const b = match();
    const before = b.renderer.draw.focus.length;
    b.renderer.panBy(140, 40);
    // Nothing the app does during planning can re-frame while the player holds
    // the camera — that IS the suspension.
    expect(b.renderer.draw.focus.length).toBe(before);
  });
});

describe('PAN-RELEASE-PLAYBACK: the release gives back the centre and nothing else', () => {
  it('orbit rotation survives the release', async () => {
    // A player who turned the board to see round a wall did not ask for it to
    // be turned back, and the ruling is explicit that only the pan releases.
    const b = match();
    b.renderer.setOrbitEnabled(true);
    b.renderer.panBy(120, 60);
    await resolveTurn(b);
    expect(b.renderer.orbitEnabled(), 'the orbit the player chose is still theirs').toBe(true);
  });

  it('and the zoom is never touched — no re-frame, no fit-to-board', async () => {
    // `lookAt` and `fitBoard` are the only two calls that set a span. If the
    // release reached either, a player who had zoomed in to read a crowded
    // corner would be snapped back out at the exact moment the turn resolved.
    const b = match();
    b.renderer.panBy(180, 100);
    const lookAts = b.renderer.draw.lookAts.length;
    const fits = b.renderer.draw.fitBoards;

    await resolveTurn(b);
    expect(b.renderer.draw.lookAts.length, 'nothing re-framed the board').toBe(lookAts);
    expect(b.renderer.draw.fitBoards, 'and nothing re-fit it').toBe(fits);
  });

  it('releasing an un-panned camera changes nothing', async () => {
    // The common case, and the one a release could quietly break: most turns
    // resolve with nobody having touched the camera at all.
    const b = match();
    expect(b.renderer.panned()).toBe(false);
    await resolveTurn(b);
    expect(b.renderer.panned()).toBe(false);
    expect(b.renderer.draw.fitBoards).toBe(0);
  });
});

describe('PAN-RELEASE-PLAYBACK: planning resumes auto-centred', () => {
  it('the next planning phase frames a character rather than staying released', async () => {
    // The end of the loop the ruling describes: pan → resolve → release →
    // planning takes the camera back and centres it on whoever is being
    // ordered. A release that left the camera ownerless would stop here.
    const b = match();
    b.renderer.panBy(150, 80);
    await resolveTurn(b);
    const last = b.renderer.draw.focus[b.renderer.draw.focus.length - 1];
    expect(last, 'something framed after the turn').toBeDefined();
    expect(b.renderer.panned(), 'and the auto-camera owns it').toBe(false);
  });
});
