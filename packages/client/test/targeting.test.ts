import { describe, expect, it } from 'vitest';
import { AIM_STEPS, aimInRange, aimVisionAllows, buildBoard, createMatch, distance, expandShape, reachableSquares, reconstructPath, vectorToStep, type AbilityDef, type CharacterDef, type MapDef } from '@cards/engine';
import {
  abilityOptions,
  abilityPreview,
  abilityTooltip,
  aimFor,
  dashRoute,
  dragToAimStep,
  draftHasOrder,
  isRotatable,
  isPlacedRotatable,
  effectLabel,
  emptyDraft,
  moveEnvelope,
  movePreview,
  nextDraft,
  pathTo,
  pathToExact,
  pathValid,
  rangeEnvelope,
  sprintAllowed,
  toUnitOrders,
  toUnitOrdersFor,
} from '../src/targeting.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import aegis from '../../../data/characters/aegis.json';

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
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

  it('ENERGY-PER-HIT: the econ line says the energy is PER HIT', () => {
    // The number stopped meaning "what a cast pays" on 2026-08-29, so the
    // tooltip has to stop reading that way: a rail shot through three enemies
    // pays 24 and a bare "+8" is now the wrong claim in both directions.
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    expect(abilityTooltip(rail).join('\n')).toContain(`energy +${rail.energyGain} per hit`);
  });

  it('…but a blink says just "+4" — it earns the act, not a recipient', () => {
    // The other branch, and the reason the qualifier is derived from the
    // engine's own predicate rather than printed on everything.
    const roll = VEX.abilities.find((a) => a.id === 'combat_roll')!;
    const econ = abilityTooltip(roll).find((l) => l.includes('energy +'))!;
    expect(econ).toContain(`energy +${roll.energyGain}`);
    expect(econ, 'a teleport has nobody to hit').not.toContain('per hit');
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
    // WALL-CAST-FIX widened "rotatable" without widening it to everything.
    // There are two kinds — a `line`/`cone` turned by a drag (`isRotatable`) and
    // a placed shape turned by the rotate row (`isPlacedRotatable`) — and the
    // order-build gate knew only about the first, which is why Warding Wall
    // could not be cast. A circle still sends nothing: the engine would ignore
    // it, and a stale step on the wire is noise a reader has to rule out.
    expect(isRotatable(rail())).toBe(true);
    expect(isRotatable(VEX.abilities.find((a) => a.id === 'frag_grenade')!)).toBe(false); // circle

    const aimed = { ...emptyDraft('vex-t0-0'), abilityId: 'rail_shot', aim: [], aimStep: 40 };
    expect(toUnitOrders(VEX, aimed).ability?.aimStep).toBe(40);

    const circle = { ...emptyDraft('vex-t0-0'), abilityId: 'frag_grenade', aim: [{ x: 4, y: 7 }], aimStep: 40 };
    expect(toUnitOrders(VEX, circle).ability?.aimStep).toBeUndefined();

    // The case the gate missed: a wall is placed-rotatable, not drag-rotatable.
    const wall = AEGIS.abilities.find((a) => a.id === 'warding_wall')!;
    expect(isRotatable(wall), 'not turned by a drag').toBe(false);
    expect(isPlacedRotatable(wall), 'turned by the rotate row').toBe(true);
    const placed = {
      ...emptyDraft('aegis-t0-0'), abilityId: wall.id, aim: [{ x: 4, y: 7 }], aimStep: 128,
    };
    expect(toUnitOrders(AEGIS, placed).ability?.aimStep, 'and its rotation goes out').toBe(128);
  });

  it('an illegal step is never sent to the engine', () => {
    // `AIM_STEPS` itself is the first illegal value — steps are 0-based — so this
    // is written against the constant and survives AIM-SMOOTH raising it.
    for (const bad of [-1, AIM_STEPS, 1.5]) {
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
  it('a circle envelope is the range disc INTERSECTED with what the team can see', () => {
    // AOE-LoS. The envelope used to be the bare `aimInRange` disc, and that is
    // no longer what the engine will accept: an area is aimed at ground the
    // caster's team can see. Asserted as the exact intersection, both ways —
    // every offered square legal, every legal square offered — because a
    // preview that is merely a *subset* of legality is a button that quietly
    // refuses to be pressed, and one that is a superset is a lie.
    const s = state();
    const u = vexUnit(s);
    const grenade = VEX.abilities.find((a) => a.id === 'frag_grenade')!; // circle range 6, lobbed
    const board = buildBoard(OPEN);
    const env = new Set(rangeEnvelope(OPEN, s, u, grenade).map((p) => `${p.x},${p.y}`));
    let legal = 0;
    for (let y = 0; y < OPEN.height; y++) {
      for (let x = 0; x < OPEN.width; x++) {
        const p = { x, y };
        const ok = aimInRange(u.pos, p, grenade.range)
          && aimVisionAllows(board, s, u, grenade, p);
        expect(env.has(`${x},${y}`), `${x},${y}`).toBe(ok);
        if (ok) legal++;
      }
    }
    expect(env.size).toBe(legal);
  });

  it('and that intersection is strictly smaller than the raw disc', () => {
    // The measurement that keeps the test above from passing vacuously: aiming
    // range is EUCLIDEAN (AIM-METRIC) and vision is MANHATTAN (MET1), so a
    // range-6 circle's far diagonal — Euclidean 5.7, Manhattan 8 — is inside
    // the disc and outside the team's sight. On an empty map with no wall in
    // the way, that corner is the whole of the difference, and it is real.
    const s = state();
    const u = vexUnit(s);
    const grenade = VEX.abilities.find((a) => a.id === 'frag_grenade')!;
    const env = rangeEnvelope(OPEN, s, u, grenade).length;
    let disc = 0;
    for (let y = 0; y < OPEN.height; y++) {
      for (let x = 0; x < OPEN.width; x++) if (aimInRange(u.pos, { x, y }, grenade.range)) disc++;
    }
    expect(env, 'the vision gate actually removed squares').toBeLessThan(disc);
  });

  it('a square envelope is still the engine’s own bare disc — only areas are gated', () => {
    // AOE-LoS is scoped to `circle`. A `square` shape places one tile and is
    // untouched, which is what stops this from having quietly become a
    // vision rule for every aimed ability in the game.
    const s = state();
    const u = vexUnit(s);
    const zone: AbilityDef = {
      id: 'zone', name: 'Zone', phase: 'blast', shape: 'square', range: 6,
      cooldown: 0, energyGain: 0, effects: [{ kind: 'damage', amount: 1 }], description: 't',
    };
    const env = rangeEnvelope(OPEN, s, u, zone);
    for (const p of env) expect(aimInRange(u.pos, p, zone.range), `${p.x},${p.y}`).toBe(true);
    let legal = 0;
    for (let y = 0; y < OPEN.height; y++) {
      for (let x = 0; x < OPEN.width; x++) if (aimInRange(u.pos, { x, y }, zone.range)) legal++;
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

/*
 * (UI2 Layer 1's outline had its tests here. AIM-PREVIEW-TRUE replaced the
 * hand-drawn silhouette with the locus of the engine's own tile-centre
 * predicate, so both the derivation and its tests moved to
 * `aim-boundary.test.ts` — where the claim is the stronger one the ruling asks
 * for: not "every covered tile is inside the polygon" but "the tiles inside the
 * polygon ARE the covered tiles", swept over every rotation.)
 */

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
