import { describe, expect, it } from 'vitest';
import { MOVE_RANGE, VISION_RANGE } from '../src/constants.js';
import { buildCatalystPool, type CatalystData } from '../src/catalysts.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, LastKnownPos, UnitOrders } from '../src/types.js';

/**
 * CHASE1 — chase orders, resolving at the end of Move.
 *
 * A chase says "follow that one" instead of naming squares, so it resolves after
 * everybody else has finished moving. Nearly all of the difficulty is in one
 * ruling (owner, 2026-09-01): **you cannot chase a target you cannot see.** A
 * chase that pathed toward a fogged target's real square would leak exactly what
 * fog hides (golden rule #5), so an unseen target's chase heads for the team's
 * last-known square and stops there.
 *
 * The tests below are written so that the *dangerous* version of the code — one
 * that reaches for `target.pos` unconditionally — fails them. Asserting only
 * "the chaser moved toward the target" would pass either way.
 */

const rows = (h: number, w: number): string[] =>
  Array.from({ length: h }, () => '.'.repeat(w));
const OPEN = makeMap(rows(21, 21));
/**
 * A brush patch out east. Brush conceals from any non-adjacent observer, so a
 * unit that walks into it is genuinely lost while still standing in the open —
 * which makes "chase into fog" testable without a maze.
 */
