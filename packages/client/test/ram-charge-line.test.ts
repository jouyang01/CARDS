// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch, resolveTurn,
  type CatalystData, type CharacterDef, type GameState, type Roster, type UnitOrders, type Vec2,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { chargeHitList } from '../src/targeting.js';
import { boundaryContains } from '../src/aim-boundary.js';
import { OPEN_MAP, aimAt, armAbility, layer, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import bastion from '../../../data/characters/bastion.json';
import kestrel from '../../../data/characters/kestrel.json';
import vex from '../../../data/characters/vex.json';

/**
 * RAM-LINE-PREVIEW-FIX — *"Bastion's Ram Charge is still not a linear dash/attack
 * preview."*
 *
 * The backlog's diagnosis was that nothing marked the crossed enemies and no
 * damage number showed along the line. **That turned out not to be what was
 * wrong** — driving the real controller shows the route lit and a `15` stamped on
 * each crossed enemy, and has done since BASTION-RAM-LINE. Two other things were,
 * and both are real:
 *
 * **1. A charge drew no outline at all.** Every attack shape has drawn its
 * continuous locus since AIM-PREVIEW-TRUE — a line gets a lane, a cone a wedge,
 * a circle a disc — and `path` returned `[]`. So the charge was tiles and a
 * route line with nothing on the shape layer, which is precisely the difference
 * between "an attack that covers this lane" and "a way to walk over there". It
 * now draws one lane per straight run of its route.
 *
 * **2. The numbers ignored `chargeHits`.** The route covers everybody standing
 * on it, but `chargeHits` decides how many of them are hit — `"all"` for Ram
 * Charge and Tempest Run, first-only for everything else. Kestrel's Skim was
 * stamping 12 on *every* enemy on the route and hitting one. That is a preview
 * that lies, in the class PREVIEW-NUMBERS-AUDIT exists to prevent; the audit
 * never saw it because it sweeps one enemy at a fixed aim, and one enemy cannot
 * tell "first" from "all".
 *
 * Both fixes read the engine: `chargedUnits` finds who is on the route and
 * `chargeVictims` applies ALLY-SAFE and `chargeHits`, and `runDash` now calls the
 * same two functions it did inline before.
 */

const BASTION = bastion as unknown as CharacterDef;
const KESTREL = kestrel as unknown as CharacterDef;
const VEX = vex as unknown as CharacterDef;
const RAM = BASTION.abilities.find((a) => a.id === 'ram_charge')!;
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

describe('RAM-LINE-PREVIEW-FIX: the charge reads as a line attack', () => {
  it('draws a continuous outline down its route, like a line attack does', () => {
    // The fix. On `main` this is zero: `path` was the only attack shape with
    // nothing on the shape layer, which is what made it read as a route.
    const b = queued(BASTION);
    armAbility(b.controls, RAM.name);
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(b.renderer.draw.shapes.length, 'an outline was drawn').toBeGreaterThan(0);
  });

  it('and the outline contains exactly the tiles the charge covers', () => {
    // AIM-PREVIEW-TRUE's standing rule, earned for the new outline rather than
    // assumed: a tile lights iff its centre is inside the drawn figure.
    const b = queued(BASTION);
    armAbility(b.controls, RAM.name);
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    const lit = new Set(layer(b.renderer, 'aim').map(key));
    expect(lit.size, 'a run of tiles').toBeGreaterThan(1);
    // Every lit tile is inside some drawn lane…
    for (const k of lit) {
      const [x, y] = k.split(',').map(Number);
      const hit = b.renderer.draw.shapes.some((o) => boundaryContains(o, { x: x!, y: y! }));
      expect(hit, `lit tile ${k} inside the outline`).toBe(true);
    }
    // …and the caster's own square, which the charge does not cover, is not.
    const casterInside = b.renderer.draw.shapes.some((o) => boundaryContains(o, { x: 8, y: 10 }));
    expect(casterInside, 'the caster is not inside its own charge').toBe(false);
  });

  it('marks EVERY crossed enemy for a chargeHits:"all" charge', () => {
    // The half that already worked, pinned so the `chargeHits` gate below cannot
    // over-correct and take it away.
    const b = queued(BASTION);
    armAbility(b.controls, RAM.name);
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(readouts()).toEqual([String(RAM_DAMAGE), String(RAM_DAMAGE)]);
  });

  it('and the landing marker is still there', () => {
    const b = queued(BASTION);
    armAbility(b.controls, RAM.name);
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(layer(b.renderer, 'impact').map(key)).toEqual(['12,10']);
  });
});

describe('RAM-LINE-PREVIEW-FIX: a first-only charge previews one hit', () => {
  it('Kestrel\'s Skim numbers the FIRST enemy on the route and no other', () => {
    // The lie. Skim is `path` with no `chargeHits`, so the engine hits one — and
    // the preview was stamping 12 on both. Nothing in the roster sweep could see
    // it: one enemy at a fixed aim reads the same under either rule.
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
