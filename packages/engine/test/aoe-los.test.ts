import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/board.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { circleSquares } from '../src/shapes.js';
import { validateAbility } from '../src/validate.js';
import { buildVision, teamCanSeeSquare, visibleSquaresForTeam } from '../src/vision.js';
import { makeMap, makeState, makeUnit, status, withStatuses } from './helpers.js';
import type {
  AbilityDef, CharacterDef, GameState, MapDef, PlayerOrders, UnitState, Vec2,
} from '../src/types.js';

/**
 * AOE-LoS — **walls shelter from explosions.**
 *
 * The owner's directive (2026-10-06), and the shape of the bug it closes: a
 * circle AoE was aimed at any square within range with no vision check at all,
 * and then hit every non-wall tile inside its radius with no line of sight from
 * its centre. So a grenade leaked around a pillar and caught the person who had
 * just taken shelter behind it, and the cover reduction was measured from the
 * *thrower* — meaning a barricade sheltered you from a blast on your own side
 * of it. Three rules replace that, all of them the ruling in
 * `docs/design/edge-cases.md` (**RULED — AOE-LoS**):
 *
 *   1. **who is hit** — a unit in the radius is hit iff the *centre* can see it;
 *   2. **how hard** — COVER-EDGE still halves, but the line is centre→victim;
 *   3. **where you may aim** — the team must see the square, and a direct burst
 *      needs the caster's own line as well. `lobbed` is the flag that says
 *      which.
 *
 * The board is drawn in every fixture below, because every case here is a
 * question about a specific piece of geometry and a reader should not have to
 * reconstruct it from coordinates.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * ```
 *    0123456789
 *  0 ..........
 *  1 ..........
 *  2 ..........
 *  3 ....#.....      the pillar
 *  4 ..........
 *  5 ..........
 *  6 ..........
 * ```
 * Wall at (4,3). Everything else open.
 *
 * The measurement that makes this board work, and the reason the pillar is one
 * row further down than it looks like it needs to be: with a blast centred on
 * (4,4), the pillar is **one** tile away and the sheltered square (4,2) is
 * **two** — inside a radius-2 disc, with the wall dead on the line. Set the
 * pillar any further out and the sheltered tile falls outside the radius
 * altogether, and every "takes 0" below passes for the wrong reason. It did, in
 * the first draft of this file; deleting the LoS filter and watching only one
 * of these tests go red is what found it.
 */
const PILLAR: MapDef = makeMap([
  '..........',
  '..........',
  '..........',
  '....#.....',
  '..........',
  '..........',
  '..........',
]);

/** A big open field, for the cases that only want distance. */
const FIELD: MapDef = makeMap(Array.from({ length: 13 }, () => '.'.repeat(13)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'circle', range: 6, radius: 2,
  cooldown: 0, energyGain: 0, effects: [{ kind: 'damage', amount: 40 }],
  description: over.id, ...over,
});

/** A lobbed grenade and a direct burst, otherwise identical. */
const GRENADE = ability({ id: 'grenade', lobbed: true });
const BURST = ability({ id: 'burst' });
/** The delayed twin of the grenade — Frag Grenade's shape exactly. */
const DELAYED = ability({ id: 'delayed', lobbed: true, delayTurns: 1, selfHarm: true });
/** A radius-2 grenade that catches its own thrower (FRAG-SELF). */
const SELFISH = ability({ id: 'selfish', lobbed: true, selfHarm: true });

const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [GRENADE, BURST, DELAYED, SELFISH],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, radius: undefined, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const at = (id: string, owner: 0 | 1, x: number, y: number, over: Partial<UnitState> = {}): UnitState =>
  makeUnit(id, owner, { x, y }, { characterId: 'test-char', ...over });

const fire = (
  map: MapDef, s: GameState, abilityId: string, target: Vec2, caster = 'a',
): GameState => resolveTurn(s, map, [
  { team: 0, units: [{ unitId: caster, ability: { abilityId, target: [target] } }] },
  { team: 1, units: [] },
] as [PlayerOrders, PlayerOrders], roster).state;

