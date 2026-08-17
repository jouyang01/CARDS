import { describe, expect, it } from 'vitest';
import {
  ULT_COST,
  type CharacterDef, type GameState, type MapDef, type Roster, type StatusInstance,
  type TeamId, type UnitState,
} from '@cards/engine';
import { fogView } from '../src/fog.js';
import {
  ICON_GAP_PX, ICON_PX, NAME_GAP_PX, PLATE_PAD_PX, PLATE_PX, PLATE_PX_PER_UNIT,
  decoyCaster, decoyNameplate, nameplateKey, plateLayout, snapshotDecoy, ultReady, unitNameplate,
} from '../src/nameplates.js';
import { PIP_ORDER } from '../src/status-pips.js';
import vex from '../../../data/characters/vex.json';
import wisp from '../../../data/characters/wisp.json';

/**
 * UI-NAMEPLATES (ar-parity §4.1) — what floats above a unit's head.
 *
 * The tests split the way the code does. The *model* questions — does the ULT
 * tag light at the right number, does a decoy's lie hold, does the shield get
 * its own segment — are pure and pinned here. The *drawing* is `renderer3d`'s
 * and needs a WebGL context, so what is checked instead is the contract between
 * them: the cache key changes when and only when the plate's content does,
 * because a key that missed a change would freeze a stale HP bar on screen and
 * a key that changed too often would rasterise text on every pointer move.
 *
 * The vision gate is checked against `fogView` itself rather than re-derived: a
 * nameplate exists for exactly the units the board already decided to draw, and
 * the one thing this batch must never become is a better scout than the vision
 * rules allow.
 */

const VEX = vex as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const roster: Roster = { [VEX.id]: VEX, [WISP.id]: WISP };

/** An open board wide enough that six squares of sight does not cover it. */
const OPEN: MapDef = {
  id: 't', name: 't', width: 20, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }], [{ x: 18, y: 7 }]],
};

const unit = (id: string, owner: TeamId, x: number, y: number, characterId = VEX.id): UnitState => ({
  unitId: id, characterId, owner, pos: { x, y }, hp: 95, maxHp: 95, energy: 0,
  alive: true, respawnIn: 0, cooldowns: {}, statuses: [] as StatusInstance[],
  catalysts: [], catalystsUsed: [],
});

const makeState = (units: UnitState[]): GameState => ({
  turn: 1, units, traps: [], delayed: [], decoys: [], powerups: [], lastKnown: [],
  kills: [0, 0], format: '2v2', status: 'active', suddenDeath: false,
});

describe('UI-NAMEPLATES: what the plate says', () => {
  it('carries the character name, not the unit id', () => {
    // Player names arrive with M3; until then the character is the identity a
    // player actually recognises on the board.
    const plate = unitNameplate(unit('vex-t0-0', 0, 2, 2), roster, 0);
    expect(plate.name).toBe(VEX.name);
  });

  it('falls back to the character id rather than rendering blank', () => {
    const stranger = { ...unit('x-t0-0', 0, 2, 2), characterId: 'not-in-roster' };
    expect(unitNameplate(stranger, roster, 0).name).toBe('not-in-roster');
  });

  it('reports HP as a number and a maximum — the bar draws the numeral inside', () => {
    const hurt = { ...unit('vex-t0-0', 0, 2, 2), hp: 57 };
    expect(unitNameplate(hurt, roster, 0)).toMatchObject({ hp: 57, maxHp: 95 });
  });

  it('sums shields into one segment appended to the fill', () => {
    // Shields are spent before HP, so the bar reads left-to-right as the order
    // damage will eat it — one pool, one segment, however many casters.
    const shielded = {
      ...unit('vex-t0-0', 0, 2, 2),
      statuses: [
        { kind: 'shield' as const, remaining: 2, amount: 15 },
        { kind: 'shield' as const, remaining: 1, amount: 10 },
      ],
    };
    expect(unitNameplate(shielded, roster, 0).shield).toBe(25);
  });

  it('ignores an expired shield instance', () => {
    const stale = {
      ...unit('vex-t0-0', 0, 2, 2),
      statuses: [{ kind: 'shield' as const, remaining: 0, amount: 40 }],
    };
    expect(unitNameplate(stale, roster, 0).shield).toBe(0);
  });
});

