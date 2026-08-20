/**
 * AIM-PREVIEW-TRUE — the aim preview's outline, derived from the engine's own
 * tile-centre predicate.
 *
 * > *"Right now it feels like there's the highlight preview + the squares that
 * > get affected, and it feels different."*
 *
 * It felt different because it **was** different. The client drew two objects
 * that cannot agree: the smooth AIM2 *input region* and the `expandShape`
 * *answer*. Under HITBOX1 a tile is taken when the region comes within half a
 * tile of its **centre**, not when it covers the tile — so tiles legitimately
 * lit up to half a tile outside the drawn silhouette, and slivers of the
 * silhouette covered tiles that never lit. The graphic depicted the question;
 * the tiles were the answer.
 *
 * The ruling (`docs/design/aim-preview-true.md`) is to draw the **predicate**:
 *
 * > The aim preview's continuous graphic is the analytic boundary of the
 * > engine's own tile-centre predicate, so that a tile is hit *iff its centre is
 * > inside the drawn shape*. Exactly, for every shape, at every rotation.
 *
 * Every selection rule in `shapes.ts` is an integer comparison on the tile
 * centre. Restated in continuous space, with the caster at the origin, the axis
 * `u = V/|V|`, `a` the axial coordinate and `b` the lateral one:
 *
 * | shape | engine test | locus |
 * |---|---|---|
 * | `circle` | `dx² + dy² ≤ r²` (CIRCLE-FIX) | disc of radius exactly `r` |
 * | `line` | `a > 0`, `|b| ≤ ½`, `a ≤ range` | **rectangle** `(0, range] × [−½, ½]` |
 * | `cone` + `beamWidth` | `a > 0`, `a ≤ range`, `|b| ≤ h + ½` | **rectangle** `(0, range] × [−h−½, h+½]` |
 * | `cone` | inside the 45° wedge, **or within ½ of it** | the wedge ⊕ disc(½), clipped to `a > 0` |
 * | `square` / `self` | the one tile | that tile |
 * | dash `impact` | `circleSquares` at the landing | the circle rule again |
 *
 * **Two of those disagree with the Designer's table, and the engine wins.** The
 * spec calls `line` "a capsule" and the beam "a rounded-corner rectangle" —
 * both being the shape ⊕ disc(½). But `lineSquares` and `beamCovers` fold the
 * half tile into the *width* only and cap the depth with a bare `a ≤ range`, so
 * their true loci have **square** ends and corners: a tile just past the far end
 * is out even when it is within ½ of the endpoint. Drawing the rounded version
 * would put an unlit sliver inside the outline at every cap — the exact class of
 * lie this item removes. Only the wedge is a genuine Minkowski inflation, and it
 * is drawn as one. (Flagged to the Analyzer; the spec's own §2 says the boundary
 * is "verified against the shipped engine", and AC #1 is the binding form.)
 *
 * **What this module does not do:** it never decides which tiles are hit. That
 * stays `expandShape`, integer and deterministic (AC #6). This is float, curved,
 * client-side presentation — and the congruence sweep in
 * `aim-boundary.test.ts` is the standing proof the two never disagree about
 * tiles.
 */

import {
  AIM_STEPS, buildBoard, circleSquares, direction8, dominantCardinal, isAimStep,
  stepToVector, wallDirection,
  type AbilityDef, type MapDef, type UnitState, type Vec2,
} from '@cards/engine';

/** Half a tile — the HITBOX1 grace, and the half-extent of a tile outline. */
const HALF = 0.5;

/**
 * How much every boundary is pushed **outward** past the exact locus.
 *
 * The engine's comparisons are inclusive (`≤`), so a tile centre sitting exactly
 * on the true boundary is *lit* — and a polygon test cannot answer "is this
 * point exactly on my edge" reliably in floating point. Pushing the drawn edge
 * out by a hair turns "inside or on" into "strictly inside", which a
 * point-in-polygon test answers the same way every time.
 *
 * The one place it points inward instead is the near edge of a directional
 * shape, where the engine's test is the strict `a > 0`: there the drawn edge is
 * inset by the same hair, so a tile square abreast of the caster stays out.
 * (Aegis's 3-wide lane is the shape that makes this matter — its half-width is
 * 1½, so the tiles either side of the caster are inside the *width* and are kept
 * out by the depth rule alone.)
 *
 * The size is chosen against the smallest gap the engine can produce. Axial and
 * lateral coordinates are integers divided by `|V|`, and `|V| ≤ AIM_STEPS / 4`,
 * so two tiles that the engine separates differ by at least `4 / AIM_STEPS`
 * ≈ 0.0078 tiles — nearly two orders of magnitude more than this. Visually it is
 * a ten-thousandth of a tile: nothing.
 */
