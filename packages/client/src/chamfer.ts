/**
 * CHAMFER — the bevel that makes a box look manufactured.
 *
 * Every solid on this board is a `BoxGeometry`: brush, cover, walls, the arena
 * slab, the rim, Warding Wall's posts. A raw box has one thing wrong with it
 * that no colour, texture or light rig can fix — its edges are *perfectly*
 * sharp, and nothing real is. A 90° corner presents exactly two surfaces to the
 * light, so the transition from lit face to shadowed face happens across zero
 * pixels and reads as a hard line drawn on the screen rather than as an edge in
 * the world.
 *
 * A chamfer adds a third, narrow surface at ~45°, which catches a highlight the
 * other two cannot. That thin bright line along the top of a wall is most of
 * what the eye uses to decide something was *made* rather than *drawn*. It is
 * the cheapest single change available here: same draw call, same material, a
 * few more triangles.
 *
 * Built by hand rather than pulled from `three/examples` (`RoundedBoxGeometry`)
 * for the reason the rest of this renderer avoids those: they are not part of
 * the published type surface, they bloat the bundle, and this is forty lines.
 *
 * Pure — no GL context, no scene. What it returns is a list of positions and
 * indices a caller turns into a `BufferGeometry`, which is what lets the whole
 * thing be checked in Node.
 */

/** How much of the shortest side is turned into bevel, per edge. */
export const CHAMFER_FRACTION = 0.055;
/** No bevel below this, in world units — sub-pixel bevels are wasted triangles. */
export const CHAMFER_MIN = 0.006;
/** …and never eat more than this share of a side, or a thin panel becomes a wedge. */
export const CHAMFER_MAX_FRACTION = 0.28;

/**
 * How wide the bevel should be for a box of these dimensions.
 *
 * Scaled off the SHORTEST side, not a constant. A wall block and a barricade
 * panel are wildly different shapes, and a fixed bevel that reads well on the
 * block eats a panel alive — `EDGE_COVER_THICK` is a fraction of a tile, and a
 * chamfer sized for a full box would meet itself in the middle and turn the
 * panel into a triangular prism.
 */
export function chamferFor(width: number, height: number, depth: number): number {
  const shortest = Math.min(Math.abs(width), Math.abs(height), Math.abs(depth));
  if (!(shortest > 0) || !Number.isFinite(shortest)) return 0;
  const wanted = shortest * CHAMFER_FRACTION;
  if (wanted < CHAMFER_MIN) return 0;
  return Math.min(wanted, shortest * CHAMFER_MAX_FRACTION);
}

export interface Solid {
  /** Flat `x, y, z` triples. */
  positions: number[];
  /** Triangle indices into `positions`. */
  indices: number[];
}

/**
 * A box with its twelve edges and eight corners cut back by `bevel`.
 *
 * Built as the convex hull of eight *corner clusters*: each of the box's eight
 * corners becomes three vertices, pulled in along each axis by the bevel. That
 * gives six face quads (inset), twelve edge quads (the bevels themselves) and
 * eight corner triangles — the shape a chamfering tool produces, without any
 * hull algorithm, because the topology of a chamfered box is fixed and can just
 * be written down.
 */
