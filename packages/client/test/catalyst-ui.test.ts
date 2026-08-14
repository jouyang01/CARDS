// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCatalystPool,
  createMatch,
  type CatalystData,
  type CharacterDef,
  type MapDef,
} from '@cards/engine';
import { createHud, type HudCatalyst, type HudCharacter, type HudModel } from '../src/hud.js';
import { emptyDraft, nextDraft, toUnitOrders } from '../src/targeting.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * CAT2 — the catalyst is a **separate slot**.
 *
 * This is the same trap MS1 fixed for move-and-shoot, one layer up: if
 * selecting a catalyst clears the chosen ability, then a catalyst can only be
 * used *instead of* your turn, which is the exact opposite of a free action.
 * It would look like a working feature the whole way through — the button
 * highlights, the order sends, the engine accepts it — so the draft-level tests
 * below are the ones that matter.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const POOL = buildCatalystPool(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/catalysts.json'), 'utf8')) as CatalystData,
);
const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }], [{ x: 13, y: 7 }]],
};

describe('CAT2: selecting a catalyst never replaces the ability selection', () => {
  const armed = () => ({
    ...emptyDraft('vex-t0-0'),
    abilityId: 'rail_shot',
    aim: [{ x: 14, y: 7 }],
    aimStep: 12,
    movePath: [{ x: 2, y: 7 }, { x: 3, y: 7 }],
  });

  it('keeps the ability, its aim, its rotation and the drawn move', () => {
    const after = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'shift' }, false);
    expect(after.catalystId).toBe('shift');
    expect(after.abilityId).toBe('rail_shot');
    expect(after.aim).toEqual([{ x: 14, y: 7 }]);
    expect(after.aimStep).toBe(12);
    expect(after.movePath).toHaveLength(2);
  });

  it('and picking an ability afterwards keeps the catalyst', () => {
    const withCatalyst = nextDraft(emptyDraft('u'), { type: 'selectCatalyst', catalystId: 'adrenaline' }, false);
    const after = nextDraft(withCatalyst, { type: 'selectAbility', abilityId: 'rail_shot', isDash: false }, false);
    expect(after.catalystId).toBe('adrenaline');
    expect(after.abilityId).toBe('rail_shot');
  });

  it('survives Sprint, which clears an ability but never a free action', () => {
    const draft = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'second_wind' }, false);
    const sprinted = nextDraft(draft, { type: 'selectSprint' }, false);
    expect(sprinted.abilityId).toBeUndefined(); // Sprint is still move-only
    expect(sprinted.catalystId).toBe('second_wind'); // …and the catalyst rides along
  });

  it('survives a dash selection, which drops the move but not the free action', () => {
    const draft = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'second_wind' }, false);
    const dash = nextDraft(draft, { type: 'selectAbility', abilityId: 'combat_roll', isDash: true }, false);
    expect(dash.movePath).toEqual([]);
    expect(dash.catalystId).toBe('second_wind');
  });

  it('re-picking the same catalyst hands the slot back without clearing the turn', () => {
    const on = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'shift' }, false);
    const off = nextDraft(on, { type: 'selectCatalyst', catalystId: 'shift' }, false);
    expect(off.catalystId).toBeUndefined();
    expect(off.catalystAim).toEqual([]);
    expect(off.abilityId).toBe('rail_shot'); // the rest of the turn is untouched
  });

  it('swapping catalysts clears the old aim so it cannot be sent with the new one', () => {
    const shift = { ...armed(), catalystId: 'shift', catalystAim: [{ x: 4, y: 7 }] };
    const swapped = nextDraft(shift, { type: 'selectCatalyst', catalystId: 'adrenaline' }, false);
    expect(swapped.catalystId).toBe('adrenaline');
    expect(swapped.catalystAim).toEqual([]);
  });

  it('`clear` resets everything, catalyst included', () => {
    const draft = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'shift' }, false);
    expect(nextDraft(draft, { type: 'clear' }, false)).toEqual(emptyDraft('vex-t0-0'));
  });
});

