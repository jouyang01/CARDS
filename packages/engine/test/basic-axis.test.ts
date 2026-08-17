import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { AIM_STEPS, axisSquares, onConeAxis, stepToVector } from '../src/shapes.js';
import { validateCharacter } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, UnitOrders, Vec2 } from '../src/types.js';
import bastion from '../../../data/characters/bastion.json';

/**
 * BASIC-AXIS — `axisBonus` on a cone: the wedge's central line hits harder
 * (Designer §3.1, adopted from AR's Titus; ships on Bastion's Crushing Slam).
 *
 * No new geometry. CONE-B already measures each tile's perpendicular offset from
 * the axis to decide whether the wedge covers it; "on the axis" is that same
 * integer compared against half a tile instead of against the wedge's width. The
 * comparison stays squared and cross-multiplied, so the whole thing is integers
 * — which is the argument for adopting this knob rather than the two AR basics
 * that would have wanted trig.
 */

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'cone', range: 3, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 10 }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'plain' }),
    ability({ id: 'axial', axisBonus: 6 }),
    ability({ id: 'hop', phase: 'dash', shape: 'square', range: 3, effects: [{ kind: 'teleport' }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };
const MAP: MapDef = makeMap(Array.from({ length: 11 }, () => '.'.repeat(11)));

const CASTER: Vec2 = { x: 5, y: 5 };
/** `caster` at (5,5) with a victim wherever you put it. */
const board = (victim: Vec2): GameState => makeState([
  makeUnit('a', 0, CASTER, { characterId: 'test-char' }),
  makeUnit('e', 1, victim, { characterId: 'test-char' }),
]);
const run = (s: GameState, orders: UnitOrders[]) =>
  resolveTurn(s, MAP, [{ team: 0, units: orders }, { team: 1, units: [] }], roster);
const hpAfter = (s: GameState, abilityId: string, victim: Vec2): number => {
  // Aimed straight east, past the victim, so the cone points down the +x axis.
  const { state } = run(s, [{ unitId: 'a', ability: { abilityId, target: [{ x: 10, y: 5 }] } }]);
  return state.units.find((u) => u.unitId === 'e')!.hp;
};

/** Two squares dead ahead, and two squares off to the side but still covered. */
const ON_AXIS: Vec2 = { x: 7, y: 5 };
const OFF_AXIS: Vec2 = { x: 7, y: 7 };

describe('BASIC-AXIS: the central line takes the bonus', () => {
  it('an axis tile takes base + bonus', () => {
    expect(hpAfter(board(ON_AXIS), 'axial', ON_AXIS)).toBe(100 - (10 + 6));
  });

  it('an off-axis tile inside the same cone takes base only', () => {
    expect(hpAfter(board(OFF_AXIS), 'axial', OFF_AXIS)).toBe(100 - 10);
  });

  it('and the same cone WITHOUT the knob treats both alike', () => {
    // The control: if the fixture's two squares differed for some other reason,
    // the pair above would pass for the wrong one.
    expect(hpAfter(board(ON_AXIS), 'plain', ON_AXIS)).toBe(100 - 10);
    expect(hpAfter(board(OFF_AXIS), 'plain', OFF_AXIS)).toBe(100 - 10);
  });

  it('the bonus rides the ability, so a hit outside the cone gets nothing at all', () => {
    // Behind the caster: not covered, so there is no damage to add a bonus to.
    expect(hpAfter(board({ x: 3, y: 5 }), 'axial', { x: 3, y: 5 })).toBe(100);
  });
});

describe('BASIC-AXIS: the axis is a subset of the wedge, at every rotation', () => {
  const board3 = buildBoard(MAP);
  const axial = CHAR.abilities.find((a) => a.id === 'axial')!;

  it('is the straight run ahead, in each of the four cardinals', () => {
    // A click-aimed cone snaps to `dominantCardinal`, so these four are the
    // directions a click can produce — and in each the axis must be exactly the
    // tiles on the ray, nothing beside them.
    for (const dir of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]) {
      const aim = [{ x: CASTER.x + dir.x * 3, y: CASTER.y + dir.y * 3 }];
      const axis = axisSquares(board3, axial, CASTER, aim);
      const where = `dir ${dir.x},${dir.y}`;
      expect(axis.length, where).toBeGreaterThan(0);
      for (const p of axis) {
        expect(onConeAxis(dir, p.x - CASTER.x, p.y - CASTER.y), `${where} ${p.x},${p.y}`).toBe(true);
      }
    }
  });

  it('and follows a quantized aim step off the cardinals too (AIM2)', () => {
    // Free rotation is the case a cardinals-only check would miss: the axis has
    // to swing with the wedge, not stay stuck on a compass point.
    for (const step of [0, 37, AIM_STEPS / 8, AIM_STEPS / 2 + 11]) {
      const dir = stepToVector(step);
      const axis = axisSquares(board3, axial, CASTER, [], step);
      expect(axis.length, `step ${step}`).toBeGreaterThan(0);
      for (const p of axis) {
        expect(onConeAxis(dir, p.x - CASTER.x, p.y - CASTER.y), `step ${step} at ${p.x},${p.y}`).toBe(true);
      }
    }
  });

  it('and it really is a line — it never widens with distance', () => {
    // CONE-B's wedge ramps out at one tile per tile of range; the axis must not.
    const axis = axisSquares(board3, axial, CASTER, [{ x: 10, y: 5 }]);
    for (const p of axis) expect(p.y, `${p.x},${p.y} strayed off the row`).toBe(CASTER.y);
  });

  it('a cone with no axisBonus reports no axis — nobody pays for the knob', () => {
    const plain = CHAR.abilities.find((a) => a.id === 'plain')!;
    expect(axisSquares(board3, plain, CASTER, [{ x: 10, y: 5 }])).toEqual([]);
  });

  it('and neither does a shape that has no axis', () => {
    expect(axisSquares(board3, { shape: 'circle', range: 4, axisBonus: 5 }, CASTER, [{ x: 7, y: 5 }]))
      .toEqual([]);
  });
});

describe('BASIC-AXIS: validation', () => {
  // Four abilities, because `validateCharacter` requires exactly four (v1).
  const withAbility = (over: Partial<AbilityDef>): CharacterDef => ({
    ...CHAR,
    abilities: [ability({ id: 'x', ...over }), CHAR.abilities[0]!, CHAR.abilities[1]!, CHAR.abilities[2]!],
  });

  it('accepts a positive integer bonus on a cone', () => {
    expect(validateCharacter(withAbility({ axisBonus: 4 }))).toEqual([]);
  });

  it('rejects it on a shape with no axis', () => {
    expect(validateCharacter(withAbility({ shape: 'line', axisBonus: 4 })).join(' '))
      .toMatch(/axisBonus is only meaningful on a cone/);
  });

  it('rejects a zero or fractional bonus', () => {
    expect(validateCharacter(withAbility({ axisBonus: 0 })).length).toBeGreaterThan(0);
    expect(validateCharacter(withAbility({ axisBonus: 1.5 })).length).toBeGreaterThan(0);
  });
});

describe('BASIC-AXIS: the kit it shipped with', () => {
  const BASTION = bastion as unknown as CharacterDef;
  const slam = BASTION.abilities.find((a) => a.id === 'crushing_slam')!;

  it('Bastion\'s Crushing Slam carries it, and is still a melee cone', () => {
    expect(slam.shape).toBe('cone');
    expect(slam.axisBonus).toBe(8);
    expect(slam.melee, 'the melee pass must survive the knob').toBe(true);
  });

  it('and the character still validates', () => {
    expect(validateCharacter(BASTION)).toEqual([]);
  });
});