describe('UI-NAMEPLATES: the ULT tag', () => {
  it('lights at the engine\'s threshold, not at a number written here', () => {
    expect(ultReady(ULT_COST)).toBe(true);
    expect(ultReady(ULT_COST - 1)).toBe(false);
  });

  it('is what makes an ultimate a threat you can play around', () => {
    // Both enemy nameplates carry it in the owner's screenshot, and that is the
    // whole reason the energy bar is on screen.
    const charged = { ...unit('vex-t1-0', 1, 9, 9), energy: ULT_COST + 30 };
    expect(unitNameplate(charged, roster, 0).ult).toBe(true);
  });

  it('and an enemy at 99 energy does not carry it', () => {
    const nearly = { ...unit('vex-t1-0', 1, 9, 9), energy: ULT_COST - 1 };
    const plate = unitNameplate(nearly, roster, 0);
    expect(plate.ult).toBe(false);
    expect(plate.energy, 'the bar still shows how close they are').toBe(ULT_COST - 1);
  });
});

describe('UI-NAMEPLATES: the status row rides the same gate as the icons', () => {
  it('an enemy plate omits Stealth', () => {
    const hidden = {
      ...unit('wisp-t1-0', 1, 9, 9, WISP.id),
      statuses: [{ kind: 'stealth' as const, remaining: 1 }, { kind: 'might' as const, remaining: 2 }],
    };
    expect(unitNameplate(hidden, roster, 0).pips.map((p) => p.kind)).toEqual(['might']);
  });

  it('the owner\'s own plate keeps it', () => {
    const hidden = {
      ...unit('wisp-t1-0', 1, 9, 9, WISP.id),
      statuses: [{ kind: 'stealth' as const, remaining: 1 }, { kind: 'might' as const, remaining: 2 }],
    };
    expect(unitNameplate(hidden, roster, 1).pips.map((p) => p.kind)).toEqual(['might', 'stealth']);
  });

  it('and drops expired statuses, like every other reader of them', () => {
    const stale = {
      ...unit('vex-t0-0', 0, 2, 2),
      statuses: [{ kind: 'slow' as const, remaining: 0 }],
    };
    expect(unitNameplate(stale, roster, 0).pips).toEqual([]);
  });
});

describe('UI-NAMEPLATES: vision gates the plate, because vision gates the unit', () => {
  const state = (): GameState => makeState([
    unit('vex-t0-0', 0, 1, 7),
    unit('vex-t1-0', 1, 18, 7),   // seventeen squares away: well past VISION_RANGE
  ]);

  it('a fogged enemy is not in the drawn set at all, so it gets no plate', () => {
    // The gate is structural rather than a flag: `fogView` returns the units to
    // draw, and a plate is built for exactly those. There is no branch that
    // could be got wrong, which is the point of doing it this way.
    const view = fogView(OPEN, state(), 0, new Map());
    expect(view.units.map((u) => u.unitId)).toEqual(['vex-t0-0']);
    const plates = view.units.map((u) => unitNameplate(u, roster, 0));
    expect(plates.map((p) => p.name)).toEqual([VEX.name]);
  });

  it('and the same enemy in sight does get one', () => {
    const close = makeState([unit('vex-t0-0', 0, 5, 7), unit('vex-t1-0', 1, 8, 7)]);
    const view = fogView(OPEN, close, 0, new Map());
    expect(view.units.map((u) => u.unitId).sort()).toEqual(['vex-t0-0', 'vex-t1-0']);
  });

  it('own units are always in it, however far apart they are', () => {
    const spread = makeState([unit('vex-t0-0', 0, 0, 0), unit('vex-t0-1', 0, 19, 14)]);
    const view = fogView(OPEN, spread, 0, new Map());
    expect(view.units).toHaveLength(2);
  });
});

