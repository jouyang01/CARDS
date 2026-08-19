import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AIM_STEPS, buildBoard, expandShape, stepToVector,
  type AbilityDef, type CharacterDef, type MapDef, type Vec2,
} from '@cards/engine';
import {
  aimBoundaries, boundaryContains, discBoundary, laneBoundary, tileBoundary, wedgeBoundary,
} from '../src/aim-boundary.js';

/**
 * AIM-PREVIEW-TRUE — **the congruence sweep**, which is the whole item.
 *
 * > *"Right now it feels like there's the highlight preview + the squares that
 * > get affected, and it feels different."*
 *
 * The Designer's ruling is that the drawn shape must be the *locus of the
 * engine's own tile-centre predicate*, so that a tile lights **iff** its centre
 * falls inside the drawn boundary — exactly, for every shape, at every rotation.
 * That claim is testable, and this file is the test:
 *
 *   for each shipped ability, at each quantized aim step,
 *     { tiles `expandShape` returns } === { tiles whose centre is in the polygon }
 *
 * Both directions matter and they fail differently. A tile lit but **outside**
 * the outline is the old bug — the shape under-promises and a player is hit by
 * something they could not see coming. A tile **inside** the outline but unlit
 * is the same lie the other way round: the shape over-promises and a shot that
 * looked certain misses.
 *
 * It is run against the **actual polygon handed to the renderer**, not against
 * an analytic stand-in. If the tessellation of an arc ever cut inside the true
 * curve, a tile centre sitting exactly on that curve would fall out of the
 * drawn shape and this would say so — which is why the arcs are circumscribed.
 *
 * **Open board, no walls.** Walls remove tiles for reasons that are not
 * geometric (a wall tile is dropped; LOS-OCCLUSION shadows what is behind one),
 * so no drawn boundary could be congruent on a board with one — the spec says as
 * much for `circle` ("draws whole… the missing tiles beneath it are the point").
 * Occlusion has its own block at the end: there the claim is the weaker,
 * correct one — the boundary shortens, and nothing lit is left outside it.
 *
 * The sweep doubles as a geometry regression guard on HITBOX1, CONE-B,
 * CIRCLE-FIX and BASIC-BEAM: any change to what those compute breaks congruence
 * here before it reaches a player.
 */

const DIR = join(import.meta.dirname, '../../..', 'data/characters');
const CHARACTERS: CharacterDef[] = readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as CharacterDef);

/** Big and empty: room for a range-8 line at any angle, with no wall in it. */
const OPEN: MapDef = {
  id: 'open', name: 'open', width: 41, height: 41, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 20 }], [{ x: 39, y: 20 }]],
};
const BOARD = buildBoard(OPEN);
const CENTRE: Vec2 = { x: 20, y: 20 };
const unitAt = (pos: Vec2) => ({ pos } as never);

const key = (p: Vec2): string => `${p.x},${p.y}`;
const sorted = (ps: readonly Vec2[]): string[] => ps.map(key).sort();

/**
 * Every tile whose centre lies inside `poly`, over the box the shape can reach.
 *
 * The caster's own tile is excluded for directional shapes, because the engine
 * excludes it by name (`dx === 0 && dy === 0` → skip) rather than by geometry:
 * it sits on the near edge of every lane and wedge, and no drawn boundary can
 * express "everything in front of me except the square I am standing on".
 */
const tilesInside = (poly: readonly Vec2[], from: Vec2, reach: number, skipCaster: boolean): Vec2[] => {
  const out: Vec2[] = [];
  for (let y = from.y - reach; y <= from.y + reach; y++) {
    for (let x = from.x - reach; x <= from.x + reach; x++) {
      if (skipCaster && x === from.x && y === from.y) continue;
      if (x < 0 || y < 0 || x >= OPEN.width || y >= OPEN.height) continue;
      if (boundaryContains(poly, { x, y })) out.push({ x, y });
    }
  }
  return out;
};

