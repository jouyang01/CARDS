import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { validateAbility } from '../src/validate.js';
import { applyStatus, hasStatus } from '../src/status.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, TurnEvent, Vec2 } from '../src/types.js';

/**
 * CASTER-SAFE + RECOIL — Dev Notes #16/#18 (no self-harm) and #17 (the one
 * deliberate exception).
 *
 * Ravok's whole kit is `circle` abilities with `range: 0`, which is to say
 * areas centred on himself. FF1 rules that a harmful effect reaches every unit
 * standing in the area, "ally or enemy" — and the engine read that literally,
 * so Whirling Cleave took 22 off Ravok every time he swung it and Shockwave
 * took 12 and slowed him as well. FF1 was written about the people around you.
 *
 * The rule is therefore global rather than a per-ability flag: **a unit is
 * never a target of its own ability's harmful effects.** Beneficial effects are
 * untouched, and so is the ally standing next to you — CASTER-SAFE excludes the
 * caster and nobody else (excluding the team is ALLY-SAFE, a separate item, and
 * the ally tests below exist to keep the two from quietly merging).
 *
 * `selfDamagePct` is the way back in, on purpose: Seismic Rupture is a 38-damage
 * radius-3 ultimate and shattering the earth under your own feet should cost
 * something. The caster takes `floor(amount × pct / 100)` — 19 — bypassing cover
 * and the attacker's own Might/Weaken (it is the authored number scaled, not an
 * attack aimed at yourself) but consuming shields normally.
 *
 * RAVOK-RECOIL then opted **Whirling Cleave** in at the same 50%: 22 to every
 * adjacent enemy, 11 to Ravok. Worth being precise about what that is and is
 * not, because the two look alike from a distance. CASTER-SAFE is untouched —
 * the swing still does not *target* Ravok, so the Slow on Shockwave would still
 * skip him and Shockwave itself, carrying no `selfDamagePct`, still costs him
 * nothing. What changed is one authored number on one ability. The rule below
 * it did not move.
 *
 * **FRAG-SELF (2026-09-27) is the second way back in, and a different one.**
 * Owner: *"Vex Frag grenade should hurt yourself too."* `selfHarm` says the
 * caster is **just another unit standing in the area** — so it costs nothing if
 * you are not there, and everything if you are. RECOIL is a price for firing;
 * this is presence. An ability carrying both would charge twice for one blast,
 * and validation refuses the pair.
 *
 * Which leaves CASTER-SAFE exactly where it was: still the default, still what
 * makes Ravok's `range: 0` kit playable, and now with two named exits rather
 * than one. The tests for all three live together on purpose — the failure mode
 * is one of them quietly widening into the others.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const RAVOK = load('ravok');
const AEGIS = load('aegis');
const VEX = load('vex');

const OPEN: MapDef = {
  id: 't', name: 't', width: 25, height: 25, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 12 }, { x: 3, y: 12 }], [{ x: 22, y: 12 }, { x: 21, y: 12 }]],
};
const roster: Roster = { ravok: RAVOK, aegis: AEGIS, vex: VEX };
/** Read off the data — these tests are about who is spared, not about the number. */
const SHOCKWAVE_DAMAGE = RAVOK.abilities.find((a) => a.id === 'shockwave')!
  .effects.find((e) => e.kind === 'damage')!.amount!;

/** Ravok with an ally beside him and two enemies, each placed by the test. */
const field = (
  ravokAt: Vec2,
  allyAt: Vec2,
  enemyAt: Vec2,
  map: MapDef = OPEN,
) => {
  const state = createMatch(map, '2v2', [[RAVOK, AEGIS], [VEX, VEX]]);
  const ravok = state.units.find((u) => u.characterId === 'ravok')!;
  const ally = state.units.find((u) => u.characterId === 'aegis')!;
  const enemies = state.units.filter((u) => u.owner === 1);
  ravok.pos = { ...ravokAt };
  ally.pos = { ...allyAt };
  enemies[0]!.pos = { ...enemyAt };
  enemies[1]!.pos = { x: 24, y: 0 }; // parked far away, out of every area below
  return { state, ravok, ally, enemy: enemies[0]! };
};

/** Fire one of Ravok's abilities at `target` and hand back the whole result. */
const cast = (state: GameState, unitId: string, abilityId: string, target: Vec2, map: MapDef = OPEN) =>
  resolveTurn(state, map, [
    { team: 0, units: [{ unitId, ability: { abilityId, target: [{ ...target }] } }] },
    { team: 1, units: [] },
  ], roster);