const BRUSHY = makeMap(rows(21, 21).map((row, y) =>
  (y === 10 ? `${row.slice(0, 13)}bbbb${row.slice(17)}` : row)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 20 }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shot' }),
    ability({ id: 'leap', phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] }),
    ability({ id: 'shove', effects: [{ kind: 'knockback', amount: 2 }] }),
    ability({ id: 'snare', effects: [{ kind: 'root', duration: 1 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

/** Just enough of a pool to test that a Dash catalyst takes the chase with it. */
const CATALYSTS = buildCatalystPool({
  prep: [], blast: [],
  dash: [{
    id: 'shift', name: 'Shift', phase: 'dash', shape: 'square', range: 3,
    cooldown: 0, energyGain: 0, free: true, oncePerMatch: true,
    effects: [{ kind: 'teleport' }], description: 'Blink up to 3 squares.',
  }],
} as unknown as CatalystData);

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = [], map = OPEN) =>
  resolveTurn(s, map, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster, CATALYSTS);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const at = (s: GameState, id: string) => unit(s, id).pos;
const known = (s: GameState, team: 0 | 1, id: string): LastKnownPos | undefined =>
  s.lastKnown.find((k) => k.team === team && k.unitId === id);
const chase = (unitId: string, target: string): UnitOrders[] => [{ unitId, chase: target }];
const idle: UnitOrders[] = [];

/** `a` (team 0) at (5,10), `e` (team 1) at (9,10) — 4 apart, in plain sight. */
const board = (): GameState => makeState([
  makeUnit('a', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
  makeUnit('e', 1, { x: 9, y: 10 }, { characterId: 'test-char' }),
]);

describe('CHASE1: a chase closes on where the target FINISHED moving', () => {
  it('follows a target that ran, rather than a square guessed at plan time', () => {
    // The point of the whole feature: the target moves 3 further away during
    // this same turn, and the chase still ends up adjacent to it. A move order
    // written at plan time could not have known where to aim.
    const s = board();
    const { state } = run(s, chase('a', 'e'), [{ unitId: 'e', movePath: [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }] }]);
    expect(at(state, 'e')).toEqual({ x: 12, y: 10 });
    // 5 → 9 on a MOVE_RANGE budget, stopping short of the occupied square.
    expect(at(state, 'a')).toEqual({ x: 5 + MOVE_RANGE, y: 10 });
  });

  it('stops short of the target rather than trying to stand on it', () => {
    const s = board();
    unit(s, 'a').pos = { x: 7, y: 10 }; // 2 away, well inside one move
    const { state } = run(s, chase('a', 'e'));
    expect(at(state, 'a')).toEqual({ x: 8, y: 10 });
    expect(at(state, 'e')).toEqual({ x: 9, y: 10 });
  });

  it('announces where it set off for, and that it could see it', () => {
    const { events } = run(board(), chase('a', 'e'));
    expect(events).toContainEqual({
      type: 'chaseResolved', unitId: 'a', targetUnitId: 'e', to: { x: 9, y: 10 }, seen: true,
    });
  });

  it('a chase order replaces a movePath — one reposition per turn', () => {
    const s = board();
    const { state } = run(s, [{ unitId: 'a', chase: 'e', movePath: [{ x: 5, y: 9 }, { x: 5, y: 8 }] }]);
    // The walk was north, the chase is east. Ending east proves the chase won.
    expect(at(state, 'a').y).toBe(10);
    expect(at(state, 'a').x).toBeGreaterThan(5);
  });

  it('a chase can still be sprinted', () => {
    // Sprint is "no ability, more squares"; a chase is movement, so nothing
    // about it should shrink the budget.
    // The target stays inside vision, or the fog rule would cap both runs at the
    // same last-known square and the sprint would look like it did nothing.
    const flee: UnitOrders[] = [{ unitId: 'e', movePath: [{ x: 10, y: 10 }, { x: 11, y: 10 }] }];
    const plain = run(board(), chase('a', 'e'), flee);
    const sprinted = run(board(), [{ unitId: 'a', chase: 'e', sprint: true }], flee);
    expect(at(plain.state, 'a')).toEqual({ x: 9, y: 10 });
    expect(at(sprinted.state, 'a'), 'the extra squares are spent on the chase').toEqual({ x: 10, y: 10 });
  });

  it('a chaser that cannot improve its position holds still', () => {
    const s = board();
    unit(s, 'a').pos = { x: 8, y: 10 }; // already adjacent
    const { state, events } = run(s, chase('a', 'e'));
    expect(at(state, 'a')).toEqual({ x: 8, y: 10 });
    expect(events.some((e) => e.type === 'moveStep' && e.unitId === 'a')).toBe(false);
  });
});

describe('CHASE1: you cannot chase a target you cannot see', () => {
  /**
   * `a` at (4,10) sees `e` at (9,10) on turn 1; on turn 2 `e` sprints east into
   * the brush and is lost. Team 0's record stays on (9,10), which is the only
   * square `a` is allowed to head for afterwards.
   */
  const loseSight = () => {
    const s = makeState([
      makeUnit('a', 0, { x: 4, y: 10 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 9, y: 10 }, { characterId: 'test-char' }),
    ]);
    const seen = run(s, idle, idle, BRUSHY);
    expect(known(seen.state, 0, 'e')?.pos, 'turn 1: in plain sight').toEqual({ x: 9, y: 10 });
    const hidden = run(seen.state, idle, [{
      unitId: 'e', sprint: true,
      movePath: [10, 11, 12, 13, 14].map((x) => ({ x, y: 10 })),
    }], BRUSHY);
    return hidden.state;
  };

  it('goes to the last-known square and STOPS — it does not pursue into fog', () => {
    // The load-bearing test, arranged so the *wrong* implementation fails on
    // position and not merely on an event field. `a` stands 3 from the last-known
    // square with a budget of 4: obeying the ruling it arrives on (9,10) and
    // halts with a square to spare, while a chase that read `e.pos` would spend
    // the fourth step and finish on (10,10).
    const s = loseSight();
    s.units.find((u) => u.unitId === 'a')!.pos = { x: 6, y: 10 };
    expect(at(s, 'e'), 'the target really did move on').toEqual({ x: 14, y: 10 });
    expect(known(s, 0, 'e')?.pos, 'and team 0 never saw it happen').toEqual({ x: 9, y: 10 });

    const { state, events } = run(s, chase('a', 'e'), idle, BRUSHY);
    expect(at(state, 'a')).toEqual({ x: 9, y: 10 });
    expect(events).toContainEqual({
      type: 'chaseResolved', unitId: 'a', targetUnitId: 'e', to: { x: 9, y: 10 }, seen: false,
    });
  });

  it('and short of the budget to arrive, it still heads only for the remembered square', () => {
    const s = loseSight(); // `a` is on (4,10): 5 away, budget 4
    const { state, events } = run(s, chase('a', 'e'), idle, BRUSHY);
    expect(at(state, 'a')).toEqual({ x: 8, y: 10 });
    expect(events.find((e) => e.type === 'chaseResolved')).toMatchObject({ to: { x: 9, y: 10 }, seen: false });
  });

  it('a target never seen at all cannot be chased — the unit holds', () => {
    // No record, no chase: you cannot chase a rumour. Put them far enough apart
    // that nothing was ever in vision range.
    const s = makeState([
      makeUnit('a', 0, { x: 1, y: 1 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 19, y: 19 }, { characterId: 'test-char' }),
    ]);
    expect(known(s, 0, 'e')).toBeUndefined();
    const { state, events } = run(s, chase('a', 'e'));
    expect(at(state, 'a')).toEqual({ x: 1, y: 1 });
    expect(events.some((e) => e.type === 'chaseResolved')).toBe(false);
  });

  it('regaining sight re-points the chase at the real square', () => {
    // The other half of the ruling: last-known is a fallback, not a lock.
    const s = loseSight();
    // Team 0 closes to within vision and, being adjacent, sees through the brush.
    unit(s, 'a').pos = { x: 13, y: 10 };
    const { events } = run(s, chase('a', 'e'), idle, BRUSHY);
    expect(events.find((e) => e.type === 'chaseResolved')).toMatchObject({ seen: true, to: { x: 14, y: 10 } });
  });

  it('the memory is per team — one side seeing does not brief the other', () => {
    const s = loseSight();
    expect(known(s, 1, 'a')?.pos, 'team 1 tracks team 0 on its own').toEqual({ x: 4, y: 10 });
    expect(known(s, 0, 'e')?.pos, "…and team 0's copy is the stale one").toEqual({ x: 9, y: 10 });
  });

  it('a sighting is stamped with its turn, so a stale ghost can be aged', () => {
    // Two more turns pass with the target still hidden. The record stops moving
    // and its stamp stops advancing, and the gap between that stamp and the
    // clock is what a client would fade a ghost by.
    let s = loseSight();
    const seenOn = known(s, 0, 'e')!.turn;
    ({ state: s } = run(s, idle, idle, BRUSHY));
    ({ state: s } = run(s, idle, idle, BRUSHY));
    const stale = known(s, 0, 'e')!;
    expect(stale.pos, 'still the square it was last seen on').toEqual({ x: 9, y: 10 });
    expect(stale.turn, 'and still stamped with the turn it was seen').toBe(seenOn);
    expect(s.turn - stale.turn, 'while the clock moved on').toBeGreaterThan(2);
  });

  it('vision range alone is enough to go stale — no wall required', () => {
    const s = makeState([
      makeUnit('a', 0, { x: 1, y: 10 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 1 + VISION_RANGE, y: 10 }, { characterId: 'test-char' }),
    ]);
    const seen = run(s, idle);
    expect(known(seen.state, 0, 'e')?.pos).toEqual({ x: 1 + VISION_RANGE, y: 10 });
    // `e` sprints out of vision; `a` holds.
    const gone = run(seen.state, idle, [{ unitId: 'e', sprint: true, movePath: Array.from({ length: 6 }, (_, i) => ({ x: 8 + i, y: 10 })) }]);
    expect(known(gone.state, 0, 'e')?.pos, 'the record did not follow it').toEqual({ x: 1 + VISION_RANGE, y: 10 });
  });
});

describe('CHASE1: the other three ruled cases', () => {
  it('a target killed EARLIER in this same turn drops the chase', () => {
    // The interesting version: the order was legal when it was written and the
    // target is a corpse by the time Move runs. A teammate does the killing, so
    // nothing about the chaser's own turn changes.
    const s = makeState([
      makeUnit('a', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
      makeUnit('b', 0, { x: 5, y: 11 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 9, y: 11 }, { characterId: 'test-char', hp: 5 }),
    ]);
    const { state, events } = run(s, [
      { unitId: 'a', chase: 'e' },
      { unitId: 'b', ability: { abilityId: 'shot', target: [{ x: 20, y: 11 }] } },
    ]);
    expect(unit(state, 'e').alive, 'the teammate got there first').toBe(false);
    expect(at(state, 'a'), 'so the chaser holds').toEqual({ x: 5, y: 10 });
    expect(events.some((e) => e.type === 'chaseResolved')).toBe(false);
  });

  it('a target already dead at the start of the turn drops it too', () => {
    const dead = board();
    unit(dead, 'e').alive = false;
    const { state, events } = run(dead, chase('a', 'e'));
    expect(at(state, 'a')).toEqual({ x: 5, y: 10 });
    expect(events.some((e) => e.type === 'chaseResolved')).toBe(false);
  });

  it('a dash ability drops the chase — the dash IS the movement', () => {
    const s = board();
    const { state, events } = run(s, [{ unitId: 'a', chase: 'e', ability: { abilityId: 'leap', target: [{ x: 5, y: 7 }] } }]);
    expect(at(state, 'a'), 'it leapt, and did not then also chase').toEqual({ x: 5, y: 7 });
    expect(events.some((e) => e.type === 'chaseResolved')).toBe(false);
  });

  it('a Dash catalyst drops it too (CAT-DASH-FULL)', () => {
    const s = board();
    unit(s, 'a').catalysts = ['shift'];
    const { state, events } = run(s, [{ unitId: 'a', chase: 'e', catalyst: { abilityId: 'shift', target: [{ x: 5, y: 8 }] } }]);
    expect(at(state, 'a'), 'it Shifted, and did not then also chase').toEqual({ x: 5, y: 8 });
    expect(events.some((e) => e.type === 'chaseResolved')).toBe(false);
  });

  it('chase vs chase converges — both read the same post-Move snapshot', () => {
    // A chases B while B chases A. Neither may see the other mid-chase, or the
    // second to resolve would be chasing a moving target and the result would
    // depend on visiting order. They meet in the middle and stop adjacent.
    const s = makeState([
      makeUnit('a', 0, { x: 4, y: 10 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 10, y: 10 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(s, chase('a', 'e'), chase('e', 'a'));
    // 6 apart, budget 4 each, so both aim for the square next to the other and
    // meet at (7,10) on the same step — a contest, which Collisions resolves by
    // letting neither in. They converge and stop one square short of touching.
    expect(at(state, 'a')).toEqual({ x: 6, y: 10 });
    expect(at(state, 'e')).toEqual({ x: 8, y: 10 });
  });

  it('a chase-vs-chase is symmetric — swapping the teams mirrors the result', () => {
    const mk = () => makeState([
      makeUnit('a', 0, { x: 4, y: 10 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 10, y: 10 }, { characterId: 'test-char' }),
    ]);
    const forwards = run(mk(), chase('a', 'e'), chase('e', 'a'));
    const backwards = run(mk(), chase('a', 'e'), chase('e', 'a'));
    expect(JSON.stringify(forwards.state)).toEqual(JSON.stringify(backwards.state));
  });
});

describe('CHASE1: a chase is Move, and everything that costs the Move costs it', () => {
  it('a knocked-back chaser loses the chase, like any other Move', () => {
    const s = makeState([
      makeUnit('a', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 9, y: 10 }, { characterId: 'test-char' }),
      makeUnit('e2', 1, { x: 3, y: 10 }, { characterId: 'test-char' }),
    ]);
    const { state, events } = run(s, chase('a', 'e'), [
      { unitId: 'e2', ability: { abilityId: 'shove', target: [{ x: 20, y: 10 }] } },
    ]);
    expect(at(state, 'a'), 'displaced, not chasing').toEqual({ x: 7, y: 10 });
    expect(events.some((e) => e.type === 'chaseResolved')).toBe(false);
  });

  it('a rooted chaser does not chase', () => {
    const s = board();
    unit(s, 'a').statuses = [{ kind: 'root', remaining: 2 }];
    const { state, events } = run(s, chase('a', 'e'));
    expect(at(state, 'a')).toEqual({ x: 5, y: 10 });
    expect(events.some((e) => e.type === 'chaseResolved')).toBe(false);
  });

  it('chasing an ally is not a chase at all', () => {
    const s = makeState([
      makeUnit('a', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
      makeUnit('b', 0, { x: 12, y: 10 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 9, y: 15 }, { characterId: 'test-char' }),
    ]);
    const { state, events } = run(s, [{ unitId: 'a', chase: 'b' }]);
    expect(at(state, 'a')).toEqual({ x: 5, y: 10 });
    expect(events.some((e) => e.type === 'chaseResolved')).toBe(false);
  });

  it('chasing a unit id that does not exist is dropped, not thrown', () => {
    const { state } = run(board(), [{ unitId: 'a', chase: 'nobody' }]);
    expect(at(state, 'a')).toEqual({ x: 5, y: 10 });
  });

  it('a chaser still triggers a trap it walks onto', () => {
    const s = board();
    s.traps = [{
      id: 't1', owner: 1, ownerUnitId: 'e', abilityId: 'x',
      pos: { x: 7, y: 10 }, damage: 20, expiresOnTurn: 99, onTrigger: [],
    }];
    const { state, events } = run(s, chase('a', 'e'));
    expect(events.some((e) => e.type === 'trapTriggered' && e.unitId === 'a')).toBe(true);
    expect(unit(state, 'a').hp).toBeLessThan(100);
  });

  it('a chaser can take a power-up pad it ends on (PADS1 resolves after chasers)', () => {
    const padded = makeMap(rows(21, 21), {
      powerups: [{ x: 8, y: 10, type: 'might', firstTurn: 1, everyTurns: 2 }],
    });
    const s = board();
    unit(s, 'a').pos = { x: 7, y: 10 }; // one step short of the pad, chasing east
    const { events } = run(s, chase('a', 'e'), idle, padded);
    expect(events.some((e) => e.type === 'powerupTaken' && e.unitId === 'a')).toBe(true);
  });
});

describe('CHASE1: determinism', () => {
  it('resolves identically twice, chasers and normal movers together', () => {
    const mk = () => makeState([
      makeUnit('a', 0, { x: 4, y: 10 }, { characterId: 'test-char' }),
      makeUnit('a2', 0, { x: 4, y: 12 }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 12, y: 10 }, { characterId: 'test-char' }),
      makeUnit('e2', 1, { x: 12, y: 12 }, { characterId: 'test-char' }),
    ]);
    const go = () => run(
      mk(),
      [{ unitId: 'a', chase: 'e' }, { unitId: 'a2', chase: 'e2' }],
      [{ unitId: 'e', movePath: [{ x: 13, y: 10 }] }, { unitId: 'e2', chase: 'a2' }],
    );
    const once = go();
    const twice = go();
    expect(JSON.stringify(once.state)).toEqual(JSON.stringify(twice.state));
    expect(JSON.stringify(once.events)).toEqual(JSON.stringify(twice.events));
  });

  it('lastKnown stays plain JSON — arrays, not Maps', () => {
    // `structuredClone` and the determinism hash both assume plain JSON; a Map
    // survives neither, and the failure mode is a desync rather than a throw.
    const { state } = run(board(), idle);
    expect(Array.isArray(state.lastKnown)).toBe(true);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
