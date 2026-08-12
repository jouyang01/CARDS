import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit, status, withStatuses } from './helpers.js';
import type {
  AbilityDef,
  CharacterDef,
  GameState,
  PlayerId,
  TurnEvent,
  UnitOrders,
  Vec2,
} from '../src/types.js';

// ── Test content ─────────────────────────────────────────────────────────────

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id,
  phase: 'blast',
  shape: 'square',
  range: 6,
  cooldown: 0,
  energyGain: 0,
  effects: [],
  description: over.id,
  ...over,
});

const ABILITIES: AbilityDef[] = [
  ability({ id: 'shoot', shape: 'line', range: 6, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
  ability({ id: 'bigshoot', shape: 'square', range: 6, energyGain: 5, effects: [{ kind: 'damage', amount: 100 }] }),
  ability({ id: 'guard', phase: 'prep', shape: 'self', range: 0, cooldown: 2, energyGain: 6, effects: [{ kind: 'shield', amount: 20, duration: 1 }] }),
  ability({ id: 'mightself', phase: 'prep', shape: 'self', range: 0, energyGain: 4, effects: [{ kind: 'might', duration: 2 }] }),
];
const ULT: AbilityDef = ability({ id: 'ultnuke', shape: 'square', range: 9, energyGain: 0, effects: [{ kind: 'damage', amount: 50 }] });

const testChar: CharacterDef = {
  id: 'test-char',
  name: 'Test',
  archetype: 'firepower',
  maxHp: 100,
  abilities: ABILITIES,
  ultimate: ULT,
};
const roster: Roster = { 'test-char': testChar };

const OPEN = () => makeMap(Array.from({ length: 9 }, () => '.'.repeat(9)));

function orders(player: PlayerId, units: UnitOrders[]) {
  return { player, units };
}

/** Run one turn from a state with per-player unit orders. */
function run(state: GameState, u0: UnitOrders[], u1: UnitOrders[], map = OPEN()) {
  return resolveTurn(state, map, [orders(0, u0), orders(1, u1)], roster);
}

const phaseOrder = (events: TurnEvent[]): string[] =>
  events.filter((e) => e.type === 'phaseStart').map((e) => (e as { phase: string }).phase);

// ── Phase order & validation ─────────────────────────────────────────────────

describe('phase order and order validation', () => {
  it('always emits the four phases in the sacred order', () => {
    const state = makeState([makeUnit('u', 0, { x: 1, y: 1 }), makeUnit('e', 1, { x: 7, y: 7 })]);
    const { events } = run(state, [], []);
    expect(phaseOrder(events)).toEqual(['prep', 'dash', 'blast', 'move']);
  });

  it('drops an unknown ability id without firing it', () => {
    const state = makeState([makeUnit('u', 0, { x: 1, y: 1 }), makeUnit('e', 1, { x: 7, y: 7 })]);
    const { events } = run(state, [{ unitId: 'u', ability: { abilityId: 'nope', target: [{ x: 7, y: 7 }] } }], []);
    expect(events.some((e) => e.type === 'abilityFired')).toBe(false);
  });

  it('drops an out-of-range aimed ability deterministically', () => {
    const state = makeState([makeUnit('u', 0, { x: 0, y: 0 }), makeUnit('e', 1, { x: 8, y: 8 })]);
    // bigshoot range 6 aimed at (8,8): Chebyshev 8 > 6 → rejected
    const { events, state: next } = run(state, [{ unitId: 'u', ability: { abilityId: 'bigshoot', target: [{ x: 8, y: 8 }] } }], []);
    expect(events.some((e) => e.type === 'abilityFired')).toBe(false);
    expect(next.units.find((u) => u.unitId === 'e')!.hp).toBe(100);
  });
});

// ── Prep before Blast ────────────────────────────────────────────────────────

describe('prep resolves before blast', () => {
  it('a shield raised in Prep absorbs a Blast hit the same turn', () => {
    const u = makeUnit('u', 0, { x: 1, y: 1 });
    const e = makeUnit('e', 1, { x: 1, y: 4 });
    const { state } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'guard', target: [] } }],
      [{ unitId: 'e', ability: { abilityId: 'shoot', target: [{ x: 1, y: 0 }] } }], // line fired north, through u
    );
    const uAfter = state.units.find((x) => x.unitId === 'u')!;
    expect(uAfter.hp).toBe(100); // 20 damage fully absorbed by the 20 shield
    expect(uAfter.statuses.some((s) => s.kind === 'shield')).toBe(false); // shield spent
  });
});