const EPS = 1e-4;

/**
 * Segments per full turn when an arc is tessellated.
 *
 * Arcs are drawn **circumscribed**: each vertex sits at `radius / cos(θ/2)` so
 * every chord is *tangent* to the true arc at its midpoint and outside it
 * everywhere else. An inscribed polygon — vertices on the arc — cuts inside, so
 * a tile centre sitting exactly on the arc (which the engine lights) would fall
 * out of the drawn shape.
 *
 * **No shipped radius puts a centre exactly on an arc today**, so this is a
 * guard rather than a fix for an observed failure — the sweep passes either way,
 * and that was checked rather than assumed. It is kept because it costs one
 * multiplication and it is the difference between a rule that holds and a rule
 * that happens to hold: erring outward can only ever add a sliver far thinner
 * than the gap between two tiles the engine tells apart. (`EPS` below is the
 * opposite case — remove it and most of the roster fails immediately.)
 */
const ARC_SEGMENTS = 128;
/** The outward scale that makes a chord tangent rather than secant. */
const CIRCUMSCRIBE = 1 / Math.cos(Math.PI / ARC_SEGMENTS);

/** A point in fractional board coordinates. */
type Pt = Vec2;

const len = (v: Vec2): number => Math.hypot(v.x, v.y);

/**
 * An arc of `radius` about `centre`, from `from` to `to` radians, going the
 * short way round in the direction implied by their order.
 */
function arc(centre: Pt, radius: number, from: number, to: number): Pt[] {
  const span = to - from;
  const steps = Math.max(1, Math.ceil((Math.abs(span) / (2 * Math.PI)) * ARC_SEGMENTS));
  const r = radius * CIRCUMSCRIBE;
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + (span * i) / steps;
    out.push({ x: centre.x + r * Math.cos(t), y: centre.y + r * Math.sin(t) });
  }
  return out;
}

/**
 * The tile at `p`, as a boundary: a square of half-extent ½ **minus** the hair.
 *
 * Inset rather than outset, uniquely: a tile's four neighbours have centres
 * exactly one tile away, which lands them on this square's edges. Shrinking puts
 * them cleanly outside while the tile's own centre stays cleanly in.
 */
export function tileBoundary(p: Pt): Pt[] {
  const h = HALF - EPS;
  return [
    { x: p.x - h, y: p.y - h },
    { x: p.x + h, y: p.y - h },
    { x: p.x + h, y: p.y + h },
    { x: p.x - h, y: p.y + h },
  ];
}

/**
 * A disc of exactly `radius` about `centre` — the `circle` rule, and the dash
 * `impact` rule (CIRCLE-FIX made the authored number the reach itself, so the
 * drawn radius is the authored radius with nothing added).
 *
 * `radius: 0` is a real authored value (Cinder's Ember Bolt cores its centre
 * tile) and its locus is a single point, which cannot be drawn. The tile
 * outline is substituted: it is the smallest figure that contains that one tile
 * centre and no other, so the congruence claim survives intact and something is
 * visible.
 */
export function discBoundary(centre: Pt, radius: number): Pt[] {
  if (radius <= 0) return tileBoundary(centre);
  return arc(centre, radius + EPS, 0, 2 * Math.PI).slice(0, -1);
}

/**
 * A constant-width lane from the caster: `line` (half-width ½) and `cone` with
 * `beamWidth` (half-width `h + ½`), which are the same rectangle at two widths.
 *
 * Square-ended on purpose — see the header. The near end is inset by the hair
 * because the engine's depth test is a strict `a > 0`.
 */
export function laneBoundary(from: Pt, dir: Vec2, reach: number, halfWidth: number): Pt[] {
  const d = len(dir);
  if (d === 0 || reach <= 0) return [];
  const u = { x: dir.x / d, y: dir.y / d };
  const n = { x: -u.y, y: u.x };
  const w = halfWidth + EPS;
  const at = (a: number, b: number): Pt => ({
    x: from.x + u.x * a + n.x * b,
    y: from.y + u.y * a + n.y * b,
  });
  return [at(EPS, -w), at(reach + EPS, -w), at(reach + EPS, w), at(EPS, w)];
}

