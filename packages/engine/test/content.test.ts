import { describe, expect, it } from 'vitest';
import { validateCharacter, validateMap } from '../src/validate.js';
import { BENEFICIAL_KINDS, HARMFUL_KINDS, NEUTRAL_KINDS } from '../src/resolve.js';
import { MAX_ABILITY_RANGE } from '../src/constants.js';
import { distance } from '../src/board.js';
import { getFormat, type FormatId } from '../src/formats.js';
import { movementBudget } from '../src/movement.js';
import { createMatch, validateMapForFormat } from '../src/setup.js';
import { EFFECT_KINDS, type CharacterDef, type MapDef } from '../src/types.js';

import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import kestrel from '../../../data/characters/kestrel.json';
import cinder from '../../../data/characters/cinder.json';
import lumen from '../../../data/characters/lumen.json';
import thorn from '../../../data/characters/thorn.json';
import aegis from '../../../data/characters/aegis.json';
import ravok from '../../../data/characters/ravok.json';
import duelArena from '../../../data/maps/duel-arena.json';
import ironBasin from '../../../data/maps/iron-basin.json';

const characters = [vex, bastion, wisp, kestrel, cinder, lumen, thorn, aegis, ravok] as unknown as CharacterDef[];
const map = duelArena as unknown as MapDef;
const IRON = ironBasin as unknown as MapDef;
/** Every shipped map, with the formats it is meant to host. */
const MAPS: { map: MapDef; formats: FormatId[] }[] = [
  { map, formats: ['1v1', '2v2', '4v4'] },
  { map: IRON, formats: ['4v4'] },
];