const hp = (s: GameState, id: string): number => s.units.find((u) => u.unitId === id)!.hp;
const lost = (s: GameState, id: string): number => 100 - hp(s, id);
const K = (p: Vec2): string => `${p.x},${p.y}`;

// ── 1. A wall shelters ──────────────────────────────────────────────────────

describe('AOE-LoS: a wall between the centre and you shelters you completely', () => {
  it('THE ITEM: a unit behind the pillar takes 0, a unit beside it takes full', () => {
    // Centre at (4,4), one row below the pillar at (4,3). `sheltered` stands at
    // (4,2) — d² = 4, inside the radius-2 disc, with the pillar dead on the
    // line from the centre. `open` is at (2,4): **the same d² = 4**, with
    // nothing in the way. The pair is the whole rule — same blast, same radius,
    // same distance, one wall.
    const s = fire(PILLAR, makeState([
      at('a', 0, 1, 4),
      at('sheltered', 1, 4, 2),
      at('open', 1, 2, 4),
    ]), 'grenade', { x: 4, y: 4 });
    expect(lost(s, 'sheltered'), 'the pillar is between them and the blast').toBe(0);
    expect(lost(s, 'open'), 'nothing is between them and the blast').toBe(40);
  });

  it('the shelter is in the AREA, so the footprint and the hit-set cannot disagree', () => {
    // The reason this lives in `circleSquares` and not in the damage loop: the
    // tile the wall protects is not in the disc at all, so the animation the
    // client plays, the trap a `perTile` cast buries and the number a preview
    // writes all inherit the same answer. One rule, one place.
    const disc = new Set(circleSquares(buildBoard(PILLAR), { x: 4, y: 4 }, 2).map(K));
    expect(disc.has('4,2'), 'the sheltered tile is not in the disc').toBe(false);
    expect(disc.has('4,3'), 'nor is the pillar itself').toBe(false);
    expect(disc.has('2,4'), 'the open tile is — the same d² = 4').toBe(true);
    expect(disc.has('4,4'), 'and so is the centre').toBe(true);
  });

  it('but the wall does NOT shelter you from a blast on your own side of it', () => {
    // The other half, and the one that keeps this from being "walls are safe".
    // Same pillar, same victim tile (4,2) — the centre has simply been moved
    // north of the wall to (4,1), and now there is nothing in between.
    const s = fire(PILLAR, makeState([
      at('a', 0, 1, 2),
      at('sheltered', 1, 4, 2),
    ]), 'grenade', { x: 4, y: 1 });
    expect(lost(s, 'sheltered'), 'the pillar is behind them now').toBe(40);
  });
});

// ── 2. Cover washes over, directionally, from the centre ────────────────────

/**
 * COVER-EDGE from the centre. The barricade sits on the **west** edge of (6,4),
 * so it shelters its occupant from anything west of them and from nothing else.
 *
 * ```
 *    ...456...
 *  4 ...a|v..        `a` casts, `|` is the faced edge, `v` stands on (6,4)
 * ```
 */
const BARRICADE: MapDef = { ...FIELD, id: 'barricade', cover: [{ x: 6, y: 4, facing: 'W' }] };

