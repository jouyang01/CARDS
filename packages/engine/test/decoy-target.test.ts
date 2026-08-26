import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { placementIsFree, resolveTurn, type Roster } from '../src/resolve.js';
import { buildRoster } from '../src/setup.js';
import { validateAbility, validateCharacter } from '../src/validate.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type {
  AbilityDef, CharacterDef, GameState, MapDef, PlayerOrders, UnitState, Vec2,
} from '../src/types.js';

/**
 * W1-DECOY-TARGET — **the decoy is placed, not worn.**
 *
 * Owner (W1): *"She can place her decoy at a range of 3 — keep the decoy
 * static."* It used to appear under Wisp's feet, which made the deception a coin
 * flip: anyone who watched her cast knew which of the two was real by watching
 * where she went next.
 *
 * The engine change is deliberately **not** a decoy special case (golden rule
 * #2). `AbilityEffect` gains `target`, so an ability can say that *this* effect
 * lands on the caster while *that* one is placed at the aim. Veil & Decoy is the
 * first user; anything that later buffs its caster while putting something down
 * at range gets it for nothing.
 *
 * **R2 is otherwise untouched** — the decoy is still static, still dies to any
 * damage, still blocks nothing, still grants no energy. Only its spawn location
 * moved, and `decoy.test.ts` still owns all of that.
 */

const DATA = join(import.meta.dirname, '../../..', 'data/characters');
const load = (id: string): CharacterDef =>
  JSON.parse(readFileSync(join(DATA, `${id}.json`), 'utf8')) as CharacterDef;
const CHARACTERS = readdirSync(DATA).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DATA, f), 'utf8')) as CharacterDef);

const WISP = load('wisp');
const VEX = load('vex');
const roster: Roster = buildRoster([WISP, VEX]);
const OPEN: MapDef = makeMap(Array.from({ length: 15 }, () => '.'.repeat(15)));

const VEIL = WISP.abilities.find((a) => a.id === 'veil_decoy')!;

const wispAt = (p: Vec2): UnitState =>
  makeUnit('wisp-0', 0, p, { characterId: 'wisp', maxHp: WISP.maxHp, hp: WISP.maxHp });
const vexAt = (p: Vec2): UnitState =>
  makeUnit('vex-0', 1, p, { characterId: 'vex', maxHp: VEX.maxHp, hp: VEX.maxHp });

const cast = (s: GameState, target: Vec2): GameState => resolveTurn(s, OPEN, [
  { team: 0, units: [{ unitId: 'wisp-0', ability: { abilityId: 'veil_decoy', target: [target] } }] },
  { team: 1, units: [] },
] as [PlayerOrders, PlayerOrders], roster).state;

const HOME: Vec2 = { x: 7, y: 7 };
const stealthed = (s: GameState): boolean =>
  s.units.find((u) => u.unitId === 'wisp-0')!.statuses.some((st) => st.kind === 'stealth');

describe('W1: the decoy goes where it is aimed, the vanish stays on Wisp', () => {
  it('THE ITEM: stealth lands on the caster while the decoy spawns three tiles away', () => {
    // Both halves of one cast, going to two different places. That is the whole
    // feature, and the reason a per-effect `target` had to exist at all.
    const away: Vec2 = { x: 10, y: 7 }; // exactly range 3
    const s = cast(makeState([wispAt(HOME)]), away);
    expect(stealthed(s), 'she vanished').toBe(true);
    expect(s.decoys).toHaveLength(1);
    expect(s.decoys[0]!.pos, 'and the decoy is over there').toEqual(away);
    expect(s.units.find((u) => u.unitId === 'wisp-0')!.pos, 'while she has not moved')
      .toEqual(HOME);
  });

  it('the reach is 3, and 4 is refused', () => {
    // `range: 3` is the owner's number. Asserted as a pair so the boundary is
    // pinned from both sides rather than "somewhere out there works".
    expect(VEIL.range).toBe(3);
    expect(cast(makeState([wispAt(HOME)]), { x: 10, y: 7 }).decoys, 'three').toHaveLength(1);
    expect(cast(makeState([wispAt(HOME)]), { x: 11, y: 7 }).decoys, 'four').toHaveLength(0);
  });

  it('and it may still be dropped at her own feet — if she is not standing there', () => {
    // The degenerate aim is legal geometry (range 0 is inside range 3); what
    // refuses it is occupancy, which is the next block's business. Wisp steps
    // away in Move, so the tile she started on is hers at Prep and refused.
    const s = cast(makeState([wispAt(HOME)]), HOME);
    expect(s.decoys, 'her own square is occupied at Prep').toHaveLength(0);
  });

  it('the ability is still FREE — she can vanish and still Sprint', () => {
    // The free-action compose was never the problem and must not become one:
    // W1 changes where the decoy goes, not what the cast costs.
    expect(VEIL.free).toBe(true);
    const s = resolveTurn(makeState([wispAt(HOME)]), OPEN, [
      {
        team: 0,
        units: [{
          unitId: 'wisp-0',
          freeAbility: { abilityId: 'veil_decoy', target: [{ x: 9, y: 7 }] },
          sprint: true,
          movePath: [{ x: 7, y: 8 }, { x: 7, y: 9 }, { x: 7, y: 10 }],
        }],
      },
      { team: 1, units: [] },
    ] as [PlayerOrders, PlayerOrders], roster).state;
    expect(s.decoys, 'the decoy went down').toHaveLength(1);
    expect(s.units[0]!.pos, 'and she sprinted anyway').toEqual({ x: 7, y: 10 });
  });
});

