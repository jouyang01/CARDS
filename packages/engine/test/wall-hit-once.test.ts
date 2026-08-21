import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { WALL_ROTATIONS } from '../src/shapes.js';
import type { CharacterDef, GameState, MapDef, TurnEvent, Vec2 } from '../src/types.js';

/**
 * WALL-HIT-ONCE — *"Warding Wall is not a trap that goes away after being hit"*,
 * disambiguated by the owner to **"barrier, but each unit hit once."**
 *
 * Warding Wall is `perTile`: one cast, four independent one-shot traps. Every
 * other part of that is right — a tile is consumed when it fires, the wall
 * expires at the end of its placement turn — but it meant **one unit could be
 * billed several times by one wall**. Walking *along* its length ran over three
 * tiles for 75, and even a perpendicular cross that clipped two tiles
 * double-hit. (WALL-CAST-FIX's client test ran into exactly this and had to
 * route its enemy perpendicular to get a number it could reason about.)
 *
 * The owner did not ask for the wall to be spent by the first victim — a barrier
 * that one enemy can safely eat is not a barrier. So the rule is a **per-unit,
 * per-cast dedup**: the first tile to catch you fires and is consumed, and the
 * rest of *that cast* neither fire on *you* again this turn nor are consumed —
 * they are still lying there for the next enemy.
 *
 * The dedup is keyed on a `groupId` stamped at placement, so it is generic: any
 * future multi-tile hazard inherits "one hit per unit per cast" for free, and a
 * single-tile mine never gets a group at all because being consumed on the first
 * trigger already makes it once-per-unit.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const AEGIS = load('aegis');
const VEX = load('vex');
const RAVOK = load('ravok');
const BASTION = load('bastion');
const WALL = AEGIS.abilities.find((a) => a.id === 'warding_wall')!;
const MINE = VEX.abilities.find((a) => a.id === 'overwatch_trap')!;
/** Read off the data so a balance pass moves the expectation with the ability. */
const WALL_DAMAGE = WALL.effects.find((e) => e.kind === 'trap')!.amount!;
const MINE_DAMAGE = MINE.effects.find((e) => e.kind === 'trap')!.amount!;

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 10 }, { x: 3, y: 10 }], [{ x: 18, y: 10 }, { x: 17, y: 10 }]],
};
const roster: Roster = { aegis: AEGIS, vex: VEX, ravok: RAVOK, bastion: BASTION };
const SOUTH = WALL_ROTATIONS[1]!;

/**
 * The wall every test below stands up: anchored at (12,9) running SOUTH, so it
 * is the column **x = 12, y = 9..12** — four tiles, one cast.
 */
const WALL_AT: Vec2 = { x: 12, y: 9 };
const wallOrder = (unitId: string, at: Vec2 = WALL_AT) =>
  ({ unitId, ability: { abilityId: WALL.id, target: [{ ...at }], aimStep: SOUTH } });

const unit = (s: GameState, unitId: string) => s.units.find((u) => u.unitId === unitId)!;
const hpLost = (before: GameState, after: GameState, unitId: string): number =>
  unit(before, unitId).hp - unit(after, unitId).hp;

/** How many separate traps went off on this unit — the count the dedup changes. */
const triggersOn = (events: readonly TurnEvent[], unitId: string): number =>
  events.filter((e) => e.type === 'trapTriggered' && e.unitId === unitId).length;

/** A 2v2 with both teams' characters placed by the caller. */
const field = (mine: CharacterDef[], theirs: CharacterDef[], at: Record<number, Vec2>) => {
  const state = createMatch(OPEN, '2v2', [mine, theirs]);
  const ordered = [...state.units.filter((u) => u.owner === 0), ...state.units.filter((u) => u.owner === 1)];
  ordered.forEach((u, i) => { const p = at[i]; if (p !== undefined) u.pos = { ...p }; });
  return { state, us: ordered.slice(0, mine.length), them: ordered.slice(mine.length) };
};

