import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { MIGHT_PCT, WEAKEN_PCT } from '../src/constants.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, TeamId, UnitOrders } from '../src/types.js';

/**
 * PHASE-STATUS-FIRST — statuses land, then damage computes, inside every phase
 * (Dev Note #21).
 *
 * Until now a Blast-applied Weaken was a promise about *next* turn: Dazzling Ray
 * weakened its victim, and the victim's own attack — fired in the same Blast,
 * simultaneously, by the rules of the game — landed at full strength anyway. The
 * owner wants the debuff to blunt the attack it was aimed at blunting.
 *
 * So each of Prep, Dash and Blast now resolves as **two batches**:
 *
 *   1. every status the phase applies, both teams at once;
 *   2. every damage and heal, both teams at once, measured against the state
 *      those statuses left behind.
 *
 * Simultaneity is not softened by this — it is the reason for the shape. Both
 * batches are gathered before either is applied, so nobody is privileged by
 * resolving first, mutual attacks both connect, and mutual kills still land in
 * full. The symmetry test below is the load-bearing one: swap the teams and the
 * numbers must not move.
 *
 * What deliberately does NOT change: Slow is a movement modifier and still has
 * nothing to say about the same phase's damage; a Blast Slow still bites this
 * turn's Move; displacement keeps its end-of-Blast slot; catalysts still resolve
 * at phase start, ahead of both batches.
 */

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'square', range: 8, cooldown: 0, energyGain: 0,
  effects: [], description: over.id, ...over,
});

