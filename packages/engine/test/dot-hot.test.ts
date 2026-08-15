import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { getStatus } from '../src/status.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders } from '../src/types.js';

/**
 * DOT-HOT — `damageOverTime` and `healOverTime` (ar-parity §7.1).
 *
 * They ride the status machinery rather than getting a parallel one: refresh-not-
 * stack, an end-of-turn tick and an expiry already exist, and a second copy of
 * "something that lasts N turns" is how two answers to the same question start
 * disagreeing.
 *
 * The load-bearing detail is **order**: the tick runs before durations decrement,
 * so a `duration: 2` effect ticks the turn it lands and the turn after. Ticking
 * after would quietly cost every over-time effect its first turn — an off-by-one
 * nobody notices until a burn reads a tick short.
 */

const OPEN = makeMap(Array.from({ length: 13 }, () => '.'.repeat(13)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'burn', effects: [{ kind: 'damageOverTime', amount: 10, duration: 2 }] }),
    ability({ id: 'scorch', effects: [{ kind: 'damageOverTime', amount: 40, duration: 3 }] }),
    ability({ id: 'mend', phase: 'prep', shape: 'circle', range: 5, radius: 1, effects: [{ kind: 'healOverTime', amount: 10, duration: 2 }] }),
    ability({ id: 'shot', effects: [{ kind: 'damage', amount: 20 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = []) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const board = (): GameState => makeState([
  makeUnit('a', 0, { x: 2, y: 6 }, { characterId: 'test-char' }),
  makeUnit('e', 1, { x: 8, y: 6 }, { characterId: 'test-char' }),
]);
const AIM = [{ x: 12, y: 6 }];
const burn = (id = 'burn') => [{ unitId: 'a', ability: { abilityId: id, target: AIM } }];
const idle: UnitOrders[] = [];

describe('DOT-HOT: a damage-over-time ticks for exactly its duration', () => {
  it('a 2-turn DoT deals its amount twice — on the turn it lands and the next', () => {
    // The order test. If the tick ran after the duration decrement this would be
    // 10, not 20, and the effect would silently be worth half what it says.
    let s = board();
    ({ state: s } = run(s, burn()));
    expect(unit(s, 'e').hp, 'the turn it landed').toBe(90);

    ({ state: s } = run(s, idle));
    expect(unit(s, 'e').hp, 'and the turn after').toBe(80);

    ({ state: s } = run(s, idle));
    expect(unit(s, 'e').hp, 'then it is spent').toBe(80);
  });

  it('is gone from the unit once it has ticked out', () => {
    let s = board();
    ({ state: s } = run(s, burn()));
    expect(getStatus(unit(s, 'e'), 'damageOverTime')).toBeDefined();
    ({ state: s } = run(s, idle));
    expect(getStatus(unit(s, 'e'), 'damageOverTime')).toBeUndefined();
  });

  it('emits an ordinary `damage` event, so nothing downstream learns a new shape', () => {
    // Playback, the combat log and any damage tally read `damage` — an over-time
    // event kind would have meant teaching all three about burning.
    let s = board();
    ({ state: s } = run(s, burn()));
    const { events } = run(s, idle);
    const tick = events.find((e) => e.type === 'damage' && e.unitId === 'e');
    expect(tick).toMatchObject({ amount: 10, sourceUnitId: 'a', abilityId: 'burn' });
  });

  it('a heal-over-time ticks the same way, on an ally', () => {
    const s = board();
    unit(s, 'a').hp = 50;
    const cast = [{ unitId: 'a', ability: { abilityId: 'mend', target: [{ x: 2, y: 6 }] } }];
    const first = run(s, cast);
    expect(unit(first.state, 'a').hp).toBe(60);
    const second = run(first.state, idle);
    expect(unit(second.state, 'a').hp).toBe(70);
  });

  it('a heal-over-time cannot overheal past max', () => {
    const s = board();
    unit(s, 'a').hp = 95;
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'mend', target: [{ x: 2, y: 6 }] } }]);
    expect(unit(state, 'a').hp).toBe(100);
  });
});