const fire = (state: GameState, unitId: string, abilityId: string, target: Vec2, map: MapDef = OPEN) =>
  cast(state, unitId, abilityId, target, map).state;

const unit = (state: GameState, unitId: string) => state.units.find((u) => u.unitId === unitId)!;

/**
 * Which statuses a turn *applied* to a unit. Read from the events rather than
 * from `statuses`, because a `duration: 1` debuff is ticked off at end of turn
 * and would be invisible by the time the caller looks — the question here is
 * who the effect reached, not who is still carrying it.
 */
const applied = (events: readonly TurnEvent[], unitId: string): string[] => events
  .flatMap((e) => (e.type === 'statusApplied' && e.unitId === unitId ? [e.status] : []));

describe('CASTER-SAFE: your own attack does not hit you', () => {
  it('Whirling Cleave costs Ravok the authored 11, not the enemy\'s 22', () => {
    // The reported bug in one line: a radius-1 disc centred on Ravok used to
    // include Ravok for the *full* 22. RAVOK-RECOIL then priced the swing at
    // 11 — but through `selfDamagePct`, so the number is the Designer's and
    // the rule underneath is still "not a target of your own attack".
    const { state, ravok, enemy } = field({ x: 10, y: 10 }, { x: 24, y: 24 }, { x: 11, y: 10 });
    const after = fire(state, ravok.unitId, 'cleave', ravok.pos);
    expect(unit(after, ravok.unitId).hp, 'half of 22, floored').toBe(RAVOK.maxHp - 11);
    expect(unit(after, enemy.unitId).hp).toBe(VEX.maxHp - 22);
  });

  it('Shockwave takes neither the 12 nor the Slow off its caster', () => {
    // #16 named the damage; #18 named the status. One rule covers both, because
    // the whole harmful half of the effect list is skipped for the caster.
    const { state, ravok, enemy } = field({ x: 10, y: 10 }, { x: 24, y: 24 }, { x: 11, y: 10 });
    const res = cast(state, ravok.unitId, 'shockwave', ravok.pos);
    expect(unit(res.state, ravok.unitId).hp).toBe(RAVOK.maxHp);
    expect(applied(res.events, ravok.unitId), 'not slowed by his own tremor').toEqual([]);
    expect(unit(res.state, enemy.unitId).hp).toBe(VEX.maxHp - SHOCKWAVE_DAMAGE);
    expect(applied(res.events, enemy.unitId)).toContain('slow');
  });

  it('but the ALLY standing in the same swing is still hit — this is not ALLY-SAFE', () => {
    // The distinction the backlog draws explicitly. Friendly fire is on: park a
    // teammate inside your own area and you cut them down. Only *you* are safe.
    const { state, ravok, ally } = field({ x: 10, y: 10 }, { x: 10, y: 11 }, { x: 24, y: 1 });
    const after = fire(state, ravok.unitId, 'cleave', ravok.pos);
    // Ravok pays his own authored 11 (RAVOK-RECOIL); the ally takes the full
    // 22, which is the asymmetry the whole rule is about.
    expect(unit(after, ravok.unitId).hp).toBe(RAVOK.maxHp - 11);
    expect(unit(after, ally.unitId).hp, 'friendly fire survives the fix').toBe(AEGIS.maxHp - 22);
  });

  it('a Prep aura keeps its shield and drops its self-Weaken', () => {
    // Warding Halo is `{ shield 40, weaken 1 }` on a range-0 disc, so before the
    // fix Aegis shielded himself and weakened himself in the same breath. The
    // shield is beneficial and unaffected; the Weaken is harmful and gone.
    const { state, ally } = field({ x: 24, y: 24 }, { x: 10, y: 10 }, { x: 24, y: 1 });
    ally.energy = 100; // it is Aegis's ultimate
    const res = resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId: ally.unitId, ability: { abilityId: 'warding_halo', target: [{ ...ally.pos }] } }] },
      { team: 1, units: [] },
    ], roster);
    expect(hasStatus(unit(res.state, ally.unitId), 'shield'), 'the point of the ability').toBe(true);
    expect(applied(res.events, ally.unitId), 'and no self-Weaken beside it').toEqual(['shield']);
  });

  it('but the grenade you armed two turns ago WILL blow you up — FRAG-SELF', () => {
    // **This assertion is reversed.** It shipped asserting CASTER-SAFE reached a
    // delayed detonation too — "it is still your ability, so standing on it
    // should not blow you up". The owner ruled the other way: *"Vex Frag grenade
    // should hurt yourself too."*
    //
    // Kept here, in the CASTER-SAFE file, because the pair is the point. The
    // rule has not gone: it is still true of every `range: 0` disc a character
    // stands in the middle of, which is what it was written for. A grenade is
    // the case it was wrong about — you threw it somewhere else, and walking
    // into your own blast is a mistake the game should let you make. So the
    // ability opts out by name (`selfHarm`) and the default is untouched.
    const state = createMatch(OPEN, '2v2', [[VEX, AEGIS], [VEX, VEX]]);
    const vex = state.units.find((u) => u.owner === 0 && u.characterId === 'vex')!;
    for (const u of state.units.filter((x) => x.owner === 1)) u.pos = { x: 24, y: 0 };
    vex.pos = { x: 10, y: 10 };
    const armed = resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId: vex.unitId, ability: { abilityId: 'frag_grenade', target: [{ x: 14, y: 10 }] } }] },
      { team: 1, units: [] },
    ], roster).state;
    expect(armed.delayed.length, 'it really is pending').toBe(1);

    unit(armed, vex.unitId).pos = { x: 14, y: 10 }; // walk onto your own grenade
    const boom = resolveTurn(armed, OPEN, [{ team: 0, units: [] }, { team: 1, units: [] }], roster).state;
    expect(boom.delayed.length, 'and it really did detonate').toBe(0);
    const grenade = VEX.abilities.find((a) => a.id === 'frag_grenade')!;
    expect(unit(boom, vex.unitId).hp, 'caught in his own blast')
      .toBe(VEX.maxHp - grenade.effects.find((e) => e.kind === 'damage')!.amount!);
  });

  it('…and standing clear of it still costs him nothing', () => {
    // The other half: FRAG-SELF is about **presence**, not about a price for
    // throwing. A grenade you did not stand in is free, which is what separates
    // it from RECOIL — and why validation refuses an ability carrying both.
    const state = createMatch(OPEN, '2v2', [[VEX, AEGIS], [VEX, VEX]]);
    const vex = state.units.find((u) => u.owner === 0 && u.characterId === 'vex')!;
    for (const u of state.units.filter((x) => x.owner === 1)) u.pos = { x: 24, y: 0 };
    vex.pos = { x: 10, y: 10 };
    const armed = resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId: vex.unitId, ability: { abilityId: 'frag_grenade', target: [{ x: 14, y: 10 }] } }] },
      { team: 1, units: [] },
    ], roster).state;
    const boom = resolveTurn(armed, OPEN, [{ team: 0, units: [] }, { team: 1, units: [] }], roster).state;
    expect(boom.delayed.length, 'it went off').toBe(0);
    expect(unit(boom, vex.unitId).hp, 'nowhere near it').toBe(VEX.maxHp);
  });

  it('and CASTER-SAFE still holds for every ability that did not opt out', () => {
    // The guard on the exception. `selfHarm` is one field on one ability; a fix
    // that reached wider would take Ravok's whole kit with it.
    const opted = [...VEX.abilities, VEX.ultimate, ...RAVOK.abilities, RAVOK.ultimate,
      ...AEGIS.abilities, AEGIS.ultimate].filter((a) => a.selfHarm === true);
    expect(opted.map((a) => a.id), 'exactly one opt-out').toEqual(['frag_grenade']);
  });
});

