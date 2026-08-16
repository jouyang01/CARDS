import { describe, expect, it } from 'vitest';
import { buildBoard, createMatch, type AbilityDef, type CharacterDef, type GameState, type MapDef } from '@cards/engine';
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

/** PREVIEW-MODIFIERS: cover lives on the board, so the preview needs one. */
const BOARD = buildBoard(OPEN);

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
  return previewNumbers(s, BOARD, caster, [{ def, squares: abilityPreview(OPEN, caster, def, aim) }], allSeen(s));
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
    expect(shown).toContainEqual({ targetId: enemy.unitId, kind: 'damage', amount: damage, pos: { ...enemy.pos } });
  });

  it('and on an ALLY standing in it — friendly fire is on, and this is the warning', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    const ally = s.units.find((u) => u.owner === vexUnit.owner && u.unitId !== vexUnit.unitId)!;
    at(s, vexUnit.unitId, 2, 7);
    at(s, ally.unitId, 6, 7);
    const shown = numbersFor(s, vexUnit.unitId, ability(VEX, 'rail_shot'), [{ x: 14, y: 7 }]);
    expect(shown.some((n) => n.targetId === ally.unitId && n.kind === 'damage')).toBe(true);
  });

  it('nothing for a unit outside the area, however close', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    const enemy = s.units.find((u) => u.owner !== vexUnit.owner)!;
    at(s, vexUnit.unitId, 2, 7);
    at(s, enemy.unitId, 7, 9); // off the fired row
    expect(numbersFor(s, vexUnit.unitId, ability(VEX, 'rail_shot'), [{ x: 14, y: 7 }])
      .some((n) => n.targetId === enemy.unitId)).toBe(false);
  });

  it('nothing at all for an unaimed ability — an empty area previews nothing', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    expect(previewNumbers(s, BOARD, vexUnit, [{ def: ability(VEX, 'rail_shot'), squares: [] }], allSeen(s))).toEqual([]);
  });

  it('nothing for a dead unit lying in the area', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    const enemy = s.units.find((u) => u.owner !== vexUnit.owner)!;
    at(s, vexUnit.unitId, 2, 7);
    at(s, enemy.unitId, 7, 7);
    enemy.alive = false;
    expect(numbersFor(s, vexUnit.unitId, ability(VEX, 'rail_shot'), [{ x: 14, y: 7 }])
      .some((n) => n.targetId === enemy.unitId)).toBe(false);
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
    expect(shown).toContainEqual({ targetId: ally.unitId, kind: 'shield', amount, pos: { ...ally.pos } });
  });

  it('and shows an enemy standing in the same area nothing', () => {
    const s = board();
    const caster = unitOf(s, 'aegis');
    const enemy = s.units.find((u) => u.owner !== caster.owner)!;
    at(s, caster.unitId, 5, 7);
    at(s, enemy.unitId, 6, 7);
    const pulse = [...AEGIS.abilities].find((a) => a.effects.some((e) => e.kind === 'shield'))!;
    expect(numbersFor(s, caster.unitId, pulse, [{ x: 6, y: 7 }])
      .some((n) => n.targetId === enemy.unitId)).toBe(false);
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
    const shown = previewNumbers(s, BOARD, caster, [{ def: withRider, squares: [caster.pos] }], allSeen(s));
    // Exactly one number: the damage. Slow and Might are real effects with no
    // amount to show, and inventing a "0" for them would be noise.
    expect(shown).toEqual([{ targetId: caster.unitId, kind: 'damage', amount: 30, pos: { ...caster.pos } }]);
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
    const shown = previewNumbers(s, BOARD, caster, [
      { def: a, squares: [enemy.pos] },
      { def: b, squares: [enemy.pos] },
    ], allSeen(s));
    expect(shown.filter((n) => n.targetId === enemy.unitId && n.kind === 'damage'))
      .toEqual([{ targetId: enemy.unitId, kind: 'damage', amount: 35, pos: { ...enemy.pos } }]);
  });

  it('keeps damage and shield on one unit as two separate numbers', () => {
    const s = board();
    const caster = unitOf(s, 'aegis');
    const ally = s.units.find((u) => u.owner === caster.owner && u.unitId !== caster.unitId)!;
    at(s, caster.unitId, 5, 7);
    at(s, ally.unitId, 6, 7);
    const hurt: AbilityDef = { ...ability(AEGIS, AEGIS.abilities[0]!.id), effects: [{ kind: 'damage', amount: 12 }] };
    const help: AbilityDef = { ...ability(AEGIS, AEGIS.abilities[0]!.id), id: 'h', effects: [{ kind: 'shield', amount: 20 }] };
    const shown = previewNumbers(s, BOARD, caster, [
      { def: hurt, squares: [ally.pos] },
      { def: help, squares: [ally.pos] },
    ], allSeen(s)).filter((n) => n.targetId === ally.unitId);
    expect(shown.map((n) => n.kind)).toEqual(['damage', 'shield']);
  });

  it('is ordered deterministically, so a repaint never reshuffles the stack', () => {
    const s = board();
    const caster = unitOf(s, 'vex');
    const squares = s.units.map((u) => u.pos);
    const def: AbilityDef = { ...ability(VEX, 'rail_shot'), effects: [{ kind: 'damage', amount: 5 }] };
    const once = previewNumbers(s, BOARD, caster, [{ def, squares }], allSeen(s));
    const twice = previewNumbers(s, BOARD, caster, [{ def, squares }], allSeen(s));
    expect(once).toEqual(twice);
    expect(once.map((n) => n.targetId)).toEqual(s.units.map((u) => u.unitId));
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
    const shown = previewNumbers(s, BOARD, caster, [{
      def: strike,
      squares: [...abilityPreview(OPEN, caster, strike, [landing]), ...impact.origin, ...impact.destination],
    }], allSeen(s));
    const damage = strike.effects.find((e) => e.kind === 'damage')!.amount!;
    expect(shown).toContainEqual({ targetId: enemy.unitId, kind: 'damage', amount: damage, pos: { ...enemy.pos } });
  });
});

