import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import type { CharacterDef, MapDef, Vec2 } from '../src/types.js';

/**
 * RAVOK-RECOIL — *"Ravok whirling cleave should do 11 damage to himself."*
 *
 * One data field: `selfDamagePct: 50` on `cleave`, and the RECOIL mechanic that
 * already carries Seismic Rupture does the rest. No engine change, which is the
 * point — a character's numbers are the Designer's and a balance ask that
 * needed code would mean the mechanic was authored wrong.
 *
 * So what is there to test? That the three Ravok blasts hold **three different
 * positions** at once, because that is the shape of the ruling and it is easy to
 * collapse by accident:
 *
 * | ability | enemies | Ravok |
 * |---|---|---|
 * | Whirling Cleave | 22 | **11** |
 * | Shockwave | 12 | **nothing** |
 * | Seismic Rupture | 38 | **19** |
 *
 * Shockwave sitting between the other two is the whole guard. A future "melee
 * discs cost their caster half" generalisation would pass a test that only
 * looked at Cleave, and would be wrong.
 *
 * The numbers are read from the shipped JSON rather than typed in twice, so a
 * rebalance moves them here without a Builder edit — but the *ratios* and the
 * bare fact of Shockwave's absence are asserted literally, because those are the
 * ruling rather than the balance.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const RAVOK = load('ravok');
const VEX = load('vex');

const CLEAVE = RAVOK.abilities.find((a) => a.id === 'cleave')!;
const SHOCKWAVE = RAVOK.abilities.find((a) => a.id === 'shockwave')!;
const SEISMIC = RAVOK.ultimate;

const OPEN: MapDef = {
  id: 't', name: 't', width: 25, height: 25, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 12 }, { x: 3, y: 12 }], [{ x: 22, y: 12 }, { x: 21, y: 12 }]],
};
const roster: Roster = { ravok: RAVOK, vex: VEX };

/** Ravok at (10,10) with one enemy `at`, and the other parked out of every area. */
const field = (at: Vec2) => {
  const state = createMatch(OPEN, '1v1', [[RAVOK], [VEX]]);
  const ravok = state.units.find((u) => u.characterId === 'ravok')!;
  const enemy = state.units.find((u) => u.owner === 1)!;
  ravok.pos = { x: 10, y: 10 };
  enemy.pos = { ...at };
  return { state, ravok, enemy };
};

const swing = (abilityId: string, at: Vec2) => {
  const { state, ravok, enemy } = field(at);
  ravok.energy = 100; // enough for the ultimate; harmless for the rest
  const after = resolveTurn(state, OPEN, [
    { team: 0, units: [{ unitId: ravok.unitId, ability: { abilityId, target: [{ ...ravok.pos }] } }] },
    { team: 1, units: [] },
  ], roster).state;
  return {
    self: RAVOK.maxHp - after.units.find((u) => u.unitId === ravok.unitId)!.hp,
    foe: VEX.maxHp - after.units.find((u) => u.unitId === enemy.unitId)!.hp,
  };
};

/** What the data says the caster pays: `floor(amount × pct / 100)`, or 0. */
const authoredRecoil = (amount: number, pct: number | undefined): number =>
  pct === undefined ? 0 : Math.floor((amount * pct) / 100);

const damageOf = (a: { effects: readonly { kind: string; amount?: number }[] }): number =>
  a.effects.find((e) => e.kind === 'damage')!.amount!;

describe('RAVOK-RECOIL: Whirling Cleave costs Ravok 11', () => {
  it('the data carries the field, and it is the same 50% Seismic already used', () => {
    // Asserted on the JSON directly: this item IS a data change, and a test
    // that only checked the resolved number would pass just as well if somebody
    // hard-coded 11 into the engine.
    expect(CLEAVE.selfDamagePct, 'the one new field').toBe(50);
    expect(SEISMIC.selfDamagePct, 'and the ultimate is untouched').toBe(50);
    expect(authoredRecoil(damageOf(CLEAVE), CLEAVE.selfDamagePct)).toBe(11);
  });

  it('resolves as 22 to the adjacent enemy and 11 to Ravok', () => {
    const { self, foe } = swing('cleave', { x: 11, y: 10 });
    expect(foe, 'the enemy takes the authored damage').toBe(22);
    expect(self, 'and Ravok takes half of it, floored').toBe(11);
  });

  it('Shockwave still costs him nothing — 12 out, 0 back', () => {
    // The ruling's middle position, and the one a careless generalisation eats.
    expect(SHOCKWAVE.selfDamagePct, 'no field on the stomp').toBeUndefined();
    const { self, foe } = swing('shockwave', { x: 11, y: 10 });
    expect(foe).toBe(12);
    expect(self, 'CASTER-SAFE, undisturbed').toBe(0);
  });

  it('Seismic Rupture is unchanged at 38 out, 19 back', () => {
    const { self, foe } = swing('seismic_rupture', { x: 13, y: 10 });
    expect(foe).toBe(38);
    expect(self).toBe(19);
  });

  it('and the recoil is paid even when the swing hits nobody', () => {
    // A whiff still costs 11: the recoil is the price of swinging, not a share
    // of what landed. Worth pinning because "scale it by the damage dealt" is
    // the obvious wrong reading of "50%".
    const { self, foe } = swing('cleave', { x: 24, y: 1 });
    expect(foe, 'nobody in reach').toBe(0);
    expect(self, 'he swung anyway').toBe(11);
  });

  it('the description tells the player the number the engine will charge', () => {
    // The tell the player reads before committing. Seismic's already named its
    // 19; a Cleave that quietly took 11 would be the same bug PREVIEW-NUMBERS
    // -AUDIT is about, one layer further out.
    expect(CLEAVE.description).toContain('11');
    expect(SHOCKWAVE.description, 'and the one that costs nothing says nothing')
      .not.toMatch(/Ravok takes/);
  });
});
