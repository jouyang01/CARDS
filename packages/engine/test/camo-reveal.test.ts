import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REVEAL_ON_ATTACK_TURNS } from '../src/constants.js';
import { buildCatalystPool, type CatalystData } from '../src/catalysts.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { hasStatus } from '../src/status.js';
import { makeMap, makeState, makeUnit, status, withStatuses } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, UnitOrders } from '../src/types.js';

/**
 * CAMO-REVEAL — "If you used an offensive ability, used a catalyst, or took
 * damage while inside a camouflage zone, the tile you were standing on turned
 * bright red … revealed you to the enemy team for the rest of that turn, as well
 * as the following turn."
 *
 * The engine only ever applied `reveal` on **dealing damage**, so a unit hiding
 * in brush could take a hit, fire a catalyst, or land a pure debuff and keep its
 * concealment into the next turn. That is the half of the rule this adds.
 *
 * **Additive, and the tests below are as much about what did NOT change.** The
 * existing reveal-on-dealing-damage stays unconditional: narrowing it to
 * concealed units only would let a unit shoot from open ground on one turn and
 * disappear into brush on the next for free, which is the opposite of what a
 * reveal mechanic is for.
 */

const POOL = buildCatalystPool(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/catalysts.json'), 'utf8')) as CatalystData,
);

