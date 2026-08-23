// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch, resolveTurn,
  type CatalystData, type CharacterDef, type GameState, type MapDef, type PlayerOrders,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { panDelta } from '../src/renderer3d.js';
import { aimAndCommit, click, lockIn, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import aegisJson from '../../../data/characters/aegis.json';
import vexJson from '../../../data/characters/vex.json';
import kestrelJson from '../../../data/characters/kestrel.json';

/**
 * CAMERA-CONTROLS — *"IMPORTANT: Need to add Camera panning and the auto camera
 * center should be on the character, not the board."*
 *
 * Two gaps, and they are the same complaint from opposite ends: the player could
 * not move the camera at all, and where it put itself was not where they were
 * working. BOARD_ZOOM made both sharper — the board deliberately runs off the
 * viewport now, so "somewhere on the board" is no longer close enough to "on the
 * character you are ordering".
 *
 * The pan maths is a pure function (`panDelta`) for the same reason
 * `squareToWorldXZ` is: it is the part that has to be right, and it needs no
 * WebGL context to check. Everything else is driven through the real controller.
 */

const AEGIS = aegisJson as unknown as CharacterDef;
const VEX = vexJson as unknown as CharacterDef;
const KESTREL = kestrelJson as unknown as CharacterDef;
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

const FIELD: MapDef = {
  id: 'f', name: 'f', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 3, y: 3 }, { x: 17, y: 17 }, { x: 8, y: 12 }, { x: 8, y: 14 }],
    [{ x: 12, y: 8 }, { x: 12, y: 10 }, { x: 12, y: 12 }, { x: 12, y: 14 }],
  ],
};

/**
 * A hot-seat with the seat's two characters at **opposite corners**.
 *
 * Deliberate: the old framing was the centroid of the seat's own units, which
 * for (3,3) and (17,17) is the middle of the board — a point neither character
 * is standing anywhere near, and indistinguishable from "frame the board". A
 * fixture with the two close together could not tell the new answer from either
 * old one.
 */
const hotSeat = () => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[VEX, AEGIS], [KESTREL, KESTREL]];
  const state: GameState = createMatch(FIELD, '2v2', teams);
  const [first, second] = state.units.filter((u) => u.owner === 0);
  const foes = state.units.filter((u) => u.owner === 1);
  first!.pos = { x: 3, y: 3 };
  second!.pos = { x: 17, y: 17 };
  foes[0]!.pos = { x: 12, y: 8 };
  foes[1]!.pos = { x: 12, y: 12 };
  startHotSeat(ui.ui, FIELD, buildRoster([VEX, AEGIS, KESTREL]), teams, '2v2', [1, 1], POOL,
    undefined, undefined, state);
  return { ...ui, state, first: first!, second: second! };
};

/** Where the auto-camera was last asked to look. */
const focus = (ui: ReturnType<typeof hotSeat>): { x: number; y: number }[] =>
  ui.renderer.draw.focus ?? [];

beforeEach(() => { document.body.replaceChildren(); });

describe('CAMERA-CONTROLS: the pan maths', () => {
  const view = { span: 20, height: 500, yawDeg: 0, pitchDeg: 90 };

  it('a drag moves the camera the OPPOSITE way, so the board follows the pointer', () => {
    // Grab-and-drag is the whole feel of a pan. Dragging right must carry the
    // board right, which means the camera's centre goes left — get this backwards
    // and every player calls it broken without being able to say why.
    expect(panDelta({ dx: 100, dy: 0 }, view).x).toBeLessThan(0);
    expect(panDelta({ dx: -100, dy: 0 }, view).x).toBeGreaterThan(0);
    // Looking straight down, screen-down is -y on the board.
    expect(panDelta({ dx: 0, dy: 100 }, view).y).toBeLessThan(0);
  });

  it('one pixel is one span-over-height of board, with no distance term', () => {
    // The camera is orthographic, so there is no perspective divide: the visible
    // height IS `span`. A drag of the full viewport height must cross exactly one
    // span of board, which is what makes a pan feel 1:1 with the pointer.
    expect(Math.abs(panDelta({ dx: 0, dy: view.height }, view).y)).toBeCloseTo(view.span, 6);
    expect(Math.abs(panDelta({ dx: view.height, dy: 0 }, view).x)).toBeCloseTo(view.span, 6);
  });

  it('and it follows the orbit — "right" is the camera’s right, not the board’s', () => {
    // Once a free orbit has swung the board 90°, dragging right must still move
    // the board right on screen. Without the yaw term the pan turns into a
    // compass and the player fights it.
    const turned = { ...view, yawDeg: 90 };
    const d = panDelta({ dx: 100, dy: 0 }, turned);
    expect(Math.abs(d.x), 'x barely moves at 90°').toBeLessThan(0.001);
    expect(d.y, 'the drag now runs along the board’s y').toBeGreaterThan(0);
  });

  it('a shallower pitch crosses MORE squares per pixel of vertical drag', () => {
    // Depth is foreshortened on screen. At an isometric pitch a vertical drag
    // covers more board than a horizontal one of the same length, and a pan that
    // ignored it would slide the board diagonally under a straight drag.
    const flat = panDelta({ dx: 0, dy: 100 }, { ...view, pitchDeg: 30 });
    const down = panDelta({ dx: 0, dy: 100 }, { ...view, pitchDeg: 90 });
    expect(Math.abs(flat.y)).toBeGreaterThan(Math.abs(down.y));
  });
});

