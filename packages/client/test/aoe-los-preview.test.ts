// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  aimInRange, aimVisionAllows, buildBoard, buildRoster, coverOrigin, createMatch, resolveTurn,
  type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster,
  type UnitState, type Vec2,
} from '@cards/engine';
import { abilityPreview, commitAim, previewBandSets, rangeEnvelope } from '../src/targeting.js';
import { previewNumbers } from '../src/preview-numbers.js';
import { startHotSeat } from '../src/app.js';
import { aimAndCommit, armAbility, layer, mountUI } from './app-harness.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * AOE-LoS, client half — **AIM-PREVIEW-TRUE for an explosion.**
 *
 * The ruling ends with a line that is entirely the client's problem: *"a grenade
 * preview must never light a tile the wall will protect."* A preview that
 * promises a hit the resolver will refuse is worse than no preview — the player
 * plans a turn around it and the turn does something else.
 *
 * Three questions, and each is asked of a different layer:
 *
 *   • **the footprint** — the tiles the aim overlay lights;
 *   • **the number** — what `previewNumbers` writes on a unit standing there;
 *   • **the aimable set** — which squares the player is offered at all.
 *
 * The footprint half needs almost no new code, and that is the point: both
 * sides call `expandShape` → `circleSquares`, so the wall's shadow is one
 * implementation. Asserted anyway, because "they share a function" is a fact
 * about today's code and this is a statement about behaviour.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, BASTION]);
const GRENADE: AbilityDef = VEX.abilities.find((a) => a.id === 'frag_grenade')!;
const K = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * A pillar at (10,11) with a blast centred one tile south of it, so (10,10) is
 * inside the radius-2 disc and behind the wall — the engine fixture's geometry,
 * on a client-sized board.
 *
 * ```
 *        9 10 11
 *   10   .  v  .        `v` is sheltered
 *   11   .  #  .        the pillar
 *   12   .  ✳  .        the centre
 * ```
 */
const PILLAR: MapDef = {
  id: 'pillar', name: 'pillar', width: 21, height: 21,
  walls: [{ x: 10, y: 11 }], cover: [], brush: [],
  spawns: [[{ x: 8, y: 12 }, { x: 6, y: 12 }], [{ x: 10, y: 10 }, { x: 18, y: 12 }]],
};
/** The same board with a west-facing barricade instead of the wall. */
const BARRICADE: MapDef = {
  ...PILLAR, id: 'barricade', walls: [], cover: [{ x: 12, y: 12, facing: 'W' }],
};

const CENTRE: Vec2 = { x: 10, y: 12 };

/** Vex at (8,12), one Bastion wherever the case wants him. */
const field = (map: MapDef, foeAt: Vec2): { state: GameState; me: UnitState; foe: UnitState } => {
  const state = createMatch(map, '1v1', [[VEX], [BASTION]]);
  const me = state.units.find((u) => u.owner === 0)!;
  const foe = state.units.find((u) => u.owner === 1)!;
  me.pos = { x: 8, y: 12 };
  foe.pos = { ...foeAt };
  return { state, me, foe };
};

/** The preview's damage number for one unit, built exactly as `app.ts` builds it. */
const previewed = (map: MapDef, state: GameState, me: UnitState, aim: Vec2[], targetId: string): number =>
  previewNumbers(state, buildBoard(map), me, [{
    def: GRENADE,
    squares: abilityPreview(map, me, GRENADE, aim),
    ...previewBandSets(map, me, GRENADE, aim),
    coverFrom: coverOrigin(GRENADE, me.pos, aim),
  }], new Set(state.units.map((u) => u.unitId)))
    .filter((n) => n.targetId === targetId && n.kind === 'damage')
    .reduce((sum, n) => sum + n.amount, 0);

/**
 * What the engine actually deals — for Frag Grenade that is **two** turns away,
 * because it is `delayTurns: 1`. Resolved rather than reasoned about, so the
 * right-hand side of every comparison below is a real detonation.
 */
