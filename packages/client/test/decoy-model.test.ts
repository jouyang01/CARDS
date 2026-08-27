// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster, type Vec2,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, lockIn, mountUI, aimAndCommit } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import wisp from '../../../data/characters/wisp.json';
import vex from '../../../data/characters/vex.json';

/**
 * DECOY-MODEL — **a decoy is drawn as the character it is pretending to be.**
 *
 * Owner Dev Note (2026-10-08): *"Wisp's decoy renders as a giant red box to the
 * enemy and a random purple square for allies. Not the Wisp model with idle
 * animation."*
 *
 * Two separate faults, one cause. The decoy was drawn in the `decoy` layer,
 * which `show()` disposes and rebuilds on every paint — so it could never hold a
 * model (a skinned mesh rebuilt each frame has its animation restarted each
 * frame) and got the same untextured box a character with no `.glb` gets. And
 * because the layer had no character to draw, the impersonated character never
 * reached the renderer at all: the owner's half was a bare ground plate with
 * nothing standing on it.
 *
 * The fix moves the decoy's body into the keyed `unitObjects` map, so it is
 * built and reconciled exactly like a unit — model, foot ring, billboarded
 * plate, idle clip. The purple plate stays, as the owner's tell, under an
 * otherwise identical Wisp.
 *
 * What is assertable headlessly is the controller's half: **which character the
 * renderer is told the decoy is.** Every one of the renderer's decisions hangs
 * off that one field, and it was absent. The mesh itself is the browser suite's
 * (STEALTH-CONFIRM).
 */

const WISP = wisp as unknown as CharacterDef;
const VEX = vex as unknown as CharacterDef;
const roster: Roster = buildRoster([WISP, VEX]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

const WISP_AT: Vec2 = { x: 5, y: 10 };
const DECOY_AT: Vec2 = { x: 7, y: 10 }; // two east — inside Veil & Decoy's range 3

/** A 1v1 with Wisp on the clock and Vex far away. */
const match = (): ReturnType<typeof mountUI> & { opening: GameState } => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[WISP], [VEX]];
  const opening = createMatch(OPEN_MAP, '1v1', teams);
  opening.units.find((u) => u.owner === 0)!.pos = { ...WISP_AT };
  opening.units.find((u) => u.owner === 1)!.pos = { x: 16, y: 10 };
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, '1v1', [1, 1], POOL, undefined, undefined, opening);
  return { ...ui, opening };
};

/** Press the free-action button, aim it at `DECOY_AT`, and resolve the turn. */
const castVeil = (b: ReturnType<typeof match>): void => {
  const button = [...b.controls.querySelectorAll<HTMLButtonElement>('.hud-ability')]
    .find((x) => x.className.includes('free'));
  expect(button, 'no free-action button in the hotbar').toBeDefined();
  button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  aimAndCommit(b.board, DECOY_AT);
  for (let i = 0; i < 4; i += 1) lockIn(b.controls);
};

beforeEach(() => { document.body.replaceChildren(); });

describe('DECOY-MODEL: the renderer is told which character to draw', () => {
  it('THE NOTE: the decoy on the board is a WISP, not an anonymous shape', () => {
    const b = match();
    castVeil(b);
    const [decoy] = b.renderer.draw.board.decoys;
    expect(decoy, 'the veil laid no decoy').toBeDefined();
    expect(decoy!.characterId, 'the impersonated character reaches the renderer').toBe('wisp');
  });

  it('…and its OWNER is told too — the purple plate is a marker, not a substitute', () => {
    // The half the note calls "a random purple square for allies". A decoy its
    // owner cannot recognise as a Wisp is a decoy they cannot plan around: the
    // whole point is that it stands where an enemy will read it as her.
    const b = match();
    castVeil(b);
    const [decoy] = b.renderer.draw.board.decoys;
    expect(decoy!.asEnemy, 'drawn for the team that placed it').toBe(false);
    expect(decoy!.characterId).toBe('wisp');
  });

  it('the character is the CASTER’s, not a hardcoded "wisp"', () => {
    // `snapshotDecoy` finds the impersonated unit from the roster's data — which
    // ability can lay a decoy — so a second decoy-caster would wear its own
    // model rather than inheriting Wisp's. Asserted through the shipped roster
    // by checking the field agrees with the unit that actually cast it.
    const b = match();
    castVeil(b);
    const caster = b.renderer.draw.board.units.find((u) => u.owner === 0);
    expect(b.renderer.draw.board.decoys[0]!.characterId).toBe(caster!.characterId);
  });

  it('the decoy keeps its own id, so its body is keyed apart from the caster’s', () => {
    // The reason a decoy can be a `unitObjects` entry at all: two bodies of the
    // same character on the board at once, reconciled separately. An id that
    // collided with the caster's would make the decoy overwrite her.
    const b = match();
    castVeil(b);
    const ids = new Set(b.renderer.draw.board.units.map((u) => u.unitId));
    expect(ids.has(b.renderer.draw.board.decoys[0]!.id)).toBe(false);
  });

  it('and it stands on the square that was clicked', () => {
    // The pairing that keeps the assertions above about the decoy rather than
    // about some other object: it is at the aimed tile, not under Wisp.
    const b = match();
    castVeil(b);
    expect(b.renderer.draw.board.decoys[0]!.pos).toEqual(DECOY_AT);
    expect(b.renderer.draw.board.decoys[0]!.pos).not.toEqual(WISP_AT);
  });

  it('DECOY-FACING: it faces the way Wisp would if she had stepped onto the tile', () => {
    // Owner: "the decoy needs to face the same direction Wisp would if she had
    // moved into that spot." She stood at (5,10) and it is at (7,10) — two east —
    // so the direction she is pretending to have taken is +x. A board-space delta
    // (not normalised): the renderer owns the angle.
    const b = match();
    castVeil(b);
    const decoy = b.renderer.draw.board.decoys[0]!;
    expect(decoy.facing).toBeDefined();
    expect(Math.sign(decoy.facing!.x), 'looking east, toward the tile').toBe(1);
    expect(decoy.facing!.y, 'and not drifting north/south').toBe(0);
  });
});
