import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  aimInRange,
  buildCatalystPool,
  createMatch,
  type AbilityDef,
  type CatalystData,
  type CharacterDef,
  type GameState,
  type MapDef,
  type UnitState,
} from '@cards/engine';
import { aimFor, aimLegal, commitAim, dashRoute, isBlockedDashLanding, rangeEnvelope } from '../src/targeting.js';
import vex from '../../../data/characters/vex.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * AIM-RANGE — "Veil's Blink looks like you can use it where you want, it should
 * be limited to the range of the skill… Aegis's intercept does the same thing."
 *
 * The engine always enforced range and quietly dropped the order. The client
 * committed the click anyway, so the ability *looked* ordered and then did
 * nothing — which reads as an ability with no range at all, and intermittently
 * broken besides. The fix has two halves and this file tests both, then audits
 * every shipped ability, free ability and catalyst rather than the two that were
 * reported ("audit this to ensure you catch all skills").
 */

const CHAR_DIR = join(import.meta.dirname, '../../../data/characters');
const ROSTER: CharacterDef[] = readdirSync(CHAR_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(CHAR_DIR, f), 'utf8')) as CharacterDef);
const POOL = buildCatalystPool(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/catalysts.json'), 'utf8')) as CatalystData,
);

const VEX = vex as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
/** Big and empty: range, not terrain, is the only thing under test here. */
const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 10 }], [{ x: 18, y: 10 }]],
};

const abilitiesOf = (c: CharacterDef): AbilityDef[] => [...c.abilities, c.ultimate];
const ability = (c: CharacterDef, id: string): AbilityDef => abilitiesOf(c).find((a) => a.id === id)!;

const match = (a: CharacterDef, b: CharacterDef = AEGIS): GameState => createMatch(OPEN, '1v1', [[a], [b]]);
const actor = (s: GameState, characterId: string): UnitState => {
  const u = s.units.find((x) => x.characterId === characterId)!;
  u.pos = { x: 10, y: 10 }; // centre, so range is never clipped by an edge
  return u;
};

describe('AIM-RANGE: an out-of-range click does not commit', () => {
  it("Blink refuses a click past its range — the reported bug", () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    const blink = ability(WISP, 'blink'); // square, range 4
    expect(commitAim(OPEN, s, u, blink, { x: u.pos.x + 3, y: u.pos.y })).toBeDefined();
    expect(commitAim(OPEN, s, u, blink, { x: u.pos.x + blink.range + 2, y: u.pos.y })).toBeUndefined();
  });

  it("Intercept refuses one too — same shape, same bug, same gate", () => {
    const s = match(AEGIS, WISP);
    const u = actor(s, 'aegis');
    const intercept = ability(AEGIS, 'intercept'); // square, range 4
    expect(commitAim(OPEN, s, u, intercept, { x: u.pos.x + 2, y: u.pos.y })).toBeDefined();
    expect(commitAim(OPEN, s, u, intercept, { x: u.pos.x, y: u.pos.y + 9 })).toBeUndefined();
  });

  it('a `circle` grenade refuses one, so it is the shape and not the ability', () => {
    const s = match(VEX);
    const u = actor(s, 'vex');
    const frag = ability(VEX, 'frag_grenade'); // circle, range 6
    expect(commitAim(OPEN, s, u, frag, { x: u.pos.x + 5, y: u.pos.y })).toBeDefined();
    expect(commitAim(OPEN, s, u, frag, { x: u.pos.x + 9, y: u.pos.y })).toBeUndefined();
  });

  it('a `path` dash still refuses an unreachable target, as it always did', () => {
    const s = match(VEX);
    const u = actor(s, 'vex');
    const roll = ability(VEX, 'combat_roll'); // path, range 3
    expect(commitAim(OPEN, s, u, roll, { x: u.pos.x + 2, y: u.pos.y })).toBeDefined();
    expect(commitAim(OPEN, s, u, roll, { x: u.pos.x + 9, y: u.pos.y })).toBeUndefined();
  });

  it('a `line` commits at any distance — its range bounds the beam, not the click', () => {
    // AIM2: a line/cone click is a *direction*, so the range gate must not
    // touch it. Refusing a far click would make the ability unaimable rather
    // than range-limited, and the beam is already clipped to `range` by
    // `expandShape`.
    const s = match(VEX);
    const u = actor(s, 'vex');
    const rail = ability(VEX, 'rail_shot');
    for (const target of [{ x: 20, y: 10 }, { x: 12, y: 10 }, { x: 0, y: 0 }]) {
      expect(commitAim(OPEN, s, u, rail, target), `${target.x},${target.y}`).toBeDefined();
    }
    // …but a click on your own square is refused (DASH-OCCUPIED part 4). It used
    // to commit: `vectorToStep(0,0)` quantizes to step 0, so clicking yourself
    // fired east. A zero-length drag carries no direction, so there is nothing
    // there to commit.
    expect(commitAim(OPEN, s, u, rail, { ...u.pos })).toBeUndefined();
  });

  it('a `self` ability ignores the click entirely', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    expect(commitAim(OPEN, s, u, ability(WISP, 'veil_decoy'), { x: 0, y: 0 })?.aim).toEqual([u.pos]);
  });

  it('the refusal is exactly the engine rule, not a second copy of it', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    const blink = ability(WISP, 'blink');
    for (let x = 0; x < OPEN.width; x++) {
      for (let y = 0; y < OPEN.height; y++) {
        const committed = commitAim(OPEN, s, u, blink, { x, y }) !== undefined;
        expect(committed, `square ${x},${y}`).toBe(aimInRange(u.pos, { x, y }, blink.range));
      }
    }
  });
});

