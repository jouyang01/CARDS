import { describe, expect, it } from 'vitest';
import {
  buildBoard, createMatch, terrainAt,
  type CharacterDef, type MapDef,
} from '@cards/engine';
import { SCENARIOS, applyScenario, isScenarioId } from '../src/scenarios.js';
import { describeSetup, parseSetup } from '../src/match-setup.js';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * CAMO-SEED — a dev-only named starting arrangement.
 *
 * The point is what it *does not* do: it nudges starting positions and nothing
 * else. No scripted orders, no injected state, no rewritten rules. So the tests
 * that matter are the negative ones — a normal match is untouched, an unknown
 * seed is refused rather than silently ignored, and the seeded state is one the
 * engine could have reached on its own (nobody stacked, nobody in a wall).
 */

const ARENA = duelArena as unknown as MapDef;
const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const MAPS = [ARENA];

const seeded = () => {
  const board = buildBoard(ARENA);
  const plain = createMatch(ARENA, '2v2', [[CATALOG[0]!, CATALOG[2]!], [CATALOG[1]!, CATALOG[3]!]]);
  return { board, plain, brushed: applyScenario('in-brush', board, plain) };
};

describe('CAMO-SEED: the in-brush seed', () => {
  it('puts one character per team inside brush', () => {
    const { board, brushed } = seeded();
    for (const team of [0, 1] as const) {
      const inBrush = brushed.units.filter(
        (u) => u.owner === team && terrainAt(board, u.pos) === 'brush',
      );
      expect(inBrush.length, `team ${team} has nobody in cover`).toBe(1);
    }
  });

  it('moves nobody else', () => {
    const { plain, brushed } = seeded();
    const movedIds = brushed.units
      .filter((u) => {
        const before = plain.units.find((p) => p.unitId === u.unitId)!;
        return before.pos.x !== u.pos.x || before.pos.y !== u.pos.y;
      })
      .map((u) => u.unitId);
    expect(movedIds, 'exactly one unit per team').toHaveLength(2);
  });

  it('produces a state the engine could have reached — nobody stacked', () => {
    // A seed that put two units on one square would be a board Collisions
    // forbids, and everything downstream would be reasoning about a position
    // that cannot occur in play.
    const { brushed } = seeded();
    const squares = brushed.units.map((u) => `${u.pos.x},${u.pos.y}`);
    expect(new Set(squares).size).toBe(squares.length);
  });

  it('changes nothing but positions', () => {
    const { plain, brushed } = seeded();
    const strip = (s: typeof plain) => ({ ...s, units: s.units.map((u) => ({ ...u, pos: null })) });
    expect(strip(brushed)).toEqual(strip(plain));
  });

  it('is deterministic — the same seed puts the same unit on the same square', () => {
    // The e2e it exists for is only worth having if it lands identically every
    // run; "nearest brush" is tie-broken by the board's own scan order for
    // exactly this reason.
    const a = seeded().brushed;
    const b = seeded().brushed;
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('leaves a brushless map alone rather than throwing', () => {
    // A dev hook that breaks the page on the wrong map is worse than one that
    // quietly does nothing — the e2e asserting on the seeded condition fails
    // loudly anyway, which is the right place for that failure.
    const bare: MapDef = { ...ARENA, brush: [] };
    const plain = createMatch(bare, '2v2', [[CATALOG[0]!, CATALOG[2]!], [CATALOG[1]!, CATALOG[3]!]]);
    expect(applyScenario('in-brush', buildBoard(bare), plain)).toEqual(plain);
  });
});

describe('CAMO-SEED: it is opt-in, and it says so', () => {
  const setupFor = (search: string) => parseSetup(search, MAPS, CATALOG);

  it('a normal match carries no scenario at all', () => {
    const result = setupFor('');
    expect('setup' in result && result.setup.scenario).toBeUndefined();
  });

  it('`?scenario=in-brush` carries it through', () => {
    const result = setupFor('?scenario=in-brush');
    expect('setup' in result && result.setup.scenario).toBe('in-brush');
  });

  it('an unknown scenario is an error, not a silent normal match', () => {
    // "My scenario did nothing" and "my scenario is not doing what I think" are
    // indistinguishable if an unknown name is ignored.
    const result = setupFor('?scenario=nope');
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.join(' ')).toMatch(/unknown scenario "nope"/);
      expect(result.errors.join(' '), 'and it lists the real ones').toContain('in-brush');
    }
  });

  it('a seeded match announces itself in the setup line', () => {
    const result = setupFor('?scenario=in-brush');
    if (!('setup' in result)) throw new Error('expected a setup');
    expect(describeSetup(result.setup)).toContain('scenario: in-brush');
    const plain = setupFor('');
    if (!('setup' in plain)) throw new Error('expected a setup');
    expect(describeSetup(plain.setup)).not.toContain('scenario');
  });

  it('every listed scenario id is recognised, and nothing else is', () => {
    for (const id of SCENARIOS) expect(isScenarioId(id), id).toBe(true);
    for (const nope of ['', 'in brush', 'IN-BRUSH', 'camo']) {
      expect(isScenarioId(nope), nope).toBe(false);
    }
  });
});
