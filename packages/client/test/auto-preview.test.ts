import { describe, expect, it } from 'vitest';
import { createMatch, type CharacterDef, type GameState, type MapDef, type UnitState } from '@cards/engine';
import { abilityPreview, abilityTooltip, damageTell, previewBands } from '../src/targeting.js';
import lumen from '../../../data/characters/lumen.json';
import thorn from '../../../data/characters/thorn.json';
import ravok from '../../../data/characters/ravok.json';
import bastion from '../../../data/characters/bastion.json';
import cinder from '../../../data/characters/cinder.json';
import vex from '../../../data/characters/vex.json';

/**
 * AUTO-PREVIEW — the reworked basics, as a player sees them before committing.
 *
 * Owner Dev Note: *"new auto attacks need new visual indicators in preview and
 * numerical descriptions for the damage differences."*
 *
 * BASICS-UNIQUE gave five characters distinct autos and the preview said nothing
 * about it. Two halves were missing, and they are different problems:
 *
 * 1. **Footprint.** Three of the five changed *shape* — a lobbed circle, a
 *    self-centred whirl, a line that also heals. `abilityPreview` is
 *    `expandShape`, so those were already right the moment the data changed;
 *    this file pins them so a regression in the shared path is caught per kit.
 * 2. **Interior.** Two changed what happens *inside* the same footprint — an
 *    axis bonus (BASIC-AXIS) and a core/ring split (BASIC-INNER) — and the aim
 *    overlay draws those tiles identically to their neighbours. `previewBands`
 *    is the second layer, and it is the engine's own `axisSquares`/
 *    `innerSquares` rather than a client guess at which tiles look central.
 *
 * The numeric tell is the part no colour can carry: Lumen's damage and heal
 * cover the *same* tiles (FF1 picks targets by team, not by square), so the only
 * honest way to show the difference is to write the two numbers down.
 */

const CHARS = {
  lumen: lumen as unknown as CharacterDef,
  thorn: thorn as unknown as CharacterDef,
  ravok: ravok as unknown as CharacterDef,
  bastion: bastion as unknown as CharacterDef,
  cinder: cinder as unknown as CharacterDef,
  vex: vex as unknown as CharacterDef,
};
const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 10 }], [{ x: 18, y: 10 }]],
};

const auto = (c: CharacterDef) => c.abilities[0]!;
/** The character at the centre of an otherwise empty board. */
const actor = (c: CharacterDef): { s: GameState; u: UnitState } => {
  const s = createMatch(OPEN, '1v1', [[c], [CHARS.vex]]);
  const u = s.units.find((x) => x.characterId === c.id)!;
  u.pos = { x: 10, y: 10 };
  return { s, u };
};
const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
/** Aimed four east, which is inside every one of these autos' ranges. */
const EAST = [{ x: 14, y: 10 }];

describe('AUTO-PREVIEW: each reworked auto paints its real footprint', () => {
  it("Thorn's Barbed Sling previews the lobbed circle, not a line", () => {
    const { u } = actor(CHARS.thorn);
    const cells = abilityPreview(OPEN, u, auto(CHARS.thorn), EAST);
    // A circle around the aimed square: the centre plus its four orthogonals.
    expect(cells.map(key)).toContain(key(EAST[0]!));
    expect(cells.map(key)).toContain('13,10');
    expect(cells.map(key)).toContain('14,9');
    expect(cells.length, 'a disc, not a beam').toBeGreaterThan(1);
  });

  it("Ravok's Whirling Cleave previews a ring around ITSELF", () => {
    // A self-centred circle: the aim is ignored, so the footprint has to sit on
    // the caster whatever the pointer is doing.
    const { u } = actor(CHARS.ravok);
    const cells = abilityPreview(OPEN, u, auto(CHARS.ravok), [{ x: u.pos.x, y: u.pos.y }]).map(key);
    expect(cells).toContain(key(u.pos));
    expect(cells).toContain('11,10');
    expect(cells).toContain('10,11');
    expect(cells, 'nowhere near the pointer').not.toContain('14,10');
  });

  it("Lumen's Radiant Lash previews a line — and the heal shares its tiles", () => {
    // The case a colour cannot carry. FF1 picks each effect's targets by team,
    // not by square, so there is no "heal half" of the footprint to paint.
    const { u } = actor(CHARS.lumen);
    const cells = abilityPreview(OPEN, u, auto(CHARS.lumen), EAST);
    expect(cells.length).toBeGreaterThan(1);
    expect(new Set(cells.map((c) => c.y)).size, 'a straight beam along one row').toBe(1);
    expect(previewBands(OPEN, u, auto(CHARS.lumen), EAST), 'nothing hits harder inside it').toEqual([]);
  });
});