describe('W1: DECOY-PLACEMENT — not on an occupied square', () => {
  /**
   * Ruled in edge-cases. R2 says a decoy does not block occupancy, so placing
   * one *inside* a real unit is mechanically legal — and it reads as broken and
   * self-defeats the deception. The aim is **refused**, not routed to the
   * nearest free square: a decoy that slides somewhere else is a worse tell
   * than a cast that does not happen.
   */
  it('THE RULING: an aim onto an enemy is refused, and nothing else happens either', () => {
    // The whole order is dropped, not just the decoy half — an illegal aim is
    // an illegal aim, and the stealth does not sneak through on a refused cast.
    const s = cast(makeState([wispAt(HOME), vexAt({ x: 9, y: 7 })]), { x: 9, y: 7 });
    expect(s.decoys).toHaveLength(0);
    expect(stealthed(s), 'the cast was refused whole').toBe(false);
  });

  it('and onto a TEAMMATE too — "any unit", either team', () => {
    const mate = makeUnit('wisp-1', 0, { x: 9, y: 7 }, { characterId: 'wisp' });
    const s = cast(makeState([wispAt(HOME), mate]), { x: 9, y: 7 });
    expect(s.decoys).toHaveLength(0);
  });

  it('THE CONTROL: one square over, with nobody on it, works', () => {
    // The pair that makes the refusals above about occupancy rather than about
    // the aim being bad in some other way.
    const s = cast(makeState([wispAt(HOME), vexAt({ x: 9, y: 7 })]), { x: 9, y: 8 });
    expect(s.decoys[0]!.pos).toEqual({ x: 9, y: 8 });
  });

  it('a DEAD unit does not occupy the square', () => {
    // Occupancy is about bodies on the board. A downed character is not one,
    // and every other occupancy rule in the engine agrees.
    const corpse = vexAt({ x: 9, y: 7 });
    corpse.alive = false;
    const s = cast(makeState([wispAt(HOME), corpse]), { x: 9, y: 7 });
    expect(s.decoys).toHaveLength(1);
  });

  it('but an existing DECOY does not block a placement — R2 says it blocks nothing', () => {
    // The scope line. DECOY-PLACEMENT names *units*; extending it to decoys
    // would be a rule nobody wrote, and R2 says explicitly that a decoy blocks
    // nothing.
    //
    // Asked of the predicate rather than of a second cast, because Veil & Decoy
    // is `cooldown: 5` — a two-cast version of this would be green whatever the
    // placement rule said, refused by the cooldown before it ever got here.
    const first = cast(makeState([wispAt(HOME)]), { x: 9, y: 7 });
    expect(first.decoys[0]!.pos).toEqual({ x: 9, y: 7 });
    expect(placementIsFree(VEIL, { x: 9, y: 7 }, first), 'a decoy is not an occupant')
      .toBe(true);
  });
});

