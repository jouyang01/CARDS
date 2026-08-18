import { describe, expect, it } from 'vitest';
import { coneSquares } from '../src/shapes.js';
import { validateAbility } from '../src/validate.js';
import { makeMap } from './helpers.js';
import { buildBoard } from '../src/board.js';
import type { AbilityDef, CharacterDef, Vec2 } from '../src/types.js';
import aegis from '../../../data/characters/aegis.json';

/**
 * BASIC-BEAM — a cone that keeps one width instead of fanning out.
 *
 * The Designer unblocked this by settling the two things the Builder stopped
 * on (`clashes-and-basics.md` §3.4):
 *
 * - **`beamWidth` is the TOTAL width in tiles, and must be odd.** A designer
 *   writing `3` gets a 3-wide lane, not a 7-wide one — a number in `data/`
 *   means the footprint you get. Even has no centre axis to rotate around and
 *   is a validation error rather than a rounding.
 * - **Aegis's Shield Bash is `beamWidth: 3`, `range: 2`, damage 20** — a
 *   3-wide × 2-deep wall of force: **6 tiles** against the cone's 8. The tower
 *   shield's face, broad and short, rather than the 1×2 spear the earlier
 *   phrasing implied.
 *
 * No new geometry: the wedge already measures every tile's perpendicular offset
 * to decide coverage, and a beam compares that same integer against a constant
 * instead of against the depth.
 */

const OPEN = makeMap(Array.from({ length: 21 }, () => '.'.repeat(21)));
const BOARD = buildBoard(OPEN);
const FROM: Vec2 = { x: 10, y: 10 };
const key = (p: Vec2) => `${p.x},${p.y}`;
const sorted = (ps: readonly Vec2[]) => ps.map(key).sort();

const ability = (over: Partial<AbilityDef>): AbilityDef => ({
  id: 'beam', name: 'Beam', phase: 'blast', shape: 'cone', range: 2, cooldown: 0,
  energyGain: 0, effects: [{ kind: 'damage', amount: 10 }], description: 'beam', ...over,
});

describe('BASIC-BEAM: the lane is a constant width', () => {
  it('beamWidth 3 at range 2, fired east, is exactly the 6 tiles the Designer priced', () => {
    // The acceptance criterion, verbatim: "the axis-aligned footprint is exactly
    // 6 tiles". Three across, two deep, and the caster's own square excluded.
    const tiles = coneSquares(BOARD, FROM, { x: 1, y: 0 }, 2, 3);
    expect(sorted(tiles)).toEqual(sorted([
      { x: 11, y: 9 }, { x: 11, y: 10 }, { x: 11, y: 11 },
      { x: 12, y: 9 }, { x: 12, y: 10 }, { x: 12, y: 11 },
    ]));
  });

  it('and the cone it replaces covered 8 — the shape gained identity, not area', () => {
    const cone = coneSquares(BOARD, FROM, { x: 1, y: 0 }, 2);
    const beam = coneSquares(BOARD, FROM, { x: 1, y: 0 }, 2, 3);
    expect(cone).toHaveLength(8);
    expect(beam).toHaveLength(6);
    // The tiles it loses are the diagonal splash at depth 2, which is the whole
    // difference between a fan and a wall.
    const lost = sorted(cone).filter((k) => !sorted(beam).includes(k));
    expect(lost).toEqual(['12,12', '12,8']);
  });

  it('the width does NOT grow with depth — that is the entire point', () => {
    // CONE-B's ramp is `halfWidth(d) = d`; a beam's is a constant. At range 5 a
    // cone is 5 wide at its cap and a 3-beam is still 3.
    const beam = coneSquares(BOARD, FROM, { x: 1, y: 0 }, 5, 3);
    for (const depth of [1, 2, 3, 4, 5]) {
      const row = beam.filter((p) => p.x === FROM.x + depth);
      expect(row, `depth ${depth}`).toHaveLength(3);
    }
    expect(beam).toHaveLength(15);
  });

  it('a wider odd lane is wider by exactly that much', () => {
    const five = coneSquares(BOARD, FROM, { x: 1, y: 0 }, 2, 5);
    expect(five, '5 across, 2 deep').toHaveLength(10);
    // The Designer's own playtest lever, priced: 3 → 5 is 6 → 10 tiles.
    expect(five.filter((p) => p.x === 11).map((p) => p.y).sort((a, b) => a - b))
      .toEqual([8, 9, 10, 11, 12]);
  });

  it('beamWidth 1 is a single file — the degenerate case is still a lane', () => {
    const one = coneSquares(BOARD, FROM, { x: 1, y: 0 }, 3, 1);
    expect(sorted(one)).toEqual(sorted([
      { x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 },
    ]));
  });

  it('an axis tile and an edge tile are both covered; one outside the width is not', () => {
    const beam = coneSquares(BOARD, FROM, { x: 1, y: 0 }, 2, 3);
    const keys = sorted(beam);
    expect(keys, 'the axis, at range').toContain('12,10');
    expect(keys, 'the edge of the lane, at range').toContain('12,11');
    expect(keys, 'one tile beyond the half-width').not.toContain('12,12');
  });

  it('nothing behind or level with the caster, whatever the width', () => {
    const beam = coneSquares(BOARD, FROM, { x: 1, y: 0 }, 3, 5);
    for (const p of beam) expect(p.x, `${key(p)} is not in front`).toBeGreaterThan(FROM.x);
  });
});

