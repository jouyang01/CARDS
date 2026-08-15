// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatch, type CharacterDef, type MapDef } from '@cards/engine';
import { createHud, type HudAbility, type HudCharacter, type HudModel } from '../src/hud.js';
import {
  draftFreeAbility,
  emptyDraft,
  draftHasOrder,
  isFreeAbility,
  nextDraft,
  sprintAllowed,
  toUnitOrders,
} from '../src/targeting.js';
import vex from '../../../data/characters/vex.json';
import wisp from '../../../data/characters/wisp.json';
import thorn from '../../../data/characters/thorn.json';

/**
 * FREE-UI — a free ability is a separate slot, exactly like a catalyst.
 *
 * The engine has accepted `order.freeAbility` since FREE1 and the client had
 * **zero references to it**: a `free: true` ability filled the normal
 * `abilityId` slot, went out as `order.ability`, and disabled Sprint. So the
 * mechanic the engine implements — place the trap AND take your turn — was
 * unreachable through the UI, which is what three Dev Notes reported.
 *
 * The tests that matter are the ones that assert what reaches `UnitOrders`,
 * because every intermediate step looked fine while this was broken.
 */

const VEX = vex as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const THORN = thorn as unknown as CharacterDef;
const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }], [{ x: 13, y: 7 }]],
};

/** The three the ruling derived: Overwatch Trap, Snare Bloom, Veil & Decoy. */
const FREE_ABILITIES = [
  [VEX, 'overwatch_trap'],
  [THORN, 'snare_bloom'],
  [WISP, 'veil_decoy'],
] as const;

describe('FREE-UI: the roster’s free abilities are recognised as free', () => {
  it.each(FREE_ABILITIES)('%#: is marked free in data and by the client', (character, id) => {
    const def = character.abilities.find((a) => a.id === id)!;
    expect(def.free).toBe(true);
    expect(isFreeAbility(def)).toBe(true);
  });

  it('a normal ability is not', () => {
    expect(isFreeAbility(VEX.abilities.find((a) => a.id === 'rail_shot')!)).toBe(false);
  });
});

