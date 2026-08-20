import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildBoard, buildRoster, createMatch, resolveTurn,
  type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster,
  type UnitOrders, type Vec2,
} from '@cards/engine';
import { abilityPreview, dashRoute, impactPreview, previewBandSets } from '../src/targeting.js';
import { previewNumbers } from '../src/preview-numbers.js';

/**
 * PREVIEW-NUMBERS-AUDIT — *"IMPORTANT again, AUDIT ALL DAMAGE PREVIEWS TO ENSURE
 * THEY ARE CORRECT."*
 *
 * PREVIEW-AUDIT proved the **footprint**: the tiles drawn are the tiles hit, for
 * every ability in `data/`, because both sides call `expandShape`. This file is
 * the same argument for the **number**, and it is the harder half — the number
 * was not one function shared by two callers but a client re-implementation that
 * had quietly fallen four rules behind the resolver.
 *
 * The property, stated once and swept over the whole roster:
 *
 *   for every ability, at a fixed aim, at **every previewed tile**:
 *     the number the preview writes there == the damage the engine deals there
 *
 * A unit is placed on one previewed tile at a time and the turn is really
 * resolved, so the right-hand side is a `damage` event and not a second opinion
 * about arithmetic. One resolution per tile is slower than one per ability and
 * it is the only version that can catch a *per-tile* error — a preview that gets
 * the total right by putting Cinder's core bonus on the wrong square would pass
 * any whole-area check.
 *
 * `amount + absorbed` on the engine's side because the preview is the post-cover
 * blow *before* shields, which is the documented contract (shields are shown on
 * the nameplate, not folded into the number).
 *
 * The named cases from Dev Note #3 — 11/22 for the whirl, nothing on Ravok for
 * Shockwave, 19/38 for Seismic, 22/14 for Cinder's core and ring, +8 on
 * Bastion's axis — get their own assertions underneath. The sweep would catch
 * them, but only as "kestrel.spread row failed"; a named test says which rule
 * broke, and these five are the ones a human asked for by number.
 */

const DIR = join(import.meta.dirname, '../../..', 'data/characters');
const CHARACTERS: CharacterDef[] = readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as CharacterDef);
const by = (id: string): CharacterDef => CHARACTERS.find((c) => c.id === id)!;
const ability = (charId: string, abilityId: string): AbilityDef => {
  const c = by(charId);
  return [...c.abilities, c.ultimate].find((a) => a.id === abilityId)!;
};
const roster: Roster = buildRoster(CHARACTERS);

const MAP: MapDef = {
  id: 't', name: 't', width: 25, height: 25, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 12 }, { x: 3, y: 12 }], [{ x: 22, y: 12 }, { x: 21, y: 12 }]],
};
const BOARD = buildBoard(MAP);
const CASTER_AT: Vec2 = { x: 10, y: 12 };
const key = (p: Vec2): string => `${p.x},${p.y}`;

/** The caster at (10,12), one enemy wherever the test wants it. */
const field = (caster: CharacterDef, foeAt: Vec2) => {
  const state = createMatch(MAP, '1v1', [[caster], [by('vex')]]);
  const me = state.units.find((u) => u.owner === 0)!;
  const foe = state.units.find((u) => u.owner === 1)!;
  me.pos = { ...CASTER_AT };
  foe.pos = { ...foeAt };
  me.energy = 100; // so an ultimate is affordable and the audit reaches it
  return { state, me, foe };
};

/**
 * One fixed aim per ability, east.
 *
 * `range: 0` is why this is not PREVIEW-AUDIT's `aimFor` verbatim: Ravok's whole
 * kit is discs centred on himself, and an aim three squares east is *illegal*
 * for them — `abilityPreview` returns nothing and the row passes by drawing
 * nothing. The recoil is the headline case of this item, so the aim has to be
 * one the ability will actually accept.
 */
