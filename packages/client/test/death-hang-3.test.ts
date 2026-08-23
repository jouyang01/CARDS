// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDef, MapDef } from '@cards/engine';
import { netRoom, serverState, type NetRoom, type NetSeat } from './net-harness.js';
import { aimAndCommit, armAbility, lockIn, playbackRow, skipPlayback } from './app-harness.js';

/**
 * DEATH-HANG-3 — *"Ravok died to a Lumen attack. Timer Vanished. The 'winning'
 * team's lock in froze."*
 *
 * DEATH-HANG-2 fixed the turn **nobody** can take: a double KO leaves both teams
 * down, the tie holds, and play continues with a window nobody can use. This is
 * a different turn state and its fix does not reach it. A **single** kill in
 * sudden death gives the killer a lead, and a lead past the turn limit **ends
 * the match** (SUDDEN-DEATH, edge-cases) — at which point `#resolveIfNobodyCanAct`
 * declines by its own first line (`status !== 'active'`) and the server clears
 * the clock, which is the *"Timer Vanished"* the owner saw.
 *
 * So the question this file asks is the one the backlog asks: **does the winning
 * client reach the victory screen, or does it sit on a dead Lock In?** The
 * suspect named in the spec notes is ordering — a resolution that carries both a
 * downed seat and the end of the match, where the downed-seat hold runs before
 * the game-over branch and the winner gets a hold instead of a win.
 *
 * The reproduction comes first and is deliberately not assumed to fail.
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

/** 20 HP against a 20-damage shot: one hit kills, so a kill is exact. */
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

/** Facing rows, so every shot is a clean straight line at somebody opposite. */
const LANES: MapDef = {
  id: 'lanes', name: 'lanes', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 8, y: 8 }, { x: 8, y: 10 }, { x: 8, y: 12 }, { x: 8, y: 14 }],
    [{ x: 12, y: 8 }, { x: 12, y: 10 }, { x: 12, y: 12 }, { x: 12, y: 14 }],
  ],
};

/** A seat owes one press per character it runs, not one per seat. */
const lockSeat = (seat: NetSeat): void => {
  for (let i = 0; i < Math.max(1, seat.client.net.unitIds.length); i++) lockIn(seat.controls);
};

const settle = async (room: NetRoom): Promise<void> => {
  for (const seat of room.seats) skipPlayback(seat.controls);
  await vi.waitFor(() => {
    for (const seat of room.seats) {
      expect(playbackRow(seat.controls).style.display).toBe('none');
    }
  });
};

/** Everyone holds; the turn resolves; every client finishes animating. */
const quietTurn = async (room: NetRoom): Promise<void> => {
  for (const seat of room.seats) lockSeat(seat);
  await settle(room);
};

/**
 * Hold turns until the format's limit passes with the scores tied — exactly the
 * condition `resolveOutcome` turns into Sudden Death. Nobody has scored, so 0–0
 * is tied, the match does not end at the limit, and play continues.
 */
const driveToSuddenDeath = async (room: NetRoom): Promise<void> => {
  for (let i = 0; i < 40 && serverState(room)?.suddenDeath !== true; i++) {
    await quietTurn(room);
  }
  expect(serverState(room)?.suddenDeath, 'the match reached sudden death').toBe(true);
};

/** The victory/defeat headline this seat is looking at, if it has one. */
const outcomeOf = (seat: NetSeat): string | undefined =>
  seat.root.querySelector<HTMLElement>('.end-headline')?.dataset['outcome'];

/**
 * Can the player actually press this — is it on screen *and* enabled?
 *
 * Visibility is half the question and the half a `disabled` check misses:
 * `hud.clear()` retires the HUD by hiding its rows, so every button survives in
 * the DOM, enabled, behind a `display: none`. A player cannot click those, and a
 * test that counted them would demand the end screen dismantle the HUD rather
 * than put it away.
 */
const pressable = (el: Element | null): boolean => {
  if (el === null) return false;
  if (el instanceof HTMLButtonElement && el.disabled) return false;
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (node instanceof HTMLElement && node.style.display === 'none') return false;
  }
  return true;
};

/** Is this seat's board still taking a decision — i.e. can the player play? */
const canAct = (seat: NetSeat): boolean =>
  pressable(seat.controls.querySelector('.hud-lockrow .hud-lock'));

/** Everything the seat could still press to send an order. */
const liveControls = (seat: NetSeat): number =>
  [...seat.controls.querySelectorAll('.hud-lock, .hud-ability, .hud-move')]
    .filter((el) => pressable(el)).length;

beforeEach(() => { document.body.replaceChildren(); });

