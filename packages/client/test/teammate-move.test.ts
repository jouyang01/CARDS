// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type MapDef, type Vec2,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import {
  aimAndCommit, armAbility, click, layer, lockIn, mountUI, moveButton,
  type StubRenderer,
} from './app-harness.js';
import { netRoom, type NetRoom, type NetSeat } from './net-harness.js';
import catalystData from '../../../data/catalysts.json';
import aegisJson from '../../../data/characters/aegis.json';
import vexJson from '../../../data/characters/vex.json';
import kestrelJson from '../../../data/characters/kestrel.json';

/**
 * TEAMMATE-MOVE-VISIBLE — *"We need to be able to see ally's movement commands
 * as well to know where they're moving."* and, the same day, *"Allied movement
 * and actions are still not visible enough, it should be VERY CLEAR what action
 * your ally is taking and what movement your ally is doing."*
 *
 * TEAMMATE-PLAN-VISIBLE shipped the ability half and one third of the movement
 * half. Three things were still missing, and each is a different way for an
 * ally's plan to be invisible:
 *
 * 1. **A locally-locked teammate's route was skipped** — the route was drawn for
 *    a *relayed* plan only. In a hot-seat, or for either of a seat's own two
 *    characters, locking the first and moving on to the second showed the first
 *    one's ability area and nothing about where it was walking.
 * 2. **A chasing teammate showed nothing at all.** A chase has no plan-time
 *    route (the engine picks it at the end of Move), so there was nothing for
 *    the route branch to draw and no other branch tried.
 * 3. **A relayed teammate had no intent badge.** `drafts` and `locked` are the
 *    client's own bookkeeping, so over the wire the label that says *what* an
 *    ally is doing was simply absent — the tiles were drawn and nothing named
 *    them.
 */

const AEGIS = aegisJson as unknown as CharacterDef;
const VEX = vexJson as unknown as CharacterDef;
const KESTREL = kestrelJson as unknown as CharacterDef;
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const RAIL = VEX.abilities.find((a) => a.id === 'rail_shot')!;

const FIELD: MapDef = {
  id: 'f', name: 'f', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 8, y: 8 }, { x: 8, y: 10 }, { x: 8, y: 12 }, { x: 8, y: 14 }],
    [{ x: 12, y: 8 }, { x: 12, y: 10 }, { x: 12, y: 12 }, { x: 12, y: 14 }],
  ],
};

const key = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * The teammate routes on the board right now.
 *
 * A path layer is replaced wholesale on every repaint, so "right now" is the
 * run of `teamPath` entries ending at the last one — reading the whole log
 * would report routes that were painted over three frames ago.
 */
const liveRoutes = (renderer: StubRenderer): string[][] => {
  const drawn = renderer.draw.paths;
  const last = drawn.map((p) => p.layer).lastIndexOf('teamPath');
  if (last === -1) return [];
  const routes: string[][] = [];
  for (let i = last; i >= 0 && drawn[i]!.layer === 'teamPath'; i--) {
    if (drawn[i]!.squares.length > 0) routes.unshift(drawn[i]!.squares.map(key));
  }
  return routes;
};

// ── The hot-seat half: one seat, two characters ─────────────────────────────

/**
 * A 2v2 hot-seat where one player runs both of team 0's characters — which is
 * the shape the first complaint is about. Locking the first and turning to the
 * second is the moment "where is my other character going" matters, and it is
 * exactly when the live preview is busy drawing the second one's plan.
 */
const hotSeat = () => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[VEX, AEGIS], [KESTREL, KESTREL]];
  const state: GameState = createMatch(FIELD, '2v2', teams);
  const [first, second] = state.units.filter((u) => u.owner === 0);
  const foes = state.units.filter((u) => u.owner === 1);
  first!.pos = { x: 8, y: 8 };
  second!.pos = { x: 8, y: 10 };
  foes[0]!.pos = { x: 12, y: 8 };
  foes[1]!.pos = { x: 12, y: 12 };
  startHotSeat(ui.ui, FIELD, buildRoster([VEX, AEGIS, KESTREL]), teams, '2v2', [1, 1], POOL,
    undefined, undefined, state);
  return { ...ui, state, first: first!, second: second!, foe: foes[0]! };
};