/**
 * The cone: the 45° wedge inflated by half a tile, clipped to the caster's front.
 *
 * This one **is** the Minkowski sum the spec describes, because `wedgeCovers`
 * really is "inside the triangle, or within ½ of its boundary" — the three cases
 * in `nearEdge`/`nearCap` are the apex, the two 45° sides and the flat cap, each
 * measured as a segment distance. So the outline is the triangle's two edges
 * offset outward by ½, its cap offset by ½, and radius-½ arcs at the two far
 * corners.
 *
 * The apex arc is **absent**, and that is not a simplification. `wedgeCovers`
 * refuses anything with `a ≤ 0`, so the inflated apex — which lives entirely
 * behind the caster — is cut off by a straight edge across the caster's own
 * square. What survives at `a = 0` is `|b| ≤ ½·√2`, where the two offset edges
 * cross it, and no tile but the caster's can sit there (a tile perpendicular to
 * the aim is a whole tile out).
 */
export function wedgeBoundary(from: Pt, dir: Vec2, reach: number): Pt[] {
  const d = len(dir);
  if (d === 0 || reach <= 0) return [];
  const u = { x: dir.x / d, y: dir.y / d };
  const n = { x: -u.y, y: u.x };
  const at = (a: number, b: number): Pt => ({
    x: from.x + u.x * a + n.x * b,
    y: from.y + u.y * a + n.y * b,
  });
  const grow = HALF + EPS;
  // Sliding a 45° edge outward by `grow` moves it `grow·√2` across the lateral
  // axis — the same 0.71-per-half-tile the old hand-drawn wedge knew about, now
  // used as an offset of the edge rather than as a widening of the far end.
  const lift = grow * Math.SQRT2;
  const off = grow / Math.SQRT2; // where an offset edge meets its corner arc

  /**
   * The radius-`grow` arc around one far corner, in traversal order.
   *
   * Described in `(a, b)` and mapped through `at`, so the trigonometry reads in
   * the frame it was derived in. It spans the 135° the boundary turns through
   * between the 45° edge's outward normal and the cap's — the triangle's
   * interior angle there is 45°, so the exterior turn is the rest of a
   * half-turn.
   */
  const cornerArc = (side: 1 | -1): Pt[] => {
    const start = side === 1 ? (3 * Math.PI) / 4 : 0;
    const end = side === 1 ? 0 : -(3 * Math.PI) / 4;
    const steps = Math.max(1, Math.ceil((Math.abs(end - start) / (2 * Math.PI)) * ARC_SEGMENTS));
    const r = grow * CIRCUMSCRIBE;
    const out: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = start + ((end - start) * i) / steps;
      out.push(at(reach + r * Math.cos(t), side * reach + r * Math.sin(t)));
    }
    return out;
  };

  // The flat cap needs no point of its own: it is the straight run between the
  // two corner arcs' ends, which is exactly where the offset cap lies.
  return [
    at(EPS, lift),
    at(reach - off, reach + off),
    ...cornerArc(1),
    ...cornerArc(-1),
    at(reach - off, -(reach + off)),
    at(EPS, -lift),
  ];
}

/**
 * Is `p` inside the drawn polygon? Ray casting, the standard crossing count.
 *
 * The congruence test runs against **this**, over the very polygon the renderer
 * is handed — so "the drawn boundary" in AC #1 means the drawn boundary, not an
 * analytic stand-in for it that the renderer might tessellate differently.
 */
