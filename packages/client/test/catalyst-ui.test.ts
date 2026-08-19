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
import { createHud, type HudAbility, type HudCatalyst, type HudCharacter, type HudModel } from '../src/hud.js';
import { catalystCost, emptyDraft, nextDraft, sprintAllowed, toUnitOrders } from '../src/targeting.js';
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
    // Second Wind is a PREP catalyst — still fully additive, so nothing in the
    // turn moves. (The Dash colour is the exception; see CAT-DASH-COST below.)
    const after = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'second_wind', isDash: false }, false);
    expect(after.catalystId).toBe('second_wind');
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
    // A PREP catalyst, which never touched the rest of the turn. (The Dash
    // colour now clears the ability on the way in — CAT-DASH-FULL below.)
    const on = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'second_wind', isDash: false }, false);
    const off = nextDraft(on, { type: 'selectCatalyst', catalystId: 'second_wind', isDash: false }, false);
    expect(off.catalystId).toBeUndefined();
    expect(off.catalystAim).toEqual([]);
    expect(off.abilityId).toBe('rail_shot'); // the rest of the turn is untouched
  });

  it('swapping catalysts clears the old aim so it cannot be sent with the new one', () => {
    const shift = { ...armed(), catalystId: 'shift', catalystAim: [{ x: 4, y: 7 }] };
    const swapped = nextDraft(shift, { type: 'selectCatalyst', catalystId: 'adrenaline', isDash: false }, false, true);
    expect(swapped.catalystId).toBe('adrenaline');
    expect(swapped.catalystAim).toEqual([]);
  });

  it('`clear` resets everything, catalyst included', () => {
    const draft = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'shift', isDash: true }, false);
    expect(nextDraft(draft, { type: 'clear' }, false)).toEqual(emptyDraft('vex-t0-0'));
  });
});

/**
 * CAT-DASH-COST — "Dash Catalysts should not be a free action" (owner
 * directive, 2026-08-28). The Dash colour alone buys its effect with the Move,
 * so it is exclusive with walking and sprinting the way a dash ability is. The
 * separate-slot invariant above still holds for everything else: it never
 * touches the chosen ability or its aim, only the Move it is now paying with.
 */