describe('RECOIL: the opt-in exception', () => {
  /** Ravok with a full bar, so the ultimate is affordable. */
  const charged = (ravokAt: Vec2, allyAt: Vec2, enemyAt: Vec2, map?: MapDef) => {
    const f = field(ravokAt, allyAt, enemyAt, map);
    f.ravok.energy = 100;
    return f;
  };

  it('Seismic Rupture costs its caster 19 of the 38 it deals', () => {
    const { state, ravok, enemy } = charged({ x: 10, y: 10 }, { x: 24, y: 24 }, { x: 13, y: 10 });
    const after = fire(state, ravok.unitId, 'seismic_rupture', ravok.pos);
    expect(unit(after, ravok.unitId).hp).toBe(RAVOK.maxHp - 19);
    expect(unit(after, enemy.unitId).hp).toBe(VEX.maxHp - 38);
  });

  it('…and only the damage: the Root that comes with it still skips him', () => {
    // RECOIL is an exception for one field, not a re-opening of the harmful half.
    const { state, ravok, enemy } = charged({ x: 10, y: 10 }, { x: 24, y: 24 }, { x: 13, y: 10 });
    const res = cast(state, ravok.unitId, 'seismic_rupture', ravok.pos);
    expect(applied(res.events, ravok.unitId)).toEqual([]);
    expect(applied(res.events, enemy.unitId)).toContain('root');
  });

  it('an ability without the field costs its caster nothing', () => {
    // The default, stated as its own case so the exception cannot leak into it.
    //
    // Shockwave rather than Cleave: RAVOK-RECOIL gave Cleave the field, and the
    // two Ravok blasts now standing on opposite sides of this line is exactly
    // why the case is worth keeping — the rule is per-ability and authored, not
    // "melee discs hurt you".
    const { state, ravok } = field({ x: 10, y: 10 }, { x: 24, y: 24 }, { x: 11, y: 10 });
    const after = fire(state, ravok.unitId, 'shockwave', ravok.pos);
    expect(unit(after, ravok.unitId).hp).toBe(RAVOK.maxHp);
  });

  it('a shield absorbs the recoil before any HP is lost', () => {
    // "Consuming shields normally" — the recoil goes through `applyDamage` like
    // every other blow, so a 25-point shield eats all 19 and leaves 6.
    const { state, ravok } = charged({ x: 10, y: 10 }, { x: 24, y: 24 }, { x: 13, y: 10 });
    applyStatus(ravok, 'shield', 3, 25);
    const after = fire(state, ravok.unitId, 'seismic_rupture', ravok.pos);
    const me = unit(after, ravok.unitId);
    expect(me.hp, 'untouched behind the shield').toBe(RAVOK.maxHp);
    expect(me.statuses.find((s) => s.kind === 'shield')?.amount).toBe(6);
  });

  it('Might raises what the enemy takes and leaves the recoil at 19', () => {
    // The recoil is the authored number scaled by its own percentage, not an
    // attack Ravok aimed at himself — so his own damage modifiers do not touch
    // it in either direction.
    const { state, ravok, enemy } = charged({ x: 10, y: 10 }, { x: 24, y: 24 }, { x: 13, y: 10 });
    applyStatus(ravok, 'might', 2);
    const after = fire(state, ravok.unitId, 'seismic_rupture', ravok.pos);
    expect(unit(after, enemy.unitId).hp, 'the enemy feels the Might').toBeLessThan(VEX.maxHp - 38);
    expect(unit(after, ravok.unitId).hp, 'he does not').toBe(RAVOK.maxHp - 19);
  });

  it('Weaken lowers what the enemy takes and still leaves the recoil at 19', () => {
    const { state, ravok, enemy } = charged({ x: 10, y: 10 }, { x: 24, y: 24 }, { x: 13, y: 10 });
    applyStatus(ravok, 'weaken', 2);
    const after = fire(state, ravok.unitId, 'seismic_rupture', ravok.pos);
    expect(unit(after, enemy.unitId).hp).toBeGreaterThan(VEX.maxHp - 38);
    expect(unit(after, ravok.unitId).hp).toBe(RAVOK.maxHp - 19);
  });

  it('a recoil that kills its caster scores for nobody', () => {
    // You can end yourself with your own ultimate — but the enemy team did not
    // earn that, and the 38 you swung still lands, because every hit including
    // the recoil is gathered before any of it is applied.
    const { state, ravok, enemy } = charged({ x: 10, y: 10 }, { x: 24, y: 24 }, { x: 13, y: 10 });
    ravok.hp = 12;
    const after = fire(state, ravok.unitId, 'seismic_rupture', ravok.pos);
    expect(unit(after, ravok.unitId).alive).toBe(false);
    expect(after.kills).toEqual([0, 0]);
    expect(unit(after, enemy.unitId).hp, 'the earthquake happened anyway').toBe(VEX.maxHp - 38);
  });
});

