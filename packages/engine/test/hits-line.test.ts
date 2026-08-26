import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import { lineImpact, resolveTurn, type Roster } from '../src/resolve.js';
import { expandShape } from '../src/shapes.js';
import { validateAbility } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type {
  AbilityDef, CharacterDef, GameState, MapDef, PlayerOrders, UnitState, Vec2,
} from '../src/types.js';

/**
 * HITS — **`chargeHits` becomes `hits`, and a `line` may stop at the first
 * enemy.**
 *
 * Owner (W2): *"Bola should slow and only hit the first enemy in the line."* The
 * field that already answered "how many of the things you reach do you actually
 * hit" was called `chargeHits` and was refused on anything but a `path`, so a
 * line asking the identical question needed either a second field or an engine
 * special case. It gets neither: one shape-agnostic `hits`, widened to `line`
 * (edge-cases, RULED — HITS).
 *
 * **The default is per-shape, and that is the load-bearing part of this file.**
 * A `path` has always been first-only when un-annotated; a `line` has always
 * pierced. Both defaults are preserved, so the rename is behaviour-neutral for
 * every shipped ability and BOLA-HITS is a real data change rather than a no-op.
 */

/**
 * ```
 *    0123456789
 *  4 C.a.b.....      C casts east; `a` is the near enemy, `b` the far one
 * ```
 */
const FIELD: MapDef = makeMap(Array.from({ length: 9 }, () => '.'.repeat(12)));

const line = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  // `duration: 2`, not the bola's authored 1: a 1-turn status applied in Blast
  // is ticked off by the end of the same turn, so it is gone by the time
  // `resolveTurn` returns and "was the rider applied" is unobservable from the
  // resolved state. Two turns leaves one on the unit to assert. The rider's
  // *duration* is Wisp's balance number and is not what this file is about.
  effects: [{ kind: 'damage', amount: 20 }, { kind: 'slow', duration: 2 }],
  description: over.id, ...over,
});

/** The bola's shape: a line that stops. And its piercing twin, for contrast. */
const BOLA = line({ id: 'bola', hits: 'first' });
const BEAM = line({ id: 'beam' }); // absent — pierces, as every shipped line does
const BEAM_ALL = line({ id: 'beam_all', hits: 'all' }); // the same thing, said out loud

