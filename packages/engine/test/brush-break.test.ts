import { describe, expect, it } from 'vitest';
import { BRUSH_BREAK_TURNS } from '../src/constants.js';
import { buildBoard } from '../src/board.js';
import { buildVision, canSee } from '../src/vision.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { hasStatus } from '../src/status.js';
import { makeMap, makeState, makeUnit, status, withStatuses } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, UnitOrders, Vec2 } from '../src/types.js';

/**
 * BRUSH-BREAK — being hit in brush suppresses the brush, not everything
 * (Dev Note #19).
 *
 * CAMO-REVEAL closed a real gap: a unit hiding in a thicket could take a hit
 * and keep its concealment, which made brush a free respawn of the ambush. It
 * closed it with `reveal`, and Reveal is far too big a hammer — it pierces
 * everything, everywhere, so one clip in a bush lit a unit up across the whole
 * board for two turns, on open ground it later ran to, through Stealth it later
 * cast. What being seen in a bush should cost you is the bush.
 *
 * So a damaged brush-concealed unit gets `brushBroken` for two turns instead:
 *
 *   • **unit-scoped, not patch-scoped** — the marker rides the unit, so running
 *     to a *fresh* thicket next turn does not help either;
 *   • **Reveal is unchanged** — still pierces everything, still applied by
 *     everything that applied it before;
 *   • **Stealth is unchanged** — still broken outright by damage, and a unit
 *     carrying `brushBroken` that is Stealthed *now* is hidden by the Stealth.
 *     Brush-break removes one veil, not both.
 */

const BRUSH_ROW = 10;
/** Two separate thickets on row 10: x=4..6 and x=14..16. */
const MAP: MapDef = makeMap(
  Array.from({ length: 21 }, (_, y) =>
    (y === BRUSH_ROW ? '....bbb.......bbb....' : '.'.repeat(21))),
);

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 20 }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shot' }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, u0: UnitOrders[] = [], u1: UnitOrders[] = []) =>
  resolveTurn(s, MAP, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

/** `a` on team 0 in the near thicket; `e` on team 1 four squares east of it. */
const board = (aAt: Vec2 = { x: 5, y: BRUSH_ROW }, stealthed = false): GameState => {
  const hider = makeUnit('a', 0, aAt, { characterId: 'test-char' });
  return makeState([
    stealthed ? withStatuses(hider, status('stealth', 3)) : hider,
    makeUnit('e', 1, { x: 10, y: BRUSH_ROW }, { characterId: 'test-char' }),
  ]);
};

/** Can team 1's unit see team 0's, on this board? */
const enemySees = (s: GameState): boolean => {
  const vision = buildVision(buildBoard(MAP));
  return canSee(vision, unit(s, 'e'), unit(s, 'a'));
};

/** `e` shoots down the brush row at `a`. */
const SHOOT: UnitOrders[] = [{ unitId: 'e', ability: { abilityId: 'shot', target: [{ x: 0, y: BRUSH_ROW }] } }];

describe('BRUSH-BREAK: the bush stops working, and nothing else does', () => {
  it('a brush-hidden unit that takes damage gains brushBroken and NO reveal', () => {
    const before = board();
    expect(enemySees(before), 'hidden to start with').toBe(false);
    const { state } = run(before, [], SHOOT);
    expect(hasStatus(unit(state, 'a'), 'brushBroken')).toBe(true);
    expect(hasStatus(unit(state, 'a'), 'reveal'), 'not lit up across the board').toBe(false);
  });

  it('and the enemy can see it, standing in the same thicket it was hiding in', () => {
    // The point of the marker, rather than the marker itself.
    const { state } = run(board(), [], SHOOT);
    expect(enemySees(state)).toBe(true);
  });

  it('this turn and the next, then the thicket works again', () => {
    // Applied at 2 and ticked at end of turn, so it survives one more turn —
    // the same arithmetic Reveal is measured by.
    const hit = run(board(), [], SHOOT).state;
    expect(unit(hit, 'a').statuses.find((s) => s.kind === 'brushBroken')!.remaining)
      .toBe(BRUSH_BREAK_TURNS - 1);
    expect(enemySees(hit), 'still visible the turn after').toBe(true);

    const later = run(hit).state;
    expect(hasStatus(unit(later, 'a'), 'brushBroken'), 'expired').toBe(false);
    expect(enemySees(later), 'and the bush hides it again').toBe(false);
  });

  it('running to a DIFFERENT thicket does not help — the marker rides the unit', () => {
    // Unit-scoped, not patch-scoped. The tempting implementation is to mark the
    // patch, and it is wrong: brush-break is about the unit having been seen.
    const hit = run(board(), [], SHOOT).state;
    unit(hit, 'a').pos = { x: 15, y: BRUSH_ROW }; // the far thicket, untouched
    expect(enemySees(hit)).toBe(true);
  });

  it('a unit hit in the OPEN gets no marker — there was no bush to break', () => {
    const { state } = run(board({ x: 2, y: BRUSH_ROW }), [], SHOOT);
    expect(hasStatus(unit(state, 'a'), 'brushBroken')).toBe(false);
  });
});

describe('BRUSH-BREAK: the other two veils are untouched', () => {
  it('Stealth still breaks outright, and still costs a Reveal', () => {
    // Stealth is the stronger veil and it is paid for; losing it is meant to
    // hurt. Nothing about this case moved.
    const { state } = run(board({ x: 5, y: BRUSH_ROW }, true), [], SHOOT);
    const a = unit(state, 'a');
    expect(hasStatus(a, 'stealth'), 'broken').toBe(false);
    expect(hasStatus(a, 'reveal'), 'and revealed, as before').toBe(true);
  });

  it('a brushBroken unit that goes Stealthed is hidden again', () => {
    // The composition case the AC names: brush-break removes one veil, not
    // both, so the Stealth check upstream of it still wins.
    const hit = run(board(), [], SHOOT).state;
    expect(hasStatus(unit(hit, 'a'), 'brushBroken')).toBe(true);
    expect(enemySees(hit), 'visible while the marker is all it has').toBe(true);

    // The Stealth goes on beside the still-live marker rather than through a
    // second turn, because the marker would expire in the meantime and the test
    // would prove nothing about the two coexisting.
    unit(hit, 'a').statuses.push({ kind: 'stealth', remaining: 3 });
    expect(hasStatus(unit(hit, 'a'), 'brushBroken'), 'the marker is still on it').toBe(true);
    expect(enemySees(hit), 'and it is hidden anyway').toBe(false);
  });

  it('Reveal still pierces the brush it always pierced', () => {
    const s = board();
    unit(s, 'a').statuses.push({ kind: 'reveal', remaining: 2 });
    expect(enemySees(s)).toBe(true);
  });

  it('and Reveal beats a Stealth that beats a brushBroken', () => {
    // The whole ladder in one assertion, so the ordering inside
    // `isConcealedFrom` cannot be rearranged by accident.
    const s = board({ x: 5, y: BRUSH_ROW }, true);
    unit(s, 'a').statuses.push({ kind: 'brushBroken', remaining: 2 });
    expect(enemySees(s), 'stealth over brush-break').toBe(false);
    unit(s, 'a').statuses.push({ kind: 'reveal', remaining: 2 });
    expect(enemySees(s), 'reveal over stealth').toBe(true);
  });
});