// ── Blast simultaneity & death ───────────────────────────────────────────────

describe('blast damage, cover and simultaneity', () => {
  it('applies Might from a pre-existing status: floor(20*1.25) = 25', () => {
    const u = withStatuses(makeUnit('u', 0, { x: 3, y: 3 }), status('might', 2));
    const e = makeUnit('e', 1, { x: 3, y: 5 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 3, y: 8 }] } }], []);
    expect(state.units.find((x) => x.unitId === 'e')!.hp).toBe(75);
  });

  it('halves damage behind cover (round down)', () => {
    //  cover 'o' between the defender and the attacker (on the defender's south
    //  side, facing the attacker below).
    //  0123
    // 0....
    // 1.e..   defender (1,1)
    // 2.o..   cover (1,2)
    // 3.a..   attacker (1,3)
    const map = makeMap(['....', '....', '.o..', '....']);
    const a = makeUnit('a', 0, { x: 1, y: 3 });
    const e = makeUnit('e', 1, { x: 1, y: 1 });
    const { state } = run(makeState([a, e]), [{ unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 1, y: 0 }] } }], [], map);
    expect(state.units.find((x) => x.unitId === 'e')!.hp).toBe(90); // floor(20*0.5)=10
  });

  it('mutual kill: both deal full damage and both kills count', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 }, { hp: 30 });
    const e = makeUnit('e', 1, { x: 3, y: 5 }, { hp: 30 });
    const { state, events } = run(
      makeState([u, e]),
      [{ unitId: 'u', ability: { abilityId: 'bigshoot', target: [{ x: 3, y: 5 }] } }],
      [{ unitId: 'e', ability: { abilityId: 'bigshoot', target: [{ x: 3, y: 3 }] } }],
    );
    expect(state.units.every((x) => !x.alive)).toBe(true);
    expect(state.kills).toEqual([1, 1]);
    expect(events.filter((e) => e.type === 'death')).toHaveLength(2);
  });

  it('a unit killed in Blast takes no Move that turn', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 }, { hp: 10 });
    const e = makeUnit('e', 1, { x: 3, y: 5 });
    const { state, events } = run(
      makeState([u, e]),
      [{ unitId: 'u', movePath: [{ x: 4, y: 3 }] }],
      [{ unitId: 'e', ability: { abilityId: 'bigshoot', target: [{ x: 3, y: 3 }] } }],
    );
    const uAfter = state.units.find((x) => x.unitId === 'u')!;
    expect(uAfter.alive).toBe(false);
    expect(uAfter.pos).toEqual({ x: 3, y: 3 }); // never moved
    expect(events.some((ev) => ev.type === 'moveStep' && ev.unitId === 'u')).toBe(false);
  });
});

// ── Move simultaneity: contested & swap (3a) ─────────────────────────────────

describe('simultaneous move resolution', () => {
  it('contested square: both stop, neither enters', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 2, y: 0 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', movePath: [{ x: 1, y: 0 }] }], [{ unitId: 'e', movePath: [{ x: 1, y: 0 }] }]);
    expect(state.units.find((x) => x.unitId === 'u')!.pos).toEqual({ x: 0, y: 0 });
    expect(state.units.find((x) => x.unitId === 'e')!.pos).toEqual({ x: 2, y: 0 });
  });

  it('crossing paths never swap through each other (3a)', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 3, y: 0 });
    const { state } = run(
      makeState([u, e]),
      [{ unitId: 'u', movePath: [{ x: 1, y: 0 }, { x: 2, y: 0 }] }],
      [{ unitId: 'e', movePath: [{ x: 2, y: 0 }, { x: 1, y: 0 }] }],
    );
    // Each advances one square, then the swap is blocked.
    expect(state.units.find((x) => x.unitId === 'u')!.pos).toEqual({ x: 1, y: 0 });
    expect(state.units.find((x) => x.unitId === 'e')!.pos).toEqual({ x: 2, y: 0 });
  });

  it('a path into a currently-occupied square is rejected at validation (v1 limit)', () => {
    // Ordering a move onto a square an ally holds is rejected up front (see
    // docs/DECISIONS.md); ally convoys become expressible at 2v2.
    const a = makeUnit('a', 0, { x: 0, y: 0 });
    const b = makeUnit('b', 0, { x: 1, y: 0 });
    const { state, events } = run(makeState([a, b]), [{ unitId: 'a', movePath: [{ x: 1, y: 0 }] }], []);
    expect(state.units.find((x) => x.unitId === 'a')!.pos).toEqual({ x: 0, y: 0 });
    expect(events.some((ev) => ev.type === 'moveStep' && ev.unitId === 'a')).toBe(false);
  });
});

