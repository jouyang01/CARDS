// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCatalystPool, buildRoster, createMatch,
  type AbilityDef, type CatalystData, type CharacterDef, type Roster,
} from '@cards/engine';
import { createHud, type HudAbility, type HudCatalyst, type HudCharacter, type HudModel } from '../src/hud.js';
import { renderInspectPanel } from '../src/inspect-panel.js';
import { inspectUnit } from '../src/inspect.js';
import { createTooltip, delegateTooltips } from '../src/tooltip.js';
import { statusChips } from '../src/status-pips.js';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, click, mountUI, recordingNet } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * TOOLTIP-SWEEP — the rest of the native `title` tooltips become instant ones
 * (Builder OQ 2026-09-20 #4).
 *
 * CATALYST-TIP-FAST answered the owner's note about the lobby's catalysts and
 * built `tooltip.ts` to do it. Four sites were left on `title`, all with the
 * same browser-owned reveal delay of roughly a second: the Time Bank pip, the
 * HUD's status chips, the topbar portraits, and the inspect panel's catalyst
 * chips.
 *
 * The mechanism is delegation rather than per-node listeners, and that is not
 * an optimisation. The HUD's nodes are keyed and re-filled on every update
 * (UI3) and the topbar strip is rebuilt wholesale on every render, so listeners
 * attached at build time would go stale and listeners attached per update would
 * stack. One listener per region, and the text is an attribute the update
 * already writes.
 *
 * **The fourth site cannot fire, and this file says so rather than pretending.**
 * `.inspect` is `pointer-events: none` — it follows the pointer, so a panel you
 * could hover would chase itself off the unit it describes — which means no
 * pointer event has ever reached those chips. The `title` there never showed
 * either. The text is carried so the panel's record is complete; making it
 * reachable is a different item.
 */

const VEX = vex as unknown as CharacterDef;
const CATALOG = [VEX, bastion as unknown as CharacterDef];
const roster: Roster = buildRoster(CATALOG);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

const handlers = () => ({
  selectCharacter: vi.fn(), selectAbility: vi.fn(), selectCatalyst: vi.fn(), hoverAbility: vi.fn(),
  selectMove: vi.fn(), selectChase: vi.fn(), hoverMove: vi.fn(), hold: vi.fn(), lock: vi.fn(),
  toggleProjection: vi.fn(), toggleOrbit: vi.fn(), extendTime: vi.fn(), selectMode: vi.fn(), selectRotation: vi.fn(),
});
const character = (over: Partial<HudCharacter> = {}): HudCharacter => ({
  unitId: 'vex-t0-0', name: 'Vex', archetype: 'firepower', colour: '#4f8cff',
  hp: 95, maxHp: 95, energy: 0, shield: 0, locked: false, hasOrder: false, statuses: [], ...over,
});
const ability = (def: AbilityDef): HudAbility => ({
  id: def.id, name: def.name, isUlt: false, available: true,
  cooldown: 0, selected: false, free: def.free === true, def,
});
const catalyst = (id: string): HudCatalyst => ({
  id, name: POOL[id]!.name, phase: POOL[id]!.phase, cost: 'free',
  spent: false, selected: false, def: POOL[id]!,
});
const model = (over: Partial<HudModel> = {}): HudModel => ({
  active: character(),
  roster: [character()],
  abilities: VEX.abilities.map(ability),
  modes: [],
  rotations: [],
  catalysts: ['second_wind', 'shift', 'adrenaline'].map(catalyst),
  move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
  chase: { armed: false, disabled: false },
  lock: { label: 'Lock In ▸' },
  view: { projection: 'Isometric', orbit: false },
  ...over,
});

const tip = (): HTMLElement | null => document.body.querySelector<HTMLElement>('.tip');
/** Hover a node the way a pointer does: `mouseover` bubbles, `mouseenter` does not. */
const hover = (node: Element, at = { x: 30, y: 30 }): void => {
  node.dispatchEvent(new MouseEvent('mouseover', {
    clientX: at.x, clientY: at.y, bubbles: true,
  }));
};
const unhover = (node: Element): void => {
  node.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
};

let root: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.appendChild(root);
});

