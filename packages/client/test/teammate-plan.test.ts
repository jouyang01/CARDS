// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDef, MapDef, Vec2 } from '@cards/engine';
import { netRoom, type NetRoom, type NetSeat } from './net-harness.js';
import { aimAndCommit, armAbility, click, lockIn, moveButton } from './app-harness.js';
import aegisJson from '../../../data/characters/aegis.json';
import vexJson from '../../../data/characters/vex.json';
import kestrelJson from '../../../data/characters/kestrel.json';

/**
 * TEAMMATE-PLAN-VISIBLE — *"You need to see your teammates actions when they
 * lock in."*
 *
 * Golden rule #5 in the direction it **permits**: hidden information is team vs
 * team, and the server has relayed a team's own submissions to its teammates
 * since M3-HIDDEN. The gap was never on the wire — it was that the board did
 * nothing with what arrived. A teammate on another client showed up as a number
 * in "1/2 locked" and as nothing at all on the tiles they had just committed to,
 * so two players sharing a team could not coordinate a turn they are supposed to
 * plan together.
 *
 * These drive **two real controllers over one real `RoomHub`** — the same seam
 * NET-E2E opened. A test against `recordingNet` could not tell the difference
 * between "the board renders relayed orders" and "the server relays orders",
 * and only one of those was ever broken.
 */

const AEGIS = aegisJson as unknown as CharacterDef;
const VEX = vexJson as unknown as CharacterDef;
const KESTREL = kestrelJson as unknown as CharacterDef;
const INTERCEPT = AEGIS.abilities.find((a) => a.id === 'intercept')!;
const PULSE = AEGIS.abilities.find((a) => a.id === 'barrier_pulse')!;

/** Facing rows, with the two team-0 spawns two squares apart. */
const LANES: MapDef = {
  id: 'lanes', name: 'lanes', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 8, y: 8 }, { x: 8, y: 10 }, { x: 8, y: 12 }, { x: 8, y: 14 }],
    [{ x: 12, y: 8 }, { x: 12, y: 10 }, { x: 12, y: 12 }, { x: 12, y: 14 }],
  ],
};

const key = (p: Vec2): string => `${p.x},${p.y}`;
const layerOf = (seat: NetSeat, name: 'locked'): string[] =>
  (seat.renderer.draw.highlights.get(name) ?? []).map(key);
/** The routes still on the board — the layer is replaced on every repaint. */
const liveRoutes = (seat: NetSeat): string[][] => {
  const drawn = seat.renderer.draw.paths;
  const last = drawn.map((p) => p.layer).lastIndexOf('teamPath');
  if (last === -1) return [];
  // A repaint writes all of a frame's routes back-to-back, so the frame is the
  // run of `teamPath` entries ending at the last one.
  const routes: string[][] = [];
  for (let i = last; i >= 0 && drawn[i]!.layer === 'teamPath'; i--) {
    if (drawn[i]!.squares.length > 0) routes.unshift(drawn[i]!.squares.map(key));
  }
  return routes;
};

/**
 * Three seats: **two players on team 0** — which is the whole point — and one
 * running both of team 1's characters.
 *
 * `me` is the player doing the looking, `mate` the one locking in. Seats
 * alternate teams in join order, so the middle seat is the opposition.
 */
const room = (): { room: NetRoom; me: NetSeat; mate: NetSeat; foe: NetSeat } => {
  const r = netRoom({
    format: '2v2',
    map: LANES,
    catalog: [AEGIS, VEX, KESTREL],
    // Distinct picks per team — a team may not field two of the same
    // character, and a room that cannot start silently stays in the lobby.
    picks: [[VEX.id], [KESTREL.id, VEX.id], [AEGIS.id]],
  });
  r.start();
  const [me, foe, mate] = r.seats;
  return { room: r, me: me!, mate: mate!, foe: foe! };
};

/** Where a unit stands, from the board its own seat is looking at. */
const posOf = (seat: NetSeat, unitId: string): Vec2 =>
  seat.renderer.draw.board.units.find((u) => u.unitId === unitId)!.pos;

const mateUnitId = (mate: NetSeat): string => mate.client.net.unitIds[0]!;
const myUnitId = (me: NetSeat): string => me.client.net.unitIds[0]!;

beforeEach(() => { document.body.replaceChildren(); });

describe('TEAMMATE-PLAN-VISIBLE: the fixture is really two players on one team', () => {
  it('two seats share team 0, and each orders its own character', () => {
    // Asserted first, because every claim below is about a *teammate* — a
    // fixture that quietly put both characters on one seat would be testing the
    // hot-seat path that already worked.
    const { me, mate, foe } = room();
    expect(me.client.net.seat?.team, 'the viewer is on team 0').toBe(0);
    expect(mate.client.net.seat?.team, 'and so is the teammate').toBe(0);
    expect(foe.client.net.seat?.team, 'the opposition is not').toBe(1);
    expect(me.client.net.unitIds, 'one character each').toHaveLength(1);
    expect(mate.client.net.unitIds).toHaveLength(1);
    expect(mateUnitId(mate)).not.toBe(myUnitId(me));
  });

  it('and my board shows nothing of theirs before they lock in', () => {
    // The "before" half. Without it, a board that drew a locked plan
    // unconditionally would pass every test below.
    const { me, mate } = room();
    armAbility(mate.controls, PULSE.name);
    aimAndCommit(mate.board, posOf(mate, mateUnitId(mate)));
    expect(layerOf(me, 'locked'), 'a plan that is only drafted is nobody else’s business')
      .toEqual([]);
    expect(liveRoutes(me)).toEqual([]);
  });
});