// ── Economy ──────────────────────────────────────────────────────────────────

describe('energy and cooldowns', () => {
  it('passive +5 at end of turn for the living', () => {
    const state = makeState([makeUnit('u', 0, { x: 1, y: 1 }), makeUnit('e', 1, { x: 7, y: 7 })]);
    const { state: next } = run(state, [], []);
    expect(next.units.find((u) => u.unitId === 'u')!.energy).toBe(5);
  });

  it('grants on-hit energy plus passive when an ability hits an enemy', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 });
    const e = makeUnit('e', 1, { x: 3, y: 5 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 3, y: 8 }] } }], []);
    expect(state.units.find((x) => x.unitId === 'u')!.energy).toBe(13); // 8 on hit + 5 passive
  });

  it('grants self-buff energy on use even with no enemy hit', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 });
    const e = makeUnit('e', 1, { x: 7, y: 7 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'guard', target: [] } }], []);
    expect(state.units.find((x) => x.unitId === 'u')!.energy).toBe(11); // 6 on use + 5 passive
  });

  it('a damaging ability that misses grants no ability energy', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 });
    const e = makeUnit('e', 1, { x: 7, y: 7 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 3, y: 0 }] } }], []);
    expect(state.units.find((x) => x.unitId === 'u')!.energy).toBe(5); // passive only
  });

  it('E1: Energized scales on-hit energy but NOT the flat passive drip', () => {
    const u = withStatuses(makeUnit('u', 0, { x: 3, y: 3 }), status('energized', 2));
    const e = makeUnit('e', 1, { x: 3, y: 5 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 3, y: 8 }] } }], []);
    // on-hit 8 → floor(8*1.5)=12 (Energized-scaled); passive 5 stays flat (not 7).
    expect(state.units.find((x) => x.unitId === 'u')!.energy).toBe(17);
  });

  it('the ultimate needs 100 energy, resets to 0 on use', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 }, { energy: 100 });
    const e = makeUnit('e', 1, { x: 3, y: 5 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'ultnuke', target: [{ x: 3, y: 5 }] } }], []);
    expect(state.units.find((x) => x.unitId === 'e')!.hp).toBe(50); // ult landed
    expect(state.units.find((x) => x.unitId === 'u')!.energy).toBe(5); // reset to 0, then +5 passive
  });

  it('the ultimate is rejected below 100 energy', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 }, { energy: 50 });
    const e = makeUnit('e', 1, { x: 3, y: 5 });
    const { state, events } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'ultnuke', target: [{ x: 3, y: 5 }] } }], []);
    expect(events.some((ev) => ev.type === 'abilityFired')).toBe(false);
    expect(state.units.find((x) => x.unitId === 'e')!.hp).toBe(100);
  });

  it('starts a cooldown on use and ticks it down at end of turn; re-use is rejected', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 });
    const e = makeUnit('e', 1, { x: 7, y: 7 });
    const first = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'guard', target: [] } }], []);
    expect(first.state.units.find((x) => x.unitId === 'u')!.cooldowns.guard).toBe(1); // cd 2, ticked to 1
    const second = resolveTurn(first.state, OPEN(), [orders(0, [{ unitId: 'u', ability: { abilityId: 'guard', target: [] } }]), orders(1, [])], roster);
    expect(second.events.some((ev) => ev.type === 'abilityFired')).toBe(false); // still on cooldown
  });
});

// ── Reveal / Stealth on attack ───────────────────────────────────────────────

describe('attacking reveals and breaks stealth', () => {
  it('a hitting attacker gains Reveal (into next turn) and loses Stealth', () => {
    const u = withStatuses(makeUnit('u', 0, { x: 3, y: 3 }), status('stealth', 3));
    const e = makeUnit('e', 1, { x: 3, y: 5 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 3, y: 8 }] } }], []);
    const uAfter = state.units.find((x) => x.unitId === 'u')!;
    expect(uAfter.statuses.some((s) => s.kind === 'stealth')).toBe(false);
    expect(uAfter.statuses.find((s) => s.kind === 'reveal')?.remaining).toBe(1); // 2 applied, ticked to 1
  });
});

// ── Deaths, respawn, win ─────────────────────────────────────────────────────