beforeEach(() => { document.body.replaceChildren(); });

describe('TEAMMATE-MOVE-VISIBLE: a locally-locked teammate’s route', () => {
  it('is not drawn before they lock in — a draft is not yet a plan', () => {
    // The "before" half, so the assertions below cannot pass vacuously on a
    // board that drew every route unconditionally.
    const b = hotSeat();
    click(moveButton(b.controls, 'Move'));
    aimAndCommit(b.board, { x: 10, y: 8 });
    expect(liveRoutes(b.renderer), 'my own live route is not a teammate’s').toEqual([]);
  });

  it('THE ITEM: locking the first character shows its route while I order the second', () => {
    // The complaint, verbatim. Lock In advances one CHARACTER at a time, so
    // after one press the board belongs to the second character — and the
    // first's committed walk has to still be on it.
    const b = hotSeat();
    const from = b.first.pos;
    const to = { x: from.x + 2, y: from.y };
    click(moveButton(b.controls, 'Move'));
    aimAndCommit(b.board, to);
    lockIn(b.controls);

    const routes = liveRoutes(b.renderer);
    expect(routes, 'one route: the character that just locked').toHaveLength(1);
    expect(routes[0]![0], 'it starts where they stand').toBe(key(from));
    expect(routes[0]![routes[0]!.length - 1], 'and ends where they are going').toBe(key(to));
  });

  it('and their ability area is still drawn beside it — both halves, one plan', () => {
    // The route must not have arrived at the ability's expense: a plan is what
    // they are doing AND where they are going, and the owner asked for both.
    const b = hotSeat();
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 12, y: 8 });
    click(moveButton(b.controls, 'Move'));
    aimAndCommit(b.board, { x: 8, y: 9 });
    lockIn(b.controls);

    expect(layer(b.renderer, 'locked').length, 'the shot is on the board').toBeGreaterThan(0);
    expect(liveRoutes(b.renderer), 'and so is the walk').toHaveLength(1);
  });
});

describe('TEAMMATE-MOVE-VISIBLE: a chasing teammate', () => {
  it('draws a link to the enemy they are chasing, and rings it', () => {
    // A chase has no plan-time route — the engine picks it at the end of Move —
    // so before this the order was invisible on the board entirely. The line to
    // the quarry is the whole of what is known at plan time, and it is the
    // sentence the owner wants: "this ally is going after that one".
    const b = hotSeat();
    click(moveButton(b.controls, 'Chase'));
    aimAndCommit(b.board, b.foe.pos);
    lockIn(b.controls);

    const link = liveRoutes(b.renderer);
    expect(link, 'the chase draws a link').toHaveLength(1);
    expect(link[0]![0], 'from the ally').toBe(key(b.first.pos));
    expect(link[0]![link[0]!.length - 1], 'to their quarry').toBe(key(b.foe.pos));
    expect(layer(b.renderer, 'chase').map(key), 'and the quarry is ringed')
      .toContain(key(b.foe.pos));
  });

  it('and the ring survives alongside my own chase rather than replacing it', () => {
    // One layer for both, so two allies after the same enemy ring it once — and
    // so my own quarry is not silently dropped when a teammate declares one.
    const b = hotSeat();
    click(moveButton(b.controls, 'Chase'));
    aimAndCommit(b.board, b.foe.pos);
    lockIn(b.controls);
    // …now the second character chases the other enemy.
    const other = b.state.units.find((u) => u.owner === 1 && u.unitId !== b.foe.unitId)!;
    click(moveButton(b.controls, 'Chase'));
    aimAndCommit(b.board, other.pos);

    const ringed = layer(b.renderer, 'chase').map(key);
    expect(ringed, 'the teammate’s quarry').toContain(key(b.foe.pos));
    expect(ringed, 'and my own').toContain(key(other.pos));
  });
});

