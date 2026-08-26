import { describe, expect, it } from 'vitest';
import provingFloor from '../../../data/themes/proving-floor.json' with { type: 'json' };
import drainedWorks from '../../../data/themes/drained-works.json' with { type: 'json' };
import {
  TERRAIN_VALUE_CEILING, budgetViolations, hexesIn, luminance, paletteViolations, parseHex,
  type TerrainAlbedo,
} from '../src/value-budget.js';

const THEMES: [string, TerrainAlbedo][] = [
  ['proving-floor', provingFloor.terrain as TerrainAlbedo],
  ['drained-works', drainedWorks.terrain as TerrainAlbedo],
];

describe('VALUE-BUDGET — terrain does not own the top of the range', () => {
  it.each(THEMES)('VALUE-BUDGET-%s: no terrain surface breaks the ceiling', (_id, terrain) => {
    expect(budgetViolations(terrain)).toEqual([]);
  });

  /**
   * The regression this whole module exists for. Proving Floor shipped `wall` at
   * 213 and `open` at 172 — the two least important surfaces in the game sitting
   * at the very top of the histogram, above every unit on the board.
   */
  it('VALUE-BUDGET-REGRESSION: the values that caused it would now fail', () => {
    const before = { open: '#b0aca4', wall: '#d8d5cd', cover: '#78736a', brush: '#54613f' };
    const broken = budgetViolations(before);
    expect(broken.map((v) => v.surface)).toEqual(['wall']);
    expect(broken[0]!.luminance).toBeCloseTo(213.1, 1);
  });

  it('VALUE-BUDGET-HEADROOM: the bright theme leaves real room above its floor', () => {
    const open = luminance(provingFloor.terrain.open)!;
    // Units, VFX and impacts get the rest. Before this it was ~83, and the top
    // 40 of those were already spent on the walls.
    expect(255 - open).toBeGreaterThan(100);
  });

  it('VALUE-BUDGET-STILL-THE-BRIGHT-THEME: Proving Floor stays far above Drained Works', () => {
    expect(luminance(provingFloor.terrain.open)!)
      .toBeGreaterThan(luminance(drainedWorks.terrain.open)! + 90);
  });

  /**
   * The theme note's other promise: terrain gives up chroma so the UI can own
   * saturated hues. Lowering the value must not have taken a shortcut that
   * changed the hue — the new hexes are the old ones scaled, nothing else.
   */
  it('VALUE-BUDGET-HUE-PRESERVED: the drop scaled the value and left the colour alone', () => {
    const pairs: [string, string][] = [
      ['#b0aca4', provingFloor.terrain.open],
      ['#d8d5cd', provingFloor.terrain.wall],
    ];
    for (const [before, after] of pairs) {
      const a = parseHex(before)!, b = parseHex(after)!;
      // Same channel ordering, and the same ratios between them to within a byte.
      const ka = a.r / a.b, kb = b.r / b.b;
      expect(kb).toBeCloseTo(ka, 2);
      expect(a.g / a.b).toBeCloseTo(b.g / b.b, 2);
    }
  });

  it('VALUE-BUDGET-CEILING-CLEARS-THE-DARK-THEME: it constrains taste in one direction only', () => {
    // A ceiling that forced Drained Works to move would not be describing
    // brightness any more.
    const brightest = Math.max(...Object.values(drainedWorks.terrain).map((h) => luminance(h)!));
    expect(brightest).toBeLessThan(TERRAIN_VALUE_CEILING);
  });

  it('VALUE-BUDGET-PARSE: rejects anything that is not a #rrggbb', () => {
    expect(parseHex('#b0aca4')).toEqual({ r: 176, g: 172, b: 164 });
    expect(parseHex('b0aca4')).toBeUndefined();
    expect(parseHex('#b0ac')).toBeUndefined();
    expect(parseHex('#gggggg')).toBeUndefined();
    expect(luminance('nope')).toBeUndefined();
  });

  it('VALUE-BUDGET-VIOLATIONS-SORTED: worst first, and it names the number', () => {
    const v = budgetViolations({ open: '#ffffff', wall: '#e0e0e0', cover: '#000000', brush: '#000000' });
    expect(v.map((e) => e.surface)).toEqual(['open', 'wall']);
    expect(v[0]!.luminance).toBeCloseTo(255, 0);
  });
});

describe('VALUE-BUDGET — props are painted world too', () => {
  it('VALUE-BUDGET-PROPS: no prop palette entry breaks the ceiling', async () => {
    const props = (await import('../../../data/props/proving-floor.json', { with: { type: 'json' } })).default;
    expect(paletteViolations(props)).toEqual([]);
  });

  /**
   * The regression that generalised the rule. Terrain came down and the frame
   * did not move: p95 and p99 stayed at exactly 185.4 while `wall` went 176 →
   * 182, because the plateau was 19,508 pixels of prop `shaft` at `#d8d5cd` —
   * the old wall colour, copied and never re-derived.
   */
  it('VALUE-BUDGET-PROPS-REGRESSION: the copied wall colour would now fail', () => {
    const before = { props: { wall: { palette: { shaft: '#d8d5cd', capital: '#cbc7bf', plinth: '#b7b3aa' } } } };
    const broken = paletteViolations(before);
    expect(broken.map((v) => v.surface)).toEqual([
      'props.wall.palette.shaft', 'props.wall.palette.capital',
    ]);
    expect(broken[0]!.luminance).toBeCloseTo(213.1, 1);
  });

  it('VALUE-BUDGET-WALKS-NESTED: a hex anywhere in the structure is found', () => {
    expect(hexesIn({ a: { b: ['#ffffff', 'not a hex', 3] } })).toEqual([{ path: 'a.b[0]', hex: '#ffffff' }]);
    expect(hexesIn({})).toEqual([]);
  });
});