describe('W1: `target` is a generic field, not a decoy carve-out', () => {
  it('THE DEFAULT: absent leaves every other character untouched', () => {
    // The AC's broad no-change assertion. `target` defaults to today's routing,
    // so the only two effects in `data/` that carry it are Wisp's — everything
    // else resolves exactly as it did before this field existed.
    const carriers: string[] = [];
    for (const c of CHARACTERS) {
      for (const a of [...c.abilities, c.ultimate]) {
        for (const e of a.effects) {
          if (e.target !== undefined) carriers.push(`${c.id}.${a.id}.${e.kind}`);
        }
      }
    }
    expect(carriers.sort()).toEqual(['wisp.veil_decoy.decoy', 'wisp.veil_decoy.stealth']);
  });

  it('and every shipped character still validates', () => {
    for (const c of CHARACTERS) expect(validateCharacter(c), c.id).toEqual([]);
  });

  it('`target: "aimed"` is refused on a `self` shape — there is no aim to place at', () => {
    const selfCast: AbilityDef = {
      id: 'x', name: 'X', phase: 'prep', shape: 'self', range: 0, cooldown: 0, energyGain: 0,
      effects: [{ kind: 'decoy', target: 'aimed', duration: 1 }], description: 'test',
    };
    expect(validateAbility(selfCast, 'x').join(' '))
      .toMatch(/target "aimed" needs an aimed square — shape is "self"/);
  });

  it('…but `target: "self"` on a `self` shape is fine — it is merely redundant', () => {
    const selfCast: AbilityDef = {
      id: 'x', name: 'X', phase: 'prep', shape: 'self', range: 0, cooldown: 0, energyGain: 0,
      effects: [{ kind: 'stealth', target: 'self', duration: 1 }], description: 'test',
    };
    expect(validateAbility(selfCast, 'x')).toEqual([]);
  });

  it('and a value that is neither is an error', () => {
    const bad: AbilityDef = {
      id: 'x', name: 'X', phase: 'prep', shape: 'square', range: 2, cooldown: 0, energyGain: 0,
      effects: [{ kind: 'decoy', target: 'somewhere' as 'aimed', duration: 1 }],
      description: 'test',
    };
    expect(validateAbility(bad, 'x').join(' ')).toMatch(/target must be "self" or "aimed"/);
  });

  it('THE GENERALITY: a made-up ability buffs its caster and places at range, unchanged engine', () => {
    // The claim golden rule #2 makes, checked rather than asserted in prose: an
    // ability nobody has written yet gets this behaviour out of the data alone.
    const ploy: AbilityDef = {
      id: 'ploy', name: 'Ploy', phase: 'prep', shape: 'square', range: 3,
      cooldown: 0, energyGain: 0,
      effects: [
        { kind: 'shield', target: 'self', amount: 15, duration: 2 },
        { kind: 'decoy', target: 'aimed', duration: 1 },
      ],
      description: 'test',
    };
    // Wisp's other three ride along: v1 requires exactly four abilities, and
    // borrowing hers keeps this about `target` rather than about inventing a
    // whole legal kit.
    const trickster: CharacterDef = {
      ...WISP,
      id: 'trickster',
      abilities: [ploy, ...WISP.abilities.filter((a) => a.id !== 'veil_decoy')],
    };
    expect(validateCharacter(trickster)).toEqual([]);
    const caster = makeUnit('t-0', 0, HOME, { characterId: 'trickster' });
    const s = resolveTurn(makeState([caster]), OPEN, [
      { team: 0, units: [{ unitId: 't-0', ability: { abilityId: 'ploy', target: [{ x: 9, y: 7 }] } }] },
      { team: 1, units: [] },
    ] as [PlayerOrders, PlayerOrders], { trickster }).state;
    expect(s.units[0]!.statuses.some((st) => st.kind === 'shield'), 'the caster is shielded')
      .toBe(true);
    expect(s.decoys[0]!.pos, 'and the placed half went to the aim').toEqual({ x: 9, y: 7 });
  });
});

describe('W1: purity', () => {
  it('the same cast resolves identically twice and never edits the input', () => {
    const s = makeState([wispAt(HOME), vexAt({ x: 12, y: 12 })]);
    const before = JSON.stringify(s);
    const one = cast(s, { x: 9, y: 7 });
    const two = cast(s, { x: 9, y: 7 });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(JSON.stringify(s)).toBe(before);
  });
});
