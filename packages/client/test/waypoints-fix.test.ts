import { describe, expect, it } from 'vitest';
import {
  MOVE_RANGE,
  SPRINT_RANGE,
  buildBoard,
  createMatch,
  resolveTurn,
  validateMovePath,
  type CharacterDef,
  type GameState,
  type MapDef,
  type Roster,
  type UnitState,
  type Vec2,
} from '@cards/engine';
import { appendWaypointRouted, emptyDraft, liveWaypointMarks, nextDraft, remainingMove, toUnitOrders } from '../src/targeting.js';
import { IDLE, arm, hoverBoard, impactLayer, previewMovePath, waypointClick, type Interaction } from '../src/order-mode.js';
import { planningState } from '../src/fog.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * WAYPOINTS-FIX — the gesture the owner actually tried.
 *
 * Owner Dev Note: *"WAYPOINTS is not working. I cannot hold shift + click to
 * move to a waypoint."*
 *
 * WAYPOINTS shipped with thirteen passing unit tests and did nothing, which is
 * the interesting part. Both halves of the failure were **outside** the function
 * those tests covered:
 *
 * 1. `appendWaypoint` took **one adjacent step per click** and answered a bare
 *    `undefined` to anything else — so a click three tiles away was refused, and
 *    refused silently.
 * 2. The Shift branch lived *inside* the "move is already armed" arm of the
 *    click handler, so a player who had merely selected a unit never reached it
 *    at all.
 *
 * The second is why this file leads with `waypointClick`: the gate is now a
 * named rule rather than a nesting level, and the case that was broken — no mode
 * armed — is a test rather than an assumption. The routing half follows.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 7 }, { x: 2, y: 9 }], [{ x: 12, y: 7 }, { x: 12, y: 9 }]],
};
/** A wall stub to route around — the "obstacle" of the original Dev Note. */
const WALLED: MapDef = { ...OPEN, walls: [{ x: 7, y: 6 }, { x: 7, y: 7 }, { x: 7, y: 8 }] };

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const roster: Roster = { vex: VEX, bastion: BASTION };

const board = (map: MapDef = OPEN): { state: GameState; unit: UnitState } => {
  const state = createMatch(map, '2v2', [[VEX, VEX], [BASTION, BASTION]]);
  const unit = state.units[0]!;
  unit.pos = { x: 5, y: 7 };
  state.units[1]!.pos = { x: 1, y: 1 };
  state.units[2]!.pos = { x: 13, y: 13 };
  state.units[3]!.pos = { x: 13, y: 1 };
  return { state, unit };
};
const key = (p: Vec2) => `${p.x},${p.y}`;

describe('WAYPOINTS-FIX: the gate that was the bug', () => {
  const draft = emptyDraft('u');

  it('a Shift-click with NOTHING armed starts a move — the reported gesture', () => {
    // The whole report in one assertion. Selecting a unit leaves `interaction`
    // idle, and the shipped handler only looked at Shift *inside* the armed-move
    // branch, so this click reached no code at all.
    expect(waypointClick(IDLE, draft, true, true)).toBe('armAndAppend');
  });

  it('a Shift-click with move already armed appends to the drawn path', () => {
    expect(waypointClick(arm('move'), draft, true, true)).toBe('append');
  });

  it('a drafted sprint counts as armed too — the budget is the sprint budget', () => {
    expect(waypointClick(IDLE, { ...draft, sprint: true }, true, true)).toBe('append');
  });

  it('aiming WINS — a Shift-click mid-aim is not a waypoint', () => {
    // Stealing the click would drop an aim the player is halfway through, and
    // Shift is a modifier people rest their hand on.
    for (const mode of ['aim', 'free', 'catalyst', 'chase'] as const) {
      expect(waypointClick(arm(mode), draft, true, true), mode).toBe('ignore');
    }
  });

  it('without Shift nothing changes — the direct-line auto-route is untouched', () => {
    expect(waypointClick(IDLE, draft, false, true)).toBe('ignore');
    expect(waypointClick(arm('move'), draft, false, true)).toBe('ignore');
  });

  it('and a unit that cannot move is never a waypoint click', () => {
    expect(waypointClick(IDLE, draft, true, false)).toBe('ignore');
  });
});