const aimFor = (def: AbilityDef): Vec2[] => {
  if (def.shape === 'self') return [];
  if (def.shape === 'path') return [{ x: 11, y: 12 }, { x: 12, y: 12 }];
  // As far east as the ability legally reaches, up to three. `range: 0` lands on
  // the caster's own square (Ravok) and `range: 2` at two (Bastion's melee cone,
  // which a fixed three-east aim would have made illegal — drawing nothing, and
  // passing every comparison for free).
  return [{ x: CASTER_AT.x + Math.min(def.range, 3), y: CASTER_AT.y }];
};

const orderFor = (unitId: string, def: AbilityDef, aim: Vec2[]): UnitOrders => def.free === true
  ? { unitId, freeAbility: { abilityId: def.id, target: aim } }
  : { unitId, ability: { abilityId: def.id, target: aim } };

/** Every square the preview would write a number over, exactly as `app.ts` builds it. */
const previewedSquares = (state: GameState, me: GameState['units'][number], def: AbilityDef, aim: Vec2[]): Vec2[] => {
  const impact = impactPreview(MAP, me, def, aim);
  return [...abilityPreview(MAP, me, def, aim), ...impact.origin, ...impact.destination];
};

/** The preview's damage number for one unit, or 0 when it writes none. */
const previewed = (state: GameState, casterId: string, def: AbilityDef, aim: Vec2[], targetId: string): number => {
  const me = state.units.find((u) => u.unitId === casterId)!;
  const numbers = previewNumbers(state, BOARD, me, [{
    def,
    squares: previewedSquares(state, me, def, aim),
    ...previewBandSets(MAP, me, def, aim),
  }], new Set(state.units.map((u) => u.unitId)));
  return numbers.filter((n) => n.targetId === targetId && n.kind === 'damage')
    .reduce((sum, n) => sum + n.amount, 0);
};

/**
 * What the engine actually dealt to one unit, shields included.
 *
 * `absorbed` is added back because the preview's contract is the post-cover blow
 * *before* the shield pool eats any of it — a shielded target must not read as
 * taking less, or the number would change meaning depending on who is standing
 * there.
 */
const resolved = (
  state: GameState, order: UnitOrders, targetId: string, def: AbilityDef,
): number => {
  let now = state;
  let events = resolveTurn(now, MAP, [{ team: 0, units: [order] }, { team: 1, units: [] }], roster);
  // FF1-delayed: a `delayTurns` ability arms this turn and detonates later, and
  // the preview quite rightly shows the number when you AIM it. So the audit
  // waits for the bang rather than reading the arming turn as "0 damage".
  for (let i = 0; i < (def.delayTurns ?? 0); i += 1) {
    now = events.state;
    events = resolveTurn(now, MAP, [{ team: 0, units: [] }, { team: 1, units: [] }], roster);
  }
  // The FIRST damage event on the target: the blow itself.
  //
  // DOT-HOT ticks emit ordinary `damage` events at end of turn, and they are
  // deliberately NOT part of the floating number — a burn is `damageTell`'s
  // "8 burn x2" and (BURN-VISIBLE) a pip, because "30" and "30 now then 8 twice"
  // are different sentences and the number over a head is the immediate one.
  // Summing every event would therefore compare the preview against a total it
  // never claimed. Taking the first works because the direct hit precedes the
  // end-of-turn tick; `every damaging ability deals its blow directly` below is
  // the guard that keeps that assumption honest.
  const hit = events.events.find((e) => e.type === 'damage' && e.unitId === targetId);
  return hit !== undefined && hit.type === 'damage' ? hit.amount + hit.absorbed : 0;
};

const rows = CHARACTERS.flatMap((c) =>
  [...c.abilities, c.ultimate].map((def) => [`${c.id}.${def.id}`, c, def] as const));

