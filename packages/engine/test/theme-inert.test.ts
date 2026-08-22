import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { validateMap } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, TeamId, UnitOrders } from '../src/types.js';

/**
 * MAP-THEMES — `MapDef.theme` is presentation, and the engine may never read it.
 *
 * The field exists so that adding a map stays one file (golden rule 2 — content
 * is data), which means a purely visual string now lives on an engine type. That
 * is a standing invitation for someone to branch on it one day, and golden rule
 * 1 says the engine is pure and deterministic: given the same `(state, map,
 * orders)`, `resolveTurn` returns the identical state forever. A map's *look*
 * cannot be part of that input.
 *
 * So this pins it from the outside rather than trusting the comment on the
 * field: run the same orders on two maps identical except for `theme`, and
 * demand byte-identical results.
 */

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 6, cooldown: 0, energyGain: 10,
  effects: [], description: over.id, ...over,
});
const char: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shoot', effects: [{ kind: 'damage', amount: 10 }] }),
    ability({ id: 'buff', phase: 'prep', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 2 }] }),
    ability({ id: 'hop', phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };

const BOARD = () => makeMap([
  '..........',
  '..w.......',
  '..........',
  '...bb.....',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
]);

const themed = (theme?: string): MapDef => ({ ...BOARD(), ...(theme === undefined ? {} : { theme }) });

const run = (s: GameState, map: MapDef, u0: UnitOrders[], u1: UnitOrders[]): GameState =>
  resolveTurn(s, map, [{ team: 0 as TeamId, units: u0 }, { team: 1 as TeamId, units: u1 }], roster).state;

const opening = (): GameState => makeState([
  makeUnit('a', 0, { x: 1, y: 5 }),
  makeUnit('b', 1, { x: 8, y: 5 }),
]);

describe('a theme cannot change what a turn does', () => {
  it('resolves identically with a theme, without one, and with a different one', () => {
    const orders0: UnitOrders[] = [{ unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 8, y: 5 }] } }];
    const orders1: UnitOrders[] = [{ unitId: 'b', movePath: [{ x: 7, y: 5 }] }];

    const none = run(opening(), themed(), orders0, orders1);
    const proving = run(opening(), themed('proving-floor'), orders0, orders1);
    const drained = run(opening(), themed('drained-works'), orders0, orders1);
    const nonsense = run(opening(), themed('a-theme-that-does-not-exist'), orders0, orders1);

    expect(proving).toEqual(none);
    expect(drained).toEqual(none);
    expect(nonsense).toEqual(none);
  });

  it('resolves identically across a multi-phase turn', () => {
    // One turn touching every phase, so a theme read during Prep, Dash or Move
    // would show up here and not only in Blast.
    const orders0: UnitOrders[] = [
      { unitId: 'a', ability: { abilityId: 'buff' }, movePath: [{ x: 2, y: 5 }, { x: 3, y: 5 }] },
    ];
    const orders1: UnitOrders[] = [{ unitId: 'b', ability: { abilityId: 'hop', target: [{ x: 6, y: 5 }] } }];

    expect(run(opening(), themed('proving-floor'), orders0, orders1))
      .toEqual(run(opening(), themed(), orders0, orders1));
  });

  it('emits an identical event log, not merely an identical end state', () => {
    // Attribution and the combat log are built from events, so two runs could
    // agree on the final state and still differ in what they claimed happened.
    const orders0: UnitOrders[] = [{ unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 8, y: 5 }] } }];
    const bare = resolveTurn(opening(), themed(), [
      { team: 0 as TeamId, units: orders0 }, { team: 1 as TeamId, units: [] },
    ], roster);
    const dressed = resolveTurn(opening(), themed('proving-floor'), [
      { team: 0 as TeamId, units: orders0 }, { team: 1 as TeamId, units: [] },
    ], roster);
    expect(dressed.events).toEqual(bare.events);
  });
});

describe('validateMap checks the shape and stops there', () => {
  it('accepts a map with no theme — a map that names none is a legal map', () => {
    expect(validateMap(themed())).toEqual([]);
  });

  it('accepts any string, including one no client has a theme for', () => {
    // Whether the theme exists is the client's business; it falls back and warns
    // rather than failing the map, so the engine must not pre-empt that.
    expect(validateMap(themed('not-a-shipped-theme'))).toEqual([]);
  });

  it('rejects a theme that is not a string', () => {
    const bad = { ...BOARD(), theme: 42 } as unknown as MapDef;
    expect(validateMap(bad).join(' ')).toMatch(/theme must be a string/);
  });
});