describe('CAMERA-CONTROLS: the auto-camera centres on the active character', () => {
  it('THE ITEM: planning frames the SELECTED character, not the team centroid', () => {
    // The owner's sentence. With the two characters at opposite corners the
    // centroid is the middle of the board — so "the character" and "the team"
    // and "the board" are three different answers and this can only pass on one.
    const b = hotSeat();
    expect(focus(b), 'the character being ordered').toEqual([b.first.pos]);
  });

  it('and switching characters re-frames on the new one', () => {
    // Framing that only happened on the opening paint would leave the player
    // ordering their second character while looking at their first.
    const b = hotSeat();
    const buttons = [...b.controls.querySelectorAll<HTMLButtonElement>('.hud-chip')];
    expect(buttons.length, 'the seat runs two characters').toBe(2);
    click(buttons[1]);
    expect(focus(b), 'the one just picked').toEqual([b.second.pos]);
  });

  it('and it is a full centring, not the auto-camera’s lean', () => {
    // `focusOn`'s `pan` argument halves the move by default, which is right when
    // four actors resolve in a row and wrong when the player is working: during
    // planning the answer is "put it in the middle", not "gesture toward it".
    const b = hotSeat();
    const last = b.renderer.draw.focusPan;
    expect(last, 'planning asks for the whole pan').toBe(1);
  });
});

describe('CAMERA-CONTROLS: panning, and getting back', () => {
  it('a pan moves the view and suspends the auto-camera', () => {
    // The auto-vs-manual model free orbit already uses: once the player has
    // taken the camera, the automatic framing stands down rather than fighting
    // them for it on the next repaint.
    const b = hotSeat();
    expect(b.renderer.panned(), 'nobody has touched it yet').toBe(false);
    b.renderer.panBy(120, 60);
    expect(b.renderer.draw.pan.x, 'the view moved').not.toBe(0);
    expect(b.renderer.panned(), 'and the player owns it now').toBe(true);
  });

  it('Recentre gives it back, and says whether it snapped', () => {
    // A pan with no way back is a way to lose the board, so the gesture ships
    // with its undo — and the undo is a HUD control, not a keyboard secret.
    const b = hotSeat();
    b.renderer.panBy(120, 60);
    const recentre = b.controls.querySelector<HTMLButtonElement>('.hud-recentre');
    expect(recentre, 'the affordance exists').not.toBeNull();
    click(recentre);
    expect(b.renderer.panned(), 'the auto-camera has it again').toBe(false);
    expect(b.renderer.draw.pan, 'and the view is back').toEqual({ x: 0, y: 0 });
    expect(b.renderer.draw.recentres.length, 'the renderer was told').toBeGreaterThan(0);
  });

  it('and coming back to Auto camera clears a pan too', () => {
    // Otherwise the button lies: it reads "Auto camera" while the auto-camera is
    // still stood down behind a pan nobody remembers making.
    const b = hotSeat();
    b.renderer.panBy(200, 0);
    const orbit = [...b.controls.querySelectorAll<HTMLButtonElement>('.hud-small')]
      .find((n) => (n.textContent ?? '').includes('orbit') || (n.textContent ?? '').includes('Auto'));
    click(orbit); // → free orbit
    click(orbit); // → back to auto
    expect(b.renderer.panned()).toBe(false);
  });
});

describe('CAMERA-CONTROLS: the camera is view-only', () => {
  it('the same orders resolve identically however the camera is pointed', () => {
    // The guard that matters most, and the cheapest one to state: the camera is
    // a view. If a pan, a zoom or an orbit could reach the engine, two players
    // looking at the same match from different angles would resolve different
    // turns — and the whole determinism guarantee would be a matter of where
    // somebody had dragged.
    const roster = buildRoster([VEX, AEGIS, KESTREL]);
    const teams: [CharacterDef[], CharacterDef[]] = [[VEX, AEGIS], [KESTREL, KESTREL]];
    const orders: [PlayerOrders, PlayerOrders] = [
      { team: 0, units: [] }, { team: 1, units: [] },
    ];

    const still = createMatch(FIELD, '2v2', teams);
    const panned = createMatch(FIELD, '2v2', teams);
    const a = resolveTurn(still, FIELD, orders, roster);

    // …now drive a real board and move the camera every way it can be moved.
    const b = hotSeat();
    b.renderer.panBy(300, -180);
    b.renderer.setOrbitEnabled(true);
    b.renderer.panBy(-90, 40);

    const c = resolveTurn(panned, FIELD, orders, roster);
    expect(c.state, 'the resolved state does not know where anybody was looking')
      .toEqual(a.state);
    expect(c.events).toEqual(a.events);
  });

  it('and a pan does not disturb the orders the seat is composing', () => {
    // The other half: panning mid-plan is exactly what a player does while
    // deciding, so it must not clear an aim, a move, or the selection.
    const b = hotSeat();
    click(b.controls.querySelector('.hud-move'));
    aimAndCommit(b.board, { x: 4, y: 3 });
    b.renderer.panBy(150, 90);
    lockIn(b.controls);
    // The plan survived the pan: locking advanced the seat to its second
    // character, which only happens if the first one had an order to lock.
    expect(focus(b), 'the seat moved on to its second character').toEqual([b.second.pos]);
  });
});