describe('WAYPOINTS-FIX: a click lands a waypoint wherever it points', () => {
  it('three tiles away builds a routed three-step segment, not a refusal', () => {
    // The v1 behaviour this reverses: non-adjacent was `undefined`.
    const { state, unit } = board();
    const path = appendWaypointRouted(OPEN, state, unit, [], { x: 8, y: 7 }, false);
    expect(path, 'a route, not a refusal').toBeDefined();
    expect(path!.map(key)).toEqual(['6,7', '7,7', '8,7']);
  });

  it('and routes AROUND a wall, exactly as a plain move click would', () => {
    const { state, unit } = board(WALLED);
    const path = appendWaypointRouted(WALLED, state, unit, [], { x: 8, y: 7 }, true)!;
    expect(path.map(key), 'no waypoint inside the wall').not.toContain('7,7');
    expect(path.at(-1), 'and it still gets there').toEqual({ x: 8, y: 7 });
    const check = validateMovePath(buildBoard(WALLED), state, unit, path, true);
    expect(check.valid, 'the engine accepts the route the client drew').toBe(true);
  });

  it('an ADJACENT click is still exactly one step — tile-by-tile survives', () => {
    // The control v1 offered is not lost: a waypoint per corner threads an
    // obstacle by hand, and each of those clicks is a one-step segment.
    const { state, unit } = board();
    let path = appendWaypointRouted(OPEN, state, unit, [], { x: 6, y: 6 }, false)!;
    expect(path.map(key)).toEqual(['6,6']);
    path = appendWaypointRouted(OPEN, state, unit, path, { x: 7, y: 6 }, false)!;
    expect(path.map(key)).toEqual(['6,6', '7,6']);
  });

  it('segments chain from the last waypoint, not from where the unit stands', () => {
    const { state, unit } = board();
    let path = appendWaypointRouted(OPEN, state, unit, [], { x: 5, y: 5 }, false)!;
    path = appendWaypointRouted(OPEN, state, unit, path, { x: 7, y: 5 }, false)!;
    expect(path.map(key)).toEqual(['5,6', '5,5', '6,5', '7,5']);
  });

  it('a second click on the waypoint you are already on is refused', () => {
    const { state, unit } = board();
    const path = appendWaypointRouted(OPEN, state, unit, [], { x: 7, y: 7 }, false)!;
    expect(appendWaypointRouted(OPEN, state, unit, path, { x: 7, y: 7 }, false)).toBeUndefined();
  });
});

describe('WAYPOINTS-FIX: the budget draws down and refusals are visible', () => {
  it('the readout is `movementBudget − Σ segment costs`', () => {
    const { state, unit } = board();
    expect(remainingMove(unit, false, [])).toBe(MOVE_RANGE);
    const path = appendWaypointRouted(OPEN, state, unit, [], { x: 8, y: 7 }, false)!;
    expect(remainingMove(unit, false, path)).toBe(MOVE_RANGE - 3);
  });

  it('a diagonal segment costs 2 a step, and the readout says so', () => {
    const { state, unit } = board();
    const path = appendWaypointRouted(OPEN, state, unit, [], { x: 6, y: 8 }, false)!;
    expect(path.map(key)).toEqual(['6,8']);
    expect(remainingMove(unit, false, path)).toBe(MOVE_RANGE - 2);
  });

  it('a click beyond the remaining budget routes as far as it legally can (MOVE1)', () => {
    // Not a refusal: the auto-route is forgiving and a waypoint segment uses the
    // same router, so a long click walks toward it rather than doing nothing.
    const { state, unit } = board();
    const path = appendWaypointRouted(OPEN, state, unit, [], { x: 14, y: 7 }, false)!;
    expect(remainingMove(unit, false, path), 'it spent the whole budget').toBe(0);
    expect(path.at(-1), 'and stopped where the budget ran out').toEqual({ x: 9, y: 7 });
  });

  it('a click with NO budget left is refused, so the caller can show the tell', () => {
    const { state, unit } = board();
    const spent = appendWaypointRouted(OPEN, state, unit, [], { x: 14, y: 7 }, false)!;
    expect(remainingMove(unit, false, spent)).toBe(0);
    expect(appendWaypointRouted(OPEN, state, unit, spent, { x: 10, y: 7 }, false)).toBeUndefined();
  });

  it('a refusal leaves the path exactly as it was', () => {
    const { state, unit } = board();
    const spent = appendWaypointRouted(OPEN, state, unit, [], { x: 14, y: 7 }, false)!;
    const before = spent.map(key);
    appendWaypointRouted(OPEN, state, unit, spent, { x: 10, y: 7 }, false);
    expect(spent.map(key), 'the function is pure — nothing was mutated').toEqual(before);
  });

  it('a sprint buys a longer route from the same click', () => {
    const { state, unit } = board();
    const walked = appendWaypointRouted(OPEN, state, unit, [], { x: 14, y: 7 }, false)!;
    const sprinted = appendWaypointRouted(OPEN, state, unit, [], { x: 14, y: 7 }, true)!;
    expect(walked).toHaveLength(MOVE_RANGE);
    expect(sprinted).toHaveLength(SPRINT_RANGE);
  });
});