describe('PREVIEW-NUMBERS-AUDIT: the previewed number is the dealt number', () => {
  it('covers the whole roster, not a sample', () => {
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(new Set(rows.map(([name]) => name)).size, 'each one once').toBe(rows.length);
  });

  it.each(rows)('%s: every previewed tile pays what it says', (_name, character, def) => {
    const aim = aimFor(def);
    // The footprint from a clean board, so the tiles swept are the ones a player
    // sees before anybody is standing in them.
    const empty = field(character, { x: 24, y: 0 });
    const tiles = previewedSquares(empty.state, empty.me, def, aim);

    // A dash carrying an `impact` has its ROUTE excluded, and only that kind.
    // A unit standing on the route stops the charge short, so the aimed landing
    // — and with it the aimed impact disc — is not where the blast goes off.
    // That is DASH-PREVIEW's documented plan-time estimate rather than a number
    // bug, and the disc's other tiles still sweep. A charge with no impact
    // (Kestrel's Skim, Tempest Run) damages the units it runs *through*, so its
    // route is exactly what needs auditing and stays in.
    const route = new Set(def.impact === undefined ? [] : dashRoute(empty.me, def, aim).map(key));
    const swept = tiles.filter((t) => !route.has(key(t)) && key(t) !== key(CASTER_AT));
    // An ability with a footprint must not drop out of the audit. Dashes are the
    // one exception and get their own coverage check below, because a teleport's
    // whole footprint can legitimately be the square it lands on.
    if (tiles.length > 0 && def.shape !== 'self' && def.phase !== 'dash') {
      expect(swept.length, `${_name} left tiles to sweep`).toBeGreaterThan(0);
    }

    for (const tile of swept) {
      const { state, me, foe } = field(character, tile);
      expect(
        previewed(state, me.unitId, def, aim, foe.unitId),
        `${_name} at ${key(tile)}`,
      ).toBe(resolved(state, orderFor(me.unitId, def, aim), foe.unitId, def));
    }
  });

  it('every damaging ability lands its blow directly, not only over time', () => {
    // The assumption `resolved` rests on: the first `damage` event on a target
    // is the blow the preview describes, and the DOT-HOT ticks come after it. It
    // holds because no shipped ability deals damage *only* over time — every one
    // that burns also hits. An ability that burned and nothing else would make
    // `resolved` read the tick as the blow and the audit would compare the
    // preview against a number it never claimed, silently.
    for (const [name, , def] of rows) {
      const kinds = new Set(def.effects.map((e) => e.kind));
      if (!kinds.has('damageOverTime')) continue;
      expect(kinds.has('damage'), `${name} burns without an immediate hit`).toBe(true);
    }
  });

  it('and every dash contributes tiles to the audit one way or the other', () => {
    // The dash rows opt out of the "left tiles to sweep" guard above, so their
    // coverage is asserted here instead: a dash either sweeps tiles or draws a
    // footprint that is entirely its own route. What it may not do is draw
    // nothing at all, which is what a broken `abilityPreview` would look like.
    for (const [name, character, def] of rows) {
      if (def.phase !== 'dash') continue;
      const { state, me } = field(character, { x: 24, y: 0 });
      expect(previewedSquares(state, me, def, aimFor(def)).length, `${name} draws nothing`)
        .toBeGreaterThan(0);
    }
  });

  it.each(rows)('%s: and so does the caster\'s own square', (_name, character, def) => {
    // The new dimension the item names. CASTER-SAFE means most abilities owe the
    // caster nothing; `selfDamagePct` means two of them owe exactly the recoil.
    // Both readings are wrong by default in a preview that just sums effects
    // over an area, because Ravok stands inside every disc he throws.
    const aim = aimFor(def);
    const { state, me, foe } = field(character, { x: 24, y: 0 });
    expect(
      previewed(state, me.unitId, def, aim, me.unitId),
      `${_name} on its own tile`,
    ).toBe(resolved(state, orderFor(me.unitId, def, aim), me.unitId, def));
    expect(foe.pos, 'the foe really is parked out of the way').toEqual({ x: 24, y: 0 });
  });
});