// ── The networked half: two seats, one team ─────────────────────────────────

const netRoomOfThree = (): { room: NetRoom; me: NetSeat; mate: NetSeat; foe: NetSeat } => {
  const r = netRoom({
    format: '2v2',
    map: FIELD,
    catalog: [AEGIS, VEX, KESTREL],
    // Distinct picks per team; seats alternate teams in join order.
    picks: [[VEX.id], [KESTREL.id, VEX.id], [AEGIS.id]],
  });
  r.start();
  const [me, foe, mate] = r.seats;
  return { room: r, me: me!, mate: mate!, foe: foe! };
};

const posOf = (seat: NetSeat, unitId: string): Vec2 =>
  seat.renderer.draw.board.units.find((u) => u.unitId === unitId)!.pos;
const intentOf = (seat: NetSeat, unitId: string): string | undefined =>
  seat.renderer.draw.board.units.find((u) => u.unitId === unitId)?.intent?.label;

describe('TEAMMATE-MOVE-VISIBLE: over the wire', () => {
  it('a relayed move still draws — the shipped half, kept', () => {
    // Regression guard on TEAMMATE-PLAN-VISIBLE: dropping the `relayed` gate
    // must not have cost the case the gate was written for.
    const { me, mate } = netRoomOfThree();
    const unitId = mate.client.net.unitIds[0]!;
    const from = posOf(mate, unitId);
    const to = { x: from.x, y: from.y + 2 };
    click(moveButton(mate.controls, 'Move'));
    aimAndCommit(mate.board, to);
    lockIn(mate.controls);

    return vi.waitFor(() => {
      const routes = liveRoutes(me.renderer);
      expect(routes, 'their walk is on my board').toHaveLength(1);
      expect(routes[0]![routes[0]!.length - 1]).toBe(key(to));
    });
  });

  it('THE OTHER ITEM: a relayed teammate finally gets an intent badge', async () => {
    // *"It should be VERY CLEAR what action your ally is taking."* Over the wire
    // there was no label at all — `drafts`/`locked` are this client's own
    // bookkeeping and a teammate on another machine is in neither, so the tiles
    // were drawn and nothing named them.
    const { me, mate } = netRoomOfThree();
    const unitId = mate.client.net.unitIds[0]!;
    expect(intentOf(me, unitId), 'nothing to say before they commit').toBeUndefined();

    armAbility(mate.controls, AEGIS.abilities[0]!.name);
    aimAndCommit(mate.board, posOf(mate, unitId));
    lockIn(mate.controls);

    await vi.waitFor(() => {
      expect(intentOf(me, unitId), 'their action is named over their head').toBeDefined();
    });
    // The label names the ability rather than numbering it, and it reads as
    // LOCKED: a relayed plan is committed by definition, and the player needs
    // "they are DONE and doing this", not "they are thinking about it".
    expect(intentOf(me, unitId), 'the ability, by name').toContain(AEGIS.abilities[0]!.name);
    expect(intentOf(me, unitId), 'and the committed tick').toContain('✓');
  });

  it('and the enemy still gets neither route nor badge (golden rule #5)', async () => {
    // The load-bearing negative, restated for the route: widening what an ALLY
    // shows must not widen what an enemy shows. The server never sends it, so
    // this is belt and braces on a boundary worth being loud about.
    const { me, foe } = netRoomOfThree();
    const enemyUnit = foe.client.net.unitIds[0]!;
    click(moveButton(foe.controls, 'Move'));
    aimAndCommit(foe.board, { x: 12, y: 9 });
    lockIn(foe.controls);
    lockIn(foe.controls); // the seat's second character holds

    await vi.waitFor(() => {
      expect(me.client.net.enemyLocked, 'the server says they are ready').toBeGreaterThan(0);
    });
    expect(liveRoutes(me.renderer), 'and says nothing about where').toEqual([]);
    expect(intentOf(me, enemyUnit), 'nor about what').toBeUndefined();
  });
});
