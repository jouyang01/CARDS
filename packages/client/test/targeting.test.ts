import { describe, expect, it } from 'vitest';
import { aimInRange, buildBoard, createMatch, distance, expandShape, reachableSquares, reconstructPath, vectorToStep, type CharacterDef, type MapDef } from '@cards/engine';
import {
  abilityOptions,
  abilityPreview,
  abilityTooltip,
  aimFor,
  dashRoute,
  dragToAimStep,
  draftHasOrder,
  isRotatable,
  effectLabel,
  emptyDraft,
  moveEnvelope,
  movePreview,
  nextDraft,
  pathTo,
  pathToExact,
  pathValid,
  rangeEnvelope,
  shapeOutline,
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
    expect(pathValid(OPEN, s, u, [{ x: 2, y: 2 }], false)).toBe(false); // non-adjacent jump
    expect(pathValid(OPEN, s, u, [{ x: 2, y: 7 }, { x: 3, y: 7 }], false)).toBe(true);
    expect(pathValid(OPEN, s, u, [{ x: 2, y: 6 }], false)).toBe(true); // a legal single diagonal (MV3)
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

describe('move-and-shoot: a non-dash ability and a Move coexist (MS1)', () => {
  it('round-trips a draft carrying BOTH a non-dash ability and a move path', () => {
    const draft = {
      ...emptyDraft('vex-t0-0'),
      abilityId: 'rail_shot', // blast line — not a dash
      aim: [{ x: 14, y: 7 }],
      movePath: [{ x: 2, y: 7 }, { x: 3, y: 7 }],
    };
    const order = toUnitOrders(VEX, draft);
    expect(order.ability?.abilityId).toBe('rail_shot');
    expect(order.movePath).toEqual([{ x: 2, y: 7 }, { x: 3, y: 7 }]); // move survives alongside the shot
    expect(order.sprint).toBeUndefined(); // sprint stays dropped when an ability is in play
  });

  it('previews an ability-turn move at the 4-budget — smaller than the 8-sprint set', () => {
    const s = state();
    const u = vexUnit(s);
    const abilityTurn = movePreview(OPEN, s, u, false).stops; // sprint=false → 4-square budget
    const sprintTurn = movePreview(OPEN, s, u, true).stops; // 8-square budget
    expect(abilityTurn.length).toBeGreaterThan(0);
    expect(abilityTurn.length).toBeLessThan(sprintTurn.length);
  });
});

describe('nextDraft reducer drives the move/shoot toggle (MS1-test)', () => {
  const base = () => ({ ...emptyDraft('u'), movePath: [{ x: 1, y: 0 }, { x: 2, y: 0 }] });

  it('a non-dash ability keeps a drawn move (move AND shoot); a dash drops it', () => {
    const shoot = nextDraft(base(), { type: 'selectAbility', abilityId: 'rail_shot', isDash: false }, false);
    expect(shoot.abilityId).toBe('rail_shot');
    expect(shoot.movePath).toHaveLength(2); // move survives
    expect(shoot.sprint).toBe(false);

    const dash = nextDraft(base(), { type: 'selectAbility', abilityId: 'combat_roll', isDash: true }, false);
    expect(dash.abilityId).toBe('combat_roll');
    expect(dash.movePath).toEqual([]); // dash owns the move
  });

  it('selectMove keeps a non-dash ability but replaces a dash or empty', () => {
    const withShot = { ...emptyDraft('u'), abilityId: 'rail_shot', aim: [{ x: 5, y: 0 }] };
    const kept = nextDraft(withShot, { type: 'selectMove' }, false);
    expect(kept.abilityId).toBe('rail_shot'); // move + shoot coexist
    expect(kept.movePath).toEqual([]);

    const withDash = { ...emptyDraft('u'), abilityId: 'combat_roll', aim: [{ x: 1, y: 0 }] };
    const replaced = nextDraft(withDash, { type: 'selectMove' }, true);
    expect(replaced.abilityId).toBeUndefined(); // a dash is replaced by a plain move
    expect(replaced.aim).toEqual([]);
  });

  it('sprint is move-only and clears any ability; clear resets to empty', () => {
    const withShot = { ...emptyDraft('u'), abilityId: 'rail_shot', movePath: [{ x: 1, y: 0 }] };
    const sprinted = nextDraft(withShot, { type: 'selectSprint' }, false);
    expect(sprinted.abilityId).toBeUndefined();
    expect(sprinted.sprint).toBe(true);

    const cleared = nextDraft(sprinted, { type: 'clear' }, false);
    expect(cleared).toEqual(emptyDraft('u'));
  });

  it('does not mutate the input draft (pure)', () => {
    const input = base();
    nextDraft(input, { type: 'selectSprint' }, false);
    expect(input.movePath).toHaveLength(2); // untouched
    expect(input.sprint).toBe(false);
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

describe('ability tooltips read straight off the AbilityDef (TT1)', () => {
  it('formats an effect as kind, amount and duration', () => {
    expect(effectLabel({ kind: 'damage', amount: 26 })).toBe('damage 26');
    expect(effectLabel({ kind: 'shield', amount: 30, duration: 2 })).toBe('shield 30 (2t)');
    expect(effectLabel({ kind: 'teleport' })).toBe('teleport');
  });

  it("shows Vex's Rail Shot data from the character JSON", () => {
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    const lines = abilityTooltip(rail);
    expect(lines[0]).toBe(`${rail.name} — ${rail.phase} · ${rail.shape}`);
    expect(lines).toContain(`range ${rail.range}`);
    expect(lines.some((l) => l.includes(`cooldown ${rail.cooldown}`) && l.includes(`energy +${rail.energyGain}`))).toBe(true);
    expect(lines).toContain(rail.effects.map(effectLabel).join(', '));
    expect(lines).toContain(rail.description);
  });

  it("surfaces a grenade's radius and delay", () => {
    const nade = VEX.abilities.find((a) => a.id === 'frag_grenade')!;
    const lines = abilityTooltip(nade).join('\n');
    if (nade.radius !== undefined) expect(lines).toContain(`radius ${nade.radius}`);
    if (nade.delayTurns !== undefined) expect(lines).toContain(`delay ${nade.delayTurns}t`);
  });
});

describe('AIM2: free-rotation aiming reaches the engine as an integer step', () => {
  const rail = () => VEX.abilities.find((a) => a.id === 'rail_shot')!;

  it('a drag becomes a quantized step using the engine’s own projection', () => {
    // No trig on the client either: the same integer projection both sides.
    expect(dragToAimStep({ x: 1, y: 7 }, { x: 9, y: 7 })).toBe(vectorToStep(8, 0));
    expect(dragToAimStep({ x: 1, y: 7 }, { x: 1, y: 1 })).toBe(vectorToStep(0, -6));
    expect(dragToAimStep({ x: 1, y: 7 }, { x: 1, y: 7 })).toBe(0); // no drag, no direction
  });

  it('only rotatable shapes carry the step into the order', () => {
    expect(isRotatable(rail())).toBe(true);
    expect(isRotatable(VEX.abilities.find((a) => a.id === 'frag_grenade')!)).toBe(false); // circle

    const aimed = { ...emptyDraft('vex-t0-0'), abilityId: 'rail_shot', aim: [], aimStep: 40 };
    expect(toUnitOrders(VEX, aimed).ability?.aimStep).toBe(40);

    const circle = { ...emptyDraft('vex-t0-0'), abilityId: 'frag_grenade', aim: [{ x: 4, y: 7 }], aimStep: 40 };
    expect(toUnitOrders(VEX, circle).ability?.aimStep).toBeUndefined();
  });

  it('an illegal step is never sent to the engine', () => {
    for (const bad of [-1, 256, 1.5]) {
      const draft = { ...emptyDraft('vex-t0-0'), abilityId: 'rail_shot', aim: [], aimStep: bad };
      expect(toUnitOrders(VEX, draft).ability?.aimStep, `step ${bad}`).toBeUndefined();
    }
  });

  it('the preview is exactly what the engine will hit, at any rotation', () => {
    const s = state();
    const u = vexUnit(s);
    for (const step of [0, 16, 32, 64, 130, 200]) {
      const preview = abilityPreview(OPEN, u, rail(), [], step);
      expect(preview).toEqual(expandShape(buildBoard(OPEN), rail(), u.pos, [], step));
      expect(preview.length, `step ${step}`).toBeGreaterThan(0);
    }
  });

  it('a rotated preview differs from the compass-snapped one', () => {
    const s = state();
    const u = vexUnit(s);
    const east = abilityPreview(OPEN, u, rail(), [], 0);
    const tilted = abilityPreview(OPEN, u, rail(), [], 16);
    expect(tilted).not.toEqual(east);
  });

  it('without a step, click-to-aim previews are unchanged', () => {
    const s = state();
    const u = vexUnit(s);
    expect(abilityPreview(OPEN, u, rail(), [{ x: 14, y: 7 }])).toEqual(
      [2, 3, 4, 5, 6, 7, 8, 9].map((x) => ({ x, y: 7 })),
    );
  });
});

describe('BRUSH1: the client offers brush squares as move and dash destinations', () => {
  //  A 15x15 open map with a brush patch beside Vex's spawn at (1,7).
  const BRUSHY: MapDef = {
    ...OPEN,
    brush: [{ x: 2, y: 7 }, { x: 3, y: 7 }, { x: 2, y: 8 }],
  };

  it('brush tiles appear in the move preview as legal STOPS', () => {
    const s = createMatch(BRUSHY, '1v1', [[VEX], [BASTION]]);
    const u = s.units.find((x) => x.characterId === 'vex')!;
    const { stops, through } = movePreview(BRUSHY, s, u, false);
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    const stopKeys = stops.map(key);
    for (const b of BRUSHY.brush) {
      expect(stopKeys, `brush ${key(b)} must be a legal stop`).toContain(key(b));
      expect(through.map(key)).not.toContain(key(b)); // not merely walk-through
    }
  });

  it('a move path ending in brush validates', () => {
    const s = createMatch(BRUSHY, '1v1', [[VEX], [BASTION]]);
    const u = s.units.find((x) => x.characterId === 'vex')!;
    expect(pathValid(BRUSHY, s, u, [{ x: 2, y: 7 }], false)).toBe(true);
  });

  it('a dash aimed into brush previews as a real target', () => {
    const s = createMatch(BRUSHY, '1v1', [[VEX], [BASTION]]);
    const u = s.units.find((x) => x.characterId === 'vex')!;
    const roll = VEX.abilities.find((a) => a.id === 'combat_roll')!; // path dash
    expect(abilityPreview(BRUSHY, u, roll, [{ x: 2, y: 7 }]).length).toBeGreaterThan(0);
  });
});

/**
 * UI1 — the effective-range **envelope** and the single aim resolver.
 *
 * The envelope answers a question the footprint cannot: "can I even reach
 * them?". A player asks that *before* selecting an ability, so it has to be
 * derivable from the ability alone, with no aim yet chosen.
 */
describe('UI1: rangeEnvelope is where an ability COULD go', () => {
  it('a circle/square envelope is the engine’s own Manhattan diamond', () => {
    const s = state();
    const u = vexUnit(s);
    const grenade = VEX.abilities.find((a) => a.id === 'frag_grenade')!; // circle range 6
    const env = rangeEnvelope(OPEN, s, u, grenade);
    // Every square in the envelope is legal to aim at, and every legal square is
    // in the envelope — the two must agree or the preview is lying.
    for (const p of env) expect(aimInRange(u.pos, p, grenade.range), `${p.x},${p.y}`).toBe(true);
    let legal = 0;
    for (let y = 0; y < OPEN.height; y++) {
      for (let x = 0; x < OPEN.width; x++) if (aimInRange(u.pos, { x, y }, grenade.range)) legal++;
    }
    expect(env).toHaveLength(legal);
  });

  it('is wider than the tiles the ability actually covers — that is the point', () => {
    const s = state();
    const u = vexUnit(s);
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!; // line, range 8
    const env = rangeEnvelope(OPEN, s, u, rail);
    const covered = abilityPreview(OPEN, u, rail, [{ x: 14, y: 7 }]);
    expect(env.length).toBeGreaterThan(covered.length);
  });

  it('a PATH ability measures its range as a movement budget, not a diamond', () => {
    const s = state();
    const u = vexUnit(s);
    const roll = VEX.abilities.find((a) => a.id === 'combat_roll')!; // path, dash
    const env = rangeEnvelope(OPEN, s, u, roll);
    const reach = reachableSquares(buildBoard(OPEN), s, u, roll.range).map((r) => r.pos);
    expect(env).toEqual(reach);
    // A dash may not walk through a wall, so its envelope is not a plain diamond.
    for (const p of env) expect(Math.abs(p.x - u.pos.x) + Math.abs(p.y - u.pos.y)).toBeLessThanOrEqual(roll.range);
  });

  it('a SELF ability’s envelope is the caster’s own square, which is where it lands', () => {
    const s = state();
    const u = vexUnit(s);
    const selfish = { ...VEX.abilities[0]!, shape: 'self' as const, range: 0 };
    expect(rangeEnvelope(OPEN, s, u, selfish)).toEqual([{ x: u.pos.x, y: u.pos.y }]);
  });

  it('the move envelope is exactly the move preview’s stops plus walk-throughs', () => {
    const s = state();
    const u = vexUnit(s);
    const { stops, through } = movePreview(OPEN, s, u, false);
    expect(moveEnvelope(OPEN, s, u, false)).toEqual([...stops, ...through]);
    // Sprinting reaches strictly further.
    expect(moveEnvelope(OPEN, s, u, true).length).toBeGreaterThan(moveEnvelope(OPEN, s, u, false).length);
  });
});

describe('UI1: aimFor is the one place a pointed-at square becomes an aim', () => {
  const s = state();
  const u = vexUnit(s);

  it('a line/cone becomes a quantized DIRECTION with no target square', () => {
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    const got = aimFor(OPEN, s, u, rail, { x: 9, y: 7 });
    expect(got.aim).toEqual([]);
    expect(got.aimStep).toBe(vectorToStep(9 - u.pos.x, 7 - u.pos.y));
  });

  it('a circle becomes that square, and carries no direction', () => {
    const grenade = VEX.abilities.find((a) => a.id === 'frag_grenade')!;
    expect(aimFor(OPEN, s, u, grenade, { x: 4, y: 7 })).toEqual({ aim: [{ x: 4, y: 7 }] });
  });

  it('a path becomes a walked route ending on the pointed-at square', () => {
    const roll = VEX.abilities.find((a) => a.id === 'combat_roll')!;
    const target = { x: u.pos.x + 2, y: u.pos.y };
    const got = aimFor(OPEN, s, u, roll, target);
    expect(got.aim.length).toBeGreaterThan(0);
    expect(got.aim[got.aim.length - 1]).toEqual(target);
  });

  it('a self ability ignores the pointer and aims at the caster', () => {
    const selfish = { ...VEX.abilities[0]!, shape: 'self' as const, range: 0 };
    expect(aimFor(OPEN, s, u, selfish, { x: 12, y: 2 })).toEqual({ aim: [{ x: u.pos.x, y: u.pos.y }] });
  });

  it('hover and click agree by construction: the same square gives the same aim', () => {
    // The commit/preview split (UI1) is only safe because both call this.
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    const target = { x: 5, y: 11 };
    expect(aimFor(OPEN, s, u, rail, target)).toEqual(aimFor(OPEN, s, u, rail, target));
    const previewed = aimFor(OPEN, s, u, rail, target);
    expect(abilityPreview(OPEN, u, rail, previewed.aim, previewed.aimStep))
      .toEqual(expandShape(buildBoard(OPEN), rail, u.pos, previewed.aim, previewed.aimStep));
  });

  it('an unreachable path target yields an empty aim rather than an illegal one', () => {
    const roll = VEX.abilities.find((a) => a.id === 'combat_roll')!;
    expect(aimFor(OPEN, s, u, roll, { x: 14, y: 14 }).aim).toEqual([]);
  });
});

describe('UI1: draftHasOrder marks a character as having committed something', () => {
  it('is false for a blank draft and true once anything is chosen', () => {
    const blank = emptyDraft('u');
    expect(draftHasOrder(blank)).toBe(false);
    expect(draftHasOrder({ ...blank, abilityId: 'rail_shot' })).toBe(true);
    expect(draftHasOrder({ ...blank, sprint: true })).toBe(true);
    expect(draftHasOrder({ ...blank, movePath: [{ x: 1, y: 1 }] })).toBe(true);
  });
});

/**
 * AIM1 (+UI4) — a dash gets the same line-and-marker indicator a move gets, in
 * yellow. It is still a route, so it deserves route geometry; the colour is
 * what says it resolves in a different phase.
 */
describe('UI4: dashRoute gives a drafted dash the same route geometry as a move', () => {
  const s = state();
  const u = vexUnit(s);
  const roll = VEX.abilities.find((a) => a.id === 'combat_roll')!; // dash, path

  it('a PATH dash draws its whole walked route', () => {
    const aim = aimFor(OPEN, s, u, roll, { x: u.pos.x + 2, y: u.pos.y }).aim;
    expect(dashRoute(u, roll, aim)).toEqual(aim);
    expect(dashRoute(u, roll, aim).length).toBeGreaterThan(1);
  });

  it('a TELEPORTING dash draws a straight segment to where it lands', () => {
    // Wisp's Blink is a dash that is not a path — it still ends somewhere, and
    // "you end up there" is the honest indicator.
    const blink = { ...roll, shape: 'circle' as const, range: 5 };
    expect(dashRoute(u, blink, [{ x: u.pos.x + 4, y: u.pos.y + 1 }])).toEqual([{ x: u.pos.x + 4, y: u.pos.y + 1 }]);
  });

  it('is empty for a non-dash ability — the one case the line is suppressed', () => {
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    expect(dashRoute(u, rail, [{ x: 9, y: 7 }])).toEqual([]);
    expect(dashRoute(u, undefined, [{ x: 9, y: 7 }])).toEqual([]);
  });

  it('is empty for an unaimed dash, and for one aimed at your own square', () => {
    expect(dashRoute(u, roll, [])).toEqual([]);
    const blink = { ...roll, shape: 'circle' as const };
    expect(dashRoute(u, blink, [{ ...u.pos }])).toEqual([]); // a hold, not a route
  });

  it('copies its squares, so the caller cannot write back into the draft', () => {
    const aim = [{ x: u.pos.x + 1, y: u.pos.y }];
    const route = dashRoute(u, roll, aim);
    route[0]!.x = 99;
    expect(aim[0]!.x).toBe(u.pos.x + 1);
  });
});

/**
 * UI2 — Layer 1, the continuous shape. The tests that matter check it is built
 * from the ENGINE's numbers rather than an eyeballed silhouette: every covered
 * tile's centre must fall inside the polygon, or the fiction and the truth
 * disagree and a clipped corner reads as a bug.
 */
describe('UI2: shapeOutline is the continuous shape the covered tiles approximate', () => {
  const s = state();
  const u = vexUnit(s);

  /** Even-odd point-in-polygon, in board coordinates. */
  const inside = (poly: { x: number; y: number }[], p: { x: number; y: number }): boolean => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };

  it('a LINE beam contains the centre of every tile the engine says it hits', () => {
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    for (const step of [0, 17, 64, 130, 200]) {
      const covered = abilityPreview(OPEN, u, rail, [], step);
      const poly = shapeOutline(u, rail, [], step, covered);
      expect(poly.length, `step ${step}`).toBe(4);
      for (const tile of covered) expect(inside(poly, tile), `step ${step} tile ${tile.x},${tile.y}`).toBe(true);
    }
  });

  it('a CONE wedge contains every tile it hits, and its apex is at the caster', () => {
    // Bastion's Crushing Slam is the cone in the shipped roster.
    const cone = [...BASTION.abilities, BASTION.ultimate].find((a) => a.shape === 'cone');
    if (cone === undefined) return; // roster has no cone: nothing to assert
    const bast = state().units.find((x) => x.characterId === 'bastion')!;
    for (const step of [0, 64, 128, 192]) {
      const covered = abilityPreview(OPEN, bast, cone, [], step);
      const poly = shapeOutline(bast, cone, [], step, covered);
      expect(poly).toHaveLength(3); // a wedge is a triangle
      for (const tile of covered) expect(inside(poly, tile), `step ${step} tile ${tile.x},${tile.y}`).toBe(true);
      // The apex sits half a tile in front of the caster — where the engine's
      // own "half-width is d-1" rule reaches zero, not at the caster's centre.
      const apex = poly[0]!;
      expect(Math.hypot(apex.x - bast.pos.x, apex.y - bast.pos.y)).toBeCloseTo(0.5, 6);
    }
  });

  it('a CIRCLE disk encloses every covered tile centre and matches radius + half a tile', () => {
    const grenade = VEX.abilities.find((a) => a.id === 'frag_grenade')!;
    const target = { x: u.pos.x + 4, y: u.pos.y };
    const covered = abilityPreview(OPEN, u, grenade, [target]);
    const poly = shapeOutline(u, grenade, [target], undefined, covered);
    for (const tile of covered) expect(inside(poly, tile), `${tile.x},${tile.y}`).toBe(true);
    const radii = poly.map((p) => Math.hypot(p.x - target.x, p.y - target.y));
    for (const r of radii) expect(r).toBeCloseTo((grenade.radius ?? 1) + 0.5, 6);
  });

  it('a SQUARE outlines exactly its one tile', () => {
    const square = { ...VEX.abilities[0]!, shape: 'square' as const, range: 6 };
    const poly = shapeOutline(u, square, [{ x: 5, y: 5 }], undefined, [{ x: 5, y: 5 }]);
    expect(poly).toEqual([
      { x: 4.5, y: 4.5 }, { x: 5.5, y: 4.5 }, { x: 5.5, y: 5.5 }, { x: 4.5, y: 5.5 },
    ]);
  });

  it('has no outline for a path or a self-cast — a route draws as a line instead', () => {
    const roll = VEX.abilities.find((a) => a.id === 'combat_roll')!;
    expect(shapeOutline(u, roll, [{ x: u.pos.x + 1, y: u.pos.y }], undefined, [{ x: u.pos.x + 1, y: u.pos.y }])).toEqual([]);
    expect(shapeOutline(u, { ...roll, shape: 'self' }, [], undefined, [])).toEqual([]);
  });

  it('has no outline for an unaimed directional shape', () => {
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    expect(shapeOutline(u, rail, [], undefined, [])).toEqual([]);
    expect(shapeOutline(u, rail, [{ ...u.pos }], undefined, [])).toEqual([]); // aimed at yourself: no direction
  });

  it('rotates with the aim step rather than snapping — same rule as the tiles', () => {
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    const east = shapeOutline(u, rail, [], 0, abilityPreview(OPEN, u, rail, [], 0));
    const askew = shapeOutline(u, rail, [], 30, abilityPreview(OPEN, u, rail, [], 30));
    expect(askew).not.toEqual(east);
  });
});

describe('UI2: Layer 1 stops where Layer 2 stops', () => {
  it('a beam blocked by a wall does not carry on past it', () => {
    // The disagreement UI2 exists to prevent: `lineSquares` stops at the first
    // wall, so an untruncated beam would read as "the shot goes through walls".
    const WALLED: MapDef = { ...OPEN, walls: [{ x: 5, y: 7 }] };
    const s = createMatch(WALLED, '1v1', [[VEX], [BASTION]]);
    const u = s.units.find((x) => x.characterId === 'vex')!;
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    const covered = abilityPreview(WALLED, u, rail, [], 0); // due east, into the wall
    expect(covered.length).toBeLessThan(rail.range); // the wall really did stop it

    const poly = shapeOutline(u, rail, [], 0, covered);
    const reach = Math.max(...poly.map((p) => p.x)) - u.pos.x;
    const unblocked = shapeOutline(u, rail, [], 0, abilityPreview(OPEN, u, rail, [], 0));
    expect(reach).toBeLessThan(Math.max(...unblocked.map((p) => p.x)) - u.pos.x);
    // It still encloses everything it did hit.
    expect(reach).toBeGreaterThanOrEqual(covered.length);
  });

  it('a disk keeps its shape when walls punch tiles out of it — that is the point', () => {
    // Unlike a beam, the engine does not shorten a circle for a wall; it drops
    // the tile. Truncating the disk would hide that a corner was clipped.
    const grenade = VEX.abilities.find((a) => a.id === 'frag_grenade')!;
    const target = { x: 6, y: 7 };
    const WALLED: MapDef = { ...OPEN, walls: [{ x: 6, y: 6 }] };
    const s = createMatch(WALLED, '1v1', [[VEX], [BASTION]]);
    const u = s.units.find((x) => x.characterId === 'vex')!;
    const clipped = abilityPreview(WALLED, u, grenade, [target]);
    const whole = abilityPreview(OPEN, u, grenade, [target]);
    expect(clipped.length).toBeLessThan(whole.length); // a tile really was dropped
    expect(shapeOutline(u, grenade, [target], undefined, clipped))
      .toEqual(shapeOutline(u, grenade, [target], undefined, whole));
  });
});

/**
 * MOVE1 — clicking somewhere you cannot end must never do nothing.
 *
 * The reported bug: clicking a teammate's tile left the character standing
 * still. Two separate failures produce it — an occupied square is *reachable*,
 * so the old code handed the engine a path ending where the unit may not stop
 * (rejected wholesale), while an unreachable square produced no path at all.
 * Both now walk as far toward the click as the rules allow.
 */
describe('MOVE1: a move click routes to the nearest legal tile', () => {
  // The shared OPEN map is 1v1-shaped; a 2v2 needs a second spawn per team so
  // two allies actually stand next to each other.
  const PAIRED: MapDef = { ...OPEN, spawns: [[{ x: 1, y: 7 }, { x: 1, y: 8 }], [{ x: 13, y: 7 }, { x: 13, y: 8 }]] };
  const crowded = () => {
    const s = createMatch(PAIRED, '2v2', [[VEX, VEX], [BASTION, BASTION]]);
    return { s, unit: s.units[0]!, ally: s.units[1]! };
  };

  it('clicking an OCCUPIED tile still moves — the reported bug', () => {
    const { s, unit, ally } = crowded();
    // Sanity: the ally's square really is reachable-but-not-stoppable, which is
    // why the old path ended there and the engine threw the order away.
    const reach = reachableSquares(buildBoard(PAIRED), s, unit, 4);
    const allySquare = reach.find((r) => r.pos.x === ally.pos.x && r.pos.y === ally.pos.y)!;
    expect(allySquare.canStop).toBe(false);

    const path = pathTo(PAIRED, s, unit, ally.pos, 4);
    expect(path.length, 'the move must not be dropped').toBeGreaterThan(0);
    const end = path[path.length - 1]!;
    expect(end, 'must not end on the occupied square').not.toEqual({ x: ally.pos.x, y: ally.pos.y });
    // And it is a legal destination the engine will accept.
    expect(pathValid(PAIRED, s, unit, path, false)).toBe(true);
  });

  it('lands adjacent to the tile it could not stop on — as far as legally possible', () => {
    const { s, unit, ally } = crowded();
    const end = pathTo(PAIRED, s, unit, ally.pos, 4).at(-1)!;
    expect(Math.abs(end.x - ally.pos.x) + Math.abs(end.y - ally.pos.y)).toBe(1);
  });

  it('clicking OUT OF RANGE walks toward it instead of standing still', () => {
    const s = state();
    const unit = vexUnit(s);
    const far = { x: 14, y: 14 };
    expect(reconstructPath(reachableSquares(buildBoard(OPEN), s, unit, 4), unit.pos, far)).toBeNull();

    const path = pathTo(OPEN, s, unit, far, 4);
    expect(path.length).toBeGreaterThan(0);
    const end = path.at(-1)!;
    // Strictly closer to the click than standing still would be.
    expect(distance(end, far)).toBeLessThan(distance(unit.pos, far));
    expect(pathValid(OPEN, s, unit, path, false)).toBe(true);
  });

  it('picks the reachable square CLOSEST to the click, not merely a legal one', () => {
    const s = state();
    const unit = vexUnit(s);
    const far = { x: 14, y: 14 };
    const end = pathTo(OPEN, s, unit, far, 4).at(-1)!;
    const best = Math.min(
      ...reachableSquares(buildBoard(OPEN), s, unit, 4).filter((r) => r.canStop).map((r) => distance(r.pos, far)),
    );
    expect(distance(end, far)).toBe(best);
  });

  it('a normal reachable click is unchanged — exact target, exact path', () => {
    const s = state();
    const unit = vexUnit(s);
    const target = { x: unit.pos.x + 2, y: unit.pos.y };
    expect(pathTo(OPEN, s, unit, target, 4).at(-1)).toEqual(target);
  });

  it('clicking your OWN square is a hold, not a re-route', () => {
    const s = state();
    const unit = vexUnit(s);
    expect(pathTo(OPEN, s, unit, { ...unit.pos }, 4)).toEqual([]);
  });

  it('is deterministic — repeated calls agree, and ties do not depend on BFS order', () => {
    const s = state();
    const unit = vexUnit(s);
    const far = { x: 14, y: 0 }; // diagonal-ish, so several squares tie on distance
    const first = pathTo(OPEN, s, unit, far, 4);
    for (let i = 0; i < 5; i++) expect(pathTo(OPEN, s, unit, far, 4)).toEqual(first);
  });

  it('a rooted unit (zero budget) still yields no move rather than a bogus one', () => {
    const s = state();
    const unit = vexUnit(s);
    expect(pathTo(OPEN, s, unit, { x: 14, y: 14 }, 0)).toEqual([]);
  });
});

describe('MOVE1: a DASH aim still requires a reachable target', () => {
  it('does not re-route — a charge must ram who you clicked, or nothing', () => {
    // MOVE1's forgiving fallback is a ruling about the *move* command. Silently
    // walking a charge somewhere else would change which unit it hits, so the
    // dash resolver stays strict and the preview stays honestly empty.
    const s = state();
    const u = vexUnit(s);
    const roll = VEX.abilities.find((a) => a.id === 'combat_roll')!;
    expect(aimFor(OPEN, s, u, roll, { x: 14, y: 14 }).aim).toEqual([]);
    expect(pathToExact(OPEN, s, u, { x: 14, y: 14 }, roll.range)).toEqual([]);
    // A reachable one still works exactly as before.
    const near = { x: u.pos.x + 2, y: u.pos.y };
    expect(pathToExact(OPEN, s, u, near, roll.range).at(-1)).toEqual(near);
  });
});
