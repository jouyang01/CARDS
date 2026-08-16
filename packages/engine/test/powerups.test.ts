import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POWERUP_EFFECTS } from '../src/powerups.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { getStatus } from '../src/status.js';
import { validateMap } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, UnitOrders } from '../src/types.js';

/**
 * PADS1 — power-up pads (ar-parity §7.3).
 *
 * A pad is a *trigger*, not a mechanic: it hands the first unit standing on it a
 * bundle of effects the engine already knows how to apply, at one fixed point at
 * the end of Move. That is the whole design, and these tests pin the three parts
 * that could plausibly drift — **when** it resolves, **who** gets it, and **when
 * it comes back**.
 */

const PADS: MapDef['powerups'] = [
  { x: 5, y: 5, type: 'health', firstTurn: 1, everyTurns: 3 },
  { x: 8, y: 5, type: 'might', firstTurn: 1, everyTurns: 2 },
  { x: 2, y: 8, type: 'energy', firstTurn: 4, everyTurns: 2 },
];
const OPEN = makeMap(Array.from({ length: 11 }, () => '.'.repeat(11)), { powerups: PADS });

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shove', effects: [{ kind: 'knockback', amount: 2 }] }),
    ability({ id: 'shot', effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'hop', phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] }),
    ability({ id: 'wait', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = [], map: MapDef = OPEN) =>
  resolveTurn(s, map, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const idle: UnitOrders[] = [];

/** `a` one step west of the health pad, `e` parked well out of the way. */
const board = (over: Partial<GameState> = {}): GameState => makeState([
  makeUnit('a', 0, { x: 4, y: 5 }, { characterId: 'test-char' }),
  makeUnit('e', 1, { x: 10, y: 10 }, { characterId: 'test-char' }),
], over);
const stepOntoHealth = [{ unitId: 'a', movePath: [{ x: 5, y: 5 }] }];

describe('PADS1: a pad grants its effects to whoever ends Move on it', () => {
  it('a unit that walks onto the Health pad is healed and left burning green', () => {
    const s = board();
    unit(s, 'a').hp = 50;
    const { state, events } = run(s, stepOntoHealth);
    // heal 10 now, healOverTime 10×2 — the first of which ticks this same turn's
    // end-of-turn, so 50 + 10 + 10.
    expect(unit(state, 'a').hp).toBe(70);
    expect(getStatus(unit(state, 'a'), 'healOverTime')).toBeDefined();
    expect(events).toContainEqual({ type: 'powerupTaken', unitId: 'a', pos: { x: 5, y: 5 }, powerup: 'health' });
  });

  it('the Might pad grants Might, the Energy pad grants Energized', () => {
    const might = run(board(), [{ unitId: 'a', movePath: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }] }]);
    expect(getStatus(unit(might.state, 'a'), 'might')).toBeDefined();

    // The Energy pad's `firstTurn` is 4, so stand on it from turn 4.
    const s = board({ turn: 4 });
    unit(s, 'a').pos = { x: 2, y: 8 };
    const energy = run(s, idle);
    expect(getStatus(unit(energy.state, 'a'), 'energized')).toBeDefined();
  });

  it('an enemy can take it just as well — a pad is neutral ground', () => {
    const s = board();
    unit(s, 'e').pos = { x: 6, y: 5 };
    const { state } = run(s, idle, [{ unitId: 'e', movePath: [{ x: 5, y: 5 }] }]);
    expect(getStatus(unit(state, 'e'), 'healOverTime')).toBeDefined();
  });

  it('nobody on it, nobody takes it — and it is still there next turn', () => {
    const { state, events } = run(board(), idle);
    expect(events.some((e) => e.type === 'powerupTaken')).toBe(false);
    expect(state.powerups, 'an untouched pad leaves no trace in state').toEqual([]);
  });

  it('a unit standing on a pad it did not walk to still takes it', () => {
    // The reason pad resolution is not inside the "did anyone move?" branch: a
    // unit knocked onto a pad, or sitting on one the turn it comes back, has as
    // much claim to it as one that walked. Resolution is about occupancy.
    const s = board();
    unit(s, 'a').pos = { x: 5, y: 5 };
    const { events } = run(s, idle);
    expect(events.some((e) => e.type === 'powerupTaken' && e.powerup === 'health')).toBe(true);
  });

  it('a knockback that lands a unit on a pad hands it over', () => {
    // Displacements resolve before Move, so the victim is standing on the pad by
    // the time pads settle — and the pad does not care how they got there.
    const s = board();
    unit(s, 'a').pos = { x: 5, y: 2 };            // shooter, aiming down the column
    unit(s, 'e').pos = { x: 5, y: 3 };            // victim, two squares north of the pad
    const { events } = run(s, [{ unitId: 'a', ability: { abilityId: 'shove', target: [{ x: 5, y: 10 }] } }]);
    expect(events.some((e) => e.type === 'powerupTaken' && e.unitId === 'e')).toBe(true);
  });

  it('a dead unit lying on a pad does not take it', () => {
    const s = board();
    unit(s, 'a').pos = { x: 5, y: 5 };
    unit(s, 'a').alive = false;
    const { events } = run(s, idle);
    expect(events.some((e) => e.type === 'powerupTaken')).toBe(false);
  });
});