/** A thicket at x=4..6 on row 10; everything else open. */
const BRUSH_ROW = 10;
const MAP: MapDef = makeMap(
  Array.from({ length: 21 }, (_, y) =>
    (y === BRUSH_ROW ? '....bbb..............' : '.'.repeat(21))),
);
const OPEN = makeMap(Array.from({ length: 21 }, () => '.'.repeat(21)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 20 }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shot' }),
    // A pure debuff: harmful, lands no damage. The Bola-out-of-a-thicket case.
    ability({ id: 'hex', effects: [{ kind: 'slow', duration: 2 }] }),
    // Harmful and non-damaging, in the Dash phase.
    ability({ id: 'shove', phase: 'dash', shape: 'square', range: 3, effects: [{ kind: 'teleport' }, { kind: 'knockback', amount: 1 }] }),
    // Beneficial only — using it must never reveal, concealed or not.
    ability({ id: 'brace', phase: 'prep', shape: 'self', range: 0, effects: [{ kind: 'shield', amount: 20, duration: 2 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = [], map: MapDef = MAP) =>
  resolveTurn(s, map, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster, POOL);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const revealed = (s: GameState, id: string) => hasStatus(unit(s, id), 'reveal');

/** `a` on team 0 at `aPos`, `e` on team 1 at (10,10) — 6 apart on the brush row. */
const board = (aPos = { x: 5, y: BRUSH_ROW }, aStatuses: 'stealth' | 'none' = 'none'): GameState => {
  const mover = makeUnit('a', 0, aPos, { characterId: 'test-char' });
  return makeState([
    aStatuses === 'stealth' ? withStatuses(mover, status('stealth', 3)) : mover,
    makeUnit('e', 1, { x: 10, y: BRUSH_ROW }, { characterId: 'test-char' }),
  ]);
};
const IN_BRUSH = { x: 5, y: BRUSH_ROW };
const IN_OPEN = { x: 2, y: BRUSH_ROW };
const AIM = [{ x: 10, y: BRUSH_ROW }];

describe('CAMO-REVEAL: acting from a camouflage tile gives you away', () => {
  it('a brush-hidden unit that TAKES damage is revealed into next turn', () => {
    // The reported gap: taking a hit only ever broke Stealth, so a unit hidden
    // by *brush* (carrying no `stealth` status at all) kept its concealment.
    const { state } = run(board(), [], [{ unitId: 'e', ability: { abilityId: 'shot', target: [{ x: 0, y: BRUSH_ROW }] } }]);
    expect(revealed(state, 'a')).toBe(true);
    // Applied at 2, ticked once at end of turn — so it is still up next turn.
    expect(unit(state, 'a').statuses.find((s) => s.kind === 'reveal')!.remaining)
      .toBe(REVEAL_ON_ATTACK_TURNS - 1);
  });

  it('a brush-hidden unit that fires a CATALYST is revealed', () => {
    const { state } = run(board(), [{ unitId: 'a', catalyst: { abilityId: 'second_wind', target: [] } }]);
    expect(revealed(state, 'a')).toBe(true);
  });

  it('a brush-hidden unit that lands a pure DEBUFF is revealed', () => {
    // `hex` deals no damage, so the damage-dealt reveal never sees it.
    const { state } = run(board(), [{ unitId: 'a', ability: { abilityId: 'hex', target: AIM } }]);
    expect(revealed(state, 'a')).toBe(true);
    expect(unit(state, 'e').statuses.some((s) => s.kind === 'slow')).toBe(true); // it did fire
  });

  it('…and a non-damaging harmful DASH from brush reveals too', () => {
    const { state } = run(board(), [{ unitId: 'a', ability: { abilityId: 'shove', target: [{ x: 7, y: BRUSH_ROW }] } }]);
    expect(revealed(state, 'a')).toBe(true);
  });

  it('a STEALTHED unit in the open is revealed by the same triggers', () => {
    // The gate is "brush tile OR carrying stealth" — concealment, not terrain.
    const { state } = run(board(IN_OPEN, 'stealth'), [{ unitId: 'a', catalyst: { abilityId: 'second_wind', target: [] } }]);
    expect(revealed(state, 'a')).toBe(true);
    expect(hasStatus(unit(state, 'a'), 'stealth')).toBe(false); // and it broke
  });
});

describe('CAMO-REVEAL: acting in the open arms nothing new', () => {
  it('an open unit that TAKES damage gains no reveal', () => {
    const { state } = run(board(IN_OPEN), [], [{ unitId: 'e', ability: { abilityId: 'shot', target: [{ x: 0, y: BRUSH_ROW }] } }]);
    expect(unit(state, 'a').hp).toBeLessThan(100); // it was hit…
    expect(revealed(state, 'a')).toBe(false); // …and stayed unremarkable
  });

  it('an open unit that fires a CATALYST gains no reveal', () => {
    const { state } = run(board(IN_OPEN), [{ unitId: 'a', catalyst: { abilityId: 'second_wind', target: [] } }]);
    expect(unit(state, 'a').catalystsUsed).toEqual(['second_wind']); // it did fire
    expect(revealed(state, 'a')).toBe(false);
  });

  it('an open unit that lands a pure DEBUFF gains no reveal', () => {
    const { state } = run(board(IN_OPEN), [{ unitId: 'a', ability: { abilityId: 'hex', target: AIM } }]);
    expect(revealed(state, 'a')).toBe(false);
  });
});

describe('CAMO-REVEAL: what must NOT change', () => {
  it('an open unit that DEALS damage is still revealed — the regression guard', () => {
    // The one the spec was corrected over. Narrowing reveal-on-damage to
    // concealed units would let a unit shoot from open ground on one turn and
    // vanish into brush on the next with no penalty, gutting the mechanic.
    const { state } = run(board(IN_OPEN), [{ unitId: 'a', ability: { abilityId: 'shot', target: AIM } }]);
    expect(unit(state, 'e').hp).toBeLessThan(100);
    expect(revealed(state, 'a')).toBe(true);
  });

  it('a concealed unit that deals damage is revealed exactly once, not twice', () => {
    const { events } = run(board(), [{ unitId: 'a', ability: { abilityId: 'shot', target: AIM } }]);
    const mine = events.filter((e) => e.type === 'statusApplied' && e.status === 'reveal' && e.unitId === 'a');
    expect(mine).toHaveLength(1);
  });

  it('a stealthed unit that only MOVES is not revealed', () => {
    const { state } = run(board(IN_OPEN, 'stealth'), [{
      unitId: 'a', movePath: [{ x: 3, y: BRUSH_ROW }, { x: 4, y: BRUSH_ROW }, { x: 5, y: BRUSH_ROW }],
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 5, y: BRUSH_ROW }); // it walked into the brush
    expect(revealed(state, 'a')).toBe(false);
    expect(hasStatus(unit(state, 'a'), 'stealth')).toBe(true); // and stayed hidden
  });

  it('a BENEFICIAL ability cast from brush is not an offensive action', () => {
    const { state } = run(board(), [{ unitId: 'a', ability: { abilityId: 'brace', target: [IN_BRUSH] } }]);
    expect(unit(state, 'a').statuses.some((s) => s.kind === 'shield')).toBe(true); // it fired
    expect(revealed(state, 'a')).toBe(false);
  });

  it('a map with no brush at all behaves exactly as before', () => {
    const plain = run(board(IN_OPEN), [{ unitId: 'a', ability: { abilityId: 'hex', target: AIM } }], [], OPEN);
    expect(revealed(plain.state, 'a')).toBe(false);
  });
});

describe('CAMO-REVEAL: the gate is the tile, not the observer', () => {
  it('an ADJACENT enemy does not stop the reveal firing', () => {
    // `isConcealedFrom` is per-observer — brush hides you from a distant enemy
    // and not from an adjacent one — so gating on it would reveal a unit to some
    // enemies and not others off one action. The rule is the square you stand on.
    const s = board();
    unit(s, 'e').pos = { x: 6, y: BRUSH_ROW }; // shoulder to shoulder, inside the thicket
    const { state } = run(s, [{ unitId: 'a', catalyst: { abilityId: 'second_wind', target: [] } }]);
    expect(revealed(state, 'a')).toBe(true);
  });
});

describe('CAMO-REVEAL: N-unit safe and deterministic', () => {
  const threeInBrush = (): GameState => makeState([
    makeUnit('a1', 0, { x: 4, y: BRUSH_ROW }, { characterId: 'test-char' }),
    makeUnit('a2', 0, { x: 5, y: BRUSH_ROW }, { characterId: 'test-char' }),
    makeUnit('a3', 0, { x: 6, y: BRUSH_ROW }, { characterId: 'test-char' }),
    makeUnit('e', 1, { x: 12, y: BRUSH_ROW }, { characterId: 'test-char' }),
  ]);

  it('three concealed units acting in one turn are all revealed', () => {
    const { state } = run(threeInBrush(), [
      { unitId: 'a1', catalyst: { abilityId: 'second_wind', target: [] } },
      { unitId: 'a2', ability: { abilityId: 'hex', target: [{ x: 12, y: BRUSH_ROW }] } },
      { unitId: 'a3', catalyst: { abilityId: 'second_wind', target: [] } },
    ]);
    for (const id of ['a1', 'a2', 'a3']) expect(revealed(state, id), id).toBe(true);
  });

  it('the same orders resolve identically twice — no ordering wobble', () => {
    const orders: UnitOrders[] = [
      { unitId: 'a1', catalyst: { abilityId: 'second_wind', target: [] } },
      { unitId: 'a2', ability: { abilityId: 'hex', target: [{ x: 12, y: BRUSH_ROW }] } },
    ];
    const once = run(threeInBrush(), orders);
    const twice = run(threeInBrush(), orders);
    expect(JSON.stringify(once.state)).toEqual(JSON.stringify(twice.state));
    expect(JSON.stringify(once.events)).toEqual(JSON.stringify(twice.events));
  });
});