const resolved = (map: MapDef, state: GameState, me: UnitState, aim: Vec2[], targetId: string): number => {
  const before = state.units.find((u) => u.unitId === targetId)!.hp;
  const mid = resolveTurn(state, map, [
    { team: 0, units: [{ unitId: me.unitId, ability: { abilityId: GRENADE.id, target: aim } }] },
    { team: 1, units: [] },
  ], roster).state;
  const after = resolveTurn(mid, map, [{ team: 0, units: [] }, { team: 1, units: [] }], roster).state;
  return before - after.units.find((u) => u.unitId === targetId)!.hp;
};

// ── The footprint ───────────────────────────────────────────────────────────

describe('AOE-LoS: the previewed footprint never lights a sheltered tile', () => {
  it('THE RULING: a grenade preview does not cover the square behind the wall', () => {
    const { state, me } = field(PILLAR, { x: 10, y: 10 });
    const drawn = new Set(abilityPreview(PILLAR, me, GRENADE, [CENTRE]).map(K));
    expect(drawn.has('10,10'), 'the wall protects this tile — do not promise it').toBe(false);
    expect(drawn.has('10,11'), 'nor the pillar itself').toBe(false);
    expect(drawn.has('8,12'), 'but the open tile the same distance out is drawn').toBe(true);
    expect(drawn.size, 'and the disc is not simply empty').toBeGreaterThan(4);
    expect(state.units).toHaveLength(2);
  });

  it('and the footprint IS the hit-set — no tile drawn goes unhit, none hit undrawn', () => {
    // The property behind the assertion above, swept over the whole disc: stand
    // a target on each previewed tile in turn and resolve. This is what makes
    // "they share `circleSquares`" a behavioural claim rather than a code fact.
    const { state, me } = field(PILLAR, { x: 10, y: 10 });
    const drawn = abilityPreview(PILLAR, me, GRENADE, [CENTRE]);
    let checked = 0;
    for (const tile of drawn) {
      if (K(tile) === K(me.pos)) continue; // the caster is FRAG-SELF's business
      const { state: s, me: caster, foe } = field(PILLAR, tile);
      expect(resolved(PILLAR, s, caster, [CENTRE], foe.unitId), `drawn tile ${K(tile)} was not hit`)
        .toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked, 'the sweep actually ran').toBeGreaterThan(5);
    // …and the other direction, on the one tile the wall removed.
    const { state: s2, me: c2, foe: f2 } = field(PILLAR, { x: 10, y: 10 });
    expect(resolved(PILLAR, s2, c2, [CENTRE], f2.unitId), 'the undrawn tile is not hit').toBe(0);
    expect(state.units).toHaveLength(2);
  });
});

// ── The number ──────────────────────────────────────────────────────────────

describe('AOE-LoS: the previewed NUMBER matches the blast, cover and all', () => {
  it('THE ITEM: a sheltered unit previews nothing and takes nothing', () => {
    const { state, me, foe } = field(PILLAR, { x: 10, y: 10 });
    expect(previewed(PILLAR, state, me, [CENTRE], foe.unitId)).toBe(0);
    expect(resolved(PILLAR, state, me, [CENTRE], foe.unitId)).toBe(0);
  });

  it('an exposed unit previews the full number, and takes it', () => {
    const { state, me, foe } = field(PILLAR, { x: 11, y: 12 });
    const shown = previewed(PILLAR, state, me, [CENTRE], foe.unitId);
    expect(shown, 'the preview writes something').toBeGreaterThan(0);
    expect(resolved(PILLAR, state, me, [CENTRE], foe.unitId), 'and the blast agrees').toBe(shown);
  });

  it('THE COVER ORIGIN: halved when the CENTRE is on the barricade’s faced side', () => {
    // (12,12) carries a west-facing barricade; the centre at (10,12) is west of
    // it, so the line crosses the faced edge. Both sides must halve, and the
    // number is the whole assertion — a preview that showed the full 33 over a
    // unit about to take 16 is the exact lie this item forbids.
    const { state, me, foe } = field(BARRICADE, { x: 12, y: 12 });
    const shown = previewed(BARRICADE, state, me, [CENTRE], foe.unitId);
    const dealt = resolved(BARRICADE, state, me, [CENTRE], foe.unitId);
    expect(shown, 'the preview halves it').toBe(dealt);
    const open = field(BARRICADE, { x: 11, y: 12 });
    expect(shown, 'and it really is a reduction, not the flat number')
      .toBeLessThan(previewed(BARRICADE, open.state, open.me, [CENTRE], open.foe.unitId));
  });

  it('and NOT halved when the centre is on the open side, from the same caster', () => {
    // The regression in one pair: the thrower does not move, only the centre
    // does. Under the old caster-origin rule both of these were halved.
    const east: Vec2 = { x: 14, y: 12 };
    const { state, me, foe } = field(BARRICADE, { x: 12, y: 12 });
    const shown = previewed(BARRICADE, state, me, [east], foe.unitId);
    expect(shown, 'the preview does not halve it').toBe(resolved(BARRICADE, state, me, [east], foe.unitId));
    const westCentre = previewed(BARRICADE, state, me, [CENTRE], foe.unitId);
    expect(shown, 'and the two centres genuinely differ').toBeGreaterThan(westCentre);
  });
});

