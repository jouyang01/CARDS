import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../src/resolve.js';
import { dummyRoster, makeDummy, makeMap, makeState } from './helpers.js';
import type { GameState, PlayerOrders, TurnEvent, Vec2 } from '../src/types.js';

const map = makeMap(Array.from({ length: 9 }, () => '.'.repeat(9)));
const roster = dummyRoster();

const twoP = (p0: PlayerOrders['units'], p1: PlayerOrders['units'] = []): [PlayerOrders, PlayerOrders] => [
  { player: 0, units: p0 },
  { player: 1, units: p1 },
];

/** Just the phaseStart phases, in the order they were emitted. */
const phaseOrder = (events: TurnEvent[]): string[] =>
  events.filter((e) => e.type === 'phaseStart').map((e) => (e as { phase: string }).phase);

describe('resolveTurn — phase order (BACKLOG item 4 signature)', () => {
  it('emits every phase once, always prep → dash → blast → move', () => {
    const state = makeState([makeDummy('u0', 0, { x: 0, y: 0 }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    const { events } = resolveTurn(state, map, twoP([{ unitId: 'u0' }]), roster);
    expect(phaseOrder(events)).toEqual(['prep', 'dash', 'blast', 'move']);
  });

  it('buckets each unit’s ability into its tagged phase, firing in unit order', () => {
    // Four dummy units (engine is N-per-side) so all three ability phases fire.
    const state = makeState([
      makeDummy('a0', 0, { x: 0, y: 0 }),
      makeDummy('a1', 0, { x: 0, y: 2 }),
      makeDummy('b0', 1, { x: 8, y: 0 }),
      makeDummy('b1', 1, { x: 8, y: 2 }),
    ]);
    const orders = twoP(
      [
        { unitId: 'a0', ability: { abilityId: 'prep_stance', target: [] } },
        { unitId: 'a1', ability: { abilityId: 'dash_roll', target: [{ x: 1, y: 2 }, { x: 2, y: 2 }] } },
      ],
      [
        { unitId: 'b0', ability: { abilityId: 'blast_shot', target: [{ x: 6, y: 0 }] } },
        { unitId: 'b1', ability: { abilityId: 'slow_bomb', target: [{ x: 6, y: 2 }] } },
      ],
    );
    const { events } = resolveTurn(state, map, orders, roster);
    expect(events).toEqual([
      { type: 'phaseStart', phase: 'prep' },
      { type: 'abilityFired', unitId: 'a0', abilityId: 'prep_stance', area: [{ x: 0, y: 0 }] },
      { type: 'phaseStart', phase: 'dash' },
      { type: 'abilityFired', unitId: 'a1', abilityId: 'dash_roll', area: [{ x: 1, y: 2 }, { x: 2, y: 2 }] },
      { type: 'phaseStart', phase: 'blast' },
      { type: 'abilityFired', unitId: 'b0', abilityId: 'blast_shot', area: [{ x: 6, y: 0 }] },
      { type: 'abilityFired', unitId: 'b1', abilityId: 'slow_bomb', area: [{ x: 6, y: 2 }] },
      { type: 'phaseStart', phase: 'move' },
    ]);
  });

  it('fires a self ability at the caster’s own square', () => {
    const state = makeState([makeDummy('u0', 0, { x: 3, y: 4 }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    const { events } = resolveTurn(state, map, twoP([{ unitId: 'u0', ability: { abilityId: 'prep_stance', target: [] } }]), roster);
    expect(events).toContainEqual({ type: 'abilityFired', unitId: 'u0', abilityId: 'prep_stance', area: [{ x: 3, y: 4 }] });
  });
});

describe('resolveTurn — the skeleton resolves no ability effects yet', () => {
  it('a fired dash does not move the unit (dash movement is item 7)', () => {
    const state = makeState([makeDummy('u0', 0, { x: 0, y: 2 }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    const { state: next } = resolveTurn(state, map, twoP([{ unitId: 'u0', ability: { abilityId: 'dash_roll', target: [{ x: 1, y: 2 }, { x: 2, y: 2 }] } }]), roster);
    expect(next.units.find((u) => u.unitId === 'u0')!.pos).toEqual({ x: 0, y: 2 });
  });

  it('a fired blast leaves hp and energy untouched (damage/energy are items 5)', () => {
    const state = makeState([
      makeDummy('u0', 0, { x: 0, y: 0 }, { energy: 20 }),
      makeDummy('u1', 1, { x: 5, y: 0 }, { hp: 90 }),
    ]);
    const { state: next } = resolveTurn(state, map, twoP([{ unitId: 'u0', ability: { abilityId: 'blast_shot', target: [{ x: 5, y: 0 }] } }]), roster);
    expect(next.units.find((u) => u.unitId === 'u0')!.energy).toBe(20);
    expect(next.units.find((u) => u.unitId === 'u1')!.hp).toBe(90);
    expect(next.turn).toBe(1); // the skeleton does not run end-of-turn bookkeeping
  });
});

describe('resolveTurn — Move phase execution', () => {
  it('walks a single unit square by square', () => {
    const state = makeState([makeDummy('u0', 0, { x: 0, y: 0 }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    const path: Vec2[] = [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    const { state: next, events } = resolveTurn(state, map, twoP([{ unitId: 'u0', movePath: path }]), roster);
    expect(events.filter((e) => e.type === 'moveStep')).toEqual([
      { type: 'moveStep', unitId: 'u0', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
      { type: 'moveStep', unitId: 'u0', from: { x: 1, y: 0 }, to: { x: 2, y: 0 } },
      { type: 'moveStep', unitId: 'u0', from: { x: 2, y: 0 }, to: { x: 3, y: 0 } },
    ]);
    expect(next.units.find((u) => u.unitId === 'u0')!.pos).toEqual({ x: 3, y: 0 });
  });

  it('fires an ability and still moves the same unit', () => {
    const state = makeState([makeDummy('u0', 0, { x: 0, y: 0 }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    const orders = twoP([{ unitId: 'u0', ability: { abilityId: 'blast_shot', target: [{ x: 4, y: 0 }] }, movePath: [{ x: 0, y: 1 }] }]);
    const { state: next, events } = resolveTurn(state, map, orders, roster);
    expect(events.some((e) => e.type === 'abilityFired' && e.unitId === 'u0')).toBe(true);
    expect(next.units.find((u) => u.unitId === 'u0')!.pos).toEqual({ x: 0, y: 1 });
  });

  it('contested square: two units entering it on the same step both stop short', () => {
    const state = makeState([makeDummy('u0', 0, { x: 0, y: 1 }), makeDummy('u1', 1, { x: 2, y: 1 })]);
    const orders = twoP([{ unitId: 'u0', movePath: [{ x: 1, y: 1 }] }], [{ unitId: 'u1', movePath: [{ x: 1, y: 1 }] }]);
    const { state: next, events } = resolveTurn(state, map, orders, roster);
    expect(events.filter((e) => e.type === 'moveStep')).toEqual([]);
    expect(next.units.find((u) => u.unitId === 'u0')!.pos).toEqual({ x: 0, y: 1 });
    expect(next.units.find((u) => u.unitId === 'u1')!.pos).toEqual({ x: 2, y: 1 });
  });

  it('a later arrival is blocked by whoever reached the shared square first', () => {
    // u0 reaches (2,0) on step 1; u1 aims to arrive on step 2 and is turned away.
    const state = makeState([makeDummy('u0', 0, { x: 1, y: 0 }), makeDummy('u1', 1, { x: 4, y: 0 })]);
    const orders = twoP(
      [{ unitId: 'u0', movePath: [{ x: 2, y: 0 }] }],
      [{ unitId: 'u1', movePath: [{ x: 3, y: 0 }, { x: 2, y: 0 }] }],
    );
    const { state: next, events } = resolveTurn(state, map, orders, roster);
    expect(next.units.find((u) => u.unitId === 'u0')!.pos).toEqual({ x: 2, y: 0 });
    expect(next.units.find((u) => u.unitId === 'u1')!.pos).toEqual({ x: 3, y: 0 });
    // Two steps land (both units' step 1); u1's blocked step 2 emits nothing.
    expect(events.filter((e) => e.type === 'moveStep')).toHaveLength(2);
  });
});

describe('resolveTurn — contract guarantees', () => {
  it('throws on invalid orders, deterministically', () => {
    const state = makeState([makeDummy('u0', 0, { x: 0, y: 0 }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    const bad = twoP([{ unitId: 'u0', ability: { abilityId: 'nope', target: [{ x: 1, y: 0 }] } }]);
    expect(() => resolveTurn(state, map, bad, roster)).toThrow(/invalid orders/);
  });

  it('does not mutate the input state (pure — replay safe)', () => {
    const state = makeState([makeDummy('u0', 0, { x: 0, y: 0 }), makeDummy('u1', 1, { x: 8, y: 8 })]);
    const before = structuredClone(state);
    resolveTurn(state, map, twoP([{ unitId: 'u0', movePath: [{ x: 1, y: 0 }, { x: 2, y: 0 }] }]), roster);
    expect(state).toEqual(before);
  });

  it('is a pure function of its inputs — identical calls, identical output', () => {
    const state = makeState([makeDummy('u0', 0, { x: 0, y: 0 }), makeDummy('u1', 1, { x: 2, y: 0 })]);
    const orders = twoP(
      [{ unitId: 'u0', ability: { abilityId: 'blast_shot', target: [{ x: 5, y: 0 }] }, movePath: [{ x: 0, y: 1 }] }],
      [{ unitId: 'u1', movePath: [{ x: 3, y: 0 }] }],
    );
    const a = resolveTurn(state, map, orders, roster);
    const b = resolveTurn(state, map, orders, roster);
    expect(a).toEqual(b);
  });
});
