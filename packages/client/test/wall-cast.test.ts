// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WALL_ROTATIONS, buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster, type Vec2,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { emptyDraft, toUnitOrders } from '../src/targeting.js';
import {
  OPEN_MAP, aimAndCommit, armAbility, click, lockIn, mountUI, moveButton, playbackRow,
  skipPlayback, unitAt, unitHp,
} from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import aegis from '../../../data/characters/aegis.json';
import vex from '../../../data/characters/vex.json';

/**
 * WALL-CAST-FIX — *"Aegis's Warding Wall does not cast successfully."*
 *
 * The ability had twenty-four engine tests and a preview test and **could not be
 * used**, which is the whole reason this file exists and the whole reason it
 * drives the controller through **lock-in and resolve** rather than through a
 * pure helper.
 *
 * The seam: WALL-ROTATE made a wall's aim need both an anchor and a rotation, so
 * `aimIsLegal` refuses a stepless wall. The client computes the rotation into
 * `draft.aimStep` and previews it correctly — but `toUnitOrders` only copied
 * `aimStep` into the order `if (isRotatable(ability))`, and `isRotatable` is
 * `line || cone`. A wall is `isPlacedRotatable`, so the step was dropped at
 * order-build, the engine got a stepless wall, and refused it.
 *
 * Every test below would have passed on `main` if it stopped at the preview.
 * `aimFor` is the function the preview reads and it was never wrong. The bug
 * lived in the one step nothing drove: **the order that actually goes out.** So
 * these assert on what the turn **did**, which is the only place a dropped order
 * field shows.
 *
 * And "what it did" rather than "what is on the board", because Warding Wall's
 * `lifetime: 1` means the hazard is swept by the same turn's end-of-turn tick —
 * it is gone from the board a test looks at afterwards, cast or not. So the enemy
 * walks into it: HP lost on the far side of the wall is proof the order arrived,
 * proof it arrived with the right rotation, and the thing a player actually
 * wanted. A test asserting on `traps` after the turn would read zero either way
 * and certify the bug as fixed.
 */

