// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDef, MapDef } from '@cards/engine';
import {
  agreement, boardOf, netRoom, serverState, turnOf, type NetRoom, type NetSeat,
} from './net-harness.js';
import {
  aimAndCommit, armAbility, click, lockIn, moveButton, playbackRow, skipPlayback,
} from './app-harness.js';
import aegis from '../../../data/characters/aegis.json';
import vex from '../../../data/characters/vex.json';

/**
 * NET-E2E — the networked loop, driven by **two real clients** at once.
 *
 * The item has been flagged for four sessions and the reason keeps recurring:
 * DEATH-HANG was a networking-wiring bug (a downed seat froze the *client*, not
 * the engine), and session-9 OQ #4 — does a rotated wall's `aimStep` survive the
 * relay — has twice been answered "verified by reading the protocol." Reading
 * the protocol is how a field gets dropped at the order-build seam and shipped
 * green, which is exactly what WALL-CAST-FIX turned out to be.
 *
 * So this drives both ends: two `RoomClient`s over a loopback into one real
 * `RoomHub`, each running a real `startHotSeat` on its own DOM, playing real
 * turns through the real HUD. The three scenarios are the ones that have bitten
 * or have never been checked.
 *
 * **On "the same resolved state":** the two clients are deliberately *not* sent
 * the same payload — M3-HIDDEN filters each to its own team, and a client that
 * saw the whole board would be the bug. So agreement is asserted where the two
 * views overlap (`agreement()`), plus the turn number, plus each seat's own
 * units against the server's authority. See `net-harness.ts`.
 */

const shot = {
  id: 'shot',
  name: 'Shot',
  phase: 'blast' as const,
  shape: 'line' as const,
  range: 10,
  cooldown: 0,
  energyGain: 8,
  effects: [{ kind: 'damage' as const, amount: 20 }],
  description: 'A plain line shot.',
};

/**
 * Synthetic content for the scenarios that need a *specific* board.
 *
 * The roster is real content and the roster's numbers move (TTK moved all nine
 * bars last session); a test that needs "one shot kills" has to own its own
 * numbers or it is a balance assertion wearing a networking hat. `glass` dies to
 * one `shot`; `tank` does not.
 */
const character = (id: string, maxHp: number): CharacterDef => ({
  id,
  name: id,
  archetype: 'firepower',
  maxHp,
  abilities: [shot],
  ultimate: { ...shot, id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] },
});

const TANK = character('tank', 100);
const GLASS = character('glass', 20);

/** Two spawns four apart on an open field, so a range-10 line always connects. */
const FIELD: MapDef = {
  id: 'field', name: 'field', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 8, y: 10 }, { x: 8, y: 12 }], [{ x: 12, y: 10 }, { x: 12, y: 12 }]],
};

/** A started 1v1: two players, one character each, boards up. */
const duel = (theirs: CharacterDef = TANK): NetRoom => {
  const room = netRoom({
    format: '1v1',
    map: FIELD,
    catalog: [TANK, GLASS],
    picks: [['tank'], [theirs.id]],
  });
  room.start();
  return room;
};

/** Everyone locks in, the server resolves, and both clients finish animating. */
const playTurn = async (room: NetRoom): Promise<void> => {
  for (const seat of room.seats) lockIn(seat.controls);
  for (const seat of room.seats) skipPlayback(seat.controls);
  await vi.waitFor(() => {
    for (const seat of room.seats) {
      expect(playbackRow(seat.controls).style.display, `${seat.name} finished playback`).toBe('none');
    }
  });
};

/** Is this seat's board taking orders — i.e. can the player still play? */
const canAct = (seat: NetSeat): boolean => {
  const lock = seat.controls.querySelector<HTMLButtonElement>('.hud-lockrow .hud-lock');
  return lock !== null && !lock.disabled;
};

beforeEach(() => { document.body.replaceChildren(); });

