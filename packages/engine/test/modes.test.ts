import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { abilityProfile, resolveTurn, type Roster } from '../src/resolve.js';
import { validateAbility } from '../src/validate.js';
import { createMatch } from '../src/setup.js';
import type { AbilityDef, CharacterDef, MapDef } from '../src/types.js';

/**
 * BASIC-MODES — two aim-time profiles on one ability (Kestrel's Twin Bolts).
 *
 * The knob is one function applied at one place: `abilityProfile` overlays the
 * chosen profile onto the ability, and `planAbility` calls it once. Everything
 * downstream — `expandShape`, the legality check, the three geometry expansions,
 * the client's preview — receives an ordinary `AbilityDef` and never learns that
 * modes exist. So what is worth testing is:
 *
 * 1. The overlay is **only** the geometry. A mode that could move damage or
 *    cooldown would be two abilities in one slot, and the type is what stops it
 *    — but the type does not stop `data/` from being written by hand, so the
 *    validator checks it too.
 * 2. Each mode **resolves its own profile** — the AC's line, and the one thing a
 *    single funnel could still get wrong by being applied after the geometry.
 * 3. Absent, out-of-range and malformed modes all land on the default rather
 *    than on an exception, because an order that lost its mode should lose the
 *    mode and not the turn.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 3, y: 10 }], [{ x: 11, y: 10 }]],
};

/** A two-mode auto: a wide short cone, or a thin long line. Kestrel's shape. */
const TWIN: AbilityDef = {
  id: 'twin', name: 'Twin', phase: 'blast', shape: 'line', range: 6,
  // MODE-BASE-INVARIANT: mode 0 IS the base profile, so Focus (line 6) leads and
  // Spread is the alternative. The validator refuses any other arrangement.
  modes: [
    { name: 'Focus', shape: 'line', range: 6 },
    { name: 'Spread', shape: 'cone', range: 2 },
  ],
  cooldown: 0, energyGain: 8,
  effects: [{ kind: 'damage', amount: 24 }],
  description: 'twin',
};

const SHOOTER: CharacterDef = {
  id: 'shooter', name: 'S', archetype: 'firepower', maxHp: 100,
  abilities: [TWIN],
  ultimate: {
    id: 'ult', name: 'U', phase: 'blast', shape: 'self', range: 0, cooldown: 0, energyGain: 0,
    effects: [{ kind: 'might', duration: 1 }], description: 'u',
  },
};
const DUMMY: CharacterDef = { ...SHOOTER, id: 'dummy', name: 'D', abilities: [TWIN] };
const roster: Roster = { shooter: SHOOTER, dummy: DUMMY };

describe('BASIC-MODES: the overlay is the geometry and nothing else', () => {
  it('a mode replaces shape and range, and keeps the ability its own', () => {
    const spread = abilityProfile(TWIN, 1);
    expect(spread.shape).toBe('cone');
    expect(spread.range).toBe(2);
    expect(spread.id, 'the same ability — cooldowns key off this').toBe(TWIN.id);
    expect(spread.effects, 'the same damage').toEqual(TWIN.effects);
    expect(spread.cooldown).toBe(TWIN.cooldown);
    expect(spread.energyGain).toBe(TWIN.energyGain);
    expect(spread.phase, 'and it resolves in the same phase').toBe(TWIN.phase);
  });

  it('the other mode is the other profile — and it is the base one', () => {
    const focus = abilityProfile(TWIN, 0);
    expect(focus.shape).toBe('line');
    expect(focus.range).toBe(6);
    expect(focus.name).toBe('Focus');
  });

  it('a mode inherits every field it does not name', () => {
    // The overlay is the profile's own keys, so a mode that says nothing about
    // `radius` gets the ability's — which is what makes a profile a *diff*.
    const bomb: AbilityDef = {
      ...TWIN, shape: 'circle', range: 5, radius: 2,
      modes: [{ shape: 'circle', range: 3 }, { shape: 'circle', range: 7 }],
    };
    expect(abilityProfile(bomb, 0).radius, 'inherited').toBe(2);
    expect(abilityProfile(bomb, 0).range, 'overridden').toBe(3);
  });

  it('an unnamed mode keeps the ability\'s name, so a label always exists', () => {
    const plain: AbilityDef = { ...TWIN, modes: [{ shape: 'cone', range: 2 }, { shape: 'line', range: 6 }] };
    expect(abilityProfile(plain, 0).name).toBe(TWIN.name);
  });

  it('an ability with no modes is returned untouched, by identity', () => {
    // Identity rather than equality: the overlay must not allocate on the path
    // every other ability in the game takes.
    const plain: AbilityDef = { ...TWIN, modes: undefined };
    expect(abilityProfile(plain, 0)).toBe(plain);
    expect(abilityProfile(plain, undefined)).toBe(plain);
  });

  it('an absent or impossible mode falls back to the default profile', () => {
    // The ability still exists and still has a profile. Refusing the turn over a
    // number would punish an old client for a field it has never heard of.
    for (const mode of [undefined, -1, 2, 99, 0.5, Number.NaN]) {
      expect(abilityProfile(TWIN, mode as number | undefined), String(mode)).toBe(TWIN);
    }
  });
});

