// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch, resolveTurn, truncateAtImpact,
  type AbilityDef, type CatalystData, type CharacterDef, type GameState, type MapDef,
  type Roster, type UnitState, type Vec2,
} from '@cards/engine';
import { abilityPreview } from '../src/targeting.js';
import { startHotSeat } from '../src/app.js';
import { aimAndCommit, armAbility, layer, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import wisp from '../../../data/characters/wisp.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * BOLA-OVERLAY — **the drawn line stops where the bola stops.**
 *
 * Owner (W2, the UI consequence): *"the drawn line overlay must TERMINATE AT THE
 * IMPACT POINT, not extend to the full range 6 — otherwise the overlay promises
 * reach the ability no longer has."*
 *
 * The fix is not a shorter line drawn over a longer area — it is that the area
 * genuinely ends there. `truncateAtImpact` is applied where the engine builds
 * `PlannedAbility.area`, so one truncation feeds the resolver, the
 * `abilityFired` event the client animates, and the aim overlay a player hovers.
 * These tests check the last of those, through the real controller, because the
 * overlay is the thing the owner is looking at.
 */

const WISP = wisp as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const roster: Roster = buildRoster([WISP, BASTION]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const BOLA: AbilityDef = WISP.abilities.find((a) => a.id === 'bola')!;
const K = (p: Vec2): string => `${p.x},${p.y}`;

/** Open, and wide enough that range 6 never runs out of board. */
const MAP: MapDef = {
  id: 'lane', name: 'lane', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 4, y: 10 }, { x: 4, y: 12 }], [{ x: 16, y: 10 }, { x: 16, y: 12 }]],
};
const EAST: Vec2 = { x: 20, y: 10 };

/** Wisp at (4,10), the enemy wherever the case wants them on row 10. */
const field = (foeAt: Vec2): { state: GameState; me: UnitState } => {
  const state = createMatch(MAP, '1v1', [[WISP], [BASTION]]);
  const me = state.units.find((u) => u.owner === 0)!;
  const foe = state.units.find((u) => u.owner === 1)!;
  me.pos = { x: 4, y: 10 };
  foe.pos = { ...foeAt };
  return { state, me };
};

describe('BOLA-OVERLAY: the beam is drawn to the impact point', () => {
  it('THE ITEM: with an enemy three tiles east, the overlay stops on them', () => {
    const { state, me } = field({ x: 7, y: 10 });
    const drawn = abilityPreview(MAP, me, BOLA, [EAST], undefined, state).map(K);
    expect(drawn, 'up to and including the enemy').toEqual(['5,10', '6,10', '7,10']);
  });

  it('THE PROMISE IT NO LONGER MAKES: it does not run on to full range', () => {
    // Range 6 from (4,10) reaches (10,10). The four tiles past the impact are
    // the "reach the ability no longer has", and drawing them is the bug.
    const { state, me } = field({ x: 7, y: 10 });
    const drawn = new Set(abilityPreview(MAP, me, BOLA, [EAST], undefined, state).map(K));
    for (const x of [8, 9, 10]) {
      expect(drawn.has(`${x},10`), `${x},10 is behind the impact`).toBe(false);
    }
  });

  it('THE CONTROL: with nobody in the beam it draws the full range', () => {
    // "If no enemy is in the line, it draws to full range (nothing to stop
    // it)" — the AC's own words, and the pair that keeps the assertion above
    // about the impact rather than about the line being short.
    const { state, me } = field({ x: 4, y: 18 }); // off the row entirely
    const drawn = abilityPreview(MAP, me, BOLA, [EAST], undefined, state).map(K);
    expect(drawn).toEqual(['5,10', '6,10', '7,10', '8,10', '9,10', '10,10']);
  });

  it('the nearer of two enemies is the one it stops on', () => {
    const { state, me } = field({ x: 6, y: 10 });
    const other = state.units.find((u) => u.owner === 1)!;
    state.units.push({ ...other, unitId: 'far', pos: { x: 9, y: 10 } });
    const drawn = abilityPreview(MAP, me, BOLA, [EAST], undefined, state).map(K);
    expect(drawn).toEqual(['5,10', '6,10']);
  });

  it('an ALLY does not stop it — the overlay runs past a teammate', () => {
    // The drawn line has to agree with the ruling that allies never block or
    // absorb, or the overlay would tell the player their own teammate is a wall.
    const state = createMatch(MAP, '2v2', [[WISP, WISP], [BASTION, BASTION]]);
    const [me, mate] = state.units.filter((u) => u.owner === 0);
    const [foe] = state.units.filter((u) => u.owner === 1);
    me!.pos = { x: 4, y: 10 };
    mate!.pos = { x: 6, y: 10 };   // in the way
    foe!.pos = { x: 8, y: 10 };
    state.units.filter((u) => u.owner === 1)[1]!.pos = { x: 18, y: 18 };
    const drawn = abilityPreview(MAP, me!, BOLA, [EAST], undefined, state).map(K);
    expect(drawn, 'through the ally, up to the enemy')
      .toEqual(['5,10', '6,10', '7,10', '8,10']);
  });
});