describe('character content', () => {
  for (const c of characters) {
    it(`${c.id} passes validation`, () => {
      expect(validateCharacter(c)).toEqual([]);
    });
  }

  it('all character ids are unique', () => {
    const ids = characters.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('EVERY character has a dash-phase escape or reposition tool', () => {
    // The guardrail that makes the mind-game work: whatever your opponent
    // commits to, you must have had an answer available in the Dash phase.
    // Support used to be exempt because Thorn had no dash; Bramble Stride closed
    // that hole, so the exemption is gone and the rule now covers the roster.
    for (const c of characters) {
      const dashAbilities = c.abilities.filter((a) => a.phase === 'dash');
      expect(dashAbilities.length, `${c.id} (${c.archetype}) must have >= 1 dash ability`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('map content', () => {
  for (const { map: m, formats } of MAPS) {
    it(`${m.id} passes validation and hosts ${formats.join('/')}`, () => {
      expect(validateMap(m)).toEqual([]);
      for (const format of formats) {
        expect(validateMapForFormat(m, format), `${m.id} must host ${format}`).toEqual([]);
      }
    });

    it(`${m.id} is left-right mirror symmetric (fair for both players)`, () => {
      const mirror = (x: number) => m.width - 1 - x;
      const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
      for (const kind of ['walls', 'cover', 'brush'] as const) {
        const set = new Set(m[kind].map(key));
        for (const p of m[kind]) {
          expect(set.has(key({ x: mirror(p.x), y: p.y })), `${m.id} ${kind} at (${p.x},${p.y}) lacks its mirror`).toBe(true);
        }
      }
      // Spawns must mirror too, or one team starts closer to the middle.
      const spawnKeys = new Set(m.spawns[1].map(key));
      for (const p of m.spawns[0]) {
        expect(spawnKeys.has(key({ x: mirror(p.x), y: p.y })), `${m.id} spawn (${p.x},${p.y}) lacks its mirror`).toBe(true);
      }
    });
  }
});

/**
 * The guardrail M2 (the range cap) exists to protect: **nobody can be hit on
 * turn 1 while still standing on their spawn.** Losing a quarter of your HP
 * before you have made a decision is not a mind-game, it is a dice roll on who
 * picked the longer gun.
 *
 * Everything here is DERIVED — from the roster's own ability ranges, the
 * engine's `movementBudget`, and the maps' own spawn squares. Hardcoding the
 * numbers would let a future long-range character silently reintroduce the
 * problem while the test kept passing.
 */
describe('turn-1 threat cannot reach an enemy spawn (roster-derived)', () => {
  /**
   * The furthest an attack can start from and still land, measured
   * conservatively as `movement + longest non-ultimate range`.
   *
   * It is deliberately an over-estimate. Blast resolves *before* Move, so a
   * shot is actually fired from the pre-move square and movement adds nothing
   * to its reach; a dash's range is its own travel, not a bonus on top. The
   * margin is the point — a guard that is exactly tight fails the moment the
   * Designer nudges a number, and this one should only fire when something is
   * genuinely wrong.
   *
   * Ultimates are excluded: they are energy-gated and unreachable on turn 1.
   */
  const maxTurn1Threat = (m: MapDef): number => {
    // A real match, so the budget comes from the engine rather than a constant.
    const state = createMatch(m, '1v1', [[characters[0]!], [characters[1]!]]);
    const budget = movementBudget(state.units[0]!, false); // sprint is move-ONLY, so it deals nothing
    const longestReach = Math.max(...characters.flatMap((c) => c.abilities.map((a) => a.range)));
    return budget + longestReach;
  };

  /** The closest any two opposing spawn squares a format actually uses get. */
  const minSpawnSeparation = (m: MapDef, format: FormatId): number => {
    const per = getFormat(format).charactersPerTeam;
    const used: [{ x: number; y: number }[], { x: number; y: number }[]] =
      [m.spawns[0].slice(0, per), m.spawns[1].slice(0, per)];
    let closest = Infinity;
    for (const a of used[0]) for (const b of used[1]) closest = Math.min(closest, distance(a, b));
    return closest;
  };

  for (const { map: m, formats } of MAPS) {
    for (const format of formats) {
      it(`${m.id} @ ${format}: no opening shot reaches a spawn`, () => {
        const threat = maxTurn1Threat(m);
        const separation = minSpawnSeparation(m, format);
        expect(separation, `${m.id} @ ${format}: threat ${threat} vs separation ${separation}`).toBeGreaterThan(threat);
      });
    }
  }

  it('is derived, not hardcoded — a longer gun WOULD trip it', () => {
    // The test's own teeth. If the guard could not fail, it is decoration; so
    // compute the shortest range that would reach a spawn and show (a) the same
    // computation rejects it, and (b) nothing shipped is that long. A future
    // character crossing that line fails the assertions above automatically.
    const state = createMatch(map, '1v1', [[characters[0]!], [characters[1]!]]);
    const budget = movementBudget(state.units[0]!, false);
    const separation = minSpawnSeparation(map, '2v2');
    const shortestReachingRange = separation - budget;

    expect(budget + shortestReachingRange).toBeGreaterThanOrEqual(separation); // would fire
    const longest = Math.max(...characters.flatMap((c) => c.abilities.map((a) => a.range)));
    expect(longest, 'no shipped non-ultimate is long enough to reach a spawn').toBeLessThan(shortestReachingRange);
  });

  it('the cap is what keeps the margin — MAX_ABILITY_RANGE bounds the threat', () => {
    // Ties the guard back to M2: no non-ultimate can exceed the cap, so the
    // worst case any future roster can produce is budget + MAX_ABILITY_RANGE.
    const state = createMatch(map, '1v1', [[characters[0]!], [characters[1]!]]);
    const worstCase = movementBudget(state.units[0]!, false) + MAX_ABILITY_RANGE;
    for (const { map: m, formats } of MAPS) {
      for (const format of formats) {
        expect(minSpawnSeparation(m, format), `${m.id} @ ${format} must survive any cap-legal roster`).toBeGreaterThan(worstCase);
      }
    }
  });
});

describe('validators catch bad content', () => {
  it('rejects a character with a wrong ability count', () => {
    const bad = { ...(vex as unknown as CharacterDef), abilities: [] };
    expect(validateCharacter(bad).length).toBeGreaterThan(0);
  });

  it('rejects an unknown effect kind', () => {
    const c = structuredClone(vex) as unknown as CharacterDef;
    (c.abilities[0]!.effects[0] as { kind: string }).kind = 'summon_dragon';
    expect(validateCharacter(c).some((e) => e.includes('unknown effect kind'))).toBe(true);
  });

  it('rejects out-of-bounds map content', () => {
    const m = structuredClone(duelArena) as unknown as MapDef;
    m.walls.push({ x: 999, y: 0 });
    expect(validateMap(m).some((e) => e.includes('out of bounds'))).toBe(true);
  });

  it('rejects a chargeHits value other than "first"/"all" (R1b)', () => {
    const c = structuredClone(kestrel) as unknown as CharacterDef;
    (c.ultimate as { chargeHits?: string }).chargeHits = 'some';
    expect(validateCharacter(c).some((e) => e.includes('chargeHits must be'))).toBe(true);
  });

  it('rejects chargeHits on a non-path ability (R1b)', () => {
    const c = structuredClone(vex) as unknown as CharacterDef;
    const line = c.abilities.find((a) => a.shape === 'line')!;
    (line as { chargeHits?: string }).chargeHits = 'all';
    expect(validateCharacter(c).some((e) => e.includes('only valid on a "path"'))).toBe(true);
  });
});

describe('non-ultimate range is capped at 8 (M2)', () => {
  it('rejects a non-ultimate ability above the cap but exempts the ultimate', () => {
    const over = structuredClone(vex) as unknown as CharacterDef;
    over.abilities[0]!.range = MAX_ABILITY_RANGE + 1;
    expect(validateCharacter(over).some((e) => e.includes('non-ultimate range must be'))).toBe(true);

    // Lance of Dawn is range 99 by design — the shipped roster must stay valid.
    expect((vex as unknown as CharacterDef).ultimate.range).toBeGreaterThan(MAX_ABILITY_RANGE);
    expect(validateCharacter(vex as unknown as CharacterDef)).toEqual([]);
  });

  it('accepts a non-ultimate exactly at the cap (Rail Shot stays 8)', () => {
    const at = structuredClone(vex) as unknown as CharacterDef;
    at.abilities[0]!.range = MAX_ABILITY_RANGE;
    expect(validateCharacter(at)).toEqual([]);
  });

  it('every shipped non-ultimate ability is within the cap', () => {
    for (const c of characters) {
      for (const a of c.abilities) {
        expect(a.range, `${c.id}.${a.id} range`).toBeLessThanOrEqual(MAX_ABILITY_RANGE);
      }
    }
  });
});

describe('effect polarity table is total (R7)', () => {
  it('every EFFECT_KIND appears in exactly one polarity row', () => {
    for (const kind of EFFECT_KINDS) {
      const rows = [HARMFUL_KINDS, BENEFICIAL_KINDS, NEUTRAL_KINDS].filter((s) => s.has(kind)).length;
      expect(rows, `${kind} must be in exactly one polarity row`).toBe(1);
    }
  });

  it('the three rows cover EFFECT_KINDS with no extras', () => {
    expect(HARMFUL_KINDS.size + BENEFICIAL_KINDS.size + NEUTRAL_KINDS.size).toBe(EFFECT_KINDS.length);
  });
});