// ── The aimable set ─────────────────────────────────────────────────────────

describe('AOE-LoS: the aimable set is what the engine will actually accept', () => {
  it('THE ENVELOPE: a square nobody can see is not offered', () => {
    // The caster is put at (10,15) — five tiles south of (10,10), so it is
    // comfortably inside the grenade's range-6 disc, with the pillar at (10,11)
    // squarely on the line. **That distance is the measurement:** park them at
    // (10,18) instead and the square falls out of *range*, so the envelope
    // omits it for a reason that has nothing to do with vision and the test
    // passes with the gate deleted. It did; the mutation check is what found it.
    const { state, me } = field(PILLAR, { x: 18, y: 18 });
    me.pos = { x: 10, y: 15 };
    const offered = new Set(rangeEnvelope(PILLAR, state, me, GRENADE).map(K));
    const board = buildBoard(PILLAR);
    expect(aimInRange(me.pos, { x: 10, y: 10 }, GRENADE.range),
      'the sheltered square is in RANGE — only vision keeps it out').toBe(true);
    for (const p of [{ x: 10, y: 16 }, { x: 10, y: 13 }]) {
      expect(offered.has(K(p)), `${K(p)} is in the open`).toBe(true);
    }
    expect(aimVisionAllows(board, state, me, GRENADE, { x: 10, y: 10 }),
      'the engine refuses the far side of the pillar').toBe(false);
    expect(offered.has('10,10'), 'so the envelope must not offer it').toBe(false);
  });

  it('and every square it DOES offer is one the engine accepts', () => {
    // Stated as the invariant rather than a spot check, because the failure
    // mode is one stray tile at the rim of the disc and a spot check would
    // never land on it.
    const { state, me } = field(PILLAR, { x: 18, y: 18 });
    me.pos = { x: 10, y: 15 };
    const board = buildBoard(PILLAR);
    const offered = rangeEnvelope(PILLAR, state, me, GRENADE);
    expect(offered.length, 'the envelope is not empty').toBeGreaterThan(10);
    for (const p of offered) {
      expect(aimVisionAllows(board, state, me, GRENADE, p), K(p)).toBe(true);
    }
  });
});

// ── Through the real controller ─────────────────────────────────────────────

