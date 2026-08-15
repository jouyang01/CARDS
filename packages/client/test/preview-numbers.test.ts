import { describe, expect, it } from 'vitest';
import { createMatch, type AbilityDef, type CharacterDef, type GameState, type MapDef } from '@cards/engine';
import { abilityPreview, impactPreview } from '../src/targeting.js';
import { previewNumbers } from '../src/preview-numbers.js';
import vex from '../../../data/characters/vex.json';
import aegis from '../../../data/characters/aegis.json';
import wisp from '../../../data/characters/wisp.json';

/**
 * PREVIEW-NUMBERS — "Players should know what their action is going to do."
 *
 * The arithmetic is trivial; the rule is not. These tests are mostly about
 * **polarity** (FF1): harmful effects reach allies too, beneficial ones do not
 * reach enemies. Getting that backwards produces a preview that is confidently
 * wrong — a green number over an enemy, or silence over the ally you are about
 * to splash — which is worse than no preview at all.
 */

const VEX = vex as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }, { x: 1, y: 5 }], [{ x: 13, y: 7 }, { x: 13, y: 5 }]],
};

const ability = (c: CharacterDef, id: string): AbilityDef =>
  [...c.abilities, c.ultimate].find((a) => a.id === id)!;
const unitOf = (s: GameState, characterId: string, nth = 0) =>
  s.units.filter((u) => u.characterId === characterId)[nth]!;
const at = (s: GameState, unitId: string, x: number, y: number): void => {
  s.units.find((u) => u.unitId === unitId)!.pos = { x, y };
};

/** Vex + Aegis against two Aegis, so both teams have an ally to stand in the way. */
const board = (): GameState => createMatch(OPEN, '2v2', [[VEX, AEGIS], [AEGIS, VEX]]);

/**
 * Everyone in sight. PREVIEW-FOG has its own describe below; the polarity tests
 * are about polarity, so they hand the gate the state where it does nothing.
 */
const allSeen = (s: GameState): Set<string> => new Set(s.units.map((u) => u.unitId));

const numbersFor = (s: GameState, casterId: string, def: AbilityDef, aim: { x: number; y: number }[]) => {
  const caster = s.units.find((u) => u.unitId === casterId)!;
  return previewNumbers(s, caster, [{ def, squares: abilityPreview(OPEN, caster, def, aim) }], allSeen(s));
};

describe('a damaging aim puts a red number on everyone it covers', () => {
  it('previews the nominal damage on an enemy in the area', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    const enemy = s.units.find((u) => u.owner !== vexUnit.owner)!;
    at(s, vexUnit.unitId, 2, 7);
    at(s, enemy.unitId, 7, 7);
    const rail = ability(VEX, 'rail_shot');
    const damage = rail.effects.find((e) => e.kind === 'damage')!.amount!;

    const shown = numbersFor(s, vexUnit.unitId, rail, [{ x: 14, y: 7 }]);
    expect(shown).toContainEqual({ unitId: enemy.unitId, kind: 'damage', amount: damage });
  });

  it('and on an ALLY standing in it — friendly fire is on, and this is the warning', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    const ally = s.units.find((u) => u.owner === vexUnit.owner && u.unitId !== vexUnit.unitId)!;
    at(s, vexUnit.unitId, 2, 7);
    at(s, ally.unitId, 6, 7);
    const shown = numbersFor(s, vexUnit.unitId, ability(VEX, 'rail_shot'), [{ x: 14, y: 7 }]);
    expect(shown.some((n) => n.unitId === ally.unitId && n.kind === 'damage')).toBe(true);
  });

  it('nothing for a unit outside the area, however close', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    const enemy = s.units.find((u) => u.owner !== vexUnit.owner)!;
    at(s, vexUnit.unitId, 2, 7);
    at(s, enemy.unitId, 7, 9); // off the fired row
    expect(numbersFor(s, vexUnit.unitId, ability(VEX, 'rail_shot'), [{ x: 14, y: 7 }])
      .some((n) => n.unitId === enemy.unitId)).toBe(false);
  });

  it('nothing at all for an unaimed ability — an empty area previews nothing', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    expect(previewNumbers(s, vexUnit, [{ def: ability(VEX, 'rail_shot'), squares: [] }], allSeen(s))).toEqual([]);
  });

  it('nothing for a dead unit lying in the area', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    const enemy = s.units.find((u) => u.owner !== vexUnit.owner)!;
    at(s, vexUnit.unitId, 2, 7);
    at(s, enemy.unitId, 7, 7);
    enemy.alive = false;
    expect(numbersFor(s, vexUnit.unitId, ability(VEX, 'rail_shot'), [{ x: 14, y: 7 }])
      .some((n) => n.unitId === enemy.unitId)).toBe(false);
  });
});

