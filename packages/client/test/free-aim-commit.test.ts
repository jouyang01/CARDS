// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster, type Vec2,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, aimAndCommit, lockIn, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import wisp from '../../../data/characters/wisp.json';
import vex from '../../../data/characters/vex.json';

/**
 * W1, the wiring — **a FREE ability that needs an aim can be cast at all.**
 *
 * Until W1 every free action in the roster was a `self` shape, so
 * `selectFreeAbility` filled the aim in from the caster's own square and armed
 * nothing: the board-click path for the free slot had no shipped user and no
 * test. W1 makes Veil & Decoy a `square` at range 3, which puts that path on the
 * critical path of a character's whole kit — and "the decoy is placeable at
 * range 3" is worth nothing if a player cannot click the square.
 *
 * Driven through `startHotSeat`, so it is the hotbar button, the board click,
 * the draft, the order builder and the engine — the chain, not a function that
 * feeds it. That is what makes this the honest home for the assertion: the
 * browser suite's version of it (STEALTH-CONFIRM) needs the camera modelled
 * before it can even click the right tile, and spent four attempts getting there.
 */

const WISP = wisp as unknown as CharacterDef;
const VEX = vex as unknown as CharacterDef;
const roster: Roster = buildRoster([WISP, VEX]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

const WISP_AT: Vec2 = { x: 5, y: 10 };

/** A 1v1 with Wisp on the clock and the enemy far away. */
const match = (): ReturnType<typeof mountUI> & { opening: GameState } => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[WISP], [VEX]];
  const opening = createMatch(OPEN_MAP, '1v1', teams);
  opening.units.find((u) => u.owner === 0)!.pos = { ...WISP_AT };
  opening.units.find((u) => u.owner === 1)!.pos = { x: 16, y: 10 };
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, '1v1', [1, 1], POOL, undefined, undefined, opening);
  return { ...ui, opening };
};

/** Press the free-action button in the hotbar. */
const armFree = (controls: HTMLElement): HTMLButtonElement => {
  const button = [...controls.querySelectorAll<HTMLButtonElement>('.hud-ability')]
    .find((b) => b.className.includes('free'));
  expect(button, 'no free-action button in the hotbar').toBeDefined();
  button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return button!;
};

/** Resolve the turn: both seats of a 1v1 have to lock. */
const resolve = (controls: HTMLElement): void => {
  for (let i = 0; i < 4; i += 1) lockIn(controls);
};

beforeEach(() => { document.body.replaceChildren(); });

describe('W1: a free ability with an aim, through the real controller', () => {
  it('THE ITEM: arming the veil and clicking a square places the decoy there', () => {
    const b = match();
    const button = armFree(b.controls);
    expect(button.className, 'the veil is armed').toContain('sel');

    const target: Vec2 = { x: 7, y: 10 }; // two east — in range 3, and empty
    aimAndCommit(b.board, target);
    resolve(b.controls);

    expect(b.renderer.draw.board.decoys).toHaveLength(1);
    expect(b.renderer.draw.board.decoys[0]!.pos, 'at the clicked square').toEqual(target);
  });

  it('and the decoy is NOT under Wisp — the click is what decided', () => {
    // The half that makes the assertion above about the click rather than about
    // the cast: before W1 the decoy always appeared on the caster's own tile,
    // so "a decoy exists" was true without any board click at all.
    const b = match();
    armFree(b.controls);
    aimAndCommit(b.board, { x: 7, y: 10 });
    resolve(b.controls);
    expect(b.renderer.draw.board.decoys[0]!.pos).not.toEqual(WISP_AT);
  });

  it('with no board click the veil never fires — arming is not casting', () => {
    // What the old `self` shape used to do for free, and no longer does. Worth
    // pinning because the failure mode is silent: the button stays lit, the
    // player locks in, and the turn resolves having done nothing.
    const b = match();
    armFree(b.controls);
    resolve(b.controls);
    expect(b.renderer.draw.board.decoys).toHaveLength(0);
  });

  it('DECOY-PLACEMENT: a click on an occupied square commits nothing', () => {
    // The refusal reaches the board, not just the engine: clicking the enemy
    // leaves the slot armed and lays no decoy. `commitAim` and the resolver
    // share one predicate, so the two cannot disagree about which it was.
    const b = match();
    armFree(b.controls);
    aimAndCommit(b.board, { x: 16, y: 10 }); // the enemy's own square
    resolve(b.controls);
    expect(b.renderer.draw.board.decoys).toHaveLength(0);
  });

  it('…and clicking Wisp’s own square is refused too', () => {
    const b = match();
    armFree(b.controls);
    aimAndCommit(b.board, { ...WISP_AT });
    resolve(b.controls);
    expect(b.renderer.draw.board.decoys).toHaveLength(0);
  });

  it('a square beyond range 3 is refused, one at exactly 3 is not', () => {
    // The boundary from both sides, driven rather than computed — this is the
    // number the owner asked for ("a range of 3") and the one a player feels.
    const far = match();
    armFree(far.controls);
    aimAndCommit(far.board, { x: WISP_AT.x + 4, y: WISP_AT.y });
    resolve(far.controls);
    expect(far.renderer.draw.board.decoys, 'four away').toHaveLength(0);

    document.body.replaceChildren();
    const edge = match();
    armFree(edge.controls);
    aimAndCommit(edge.board, { x: WISP_AT.x + 3, y: WISP_AT.y });
    resolve(edge.controls);
    expect(edge.renderer.draw.board.decoys, 'exactly three').toHaveLength(1);
  });
});
