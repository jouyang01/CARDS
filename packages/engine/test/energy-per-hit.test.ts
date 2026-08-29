import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PASSIVE_ENERGY } from '../src/constants.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { buildRoster } from '../src/setup.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { CharacterDef, GameState, MapDef, UnitOrders, Vec2 } from '../src/types.js';

/**
 * ENERGY-PER-HIT — **an ability is paid per unit it landed on, not per cast.**
 *
 * Owner Dev Notes (2026-08-29):
 *
 *   1. *"Energy on attacks should give energy only if it hits the enemy unit. If
 *      it hits multiple it should give multiple ticks of energy… if Vex's rail
 *      shot hits two enemies, it should give a total of 16 energy + the 5 energy
 *      per turn."* Caveat: *"hitting allies with damaging skills should NOT give
 *      energy. (Lumen's auto attack is a heal for allies and damage for enemies
 *      and so it should give energy accordingly)."*
 *   2. *"Energy on heals/shields should give energy only if it hits allied
 *      units. If it hits multiple it should give multiple ticks."*
 *
 * The rule underneath both: the unit of payment is a **recipient** — an enemy
 * that took something harmful, or an ally that took something good. That is what
 * makes the two notes one change and what makes Lumen fall out of it rather than
 * needing a case of her own.
 *
 * Driven through `resolveTurn` on the **shipped** kits, because the numbers in
 * the notes are the shipped numbers: Rail Shot really is `energyGain: 8`, the
 * passive really is 5, and 16 + 5 is a claim about the game rather than about a
 * fixture.
 */

const read = (id: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, `../../../data/characters/${id}.json`), 'utf8'),
) as CharacterDef;

const VEX = read('vex');
const LUMEN = read('lumen');
const roster: Roster = buildRoster([VEX, LUMEN]);

/** Open floor, wide enough for a range-8 line. */
const FIELD: MapDef = makeMap(Array.from({ length: 7 }, () => '.'.repeat(14)));

/** Resolve one turn of team 0's orders and report the caster's energy. */
const energyAfter = (
  units: GameState['units'], orders: UnitOrders[], casterId = 'me',
): number => {
  const { state } = resolveTurn(makeState(units), FIELD, [
    { team: 0, units: orders },
    { team: 1, units: [] },
  ], roster);
  return state.units.find((u) => u.unitId === casterId)!.energy;
};

const at = (id: string, owner: 0 | 1, x: number, y: number, characterId: string, over = {}) =>
  makeUnit(id, owner, { x, y }, { characterId, ...over });

/** Aim a `line` down row 3, past everything. */
const EAST: Vec2 = { x: 13, y: 3 };
const shoot = (abilityId: string): UnitOrders =>
  ({ unitId: 'me', ability: { abilityId, target: [EAST] } });

describe('ENERGY-PER-HIT: the owner’s own example', () => {
  it('THE NOTE: Vex’s Rail Shot through TWO enemies pays 16, plus the 5 passive', () => {
    expect(energyAfter([
      at('me', 0, 1, 3, 'vex'),
      at('e1', 1, 3, 3, 'vex'),
      at('e2', 1, 5, 3, 'vex'),
    ], [shoot('rail_shot')])).toBe(8 + 8 + PASSIVE_ENERGY);
  });

  it('one enemy pays 8 — the old behaviour, unchanged where it was already right', () => {
    expect(energyAfter([
      at('me', 0, 1, 3, 'vex'),
      at('e1', 1, 3, 3, 'vex'),
    ], [shoot('rail_shot')])).toBe(8 + PASSIVE_ENERGY);
  });

  it('and a shot down an empty row pays nothing but the passive', () => {
    // The floor. "Only if it hits the enemy unit" is the half that keeps energy
    // from being a reward for pressing the button.
    expect(energyAfter([
      at('me', 0, 1, 3, 'vex'),
      at('e1', 1, 3, 0, 'vex'),
    ], [shoot('rail_shot')])).toBe(PASSIVE_ENERGY);
  });

  it('THE CAVEAT: an ALLY in the beam is damaged and pays nothing', () => {
    // *"hitting allies with damaging skills should NOT give energy."* FF1 means
    // Rail Shot really does hurt the teammate standing in it — the damage is
    // unchanged — and the payment is the part that is enemies-only.
    const units = [
      at('me', 0, 1, 3, 'vex'),
      at('mate', 0, 3, 3, 'vex'),
      at('e1', 1, 5, 3, 'vex'),
    ];
    expect(energyAfter(units, [shoot('rail_shot')]), 'the enemy alone').toBe(8 + PASSIVE_ENERGY);
    const { state } = resolveTurn(makeState(units), FIELD, [
      { team: 0, units: [shoot('rail_shot')] }, { team: 1, units: [] },
    ], roster);
    expect(state.units.find((u) => u.unitId === 'mate')!.hp, 'and was hurt all the same')
      .toBeLessThan(100);
  });
});