describe('NET-E2E: two clients, one room, one match', () => {
  it('both boards come up, on their own seats', () => {
    const room = duel();
    const [a, b] = room.seats;
    expect(a!.controls.querySelectorAll('.hud-ability').length, 'A has a hotbar').toBeGreaterThan(0);
    expect(b!.controls.querySelectorAll('.hud-ability').length, 'B has one too').toBeGreaterThan(0);
    expect(serverState(room), 'and the server has a match').toBeDefined();
  });

  it('a turn submitted by both seats resolves once and reaches both', async () => {
    // The loop itself, which nothing in CI has ever executed: lock in on two
    // clients, one resolution, two deliveries.
    const room = duel();
    const before = turnOf(room.seats[0]!);
    await playTurn(room);
    expect(turnOf(room.seats[0]!), 'A advanced').toBe(before! + 1);
    expect(turnOf(room.seats[1]!), 'B advanced with it').toBe(before! + 1);
    expect(serverState(room)!.turn, 'and the server agrees').toBe(before! + 1);
  });

  it('and the two views agree wherever they overlap', async () => {
    const room = duel();
    await playTurn(room);
    const { shared, disagreements } = agreement(room.seats[0]!, room.seats[1]!);
    expect(shared.length, 'the views actually overlap — otherwise this is vacuous')
      .toBeGreaterThan(0);
    expect(disagreements).toEqual([]);
  });

  it('over several turns, not just the first', async () => {
    // Turn 1 is the one turn every networked test already reached. The bugs
    // this exists for live in the turns after it — TIMER-EVERY-PHASE was
    // exactly "turn 2's clock never started".
    const room = duel();
    for (let i = 0; i < 3; i++) await playTurn(room);
    expect(turnOf(room.seats[0]!)).toBe(4);
    expect(turnOf(room.seats[1]!)).toBe(4);
    expect(agreement(room.seats[0]!, room.seats[1]!).disagreements).toEqual([]);
    for (const seat of room.seats) {
      expect(canAct(seat), `${seat.name} can still play`).toBe(true);
    }
  });
});

describe('NET-E2E scenario 1 — a death mid-match (DEATH-HANG, networked)', () => {
  /**
   * The bug that started Path A: a unit went down and the *client* stopped
   * taking orders. It was fixed and covered — against `recordingNet`, a fake
   * that plays the server's part on one machine. Whether the real server and the
   * real client agree about a downed seat has never been executed.
   */
  const kill = async (room: NetRoom): Promise<void> => {
    armAbility(room.seats[0]!.controls, shot.name);
    aimAndCommit(room.seats[0]!.board, { x: 12, y: 10 });
    await playTurn(room);
  };

  it('the shot actually kills — the fixture before anything is concluded', async () => {
    const room = duel(GLASS);
    await kill(room);
    const victim = serverState(room)!.units.find((u) => u.owner === 1)!;
    expect(victim.alive, 'glass has 20 HP and took a 20 shot').toBe(false);
    expect(serverState(room)!.kills[0], 'and it is on the scoreboard').toBe(1);
  });

  it('the killer\'s client keeps playing', async () => {
    const room = duel(GLASS);
    await kill(room);
    expect(canAct(room.seats[0]!), 'A is still taking orders').toBe(true);
  });

  it('and so does the downed seat — it is not frozen, just empty', async () => {
    // DEATH-HANG itself. The downed client has nothing to order, which is not
    // the same as having nothing to do: it must keep receiving turns, so it can
    // watch the match it is still in and act the moment it respawns.
    const room = duel(GLASS);
    const before = turnOf(room.seats[1]!);
    await kill(room);
    expect(turnOf(room.seats[1]!), 'B saw the turn it lost').toBe(before! + 1);
    expect(playbackRow(room.seats[1]!.controls).style.display, 'and is not stuck animating')
      .toBe('none');
    // "Not frozen" is literal: the board is still live and the button still
    // takes a press. A seat with nothing to order can still lock in an empty
    // turn, which is what stops the match waiting on a player who cannot move.
    expect(canAct(room.seats[1]!), 'the HUD is still live').toBe(true);
  });

  it('the match goes on without waiting for the seat that has nobody', async () => {
    // DOWN-SEAT-SKIP over the wire: the server must resolve on the living seat
    // alone. If it waited for a lock-in that can never come, the match hangs —
    // which is the networked shape of the original bug.
    const room = duel(GLASS);
    await kill(room);
    const after = turnOf(room.seats[0]!);
    lockIn(room.seats[0]!.controls);
    for (const seat of room.seats) skipPlayback(seat.controls);
    await vi.waitFor(() => {
      expect(turnOf(room.seats[0]!), 'the turn resolved on one seat').toBe(after! + 1);
    });
    expect(turnOf(room.seats[1]!), 'and the downed seat got it too').toBe(after! + 1);
  });

  it('and when it respawns, both clients see it come back', async () => {
    // The other end of the hang: coming back. RESPAWN_TURNS is 1 and the turn
    // it died does not count, so one more turn brings it in on a spawn square —
    // and the seat that lost it must be rendering that, not a stale corpse.
    const room = duel(GLASS);
    await kill(room);
    expect(serverState(room)!.units.find((u) => u.owner === 1)!.alive, 'still down').toBe(false);

    await playTurn(room);

    const back = serverState(room)!.units.find((u) => u.owner === 1)!;
    expect(back.alive, 'it respawned').toBe(true);
    expect(room.seats[1]!.client.net.unitIds, 'and B is ordering it again').toContain(back.unitId);
    const drawn = boardOf(room.seats[1]!).get(back.unitId);
    expect(drawn?.hp, 'B is drawing a live unit at full HP').toBe(GLASS.maxHp);
    expect(agreement(room.seats[0]!, room.seats[1]!).disagreements,
      'both clients see the same respawned unit').toEqual([]);
  });
});