describe('BASIC-MODES: each mode resolves its own profile', () => {
  /** Fire `twin` at the dummy in `mode`, and report the damage it took. */
  const shootAt = (mode: number | undefined, gap: number): number => {
    const state = createMatch(OPEN, '1v1', [[SHOOTER], [DUMMY]]);
    const shooter = state.units[0]!;
    const target = state.units[1]!;
    shooter.pos = { x: 5, y: 10 };
    target.pos = { x: 5 + gap, y: 10 };
    const before = target.hp;
    const ability = mode === undefined
      ? { abilityId: 'twin', target: [{ ...target.pos }] }
      : { abilityId: 'twin', target: [{ ...target.pos }], mode };
    const after = resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId: shooter.unitId, ability }] },
      { team: 1, units: [] },
    ], roster).state;
    return before - after.units.find((u) => u.unitId === target.unitId)!.hp;
  };

  it('the short mode cannot reach what the long mode can', () => {
    // The whole point of the toggle, as one assertion: same ability, same
    // target, same turn — and only one of the two arrives.
    expect(shootAt(0, 5), 'Focus reaches 5 squares').toBeGreaterThan(0);
    expect(shootAt(1, 5), 'Spread does not').toBe(0);
  });

  it('and both hit at a range they share', () => {
    expect(shootAt(0, 2)).toBeGreaterThan(0);
    expect(shootAt(1, 2)).toBeGreaterThan(0);
  });

  it('the damage is the same either way — the mode is the spacing, not the punch', () => {
    expect(shootAt(0, 2)).toBe(shootAt(1, 2));
  });

  it('no mode resolves as the ability\'s own profile — which is mode 0', () => {
    // MODE-BASE-INVARIANT is exactly this sentence made unbreakable: an order
    // with no mode, an order naming mode 0, and a client that has never heard of
    // modes all aim the same way, and the validator refuses content where they
    // would not.
    expect(shootAt(undefined, 5)).toBe(shootAt(0, 5));
    expect(shootAt(undefined, 5)).toBeGreaterThan(0);
  });

  it('an out-of-range mode index resolves rather than voiding the order', () => {
    expect(shootAt(7, 5), 'the default profile ran').toBe(shootAt(undefined, 5));
  });

  it('the wide mode catches a target the thin one misses', () => {
    // The other half of the trade, and the reason Spread is worth choosing: a
    // cone covers squares off the aim axis that a line never touches.
    const state = createMatch(OPEN, '1v1', [[SHOOTER], [DUMMY]]);
    const shooter = state.units[0]!;
    const target = state.units[1]!;
    shooter.pos = { x: 5, y: 10 };
    target.pos = { x: 6, y: 11 }; // one across and one down from the aim
    const fire = (mode: number): number => {
      const fresh = createMatch(OPEN, '1v1', [[SHOOTER], [DUMMY]]);
      fresh.units[0]!.pos = { ...shooter.pos };
      fresh.units[1]!.pos = { ...target.pos };
      const after = resolveTurn(fresh, OPEN, [
        {
          team: 0,
          units: [{
            unitId: fresh.units[0]!.unitId,
            ability: { abilityId: 'twin', target: [{ x: 7, y: 10 }], mode },
          }],
        },
        { team: 1, units: [] },
      ], roster).state;
      return fresh.units[1]!.hp - after.units[1]!.hp;
    };
    expect(fire(1), 'the cone spreads onto the off-axis square').toBeGreaterThan(0);
    expect(fire(0), 'the line does not').toBe(0);
  });
});