describe('AIM-RANGE: the envelope is drawn for every aimable slot', () => {
  it('a free ability has one — "Overwatch Trap doesn\'t have a range indicator either"', () => {
    const s = match(VEX);
    const u = actor(s, 'vex');
    const trap = ability(VEX, 'overwatch_trap'); // free, square, range 4
    expect(trap.free).toBe(true);
    expect(rangeEnvelope(OPEN, s, u, trap).length).toBeGreaterThan(0);
  });

  it('a catalyst has one — "Dash catalyst doesn\'t have a range indicator"', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    expect(rangeEnvelope(OPEN, s, u, POOL['shift']!).length).toBeGreaterThan(0);
  });

  it('and the envelope never draws a square the engine would reject', () => {
    // The two halves have to agree or the indicator lies: a tile shown as
    // in-range that then refuses the click is worse than no indicator.
    const s = match(WISP);
    const u = actor(s, 'wisp');
    for (const def of [ability(WISP, 'blink'), ability(VEX, 'frag_grenade'), POOL['shift']!]) {
      for (const p of rangeEnvelope(OPEN, s, u, def)) {
        expect(commitAim(OPEN, s, u, def, p), `${def.id} at ${p.x},${p.y}`).toBeDefined();
      }
    }
  });
});

describe('AIM-RANGE: the audit — every shipped ability, on every slot', () => {
  const AIMABLE = ['square', 'circle', 'path'] as const;
  const targeted = (def: AbilityDef): boolean =>
    (AIMABLE as readonly string[]).includes(def.shape) && def.range > 0;

  const cases: { owner: string; def: AbilityDef }[] = [
    ...ROSTER.flatMap((c) => abilitiesOf(c).map((def) => ({ owner: c.id, def }))),
    ...Object.values(POOL).map((def) => ({ owner: 'catalyst', def })),
  ];

  it('covers the whole roster plus the whole catalyst pool', () => {
    // A guard on the guard: if this file silently stopped loading the roster,
    // every audit below would pass vacuously.
    expect(ROSTER.length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(POOL)).toHaveLength(11);
    expect(cases.filter((c) => targeted(c.def)).length).toBeGreaterThanOrEqual(15);
  });

  it('every targeted ability paints a bounded, non-empty envelope', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    for (const { owner, def } of cases.filter((c) => targeted(c.def))) {
      const env = rangeEnvelope(OPEN, s, u, def);
      const label = `${owner}/${def.id}`;
      expect(env.length, label).toBeGreaterThan(0);
      // Bounded: it must not be the whole board, or "limited to the range of
      // the skill" is not what the player is being shown.
      expect(env.length, label).toBeLessThan(OPEN.width * OPEN.height);
    }
  });

  it('every targeted ability refuses a click far outside its range', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    for (const { owner, def } of cases.filter((c) => targeted(c.def))) {
      // The far corner is beyond every shipped range (max 8, board diagonal 28).
      expect(commitAim(OPEN, s, u, def, { x: 0, y: 0 }), `${owner}/${def.id}`).toBeUndefined();
    }
  });

  it('every targeted ability still accepts a click at its own doorstep', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    for (const { owner, def } of cases.filter((c) => targeted(c.def))) {
      expect(commitAim(OPEN, s, u, def, { x: u.pos.x + 1, y: u.pos.y }), `${owner}/${def.id}`).toBeDefined();
    }
  });

  it('range-0 and self abilities are not accidentally caught by the gate', () => {
    // Shockwave and Warding Halo are `range: 0` circles centred on the caster:
    // their only legal aim is their own square, and a gate that rejected that
    // would make them uncastable.
    const s = match(AEGIS);
    const u = actor(s, 'aegis');
    for (const def of abilitiesOf(AEGIS).filter((a) => a.range === 0)) {
      const target = def.shape === 'self' ? { x: 0, y: 0 } : { ...u.pos };
      expect(commitAim(OPEN, s, u, def, target), def.id).toBeDefined();
    }
  });
});