describe('DOT-HOT: it behaves like every other status', () => {
  it('refreshes rather than stacking', () => {
    // Two burns on one target is one burn, re-lit — the same rule as every
    // status (GAME_SPEC §6), which is the point of riding the same machinery.
    let s = board();
    ({ state: s } = run(s, burn()));
    ({ state: s } = run(s, burn()));
    const dot = getStatus(unit(s, 'e'), 'damageOverTime')!;
    expect(dot.remaining).toBe(1); // re-applied at 2, ticked once
    expect(dot.amount).toBe(10);   // one instance, not two
  });

  it('a refresh re-authors it — the kill belongs to whoever last lit it', () => {
    // Refresh-not-stack replaces the instance, so it must replace the author
    // too: crediting the unit that started a burn somebody else re-applied would
    // be the wrong name on the kill.
    const s = makeState([
      makeUnit('a', 0, { x: 2, y: 6 }, { characterId: 'test-char' }),
      makeUnit('b', 0, { x: 2, y: 5 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 8, y: 6 }, { characterId: 'test-char' }),
    ]);
    const first = run(s, burn());
    expect(getStatus(unit(first.state, 'e'), 'damageOverTime')?.sourceUnitId).toBe('a');

    // `b` walks onto `a`'s row and re-lights the same target.
    first.state.units.find((u) => u.unitId === 'b')!.pos = { x: 3, y: 6 };
    const second = run(first.state, [{ unitId: 'b', ability: { abilityId: 'burn', target: AIM } }]);
    expect(getStatus(unit(second.state, 'e'), 'damageOverTime')?.sourceUnitId).toBe('b');
  });

  it('follows FF1 polarity: a DoT reaches an ally in the area, a HoT does not reach an enemy', () => {
    const s = makeState([
      makeUnit('a', 0, { x: 2, y: 6 }, { characterId: 'test-char' }),
      makeUnit('ally', 0, { x: 5, y: 6 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 8, y: 6 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(s, burn());
    expect(getStatus(unit(state, 'ally'), 'damageOverTime'), 'friendly fire is on').toBeDefined();

    const healed = run(s, [{ unitId: 'a', ability: { abilityId: 'mend', target: [{ x: 5, y: 6 }] } }]);
    expect(getStatus(unit(healed.state, 'ally'), 'healOverTime')).toBeDefined();
    expect(getStatus(unit(healed.state, 'e'), 'healOverTime'), 'you do not heal enemies').toBeUndefined();
  });
});

describe('DOT-HOT: death, credit and determinism', () => {
  it('a unit that dies mid-DoT stops ticking', () => {
    // Asserted on the *events* rather than on HP, because a corpse respawns —
    // reading HP back would be measuring the respawn, not the burn.
    let s = board();
    unit(s, 'e').hp = 15;
    ({ state: s } = run(s, burn('scorch'))); // 40/turn — kills on the first tick
    expect(unit(s, 'e').alive).toBe(false);

    const after = run(s, idle);
    expect(after.events.some((e) => e.type === 'damage' && e.unitId === 'e'),
      'a corpse does not keep burning').toBe(false);
  });

  it('a DoT kill credits the applying unit\'s team, like a trap', () => {
    const s = board();
    unit(s, 'e').hp = 15;
    const { state, events } = run(s, burn('scorch'));
    expect(state.kills[0]).toBe(1);
    expect(state.kills[1]).toBe(0);
    expect(events.some((e) => e.type === 'death' && e.unitId === 'e' && e.killer === 0)).toBe(true);
  });

  it('and a DoT the victim owns credits nobody — a friendly kill scores nothing', () => {
    // FF1: an ally burned to death by your own AoE is a tempo loss, not a point.
    const s = makeState([
      makeUnit('a', 0, { x: 2, y: 6 }, { characterId: 'test-char' }),
      makeUnit('ally', 0, { x: 5, y: 6 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 8, y: 6 }, { characterId: 'test-char' }),
    ]);
    unit(s, 'ally').hp = 15;
    const { state } = run(s, burn('scorch'));
    expect(unit(state, 'ally').alive).toBe(false);
    expect(state.kills).toEqual([0, 0]);
  });

  it('two units burning out in one turn resolve in a fixed order', () => {
    const mk = (): GameState => {
      const s = makeState([
        makeUnit('a', 0, { x: 2, y: 6 }, { characterId: 'test-char' }),
        makeUnit('e1', 1, { x: 6, y: 6 }, { characterId: 'test-char' }),
        makeUnit('e2', 1, { x: 8, y: 6 }, { characterId: 'test-char' }),
      ]);
      unit(s, 'e1').hp = 15;
      unit(s, 'e2').hp = 15;
      return s;
    };
    const once = run(mk(), burn('scorch'));
    const twice = run(mk(), burn('scorch'));
    expect(JSON.stringify(once.state)).toEqual(JSON.stringify(twice.state));
    expect(JSON.stringify(once.events)).toEqual(JSON.stringify(twice.events));
    expect(once.state.kills[0]).toBe(2);
  });

  it('a shield absorbs a DoT tick, like any other damage', () => {
    let s = board();
    unit(s, 'e').statuses = [{ kind: 'shield', remaining: 3, amount: 6 }];
    ({ state: s } = run(s, burn()));
    // 10 damage, 6 absorbed by the shield, 4 to HP.
    expect(unit(s, 'e').hp).toBe(96);
  });

  it('the amounts stay integers — no float creeps in from a per-turn division', () => {
    let s = board();
    ({ state: s } = run(s, burn()));
    ({ state: s } = run(s, idle));
    expect(Number.isInteger(unit(s, 'e').hp)).toBe(true);
  });
});