/** Every ability in `data/`, plus each mode of a multi-mode one, as a profile. */
const profiles = (): { name: string; def: AbilityDef }[] => {
  const out: { name: string; def: AbilityDef }[] = [];
  for (const c of CHARACTERS) {
    for (const def of [...c.abilities, c.ultimate]) {
      out.push({ name: `${c.id}.${def.id}`, def });
      for (const [i, mode] of (def.modes ?? []).entries()) {
        out.push({
          name: `${c.id}.${def.id}#${mode.name}`,
          def: { ...def, ...mode, modes: undefined } as AbilityDef,
        });
      }
    }
  }
  return out;
};

/**
 * Congruence for one ability at one aim step.
 *
 * Returns the two failure sets so a message can name the offending tiles rather
 * than just the counts.
 */
const congruence = (def: AbilityDef, step: number | undefined, aim: Vec2[]) => {
  const covered = expandShape(BOARD, def, CENTRE, aim, step);
  const polys = aimBoundaries(unitAt(CENTRE), def, aim, step, covered);
  const outer = polys[0];
  const directional = def.shape === 'line' || def.shape === 'cone';
  // Wide enough to hold everything the shape can reach from the caster: the
  // aimed square can be `range` away and the disc reaches `radius` past it.
  const box = Math.ceil(def.range) + (def.radius ?? 0) + 4;
  const inside = outer === undefined ? [] : tilesInside(outer, CENTRE, box, directional);
  const lit = new Set(covered.map(key));
  const drawn = new Set(inside.map(key));
  return {
    covered,
    outer,
    litButOutside: [...lit].filter((k) => !drawn.has(k)),
    drawnButUnlit: [...drawn].filter((k) => !lit.has(k)),
  };
};

/** The steps swept. Every one for short shapes; a fine sample for long ones. */
const stepsFor = (def: AbilityDef): number[] => {
  const every = def.range <= 3 ? 1 : 8;
  return Array.from({ length: Math.floor(AIM_STEPS / every) }, (_, i) => i * every);
};

describe('AIM-PREVIEW-TRUE: the drawn shape IS the lit tile set', () => {
  const directional = profiles().filter(({ def }) => def.shape === 'line' || def.shape === 'cone');

  it('there is something to sweep — every directional shape in the roster', () => {
    // A congruence suite that swept nothing would pass forever. Named up front:
    // lines, wedges, the beam, and both Kestrel modes.
    const names = directional.map((p) => p.name);
    expect(names.length, 'lines and cones across the roster').toBeGreaterThanOrEqual(10);
    expect(names).toContain('aegis.shield_bash'); // the beam
    expect(names).toContain('bastion.crushing_slam'); // the wedge with an axis bonus
    expect(names.some((n) => n.includes('twin_bolts#Focus'))).toBe(true);
    expect(names.some((n) => n.includes('twin_bolts#Spread'))).toBe(true);
  });

  it.each(directional.map((p) => [p.name, p.def] as const))(
    '%s: lit tiles === tiles inside the boundary, at every swept rotation',
    (name, def) => {
      for (const step of stepsFor(def)) {
        const r = congruence(def, step, []);
        expect(r.litButOutside, `${name} @${step}: lit but OUTSIDE the drawn shape`).toEqual([]);
        expect(r.drawnButUnlit, `${name} @${step}: inside the drawn shape but NOT lit`).toEqual([]);
      }
    },
  );

  it('and the sweep is not passing because nothing was ever lit', () => {
    // The control the assertion above cannot make: two empty sets are equal.
    for (const { name, def } of directional) {
      const r = congruence(def, 0, []);
      expect(r.covered.length, `${name} covers tiles`).toBeGreaterThan(0);
      expect(r.outer, `${name} draws a boundary`).toBeDefined();
    }
  });

  it.each(profiles().filter(({ def }) => def.shape === 'circle').map((p) => [p.name, p.def] as const))(
    '%s: a disc lights exactly the tiles inside its drawn radius',
    (name, def) => {
      // Circles do not rotate, so the sweep is over aimed squares instead —
      // including the caster's own, where the disc wraps its own tile.
      for (const at of [CENTRE, { x: 23, y: 20 }, { x: 22, y: 22 }, { x: 20, y: 17 }]) {
        const r = congruence(def, undefined, [at]);
        expect(r.litButOutside, `${name} @${key(at)}: lit but outside`).toEqual([]);
        expect(r.drawnButUnlit, `${name} @${key(at)}: drawn but unlit`).toEqual([]);
        expect(r.covered.length, `${name} covers something`).toBeGreaterThan(0);
      }
    },
  );

  it('a square-shaped ability draws its one tile and nothing beside it', () => {
    const blink = CHARACTERS.find((c) => c.id === 'wisp')!.abilities.find((a) => a.id === 'blink')!;
    const r = congruence(blink, undefined, [{ x: 22, y: 21 }]);
    expect(r.litButOutside).toEqual([]);
    expect(r.drawnButUnlit).toEqual([]);
    expect(sorted(r.covered)).toEqual(['22,21']);
  });
});

