// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHud, type HudAbility, type HudCharacter, type HudModel } from '../src/hud.js';
import type { AbilityDef, CharacterDef } from '@cards/engine';
import vex from '../../../data/characters/vex.json';

/**
 * UI3 — the HUD's defining property is that it is **updated in place**, not
 * rebuilt. That is not a performance nicety: UI1's hover fires `mouseleave`
 * when a node under the pointer is replaced, so a rebuilt hotbar would wipe the
 * range envelope it had just asked for. These tests pin node identity across
 * updates, which is the thing that would silently regress.
 */

const VEX = vex as unknown as CharacterDef;
const def = (id: string): AbilityDef => [...VEX.abilities, VEX.ultimate].find((a) => a.id === id)!;

const character = (over: Partial<HudCharacter> = {}): HudCharacter => ({
  unitId: 'vex-t0-0', name: 'Vex', archetype: 'firepower', colour: '#4f8cff',
  hp: 95, maxHp: 95, energy: 0, shield: 0, locked: false, hasOrder: false, ...over,
});

const ability = (id: string, over: Partial<HudAbility> = {}): HudAbility => ({
  id, name: def(id).name, isUlt: id === 'lance_of_dawn', available: true,
  cooldown: 0, selected: false, free: false, def: def(id), ...over,
});

const model = (over: Partial<HudModel> = {}): HudModel => ({
  active: character(),
  roster: [character()],
  abilities: [ability('rail_shot'), ability('frag_grenade')],
  catalysts: [],
  move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
  chase: { armed: false, disabled: false },
  lock: { label: 'Lock In ▸' },
  view: { projection: 'Isometric', orbit: false },
  ...over,
});

const handlers = () => ({
  selectCharacter: vi.fn(), selectAbility: vi.fn(), selectCatalyst: vi.fn(), hoverAbility: vi.fn(),
  selectMove: vi.fn(), selectChase: vi.fn(), hoverMove: vi.fn(), hold: vi.fn(), lock: vi.fn(),
  toggleProjection: vi.fn(), toggleOrbit: vi.fn(),
});

let root: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.appendChild(root);
});

const abilityButtons = () => [...root.querySelectorAll('.hud-ability')] as HTMLButtonElement[];

describe('UI3: the HUD is updated in place, never rebuilt', () => {
  it('keeps the SAME button node across updates — the property UI1 depends on', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    const before = abilityButtons();
    hud.update(model({ abilities: [ability('rail_shot', { selected: true }), ability('frag_grenade')] }));
    const after = abilityButtons();
    // Identity, not just count: a replaced node would fire mouseleave and wipe
    // the hover state the pointer is currently expressing.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[0]!.classList.contains('sel')).toBe(true);
  });

  it('keeps the character chips too, and marks locked / has-order', () => {
    const hud = createHud(root, handlers());
    const two = [character(), character({ unitId: 'wisp-t0-1', name: 'Wisp' })];
    hud.update(model({ roster: two }));
    const before = [...root.querySelectorAll('.hud-chip')];
    expect(before).toHaveLength(2);

    hud.update(model({ roster: [character({ hasOrder: true }), character({ unitId: 'wisp-t0-1', name: 'Wisp', locked: true })] }));
    const after = [...root.querySelectorAll('.hud-chip')] as HTMLButtonElement[];
    expect(after[0]).toBe(before[0]);
    expect(after[0]!.textContent).toContain('•'); // ordered but still editable
    expect(after[1]!.textContent).toContain('✓'); // locked
    expect(after[1]!.disabled).toBe(true);
  });

  it('adds and removes buttons when the character changes, without touching survivors', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    const rail = abilityButtons()[0]!;
    hud.update(model({ abilities: [ability('rail_shot'), ability('combat_roll'), ability('lance_of_dawn')] }));
    const after = abilityButtons();
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(rail); // survivor kept its node
    expect(after.map((b) => b.textContent)).toEqual([
      def('rail_shot').name, def('combat_roll').name, `${def('lance_of_dawn').name} ★`,
    ]);
  });

  it('renders the hotbar in model order even after a swap', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    hud.update(model({ abilities: [ability('frag_grenade'), ability('rail_shot')] }));
    expect(abilityButtons().map((b) => b.textContent)).toEqual([def('frag_grenade').name, def('rail_shot').name]);
  });
});

describe('UI3: availability comes from the model, never re-derived', () => {
  it('disables an unavailable ability and shows why', () => {
    const hud = createHud(root, handlers());
    hud.update(model({
      abilities: [
        ability('rail_shot', { available: false, reason: 'cooldown', cooldown: 2 }),
        ability('lance_of_dawn', { available: false, reason: 'energy' }),
      ],
    }));
    const [cd, energy] = abilityButtons();
    expect(cd!.disabled).toBe(true);
    expect(cd!.textContent).toContain('2t');
    expect(energy!.disabled).toBe(true);
    expect(energy!.textContent).toContain('energy');
  });
});

