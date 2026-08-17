import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalystPool, type CatalystData } from '../src/catalysts.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders } from '../src/types.js';

/**
 * DASH-OCCUPIED — "you should not be able to dash onto the same square as
 * another character unless there's a knockback associated with the skill."
 *
 * The prohibition holds in three separate places, none of which said so out
 * loud: `teleport`, `walkCharge` resting on the furthest free square, and a
 * Shift catalyst going through the same `teleport`. Three implementations of one
 * rule with no test between them is how a refactor quietly turns a refusal into
 * two units on one square, so this pins all three.
 *
 * **BLINK-ADJ changed what "refused" means for a teleport** (owner, 2026-09-10):
 * the square is still forbidden, but the blink no longer stays home over it — it
 * lands on the nearest legal square instead. The invariant these tests exist for
 * is untouched and is what they now assert: **nobody ends up standing on
 * anybody**. A charge is unaffected; it has a path and still rests short.
 *
 * The exception is new and, for now, unreachable from the roster — every shipped
 * teleport is knockback-free — so it is driven here by a synthetic ability.
 */

const POOL = buildCatalystPool(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/catalysts.json'), 'utf8')) as CatalystData,
);
const OPEN = makeMap(Array.from({ length: 15 }, () => '.'.repeat(15)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'dash', shape: 'square', range: 6, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'teleport' }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'blink' }),
    ability({ id: 'charge', shape: 'path', range: 6, effects: [{ kind: 'damage', amount: 10 }] }),
    // The exception, which no shipped ability exercises: a teleport that shoves
    // whoever is standing where it means to land.
    ability({ id: 'bodycheck', effects: [{ kind: 'teleport' }, { kind: 'knockback', amount: 2 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const at = (id: string, owner: 0 | 1, x: number, y: number) =>
  makeUnit(id, owner, { x, y }, { characterId: 'test-char' });
const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = []) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster, POOL);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

const ROW = 7;
const START = { x: 2, y: ROW };

describe('DASH-OCCUPIED: a dash may not end on a living character', () => {
  it('a TELEPORT aimed at an occupied square lands beside it (BLINK-ADJ)', () => {
    // Flipped by BLINK-ADJ. The square is still refused — what changed is that
    // the blink takes the nearest one instead of nothing at all.
    const s = makeState([at('a', 0, START.x, ROW), at('e', 1, 6, ROW)]);
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'blink', target: [{ x: 6, y: ROW }] } }]);
    expect(unit(state, 'a').pos, 'not on the occupant').not.toEqual({ x: 6, y: ROW });
    expect(unit(state, 'a').pos, 'and not still at home').not.toEqual(START);
    expect(unit(state, 'e').pos, 'the occupant was not disturbed').toEqual({ x: 6, y: ROW });
  });

  it('…and an ALLY is no more standable than an enemy — the rule is "another character"', () => {
    const s = makeState([at('a', 0, START.x, ROW), at('b', 0, 6, ROW), at('e', 1, 12, ROW)]);
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'blink', target: [{ x: 6, y: ROW }] } }]);
    expect(unit(state, 'a').pos).not.toEqual({ x: 6, y: ROW });
    expect(unit(state, 'b').pos, 'the teammate stayed put').toEqual({ x: 6, y: ROW });
  });

  it('a teleport onto a FREE square still works — the guard is not blanket', () => {
    const s = makeState([at('a', 0, START.x, ROW), at('e', 1, 12, ROW)]);
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'blink', target: [{ x: 6, y: ROW }] } }]);
    expect(unit(state, 'a').pos).toEqual({ x: 6, y: ROW });
  });

  it('a CHARGE rests on the furthest free square, short of the occupant', () => {
    // It passes *through* bodies (MV1) but may not stop on one, so it settles on
    // the last free square of its path.
    const s = makeState([at('a', 0, START.x, ROW), at('e', 1, 5, ROW)]);
    const path = [3, 4, 5].map((x) => ({ x, y: ROW }));
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'charge', target: path } }]);
    expect(unit(state, 'a').pos).toEqual({ x: 4, y: ROW });
    expect(unit(state, 'e').pos).toEqual({ x: 5, y: ROW });
  });

  it('a charge whose whole path is occupied holds at its origin', () => {
    const s = makeState([at('a', 0, START.x, ROW), at('e', 1, 3, ROW), at('e2', 1, 4, ROW)]);
    const path = [3, 4].map((x) => ({ x, y: ROW }));
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'charge', target: path } }]);
    expect(unit(state, 'a').pos).toEqual(START);
  });

  it('the SHIFT catalyst obeys the same rule — it is a teleport like any other', () => {
    const s = makeState([at('a', 0, START.x, ROW), at('e', 1, 4, ROW)]);
    const { state } = run(s, [{ unitId: 'a', catalyst: { abilityId: 'shift', target: [{ x: 4, y: ROW }] } }]);
    expect(unit(state, 'a').pos, 'refused the square, landed beside it').not.toEqual({ x: 4, y: ROW });
    // Spent regardless: the catalyst resolved, it just could not put you *there*.
    expect(unit(state, 'a').catalystsUsed).toEqual(['shift']);
  });

  it('a dead unit is not an obstacle — a corpse is off the board', () => {
    const s = makeState([at('a', 0, START.x, ROW), at('e', 1, 6, ROW)]);
    unit(s, 'e').alive = false;
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'blink', target: [{ x: 6, y: ROW }] } }]);
    expect(unit(state, 'a').pos).toEqual({ x: 6, y: ROW });
  });
});