describe('AIM-PREVIEW-TRUE: the two shapes the owner reported', () => {
  const aegis = CHARACTERS.find((c) => c.id === 'aegis')!;
  const bastion = CHARACTERS.find((c) => c.id === 'bastion')!;
  const BASH = aegis.abilities.find((a) => a.id === 'shield_bash')!;
  const SLAM = bastion.abilities.find((a) => a.id === 'crushing_slam')!;

  it('Aegis Shield Bash draws a LANE, not a wedge (Dev Note #2)', () => {
    // *"Aegis Shield Bash still shows a cone preview, it should be the 3 tile
    // wide rectangle."* The beam knob was simply not read by the outline code —
    // `beamCovers` shipped with BASIC-BEAM and the drawing never learned about
    // it. A lane has constant lateral extent; a wedge's grows with depth.
    expect(BASH.beamWidth, 'it really is a beam in the data').toBe(3);
    const covered = expandShape(BOARD, BASH, CENTRE, [], 0);
    const poly = aimBoundaries(unitAt(CENTRE), BASH, [], 0, covered)[0]!;
    const lateral = poly.map((p) => Math.abs(p.y - CENTRE.y));
    // Constant width: every vertex sits on one of the two long edges.
    expect(new Set(lateral.map((v) => v.toFixed(3))).size, 'two lateral extents only').toBe(1);
    expect(Math.max(...lateral)).toBeCloseTo((BASH.beamWidth! - 1) / 2 + 0.5, 3);
  });

  it('and it is three tiles wide at every depth, which a wedge never is', () => {
    const covered = expandShape(BOARD, BASH, CENTRE, [], 0);
    for (let d = 1; d <= BASH.range; d++) {
      const row = covered.filter((p) => p.x === CENTRE.x + d);
      expect(row.length, `depth ${d}`).toBe(3);
    }
  });

  it('Bastion Crushing Slam draws its centre band as its own locus (Dev Note #1)', () => {
    // *"Crushing Slam Center hit does not account for preview correctly."* The
    // axis bonus is a second predicate (`onConeAxis`) over the same wedge, and
    // it had a tile wash but no shape of its own — so which tiles carried the
    // bonus was left for the eye to infer from a colour. Now it is drawn, and
    // congruent by the same rule as the outer shape.
    expect(SLAM.axisBonus, 'the bonus is in the data').toBe(8);
    for (const step of [0, 37, 128, 200, 400]) {
      const covered = expandShape(BOARD, SLAM, CENTRE, [], step);
      const polys = aimBoundaries(unitAt(CENTRE), SLAM, [], step, covered);
      expect(polys.length, `@${step}: an outer shape and a band`).toBe(2);
      const band = polys[1]!;
      const dir = stepToVector(step);
      const onAxis = covered.filter((p) => {
        const b = dir.x * (p.y - CENTRE.y) - dir.y * (p.x - CENTRE.x);
        return 4 * b * b <= dir.x * dir.x + dir.y * dir.y; // `onConeAxis`, verbatim
      });
      const inBand = tilesInside(band, CENTRE, SLAM.range + 4, true)
        .filter((p) => covered.some((c) => c.x === p.x && c.y === p.y));
      expect(sorted(inBand), `@${step}: the band draws the bonus tiles`).toEqual(sorted(onAxis));
      expect(onAxis.length, `@${step}: there IS an axis`).toBeGreaterThan(0);
    }
  });

  it('Cinder Ember Bolt draws its core, and the core is inside the burst', () => {
    // The other sub-band (BASIC-INNER). `innerRadius: 0` is a real authored
    // value — the core is the aimed tile alone — so its locus is a single point
    // and the tile outline stands in for it.
    const bolt = CHARACTERS.find((c) => c.id === 'cinder')!.abilities.find((a) => a.id === 'ember_bolt')!;
    const at: Vec2 = { x: 23, y: 20 };
    const covered = expandShape(BOARD, bolt, CENTRE, [at]);
    const polys = aimBoundaries(unitAt(CENTRE), bolt, [at], undefined, covered);
    expect(polys.length).toBe(2);
    const core = tilesInside(polys[1]!, at, 3, false);
    expect(sorted(core)).toEqual([key(at)]);
    expect(boundaryContains(polys[0]!, at), 'and the core sits inside the burst').toBe(true);
  });
});

