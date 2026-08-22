// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDef, MapDef } from '@cards/engine';
import { netRoom, serverState, type NetRoom, type NetSeat } from './net-harness.js';
import { aimAndCommit, armAbility, lockIn, playbackRow, skipPlayback } from './app-harness.js';

/**
 * DEATH-HANG-2 — *"The Death bug and then not being able to lock-in and breaking
 * the game is still happening, playtest made it happen during sudden death."*
 *
 * DEATH-HANG (PR #94) fixed the case it was tested on: a downed networked seat
 * *holds* instead of auto-submitting. What nothing covered was **sudden death**,
 * and that is where a real playtest broke.
 *
 * **The repro comes first, because the last fix shipped without one and that is
 * why the bug came back.** Everything below drives real clients into a real
 * sudden death over a real `RoomHub` and then kills somebody.
 *
 * Sudden death is what makes the bad shape reachable at all. Outside it, a death
 * creates a kill differential and the match simply ends — nobody is waiting on
 * anybody. Inside it, the one death that does NOT end the match is a **double
 * KO**: both teams score, the scores stay tied, and play continues... with
 * whoever just died still owed a turn.
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

/** 20 HP, and a 20-damage shot: one hit kills, so a trade is exact. */
const glass = (id: string): CharacterDef => ({
  id,
  name: id,
  archetype: 'firepower',
  maxHp: 20,
  abilities: [shot],
  ultimate: { ...shot, id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] },
});

const A = glass('glass-a');
const B = glass('glass-b');
const C = glass('glass-c');
const D = glass('glass-d');

/** Facing rows, so every shot is a clean straight line at anybody opposite. */
const LANES: MapDef = {
  id: 'lanes', name: 'lanes', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 8, y: 8 }, { x: 8, y: 10 }, { x: 8, y: 12 }, { x: 8, y: 14 }],
    [{ x: 12, y: 8 }, { x: 12, y: 10 }, { x: 12, y: 12 }, { x: 12, y: 14 }],
  ],
};

const lockSeat = (seat: NetSeat): void => {
  for (let i = 0; i < Math.max(1, seat.client.net.unitIds.length); i++) lockIn(seat.controls);
};

/** Everyone holds; the turn resolves; every client finishes animating. */
const quietTurn = async (room: NetRoom): Promise<void> => {
  for (const seat of room.seats) lockSeat(seat);
  for (const seat of room.seats) skipPlayback(seat.controls);
  await vi.waitFor(() => {
    for (const seat of room.seats) {
      expect(playbackRow(seat.controls).style.display).toBe('none');
    }
  });
};

/**
 * Hold turns until the format's limit passes with the scores tied, which is
 * exactly the condition `resolveOutcome` turns into Sudden Death.
 *
 * Nobody has scored, so 0–0 is tied and the match does not end at the limit —
 * it keeps going. That is the state the playtest was in when it broke.
 */
const driveToSuddenDeath = async (room: NetRoom): Promise<void> => {
  for (let i = 0; i < 40 && serverState(room)?.suddenDeath !== true; i++) {
    await quietTurn(room);
  }
  expect(serverState(room)?.suddenDeath, 'the match reached sudden death').toBe(true);
};

/**
 * Let every client finish animating and come to rest.
 *
 * Needed after anything that resolves on the SERVER's schedule rather than on a
 * press: the server state moves the instant the turn resolves, the clients are
 * still playing it back, and a Lock In pressed into a playing-back client lands
 * on whatever window arrives next. Reading the turn counter mid-playback is how
 * a test invents an off-by-one that is really a timing artefact.
 */
const settle = async (room: NetRoom): Promise<void> => {
  for (const seat of room.seats) skipPlayback(seat.controls);
  await vi.waitFor(() => {
    for (const seat of room.seats) {
      expect(playbackRow(seat.controls).style.display).toBe('none');
    }
  });
};

