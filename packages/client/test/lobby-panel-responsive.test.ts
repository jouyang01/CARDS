// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 * LOBBY-PANEL-RESPONSIVE — the kit panel collapses instead of vanishing
 * (Builder OQ 2026-09-19 #7).
 *
 * LOBBY-DETAIL-PANEL put the kit in the empty left third of a wide lobby and
 * hid it under 1320px with `display: none !important`, which was right about the
 * space and wrong about the choice: below that width there is no empty third to
 * put it in, but a player windowed at 1280 got no kit panel *and no way to ask
 * for one*. Now they get a button.
 *
 * Tested against the **page's own stylesheet**, the way LOBBY-BOUNDS is, because
 * the way a responsive rule fails is by not reaching the element: a media query
 * written for a class the DOM does not have looks correct in the file and does
 * nothing on the page. happy-dom resolves the cascade and evaluates
 * `@media (max-width: …)` against `innerWidth`, so "at 1280, is the toggle
 * shown and the panel collapsed" is a question this can actually answer. Pixel
 * geometry is still the e2e's job.
 *
 * The breakpoint lives in CSS and only in CSS. A JS copy of 1320 would be a
 * second number to keep in step with the first, and the two would part on the
 * day somebody edited the stylesheet alone.
 */

const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const VEX = vex as unknown as CharacterDef;
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

let css = '';
beforeAll(() => {
  const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
  css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  expect(css.length, 'index.html still carries the stylesheet').toBeGreaterThan(0);
});

/**
 * Mount a lobby at a given viewport width.
 *
 * The width is set **before** the nodes are created, because that is when
 * happy-dom resolves the media query for them — which is a property of the fake
 * DOM rather than of the page, and the reason each case builds its own lobby
 * instead of resizing a shared one.
 */
const at = (width: number) => {
  (globalThis as unknown as { happyDOM: { setViewport(v: { width: number }): void } })
    .happyDOM.setViewport({ width });
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
  const a = new Wire(hub, 'a');
  const b = new Wire(hub, 'b');
  a.client.join('Ada');
  b.client.join('Bo');
  const root = document.createElement('div');
  root.className = 'lobby';
  document.body.appendChild(root);
  const screen = createLobbyScreen({ root }, a.client, CATALOG, CATALYSTS);
  return { hub, root, screen };
};

const NARROW = 1280; // the width the Dev Note names — a windowed 1280 lobby
const WIDE = 1600;

const panel = (): HTMLElement => document.body.querySelector<HTMLElement>('.lobby-detail')!;
const toggle = (): HTMLButtonElement =>
  document.body.querySelector<HTMLButtonElement>('[data-action="toggle-detail"]')!;
const characterButton = (root: HTMLElement, id: string): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`[data-character="${id}"]`)!;
const shown = (node: HTMLElement): boolean => getComputedStyle(node).display !== 'none';

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});
afterEach(() => {
  (globalThis as unknown as { happyDOM: { setViewport(v: { width: number }): void } })
    .happyDOM.setViewport({ width: 1024 });
});

describe('LOBBY-PANEL-RESPONSIVE: at a narrow width there is a way in', () => {
  it('the toggle exists and is shown at 1280', () => {
    // The AC's own assertion. Before this, a 1280 lobby had no kit panel and
    // nothing on screen to suggest one existed.
    const { root } = at(NARROW);
    characterButton(root, 'vex').click();
    expect(toggle(), 'the button is in the DOM').toBeTruthy();
    expect(shown(toggle()), 'and the stylesheet shows it at this width').toBe(true);
  });

  it('the panel starts collapsed, so it does not cover the grid unasked', () => {
    // Choosing a character fills the panel; at this width filling it must not
    // also open it over the thing that was just clicked.
    const { root } = at(NARROW);
    characterButton(root, 'vex').click();
    expect(panel().dataset['character'], 'it has something to say').toBe('vex');
    expect(shown(panel()), 'and is not saying it yet').toBe(false);
  });

  it('pressing it opens the panel, and pressing it again puts it away', () => {
    const { root } = at(NARROW);
    characterButton(root, 'vex').click();
    toggle().click();
    expect(shown(panel()), 'open').toBe(true);
    expect(panel().classList.contains('is-open')).toBe(true);
    toggle().click();
    expect(shown(panel()), 'closed again').toBe(false);
  });

  it('and the button says which kit it opens, and which way it points', () => {
    // A toggle that reads the same in both states is a toggle nobody trusts —
    // the same rule the Ready button is held to.
    const { root } = at(NARROW);
    expect(toggle().disabled, 'nothing chosen yet').toBe(true);
    expect(toggle().textContent).toMatch(/character kit/i);

    characterButton(root, 'vex').click();
    expect(toggle().disabled).toBe(false);
    expect(toggle().textContent).toContain(VEX.name);
    expect(toggle().dataset['open']).toBe('false');
    toggle().click();
    expect(toggle().dataset['open']).toBe('true');
  });

  it('the open panel follows the character that is chosen next', () => {
    // Opened once, it stays a live panel rather than a snapshot of whatever was
    // chosen when it was opened.
    const { root } = at(NARROW);
    characterButton(root, 'vex').click();
    toggle().click();
    characterButton(root, 'wisp').click();
    expect(panel().dataset['character']).toBe('wisp');
    expect(shown(panel()), 'and it stayed open').toBe(true);
  });

  it('an empty panel is never opened, however hard the button is pressed', () => {
    // The disabled button is the guard, but the panel's own inline `none`
    // (nothing to describe) is what makes it true rather than merely likely.
    at(NARROW);
    toggle().click();
    expect(shown(panel())).toBe(false);
  });
});

describe('LOBBY-PANEL-RESPONSIVE: at a wide width nothing changed', () => {
  it('the panel shows on its own and the toggle is not there', () => {
    // The whole point of a collapse is that it only happens where it must. A
    // button offering to open something already open would be noise.
    const { root } = at(WIDE);
    characterButton(root, 'vex').click();
    expect(shown(panel()), 'the panel is simply up').toBe(true);
    expect(shown(toggle()), 'and there is nothing to press').toBe(false);
  });

  it('and an unchosen panel is still hidden, as it always was', () => {
    at(WIDE);
    expect(shown(panel())).toBe(false);
  });
});

describe('LOBBY-PANEL-RESPONSIVE: it is taken down with the screen', () => {
  it('the toggle does not outlive the lobby it belongs to', () => {
    // It hangs off the body, like the panel and the tooltip, so it has to be
    // removed explicitly or it would sit over the board the match starts on.
    const { screen } = at(NARROW);
    expect(toggle()).toBeTruthy();
    screen.destroy();
    expect(document.body.querySelector('[data-action="toggle-detail"]')).toBeNull();
  });
});
