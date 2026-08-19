import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { validateAbility } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, AbilityEffect, CharacterDef, GameState, TrapState, UnitOrders } from '../src/types.js';

/**
 * TRAP-HALT — a halting trap ends the mover's movement on the square it caught
 * them (Dev Note #10b).
 *
 * Snare Bloom shipped as an interim: damage and a Slow, with the halt the note
 * actually asked for left as a TODO in its own description. `halt: true` on the
 * trap effect completes it.
 *
 * The mechanism is deliberately the one already there. `triggerTrapsOnEntry`
 * returned "the victim died", and every caller read that as *stop walking* — a
 * Move step discarded the rest of the path, a charge stopped where it stood. A
 * halt is the same sentence with a different reason, so it travels the same
 * channel rather than growing a second one.
 *
 * It is a stop, not a displacement: nothing is pushed, and nothing else about
 * the turn is cancelled beyond the steps that never happened. Unstoppable
 * ignores it, exactly as it already ignores the Slow the same trap carries.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;
const THORN = load('thorn');
const SNARE = THORN.abilities.find((a) => a.id === 'snare_bloom')!;

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'square', range: 6, cooldown: 0, energyGain: 0,
  effects: [], description: over.id, ...over,
});
const char: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 6, effects: [{ kind: 'damage', amount: 5 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 13 }, () => '.'.repeat(13)));

/** A pre-armed enemy trap, so the tests are about triggering, not placement. */
const snare = (x: number, y: number, over: Partial<TrapState> = {}): TrapState => ({
  id: `snare-${x}-${y}`, owner: 0, ownerUnitId: 'owner', abilityId: 'snare_bloom',
  pos: { x, y }, damage: 12, expiresOnTurn: 99, halt: true,
  onTrigger: [{ kind: 'slow', duration: 2 }], ...over,
});

const run = (s: GameState, u1: UnitOrders[]) =>
  resolveTurn(s, OPEN(), [{ team: 0, units: [] }, { team: 1, units: u1 }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

/** A team-1 walker four steps east of a snare-laying team-0 unit. */
const walker = (overrides = {}) => {
  const owner = makeUnit('owner', 0, { x: 0, y: 12 });
  const mover = makeUnit('M', 1, { x: 4, y: 6 }, overrides);
  return { owner, mover };
};
const east = [{ x: 5, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }];

describe('TRAP-HALT: a mover stops on the square that caught it', () => {
  it('the rest of the path is dropped, and the walker is standing on the snare', () => {
    const { owner, mover } = walker();
    const { state } = run(makeState([owner, mover], { traps: [snare(6, 6)] }),
      [{ unitId: 'M', movePath: east }]);
    expect(unit(state, 'M').pos, 'stopped where it was caught').toEqual({ x: 6, y: 6 });
    expect(unit(state, 'M').hp, 'and took the trap').toBe(88);
  });

  it('a trap without the flag lets the walk finish', () => {
    // The control. Everything else about this trap is identical, so the stop is
    // attributable to `halt` and to nothing else in the fixture.
    const { owner, mover } = walker();
    const { state } = run(makeState([owner, mover], { traps: [snare(6, 6, { halt: undefined })] }),
      [{ unitId: 'M', movePath: east }]);
    expect(unit(state, 'M').pos).toEqual({ x: 8, y: 6 });
    expect(unit(state, 'M').hp, 'the trap still went off').toBe(88);
  });

  it('a DASHING unit stops in the snare too', () => {
    // A charge walks square by square and triggers what it crosses, so it stops
    // on the same square a walk would — mid-charge, with the rest discarded.
    const { owner, mover } = walker();
    const { state } = run(makeState([owner, mover], { traps: [snare(6, 6)] }),
      [{ unitId: 'M', ability: { abilityId: 'charge', target: east } }]);
    expect(unit(state, 'M').pos).toEqual({ x: 6, y: 6 });
  });

  it('an Unstoppable unit walks straight through it', () => {
    // The exception the AC names, and the one this rule needs: Unstoppable
    // already ignores the Slow the same trap applies, so it would be strange for
    // the harder version of the same effect to bite.
    const { owner, mover } = walker({ statuses: [{ kind: 'unstoppable' as const, remaining: 2 }] });
    const { state } = run(makeState([owner, mover], { traps: [snare(6, 6)] }),
      [{ unitId: 'M', movePath: east }]);
    expect(unit(state, 'M').pos, 'the whole path').toEqual({ x: 8, y: 6 });
    expect(unit(state, 'M').hp, 'the damage still lands — it is a halt it ignores').toBe(88);
  });

  it('the halt is a stop, not a shove: the unit keeps the square it stopped on', () => {
    // Stated because "ends its movement" could have been read as a displacement,
    // and displacement carries Move-cancel semantics this must not inherit.
    const { owner, mover } = walker();
    const { state, events } = run(makeState([owner, mover], { traps: [snare(6, 6)] }),
      [{ unitId: 'M', movePath: east }]);
    expect(events.some((e) => e.type === 'displaced'), 'nothing was pushed').toBe(false);
    expect(unit(state, 'M').pos).toEqual({ x: 6, y: 6 });
  });

  it('a trap that kills still stops the walk, as it always did', () => {
    // The channel this shares. A halt must not have replaced the death case.
    const { owner, mover } = walker({ hp: 5 });
    const { state } = run(makeState([owner, mover], { traps: [snare(6, 6)] }),
      [{ unitId: 'M', movePath: east }]);
    expect(unit(state, 'M').alive).toBe(false);
  });
});

describe('TRAP-HALT: Snare Bloom carries it', () => {
  it('the shipped effect has the flag, and its slow beside it', () => {
    const trap = SNARE.effects.find((e) => e.kind === 'trap')!;
    expect(trap.halt).toBe(true);
    expect(SNARE.effects.some((e) => e.kind === 'slow')).toBe(true);
  });

  it('placing it stamps the halt onto the trap on the board', () => {
    const thorn = makeUnit('T', 0, { x: 4, y: 6 }, { characterId: 'thorn' });
    const enemy = makeUnit('E', 1, { x: 11, y: 11 });
    const { state } = resolveTurn(makeState([thorn, enemy]), OPEN(), [
      { team: 0, units: [{ unitId: 'T', ability: { abilityId: 'snare_bloom', target: [{ x: 6, y: 6 }] } }] },
      { team: 1, units: [] },
    ], { thorn: THORN, 'test-char': char });
    expect(state.traps[0]!.halt).toBe(true);
  });
});

describe('TRAP-HALT: validation', () => {
  const base: AbilityDef = {
    id: 'x', name: 'X', phase: 'prep', shape: 'square', range: 4, cooldown: 0, energyGain: 0,
    effects: [{ kind: 'trap', amount: 10, lifetime: 2 }], description: 'test',
  };
  const withTrap = (over: Partial<AbilityEffect>): AbilityDef =>
    ({ ...base, effects: [{ ...base.effects[0]!, ...over }] });

  it('accepts halt on a trap effect', () => {
    expect(validateAbility(withTrap({ halt: true }), 'x')).toEqual([]);
  });

  it('rejects it anywhere else — a field the engine never reads', () => {
    const bad: AbilityDef = { ...base, effects: [{ kind: 'damage', amount: 10, halt: true }] };
    expect(validateAbility(bad, 'x').join(' ')).toMatch(/halt is only meaningful on a "trap" effect/);
  });

  it('rejects `halt: false`, which reads like a decision and is not one', () => {
    expect(validateAbility(withTrap({ halt: false }), 'x').join(' '))
      .toMatch(/halt must be true when present/);
  });
});