describe('NET-E2E scenario 2 — a seat drops and comes back', () => {
  /**
   * M3-RECONNECT has server tests (the seat is held, the ticket is honoured) and
   * client tests (the ticket is remembered, the banner is right). What neither
   * covers is the thing a player experiences: the board coming back up on a
   * fresh socket, mid-match, playable.
   */
  it('the match survives the drop — the other seat keeps playing', async () => {
    const room = duel();
    await playTurn(room);
    const at = turnOf(room.seats[0]!);
    room.seats[1]!.wire.drop();

    lockIn(room.seats[0]!.controls);
    skipPlayback(room.seats[0]!.controls);
    await vi.waitFor(() => {
      expect(turnOf(room.seats[0]!), 'the turn went through without B').toBe(at! + 1);
    });
  });

  it('and the returning seat gets its board back, on the current turn', async () => {
    // The reclaim, end to end: a new socket, the old seat id, and a controller
    // that was never told about the turns it missed — it is handed the state the
    // server has now.
    const room = duel();
    await playTurn(room);
    room.seats[1]!.wire.drop();
    lockIn(room.seats[0]!.controls);
    skipPlayback(room.seats[0]!.controls);
    await vi.waitFor(() => {
      expect(serverState(room)!.turn).toBe(3);
    });

    const back = room.rejoin(1, 'sock-1b');
    expect(back.controls.querySelectorAll('.hud-ability').length, 'a hotbar came back')
      .toBeGreaterThan(0);
    expect(turnOf(back), 'on the turn the match is actually on').toBe(serverState(room)!.turn);
    expect(back.client.net.unitIds.length, 'ordering its own characters again')
      .toBeGreaterThan(0);
  });

  it('and it can play the very next turn, in step with the seat that stayed', async () => {
    // The assertion that makes the two above worth having: a board that renders
    // but cannot submit is the same outage with a nicer picture.
    const room = duel();
    await playTurn(room);
    room.seats[1]!.wire.drop();
    lockIn(room.seats[0]!.controls);
    skipPlayback(room.seats[0]!.controls);
    await vi.waitFor(() => { expect(serverState(room)!.turn).toBe(3); });

    room.rejoin(1, 'sock-1b');
    const at = serverState(room)!.turn;
    await playTurn(room);
    expect(serverState(room)!.turn, 'the reconnected seat submitted a real turn').toBe(at + 1);
    expect(turnOf(room.seats[0]!)).toBe(at + 1);
    expect(turnOf(room.seats[1]!)).toBe(at + 1);
    const { shared, disagreements } = agreement(room.seats[0]!, room.seats[1]!);
    expect(shared.length, 'and the two views are back in sync').toBeGreaterThan(0);
    expect(disagreements).toEqual([]);
  });
});