describe('AOE-LoS: cover washes over the blast, measured from its centre', () => {
  it('THE OWNER’S WORDS: reduced only if the centre is on the cover’s faced side', () => {
    // Centre west of the barricade → the line crosses the faced edge → halved.
    const west = fire(BARRICADE, makeState([
      at('a', 0, 2, 4),
      at('v', 1, 6, 4),
    ]), 'grenade', { x: 4, y: 4 });
    expect(lost(west, 'v')).toBe(20);
  });

  it('and NOT reduced when the centre is on the open side', () => {
    // Same barricade, same victim, centre moved to the east. The blast comes in
    // over their unprotected shoulder, so the half-wall does nothing — which is
    // the entire point of COVER-EDGE being directional.
    const east = fire(BARRICADE, makeState([
      at('a', 0, 10, 4),
      at('v', 1, 6, 4),
    ]), 'grenade', { x: 8, y: 4 });
    expect(lost(east, 'v')).toBe(40);
  });

  it('THE REGRESSION: the CASTER’s side of the barricade no longer decides it', () => {
    // The defect, stated as the difference it makes. The caster stands west of
    // the barricade — where the old rule measured from — and lobs the grenade
    // *past* the victim so the blast comes back at them from the open east
    // side. Under the old rule that was halved; under AOE-LoS it is not, and
    // the two numbers are what separate a caster-origin from a centre-origin.
    const s = fire(BARRICADE, makeState([
      at('a', 0, 2, 4),
      at('v', 1, 6, 4),
    ]), 'grenade', { x: 8, y: 4 });
    expect(lost(s, 'v'), 'the blast is east of them; the west-facing cover is irrelevant').toBe(40);
  });

  it('cover never BLOCKS the blast — it only halves it', () => {
    // `hasLineOfSight` is walls-only, so a barricade cannot remove a tile from
    // the disc the way a wall does. Asserted because the two are one line apart
    // in the implementation and confusing them would silently make cover a
    // second kind of wall.
    const disc = new Set(circleSquares(buildBoard(BARRICADE), { x: 4, y: 4 }, 2).map(K));
    expect(disc.has('6,4'), 'the covered tile is still in the blast').toBe(true);
  });
});

// ── 3. Aiming: vision, and the `lobbed` flag ────────────────────────────────

describe('AOE-LoS: you may only aim an area at ground your team can see', () => {
  it('THE LOB: a grenade arcs over a wall onto a square a teammate can see', () => {
    // `a` stands at (4,5), south of the pillar, with no line to (4,2) at all;
    // the teammate `b` at (4,0) is north of it and has a clear one. Team vision
    // is shared (GAME_SPEC §3), so the throw is legal — and it lands, which is
    // the half that proves the order was not silently dropped.
    const board = buildBoard(PILLAR);
    const s = makeState([at('a', 0, 4, 5), at('b', 0, 4, 0), at('v', 1, 4, 2)]);
    expect(teamCanSeeSquare(buildVision(board), s, 0, { x: 4, y: 2 }),
      'the teammate spots it').toBe(true);
    expect(lost(fire(PILLAR, s, 'grenade', { x: 4, y: 2 }), 'v'), 'the lob lands').toBe(40);
  });

  it('THE FOG: the same lob onto a square NOBODY can see is refused', () => {
    // The teammate is gone; nothing else changes. There is no spotter, so the
    // grenade cannot be thrown — "over the wall" is a licence to skip the
    // caster's own line, never a licence to blind-fire.
    const s = makeState([at('a', 0, 4, 5), at('v', 1, 4, 2)]);
    expect(teamCanSeeSquare(buildVision(buildBoard(PILLAR)), s, 0, { x: 4, y: 2 })).toBe(false);
    expect(lost(fire(PILLAR, s, 'grenade', { x: 4, y: 2 }), 'v'), 'the order is refused').toBe(0);
  });

  it('THE DIRECT BURST: refused through a wall even onto a square the team CAN see', () => {
    // Identical board to the successful lob, identical aim — the only
    // difference is the flag. A flat shot does not go over things.
    const s = makeState([at('a', 0, 4, 5), at('b', 0, 4, 0), at('v', 1, 4, 2)]);
    expect(lost(fire(PILLAR, s, 'burst', { x: 4, y: 2 }), 'v')).toBe(0);
  });

  it('and the same burst IS legal once the caster has its own clear line', () => {
    // The control for the case above: nothing about the burst is broken, it
    // simply needs to see what it is shooting at. Cast from (1,2), west of the
    // victim along a clear row, with the pillar out of the way.
    const s = makeState([at('a', 0, 1, 2), at('v', 1, 4, 2)]);
    expect(lost(fire(PILLAR, s, 'burst', { x: 3, y: 2 }), 'v')).toBe(40);
  });

  it('vision is capped by RANGE too, not only by walls', () => {
    // Aiming range is EUCLIDEAN (AIM-METRIC) and vision is MANHATTAN (MET1),
    // so a range-6 circle's far diagonal is inside the disc and outside the
    // 6-tile sight radius. Pinned because it is the one place the two metrics
    // disagree, and it is the reason a grenade's *effective* reach is now a
    // diamond rather than a disc.
    const s = makeState([at('a', 0, 2, 6), at('v', 1, 6, 10)]);
    const board = buildBoard(FIELD);
    expect(teamCanSeeSquare(buildVision(board), s, 0, { x: 6, y: 10 }),
      'Manhattan 8 — out of sight').toBe(false);
    expect(lost(fire(FIELD, s, 'grenade', { x: 6, y: 10 }), 'v')).toBe(0);
  });

  it('a self-centred circle is always legal — you can always see your own feet', () => {
    // The guard that keeps this from breaking every `radius: 1` support cast in
    // the roster: a `range: 0` circle is centred on the caster's own square,
    // which its team sees and has a trivial line to.
    const selfCast = ability({ id: 'selfish', range: 0, radius: 2, lobbed: undefined });
    const chr: CharacterDef = { ...CHAR, abilities: [selfCast], id: 'selfcaster' };
    const s = makeState([
      at('a', 0, 6, 6, { characterId: 'selfcaster' }),
      at('v', 1, 7, 6),
    ]);
    const after = resolveTurn(s, FIELD, [
      { team: 0, units: [{ unitId: 'a', ability: { abilityId: 'selfish', target: [{ x: 6, y: 6 }] } }] },
      { team: 1, units: [] },
    ], { selfcaster: chr }).state;
    expect(lost(after, 'v')).toBe(40);
  });
});

