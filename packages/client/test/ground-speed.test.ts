import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MS_PER_MOVE_STEP } from '../src/animate.js';

/**
 * GROUND-SPEED — the board moves at the speed the feet are built for.
 *
 * A locomotion clip is exported In Place, so it carries no ground speed of its
 * own; the speed is implied by how far a stride carries the foot. If a unit
 * crosses a square in any other time, the feet slide — and no amount of tuning
 * the *animation* fixes it, because the mismatch is between the clip and the
 * timeline. Aegis crossed a square in 760 ms against feet built for 439 ms, so
 * he took 2.07 steps per tile and skated the difference.
 *
 * `MS_PER_MOVE_STEP` is that measurement. This asserts the shipped clip still
 * agrees with it, because the number is only correct for the clip it was
 * measured from: swap the run and the constant is silently wrong. Reading the
 * `.glb` is the only way to know — the clip is the source of truth, not the doc
 * that quotes it.
 */

const MODEL = new URL('../public/models/aegis.glb', import.meta.url).pathname;
/** Body height in model units, and the tiles it is drawn at (MODEL_HEIGHT_TILES). */
const TILE_UNITS = 1.733 / 1.9;
const CHAIN = [
  'mixamorig:Hips', 'mixamorig:RightUpLeg', 'mixamorig:RightLeg',
  'mixamorig:RightFoot', 'mixamorig:RightToeBase',
];

type Vec = readonly number[];
const qmul = (a: Vec, b: Vec): number[] => [
  a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
  a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
  a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
  a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
];
const qrot = (q: Vec, v: Vec): number[] => {
  const [x, y, z, w] = [q[0]!, q[1]!, q[2]!, q[3]!];
  const t = [2 * (y * v[2]! - z * v[1]!), 2 * (z * v[0]! - x * v[2]!), 2 * (x * v[1]! - y * v[0]!)];
  return [
    v[0]! + w * t[0]! + y * t[2]! - z * t[1]!,
    v[1]! + w * t[1]! + z * t[0]! - x * t[2]!,
    v[2]! + w * t[2]! + x * t[1]! - y * t[0]!,
  ];
};

/** Stride length in tiles and stride duration in seconds, read off the clip. */
const measure = (path: string, clipName: string) => {
  const buf = readFileSync(path);
  let off = 12;
  let gltf: any;
  let bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) gltf = JSON.parse(chunk.toString('utf8'));
    else bin = chunk;
    off += 8 + len;
  }
  const read = (i: number): number[][] => {
    const a = gltf.accessors[i];
    const bv = gltf.bufferViews[a.bufferView];
    const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const n = ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]!;
    return Array.from({ length: a.count }, (_, k) =>
      Array.from({ length: n }, (_, j) => bin.readFloatLE(start + (k * n + j) * 4)));
  };
  const byName = new Map<string, number>(gltf.nodes.map((n: any, i: number) => [n.name, i]));
  const clip = gltf.animations.find((a: any) => a.name === clipName);
  const ch = new Map<string, { times: number[]; vals: number[][] }>();
  let duration = 0;
  for (const c of clip.channels) {
    const s = clip.samplers[c.sampler];
    const times = read(s.input).map((v) => v[0]!);
    duration = Math.max(duration, times[times.length - 1]!);
    ch.set(`${c.target.node}:${c.target.path}`, { times, vals: read(s.output) });
  }
  const sample = (node: number, path: string, t: number, fallback: number[]): number[] => {
    const e = ch.get(`${node}:${path}`);
    if (e === undefined) return fallback;
    const { times, vals } = e;
    if (t <= times[0]!) return vals[0]!;
    if (t >= times[times.length - 1]!) return vals[vals.length - 1]!;
    const k = times.findIndex((x) => x >= t);
    const f = (t - times[k - 1]!) / (times[k]! - times[k - 1]!);
    return vals[k - 1]!.map((a, j) => a + (vals[k]![j]! - a) * f);
  };
  // Toe position relative to the HIPS: the hips' own travel is the character's,
  // and an In Place clip has none. What is left is the foot's stride.
  const toeZ = (t: number): number => {
    let pos = [0, 0, 0];
    let rot = [0, 0, 0, 1];
    CHAIN.forEach((name, k) => {
      const i = byName.get(name)!;
      const node = gltf.nodes[i];
      const tr = k === 0 ? [0, 0, 0] : sample(i, 'translation', t, node.translation ?? [0, 0, 0]);
      const q = sample(i, 'rotation', t, node.rotation ?? [0, 0, 0, 1]);
      const world = qrot(rot, tr);
      pos = pos.map((v, j) => v + world[j]!);
      rot = qmul(rot, q);
    });
    return pos[2]!;
  };
  const zs = Array.from({ length: 61 }, (_, i) => toeZ((duration * i) / 60));
  return {
    strideTiles: (Math.max(...zs) - Math.min(...zs)) / TILE_UNITS,
    strideSeconds: duration / 2, // a Mixamo cycle is left foot, right foot
  };
};

describe('GROUND-SPEED: a square takes as long as a stride carries a foot across it', () => {
  if (!existsSync(MODEL)) {
    it('no model committed yet, which is a valid state', () => {
      expect(existsSync(MODEL)).toBe(false);
    });
  } else {
    const { strideTiles, strideSeconds } = measure(MODEL, 'sword_and_shield_run');

    it('the shipped run clip still implies the configured move-step duration', () => {
      const impliedMs = (strideSeconds / strideTiles) * 1000;
      // 10% — enough that a re-rig or a re-export wobbling the toe by a
      // millimetre does not fail the build, tight enough that a different
      // locomotion clip does.
      expect(MS_PER_MOVE_STEP, `clip implies ${impliedMs.toFixed(0)}ms per tile`)
        .toBeGreaterThan(impliedMs * 0.9);
      expect(MS_PER_MOVE_STEP, `clip implies ${impliedMs.toFixed(0)}ms per tile`)
        .toBeLessThan(impliedMs * 1.1);
    });

    it('and the stride is a plausible length for a character of this height', () => {
      // A sanity rail on the maths itself: a run stride is around a body-height
      // of travel, so anything wildly outside means the chain walk is wrong
      // rather than the clip being unusual.
      expect(strideTiles).toBeGreaterThan(0.4);
      expect(strideTiles).toBeLessThan(2.0);
    });
  }
});
