import { describe, expect, it } from 'vitest';
import { buildCatalystPool, type CatalystData } from '../src/catalysts.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, UnitOrders } from '../src/types.js';

/**
 * BLINK-CLASH — two blinks aimed at one square land nobody there.
 *
 * Owner Dev Note: *"if two characters try to end their movement or dash/blink on
 * the exact same square, a collision occurs … Right now in CARDS, blinks do not
 * work like that. If Veil and Aegis try to blink to the same spot, only one of
 * them makes it to the square, the other one does not move at all."*
 *
 * The report was exact, and the asymmetry was an accident of iteration order: a
 * teleport refuses an occupied square, so whichever blink resolved first landed
 * and the second found a body in the way. Two identical orders, two different
 * outcomes, decided by nothing a player can see.
 *
 * Claims are counted before anything moves and the contested square is refused
 * to everyone who aimed at it. **BLINK-ADJ then answered the question this file
 * left open** (owner, 2026-09-10: *"Blocked blink should land adjacent instead
 * of not at all"*): refused is not the same as stranded, so each blinker takes
 * the **nearest legal square** to the destination instead of staying home. That
 * is AR's "the square immediately before the destination", made precise for a
 * movement with no path to walk back along.
 *
 * Both halves matter and this file owns both: the square is denied to everybody
 * (no coin flip), and everybody still moves (no stranding). Because teleports
 * resolve in a fixed order, the first blinker takes the nearest square and is
 * standing there when the second scans — so they land on distinct squares
 * without needing a tiebreak of their own.
 */

const OPEN: MapDef = makeMap(Array.from({ length: 11 }, () => '.'.repeat(11)));
const X = { x: 5, y: 5 };

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    // The two the owner names: a square-shaped dash carrying `teleport`.
    ability({ id: 'blink', phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] }),
    // A walked charge, for the contrast — it has a path, so it is not a blink.
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 4, effects: [{ kind: 'damage', amount: 5 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };
const CATALYSTS = buildCatalystPool({
  prep: [], blast: [],
  dash: [{
    id: 'shift', name: 'Shift', phase: 'dash', shape: 'square', range: 3,
    cooldown: 0, energyGain: 0, free: true, oncePerMatch: true,
    effects: [{ kind: 'teleport' }], description: 'Blink up to 3 squares.',
  }],
} as unknown as CatalystData);

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = []) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster, CATALYSTS);
const at = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!.pos;
/** `a` west of the contested square, `e` east of it — both a blink away. */
const pair = (): GameState => makeState([
  makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char', catalysts: ['shift'] }),
  makeUnit('e', 1, { x: 7, y: X.y }, { characterId: 'test-char', catalysts: ['shift'] }),
]);
const blink = (unitId: string, to = X): UnitOrders =>
  ({ unitId, ability: { abilityId: 'blink', target: [to] } });

describe('BLINK-CLASH: two blinks to one square — neither takes it, both land', () => {
  it('both move, and neither is on the square they fought over', () => {
    // Flipped by BLINK-ADJ. The contested square is still denied to both — that
    // is the coin flip staying dead — but "denied" now means "take the nearest
    // one" rather than "stay home".
    const { state } = run(pair(), [blink('a')], [blink('e')]);
    for (const id of ['a', 'e']) {
      expect(at(state, id), `${id} is not on the contested square`).not.toEqual(X);
    }
    expect(at(state, 'a'), 'and it did move').not.toEqual({ x: 3, y: X.y });
    expect(at(state, 'e')).not.toEqual({ x: 7, y: X.y });
    expect(at(state, 'a'), 'on distinct squares').not.toEqual(at(state, 'e'));
  });

  it('each lands adjacent to the destination — nearest, not anywhere', () => {
    const { state } = run(pair(), [blink('a')], [blink('e')]);
    for (const id of ['a', 'e']) {
      const p = at(state, id);
      expect(Math.abs(p.x - X.x) + Math.abs(p.y - X.y), `${id} is one square off`).toBe(1);
    }
  });

  it('and the outcome does not depend on which one is ordered first', () => {
    // The actual defect, isolated: the old rule handed the square to whichever
    // blink resolved first, so the *order the two were listed in* decided who
    // moved. Two teammates, so the listing order is genuinely mine to swap.
    const mates = (): GameState => makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('b', 0, { x: 7, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 0, y: 0 }, { characterId: 'test-char' }),
    ]);
    const forward = run(mates(), [blink('a'), blink('b')]);
    const reversed = run(mates(), [blink('b'), blink('a')]);
    expect(at(forward.state, 'a')).toEqual(at(reversed.state, 'a'));
    expect(at(forward.state, 'b')).toEqual(at(reversed.state, 'b'));
    // …and in both, nobody is standing on the square they fought over.
    for (const s of [forward.state, reversed.state]) {
      expect(s.units.filter((u) => u.pos.x === X.x && u.pos.y === X.y)).toHaveLength(0);
    }
  });

  it('an uncontested blink still lands exactly — the rule costs nothing on its own', () => {
    // The guard that stops this becoming "blinks never go where you aim". One
    // claim, one arrival, on the square itself.
    const { state } = run(pair(), [blink('a')]);
    expect(at(state, 'a')).toEqual(X);
  });

  it('two blinks at DIFFERENT squares both land', () => {
    const { state } = run(
      pair(),
      [blink('a', { x: 4, y: X.y })],
      [blink('e', { x: 6, y: X.y })],
    );
    expect(at(state, 'a')).toEqual({ x: 4, y: X.y });
    expect(at(state, 'e')).toEqual({ x: 6, y: X.y });
  });

  it('a Shift catalyst is a blink too, and contests with an ability', () => {
    // Both kinds resolve in the same phase onto the same board, so a rule that
    // saw only one of them would just move the coin flip somewhere else.
    const { state } = run(
      pair(),
      [{ unitId: 'a', catalyst: { abilityId: 'shift', target: [X] } }],
      [blink('e')],
    );
    expect(at(state, 'a'), 'the Shift is refused the contested square').not.toEqual(X);
    expect(at(state, 'e')).not.toEqual(X);
    expect(at(state, 'a'), 'and both still moved').not.toEqual({ x: 3, y: X.y });
    expect(at(state, 'e')).not.toEqual({ x: 7, y: X.y });
  });

  it('two Shifts contest each other as well', () => {
    const { state } = run(
      pair(),
      [{ unitId: 'a', catalyst: { abilityId: 'shift', target: [X] } }],
      [{ unitId: 'e', catalyst: { abilityId: 'shift', target: [X] } }],
    );
    expect(at(state, 'a')).not.toEqual(X);
    expect(at(state, 'e')).not.toEqual(X);
    expect(at(state, 'a')).not.toEqual(at(state, 'e'));
  });
});

