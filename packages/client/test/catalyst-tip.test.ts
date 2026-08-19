// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalystData, CharacterDef, MapDef, Roster } from '@cards/engine';
import { buildCatalystPool, buildRoster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import { createLobbyScreen, type CatalystOption } from '../src/lobby-screen.js';
import { createTooltip, placeBeside } from '../src/tooltip.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * CATALYST-TIP-FAST — *"Catalyst descriptions on mouseover appear very slowly,
 * can we speed up how soon they show up?"*
 *
 * The delay was never ours to tune. The buttons carried their description as a
 * `title` attribute, and how long a browser waits before showing one is the
 * browser's business — roughly half a second to a second, with no knob. Nine
 * catalysts in a lobby is nine of those waits, while choosing a loadout is
 * exactly the moment a player wants to read all nine.
 *
 * So the description becomes an element, on `mouseenter`, which has no delay
 * because there is no timer: the same mechanism LOBBY-INSPECT already uses one
 * section up the same screen.
 *
 * The tests below are mostly about the two halves of "immediately": the tip is
 * **there in the same tick** as the event, and the `title` is **gone** — a
 * description in both places would still be slow, in the browser's own layer,
 * over the top of the one that is not.
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

const mounted = () => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2'), config);
  const a = new Wire(hub, 'a');
  const b = new Wire(hub, 'b');
  a.client.join('Ada');
  b.client.join('Bo');
  const root = document.createElement('div');
  document.body.appendChild(root);
  const screen = createLobbyScreen({ root }, a.client, CATALOG, CATALYSTS);
  return { hub, a, b, root, screen };
};

const catalystButtons = (root: HTMLElement): HTMLButtonElement[] =>
  [...root.querySelectorAll<HTMLButtonElement>('[data-catalyst]')];
const catalystButton = (root: HTMLElement, id: string): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`[data-catalyst="${id}"]`)!;
/** The tip hangs off the body, like the inspect panel beside it. */
const tip = (): HTMLElement | null => document.body.querySelector<HTMLElement>('.tip');
const hover = (node: HTMLElement, at = { x: 40, y: 40 }): void => {
  node.dispatchEvent(new MouseEvent('mouseenter', { clientX: at.x, clientY: at.y }));
};
const unhover = (node: HTMLElement): void => {
  node.dispatchEvent(new MouseEvent('mouseleave'));
};

beforeEach(() => { document.body.replaceChildren(); });

describe('CATALYST-TIP-FAST: the description arrives on the hover, not after it', () => {
  it('a catalyst button no longer carries a `title` for the browser to sit on', () => {
    // The bug, stated as the thing that is gone. `title` is the delay: as long
    // as one is set, the browser will show its own tooltip on its own schedule.
    const { root } = mounted();
    const buttons = catalystButtons(root);
    expect(buttons.length, 'the catalysts are on screen').toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.title, button.dataset['catalyst']).toBe('');
      expect(button.hasAttribute('title'), button.dataset['catalyst']).toBe(false);
    }
  });

  it('and hovering one shows its description in the same tick', () => {
    // "Immediately" made testable: the assertion runs synchronously after the
    // event, with no timers advanced and nothing awaited. A delayed tip would
    // fail here, which is the whole point.
    const { root } = mounted();
    const first = CATALYSTS[0]!;
    expect(tip()!.style.display, 'nothing to say yet').toBe('none');
    hover(catalystButton(root, first.id));
    expect(tip()!.style.display).toBe('block');
    expect(tip()!.textContent).toBe(first.description);
  });

  it('with no timer scheduled behind it', () => {
    // The mechanical form of the same claim, in case a later "polish" pass adds
    // a fade: showing the tip must not go through the clock.
    const { root } = mounted();
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    hover(catalystButton(root, CATALYSTS[0]!.id));
    expect(timeout).not.toHaveBeenCalled();
    timeout.mockRestore();
  });

  it('every catalyst says its own sentence, straight out of `data/`', () => {
    // Not a re-description: the tip is the Designer's text, so a wording change
    // in `data/catalysts.json` moves it with no client change.
    const { root } = mounted();
    for (const cat of CATALYSTS) {
      hover(catalystButton(root, cat.id));
      expect(tip()!.textContent, cat.id).toBe(cat.description);
    }
  });

  it('and it goes when the pointer does', () => {
    const { root } = mounted();
    const button = catalystButton(root, CATALYSTS[0]!.id);
    hover(button);
    unhover(button);
    expect(tip()!.style.display).toBe('none');
  });

  it('the tip survives the lobby being repainted under it', () => {
    // The lobby is rebuilt on every server message, so a tip rebuilt with it
    // would vanish from under the pointer that summoned it — the same reason
    // the inspect panel lives on the body.
    const { root, screen, b } = mounted();
    hover(catalystButton(root, CATALYSTS[0]!.id));
    b.client.pick([{ characterId: 'wisp' }, { characterId: 'aegis' }]);
    screen.update();
    expect(tip()!.style.display, 'still up').toBe('block');
    expect(document.body.querySelectorAll('.tip'), 'and still exactly one of it').toHaveLength(1);
  });

  it('and is taken down with the screen, not left over the board', () => {
    const { screen } = mounted();
    screen.destroy();
    expect(tip()).toBeNull();
  });

  it('clicking a catalyst still picks it — the hover did not eat the button', () => {
    // The tip is decoration over a control, and a control that stopped working
    // would be a worse bug than the one being fixed.
    const { root } = mounted();
    const dash = CATALYSTS.find((c) => c.phase === 'dash')!;
    const button = catalystButton(root, dash.id);
    hover(button);
    button.click();
    expect(catalystButton(root, dash.id).classList.contains('is-chosen')).toBe(true);
  });
});

describe('CATALYST-TIP-FAST: the placement rule, which there is now one of', () => {
  it('a tip is text, never markup', () => {
    // `textContent`: a description is a sentence out of `data/`, and the one
    // thing a tooltip must not become is a place to ship a tag.
    const tooltip = createTooltip();
    tooltip.show('<b>bold</b>', { x: 10, y: 10 });
    expect(tooltip.node.textContent).toBe('<b>bold</b>');
    expect(tooltip.node.querySelector('b'), 'not parsed').toBeNull();
    tooltip.destroy();
  });

  it('it sits beside the pointer, and inside the window', () => {
    const node = document.createElement('div');
    document.body.appendChild(node);
    placeBeside(node, { x: 100, y: 100 });
    expect(node.style.left).toBe('118px');
    expect(node.style.top).toBe('112px');
  });

  it('and is never pushed off the top-left edge', () => {
    // The clamp: a tooltip that opens off-screen is a tooltip that did not open.
    const node = document.createElement('div');
    document.body.appendChild(node);
    placeBeside(node, { x: -400, y: -400 });
    expect(Number.parseInt(node.style.left, 10)).toBeGreaterThanOrEqual(8);
    expect(Number.parseInt(node.style.top, 10)).toBeGreaterThanOrEqual(8);
  });

  it('destroy takes it off the page', () => {
    const tooltip = createTooltip();
    expect(document.body.contains(tooltip.node)).toBe(true);
    tooltip.destroy();
    expect(document.body.contains(tooltip.node)).toBe(false);
  });
});