describe('WALL-HIT-ONCE: one wall bills one unit once', () => {
  it('walking ALONG a three-tile stretch costs 25, not 75', () => {
    // The bug, in the form the owner met it. The enemy starts south of the wall
    // and walks up the inside of the column, entering (12,12), (12,11) and
    // (12,10) — three tiles of one cast. Before the dedup that was three
    // separate traps for three separate 25s.
    const { state, us, them } = field([AEGIS, VEX], [VEX, VEX], {
      0: { x: 10, y: 10 }, 1: { x: 1, y: 1 }, 2: { x: 12, y: 13 }, 3: { x: 1, y: 19 },
    });
    const walker = them[0]!;
    const out = resolveTurn(state, OPEN, [
      { team: 0, units: [wallOrder(us[0]!.unitId)] },
      {
        team: 1,
        units: [{
          unitId: walker.unitId,
          movePath: [{ x: 12, y: 12 }, { x: 12, y: 11 }, { x: 12, y: 10 }],
        }],
      },
    ], roster);

    expect(unit(out.state, walker.unitId).pos, 'the walk really did run the wall')
      .toEqual({ x: 12, y: 10 });
    expect(triggersOn(out.events, walker.unitId), 'one trap, not three').toBe(1);
    expect(hpLost(state, out.state, walker.unitId)).toBe(WALL_DAMAGE);
  });

  it('but the wall is still there for the NEXT enemy — it is a barrier', () => {
    // The half the owner explicitly kept, and the reason this is a dedup rather
    // than "the wall is spent by whoever hits it first". Two enemies cross the
    // same cast on different rows; both pay.
    const { state, us, them } = field([AEGIS, VEX], [VEX, VEX], {
      0: { x: 10, y: 10 }, 1: { x: 1, y: 1 }, 2: { x: 13, y: 10 }, 3: { x: 13, y: 12 },
    });
    const out = resolveTurn(state, OPEN, [
      { team: 0, units: [wallOrder(us[0]!.unitId)] },
      {
        team: 1,
        units: [
          { unitId: them[0]!.unitId, movePath: [{ x: 12, y: 10 }, { x: 11, y: 10 }] },
          { unitId: them[1]!.unitId, movePath: [{ x: 12, y: 12 }, { x: 11, y: 12 }] },
        ],
      },
    ], roster);

    expect(hpLost(state, out.state, them[0]!.unitId), 'first crosser').toBe(WALL_DAMAGE);
    expect(hpLost(state, out.state, them[1]!.unitId), 'and the second one too').toBe(WALL_DAMAGE);
  });

  it('and two SEPARATE walls each get their bite of the same unit', () => {
    // The scope line: the dedup is per cast, not per ability and not per turn.
    // Two Aegis raise two walls; one enemy walks through both and pays twice.
    // A dedup keyed on the ability id — an easy way to write this — would make
    // the second wall free, and it would look correct in every other test here.
    const { state, us, them } = field([AEGIS, AEGIS], [VEX, VEX], {
      0: { x: 10, y: 10 }, 1: { x: 13, y: 12 }, 2: { x: 15, y: 10 }, 3: { x: 1, y: 19 },
    });
    const walker = them[0]!;
    const out = resolveTurn(state, OPEN, [
      {
        team: 0,
        units: [wallOrder(us[0]!.unitId), wallOrder(us[1]!.unitId, { x: 14, y: 9 })],
      },
      {
        team: 1,
        units: [{
          unitId: walker.unitId,
          movePath: [{ x: 14, y: 10 }, { x: 13, y: 10 }, { x: 12, y: 10 }, { x: 11, y: 10 }],
        }],
      },
    ], roster);

    expect(triggersOn(out.events, walker.unitId), 'one from each wall').toBe(2);
    expect(hpLost(state, out.state, walker.unitId)).toBe(WALL_DAMAGE * 2);
  });

  it('the dedup spans the whole turn, not one phase', () => {
    // Ruled explicitly (edge-cases, WALL-HIT-ONCE): "the set spans the whole
    // turn". Ravok charges through the wall in DASH — crossing (12,10) and
    // bending south to rest at (11,11) — and Bastion's Chain Hook then drags him
    // back east through (12,11) in BLAST. Two different tiles of one cast, in
    // two different phases.
    //
    // The bend matters, and it is the only way to build this: a straight charge
    // leaves the victim in the lane it crossed, so a shove back along that lane
    // re-enters the tile the charge already consumed and there is nothing left
    // to fire. Only a victim who *changed lane* mid-turn can reach a second live
    // tile of the same wall — which makes this the one arrangement where a
    // phase-scoped dedup would still be wrong.
    const { state, us, them } = field([AEGIS, BASTION], [RAVOK, VEX], {
      0: { x: 9, y: 9 }, 1: { x: 15, y: 11 }, 2: { x: 14, y: 10 }, 3: { x: 1, y: 19 },
    });
    const charger = them[0]!;
    const out = resolveTurn(state, OPEN, [
      {
        team: 0,
        units: [
          wallOrder(us[0]!.unitId),
          { unitId: us[1]!.unitId, ability: { abilityId: 'chain_hook', target: [{ x: 11, y: 11 }] } },
        ],
      },
      {
        team: 1,
        units: [{
          unitId: charger.unitId,
          ability: {
            abilityId: 'bullrush',
            target: [{ x: 13, y: 10 }, { x: 12, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }],
          },
        }],
      },
    ], roster);

    // The fixture, asserted before anything is concluded from it: the charge
    // really did cross the wall and land off its lane, and the hook really did
    // drag him back across it.
    const crossedInDash = out.events.some((e) => e.type === 'moveStep'
      && e.unitId === charger.unitId && e.to.x === 12 && e.to.y === 10);
    expect(crossedInDash, 'the charge went through the wall').toBe(true);
    // A displacement reports one `displaced` event for the whole slide rather
    // than a step per square, so the crossing is read off its endpoints: pulled
    // from (11,11) to (13,11) along y=11, which passes through (12,11).
    const pulled = out.events.flatMap((e) =>
      (e.type === 'displaced' && e.unitId === charger.unitId ? [e] : []))[0];
    expect(pulled, 'the hook connected').toBeDefined();
    expect({ from: pulled!.from, to: pulled!.to }, 'and dragged him back across the wall line')
      .toEqual({ from: { x: 11, y: 11 }, to: { x: 13, y: 11 } });

    expect(triggersOn(out.events, charger.unitId), 'one wall, one hit, all turn').toBe(1);
  });
});