describe('deaths, respawn and win conditions', () => {
  it('respawns a dead unit one full turn later, at spawn, full HP', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 }, { hp: 10 });
    const e = makeUnit('e', 1, { x: 3, y: 5 });
    const t1 = run(makeState([u, e]), [], [{ unitId: 'e', ability: { abilityId: 'bigshoot', target: [{ x: 3, y: 3 }] } }]);
    const uT1 = t1.state.units.find((x) => x.unitId === 'u')!;
    expect(uT1.alive).toBe(false);
    expect(uT1.respawnIn).toBe(1);

    const t2 = resolveTurn(t1.state, OPEN(), [orders(0, []), orders(1, [])], roster);
    const uT2 = t2.state.units.find((x) => x.unitId === 'u')!;
    expect(uT2.alive).toBe(true);
    expect(uT2.hp).toBe(100);
    expect(uT2.pos).toEqual({ x: 0, y: 0 }); // player-0 spawn on the open map
    expect(t2.events.some((ev) => ev.type === 'respawn' && ev.unitId === 'u')).toBe(true);
  });

  it('first to 3 kills wins', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 });
    const e = makeUnit('e', 1, { x: 3, y: 5 }, { hp: 10 });
    const { state, events } = run(makeState([u, e], { kills: [2, 0] }), [{ unitId: 'u', ability: { abilityId: 'bigshoot', target: [{ x: 3, y: 5 }] } }], []);
    expect(state.kills).toEqual([3, 0]);
    expect(state.status).toBe('finished');
    expect(state.winner).toBe(0);
    expect(events.some((ev) => ev.type === 'gameEnd' && ev.result === 'win' && ev.winner === 0)).toBe(true);
  });

  it('both reaching 3 at once is a draw (Double KO)', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 }, { hp: 10 });
    const e = makeUnit('e', 1, { x: 3, y: 5 }, { hp: 10 });
    const { state, events } = run(
      makeState([u, e], { kills: [2, 2] }),
      [{ unitId: 'u', ability: { abilityId: 'bigshoot', target: [{ x: 3, y: 5 }] } }],
      [{ unitId: 'e', ability: { abilityId: 'bigshoot', target: [{ x: 3, y: 3 }] } }],
    );
    expect(state.kills).toEqual([3, 3]);
    expect(state.status).toBe('draw');
    expect(events.some((ev) => ev.type === 'gameEnd' && ev.result === 'draw')).toBe(true);
  });

  it('turn-12 kill leader wins', () => {
    const state = makeState([makeUnit('u', 0, { x: 1, y: 1 }), makeUnit('e', 1, { x: 7, y: 7 })], { turn: 12, kills: [1, 0] });
    const { state: next } = run(state, [], []);
    expect(next.status).toBe('finished');
    expect(next.winner).toBe(0);
  });

  it('a tie at the limit enters sudden death and keeps playing', () => {
    const state = makeState([makeUnit('u', 0, { x: 1, y: 1 }), makeUnit('e', 1, { x: 7, y: 7 })], { turn: 12, kills: [1, 1] });
    const { state: next } = run(state, [], []);
    expect(next.status).toBe('active');
    expect(next.suddenDeath).toBe(true);
    expect(next.turn).toBe(13);
  });

  it('advances the turn counter when play continues', () => {
    const state = makeState([makeUnit('u', 0, { x: 1, y: 1 }), makeUnit('e', 1, { x: 7, y: 7 })], { turn: 3 });
    expect(run(state, [], []).state.turn).toBe(4);
  });
});

// ── Purity ───────────────────────────────────────────────────────────────────

describe('purity and determinism', () => {
  it('does not mutate the input state', () => {
    const u = makeUnit('u', 0, { x: 3, y: 3 });
    const e = makeUnit('e', 1, { x: 3, y: 5 }, { hp: 30 });
    const state = makeState([u, e]);
    const snapshot = JSON.stringify(state);
    run(state, [{ unitId: 'u', ability: { abilityId: 'bigshoot', target: [{ x: 3, y: 5 }] } }], []);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('identical inputs produce identical output', () => {
    const build = (): [GameState, UnitOrders[], UnitOrders[]] => [
      makeState([makeUnit('u', 0, { x: 3, y: 3 }), makeUnit('e', 1, { x: 3, y: 5 }, { hp: 40 })]),
      [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 3, y: 8 }] } }],
      [{ unitId: 'e', ability: { abilityId: 'shoot', target: [{ x: 3, y: 0 }] } }],
    ];
    const a = run(...build());
    const b = run(...build());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