describe('WAYPOINTS-FIX: the composed path is an ordinary order', () => {
  it('the engine walks it verbatim, around the wall', () => {
    const { state, unit } = board(WALLED);
    let path = appendWaypointRouted(WALLED, state, unit, [], { x: 6, y: 5 }, true)!;
    path = appendWaypointRouted(WALLED, state, unit, path, { x: 8, y: 5 }, true)!;
    const { state: after } = resolveTurn(
      state, WALLED,
      [{ team: 0, units: [{ unitId: unit.unitId, movePath: path, sprint: true }] }, { team: 1, units: [] }],
      roster,
    );
    expect(after.units.find((u) => u.unitId === unit.unitId)!.pos).toEqual({ x: 8, y: 5 });
  });

  it('MOVE-FOG holds: a fogged enemy does not bend where the segment ENDS', () => {
    // The leak MOVE-FOG closes, in the one place a waypoint can leak it. Passing
    // *through* a body is a planning affordance for visible and invisible units
    // alike (`validateMovePath`: "any unit — ally or enemy — may be passed
    // through"), so a mid-route tile tells nobody anything either way. Where a
    // segment is allowed to *stop* is a different matter: a click on an enemy's
    // tile ends short of it, and doing that for an enemy the team cannot see
    // would announce it is standing there.
    const { state, unit } = board();
    state.units[2]!.pos = { x: 9, y: 7 };
    const visible = state.units.filter((u) => u.owner === unit.owner);

    const blind = appendWaypointRouted(OPEN, planningState(state, visible), unit, [], { x: 9, y: 7 }, false)!;
    expect(blind.at(-1), 'the tile looks empty, so the waypoint lands on it').toEqual({ x: 9, y: 7 });

    const seeing = appendWaypointRouted(OPEN, state, unit, [], { x: 9, y: 7 }, false)!;
    expect(seeing.at(-1), 'and stops short only when we can actually see them').not.toEqual({ x: 9, y: 7 });
  });

  it('…and the fogged route is the same one an empty board would give', () => {
    // Stated as an equality, which is the only way to be sure no *shape* of the
    // route carries the tell either.
    const { state, unit } = board();
    const empty = appendWaypointRouted(OPEN, state, unit, [], { x: 9, y: 7 }, false)!;
    state.units[2]!.pos = { x: 8, y: 7 };
    const visible = state.units.filter((u) => u.owner === unit.owner);
    const fogged = appendWaypointRouted(OPEN, planningState(state, visible), unit, [], { x: 9, y: 7 }, false)!;
    expect(fogged.map(key)).toEqual(empty.map(key));
  });
});

describe('the impact layer: the regression that shipped green', () => {
  const sq = (x: number, y: number): Vec2 => ({ x, y });

  it('a dash draws its landing discs', () => {
    // The line that carries this was **deleted** by the AIM-RANGE-TELL commit,
    // which added its own and shipped neither: DASH-PREVIEW's discs silently
    // stopped drawing, through a green suite and a green render e2e. Nothing
    // could have caught it, because the decision lived inside a render loop no
    // test can reach. It lives in a function now.
    const layer = impactLayer([sq(3, 3), sq(4, 3)], [], undefined);
    expect(layer.squares).toEqual([sq(3, 3), sq(4, 3)]);
    expect(layer.refused, 'a landing is not a refusal').toBe(false);
  });

  it('a refused aim is marked when there is no landing to show', () => {
    const layer = impactLayer([], [sq(9, 2)], undefined);
    expect(layer.squares).toEqual([sq(9, 2)]);
    expect(layer.refused).toBe(true);
  });

  it('a refused waypoint is marked the same way', () => {
    const layer = impactLayer([], [], sq(1, 1));
    expect(layer.squares).toEqual([sq(1, 1)]);
    expect(layer.refused).toBe(true);
  });

  it('a landing wins over a stale refusal — they can never both be right', () => {
    const layer = impactLayer([sq(3, 3)], [sq(9, 2)], sq(1, 1));
    expect(layer.squares).toEqual([sq(3, 3)]);
    expect(layer.refused).toBe(false);
  });

  it('and nothing at all is the ordinary case', () => {
    expect(impactLayer([], [], undefined)).toEqual({ squares: [], refused: true });
  });

  it('the squares are copies, so the layer cannot be edited through them', () => {
    const disc = sq(3, 3);
    const layer = impactLayer([disc], [], undefined);
    disc.x = 99;
    expect(layer.squares[0]).toEqual({ x: 3, y: 3 });
  });
});

