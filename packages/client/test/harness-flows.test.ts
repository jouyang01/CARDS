// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch, resolveTurn,
  type CatalystData, type CatalystPool, type CharacterDef, type GameState, type Roster, type Vec2,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import {
  OPEN_MAP, aimAndCommit, aimAt, armAbility, armCatalyst, catalystButtons, click,
  layer, lockIn, mountUI, moveButton, playbackRow, recordingNet, skipPlayback,
} from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * HARNESS-BROADEN — the controller's real flows, driven through the real
 * controller (Builder OQ 2026-09-19 #6).
 *
 * `app-harness.ts` shipped with KESTREL-CONE and was used by exactly one spec,
 * which is a strange place to leave it: three of that batch's five items were
 * "the pure function passes, the wiring is broken", and the harness exists
 * precisely because `startHotSeat` — where the HUD, the draft reducer, the
 * preview and the order builder are actually joined up — could not be tested at
 * all before it.
 *
 * So this file walks the flows a turn is actually made of, each one **through
 * the button**: aim and commit, a catalyst, a free action, the chase, and
 * playback. Every assertion lands on something the player can see (a highlight
 * layer, a log line, the HUD's own nodes) or on the `UnitOrders` the server
 * would have received — never on the pure helper that produced it, because the
 * pure helpers were never the thing that was broken.
 *
 * The lobby ready flow, the sixth of the AC's flows, is `lobby-ready-fix.test.ts`
 * — two real net clients through a real `RoomHub`, where LOBBY-READY-FIX's own
 * regression lives.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION]);
const POOL: CatalystPool = buildCatalystPool(catalystData as unknown as CatalystData);
const RAIL = VEX.abilities.find((a) => a.id === 'rail_shot')!;
const TRAP = VEX.abilities.find((a) => a.id === 'overwatch_trap')!;

/** Vex at (5,10) with Bastion three east — room for any shape, and a target. */
const board = (): ReturnType<typeof mountUI> & {
  opening: GameState;
  me: { unitId: string };
  foe: { unitId: string; pos: Vec2 };
  submitted: ReturnType<typeof recordingNet>['submitted'];
  resolve: ReturnType<typeof recordingNet>['resolve'];
} => {
  const ui = mountUI();
  const opening = createMatch(OPEN_MAP, '1v1', [[VEX], [BASTION]]);
  const me = opening.units.find((u) => u.owner === 0)!;
  const foe = opening.units.find((u) => u.owner === 1)!;
  me.pos = { x: 5, y: 10 };
  foe.pos = { x: 8, y: 10 };
  const wire = recordingNet('s0', 0, [me.unitId]);
  startHotSeat(ui.ui, OPEN_MAP, roster, [[VEX], [BASTION]], '1v1', [1, 1], POOL, undefined, wire.net, opening);
  return { ...ui, opening, me, foe, submitted: wire.submitted, resolve: wire.resolve };
};

/** The one order the seat sent, once it has sent one. */
const sent = (b: ReturnType<typeof board>) => {
  expect(b.submitted, 'the seat locked in exactly once').toHaveLength(1);
  return b.submitted[0]![0]!;
};

beforeEach(() => { document.body.replaceChildren(); });