export function boundaryContains(poly: readonly Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The direction a `line`/`cone` points — the engine's own resolution order. */
export function aimDirectionOf(
  from: Vec2, ability: Pick<AbilityDef, 'shape'>, aim: readonly Vec2[], aimStep?: number,
): Vec2 | undefined {
  // WALL-ROTATE: a wall's direction is the one thing about it the caster does
  // not decide — it is the rotation the player picked, snapped to a cardinal by
  // the same `wallDirection` the engine lays the tiles with. So it reads the
  // step and ignores `from` entirely.
  if (ability.shape === 'wall') {
    return isAimStep(aimStep) ? wallDirection(aimStep) : undefined;
  }
  if (ability.shape !== 'line' && ability.shape !== 'cone') return undefined;
  if (isAimStep(aimStep)) return stepToVector(aimStep);
  const target = aim[0];
  if (target === undefined) return undefined;
  const v = ability.shape === 'line' ? direction8(from, target) : dominantCardinal(from, target);
  return v.x === 0 && v.y === 0 ? undefined : v;
}

/**
 * How far a directional shape actually got, in tile-widths along its axis.
 *
 * The only reason to ask is **occlusion** (AC #3): `lineSquares` stops at the
 * first wall and `coneSquares` drops what the wall shadows, so a boundary drawn
 * to the authored range would glide over a wall the tiles stopped at — which is
 * the same lie in a different place. Measured as the deepest covered tile, so a
 * shape merely *notched* by a wall beside its axis keeps its full length.
 */
export function depthReached(from: Vec2, dir: Vec2, covered: readonly Vec2[]): number {
  const d = len(dir);
  if (d === 0) return 0;
  let deepest = 0;
  for (const p of covered) {
    const a = ((p.x - from.x) * dir.x + (p.y - from.y) * dir.y) / d;
    if (a > deepest) deepest = a;
  }
  return deepest;
}

/**
 * Every boundary an armed ability draws: the outer shape, then any sub-band.
 *
 * A list rather than one polygon because Bastion's axis bonus and Cinder's core
 * are *loci too* — "Crushing Slam Center hit does not account for preview
 * correctly" is a complaint about which tiles carry the bonus, and the honest
 * answer is to draw that predicate as well, from this same module, rather than
 * leaving the band as a tile wash with no shape of its own.
 */
export function aimBoundaries(
  unit: UnitState,
  ability: AbilityDef,
  aim: readonly Vec2[],
  aimStep: number | undefined,
  covered: readonly Vec2[],
): Pt[][] {
  const from = unit.pos;
  const dir = aimDirectionOf(from, ability, aim, aimStep);
  const reach = dir === undefined ? 0 : Math.min(ability.range, depthReached(from, dir, covered));
  return memoised(boundaryKey(unit, ability, aim, dir, reach, covered.length),
    () => tessellate(from, ability, aim[0], dir, reach, covered.length, aim));
}

/**
 * LINE-PREVIEW-SMOOTH — everything the outline is a function of, as one string.
 *
 * *"Vex's and other line attack previews seem to be a little laggy, can you make
 * it more smooth?"*
 *
 * The aim follows the mouse continuously and the outline does not: AIM2
 * quantizes a free-rotation aim to one of `AIM_STEPS` directions, so a hover
 * that sweeps a hundred pixels across one step produces a hundred identical
 * polygons. `wedgeBoundary` and `discBoundary` each tessellate a 128-segment
 * arc to build one, and every one after the first is thrown away — which is the
 * lag, and it gets worse the longer the shape is.
 *
 * So the key is the *quantized* aim rather than the pointer: the direction, the
 * reach, the aimed tile, and the shape knobs that change the geometry. Nothing
 * float-valued and nothing per-pixel goes in it. `covered.length` rides along as
 * a cheap proxy for "the shape is occluded differently now" — `reach` already
 * carries the depth a wall clipped it to, and the length catches the remaining
 * case where a wall notches the sides without shortening the axis.
 *
 * Deliberately **not** hashing `covered` itself: walking it is the same order of
 * work as re-deriving, which would spend the saving to measure it.
 *
 * The key is a deliberate **superset** of what any one shape reads — a disc
 * ignores the direction, a lane ignores the aimed tile. Erring that way costs at
 * worst a miss that recomputes an identical polygon; erring the other way hands
 * back the wrong outline, which is silent. (It costs nothing in practice:
 * `aimFor` returns an empty `aim` for `line`/`cone`, so a rotating shape has no
 * aimed tile in its key to churn on.)
 */
function boundaryKey(
  unit: UnitState,
  a: AbilityDef,
  aim: readonly Vec2[],
  dir: Vec2 | undefined,
  reach: number,
  coveredCount: number,
): string {
  const t = aim[0];
  // RAM-LINE-PREVIEW-FIX: a `path` is the one shape whose outline depends on the
  // WHOLE aim rather than on its first square — two routes to the same corner
  // draw different lanes. Its tiles go in the key; every other shape contributes
  // only `aim[0]`, exactly as before, so nothing else pays for this.
  const route = a.shape === 'path' ? aim.map((p) => `${p.x},${p.y}`).join(';') : '';
  return [
    unit.unitId, unit.pos.x, unit.pos.y,
    a.id, a.shape, a.range, a.radius, a.innerRadius, a.beamWidth, a.axisBonus, a.wallLength,
    t?.x, t?.y, dir?.x, dir?.y, reach, coveredCount, route,
  ].join('|');
}

/**
 * The last few outlines, by key.
 *
 * A handful of slots rather than one, because a render draws more than one
 * boundary: the live aim, plus AC #5's already-locked teammate plans. A
 * single-slot cache would be evicted by each of them in turn and never hit —
 * the classic way a memo makes something slower.
 *
 * Bounded because the key includes the aim, so an unbounded map would grow by
 * one entry per square a player has ever hovered over. `CACHE_MAX` is well above
 * the number of boundaries any one frame draws; entries older than that are
 * dropped in insertion order.
 *
 * The arrays handed back are **shared, and must not be mutated** — every caller
 * today passes them straight to `renderer.drawShape`, which reads them into
 * geometry.
 */
const CACHE_MAX = 16;
const cache = new Map<string, Pt[][]>();
/** Counts real derivations, so a test can assert a hover did not cause one. */
let derivations = 0;

function memoised(key: string, derive: () => Pt[][]): Pt[][] {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  derivations += 1;
  const value = derive();
  cache.set(key, value);
  // Insertion-ordered, so the first key is the oldest.
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!(oldest.done ?? false)) cache.delete(oldest.value);
  }
  return value;
}

