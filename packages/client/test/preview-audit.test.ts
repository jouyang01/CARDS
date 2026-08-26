import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildBoard, buildRoster, coneSquares, createMatch, resolveTurn,
  type CharacterDef, type MapDef, type Roster, type UnitOrders, type Vec2,
} from '@cards/engine';
import { abilityPreview, abilityTooltip, damageTell, previewBands } from '../src/targeting.js';

/**
 * PREVIEW-AUDIT — every ability's preview matches its resolution (Dev Notes #1
 * and #3).
 *
 * *#1: "Damage previews need to account for things like the center of Cinder's
 * Ember bolt and center of Bastion punch. Audit all skills to ensure damage
 * preview is correct." #3: "Aegis's auto attack does not have anything special
 * about it. Make sure it shows in both description and gameplay."*
 *
 * A preview makes two claims, and they fail differently:
 *
 * 1. **the footprint** — which tiles. This is `expandShape`, the engine's own
 *    function, on both sides, so the first block below is a property test over
 *    the *whole roster* rather than a list of examples: every ability, at a
 *    fixed aim, drawn cells against the engine's own `abilityFired` area. It
 *    passes today and its job is to keep passing — a client that ever grew its
 *    own idea of a cone would fail here on every cone at once.
 *
 * 2. **the number** — how much, and where it differs. This is where the gaps
 *    were. `damageTell` knew about the core/ring split and the axis bonus and
 *    nothing else, so:
 *      • Aegis's Shield Bash read "20 dmg", identical to any other 20 — the
 *        constant-width lane that makes it Aegis's was invisible (Dev Note #3);
 *      • Cinder's Solar Flare read "30 dmg" when it is 30 and then 8 twice;
 *      • Snare Bloom and Overwatch Trap read **nothing at all** while burying a
 *        12- and a 20-damage mine.
 *
 * The footprint half needed no fix. The tell half is the item.
 */

const DIR = join(import.meta.dirname, '../../..', 'data/characters');
const CHARACTERS: CharacterDef[] = readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as CharacterDef);
const by = (id: string): CharacterDef => CHARACTERS.find((c) => c.id === id)!;
const ability = (charId: string, abilityId: string) => {
  const c = by(charId);
  return [...c.abilities, c.ultimate].find((a) => a.id === abilityId)!;
};
const roster: Roster = buildRoster(CHARACTERS);

const MAP: MapDef = {
  id: 't', name: 't', width: 25, height: 25, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 12 }, { x: 3, y: 12 }], [{ x: 22, y: 12 }, { x: 21, y: 12 }]],
};
const keys = (squares: readonly Vec2[]): string[] =>
  [...squares].map((p) => `${p.x},${p.y}`).sort();

/** The caster at (10,12) with an enemy three east — room for any shape. */
const field = (caster: CharacterDef) => {
  const state = createMatch(MAP, '1v1', [[caster], [by('vex')]]);
  const me = state.units.find((u) => u.owner === 0)!;
  const foe = state.units.find((u) => u.owner === 1)!;
  me.pos = { x: 10, y: 12 };
  foe.pos = { x: 13, y: 12 };
  me.energy = 100; // so an ultimate is affordable and the audit reaches it
  return { state, me, foe };
};

/** One fixed aim per shape, east: a target square, a walked path, or nothing. */
const aimFor = (shape: string): Vec2[] =>
  shape === 'self' ? []
    : shape === 'path' ? [{ x: 11, y: 12 }, { x: 12, y: 12 }]
      : [{ x: 13, y: 12 }];

/** What the engine actually covered when the order was resolved. */
const resolvedArea = (
  state: ReturnType<typeof field>['state'],
  order: UnitOrders,
  abilityId: string,
): Vec2[] => {
  const { events } = resolveTurn(state, MAP, [
    { team: 0, units: [order] }, { team: 1, units: [] },
  ], roster);
  const fired = events.find((e) => e.type === 'abilityFired' && e.abilityId === abilityId);
  return fired !== undefined && fired.type === 'abilityFired' ? [...fired.area] : [];
};