describe('BLINK-ADJ: every unavailable destination resolves the same way', () => {
  it('a blink into a WALL lands on the nearest open square', () => {
    // The third of the three cases the ruling names. Terrain is refused like a
    // body is, and the answer is the same: the closest square that is not.
    const WALLED: MapDef = makeMap(Array.from({ length: 11 }, (_, y) =>
      (y === X.y ? `${'.'.repeat(X.x)}#${'.'.repeat(10 - X.x)}` : '.'.repeat(11))));
    const s = makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 9, y: 9 }, { characterId: 'test-char' }),
    ]);
    const { state } = resolveTurn(s, WALLED, [
      { team: 0, units: [blink('a')] }, { team: 1, units: [] },
    ], roster, CATALYSTS);
    const p = state.units.find((u) => u.unitId === 'a')!.pos;
    expect(p, 'not inside the wall').not.toEqual(X);
    expect(Math.abs(p.x - X.x) + Math.abs(p.y - X.y), 'the closest square outside it').toBe(1);
  });

  it('the landing is deterministic — the same board gives the same square', () => {
    // The tie-break is the scan order (rings by Manhattan distance, row-major
    // within a ring), so there is nothing machine-dependent in it.
    const runs = [0, 1, 2].map(() => run(pair(), [blink('a')], [blink('e')]));
    for (const r of runs.slice(1)) {
      expect(at(r.state, 'a')).toEqual(at(runs[0]!.state, 'a'));
      expect(at(r.state, 'e')).toEqual(at(runs[0]!.state, 'e'));
    }
  });
});

describe('BLINK-CLASH: what it deliberately leaves alone', () => {
  it('a walked charge is not a blink — it keeps CLASH-AR/MV1 semantics', () => {
    // A `path` dash has squares to be stopped on, so it is the movement rules'
    // business and not this one's. Pinned so the two are not conflated later.
    const s = makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, { x: 7, y: X.y }, { characterId: 'test-char' }),
    ]);
    const { state } = run(s, [{
      unitId: 'a', ability: { abilityId: 'charge', target: [{ x: 4, y: X.y }, X] },
    }]);
    expect(at(state, 'a'), 'the charge walked its path as before').toEqual(X);
  });

  it('a blink onto a stationary body lands beside it, by the same rule', () => {
    // Occupancy is a different rule and predates this one, but BLINK-ADJ gives
    // all three unavailable-destination cases the same answer — the owner asked
    // for exactly this one by name.
    const s = makeState([
      makeUnit('a', 0, { x: 3, y: X.y }, { characterId: 'test-char' }),
      makeUnit('e', 1, X, { characterId: 'test-char' }),
    ]);
    const { state } = run(s, [blink('a')]);
    expect(Math.abs(at(state, 'a').x - X.x) + Math.abs(at(state, 'a').y - X.y)).toBe(1);
    expect(at(state, 'e'), 'the occupant is undisturbed').toEqual(X);
  });
});
