import { describe, expect, it } from 'vitest';
import { MOVE_RANGE, SPRINT_RANGE, ULT_COST } from '../src/constants.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, UnitOrders } from '../src/types.js';

/**
 * CHASE-SPRINT — a chase that spends no ability runs at sprint budget.
 *
 * Owner Dev Note: *"Chase should be able to sprint or move depending on how many
 * actions the character has. If I choose chase and haven't used an attack or
 * only a free action, I should get full sprinting chase."*
 *
 * A chase **is** the unit's Move, so it should buy exactly what a Move buys.
 * There was no reason for the same turn to close eight squares as a walk and
 * four as a chase.
 *
 * The budget is *derived* rather than read off `order.sprint`: a client cannot
 * draw a chase's route at plan time — the engine picks it at the end of Move,
 * after everybody else has finished — so there is nothing for a player to opt
 * into, and a client that never set the flag would silently get the short
 * budget. These tests therefore never set it.
 */

const OPEN: MapDef = makeMap(Array.from({ length: 21 }, () => '.'.repeat(21)));

const ability = (over: Partial<AbilityDef>): AbilityDef => ({
  id: 'shot', name: 'Shot', phase: 'blast', shape: 'line', range: 8, cooldown: 0,
  energyGain: 0, effects: [{ kind: 'damage', amount: 5 }], description: 't', ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 200,
  abilities: [
    ability({}),
    // FREE1: a prep-phase free action, the case the owner names explicitly.
    ability({ id: 'trap', phase: 'prep', shape: 'square', range: 4, free: true, effects: [{ kind: 'trap', amount: 5 }] }),
    ability({ id: 'hop', phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

/** Chaser far west, target far east and standing still — a pure footrace. */
const race = (orders: UnitOrders[], energy = 0): GameState => {
  const state = makeState([
    makeUnit('a', 0, { x: 0, y: 10 }, { characterId: 'test-char', maxHp: 200, hp: 200, energy }),
    makeUnit('e', 1, { x: 20, y: 10 }, { characterId: 'test-char', maxHp: 200, hp: 200 }),
  ]);
  // Turn 1 in plain sight so the chase has a target it is allowed to pursue,
  // then the race itself. Vision is six, so seed the memory from close up.
  state.units[0]!.pos = { x: 14, y: 10 };
  const seen = resolveTurn(state, OPEN, [{ team: 0, units: [] }, { team: 1, units: [] }], roster);
  seen.state.units.find((u) => u.unitId === 'a')!.pos = { x: 0, y: 10 };
  return resolveTurn(seen.state, OPEN, [{ team: 0, units: orders }, { team: 1, units: [] }], roster).state;
};
const travelled = (s: GameState): number => s.units.find((u) => u.unitId === 'a')!.pos.x;

describe('CHASE-SPRINT: the budget follows what the turn spent', () => {
  it('a chase with no ability closes at sprint range', () => {
    // The owner's ask, in one number.
    expect(travelled(race([{ unitId: 'a', chase: 'e' }]))).toBe(SPRINT_RANGE);
  });

  it('a chase alongside a normal ability closes at move range', () => {
    // Spending the action still costs the extra squares — sprint has always
    // meant "no ability, more ground", and a chase does not exempt you.
    const s = race([{ unitId: 'a', chase: 'e', ability: { abilityId: 'shot', target: [{ x: 20, y: 10 }] } }]);
    expect(travelled(s)).toBe(MOVE_RANGE);
  });

  it('and the two really are different distances', () => {
    // Guards the test itself: if the constants were equal, every case above
    // would pass for the wrong reason.
    expect(SPRINT_RANGE).toBeGreaterThan(MOVE_RANGE);
  });
});

describe('CHASE-SPRINT: a free action does not block it', () => {
  it('a chase with only a free action still sprints', () => {
    // The half of the note that names the case: "or only a free action". FREE1
    // made a free ability budget-independent for moves; this extends the same
    // answer to chases.
    const s = race([{ unitId: 'a', chase: 'e', freeAbility: { abilityId: 'trap', target: [{ x: 1, y: 10 }] } }]);
    expect(travelled(s)).toBe(SPRINT_RANGE);
  });

  it('a free action *plus* a normal ability is back to move range', () => {
    const s = race([{
      unitId: 'a', chase: 'e',
      ability: { abilityId: 'shot', target: [{ x: 20, y: 10 }] },
      freeAbility: { abilityId: 'trap', target: [{ x: 1, y: 10 }] },
    }]);
    expect(travelled(s)).toBe(MOVE_RANGE);
  });
});

describe('CHASE-SPRINT: what still cancels a chase', () => {
  it('a dash ability drops it entirely — one reposition per turn', () => {
    // CHASE1's rule, unchanged: the dash *is* the movement, so there is no
    // chase left to give a budget to.
    const s = race([{ unitId: 'a', chase: 'e', ability: { abilityId: 'hop', target: [{ x: 3, y: 10 }] } }]);
    expect(travelled(s), 'the hop happened, the chase did not').toBe(3);
  });

  it('a CHARGED ultimate counts as an ability, so it shortens the chase', () => {
    const s = race([{ unitId: 'a', chase: 'e', ability: { abilityId: 'ult', target: [{ x: 0, y: 10 }] } }], ULT_COST);
    expect(travelled(s)).toBe(MOVE_RANGE);
  });

  it('but an ult the unit cannot afford is not an ability at all', () => {
    // `planAbility` drops an unaffordable ult, so nothing was spent and the
    // chase keeps its sprint. Worth pinning: it is the one case where the same
    // order gives two different budgets depending on state elsewhere.
    //
    // Well under the cost, not one short of it: the seeding turn grants
    // PASSIVE_ENERGY, so a unit set to `ULT_COST - 1` is affordable by the turn
    // that matters and the case would silently test the opposite thing.
    const s = race([{ unitId: 'a', chase: 'e', ability: { abilityId: 'ult', target: [{ x: 0, y: 10 }] } }], 0);
    expect(travelled(s)).toBe(SPRINT_RANGE);
  });
});

describe('CHASE-SPRINT: it is the chase that gains, not every move', () => {
  it('a plain walk with no ability is unchanged — it always could sprint', () => {
    // Sanity: the rule adds a budget to chases, it does not quietly re-tune
    // ordinary movement, which has had the sprint option all along.
    const walk = race([{ unitId: 'a', sprint: true, movePath: Array.from({ length: SPRINT_RANGE }, (_, i) => ({ x: i + 1, y: 10 })) }]);
    expect(travelled(walk)).toBe(SPRINT_RANGE);
  });

  it('and a walk that declines the sprint flag still only moves four', () => {
    const walk = race([{ unitId: 'a', movePath: Array.from({ length: MOVE_RANGE }, (_, i) => ({ x: i + 1, y: 10 })) }]);
    expect(travelled(walk)).toBe(MOVE_RANGE);
  });
});
