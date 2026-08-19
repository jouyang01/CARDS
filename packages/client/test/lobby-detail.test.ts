// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalystData, CharacterDef, MapDef, Roster } from '@cards/engine';
import { ULT_COST, buildCatalystPool, buildRoster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import { createLobbyScreen, type CatalystOption } from '../src/lobby-screen.js';
import { characterDetail } from '../src/lobby.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * LOBBY-DETAIL-PANEL — *"When selecting a character in the lobby, the mouseover
 * is going great, but it should also expand into a bigger window on the side
 * that shows a description of all the skills. There is space on the left."*
 *
 * LOBBY-INSPECT's tooltip answers "what is this" in a glance and vanishes. This
 * answers "what would I be playing" and **stays** — which is the whole
 * difference, and the property most easily lost: a panel that emptied when the
 * pointer left would be the tooltip again, with more pixels.
 *
 * Same source as the tooltip — the character file — so the two cannot disagree
 * about a kit. What it adds is the Designer's own sentences, one per skill, and
 * the ultimate's price beside it.
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
const panel = (): HTMLElement | null => document.body.querySelector<HTMLElement>('.lobby-detail');
const skillRows = (): HTMLElement[] =>
  [...(panel()?.querySelectorAll<HTMLElement>('.lobby-detail-skill') ?? [])];
const hover = (button: HTMLElement): void => {
  button.dispatchEvent(new MouseEvent('mouseenter', { clientX: 20, clientY: 20 }));
};
const unhover = (button: HTMLElement): void => {
  button.dispatchEvent(new MouseEvent('mouseleave'));
};

beforeEach(() => { document.body.replaceChildren(); });

describe('LOBBY-DETAIL-PANEL: every skill, with its description', () => {
  it('starts empty — there is nothing to describe yet', () => {
    mounted();
    expect(panel()!.style.display).toBe('none');
  });

  it('pointing at a character fills it with ALL of that character\'s skills', () => {
    // "A description of all the skills": four abilities and the ultimate. A
    // panel that showed four of five would be worse than none, because it would
    // look complete.
    const { root } = mounted();
    hover(characterButton(root, 'vex'));
    const names = skillRows().map((r) => r.querySelector('.lobby-detail-skill-title')?.textContent);
    for (const a of VEX.abilities) expect(names, a.name).toContain(a.name);
    expect(names, 'the ultimate too').toContain(VEX.ultimate.name);
    expect(skillRows()).toHaveLength(VEX.abilities.length + 1);
  });

  it('and each row carries the Designer\'s own sentence', () => {
    const { root } = mounted();
    hover(characterButton(root, 'vex'));
    for (const def of [...VEX.abilities, VEX.ultimate]) {
      const row = panel()!.querySelector<HTMLElement>(`[data-skill="${def.id}"]`)!;
      expect(row, def.id).toBeTruthy();
      expect(row.querySelector('.lobby-detail-skill-text')?.textContent, def.id)
        .toBe(def.description);
    }
  });

  it('with the archetype and the health beside the name', () => {
    const { root } = mounted();
    hover(characterButton(root, 'vex'));
    expect(panel()!.querySelector('.lobby-detail-name')?.textContent).toBe(VEX.name);
    const role = panel()!.querySelector('.lobby-detail-role')?.textContent ?? '';
    expect(role).toContain(VEX.archetype);
    expect(role).toContain(String(VEX.maxHp));
  });

  it('and the ultimate marked as the one with a price', () => {
    const { root } = mounted();
    hover(characterButton(root, 'vex'));
    const ult = panel()!.querySelector<HTMLElement>(`[data-skill="${VEX.ultimate.id}"]`)!;
    expect(ult.classList.contains('is-ult')).toBe(true);
    expect(ult.querySelector('.lobby-detail-skill-meta')?.textContent).toContain(String(ULT_COST));
  });
});

describe('LOBBY-DETAIL-PANEL: it is persistent, which is the point', () => {
  it('stays up when the pointer leaves', () => {
    // The one behaviour that distinguishes it from the tooltip it sits beside.
    const { root } = mounted();
    const button = characterButton(root, 'vex');
    hover(button);
    unhover(button);
    expect(panel()!.style.display).not.toBe('none');
    expect(panel()!.dataset['character']).toBe('vex');
  });

  it('and swaps only when another character is chosen', () => {
    const { root } = mounted();
    hover(characterButton(root, 'vex'));
    expect(panel()!.dataset['character']).toBe('vex');
    hover(characterButton(root, 'wisp'));
    expect(panel()!.dataset['character']).toBe('wisp');
    expect(skillRows().map((r) => r.dataset['skill']))
      .toEqual([...(wisp as unknown as CharacterDef).abilities.map((a) => a.id),
        (wisp as unknown as CharacterDef).ultimate.id]);
  });

  it('picking a character fills it too, not only pointing at one', () => {
    // The AC says "selecting (or hovering)". A click is the stronger signal of
    // the two and must not be the one that leaves the panel blank.
    const { root } = mounted();
    characterButton(root, 'bastion').click();
    expect(panel()!.dataset['character']).toBe('bastion');
  });

  it('and survives the lobby being repainted under it', () => {
    // The lobby is rebuilt on every server message. The panel lives outside its
    // root for the same reason the tooltip does.
    const { root, screen, b } = mounted();
    hover(characterButton(root, 'vex'));
    b.client.pick([{ characterId: 'wisp' }, { characterId: 'aegis' }]);
    screen.update();
    expect(panel()!.dataset['character'], 'still describing what it was').toBe('vex');
    expect(skillRows().length).toBeGreaterThan(0);
  });

  it('and is taken down with the screen, not left over the board', () => {
    const { screen } = mounted();
    screen.destroy();
    expect(panel()).toBeNull();
  });
});

describe('LOBBY-DETAIL-PANEL: the model is a reading of the character file', () => {
  const DIR = join(import.meta.dirname, '../../..', 'data/characters');
  const ALL: CharacterDef[] = readdirSync(DIR).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as CharacterDef);

  it('lists every ability of every shipped character, in the file\'s order', () => {
    // The AC's assertion, applied to the whole roster rather than to one
    // character: nothing composed, nothing dropped, nothing reordered.
    for (const c of ALL) {
      const detail = characterDetail(c);
      expect(detail.skills.map((s) => s.id), c.id)
        .toEqual([...c.abilities.map((a) => a.id), c.ultimate.id]);
      expect(detail.skills.filter((s) => s.isUlt).map((s) => s.id), `${c.id} has one ult`)
        .toEqual([c.ultimate.id]);
    }
  });

  it('carries each skill\'s own description, never a rewrite of one', () => {
    for (const c of ALL) {
      for (const skill of characterDetail(c).skills) {
        const def = [...c.abilities, c.ultimate].find((a) => a.id === skill.id)!;
        expect(skill.description, `${c.id}.${skill.id}`).toBe(def.description);
        expect(skill.name).toBe(def.name);
        expect(skill.phase).toBe(def.phase);
      }
    }
  });

  it('and the numeric tell the rest of the client already shows', () => {
    // Reused rather than re-derived: the panel says what the hotbar tooltip
    // says, so a balance edit moves both and neither can drift.
    const detail = characterDetail(ALL.find((c) => c.id === 'aegis')!);
    const bash = detail.skills.find((s) => s.id === 'shield_bash')!;
    expect(bash.tell).toBe('20 dmg · 3-wide lane');
  });
});