describe('TOOLTIP-SWEEP: the HUD sites', () => {
  const mounted = (over: Partial<HudModel> = {}) => {
    const hud = createHud(root, handlers());
    hud.update(model(over));
    return hud;
  };

  it('the Time Bank pip says what it costs, immediately', () => {
    const hud = mounted();
    hud.setTimer({ text: '18.0', fraction: 0.5, urgent: false, expired: false, extending: false, charges: 1, canExtend: true });
    const bank = root.querySelector('.hud-bank')!;
    expect(bank.hasAttribute('title'), 'no browser tooltip left').toBe(false);
    hover(bank);
    expect(tip()!.style.display).toBe('block');
    expect(tip()!.textContent).toContain('Time Bank');
    expect(tip()!.textContent).toContain('1 left');
  });

  it('and says so when it is spent', () => {
    const hud = mounted();
    hud.setTimer({ text: '18.0', fraction: 0.5, urgent: false, expired: false, extending: false, charges: 0, canExtend: false });
    hover(root.querySelector('.hud-bank')!);
    expect(tip()!.textContent).toContain('spent');
  });

  it('a status chip explains itself on hover, with no `title` behind it', () => {
    mounted({ active: character({ statuses: statusChips([{ kind: 'root', remaining: 2 }]) }) });
    const chip = root.querySelector('.hud-status')!;
    expect(chip.hasAttribute('title')).toBe(false);
    hover(chip);
    expect(tip()!.textContent).toContain('Rooted');
    expect(tip()!.textContent).toContain('2 turns left');
  });

  it('and the tip follows the chip as its text changes turn to turn', () => {
    // The reason this is delegated: the chip is a keyed node that survives the
    // update, so a listener that captured the text once would be describing
    // last turn's duration for the rest of the match.
    const hud = mounted({ active: character({ statuses: statusChips([{ kind: 'root', remaining: 3 }]) }) });
    const chip = root.querySelector('.hud-status')!;
    hud.update(model({ active: character({ statuses: statusChips([{ kind: 'root', remaining: 1 }]) }) }));
    expect(root.querySelector('.hud-status'), 'the same node').toBe(chip);
    hover(chip);
    expect(tip()!.textContent).toContain('1 turn left');
  });

  it('leaving the chip puts the tip away', () => {
    mounted({ active: character({ statuses: statusChips([{ kind: 'root', remaining: 2 }]) }) });
    const chip = root.querySelector('.hud-status')!;
    hover(chip);
    unhover(chip);
    expect(tip()!.style.display).toBe('none');
  });

  it('hovering something untipped shows nothing', () => {
    // The control: delegation must not put an empty box up over every button
    // on the bar.
    mounted();
    hover(root.querySelector('.hud-ability')!);
    expect(tip()!.style.display).toBe('none');
  });
});

describe('TOOLTIP-SWEEP: the topbar portraits', () => {
  const board = () => {
    const ui = mountUI();
    const opening = createMatch(OPEN_MAP, '1v1', [[VEX], [CATALOG[1]!]]);
    const wire = recordingNet('s0', 0, [opening.units[0]!.unitId]);
    startHotSeat(ui.ui, OPEN_MAP, roster, [[VEX], [CATALOG[1]!]], '1v1', [1, 1],
      POOL, undefined, wire.net, opening);
    return ui;
  };

  it('a portrait names its character and its health, on hover', () => {
    board();
    const portrait = document.querySelector('.topbar-portrait')!;
    expect(portrait.hasAttribute('title'), 'no browser tooltip left').toBe(false);
    hover(portrait);
    const shown = tip()!;
    expect(shown.style.display).toBe('block');
    expect(shown.textContent).toContain(VEX.name);
    expect(shown.textContent).toContain(String(VEX.maxHp));
  });

  it('and the strip being rebuilt does not cost it its tooltip', () => {
    // The topbar is rebuilt wholesale on every render (`scoreEl.replaceChildren`),
    // so a per-node listener would survive exactly one turn. Delegation is on
    // `scoreEl` itself, which is built once and does not.
    const ui = board();
    const before = document.querySelector('.topbar-portrait')!;
    click(ui.controls.querySelector('.hud-ability')); // any interaction re-renders
    const after = document.querySelector('.topbar-portrait')!;
    expect(after, 'a fresh node, as expected').not.toBe(before);
    hover(after);
    expect(tip()!.textContent).toContain(VEX.name);
  });
});

describe('TOOLTIP-SWEEP: the inspect panel keeps its text, unreachable as it is', () => {
  /** A real unit's panel — a dealt triad is where the catalyst chips come from. */
  const unitPanel = () => {
    const state = createMatch(OPEN_MAP, '1v1', [[VEX], [CATALOG[1]!]]);
    return inspectUnit(state.units[0]!, roster, POOL, 0)!;
  };

  it('the catalyst chips carry `data-tip` and no `title`', () => {
    const panel = document.createElement('div');
    panel.className = 'inspect';
    document.body.appendChild(panel);
    renderInspectPanel(panel, unitPanel());
    const chips = [...panel.querySelectorAll<HTMLElement>('.inspect-catalyst')];
    expect(chips.length, 'a fresh character carries its triad').toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.hasAttribute('title'), 'the native one is gone').toBe(false);
      expect(chip.dataset['tip'] ?? '', 'and the text survived').not.toBe('');
    }
  });

  it('and would show it if the panel could ever be pointed at', () => {
    // Honest about the limit: the panel is `pointer-events: none`, so this
    // wires the delegation by hand to prove the data is right rather than
    // claiming a hover that cannot happen. If the panel ever gains a pinned
    // mode, one `delegateTooltips` call is the whole of the work.
    const panel = document.createElement('div');
    panel.className = 'inspect';
    document.body.appendChild(panel);
    delegateTooltips(panel, createTooltip());
    renderInspectPanel(panel, unitPanel());
    hover(panel.querySelector('.inspect-catalyst')!);
    expect(tip()!.textContent).toMatch(/prep|dash|blast|spent/);
  });
});

describe('TOOLTIP-SWEEP: nothing in the client is left on `title`', () => {
  it('the four converted sites are the four that had one', () => {
    // A sweep's own regression: the point is that the *family* is closed, so
    // this reads the sources rather than trusting four separate assertions to
    // stay exhaustive. `main.ts` sets one on the `<h1>` — that is the page
    // heading naming the loaded setup, not a control tooltip.
    const files = ['hud.ts', 'app.ts', 'inspect-panel.ts', 'lobby-screen.ts'];
    for (const name of files) {
      const src = readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8');
      const assignments = [...src.matchAll(/^\s*[\w.[\]']+\.title\s*=/gm)];
      expect(assignments.map((m) => m[0].trim()), `${name} still sets a title`).toEqual([]);
    }
  });
});