describe('beneficial aims stay on your own team', () => {
  it('a shield previews blue on an ally in the area', () => {
    const s = board();
    const caster = unitOf(s, 'aegis');
    const ally = s.units.find((u) => u.owner === caster.owner && u.unitId !== caster.unitId)!;
    at(s, caster.unitId, 5, 7);
    at(s, ally.unitId, 6, 7);
    const pulse = [...AEGIS.abilities].find((a) => a.effects.some((e) => e.kind === 'shield'))!;
    const amount = pulse.effects.find((e) => e.kind === 'shield')!.amount!;

    const shown = numbersFor(s, caster.unitId, pulse, [{ x: 6, y: 7 }]);
    expect(shown).toContainEqual({ unitId: ally.unitId, kind: 'shield', amount });
  });

  it('and shows an enemy standing in the same area nothing', () => {
    const s = board();
    const caster = unitOf(s, 'aegis');
    const enemy = s.units.find((u) => u.owner !== caster.owner)!;
    at(s, caster.unitId, 5, 7);
    at(s, enemy.unitId, 6, 7);
    const pulse = [...AEGIS.abilities].find((a) => a.effects.some((e) => e.kind === 'shield'))!;
    expect(numbersFor(s, caster.unitId, pulse, [{ x: 6, y: 7 }])
      .some((n) => n.unitId === enemy.unitId)).toBe(false);
  });

  it('only the three colours — a status rider is not a number', () => {
    const s = board();
    const caster = unitOf(s, 'aegis');
    at(s, caster.unitId, 5, 7);
    const withRider: AbilityDef = {
      ...ability(AEGIS, AEGIS.ultimate.id),
      shape: 'circle', radius: 1, range: 3, phase: 'blast',
      effects: [{ kind: 'damage', amount: 30 }, { kind: 'slow', duration: 2 }, { kind: 'might', duration: 1 }],
    };
    const shown = previewNumbers(s, caster, [{ def: withRider, squares: [caster.pos] }], allSeen(s));
    // Exactly one number: the damage. Slow and Might are real effects with no
    // amount to show, and inventing a "0" for them would be noise.
    expect(shown).toEqual([{ unitId: caster.unitId, kind: 'damage', amount: 30 }]);
  });
});

describe('several armed actions read as one turn', () => {
  it('sums two damaging areas on the same unit into one number', () => {
    const s = board();
    const caster = unitOf(s, 'vex');
    const enemy = s.units.find((u) => u.owner !== caster.owner)!;
    at(s, caster.unitId, 2, 7);
    at(s, enemy.unitId, 7, 7);
    const a: AbilityDef = { ...ability(VEX, 'rail_shot'), effects: [{ kind: 'damage', amount: 10 }] };
    const b: AbilityDef = { ...ability(VEX, 'rail_shot'), id: 'other', effects: [{ kind: 'damage', amount: 25 }] };
    const shown = previewNumbers(s, caster, [
      { def: a, squares: [enemy.pos] },
      { def: b, squares: [enemy.pos] },
    ], allSeen(s));
    expect(shown.filter((n) => n.unitId === enemy.unitId && n.kind === 'damage'))
      .toEqual([{ unitId: enemy.unitId, kind: 'damage', amount: 35 }]);
  });

  it('keeps damage and shield on one unit as two separate numbers', () => {
    const s = board();
    const caster = unitOf(s, 'aegis');
    const ally = s.units.find((u) => u.owner === caster.owner && u.unitId !== caster.unitId)!;
    at(s, caster.unitId, 5, 7);
    at(s, ally.unitId, 6, 7);
    const hurt: AbilityDef = { ...ability(AEGIS, AEGIS.abilities[0]!.id), effects: [{ kind: 'damage', amount: 12 }] };
    const help: AbilityDef = { ...ability(AEGIS, AEGIS.abilities[0]!.id), id: 'h', effects: [{ kind: 'shield', amount: 20 }] };
    const shown = previewNumbers(s, caster, [
      { def: hurt, squares: [ally.pos] },
      { def: help, squares: [ally.pos] },
    ], allSeen(s)).filter((n) => n.unitId === ally.unitId);
    expect(shown.map((n) => n.kind)).toEqual(['damage', 'shield']);
  });

  it('is ordered deterministically, so a repaint never reshuffles the stack', () => {
    const s = board();
    const caster = unitOf(s, 'vex');
    const squares = s.units.map((u) => u.pos);
    const def: AbilityDef = { ...ability(VEX, 'rail_shot'), effects: [{ kind: 'damage', amount: 5 }] };
    const once = previewNumbers(s, caster, [{ def, squares }], allSeen(s));
    const twice = previewNumbers(s, caster, [{ def, squares }], allSeen(s));
    expect(once).toEqual(twice);
    expect(once.map((n) => n.unitId)).toEqual(s.units.map((u) => u.unitId));
  });
});

describe("a dash previews where it DETONATES, not where it lands", () => {
  it("Shadowstep Strike numbers the units inside its impact disc", () => {
    const s = createMatch(OPEN, '2v2', [[WISP, VEX], [AEGIS, VEX]]);
    const caster = unitOf(s, 'wisp');
    const enemy = s.units.find((u) => u.owner !== caster.owner)!;
    at(s, caster.unitId, 2, 7);
    const landing = { x: 6, y: 7 };
    at(s, enemy.unitId, 6, 8); // adjacent to the landing square, not on it

    const strike = ability(WISP, 'shadowstep_strike');
    const impact = impactPreview(OPEN, caster, strike, [landing]);
    const shown = previewNumbers(s, caster, [{
      def: strike,
      squares: [...abilityPreview(OPEN, caster, strike, [landing]), ...impact.origin, ...impact.destination],
    }], allSeen(s));
    const damage = strike.effects.find((e) => e.kind === 'damage')!.amount!;
    expect(shown).toContainEqual({ unitId: enemy.unitId, kind: 'damage', amount: damage });
  });
});
