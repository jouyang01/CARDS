// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { fofFor, type Viewer } from '../src/fof.js';
import { OPEN_MAP, lockIn, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * FOF-UNITS — the **wiring**, driven through the real controller.
 *
 * `fof.test.ts` owns the decision ("given this viewer, is that unit friend or
 * foe"). This owns the plumbing: that the controller tells the renderer whose
 * seat it is drawing for, that it keeps telling it as the seat changes, and
 * that the two composed together give the right answer for a real board.
 *
 * **Why the composition and not a colour assertion.** The stub renderer draws
 * nothing, so "is that unit blue" is not a question it can answer — the pixels
 * are the browser suite's job. What a stub *can* prove is the thing that was
 * actually broken: the renderer was never told who was looking, so it fell back
 * to the team number. Recording the viewer and resolving the board through it
 * checks exactly that link.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION, WISP, AEGIS]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

/**
 * `players` is per team: `[1, 1]` gives one player each driving both
 * characters, `[2, 2]` gives four seats of one character each. The two are
 * genuinely different FoF boards — the first has no ally, the second does.
 */
const match = (players: [number, number] = [1, 1]) => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[VEX, BASTION], [WISP, AEGIS]];
  const opening: GameState = createMatch(OPEN_MAP, '2v2', teams);
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, '2v2', players, POOL, undefined, undefined, opening);
  return { ...ui, opening };
};

/** The viewer the controller last handed the renderer, as a usable `Viewer`. */
const viewerOf = (b: ReturnType<typeof match>): Viewer => {
  const recorded = b.renderer.draw.viewer;
  expect(recorded, 'the controller never told the renderer who is looking').toBeDefined();
  return { team: recorded!.team, seatUnitIds: new Set(recorded!.seatUnitIds) };
};

/**
 * Every **drawn** unit, resolved through the viewer the controller supplied.
 *
 * Drawn, not "every unit in the match" — fog decides what reaches the renderer
 * at all, and a fogged enemy is absent rather than grey (golden rule #5). So
 * this is deliberately a partial view of the board, and the tests below say
 * which of the two they mean every time.
 */
const drawnFof = (b: ReturnType<typeof match>): Record<string, string> => {
  const viewer = viewerOf(b);
  const out: Record<string, string> = {};
  for (const u of b.renderer.draw.board.units) out[u.unitId] = fofFor(u, viewer);
  return out;
};

/** Hand the board to the next seat by locking in everything this one drives. */
const passSeat = (b: ReturnType<typeof match>): void => {
  const before = viewerOf(b);
  for (let i = 0; i < 4 && viewerOf(b).team === before.team; i++) lockIn(b.controls);
};

beforeEach(() => { document.body.replaceChildren(); });

describe('FOF-UNITS: the controller tells the renderer who is looking', () => {
  it('the opening paint already carries a viewer', () => {
    // VISION1's opening paint is synchronous so the enemy never flashes
    // unfogged. The same frame must know whose side it is on, or the board is
    // briefly coloured for nobody.
    const b = match();
    expect(b.renderer.draw.viewer).toBeDefined();
    expect(b.renderer.draw.viewer?.team).toBe(0);
  });

  it('and it names the characters, not just the team', () => {
    // The viewer carries unit ids because `self` and `ally` cannot be told
    // apart from a team number alone. *Which* ids is the question the playtest
    // settled: locally it is the whole team, because one human drives every
    // seat on this keyboard. Across the wire it narrows to the seat.
    const b = match([2, 2]);
    const viewer = viewerOf(b);
    const own = b.opening.units.filter((u) => u.owner === viewer.team);
    expect(viewer.seatUnitIds.size, 'a hot-seat player drives their whole team')
      .toBe(own.length);
  });
});