const char: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    // A shot that weakens what it hits: the two halves of the rule in one ability.
    ability({ id: 'ray', effects: [{ kind: 'damage', amount: 40 }, { kind: 'weaken', duration: 2 }] }),
    ability({ id: 'shot', effects: [{ kind: 'damage', amount: 40 }] }),
    ability({ id: 'blunt', effects: [{ kind: 'weaken', duration: 2 }] }),
    ability({ id: 'chill', effects: [{ kind: 'slow', duration: 2 }] }),
    ability({ id: 'guard', shape: 'circle', radius: 1, effects: [{ kind: 'shield', amount: 30, duration: 2 }] }),
    ability({ id: 'cheer', shape: 'circle', radius: 1, effects: [{ kind: 'might', duration: 2 }] }),
    ability({ id: 'anthem', phase: 'prep', shape: 'circle', radius: 1, effects: [{ kind: 'might', duration: 2 }] }),
    ability({ id: 'mine', phase: 'prep', effects: [{ kind: 'trap', amount: 20, lifetime: 3 }] }),
    ability({ id: 'dive', phase: 'dash', shape: 'square', range: 4, impact: { destination: 2 }, effects: [{ kind: 'damage', amount: 40 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 13 }, () => '.'.repeat(13)));

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[]) =>
  resolveTurn(s, OPEN(), [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

/** `amount` after a Weaken, by the engine's own rounding. */
const weakened = (amount: number): number => Math.floor((amount * (100 - WEAKEN_PCT)) / 100);
const mighty = (amount: number): number => Math.floor((amount * (100 + MIGHT_PCT)) / 100);

describe('PHASE-STATUS-FIRST: a Weaken blunts the attack it was fired at', () => {
  it('two rays cross: both weaken, and BOTH are already weakened when they land', () => {
    // The headline case and the symmetry proof in one. A and B fire the same
    // weakening shot at each other in the same Blast. Each lands 30 rather than
    // 40, because the other's Weaken is on them by the time the number is
    // computed — and neither goes first, so the two results are equal.
    const a = makeUnit('A', 0, { x: 4, y: 6 });
    const b = makeUnit('B', 1, { x: 8, y: 6 });
    const { state } = run(makeState([a, b]),
      [{ unitId: 'A', ability: { abilityId: 'ray', target: [{ x: 8, y: 6 }] } }],
      [{ unitId: 'B', ability: { abilityId: 'ray', target: [{ x: 4, y: 6 }] } }]);
    expect(unit(state, 'A').hp).toBe(100 - weakened(40));
    expect(unit(state, 'B').hp).toBe(100 - weakened(40));
    expect(unit(state, 'A').hp, 'and neither was privileged').toBe(unit(state, 'B').hp);
  });

  it('and swapping which team declares it changes nothing at all', () => {
    // Symmetry stated as an experiment rather than an assertion about one run:
    // the same board mirrored across teams must produce the same two numbers.
    const mirrored = (aTeam: TeamId) => {
      const bTeam: TeamId = aTeam === 0 ? 1 : 0;
      const s = makeState([makeUnit('A', aTeam, { x: 4, y: 6 }), makeUnit('B', bTeam, { x: 8, y: 6 })]);
      const aOrders: UnitOrders[] = [{ unitId: 'A', ability: { abilityId: 'ray', target: [{ x: 8, y: 6 }] } }];
      const bOrders: UnitOrders[] = [{ unitId: 'B', ability: { abilityId: 'ray', target: [{ x: 4, y: 6 }] } }];
      // `run` takes team 0's orders first, so swapping sides genuinely swaps
      // which plan the resolver walks first.
      const { state } = aTeam === 0 ? run(s, aOrders, bOrders) : run(s, bOrders, aOrders);
      return [unit(state, 'A').hp, unit(state, 'B').hp];
    };
    expect(mirrored(0)).toEqual(mirrored(1));
  });

  it('a pure debuff blunts an enemy shot fired in the same Blast', () => {
    // The support case: no damage of your own, you simply take the edge off the
    // blow coming at your teammate. Before the fix this did nothing until the
    // following turn — which is to say, nothing at all for the ally being shot.
    const support = makeUnit('S', 0, { x: 3, y: 6 });
    const ally = makeUnit('A', 0, { x: 4, y: 6 });
    const enemy = makeUnit('E', 1, { x: 8, y: 6 });
    const { state } = run(makeState([support, ally, enemy]),
      [{ unitId: 'S', ability: { abilityId: 'blunt', target: [{ x: 8, y: 6 }] } }],
      [{ unitId: 'E', ability: { abilityId: 'shot', target: [{ x: 4, y: 6 }] } }]);
    expect(unit(state, 'A').hp).toBe(100 - weakened(40));
  });

  it('a Might raises the attack it was cast to raise', () => {
    // The same rule with the sign flipped, so the ordering cannot be a special
    // case for debuffs.
    const support = makeUnit('S', 0, { x: 3, y: 6 });
    const shooter = makeUnit('A', 0, { x: 4, y: 6 });
    const enemy = makeUnit('E', 1, { x: 8, y: 6 });
    const { state } = run(makeState([support, shooter, enemy]),
      [
        { unitId: 'S', ability: { abilityId: 'cheer', target: [{ x: 4, y: 6 }] } },
        { unitId: 'A', ability: { abilityId: 'shot', target: [{ x: 8, y: 6 }] } },
      ], []);
    expect(unit(state, 'E').hp).toBe(100 - mighty(40));
  });

  it('a shield thrown in the same Blast absorbs that Blast', () => {
    // A shield is a status, so it lands in batch one — which is the difference
    // between a bodyguard ability and a decoration. Note this holds whichever
    // plan the ordering reaches first; the batch is what removes the race.
    const guard = makeUnit('G', 0, { x: 3, y: 6 });
    const ally = makeUnit('A', 0, { x: 4, y: 6 });
    const enemy = makeUnit('E', 1, { x: 8, y: 6 });
    const { state } = run(makeState([guard, ally, enemy]),
      [{ unitId: 'G', ability: { abilityId: 'guard', target: [{ x: 4, y: 6 }] } }],
      [{ unitId: 'E', ability: { abilityId: 'shot', target: [{ x: 4, y: 6 }] } }]);
    const hurt = unit(state, 'A');
    expect(hurt.hp, 'the 30-point shield ate 30 of the 40').toBe(90);
    expect(hurt.statuses.find((s) => s.kind === 'shield'), 'and is spent').toBeUndefined();
  });
});

describe('PHASE-STATUS-FIRST: simultaneity survives the restructure', () => {
  it('mutual kills still land in full — both die, both score', () => {
    // The regression the AC names. Batching must not let the first blow applied
    // cancel the second: each side is alive when the hits are gathered, and a
    // unit that dies still dealt its damage.
    const a = makeUnit('A', 0, { x: 4, y: 6 }, { hp: 20 });
    const b = makeUnit('B', 1, { x: 8, y: 6 }, { hp: 20 });
    const { state } = run(makeState([a, b]),
      [{ unitId: 'A', ability: { abilityId: 'shot', target: [{ x: 8, y: 6 }] } }],
      [{ unitId: 'B', ability: { abilityId: 'shot', target: [{ x: 4, y: 6 }] } }]);
    expect(unit(state, 'A').alive).toBe(false);
    expect(unit(state, 'B').alive).toBe(false);
    expect(state.kills).toEqual([1, 1]);
  });

  it('mutual kills in the DASH phase too, now that its damage is a batch as well', () => {
    // Dash used to apply each dive's damage the moment that plan resolved. So
    // the first diver to land killed its target outright, and the target's own
    // dive — declared simultaneously, in the same phase — was skipped at the top
    // of the loop for the crime of being dead. Two divers who blink onto each
    // other now both connect and both fall.
    const a = makeUnit('A', 0, { x: 4, y: 6 }, { hp: 20 });
    const b = makeUnit('B', 1, { x: 8, y: 6 }, { hp: 20 });
    const { state } = run(makeState([a, b]),
      [{ unitId: 'A', ability: { abilityId: 'dive', target: [{ x: 6, y: 6 }] } }],
      [{ unitId: 'B', ability: { abilityId: 'dive', target: [{ x: 7, y: 6 }] } }]);
    expect(unit(state, 'A').alive).toBe(false);
    expect(unit(state, 'B').alive).toBe(false);
    expect(state.kills).toEqual([1, 1]);
  });

  it('a Weaken from a unit that dies this Blast still counted against its killer', () => {
    // Batch one runs before anybody has died, so a debuff you applied with your
    // last action is not undone by the blow that ended you.
    const a = makeUnit('A', 0, { x: 4, y: 6 }, { hp: 10 });
    const b = makeUnit('B', 1, { x: 8, y: 6 });
    const c = makeUnit('C', 0, { x: 4, y: 7 });
    const { state } = run(makeState([a, b, c]),
      [{ unitId: 'A', ability: { abilityId: 'blunt', target: [{ x: 8, y: 6 }] } }],
      [{ unitId: 'B', ability: { abilityId: 'shot', target: [{ x: 4, y: 7 }] } }]);
    expect(unit(state, 'A').alive, 'A is not even alive to see it').toBe(true);
    expect(unit(state, 'C').hp, 'but the Weaken landed before the shot did').toBe(100 - weakened(40));
  });
});

describe('PHASE-STATUS-FIRST: what deliberately did not move', () => {
  it('a Slow does not touch the same phase\'s damage', () => {
    // Slow is a movement modifier. Batch one applies it before the damage batch,
    // and the damage is exactly what it would have been — the ordering changed,
    // the meaning of the status did not.
    const support = makeUnit('S', 0, { x: 3, y: 6 });
    const ally = makeUnit('A', 0, { x: 4, y: 6 });
    const enemy = makeUnit('E', 1, { x: 8, y: 6 });
    const { state } = run(makeState([support, ally, enemy]),
      [{ unitId: 'S', ability: { abilityId: 'chill', target: [{ x: 8, y: 6 }] } }],
      [{ unitId: 'E', ability: { abilityId: 'shot', target: [{ x: 4, y: 6 }] } }]);
    expect(unit(state, 'A').hp).toBe(60);
  });

  it('but a Blast Slow still bites this turn\'s Move', () => {
    // The cross-phase behaviour the AC protects: Blast resolves before Move, and
    // a unit slowed in Blast walks a shorter path in the Move that follows.
    const shooter = makeUnit('S', 0, { x: 3, y: 6 });
    const runner = makeUnit('E', 1, { x: 8, y: 6 });
    const path = [{ x: 9, y: 6 }, { x: 10, y: 6 }, { x: 11, y: 6 }, { x: 12, y: 6 }];
    const { state } = run(makeState([shooter, runner]),
      [{ unitId: 'S', ability: { abilityId: 'chill', target: [{ x: 8, y: 6 }] } }],
      [{ unitId: 'E', movePath: path }]);
    expect(unit(state, 'E').pos.x, 'four steps of budget, halved').toBe(10);
  });

  it('a heal still arrives after the damage, so it cannot undo a killing blow', () => {
    // Heals sit in batch two beside the damage rather than in batch one with the
    // statuses. A support who heals the turn their ally is executed is late, as
    // they always were.
    const medic = makeUnit('M', 0, { x: 3, y: 6 });
    const ally = makeUnit('A', 0, { x: 4, y: 6 }, { hp: 10 });
    const enemy = makeUnit('E', 1, { x: 8, y: 6 });
    const heals: Roster = { 'test-char': {
      ...char,
      abilities: [...char.abilities, ability({ id: 'mend', shape: 'circle', radius: 1, effects: [{ kind: 'heal', amount: 50 }] })],
    } };
    const { state } = resolveTurn(makeState([medic, ally, enemy]), OPEN(), [
      { team: 0, units: [{ unitId: 'M', ability: { abilityId: 'mend', target: [{ x: 4, y: 6 }] } }] },
      { team: 1, units: [{ unitId: 'E', ability: { abilityId: 'shot', target: [{ x: 4, y: 6 }] } }] },
    ], heals);
    expect(unit(state, 'A').alive).toBe(false);
  });
});

describe('PHASE-STATUS-FIRST: Prep arms its traps after the phase\'s statuses', () => {
  it('a Might landing in Prep is stamped into the mine buried in the same Prep', () => {
    // Prep lands no damage of its own; arming a trap is the closest thing it
    // has, and the trap's number is taken from the owner as it goes in. So the
    // arming waits for the phase's statuses, and an ally's Might is in the
    // charge — the AC's own example of the rule.
    const support = makeUnit('S', 0, { x: 3, y: 6 });
    const trapper = makeUnit('T', 0, { x: 4, y: 6 });
    const victim = makeUnit('E', 1, { x: 7, y: 6 });
    const { state } = run(makeState([support, trapper, victim]), [
      { unitId: 'S', ability: { abilityId: 'anthem', target: [{ x: 4, y: 6 }] } },
      { unitId: 'T', ability: { abilityId: 'mine', target: [{ x: 6, y: 6 }] } },
    ], []);
    expect(state.traps).toHaveLength(1);
    expect(state.traps[0]!.damage, '20 raised by Might').toBe(mighty(20));
  });

  it('the charge is set when it is buried, not re-measured when it goes off', () => {
    // The other half of "stamped": a trap that detonates two turns later carries
    // the number it was armed with, whatever its owner is feeling by then.
    const trapper = makeUnit('T', 0, { x: 4, y: 6 });
    const victim = makeUnit('E', 1, { x: 7, y: 6 });
    const armed = run(makeState([trapper, victim]),
      [{ unitId: 'T', ability: { abilityId: 'mine', target: [{ x: 6, y: 6 }] } }], []).state;
    expect(armed.traps[0]!.damage).toBe(20);

    // Now hand the owner a Might and walk the victim onto the mine.
    unit(armed, 'T').statuses.push({ kind: 'might', remaining: 2 });
    const sprung = run(armed, [], [{ unitId: 'E', movePath: [{ x: 6, y: 6 }] }]).state;
    expect(unit(sprung, 'E').hp, 'still the 20 it was armed with').toBe(80);
  });

  it('an unbuffed trapper arms exactly the authored number', () => {
    // The control: scaling by a modifier nobody has must be the identity, or
    // every trap in the game just changed.
    const trapper = makeUnit('T', 0, { x: 4, y: 6 });
    const { state } = run(makeState([trapper, makeUnit('E', 1, { x: 7, y: 6 })]),
      [{ unitId: 'T', ability: { abilityId: 'mine', target: [{ x: 6, y: 6 }] } }], []);
    expect(state.traps[0]!.damage).toBe(20);
  });
});
