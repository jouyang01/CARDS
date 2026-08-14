import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { buildRoster } from '../src/setup.js';
import { validateAbility } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, TeamId, UnitOrders } from '../src/types.js';

/**
 * DASH-IMPACT — a dash may detonate where it takes off and/or where it lands.
 *
 * The architectural half matters as much as the feature: the teleport-strike's
 * Manhattan-1 adjacency was a hardcoded branch in the resolver with exactly one
 * user, and it is now a number in `data/`. A special case became content.
 */

const OPEN = makeMap(Array.from({ length: 15 }, () => '.'.repeat(15)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'dash', shape: 'square', range: 6, cooldown: 0, energyGain: 4,
  effects: [{ kind: 'damage', amount: 30 }], description: over.id, ...over,
});

const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'frontline', maxHp: 100,
  abilities: [
    // A leap that detonates on landing, and the same leap without an impact.
    ability({ id: 'leap', impact: { destination: 2 } }),
    ability({ id: 'plain_leap' }),
    // A walked charge that hits the first body AND detonates where it stops.
    ability({ id: 'bull', shape: 'path', range: 4, impact: { destination: 2 }, effects: [{ kind: 'damage', amount: 14 }, { kind: 'knockback', amount: 1 }] }),
    // Takeoff blast: leave a hole behind you.
    ability({ id: 'kickoff', impact: { origin: 1 } }),
  ],
  ultimate: ability({
    id: 'guard', shape: 'square', range: 4, energyGain: 0, impact: { destination: 1 },
    effects: [{ kind: 'teleport' }, { kind: 'shield', amount: 12, duration: 2 }],
  }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = []) =>
  resolveTurn(s, OPEN, [{ team: 0 as TeamId, units: u0 }, { team: 1 as TeamId, units: u1 }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const hpOf = (s: GameState, id: string) => unit(s, id).hp;

describe('DASH-IMPACT: a square dash detonates on landing', () => {
  it('catches everything inside the Euclidean radius, and nothing outside it', () => {
    const s = makeState([
      makeUnit('u', 0, { x: 0, y: 7 }, { characterId: 'test-char' }),
      makeUnit('near', 1, { x: 8, y: 7 }, { characterId: 'test-char' }), // 2 away
      makeUnit('edge', 1, { x: 7, y: 5 }, { characterId: 'test-char' }), // 2.24 — out
      makeUnit('far', 1, { x: 6, y: 4 }, { characterId: 'test-char' }), // well out
    ]);
    const { state } = run(s, [{ unitId: 'u', ability: { abilityId: 'leap', target: [{ x: 6, y: 7 }] } }]);
    expect(unit(state, 'u').pos).toEqual({ x: 6, y: 7 });
    expect(hpOf(state, 'near')).toBe(70);
    expect(hpOf(state, 'edge')).toBe(100); // 2.24 > 2: the disc has no diagonal bonus
    expect(hpOf(state, 'far')).toBe(100);
  });

  it('absent `impact` is today’s behaviour exactly — a leap that hits nothing', () => {
    const s = makeState([
      makeUnit('u', 0, { x: 0, y: 7 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 7, y: 7 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(s, [{ unitId: 'u', ability: { abilityId: 'plain_leap', target: [{ x: 6, y: 7 }] } }]);
    expect(unit(state, 'u').pos).toEqual({ x: 6, y: 7 }); // it still moves
    expect(hpOf(state, 'e')).toBe(100); // …and no longer strikes on arrival
  });

  it('an `origin` blast fires where the dasher took off from', () => {
    const s = makeState([
      makeUnit('u', 0, { x: 4, y: 7 }, { characterId: 'test-char' }),
      makeUnit('behind', 1, { x: 4, y: 8 }, { characterId: 'test-char' }), // beside the takeoff
      makeUnit('ahead', 1, { x: 9, y: 7 }, { characterId: 'test-char' }), // beside the landing
    ]);
    const { state } = run(s, [{ unitId: 'u', ability: { abilityId: 'kickoff', target: [{ x: 8, y: 7 }] } }]);
    expect(hpOf(state, 'behind')).toBe(70);
    expect(hpOf(state, 'ahead')).toBe(100); // `kickoff` declares no destination blast
  });
});

describe('DASH-IMPACT: a walked charge hits the first body AND detonates', () => {
  it('damages the crossed unit and the blast, each unit exactly once', () => {
    // The charge crosses `first` at (2,7) and comes to rest past it; `bystander`
    // is not on the path but is inside the radius-2 landing blast.
    const s = makeState([
      makeUnit('u', 0, { x: 0, y: 7 }, { characterId: 'test-char' }),
      makeUnit('first', 1, { x: 2, y: 7 }, { characterId: 'test-char' }),
      makeUnit('bystander', 1, { x: 4, y: 8 }, { characterId: 'test-char' }),
    ]);
    const { state, events } = run(s, [{
      unitId: 'u',
      ability: { abilityId: 'bull', target: [{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }] },
    }]);
    // `first` is both crossed and inside the blast — it takes 14, not 28.
    expect(hpOf(state, 'first')).toBe(86);
    expect(events.filter((e) => e.type === 'damage' && e.unitId === 'first')).toHaveLength(1);
    expect(hpOf(state, 'bystander')).toBe(86);
  });

  it('detonates where the charge actually STOPPED, not where it aimed', () => {
    // A charge passes THROUGH bodies and rests on the furthest free square
    // (MV1). With (3,7) and (4,7) both occupied that is (2,7) — two short of the
    // aim. The blast has to follow the unit, not the order.
    const s = makeState([
      makeUnit('u', 0, { x: 0, y: 7 }, { characterId: 'test-char' }),
      makeUnit('block1', 1, { x: 3, y: 7 }, { characterId: 'test-char' }),
      makeUnit('block2', 1, { x: 4, y: 7 }, { characterId: 'test-char' }),
      makeUnit('nearStop', 1, { x: 2, y: 5 }, { characterId: 'test-char' }), // 2 from (2,7)
      makeUnit('nearAim', 1, { x: 6, y: 7 }, { characterId: 'test-char' }), // 2 from the aimed (4,7)
    ]);
    const { state } = run(s, [{
      unitId: 'u',
      ability: { abilityId: 'bull', target: [{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }] },
    }]);
    expect(unit(state, 'u').pos).toEqual({ x: 2, y: 7 });
    expect(hpOf(state, 'nearStop')).toBe(86);
    expect(hpOf(state, 'nearAim')).toBe(100);
  });

  it('knockback from the blast pushes away from where it went off', () => {
    const s = makeState([
      makeUnit('u', 0, { x: 0, y: 7 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 4, y: 9 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(s, [{
      unitId: 'u',
      ability: { abilityId: 'bull', target: [{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }] },
    }]);
    // Blast centre is (4,7); the victim at (4,9) is pushed further south.
    expect(unit(state, 'e').pos).toEqual({ x: 4, y: 10 });
  });
});

describe('DASH-IMPACT: FF1 polarity — harmful to enemies, beneficial to allies', () => {
  it('shields ALLIES at the destination — the bodyguard dive', () => {
    // The half of `impact` that makes Aegis's Intercept do its one job: before
    // this it teleported to the ally being dived and arrived with nothing.
    const s = makeState([
      makeUnit('u', 0, { x: 1, y: 7 }, { characterId: 'test-char', energy: 100 }),
      makeUnit('ally', 0, { x: 4, y: 7 }, { characterId: 'test-char' }),
      makeUnit('enemy', 1, { x: 3, y: 7 }, { characterId: 'test-char' }),
    ]);
    // (4,6) is 3.16 from (1,7) — inside the ult's Euclidean range 4.
    const { state } = run(s, [{ unitId: 'u', ability: { abilityId: 'guard', target: [{ x: 4, y: 6 }] } }]);
    const shieldOf = (id: string) =>
      unit(state, id).statuses.find((st) => st.kind === 'shield')?.amount ?? 0;
    expect(shieldOf('ally')).toBe(12);
    expect(shieldOf('u')).toBe(12); // the caster shields itself, exactly once
    expect(shieldOf('enemy')).toBe(0); // beneficial effects never reach an enemy
  });

  it('a harmful blast spares allies standing in it', () => {
    const s = makeState([
      makeUnit('u', 0, { x: 0, y: 7 }, { characterId: 'test-char' }),
      makeUnit('ally', 0, { x: 7, y: 7 }, { characterId: 'test-char' }),
      makeUnit('enemy', 1, { x: 5, y: 7 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(s, [{ unitId: 'u', ability: { abilityId: 'leap', target: [{ x: 6, y: 7 }] } }]);
    expect(hpOf(state, 'ally')).toBe(100);
    expect(hpOf(state, 'enemy')).toBe(70);
  });

  it('energy is once per use and needs an enemy — a blast that hits only air pays nothing', () => {
    const alone = makeState([
      makeUnit('u', 0, { x: 0, y: 7 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 14, y: 0 }, { characterId: 'test-char' }),
    ]);
    expect(unit(run(alone, [{ unitId: 'u', ability: { abilityId: 'leap', target: [{ x: 6, y: 7 }] } }]).state, 'u').energy)
      .toBe(5); // the passive tick only

    const crowd = makeState([
      makeUnit('u', 0, { x: 0, y: 7 }, { characterId: 'test-char' }),
      makeUnit('a', 1, { x: 6, y: 8 }, { characterId: 'test-char' }),
      makeUnit('b', 1, { x: 7, y: 7 }, { characterId: 'test-char' }),
    ]);
    // Two enemies caught, one `energyGain` — not two.
    expect(unit(run(crowd, [{ unitId: 'u', ability: { abilityId: 'leap', target: [{ x: 6, y: 7 }] } }]).state, 'u').energy)
      .toBe(4 + 5);
  });
});

describe('DASH-IMPACT: validation', () => {
  const dash = (impact: unknown): AbilityDef =>
    ({ ...ability({ id: 'x' }), impact } as unknown as AbilityDef);

  it('accepts either member, or both', () => {
    for (const impact of [{ origin: 1 }, { destination: 3 }, { origin: 1, destination: 2 }]) {
      expect(validateAbility(dash(impact), 'x')).toEqual([]);
    }
  });

  it('rejects `impact` on anything that is not a dash', () => {
    const blast = { ...ability({ id: 'x', phase: 'blast', shape: 'circle', radius: 2 }), impact: { destination: 2 } };
    expect(validateAbility(blast, 'x').join(' ')).toMatch(/impact is only valid on a "dash" ability/);
  });

  it('rejects a radius that is not an integer >= 1', () => {
    for (const bad of [{ destination: 0 }, { destination: -1 }, { origin: 1.5 }, { origin: '2' }]) {
      expect(validateAbility(dash(bad), 'x').join(' '), JSON.stringify(bad)).toMatch(/must be an integer >= 1/);
    }
  });

  it('rejects an empty block and an unknown member — a typo must not go quiet', () => {
    // This is the check that did not exist: `validateAbility` lets unknown keys
    // through, so the three staged `impact` blocks sat in data/ for a session
    // and the suite accepted them silently.
    expect(validateAbility(dash({}), 'x').join(' ')).toMatch(/at least one of origin\/destination/);
    expect(validateAbility(dash({ destinaton: 2 }), 'x').join(' ')).toMatch(/unknown impact member "destinaton"/);
    expect(validateAbility(dash([1, 2]), 'x').join(' ')).toMatch(/impact must be an object/);
  });
});

describe('DASH-IMPACT: the shipped roster', () => {
  const dir = join(import.meta.dirname, '../../../data/characters');
  const characters = readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as CharacterDef);
  const withImpact = characters.flatMap((c) =>
    [...c.abilities, c.ultimate].filter((a) => a.impact !== undefined).map((a) => ({ c, a })));

  it('the three staged blocks are live, and every one validates', () => {
    expect(withImpact.map(({ a }) => a.id).sort()).toEqual(['bullrush', 'intercept', 'shadowstep_strike']);
    for (const { a } of withImpact) expect(validateAbility(a, a.id)).toEqual([]);
  });

  it('no `square` dash deals damage without an impact — nothing lost to the deleted branch', () => {
    // The audit the deletion rests on: the hardcoded adjacency had exactly one
    // user. If a future kit adds a damaging `square` dash and forgets `impact`,
    // it would silently hit nobody — this is what catches that.
    for (const c of characters) {
      for (const a of [...c.abilities, c.ultimate]) {
        if (a.phase !== 'dash' || a.shape !== 'square') continue;
        if (!a.effects.some((e) => e.kind === 'damage')) continue;
        expect(a.impact, `${c.id}/${a.id} damages on a square dash but declares no impact`).toBeDefined();
      }
    }
  });

  it("Wisp's Shadowstep still strikes its neighbours — a formalisation, not a change", () => {
    const wisp = characters.find((c) => c.id === 'wisp')!;
    const kit = buildRoster([wisp]);
    const s = makeState([
      makeUnit('w', 0, { x: 0, y: 7 }, { characterId: 'wisp', energy: 100 }),
      makeUnit('orth', 1, { x: 5, y: 7 }, { characterId: 'wisp' }),
      makeUnit('diag', 1, { x: 5, y: 8 }, { characterId: 'wisp' }),
    ]);
    const { state } = resolveTurn(
      s, OPEN,
      [{ team: 0, units: [{ unitId: 'w', ability: { abilityId: 'shadowstep_strike', target: [{ x: 4, y: 7 }] } }] },
        { team: 1, units: [] }],
      kit,
    );
    expect(unit(state, 'w').pos).toEqual({ x: 4, y: 7 });
    expect(hpOf(state, 'orth')).toBeLessThan(100); // 1 away — struck
    expect(hpOf(state, 'diag')).toBe(100); // 1.41 away — spared, as before
  });
});