describe('NET-E2E scenario 3 — a rotated Warding Wall crosses the wire', () => {
  /**
   * Session-9 OQ #4, twice deferred: does a placed shape's **rotation** survive
   * the relay? It has been answered "verified by reading the protocol" both
   * times — and WALL-CAST-FIX is what happens when a field is verified by
   * reading rather than by driving. That bug dropped `aimStep` at the
   * order-build seam and shipped green past twenty-four engine tests.
   *
   * A wall's aim is the one aim in the game that is **two values**: an anchor
   * square and a cardinal. `aimIsLegal` refuses a stepless wall outright, so a
   * relay that lost the step would not corrupt the wall — it would silently
   * produce no wall at all, and the turn would look like Aegis did nothing.
   *
   * As in WALL-CAST-FIX's hot-seat test, the assertion is **HP the enemy lost**,
   * not `traps`: `lifetime: 1` sweeps the hazard at the same turn's end, so a
   * post-turn trap count reads zero whether the wall was cast or not.
   */
  const AEGIS = aegis as unknown as CharacterDef;
  const VEX = vex as unknown as CharacterDef;
  const WALL = AEGIS.abilities.find((a) => a.id === 'warding_wall')!;
  const WALL_DAMAGE = WALL.effects.find((e) => e.kind === 'trap')!.amount!;

  /** Aegis at (10,10), the enemy at (13,13) — the WALL-CAST-FIX geometry. */
  const LANE: MapDef = {
    id: 'lane', name: 'lane', width: 21, height: 21, walls: [], cover: [], brush: [],
    spawns: [[{ x: 10, y: 10 }], [{ x: 13, y: 13 }]],
  };

  const siege = (): NetRoom => {
    const room = netRoom({
      format: '1v1', map: LANE, catalog: [AEGIS, VEX], picks: [['aegis'], ['vex']],
    });
    room.start();
    return room;
  };

  const rotateButtons = (seat: NetSeat): HTMLButtonElement[] =>
    [...seat.controls.querySelectorAll<HTMLButtonElement>('.hud-rotate')];

  const enemyUnit = (room: NetRoom) => serverState(room)!.units.find((u) => u.owner === 1)!;

  /**
   * Aegis raises the wall at (12,10) on `rotation`, the enemy walks NORTH up the
   * x=13 column from (13,13) to (13,9) — crossing (13,10), which is one tile of
   * the EASTWARD wall and no tile of the southward one.
   */
  const siegeTurn = async (room: NetRoom, rotation?: number): Promise<number> => {
    const before = enemyUnit(room).hp;
    armAbility(room.seats[0]!.controls, WALL.name);
    if (rotation !== undefined) click(rotateButtons(room.seats[0]!)[rotation]);
    aimAndCommit(room.seats[0]!.board, { x: 12, y: 10 });

    click(moveButton(room.seats[1]!.controls, 'Move'));
    aimAndCommit(room.seats[1]!.board, { x: 13, y: 9 });

    await playTurn(room);
    return before - enemyUnit(room).hp;
  };

  it('the fixture really does walk the enemy across the wall line', async () => {
    // The control. Aegis casts nothing; the identical walk costs nothing — so
    // the HP the tests below read is the wall and not the walking.
    const room = siege();
    click(moveButton(room.seats[1]!.controls, 'Move'));
    aimAndCommit(room.seats[1]!.board, { x: 13, y: 9 });
    const before = enemyUnit(room).hp;
    await playTurn(room);
    expect(enemyUnit(room).pos, 'the enemy really moved').toEqual({ x: 13, y: 9 });
    expect(before - enemyUnit(room).hp, 'and nothing hurt them').toBe(0);
  });

  it('the default rotation relays and the wall bites', async () => {
    // `aimFor` supplies WALL_ROTATIONS[0] when the player never touches the
    // rotate row, which is what most first casts look like. A relay that only
    // carried an *explicitly chosen* rotation would leave this dead.
    const room = siege();
    expect(await siegeTurn(room), 'the wall was there and it bit').toBe(WALL_DAMAGE);
  });

  it('and the rotation the player PICKED is the one that lands on the far client', async () => {
    // Not "a wall arrived" — the *right* wall. Turned south it runs down x=12,
    // so the x=13 column the enemy walks is bare. This is the assertion that
    // fails if `aimStep` is dropped, defaulted, or re-derived anywhere between
    // the two machines.
    const room = siege();
    expect(await siegeTurn(room, 1), 'x=13 is not on a southward wall').toBe(0);
  });

  it('…and the southward wall bites where it actually runs', async () => {
    // The other half of that claim: the wall did not vanish, it turned.
    const room = siege();
    const before = enemyUnit(room).hp;
    armAbility(room.seats[0]!.controls, WALL.name);
    click(rotateButtons(room.seats[0]!)[1]);
    aimAndCommit(room.seats[0]!.board, { x: 12, y: 10 });
    click(moveButton(room.seats[1]!.controls, 'Move'));
    aimAndCommit(room.seats[1]!.board, { x: 12, y: 12 }); // onto the column itself
    await playTurn(room);
    expect(before - enemyUnit(room).hp, 'the southward wall is real').toBe(WALL_DAMAGE);
  });

  it('and both clients render the same outcome', async () => {
    // The relay's other direction: the seat that did NOT cast has to see the
    // damage too, from its own filtered payload.
    const room = siege();
    await siegeTurn(room);
    const victim = enemyUnit(room);
    const { disagreements } = agreement(room.seats[0]!, room.seats[1]!);
    expect(disagreements).toEqual([]);
    expect(boardOf(room.seats[1]!).get(victim.unitId)?.hp, 'the victim sees its own HP')
      .toBe(victim.hp);
  });
});