describe('DASH-CAT-ROUTE: Shift draws a route, not a patch of tiles', () => {
  it('a Dash catalyst produces a dash route to its landing square', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    const shift = POOL['shift']!;
    expect(shift.phase).toBe('dash');
    const landing = { x: u.pos.x + 2, y: u.pos.y };
    const { aim } = aimFor(OPEN, s, u, shift, landing);
    expect(dashRoute(u, shift, aim)).toEqual([landing]);
  });

  it('a non-dash catalyst produces none — it is not a reposition', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    for (const id of ['second_wind', 'adrenaline']) {
      expect(dashRoute(u, POOL[id]!, [{ x: u.pos.x + 1, y: u.pos.y }]), id).toEqual([]);
    }
  });

  it('an unaimed Shift draws nothing rather than a line to nowhere', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    expect(dashRoute(u, POOL['shift']!, [])).toEqual([]);
  });

  it('and a Shift aimed at your own square is a hold, not a route', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    expect(dashRoute(u, POOL['shift']!, [{ ...u.pos }])).toEqual([]);
  });

  it('the route only ever ends somewhere the commit gate would allow', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    const shift = POOL['shift']!;
    const far = { x: u.pos.x + shift.range + 3, y: u.pos.y };
    expect(commitAim(OPEN, s, u, shift, far)).toBeUndefined();
    // …so the aim never reaches the draft, and no route is drawn to it.
    expect(aimLegal(u, shift, [far])).toBe(false);
  });
});

/**
 * DASH-OCCUPIED, client half. Two more reasons `commitAim` says no, both of the
 * same species as the range refusal: an order the engine will silently discard
 * is worse than a click that visibly does not take.
 */
