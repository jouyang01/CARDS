import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { buildBoard } from '../src/board.js';
import { reachableSquares, validateMovePath } from '../src/movement.js';
import { buildVision, canSee } from '../src/vision.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, TeamId, UnitOrders } from '../src/types.js';

/**
 * BRUSH1 — "You should be able to dash into bushes."
 *
 * Brush conceals but does not block: it is walkable, chargeable and a legal
 * teleport destination, and arriving in one hides you from enemies outside the
 * patch. These lock that end to end, so a future terrain change can't quietly
 * turn brush into cover.
 */

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'dash', shape: 'square', range: 6, cooldown: 0, energyGain: 0,
  effects: [], description: over.id, ...over,
});
const char: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'trickster', maxHp: 100,
  abilities: [
    ability({ id: 'blink', shape: 'square', range: 6, effects: [{ kind: 'teleport' }] }),
    ability({ id: 'roll', shape: 'path', range: 4, effects: [{ kind: 'teleport' }] }),
    ability({ id: 'noop', phase: 'prep', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
    ability({ id: 'shoot', phase: 'blast', shape: 'line', range: 6, effects: [{ kind: 'damage', amount: 10 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': char };

//  0123456
// 0.......
// 1.bbb...   brush patch on row 1, x = 1..3
// 2.......
const BRUSHY = () => makeMap(['.......', '.bbb...', '.......', '.......', '.......', '.......', '.......']);
const run = (s: GameState, u0: UnitOrders[]) =>
  resolveTurn(s, BRUSHY(), [{ team: 0 as TeamId, units: u0 }, { team: 1 as TeamId, units: [] }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

describe('BRUSH1: brush is a legal destination for every kind of movement', () => {
  it('a walked move may end in brush', () => {
    const u = makeUnit('u', 0, { x: 0, y: 1 });
    const board = buildBoard(BRUSHY());
    const state = makeState([u, makeUnit('e', 1, { x: 6, y: 6 })]);
    expect(validateMovePath(board, state, u, [{ x: 1, y: 1 }, { x: 2, y: 1 }])).toEqual({ valid: true, cost: 2 });

    const { state: after } = run(state, [{ unitId: 'u', movePath: [{ x: 1, y: 1 }, { x: 2, y: 1 }] }]);
    expect(unit(after, 'u').pos).toEqual({ x: 2, y: 1 });
  });

  it('brush squares are offered as reachable STOPS, not merely walk-through', () => {
    const u = makeUnit('u', 0, { x: 0, y: 1 });
    const out = reachableSquares(buildBoard(BRUSHY()), makeState([u]), u, 4);
    for (const x of [1, 2, 3]) {
      const tile = out.find((s) => s.pos.x === x && s.pos.y === 1);
      expect(tile, `brush tile ${x},1 not reachable`).toBeDefined();
      expect(tile!.canStop, `brush tile ${x},1 is not a legal stop`).toBe(true);
    }
  });

  it('a walked charge may end in brush', () => {
    const u = makeUnit('u', 0, { x: 0, y: 1 });
    const { state } = run(makeState([u, makeUnit('e', 1, { x: 6, y: 6 })]), [
      { unitId: 'u', ability: { abilityId: 'roll', target: [{ x: 1, y: 1 }, { x: 2, y: 1 }] } },
    ]);
    expect(unit(state, 'u').pos).toEqual({ x: 2, y: 1 }); // dashed into the bush
  });

  it('a teleport may land in brush', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const { state } = run(makeState([u, makeUnit('e', 1, { x: 6, y: 6 })]), [
      { unitId: 'u', ability: { abilityId: 'blink', target: [{ x: 2, y: 1 }] } },
    ]);
    expect(unit(state, 'u').pos).toEqual({ x: 2, y: 1 });
  });

  it('arriving in brush actually conceals you from an enemy outside the patch', () => {
    const u = makeUnit('u', 0, { x: 0, y: 1 });
    const watcher = makeUnit('e', 1, { x: 5, y: 1 });
    const before = buildVision(buildBoard(BRUSHY()));
    expect(canSee(before, watcher, u)).toBe(true); // visible in the open

    const { state } = run(makeState([u, watcher]), [
      { unitId: 'u', ability: { abilityId: 'blink', target: [{ x: 2, y: 1 }] } },
    ]);
    const hidden = unit(state, 'u');
    expect(hidden.pos).toEqual({ x: 2, y: 1 });
    expect(canSee(before, unit(state, 'e'), hidden)).toBe(false); // the bush did its job
  });
});