const AEGIS = aegis as unknown as CharacterDef;
const VEX = vex as unknown as CharacterDef;
const WALL = AEGIS.abilities.find((a) => a.id === 'warding_wall')!;
const roster: Roster = buildRoster([AEGIS, VEX]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

/**
 * Aegis at (10,10) with the wall armed, and an enemy at `foeAt` ready to be
 * walked into whatever gets laid down.
 */
const armed = (foeAt: Vec2 = { x: 13, y: 13 }, arm = true) => {
  const ui = mountUI();
  const opening: GameState = createMatch(OPEN_MAP, '1v1', [[AEGIS], [VEX]]);
  const me = opening.units.find((u) => u.owner === 0)!;
  const foe = opening.units.find((u) => u.owner === 1)!;
  me.pos = { x: 10, y: 10 };
  foe.pos = { ...foeAt };
  const foeHp = foe.hp;
  startHotSeat(ui.ui, OPEN_MAP, roster, [[AEGIS], [VEX]], '1v1', [1, 1], POOL, undefined,
    undefined, opening);
  if (arm) armAbility(ui.controls, WALL.name);
  return { ...ui, opening, me, foe, foeHp };
};

/** The 25 a Warding Wall tile deals, read off the data rather than typed twice. */
const WALL_DAMAGE = WALL.effects.find((e) => e.kind === 'trap')!.amount!;

const rotateButtons = (controls: HTMLElement): HTMLButtonElement[] =>
  [...controls.querySelectorAll<HTMLButtonElement>('.hud-rotate')];

/**
 * Play the turn out: Aegis locks in, then the enemy seat walks the route given
 * (or holds), then the hot-seat resolves and the animation is skipped.
 *
 * Two lock-ins because a 1v1 hot-seat walks both seats before it resolves — the
 * turn does not exist until every seat has answered, which is exactly the path a
 * dropped order field has to survive.
 */
const playTurn = async (b: ReturnType<typeof armed>, enemyWalk?: Vec2): Promise<void> => {
  lockIn(b.controls); // Aegis
  if (enemyWalk !== undefined) {
    click(moveButton(b.controls, 'Move'));
    aimAndCommit(b.board, enemyWalk);
  }
  lockIn(b.controls); // the enemy seat
  skipPlayback(b.controls);
  await vi.waitFor(() => {
    expect(playbackRow(b.controls).style.display, 'playback finished').toBe('none');
  });
};

/** How much the enemy lost this turn, as the board reports it. */
const foeLost = (b: ReturnType<typeof armed>): number =>
  b.foeHp - (unitHp(b.renderer, b.foe.unitId) ?? b.foeHp);

beforeEach(() => { document.body.replaceChildren(); });

describe('WALL-CAST-FIX: the wall actually casts', () => {
  // The geometry every test below shares. Aegis anchors at (12,10); east lays
  // the row (12..15, y=10), south lays the column (x=12, 10..13). The enemy
  // starts at (13,13) and walks NORTH up the x=13 column to (13,9), crossing
  // (13,10) — one tile of the east wall, and no tile of the south one.
  //
  // Crossing it PERPENDICULAR is the point: walking *along* a wall's length runs
  // over three separate traps for 75, which is correct (each tile is its own)
  // and would make the number here a statement about the route rather than about
  // the cast.
  const WALK_NORTH: Vec2 = { x: 13, y: 9 };

  it('the fixture really does walk the enemy across the wall line', async () => {
    // The control. With Aegis casting nothing, the identical walk costs nothing
    // — so the HP the other tests read is the wall and not the walking.
    const b = armed({ x: 13, y: 13 }, false);
    await playTurn(b, WALK_NORTH);
    expect(unitAt(b.renderer, b.foe.unitId), 'the enemy really moved').toEqual(WALK_NORTH);
    expect(foeLost(b), 'and nothing hurt them').toBe(0);
  });

  it('select → click → Lock In → resolve lays a wall the enemy walks into', async () => {
    // The bug, end to end. On `main` the order goes out with no `aimStep`,
    // `aimIsLegal` refuses the wall, the turn passes with Aegis having done
    // nothing, and the enemy strolls across for free.
    const b = armed();
    aimAndCommit(b.board, { x: 12, y: 10 });
    await playTurn(b, WALK_NORTH);
    expect(foeLost(b), 'the wall was there and it bit').toBe(WALL_DAMAGE);
  });

  it('a player who never touches the rotate row still casts', async () => {
    // The defaulted path, and the one most players take on their first cast:
    // `aimFor` supplies `WALL_ROTATIONS[0]` (east). A fix that only carried an
    // *explicitly chosen* rotation would leave this broken — which is the shape
    // of fix somebody reaching for `draft.mode`'s pattern would write.
    const b = armed();
    expect(rotateButtons(b.controls).filter((r) => r.classList.contains('sel')),
      'nothing was pressed').toHaveLength(1);
    aimAndCommit(b.board, { x: 12, y: 10 });
    await playTurn(b, WALK_NORTH);
    expect(foeLost(b)).toBe(WALL_DAMAGE);
  });

  it('and the rotation the player PICKED is the one that lands', async () => {
    // Not just "a wall appeared" — the *right* wall, which is what catches a fix
    // that hard-codes a default instead of carrying the draft. Turned south the
    // wall runs down x=12, so the x=13 column the enemy walks is bare.
    const b = armed();
    click(rotateButtons(b.controls)[1]); // south
    aimAndCommit(b.board, { x: 12, y: 10 });
    await playTurn(b, WALK_NORTH);
    expect(foeLost(b), 'x=13 is not on a southward wall').toBe(0);
  });

  it('…and the southward wall bites where it actually runs', async () => {
    // The other half of that claim: the wall did not vanish, it turned. Same
    // cast, an enemy crossing the column instead of the row.
    const b = armed({ x: 14, y: 12 });
    click(rotateButtons(b.controls)[1]); // south
    aimAndCommit(b.board, { x: 12, y: 10 });
    await playTurn(b, { x: 11, y: 12 });
    expect(foeLost(b)).toBe(WALL_DAMAGE);
  });

  it('the order that goes out carries the step — the field that was dropped', () => {
    // The unit-level statement of the fix, under the end-to-end ones rather than
    // instead of them. `toUnitOrders` gated the `aimStep` write on
    // `isRotatable`, which is `line || cone`; a wall is `isPlacedRotatable`, so
    // the rotation never left the client.
    const draft = { ...emptyDraft('u0'), abilityId: WALL.id, aim: [{ x: 12, y: 10 }], aimStep: WALL_ROTATIONS[2]! };
    const order = toUnitOrders(AEGIS, draft);
    expect(order.ability?.aimStep, 'the rotation is in the order').toBe(WALL_ROTATIONS[2]);
  });
});
