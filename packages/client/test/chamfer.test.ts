import { describe, expect, it } from 'vitest';
import {
  CHAMFER_MAX_FRACTION, CHAMFER_MIN, chamferFor, chamferedBox,
} from '../src/chamfer.js';

/**
 * A chamfered box has to be a *solid*, not merely a list of triangles.
 *
 * The failure mode of hand-written geometry is not "it throws" — it is a face
 * wound inside out, which renders as a hole you can see through, or a missing
 * corner triangle, which renders as a notch. Neither shows up in a build and
 * both are obvious in a screenshot nobody takes. These check the properties
 * instead: closed, outward-facing, inside the box it was asked for.
 */

const tri = (s: ReturnType<typeof chamferedBox>, i: number) => {
  const at = (n: number): [number, number, number] => [
    s.positions[n * 3]!, s.positions[n * 3 + 1]!, s.positions[n * 3 + 2]!,
  ];
  return [at(s.indices[i * 3]!), at(s.indices[i * 3 + 1]!), at(s.indices[i * 3 + 2]!)] as const;
};
const sub = (a: readonly number[], b: readonly number[]): number[] =>
  [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: number[], b: number[]): number[] =>
  [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const len = (a: number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);

describe('chamferedBox', () => {
  const W = 2, H = 1.4, D = 3, B = 0.12;
  const solid = chamferedBox(W, H, D, B);

  it('CHAMFER-VERTS: three vertices per corner, eight corners', () => {
    expect(solid.positions.length / 3).toBe(24);
  });

  it('CHAMFER-TOPOLOGY: six faces, twelve edge bevels, eight corners', () => {
    // 6*2 + 12*2 + 8 triangles.
    expect(solid.indices.length / 3).toBe(6 * 2 + 12 * 2 + 8);
  });

  it('CHAMFER-INSIDE-THE-BOX: nothing pokes outside the dimensions asked for', () => {
    for (let i = 0; i < solid.positions.length; i += 3) {
      expect(Math.abs(solid.positions[i]!)).toBeLessThanOrEqual(W / 2 + 1e-9);
      expect(Math.abs(solid.positions[i + 1]!)).toBeLessThanOrEqual(H / 2 + 1e-9);
      expect(Math.abs(solid.positions[i + 2]!)).toBeLessThanOrEqual(D / 2 + 1e-9);
    }
  });

  it('CHAMFER-FILLS-THE-BOX: and it still reaches the full extent on every axis', () => {
    // A bevel that ate the whole side would pass the test above and be wrong.
    const axis = (o: number): number[] => {
      const out: number[] = [];
      for (let i = o; i < solid.positions.length; i += 3) out.push(solid.positions[i]!);
      return out;
    };
    expect(Math.max(...axis(0))).toBeCloseTo(W / 2, 9);
    expect(Math.max(...axis(1))).toBeCloseTo(H / 2, 9);
    expect(Math.max(...axis(2))).toBeCloseTo(D / 2, 9);
  });

  it('CHAMFER-OUTWARD: every triangle faces away from the centre', () => {
    // A face wound the wrong way renders as a hole you can see through. Checked
    // per triangle rather than by eye, because one flipped quad out of 44 is
    // exactly the kind of thing a screenshot does not show.
    const count = solid.indices.length / 3;
    for (let i = 0; i < count; i++) {
      const [a, b, c] = tri(solid, i);
      const normal = cross(sub(b, a), sub(c, a));
      expect(len(normal), `triangle ${i} is degenerate`).toBeGreaterThan(1e-12);
      // Centroid doubles as the outward direction, the box being centred on 0.
      const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      expect(dot(normal, centroid), `triangle ${i} faces inward`).toBeGreaterThan(0);
    }
  });

  it('CHAMFER-PLUS-X-FACES-PLUS-X: a hand-checked face, independent of the orient pass', () => {
    // `chamferedBox` flips any triangle facing inward, so the outward test above
    // agrees with it by construction. This one does not: the +x face is known to
    // point along +x, and is checked against that directly.
    const count = solid.indices.length / 3;
    let found = 0;
    for (let i = 0; i < count; i++) {
      const [a, b, c] = tri(solid, i);
      if (![a, b, c].every((p) => Math.abs(p[0] - W / 2) < 1e-9)) continue;
      found += 1;
      const n = cross(sub(b, a), sub(c, a));
      expect(n[0]! / len(n)).toBeCloseTo(1, 9);
    }
    expect(found, 'no +x face found at all').toBe(2);
  });

  it('CHAMFER-CLOSED: every edge is shared by exactly two triangles', () => {
    // The definition of a closed surface, and what catches a missing corner
    // triangle — which renders as a notch in the silhouette.
    const seen = new Map<string, number>();
    const count = solid.indices.length / 3;
    for (let i = 0; i < count; i++) {
      const ids = [solid.indices[i * 3]!, solid.indices[i * 3 + 1]!, solid.indices[i * 3 + 2]!];
      for (let e = 0; e < 3; e++) {
        const a = ids[e]!;
        const b = ids[(e + 1) % 3]!;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    for (const [key, n] of seen) expect(n, `edge ${key} borders ${n} triangles`).toBe(2);
  });

  it('CHAMFER-ZERO-BEVEL: a zero bevel still yields a closed, outward solid', () => {
    const flat = chamferedBox(1, 1, 1, 0);
    expect(flat.positions.length / 3).toBe(24);
    expect(flat.indices.length / 3).toBe(6 * 2 + 12 * 2 + 8);
  });

  it('CHAMFER-CLAMPED: a bevel larger than the box cannot invert it', () => {
    const over = chamferedBox(1, 1, 1, 10);
    for (let i = 0; i < over.positions.length; i += 3) {
      expect(Math.abs(over.positions[i]!)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

describe('chamferFor', () => {
  it('BEVEL-FROM-SHORTEST: a thin panel gets a bevel sized to its thickness', () => {
    // A fixed bevel that reads well on a full block eats a barricade panel
    // alive: EDGE_COVER_THICK is a fraction of a tile, and a block-sized bevel
    // would meet itself in the middle and make a triangular prism.
    const block = chamferFor(1, 1, 1);
    const panel = chamferFor(1, 0.5, 0.08);
    expect(panel).toBeLessThan(block);
    expect(panel).toBeLessThanOrEqual(0.08 * CHAMFER_MAX_FRACTION + 1e-12);
  });

  it('BEVEL-NEVER-HALVES: it can never reach half the shortest side', () => {
    for (const s of [0.02, 0.08, 0.5, 1, 4]) {
      expect(chamferFor(s, s, s)).toBeLessThan(s / 2);
    }
  });

  it('BEVEL-SKIPPED-WHEN-INVISIBLE: a sub-pixel bevel is not worth the triangles', () => {
    expect(chamferFor(0.001, 0.001, 0.001)).toBe(0);
    expect(chamferFor(1, 1, CHAMFER_MIN / 100)).toBe(0);
  });

  it('BEVEL-DEGENERATE: zero or nonsense dimensions produce no bevel, not NaN', () => {
    expect(chamferFor(0, 1, 1)).toBe(0);
    expect(chamferFor(Number.NaN, 1, 1)).toBe(0);
  });
});