describe('BASIC-BEAM: rotation keeps the footprint', () => {
  it('every cardinal covers the same 6 tiles, reflected', () => {
    for (const dir of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      expect(coneSquares(BOARD, FROM, dir, 2, 3), `${dir.x},${dir.y}`).toHaveLength(6);
    }
  });

  it('and a quantized rotation lands within ±1 — the acceptance bound', () => {
    // The Designer's own tolerance. A grid cannot hold an exact area through an
    // arbitrary angle; what it can promise is that the lane does not swell or
    // collapse as it turns.
    const sizes: number[] = [];
    for (let step = 0; step < 512; step += 8) {
      const t = (step * Math.PI * 2) / 512;
      // An integer direction from the quantization diamond, built without trig
      // in the engine — this test may use it to *choose* a direction.
      const dir = { x: Math.round(Math.cos(t) * 128), y: Math.round(Math.sin(t) * 128) };
      if (dir.x === 0 && dir.y === 0) continue;
      sizes.push(coneSquares(BOARD, FROM, dir, 2, 3).length);
    }
    expect(Math.min(...sizes), 'never collapses').toBeGreaterThanOrEqual(5);
    expect(Math.max(...sizes), 'never swells').toBeLessThanOrEqual(7);
  });

  it('the beam is deterministic — the same aim gives the same tiles every time', () => {
    const once = coneSquares(BOARD, FROM, { x: 3, y: 1 }, 3, 3);
    const twice = coneSquares(BOARD, FROM, { x: 3, y: 1 }, 3, 3);
    expect(JSON.stringify(once)).toEqual(JSON.stringify(twice));
  });
});

describe('BASIC-BEAM: what the validator refuses', () => {
  it('an EVEN width — an even lane has no centre axis', () => {
    const errs = validateAbility(ability({ beamWidth: 2 }), 'x');
    expect(errs.join(' ')).toMatch(/beamWidth must be ODD/);
  });

  it('and says which number it got, so the fix is obvious', () => {
    expect(validateAbility(ability({ beamWidth: 4 }), 'x').join(' ')).toContain('got 4');
  });

  it('a width below 1, and a non-integer', () => {
    expect(validateAbility(ability({ beamWidth: 0 }), 'x').join(' ')).toMatch(/integer >= 1/);
    expect(validateAbility(ability({ beamWidth: 3.5 }), 'x').join(' ')).toMatch(/integer >= 1/);
  });

  it('the field on any shape but a cone', () => {
    const errs = validateAbility(ability({ shape: 'circle', radius: 2, beamWidth: 3 }), 'x');
    expect(errs.join(' ')).toMatch(/only meaningful on a cone/);
  });

  it('and accepts every odd width on a cone', () => {
    for (const width of [1, 3, 5, 7]) {
      expect(validateAbility(ability({ beamWidth: width }), 'x'), `beamWidth ${width}`).toEqual([]);
    }
  });
});

describe('BASIC-BEAM: Aegis carries it', () => {
  const AEGIS = aegis as unknown as CharacterDef;
  const bash = AEGIS.abilities.find((a) => a.id === 'shield_bash')!;

  it('Shield Bash is beamWidth 3, range 2, damage 20 — the ruled numbers', () => {
    expect(bash.beamWidth).toBe(3);
    expect(bash.range).toBe(2);
    expect(bash.effects.find((e) => e.kind === 'damage')?.amount, 'damage stays 20').toBe(20);
  });

  it('and keeps `melee: true` — the acceptance says so explicitly', () => {
    expect(bash.melee).toBe(true);
  });

  it('its footprint is the 6-tile wall, from the data rather than a constant', () => {
    const tiles = coneSquares(BOARD, FROM, { x: 1, y: 0 }, bash.range, bash.beamWidth);
    expect(tiles).toHaveLength(6);
  });

  it('the whole roster still validates with the new field in it', () => {
    for (const a of [...AEGIS.abilities, AEGIS.ultimate]) {
      expect(validateAbility(a, a.id), a.id).toEqual([]);
    }
  });
});
