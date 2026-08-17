import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ABILITY_KEYS, EFFECT_KEYS, validateAbility, validateCharacter } from '../src/validate.js';
import { buildCatalystPool, validateCatalysts, type CatalystData } from '../src/catalysts.js';
import type { AbilityDef, AbilityEffect, CharacterDef } from '../src/types.js';

/**
 * VALIDATE-KEYS — a mistyped field must fail loudly, not disappear.
 *
 * Content is JSON, so `impcat: {...}` is not a compile error. It parses, it
 * validates, and the ability quietly does not do the thing it was written to
 * do. That is not hypothetical: three `impact` blocks sat inert in `data/` for a
 * whole session with the suite green, because nothing was looking at the keys.
 */

const DATA = join(import.meta.dirname, '../../..', 'data');
const CHARACTERS = readdirSync(join(DATA, 'characters')).filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, def: JSON.parse(readFileSync(join(DATA, 'characters', f), 'utf8')) as CharacterDef }));

const ability = (over: Partial<AbilityDef>): AbilityDef => ({
  id: 'x', name: 'X', phase: 'blast', shape: 'line', range: 4, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 10 }], description: 'test', ...over,
});

/**
 * Compile-time halves of the same guard. The runtime list and the type have to
 * agree, and the honest way to keep them agreeing is to make the disagreement
 * stop compiling rather than to trust anyone to remember.
 */
type Assert<T extends never> = T;
type _EveryAbilityKeyIsListed = Assert<Exclude<keyof AbilityDef, (typeof ABILITY_KEYS)[number]>>;
type _NoStaleAbilityKeys = Assert<Exclude<(typeof ABILITY_KEYS)[number], keyof AbilityDef>>;
type _EveryEffectKeyIsListed = Assert<Exclude<keyof AbilityEffect, (typeof EFFECT_KEYS)[number]>>;
type _NoStaleEffectKeys = Assert<Exclude<(typeof EFFECT_KEYS)[number], keyof AbilityEffect>>;

describe('VALIDATE-KEYS: an unknown key is an error', () => {
  it('rejects a typo, and names it', () => {
    const errs = validateAbility({ ...ability({}), impcat: { destination: 2 } } as unknown as AbilityDef, 'x');
    expect(errs.join(' ')).toMatch(/unknown key "impcat"/);
  });

  it('names the legal keys, so the fix is obvious from the message', () => {
    const errs = validateAbility({ ...ability({}), radios: 2 } as unknown as AbilityDef, 'x').join(' ');
    expect(errs).toMatch(/unknown key "radios"/);
    expect(errs).toMatch(/radius/); // the one they meant is in the list
  });

  it('catches a typo one level down, inside an effect', () => {
    const bad = ability({ effects: [{ kind: 'damage', ammount: 10 } as unknown as AbilityEffect] });
    expect(validateAbility(bad, 'x').join(' ')).toMatch(/effects\[0\]: unknown key "ammount"/);
  });

  it('accepts every legal key at once', () => {
    // The whole surface in one object, so a key that is legal but omitted from
    // the runtime list fails here rather than in someone's content.
    const everything: AbilityDef = {
      id: 'x', name: 'X', phase: 'dash', shape: 'path', range: 4, radius: 1, cooldown: 2,
      energyGain: 0, delayTurns: 1, chargeHits: 'all', free: false, melee: false, oncePerMatch: false,
      impact: { origin: 1, destination: 2 },
      effects: [{ kind: 'damage', amount: 10, duration: 2 }], description: 'test',
    };
    expect(validateAbility(everything, 'x')).toEqual([]);
    expect(Object.keys(everything).sort()).toEqual([...ABILITY_KEYS].sort());
  });

  it('rejecting unknown keys did not break rejecting bad VALUES', () => {
    expect(validateAbility(ability({ cooldown: -1 }), 'x').join(' ')).toMatch(/cooldown/);
    expect(validateAbility(ability({ shape: 'blob' as AbilityDef['shape'] }), 'x').join(' ')).toMatch(/invalid shape/);
  });
});

describe('VALIDATE-KEYS: everything shipped still validates', () => {
  // The reason this is its own item: it touches every ability at once, so the
  // check is worth nothing unless the whole of `data/` is run through it.
  it.each(CHARACTERS.map((c) => [c.file, c.def] as const))('%s', (_file, def) => {
    expect(validateCharacter(def)).toEqual([]);
  });

  it('the catalyst pool validates too', () => {
    const data = JSON.parse(readFileSync(join(DATA, 'catalysts.json'), 'utf8')) as CatalystData;
    expect(validateCatalysts(data)).toEqual([]);
    // …and every catalyst individually, since they are AbilityDefs as well.
    for (const def of Object.values(buildCatalystPool(data))) {
      expect(validateAbility(def, def.id), def.id).toEqual([]);
    }
  });

  it('every ability in the roster carries only listed keys', () => {
    for (const { file, def } of CHARACTERS) {
      for (const a of [...def.abilities, def.ultimate]) {
        for (const key of Object.keys(a)) {
          expect(ABILITY_KEYS, `${file} / ${a.id}`).toContain(key);
        }
      }
    }
  });
});
