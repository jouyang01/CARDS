// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch, deriveSeats,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import {
  OPEN_MAP, aimAndCommit, armAbility, layer, lockIn, mountUI, playbackRow, skipPlayback,
} from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * HARNESS-HOTSEAT — the pass-the-device handover, through the real controller
 * (Builder OQ 2026-09-20 #6).
 *
 * HARNESS-BROADEN covered aiming, catalysts, free actions, the chase and
 * playback, but every one of those specs drives a **networked** seat: one seat
 * id, one `submit`, and the orders come out as a value the test can hold. The
 * hot-seat does not work like that. It walks `deriveSeats` — seat 0 orders its
 * characters, hands the device to seat 1, and only when the last seat is done
 * does the turn resolve locally — and it hands nothing out, because it resolves
 * its own turn.
 *
 * So this file asserts the handover the way a player sees it: **who is on the
 * clock**, which is in the status line; **what they are looking at**, which is
 * the fog the renderer was given; and **that both seats' orders actually ran**,
 * which is the resolved turn's log. Those are three separate ways for a broken
 * handover to show, and the middle one is the one a label alone would miss — a
 * seat that got the clock but not the board would be showing the previous
 * player's fog to their opponent.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION, WISP, AEGIS]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const RAIL = VEX.abilities.find((a) => a.id === 'rail_shot')!;

/**
 * A **hot-seat** — no `net`, which is the whole point: the controller walks the
 * seats itself and resolves the turn itself.
 */
const hotSeat = (
  teams: [CharacterDef[], CharacterDef[]],
  format: '1v1' | '2v2',
  playersPerTeam: [number, number],
) => {
  const ui = mountUI();
  const opening: GameState = createMatch(OPEN_MAP, format, teams);
  // Face each other across the middle, close enough to shoot. The map's own
  // spawns are 16 apart, which is past every ability's range — a turn from
  // there resolves to nothing and would make the log assertions vacuous.
  const own = opening.units.filter((u) => u.owner === 0);
  const foe = opening.units.filter((u) => u.owner === 1);
  own.forEach((u, i) => { u.pos = { x: 8, y: 9 + i * 2 }; });
  foe.forEach((u, i) => { u.pos = { x: 12, y: 9 + i * 2 }; });
  // `net` is `undefined` — a real hot-seat, walking its own seats and resolving
  // its own turn — while `opening` hands it the board above rather than letting
  // it build one from the spawns.
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, format, playersPerTeam, POOL,
    undefined, undefined, opening);
  return { ...ui, opening, seats: deriveSeats(opening, playersPerTeam) };
};

/** Who the status line says is on the clock. */
const onTheClock = (ui: { status: HTMLElement }): string => ui.status.textContent ?? '';
/** The character the HUD is currently ordering. */
const active = (controls: HTMLElement): string =>
  controls.querySelector('.hud-name')?.textContent ?? '';
const fogKey = (renderer: Parameters<typeof layer>[0]): string =>
  layer(renderer, 'fog').map((p) => `${p.x},${p.y}`).sort().join('|');

beforeEach(() => { document.body.replaceChildren(); });

describe('HARNESS-HOTSEAT: the device passes from seat to seat', () => {
  const duel = () => hotSeat([[VEX], [BASTION]], '1v1', [1, 1]);

  it('opens on seat 0, ordering its own character', () => {
    const b = duel();
    expect(b.seats.map((s) => s.seatId), 'two seats, one each').toEqual(['t0-p0', 't1-p0']);
    expect(onTheClock(b)).toContain('t0-p0');
    expect(active(b.controls)).toContain(VEX.name);
  });

  it('locking the last character of a seat hands the clock to the next one', () => {
    // The handover itself. Seat 0 has one character, so its Lock In is also the
    // end of its turn — `seatIdx += 1; openSeat()`.
    const b = duel();
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 12, y: 9 });
    lockIn(b.controls);

    expect(onTheClock(b), 'seat 1 is on the clock').toContain('t1-p0');
    expect(active(b.controls), 'and it is ordering its own character').toContain(BASTION.name);
  });

  it('and the board changes hands with it, not just the label', () => {
    // The half a status line cannot prove. Each seat is a different team, so
    // the fog is a different set of squares — a handover that moved the clock
    // and not the view would be showing one player their opponent's board.
    const b = duel();
    const before = fogKey(b.renderer);
    expect(before.length, 'a fogged opening').toBeGreaterThan(0);
    lockIn(b.controls);
    expect(fogKey(b.renderer), 'the new seat sees its own board').not.toBe(before);
  });

  it('the second seat starts with a clean plan, not the first seat\'s aim', () => {
    // Drafts are per unit, so nothing seat 0 aimed may be on screen when seat 1
    // takes over — a live overlay would read as an order they had already made.
    const b = duel();
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 12, y: 9 });
    expect(layer(b.renderer, 'aim').length, 'seat 0 has an aim up').toBeGreaterThan(0);
    lockIn(b.controls);
    expect(layer(b.renderer, 'aim'), 'seat 1 does not inherit it').toEqual([]);
  });

  it('and the turn does not resolve until the LAST seat locks in', () => {
    // The property that makes it a hot-seat rather than two independent turns.
    const b = duel();
    lockIn(b.controls);
    expect(playbackRow(b.controls).style.display, 'still ordering').toBe('none');
    lockIn(b.controls);
    expect(playbackRow(b.controls).style.display, 'and now it resolves').not.toBe('none');
  });
});