describe('RECOIL: cover is a thing between two units, not under your feet', () => {
  // Seismic Rupture cannot show this on its own — `range: 0` means cover is
  // never checked for it at all — so the property gets a purpose-built ability:
  // a ranged blast whose victim IS behind cover while its caster is not.
  //
  // AOE-LoS re-specced the geometry, not the property. The shell used to be a
  // `radius: 0` burst aimed **at the victim's own square**, and cover was
  // measured from the *caster* — so the barricade the victim stood beside
  // halved it. Cover is now measured from the blast's **centre**, and there is
  // nothing between you and an explosion going off under your feet, so that
  // aim now deals full damage. The correct shape for "the victim IS behind
  // cover from this blast" is a disc whose centre sits on the far side of the
  // barricade, which is what the cast below is.
  const shellShape: AbilityDef = {
    id: 'shell', name: 'Shell', phase: 'blast', shape: 'circle', range: 6, radius: 2,
    cooldown: 0, energyGain: 0, selfDamagePct: 50,
    effects: [{ kind: 'damage', amount: 40 }], description: 'test',
  };
  const GUNNER: CharacterDef = {
    id: 'gunner', name: 'Gunner', archetype: 'firepower', maxHp: 100,
    abilities: [shellShape],
    ultimate: { ...shellShape, id: 'shell_ult', selfDamagePct: undefined, effects: [{ kind: 'damage', amount: 1 }] },
  };
  const COVERED: MapDef = {
    ...OPEN, id: 'c', cover: [{ x: 13, y: 10 }],
  };
  const gunRoster: Roster = { gunner: GUNNER, vex: VEX };

  it('the enemy is halved by the cover; the caster still pays the full 20', () => {
    const state = createMatch(COVERED, '2v2', [[GUNNER, GUNNER], [VEX, VEX]]);
    const [me, mate] = state.units.filter((u) => u.owner === 0);
    const [them, other] = state.units.filter((u) => u.owner === 1);
    me!.pos = { x: 8, y: 10 };
    mate!.pos = { x: 24, y: 24 };
    them!.pos = { x: 14, y: 10 };
    other!.pos = { x: 24, y: 0 };
    // Centre at (12,10): the cover at (13,10) is between it and the victim at
    // (14,10), so the centre→victim line crosses the shared edge and the
    // COVER-EDGE half applies. The caster stands four tiles back, outside its
    // own disc — CASTER-SAFE would spare it anyway; the point is that the
    // recoil below is the *only* thing that touches it.
    const after = resolveTurn(state, COVERED, [
      { team: 0, units: [{ unitId: me!.unitId, ability: { abilityId: 'shell', target: [{ x: 12, y: 10 }] } }] },
      { team: 1, units: [] },
    ], gunRoster).state;
    expect(unit(after, them!.unitId).hp, 'cover halves the shell').toBe(VEX.maxHp - 20);
    expect(unit(after, me!.unitId).hp, 'the recoil ignores it').toBe(100 - 20);
  });
});

