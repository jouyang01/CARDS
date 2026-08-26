import { describe, expect, it } from 'vitest';
import {
  buildBoard, buildRoster, createMatch, resolveTurn,
  type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster,
  type UnitState, type Vec2,
} from '@cards/engine';
import { abilityHitList, abilityPreview } from '../src/targeting.js';
import { previewNumbers } from '../src/preview-numbers.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * HITS, preview parity — **the number a stopping line writes is the number it
 * deals.**
 *
 * The half of HITS-RENAME that is not the rename. A `hits: "first"` line reaches
 * through the beam and affects exactly one unit, so "is this unit in the
 * footprint" stops being the same question as "is this unit hit" — and that gap
 * is precisely where RAM-LINE-PREVIEW-FIX found the preview lying about charges,
 * stamping a damage number on every enemy on a route that hits one.
 *
 * Both sides go through the engine's `lineImpact`, so there is no second
 * implementation to drift.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;

/** A stopping bola and its piercing twin, otherwise identical. */
const line = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 20 }], description: over.id, ...over,
});
const BOLA = line({ id: 'bola', hits: 'first' });
const BEAM = line({ id: 'beam' });

const THROWER: CharacterDef = { ...VEX, id: 'thrower', abilities: [BOLA, BEAM] };
const roster: Roster = buildRoster([THROWER, BASTION]);

const MAP: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 10 }, { x: 2, y: 12 }], [{ x: 18, y: 10 }, { x: 18, y: 12 }]],
};
const BOARD = buildBoard(MAP);
const CASTER_AT: Vec2 = { x: 4, y: 10 };
const EAST: Vec2 = { x: 20, y: 10 };

/** The thrower at (4,10) with two enemies in a row east of them. */
const field = (): { state: GameState; me: UnitState; near: UnitState; far: UnitState } => {
  const state = createMatch(MAP, '2v2', [[THROWER, THROWER], [BASTION, BASTION]]);
  const [me, mate] = state.units.filter((u) => u.owner === 0);
  const [near, far] = state.units.filter((u) => u.owner === 1);
  me!.pos = { ...CASTER_AT };
  mate!.pos = { x: 4, y: 18 };
  near!.pos = { x: 7, y: 10 };
  far!.pos = { x: 10, y: 10 };
  return { state, me: me!, near: near!, far: far! };
};

/** The preview's damage number for one unit, built exactly as `app.ts` builds it. */
const previewed = (
  state: GameState, me: UnitState, def: AbilityDef, targetId: string,
): number => previewNumbers(state, BOARD, me, [{
  def,
  squares: abilityPreview(MAP, me, def, [EAST]),
  // Exactly `app.ts`'s composition: an absent list means "the area is the
  // answer", an empty one means "numbered nobody". Passing `[]` through for a
  // piercing line is what blanked Rail Shot's numbers when this was written.
  ...(abilityHitList(MAP, state, me, def, [EAST]) === undefined
    ? {}
    : { victims: abilityHitList(MAP, state, me, def, [EAST])! }),
}], new Set(state.units.map((u) => u.unitId)))
  .filter((n) => n.targetId === targetId && n.kind === 'damage')
  .reduce((sum, n) => sum + n.amount, 0);

/** What the engine actually deals to one unit on this turn. */
const resolved = (
  state: GameState, me: UnitState, def: AbilityDef, targetId: string,
): number => {
  const before = state.units.find((u) => u.unitId === targetId)!.hp;
  const after = resolveTurn(state, MAP, [
    { team: 0, units: [{ unitId: me.unitId, ability: { abilityId: def.id, target: [EAST] } }] },
    { team: 1, units: [] },
  ], roster).state;
  return before - after.units.find((u) => u.unitId === targetId)!.hp;
};

describe('HITS: a stopping line previews one number, and it is the right one', () => {
  it('THE ITEM: the near enemy is numbered and the far one is not', () => {
    const { state, me, near, far } = field();
    expect(previewed(state, me, BOLA, near.unitId), 'the bola stops here').toBeGreaterThan(0);
    expect(previewed(state, me, BOLA, far.unitId), 'and never reaches here').toBe(0);
  });

  it('and both numbers match what the turn actually deals', () => {
    // The parity assertion, per unit rather than per total: a preview that got
    // the sum right by numbering the wrong enemy would pass a whole-area check.
    const { state, me, near, far } = field();
    for (const target of [near, far]) {
      expect(previewed(state, me, BOLA, target.unitId), target.unitId)
        .toBe(resolved(state, me, BOLA, target.unitId));
    }
  });

  it('THE CONTROL: a piercing line still numbers both, and still hits both', () => {
    // What keeps the assertion above about `hits` rather than about lines.
    const { state, me, near, far } = field();
    for (const target of [near, far]) {
      const shown = previewed(state, me, BEAM, target.unitId);
      expect(shown, `${target.unitId} is numbered`).toBeGreaterThan(0);
      expect(shown, `${target.unitId} parity`).toBe(resolved(state, me, BEAM, target.unitId));
    }
  });

  it('the footprint is unchanged — the beam is DRAWN full length here', () => {
    // Deliberate scope line. HITS decides who is *hit*; truncating the drawn
    // overlay is BOLA-OVERLAY's job and has its own tests. If this ever starts
    // failing, the two items have been conflated.
    const { state, me } = field();
    void state;
    expect(abilityPreview(MAP, me, BOLA, [EAST]).length)
      .toBe(abilityPreview(MAP, me, BEAM, [EAST]).length);
  });
});

describe('HITS: an ally in the beam is not numbered and does not stop it', () => {
  it('the shot flies past a teammate to the first enemy', () => {
    const { state, me, near } = field();
    // Put the thrower's partner directly in front of the near enemy.
    state.units.filter((u) => u.owner === 0 && u.unitId !== me.unitId)[0]!.pos = { x: 6, y: 10 };
    const mate = state.units.find((u) => u.owner === 0 && u.unitId !== me.unitId)!;
    expect(previewed(state, me, BOLA, mate.unitId), 'no number over the ally').toBe(0);
    expect(previewed(state, me, BOLA, near.unitId), 'the enemy behind them is numbered')
      .toBeGreaterThan(0);
    expect(previewed(state, me, BOLA, near.unitId)).toBe(resolved(state, me, BOLA, near.unitId));
  });
});

describe('HITS: abilityHitList is empty where the footprint is the answer', () => {
  it('a piercing line needs no list, and neither does a cone', () => {
    // The contract that lets `app.ts` pass the result through without asking
    // what shape it has: empty means "everyone in the area".
    const { state, me } = field();
    // `undefined`, not `[]` — see the note on `abilityHitList`. An empty array
    // would mean "this ability restricts its victims, and there are none",
    // which blanks every number the beam should have written.
    expect(abilityHitList(MAP, state, me, BEAM, [EAST])).toBeUndefined();
    const cone: AbilityDef = { ...BEAM, shape: 'cone' };
    expect(abilityHitList(MAP, state, me, cone, [EAST])).toBeUndefined();
    expect(abilityHitList(MAP, state, me, undefined, [EAST])).toBeUndefined();
  });

  it('and names exactly one unit for a stopping line', () => {
    const { state, me, near } = field();
    expect(abilityHitList(MAP, state, me, BOLA, [EAST])).toEqual([near.unitId]);
  });
});