describe('FREE-UI: a free ability never occupies the normal ability slot', () => {
  const armed = () => ({
    ...emptyDraft('vex-t0-0'),
    abilityId: 'rail_shot',
    aim: [{ x: 14, y: 7 }],
    aimStep: 12,
    movePath: [{ x: 2, y: 7 }, { x: 3, y: 7 }],
  });

  it('arming it leaves the chosen ability, its aim, its rotation and the move intact', () => {
    const after = nextDraft(armed(), { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    expect(after.freeAbilityId).toBe('overwatch_trap');
    expect(after.abilityId).toBe('rail_shot');
    expect(after.aim).toEqual([{ x: 14, y: 7 }]);
    expect(after.aimStep).toBe(12);
    expect(after.movePath).toHaveLength(2);
  });

  it('and choosing an ability afterwards keeps the free one', () => {
    const free = nextDraft(emptyDraft('u'), { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    const after = nextDraft(free, { type: 'selectAbility', abilityId: 'rail_shot', isDash: false }, false);
    expect(after.freeAbilityId).toBe('overwatch_trap');
    expect(after.abilityId).toBe('rail_shot');
  });

  it('does NOT disable Sprint — the reported bug, at the source', () => {
    // `sprintAllowed` keys off the normal ability. A free ability living in
    // `abilityId` is exactly what made "I cannot sprint after placing my trap"
    // true, and it looked correct at every layer above this one.
    const free = nextDraft(emptyDraft('u'), { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    expect(sprintAllowed(free)).toBe(true);
    const withAbility = nextDraft(free, { type: 'selectAbility', abilityId: 'rail_shot', isDash: false }, false);
    expect(sprintAllowed(withAbility)).toBe(false); // …and the real exclusion still holds
  });

  it('survives Sprint, which clears an ability but never a free action', () => {
    const draft = nextDraft(armed(), { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    const sprinted = nextDraft(draft, { type: 'selectSprint' }, false);
    expect(sprinted.abilityId).toBeUndefined();
    expect(sprinted.freeAbilityId).toBe('overwatch_trap');
  });

  it('survives a dash selection, which drops the move but not the free action', () => {
    const draft = nextDraft(armed(), { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    const dash = nextDraft(draft, { type: 'selectAbility', abilityId: 'combat_roll', isDash: true }, false);
    expect(dash.movePath).toEqual([]);
    expect(dash.freeAbilityId).toBe('overwatch_trap');
  });

  it('re-picking hands the slot back without clearing the turn', () => {
    const on = nextDraft(armed(), { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    const off = nextDraft(on, { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    expect(off.freeAbilityId).toBeUndefined();
    expect(off.freeAim).toEqual([]);
    expect(off.abilityId).toBe('rail_shot');
  });

  it('counts as having ordered something on its own', () => {
    const free = nextDraft(emptyDraft('u'), { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    expect(draftHasOrder(free)).toBe(true);
  });

  it('`clear` resets it with everything else', () => {
    const draft = nextDraft(armed(), { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    expect(nextDraft(draft, { type: 'clear' }, false)).toEqual(emptyDraft('vex-t0-0'));
  });

  it('resolves against the character, so the aim knows what shape to use', () => {
    const draft = { ...emptyDraft('u'), freeAbilityId: 'overwatch_trap' };
    expect(draftFreeAbility(VEX, draft)?.id).toBe('overwatch_trap');
    expect(draftFreeAbility(VEX, emptyDraft('u'))).toBeUndefined();
  });
});

describe('FREE-UI: all three reach UnitOrders in one turn', () => {
  it('free ability + normal ability + move — the AC, end to end', () => {
    const order = toUnitOrders(VEX, {
      ...emptyDraft('vex-t0-0'),
      abilityId: 'rail_shot',
      aim: [{ x: 14, y: 7 }],
      movePath: [{ x: 2, y: 7 }, { x: 3, y: 7 }],
      freeAbilityId: 'overwatch_trap',
      freeAim: [{ x: 3, y: 8 }],
    });
    expect(order.freeAbility).toEqual({ abilityId: 'overwatch_trap', target: [{ x: 3, y: 8 }] });
    expect(order.ability?.abilityId).toBe('rail_shot');
    expect(order.movePath).toEqual([{ x: 2, y: 7 }, { x: 3, y: 7 }]);
  });

  it('free ability + SPRINT — the Dev Note, end to end', () => {
    const order = toUnitOrders(WISP, {
      ...emptyDraft('wisp-t0-0'),
      sprint: true,
      movePath: [{ x: 2, y: 7 }],
      freeAbilityId: 'veil_decoy',
      freeAim: [{ x: 1, y: 7 }],
    });
    expect(order.sprint).toBe(true);
    expect(order.freeAbility?.abilityId).toBe('veil_decoy');
    expect(order.ability).toBeUndefined(); // it never touches the normal slot
  });

  it('a free ability alone sends only `freeAbility`', () => {
    const order = toUnitOrders(THORN, {
      ...emptyDraft('u'), freeAbilityId: 'snare_bloom', freeAim: [{ x: 4, y: 4 }],
    });
    expect(order.freeAbility?.abilityId).toBe('snare_bloom');
    expect(order.ability).toBeUndefined();
    expect(order.sprint).toBeUndefined();
  });
});

describe('FREE-UI: one free action per turn', () => {
  it('arming a catalyst drops an armed free ability, and vice versa', () => {
    // The ruling is one free action per turn counting both together. The engine
    // already yields the catalyst; the UI should not let the player order two
    // and watch half of it silently vanish.
    const free = nextDraft(emptyDraft('u'), { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    const thenCatalyst = nextDraft(free, { type: 'selectCatalyst', catalystId: 'second_wind' }, false);
    expect(thenCatalyst.catalystId).toBe('second_wind');
    expect(thenCatalyst.freeAbilityId).toBeUndefined();

    const thenFree = nextDraft(thenCatalyst, { type: 'selectFreeAbility', abilityId: 'overwatch_trap' }, false);
    expect(thenFree.freeAbilityId).toBe('overwatch_trap');
    expect(thenFree.catalystId).toBeUndefined();
  });

  it('so an order never carries both', () => {
    const draft = nextDraft(
      nextDraft(emptyDraft('u'), { type: 'selectCatalyst', catalystId: 'second_wind' }, false),
      { type: 'selectFreeAbility', abilityId: 'overwatch_trap' },
      false,
    );
    const order = toUnitOrders(VEX, draft);
    expect(order.catalyst).toBeUndefined();
    expect(order.freeAbility?.abilityId).toBe('overwatch_trap');
  });

  it('swapping free abilities clears the old aim', () => {
    const one = { ...emptyDraft('u'), freeAbilityId: 'overwatch_trap', freeAim: [{ x: 3, y: 3 }] };
    const two = nextDraft(one, { type: 'selectFreeAbility', abilityId: 'snare_bloom' }, false);
    expect(two.freeAbilityId).toBe('snare_bloom');
    expect(two.freeAim).toEqual([]);
  });
});

// ── The hotbar has to say a free action is free ─────────────────────────────

const character = (over: Partial<HudCharacter> = {}): HudCharacter => ({
  unitId: 'vex-t0-0', name: 'Vex', archetype: 'firepower', colour: '#4f8cff',
  hp: 95, maxHp: 95, energy: 0, shield: 0, locked: false, hasOrder: false, ...over,
});
const hudAbility = (id: string, over: Partial<HudAbility> = {}): HudAbility => {
  const def = [...VEX.abilities, VEX.ultimate].find((a) => a.id === id)!;
  return {
    id, name: def.name, isUlt: false, available: true, cooldown: 0, selected: false,
    free: def.free === true, def, ...over,
  };
};
const model = (over: Partial<HudModel> = {}): HudModel => ({
  active: character(),
  roster: [character()],
  abilities: [hudAbility('rail_shot'), hudAbility('overwatch_trap')],
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
const buttons = () => [...root.querySelectorAll('.hud-ability')] as HTMLButtonElement[];

describe('FREE-UI: the hotbar marks a free action as additive', () => {
  it('tags the free ability and leaves the normal one alone', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    const [rail, trap] = buttons();
    expect(rail!.classList.contains('free')).toBe(false);
    expect(trap!.classList.contains('free')).toBe(true);
    expect(trap!.textContent).toContain('free');
  });

  it('a cooldown still wins the note — you cannot have it at all beats how it costs', () => {
    const hud = createHud(root, handlers());
    hud.update(model({
      abilities: [hudAbility('overwatch_trap', { available: false, reason: 'cooldown', cooldown: 3 })],
    }));
    expect(buttons()[0]!.textContent).toContain('3t');
    expect(buttons()[0]!.disabled).toBe(true);
  });

  it('the match really deals a character with a free ability', () => {
    // Guard against the roster losing them: the UI work is pointless if no
    // shipped character can reach it.
    const s = createMatch(OPEN, '1v1', [[VEX], [WISP]]);
    expect(s.units).toHaveLength(2);
    expect([...VEX.abilities, ...WISP.abilities].filter((a) => a.free === true).length).toBeGreaterThan(0);
  });
});
