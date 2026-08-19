import { describe, expect, it } from 'vitest';
import { validateCharacter, validateMap } from '../src/validate.js';
import { buildCatalystPool, type CatalystData } from '../src/catalysts.js';
import { BENEFICIAL_KINDS, HARMFUL_KINDS, NEUTRAL_KINDS } from '../src/resolve.js';
import { DASH_RANGE_FLOOR, MAX_ABILITY_RANGE } from '../src/constants.js';
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
import catalystData from '../../../data/catalysts.json';
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

    it(`${m.id} mirrors its power-up pads, type included (PADS1)`, () => {
      // A pad whose mirror is a different flavour — or missing — hands one team
      // a resource the other cannot answer, which is the one thing a symmetric
      // map exists to prevent. Placement here is a Builder placeholder; the
      // Designer tunes the squares and the timings, and this guard survives it.
      const mirror = (x: number) => m.width - 1 - x;
      const pads = m.powerups ?? [];
      expect(pads.length, `${m.id} should ship pads`).toBeGreaterThan(0);
      const byPos = new Map(pads.map((p) => [`${p.x},${p.y}`, p]));
      for (const pad of pads) {
        const twin = byPos.get(`${mirror(pad.x)},${pad.y}`);
        expect(twin, `${m.id} pad at (${pad.x},${pad.y}) lacks its mirror`).toBeDefined();
        expect(twin?.type, `${m.id} pad at (${pad.x},${pad.y}) mirrors a different type`).toBe(pad.type);
        expect(twin?.firstTurn).toBe(pad.firstTurn);
        expect(twin?.everyTurns).toBe(pad.everyTurns);
      }
    });

    it(`${m.id} runs the owner's pad schedule (PADS-SCHEDULE)`, () => {
      // Owner Dev Notes #5/#6: "Regular power-ups began appearing on turn 4,
      // while Might power-ups spawned earlier on turn 2 … Respawn Timer: 4
      // turns." The early Might spawn is what makes it *the* turn-2 rush — both
      // teams reach for it while the opening is still about position.
      for (const pad of m.powerups ?? []) {
        const where = `${m.id} ${pad.type} pad at (${pad.x},${pad.y})`;
        expect(pad.everyTurns, `${where}: respawn is four turns`).toBe(4);
        expect(pad.firstTurn, `${where}: first spawn`).toBe(pad.type === 'might' ? 2 : 4);
      }
    });

    it(`${m.id} spreads its power-up pads — none touch (PADS-SPREAD)`, () => {
      // Two pads side by side are one prize worth double, taken by a unit that
      // stands between them or — since PADS-PASS — merely walks past. The
      // detour a pad is supposed to cost disappears. Atlas Reactor places its
      // power-ups singly and far apart; this is the floor of that shape.
      const pads = m.powerups ?? [];
      for (const [i, a] of pads.entries()) {
        for (const b of pads.slice(i + 1)) {
          const gap = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
          expect(gap, `${m.id}: pads (${a.x},${a.y}) and (${b.x},${b.y}) touch`).toBeGreaterThan(1);
        }
      }
    });

    it(`${m.id} keeps every pad out of the camera's shadow (SHADOW-ROW)`, () => {
      // A pad is a flat mark on the floor and the board is drawn from a pitched
      // camera, so a raised block hides the ground one row *behind* it — the
      // square at `y - 1`, north of the block. duel-arena shipped its Health
      // pads at `y = 3`, immediately north of the wall line at `y = 4`, and they
      // composited **zero** pixels: a contested prize nobody could see (Builder
      // OQ 2026-09-08 #1). The pads were moved in data; this is the guard that
      // was owed with the move.
      //
      // Stated as a property of the *map* rather than of the renderer because
      // the alternative lever was rejected — drawing a pad over the block that
      // occludes it would be a mark that lies about where it is. Placement is
      // the Designer's, and this is the rule placement has to satisfy.
      expect(padsInShadow(m)).toEqual([]);
    });

    it(`${m.id} keeps its terrain runs under the caps (MAP-CAPS)`, () => {
      for (const [kind, cap] of Object.entries(TERRAIN_RUN_CAPS) as [TerrainKey, number][]) {
        for (const [axis, run] of Object.entries(longestRuns(m, kind))) {
          expect(run, `${m.id}: ${kind} run of ${run} along a ${axis} (cap ${cap})`)
            .toBeLessThanOrEqual(cap);
        }
      }
    });
  }
});

