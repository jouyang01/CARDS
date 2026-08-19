import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MOVE_RANGE, PASSIVE_ENERGY, SPRINT_RANGE } from '../src/constants.js';
import { movementBudget } from '../src/movement.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { validateAbility } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders } from '../src/types.js';

/**
 * FREE1 — a free action does not consume your turn.
 *
 * The rulings this covers all fail **silently** if they are wrong: the turn
 * still resolves, the ability still fires, and the only symptom is that a free
 * action quietly cost you four squares of movement or your Sprint. So the tests
 * below assert the *budget*, not just that the ability happened.
 */

const OPEN = makeMap(Array.from({ length: 21 }, () => '.'.repeat(21)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 8,
  effects: [{ kind: 'damage', amount: 20 }], description: over.id, ...over,
});

/** A kit with one free Prep action, one ordinary Prep action and a normal shot. */
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'trickster', maxHp: 100,
  abilities: [
    ability({ id: 'shot', shape: 'line', range: 8 }),
    ability({
      id: 'trap', phase: 'prep', shape: 'square', range: 4, cooldown: 4, energyGain: 0, free: true,
      effects: [{ kind: 'trap', amount: 20, duration: 3 }],
    }),
    ability({
      id: 'brace', phase: 'prep', shape: 'self', range: 0, cooldown: 2, energyGain: 6,
      effects: [{ kind: 'shield', amount: 20, duration: 1 }],
    }),
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 4, cooldown: 2, energyGain: 4 }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const setup = (): GameState => makeState([
  makeUnit('a', 0, { x: 4, y: 10 }, { characterId: 'test-char' }),
  makeUnit('e', 1, { x: 16, y: 10 }, { characterId: 'test-char' }),
]);

const run = (s: GameState, units: UnitOrders[]) =>
  resolveTurn(s, OPEN, [{ team: 0, units }, { team: 1, units: [] }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
/** A straight walk east of `n` squares from (4,10). */
const walk = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 5 + i, y: 10 }));