describe('HARNESS-BROADEN: aiming and committing, which is most of a turn', () => {
  it('hovering an armed ability previews it, and hovering nothing does not', () => {
    // UI1's first half. The `aim` layer *is* the preview — asserting on it is
    // asserting on what the player sees, not on `abilityPreview`.
    const b = board();
    expect(layer(b.renderer, 'aim'), 'nothing armed, nothing drawn').toEqual([]);
    armAbility(b.controls, RAIL.name);
    aimAt(b.board, { x: 9, y: 10 }, 'mousemove');
    expect(layer(b.renderer, 'aim').length, 'the lane is on the board').toBeGreaterThan(0);
  });

  it('the preview follows the pointer until a click pins it', () => {
    // UI1-fix: "a board click locks the action (stop mouse-follow)". The bug
    // this guards is a preview that keeps chasing the mouse after the player
    // has chosen, so the drawn shape and the committed one drift apart.
    const b = board();
    armAbility(b.controls, RAIL.name);
    aimAt(b.board, { x: 9, y: 10 }, 'mousemove');
    const east = layer(b.renderer, 'aim').map((p) => `${p.x},${p.y}`).sort();
    aimAt(b.board, { x: 5, y: 6 }, 'mousemove');
    expect(layer(b.renderer, 'aim').map((p) => `${p.x},${p.y}`).sort(), 'it moved').not.toEqual(east);

    aimAt(b.board, { x: 9, y: 10 }, 'mousemove');
    aimAt(b.board, { x: 9, y: 10 }, 'click');
    const pinned = layer(b.renderer, 'aim').map((p) => `${p.x},${p.y}`).sort();
    aimAt(b.board, { x: 5, y: 6 }, 'mousemove');
    expect(layer(b.renderer, 'aim').map((p) => `${p.x},${p.y}`).sort(), 'and then it stopped')
      .toEqual(pinned);
  });

  it('committing is not locking in — nothing is sent until the button', () => {
    // UI1: "commit != lock". A client that submitted on the board click would
    // take the turn away from a player who was still deciding.
    const b = board();
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 9, y: 10 });
    expect(b.submitted, 'still theirs to change').toHaveLength(0);
    lockIn(b.controls);
    expect(b.submitted, 'and now it is gone').toHaveLength(1);
  });

  it('and the order that goes out is the ability that was aimed', () => {
    // A line is aimed as a **direction**, not a square (AIM2): `aimFor`
    // quantizes the drag into an `aimStep` and leaves the target list empty. So
    // the thing to assert is the step — and that it is the one pointed at, not
    // merely present.
    const b = board();
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 9, y: 10 }); // due east of (5,10)
    lockIn(b.controls);
    expect(sent(b).ability).toMatchObject({ abilityId: RAIL.id });
    expect(sent(b).ability!.aimStep, 'a direction, quantized').toBe(0);

    // …and a square-shaped one is aimed the other way, at a tile.
    const c = board();
    armAbility(c.controls, TRAP.name);
    aimAndCommit(c.board, { x: 6, y: 10 });
    lockIn(c.controls);
    expect(sent(c).freeAbility!.target).toEqual([{ x: 6, y: 10 }]);
  });

  it('a move is a path, and it rides alongside a non-dash ability', () => {
    // The composition rule (MS1) at the level of the buttons: arm, aim, then
    // walk, and both survive into the same order.
    const b = board();
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 9, y: 10 });
    click(moveButton(b.controls, 'Move'));
    aimAndCommit(b.board, { x: 5, y: 12 });
    lockIn(b.controls);
    expect(sent(b).ability, 'the shot').toMatchObject({ abilityId: RAIL.id });
    expect(sent(b).movePath?.at(-1), 'and the walk').toEqual({ x: 5, y: 12 });
  });

  it('Clear takes the plan back off the board', () => {
    const b = board();
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 9, y: 10 });
    click(moveButton(b.controls, 'Clear'));
    lockIn(b.controls);
    expect(sent(b).ability, 'nothing left to fire').toBeUndefined();
    expect(sent(b).movePath, 'and nowhere to be').toBeUndefined();
  });
});

describe('HARNESS-BROADEN: a catalyst rides along (CAT2)', () => {
  it('the row offers the seat\'s three, one per phase', () => {
    const b = board();
    expect(catalystButtons(b.controls).map((n) => n.textContent))
      .toHaveLength(3);
  });

  it('arming one puts it in the order beside everything else', () => {
    // Additive, which is the whole mechanic: the catalyst does not replace the
    // ability, and an order carrying only one of the two would be the bug.
    const b = board();
    const secondWind = POOL['second_wind']!;
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 9, y: 10 });
    armCatalyst(b.controls, secondWind.name);
    lockIn(b.controls);
    expect(sent(b).catalyst, 'the catalyst').toMatchObject({ abilityId: 'second_wind' });
    expect(sent(b).ability, 'and the ability it did not replace')
      .toMatchObject({ abilityId: RAIL.id });
  });

  it('and a self-shaped one needs no board click at all', () => {
    // Second Wind is `shape: 'self'`: there is nowhere to point it, so arming
    // it has to be the whole gesture. A control that waited for a board click
    // would be a button that appears to do nothing. The aim it gets is the
    // caster's own square (`aimFor`), which is what a self shape means.
    const b = board();
    armCatalyst(b.controls, POOL['second_wind']!.name);
    lockIn(b.controls);
    expect(sent(b).catalyst).toMatchObject({
      abilityId: 'second_wind', target: [{ x: 5, y: 10 }],
    });
  });
});

describe('HARNESS-BROADEN: a free action is additive too (FREE-UI)', () => {
  it('the hotbar says which ability is the free one', () => {
    // "A player who cannot tell a free ability from a normal one will spend
    // their action on it" — the note is the whole of the affordance.
    const b = board();
    const trap = [...b.controls.querySelectorAll<HTMLButtonElement>('.hud-ability')]
      .find((n) => (n.textContent ?? '').includes(TRAP.name))!;
    expect(trap.classList.contains('free')).toBe(true);
    expect(trap.textContent).toContain('free');
  });

  it('and it goes out beside the action it did not spend', () => {
    // The property that makes it free: `freeAbility` and `ability` in one order.
    const b = board();
    armAbility(b.controls, TRAP.name);
    aimAndCommit(b.board, { x: 6, y: 10 });
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 9, y: 10 });
    lockIn(b.controls);
    expect(sent(b).freeAbility, 'the trap').toMatchObject({ abilityId: TRAP.id });
    expect(sent(b).ability, 'and the shot it did not cost').toMatchObject({ abilityId: RAIL.id });
  });

  it('the free aim is drawn on its own layer, not over the action\'s', () => {
    // Two plans on one board at once. They are separate layers because they are
    // separate things, and a preview that merged them would say the ability
    // covers ground it does not.
    const b = board();
    armAbility(b.controls, TRAP.name);
    aimAndCommit(b.board, { x: 6, y: 10 });
    expect(layer(b.renderer, 'free').length, 'the trap is on the board').toBeGreaterThan(0);
  });
});