/**
 * MAP-CAPS — the longest unbroken run of one terrain along any row and any
 * column (ar-parity §5).
 *
 * The caps exist because a long unbroken run stops being cover and starts being
 * a wall: a 6-square brush strip is not concealment you contest, it is a
 * corridor you cannot see down, and a 7-square wall is a lane with no counterplay.
 * Both shipped maps were re-cut to satisfy them; this is the guard that keeps the
 * next map honest, and it is checked on **both orientations** because a vertical
 * corridor plays exactly like a horizontal one.
 */
const TERRAIN_RUN_CAPS = { brush: 3, cover: 4, walls: 5 } as const;
type TerrainKey = keyof typeof TERRAIN_RUN_CAPS;

export function longestRuns(m: MapDef, kind: TerrainKey): { row: number; column: number } {
  const present = new Set(m[kind].map((p) => `${p.x},${p.y}`));
  const scan = (outer: number, inner: number, at: (a: number, b: number) => string): number => {
    let longest = 0;
    for (let a = 0; a < outer; a++) {
      let run = 0;
      for (let b = 0; b < inner; b++) {
        run = present.has(at(a, b)) ? run + 1 : 0;
        if (run > longest) longest = run;
      }
    }
    return longest;
  };
  return {
    row: scan(m.height, m.width, (y, x) => `${x},${y}`),
    column: scan(m.width, m.height, (x, y) => `${x},${y}`),
  };
}

/**
 * SHADOW-ROW — pads whose south neighbour is a raised block, and which the
 * camera therefore hides.
 *
 * Returns the offenders rather than a boolean so a failure names the pad and the
 * block that swallowed it; a bare `false` on a map with six pads is a bug report
 * you then have to go and write yourself.
 */
function padsInShadow(m: MapDef): string[] {
  const blocked = new Set([...m.walls, ...m.cover].map((p) => `${p.x},${p.y}`));
  return (m.powerups ?? [])
    .filter((pad) => blocked.has(`${pad.x},${pad.y + 1}`))
    .map((pad) => `${pad.type} pad (${pad.x},${pad.y}) behind the block at (${pad.x},${pad.y + 1})`);
}

describe('SHADOW-ROW: the shadow guard actually catches a bad map', () => {
  // A guard on the guard, for the same reason MAP-CAPS has one: both shipped
  // maps pass, so the assertion above could be vacuous and nobody would find out
  // until a map shipped an invisible pad again.
  const withBlockAt = (kind: 'walls' | 'cover', at: { x: number; y: number }): MapDef => ({
    id: 'bad', name: 'bad', width: 12, height: 12, walls: [], cover: [], brush: [],
    spawns: [[{ x: 0, y: 0 }], [{ x: 11, y: 0 }]],
    powerups: [{ x: 5, y: 5, type: 'might', firstTurn: 2, everyTurns: 4 }],
    [kind]: [at],
  } as MapDef);

  it('catches a pad tucked north of a WALL', () => {
    expect(padsInShadow(withBlockAt('walls', { x: 5, y: 6 }))).toHaveLength(1);
  });

  it('catches a pad tucked north of COVER — same silhouette, same shadow', () => {
    expect(padsInShadow(withBlockAt('cover', { x: 5, y: 6 }))).toHaveLength(1);
  });

  it('and names the pad it caught, so a failure reads as a bug report', () => {
    expect(padsInShadow(withBlockAt('walls', { x: 5, y: 6 }))[0]).toContain('(5,5)');
  });

  it('the block has to be directly SOUTH — the shadow falls one way', () => {
    // North, east and west of a pad are all fine: the camera looks down the
    // +y axis, so only the row below a pad can stand in front of it.
    for (const at of [{ x: 5, y: 4 }, { x: 4, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 7 }]) {
      expect(padsInShadow(withBlockAt('walls', at)), `block at (${at.x},${at.y})`).toEqual([]);
    }
  });

  it('a map with no pads at all is not a violation', () => {
    expect(padsInShadow({ ...withBlockAt('walls', { x: 5, y: 6 }), powerups: [] })).toEqual([]);
  });
});