describe('DEATH-HANG-3: the fixture reaches the owner’s exact turn state', () => {
  /** Two players, one character each: the smallest board the shape fits on. */
  const duel = (): NetRoom => {
    const room = netRoom({
      format: '1v1', map: LANES, catalog: [A, B], picks: [[A.id], [B.id]],
    });
    room.start();
    return room;
  };

  /** Team 0 shoots team 1 dead. One kill, no trade — so somebody LEADS. */
  const execute = async (room: NetRoom): Promise<void> => {
    const [killer, victim] = room.seats;
    armAbility(killer!.controls, shot.name);
    aimAndCommit(killer!.board, { x: 12, y: 8 });
    lockSeat(killer!);
    lockSeat(victim!);
    for (const seat of room.seats) skipPlayback(seat.controls);
    await vi.waitFor(() => {
      expect(serverState(room)!.kills, 'one team scored and the other did not').toEqual([1, 0]);
    });
  };

  it('sudden death, tied, with the match still running', async () => {
    // Asserted before anything is concluded from it: a fixture that stopped at
    // the turn limit would be testing an ordinary win, which was never broken.
    const room = duel();
    await driveToSuddenDeath(room);
    expect(serverState(room)!.kills, 'tied, which is why it did not end').toEqual([0, 0]);
    expect(serverState(room)!.status).toBe('active');
  });

  it('and a single kill there ends the match rather than continuing it', async () => {
    // The half that separates this from DEATH-HANG-2. A trade keeps the tie and
    // play continues; ONE kill breaks it, and past the turn limit a lead is a
    // win — so the turn that downs a seat is also the turn that ends the match,
    // which is the state the owner was in.
    const room = duel();
    await driveToSuddenDeath(room);
    await execute(room);
    expect(serverState(room)!.status, 'the match is over').not.toBe('active');
    expect(serverState(room)!.winner, 'and the killer won it').toBe(0);
  });

  it('the server stops the clock and opens no new window', async () => {
    // *"Timer Vanished."* That part is correct and deliberate — a finished match
    // has nothing to decide — so it is pinned rather than fixed. It also means
    // the client cannot be waiting for a window that is coming.
    const room = duel();
    await driveToSuddenDeath(room);
    await execute(room);
    expect(room.hub.deadline, 'no deadline on a finished match').toBeUndefined();
    expect(room.hub.locked, 'and nobody is queued for a turn that will not come').toEqual([]);
  });
});

describe('DEATH-HANG-3: both clients reach an end screen', () => {
  const duel = (): NetRoom => {
    const room = netRoom({
      format: '1v1', map: LANES, catalog: [A, B], picks: [[A.id], [B.id]],
    });
    room.start();
    return room;
  };

  const execute = async (room: NetRoom): Promise<void> => {
    const [killer, victim] = room.seats;
    armAbility(killer!.controls, shot.name);
    aimAndCommit(killer!.board, { x: 12, y: 8 });
    lockSeat(killer!);
    lockSeat(victim!);
    for (const seat of room.seats) skipPlayback(seat.controls);
    await vi.waitFor(() => {
      expect(serverState(room)!.status).not.toBe('active');
    });
    await settle(room);
  };

  it('THE BUG: the WINNING client shows Victory, not a frozen Lock In', async () => {
    // The owner's sentence, as an assertion. The winning seat's own character is
    // alive and its opponent's is down — so if the downed-seat hold or a fresh
    // Decision window can pre-empt the game-over branch, this is where it shows.
    const room = duel();
    await driveToSuddenDeath(room);
    await execute(room);

    const [winner] = room.seats;
    expect(outcomeOf(winner!), 'the winner is told they won').toBe('won');
    expect(canAct(winner!), 'and has nothing left to lock in').toBe(false);
    expect(liveControls(winner!), 'the HUD is cleared, not left armed').toBe(0);
  });

  it('and the LOSING client shows Defeat rather than hanging on a dead board', async () => {
    // The other half. The losing seat is the one that is *down*, which is the
    // branch DEATH-HANG-2 taught to hold — it must not hold here, because there
    // is no next turn to hold for.
    const room = duel();
    await driveToSuddenDeath(room);
    await execute(room);

    const [, loser] = room.seats;
    expect(outcomeOf(loser!), 'the loser is told they lost').toBe('lost');
    expect(canAct(loser!), 'and is not still being asked for orders').toBe(false);
  });

  it('the end screen is the LAST thing either client does', async () => {
    // A game-over that is immediately overwritten by a repaint is the same
    // outage with an extra frame in it. Nothing the room does afterwards — an
    // expired alarm, a late frame — may put a board back in front of the result.
    const room = duel();
    await driveToSuddenDeath(room);
    await execute(room);

    room.now.ms += 10 * 60 * 1000;
    room.hub.expire();
    await settle(room);
    for (const seat of room.seats) {
      expect(outcomeOf(seat), `${seat.name} is still on its end screen`).toBeDefined();
      expect(canAct(seat), `${seat.name} is still not taking orders`).toBe(false);
    }
  });
});

describe('DEATH-HANG-3: the asymmetric three-player shape', () => {
  /**
   * Two seats on team 0, one seat running both of team 1's characters — the
   * shape where a downed SEAT and a downed TEAM are different things. Team 1's
   * seat loses one of its two characters and keeps playing the other, so the
   * hold branch and the game-over branch are genuinely both in play.
   */
  const asymmetric = (): NetRoom => {
    const room = netRoom({
      format: '2v2', map: LANES, catalog: [A, B, C, D],
      picks: [[A.id], [C.id, D.id], [B.id]],
    });
    room.start();
    return room;
  };

  it('a kill that ends the match ends it for all three clients', async () => {
    // 2v2 needs `killsToWin` 4 outright, so the only way a single kill ends this
    // is sudden death — which is exactly the owner's case, at the player count
    // the game actually ships at.
    const room = asymmetric();
    await driveToSuddenDeath(room);
    const [shareA, solo, shareB] = room.seats;

    armAbility(shareA!.controls, shot.name);
    aimAndCommit(shareA!.board, { x: 12, y: 8 });
    lockSeat(shareA!);
    lockSeat(solo!);
    lockSeat(shareB!);
    for (const seat of room.seats) skipPlayback(seat.controls);

    await vi.waitFor(() => {
      expect(serverState(room)!.status, 'a lead in sudden death ends it').not.toBe('active');
    });
    await settle(room);

    expect(serverState(room)!.winner, 'team 0 took it').toBe(0);
    expect(outcomeOf(shareA!), 'the killer sees Victory').toBe('won');
    expect(outcomeOf(shareB!), 'and so does their teammate, who did nothing').toBe('won');
    expect(outcomeOf(solo!), 'the seat that lost a character sees Defeat').toBe('lost');
    for (const seat of room.seats) {
      expect(canAct(seat), `${seat.name} has nothing left to press`).toBe(false);
    }
  });
});
