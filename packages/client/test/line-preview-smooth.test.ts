import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AIM_STEPS, buildBoard, expandShape, stepToVector,
  type AbilityDef, type CharacterDef, type MapDef, type UnitState, type Vec2,
} from '@cards/engine';
import {
  aimBoundaries, boundaryDerivations, resetBoundaryCache,
} from '../src/aim-boundary.js';

/**
 * LINE-PREVIEW-SMOOTH — *"Vex's and other line attack previews seem to be a
 * little laggy, can you make it more smooth?"*
 *
 * The aim follows the mouse continuously and the outline does not. AIM2
 * quantizes a free-rotation aim to one of `AIM_STEPS` directions, so a pointer
 * sweeping across one step's worth of screen produces a run of *identical*
 * polygons — and AIM-PREVIEW-TRUE tessellates each of them from scratch, arcs
 * and all. The work is real, the result is thrown away, and it gets worse the
 * longer the shape is, which is why a line attack is where it was noticed.
 *
 * The fix is a memo on the **quantized** aim rather than on the pointer. What
 * makes it testable at all is that the output is byte-identical either way: a
 * test comparing polygons cannot tell a cached answer from a recomputed one. So
 * `boundaryDerivations()` counts the tessellations, and these assertions are
 * about that counter — the one observable that distinguishes "smooth" from
 * "looks the same and costs the same".
 *
 * The correctness half is not re-argued here. `aim-boundary.test.ts`'s
 * congruence sweep already proves the boundary is the engine's predicate at
 * every rotation, and it runs against the memoised function — a cache that
 * returned the wrong polygon would fail it, loudly, for every shape at once.
 * What is checked below is that the memo has not become a *lie*: every input
 * the outline depends on still misses the cache when it changes.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const VEX = load('vex');
const AEGIS = load('aegis');
const RAIL = VEX.abilities.find((a) => a.id === 'rail_shot')!;
const BASH = AEGIS.abilities.find((a) => a.id === 'shield_bash')!;

const MAP: MapDef = {
  id: 't', name: 't', width: 25, height: 25, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 12 }], [{ x: 22, y: 12 }]],
};
const BOARD = buildBoard(MAP);
const CENTRE: Vec2 = { x: 12, y: 12 };

const unitAt = (pos: Vec2, unitId = 'u0'): UnitState => ({
  unitId, characterId: 'vex', owner: 0, pos: { ...pos }, hp: 100, maxHp: 100,
  energy: 0, alive: true, statuses: [], cooldowns: {}, ultUsed: false,
  catalysts: [], catalystsUsed: [],
} as unknown as UnitState);

/** The tiles the engine covers at one aim step — what `app.ts` passes as `covered`. */
const coveredAt = (def: AbilityDef, step: number, from: Vec2 = CENTRE): Vec2[] =>
  expandShape(BOARD, def, from, [], step);

/** One hover: derive the outline the way the controller does. */
const hover = (def: AbilityDef, step: number, unit = unitAt(CENTRE)): void => {
  aimBoundaries(unit, def, [], step, coveredAt(def, step, unit.pos));
};

beforeEach(() => { resetBoundaryCache(); });

