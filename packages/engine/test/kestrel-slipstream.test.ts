import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { hasStatus } from '../src/status.js';
import { movementBudget } from '../src/movement.js';
import { energyGainPct } from '../src/combat.js';
import type { CharacterDef, GameState, MapDef } from '../src/types.js';

/**
 * KESTREL-SLIPSTREAM-2T — *"Kestrel's slipstream should give a 2T buff for both
 * haste and energized."*
 *
 * Two data fields, `duration: 1 → 2`. It gets a test because "two turns" is an
 * unusually easy thing to be wrong about by exactly one, and the error is
 * invisible on the turn you cast it: a 1-turn rider and a 2-turn rider behave
 * identically for the whole cast turn and differ only afterwards.
 *
 * The tick model, since every assertion below depends on it: `applyStatus` sets
 * `remaining = duration`, and `endOfTurn` decrements once and drops anything
 * that reaches zero. So `duration: 1` is spent by the time the caster acts
 * again — it was only ever a cast-turn buff — and `duration: 2` survives that
 * tick with `remaining: 1`, which is precisely "still up for the next turn".
 *
 * Hence the boundary this file cares about is the state *returned by* the cast
 * turn: what is still on it is what the player gets to use next turn. Checking
 * after the following turn instead would find both riders gone under either
 * value, because that turn's own tick has already run — which is the trap this
 * test walked into once and is commented so it is not walked into again.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const KESTREL = load('kestrel');
const VEX = load('vex');
const SLIPSTREAM = KESTREL.abilities.find((a) => a.id === 'slipstream')!;

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 10 }], [{ x: 18, y: 10 }]],
};
const roster: Roster = { kestrel: KESTREL, vex: VEX };

const opening = () => {
  const state = createMatch(OPEN, '1v1', [[KESTREL], [VEX]]);
  return { state, kestrel: state.units.find((u) => u.characterId === 'kestrel')! };
};

/** Resolve a turn in which Kestrel rides the wind (`casterId`) or does nothing. */
const turn = (state: GameState, casterId?: string): GameState => resolveTurn(state, OPEN, [
  {
    team: 0,
    units: casterId === undefined ? [] : [{
      unitId: casterId,
      ability: {
        abilityId: 'slipstream',
        target: [{ ...state.units.find((u) => u.unitId === casterId)!.pos }],
      },
    }],
  },
  { team: 1, units: [] },
], roster).state;

const unit = (state: GameState, unitId: string) => state.units.find((u) => u.unitId === unitId)!;
const riding = (state: GameState, unitId: string): { haste: boolean; energized: boolean } => ({
  haste: hasStatus(unit(state, unitId), 'haste'),
  energized: hasStatus(unit(state, unitId), 'energized'),
});

describe('KESTREL-SLIPSTREAM-2T: both riders last two turns', () => {
  it('the data says 2 for both, not one of each', () => {
    // Asserted on the JSON because the ask names *both* riders — a change that
    // moved haste and left energized behind is the plausible half-fix, and it
    // would still read as "slipstream lasts longer" in a playtest.
    expect(SLIPSTREAM.effects.map((e) => [e.kind, e.duration]))
      .toEqual([['haste', 2], ['energized', 2]]);
  });

  it('both survive the cast turn\'s tick, so the next turn still has them', () => {
    // The item, in one assertion. Under the shipped `duration: 1` both riders
    // were ticked off here and the following turn started clean.
    const { state, kestrel } = opening();
    const cast = turn(state, kestrel.unitId);
    expect(riding(cast, kestrel.unitId)).toEqual({ haste: true, energized: true });
    // …with one tick already spent, which is what makes it the *next* turn and
    // not the one after as well.
    const me = unit(cast, kestrel.unitId);
    expect(me.statuses.filter((s) => s.remaining > 0).map((s) => [s.kind, s.remaining]))
      .toEqual([['haste', 1], ['energized', 1]]);
  });

  it('and they are actually worth something on that turn, not just present', () => {
    // A status the engine carries but nothing reads would satisfy the counter
    // assertions above and give the player nothing. Both riders are checked
    // through the functions that consume them.
    const { state, kestrel } = opening();
    const base = unit(state, kestrel.unitId);
    const cast = unit(turn(state, kestrel.unitId), kestrel.unitId);
    expect(movementBudget(cast), 'hasted next turn').toBeGreaterThan(movementBudget(base));
    expect(energyGainPct(cast), 'and energized next turn').toBeGreaterThan(energyGainPct(base));
  });

  it('but they are gone after that next turn — 2 turns, not 3', () => {
    // The far end. "Longer" was not the ask; "two" was.
    const { state, kestrel } = opening();
    const after = turn(turn(state, kestrel.unitId));
    expect(riding(after, kestrel.unitId)).toEqual({ haste: false, energized: false });
  });

  it('the description tells the player it is two', () => {
    expect(SLIPSTREAM.description).toContain('two turns');
  });
});
