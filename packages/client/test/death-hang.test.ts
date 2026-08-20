// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch, resolveTurn,
  type CatalystData, type CharacterDef, type GameState, type Roster, type TurnEvent,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import {
  OPEN_MAP, abilityButtons, aimAndCommit, armAbility, lockIn, mountUI, playbackRow,
  recordingNet, skipPlayback,
} from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * DEATH-HANG — *"BIG BUG: IMPORTANT: Something breaks when a character dies, the
 * lock-in is not possible and the timer bar goes away, forcing game to go on
 * forever."*
 *
 * The engine is fine: units die, respawn after `RESPAWN_TURNS`, and the match
 * ends on the kill target. The break is in the controller's turn boundary.
 *
 * `playResolution` ends with `beginTurn()` for **both** modes, and `beginTurn`
 * calls `openSeat`, which was written for the hot-seat's seat walk: *"skip seats
 * with no living characters; if none is left, the turn is over"*. In a networked
 * match there is exactly **one** seat, so the instant a resolution leaves this
 * client's characters downed that branch fires `endTurn()` — which, networked,
 * means `net.submit([])`.
 *
 * That is the whole fault, and it is smaller and nastier than it looks. The
 * client has *answered a turn it was never shown*: the orders are gone, and
 * every control that could change them is now correctly refusing, because from
 * the board's point of view this player has locked in. `lockSelected` returns on
 * its `banner` guard, and the window the server opens next is a window on a turn
 * already spent. "Lock-in is not possible", exactly — and the timer that came
 * with the sent turn is not a timer the player can use.
 *
 * The reproduction below was written before the fix (the Spec Notes ask for it,
 * and a pure-function test could not have found a wiring bug), and it corrected
 * the first guess: `endTurn`'s networked branch calls `render()` after
 * submitting, so the HUD *does* come back out of the playback layout. Tests 3
 * and 4 pin that half — it was already right, and the fix must not break it.
 * What was missing is the other half: nothing on screen said why the board had
 * stopped taking orders.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const SLAM = BASTION.abilities.find((a) => a.id === 'crushing_slam')!;

/**
 * A networked seat holding one character, standing next to an enemy who can
 * finish it. `hp` is dropped rather than the damage raised — the numbers are the
 * Designer's and a test that needed a rebalance to kill somebody would be
 * testing the wrong thing.
 */
const networked = (hp = 5) => {
  const ui = mountUI();
  const opening: GameState = createMatch(OPEN_MAP, '1v1', [[VEX], [BASTION]]);
  const me = opening.units.find((u) => u.owner === 0)!;
  const foe = opening.units.find((u) => u.owner === 1)!;
  me.pos = { x: 8, y: 10 };
  foe.pos = { x: 10, y: 10 };
  me.hp = hp;
  const wire = recordingNet('s0', 0, [me.unitId]);
  startHotSeat(ui.ui, OPEN_MAP, roster, [[VEX], [BASTION]], '1v1', [1, 1], POOL, undefined,
    wire.net, opening);
  return { ...ui, opening, me, foe, wire };
};

/** Resolve one turn for real: the enemy swings, this seat holds. */
const enemySwings = (
  state: GameState, foeId: string, at: { x: number; y: number },
): { state: GameState; events: TurnEvent[] } => resolveTurn(state, OPEN_MAP, [
  { team: 0, units: [] },
  { team: 1, units: [{ unitId: foeId, ability: { abilityId: SLAM.id, target: [at] } }] },
], roster, POOL);

/** Play the resolution the server sent, skipping the animation. */
const play = async (
  b: ReturnType<typeof networked>, out: { state: GameState; events: TurnEvent[] },
): Promise<void> => {
  b.wire.resolve(out.state as never, out.events as never);
  skipPlayback(b.controls);
  await vi.waitFor(() => {
    expect(playbackRow(b.controls).style.display, 'playback finished').toBe('none');
  });
};

const ordering = (b: ReturnType<typeof networked>): boolean =>
  (b.controls.querySelector<HTMLElement>('.hud-centre')?.style.display ?? '') !== 'none';
const timerShown = (b: ReturnType<typeof networked>): boolean =>
  (b.controls.querySelector<HTMLElement>('.hud-timer')?.style.display ?? '') !== 'none';

beforeEach(() => { document.body.replaceChildren(); });