/**
 * How many outlines have actually been tessellated since the last reset.
 *
 * Exported for the LINE-PREVIEW-SMOOTH test, which is the only way to assert
 * "the derivation is skipped" — the *output* is identical either way, so a test
 * that only compared polygons could not tell a memo from a re-computation.
 */
export const boundaryDerivations = (): number => derivations;

/**
 * Drop the cache and the counter.
 *
 * For the tests, which need a known starting count. Nothing in the app calls it
 * and nothing needs to: the value is a pure function of the key, so a hit from
 * an earlier match is the same polygon this one would have derived.
 */
export function resetBoundaryCache(): void {
  cache.clear();
  derivations = 0;
}

/** The tessellation itself — the expensive half, run only on a cache miss. */
function tessellate(
  from: Vec2,
  ability: AbilityDef,
  target: Vec2 | undefined,
  dir: Vec2 | undefined,
  reach: number,
  coveredCount: number,
  /** RAM-LINE-PREVIEW-FIX: the charge's route, for the one shape that is a route. */
  path: readonly Vec2[] = [],
): Pt[][] {
  switch (ability.shape) {
    case 'self':
      return [tileBoundary(from)];
    case 'square':
      return target === undefined ? [] : [tileBoundary(target)];
    case 'circle': {
      if (target === undefined) return [];
      const outer = discBoundary(target, ability.radius ?? 1);
      // BASIC-INNER's core, from the engine's own `innerRadius`.
      return ability.innerRadius === undefined
        ? [outer]
        : [outer, discBoundary(target, ability.innerRadius)];
    }
    case 'line':
      return dir === undefined || coveredCount === 0 ? [] : [laneBoundary(from, dir, reach, HALF)];
    case 'cone': {
      if (dir === undefined || coveredCount === 0) return [];
      // BASIC-BEAM: a constant half-width turns the wedge into a lane. Aegis's
      // Shield Bash drew a cone until now — the beam knob was simply not read
      // here, which is the owner's "it should be the 3 tile wide rectangle".
      if (ability.beamWidth !== undefined) {
        return [laneBoundary(from, dir, reach, (ability.beamWidth - 1) / 2 + HALF)];
      }
      const outer = wedgeBoundary(from, dir, reach);
      // BASIC-AXIS's centre line. `onConeAxis` is `|b| ≤ ½`, and inside the
      // wedge that band runs the full depth plus the cap's half tile — so it is
      // the same lane the `line` shape draws, capped where the cone is.
      return ability.axisBonus === undefined
        ? [outer]
        : [outer, laneBoundary(from, dir, reach + HALF, HALF)];
    }
    case 'wall': {
      // WALL-ROTATE. The locus is the union of the wall's tiles — a rectangle
      // `wallLength` long and one tile wide — drawn as a lane so the outline is
      // one figure rather than four squares with seams down the middle.
      //
      // The wall is **anchored at the aimed tile and runs along `dir`**, so the
      // lane starts one step *before* that tile: `laneBoundary` draws
      // `(0, reach] × [−h, h]` from its origin, which puts the anchor at a = 1
      // and the last tile at a = length. Exactly the tiles `wallSquares`
      // returns, with no centring offset to get wrong. Getting it wrong would
      // draw the outline off the tiles that light, which is the exact lie
      // AIM-PREVIEW-TRUE removed.
      if (target === undefined || dir === undefined) return [];
      const length = ability.wallLength ?? 1;
      const start: Pt = { x: target.x - dir.x, y: target.y - dir.y };
      return [laneBoundary(start, dir, length, HALF)];
    }
    case 'path': {
      // RAM-LINE-PREVIEW-FIX. A charge drew **no outline at all** — the one
      // attack shape with nothing on the shape layer — so it read as a movement
      // route with tiles under it rather than as an attack. *"Bastion's Ram
      // Charge is still not a linear dash/attack preview."* Every other shape
      // has drawn its continuous locus since AIM-PREVIEW-TRUE; this is a charge
      // finally drawing its own.
      //
      // A route may bend (MV4 allows diagonals and a waypointed charge turns
      // corners), so it is drawn as **one lane per straight run** rather than as
      // a single rectangle. For the common straight ram that is exactly the one
      // lane a `line` gets, which is the whole point.
      //
      // `laneBoundary` spans `(0, reach]` from its origin, so each run starts
      // one step *before* its first tile — putting that tile at a = 1 and the
      // last at a = length, precisely the squares the path lists. The near edge
      // is inset (`a > 0`), so the tile a run starts from — the caster's square
      // for the first run, the corner tile for the others — stays outside its
      // own lane and keeps whatever the previous run gave it.
      return runsOf(path).map(({ from, dir, length }) =>
        laneBoundary({ x: from.x - dir.x, y: from.y - dir.y }, dir, length, HALF));
    }
  }
}