/** Is this seat's board still taking a decision — i.e. can the player play? */
const canAct = (seat: NetSeat): boolean => {
  const lock = seat.controls.querySelector<HTMLButtonElement>('.hud-lockrow .hud-lock');
  return lock !== null && !lock.disabled;
};

/** Every living unit the server knows about, by owner. */
const aliveByTeam = (room: NetRoom): [number, number] => {
  const units = serverState(room)?.units ?? [];
  return [
    units.filter((u) => u.alive && u.owner === 0).length,
    units.filter((u) => u.alive && u.owner === 1).length,
  ];
};

beforeEach(() => { document.body.replaceChildren(); });

describe('DEATH-HANG-2: a double KO in sudden death', () => {
  /** Two players, one character each — the smallest board the shape fits on. */
  const duel = (): NetRoom => {
    const room = netRoom({
      format: '1v1', map: LANES, catalog: [A, B], picks: [[A.id], [B.id]],
    });
    room.start();
    return room;
  };

  /** Both sides shoot each other dead in the same Blast. */
  const trade = async (room: NetRoom): Promise<void> => {
    const [a, b] = room.seats;
    armAbility(a!.controls, shot.name);
    aimAndCommit(a!.board, { x: 12, y: 8 });
    lockSeat(a!);
    armAbility(b!.controls, shot.name);
    aimAndCommit(b!.board, { x: 8, y: 8 });
    lockSeat(b!);
    for (const seat of room.seats) skipPlayback(seat.controls);
    await vi.waitFor(() => {
      expect(serverState(room)!.kills, 'both scored').toEqual([1, 1]);
    });
  };

  it('the fixture really does reach sudden death, tied', async () => {
    // Asserted before anything is concluded from it: a test that never got
    // there would prove nothing about the state the playtest was in.
    const room = duel();
    await driveToSuddenDeath(room);
    expect(serverState(room)!.kills, 'tied, which is why it did not end').toEqual([0, 0]);
    expect(serverState(room)!.status).toBe('active');
  });

  it('and the trade really does leave nobody standing, with play continuing', async () => {
    // The one death in sudden death that does NOT end the match. Both shots are
    // locked in the same Decision and land in the same Blast (RULED — Mutual
    // damage), so 0–0 becomes 1–1, the tie holds, and the match carries on —
    // with nobody alive to carry it.
    const room = duel();
    await driveToSuddenDeath(room);
    await trade(room);
    expect(serverState(room)!.status, 'still tied, so still playing').toBe('active');
  });

  it('THE BUG: the turn nobody can take resolves itself, eating no press', async () => {
    // The wedge, and it is subtle enough to be worth stating exactly.
    //
    // DOWN-SEAT-SKIP removes a seat with no living character from the answering
    // set. When EVERY seat is down that set is empty, and `#allIn()` guards
    // `answering.length > 0` — so the room waits. The first player to press Hold
    // Position then puts themselves ALONE in the answering set and resolves the
    // whole turn by themselves; the second player's press, made for that same
    // turn, lands on the window that has already replaced it.
    //
    // On `main` this shows up as a stale lock sitting in the NEXT turn before
    // anybody has touched anything — which is why the assertion is on `locked`.
    const room = duel();
    await driveToSuddenDeath(room);
    await trade(room);

    expect(room.hub.locked, 'no press was consumed by the turn nobody could take')
      .toEqual([]);
    expect(aliveByTeam(room), 'the all-down turn resolved on its own, and they respawned')
      .toEqual([1, 1]);
  });

  it('and the turn after it still needs BOTH seats', async () => {
    // The half a player actually feels. With a press eaten, one seat's Lock In
    // resolves the turn alone and the other player never gets to plan — "not
    // being able to lock-in", exactly. A turn that waits for both is the proof
    // the press was not stolen.
    const room = duel();
    await driveToSuddenDeath(room);
    await trade(room);
    await vi.waitFor(() => { expect(aliveByTeam(room)).toEqual([1, 1]); });
    await settle(room);

    const at = serverState(room)!.turn;
    lockSeat(room.seats[0]!);
    expect(serverState(room)!.turn, 'one seat is not everybody').toBe(at);
    lockSeat(room.seats[1]!);
    expect(serverState(room)!.turn, 'and now it goes').toBe(at + 1);
  });

  it('and both clients are live again on the far side of it', async () => {
    // A room that resolves but leaves its clients unable to press anything is
    // the same outage with a moving turn counter.
    const room = duel();
    await driveToSuddenDeath(room);
    await trade(room);
    await settle(room);
    for (const seat of room.seats) {
      expect(canAct(seat), `${seat.name} is taking orders again`).toBe(true);
    }
  });

  it('an abandoned all-down room stops ticking instead of running forever', async () => {
    // QUOTA-RUNAWAY, which the fix had to not undo. Sudden death has no exit
    // without a kill, so a match everybody has left must not go on resolving
    // hold-position turns — each one a storage write, until the day's row-write
    // allowance is gone and every room in the account fails to create.
    //
    // The window that was already open still resolves when the alarm finds it
    // (that is `expire()`, unchanged). What must not happen is a NEW window
    // opening behind it: with no sockets attached, `#sendDecision` opens none
    // and `#resolveIfNobodyCanAct` declines, so the room comes to a stop.
    const room = duel();
    await driveToSuddenDeath(room);
    await trade(room);
    await vi.waitFor(() => { expect(aliveByTeam(room)).toEqual([1, 1]); });
    await settle(room);

    for (const seat of room.seats) seat.wire.drop();
    room.now.ms += 10 * 60 * 1000;
    room.hub.expire(); // the window that was open when everybody left
    const frozen = serverState(room)!.turn;

    for (let i = 0; i < 5; i++) {
      room.now.ms += 10 * 60 * 1000;
      room.hub.expire();
    }
    expect(serverState(room)!.turn, 'and then it stays where it is').toBe(frozen);
  });
});

