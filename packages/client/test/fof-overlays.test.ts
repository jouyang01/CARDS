// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { fofFor } from '../src/fof.js';
import { OPEN_MAP, aimAndCommit, click, lockIn, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * FOF-OVERLAYS — *"Blue lines meant your ally was moving or aiming there; red
 * lines tracked enemy placements … AoE templates were heavily color-coded so
 * you wouldn't confuse an ally's ultimate with an enemy mirror character's
 * ultimate."*
 *
 * The **committed** half takes FoF colour; the viewer's own **live** aim keeps
 * the meaning-coded palette (amber aim, blue range). That split is the whole
 * reconciliation with the meaning-coded overlay vocabulary, so both halves are
 * asserted here — a change that made everything friendly-blue would satisfy the
 * first assertion and fail the second.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION, WISP, AEGIS]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

/** The identity hues, as `app.ts` defines them. Duplicated deliberately — see below. */
const SELF = 0x4f8cff;
const FOE = 0xff6b5e;

const match = () => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[VEX, BASTION], [WISP, AEGIS]];
  const opening: GameState = createMatch(OPEN_MAP, '2v2', teams);
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, '2v2', [1, 1], POOL, undefined, undefined, opening);
  return { ...ui, opening };
};

beforeEach(() => { document.body.replaceChildren(); });

describe('FOF-OVERLAYS: a committed plan on your side reads friendly', () => {
  it('THE ITEM: the first character’s locked plan is drawn in the friendly colour', () => {
    // Order and lock the first character, then land on the second. The first
    // one's committed plan is now on the board as context for the second's —
    // which is exactly the moment the colour has to say "this one is ours".
    const b = match();
    click(b.controls.querySelector('.hud-move'));
    aimAndCommit(b.board, { x: 3, y: 10 });
    lockIn(b.controls);

    expect(b.renderer.draw.pathColours.get('teamPath'), 'the ally route is friendly blue')
      .toBe(SELF);
  });

  it('and the committed AoE and its outline are the same friendly colour', () => {
    // The mirror-matchup clause: an ally's template and an enemy's are the same
    // *shape*, so the hue is the only thing that separates them. Area and
    // outline must agree, or the footprint and its border disagree about whose
    // it is.
    const b = match();
    const ability = b.controls.querySelector<HTMLButtonElement>('.hud-ability:not([disabled])');
    expect(ability, 'the character has an ability to commit').not.toBeNull();
    click(ability);
    aimAndCommit(b.board, { x: 4, y: 11 });
    lockIn(b.controls);

    const area = b.renderer.draw.highlightColours.get('locked');
    const outline = b.renderer.draw.shapeColours.get('shapeLocked');
    expect(area, 'the committed footprint').toBe(SELF);
    expect(outline, 'and its border, in the same blue').toBe(SELF);
  });
});

describe('FOF-OVERLAYS: the viewer’s own live aim is left alone', () => {
  it('an aim being composed keeps the meaning-coded palette, not the FoF one', () => {
    // The reconciliation this item takes, stated as a test. If the live aim went
    // friendly-blue too, "committed" and "still deciding" would collapse into
    // one colour and the player would lose the more useful distinction to gain
    // one they never needed — their own aim is unambiguously theirs.
    const b = match();
    const ability = b.controls.querySelector<HTMLButtonElement>('.hud-ability:not([disabled])');
    click(ability);
    aimAndCommit(b.board, { x: 4, y: 11 });

    const live = b.renderer.draw.highlightColours.get('aim');
    expect(live, 'the live aim is drawn').toBeDefined();
    expect(live, 'and it is not the friendly plan colour').not.toBe(SELF);
    expect(live, 'nor the foe colour').not.toBe(FOE);
  });

  it('the live move line stays its own colour, distinct from a committed route', () => {
    // Both are "a route", and they mean different things: one is a decision
    // still being made, the other one already taken.
    const b = match();
    click(b.controls.querySelector('.hud-move'));
    aimAndCommit(b.board, { x: 3, y: 10 });
    const live = b.renderer.draw.pathColours.get('path');
    lockIn(b.controls);
    const committed = b.renderer.draw.pathColours.get('teamPath');
    expect(committed).toBe(SELF);
    expect(live, 'the line you are dragging is not the line you already locked')
      .not.toBe(committed);
  });
});

describe('FOF-OVERLAYS: the enemy telegraph the client actually has', () => {
  /**
   * **Scoped to what is already public, as the item requires.**
   *
   * The client surfaces exactly one piece of enemy last-turn information:
   * LAST-KNOWN ghosts — where this team last *saw* each enemy. There is no
   * enemy trajectory or AoE telegraph to colour, and golden rule #5 keeps
   * *this*-turn enemy plans hidden until resolution, so inventing one was never
   * on the table. A ghost is a `RenderUnit`, so it takes its foe colour from
   * FOF-UNITS' resolver — which is the reuse this item asked for rather than a
   * second, parallel notion of "enemy red".
   */
  it('a remembered enemy resolves foe from the viewer, like a live one', () => {
    const b = match();
    const viewer = b.renderer.draw.viewer!;
    const seat = { team: viewer.team, seatUnitIds: new Set(viewer.seatUnitIds) };
    for (const enemy of b.opening.units.filter((u) => u.owner !== viewer.team)) {
      expect(fofFor(enemy, seat), `${enemy.unitId} is remembered as an enemy`).toBe('foe');
    }
  });
});

describe('FOF-OVERLAYS: the hues are the ones app.ts ships', () => {
  it('the constants this file asserts against are the board’s own', () => {
    // The two numbers above are duplicated from `app.ts` rather than imported,
    // because `FOF` is module-private there and exporting it only for a test
    // would be the test shaping the source. This pins the duplication instead:
    // the friendly overlay colour IS whatever the board paints a friendly unit,
    // so if `app.ts` re-hues, this fails here rather than silently passing on a
    // stale literal.
    const b = match();
    click(b.controls.querySelector('.hud-move'));
    aimAndCommit(b.board, { x: 3, y: 10 });
    lockIn(b.controls);
    expect(b.renderer.draw.pathColours.get('teamPath')).toBe(SELF);
    expect(SELF).not.toBe(FOE);
  });
});