describe('AIM-PREVIEW-TRUE: the boundary comes from the engine\'s numbers', () => {
  it('a disc is exactly its authored radius — no half tile bolted on', () => {
    // CIRCLE-FIX made the authored number the reach itself, so adding HITBOX1's
    // half tile to the drawing (which is what shipped) drew a ring of tiles that
    // never light. This is the assertion that stops it coming back.
    const poly = discBoundary({ x: 10, y: 10 }, 2);
    const radii = poly.map((p) => Math.hypot(p.x - 10, p.y - 10));
    expect(Math.min(...radii)).toBeGreaterThan(2);
    expect(Math.max(...radii)).toBeLessThan(2.01);
    expect(boundaryContains(poly, { x: 12, y: 10 }), 'a tile exactly r out is in').toBe(true);
    expect(boundaryContains(poly, { x: 12, y: 11 }), 'and √5 out is not').toBe(false);
  });

  it('a lane is a rectangle, square-ended, at the engine\'s half-width', () => {
    // Not the spec's "capsule": `lineSquares` caps the depth with a bare
    // `a ≤ range`, so a rounded end would enclose tiles that never light.
    const poly = laneBoundary({ x: 10, y: 10 }, { x: 1, y: 0 }, 4, 0.5);
    expect(poly).toHaveLength(4);
    expect(boundaryContains(poly, { x: 14, y: 10 }), 'the last tile on the axis').toBe(true);
    expect(boundaryContains(poly, { x: 15, y: 10 }), 'one past the range').toBe(false);
    expect(boundaryContains(poly, { x: 12, y: 11 }), 'a tile abreast of the lane').toBe(false);
  });

  it('a wedge is the triangle inflated by half a tile, and rounded at its corners', () => {
    const poly = wedgeBoundary({ x: 10, y: 10 }, { x: 1, y: 0 }, 2);
    // The cap sits half a tile past the range, and the corners are arcs rather
    // than points — a sharp corner would cut tiles the engine's `nearEdge`
    // grants.
    expect(Math.max(...poly.map((p) => p.x))).toBeCloseTo(12.5, 2);
    expect(poly.length, 'two edges, a cap and two arcs').toBeGreaterThan(20);
    expect(boundaryContains(poly, { x: 12, y: 12 }), 'the far corner tile').toBe(true);
    expect(boundaryContains(poly, { x: 13, y: 13 }), 'past it').toBe(false);
  });

  it('a tile outline holds its own centre and none of its neighbours', () => {
    const poly = tileBoundary({ x: 5, y: 5 });
    expect(boundaryContains(poly, { x: 5, y: 5 })).toBe(true);
    for (const n of [{ x: 6, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 4 }]) {
      expect(boundaryContains(poly, n), key(n)).toBe(false);
    }
  });

  it('and nothing is drawn for a shape that has no projected area', () => {
    const roll = CHARACTERS.find((c) => c.id === 'vex')!.abilities.find((a) => a.id === 'combat_roll')!;
    expect(aimBoundaries(unitAt(CENTRE), roll, [{ x: 21, y: 20 }], undefined, [{ x: 21, y: 20 }])).toEqual([]);
    const rail = CHARACTERS.find((c) => c.id === 'vex')!.abilities.find((a) => a.id === 'rail_shot')!;
    expect(aimBoundaries(unitAt(CENTRE), rail, [], undefined, []), 'no aim, no shape').toEqual([]);
    expect(aimBoundaries(unitAt(CENTRE), rail, [CENTRE], undefined, []), 'aimed at yourself').toEqual([]);
  });
});