describe('WALL-HIT-ONCE: single-tile traps are untouched', () => {
  it('two ordinary mines on one route both go off', () => {
    // A mine is consumed by the first unit to set it off, so "once per unit" is
    // already true of it and it is given no group at all. This is the test that
    // fails if the dedup were keyed on something coarser — the ability id, or
    // the owner — and quietly made a second mine free.
    const { state, us, them } = field([VEX, VEX], [VEX, VEX], {
      0: { x: 10, y: 10 }, 1: { x: 10, y: 12 }, 2: { x: 15, y: 10 }, 3: { x: 1, y: 19 },
    });
    const walker = them[0]!;
    const out = resolveTurn(state, OPEN, [
      {
        team: 0,
        units: [
          { unitId: us[0]!.unitId, ability: { abilityId: MINE.id, target: [{ x: 13, y: 10 }] } },
          { unitId: us[1]!.unitId, ability: { abilityId: MINE.id, target: [{ x: 12, y: 10 }] } },
        ],
      },
      {
        team: 1,
        units: [{
          unitId: walker.unitId,
          movePath: [{ x: 14, y: 10 }, { x: 13, y: 10 }, { x: 12, y: 10 }, { x: 11, y: 10 }],
        }],
      },
    ], roster);

    expect(triggersOn(out.events, walker.unitId), 'both mines').toBe(2);
    expect(hpLost(state, out.state, walker.unitId)).toBe(MINE_DAMAGE * 2);
  });

  it('and a mine carries no group id — it never needed one', () => {
    // The structural half of the claim above, readable because a mine outlives
    // its turn (`lifetime: 3`) where the wall does not. `groupId` means "I am one
    // tile of a bigger hazard", not "every trap has an id".
    const { state, us } = field([VEX, VEX], [VEX, VEX], {
      0: { x: 10, y: 10 }, 1: { x: 1, y: 1 }, 2: { x: 18, y: 10 }, 3: { x: 1, y: 19 },
    });
    const out = resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId: us[0]!.unitId, ability: { abilityId: MINE.id, target: [{ x: 13, y: 10 }] } }] },
      { team: 1, units: [] },
    ], roster);

    expect(out.state.traps).toHaveLength(1);
    expect(out.state.traps[0]!.groupId, 'a lone mine is its own group of one').toBeUndefined();
  });
});