describe('PADS1: respawn timing is exact', () => {
  it('a taken pad is dark for `everyTurns`, then live again', () => {
    // Might pad: everyTurns 2. Taken on turn 1 → available again on turn 3.
    let s = board();
    unit(s, 'a').pos = { x: 8, y: 5 };
    ({ state: s } = run(s, idle));
    expect(s.powerups).toEqual([{ pos: { x: 8, y: 5 }, availableOnTurn: 3 }]);

    const turn2 = run(s, idle);
    expect(turn2.events.some((e) => e.type === 'powerupTaken'), 'turn 2: still dark').toBe(false);

    const turn3 = run(turn2.state, idle);
    expect(turn3.events.some((e) => e.type === 'powerupTaken'), 'turn 3: back').toBe(true);
    expect(turn3.state.powerups).toEqual([{ pos: { x: 8, y: 5 }, availableOnTurn: 5 }]);
  });

  it('a pad is dormant until its `firstTurn`', () => {
    // The Energy pad opens on turn 4; camping it from turn 3 earns nothing.
    const s = board({ turn: 3 });
    unit(s, 'a').pos = { x: 2, y: 8 };
    expect(run(s, idle).events.some((e) => e.type === 'powerupTaken')).toBe(false);
    expect(run(board({ turn: 4 }), [{ unitId: 'a', movePath: [] }]).events.some((e) => e.type === 'powerupTaken')).toBe(false);
  });

  it('pads respawn independently of one another', () => {
    const s = board();
    unit(s, 'a').pos = { x: 5, y: 5 }; // health, everyTurns 3
    unit(s, 'e').pos = { x: 8, y: 5 }; // might,  everyTurns 2
    const { state } = run(s, idle);
    expect(state.powerups).toEqual([
      { pos: { x: 5, y: 5 }, availableOnTurn: 4 },
      { pos: { x: 8, y: 5 }, availableOnTurn: 3 },
    ]);
  });

  it('a same-step contest for the pad leaves it standing — nobody entered', () => {
    // "Contested is impossible" falls straight out of Collisions: two units
    // stepping onto one square on the same step means *neither* enters, so there
    // is no tie for the pad to break. Nothing here decides a winner.
    const s = board();
    unit(s, 'a').pos = { x: 4, y: 5 };
    unit(s, 'e').pos = { x: 6, y: 5 };
    const { state, events } = run(
      s,
      [{ unitId: 'a', movePath: [{ x: 5, y: 5 }] }],
      [{ unitId: 'e', movePath: [{ x: 5, y: 5 }] }],
    );
    expect(events.some((e) => e.type === 'powerupTaken')).toBe(false);
    expect(state.powerups, 'and it is still live next turn').toEqual([]);
  });

  it('the unit that gets there a step earlier takes it, and blocks the other', () => {
    const s = board();
    unit(s, 'a').pos = { x: 4, y: 5 };                       // one step away
    unit(s, 'e').pos = { x: 7, y: 5 };                       // two steps away
    const { state, events } = run(
      s,
      [{ unitId: 'a', movePath: [{ x: 5, y: 5 }] }],
      [{ unitId: 'e', movePath: [{ x: 6, y: 5 }, { x: 5, y: 5 }] }],
    );
    const taken = events.filter((e) => e.type === 'powerupTaken');
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ unitId: 'a' });
    expect(state.powerups).toHaveLength(1);
  });
});