describe('LINE-PREVIEW-SMOOTH: one derivation per aim step, not per pixel', () => {
  it('the counter really does count — a first hover derives', () => {
    // The instrument, before anything is concluded from it. A counter stuck at
    // zero would make every "did not derive" claim below pass for free.
    expect(boundaryDerivations()).toBe(0);
    hover(RAIL, 0);
    expect(boundaryDerivations()).toBe(1);
  });

  it('a hundred hovers at the same aim step derive exactly once', () => {
    // The item. Between two quantized directions the pointer can cross a great
    // many pixels, and every one of them used to re-tessellate the lane.
    for (let i = 0; i < 100; i += 1) hover(RAIL, 0);
    expect(boundaryDerivations(), 'the other ninety-nine were free').toBe(1);
  });

  it('and the polygon is the same object each time, not merely equal', () => {
    // Identity rather than deep equality, because deep equality is what a
    // re-derivation would also produce — this is the assertion that would fail
    // if the memo were quietly removed.
    const unit = unitAt(CENTRE);
    const once = aimBoundaries(unit, RAIL, [], 0, coveredAt(RAIL, 0));
    const twice = aimBoundaries(unit, RAIL, [], 0, coveredAt(RAIL, 0));
    expect(twice).toBe(once);
  });

  it('but a new aim step derives again — the outline still tracks', () => {
    // The other half, and the one that matters more: a memo that never misses
    // is a frozen preview. Eight genuinely different directions, eight
    // derivations.
    const steps = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * AIM_STEPS) / 8);
    for (const step of steps) hover(RAIL, step);
    expect(boundaryDerivations()).toBe(steps.length);
    // …and going back to one already seen is free again.
    hover(RAIL, steps[0]!);
    expect(boundaryDerivations()).toBe(steps.length);
  });

  it('sweeping the whole rotation derives once per step and never twice', () => {
    // The upper bound, over every aim step the engine can quantize to. If the
    // key carried anything finer than the quantized aim — a raw pointer
    // coordinate, a float — this count would exceed the number of steps.
    const directions = new Set<string>();
    for (let step = 0; step < AIM_STEPS; step += 1) {
      const dir = stepToVector(step);
      directions.add(`${dir.x},${dir.y}`);
    }
    for (let step = 0; step < AIM_STEPS; step += 1) hover(RAIL, step);
    expect(boundaryDerivations(), 'at most one outline per distinct direction')
      .toBeLessThanOrEqual(directions.size);
  });

  it('a hover that wanders between two neighbouring steps derives twice, total', () => {
    // What the pointer actually does. A player nudging an aim across a step
    // boundary and back re-crosses it many times; the cache is small, but it is
    // not one slot, so the two outlines either side of a boundary both stay
    // resident and the wander is free after the first crossing.
    for (let i = 0; i < 50; i += 1) {
      hover(RAIL, 0);
      hover(RAIL, 1);
    }
    expect(boundaryDerivations()).toBe(2);
  });
});

describe('LINE-PREVIEW-SMOOTH: the key covers everything the outline depends on', () => {
  // A memo is only as honest as its key. Each of these changes the drawn shape
  // and must therefore miss — a stale outline is a worse bug than a slow one,
  // because it is silent.

  it('the caster moving derives a new outline', () => {
    hover(RAIL, 0, unitAt(CENTRE));
    hover(RAIL, 0, unitAt({ x: 8, y: 12 }));
    expect(boundaryDerivations()).toBe(2);
  });

  it('a different ability derives a new outline', () => {
    // Same direction, same caster: only the shape knobs differ. Bash is a
    // 3-wide beam and Rail Shot a 1-wide lane, so a key that ignored the
    // ability would draw the wrong width.
    hover(RAIL, 0);
    hover(BASH, 0);
    expect(boundaryDerivations()).toBe(2);
  });

  it('an occluded shape derives a new outline, because its reach changed', () => {
    // AC #3: the boundary stops where the tiles stop. `reach` is in the key, so
    // the same aim against a wall is a different outline — asserted by feeding
    // the two different `covered` lists the engine produces.
    const unit = unitAt(CENTRE);
    const full = coveredAt(RAIL, 0);
    const clipped = full.filter((p) => p.x <= CENTRE.x + 2);
    aimBoundaries(unit, RAIL, [], 0, full);
    aimBoundaries(unit, RAIL, [], 0, clipped);
    expect(boundaryDerivations(), 'the shortened lane is its own outline').toBe(2);
  });

  it('two casters aiming at once do not evict each other', () => {
    // AC #5 draws the locked-in teammate plans on the same frame as the live
    // aim, so more than one boundary is derived per render. A single-slot cache
    // would be evicted by each in turn and never hit — a memo that makes things
    // slower. Alternating between two casters must cost two derivations total.
    const me = unitAt(CENTRE, 'u0');
    const mate = unitAt({ x: 12, y: 16 }, 'u1');
    for (let i = 0; i < 20; i += 1) {
      aimBoundaries(me, RAIL, [], 0, coveredAt(RAIL, 0, me.pos));
      aimBoundaries(mate, RAIL, [], 0, coveredAt(RAIL, 0, mate.pos));
    }
    expect(boundaryDerivations()).toBe(2);
  });

  it('the cache is bounded, so a long match cannot grow it without limit', () => {
    // The key contains the aim, so an unbounded map would gain an entry for
    // every square a player ever hovered. Sweeping far more distinct keys than
    // the cache holds and returning to the first must miss.
    const casters = Array.from({ length: 40 }, (_, i) => unitAt({ x: 4 + i % 16, y: 12 }, `u${i}`));
    for (const caster of casters) {
      aimBoundaries(caster, RAIL, [], 0, coveredAt(RAIL, 0, caster.pos));
    }
    const before = boundaryDerivations();
    aimBoundaries(casters[0]!, RAIL, [], 0, coveredAt(RAIL, 0, casters[0]!.pos));
    expect(boundaryDerivations(), 'the oldest entry was evicted').toBe(before + 1);
  });
});