describe('CASTER-SAFE: selfDamagePct is validated like any other field', () => {
  const base: AbilityDef = {
    id: 'x', name: 'X', phase: 'blast', shape: 'circle', range: 4, radius: 1,
    cooldown: 0, energyGain: 4, effects: [{ kind: 'damage', amount: 20 }], description: 'test',
  };

  it('accepts a whole percentage in 1..100', () => {
    expect(validateAbility({ ...base, selfDamagePct: 50 }, 'x')).toEqual([]);
    expect(validateAbility({ ...base, selfDamagePct: 1 }, 'x')).toEqual([]);
    expect(validateAbility({ ...base, selfDamagePct: 100 }, 'x')).toEqual([]);
  });

  it('rejects 0, a negative, an overshoot and a fraction', () => {
    for (const bad of [0, -10, 101, 50.5]) {
      expect(validateAbility({ ...base, selfDamagePct: bad }, 'x').join(' '), String(bad))
        .toMatch(/selfDamagePct must be an integer 1\.\.100/);
    }
  });

  it('rejects it on an ability with no damage to take a fraction OF', () => {
    // A percentage of nothing is nothing — a content bug that would otherwise
    // sit there silently doing exactly zero.
    const healer: AbilityDef = { ...base, effects: [{ kind: 'heal', amount: 20 }], selfDamagePct: 50 };
    expect(validateAbility(healer, 'x').join(' ')).toMatch(/selfDamagePct needs a damage effect/);
  });

  it('and the shipped Seismic Rupture carries it', () => {
    // The data half of this commit, asserted from the file rather than restated.
    expect(RAVOK.ultimate.id).toBe('seismic_rupture');
    expect(RAVOK.ultimate.selfDamagePct).toBe(50);
    expect(validateAbility(RAVOK.ultimate, 'ravok.ultimate')).toEqual([]);
  });
});