describe('WAYPOINT-TELL: the composed route is visible while you build it', () => {
  /**
   * Owner Dev Note: *"Waypoints should track where you are moving via the line
   * and marker, right now it's just invisible and hard to tell where you are
   * waypointing around to."*
   *
   * The cause was in the *preview*, not the order. A Shift-click leaves move
   * armed and the pointer over the board, and `previewMovePath` answered
   * `pathTo(hover)` **from the unit** — so the drawn line snapped back to a
   * fresh direct route the instant the mouse moved, while the waypoints sat in
   * the draft, invisible, and resolved perfectly.
   */
  const hovering = (square: Vec2, shift: boolean): Interaction =>
    ({ mode: 'move', hover: { square, shift } });

  it('the reported bug: a composed route is no longer replaced by the hover line', () => {
    const { state, unit } = board();
    const composed = appendWaypointRouted(OPEN, state, unit, [], { x: 5, y: 5 }, false)!;
    const draft = { ...emptyDraft(unit.unitId), movePath: composed };

    const drawn = previewMovePath(OPEN, state, unit, draft, hovering({ x: 7, y: 5 }, true));
    expect(drawn.slice(0, composed.length).map(key), 'the waypoints are still on screen')
      .toEqual(composed.map(key));
    expect(drawn.length, 'and the pointer extends them').toBeGreaterThan(composed.length);
    expect(drawn.at(-1)).toEqual({ x: 7, y: 5 });
  });

  it('the extension is exactly what the click would append — one resolver', () => {
    // AIM-PREVIEW-RANGE's rule applied to the move: the preview and the commit
    // come from the same function, so they cannot describe different routes.
    const { state, unit } = board();
    const composed = appendWaypointRouted(OPEN, state, unit, [], { x: 5, y: 5 }, false)!;
    const draft = { ...emptyDraft(unit.unitId), movePath: composed };

    const previewed = previewMovePath(OPEN, state, unit, draft, hovering({ x: 7, y: 5 }, true));
    const committed = appendWaypointRouted(OPEN, state, unit, composed, { x: 7, y: 5 }, false)!;
    expect(previewed.map(key)).toEqual(committed.map(key));
  });

  it('WITHOUT Shift it previews the replacement, because that is what the click does', () => {
    // The other half of honesty: a plain click throws the composed route away
    // and auto-routes, so previewing the extension would show the wrong future.
    const { state, unit } = board();
    const composed = appendWaypointRouted(OPEN, state, unit, [], { x: 5, y: 5 }, false)!;
    const draft = { ...emptyDraft(unit.unitId), movePath: composed };

    const drawn = previewMovePath(OPEN, state, unit, draft, hovering({ x: 7, y: 7 }, false));
    expect(drawn.map(key), 'a direct line from the unit').toEqual(['6,7', '7,7']);
  });

  it('an unroutable extension leaves the drawn route where it is', () => {
    // A refusal must not blank the line — the player would read "my route is
    // gone" from what is only "that square is out of reach".
    const { state, unit } = board();
    const spent = appendWaypointRouted(OPEN, state, unit, [], { x: 14, y: 7 }, false)!;
    const draft = { ...emptyDraft(unit.unitId), movePath: spent };
    const drawn = previewMovePath(OPEN, state, unit, draft, hovering({ x: 14, y: 14 }, true));
    expect(drawn.map(key)).toEqual(spent.map(key));
  });

  it('with no route yet, Shift previews the first segment like any other hover', () => {
    const { state, unit } = board();
    const draft = emptyDraft(unit.unitId);
    expect(previewMovePath(OPEN, state, unit, draft, hovering({ x: 7, y: 7 }, true)).map(key))
      .toEqual(['6,7', '7,7']);
  });

  it('off the board, the committed route is what stays drawn', () => {
    const { state, unit } = board();
    const composed = appendWaypointRouted(OPEN, state, unit, [], { x: 5, y: 5 }, false)!;
    const draft = { ...emptyDraft(unit.unitId), movePath: composed };
    expect(previewMovePath(OPEN, state, unit, draft, { mode: 'move', hover: {} }).map(key))
      .toEqual(composed.map(key));
  });

  it('pressing Shift without moving the mouse repaints — the modifier IS a change', () => {
    // The old early-out compared squares only, so a Shift pressed over a tile
    // the pointer was already on would have frozen the preview mid-gesture.
    const at = { x: 7, y: 7 };
    const hovered = hoverBoard(arm('move'), at, false)!;
    const shifted = hoverBoard(hovered, at, true);
    expect(shifted, 'a repaint is required').toBeDefined();
    expect(shifted!.hover.shift).toBe(true);
    expect(hoverBoard(shifted!, at, true), 'and nothing changed is still nothing').toBeUndefined();
  });
});