describe('PREVIEW-AUDIT: the drawn footprint is the resolved footprint', () => {
  // The audit proper: not a list of the abilities somebody remembered, but
  // every ability in `data/`, so a kit added later is covered the day it lands.
  const rows = CHARACTERS.flatMap((c) =>
    [...c.abilities, c.ultimate].map((def) => [`${c.id}.${def.id}`, c, def] as const));

  it('covers the whole roster, not a sample', () => {
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(new Set(rows.map(([name]) => name)).size, 'each one once').toBe(rows.length);
  });

  it.each(rows)('%s draws exactly what it hits', (_name, character, def) => {
    const { state, me } = field(character);
    const aim = aimFor(def.shape);
    // `state` goes in: DECOY-PLACEMENT makes one preview depend on who is
    // standing on the aimed square, and the sweep aims every square-shape at
    // the FOE. Without it this row drew a decoy the engine refuses — which is
    // exactly the divergence this audit exists to catch, found on itself.
    const drawn = abilityPreview(MAP, me, def, aim, undefined, state);
    const order: UnitOrders = def.free === true
      ? { unitId: me.unitId, freeAbility: { abilityId: def.id, target: aim } }
      : { unitId: me.unitId, ability: { abilityId: def.id, target: aim } };
    expect(keys(drawn)).toEqual(keys(resolvedArea(state, order, def.id)));
  });
});

describe('PREVIEW-AUDIT: Aegis Shield Bash is a lane, not a wedge', () => {
  // Dev Note #3, the named gap. The lane already *resolved* correctly — the
  // engine's `beamCovers` shipped with BASIC-BEAM — so the checks below are
  // about it being visible: the footprint says lane, and now the tell does too.
  const BASH = ability('aegis', 'shield_bash');

  it('the ability really does carry a constant width', () => {
    expect(BASH.shape).toBe('cone');
    expect(BASH.beamWidth).toBe(3);
  });

  it('it resolves 3 wide at every depth, where a plain cone would widen', () => {
    // The distinction, made against the engine's own geometry rather than a
    // count: same wedge, same range, only the knob differs.
    const board = buildBoard(MAP);
    const from: Vec2 = { x: 10, y: 12 };
    const east: Vec2 = { x: 1, y: 0 };
    const lane = coneSquares(board, from, east, BASH.range, BASH.beamWidth);
    const wedge = coneSquares(board, from, east, BASH.range, undefined);
    expect(lane.length, 'narrower than the wedge it would otherwise be')
      .toBeLessThan(wedge.length);
    for (const depth of [1, 2]) {
      const row = lane.filter((p) => p.x === from.x + depth);
      expect(row.length, `depth ${depth} is 3 wide`).toBe(3);
    }
  });

  it('and the preview draws that lane, tile for tile', () => {
    const { state, me } = field(by('aegis'));
    const drawn = abilityPreview(MAP, me, BASH, [{ x: 13, y: 12 }]);
    const order: UnitOrders = { unitId: me.unitId, ability: { abilityId: BASH.id, target: [{ x: 13, y: 12 }] } };
    expect(keys(drawn)).toEqual(keys(resolvedArea(state, order, BASH.id)));
    expect(new Set(drawn.map((p) => p.y)).size, 'three lanes across, at both depths').toBe(3);
  });

  it('the tell names the lane, so the ability reads as something', () => {
    // "Does not have anything special about it": before this, `20 dmg`.
    expect(damageTell(BASH)).toBe('20 dmg · 3-wide lane');
    expect(abilityTooltip(BASH)).toContain('20 dmg · 3-wide lane');
  });
});