describe('UI3: the panel reads the active character', () => {
  it('shows identity and fills HP / shield / energy bars by fraction', () => {
    const hud = createHud(root, handlers());
    hud.update(model({ active: character({ hp: 40, maxHp: 80, energy: 25, shield: 20 }) }));
    expect(root.querySelector('.hud-name')!.textContent).toBe('Vex');
    expect(root.querySelector('.hud-role')!.textContent).toBe('firepower');
    expect(root.querySelector('.hud-portrait')!.textContent).toBe('V');
    const fills = [...root.querySelectorAll('.hud-bar-fill')] as HTMLElement[];
    expect(fills[0]!.style.width).toBe('50.0%'); // 40/80 hp
    expect(fills[1]!.style.width).toBe('25.0%'); // 20/80 shield
    expect(fills[2]!.style.width).toBe('25.0%'); // 25/100 energy
  });

  it('hides the shield bar until someone actually shields you', () => {
    const hud = createHud(root, handlers());
    const bar = () => (root.querySelectorAll('.hud-bar')[1] as HTMLElement).style.display;
    hud.update(model({ active: character({ shield: 0 }) }));
    expect(bar()).toBe('none'); // a permanent empty shield bar is noise
    hud.update(model({ active: character({ shield: 30 }) }));
    expect(bar()).toBe('');
  });

  it('hides the switcher when the seat runs a single character', () => {
    const hud = createHud(root, handlers());
    hud.update(model({ roster: [character()] }));
    expect((root.querySelector('.hud-switcher') as HTMLElement).style.display).toBe('none');
    hud.update(model({ roster: [character(), character({ unitId: 'b', name: 'Wisp' })] }));
    expect((root.querySelector('.hud-switcher') as HTMLElement).style.display).toBe('');
  });
});

describe('UI3: controls are wired to handlers, and Lock In sits right of the hotbar', () => {
  it('clicking an ability, a move control and Lock In each call through', () => {
    const h = handlers();
    const hud = createHud(root, h);
    hud.update(model());
    abilityButtons()[1]!.click();
    expect(h.selectAbility).toHaveBeenCalledWith('frag_grenade');

    const moves = [...root.querySelectorAll('.hud-move')] as HTMLButtonElement[];
    moves[0]!.click();
    expect(h.selectMove).toHaveBeenCalledWith(false);
    moves[1]!.click();
    expect(h.selectMove).toHaveBeenCalledWith(true);
    // CHASE1 put a Chase control between Sprint and Clear.
    moves[2]!.click();
    expect(h.selectChase).toHaveBeenCalled();
    moves[3]!.click();
    expect(h.hold).toHaveBeenCalled();

    (root.querySelector('.hud-lock') as HTMLButtonElement).click();
    expect(h.lock).toHaveBeenCalled();
  });

  it('hovering an ability reports the id AND its definition, so TT1 still works', () => {
    const h = handlers();
    const hud = createHud(root, h);
    hud.update(model());
    abilityButtons()[0]!.dispatchEvent(new Event('mouseenter'));
    expect(h.hoverAbility).toHaveBeenCalledWith('rail_shot', abilityButtons()[0], def('rail_shot'));
    abilityButtons()[0]!.dispatchEvent(new Event('mouseleave'));
    expect(h.hoverAbility).toHaveBeenLastCalledWith(undefined);
  });

  it('Lock In is the last element of the HUD, immediately right of the hotbar', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    const order = [...root.children].map((c) => c.className);
    expect(order.indexOf('hud-centre')).toBeLessThan(order.indexOf('hud-right'));
    expect(root.querySelector('.hud-right')!.contains(root.querySelector('.hud-lock'))).toBe(true);
  });

  it('sprint is disabled once an ability is chosen (GAME_SPEC §2)', () => {
    const hud = createHud(root, handlers());
    hud.update(model({ move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: true } }));
    const moves = [...root.querySelectorAll('.hud-move')] as HTMLButtonElement[];
    expect(moves[1]!.disabled).toBe(true);
  });
});

describe('UI3: playback swaps the HUD without destroying it', () => {
  it('hides the ordering panels, shows Skip, and comes back on the next update', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    const rail = abilityButtons()[0]!;

    const onSkip = vi.fn();
    hud.showPlayback(onSkip);
    expect((root.querySelector('.hud-centre') as HTMLElement).style.display).toBe('none');
    const skip = root.querySelector('.hud-playback button') as HTMLButtonElement;
    skip.click();
    expect(onSkip).toHaveBeenCalled();

    hud.update(model());
    expect((root.querySelector('.hud-centre') as HTMLElement).style.display).toBe('');
    expect(abilityButtons()[0]).toBe(rail); // survived the round trip
  });
});