describe('FOF-UNITS: a real board, resolved from the seat', () => {
  it('THE ITEM: every unit the seat can see resolves from that seat', () => {
    // Over the drawn board, because that is what the renderer colours. On an
    // open map the opening seat sees only its own two characters — the enemy is
    // fogged, and an absent unit has no colour to get wrong.
    const b = match();
    const fof = drawnFof(b);
    expect(Object.keys(fof).length, 'the seat is drawing something').toBeGreaterThan(0);
    for (const u of b.renderer.draw.board.units) {
      expect(fof[u.unitId], `${u.unitId} is owner ${u.owner}, viewer is team 0`)
        .toBe(u.owner === 0 ? 'self' : 'foe');
    }
  });

  it('THE REGRESSION: the same unit changes side when the board changes hands', () => {
    // The whole bug in one comparison. Before FOF-COLORS the seat changed and
    // the colours did not, so the second player planned a turn looking at their
    // own characters in the enemy's red.
    //
    // Resolved against the match roster rather than the drawn board on purpose:
    // fog means team 0's units are not even drawn for team 1, so a drawn-board
    // comparison would be measuring vision, not colour. The question here is
    // "does the answer depend on the viewer", and that is asked of the resolver
    // with the two viewers the controller actually produced.
    const b = match();
    const before = viewerOf(b);
    passSeat(b);
    const after = viewerOf(b);
    expect(after.team, 'the board changed hands').toBe(1);

    for (const u of b.opening.units) {
      expect(fofFor(u, before), `${u.unitId} from team 0's seat`)
        .toBe(u.owner === 0 ? 'self' : 'foe');
      expect(fofFor(u, after), `${u.unitId} from team 1's seat`)
        .toBe(u.owner === 1 ? 'self' : 'foe');
      expect(fofFor(u, after), `${u.unitId} did not simply keep its colour`)
        .not.toBe(fofFor(u, before));
    }
  });

  it('and the new seat’s own board is drawn from its own side', () => {
    // The wiring half of the regression: not just that the resolver *could*
    // answer differently, but that the renderer was handed the new seat.
    const b = match();
    passSeat(b);
    const fof = drawnFof(b);
    expect(Object.keys(fof).length).toBeGreaterThan(0);
    for (const u of b.renderer.draw.board.units) {
      expect(fof[u.unitId]).toBe(u.owner === 1 ? 'self' : 'foe');
    }
  });

  it('THE PLAYTEST BUG: two hot-seat seats a side is still ONE player, so no green', () => {
    // *"East team has Wisp green when it's Vex's turn, and Vex green when it's
    // Wisp's turn."* 2v2 defaults to `players = [2, 1]`, so a hot-seat splits a
    // team into two seats of one character each — and a seat that owns one
    // character made the other an `ally`, so the green followed the selection
    // around the player's own team.
    //
    // The seats are one human passing the board to themselves. `ally` means a
    // different *person*, which locally there is not.
    const b = match([2, 2]);
    const viewer = viewerOf(b);
    const own = b.opening.units.filter((u) => u.owner === viewer.team);
    expect(own.length, 'two characters a side').toBe(2);
    for (const u of own) {
      expect(fofFor(u, viewer), `${u.unitId} is this player's to order`).toBe('self');
    }
  });

  it('and the green does not follow the selection around your own team', () => {
    // The shape of the report, stated directly: order one character, hand the
    // board on, and the two must not have swapped colours between them.
    const b = match([2, 2]);
    const before = drawnFof(b);
    lockIn(b.controls);
    const after = drawnFof(b);
    for (const id of Object.keys(before)) {
      if (after[id] === undefined) continue; // fog moved it out of the drawn set
      expect(after[id], `${id} kept its identity across the hand-over`).toBe(before[id]);
    }
    expect(Object.values(after), 'and nothing on your own side went green')
      .not.toContain('ally');
  });

  it('and one player driving both sees both as self, with no ally', () => {
    const b = match();
    const viewer = viewerOf(b);
    const own = b.opening.units.filter((u) => u.owner === 0);
    expect(own.map((u) => fofFor(u, viewer))).toEqual(['self', 'self']);
  });
});

describe('FOF-UNITS: the colours hold still across a lock-in', () => {
  /**
   * Owner playtest: *"When locking in, east side team turns green and west side
   * team turns red — they should stay consistent with the friendly rules."*
   *
   * Locking in the last character runs `seatIdx` past the end of `seats`, so for
   * the whole resolution `seats[seatIdx]` is undefined. A viewer built from that
   * is team 0 with an **empty** unit set — not "no seat" but a seat that
   * controls nothing — and every unit on the viewer's own team drops from `self`
   * to `ally`. The player's own side turned green at the exact moment they
   * committed to a turn.
   */
  it('THE PLAYTEST BUG: your own characters stay blue when you lock in', async () => {
    const b = match();
    const before = viewerOf(b);
    expect(before.seatUnitIds.size, 'the seat controls its characters').toBeGreaterThan(0);

    // Lock every character in — the last one pushes the seat index off the end.
    for (let i = 0; i < 6; i++) lockIn(b.controls);

    const after = viewerOf(b);
    expect(after.seatUnitIds.size, 'the viewer still controls somebody').toBeGreaterThan(0);
    for (const u of b.opening.units.filter((x) => x.owner === after.team)) {
      expect(fofFor(u, after), `${u.unitId} is still the viewer's own`).not.toBe('ally');
    }
  });

  it('and nothing ever resolves to ally when one seat drives the whole team', async () => {
    // The general form of the same bug: with `[1, 1]` a seat owns both
    // characters, so `ally` is unreachable by construction. Any green at all is
    // a viewer that has lost track of what it controls.
    const b = match();
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const viewer = viewerOf(b);
      for (const u of b.opening.units) seen.add(fofFor(u, viewer));
      lockIn(b.controls);
    }
    expect([...seen].sort(), 'self and foe only — never ally').toEqual(['foe', 'self']);
  });
});

describe('FOF-UNITS: colour is pure view', () => {
  it('passing the board does not edit a single game value', () => {
    // The determinism guard the spec asks for, stated where it can fail: FoF is
    // a rendering decision, so changing seats must not write into state. If
    // colour could reach the engine's numbers, two clients on opposite teams
    // would diverge — and they would diverge silently.
    //
    // Compared against the opening roster, because *which* units are drawn
    // legitimately changes with the seat (fog); what must not change is what
    // any of them are.
    const b = match();
    const opening = new Map(b.opening.units.map((u) => [u.unitId, u]));
    passSeat(b);
    expect(b.renderer.draw.board.units.length).toBeGreaterThan(0);
    for (const drawn of b.renderer.draw.board.units) {
      const was = opening.get(drawn.unitId);
      expect(was, `${drawn.unitId} is a unit from this match`).toBeDefined();
      expect({ owner: drawn.owner, hp: drawn.hp, pos: drawn.pos, alive: drawn.alive })
        .toEqual({ owner: was!.owner, hp: was!.hp, pos: was!.pos, alive: was!.alive });
    }
  });
});