describe('HARNESS-HOTSEAT: a seat with two characters keeps the device', () => {
  // The shipped demo's split: team 0 across two players, team 1 on one player
  // running both. The asymmetry is the point — the handover only has a bug to
  // have when the two teams are seated differently.
  const demo = () => hotSeat([[VEX, WISP], [BASTION, AEGIS]], '2v2', [2, 1]);

  it('three seats: two on one side, one running the pair on the other', () => {
    const b = demo();
    expect(b.seats.map((s) => s.seatId)).toEqual(['t0-p0', 't0-p1', 't1-p0']);
    expect(b.seats[0]!.unitIds, 'the split side runs one each').toHaveLength(1);
    expect(b.seats.at(-1)!.unitIds, 'the solo player runs both').toHaveLength(2);
  });

  it('a one-character seat hands over on its single lock', () => {
    // Team 0 is split two ways, so each of its seats has one character and its
    // Lock In is also the end of its turn.
    const b = demo();
    expect(onTheClock(b)).toContain('t0-p0');
    lockIn(b.controls);
    expect(onTheClock(b), 'straight on to the teammate').toContain('t0-p1');
  });

  it('but the PAIR seat keeps the device after its first lock', () => {
    // `lockSelected` looks for the seat's next unlocked character before it
    // advances. A handover here would take the device off a player mid-turn —
    // and it is the asymmetry that makes this worth driving: the two teams are
    // seated differently, which is when a seat walk has a bug to have.
    const b = demo();
    lockIn(b.controls); // t0-p0
    lockIn(b.controls); // t0-p1 — now the pair seat is up
    expect(onTheClock(b)).toContain('t1-p0');
    const first = active(b.controls);

    lockIn(b.controls);
    expect(onTheClock(b), 'still the same seat').toContain('t1-p0');
    expect(active(b.controls), 'on their other character').not.toBe(first);
  });

  it('and the lock counter counts that seat\'s characters, not the board\'s', () => {
    // "(1/2 locked)" is the seat's own progress — the sentence a player reads
    // to know whether it is still their turn.
    const b = demo();
    expect(onTheClock(b), 'a one-character seat owes one').toContain('(0/1 locked)');
    lockIn(b.controls);
    lockIn(b.controls);
    expect(onTheClock(b), 'the pair seat owes two').toContain('(0/2 locked)');
    lockIn(b.controls);
    expect(onTheClock(b), 'one of them done').toContain('(1/2 locked)');
  });

  it('and only the second lock hands the pair seat on', () => {
    const b = demo();
    lockIn(b.controls); // t0-p0
    lockIn(b.controls); // t0-p1
    expect(onTheClock(b)).toContain('t1-p0');
    lockIn(b.controls); // t1-p0, first of two
    expect(playbackRow(b.controls).style.display, 'one still to order').toBe('none');
    lockIn(b.controls); // t1-p0, second
    expect(playbackRow(b.controls).style.display, 'now the turn resolves').not.toBe('none');
  });
});

describe('HARNESS-HOTSEAT: every seat\'s orders survive to the resolution', () => {
  it('both seats\' shots land in the same turn', async () => {
    // The end of the sentence: a handover that dropped the earlier seat's
    // orders would look completely normal until the turn ran. Each seat aims at
    // the other, and the log — written from the resolved event list — has to
    // carry both.
    const b = hotSeat([[VEX], [BASTION]], '1v1', [1, 1]);

    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 12, y: 9 }); // seat 0 shoots east
    lockIn(b.controls);

    const punch = BASTION.abilities.find((a) => a.phase === 'blast')!;
    armAbility(b.controls, punch.name);
    aimAndCommit(b.board, { x: 8, y: 9 }); // seat 1 shoots west
    lockIn(b.controls);

    // The resolution is async — `endTurn` is not awaited by the click that
    // triggered it — so the log arrives on the next microtask, not this one.
    await vi.waitFor(() => {
      expect(b.log.querySelectorAll('.log-line').length).toBeGreaterThan(0);
    });
    const log = b.log.textContent ?? '';
    expect(log, 'seat 0 acted').toContain(VEX.name);
    expect(log, 'and so did seat 1').toContain(BASTION.name);
  });

  it('and the next turn opens back on seat 0', async () => {
    // `beginTurn` resets `seatIdx` to 0, so the device goes back to the first
    // player. A counter that kept climbing would end the match after one turn.
    const b = hotSeat([[VEX], [BASTION]], '1v1', [1, 1]);
    lockIn(b.controls);
    lockIn(b.controls);
    await vi.waitFor(() => {
      expect(playbackRow(b.controls).style.display, 'playback started').not.toBe('none');
    });
    skipPlayback(b.controls);
    await vi.waitFor(() => {
      expect(playbackRow(b.controls).style.display, 'playback finished').toBe('none');
    });
    expect(onTheClock(b), 'seat 0 again').toContain('t0-p0');
    expect(onTheClock(b), 'on the next turn').toContain('Turn 2');
  });
});