describe('WAYPOINT-DASH-CLEAR: a dash IS the movement, so it takes the route with it', () => {
  /**
   * Builder OQ 2026-09-14 #2, ruled. A composed route correctly **survives** a
   * non-dash ability — move and shoot is one turn — but `nextDraft` already
   * drops `movePath` the moment a dash or a Dash catalyst is armed, because the
   * dash *is* the reposition. The marks were separate controller state and did
   * not follow, so they would have drawn a path the turn was never going to
   * walk, and reappeared beside a fresh route if the player armed Move again.
   *
   * Derived rather than cleared: a mark is only meaningful while the route it
   * belongs to still passes through it, so there is no second piece of state to
   * keep in step and no code path that can forget.
   */
  const marks = [{ x: 6, y: 6 }, { x: 7, y: 6 }];

  it('a cleared route leaves no marks — the dash case, by arithmetic', () => {
    expect(liveWaypointMarks(marks, [])).toEqual([]);
  });

  it('a surviving route keeps the marks that are still on it', () => {
    const path = [{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }];
    expect(liveWaypointMarks(marks, path)).toEqual(marks);
  });

  it('a REPLACED route drops the marks it no longer passes through', () => {
    // The subtler half: a plain move click auto-routes somewhere else, and a
    // mark from the discarded route would label a square this path never visits.
    const elsewhere = [{ x: 6, y: 8 }, { x: 7, y: 8 }];
    expect(liveWaypointMarks(marks, elsewhere)).toEqual([]);
  });

  it('and keeps only the overlap when the two routes share a square', () => {
    const partly = [{ x: 6, y: 6 }, { x: 6, y: 5 }];
    expect(liveWaypointMarks(marks, partly)).toEqual([{ x: 6, y: 6 }]);
  });

  it('the marks it returns are copies — the board cannot edit the record', () => {
    const source = [{ x: 6, y: 6 }];
    const live = liveWaypointMarks(source, [{ x: 6, y: 6 }]);
    live[0]!.x = 99;
    expect(source[0]!.x).toBe(6);
  });

  it('arming a dash empties the draft\'s movePath — the engine\'s own rule', () => {
    // The other half of the pair, at the function that owns it. Together with
    // the filter above, "a dash clears the route and its marks" holds without
    // the controller having to remember either.
    const composed = { ...emptyDraft('u'), movePath: [{ x: 6, y: 6 }, { x: 7, y: 6 }] };
    const dashed = nextDraft(composed, { type: 'selectAbility', abilityId: 'leap', isDash: true }, false);
    expect(dashed.movePath, 'the dash owns the movement').toEqual([]);
    expect(liveWaypointMarks(marks, dashed.movePath), 'so the marks go with it').toEqual([]);
  });

  it('a Dash CATALYST does the same — CAT-DASH-COST spends the Move too', () => {
    const composed = { ...emptyDraft('u'), movePath: [{ x: 6, y: 6 }] };
    const shifted = nextDraft(composed, { type: 'selectCatalyst', catalystId: 'shift', isDash: true }, false);
    expect(shifted.movePath).toEqual([]);
    expect(liveWaypointMarks(marks, shifted.movePath)).toEqual([]);
  });

  it('but a NON-dash ability leaves both — move and shoot is one turn', () => {
    const composed = { ...emptyDraft('u'), movePath: [{ x: 6, y: 6 }, { x: 7, y: 6 }] };
    const shot = nextDraft(composed, { type: 'selectAbility', abilityId: 'rail_shot', isDash: false }, false);
    expect(shot.movePath, 'the walk is still part of the turn').toEqual(composed.movePath);
    expect(liveWaypointMarks(marks, shot.movePath)).toEqual(marks);
  });

  it('and the order that goes out carries no movePath after a dash', () => {
    // The AC's end-to-end half: what the engine is handed, not just what the
    // board draws.
    const composed = { ...emptyDraft(VEX.id), movePath: [{ x: 6, y: 6 }] };
    const dashed = nextDraft(composed, { type: 'selectAbility', abilityId: 'combat_roll', isDash: true }, false);
    const order = toUnitOrders(VEX, { ...dashed, aim: [{ x: 8, y: 7 }] });
    expect(order.movePath, 'no path in the submitted order').toBeUndefined();
  });
});