describe('UI-NAMEPLATES: the decoy wears a real plate', () => {
  const snapshot = {
    name: WISP.name, characterId: WISP.id, hp: 60, maxHp: 80, energy: 40,
    cooldowns: {}, catalysts: [], catalystsUsed: [],
  };

  it('name and frozen HP, so the absence of a plate is not the tell', () => {
    // A Wisp-shaped body with no nameplate, on a board where every other unit
    // has one, is un-disguised the moment a player looks at it — the same tell
    // the missing preview number was before PREVIEW-DECOY.
    expect(decoyNameplate(snapshot)).toMatchObject({ name: WISP.name, hp: 60, maxHp: 80 });
  });

  it('with an empty status row — real buffs would leak, fake ones would be invented', () => {
    expect(decoyNameplate(snapshot).pips).toEqual([]);
  });

  it('and no shield, ever: a decoy dies to any damage', () => {
    expect(decoyNameplate(snapshot).shield).toBe(0);
  });

  it('the frozen energy does not light ULT when the real Wisp charges', () => {
    // The snapshot is the cast; a plate that lit up later would be live data
    // wearing a disguise.
    expect(decoyNameplate({ ...snapshot, energy: ULT_COST - 1 }).ult).toBe(false);
    expect(decoyNameplate({ ...snapshot, energy: ULT_COST }).ult).toBe(true);
  });

  it('finds its caster from the kit, not from a hardcoded name', () => {
    // A second decoy character would otherwise silently wear Wisp's name.
    const s = makeState([unit('vex-t1-0', 1, 9, 9), unit('wisp-t1-1', 1, 10, 9, WISP.id)]);
    expect(decoyCaster(s.units, roster, 1)?.unitId).toBe('wisp-t1-1');
    expect(decoyCaster(s.units, roster, 0), 'no decoy-caster on team 0').toBeUndefined();
  });

  it('snapshots the caster as it stands at the cast', () => {
    const s = makeState([{ ...unit('wisp-t1-0', 1, 10, 9, WISP.id), hp: 44, energy: 30 }]);
    expect(snapshotDecoy(s.units, roster, 1)).toEqual({
      name: WISP.name, characterId: WISP.id, hp: 44, maxHp: 95, energy: 30,
      cooldowns: {}, catalysts: [], catalystsUsed: [],
    });
  });

  it('and gives nothing rather than throwing when no caster is on that team', () => {
    const s = makeState([unit('vex-t0-0', 0, 1, 1)]);
    expect(snapshotDecoy(s.units, roster, 0)).toBeUndefined();
  });
});

describe('UI-NAMEPLATES: the texture cache key', () => {
  const base = unit('vex-t0-0', 0, 2, 2);

  it('is stable for an unchanged plate — the plate is rebuilt every frame', () => {
    // `show()` runs on every pointer move during mouse-follow aiming. If the key
    // moved with it, the client would rasterise text sixty times a second.
    const a = nameplateKey(unitNameplate(base, roster, 0), 0);
    const b = nameplateKey(unitNameplate(base, roster, 0), 0);
    expect(a).toBe(b);
  });

  it('changes when the HP does — a stale bar is the worst possible bug here', () => {
    const hurt = { ...base, hp: 40 };
    expect(nameplateKey(unitNameplate(hurt, roster, 0), 0))
      .not.toBe(nameplateKey(unitNameplate(base, roster, 0), 0));
  });

  it('changes when the ULT tag lights', () => {
    const charged = { ...base, energy: ULT_COST };
    expect(nameplateKey(unitNameplate(charged, roster, 0), 0))
      .not.toBe(nameplateKey(unitNameplate({ ...base, energy: 0 }, roster, 0), 0));
  });

  it('changes when a status lands or its countdown ticks', () => {
    const slowed = { ...base, statuses: [{ kind: 'slow' as const, remaining: 2 }] };
    const ticking = { ...base, statuses: [{ kind: 'slow' as const, remaining: 1 }] };
    const keys = [base, slowed, ticking].map((u) => nameplateKey(unitNameplate(u, roster, 0), 0));
    expect(new Set(keys).size).toBe(3);
  });

  it('and separates the teams, since the name is inked in the team colour', () => {
    const plate = unitNameplate(base, roster, 0);
    expect(nameplateKey(plate, 0)).not.toBe(nameplateKey(plate, 1));
  });
});