// ── 4. The load-bearing gotcha: WHICH vision snapshot ───────────────────────

describe('AOE-LoS: the aim is judged against the TURN’S OPENING vision', () => {
  it('THE GOTCHA: a spotter who dashes away first does not retract the throw', () => {
    // The trap the spec flags. `b` is the only unit that can see (4,2), and it
    // dashes out of sight in the Dash phase — which resolves *before* Blast. If
    // the aim gate re-asked at resolution time it would refuse a throw that was
    // legal when the player locked it in, and the client (which checked against
    // the fog on screen) would disagree with the server about a turn the player
    // already committed to.
    //
    // Orders are validated once, up front, against the opening board — this
    // pins that, by making the *only* spotter leave.
    const dash = ability({
      id: 'bolt', phase: 'dash', shape: 'path', range: 6, radius: undefined,
      effects: [], description: 'bolt',
    });
    const chr: CharacterDef = { ...CHAR, id: 'runner', abilities: [GRENADE, dash] };
    const s = makeState([
      at('a', 0, 4, 5, { characterId: 'runner' }),
      at('b', 0, 4, 0, { characterId: 'runner' }),
      at('v', 1, 4, 2),
    ]);
    const after = resolveTurn(s, PILLAR, [
      {
        team: 0,
        units: [
          { unitId: 'a', ability: { abilityId: 'grenade', target: [{ x: 4, y: 2 }] } },
          { unitId: 'b', ability: { abilityId: 'bolt', target: [{ x: 3, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }] } },
        ],
      },
      { team: 1, units: [] },
    ], { runner: chr }).state;
    expect(after.units.find((u) => u.unitId === 'b')!.pos, 'the spotter really did leave')
      .toEqual({ x: 0, y: 0 });
    expect(lost(after, 'v'), 'the grenade still lands where it was thrown').toBe(40);
  });
});

// ── 5. The caster is one more unit in the blast ─────────────────────────────

describe('AOE-LoS: CASTER-SAFE and FRAG-SELF compose with the shelter', () => {
  it('a selfHarm blast catches its thrower when the centre can see them', () => {
    // FRAG-SELF: *"Vex Frag grenade should hurt yourself too."* Standing two
    // tiles from your own centre on open ground is exactly that mistake.
    const s = fire(FIELD, makeState([at('a', 0, 6, 6)]), 'selfish', { x: 6, y: 8 });
    expect(lost(s, 'a')).toBe(40);
  });

  it('THE COMPOSITION: and does NOT, when the thrower is behind the wall', () => {
    // One rule for every unit in the radius, the caster included. `a` at (4,4)
    // throws over the pillar onto (4,2) — a teammate spots the square — and is
    // itself d² = 4 from that centre, so it is squarely inside its own blast.
    // The pillar at (4,3) is between the two, so the centre cannot see the
    // thrower and the thrower takes nothing.
    const s = makeState([at('a', 0, 4, 4), at('b', 0, 4, 0)]);
    const after = fire(PILLAR, s, 'selfish', { x: 4, y: 2 });
    expect(lost(after, 'a'), 'their own pillar sheltered them').toBe(0);
  });

  it('an ordinary blast still never touches its caster (CASTER-SAFE)', () => {
    const s = fire(FIELD, makeState([at('a', 0, 6, 6)]), 'grenade', { x: 6, y: 8 });
    expect(lost(s, 'a')).toBe(0);
  });
});