describe('AIM-PREVIEW-TRUE: a wall truncates the drawn shape (AC #3)', () => {
  /** The same open field with a wall four tiles east of the caster. */
  const WALLED: MapDef = { ...OPEN, walls: [{ x: 24, y: 20 }] };
  const walledBoard = buildBoard(WALLED);
  const rail = CHARACTERS.find((c) => c.id === 'vex')!.abilities.find((a) => a.id === 'rail_shot')!;

  it('the boundary stops at the wall instead of gliding through it', () => {
    // "A smooth shape gliding over a wall while the tiles stop at it re-creates
    // the exact lie this item removes."
    const clear = expandShape(BOARD, rail, CENTRE, [], 0);
    const blocked = expandShape(walledBoard, rail, CENTRE, [], 0);
    expect(blocked.length, 'the wall really did stop it').toBeLessThan(clear.length);

    const far = (poly: Vec2[]): number => Math.max(...poly.map((p) => p.x));
    const open = aimBoundaries(unitAt(CENTRE), rail, [], 0, clear)[0]!;
    const cut = aimBoundaries(unitAt(CENTRE), rail, [], 0, blocked)[0]!;
    expect(far(cut), 'the drawn shape is shorter').toBeLessThan(far(open));
    expect(far(cut), 'and stops before the wall').toBeLessThan(24);
  });

  it('and nothing it still lights is left outside the shortened shape', () => {
    // The half of congruence that survives occlusion. The other half cannot: a
    // wall removes tiles for reasons that are not geometric, so tiles inside the
    // outline going dark is the point rather than a defect.
    const blocked = expandShape(walledBoard, rail, CENTRE, [], 0);
    const cut = aimBoundaries(unitAt(CENTRE), rail, [], 0, blocked)[0]!;
    for (const p of blocked) {
      expect(boundaryContains(cut, p), `${key(p)} is lit but outside`).toBe(true);
    }
  });

  it('a disc is NOT truncated — it draws whole over the tiles the wall removes', () => {
    const grenade = CHARACTERS.find((c) => c.id === 'vex')!.abilities.find((a) => a.id === 'frag_grenade')!;
    const at: Vec2 = { x: 24, y: 21 }; // next to the wall
    const clipped = expandShape(walledBoard, grenade, CENTRE, [at]);
    const whole = expandShape(BOARD, grenade, CENTRE, [at]);
    expect(clipped.length, 'the wall took a tile out of it').toBeLessThan(whole.length);
    expect(aimBoundaries(unitAt(CENTRE), grenade, [at], undefined, clipped))
      .toEqual(aimBoundaries(unitAt(CENTRE), grenade, [at], undefined, whole));
  });
});