const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [BOLA, BEAM, BEAM_ALL],
  ultimate: line({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const at = (id: string, owner: 0 | 1, x: number, y: number): UnitState =>
  makeUnit(id, owner, { x, y }, { characterId: 'test-char' });

/** Caster at (0,4); fire east down row 4. */
const CASTER: Vec2 = { x: 0, y: 4 };
const EAST: Vec2 = { x: 11, y: 4 };

const fire = (s: GameState, abilityId: string): GameState => resolveTurn(s, FIELD, [
  { team: 0, units: [{ unitId: 'c', ability: { abilityId, target: [EAST] } }] },
  { team: 1, units: [] },
] as [PlayerOrders, PlayerOrders], roster).state;

const unit = (s: GameState, id: string): UnitState => s.units.find((u) => u.unitId === id)!;
const lost = (s: GameState, id: string): number => 100 - unit(s, id).hp;
const slowed = (s: GameState, id: string): boolean =>
  unit(s, id).statuses.some((st) => st.kind === 'slow');

/** Two enemies in a row, the near one at (2,4) and the far one at (4,4). */
const twoInARow = (): GameState => makeState([
  makeUnit('c', 0, CASTER, { characterId: 'test-char' }),
  at('near', 1, 2, 4),
  at('far', 1, 4, 4),
]);

describe('HITS: a line that stops at the first enemy', () => {
  it('THE ITEM: hits "first" damages the near enemy and not the far one', () => {
    // *"Bola should slow and only hit the first enemy in the line."* Both
    // halves — the damage and the rider — stop at the same unit, because the
    // rule selects a victim rather than trimming a damage list.
    const s = fire(twoInARow(), 'bola');
    expect(lost(s, 'near'), 'the first enemy takes it').toBe(20);
    expect(lost(s, 'far'), 'the one behind them does not').toBe(0);
    expect(slowed(s, 'near'), 'and is slowed').toBe(true);
    expect(slowed(s, 'far'), 'while the far one is not').toBe(false);
  });

  it('THE CONTROL: the same beam without the flag still hits both', () => {
    // The pair that makes the assertion above about `hits` rather than about
    // the geometry: identical board, identical aim, one field different.
    const s = fire(twoInARow(), 'beam');
    expect(lost(s, 'near')).toBe(20);
    expect(lost(s, 'far'), 'absent means pierce — every shipped line').toBe(20);
  });

  it('and an explicit "all" reads the same as absent', () => {
    const s = fire(twoInARow(), 'beam_all');
    expect([lost(s, 'near'), lost(s, 'far')]).toEqual([20, 20]);
  });

  it('nearer is decided by walking OUTWARD, not by list order', () => {
    // `lineSquares` walks d = 1..range, so "first" is the first square in the
    // returned list. Asserted with the two enemies declared in the *reverse*
    // order in `state.units`, which is the only thing that could make an
    // implementation reading unit order instead of square order pass by luck.
    const reversed = makeState([
      makeUnit('c', 0, CASTER, { characterId: 'test-char' }),
      at('far', 1, 4, 4),
      at('near', 1, 2, 4),
    ]);
    const s = fire(reversed, 'bola');
    expect(lost(s, 'near'), 'still the nearer one').toBe(20);
    expect(lost(s, 'far')).toBe(0);
  });

  it('with nobody in the beam it simply reaches nobody', () => {
    const s = fire(makeState([makeUnit('c', 0, CASTER, { characterId: 'test-char' })]), 'bola');
    expect(s.units).toHaveLength(1);
  });
});

describe('HITS: allies never block or absorb a line', () => {
  it('THE RULING: an ally standing in front does not spend the shot', () => {
    // Ruled in edge-cases and consistent with "units never block": a teammate
    // in the beam is not a wall. The bola flies past them to the first enemy.
    const s = fire(makeState([
      makeUnit('c', 0, CASTER, { characterId: 'test-char' }),
      at('mate', 0, 2, 4),
      at('foe', 1, 4, 4),
    ]), 'bola');
    expect(lost(s, 'foe'), 'the enemy behind the ally still takes it').toBe(20);
  });

  it('and the ally takes nothing — the shot was never aimed at them', () => {
    // The other half. FF1 endangers allies standing in an *area*; a stopping
    // line selects one enemy, so there is no splash for a teammate to catch.
    const s = fire(makeState([
      makeUnit('c', 0, CASTER, { characterId: 'test-char' }),
      at('mate', 0, 2, 4),
      at('foe', 1, 4, 4),
    ]), 'bola');
    expect(lost(s, 'mate')).toBe(0);
    expect(slowed(s, 'mate')).toBe(false);
  });

  it('but a PIERCING line still friendly-fires, exactly as it did (FF1)', () => {
    // The scope line. HITS changes who a *stopping* line reaches; it must not
    // quietly turn friendly fire off for every beam in the game.
    const s = fire(makeState([
      makeUnit('c', 0, CASTER, { characterId: 'test-char' }),
      at('mate', 0, 2, 4),
      at('foe', 1, 4, 4),
    ]), 'beam');
    expect(lost(s, 'mate'), 'FF1 is untouched').toBe(20);
    expect(lost(s, 'foe')).toBe(20);
  });
});

describe('HITS: lineImpact is the one answer, shared with the overlay', () => {
  const areaFor = (def: AbilityDef): Vec2[] =>
    expandShape(buildBoard(FIELD), def, CASTER, [EAST]);

  it('names the square the beam stops on', () => {
    const s = twoInARow();
    expect(lineImpact(BOLA, 0, areaFor(BOLA), s.units)).toEqual({ x: 2, y: 4 });
  });

  it('is undefined for a piercing line — nothing truncates it', () => {
    // The contract that lets a caller use it without asking about the shape
    // first: `undefined` means "draw the whole beam / hit everyone in it".
    const s = twoInARow();
    expect(lineImpact(BEAM, 0, areaFor(BEAM), s.units)).toBeUndefined();
    expect(lineImpact(BEAM_ALL, 0, areaFor(BEAM_ALL), s.units)).toBeUndefined();
  });

  it('is undefined when the beam is empty, and for a non-line shape', () => {
    const empty = makeState([makeUnit('c', 0, CASTER, { characterId: 'test-char' })]);
    expect(lineImpact(BOLA, 0, areaFor(BOLA), empty.units)).toBeUndefined();
    const cone: AbilityDef = { ...BOLA, shape: 'cone' };
    expect(lineImpact(cone, 0, areaFor(BOLA), twoInARow().units)).toBeUndefined();
  });

  it('skips a dead unit — a corpse does not stop a bola', () => {
    const s = twoInARow();
    unit(s, 'near').alive = false;
    expect(lineImpact(BOLA, 0, areaFor(BOLA), s.units)).toEqual({ x: 4, y: 4 });
  });

  it('THE OVERLAY CONTRACT: the stop is a square the beam actually covers', () => {
    // BOLA-OVERLAY draws the line up to this square, so it has to be one of the
    // beam's own tiles or the overlay would end somewhere the ability does not
    // reach. Free from the implementation — asserted so it stays free.
    const area = areaFor(BOLA);
    const stop = lineImpact(BOLA, 0, area, twoInARow().units)!;
    expect(area.some((p) => p.x === stop.x && p.y === stop.y)).toBe(true);
  });
});

describe('HITS: the field, renamed and widened', () => {
  it('THE RENAME: `chargeHits` is gone from the codebase', () => {
    // Asserted here as well as by grep because a rename that leaves one caller
    // behind is a field that silently stops being read — the exact failure the
    // key whitelist exists to catch, one level up.
    expect(Object.keys(BOLA)).not.toContain('chargeHits');
    expect(validateAbility({ ...BOLA, chargeHits: 'all' } as unknown as AbilityDef, 'x').join(' '))
      .toMatch(/unknown key "chargeHits"/);
  });

  it('is accepted on a line and on a path, refused on everything else', () => {
    expect(validateAbility(BOLA, 'x')).toEqual([]);
    const charge: AbilityDef = {
      ...line({ id: 'charge' }), shape: 'path', phase: 'dash', hits: 'all', range: 4,
    };
    expect(validateAbility(charge, 'x')).toEqual([]);
    for (const shape of ['cone', 'circle', 'square', 'self'] as const) {
      const bad: AbilityDef = { ...BOLA, shape, ...(shape === 'circle' ? { radius: 1 } : {}) };
      expect(validateAbility(bad, 'x').join(' '), shape)
        .toMatch(/hits is only valid on a "line" or a "path"/);
    }
  });

  it('and still refuses a value that is neither "first" nor "all"', () => {
    expect(validateAbility({ ...BOLA, hits: 'some' } as unknown as AbilityDef, 'x').join(' '))
      .toMatch(/hits must be "first" or "all"/);
  });
});

describe('HITS: purity', () => {
  it('the same shot resolves identically twice and never edits the input', () => {
    const s = twoInARow();
    const before = JSON.stringify(s);
    const one = fire(s, 'bola');
    const two = fire(s, 'bola');
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(JSON.stringify(s)).toBe(before);
  });
});