// ── 6. Delayed detonation ───────────────────────────────────────────────────

describe('AOE-LoS: a delayed grenade stamps its NUMBER, resolves its SHELTER', () => {
  /** Throw a `delayTurns: 1` grenade, then let a quiet turn detonate it. */
  const throwThenWait = (
    map: MapDef, s: GameState, target: Vec2, after?: (mid: GameState) => void,
  ): GameState => {
    const mid = fire(map, s, 'delayed', target);
    expect(mid.delayed, 'the grenade is in the air').toHaveLength(1);
    after?.(mid);
    return resolveTurn(mid, map, [{ team: 0, units: [] }, { team: 1, units: [] }], roster).state;
  };

  it('THE ITEM: the shelter is read at DETONATION, against where people ended up', () => {
    // `v` stands at (3,4), in the open beside the centre, when the pin is
    // pulled, and is at (4,2) — same disc, wrong side of the pillar — when it
    // goes off. Positions are live at detonation, so the blast finds them
    // sheltered, which is the whole reason a delayed grenade is a *warning*
    // rather than a sentence.
    const s = makeState([at('a', 0, 1, 4), at('b', 0, 4, 0), at('v', 1, 3, 4)]);
    const out = throwThenWait(PILLAR, s, { x: 4, y: 4 }, (mid) => {
      mid.units.find((u) => u.unitId === 'v')!.pos = { x: 4, y: 2 };
    });
    expect(lost(out, 'v'), 'they got behind the wall in time').toBe(0);
  });

  it('and catches them where they did not move', () => {
    // The control: the same grenade, nobody moving.
    const s = makeState([at('a', 0, 1, 4), at('v', 1, 3, 4)]);
    expect(lost(throwThenWait(PILLAR, s, { x: 4, y: 4 }), 'v')).toBe(40);
  });

  it('the AMOUNT is stamped at cast — a Might carried then, not later', () => {
    // Like a trap's charge (`placeTraps`). The thrower has Might when they pull
    // the pin, so the grenade carries the boosted number even though the buff
    // has expired by the time it lands. Before AOE-LoS the delayed path ignored
    // Might entirely, so this is 40 either way unless the stamp is real.
    const might = withStatuses(at('a', 0, 1, 4), status('might', 1));
    const s = makeState([might, at('v', 1, 3, 4)]);
    const out = throwThenWait(PILLAR, s, { x: 4, y: 4 });
    expect(out.units.find((u) => u.unitId === 'a')!.statuses, 'the buff is long gone')
      .toHaveLength(0);
    expect(lost(out, 'v'), 'but the number it was thrown with is not').toBeGreaterThan(40);
  });

  it('and COVER is not stamped — it is measured at detonation, from the centre', () => {
    // The other half of the split. The delayed path used to bypass cover
    // outright (`fixedDamage`), so a barricade meant nothing to a grenade; now
    // the reduction is read when it goes off, from the square it was aimed at.
    //
    // The thrower deliberately stands EAST of the barricade and lobs the
    // grenade past the victim to the west, so caster-origin and centre-origin
    // give different answers: from (10,4) the west-facing cover is irrelevant
    // and this would be 40. It is the centre that decides, so it is 20.
    const s = makeState([at('a', 0, 10, 4), at('v', 1, 6, 4)]);
    const out = throwThenWait(BARRICADE, s, { x: 4, y: 4 });
    expect(lost(out, 'v'), 'halved by the west-facing barricade').toBe(20);
  });
});