describe('DASH-OCCUPIED: the knockback exception', () => {
  it('a dash with its own knockback shoves the occupant and lands', () => {
    // The order is the whole rule: queued for end-of-Blast the way every other
    // displacement is, the occupant would still be standing when the teleport
    // tried to land and the dash would just fizzle.
    const s = makeState([at('a', 0, START.x, ROW), at('e', 1, 6, ROW)]);
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'bodycheck', target: [{ x: 6, y: ROW }] } }]);
    expect(unit(state, 'a').pos).toEqual({ x: 6, y: ROW }); // landed
    expect(unit(state, 'e').pos).toEqual({ x: 8, y: ROW }); // shoved 2 further along
  });

  it('the shove is pushed along the line the dasher travelled', () => {
    // Away from where the dash came from — the only direction a body arriving at
    // speed could send them.
    const s = makeState([at('a', 0, 6, 2), at('e', 1, 6, 5)]);
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'bodycheck', target: [{ x: 6, y: 5 }] } }]);
    expect(unit(state, 'a').pos).toEqual({ x: 6, y: 5 });
    expect(unit(state, 'e').pos).toEqual({ x: 6, y: 7 });
  });

  it('the occupant is displaced ONCE, not twice', () => {
    // The dash's knockback is also in `a.def.effects`, so the damage pass would
    // happily queue it a second time if the pre-landing shove were not recorded.
    const s = makeState([at('a', 0, START.x, ROW), at('e', 1, 6, ROW)]);
    const { events } = run(s, [{ unitId: 'a', ability: { abilityId: 'bodycheck', target: [{ x: 6, y: ROW }] } }]);
    expect(events.filter((ev) => ev.type === 'displaced' && ev.unitId === 'e')).toHaveLength(1);
  });

  it('a shoved occupant loses its Move, like any displaced unit', () => {
    const s = makeState([at('a', 0, START.x, ROW), at('e', 1, 6, ROW)]);
    const { state } = run(
      s,
      [{ unitId: 'a', ability: { abilityId: 'bodycheck', target: [{ x: 6, y: ROW }] } }],
      [{ unitId: 'e', movePath: [{ x: 6, y: ROW + 1 }, { x: 6, y: ROW + 2 }] }],
    );
    expect(unit(state, 'e').pos).toEqual({ x: 8, y: ROW }); // where the shove left it
  });

  it('an unclearable shove still does not license stacking — it lands beside instead', () => {
    // Backed against the board edge with nowhere to go: the exception is
    // "knockback clears it", not "knockback licenses stacking". Since BLINK-ADJ
    // the dasher takes the nearest square rather than staying home, but the
    // thing being guarded is the same — it does not land *on* the occupant.
    const s = makeState([at('a', 0, 11, ROW), at('e', 1, 14, ROW)]);
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'bodycheck', target: [{ x: 14, y: ROW }] } }]);
    expect(unit(state, 'e').pos).toEqual({ x: 14, y: ROW }); // wall at its back
    expect(unit(state, 'a').pos).not.toEqual({ x: 14, y: ROW });
  });

  it('the knockback still buys the exact square — the control for the case above', () => {
    // With room behind it the occupant is shoved and the dasher lands where it
    // aimed, which is what distinguishes the exception from the nearest-legal
    // fallback every other blocked blink takes.
    const s = makeState([at('a', 0, START.x, ROW), at('e', 1, 6, ROW)]);
    const shoved = run(s, [{ unitId: 'a', ability: { abilityId: 'bodycheck', target: [{ x: 6, y: ROW }] } }]);
    expect(unit(shoved.state, 'a').pos, 'exactly on target').toEqual({ x: 6, y: ROW });

    const plain = run(
      makeState([at('a', 0, START.x, ROW), at('e', 1, 6, ROW)]),
      [{ unitId: 'a', ability: { abilityId: 'blink', target: [{ x: 6, y: ROW }] } }],
    );
    expect(unit(plain.state, 'a').pos, 'the knockback-free one settles for nearby').not.toEqual({ x: 6, y: ROW });
  });

  it('resolves identically twice — the new ordering is deterministic', () => {
    const orders: UnitOrders[] = [{ unitId: 'a', ability: { abilityId: 'bodycheck', target: [{ x: 6, y: ROW }] } }];
    const mk = () => makeState([at('a', 0, START.x, ROW), at('e', 1, 6, ROW)]);
    expect(JSON.stringify(run(mk(), orders).state)).toEqual(JSON.stringify(run(mk(), orders).state));
  });
});