describe('ENERGY-PER-HIT: heals and shields pay per ALLY', () => {
  it('Mending Light over two allies pays twice', () => {
    // `mending_light` is a Prep `circle`, `energyGain: 6`. The caster stands in
    // her own disc, so she is one of the two allies it reaches.
    const heal = LUMEN.abilities.find((a) => a.id === 'mending_light')!;
    expect(energyAfter([
      at('me', 0, 5, 3, 'lumen'),
      at('mate', 0, 6, 3, 'lumen', { hp: 40 }),
      at('e1', 1, 13, 0, 'lumen'),
    ], [{ unitId: 'me', ability: { abilityId: 'mending_light', target: [{ x: 5, y: 3 }] } }]))
      .toBe(heal.energyGain * 2 + PASSIVE_ENERGY);
  });

  it('…and over nobody pays nothing — a heal aimed at empty ground earns none', () => {
    expect(energyAfter([
      at('me', 0, 1, 3, 'lumen'),
      at('e1', 1, 13, 0, 'lumen'),
    ], [{ unitId: 'me', ability: { abilityId: 'mending_light', target: [{ x: 5, y: 6 }] } }]))
      .toBe(PASSIVE_ENERGY);
  });
});

describe('ENERGY-PER-HIT: an ability that is both, at once', () => {
  it('LUMEN’S AUTO ATTACK: Radiant Lash pays for the enemy it burns AND the ally it heals', () => {
    // The owner's named case: *"a heal for allies and damage for enemies and so
    // it should give energy accordingly."* `radiant_lash` is `noFriendlyFire`,
    // so the ally in the beam takes the heal and not the damage — and both
    // recipients are counted, out of one tally, because the rule is about who
    // was reached rather than about which half of the kit reached them.
    const lash = LUMEN.abilities.find((a) => a.id === 'radiant_lash')!;
    expect(energyAfter([
      at('me', 0, 1, 3, 'lumen'),
      at('mate', 0, 3, 3, 'lumen', { hp: 40 }),
      at('e1', 1, 5, 3, 'lumen'),
    ], [shoot('radiant_lash')])).toBe(lash.energyGain * 2 + PASSIVE_ENERGY);
  });

  it('the same lash with only the ally in it still pays — for the heal, not the damage', () => {
    // The half that proves the two sides are counted separately rather than
    // "somebody was in the beam". No enemy at all, and it is still paid once.
    const lash = LUMEN.abilities.find((a) => a.id === 'radiant_lash')!;
    expect(energyAfter([
      at('me', 0, 1, 3, 'lumen'),
      at('mate', 0, 3, 3, 'lumen', { hp: 40 }),
      at('e1', 1, 13, 0, 'lumen'),
    ], [shoot('radiant_lash')])).toBe(lash.energyGain + PASSIVE_ENERGY);
  });
});

describe('ENERGY-PER-HIT: what is deliberately NOT per-hit', () => {
  it('a blink still pays its flat tick, having nobody to land on', () => {
    // Placement and travel earn the act, not a recipient: a teleport, a trap, a
    // decoy. Without this exception every utility ability in the roster would
    // silently stop paying, which is not what either note asked for.
    const roll = VEX.abilities.find((a) => a.id === 'combat_roll')!;
    expect(energyAfter([
      at('me', 0, 1, 3, 'vex'),
      at('e1', 1, 13, 0, 'vex'),
    ], [{ unitId: 'me', ability: { abilityId: 'combat_roll', target: [{ x: 2, y: 3 }, { x: 3, y: 3 }] } }]))
      .toBe(roll.energyGain + PASSIVE_ENERGY);
  });

  it('the passive drip is 5 whatever happened, and is not multiplied by anything', () => {
    // Named because every expectation in this file adds it, and a change to it
    // would move all of them together and look like the per-hit rule breaking.
    expect(energyAfter([
      at('me', 0, 1, 3, 'vex'),
      at('e1', 1, 13, 0, 'vex'),
    ], [])).toBe(PASSIVE_ENERGY);
  });
});

describe('ENERGY-PER-HIT: Energized floors each tick, not the sum', () => {
  it('two ticks under Energized are floored separately', () => {
    // The one place "multiple ticks" and "multiply the number" disagree, so the
    // arithmetic is pinned rather than left to whichever reading came first.
    // Rail Shot's 8 at +50% is 12 a tick: 24 for two, which happens to equal
    // floor(16 x 1.5) — so the claim is made where it can be seen, on a base
    // that does not divide evenly.
    const odd: CharacterDef = {
      ...VEX,
      id: 'oddvex',
      abilities: VEX.abilities.map((a) => (a.id === 'rail_shot' ? { ...a, energyGain: 5 } : a)),
    };
    const { state } = resolveTurn(makeState([
      at('me', 0, 1, 3, 'oddvex', { statuses: [{ kind: 'energized', remaining: 2 }] }),
      at('e1', 1, 3, 3, 'oddvex'),
      at('e2', 1, 5, 3, 'oddvex'),
    ]), FIELD, [
      { team: 0, units: [shoot('rail_shot')] }, { team: 1, units: [] },
    ], buildRoster([odd]));
    // floor(5 x 1.5) = 7, twice = 14 — NOT floor(10 x 1.5) = 15.
    expect(state.units.find((u) => u.unitId === 'me')!.energy).toBe(7 + 7 + PASSIVE_ENERGY);
  });
});
