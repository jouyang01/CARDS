import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { buildRoster } from '../src/setup.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders } from '../src/types.js';

/**
 * PREP-AOE — a Prep beneficial area ability reaches every ally in its area.
 *
 * The bug this closes: `firePrep`'s non-trap branch applied the effects to the
 * caster and ignored `a.area` completely, so Aegis's Barrier Pulse — a `circle`
 * of radius 1 — only ever shielded Aegis. It read as "the shield is tiny"
 * rather than as "the area is not being used", which is why it survived a
 * session: the ability fired, an event landed, and one unit really was shielded.
 */

const OPEN = makeMap(Array.from({ length: 15 }, () => '.'.repeat(15)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'prep', shape: 'circle', range: 4, radius: 1, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'shield', amount: 25, duration: 2 }], description: over.id, ...over,
});

const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'support', maxHp: 100,
  abilities: [
    ability({ id: 'pulse' }), // the Barrier Pulse shape
    ability({ id: 'mend', effects: [{ kind: 'heal', amount: 20 }] }),
    ability({ id: 'brace', shape: 'self', range: 0 }), // a self-cast, unchanged
    ability({ id: 'snare', shape: 'square', range: 4, effects: [{ kind: 'trap', amount: 20, duration: 3 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, units: UnitOrders[]) =>
  resolveTurn(s, OPEN, [{ team: 0, units }, { team: 1, units: [] }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const shieldOf = (s: GameState, id: string) =>
  unit(s, id).statuses.filter((st) => st.kind === 'shield').reduce((n, st) => n + (st.amount ?? 0), 0);
const shieldCount = (s: GameState, id: string) =>
  unit(s, id).statuses.filter((st) => st.kind === 'shield').length;

/** Caster, one ally beside it, one ally out of reach, one enemy in the area. */
const setup = (): GameState => makeState([
  makeUnit('caster', 0, { x: 5, y: 7 }, { characterId: 'test-char' }),
  makeUnit('near', 0, { x: 8, y: 7 }, { characterId: 'test-char' }),
  makeUnit('far', 0, { x: 12, y: 7 }, { characterId: 'test-char' }),
  makeUnit('enemy', 1, { x: 7, y: 7 }, { characterId: 'test-char' }),
]);

describe('PREP-AOE: a Prep beneficial area shields every ally standing in it', () => {
  it('shields TWO allies when both are in the radius — the reported bug', () => {
    const s = setup();
    unit(s, 'near').pos = { x: 7, y: 7 };
    unit(s, 'far').pos = { x: 7, y: 8 }; // both inside a radius-1 circle at (7,7)
    unit(s, 'enemy').pos = { x: 0, y: 0 };
    const { state } = run(s, [{ unitId: 'caster', ability: { abilityId: 'pulse', target: [{ x: 7, y: 7 }] } }]);
    expect(shieldOf(state, 'near')).toBe(25);
    expect(shieldOf(state, 'far')).toBe(25);
  });

  it('shields each ally exactly ONCE, caster included', () => {
    // The double-application trap: the caster gets its self-effects and is also
    // standing in its own area, so a naive fix shields it twice.
    const s = setup();
    unit(s, 'near').pos = { x: 6, y: 7 };
    const { state } = run(s, [{ unitId: 'caster', ability: { abilityId: 'pulse', target: [{ x: 5, y: 7 }] } }]);
    expect(shieldOf(state, 'caster')).toBe(25);
    expect(shieldCount(state, 'caster')).toBe(1);
    expect(shieldOf(state, 'near')).toBe(25);
    expect(shieldCount(state, 'near')).toBe(1);
  });

  it('leaves an ally outside the radius alone', () => {
    const { state } = run(setup(), [{ unitId: 'caster', ability: { abilityId: 'pulse', target: [{ x: 8, y: 7 }] } }]);
    expect(shieldOf(state, 'near')).toBe(25); // at (8,7), the centre
    expect(shieldOf(state, 'far')).toBe(0); // 4 away
  });

  it('never reaches an ENEMY standing in the area (FF1 polarity)', () => {
    const { state } = run(setup(), [{ unitId: 'caster', ability: { abilityId: 'pulse', target: [{ x: 7, y: 7 }] } }]);
    expect(shieldOf(state, 'enemy')).toBe(0);
  });

  it('heals the same way it shields — the rule is the effect polarity, not the kind', () => {
    const s = setup();
    unit(s, 'near').pos = { x: 7, y: 7 };
    unit(s, 'near').hp = 50;
    unit(s, 'caster').hp = 50;
    const { state } = run(s, [{ unitId: 'caster', ability: { abilityId: 'mend', target: [{ x: 6, y: 7 }] } }]);
    expect(unit(state, 'caster').hp).toBe(70);
    expect(unit(state, 'near').hp).toBe(70);
  });

  it('aimed at empty space it shields NOBODY — not even the caster (MENDING-RANGE)', () => {
    // This used to shield the caster. The caster's self-effects *are* an area
    // question: an aimed circle that reached its caster from anywhere on the
    // board is what the owner reported as "Mending Light heals outside its
    // range" (Dev Note #12). Aiming at nothing now buffs nothing.
    const { state } = run(setup(), [{ unitId: 'caster', ability: { abilityId: 'pulse', target: [{ x: 5, y: 4 }] } }]);
    expect(shieldOf(state, 'caster')).toBe(0);
    expect(shieldOf(state, 'near')).toBe(0);
    expect(shieldOf(state, 'far')).toBe(0);
  });

  it('…and the caster gets it by AIMING at itself, which is the whole point', () => {
    // The boon is not gone, it is targeted. A `circle` reaches range 0, so a
    // caster who wants the shield asks for it — one decision, not a freebie.
    const { state } = run(setup(), [{ unitId: 'caster', ability: { abilityId: 'pulse', target: [{ x: 5, y: 7 }] } }]);
    expect(shieldOf(state, 'caster')).toBe(25);
    expect(shieldCount(state, 'caster'), 'and exactly once').toBe(1);
  });

  it('a self-cast is unchanged — it was never the broken case', () => {
    const s = setup();
    unit(s, 'near').pos = { x: 6, y: 7 }; // adjacent, but `self` has no area to be in
    const { state } = run(s, [{ unitId: 'caster', ability: { abilityId: 'brace', target: [] } }]);
    expect(shieldOf(state, 'caster')).toBe(25);
    expect(shieldOf(state, 'near')).toBe(0);
  });

  it('a trap Prep ability is untouched — it places, it does not buff', () => {
    const { state } = run(setup(), [{ unitId: 'caster', ability: { abilityId: 'snare', target: [{ x: 7, y: 7 }] } }]);
    expect(state.traps).toHaveLength(1);
    expect(shieldOf(state, 'caster')).toBe(0);
    expect(shieldOf(state, 'near')).toBe(0);
  });

  it('a free Prep ability gets the same treatment — one code path', () => {
    const free: CharacterDef = {
      ...CHAR,
      id: 'free-char',
      abilities: [{ ...ability({ id: 'ward' }), free: true, cooldown: 3 }],
    };
    const s = makeState([
      makeUnit('caster', 0, { x: 5, y: 7 }, { characterId: 'free-char' }),
      makeUnit('near', 0, { x: 6, y: 7 }, { characterId: 'free-char' }),
    ]);
    const { state } = resolveTurn(
      s, OPEN,
      [{ team: 0, units: [{ unitId: 'caster', freeAbility: { abilityId: 'ward', target: [{ x: 6, y: 7 }] } }] },
        { team: 1, units: [] }],
      { 'free-char': free },
    );
    expect(shieldOf(state, 'near')).toBe(25);
  });
});

describe('PREP-AOE: the shipped roster', () => {
  it("Aegis's Barrier Pulse shields the ally it was aimed at", () => {
    // The Dev Note, driven through the real content rather than a fixture.
    const aegis = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../data/characters/aegis.json'), 'utf8'),
    ) as CharacterDef;
    const pulse = aegis.abilities.find((a) => a.id === 'barrier_pulse')!;
    expect(pulse.phase).toBe('prep');
    expect(pulse.shape).toBe('circle');

    const s = makeState([
      makeUnit('aegis', 0, { x: 5, y: 7 }, { characterId: 'aegis' }),
      makeUnit('ally1', 0, { x: 7, y: 7 }, { characterId: 'aegis' }),
      makeUnit('ally2', 0, { x: 7, y: 8 }, { characterId: 'aegis' }),
    ]);
    const { events } = resolveTurn(
      s, OPEN,
      [{ team: 0, units: [{ unitId: 'aegis', ability: { abilityId: 'barrier_pulse', target: [{ x: 7, y: 7 }] } }] },
        { team: 1, units: [] }],
      buildRoster([aegis]),
    );
    const amount = pulse.effects.find((e) => e.kind === 'shield')!.amount!;
    // Barrier Pulse is duration 1, so it is gone by the end-of-turn tick — the
    // events are where a one-turn shield leaves its evidence.
    const shielded = events.flatMap((e) =>
      e.type === 'statusApplied' && e.status === 'shield' && e.abilityId === 'barrier_pulse'
        ? [[e.unitId, e.amount]]
        : []);
    // MENDING-RANGE: Aegis is at (5,7) and the radius-1 circle at (7,7) does not
    // cover her, so she is no longer shielded by a pulse aimed past herself.
    // The Dev Note this test was written for — "it only ever shielded Aegis" —
    // is still answered: both allies in the circle get it.
    expect(shielded.map(([id]) => id).sort()).toEqual(['ally1', 'ally2']);
    for (const [, got] of shielded) expect(got).toBe(amount);
  });
});