describe('AOE-LoS: driven through the controller, the overlay the player sees', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('THE PLAYER’S VIEW: arming the grenade and aiming past the pillar', () => {
    // The whole chain — hotbar button, board hover, aim overlay — with nothing
    // stubbed but the GL context. `aim` is the layer the AoE footprint is drawn
    // into, so this is the tiles on screen and not a function that feeds them.
    const ui = mountUI();
    const teams: [CharacterDef[], CharacterDef[]] = [[VEX], [BASTION]];
    const opening = createMatch(PILLAR, '1v1', teams);
    opening.units.find((u) => u.owner === 0)!.pos = { x: 8, y: 12 };
    opening.units.find((u) => u.owner === 1)!.pos = { x: 10, y: 10 };
    startHotSeat(ui.ui, PILLAR, roster, teams, '1v1', [1, 1], {}, undefined, undefined, opening);

    armAbility(ui.controls, 'Frag Grenade');
    aimAndCommit(ui.board, CENTRE);

    const lit = new Set(layer(ui.renderer, 'aim').map(K));
    expect(lit.size, 'the grenade is armed and aimed').toBeGreaterThan(4);
    expect(lit.has('10,10'), 'the sheltered tile is NOT drawn as covered').toBe(false);
    expect(lit.has('10,11'), 'nor is the pillar').toBe(false);
    expect(lit.has('10,13'), 'the tile south of the centre is').toBe(true);
  });
});

// ── LOBBED-WALL ─────────────────────────────────────────────────────────────

/**
 * LOBBED-WALL — **the preview refuses the wall too, not just the click.**
 *
 * Owner Dev Note (2026-08-29): *"No lobbed projectiles should be able to be
 * lobbed onto hard walls."*
 *
 * The engine has refused a wall-centred blast since AOE-LoS, and so has
 * `commitAim`. What did not was the **hover**: `aimLegal` decides whether
 * `abilityPreview` draws anything and it is handed no board, so it could only
 * ask about range. Hovering the pillar therefore lit a full radius-2 disc
 * centred on it — the loud half of the UI saying yes — while the refusal marker
 * beside it said no and the click did nothing. A player reads the disc.
 *
 * Both halves now call the engine's `blastCentreAllowed`, which is why this is
 * asserted through `abilityPreview` and `commitAim` rather than through a
 * predicate: the bug was never in the rule, it was in which callers knew it.
 */
describe('LOBBED-WALL: a blast may not be centred on a wall', () => {
  it('THE NOTE: hovering the pillar draws NO burst', () => {
    const { state, me } = field(PILLAR, { x: 10, y: 10 });
    expect(abilityPreview(PILLAR, me, GRENADE, [{ x: 10, y: 11 }], undefined, state))
      .toEqual([]);
  });

  it('…and the click is refused, as it already was', () => {
    const { state, me } = field(PILLAR, { x: 10, y: 10 });
    expect(commitAim(PILLAR, state, me, GRENADE, { x: 10, y: 11 })).toBeUndefined();
  });

  it('THE CONTROL: one tile south, on open floor, both still say yes', () => {
    // The pair that keeps the two above about the wall rather than about the
    // grenade being unaimable here at all.
    const { state, me } = field(PILLAR, { x: 10, y: 10 });
    expect(abilityPreview(PILLAR, me, GRENADE, [CENTRE], undefined, state).length)
      .toBeGreaterThan(4);
    expect(commitAim(PILLAR, state, me, GRENADE, CENTRE)).toBeDefined();
  });

  it('COVER IS NOT A WALL: a grenade still lands on a barricade square', () => {
    // Deliberate, and stated so a future reading of "hard walls" does not
    // quietly widen: cover is crouch-height and the grenade lands on the floor
    // behind it. The barricade board puts cover at (12,12).
    const { state, me } = field(BARRICADE, { x: 10, y: 10 });
    expect(commitAim(BARRICADE, state, me, GRENADE, { x: 12, y: 12 })).toBeDefined();
    expect(abilityPreview(BARRICADE, me, GRENADE, [{ x: 12, y: 12 }], undefined, state).length)
      .toBeGreaterThan(0);
  });

  it('the preview and the resolver agree about the refusal, end to end', () => {
    // PREVIEW-AUDIT's rule for this case: an empty preview must mean a turn in
    // which nothing happened, not merely a quiet overlay over a live shot.
    const { state, me, foe } = field(PILLAR, { x: 10, y: 10 });
    expect(resolved(PILLAR, state, me, [{ x: 10, y: 11 }], foe.unitId), 'the order dropped')
      .toBe(0);
  });
});