describe('DASH-OCCUPIED: the client refuses a dash that would fizzle', () => {
  const occupiedBy = (s: GameState, u: UnitState) => {
    const other = s.units.find((x) => x.unitId !== u.unitId)!;
    other.pos = { x: u.pos.x + 2, y: u.pos.y };
    return other.pos;
  };

  it('refuses a teleport aimed at a square somebody is standing on', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    const taken = occupiedBy(s, u);
    expect(commitAim(OPEN, s, u, ability(WISP, 'blink'), taken)).toBeUndefined();
  });

  it('…including an ALLY\'s square — the rule is "another character"', () => {
    // Friendly fire is on, but bodies are still bodies.
    const pair: MapDef = { ...OPEN, spawns: [[{ x: 2, y: 10 }, { x: 2, y: 8 }], [{ x: 18, y: 10 }, { x: 18, y: 8 }]] };
    const s = createMatch(pair, '2v2', [[WISP, VEX], [AEGIS, VEX]]);
    const u = actor(s, 'wisp');
    const ally = s.units.find((x) => x.owner === u.owner && x.unitId !== u.unitId)!;
    ally.pos = { x: u.pos.x + 2, y: u.pos.y };
    expect(commitAim(pair, s, u, ability(WISP, 'blink'), { ...ally.pos })).toBeUndefined();
  });

  it('still accepts the neighbouring free square, so the gate is not blanket', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    occupiedBy(s, u);
    expect(commitAim(OPEN, s, u, ability(WISP, 'blink'), { x: u.pos.x + 1, y: u.pos.y })).toBeDefined();
  });

  it('a dead unit is not an obstacle', () => {
    const s = match(WISP);
    const u = actor(s, 'wisp');
    const taken = occupiedBy(s, u);
    s.units.find((x) => x.unitId !== u.unitId)!.alive = false;
    expect(commitAim(OPEN, s, u, ability(WISP, 'blink'), taken)).toBeDefined();
  });

  it('a CHARGE is still allowed to be aimed at an occupied square', () => {
    // A `path` dash passes through bodies and rests short rather than fizzling,
    // so refusing the click would veto a perfectly legal order.
    const s = match(VEX);
    const u = actor(s, 'vex');
    const taken = occupiedBy(s, u);
    expect(isBlockedDashLanding(s, u, ability(VEX, 'combat_roll'), taken)).toBe(false);
  });

  it('a dash carrying its own knockback is allowed to aim at an occupant', () => {
    // The engine clears the square and lands it, so the client must not veto
    // what the engine will permit.
    const s = match(WISP);
    const u = actor(s, 'wisp');
    const taken = occupiedBy(s, u);
    const bodycheck: AbilityDef = {
      ...ability(WISP, 'blink'),
      effects: [{ kind: 'teleport' }, { kind: 'knockback', amount: 2 }],
    };
    expect(isBlockedDashLanding(s, u, bodycheck, taken)).toBe(false);
  });

  it('a non-teleporting ability is unaffected — you may shoot at a unit', () => {
    const s = match(VEX);
    const u = actor(s, 'vex');
    const taken = occupiedBy(s, u);
    expect(isBlockedDashLanding(s, u, ability(VEX, 'frag_grenade'), taken)).toBe(false);
    expect(commitAim(OPEN, s, u, ability(VEX, 'frag_grenade'), taken)).toBeDefined();
  });
});

describe('DASH-OCCUPIED: a line or cone aimed at yourself is a no-op', () => {
  it('refuses the commit rather than firing east', () => {
    const s = match(VEX);
    const u = actor(s, 'vex');
    for (const id of ['rail_shot']) {
      expect(commitAim(OPEN, s, u, ability(VEX, id), { ...u.pos }), id).toBeUndefined();
    }
  });

  it('applies to cones too, not just lines', () => {
    const s = match(AEGIS, WISP);
    const u = actor(s, 'aegis');
    const cone = abilitiesOf(AEGIS).find((a) => a.shape === 'cone')!;
    expect(commitAim(OPEN, s, u, cone, { ...u.pos })).toBeUndefined();
  });

  it('but a `self` ability aimed at your own square still commits', () => {
    // A self-cast has nowhere else to point; refusing it would make Veil & Decoy
    // uncastable.
    const s = match(WISP);
    const u = actor(s, 'wisp');
    expect(commitAim(OPEN, s, u, ability(WISP, 'veil_decoy'), { ...u.pos })).toBeDefined();
  });

  it('and a one-square-away click still gives a direction', () => {
    const s = match(VEX);
    const u = actor(s, 'vex');
    expect(commitAim(OPEN, s, u, ability(VEX, 'rail_shot'), { x: u.pos.x + 1, y: u.pos.y })).toBeDefined();
  });
});
