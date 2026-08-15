import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRAP_MAX_LIFETIME } from '../src/constants.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { validateAbility } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders } from '../src/types.js';

/**
 * TRAP-LIFETIME — "Overwatch Traps should only last for 2 turns total. Traps in
 * general should only last for up to 3 turns max."
 *
 * A placed trap never expired: it sat until somebody stepped on it, so a Vex
 * could lay one every turn and accrete a minefield the enemy has to solve rather
 * than a threat they have to time. Expiry is measured exactly like a status
 * `duration` — `lifetime: 2` covers the turn it was placed and the next — so
 * there is one arithmetic in the engine for "how long does this last", not two.
 */

const OPEN = makeMap(Array.from({ length: 11 }, () => '.'.repeat(11)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'prep', shape: 'square', range: 4, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'trap', amount: 20 }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'short', effects: [{ kind: 'trap', amount: 20, lifetime: 2 }] }),
    ability({ id: 'long', effects: [{ kind: 'trap', amount: 20, lifetime: 3 }] }),
    // No `lifetime` at all — it must land on the cap, not live forever.
    ability({ id: 'unspecified', effects: [{ kind: 'trap', amount: 20 }] }),
    ability({ id: 'wait', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = []) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const board = (): GameState => makeState([
  makeUnit('a', 0, { x: 2, y: 5 }, { characterId: 'test-char' }),
  makeUnit('e', 1, { x: 9, y: 5 }, { characterId: 'test-char' }),
]);
const place = (abilityId: string) => [{ unitId: 'a', ability: { abilityId, target: [{ x: 4, y: 5 }] } }];
const idle: UnitOrders[] = [];

describe('TRAP-LIFETIME: a trap nobody steps on runs out', () => {
  it('an Overwatch-shaped trap (lifetime 2) covers the turn placed and the next', () => {
    // Placed in Prep of turn 1, so it is live for the rest of turn 1 and for all
    // of turn 2 — including turn 2's Move, which is when somebody would step on
    // it — and is swept at the end of turn 2.
    let s = board();
    const placedOn = s.turn;
    ({ state: s } = run(s, place('short')));
    expect(s.traps, 'live for the rest of the turn it was placed').toHaveLength(1);
    expect(s.traps[0]!.expiresOnTurn).toBe(placedOn + 1);

    ({ state: s } = run(s, idle));
    expect(s.traps, 'swept at the end of the following turn').toHaveLength(0);
  });

  it('a lifetime-3 trap lasts exactly one turn longer', () => {
    let s = board();
    ({ state: s } = run(s, place('long')));
    ({ state: s } = run(s, idle));
    expect(s.traps, 'where the lifetime-2 trap had already gone').toHaveLength(1);
    ({ state: s } = run(s, idle));
    expect(s.traps).toHaveLength(0);
  });

  it('a trap with no authored lifetime lands on the cap, not on forever', () => {
    // The failure this prevents is silent: an under-specified trap that never
    // expires is exactly the bug the ruling is closing.
    let s = board();
    const placedOn = s.turn;
    ({ state: s } = run(s, place('unspecified')));
    expect(s.traps[0]!.expiresOnTurn).toBe(placedOn + TRAP_MAX_LIFETIME - 1);
    for (let i = 0; i < TRAP_MAX_LIFETIME; i++) ({ state: s } = run(s, idle));
    expect(s.traps).toHaveLength(0);
  });

  it('expiry is announced, so a client folding the log can clear the marker', () => {
    // Distinct from `trapTriggered`, which means somebody stepped on it. A
    // marker left over a square that is no longer dangerous is worse than none.
    let s = board();
    const placed = run(s, place('short'));
    s = placed.state;
    const id = s.traps[0]!.id;
    expect(placed.events.some((e) => e.type === 'trapExpired'), 'not on the turn it was laid').toBe(false);

    const next = run(s, idle);
    expect(next.events).toContainEqual({ type: 'trapExpired', trapId: id, pos: { x: 4, y: 5 }, owner: 0 });
  });

  it('a trap still triggers normally inside its life', () => {
    // Live through the *whole* of its last turn, Move included — expiry is a
    // sweep at end of turn, not a mid-turn disarm.
    let s = board();
    ({ state: s } = run(s, place('short')));
    s.units.find((u) => u.unitId === 'e')!.pos = { x: 5, y: 5 }; // adjacent, ready to step on
    const stepped = run(s, idle, [{ unitId: 'e', movePath: [{ x: 4, y: 5 }] }]);
    expect(stepped.events.some((e) => e.type === 'trapTriggered')).toBe(true);
    expect(stepped.state.units.find((u) => u.unitId === 'e')!.hp).toBeLessThan(100);
  });

  it('a triggered trap is consumed, and does not also report expiring', () => {
    // Two removal paths for one trap; emitting both would tell a client the
    // square was cleared twice, and the second would arrive after the marker had
    // already gone.
    let s = board();
    ({ state: s } = run(s, place('short')));
    s.units.find((u) => u.unitId === 'e')!.pos = { x: 5, y: 5 };
    const stepped = run(s, idle, [{ unitId: 'e', movePath: [{ x: 4, y: 5 }] }]);
    expect(stepped.state.traps).toHaveLength(0);
    expect(stepped.events.filter((e) => e.type === 'trapExpired')).toHaveLength(0);
  });

  it('several traps expire independently, in list order', () => {
    // N-trap-safe: the sweep is a filter over the list, not a single-trap check.
    let s = board();
    ({ state: s } = run(s, place('long')));   // turn 1 → expires end of turn 3
    ({ state: s } = run(s, [{ unitId: 'a', ability: { abilityId: 'short', target: [{ x: 3, y: 5 }] } }])); // turn 2 → end of turn 3
    expect(s.traps).toHaveLength(2);
    ({ state: s } = run(s, idle));            // turn 3 sweeps both
    expect(s.traps).toEqual([]);
  });

  it('resolves identically twice — expiry is integer turn arithmetic', () => {
    const once = run(run(board(), place('short')).state, idle);
    const twice = run(run(board(), place('short')).state, idle);
    expect(JSON.stringify(once.state)).toEqual(JSON.stringify(twice.state));
    expect(JSON.stringify(once.events)).toEqual(JSON.stringify(twice.events));
  });
});

describe('TRAP-LIFETIME: validation enforces the cap', () => {
  const check = (effects: AbilityDef['effects']): string =>
    validateAbility({ ...ability({ id: 'x' }), effects }, 'x').join(' ');

  it('accepts 1, 2 and 3', () => {
    for (const lifetime of [1, 2, 3]) {
      expect(check([{ kind: 'trap', amount: 10, lifetime }]), String(lifetime)).toBe('');
    }
  });

  it('rejects 4 — the owner\'s general cap', () => {
    expect(check([{ kind: 'trap', amount: 10, lifetime: 4 }])).toMatch(/lifetime must be an integer 1\.\.3/);
  });

  it('rejects 0, a negative and a fraction', () => {
    for (const lifetime of [0, -1, 2.5]) {
      expect(check([{ kind: 'trap', amount: 10, lifetime }]), String(lifetime)).toMatch(/lifetime/);
    }
  });

  it('rejects a lifetime on a non-trap effect', () => {
    // Nothing reads it there, and a field that silently does nothing is exactly
    // what VALIDATE-KEYS exists to catch.
    expect(check([{ kind: 'damage', amount: 10, lifetime: 2 }]))
      .toMatch(/only meaningful on a "trap" effect/);
  });

  it('still accepts a trap with no lifetime — the default covers it', () => {
    expect(check([{ kind: 'trap', amount: 10 }])).toBe('');
  });
});

describe('TRAP-LIFETIME: the shipped roster obeys it', () => {
  const load = (n: string): CharacterDef =>
    JSON.parse(readFileSync(join(import.meta.dirname, `../../../data/characters/${n}.json`), 'utf8')) as CharacterDef;

  it("Vex's Overwatch Trap is the owner's 2", () => {
    const trap = load('vex').abilities.find((a) => a.id === 'overwatch_trap')!;
    expect(trap.effects.find((e) => e.kind === 'trap')!.lifetime).toBe(2);
  });

  it('no shipped trap ability exceeds the cap', () => {
    for (const name of ['vex', 'thorn']) {
      for (const a of load(name).abilities) {
        const t = a.effects.find((e) => e.kind === 'trap');
        if (t === undefined) continue;
        expect(t.lifetime ?? TRAP_MAX_LIFETIME, `${name}/${a.id}`).toBeLessThanOrEqual(TRAP_MAX_LIFETIME);
      }
    }
  });
});