describe('BASIC-MODES: the validator refuses a malformed modes array', () => {
  const withModes = (modes: unknown): AbilityDef =>
    ({ ...TWIN, modes } as unknown as AbilityDef);

  it('rejects anything but exactly two profiles', () => {
    for (const bad of [[], [{ shape: 'line', range: 6 }], [{}, {}, {}], 'two', 7]) {
      expect(validateAbility(withModes(bad), 'x').join(' '), JSON.stringify(bad))
        .toMatch(/modes must be an array of exactly 2 profiles/);
    }
  });

  it('rejects a key that is not aim-time geometry — a mode is not a second ability', () => {
    const errs = validateAbility(withModes([
      { shape: 'cone', range: 2, cooldown: 0 },
      { shape: 'line', range: 6 },
    ]), 'x').join(' ');
    expect(errs).toMatch(/modes\[0\]: unknown key "cooldown"/);
    expect(errs, 'and the message says what a mode may change').toMatch(/may only change aiming/);
  });

  it('holds each merged mode to the shape\'s own rules', () => {
    // Re-validating the merged ability rather than writing a second rulebook: a
    // mode that becomes a circle needs a radius, and nobody had to remember that
    // here.
    const errs = validateAbility(withModes([
      { shape: 'circle', range: 4 },
      { shape: 'line', range: 6 },
    ]), 'x').join(' ');
    expect(errs).toMatch(/modes\[0\].*circle shape requires integer radius/);
  });

  it('and to the range cap, which a mode could otherwise walk around', () => {
    const errs = validateAbility(withModes([
      { shape: 'line', range: 99 },
      { shape: 'line', range: 6 },
    ]), 'x').join(' ');
    expect(errs).toMatch(/modes\[0\].*non-ultimate range must be <= /);
  });

  // MODE-BASE-INVARIANT (Builder OQ 2026-09-17 #2) — mode 0 IS the base profile.
  //
  // Three paths resolve an order: no `mode` field at all (an old client, or a
  // player who never touched the toggle), `mode: 0`, and an out-of-range index.
  // All three land on the ability's own `shape`+`range`. If `modes[0]` says
  // something else, the same ability aims two different ways depending on which
  // path the order took — so the content is refused rather than the three paths
  // reconciled.
  it('rejects a mode 0 whose SHAPE disagrees with the base', () => {
    const errs = validateAbility(withModes([
      { name: 'Spread', shape: 'cone', range: 6 },
      { name: 'Focus', shape: 'line', range: 6 },
    ]), 'x').join(' ');
    expect(errs).toMatch(/modes\[0\] shape "cone" must match the ability's own "line"/);
  });

  it('rejects a mode 0 whose RANGE disagrees with the base', () => {
    const errs = validateAbility(withModes([
      { name: 'Short', shape: 'line', range: 2 },
      { name: 'Focus', shape: 'line', range: 6 },
    ]), 'x').join(' ');
    expect(errs).toMatch(/modes\[0\] range 2 must match the ability's own 6/);
  });

  it('accepts a mode 0 that names nothing, because it inherits the base', () => {
    // A profile is a diff. One that changes only the label is mode 0 by
    // construction, and refusing it would be refusing the clearest way to write
    // the invariant down.
    expect(validateAbility(withModes([
      { name: 'Focus' },
      { name: 'Spread', shape: 'cone', range: 2 },
    ]), 'x')).toEqual([]);
  });

  it('says nothing about mode 1, which is the whole point of having one', () => {
    const errs = validateAbility(withModes([
      { name: 'Focus', shape: 'line', range: 6 },
      { name: 'Spread', shape: 'cone', range: 2 },
    ]), 'x');
    expect(errs).toEqual([]);
  });

  it('rejects two identical modes — a toggle that does nothing', () => {
    const errs = validateAbility(withModes([
      { name: 'A', shape: 'line', range: 6 },
      { name: 'B', shape: 'line', range: 6 },
    ]), 'x').join(' ');
    expect(errs, 'different labels, same geometry').toMatch(/the two modes are identical/);
  });

  it('accepts the shape Kestrel actually ships', () => {
    expect(validateAbility(TWIN, 'twin')).toEqual([]);
  });
});

describe('BASIC-MODES: Kestrel is back, and carries it', () => {
  const KESTREL = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../..', 'data/characters/kestrel.json'), 'utf8'),
  ) as CharacterDef;

  it('Twin Bolts is the wide-cone / thin-line pair the Designer specced', () => {
    const twin = KESTREL.abilities.find((a) => a.id === 'twin_bolts')!;
    expect(twin.modes).toEqual([
      { name: 'Focus', shape: 'line', range: 6 },
      { name: 'Spread', shape: 'cone', range: 2 },
    ]);
  });

  it('and the base profile is the one it always had, so nothing rebalanced', () => {
    // The data edit is the toggle and the description. Damage, cooldown, energy
    // and the default geometry are untouched — this is a knob, not a nerf.
    const twin = KESTREL.abilities.find((a) => a.id === 'twin_bolts')!;
    expect(twin.shape).toBe('line');
    expect(twin.range).toBe(6);
    expect(twin.effects).toEqual([{ kind: 'damage', amount: 24 }]);
    expect(twin.cooldown).toBe(0);
    expect(twin.energyGain).toBe(8);
  });

  it('the base profile and mode 0 agree, so an order with no mode is unchanged', () => {
    // MODE-BASE-INVARIANT turned this from a content convention nobody enforced
    // into a rule `validateAbility` refuses to let content break — which is what
    // lets the client show mode 0 as live for a draft that has not chosen.
    const twin = KESTREL.abilities.find((a) => a.id === 'twin_bolts')!;
    const focus = abilityProfile(twin, 0);
    expect(focus.shape).toBe(twin.shape);
    expect(focus.range).toBe(twin.range);
    expect(validateAbility(twin, 'kestrel.twin_bolts')).toEqual([]);
  });
});