export function chamferedBox(width: number, height: number, depth: number, bevel: number): Solid {
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;
  const b = Math.max(0, Math.min(bevel, Math.min(hx, hy, hz)));

  const positions: number[] = [];
  const push = (x: number, y: number, z: number): number => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };

  // Per corner, three vertices — one lying on each of the three faces that meet
  // there. `v[...].x` is the one on the ±x face: at FULL extent along x, and
  // pulled in by the bevel along the other two axes. That is what makes the ±x
  // face a rectangle inset on all four sides, which is the whole point.
  //
  // The first version inset only one axis per vertex, which produces a
  // different solid entirely: no face ended up at full extent, so the box was
  // uniformly shrunk and every "face" was really a bevel. It passed a bounds
  // check and failed the one that asked where the +x face actually was.
  const v: Record<string, { x: number; y: number; z: number }> = {};
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const key = `${sx}${sy}${sz}`;
        v[key] = {
          x: push(sx * hx, sy * (hy - b), sz * (hz - b)),
          y: push(sx * (hx - b), sy * hy, sz * (hz - b)),
          z: push(sx * (hx - b), sy * (hy - b), sz * hz),
        };
      }
    }
  }

  const indices: number[] = [];
  /** A quad, wound so its front face points away from the box's centre. */
  const quad = (a: number, c: number, d: number, e: number): void => {
    indices.push(a, c, d, a, d, e);
  };
  const tri = (a: number, c: number, d: number): void => {
    indices.push(a, c, d);
  };

  /**
   * One inset face: the four corners of this side, each taken at the vertex
   * that was pulled in along this face's own axis.
   *
   * Corners are listed counter-clockwise as seen from OUTSIDE the box, which is
   * what makes the generated normal point outward. `chamfer.test.ts` checks
   * every triangle against that, rather than trusting the lists below.
   */
  const face = (
    axis: 'x' | 'y' | 'z',
    corners: readonly (readonly [number, number, number])[],
  ): void => {
    const ids = corners.map(([sx, sy, sz]) => v[`${sx}${sy}${sz}`]![axis]);
    indices.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!);
  };

  face('x', [[1, -1, 1], [1, 1, 1], [1, 1, -1], [1, -1, -1]]);
  face('x', [[-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1]]);
  face('y', [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]);
  face('y', [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]);
  face('z', [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]);
  face('z', [[-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, -1]]);

  // Twelve edge bevels. Each joins the two faces that share the edge, using the
  // pair of vertices at each end that were pulled in along those two axes.
  const edge = (
    a: readonly [number, number, number], c: readonly [number, number, number],
    p: 'x' | 'y' | 'z', q: 'x' | 'y' | 'z',
  ): void => {
    const ka = `${a[0]}${a[1]}${a[2]}`;
    const kc = `${c[0]}${c[1]}${c[2]}`;
    quad(v[ka]![p], v[kc]![p], v[kc]![q], v[ka]![q]);
  };

  // Edges along z (varying sz), at each (sx, sy) corner column.
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      edge([sx, sy, -1], [sx, sy, 1], 'x', 'y');
    }
  }
  // Edges along y.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      edge([sx, -1, sz], [sx, 1, sz], 'z', 'x');
    }
  }
  // Edges along x.
  for (const sy of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      edge([-1, sy, sz], [1, sy, sz], 'y', 'z');
    }
  }

  // Eight corner triangles, closing the gap where three bevels meet.
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const c = v[`${sx}${sy}${sz}`]!;
        tri(c.x, c.y, c.z);
      }
    }
  }

  // ORIENT, rather than hand-derive twenty-six windings.
  //
  // The first draft listed the corners of every face, bevel and corner triangle
  // by hand and got twenty of forty-four backwards — which renders as holes you
  // can see through, and is invisible in a build. The shape is convex and
  // centred on the origin, so "faces away from its own centroid" *is* the
  // definition of outward here, and flipping the ones that do not is exact
  // rather than a guess.
  //
  // `chamfer.test.ts` keeps two checks that do not depend on this pass — that
  // the surface is closed, and that the +x face really does point along +x — so
  // the geometry is still pinned by something other than the code that made it.
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!;
    const c = indices[i + 1]!;
    const d = indices[i + 2]!;
    const at = (n: number): [number, number, number] =>
      [positions[n * 3]!, positions[n * 3 + 1]!, positions[n * 3 + 2]!];
    const [ax, ay, az] = at(a);
    const [bx, by, bz] = at(c);
    const [cx, cy, cz] = at(d);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const gx = (ax + bx + cx) / 3, gy = (ay + by + cy) / 3, gz = (az + bz + cz) / 3;
    if (nx * gx + ny * gy + nz * gz < 0) {
      indices[i + 1] = d;
      indices[i + 2] = c;
    }
  }

  return { positions, indices };
}
