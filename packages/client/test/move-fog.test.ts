import { describe, expect, it } from 'vitest';
import {
  VISION_RANGE, buildBoard, createMatch, movementBudget, reachableSquares,
  type CharacterDef, type GameState, type MapDef,
} from '@cards/engine';
import { fogView, planningState } from '../src/fog.js';
import { movePreview, pathTo } from '../src/targeting.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * MOVE-FOG — a plan may be optimistic; a plan may not be a scout.
 *
 * Owner Dev Note: *"Move command is blocked if an enemy is out of line of sight
 * but on the tile that you are trying to move. This is giving unintentional
 * information."*
 *
 * It was. The move preview ran `reachableSquares` against the true unit list, so
 * an invisible enemy blocked a square and the drawn route bent around a body the
 * player was never shown. Sweeping a move target along a corridor located a
 * hidden unit exactly — the cheapest scouting tool in the game, and free.
 *
 * The fix is structural rather than a special case: plan against a state whose
 * unseen units are **absent**. There is no "should I hide this" branch that
 * could be written the wrong way round, which is the same reason M3-HIDDEN
 * filters the server's payload instead of blanking it.
 *
 * Resolution is deliberately untouched. The engine walks the true board, stops
 * the mover on contact, and that contact is the reveal — the correct outcome.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;

/** A long open corridor: one row, wide enough to put a unit well out of sight. */
const CORRIDOR: MapDef = {
  id: 't', name: 't', width: 25, height: 3, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 1 }], [{ x: 23, y: 1 }]],
};

const match = (): GameState => createMatch(CORRIDOR, '1v1', [[VEX], [BASTION]]);
const at = (s: GameState, unitId: string, x: number, y: number): void => {
  s.units.find((u) => u.unitId === unitId)!.pos = { x, y };
};
const ids = (s: GameState) => ({
  mine: s.units.find((u) => u.owner === 0)!.unitId,
  theirs: s.units.find((u) => u.owner === 1)!.unitId,
});

/** `mine` at x=2; the enemy parked `gap` squares east of it on the same row. */
const corridor = (gap: number) => {
  const s = match();
  const { mine, theirs } = ids(s);
  at(s, mine, 2, 1);
  at(s, theirs, 2 + gap, 1);
  const unit = s.units.find((u) => u.unitId === mine)!;
  const visible = fogView(CORRIDOR, s, 0, new Map()).units;
  return { s, unit, visible, enemyX: 2 + gap };
};

describe('MOVE-FOG: an unseen enemy does not block the plan', () => {
  it('the premise: an enemy past vision range really is hidden', () => {
    const { visible } = corridor(VISION_RANGE + 2);
    expect(visible.map((u) => u.owner)).toEqual([0]);
  });

  it('a route toward a hidden enemy\'s tile is drawn as if the tile were free', () => {
    // The owner's exact case. Planning against the truth stopped the path short
    // of the body; planning against what the seat can see does not.
    const { s, unit, visible, enemyX } = corridor(VISION_RANGE + 2);
    const budget = movementBudget(unit, true);
    const target = { x: enemyX, y: 1 };

    const honest = pathTo(CORRIDOR, planningState(s, visible), unit, target, budget);
    expect(honest.at(-1), 'the plan reaches the tile the enemy is standing on').toEqual(target);
  });

  it('and the truthful board is what used to leak', () => {
    // The counterfactual, kept so the test says what it is preventing: given the
    // real unit list, the same query refuses the tile — which is the tell.
    const { s, unit, enemyX } = corridor(VISION_RANGE + 2);
    const leaky = pathTo(CORRIDOR, s, unit, { x: enemyX, y: 1 }, movementBudget(unit, true));
    expect(leaky.at(-1), 'the true board stops short of the hidden body').not.toEqual({ x: enemyX, y: 1 });
  });

  it('the move envelope does not have a hole punched in it either', () => {
    // The other half of the tell: a square missing from the reach wash is as
    // loud as a bent route. `stops` is what matters — an occupied square stays
    // *reachable* as a pass-through, so the giveaway is specifically that it
    // stops being a legal destination.
    const { s, unit, visible, enemyX } = corridor(VISION_RANGE + 2);
    const { stops } = movePreview(CORRIDOR, planningState(s, visible), unit, true);
    expect(stops.some((p) => p.x === enemyX && p.y === 1), 'the hidden tile is offered').toBe(true);
  });
});

