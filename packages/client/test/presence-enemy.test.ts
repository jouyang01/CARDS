// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { CharacterDef, MapDef } from '@cards/engine';
import { createMatch } from '@cards/engine';
import type { Seat } from '@cards/server/room';
import type { RoomView } from '@cards/server/protocol';
import { RoomClient } from '../src/net.js';
import { enemyProgress } from '../src/lobby.js';
import { createLobbyScreen } from '../src/lobby-screen.js';
import { scoreReadout, topbar } from '../src/scoreboard.js';
import { presenceOf } from '../src/presence.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * NET-PRESENCE-ENEMY — how many of them are still there.
 *
 * NET-PRESENCE-UI named and marked *own-team* absences; across the team line the
 * ruled shape is a **count and nothing else** (M3-LOCKLIST, BLIND-PICK), exactly
 * like the lock count already is. Which opponent dropped is a durable handle on
 * one specific person and stays out; how many of them are there is coarse status
 * — and a lobby that hid it would leave you waiting on somebody who has gone.
 *
 * So the two claims here are: the count is **right**, and it is **all** that
 * crosses. The second is the one worth a test, because it is the one a careless
 * `.map` over `net.room.seats` would break.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 9 }, { x: 1, y: 11 }], [{ x: 19, y: 9 }, { x: 19, y: 11 }]],
};

const seat = (over: Partial<Seat> & { seatId: string }): Seat => ({
  team: 0, name: over.seatId, unitIds: [], picks: [], ready: false, connected: true, missedTurns: 0, ...over,
});

const room = (seats: Seat[]): RoomView => ({
  code: 'WXYZ', format: '2v2', seats, turn: 0, canStart: false, started: false, locked: [],
});

/** A client folded from real frames, so what the screen reads is what the wire says. */
const clientOn = (seats: Seat[], mine: string, lobbyOver: Record<string, unknown> = {}) => {
  const client = new RoomClient({ send: () => {}, close: () => {} });
  const view = room(seats);
  const me = seats.find((s) => s.seatId === mine)!;
  client.receive(JSON.stringify({ type: 'joined', seat: me, room: view }));
  client.receive(JSON.stringify({
    type: 'lobby',
    room: view,
    lobby: {
      picks: {}, owed: { [mine]: 1 }, ready: [], enemyReady: 1,
      enemyOf: seats.filter((s) => s.team !== me.team).length,
      canStart: false,
      ...lobbyOver,
    },
  }));
  return client;
};

/**
 * Seat ids are deliberately distinctive strings rather than single letters: the
 * leak test below asserts on rendered text, and a one-character id hides inside
 * ordinary words ("y" is in "ready"), which would make it pass for free.
 */
const TEAM = [
  seat({ seatId: 'seat-ada', name: 'Ada', team: 0 }),
  seat({ seatId: 'seat-yan', name: 'Yan', team: 1 }),
  seat({ seatId: 'seat-zed', name: 'Zed', team: 1 }),
];

describe('NET-PRESENCE-ENEMY: the count', () => {
  it('is everybody when everybody is there', () => {
    const progress = enemyProgress(clientOn(TEAM, 'seat-ada').net);
    expect(progress).toMatchObject({ of: 2, present: 2 });
  });

  it('drops by one when one of them goes', () => {
    const dropped = TEAM.map((s) => (s.seatId === 'seat-zed' ? { ...s, connected: false } : s));
    expect(enemyProgress(clientOn(dropped, 'seat-ada').net)).toMatchObject({ of: 2, present: 1 });
  });

  it('counts THEIR seats, not the room — my own absence is not their problem', () => {
    // The obvious wrong implementation is `seats.filter(s => !s.connected).length`
    // over the whole room, which would report the other side short because *I*
    // blinked.
    const mineGone = TEAM.map((s) => (s.seatId === 'seat-ada' ? { ...s, connected: false } : s));
    expect(enemyProgress(clientOn(mineGone, 'seat-ada').net)).toMatchObject({ of: 2, present: 2 });
  });

  it('says "all of them" while this client cannot tell', () => {
    // Before a seat arrives there is nothing to compare against, and the safe
    // direction is silence: claiming somebody is missing when you do not know is
    // worse than not mentioning presence at all.
    const fresh = new RoomClient({ send: () => {}, close: () => {} });
    const progress = enemyProgress(fresh.net);
    expect(progress.present).toBe(progress.of);
  });

  it('and it is a NUMBER — nothing about who', () => {
    const dropped = TEAM.map((s) => (s.seatId === 'seat-zed' ? { ...s, connected: false } : s));
    const progress = enemyProgress(clientOn(dropped, 'seat-ada').net);
    expect(typeof progress.present).toBe('number');
    expect(Object.keys(progress).sort(), 'three counts, no lists').toEqual(['of', 'present', 'ready']);
  });
});