describe('AUTO-PREVIEW: the tiles that hit harder get their own band', () => {
  it("Bastion's Crushing Slam marks the cone's axis", () => {
    const { u } = actor(CHARS.bastion);
    const slam = auto(CHARS.bastion);
    const covered = abilityPreview(OPEN, u, slam, EAST).map(key);
    const band = previewBands(OPEN, u, slam, EAST).map(key);

    expect(band.length, 'the axis is marked at all').toBeGreaterThan(0);
    expect(band.length, 'and it is a subset, not the whole wedge').toBeLessThan(covered.length);
    for (const cell of band) expect(covered, `${cell} is inside the aim`).toContain(cell);
    // The axis of an eastward cone runs along the caster's own row.
    for (const cell of previewBands(OPEN, u, slam, EAST)) expect(cell.y).toBe(u.pos.y);
  });

  it("Cinder's Ember Bolt marks the core inside the ring", () => {
    const { u } = actor(CHARS.cinder);
    const bolt = auto(CHARS.cinder);
    const covered = abilityPreview(OPEN, u, bolt, EAST).map(key);
    const band = previewBands(OPEN, u, bolt, EAST).map(key);

    expect(band, 'the aimed square is the core').toEqual([key(EAST[0]!)]);
    expect(covered.length, 'and the ring around it is still covered').toBeGreaterThan(band.length);
    expect(covered).toContain('13,10');
  });

  it('an ability with neither knob gets no band — the layer costs nothing', () => {
    const { u } = actor(CHARS.vex);
    expect(previewBands(OPEN, u, auto(CHARS.vex), EAST)).toEqual([]);
  });

  it('the band is engine geometry, never a client guess', () => {
    // The property that keeps the drawn band and the paid band identical: every
    // tile in it is one the aim already covers, for every auto, at every aim.
    for (const c of [CHARS.bastion, CHARS.cinder, CHARS.thorn, CHARS.ravok, CHARS.lumen]) {
      const { u } = actor(c);
      for (const target of [EAST, [{ x: 10, y: 14 }], [{ x: 7, y: 7 }]]) {
        const covered = new Set(abilityPreview(OPEN, u, auto(c), target).map(key));
        for (const cell of previewBands(OPEN, u, auto(c), target)) {
          expect(covered.has(key(cell)), `${c.id}: ${key(cell)} outside its own aim`).toBe(true);
        }
      }
    }
  });
});

describe('AUTO-PREVIEW: the numeric tell says where the numbers differ', () => {
  it("Lumen: the damage and the heal, because the tiles cannot say it", () => {
    expect(damageTell(auto(CHARS.lumen))).toBe('14 dmg · +12 heal to allies');
  });

  it("Bastion: the wedge's number and the axis bonus on top", () => {
    expect(damageTell(auto(CHARS.bastion))).toBe('24 dmg · +8 on the axis');
  });

  it("Cinder: a core/ring split, not a base with an exception", () => {
    // BASIC-INNER *replaces* rather than adds, and the wording follows the rule
    // — "22 core / 14 ring" is what a player reads off the board.
    expect(damageTell(auto(CHARS.cinder))).toBe('22 core / 14 ring');
  });

  it('Thorn and Ravok: one number each, because there is one number', () => {
    expect(damageTell(auto(CHARS.thorn))).toBe('15 dmg');
    expect(damageTell(auto(CHARS.ravok))).toBe('22 dmg');
  });

  it('it is derived from the def, so a Designer edit needs no client change', () => {
    const edited = { ...auto(CHARS.cinder), innerAmount: 30 };
    expect(damageTell(edited)).toBe('30 core / 14 ring');
  });

  it('an ability with no damage at all says nothing rather than "0 dmg"', () => {
    const veil = CHARS.vex.abilities.find((a) => a.effects.every((e) => e.kind !== 'damage'));
    if (veil !== undefined) expect(damageTell(veil)).not.toMatch(/dmg/);
    expect(damageTell({ ...auto(CHARS.vex), effects: [] })).toBe('');
  });

  it('and the tooltip carries it, above the raw effect dump', () => {
    // The effect list cannot express these differences: they live on the
    // ability (`axisBonus`, `innerAmount`) rather than inside one effect.
    const lines = abilityTooltip(auto(CHARS.cinder));
    expect(lines.some((l) => l === '22 core / 14 ring')).toBe(true);
    expect(lines.indexOf('22 core / 14 ring')).toBeLessThan(lines.length - 1);
  });
});
