// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalystData, CharacterDef, MapDef, Roster } from '@cards/engine';
import { buildCatalystPool, buildRoster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import { createLobbyScreen, type CatalystOption } from '../src/lobby-screen.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * LOBBY-BOUNDS — the "Your team" bar clips inside its panel (Dev Note #1: *the
 * team bar extends past into the log*).
 *
 * A seat line is a name on the left and a pick list on the right, laid out with
 * `justify-content: space-between`. That distributes free space and shrinks
 * nothing, so at 8 seats with three characters each the pick list — the longest
 * string on the screen — pushed the row wider than the panel and out over the
 * log beside it.
 *
 * The fix is three CSS rules and the tests are about **whether they reach the
 * elements the lobby actually builds**, which is the way a containment fix
 * usually fails: a rule written for a class the DOM does not have looks correct
 * in the stylesheet and does nothing on the page. So the real page stylesheet is
 * loaded and matched against a real rendered lobby, at 4v4 with every seat
 * filled — happy-dom resolves the cascade even though it lays nothing out, and
 * "does this rule apply to this node" is exactly the question worth asking here.
 * Pixel geometry is the e2e's job and a headless DOM would only pretend at it.
 */

const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const roster: Roster = buildRoster(CATALOG);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const CATALYSTS: CatalystOption[] = Object.values(POOL).map((c) => ({
  id: c.id, name: c.name, phase: c.phase, description: c.description,
}));
const config: MatchConfig = { map: duelArena as unknown as MapDef, roster, catalysts: POOL };

class Wire implements Sink {
  readonly client: RoomClient;
  constructor(private readonly hub: RoomHub, private readonly seatId: string) {
    this.client = new RoomClient({
      send: (data: string) => { this.hub.receive(this.seatId, data); },
      close: () => { this.hub.close(this.seatId); },
    });
    this.hub.open(seatId, this);
  }
  send(data: string): void { this.client.receive(data); }
  close(): void { this.client.closed(); }
}

/** The page's own stylesheet, so the rules under test are the shipped ones. */
beforeAll(() => {
  const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  expect(css.length, 'index.html still carries the stylesheet').toBeGreaterThan(0);
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
});

/**
 * A full 4v4 lobby — 8 seats, one character each, every name long — mounted for
 * seat 0. The worst case the AC names, built rather than described.
 */
const crowded = () => {
  const hub = new RoomHub(createRoom('WXYZ', '4v4'), config);
  const wires: Wire[] = [];
  for (let i = 0; i < 8; i++) {
    const wire = new Wire(hub, `s${i}`);
    wire.client.join(`Player-With-A-Very-Long-Handle-${i}`);
    wires.push(wire);
  }
  // Every seat picks, so every row carries a pick list rather than "choosing 1…".
  for (const [i, wire] of wires.entries()) {
    wire.client.pick([{ characterId: CATALOG[i % CATALOG.length]!.id, catalysts: [] }]);
  }
  const root = document.createElement('div');
  root.className = 'lobby';
  document.body.appendChild(root);
  const screen = createLobbyScreen({ root }, wires[0]!.client, CATALOG, CATALYSTS);
  return { hub, root, screen, wires };
};

const seats = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('.lobby-seat')];

describe('LOBBY-BOUNDS: the team bar stays inside its panel', () => {
  it('renders the case that broke it — four seats a side, all named and picked', () => {
    // A containment test over an empty list proves nothing, so the fixture is
    // asserted before the rules are.
    const { root } = crowded();
    const rows = seats(root);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.some((r) => (r.textContent ?? '').length > 40), 'long rows exist').toBe(true);
  });

  it('a seat row wraps rather than growing past the panel', () => {
    const { root } = crowded();
    const row = seats(root)[0]!;
    const style = getComputedStyle(row);
    expect(style.display).toBe('flex');
    expect(style.flexWrap, 'the picks drop under the name instead of widening the row').toBe('wrap');
    expect(style.maxWidth).toBe('100%');
  });

  it('and both halves of the row are allowed to shrink', () => {
    // The rule that is usually missing: a flex item defaults to `min-width:
    // auto` and refuses to go below its content, which is why "I added
    // flex-wrap and it still overflowed" is the normal first outcome.
    const { root } = crowded();
    const row = seats(root)[0]!;
    for (const cls of ['.lobby-seat-name', '.lobby-seat-picks']) {
      const part = row.querySelector<HTMLElement>(cls)!;
      expect(part, `${cls} is in the row`).toBeTruthy();
      // happy-dom reports the declared value verbatim ("0"), a browser
      // normalises it to "0px" — parse rather than string-match, so the test is
      // about the number and not about whose serialiser ran.
      expect(Number.parseFloat(getComputedStyle(part).minWidth), cls).toBe(0);
    }
  });

  it('and an unbroken name breaks rather than defeating the wrap', () => {
    // One long token with no spaces is the exception that would otherwise walk
    // straight through `flex-wrap`.
    const { root } = crowded();
    const row = seats(root)[0]!;
    expect(getComputedStyle(row).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(row.querySelector<HTMLElement>('.lobby-seat-picks')!).overflowWrap)
      .toBe('anywhere');
  });

  it('the panel itself never scrolls sideways', () => {
    // The last line of defence rather than the mechanism: if this is ever doing
    // the work, something above it has already escaped.
    const { root } = crowded();
    expect(getComputedStyle(root).overflowX).toBe('hidden');
    expect(getComputedStyle(root).boxSizing, 'padding counts inside the max-width').toBe('border-box');
  });

  it('the rules reach the real markup, not a class the screen never emits', () => {
    // The failure mode this file exists for: a stylesheet that looks right and
    // selects nothing. Every class the fix names has to be on the page.
    const { root } = crowded();
    for (const cls of ['lobby-team', 'lobby-seat', 'lobby-seat-name', 'lobby-seat-picks']) {
      expect(root.querySelector(`.${cls}`), cls).toBeTruthy();
    }
  });
});