describe('PREVIEW-NUMBERS-AUDIT: the numbers the owner asked for by name', () => {
  const numbersFor = (character: CharacterDef, def: AbilityDef, foeAt: Vec2) => {
    const { state, me, foe } = field(character, foeAt);
    const aim = aimFor(def);
    return {
      self: previewed(state, me.unitId, def, aim, me.unitId),
      foe: previewed(state, me.unitId, def, aim, foe.unitId),
    };
  };

  it('Whirling Cleave: 11 to Ravok, 22 to the enemy beside him', () => {
    // "show 11 to himself, 22 to enemies for whirling cleave"
    expect(numbersFor(by('ravok'), ability('ravok', 'cleave'), { x: 11, y: 12 }))
      .toEqual({ self: 11, foe: 22 });
  });

  it('Shockwave: 12 to enemies and nothing at all on Ravok', () => {
    // "12 to enemies for shockwave and nothing on Ravok" — the middle position,
    // and the one a blanket "melee discs recoil" rule would get wrong.
    expect(numbersFor(by('ravok'), ability('ravok', 'shockwave'), { x: 11, y: 12 }))
      .toEqual({ self: 0, foe: 12 });
  });

  it('Seismic Rupture: 19 to Ravok, 38 to everyone else', () => {
    // "seismic rupture should show 19 damage to ravok and 38 to others"
    expect(numbersFor(by('ravok'), by('ravok').ultimate, { x: 12, y: 12 }))
      .toEqual({ self: 19, foe: 38 });
  });

  it('Cinder\'s Ember Bolt: 22 in the core, 14 in the ring', () => {
    // Dev Note #2, named: "Cinder's preview for damage on her auto attack should
    // show the extra damage to the center correctly." Both tiles are inside one
    // aim, which is exactly why a per-tile sweep was needed — the total over the
    // area is the same however the two numbers are distributed.
    const bolt = ability('cinder', 'ember_bolt');
    expect(bolt.innerAmount, 'the core number is authored').toBe(22);
    expect(numbersFor(by('cinder'), bolt, { x: 13, y: 12 }).foe, 'dead centre').toBe(22);
    const ring = numbersFor(by('cinder'), bolt, { x: 13, y: 13 }).foe;
    expect(ring, 'one out').toBe(bolt.effects.find((e) => e.kind === 'damage')!.amount);
    expect(ring, 'and genuinely different from the core').not.toBe(22);
  });

  it('Bastion\'s Crushing Slam: the axis pays its bonus on top', () => {
    const slam = ability('bastion', 'crushing_slam');
    const base = slam.effects.find((e) => e.kind === 'damage')!.amount!;
    expect(slam.axisBonus, 'the bonus is authored').toBeGreaterThan(0);
    // Straight ahead is the axis; off it is not. The slam's range is 2, so the
    // aim lands at (12,12) — on the centre line — and (12,13) is beside it.
    expect(numbersFor(by('bastion'), slam, { x: 12, y: 12 }).foe).toBe(base + slam.axisBonus!);
    expect(numbersFor(by('bastion'), slam, { x: 12, y: 13 }).foe).toBe(base);
  });
});