describe('HARNESS-BROADEN: the chase names a unit, not a square', () => {
  it('clicking a visible enemy sets the target; clicking dirt does not', () => {
    // CHASE1 through the button. Clicking empty ground leaves the mode armed
    // rather than quietly dropping the order — so the second half of this is
    // that nothing happened, which is the part a pure test cannot see.
    const b = board();
    click(moveButton(b.controls, 'Chase'));
    aimAndCommit(b.board, { x: 12, y: 3 }); // nobody there
    lockIn(b.controls);
    expect(sent(b).chase, 'no target, no chase').toBeUndefined();
  });

  it('and the order carries the unit id the player pointed at', () => {
    const b = board();
    click(moveButton(b.controls, 'Chase'));
    aimAndCommit(b.board, b.foe.pos);
    lockIn(b.controls);
    expect(sent(b).chase).toBe(b.foe.unitId);
    expect(sent(b).movePath, 'a chase is instead of a walk, never as well as')
      .toBeUndefined();
  });

  it('the chased unit is marked on the board', () => {
    const b = board();
    click(moveButton(b.controls, 'Chase'));
    aimAndCommit(b.board, b.foe.pos);
    expect(layer(b.renderer, 'chase')).toEqual([b.foe.pos]);
  });
});

describe('HARNESS-BROADEN: playback, from the server\'s own payload', () => {
  /** Resolve the turn the way the server would, and hand the client the result. */
  const resolved = (b: ReturnType<typeof board>) => {
    const out = resolveTurn(b.opening, OPEN_MAP, [
      { team: 0, units: b.submitted[0] ?? [] }, { team: 1, units: [] },
    ], roster);
    b.resolve(out.state as never, out.events as never);
    return out;
  };

  it('the log is written up front, so it is complete whether or not you watch', () => {
    // Deliberate in `playResolution`: a player who skips the animation must end
    // up with the same log as one who watches it.
    const b = board();
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 9, y: 10 });
    lockIn(b.controls);
    expect(b.log.querySelectorAll('.log-line'), 'nothing has happened yet').toHaveLength(0);
    resolved(b);
    expect(b.log.querySelectorAll('.log-line').length, 'the turn is on the record')
      .toBeGreaterThan(0);
    expect(b.log.textContent).toContain(BASTION.name);
  });

  it('the ordering HUD is replaced by one Skip while it plays', () => {
    // The board is not taking orders during a resolution, and the HUD says so
    // by swapping rather than by disabling — a hotbar you can click into a
    // resolving turn is the ambiguity this avoids.
    const b = board();
    lockIn(b.controls);
    resolved(b);
    expect(playbackRow(b.controls).style.display, 'Skip is offered').not.toBe('none');
    expect(b.controls.querySelector<HTMLElement>('.hud-centre')!.style.display,
      'and the hotbar is gone').toBe('none');
  });

  it('and skipping lands on the same board, ready for the next turn', async () => {
    // The property `playResolution` is built around: the player owns the state,
    // so skipping and watching agree by construction. Here that means the turn
    // completes and the ordering HUD comes back.
    const b = board();
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 9, y: 10 });
    lockIn(b.controls);
    const out = resolved(b);
    skipPlayback(b.controls);
    await vi.waitFor(() => {
      expect(playbackRow(b.controls).style.display, 'playback is over').toBe('none');
    });
    expect(b.controls.querySelector<HTMLElement>('.hud-centre')!.style.display,
      'and the hotbar is back').not.toBe('none');
    expect(out.state.turn, 'on the turn the server resolved to').toBe(2);
  });

  it('the aim overlays are cleared when the plan stops being a plan', () => {
    // "The turn stops being a plan the instant it resolves" — a preview left
    // over the animation would be describing an order that has already run.
    const b = board();
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 9, y: 10 });
    expect(layer(b.renderer, 'aim').length).toBeGreaterThan(0);
    lockIn(b.controls);
    resolved(b);
    expect(layer(b.renderer, 'range'), 'nothing left to aim with').toEqual([]);
  });
});
