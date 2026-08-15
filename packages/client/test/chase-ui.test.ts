// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDef, TurnEvent } from '@cards/engine';
import { createHud, type HudCharacter, type HudModel } from '../src/hud.js';
import { emptyDraft, nextDraft, toUnitOrders } from '../src/targeting.js';
import { logEntriesForTurn, type LogNames } from '../src/combat-log.js';
import { LAYER_LIFT } from '../src/renderer3d.js';
import vex from '../../../data/characters/vex.json';

/**
 * CHASE1 (client) — the affordance for an order whose subject is a **unit**.
 *
 * Every other order the client sends names squares, so a chase is the one place
 * the draft has to hold an id and the Move slot has two possible occupants. The
 * tests worth writing are therefore about the slot: what reaches `UnitOrders`,
 * and what happens to the drawn path a chase displaces (and vice versa).
 */

const VEX = vex as unknown as CharacterDef;
/** Vex's dash ability and a normal blast one, read off the shipped data. */
const DASH = VEX.abilities.find((a) => a.phase === 'dash')!;
const BLAST = VEX.abilities.find((a) => a.phase === 'blast' && a.free !== true)!;

const withChase = (targetUnitId: string, currentIsDash = false) =>
  nextDraft(emptyDraft('me'), { type: 'selectChase', targetUnitId }, currentIsDash);

describe('CHASE1: the chase occupies the Move slot', () => {
  it('reaches the engine as `order.chase`', () => {
    const order = toUnitOrders(VEX, withChase('enemy-1'));
    expect(order.chase).toBe('enemy-1');
    expect(order.movePath).toBeUndefined();
  });

  it('a drawn path and a chase never both go out', () => {
    // The engine drops the path anyway; sending it would put a promise in the
    // order that resolution does not keep.
    const drafted = { ...emptyDraft('me'), movePath: [{ x: 2, y: 2 }] };
    const chasing = nextDraft(drafted, { type: 'selectChase', targetUnitId: 'enemy-1' }, false);
    expect(chasing.movePath).toEqual([]);
    const order = toUnitOrders(VEX, chasing);
    expect(order.chase).toBe('enemy-1');
    expect(order.movePath).toBeUndefined();
  });

  it('drawing a move afterwards hands the slot back', () => {
    const back = nextDraft(withChase('enemy-1'), { type: 'selectMove' }, false);
    expect(back.chaseTargetId).toBeUndefined();
    expect(toUnitOrders(VEX, back).chase).toBeUndefined();
  });

  it('re-picking the same target deselects it', () => {
    const off = nextDraft(withChase('enemy-1'), { type: 'selectChase', targetUnitId: 'enemy-1' }, false);
    expect(off.chaseTargetId).toBeUndefined();
  });

  it('picking a different target just re-points it', () => {
    const moved = nextDraft(withChase('enemy-1'), { type: 'selectChase', targetUnitId: 'enemy-2' }, false);
    expect(moved.chaseTargetId).toBe('enemy-2');
  });

  it('Sprint takes the slot back', () => {
    const sprinting = nextDraft(withChase('enemy-1'), { type: 'selectSprint' }, false);
    expect(sprinting.chaseTargetId).toBeUndefined();
    expect(sprinting.sprint).toBe(true);
  });
});

describe('CHASE1: it composes exactly like a drawn move', () => {
  it('chase AND shoot — a non-dash ability keeps its slot', () => {
    const aimed = { ...emptyDraft('me'), abilityId: BLAST.id, aim: [{ x: 6, y: 6 }] };
    const chasing = nextDraft(aimed, { type: 'selectChase', targetUnitId: 'enemy-1' }, false);
    expect(chasing.abilityId, 'move-and-shoot, with a unit for a destination').toBe(BLAST.id);
    const order = toUnitOrders(VEX, chasing);
    expect(order.ability?.abilityId).toBe(BLAST.id);
    expect(order.chase).toBe('enemy-1');
  });

  it('a dash ability drops the chase — the dash IS the reposition', () => {
    const chasing = withChase('enemy-1');
    const dashed = nextDraft(chasing, { type: 'selectAbility', abilityId: DASH.id, isDash: true }, false);
    expect(dashed.chaseTargetId).toBeUndefined();
    expect(toUnitOrders(VEX, dashed).chase).toBeUndefined();
  });

  it('and choosing a chase while a dash is armed clears the dash', () => {
    const dashed = { ...emptyDraft('me'), abilityId: DASH.id, aim: [{ x: 4, y: 4 }] };
    const chasing = nextDraft(dashed, { type: 'selectChase', targetUnitId: 'enemy-1' }, true);
    expect(chasing.abilityId, 'one reposition per turn, either way round').toBeUndefined();
    expect(chasing.chaseTargetId).toBe('enemy-1');
  });

  it('a Dash catalyst is handed back when a chase is chosen', () => {
    // CAT-DASH-FULL: a Dash catalyst is the whole active turn, so it and a chase
    // are bidding for the same one. Picking the chase releases the slot rather
    // than silently voiding the catalyst at resolution.
    const armed = { ...emptyDraft('me'), catalystId: 'shift', catalystAim: [{ x: 4, y: 4 }] };
    const chasing = nextDraft(armed, { type: 'selectChase', targetUnitId: 'enemy-1' }, false, true);
    expect(chasing.catalystId).toBeUndefined();
    expect(chasing.chaseTargetId).toBe('enemy-1');
  });

  it('an empty draft still sends no chase', () => {
    expect(toUnitOrders(VEX, emptyDraft('me')).chase).toBeUndefined();
  });
});