// ── 7. Validation, and the primitives ───────────────────────────────────────

describe('AOE-LoS: `lobbed` is a circle-only flag', () => {
  it('accepted on a circle', () => {
    expect(validateAbility(GRENADE, 'x')).toEqual([]);
  });

  it('THE GUARD: refused on every other shape, like wallLength off a wall', () => {
    for (const shape of ['line', 'cone', 'square', 'self', 'path', 'wall'] as const) {
      const errs = validateAbility({
        ...ability({ id: 'x' }), shape, radius: undefined, lobbed: true,
        ...(shape === 'wall' ? { wallLength: 2 } : {}),
      }, 'x');
      expect(errs.join(' '), shape).toMatch(/lobbed is only meaningful on a circle/);
    }
  });

  it('and absent is the default — nine of the ten shipped circles are direct', () => {
    // Recorded here rather than asserted over `data/`, because *which* abilities
    // lob is the Designer's call and this Builder pass deliberately changed
    // exactly one (see DECISIONS 2026-08-26). If a later data pass flips more,
    // this test should not be what objects.
    expect(GRENADE.lobbed).toBe(true);
    expect(BURST.lobbed).toBeUndefined();
  });
});

describe('AOE-LoS: teamCanSeeSquare is the fog the player is looking at', () => {
  it('THE INVARIANT: it agrees with visibleSquaresForTeam, square for square', () => {
    // The aim gate and the fog renderer must not drift: a square the player can
    // see is a square they may throw at, and the two answers come from
    // different functions. Checked over the whole pillar board so the wall's
    // shadow is included on both sides.
    const board = buildBoard(PILLAR);
    const vision = buildVision(board);
    const s = makeState([at('a', 0, 4, 4), at('b', 0, 0, 0), at('v', 1, 9, 4)]);
    const lit = new Set(visibleSquaresForTeam(vision, s, 0).map(K));
    let checked = 0;
    for (let y = 0; y < PILLAR.height; y++) {
      for (let x = 0; x < PILLAR.width; x++) {
        expect(teamCanSeeSquare(vision, s, 0, { x, y }), `${x},${y}`).toBe(lit.has(`${x},${y}`));
        checked += 1;
      }
    }
    expect(checked).toBe(PILLAR.width * PILLAR.height);
    expect(lit.size, 'and the fog is not simply the whole board').toBeLessThan(checked);
  });

  it('ignores concealment — a square has nothing to hide behind', () => {
    // Deliberately different from `teamCanSee`, which is about units: brush
    // hides the occupant, not the ground. If this asked the unit question, a
    // lobbed grenade would refuse the exact tile a hidden enemy is standing on,
    // which is the tile you most want to hit.
    const BRUSHY: MapDef = makeMap([
      '.........',
      '....b....',
      '.........',
    ]);
    const board = buildBoard(BRUSHY);
    const s = makeState([at('a', 0, 1, 1), at('v', 1, 4, 1)]);
    expect(teamCanSeeSquare(buildVision(board), s, 0, { x: 4, y: 1 })).toBe(true);
  });
});

describe('AOE-LoS: purity and determinism', () => {
  it('the same throw resolves identically twice, and never edits the input', () => {
    // Golden rule #1, at the seam this item touched: the new gate reads vision
    // and geometry, both of which are integer-exact and derived from the board.
    const s = makeState([at('a', 0, 1, 4), at('sheltered', 1, 4, 2), at('open', 1, 2, 4)]);
    const before = JSON.stringify(s);
    const one = fire(PILLAR, s, 'grenade', { x: 4, y: 4 });
    const two = fire(PILLAR, s, 'grenade', { x: 4, y: 4 });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(JSON.stringify(s), 'the caller’s state is untouched').toBe(before);
  });

  it('every game value the blast produced is an integer', () => {
    const s = fire(BARRICADE, makeState([at('a', 0, 2, 4), at('v', 1, 6, 4)]), 'grenade', { x: 4, y: 4 });
    for (const u of s.units) expect(Number.isInteger(u.hp), u.unitId).toBe(true);
  });
});