describe('CAT-DASH-FULL: a Dash catalyst and the whole active turn are one choice', () => {
  const armed = () => ({
    ...emptyDraft('vex-t0-0'),
    abilityId: 'rail_shot',
    aim: [{ x: 14, y: 7 }],
    aimStep: 12,
    movePath: [{ x: 2, y: 7 }, { x: 3, y: 7 }],
  });

  it('arming Shift drops the drawn move — the engine would throw it away anyway', () => {
    const after = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'shift', isDash: true }, false);
    expect(after.catalystId).toBe('shift');
    expect(after.movePath).toEqual([]);
    expect(after.sprint).toBe(false);
  });

  it('…and the ability and its aim with it — it IS the active turn now', () => {
    // The inversion. Under CAT-DASH-COST this asserted the ability survived
    // untouched; the catalyst only bought the Move. Owner ruling 2026-09-01
    // prices it at the whole action, so a drafted ability left sitting beside it
    // would promise something the engine is going to throw away.
    const after = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'shift', isDash: true }, false);
    expect(after.abilityId).toBeUndefined();
    expect(after.aim).toEqual([]);
    expect(after.aimStep).toBeUndefined();
  });

  it('choosing an ability hands the Dash catalyst back, rather than voiding it later', () => {
    const shifted = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'shift', isDash: true }, false);
    const armedAbility = nextDraft(shifted, { type: 'selectAbility', abilityId: 'rail_shot', isDash: false }, false, true);
    expect(armedAbility.abilityId).toBe('rail_shot');
    expect(armedAbility.catalystId).toBeUndefined();
  });

  it('but a PREP catalyst still stacks with an ability and a move', () => {
    const after = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'second_wind', isDash: false }, false);
    expect(after.catalystId).toBe('second_wind');
    expect(after.abilityId).toBe('rail_shot');
    expect(after.movePath).toHaveLength(2);
  });

  it('applies to every Dash catalyst, not only the one that repositions', () => {
    const fade = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'fade', isDash: true }, false);
    expect(fade.movePath).toEqual([]);
  });

  it('leaves Prep and Blast catalysts exactly as additive as before', () => {
    for (const id of ['second_wind', 'adrenaline']) {
      const after = nextDraft(armed(), { type: 'selectCatalyst', catalystId: id, isDash: false }, false);
      expect(after.movePath, id).toHaveLength(2);
    }
  });

  it('choosing to move hands the Dash catalyst back rather than silently voiding it', () => {
    const shifted = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'shift', isDash: true }, false);
    const moved = nextDraft(shifted, { type: 'selectMove' }, false, true);
    expect(moved.catalystId).toBeUndefined();
    expect(moved.catalystAim).toEqual([]);
  });

  it('and so does Sprint — they are bidding for the same Move', () => {
    const shifted = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'shift', isDash: true }, false);
    const sprinted = nextDraft(shifted, { type: 'selectSprint' }, false, true);
    expect(sprinted.catalystId).toBeUndefined();
    expect(sprinted.sprint).toBe(true);
  });

  it('a Prep catalyst is NOT handed back by choosing to move', () => {
    const helped = nextDraft(armed(), { type: 'selectCatalyst', catalystId: 'second_wind', isDash: false }, false);
    expect(nextDraft(helped, { type: 'selectMove' }, false, false).catalystId).toBe('second_wind');
  });

  it('Sprint is unselectable while a Dash catalyst is armed, and fine otherwise', () => {
    const draft = emptyDraft('u');
    expect(sprintAllowed(draft, true)).toBe(false);
    expect(sprintAllowed(draft, false)).toBe(true);
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
  hp: 95, maxHp: 95, energy: 0, shield: 0, locked: false, hasOrder: false, statuses: [], ...over,
});
const slot = (id: string, over: Partial<HudCatalyst> = {}): HudCatalyst => ({
  id, name: POOL[id]!.name, phase: POOL[id]!.phase, cost: catalystCost(POOL[id]!),
  spent: false, selected: false, def: POOL[id]!, ...over,
});
const model = (over: Partial<HudModel> = {}): HudModel => ({
  active: character(),
  roster: [character()],
  abilities: [],
  modes: [],
  catalysts: [slot('second_wind'), slot('shift'), slot('adrenaline')],
  move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
  chase: { armed: false, disabled: false },
  lock: { label: 'Lock In ▸' },
  view: { projection: 'Isometric', orbit: false },
  ...over,
});
const handlers = () => ({
  selectCharacter: vi.fn(), selectAbility: vi.fn(), selectCatalyst: vi.fn(), hoverAbility: vi.fn(),
  selectMove: vi.fn(), selectChase: vi.fn(), hoverMove: vi.fn(), hold: vi.fn(), lock: vi.fn(),
  toggleProjection: vi.fn(), toggleOrbit: vi.fn(), extendTime: vi.fn(), selectMode: vi.fn(),
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
    expect(slots().map((b) => b.textContent))
      .toEqual(['Second Windprepfree', 'Shiftdashyour action', 'Adrenalineblastfree']);
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

/**
 * CAT-COST-LABEL — "Prep Catalyst and Blast Catalyst are not showing as free
 * actions." Free *abilities* already carried a tag and the catalyst row carried
 * none, so two additive mechanics on screen at once looked like different kinds
 * of thing. Post-CAT-DASH-COST the tag is load-bearing rather than decorative:
 * the Dash slot is the one that prices your turn, and a player has to know that
 * *before* spending a once-per-match resource.
 */
describe('CAT-COST-LABEL: each slot says what it costs', () => {
  const costs = () => [...root.querySelectorAll('.hud-catalyst-cost')] as HTMLElement[];

  it('tags Prep and Blast free, and Dash as costing your whole action', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    expect(costs().map((n) => n.textContent)).toEqual(['free', 'your action', 'free']);
  });

  it('marks them with distinct classes, so the exception can be styled as one', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    expect(costs().map((n) => n.className)).toEqual([
      'hud-catalyst-cost free', 'hud-catalyst-cost action', 'hud-catalyst-cost free',
    ]);
  });

  it('derives the cost from the phase, for every catalyst in the pool', () => {
    // One rule: yellow IS your turn, the other two colours cost nothing.
    for (const def of Object.values(POOL)) {
      expect(catalystCost(def), def.id).toBe(def.phase === 'dash' ? 'action' : 'free');
    }
  });

  it('drops the tag on a spent slot — what it cost stopped mattering', () => {
    const hud = createHud(root, handlers());
    hud.update(model({ catalysts: [slot('second_wind', { spent: true }), slot('shift'), slot('adrenaline')] }));
    expect(costs()).toHaveLength(2);
    expect(slots()[0]!.textContent).toContain('spent');
  });

  it('keeps the phase word too — the cost is added information, not a swap', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    expect(slots()[1]!.textContent).toContain('dash');
    expect(slots()[1]!.textContent).toContain('your action');
  });
});

/**
 * CAT-DASH-FULL, the hotbar half. The reducer clearing the ability is only half
 * a rule — if the buttons stay lit, the player learns it by having their turn
 * silently rewritten.
 */
describe('CAT-DASH-FULL: the hotbar goes dark while a Dash catalyst is armed', () => {
  const hudAbility = (over: Partial<HudAbility> = {}): HudAbility => ({
    id: 'rail_shot', name: 'Rail Shot', isUlt: false, available: true,
    cooldown: 0, selected: false, free: false, def: VEX.abilities[0]!, ...over,
  });
  const buttons = () => [...root.querySelectorAll('.hud-ability')] as HTMLButtonElement[];

  it('disables a normal ability button when the model says it is unavailable', () => {
    const hud = createHud(root, handlers());
    hud.update(model({
      abilities: [hudAbility({ available: false, reason: 'catalyst' })],
    }));
    expect(buttons()[0]!.disabled).toBe(true);
    // Not "cooldown" and not "energy": the slot is spoken for, which is a third
    // reason and reads as one.
    expect(buttons()[0]!.textContent).toContain('catalyst');
  });

  it('leaves a FREE ability usable — it is a separate free action', () => {
    // The ruling prices the *active* turn; a free action was never part of it.
    const hud = createHud(root, handlers());
    hud.update(model({
      abilities: [hudAbility({ id: 'overwatch_trap', name: 'Overwatch Trap', free: true, available: true })],
    }));
    expect(buttons()[0]!.disabled).toBe(false);
  });
});
