import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildBoard } from '../src/board.js';
import {
  AIM_STEPS,
  coneSquares,
  expandShape,
  isAimStep,
  lineSquares,
  stepToVector,
  vectorToStep,
} from '../src/shapes.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit, posKeys } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders, Vec2 } from '../src/types.js';

/**
 * AIM2 — free-rotation aiming through a quantized integer direction.
 * The engine never sees an angle, only a step; determinism is the whole point.
 */

const OPEN = (n = 21) => makeMap(Array.from({ length: n }, () => '.'.repeat(n)));
const board = () => buildBoard(OPEN());
const CENTRE: Vec2 = { x: 10, y: 10 };

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 8,
  effects: [{ kind: 'damage', amount: 20 }], description: over.id, ...over,
});
const char: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'rail', shape: 'line', range: 8 }),
    ability({ id: 'fan', shape: 'cone', range: 4 }),
    ability({ id: 'lob', shape: 'circle', range: 6, radius: 1 }),
    ability({ id: 'poke', shape: 'square', range: 4 }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };
const run = (s: GameState, u0: UnitOrders[]) =>
  resolveTurn(s, OPEN(), [{ team: 0, units: u0 }, { team: 1, units: [] }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

describe('AIM2: the quantized direction is pure integer, both ways', () => {
  it('every step maps to an integer lattice vector on the diamond', () => {
    for (let s = 0; s < AIM_STEPS; s++) {
      const v = stepToVector(s);
      expect(Number.isInteger(v.x) && Number.isInteger(v.y), `step ${s} is not integral`).toBe(true);
      expect(Math.abs(v.x) + Math.abs(v.y), `step ${s} off the diamond`).toBe(AIM_STEPS / 4);
    }
  });

  it('the four cardinals land on the steps you would expect', () => {
    expect(stepToVector(0)).toEqual({ x: 64, y: 0 }); // east
    expect(stepToVector(64)).toEqual({ x: 0, y: 64 }); // south (screen y grows down)
    expect(stepToVector(128)).toEqual({ x: -64, y: 0 }); // west
    expect(stepToVector(192)).toEqual({ x: 0, y: -64 }); // north
  });

  it('vectorToStep inverts stepToVector for every step', () => {
    for (let s = 0; s < AIM_STEPS; s++) {
      const v = stepToVector(s);
      expect(vectorToStep(v.x, v.y), `step ${s} did not round-trip`).toBe(s);
    }
  });

  it('vectorToStep maps raw deltas (a mouse drag) onto the same directions', () => {
    expect(vectorToStep(5, 0)).toBe(0); // due east, any magnitude
    expect(vectorToStep(100, 0)).toBe(0);
    expect(vectorToStep(0, 3)).toBe(64);
    expect(vectorToStep(-7, 0)).toBe(128);
    expect(vectorToStep(0, -9)).toBe(192);
    expect(vectorToStep(4, 4)).toBe(32); // the SE diagonal, halfway round the quadrant
    expect(vectorToStep(0, 0)).toBe(0); // no direction at all
  });

  it('isAimStep accepts only integers inside one turn', () => {
    expect(isAimStep(0)).toBe(true);
    expect(isAimStep(AIM_STEPS - 1)).toBe(true);
    expect(isAimStep(AIM_STEPS)).toBe(false);
    expect(isAimStep(-1)).toBe(false);
    expect(isAimStep(1.5)).toBe(false);
    expect(isAimStep('12')).toBe(false);
    expect(isAimStep(undefined)).toBe(false);
  });
});

describe('AIM2: rotated shapes keep their reach (range = tiles along the axis)', () => {
  it('a line covers `range` tiles whichever way it points', () => {
    for (let s = 0; s < AIM_STEPS; s += 8) {
      const squares = lineSquares(board(), CENTRE, stepToVector(s), 8);
      expect(squares.length, `step ${s} reached ${squares.length} tiles`).toBe(8);
    }
  });

  it('the cardinal directions reproduce the pre-AIM2 straight rays exactly', () => {
    expect(posKeys(lineSquares(board(), CENTRE, stepToVector(0), 3))).toEqual(['11,10', '12,10', '13,10']);
    expect(posKeys(lineSquares(board(), CENTRE, stepToVector(192), 3))).toEqual(['10,7', '10,8', '10,9']);
  });

  it('a diagonal step gives the diagonal ray, same tile count', () => {
    expect(posKeys(lineSquares(board(), CENTRE, stepToVector(32), 3))).toEqual(['11,11', '12,12', '13,13']);
  });

  it('an in-between step gives a genuinely rotated ray — not snapped to a compass point', () => {
    const ray = lineSquares(board(), CENTRE, stepToVector(16), 6); // between E and SE
    expect(ray).toHaveLength(6);
    const keys = posKeys(ray);
    expect(keys).not.toEqual(posKeys(lineSquares(board(), CENTRE, stepToVector(0), 6)));
    expect(keys).not.toEqual(posKeys(lineSquares(board(), CENTRE, stepToVector(32), 6)));
    // It drifts off the row gradually, which is what "rotated" should look like.
    expect(ray.every((p) => p.x > CENTRE.x)).toBe(true);
    expect(ray.at(-1)!.y).toBeGreaterThan(CENTRE.y);
  });

  it('a line still stops at the first wall', () => {
    const walled = buildBoard(makeMap(['.....', '..#..', '.....']));
    expect(posKeys(lineSquares(walled, { x: 0, y: 1 }, stepToVector(0), 4))).toEqual(['1,1']);
  });

  it('a cone keeps its depth and widening at any rotation', () => {
    for (let s = 0; s < AIM_STEPS; s++) {
      const dir = stepToVector(s);
      const wedge = coneSquares(board(), CENTRE, dir, 4);
      expect(new Set(posKeys(wedge)).size, `step ${s}`).toBe(wedge.length); // no duplicates
      // "Reaches as far when rotated" (MET1 x AIM2) means the tile `range`
      // steps along the axis is covered whichever way the cone points.
      const m = Math.max(Math.abs(dir.x), Math.abs(dir.y));
      const tip = `${CENTRE.x + Math.round((4 * dir.x) / m)},${CENTRE.y + Math.round((4 * dir.y) / m)}`;
      expect(posKeys(wedge), `step ${s}`).toContain(tip);
      // …and it is a wedge, not a beam: it always widens beyond 4 tiles.
      expect(wedge.length, `step ${s}`).toBeGreaterThan(4);
    }
  });

  it('a cardinal cone is the wedge the half-tile hitbox covers (HITBOX1)', () => {
    const wedge = posKeys(coneSquares(board(), CENTRE, stepToVector(0), 2));
    // depth 1: (11, 9..11); depth 2: (12, 8..12). posKeys sorts lexically.
    expect(wedge).toEqual([
      '11,10', '11,11', '11,9',
      '12,10', '12,11', '12,12', '12,8', '12,9',
    ]);
  });
});

describe('HITBOX1: coverage is the central hitbox, and binary', () => {
  it('a covered tile takes FULL damage — never a fraction', () => {
    const caster = makeUnit('a', 0, { x: 10, y: 10 });
    const victim = makeUnit('e', 1, { x: 13, y: 10 });
    const { state } = run(makeState([caster, victim]), [
      { unitId: 'a', ability: { abilityId: 'rail', target: [], aimStep: 0 } },
    ]);
    expect(unit(state, 'e').hp).toBe(80); // the full 20, not a share of it
  });

  it('a unit just outside the rotated shape takes nothing at all', () => {
    const caster = makeUnit('a', 0, { x: 10, y: 10 });
    const off = makeUnit('e', 1, { x: 13, y: 13 }); // on the SE diagonal
    const { state } = run(makeState([caster, off]), [
      { unitId: 'a', ability: { abilityId: 'rail', target: [], aimStep: 0 } }, // fires due east
    ]);
    expect(unit(state, 'e').hp).toBe(100);
  });
});

describe('AIM2: orders carry the step, and illegal steps are rejected', () => {
  const caster = () => makeUnit('a', 0, { x: 10, y: 10 });
  const victim = () => makeUnit('e', 1, { x: 10, y: 13 });

  it('an aimStep aims the ability with no target square at all', () => {
    const { state } = run(makeState([caster(), victim()]), [
      { unitId: 'a', ability: { abilityId: 'rail', target: [], aimStep: 64 } }, // due south
    ]);
    expect(unit(state, 'e').hp).toBe(80);
  });

  it('an out-of-range step drops the ability rather than resolving it', () => {
    for (const bad of [AIM_STEPS, -1, 1.5]) {
      const { state } = run(makeState([caster(), victim()]), [
        { unitId: 'a', ability: { abilityId: 'rail', target: [], aimStep: bad } },
      ]);
      expect(unit(state, 'e').hp, `step ${bad} should not resolve`).toBe(100);
    }
  });

  it('without a step, click-to-aim still works exactly as before', () => {
    const { state } = run(makeState([caster(), victim()]), [
      { unitId: 'a', ability: { abilityId: 'rail', target: [{ x: 10, y: 20 }] } },
    ]);
    expect(unit(state, 'e').hp).toBe(80);
  });

  it('the step is ignored by target-square shapes (circle/square unaffected)', () => {
    const withStep = run(makeState([caster(), victim()]), [
      { unitId: 'a', ability: { abilityId: 'lob', target: [{ x: 10, y: 13 }], aimStep: 99 } },
    ]);
    const without = run(makeState([caster(), victim()]), [
      { unitId: 'a', ability: { abilityId: 'lob', target: [{ x: 10, y: 13 }] } },
    ]);
    expect(unit(withStep.state, 'e').hp).toBe(unit(without.state, 'e').hp);
  });
});

describe('AIM2: cross-engine determinism', () => {
  it('a fixed step and shape yield a byte-identical tile set, every time', () => {
    const snapshot = (): string => {
      const rows: string[] = [];
      for (let s = 0; s < AIM_STEPS; s += 1) {
        rows.push(`${s}|${posKeys(lineSquares(board(), CENTRE, stepToVector(s), 8)).join(' ')}`);
        rows.push(`${s}c|${posKeys(coneSquares(board(), CENTRE, stepToVector(s), 3)).join(' ')}`);
      }
      return rows.join('\n');
    };
    expect(snapshot()).toBe(snapshot());
  });

  it('expandShape is stable for a rotated line through the public entry point', () => {
    const def = char.abilities[0]!;
    const once = expandShape(board(), def, CENTRE, [], 40);
    const twice = expandShape(board(), def, CENTRE, [], 40);
    expect(posKeys(once)).toEqual(posKeys(twice));
    expect(once.length).toBe(8);
  });

  it('produces no floats anywhere in a covered tile set', () => {
    for (let s = 0; s < AIM_STEPS; s += 3) {
      for (const p of coneSquares(board(), CENTRE, stepToVector(s), 4)) {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y), `step ${s}`).toBe(true);
      }
    }
  });
});

describe('AIM2-guard: the engine contains no trigonometry (standing guard)', () => {
  it('no Math.cos/sin/tan/atan2 anywhere in packages/engine/src', () => {
    const dir = new URL('../src/', import.meta.url).pathname;
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, file), 'utf8');
      // Trig belongs in the client (mouse → step is presentation). In the engine
      // it would make coverage depend on transcendental rounding, and two
      // machines could disagree about which tiles an ability hit.
      const hit = /Math\.(cos|sin|tan|atan2|atan|acos|asin|hypot)\b/.exec(src);
      if (hit !== null) offenders.push(`${file}: ${hit[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