describe('MAP-CAPS: the run-cap guard actually catches a bad map', () => {
  // A guard on the guard. Both shipped maps pass, so without a deliberately
  // over-long map here the assertions above could be vacuously true and nobody
  // would find out until a future map shipped a 6-square brush corridor.
  const strip = (kind: TerrainKey, n: number, vertical = false): MapDef => ({
    id: 'bad', name: 'bad', width: 12, height: 12, walls: [], cover: [], brush: [],
    spawns: [[{ x: 0, y: 0 }], [{ x: 11, y: 0 }]],
    [kind]: Array.from({ length: n }, (_, i) => (vertical ? { x: 4, y: 2 + i } : { x: 2 + i, y: 4 })),
  } as MapDef);

  for (const [kind, cap] of Object.entries(TERRAIN_RUN_CAPS) as [TerrainKey, number][]) {
    it(`${kind}: a run of ${cap} is fine and ${cap + 1} is not, in a row`, () => {
      expect(longestRuns(strip(kind, cap), kind).row).toBe(cap);
      expect(longestRuns(strip(kind, cap + 1), kind).row).toBeGreaterThan(cap);
    });

    it(`${kind}: the same holds down a column`, () => {
      expect(longestRuns(strip(kind, cap + 1, true), kind).column).toBeGreaterThan(cap);
      // …and a vertical strip must not be mistaken for a long row.
      expect(longestRuns(strip(kind, cap + 1, true), kind).row).toBe(1);
    });
  }

  it('counts a run as broken by a gap, not merely by the row ending', () => {
    const gapped: MapDef = {
      id: 'g', name: 'g', width: 12, height: 3, walls: [], cover: [],
      spawns: [[{ x: 0, y: 0 }], [{ x: 11, y: 0 }]],
      brush: [0, 1, 2, 4, 5, 6].map((x) => ({ x, y: 1 })),
    };
    expect(longestRuns(gapped, 'brush').row).toBe(3);
  });
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

describe('DASH-FLOOR-GUARD: a dash moves you further than a walk does', () => {
  /**
   * Dev Note #20, ruled in edge-cases: **every Dash-phase reposition is range 4
   * or more**. A dash shorter than the move budget is not a mobility tool, it is
   * a turn spent going nowhere, and the five shipped ones already sit on the
   * floor — this is here so the sixth cannot quietly undercut it.
   *
   * Abilities *and* catalysts, because Shift is a catalyst and a floor with a
   * hole in it is not a floor.
   *
   * "Reposition" is narrower than "Dash-phase": the engine moves a dasher when
   * the shape is a `path` it walks or a `square` it blinks to, and Fade,
   * Unshackle and Fetter are Dash-phase catalysts that move nobody — a range-0
   * `self` buff has no travel to put a floor under.
   */
  const REPOSITIONS = (a: { shape: string; effects: readonly { kind: string }[] }): boolean =>
    a.shape === 'path' || a.shape === 'square' || a.effects.some((e) => e.kind === 'teleport');
  const dashes: { where: string; range: number }[] = [
    ...characters.flatMap((c) => [...c.abilities, c.ultimate]
      .filter((a) => a.phase === 'dash' && REPOSITIONS(a))
      .map((a) => ({ where: `${c.id}.${a.id}`, range: a.range }))),
    ...Object.values(buildCatalystPool(catalystData as unknown as CatalystData))
      .filter((a) => a.phase === 'dash' && REPOSITIONS(a))
      .map((a) => ({ where: `catalyst.${a.id}`, range: a.range })),
  ];

  it('finds the repositions rather than an empty list', () => {
    // A guard that iterates nothing passes forever. The owner's ruling names
    // five, so five is the floor on the guard as well as on the content.
    expect(dashes.length).toBeGreaterThanOrEqual(5);
  });

  it('every one of them is at least the floor', () => {
    for (const { where, range } of dashes) {
      expect(range, `${where} is a dash reposition below the floor`)
        .toBeGreaterThanOrEqual(DASH_RANGE_FLOOR);
    }
  });

  it('and the guard would actually catch one that was not', () => {
    // The check on the check: a floor nobody can demonstrate failing is a
    // comment. A hand-built entry one square short must trip the assertion.
    const short = [...dashes, { where: 'invented.shuffle', range: DASH_RANGE_FLOOR - 1 }];
    expect(short.every((d) => d.range >= DASH_RANGE_FLOOR)).toBe(false);
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