describe('PADS1: determinism and the map schema', () => {
  it('resolves identically twice', () => {
    const go = () => {
      const s = board();
      unit(s, 'e').pos = { x: 6, y: 5 };
      return run(s, stepOntoHealth, [{ unitId: 'e', movePath: [{ x: 7, y: 5 }, { x: 8, y: 5 }] }]);
    };
    const once = go();
    const twice = go();
    expect(JSON.stringify(once.state)).toEqual(JSON.stringify(twice.state));
    expect(JSON.stringify(once.events)).toEqual(JSON.stringify(twice.events));
  });

  it('every pad effect is an integer — no per-turn division creeps in', () => {
    for (const effects of Object.values(POWERUP_EFFECTS)) {
      for (const e of effects) {
        if (e.amount !== undefined) expect(Number.isInteger(e.amount)).toBe(true);
        if (e.duration !== undefined) expect(Number.isInteger(e.duration)).toBe(true);
      }
    }
  });

  it('a map with no `powerups` at all is still a legal map', () => {
    const bare = makeMap(['..........', '..........', '..........', '..........',
      '..........', '..........', '..........', '..........', '..........', '..........']);
    expect(validateMap(bare)).toEqual([]);
    expect(run(board(), stepOntoHealth, [], bare).events.some((e) => e.type === 'powerupTaken')).toBe(false);
  });

  describe('validation rejects a broken pad', () => {
    const check = (powerups: MapDef['powerups']): string =>
      validateMap(makeMap(Array.from({ length: 10 }, () => '.'.repeat(10)), { powerups })).join(' ');
    const ok = { x: 3, y: 3, type: 'health', firstTurn: 1, everyTurns: 2 } as const;

    it('accepts a well-formed one', () => {
      expect(check([ok])).toBe('');
    });

    it('rejects an out-of-bounds square', () => {
      expect(check([{ ...ok, x: 99 }])).toMatch(/out of bounds/);
    });

    it('rejects a pad on a wall — nobody could ever take it', () => {
      const walled = makeMap(['##########', ...Array.from({ length: 9 }, () => '.'.repeat(10))], {
        powerups: [{ ...ok, x: 3, y: 0 }],
      });
      expect(validateMap(walled).join(' ')).toMatch(/on a solid square/);
    });

    it('rejects two pads on one square', () => {
      expect(check([ok, { ...ok, type: 'might' }])).toMatch(/a second pad on \(3,3\)/);
    });

    it('rejects two pads that touch, orthogonally or diagonally (PADS-SPREAD)', () => {
      // A pair of pads is not two pick-ups; it is one prize worth double, and
      // since PADS-PASS it is collected by walking past rather than stopping.
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        const neighbour = { ...ok, x: ok.x + dx!, y: ok.y + dy!, type: 'might' as const };
        expect(check([ok, neighbour]), `offset ${dx},${dy}`).toMatch(/may not be adjacent/);
      }
    });

    it('accepts pads one square further apart', () => {
      expect(check([ok, { ...ok, x: 5, type: 'might' }])).toBe('');
      expect(check([ok, { ...ok, x: 5, y: 5, type: 'might' }])).toBe('');
    });

    it('reports a touching pair once, not twice', () => {
      // Three in a row is three facts, not six restatements of them.
      const errs = check([ok, { ...ok, x: 4 }, { ...ok, x: 5 }]).match(/may not be adjacent/g) ?? [];
      expect(errs).toHaveLength(2);
    });

    it('a duplicate square is reported as a duplicate, not as adjacency', () => {
      const errs = check([ok, { ...ok, type: 'might' }]);
      expect(errs).toMatch(/a second pad on \(3,3\)/);
      expect(errs).not.toMatch(/may not be adjacent/);
    });

    it('rejects an unknown type and an unknown key', () => {
      expect(check([{ ...ok, type: 'ammo' as never }])).toMatch(/unknown powerup type "ammo"/);
      expect(check([{ ...ok, colour: 'red' } as never])).toMatch(/unknown key "colour"/);
    });

    it('rejects non-positive or fractional timings', () => {
      for (const firstTurn of [0, -1, 1.5]) {
        expect(check([{ ...ok, firstTurn }]), String(firstTurn)).toMatch(/firstTurn must be an integer >= 1/);
      }
      expect(check([{ ...ok, everyTurns: 0 }])).toMatch(/everyTurns must be an integer >= 1/);
    });
  });

  describe('the shipped maps', () => {
    const load = (n: string): MapDef =>
      JSON.parse(readFileSync(join(import.meta.dirname, `../../../data/maps/${n}.json`), 'utf8')) as MapDef;

    it('both ship pads, and every one of them validates', () => {
      for (const name of ['duel-arena', 'iron-basin']) {
        const m = load(name);
        expect(m.powerups?.length, `${name} should ship pads`).toBeGreaterThan(0);
        expect(validateMap(m), name).toEqual([]);
      }
    });
  });
});