/**
 * PREVIEW-DECOY — "Decoy should be a real character for all intents and
 * purposes. Meaning damage, healing, and shielding previews should show on it."
 *
 * A decoy renders to the enemy as a real Wisp (DECOY-RENDER). If an aim covering
 * it shows nothing while the same aim over a real Wisp shows a number, the
 * *absence* is the tell — the decoy outs itself to anyone who sweeps an aim past
 * it, for free, every turn. So the preview lies in the decoy's favour.
 *
 * It is a **client-side fiction and nothing more**: the engine still gives a
 * decoy no heals and no shields and kills it with any damage (edge-cases R2).
 * What the number promises is what the action would do to the character the
 * viewer believes is standing there.
 */
describe('PREVIEW-DECOY: a decoy previews exactly like the unit it impersonates', () => {
  const decoyAt = (id: string, x: number, y: number, owner: 0 | 1) =>
    ({ id, pos: { x, y }, owner });

  it('a damaging aim covering a decoy floats the same red number a unit would', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    at(s, vexUnit.unitId, 2, 7);
    const rail = ability(VEX, 'rail_shot');
    const damage = rail.effects.find((e) => e.kind === 'damage')!.amount!;
    const caster = s.units.find((u) => u.unitId === vexUnit.unitId)!;

    // An enemy decoy sitting on the fired row.
    const decoy = decoyAt('decoy-wisp-t1', 7, 7, 1);
    const shown = previewNumbers(s, BOARD, caster,
      [{ def: rail, squares: abilityPreview(OPEN, caster, rail, [{ x: 14, y: 7 }]) }],
      allSeen(s), [decoy],
    );
    expect(shown).toContainEqual({ targetId: decoy.id, kind: 'damage', amount: damage, pos: { x: 7, y: 7 } });
  });

  it('a heal or shield reaches a decoy of your OWN team, and not an enemy one', () => {
    // Polarity comes off the decoy's `owner` exactly as it comes off a unit's,
    // so the fiction cannot disagree with FF1 about who a beneficial aim reaches.
    const s = board();
    const caster = unitOf(s, 'aegis');
    at(s, caster.unitId, 5, 7);
    const ward = [...AEGIS.abilities, AEGIS.ultimate].find((a) => a.effects.some((e) => e.kind === 'shield'))!;
    const amount = ward.effects.find((e) => e.kind === 'shield')!.amount!;

    const mine = decoyAt('decoy-mine', 6, 7, caster.owner);
    const theirs = decoyAt('decoy-theirs', 6, 7, caster.owner === 0 ? 1 : 0);
    const shown = previewNumbers(s, BOARD, caster,
      [{ def: ward, squares: abilityPreview(OPEN, caster, ward, [{ x: 6, y: 7 }]) }],
      allSeen(s), [mine, theirs],
    );
    expect(shown).toContainEqual({ targetId: mine.id, kind: 'shield', amount, pos: { x: 6, y: 7 } });
    expect(shown.some((n) => n.targetId === theirs.id), 'a shield does nothing to an enemy').toBe(false);
  });

  it('a decoy the viewer cannot see shows nothing — the list IS the fog gate', () => {
    // PREVIEW-FOG's rule, arrived at differently: a hidden enemy is still in
    // `state.units` and has to be filtered, but a hidden decoy is simply absent
    // from `FogView.decoys`. Passing an empty list is what a fogged decoy is.
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    at(s, vexUnit.unitId, 2, 7);
    const rail = ability(VEX, 'rail_shot');
    const caster = s.units.find((u) => u.unitId === vexUnit.unitId)!;
    const squares = abilityPreview(OPEN, caster, rail, [{ x: 14, y: 7 }]);

    const lit = previewNumbers(s, BOARD, caster, [{ def: rail, squares }], allSeen(s), [decoyAt('d', 7, 7, 1)]);
    const fogged = previewNumbers(s, BOARD, caster, [{ def: rail, squares }], allSeen(s), []);
    expect(lit.some((n) => n.targetId === 'd')).toBe(true);
    expect(fogged.some((n) => n.targetId === 'd'), 'no number for a decoy nobody can see').toBe(false);
  });

  it('a decoy outside the area gets nothing, however close', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    at(s, vexUnit.unitId, 2, 7);
    const rail = ability(VEX, 'rail_shot');
    const caster = s.units.find((u) => u.unitId === vexUnit.unitId)!;
    const shown = previewNumbers(s, BOARD, caster,
      [{ def: rail, squares: abilityPreview(OPEN, caster, rail, [{ x: 14, y: 7 }]) }],
      allSeen(s), [decoyAt('d', 7, 8, 1)], // one row off the beam
    );
    expect(shown.some((n) => n.targetId === 'd')).toBe(false);
  });

  it('a decoy standing where a real Wisp stands reads identically', () => {
    // The whole point, stated as an equality: the number a viewer sees over a
    // decoy is the number it would see over the character it is impersonating.
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    const realWisp = createMatch(OPEN, '2v2', [[VEX, AEGIS], [WISP, AEGIS]]);
    at(s, vexUnit.unitId, 2, 7);
    at(realWisp, realWisp.units.find((u) => u.characterId === 'vex')!.unitId, 2, 7);
    at(realWisp, realWisp.units.find((u) => u.characterId === 'wisp')!.unitId, 7, 7);

    const rail = ability(VEX, 'rail_shot');
    const casterA = s.units.find((u) => u.unitId === vexUnit.unitId)!;
    const casterB = realWisp.units.find((u) => u.characterId === 'vex')!;
    const wispId = realWisp.units.find((u) => u.characterId === 'wisp')!.unitId;

    const overDecoy = previewNumbers(
      s, BOARD, casterA,
      [{ def: rail, squares: abilityPreview(OPEN, casterA, rail, [{ x: 14, y: 7 }]) }],
      allSeen(s), [decoyAt('d', 7, 7, 1)],
    ).find((n) => n.targetId === 'd');
    const overWisp = previewNumbers(
      realWisp, BOARD, casterB,
      [{ def: rail, squares: abilityPreview(OPEN, casterB, rail, [{ x: 14, y: 7 }]) }],
      allSeen(realWisp),
    ).find((n) => n.targetId === wispId);

    expect(overDecoy?.kind).toBe(overWisp?.kind);
    expect(overDecoy?.amount).toBe(overWisp?.amount);
    expect(overDecoy?.pos).toEqual(overWisp?.pos);
  });

  it('numbers stay deterministic with decoys in the mix — units first, then decoys', () => {
    const s = board();
    const vexUnit = unitOf(s, 'vex');
    at(s, vexUnit.unitId, 2, 7);
    const rail = ability(VEX, 'rail_shot');
    const caster = s.units.find((u) => u.unitId === vexUnit.unitId)!;
    const decoys = [decoyAt('d1', 6, 7, 1), decoyAt('d2', 8, 7, 1)];
    const go = () => previewNumbers(s, BOARD, caster,
      [{ def: rail, squares: abilityPreview(OPEN, caster, rail, [{ x: 14, y: 7 }]) }],
      allSeen(s), decoys,
    );
    expect(go()).toEqual(go());
    const ids = go().map((n) => n.targetId);
    expect(ids.indexOf('d1'), 'decoys come after every unit').toBeGreaterThan(
      Math.max(...s.units.map((u) => ids.indexOf(u.unitId))),
    );
    expect(ids.indexOf('d1')).toBeLessThan(ids.indexOf('d2'));
  });
});