describe('PREVIEW-AUDIT: the two differentials that started this', () => {
  it('Ember Bolt bands its core and says both numbers', () => {
    // Dev Note #1's first example. The band is `innerSquares` — the engine's own
    // answer to "which tiles take the other number".
    const bolt = ability('cinder', 'ember_bolt');
    const { me } = field(by('cinder'));
    const aim: Vec2[] = [{ x: 13, y: 12 }];
    const band = previewBands(MAP, me, bolt, aim);
    const all = abilityPreview(MAP, me, bolt, aim);
    expect(band.length, 'the core is drawn').toBeGreaterThan(0);
    expect(band.length, 'and it is a subset, not the whole disc').toBeLessThan(all.length);
    expect(keys(band).every((k) => keys(all).includes(k)), 'inside the footprint').toBe(true);
    expect(damageTell(bolt)).toBe('22 core / 14 ring');
  });

  it('Crushing Slam bands its axis and says the bonus', () => {
    // Dev Note #1's second. Additive rather than a replacement, and the tell
    // reads that way — "+8 on the axis", not a second flat number.
    const slam = ability('bastion', 'crushing_slam');
    const { me } = field(by('bastion'));
    const aim: Vec2[] = [{ x: 13, y: 12 }];
    const band = previewBands(MAP, me, slam, aim);
    const all = abilityPreview(MAP, me, slam, aim);
    expect(band.length).toBeGreaterThan(0);
    expect(band.length).toBeLessThan(all.length);
    expect(damageTell(slam)).toBe('24 dmg · +8 on the axis');
  });

  it('an ability with neither knob bands nothing', () => {
    // The control: the band layer must stay empty for the ordinary case, or it
    // stops meaning "this part is different".
    const rail = ability('vex', 'rail_shot');
    const { me } = field(by('vex'));
    expect(previewBands(MAP, me, rail, [{ x: 13, y: 12 }])).toEqual([]);
  });
});

describe('PREVIEW-AUDIT: the numbers a tell was hiding', () => {
  it('a burn is part of what the ability does to you', () => {
    // DOT-HOT shipped the mechanic; the tell never learned it, so Solar Flare
    // read as 30 when it is 30 and then 8 twice — the wrong number for the one
    // question a damage preview exists to answer.
    expect(damageTell(ability('cinder', 'solar_flare'))).toBe('30 dmg · 8 burn ×2');
    expect(damageTell(ability('cinder', 'flare_burst'))).toBe('12 dmg · 6 burn ×2');
  });

  it('a mine is a number too, even when the ability deals none directly', () => {
    // Snare Bloom and Overwatch Trap had **no tell at all** while burying a
    // 12- and a 20-damage mine. A preview that shows nothing for an ability that
    // does something is worse than one that shows too little.
    expect(damageTell(ability('thorn', 'snare_bloom'))).toBe('12 mine');
    expect(damageTell(ability('vex', 'overwatch_trap'))).toBe('20 mine');
    expect(damageTell(ability('thorn', 'barbed_sling')), 'and the auto that seeds one')
      .toBe('15 dmg · 8 mine');
  });

  it('a heal riding a damage line still says both', () => {
    // Radiant Lash: the two numbers cover the same tiles and cannot be told
    // apart by colour, which is exactly why they have to be said in words.
    expect(damageTell(ability('lumen', 'radiant_lash'))).toBe('14 dmg · +12 heal to allies');
  });

  it('and every ability that does a number now shows one', () => {
    // The audit's other half, as a sweep: no ability with a damage, heal,
    // shield, burn or trap amount may render an empty tell.
    const numeric = new Set(['damage', 'heal', 'shield', 'damageOverTime', 'healOverTime', 'trap']);
    for (const c of CHARACTERS) {
      for (const def of [...c.abilities, c.ultimate]) {
        const carries = def.effects.some((e) => numeric.has(e.kind) && e.amount !== undefined);
        if (!carries) continue;
        expect(damageTell(def), `${c.id}.${def.id}`).not.toBe('');
      }
    }
  });

  it('while an ability that is pure utility still says nothing', () => {
    // The counterweight: a tell that always spoke would be noise. Blink moves
    // you and does nothing else, and the line is left out rather than padded.
    expect(damageTell(ability('wisp', 'blink'))).toBe('');
    expect(damageTell(ability('cinder', 'stoke_the_flame'))).toBe('');
  });
});