describe('DEATH-HANG-2: one seat down, the others still playing', () => {
  /**
   * The asymmetric 3-player 2v2: two seats share team 0, one runs both of team
   * 1's characters. The *partial* shape — one seat with nothing to order while
   * the match carries on around it, which is DOWN-SEAT-SKIP's own case and must
   * keep working exactly as it did.
   */
  const asymmetric = (): NetRoom => {
    const room = netRoom({
      format: '2v2', map: LANES, catalog: [A, B, C, D],
      picks: [[A.id], [C.id, D.id], [B.id]],
    });
    room.start();
    return room;
  };

  it('a seat whose only character dies in sudden death does not wedge the room', async () => {
    const room = asymmetric();
    await driveToSuddenDeath(room);
    const [shareA, solo, shareB] = room.seats;

    armAbility(shareA!.controls, shot.name);
    aimAndCommit(shareA!.board, { x: 12, y: 8 });
    lockSeat(shareA!);
    armAbility(solo!.controls, shot.name);
    aimAndCommit(solo!.board, { x: 8, y: 8 });
    lockSeat(solo!);
    lockSeat(shareB!);
    for (const seat of room.seats) skipPlayback(seat.controls);

    await vi.waitFor(() => {
      expect(serverState(room)!.kills, 'a trade, so the scores stay tied').toEqual([1, 1]);
    });
    expect(serverState(room)!.status, 'still playing').toBe('active');

    // Somebody can still act, so this turn is NOT self-resolved — it waits for
    // the seats that have a turn to take, which is DOWN-SEAT-SKIP unchanged.
    const at = serverState(room)!.turn;
    for (const seat of room.seats) lockSeat(seat);
    for (const seat of room.seats) skipPlayback(seat.controls);
    await vi.waitFor(() => {
      expect(serverState(room)!.turn, 'the turn went through').toBe(at + 1);
    });
    for (const seat of room.seats) {
      expect(canAct(seat), `${seat.name} is still live`).toBe(true);
    }
  });
});
