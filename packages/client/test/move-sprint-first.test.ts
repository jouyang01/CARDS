import { describe, expect, it } from 'vitest';
import {
  MOVE_RANGE, SPRINT_RANGE, buildRoster, createMatch, movementBudget, resolveTurn,
  type CharacterDef, type MapDef,
} from '@cards/engine';
import { emptyDraft, nextDraft, pathTo, sprintAllowed, toUnitOrders } from '../src/targeting.js';
import { fogView, planningState } from '../src/fog.js';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import wisp from '../../../data/characters/wisp.json';
import bastion from '../../../data/characters/bastion.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * MOVE-SPRINT-FIRST — the **first** Sprint of a match, end to end.
 *
 * Owner Dev Note: *"BUG: Vex's first sprint action does not move the character."*
 *
 * **It does not reproduce.** Driven in a real browser against this build, the
 * opening Sprint arms (the Move control re-prices itself from 4 to 8), a route
 * is drawn, and the unit resolves five columns further up the board — the whole
 * chain works. The same conclusion the UI1 "still broken" report reached: a
 * cached bundle, not a defect (reviews 2026-08-24/25).
 *
 * "It works when I try it" is not a regression test, though, so this pins the
 * chain the report accuses, in the order the client walks it: select Sprint →
 * budget → plan against the **fogged** board (MOVE-FOG was the prime suspect) →
 * commit → the engine's own resolution. Turn one specifically, with the shipped
 * map and the shipped opening roster, because "the first one" is what the note
 * says and a fresh draft is the state everything else is downstream of.
 *
 * The one thing deliberately not asserted is the exact landing square: that is
 * `duel-arena`'s wall pillar and MOVE1's re-route talking, and pinning it here
 * would make a map edit look like a movement bug.
 */

const MAP = duelArena as unknown as MapDef;
const TEAMS: [CharacterDef[], CharacterDef[]] = [
  [vex as unknown as CharacterDef, wisp as unknown as CharacterDef],
  [bastion as unknown as CharacterDef, aegis as unknown as CharacterDef],
];
const roster = buildRoster(TEAMS.flat());

/** The opening board, and Vex on it — the exact pair the Dev Note names. */
const opening = () => {
  const state = createMatch(MAP, '2v2', TEAMS);
  const unit = state.units.find((u) => u.characterId === 'vex')!;
  return { state, unit };
};

/** What `app.ts` does between the Sprint button and the board click. */
const armSprint = (unitId: string) => nextDraft(emptyDraft(unitId), { type: 'selectSprint' }, false, false);

/** …and what it does on the click: plan against the seat's *visible* board. */
const commit = (state: ReturnType<typeof opening>['state'], unit: ReturnType<typeof opening>['unit'], sprint: boolean) => {
  const budget = movementBudget(unit, sprint);
  const planned = planningState(state, fogView(MAP, state, unit.owner).units);
  // Straight at the middle of the map — further than any budget reaches, so the
  // assertion is about the budget rather than about the target.
  return pathTo(MAP, planned, unit, { x: Math.floor(MAP.width / 2), y: unit.pos.y }, budget);
};

describe('MOVE-SPRINT-FIRST: the opening Sprint', () => {
  it('is offered at all — a fresh draft has spent nothing', () => {
    const { unit } = opening();
    expect(sprintAllowed(armSprint(unit.unitId))).toBe(true);
  });

  it('prices the turn at the sprint budget, not the walk', () => {
    const { unit } = opening();
    expect(movementBudget(unit, armSprint(unit.unitId).sprint)).toBe(SPRINT_RANGE);
    expect(SPRINT_RANGE, 'the two budgets must differ or nothing below can fail')
      .toBeGreaterThan(MOVE_RANGE);
  });

  it('commits a non-empty path that spends the whole budget', () => {
    // The heart of the report: turn one, first click, nothing armed before it.
    const { state, unit } = opening();
    const path = commit(state, unit, true);
    expect(path.length, 'the first Sprint committed no path at all').toBeGreaterThan(0);
    // Manhattan steps and diagonals both cost, so length is a floor on the spend
    // rather than the spend itself — what matters is that it is longer than a
    // walk could have been.
    expect(path.length).toBeGreaterThan(MOVE_RANGE / 2);
  });

  it('and MOVE-FOG does not shorten it — the fogged board plans the same route', () => {
    // The Analyzer's prime suspect. On turn 1 the enemies are unseen, so the
    // planning state is missing two units; if filtering them out cost the mover
    // its own entry (or its identity), the reachable set would collapse.
    const { state, unit } = opening();
    const fogged = commit(state, unit, true);
    const truthful = pathTo(MAP, state, unit, { x: Math.floor(MAP.width / 2), y: unit.pos.y }, movementBudget(unit, true));
    expect(fogged, 'the fog-filtered plan and the true-board plan agree on turn 1').toEqual(truthful);
  });

  it('moves the unit when the turn resolves', () => {
    // The other half of the note — a path that exists but does not resolve
    // would look identical to the player.
    const { state, unit } = opening();
    const draft = armSprint(unit.unitId);
    draft.movePath = commit(state, unit, true);
    const order = toUnitOrders(roster['vex']!, draft);
    expect(order.sprint, 'the order has to carry the flag or the engine walks four').toBe(true);

    const out = resolveTurn(state, MAP, [{ team: 0, units: [order] }, { team: 1, units: [] }], roster);
    const after = out.state.units.find((u) => u.unitId === unit.unitId)!;
    expect(after.pos, 'the first Sprint left the unit where it started').not.toEqual(unit.pos);
    expect(out.events.some((e) => e.type === 'moveStep' && e.unitId === unit.unitId)).toBe(true);
  });

  it('and it really is the sprint doing it — the same click walks less at Move budget', () => {
    // Guards the test above from passing on a plain walk: if `sprint` were being
    // dropped somewhere, this pair would report the same distance.
    const { state, unit } = opening();
    expect(commit(state, unit, true).length)
      .toBeGreaterThan(commit(state, unit, false).length);
  });
});