/**
 * NAMEPLATE-LAYOUT (ar-parity §4.8) — the owner's rearrangement of the plate.
 *
 * The raster itself needs a canvas, so what is pinned here is the arithmetic it
 * is driven by: name hard left, row on the same line to its right, and an icon
 * big enough that moving it onto the plate did not undo STATUS-ICONS-SIZE.
 */
describe('NAMEPLATE-LAYOUT: name left, status row beside it', () => {
  const NAME_W = 96; // roughly "Bastion" at the plate's 26px bold

  it('justifies the name to the plate margin instead of centring it', () => {
    expect(plateLayout(NAME_W, 0).nameX).toBe(PLATE_PAD_PX);
  });

  it('starts the row past the end of the name, on the same line', () => {
    const layout = plateLayout(NAME_W, 3);
    expect(layout.iconXs[0], 'the first icon clears the name')
      .toBe(PLATE_PAD_PX + NAME_W + NAME_GAP_PX);
    // Same line: the row shares the name band at the top of the plate, well
    // above the HP bar it used to sit under.
    expect(layout.iconY).toBeLessThan(PLATE_PX.h / 4);
  });

  it('grows rightward at one icon plus one gap', () => {
    const xs = plateLayout(NAME_W, 3).iconXs;
    expect(xs).toHaveLength(3);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBe(ICON_PX + ICON_GAP_PX);
  });

  it('keeps every icon inside the plate', () => {
    for (const n of [1, 3, 5, PIP_ORDER.length]) {
      for (const x of plateLayout(NAME_W, n).iconXs) {
        expect(x + ICON_PX, `${n} icons`).toBeLessThanOrEqual(PLATE_PX.w - PLATE_PAD_PX);
      }
    }
  });

  it('counts what did not fit rather than dropping it silently', () => {
    // Eleven icons cannot sit beside a name on a plate this wide, and a row
    // that just stopped would be a plate under-reporting what a unit carries.
    const full = plateLayout(NAME_W, PIP_ORDER.length);
    expect(full.iconXs.length).toBeGreaterThan(0);
    expect(full.iconXs.length + full.overflow).toBe(PIP_ORDER.length);
    expect(full.overflow).toBeGreaterThan(0);
  });

  it('and reports no overflow when the row fits', () => {
    const layout = plateLayout(NAME_W, 2);
    expect(layout.overflow).toBe(0);
    expect(layout.iconXs).toHaveLength(2);
  });

  it('shows nothing, and claims nothing, for a unit carrying nothing', () => {
    expect(plateLayout(NAME_W, 0)).toMatchObject({ iconXs: [], overflow: 0 });
  });

  it('gives a long name fewer icons rather than pushing them off the edge', () => {
    const short = plateLayout(40, PIP_ORDER.length);
    const long = plateLayout(150, PIP_ORDER.length);
    expect(long.iconXs.length).toBeLessThan(short.iconXs.length);
    expect(long.overflow).toBeGreaterThan(short.overflow);
  });

  it('does not undo STATUS-ICONS-SIZE — the icon is at least as big as the pips were', () => {
    // The floating row was raised to 0.18 world units because a drawing you
    // cannot resolve is worse than a colour you can. Moving it onto the plate
    // must not quietly hand that back, and this is the conversion that says so.
    expect(ICON_PX / PLATE_PX_PER_UNIT).toBeGreaterThanOrEqual(0.18);
  });
});