describe('BOLA-OVERLAY: the drawn beam IS the resolved beam', () => {
  it('the overlay matches the engine’s own abilityFired area, tile for tile', () => {
    // The parity that makes this one rule rather than two: the truncation lives
    // where `PlannedAbility.area` is built, so the client is not shortening a
    // line the engine still thinks is long. If these ever disagree, the
    // overlay has grown its own opinion.
    const { state, me } = field({ x: 7, y: 10 });
    const drawn = abilityPreview(MAP, me, BOLA, [EAST], undefined, state).map(K);
    const { events } = resolveTurn(state, MAP, [
      { team: 0, units: [{ unitId: me.unitId, ability: { abilityId: 'bola', target: [EAST] } }] },
      { team: 1, units: [] },
    ], roster);
    const fired = events.find((e) => e.type === 'abilityFired' && e.abilityId === 'bola');
    expect(fired).toBeDefined();
    expect(fired!.type === 'abilityFired' ? fired!.area.map(K) : []).toEqual(drawn);
  });

  it('`truncateAtImpact` leaves a piercing line alone', () => {
    // The scope line, at the primitive. A beam with nothing to stop it comes
    // back byte-identical, so no other ability in the roster is shortened.
    const { state, me } = field({ x: 7, y: 10 });
    const rail = { ...BOLA, hits: undefined } as AbilityDef;
    const full = abilityPreview(MAP, me, rail, [EAST]);
    expect(truncateAtImpact(rail, me.owner, full, state.units).map(K)).toEqual(full.map(K));
  });
});

describe('BOLA-OVERLAY: through the real controller', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('THE PLAYER’S VIEW: arming Bola and aiming east draws a beam that stops', () => {
    // The whole chain — hotbar button, board hover, `aim` layer — because the
    // owner's report is about what is on screen, not about a function's return
    // value. `aim` is the layer the line overlay is drawn into.
    const ui = mountUI();
    const teams: [CharacterDef[], CharacterDef[]] = [[WISP], [BASTION]];
    const opening = createMatch(MAP, '1v1', teams);
    opening.units.find((u) => u.owner === 0)!.pos = { x: 4, y: 10 };
    opening.units.find((u) => u.owner === 1)!.pos = { x: 7, y: 10 };
    startHotSeat(ui.ui, MAP, roster, teams, '1v1', [1, 1], POOL, undefined, undefined, opening);

    armAbility(ui.controls, 'Bola');
    aimAndCommit(ui.board, EAST);

    const lit = new Set(layer(ui.renderer, 'aim').map(K));
    expect(lit.size, 'the bola is armed and aimed').toBeGreaterThan(0);
    expect(lit.has('7,10'), 'the impact tile is lit').toBe(true);
    expect(lit.has('8,10'), 'and nothing behind it is').toBe(false);
    expect(lit.has('10,10'), 'least of all the far end of the range').toBe(false);
  });
});
