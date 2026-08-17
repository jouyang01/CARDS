import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATALYST_PHASES, DEFAULT_CATALYSTS, buildCatalystPool, validateCatalystTriad,
  type CatalystData,
} from '../src/catalysts.js';
import { createMatch, spawnUnit } from '../src/setup.js';
import { makeMap } from './helpers.js';
import type { AbilityDef, CharacterDef, MapDef } from '../src/types.js';

/**
 * CAT-SELECT — somewhere for a lobby's catalyst picks to land.
 *
 * Builder OQ 2026-09-08 #4: the engine seeded every unit `DEFAULT_CATALYSTS` and
 * `createMatch` took no catalyst argument at all, so M3-LOBBY had nowhere to put
 * what a player chose. The ruled pick model is **per character** — a seat picks N
 * characters and each of them carries its own triad — so the picks are shaped
 * like `teams` and read with the same index rather than keyed by character id,
 * which two mirrored characters would collide on.
 *
 * The engine's half of the lobby, and only that half. Who may pick what (R3,
 * unique within a team) is a *selection* rule and stays in the lobby, as
 * edge-cases rules; what the engine owns is that a triad is structurally legal
 * and that a chosen one actually reaches the unit.
 */

const POOL = buildCatalystPool(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/catalysts.json'), 'utf8')) as CatalystData,
);
const byPhase = (phase: string): string[] =>
  Object.entries(POOL).filter(([, def]) => def.phase === phase).map(([id]) => id);

/** A legal, deliberately non-default triad: the *last* option in each phase. */
const CHOSEN = CATALYST_PHASES.map((phase) => byPhase(phase).at(-1)!);
/** …and the same for the second slot, so two characters can differ. */
const OTHER = CATALYST_PHASES.map((phase) => byPhase(phase)[0]!);

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 6, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 10 }], description: over.id, ...over,
});
const character = (id: string): CharacterDef => ({
  id, name: id, archetype: 'firepower', maxHp: 100,
  abilities: [ability({ id: `${id}-shot` }), ability({ id: `${id}-hop`, phase: 'dash', shape: 'square', range: 3, effects: [{ kind: 'teleport' }] })],
  ultimate: ability({ id: `${id}-ult`, shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
});
const A = character('alpha');
const B = character('beta');

const MAP: MapDef = makeMap(Array.from({ length: 9 }, () => '.'.repeat(9)), {
  spawns: [[{ x: 1, y: 3 }, { x: 1, y: 5 }], [{ x: 7, y: 3 }, { x: 7, y: 5 }]],
});
const catalystsOf = (state: ReturnType<typeof createMatch>, unitId: string) =>
  state.units.find((u) => u.unitId === unitId)!.catalysts;

describe('CAT-SELECT: a chosen triad reaches the unit', () => {
  it('seeds the pick instead of the default', () => {
    const state = createMatch(MAP, '2v2', [[A, B], [A, B]], [[CHOSEN], []]);
    expect(catalystsOf(state, 'alpha-t0-0')).toEqual(CHOSEN);
    expect(CHOSEN, 'the fixture has to differ from the default or this proves nothing')
      .not.toEqual([...DEFAULT_CATALYSTS]);
  });

  it('gives each character its OWN triad, not the team\'s', () => {
    const state = createMatch(MAP, '2v2', [[A, B], [A, B]], [[CHOSEN, OTHER], []]);
    expect(catalystsOf(state, 'alpha-t0-0')).toEqual(CHOSEN);
    expect(catalystsOf(state, 'beta-t0-1')).toEqual(OTHER);
  });

  it('lets two mirrored copies of one character differ', () => {
    // The reason picks are positional rather than keyed by character id: R3
    // allows a cross-team mirror, and both copies are `alpha`.
    const state = createMatch(MAP, '2v2', [[A, B], [A, B]], [[CHOSEN], [OTHER]]);
    expect(catalystsOf(state, 'alpha-t0-0')).toEqual(CHOSEN);
    expect(catalystsOf(state, 'alpha-t1-0')).toEqual(OTHER);
  });

  it('copies the triad rather than aliasing the caller\'s array', () => {
    // A lobby holds its picks and keeps editing them; a unit sharing that array
    // would have its loadout change under it between turns.
    const mutable = [...CHOSEN];
    const state = createMatch(MAP, '2v2', [[A, B], [A, B]], [[mutable], []]);
    mutable[0] = 'not_a_catalyst';
    expect(catalystsOf(state, 'alpha-t0-0')).toEqual(CHOSEN);
  });
});

describe('CAT-SELECT: an absent pick falls back to the default', () => {
  it('no picks at all — every unit gets the neutral triad', () => {
    const state = createMatch(MAP, '2v2', [[A, B], [A, B]]);
    for (const u of state.units) expect(u.catalysts).toEqual([...DEFAULT_CATALYSTS]);
  });

  it('a hole in the picks is one character who has not chosen yet', () => {
    // The normal state of a lobby: somebody has locked in and somebody has not.
    const state = createMatch(MAP, '2v2', [[A, B], [A, B]], [[undefined, OTHER], []]);
    expect(catalystsOf(state, 'alpha-t0-0')).toEqual([...DEFAULT_CATALYSTS]);
    expect(catalystsOf(state, 'beta-t0-1')).toEqual(OTHER);
  });

  it('and `spawnUnit` on its own behaves the same way', () => {
    expect(spawnUnit(A, 'u', 0, { x: 0, y: 0 }).catalysts).toEqual([...DEFAULT_CATALYSTS]);
    expect(spawnUnit(A, 'u', 0, { x: 0, y: 0 }, CHOSEN).catalysts).toEqual(CHOSEN);
  });
});

describe('CAT-SELECT: a triad is one catalyst per phase', () => {
  it('accepts a legal triad', () => {
    expect(validateCatalystTriad(CHOSEN, POOL)).toEqual([]);
    expect(validateCatalystTriad(DEFAULT_CATALYSTS, POOL)).toEqual([]);
  });

  it('rejects two of the same phase', () => {
    // The AC's case. Two Dash catalysts leave a unit with a phase it can never
    // act in and another it could act in twice.
    const twoDash = [byPhase('dash')[0]!, byPhase('dash')[1]!, byPhase('blast')[0]!];
    const errs = validateCatalystTriad(twoDash, POOL);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(' ')).toMatch(/two dash/i);
    expect(errs.join(' '), 'and it should say which phase is missing').toMatch(/no prep/i);
  });

  it('rejects a triad that is not three', () => {
    expect(validateCatalystTriad(CHOSEN.slice(0, 2), POOL).join(' ')).toMatch(/3 catalysts, got 2/);
    expect(validateCatalystTriad([...CHOSEN, CHOSEN[0]!], POOL).length).toBeGreaterThan(0);
  });

  it('rejects an id that is not in the pool, and says so by name', () => {
    const errs = validateCatalystTriad(['second_wind', 'shift', 'made_up'], POOL);
    expect(errs.join(' ')).toContain('"made_up"');
  });

  it('names the path it was given, so a lobby can say WHOSE triad is wrong', () => {
    expect(validateCatalystTriad([], POOL, 'seat t0-p0 / alpha').join(' '))
      .toContain('seat t0-p0 / alpha');
  });

  it('is order-independent — a lobby may list the phases however it likes', () => {
    expect(validateCatalystTriad([...CHOSEN].reverse(), POOL)).toEqual([]);
  });
});
