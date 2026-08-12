import { describe, expect, it } from 'vitest';
import { buildBoard, createMatch, expandShape, type CharacterDef, type MapDef } from '@cards/engine';
import {
  abilityOptions,
  abilityPreview,
  emptyDraft,
  movePreview,
  pathValid,
  sprintAllowed,
  toUnitOrders,
  toUnitOrdersFor,
} from '../src/targeting.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const OPEN: MapDef = { id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [], spawns: [[{ x: 1, y: 7 }], [{ x: 13, y: 7 }]] };

const state = () => createMatch(OPEN, '1v1', [[VEX], [BASTION]]);
const vexUnit = (s = state()) => s.units.find((u) => u.characterId === 'vex')!;

describe('ability aim preview reuses the engine (item 18 AC)', () => {
  it("Vex's Rail Shot previews exactly expandShape's squares", () => {
    const u = vexUnit();
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    const aim = [{ x: 14, y: 7 }]; // fire east down the row
    const preview = abilityPreview(OPEN, u, rail, aim);
    expect(preview).toEqual(expandShape(buildBoard(OPEN), rail, u.pos, aim));
    // sanity: a straight 8-long ray from (1,7)
    expect(preview).toEqual([2, 3, 4, 5, 6, 7, 8, 9].map((x) => ({ x, y: 7 })));
  });

  it('an out-of-range aim previews nothing (no client geometry)', () => {
    const u = vexUnit();
    const grenade = VEX.abilities.find((a) => a.id === 'frag_grenade')!; // circle range 6
    expect(abilityPreview(OPEN, u, grenade, [{ x: 14, y: 14 }])).toEqual([]);
  });
});

describe('move legality reuses the engine', () => {
  it('rejects an illegal path and accepts a legal one via validateMovePath', () => {
    const s = state();
    const u = vexUnit(s);
    expect(pathValid(OPEN, s, u, [{ x: 2, y: 2 }], false)).toBe(false); // diagonal jump
    expect(pathValid(OPEN, s, u, [{ x: 2, y: 7 }, { x: 3, y: 7 }], false)).toBe(true);
  });

  it('splits reachable squares into stops and walk-through', () => {
    const s = state();
    const u = vexUnit(s);
    const { stops, through } = movePreview(OPEN, s, u, false);
    expect(stops.length).toBeGreaterThan(0);
    expect(through).toEqual([]); // no allies here → nothing walk-through-only
  });
});

describe('sprint vs ability exclusivity (GAME_SPEC §2)', () => {
  it('sprint is disallowed once an ability is chosen, and dropped from the order', () => {
    const withAbility = { ...emptyDraft('vex-t0-0'), abilityId: 'rail_shot', aim: [{ x: 14, y: 7 }], sprint: true };
    expect(sprintAllowed(withAbility)).toBe(false);
    const order = toUnitOrders(VEX, withAbility);
    expect(order.sprint).toBeUndefined();
    expect(order.ability?.abilityId).toBe('rail_shot');
  });

  it('a plain sprint order carries the path and the sprint flag', () => {
    const draft = { ...emptyDraft('vex-t0-0'), sprint: true, movePath: [{ x: 2, y: 7 }, { x: 3, y: 7 }] };
    expect(sprintAllowed(draft)).toBe(true);
    const order = toUnitOrders(VEX, draft);
    expect(order.sprint).toBe(true);
    expect(order.movePath).toHaveLength(2);
  });
});

describe('dash ability is the movement (no separate move path)', () => {
  it('drops a move path when the chosen ability is a dash', () => {
    const draft = { ...emptyDraft('vex-t0-0'), abilityId: 'combat_roll', aim: [{ x: 2, y: 7 }, { x: 3, y: 7 }], movePath: [{ x: 1, y: 6 }] };
    const order = toUnitOrders(VEX, draft);
    expect(order.ability?.abilityId).toBe('combat_roll');
    expect(order.movePath).toBeUndefined();
  });
});

describe('ability availability from unit state', () => {
  it('flags cooldown and ult-energy gating', () => {
    const u = vexUnit();
    u.cooldowns[VEX.abilities.find((a) => a.id === 'frag_grenade')!.id] = 2;
    const opts = abilityOptions(u, VEX);
    const grenade = opts.find((o) => o.def.id === 'frag_grenade')!;
    expect(grenade.available).toBe(false);
    expect(grenade.reason).toBe('cooldown');
    const rail = opts.find((o) => o.def.id === 'rail_shot')!;
    expect(rail.available).toBe(true);
    const ult = opts.find((o) => o.isUlt)!;
    expect(ult.available).toBe(false); // 0 energy < 100
    expect(ult.reason).toBe('energy');
    u.energy = 100;
    expect(abilityOptions(u, VEX).find((o) => o.isUlt)!.available).toBe(true);
  });
});

describe('a player controlling two characters produces two orders (item 18 AC)', () => {
  it('builds one UnitOrders per controlled character', () => {
    const chars = new Map<string, CharacterDef>([['A', VEX], ['B', BASTION]]);
    const drafts = [
      { ...emptyDraft('A'), abilityId: 'rail_shot', aim: [{ x: 14, y: 7 }] },
      { ...emptyDraft('B'), sprint: true, movePath: [{ x: 12, y: 7 }] },
    ];
    const orders = toUnitOrdersFor(chars, drafts);
    expect(orders.map((o) => o.unitId)).toEqual(['A', 'B']);
    expect(orders[0]!.ability?.abilityId).toBe('rail_shot');
    expect(orders[1]!.sprint).toBe(true);
  });
});