describe('PREVIEW-NUMBERS-AUDIT: an ally is numbered by the same rules', () => {
  /** The caster with a teammate, so friendly fire has somebody to reach. */
  const withAlly = (caster: CharacterDef, allyAt: Vec2) => {
    const state = createMatch(MAP, '2v2', [[caster, by('vex')], [by('vex'), by('vex')]]);
    const me = state.units.filter((u) => u.owner === 0)[0]!;
    const ally = state.units.filter((u) => u.owner === 0)[1]!;
    const foes = state.units.filter((u) => u.owner === 1);
    me.pos = { ...CASTER_AT };
    ally.pos = { ...allyAt };
    foes.forEach((f, i) => { f.pos = { x: 24, y: i }; });
    me.energy = 100;
    return { state, me, ally };
  };

  it('friendly fire is previewed — the ally in your cone gets a red number', () => {
    // FF1, already true and pinned here because the audit's new skips (CASTER
    // -SAFE, ALLY-SAFE) are exactly the kind that over-reach.
    const slam = ability('bastion', 'crushing_slam');
    const { state, me, ally } = withAlly(by('bastion'), { x: 12, y: 12 });
    const aim = aimFor(slam);
    expect(previewed(state, me.unitId, slam, aim, ally.unitId))
      .toBe(resolved(state, orderFor(me.unitId, slam, aim), ally.unitId, slam));
    expect(previewed(state, me.unitId, slam, aim, ally.unitId), 'and it is not zero')
      .toBeGreaterThan(0);
  });

  it('but an ALLY-SAFE ability writes no damage on its own team', () => {
    // Lumen's Radiant Lash damages enemies down the line and heals allies in the
    // same line, so an ally standing in it took a red number for a blow that
    // never lands. `noFriendlyFire` is the engine's own field.
    const lash = ability('lumen', 'radiant_lash');
    expect(lash.noFriendlyFire, 'the ability really is ALLY-SAFE').toBe(true);
    const { state, me, ally } = withAlly(by('lumen'), { x: 13, y: 12 });
    const aim = aimFor(lash);
    expect(previewed(state, me.unitId, lash, aim, ally.unitId), 'no damage on the ally').toBe(0);
    expect(previewed(state, me.unitId, lash, aim, ally.unitId))
      .toBe(resolved(state, orderFor(me.unitId, lash, aim), ally.unitId, lash));
  });
});

describe('FRAG-SELF: the preview shows the grenade you are standing in', () => {
  // *"Vex Frag grenade should hurt yourself too."* The engine now catches its
  // own caster in a `selfHarm` blast, and PREVIEW-NUMBERS-AUDIT's contract is
  // that the preview says whatever the resolution does. Keeping quiet about the
  // 34 you are about to take would be the worst version of this bug: the rule
  // changed, the preview did not, and the player learns it by dying.
  const GRENADE = ability('vex', 'frag_grenade');
  const GRENADE_DAMAGE = GRENADE.effects.find((e) => e.kind === 'damage')!.amount!;

  it('the ability really does opt out of CASTER-SAFE', () => {
    expect(GRENADE.selfHarm, 'authored, not inferred').toBe(true);
  });

  it('a caster inside the blast is numbered like anyone else in it', () => {
    // Aimed at the caster's own feet: legal (range 6 covers 0) and the clearest
    // possible statement of "you are standing in this".
    const { state, me } = field(by('vex'), { x: 24, y: 0 });
    const aim = [{ ...CASTER_AT }];
    expect(previewed(state, me.unitId, GRENADE, aim, me.unitId)).toBe(GRENADE_DAMAGE);
  });

  it('and standing clear of it is still previewed as free', () => {
    // The other half — `selfHarm` is presence, not a cost of throwing.
    const { state, me } = field(by('vex'), { x: 24, y: 0 });
    const aim = [{ x: CASTER_AT.x + 5, y: CASTER_AT.y }];
    expect(previewed(state, me.unitId, GRENADE, aim, me.unitId)).toBe(0);
  });

  it('an ability that did NOT opt out still previews nothing on its caster', () => {
    // Ravok's Shockwave is a `range: 0` disc he stands in the middle of, and
    // carries neither `selfHarm` nor `selfDamagePct`. CASTER-SAFE, undisturbed.
    const shockwave = ability('ravok', 'shockwave');
    const { state, me } = field(by('ravok'), { x: 24, y: 0 });
    expect(previewed(state, me.unitId, shockwave, [{ ...CASTER_AT }], me.unitId)).toBe(0);
  });
});