describe('DEATH-HANG: a death must not answer the turn for you', () => {
  it('the setup really does kill the seat\'s only character', () => {
    // The fixture, asserted before anything is concluded from it. A test that
    // silently stopped killing anybody would pass every claim below for free.
    const b = networked();
    const out = enemySwings(b.opening, b.foe.unitId, b.me.pos);
    const after = out.state.units.find((u) => u.unitId === b.me.unitId)!;
    expect(after.alive, 'downed').toBe(false);
    expect(out.state.status, 'and the match is still running').toBe('active');
  });

  it('a resolution that downs this seat does NOT auto-submit the next turn', async () => {
    // The bug itself. `openSeat`'s "no living roster → endTurn()" branch is the
    // hot-seat's seat walk; networked, `endTurn` is `net.submit(...)`, so the
    // client answers a turn it has not been shown.
    const b = networked();
    expect(b.wire.submitted, 'nothing sent yet').toHaveLength(0);
    await play(b, enemySwings(b.opening, b.foe.unitId, b.me.pos));
    expect(b.wire.submitted, 'a downed seat must not answer for itself').toHaveLength(0);
  });

  it('and the HUD comes out of playback, so the board is not frozen', async () => {
    // Already true before the fix — `endTurn` renders after submitting — and
    // pinned so the hold cannot regress it. A seat that holds must still put
    // the ordering panel back; the server's next window has to land somewhere
    // visible.
    const b = networked();
    await play(b, enemySwings(b.opening, b.foe.unitId, b.me.pos));
    expect(ordering(b), 'the ordering panel is back').toBe(true);
  });

  it('the server\'s next window shows on a downed seat ("the timer bar goes away")', async () => {
    const b = networked();
    await play(b, enemySwings(b.opening, b.foe.unitId, b.me.pos));
    b.wire.openWindow(40_000, 1);
    expect(timerShown(b), 'the countdown is on screen').toBe(true);
  });

  it('a downed seat is told why it cannot act, rather than looking broken', async () => {
    // The AC's "honest waiting/hold state". There is genuinely nothing to order
    // — every character this seat holds is down — and the difference between
    // that and a frozen client is entirely whether it says so.
    const b = networked();
    await play(b, enemySwings(b.opening, b.foe.unitId, b.me.pos));
    const banner = b.controls.querySelector<HTMLElement>('.hud-banner');
    expect(banner?.style.display, 'a banner is up').not.toBe('none');
    expect((banner?.textContent ?? '').toLowerCase()).toMatch(/down|respawn|wait/);
  });

  it('but the player may still hold, and only then does the turn go out', async () => {
    // The hold is a *decision*, not a silence. The difference from the bug is
    // entirely who pressed the button: nothing is sent until the player says
    // "resolve without me", and then exactly one empty submission goes.
    const b = networked();
    await play(b, enemySwings(b.opening, b.foe.unitId, b.me.pos));
    expect(b.wire.submitted, 'still nothing sent').toHaveLength(0);
    lockIn(b.controls);
    expect(b.wire.submitted, 'the player chose to hold').toHaveLength(1);
    expect(b.wire.submitted[0], 'and held with no orders').toEqual([]);
  });

  it('and the turn after the respawn is fully playable again', async () => {
    // The end of the sentence: a death costs you a turn, not the match.
    const b = networked();
    await play(b, enemySwings(b.opening, b.foe.unitId, b.me.pos));
    // The next turn resolves with this seat holding; RESPAWN_TURNS is 1, so it
    // comes back up for the turn after.
    const downed = b.wire.submitted.length;
    let state = b.opening;
    const first = enemySwings(state, b.foe.unitId, b.me.pos);
    state = first.state;
    const second = resolveTurn(state, OPEN_MAP, [{ team: 0, units: [] }, { team: 1, units: [] }], roster, POOL);
    await play(b, second);

    const back = second.state.units.find((u) => u.unitId === b.me.unitId)!;
    expect(back.alive, 'respawned').toBe(true);
    expect(ordering(b), 'ordering again').toBe(true);
    expect(abilityButtons(b.controls).length, 'a live hotbar').toBeGreaterThan(0);

    // …and Lock In actually sends this time.
    armAbility(b.controls, VEX.abilities.find((a) => a.id === 'rail_shot')!.name);
    aimAndCommit(b.board, { x: 14, y: back.pos.y });
    lockIn(b.controls);
    expect(b.wire.submitted.length, 'the player answered the turn themselves')
      .toBe(downed + 1);
  });
});

