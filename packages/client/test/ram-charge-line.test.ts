// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch, resolveTurn,
  type CatalystData, type CharacterDef, type GameState, type Roster, type UnitOrders, type Vec2,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { chargeHitList } from '../src/targeting.js';
import { OPEN_MAP, aimAt, armAbility, layer, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import bastion from '../../../data/characters/bastion.json';
import kestrel from '../../../data/characters/kestrel.json';
import vex from '../../../data/characters/vex.json';

/**
 * RAM-PREVIEW-REVERT — *"Ram Charge line attack preview is not working, just go
 * back to how it was before."*
 *
 * This file was written for RAM-LINE-PREVIEW-FIX (PR #103), which did **two
 * separable things**. The owner has played the result and rejected one of them,
 * so the file now pins the line between them:
 *
 * **Reverted — the lane outline.** `tessellate`'s `path` case drew one lane per
 * straight run of the route, on the reasoning that every other attack shape has
 * drawn its continuous locus since AIM-PREVIEW-TRUE and a charge was the only one
 * that did not. The owner's verdict is the one that counts. A charge is back to
 * route tiles + the landing marker + per-enemy numbers, and **nothing on the
 * shape layer** — the first two tests below are the old outline assertions
 * turned around, and they fail before the revert.
 *
 * **Kept — the `chargeHits` numbers.** The route covers everybody standing on
 * it; `chargeHits` decides how many are hit — `"all"` for Ram Charge and Tempest
 * Run, first-only by omission for everything else. Kestrel's Skim was stamping
 * its damage on *every* enemy on the route and hitting one. That is not part of
 * "how it was before" worth restoring: it is a preview that lies, of the class
 * PREVIEW-NUMBERS-AUDIT exists to prevent, and it is invisible to Ram Charge
 * anyway (`chargeHits:"all"` hits everyone the numbers name). The rest of this
 * file is that half, unchanged.
 */

const BASTION = bastion as unknown as CharacterDef;
const KESTREL = kestrel as unknown as CharacterDef;
const VEX = vex as unknown as CharacterDef;
const RAM = BASTION.abilities.find((a) => a.id === 'ram_charge')!;
const HOOK = BASTION.abilities.find((a) => a.id === 'chain_hook')!;
const SKIM = KESTREL.abilities.find((a) => a.id === 'skim')!;
const RAM_DAMAGE = RAM.effects.find((e) => e.kind === 'damage')!.amount!;
const SKIM_DAMAGE = SKIM.effects.find((e) => e.kind === 'damage')!.amount!;
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

/**
 * A charger at (8,10) with two enemies queued east at (9,10) and (10,10), so a
 * charge down the row crosses both. Two is the smallest number that can tell
 * `first` from `all`.
 */
const queued = (charger: CharacterDef) => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[charger, VEX], [VEX, VEX]];
  const state: GameState = createMatch(OPEN_MAP, '2v2', teams);
  const me = state.units.find((u) => u.characterId === charger.id)!;
  const mate = state.units.filter((u) => u.owner === 0).find((u) => u.unitId !== me.unitId)!;
  const foes = state.units.filter((u) => u.owner === 1);
  me.pos = { x: 8, y: 10 };
  foes[0]!.pos = { x: 9, y: 10 };
  foes[1]!.pos = { x: 10, y: 10 };
  mate.pos = { x: 1, y: 1 }; // well clear; this is about the enemies on the route
  startHotSeat(ui.ui, OPEN_MAP, buildRoster([charger, VEX]), teams, '2v2', [1, 1], POOL,
    undefined, undefined, state);
  return { ...ui, state, me, foes };
};

/** The damage numbers the board is showing, as the player reads them. */
const readouts = (): string[] =>
  [...document.querySelectorAll('.readout.preview.damage')].map((n) => n.textContent ?? '');

const key = (p: Vec2): string => `${p.x},${p.y}`;

beforeEach(() => { document.body.replaceChildren(); });