/**
 * A path split into maximal straight runs: where each starts, which way it goes,
 * and how many tiles long it is.
 *
 * Integer throughout — `direction8` of two adjacent squares is a unit step, and
 * two steps are the same run when both components match.
 */
function runsOf(path: readonly Vec2[]): { from: Vec2; dir: Vec2; length: number }[] {
  const runs: { from: Vec2; dir: Vec2; length: number }[] = [];
  for (let i = 0; i < path.length; i++) {
    const here = path[i]!;
    const prev = path[i - 1];
    const dir = prev === undefined ? undefined : direction8(prev, here);
    const open = runs[runs.length - 1];
    if (dir !== undefined && open !== undefined && open.dir.x === dir.x && open.dir.y === dir.y) {
      open.length += 1;
      continue;
    }
    // A new run. Its direction is the step that reached this tile; the very
    // first tile has no predecessor in the path, so it takes the step that
    // leads *out* of it instead — a one-tile path with no direction at all
    // draws nothing, which is the honest answer for an aim that is not a route.
    const next = path[i + 1];
    const heading = dir ?? (next === undefined ? undefined : direction8(here, next));
    if (heading === undefined || (heading.x === 0 && heading.y === 0)) continue;
    runs.push({ from: { ...here }, dir: heading, length: 1 });
  }
  return runs;
}

/**
 * DASH-PREVIEW's impact discs as boundaries — the circle rule again, centred on
 * the takeoff and the aimed landing.
 *
 * Separate from {@link aimBoundaries} for the same reason the tiles are a
 * separate layer: the aimed area is where the dash *goes*, the disc is what the
 * arrival *does*.
 */
export function impactBoundaries(
  map: MapDef,
  ability: AbilityDef | undefined,
  origin: Vec2,
  landing: Vec2 | undefined,
): Pt[][] {
  if (ability?.impact === undefined || landing === undefined) return [];
  const out: Pt[][] = [];
  const add = (centre: Vec2, radius: number | undefined): void => {
    if (radius === undefined || radius < 1) return;
    // Asked of the board so an out-of-bounds centre draws nothing, matching the
    // engine's own `circleSquares` guard rather than floating a disc off-map.
    if (circleSquares(buildBoard(map), centre, radius).length === 0) return;
    out.push(discBoundary(centre, radius));
  };
  add(landing, ability.impact.destination);
  add(origin, ability.impact.origin);
  return out;
}

/** Re-exported so a test can sweep the same quantization the engine aims in. */
export { AIM_STEPS };