describe('TEAMMATE-PLAN-VISIBLE: a teammate locks in and it appears on my board', () => {
  it('THE ITEM: their committed ability area is drawn over their character', async () => {
    // Aegis commits Barrier Pulse on himself: a radius-1 circle, so the tiles
    // are unambiguous and the assertion is on the FOOTPRINT rather than on "the
    // layer is non-empty" — a layer with the wrong tiles in it is a preview that
    // lies about where the shield lands.
    const { me, mate } = room();
    const at = posOf(mate, mateUnitId(mate));
    armAbility(mate.controls, PULSE.name);
    aimAndCommit(mate.board, at);
    lockIn(mate.controls);

    await vi.waitFor(() => {
      expect(layerOf(me, 'locked'), 'the pulse is on my board').toContain(key(at));
    });
    // The whole disc, not just the centre: this is `abilityPreview`, the same
    // derivation that draws my own aim, fed a plan that came off the wire.
    expect(layerOf(me, 'locked').sort(), 'and it is the ability’s real footprint')
      .toEqual([at, { x: at.x + 1, y: at.y }, { x: at.x - 1, y: at.y },
        { x: at.x, y: at.y + 1 }, { x: at.x, y: at.y - 1 }].map(key).sort());
  });

  it('their move path is drawn too, as a route from where they stand', async () => {
    // "The move path" — a plan is where you are going as much as what you are
    // firing, and a teammate walking into your line of fire is exactly the thing
    // this feature exists to let you see.
    const { me, mate } = room();
    const from = posOf(mate, mateUnitId(mate));
    const to = { x: from.x + 2, y: from.y };
    click(moveButton(mate.controls, 'Move'));
    aimAndCommit(mate.board, to);
    lockIn(mate.controls);

    await vi.waitFor(() => {
      expect(liveRoutes(me), 'one route, theirs').toHaveLength(1);
    });
    const route = liveRoutes(me)[0]!;
    expect(route[0], 'it starts where they are standing').toBe(key(from));
    expect(route[route.length - 1], 'and ends where they are going').toBe(key(to));
  });

  it('and Aegis’s guard link, so an Intercept reads as stepping in front of me', async () => {
    // The case the AC names by hand, and the one a bare ability layer gets
    // wrong: Intercept's area is a single square, which on its own reads as
    // "something happens over there" rather than as "he is coming to stand in
    // front of you".
    const { me, mate } = room();
    const mine = posOf(me, myUnitId(me));
    const beside = { x: mine.x, y: mine.y + 1 };
    armAbility(mate.controls, INTERCEPT.name);
    aimAndCommit(mate.board, beside);
    lockIn(mate.controls);

    await vi.waitFor(() => {
      expect(layerOf(me, 'locked'), 'the landing square is marked').toContain(key(beside));
    });
    const link = liveRoutes(me).find((r) => r[r.length - 1] === key(beside));
    expect(link, 'and a line runs to it from him').toBeDefined();
    expect(link![0], 'from where he is standing').toBe(key(posOf(mate, mateUnitId(mate))));
  });
});

describe('TEAMMATE-PLAN-VISIBLE: what it must NOT show', () => {
  it('the enemy’s committed plan stays hidden (golden rule #5)', async () => {
    // The load-bearing negative. The enemy seat locks in a real ability at a
    // real square; my board must show nothing of it, and the reason is that the
    // server never sent it — nothing here is trusting the client to look away.
    const { me, foe } = room();
    const bolts = KESTREL.abilities.find((a) => a.id === 'twin_bolts')!;
    armAbility(foe.controls, bolts.name);
    aimAndCommit(foe.board, posOf(me, myUnitId(me)));
    lockIn(foe.controls);
    lockIn(foe.controls); // the second Kestrel holds, finishing that seat

    await vi.waitFor(() => {
      expect(me.client.net.enemyLocked, 'the server told me they are ready').toBeGreaterThan(0);
    });
    expect(layerOf(me, 'locked'), 'and told me nothing else').toEqual([]);
    expect(liveRoutes(me)).toEqual([]);
    // The bytes themselves: the enemy's orders are not in the payload at all.
    expect(Object.keys(me.client.net.orders), 'only my own team is in the relay')
      .not.toContain(foe.client.net.seat?.seatId);
  });

  it('and it clears when the turn resolves, rather than haunting the next one', async () => {
    // `turnResolved` sends `orders: {}`, which is the wire saying "nobody is
    // committed any more". A board that merged relays instead of replacing them
    // would keep drawing last turn's plan over a character that has moved.
    const { me, mate, foe } = room();
    const at = posOf(mate, mateUnitId(mate));
    armAbility(mate.controls, PULSE.name);
    aimAndCommit(mate.board, at);
    lockIn(mate.controls);
    await vi.waitFor(() => {
      expect(layerOf(me, 'locked')).toContain(key(at));
    });

    lockIn(me.controls);
    lockIn(foe.controls);
    lockIn(foe.controls);
    await vi.waitFor(() => {
      expect(Object.keys(me.client.net.orders), 'the relay emptied out').toEqual([]);
    });
  });
});
