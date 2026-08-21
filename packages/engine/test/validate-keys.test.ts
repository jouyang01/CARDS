import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ABILITY_KEYS, EFFECT_KEYS, PROFILE_KEYS, validateAbility, validateCharacter } from '../src/validate.js';
import { buildCatalystPool, validateCatalysts, type CatalystData } from '../src/catalysts.js';
import type { AbilityDef, AbilityEffect, AbilityProfile, CharacterDef } from '../src/types.js';

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
// BASIC-MODES: the profile's key list gets the same two-way guard, because a
// mode key the runtime does not know about is the same silent nothing.
type _EveryProfileKeyIsListed = Assert<Exclude<keyof AbilityProfile, (typeof PROFILE_KEYS)[number]>>;
type _NoStaleProfileKeys = Assert<Exclude<(typeof PROFILE_KEYS)[number], keyof AbilityProfile>>;

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

  it('accepts every legal key, across the shapes that may carry them', () => {
    // The whole surface, so a key that is legal but omitted from the runtime
    // list fails here rather than in someone's content.
    //
    // Four objects rather than one, because some keys are **shape-exclusive**:
    // `chargeHits` is only valid on a `path`, `axisBonus`/`beamWidth` only on a
    // `cone`, and `innerRadius`/`innerAmount` only on a `circle` — each for the
    // same reason,
    // that a balance field the engine cannot read on that shape is a number
    // nobody can find. The coverage assertion is over the union, so the guard is
    // exactly as strong as it was.
    const charge: AbilityDef = {
      id: 'x', name: 'X', phase: 'dash', shape: 'path', range: 4, radius: 1, cooldown: 2,
      energyGain: 0, delayTurns: 1, chargeHits: 'all', free: false, melee: false, oncePerMatch: false,
      impact: { origin: 1, destination: 2 },
      effects: [{ kind: 'damage', amount: 10, duration: 2 }], description: 'test',
    };
    const wedge: AbilityDef = {
      id: 'y', name: 'Y', phase: 'blast', shape: 'cone', range: 3, cooldown: 0, energyGain: 4,
      melee: true, axisBonus: 8, beamWidth: 3, selfDamagePct: 50, noFriendlyFire: true,
      effects: [{ kind: 'damage', amount: 10 }], description: 'test',
    };
    const bomb: AbilityDef = {
      id: 'z', name: 'Z', phase: 'blast', shape: 'circle', range: 6, radius: 2, cooldown: 0,
      energyGain: 4, innerRadius: 0, innerAmount: 22,
      // FRAG-SELF lives here rather than on `wedge`: it is refused alongside
      // `selfDamagePct`, which `wedge` carries.
      selfHarm: true,
      effects: [{ kind: 'damage', amount: 10 }], description: 'test',
    };
    // BASIC-MODES is a fourth object for the same reason: a mode may change the
    // shape, so an ability carrying `modes` cannot also be the one carrying the
    // cone-only or circle-only keys above.
    const twin: AbilityDef = {
      id: 'w', name: 'W', phase: 'blast', shape: 'line', range: 6, cooldown: 0, energyGain: 8,
      modes: [{ name: 'Focus', shape: 'line', range: 6 }, { name: 'Spread', shape: 'cone', range: 2 }],
      effects: [{ kind: 'damage', amount: 10 }], description: 'test',
    };
    // WARDING-WALL: a fifth, because `wallLength` is `wall`-exclusive on the
    // same argument again — and its trap effect is where `perTile`/`triggers`
    // live, which the effect-key union below needs a home for.
    const barrier: AbilityDef = {
      id: 'v', name: 'V', phase: 'prep', shape: 'wall', range: 4, wallLength: 4, cooldown: 4,
      energyGain: 8,
      effects: [
        { kind: 'trap', amount: 25, lifetime: 1, halt: true, perTile: true, triggers: ['move', 'displacement'] },
      ],
      description: 'test',
    };
    // INTERCEPT-GUARD: a sixth, because `allyTarget` is `square`-exclusive on
    // the same argument again — the ally's square IS the aim, so a shape that
    // takes a direction or a radius cannot also claim to be ally-bound.
    const bodyguard: AbilityDef = {
      id: 'u', name: 'U', phase: 'dash', shape: 'square', range: 5, cooldown: 5, energyGain: 5,
      allyTarget: true,
      effects: [{ kind: 'teleport' }, { kind: 'guard', duration: 1 }],
      description: 'test',
    };
    expect(validateAbility(charge, 'x')).toEqual([]);
    expect(validateAbility(wedge, 'y')).toEqual([]);
    expect(validateAbility(bomb, 'z')).toEqual([]);
    expect(validateAbility(twin, 'w')).toEqual([]);
    expect(validateAbility(barrier, 'v')).toEqual([]);
    expect(validateAbility(bodyguard, 'u')).toEqual([]);
    expect([...new Set([
      ...Object.keys(charge), ...Object.keys(wedge), ...Object.keys(bomb), ...Object.keys(twin),
      ...Object.keys(barrier), ...Object.keys(bodyguard),
    ])].sort())
      .toEqual([...ABILITY_KEYS].sort());
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
