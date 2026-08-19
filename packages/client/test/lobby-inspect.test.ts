// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalystData, CharacterDef, MapDef, Roster } from '@cards/engine';
import { buildCatalystPool, buildRoster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import { createLobbyScreen, type CatalystOption } from '../src/lobby-screen.js';
import { inspectCharacter } from '../src/inspect.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * LOBBY-INSPECT — hover a character in the lobby and read its kit; hover a
 * catalyst and read what it does (Dev Notes #2 + #3).
 *
 * The rule the AC sets is *reuse*, not "build a lobby version": the panel a
 * player reads while picking has to be the panel they will read over that
 * character all match, or the lobby becomes a second, quietly different account
 * of the same kit. So the drawing moved out of `hud.ts` into `inspect-panel.ts`
 * and both screens call it — these tests are largely about that being true.
 *
 * **No vision gate**, and not because one was skipped. The board's panel is
 * gated because it describes a unit somebody may not be able to see; the lobby's
 * describes a character in an open catalogue, and there is no unit to hide.
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

const characterButton = (root: HTMLElement, id: string): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`[data-character="${id}"]`)!;
/** The floating panel — it hangs off the body, not off the lobby. */
const panel = (): HTMLElement | null => document.body.querySelector<HTMLElement>('.inspect');
const hover = (button: HTMLElement): void => {
  button.dispatchEvent(new MouseEvent('mouseenter', { clientX: 40, clientY: 40 }));
};
const unhover = (button: HTMLElement): void => {
  button.dispatchEvent(new MouseEvent('mouseleave'));
};

beforeEach(() => { document.body.replaceChildren(); });

describe('LOBBY-INSPECT: hovering a character shows its kit', () => {
  it('the panel is hidden until the pointer is on something', () => {
    mounted();
    expect(panel()!.style.display).toBe('none');
  });

  it('hovering fills it with that character\'s name, archetype and health', () => {
    const { root } = mounted();
    hover(characterButton(root, 'vex'));
    const text = panel()!.textContent ?? '';
    expect(text).toContain(VEX.name);
    expect(text).toContain(VEX.archetype);
    expect(text, 'a fresh character is at full health').toContain(`${VEX.maxHp}/${VEX.maxHp}`);
    expect(panel()!.style.display).toBe('block');
  });

  it('and with every ability it owns, the ultimate included', () => {
    // "Kit" is the whole point of the hover: a player picking is choosing a
    // toolkit, and a panel that showed three of the five would be worse than
    // none because it would look complete.
    const { root } = mounted();
    hover(characterButton(root, 'vex'));
    const names = [...panel()!.querySelectorAll('.inspect-slot-name')].map((n) => n.textContent ?? '');
    for (const ability of VEX.abilities) {
      expect(names.some((n) => n.startsWith(ability.name)), ability.name).toBe(true);
    }
    expect(names.some((n) => n.startsWith(VEX.ultimate.name)), 'the ult too').toBe(true);
  });

  it('leaving hides it again', () => {
    const { root } = mounted();
    const button = characterButton(root, 'vex');
    hover(button);
    unhover(button);
    expect(panel()!.style.display).toBe('none');
  });

  it('a character a teammate already took still answers when hovered', () => {
    // A greyed row is the one that provokes the question, and `mouseenter`
    // fires on a disabled button where `click` does not — so the panel is the
    // only way that question gets answered.
    //
    // A 4v4 room, because R3 is a **team** rule and a 2v2 with two seats puts
    // them on opposite sides. Joins alternate, so `c` is `a`'s teammate.
    const hub = new RoomHub(createRoom('WXYZ', '4v4'), config);
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => new Wire(hub, id));
    for (const [wire, name] of [[a!, 'Ada'], [b!, 'Bo'], [c!, 'Cy'], [d!, 'Di']] as const) {
      wire.client.join(name);
    }
    const root = document.createElement('div');
    document.body.appendChild(root);
    createLobbyScreen({ root }, a!.client, CATALOG, CATALYSTS);
    c!.client.pick([{ characterId: 'vex' }, { characterId: 'wisp' }]);

    const taken = characterButton(root, 'vex');
    expect(taken.disabled, 'R3 greys it').toBe(true);
    hover(taken);
    expect(panel()!.textContent).toContain(VEX.name);
  });

  it('the panel survives the screen being repainted under it', () => {
    // The lobby is rebuilt on every message. A panel rebuilt with it would
    // vanish from under the pointer that summoned it, which is why it lives
    // outside the lobby's root.
    const { root, screen, b } = mounted();
    hover(characterButton(root, 'vex'));
    b.client.pick([{ characterId: 'wisp', catalysts: [] }, { characterId: 'aegis', catalysts: [] }]);
    screen.update();
    expect(panel()!.style.display, 'still up').toBe('block');
  });

  it('and is taken down with the screen, not left over the board', () => {
    const { screen } = mounted();
    screen.destroy();
    expect(panel(), 'gone from the document').toBeNull();
  });
});

describe('LOBBY-INSPECT: hovering a catalyst says what it does', () => {
  it('every catalyst in the picker carries its own description', () => {
    // Dev Note #3, and it is the same text the in-match chip shows — the pool's
    // `description`, forwarded rather than restated.
    const { root } = mounted();
    characterButton(root, 'vex').click();
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.lobby-catalyst')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const option = CATALYSTS.find((c) => c.id === button.dataset['catalyst'])!;
      expect(button.title, option.id).toBe(option.description);
      expect(button.title.length, 'and it actually says something').toBeGreaterThan(0);
    }
  });
});

describe('LOBBY-INSPECT: the panel is the board\'s panel', () => {
  it('a lobby panel is a fresh unit: full health, no energy, nothing on cooldown', () => {
    const built = inspectCharacter(VEX, 0);
    expect(built.hp).toBe(VEX.maxHp);
    expect(built.energy).toBe(0);
    expect(built.ult, 'no ult until it is charged').toBe(false);
    expect(built.abilities.every((a) => a.cooldown === 0)).toBe(true);
    expect(built.statuses, 'nothing has happened to it yet').toEqual([]);
    expect(built.frozen, 'a catalogue entry is not a decoy snapshot').toBe(false);
  });

  it('and every ability reads ready except the ultimate, which needs energy', () => {
    const built = inspectCharacter(VEX, 0);
    for (const a of built.abilities) {
      expect(a.ready, a.name).toBe(!a.isUlt);
    }
  });

  it('it wears the viewer\'s team colour', () => {
    expect(inspectCharacter(VEX, 1).team).toBe(1);
  });
});