describe('CHASE1: the HUD names the quarry', () => {
  const character = (): HudCharacter => ({
    unitId: 'me', name: 'Vex', archetype: 'firepower', colour: '#5aa9ff',
    hp: 95, maxHp: 95, energy: 0, shield: 0, locked: false, hasOrder: false,
  });
  const model = (chase: HudModel['chase']): HudModel => ({
    active: character(), roster: [character()], abilities: [], catalysts: [],
    move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
    chase,
    lock: { label: 'Lock In ▸' },
    view: { projection: 'Isometric', orbit: false },
  });
  const handlers = () => ({
    selectCharacter: vi.fn(), selectAbility: vi.fn(), selectCatalyst: vi.fn(),
    hoverAbility: vi.fn(), selectMove: vi.fn(), selectChase: vi.fn(), hoverMove: vi.fn(),
    hold: vi.fn(), lock: vi.fn(), toggleProjection: vi.fn(), toggleOrbit: vi.fn(),
  });
  const chaseButton = (root: HTMLElement): HTMLButtonElement =>
    [...root.querySelectorAll('.hud-move')].find((b) => b.textContent?.startsWith('Chase')) as HTMLButtonElement;

  it('reads "Chase" unarmed and "Chase <name>" once a target is picked', () => {
    const root = document.createElement('div');
    const hud = createHud(root, handlers());
    hud.update(model({ armed: false, disabled: false }));
    expect(chaseButton(root).textContent).toBe('Chase');
    hud.update(model({ armed: true, disabled: false, targetName: 'Thorn' }));
    expect(chaseButton(root).textContent, 'the order names a unit, so the control must too').toBe('Chase Thorn');
    expect(chaseButton(root).classList.contains('sel')).toBe(true);
  });

  it('greys out when there is nothing to chase', () => {
    const root = document.createElement('div');
    createHud(root, handlers()).update(model({ armed: false, disabled: true }));
    expect(chaseButton(root).disabled).toBe(true);
  });
});

describe('CHASE1: the resolution reads back', () => {
  const names: LogNames = { unit: (id) => (id === 'a' ? 'Vex' : 'Thorn'), ability: (id) => id };
  const chased = (seen: boolean): TurnEvent =>
    ({ type: 'chaseResolved', unitId: 'a', targetUnitId: 'e', to: { x: 9, y: 1 }, seen });

  it('a chase into fog says where it went instead', () => {
    // The one line that has to exist: the unit stopped on a square nobody can
    // see a reason for, and "their last known position" is the reason.
    expect(logEntriesForTurn(3, [chased(false)], names)[0]?.text)
      .toBe('Vex chased Thorn to their last known position (9,1)');
  });

  it('and a chase in the open just names them', () => {
    expect(logEntriesForTurn(3, [chased(true)], names)[0]?.text).toBe('Vex chased Thorn');
  });

  it('the quarry ring sits above every aim overlay but under the selection ring', () => {
    // A chase marks a *unit*, so an aim drawn over the same square must not hide
    // it — and it must still yield to "this is who you are ordering".
    expect(LAYER_LIFT.chase).toBeGreaterThan(LAYER_LIFT.catalyst);
    expect(LAYER_LIFT.chase).toBeLessThan(LAYER_LIFT.select);
  });
});
