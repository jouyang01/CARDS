// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch, deriveSeats, mergeSeatOrders, resolveTurn,
  type CatalystData, type CharacterDef, type GameState, type Roster, type UnitOrders,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, abilityButtons, click, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * CAMERA-CONTROLS — the owner's note: *"Need to add Camera panning and the auto
 * camera center should be on the character, not the board."*
 *
 * Two gaps, and they are one ask. Since BOARD_ZOOM the frame is deliberately
 * tighter than the board, so parts of the map are off-screen **by design** —
 * which makes both a pan gesture and a sensible auto-centre load-bearing rather
 * than nice to have. A player who cannot pan cannot look at the corner their
 * opponent is standing in.
 *
 * These drive the real controller through `startHotSeat`. The projection maths
 * has its own unit tests in `camera-pan.test.ts`; what is checked here is the
 * wiring — who takes the camera, who hands it back, and what it points at.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION, WISP, AEGIS]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

const match = (players: [number, number] = [1, 1]) => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[VEX, BASTION], [WISP, AEGIS]];
  const opening: GameState = createMatch(OPEN_MAP, '2v2', teams);
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, '2v2', players, POOL, undefined, undefined, opening);
  return { ...ui, opening };
};

/** The squares the auto-camera was last asked to frame. */
const lastFocus = (ui: ReturnType<typeof match>): { x: number; y: number }[] => {
  const entries = ui.renderer.draw.focus;
  return entries[entries.length - 1]?.squares ?? [];
};

/**
 * The button that hands the camera back — the HUD's auto/free-orbit control.
 *
 * Found by its label rather than a class, because it shares `hud-small` with
 * the projection toggle beside it and the label is the thing a player reads.
 */
const cameraButton = (controls: HTMLElement): HTMLButtonElement => {
  const found = [...controls.querySelectorAll<HTMLButtonElement>('.hud-view button')]
    .find((b) => /auto camera|free orbit/i.test(b.textContent ?? ''));
  expect(found, 'the HUD must offer a camera control').toBeDefined();
  return found!;
};

beforeEach(() => { document.body.replaceChildren(); });

describe('the auto-camera centres on the character being planned for', () => {
  it('frames the selected character, not the roster centroid and not the board', () => {
    const ui = match();
    const focus = lastFocus(ui);
    expect(focus.length, 'one square: the character on the clock').toBe(1);

    // OPEN_MAP spawns team 0 at x=2, and the board middle is x=10. A frame on
    // the centroid or the board would sit well away from the character.
    const selected = ui.opening.units.find((u) => u.owner === 0)!;
    expect(focus[0]).toEqual(selected.pos);
  });

  it('re-frames when the seat switches to its other character', () => {
    // Two characters, one player: locking the first hands the seat the second.
    const ui = match([1, 1]);
    const first = lastFocus(ui)[0]!;
    click(ui.controls.querySelector('.hud-lock'));
    const second = lastFocus(ui)[0]!;
    expect(second, 'the camera followed the seat to its next character')
      .not.toEqual(first);
    const owned = ui.opening.units.filter((u) => u.owner === 0).map((u) => u.pos);
    expect(owned).toContainEqual(second);
  });

  it('asks for a full pan, not the auto-camera lean', () => {
    // The lean exists so a resolution that jumps between four actors stays
    // readable. Planning is the opposite case: the player is working on one
    // character and wants it centred, not gestured at.
    const ui = match();
    expect(ui.renderer.draw.focus[ui.renderer.draw.focus.length - 1]?.pan).toBe(1);
  });
});

describe('panning takes the camera, and the HUD hands it back', () => {
  it('a pan stands the auto-camera down', () => {
    const ui = match();
    const before = ui.renderer.draw.focus.length;
    ui.renderer.panBy(40, 25);
    expect(ui.renderer.panned()).toBe(true);

    // Re-render by arming something: the controller re-frames on every planning
    // paint, and every one of those must now be declined.
    const buttons = abilityButtons(ui.controls);
    click(buttons[0]);
    expect(ui.renderer.draw.focus.length, 'the auto-camera must not fight the pan')
      .toBe(before);
  });

  it('the camera control recentres instead of toggling free orbit', () => {
    const ui = match();
    ui.renderer.panBy(40, 25);
    expect(ui.renderer.orbitEnabled()).toBe(false);

    click(cameraButton(ui.controls));
    expect(ui.renderer.panned(), 'the pan is released').toBe(false);
    expect(ui.renderer.orbitEnabled(), 'and the player is not handed free orbit instead')
      .toBe(false);
    expect(lastFocus(ui).length, 'the auto-camera framed something again')
      .toBeGreaterThan(0);
  });

  it('the control still toggles free orbit when nothing has been panned', () => {
    const ui = match();
    click(cameraButton(ui.controls));
    expect(ui.renderer.orbitEnabled()).toBe(true);
    click(cameraButton(ui.controls));
    expect(ui.renderer.orbitEnabled()).toBe(false);
  });

  it('entering free orbit releases a pan, so the toggle is never a dead control', () => {
    const ui = match();
    ui.renderer.panBy(10, 10);
    ui.renderer.setOrbitEnabled(true);
    ui.renderer.setOrbitEnabled(false);
    expect(ui.renderer.panned(), 'a latched pan would keep focusOn standing down forever')
      .toBe(false);
  });
});

/**
 * The camera is a **view**, and `BACKLOG.md` says so in as many words: *no game
 * rule, event, or resolved-state may depend on it.* This is the guard for that,
 * and it belongs here rather than in the engine suite because the engine cannot
 * be the thing that breaks it — the client would be, by routing something
 * through a camera-derived value on its way to `resolveTurn`.
 */
describe('the camera cannot touch the game', () => {
  it('resolves a turn identically however the camera is pointed', () => {
    const teams: [CharacterDef[], CharacterDef[]] = [[VEX, BASTION], [WISP, AEGIS]];
    const opening = createMatch(OPEN_MAP, '2v2', teams);
    const seats = deriveSeats(opening, [1, 1]);

    const orders: UnitOrders[] = opening.units.map((u) => ({
      unitId: u.unitId,
      movePath: [],
      sprint: false,
    }));
    const merged = mergeSeatOrders(seats, new Map(seats.map((s) => [
      s.seatId,
      orders.filter((o) => s.unitIds.includes(o.unitId)),
    ])));

    const still = resolveTurn(opening, OPEN_MAP, merged, roster, POOL);

    // The same orders, resolved after the camera has been dragged, orbited and
    // zoomed. `resolveTurn` takes no camera argument at all, which is the point:
    // the only way this could differ is if something leaked one in.
    const ui = mountUI();
    startHotSeat(ui.ui, OPEN_MAP, roster, teams, '2v2', [1, 1], POOL, undefined, undefined, opening);
    ui.renderer.panBy(137, -84);
    ui.renderer.setOrbitEnabled(true);
    ui.renderer.panBy(-40, 900);
    const moved = resolveTurn(opening, OPEN_MAP, merged, roster, POOL);

    expect(moved).toEqual(still);
  });
});