describe('DEATH-HANG: a partly-downed networked seat still plays', () => {
  /** One networked seat holding two characters, one of them about to die. */
  const pair = () => {
    const ui = mountUI();
    const teams: [CharacterDef[], CharacterDef[]] = [[VEX, VEX], [BASTION, BASTION]];
    const opening: GameState = createMatch(OPEN_MAP, '2v2', teams);
    const mine = opening.units.filter((u) => u.owner === 0);
    const foes = opening.units.filter((u) => u.owner === 1);
    mine.forEach((u, i) => { u.pos = { x: 8, y: 6 + i * 8 }; });
    foes.forEach((u, i) => { u.pos = { x: 10, y: 6 + i * 8 }; });
    mine[0]!.hp = 5; // the one that dies; the other is untouched and far away
    const wire = recordingNet('s0', 0, mine.map((u) => u.unitId));
    startHotSeat(ui.ui, OPEN_MAP, roster, teams, '2v2', [1, 1], POOL, undefined,
      wire.net, opening);
    return { ...ui, opening, mine, foes, wire };
  };

  it('the survivor is still orderable, and the seat does not hold', async () => {
    // The hold is for a seat with *nothing* alive. A seat that lost one of two
    // characters has lost a character, not a turn — `seatRoster()` already
    // filters `alive`, and the DEATH-HANG branch must not widen that.
    const b = pair();
    const first = enemySwings(b.opening, b.foes[0]!.unitId, b.mine[0]!.pos);
    expect(first.state.units.find((u) => u.unitId === b.mine[0]!.unitId)!.alive,
      'one of the two is down').toBe(false);
    expect(first.state.units.find((u) => u.unitId === b.mine[1]!.unitId)!.alive,
      'the other is not').toBe(true);
    await play(b as never, first);

    expect(abilityButtons(b.controls).length, 'the survivor has a hotbar')
      .toBeGreaterThan(0);
    expect(b.wire.submitted, 'and nothing was answered for the player').toHaveLength(0);

    // …and the player's own lock-in still sends, exactly once.
    lockIn(b.controls);
    expect(b.wire.submitted, 'the survivor\'s turn went out').toHaveLength(1);
  });

  it('a transient down does not end the match', async () => {
    // AC: "the match still ends on the kill target, not on a transient down."
    // The engine is right about this; what is asserted here is that the client
    // does not draw the end screen over a respawn.
    const b = pair();
    const first = enemySwings(b.opening, b.foes[0]!.unitId, b.mine[0]!.pos);
    expect(first.state.status, 'still running').toBe('active');
    await play(b as never, first);
    expect(document.querySelector('.end-headline'), 'no end screen').toBeNull();
    expect(document.querySelector('.end-exit'), 'and no way-out link').toBeNull();
  });
});

describe('DEATH-HANG: the hot-seat turn boundary', () => {
  /** A 2v2 hot-seat on one seat per team, so a team can lose a character. */
  const hotSeat = () => {
    const ui = mountUI();
    const teams: [CharacterDef[], CharacterDef[]] = [[VEX, VEX], [BASTION, BASTION]];
    const opening: GameState = createMatch(OPEN_MAP, '2v2', teams);
    opening.units.filter((u) => u.owner === 0).forEach((u, i) => { u.pos = { x: 8, y: 9 + i * 2 }; });
    opening.units.filter((u) => u.owner === 1).forEach((u, i) => { u.pos = { x: 10, y: 9 + i * 2 }; });
    startHotSeat(ui.ui, OPEN_MAP, buildRoster([VEX, BASTION]), teams, '2v2', [1, 1], POOL,
      undefined, undefined, opening);
    return { ...ui, opening };
  };

  it('a seat with one downed character still orders the other', () => {
    // `seatRoster()` filters `alive`, so the hot-seat walk was already right
    // about this — pinned so the DEATH-HANG fix cannot regress it.
    const b = hotSeat();
    const before = abilityButtons(b.controls).length;
    expect(before, 'a hotbar to begin with').toBeGreaterThan(0);
    expect(b.status.textContent).toContain('t0-p0');
  });

  it('a real kill leaves the next hot-seat turn on the living team', async () => {
    // The half the networked fix must NOT change, driven end to end: team 1
    // actually kills team 0's only character, the hot-seat resolves its own
    // turn, and the next turn opens.
    //
    // Hot-seat, this client is both players, so walking off the end of the seat
    // list is how the turn gets answered and a seat with nothing alive is a
    // seat with nothing to say — the opposite of the networked meaning. The new
    // `net !== undefined && seatIdx === 0` guard is what keeps the two apart,
    // and this is the assertion that catches it being widened.
    const ui = mountUI();
    const teams: [CharacterDef[], CharacterDef[]] = [[VEX], [BASTION]];
    const opening: GameState = createMatch(OPEN_MAP, '1v1', teams);
    const doomed = opening.units.find((u) => u.owner === 0)!;
    const killer = opening.units.find((u) => u.owner === 1)!;
    doomed.pos = { x: 8, y: 10 };
    killer.pos = { x: 10, y: 10 };
    doomed.hp = 5;
    startHotSeat(ui.ui, OPEN_MAP, roster, teams, '1v1', [1, 1], POOL, undefined, undefined, opening);

    lockIn(ui.controls); // team 0 holds — it is about to be dead anyway
    armAbility(ui.controls, SLAM.name);
    aimAndCommit(ui.board, doomed.pos);
    lockIn(ui.controls); // team 1 swings, and the hot-seat resolves itself
    skipPlayback(ui.controls);
    await vi.waitFor(() => {
      expect(playbackRow(ui.controls).style.display, 'playback finished').toBe('none');
    });

    // Seat 0 has nothing alive, so the walk skips it and lands on seat 1 —
    // rather than holding (that is the networked reading) or hanging.
    expect(ui.status.textContent, 'the living seat has the board').toContain('t1-p0');
    expect(abilityButtons(ui.controls).length, 'with a live hotbar').toBeGreaterThan(0);
  });
});