describe('FREE1: budget independence — the ruling that fails silently', () => {
  it('a free action does NOT reduce the move budget', () => {
    const { state } = run(setup(), [{
      unitId: 'a',
      freeAbility: { abilityId: 'trap', target: [{ x: 6, y: 10 }] },
      movePath: walk(MOVE_RANGE),
    }]);
    // All four squares walked — a free action costs no movement.
    expect(unit(state, 'a').pos).toEqual({ x: 8, y: 10 });
    expect(state.traps).toHaveLength(1);
  });

  it('a free action does NOT block Sprint — free action + Sprint 8 in one turn', () => {
    const { state } = run(setup(), [{
      unitId: 'a',
      freeAbility: { abilityId: 'trap', target: [{ x: 6, y: 10 }] },
      sprint: true,
      movePath: walk(SPRINT_RANGE),
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 12, y: 10 }); // the full 8
    expect(state.traps).toHaveLength(1);
  });

  it('a NORMAL ability still blocks Sprint — the exclusion is intact', () => {
    // The other half of the same rule. Without it, `sprint` would simply never
    // be cleared and the test above would pass for the wrong reason. An
    // over-budget path is rejected outright rather than clamped, so the unit
    // holds — the same 8-square walk that succeeded with a free action.
    const { state } = run(setup(), [{
      unitId: 'a',
      ability: { abilityId: 'shot', target: [{ x: 16, y: 10 }] },
      sprint: true,
      movePath: walk(SPRINT_RANGE),
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 4, y: 10 });
  });

  it('free action + normal ability + a full move all resolve in the same turn', () => {
    const s = setup();
    unit(s, 'e').pos = { x: 12, y: 10 }; // inside the shot's 8 tiles, off the walk
    const { state, events } = run(s, [{
      unitId: 'a',
      ability: { abilityId: 'shot', target: [{ x: 12, y: 10 }] },
      freeAbility: { abilityId: 'trap', target: [{ x: 6, y: 10 }] },
      movePath: walk(MOVE_RANGE),
    }]);
    const fired = events.filter((e) => e.type === 'abilityFired').map((e) => e.abilityId);
    expect(fired).toContain('trap');
    expect(fired).toContain('shot');
    expect(unit(state, 'a').pos).toEqual({ x: 8, y: 10 });
    expect(unit(state, 'e').hp).toBeLessThan(100);
  });

  it('`movementBudget` reads only the unit and the sprint flag', () => {
    // The structural half: there is no ability argument to get wrong.
    const u = makeUnit('a', 0, { x: 0, y: 0 });
    expect(movementBudget(u, false)).toBe(MOVE_RANGE);
    expect(movementBudget(u, true)).toBe(SPRINT_RANGE);
    expect(movementBudget.length).toBeLessThanOrEqual(2);
  });
});

describe('FREE1: what may be ordered into the free slot', () => {
  it('rejects an ability that is not marked free', () => {
    const { state, events } = run(setup(), [{ unitId: 'a', freeAbility: { abilityId: 'brace', target: [] } }]);
    expect(events.filter((e) => e.type === 'abilityFired')).toHaveLength(0);
    expect(unit(state, 'a').statuses).toHaveLength(0);
  });

  it('rejects a free ability that is on cooldown', () => {
    const s = setup();
    unit(s, 'a').cooldowns['trap'] = 2;
    const { state } = run(s, [{ unitId: 'a', freeAbility: { abilityId: 'trap', target: [{ x: 6, y: 10 }] } }]);
    expect(state.traps).toHaveLength(0);
  });

  it('rejects an ability the unit does not own, and an out-of-range aim', () => {
    expect(run(setup(), [{ unitId: 'a', freeAbility: { abilityId: 'nope', target: [{ x: 6, y: 10 }] } }])
      .state.traps).toHaveLength(0);
    expect(run(setup(), [{ unitId: 'a', freeAbility: { abilityId: 'trap', target: [{ x: 20, y: 10 }] } }])
      .state.traps).toHaveLength(0);
  });

  it('will not fire the same ability twice off one cooldown', () => {
    // Ordering the free ability into BOTH slots is the one way this could be
    // abused: two `abilityFired` events, two traps, one cooldown paid.
    const { state, events } = run(setup(), [{
      unitId: 'a',
      ability: { abilityId: 'trap', target: [{ x: 6, y: 10 }] },
      freeAbility: { abilityId: 'trap', target: [{ x: 7, y: 10 }] },
    }]);
    expect(events.filter((e) => e.type === 'abilityFired')).toHaveLength(1);
    expect(state.traps).toHaveLength(1);
  });

  it('pays its cooldown like any other ability', () => {
    const { state } = run(setup(), [{ unitId: 'a', freeAbility: { abilityId: 'trap', target: [{ x: 6, y: 10 }] } }]);
    // 4 when it fires, ticked once by end of turn — the same accounting every
    // other ability gets. The cooldown IS the price of a free action.
    expect(unit(state, 'a').cooldowns['trap']).toBe(3);
  });

  it('grants no energy — the ult clock does not move for a free action', () => {
    const { state, events } = run(setup(), [{ unitId: 'a', freeAbility: { abilityId: 'trap', target: [{ x: 6, y: 10 }] } }]);
    // The end-of-turn passive is the only thing that lands, and it lands for
    // both units whatever they did — so compare against the enemy, who held.
    expect(unit(state, 'a').energy).toBe(unit(state, 'e').energy);
    expect(unit(state, 'a').energy).toBe(PASSIVE_ENERGY);
    expect(events.filter((e) => e.type === 'energyGained' && e.unitId === 'a' && e.amount !== PASSIVE_ENERGY))
      .toHaveLength(0);
  });

  it('a dead unit fires nothing', () => {
    const s = setup();
    const u = unit(s, 'a');
    u.alive = false;
    expect(run(s, [{ unitId: 'a', freeAbility: { abilityId: 'trap', target: [{ x: 6, y: 10 }] } }])
      .state.traps).toHaveLength(0);
  });
});

describe('FREE1: `free: true` is validated, not special-cased at runtime', () => {
  const base = { ...ability({ id: 'x', phase: 'prep', shape: 'self', range: 0, energyGain: 0 }), free: true };

  it('accepts a prep ability with energyGain 0', () => {
    expect(validateAbility(base, 'x')).toEqual([]);
  });

  it('rejects a free ability outside Prep — no future kit gets a free Blast', () => {
    for (const phase of ['dash', 'blast'] as const) {
      expect(validateAbility({ ...base, phase }, 'x').join(' ')).toMatch(/free abilities must be phase "prep"/);
    }
  });

  it('rejects a free ability that also grants energy', () => {
    expect(validateAbility({ ...base, energyGain: 5 }, 'x').join(' ')).toMatch(/energyGain 0/);
  });

  it('rejects a non-boolean free flag', () => {
    expect(validateAbility({ ...base, free: 'yes' as unknown as boolean }, 'x').join(' '))
      .toMatch(/free must be a boolean/);
  });

  it('says nothing about an ability with no free flag at all', () => {
    const { free, ...plain } = base;
    expect(validateAbility(plain, 'x')).toEqual([]);
  });
});

describe('FREE1: the shipped roster', () => {
  const dir = join(import.meta.dirname, '../../../data/characters');
  const characters = readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as CharacterDef);

  it('marks exactly the four designated kits free, and every one of them validates', () => {
    const free = characters.flatMap((c) => [...c.abilities, c.ultimate].filter((a) => a.free === true));
    // Vex Overwatch Trap, Thorn Snare Bloom, Wisp Veil & Decoy — from the
    // "Prep, no immediate payoff" rule — plus Cinder's Stoke the Flame, the
    // owner-designated exception (Dev Note #13, dev-notes-batch-3 §B): the
    // rule is now "…deferred-or-conditional payoff, OR owner-designated".
    expect(free.map((a) => a.id).sort()).toEqual(['overwatch_trap', 'snare_bloom', 'stoke_the_flame', 'veil_decoy']);
    for (const a of free) expect(validateAbility(a, a.id)).toEqual([]);
  });

  it('every free ability paid its cooldown tax and gave up its energy', () => {
    for (const c of characters) {
      for (const a of [...c.abilities, c.ultimate]) {
        if (a.free !== true) continue;
        expect(a.energyGain, `${c.id}/${a.id}`).toBe(0);
        expect(a.cooldown, `${c.id}/${a.id}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