describe('RAM-PREVIEW-REVERT: the charge draws no outline again', () => {
  it('aiming Ram Charge puts nothing on the shape layer', () => {
    // The revert, stated as the assertion it is: this fails on PR #103's
    // preview, where the charge drew a lane per straight run of its route.
    const b = queued(BASTION);
    armAbility(b.controls, RAM.name);
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(b.renderer.draw.shapes, 'no lane polygon for a charge').toEqual([]);
  });

  it('and that is about the shape, not about the harness', () => {
    // The control, because "nothing was drawn" is exactly the assertion that
    // passes for the wrong reason if the recording ever breaks. Same character,
    // same board, same stub: Bastion's Chain Hook is a `line` and still draws
    // its lane, so an empty list above means the charge chose to draw nothing.
    const b = queued(BASTION);
    armAbility(b.controls, HOOK.name);
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(b.renderer.draw.shapes.length, 'a line attack still outlines').toBeGreaterThan(0);
  });

  it('the route tiles are still lit', () => {
    // "How it was before" is not "nothing at all": BASTION-RAM-LINE's preview
    // stands. The tiles the charge covers are still the aim layer's answer.
    const b = queued(BASTION);
    armAbility(b.controls, RAM.name);
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(new Set(layer(b.renderer, 'aim').map(key)).size, 'a run of tiles').toBeGreaterThan(1);
  });

  it('and the landing marker is still there', () => {
    const b = queued(BASTION);
    armAbility(b.controls, RAM.name);
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(layer(b.renderer, 'impact').map(key)).toEqual(['12,10']);
  });

  it('and a chargeHits:"all" charge still numbers EVERY crossed enemy', () => {
    // The third thing "before" had and keeps. Pinned here so a revert that
    // reached one function too far would be caught.
    const b = queued(BASTION);
    armAbility(b.controls, RAM.name);
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(readouts()).toEqual([String(RAM_DAMAGE), String(RAM_DAMAGE)]);
  });
});

describe('RAM-PREVIEW-REVERT keeps the fix: a first-only charge previews one hit', () => {
  it('Kestrel\'s Skim numbers the FIRST enemy on the route and no other', () => {
    // The half that is NOT going back. Skim is `path` with no `chargeHits`, so
    // the engine hits one — and the preview stamped its damage on both. Nothing
    // in the roster sweep could see it: one enemy at a fixed aim reads the same
    // under either rule.
    const b = queued(KESTREL);
    armAbility(b.controls, SKIM.name);
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(SKIM.chargeHits, 'first-only, by omission').toBeUndefined();
    expect(readouts(), 'one number, not two').toEqual([String(SKIM_DAMAGE)]);
  });

  it('and the one it names is the one the engine actually damages', () => {
    // Not just "one number" — the *right* one. Resolved for real and compared,
    // which is the property PREVIEW-NUMBERS-AUDIT holds for every other shape.
    const b = queued(KESTREL);
    const aim = [{ x: 9, y: 10 }, { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }];
    const previewed = chargeHitList(b.state, b.me, SKIM, aim);
    expect(previewed).toHaveLength(1);

    const roster: Roster = buildRoster([KESTREL, VEX]);
    const order: UnitOrders = { unitId: b.me.unitId, ability: { abilityId: SKIM.id, target: aim } };
    const out = resolveTurn(b.state, OPEN_MAP, [
      { team: 0, units: [order] }, { team: 1, units: [] },
    ], roster);
    const damaged = [...new Set(out.events.flatMap((e) =>
      e.type === 'damage' && e.unitId !== b.me.unitId ? [e.unitId] : []))];
    expect(previewed, 'the preview names exactly who was hit').toEqual(damaged);
  });

  it('the two charges disagree, which is the whole point of reading the field', () => {
    // A guard against a fix that hard-coded either rule: the same geometry, two
    // abilities, two different answers.
    const ram = queued(BASTION);
    const aim = [{ x: 9, y: 10 }, { x: 10, y: 10 }];
    expect(chargeHitList(ram.state, ram.me, RAM, aim), 'all').toHaveLength(2);
    document.body.replaceChildren();
    const skim = queued(KESTREL);
    expect(chargeHitList(skim.state, skim.me, SKIM, aim), 'first').toHaveLength(1);
  });

  it('a non-charge shape is not gated at all', () => {
    // The scope line: `chargeHitList` is empty for anything that is not a `path`
    // dash, and `previewNumbers` reads empty as "the area is the answer".
    const b = queued(BASTION);
    const slam = BASTION.abilities.find((a) => a.id === 'crushing_slam')!;
    expect(chargeHitList(b.state, b.me, slam, [{ x: 10, y: 10 }])).toEqual([]);
    expect(chargeHitList(b.state, b.me, undefined, [{ x: 10, y: 10 }])).toEqual([]);
  });
});