describe('CAT2: the order that reaches the engine carries both', () => {
  it('sends the catalyst alongside the ability and the move', () => {
    const draft = {
      ...emptyDraft('vex-t0-0'),
      abilityId: 'rail_shot',
      aim: [{ x: 14, y: 7 }],
      movePath: [{ x: 2, y: 7 }],
      catalystId: 'shift',
      catalystAim: [{ x: 1, y: 4 }],
    };
    const order = toUnitOrders(VEX, draft);
    expect(order.catalyst).toEqual({ abilityId: 'shift', target: [{ x: 1, y: 4 }] });
    expect(order.ability?.abilityId).toBe('rail_shot');
    expect(order.movePath).toEqual([{ x: 2, y: 7 }]);
  });

  it('sends a self-cast catalyst with no target at all', () => {
    const order = toUnitOrders(VEX, { ...emptyDraft('u'), catalystId: 'adrenaline' });
    expect(order.catalyst).toEqual({ abilityId: 'adrenaline', target: [] });
    expect(order.ability).toBeUndefined();
  });

  it('sends a catalyst on a Sprint turn — a free action never prices the turn', () => {
    const order = toUnitOrders(VEX, {
      ...emptyDraft('u'), sprint: true, movePath: [{ x: 2, y: 7 }], catalystId: 'second_wind',
    });
    expect(order.sprint).toBe(true);
    expect(order.catalyst?.abilityId).toBe('second_wind');
  });

  it('a catalyst alone counts as having ordered something', () => {
    // Otherwise the HUD would mark the character as holding, and the player
    // would think the slot had not registered.
    const state = createMatch(OPEN, '1v1', [[VEX], [BASTION]]);
    expect(state.units[0]!.catalysts).toHaveLength(3);
    const order = toUnitOrders(VEX, { ...emptyDraft('u'), catalystId: 'shift', catalystAim: [{ x: 3, y: 7 }] });
    expect(order.catalyst).toBeDefined();
  });
});

// ── The HUD row ─────────────────────────────────────────────────────────────

const character = (over: Partial<HudCharacter> = {}): HudCharacter => ({
  unitId: 'vex-t0-0', name: 'Vex', archetype: 'firepower', colour: '#4f8cff',
  hp: 95, maxHp: 95, energy: 0, shield: 0, locked: false, hasOrder: false, ...over,
});
const slot = (id: string, over: Partial<HudCatalyst> = {}): HudCatalyst => ({
  id, name: POOL[id]!.name, phase: POOL[id]!.phase, spent: false, selected: false, def: POOL[id]!, ...over,
});
const model = (over: Partial<HudModel> = {}): HudModel => ({
  active: character(),
  roster: [character()],
  abilities: [],
  catalysts: [slot('second_wind'), slot('shift'), slot('adrenaline')],
  move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
  lock: { label: 'Lock In ▸' },
  view: { projection: 'Isometric', orbit: false },
  ...over,
});
const handlers = () => ({
  selectCharacter: vi.fn(), selectAbility: vi.fn(), selectCatalyst: vi.fn(), hoverAbility: vi.fn(),
  selectMove: vi.fn(), hoverMove: vi.fn(), hold: vi.fn(), lock: vi.fn(),
  toggleProjection: vi.fn(), toggleOrbit: vi.fn(),
});

let root: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.appendChild(root);
});
const slots = () => [...root.querySelectorAll('.hud-catalyst')] as HTMLButtonElement[];

describe('CAT2: three slots, in phase order, greyed out once spent', () => {
  it('shows one slot per phase, in Prep → Dash → Blast order', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    expect(slots().map((b) => b.dataset['phase'])).toEqual(['prep', 'dash', 'blast']);
    expect(slots().map((b) => b.textContent)).toEqual(['Second Windprep', 'Shiftdash', 'Adrenalineblast']);
  });

  it('a spent slot is disabled, marked, and still says what it was', () => {
    const hud = createHud(root, handlers());
    hud.update(model({ catalysts: [slot('second_wind', { spent: true }), slot('shift'), slot('adrenaline')] }));
    const [spent] = slots();
    expect(spent!.disabled).toBe(true);
    expect(spent!.classList.contains('spent')).toBe(true);
    // The name survives: an empty box tells you nothing about what you spent.
    expect(spent!.textContent).toContain('Second Wind');
    expect(spent!.textContent).toContain('spent');
  });

  it('clicking a slot asks the controller for it — the HUD decides nothing', () => {
    const h = handlers();
    const hud = createHud(root, h);
    hud.update(model());
    slots()[1]!.click();
    expect(h.selectCatalyst).toHaveBeenCalledWith('shift');
  });

  it('marks the selected slot without touching the others', () => {
    const hud = createHud(root, handlers());
    hud.update(model({ catalysts: [slot('second_wind'), slot('shift', { selected: true }), slot('adrenaline')] }));
    expect(slots().map((b) => b.classList.contains('sel'))).toEqual([false, true, false]);
  });

  it('keeps the SAME nodes across updates, like the hotbar (UI3)', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    const before = slots();
    hud.update(model({ catalysts: [slot('second_wind', { spent: true }), slot('shift'), slot('adrenaline')] }));
    expect(slots()).toEqual(before);
  });

  it('hides the row entirely when the match has no catalyst pool', () => {
    const hud = createHud(root, handlers());
    hud.update(model({ catalysts: [] }));
    expect((root.querySelector('.hud-catalysts') as HTMLElement).style.display).toBe('none');
  });
});