describe('NET-PRESENCE-ENEMY: the lobby line', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  const render = (seats: Seat[]) => {
    const client = clientOn(seats, 'seat-ada');
    createLobbyScreen({ root }, client, [], []).update();
    return root.querySelector<HTMLElement>('.lobby-enemy')!;
  };

  it('appears when one of them has dropped', () => {
    const dropped = TEAM.map((s) => (s.seatId === 'seat-zed' ? { ...s, connected: false } : s));
    const block = render(dropped);
    const line = block.querySelector<HTMLElement>('.lobby-enemy-present')!;
    expect(line, 'the line is there').not.toBeNull();
    expect(line.textContent).toBe('1 of 2 present');
    expect(line.dataset['present'], 'and readable as a datum').toBe('1');
    expect(block.textContent, 'beside the pick count, not instead of it').toContain('ready');
  });

  it('stays quiet while they are all there', () => {
    // "2 of 2 present" on a healthy lobby is reassurance nobody asked for, and a
    // line that is always on is a line the eye learns to skip — which would cost
    // exactly the moment it exists for.
    const block = render(TEAM);
    expect(block.querySelector('.lobby-enemy-present')).toBeNull();
    expect(block.textContent, 'the pick count is untouched').toContain('1 of 2 ready');
  });

  it('never names them, and never shows a pick', () => {
    // The rule the whole block exists under. Asserted against the rendered text
    // rather than against the model, because the leak would be in the render.
    const dropped = TEAM.map((s) => (s.seatId === 'seat-zed' ? { ...s, connected: false } : s));
    const block = render(dropped);
    for (const secret of ['Zed', 'Yan', 'seat-zed', 'seat-yan']) {
      expect(block.textContent, `"${secret}" must not appear`).not.toContain(secret);
    }
    expect(block.querySelector('[data-seat]'), 'and no enemy seat node at all').toBeNull();
  });

  it('the own-team list is still the only place a name appears', () => {
    const dropped = TEAM.map((s) => (s.seatId === 'seat-zed' ? { ...s, connected: false } : s));
    render(dropped);
    const named = [...root.querySelectorAll<HTMLElement>('[data-seat]')].map((n) => n.dataset['seat']);
    expect(named, 'my seat, and nobody else\'s').toEqual(['seat-ada']);
  });
});

describe('NET-PRESENCE-ENEMY: the topbar half was already shipped', () => {
  // NET-PRESENCE-UI's `away` mark is derived from every seat in `RoomView`, not
  // just own-team, so an absent opponent's portrait already dims. Pinned here so
  // the two items cannot drift apart — and because "already done" is a claim
  // that should be checkable rather than remembered.
  const VEX = vex as unknown as CharacterDef;
  const BASTION = bastion as unknown as CharacterDef;

  it('an absent opponent dims in the strip, and is still never borrowed', () => {
    const state = createMatch(OPEN, '1v1', [[VEX], [BASTION]]);
    const mineUnit = state.units.find((u) => u.owner === 0)!.unitId;
    const theirUnit = state.units.find((u) => u.owner === 1)!.unitId;
    const seats: Seat[] = [
      seat({ seatId: 'seat-ada', team: 0, unitIds: [mineUnit] }),
      seat({ seatId: 'seat-zed', name: 'Zed', team: 1, unitIds: [theirUnit], connected: false }),
    ];
    const presence = presenceOf({ seats, mySeatId: 'seat-ada', controls: [mineUnit] });
    expect(presence.awayUnitIds).toEqual([theirUnit]);
    expect(presence.coveringFor, 'nobody covers for the other side').toEqual([]);

    const bar = topbar(scoreReadout(state, (id) => id), 0, presence);
    expect(bar.enemy[0]?.away).toBe(true);
    expect(bar.enemy[0]?.borrowed).toBe(false);
    expect(bar.friendly[0]?.away, 'and mine is unaffected').toBe(false);
  });
});
