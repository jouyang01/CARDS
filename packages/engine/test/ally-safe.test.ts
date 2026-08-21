import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { validateAbility } from '../src/validate.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, Vec2 } from '../src/types.js';

/**
 * ALLY-SAFE — an ability may opt out of friendly fire (Dev Note #11).
 *
 * FF1 stays the global default, and it should: an attack endangering whoever is
 * standing in it is the positioning tax the whole game is built around. But
 * Lumen's Radiant Lash is a beam that damages enemies and heals allies **down
 * the same line** — "fire it through your frontliner at the enemy behind them"
 * is the printed instruction — and under the default the frontliner took 14 for
 * standing where the ability told them to. A Mender whose healing beam
 * friendly-fires is self-contradictory.
 *
 * `noFriendlyFire: true` is the per-ability exception. Note what it is not:
 *
 *   • not global — every other ability in the game still hits its own team;
 *   • not CASTER-SAFE, which excludes the *caster* from *every* ability. This
 *     is team-scoped and opt-in. The two compose: an ALLY-SAFE ability spares
 *     the caster because it spares the team, and a normal one spares the caster
 *     alone.
 *   • not a change to beneficial effects, which reached the caster's team only
 *     to begin with.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;
const LUMEN = load('lumen');
const VEX = load('vex');
const LASH = LUMEN.abilities.find((a) => a.id === 'radiant_lash')!;

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 10 }, { x: 3, y: 10 }], [{ x: 18, y: 10 }, { x: 17, y: 10 }]],
};
const roster: Roster = { lumen: LUMEN, vex: VEX };

/** Lumen, a wounded ally, and one enemy — the beam's three roles. */
const beamline = (lumenAt: Vec2, allyAt: Vec2, enemyAt: Vec2) => {
  const state = createMatch(OPEN, '2v2', [[LUMEN, VEX], [VEX, VEX]]);
  const lumen = state.units.find((u) => u.characterId === 'lumen')!;
  const ally = state.units.find((u) => u.owner === 0 && u.characterId === 'vex')!;
  const [enemy, other] = state.units.filter((u) => u.owner === 1);
  lumen.pos = { ...lumenAt };
  ally.pos = { ...allyAt };
  ally.hp = 50;
  enemy!.pos = { ...enemyAt };
  other!.pos = { x: 20, y: 0 };
  return { state, lumen, ally, enemy: enemy! };
};

const fire = (state: GameState, unitId: string, abilityId: string, target: Vec2) =>
  resolveTurn(state, OPEN, [
    { team: 0, units: [{ unitId, ability: { abilityId, target: [{ ...target }] } }] },
    { team: 1, units: [] },
  ], roster).state;

const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

describe('ALLY-SAFE: Radiant Lash fires through its own frontliner', () => {
  // Lumen at (5,10) firing east: the ally stands at (7,10), the enemy at (9,10),
  // both on the beam.
  const line = () => beamline({ x: 5, y: 10 }, { x: 7, y: 10 }, { x: 9, y: 10 });

  it('the enemy takes 14, the ally takes nothing, and the ally is healed', () => {
    // All three clauses of the AC in one shot, because they are one behaviour:
    // the beam sorts by team rather than by who is in the way.
    const { state, lumen, ally, enemy } = line();
    const after = fire(state, lumen.unitId, 'radiant_lash', { x: 11, y: 10 });
    expect(unit(after, enemy.unitId).hp).toBe(VEX.maxHp - 14);
    expect(unit(after, ally.unitId).hp, '50 + the 12 heal, no 14').toBe(62);
  });

  it('the enemy behind the ally is still reached — nothing about the shape changed', () => {
    // Worth its own case: sparing a teammate must not be implemented as the beam
    // stopping at them.
    const { state, lumen, enemy } = line();
    const after = fire(state, lumen.unitId, 'radiant_lash', { x: 11, y: 10 });
    expect(unit(after, enemy.unitId).hp).toBeLessThan(VEX.maxHp);
  });

  it('and it still pays energy, because it hit an enemy', () => {
    // Energy is enemy-only. Skipping the ally must not skip the accounting for
    // the enemy standing behind them.
    const { state, lumen } = line();
    const after = fire(state, lumen.unitId, 'radiant_lash', { x: 11, y: 10 });
    expect(unit(after, lumen.unitId).energy).toBeGreaterThan(0);
  });

  it('an ordinary attack still cuts down the teammate in its way', () => {
    // The control that keeps this an exception rather than a new default.
    // Dazzling Ray is the same shape from the same character, without the flag.
    const { state, lumen, ally } = beamline({ x: 5, y: 10 }, { x: 7, y: 10 }, { x: 9, y: 10 });
    const after = fire(state, lumen.unitId, 'dazzling_ray', { x: 11, y: 10 });
    const ray = LUMEN.abilities.find((a) => a.id === 'dazzling_ray')!
      .effects.find((e) => e.kind === 'damage')!.amount!;
    expect(unit(after, ally.unitId).hp, 'FF1 is still the rule').toBe(50 - ray);
  });
});

describe('ALLY-SAFE: the flag is validated', () => {
  const base: AbilityDef = {
    id: 'x', name: 'X', phase: 'blast', shape: 'line', range: 4, cooldown: 0, energyGain: 4,
    effects: [{ kind: 'damage', amount: 20 }], description: 'test',
  };

  it('accepts it on an ability with something harmful to skip', () => {
    expect(validateAbility({ ...base, noFriendlyFire: true }, 'x')).toEqual([]);
    const debuffOnly: AbilityDef = { ...base, effects: [{ kind: 'slow', duration: 2 }], noFriendlyFire: true };
    expect(validateAbility(debuffOnly, 'x'), 'a debuff is harmful too').toEqual([]);
  });

  it('rejects it on a heal-only ability — nothing there to spare anyone from', () => {
    const healer: AbilityDef = { ...base, effects: [{ kind: 'heal', amount: 20 }], noFriendlyFire: true };
    expect(validateAbility(healer, 'x').join(' ')).toMatch(/noFriendlyFire needs a harmful effect/);
  });

  it('rejects `false`, which reads like a decision and is not one', () => {
    expect(validateAbility({ ...base, noFriendlyFire: false }, 'x').join(' '))
      .toMatch(/noFriendlyFire must be true when present/);
  });

  it('the shipped Radiant Lash carries it and validates', () => {
    expect(LASH.noFriendlyFire).toBe(true);
    expect(validateAbility(LASH, 'lumen.radiant_lash')).toEqual([]);
  });

  it('and it is the ONLY ability that does — this is an exception, not a policy', () => {
    // Read from the directory rather than a list, so a character added later is
    // covered without anybody remembering to add them here.
    const dir = join(import.meta.dirname, '../../..', 'data/characters');
    const flagged: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const def = load(file.replace(/\.json$/, ''));
      for (const a of [...def.abilities, def.ultimate]) {
        if (a.noFriendlyFire === true) flagged.push(`${def.id}/${a.id}`);
      }
    }
    expect(flagged).toEqual(['lumen/radiant_lash']);
  });
});