describe('MOVE-FOG: a VISIBLE enemy still blocks, as it should', () => {
  it('a route toward a seen enemy stops short of it', () => {
    // Collisions are a real rule and the player can see this one — hiding the
    // block here would be a different bug, not a fix.
    const { s, unit, visible, enemyX } = corridor(3);
    expect(visible.map((u) => u.owner).sort(), 'the premise: it is in sight').toEqual([0, 1]);
    const route = pathTo(CORRIDOR, planningState(s, visible), unit, { x: enemyX, y: 1 }, movementBudget(unit, true));
    expect(route.at(-1)).not.toEqual({ x: enemyX, y: 1 });
  });

  it('and its square is not offered as a destination', () => {
    const { s, unit, visible, enemyX } = corridor(3);
    const { stops } = movePreview(CORRIDOR, planningState(s, visible), unit, true);
    expect(stops.some((p) => p.x === enemyX && p.y === 1)).toBe(false);
  });

  it('an ALLY is never a legal destination — your own team is never fogged', () => {
    const TWO: MapDef = { ...CORRIDOR, spawns: [
      [{ x: 1, y: 1 }, { x: 1, y: 0 }], [{ x: 23, y: 1 }, { x: 23, y: 0 }],
    ] };
    const s = createMatch(TWO, '2v2', [[VEX, BASTION], [BASTION, VEX]]);
    const mine = s.units.filter((u) => u.owner === 0);
    at(s, mine[0]!.unitId, 2, 1);
    at(s, mine[1]!.unitId, 5, 1);
    for (const u of s.units.filter((x) => x.owner === 1)) u.pos = { x: 23, y: 1 };

    const visible = fogView(CORRIDOR, s, 0, new Map()).units;
    const unit = s.units.find((u) => u.unitId === mine[0]!.unitId)!;
    const { stops } = movePreview(CORRIDOR, planningState(s, visible), unit, true);
    expect(stops.some((p) => p.x === 5 && p.y === 1), 'the teammate\'s square is not offered').toBe(false);
  });
});

describe('MOVE-FOG: planningState is a filter, not a rewrite', () => {
  it('keeps everything else about the state intact', () => {
    const { s, visible } = corridor(3);
    const planned = planningState(s, visible);
    expect(planned.turn).toBe(s.turn);
    expect(planned.powerups).toEqual(s.powerups);
    expect(planned.kills).toEqual(s.kills);
    expect(planned.format).toBe(s.format);
  });

  it('does not mutate the state it filters', () => {
    // The real state is the authority for resolution; a planning helper that
    // edited it would be a very quiet disaster.
    const { s, visible } = corridor(VISION_RANGE + 2);
    const before = s.units.length;
    planningState(s, visible);
    expect(s.units).toHaveLength(before);
  });

  it('and the engine is unchanged — the true board still stops the mover', () => {
    // The reveal-at-contact is correct behaviour, so the engine's own query
    // must keep seeing the hidden unit.
    const { s, unit, enemyX } = corridor(VISION_RANGE + 2);
    const board = buildBoard(CORRIDOR);
    const truth = reachableSquares(board, s, unit, movementBudget(unit, true));
    const tile = truth.find((r) => r.pos.x === enemyX && r.pos.y === 1);
    expect(tile?.canStop ?? false, 'the engine still refuses the occupied square').toBe(false);
  });
});
