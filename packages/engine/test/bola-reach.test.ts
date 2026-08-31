import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { buildRoster } from '../src/setup.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { CharacterDef, GameState, MapDef, Vec2 } from '../src/types.js';

/**
 * BOLA-RANGE — **the bola reaches 5.**
 *
 * Owner Dev Note (2026-08-29): *"Wisp's bola should have a 5 range."* It was
 * authored at 6, which is `VISION_RANGE` — the whole of what she can see. At 5
 * it stops one square short of her sight, so there is now a band she can watch
 * a target stand in and not reach, which is the point of moving it.
 *
 * There is no derivation behind 5 and none is invented here: it is the owner's
 * number. What this file pins is the **consequence** rather than the field —
 * the shipped `.json` is read, a real turn is resolved, and the boundary is
 * asserted from both sides. A change-detector on `range` alone would pass just
 * as happily if the resolver had stopped reading it.
 */

const WISP = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../data/characters/wisp.json'), 'utf8'),
) as CharacterDef;
const BOLA = WISP.abilities.find((a) => a.id === 'bola')!;
const roster: Roster = buildRoster([WISP]);

/** Open floor, wide enough that nothing here runs out of board. */
const FIELD: MapDef = makeMap(Array.from({ length: 5 }, () => '.'.repeat(14)));

/** Wisp at (1,2); one enemy `gap` squares due east. Returns the enemy after the turn. */
const shootEast = (gap: number): GameState['units'][number] => {
  const target: Vec2 = { x: 1 + gap, y: 2 };
  const state: GameState = makeState([
    makeUnit('wisp', 0, { x: 1, y: 2 }, { characterId: 'wisp' }),
    makeUnit('foe', 1, target, { characterId: 'wisp' }),
  ]);
  const { state: after } = resolveTurn(state, FIELD, [
    // Aimed at the far edge of the row, so the aim itself is never the thing
    // that ran out — only the ability's own reach can end the beam.
    { team: 0, units: [{ unitId: 'wisp', ability: { abilityId: 'bola', target: [{ x: 13, y: 2 }] } }] },
    { team: 1, units: [] },
  ], roster);
  return after.units.find((u) => u.unitId === 'foe')!;
};

describe('BOLA-RANGE: the shipped number', () => {
  it('THE NOTE: Bola is authored at range 5', () => {
    expect(BOLA.range).toBe(5);
  });
});

describe('BOLA-RANGE: what that reach costs, at the boundary', () => {
  it('an enemy five squares away is hit', () => {
    expect(shootEast(5).hp).toBeLessThan(100);
  });

  it('…and one at six is not — the beam stops one short of her sight', () => {
    // The half that makes the test about the reach rather than about the bola
    // working at all. Six is `VISION_RANGE`: she can see this target and cannot
    // hit it, which is exactly the band the note opened.
    expect(shootEast(6).hp).toBe(100);
  });

  it('and the near end is unchanged — an adjacent enemy still takes it', () => {
    expect(shootEast(1).hp).toBeLessThan(100);
  });
});
