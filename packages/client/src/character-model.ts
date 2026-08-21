/**
 * Loading and instancing rigged characters.
 *
 * The Three.js half of Phase 8. `character-clips.ts` decides WHICH clip plays;
 * this puts it on screen. Everything here is deliberately fail-soft: a character
 * with no `.glb` on disk, a fetch that 404s, a malformed manifest — each of them
 * leaves `instance()` returning undefined, and `renderer3d` falls back to the box
 * it drew before. Eight of the nine characters have no model yet and the e2e
 * suite runs without any, so an unavailable model must be ordinary, not an error.
 */

import { AnimationMixer, Group, LoopOnce, LoopRepeat, Object3D, type AnimationAction, type AnimationClip, type Bone } from 'three';

import type { ClipChoice, ClipSet } from './character-clips.js';

/** What `build_glb.py` writes next to each `.glb`. */
export interface CharacterManifest {
  id: string;
  clips: string[];
  map: ClipSet;
  posture?: PostureSpec;
}

/**
 * Bone offsets applied ON TOP of every clip.
 *
 * Mixamo's auto-rigger requires a symmetric T-pose, so a character's hunch and
 * dropped shoulder cannot be baked into the mesh. Applying them as offsets is
 * better anyway: the posture then survives idle, walk, dash *and* death, rather
 * than being one pose that every animation overwrites.
 */
export interface PostureSpec {
  dropShoulder?: 'left' | 'right';
  dropShoulderDeg?: number;
  hunchDeg?: number;
  headForwardDeg?: number;
}

/** Bone name → extra X rotation in radians. Pure, so it is unit-tested. */
export function postureRotations(posture: PostureSpec | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (posture === undefined) return out;
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  if (posture.hunchDeg) {
    // Split across the spine chain rather than bending one joint, which would
    // crease the model instead of curving it.
    out.set('mixamorigSpine', rad(posture.hunchDeg * 0.45));
    out.set('mixamorigSpine1', rad(posture.hunchDeg * 0.35));
    out.set('mixamorigSpine2', rad(posture.hunchDeg * 0.2));
  }
  if (posture.headForwardDeg) out.set('mixamorigNeck', rad(posture.headForwardDeg));
  if (posture.dropShoulderDeg) {
    const side = posture.dropShoulder === 'right' ? 'Right' : 'Left';
    out.set(`mixamorig${side}Shoulder`, rad(posture.dropShoulderDeg));
  }
  return out;
}

/** Mixamo bone names survive glTF as `mixamorigHips` or `mixamorig:Hips`. */
const findBone = (root: Object3D, name: string): Bone | undefined => {
  const alt = name.replace('mixamorig', 'mixamorig:');
  let hit: Bone | undefined;
  root.traverse((o) => {
    if (hit !== undefined) return;
    if ((o as Bone).isBone && (o.name === name || o.name === alt)) hit = o as Bone;
  });
  return hit;
};

export interface ModelInstance {
  root: Group;
  /** Play a choice, seeking rather than restarting if it is already running. */
  play(choice: ClipChoice, beatSeconds: number): void;
  /** Advance the mixer, then re-apply posture on top of whatever it wrote. */
  update(deltaSeconds: number): void;
  dispose(): void;
}

export class CharacterModels {
  private readonly loaded = new Map<string, { scene: Group; clips: AnimationClip[]; manifest: CharacterManifest }>();
  private readonly missing = new Set<string>();
  /**
   * SkeletonUtils.clone, captured when the loaders are imported.
   *
   * GLTFLoader and SkeletonUtils together are ~77 kB gzipped — more than half
   * the headroom in the bundle budget, for a feature eight of the nine
   * characters do not use yet. Importing them dynamically keeps them out of the
   * main bundle entirely until a match actually contains a character with a
   * model.
   */
  private cloneFn: ((o: Object3D) => Object3D) | undefined;

  /**
   * Fetch models for these character ids. Never rejects: a character whose files
   * are absent is recorded as missing and simply keeps its box.
   */
  async load(ids: readonly string[], base = 'models'): Promise<void> {
    const [{ GLTFLoader }, skeletonUtils] = await Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/utils/SkeletonUtils.js'),
    ]);
    this.cloneFn = skeletonUtils.clone;
    const loader = new GLTFLoader();
    await Promise.all(
      [...new Set(ids)].map(async (id) => {
        if (this.loaded.has(id) || this.missing.has(id)) return;
        try {
          const res = await fetch(`${base}/${id}.clips.json`);
          if (!res.ok) throw new Error(`manifest ${res.status}`);
          const manifest = (await res.json()) as CharacterManifest;
          const gltf = await loader.loadAsync(`${base}/${id}.glb`);
          this.loaded.set(id, {
            scene: gltf.scene as Group,
            clips: gltf.animations,
            manifest,
          });
        } catch {
          // Ordinary, not exceptional. Eight characters have no model yet.
          this.missing.add(id);
        }
      }),
    );
  }

  has(characterId: string): boolean {
    return this.loaded.has(characterId);
  }

  manifest(characterId: string): CharacterManifest | undefined {
    return this.loaded.get(characterId)?.manifest;
  }

  /** A fresh, independently-animatable copy, or undefined if there is no model. */
  instance(characterId: string): ModelInstance | undefined {
    const entry = this.loaded.get(characterId);
    if (entry === undefined || this.cloneFn === undefined) return undefined;

    // SkeletonUtils.clone rather than Object3D.clone: the latter shares the
    // skeleton, so every unit of the same character would animate in lockstep.
    // clone() preserves the concrete type it is handed; the signature cannot say so.
    const root = this.cloneFn(entry.scene) as Group;
    const mixer = new AnimationMixer(root);
    const byName = new Map(entry.clips.map((c) => [c.name, c]));
    const posture = postureRotations(entry.manifest.posture);
    const bones = new Map<string, { bone: Bone; extra: number; base: number }>();
    for (const [name, extra] of posture) {
      const bone = findBone(root, name);
      if (bone !== undefined) bones.set(name, { bone, extra, base: bone.rotation.x });
    }

    let current: AnimationAction | undefined;
    let currentName = '';

    return {
      root,
      play(choice, beatSeconds) {
        const clip = byName.get(choice.clip);
        if (clip === undefined) return;
        if (choice.clip === currentName && current !== undefined) {
          current.loop = choice.loop ? LoopRepeat : LoopOnce;
          return; // already running — do not restart, or it hitches every frame
        }
        const next = mixer.clipAction(clip);
        next.reset();
        next.loop = choice.loop ? LoopRepeat : LoopOnce;
        next.clampWhenFinished = !choice.loop; // a corpse holds its last frame
        // Seek to where the cue says we are, so joining mid-clip looks right.
        next.time = Math.min(choice.since * beatSeconds, clip.duration);
        if (current !== undefined && current !== next) current.crossFadeTo(next, 0.12, false);
        next.play();
        current = next;
        currentName = choice.clip;
      },
      update(delta) {
        mixer.update(delta);
        // AFTER the mixer: it overwrites bone rotations wholesale each frame, so
        // posture applied before would be erased by the clip it is meant to sit on.
        for (const { bone, extra, base } of bones.values()) bone.rotation.x = base + extra;
      },
      dispose() {
        mixer.stopAllAction();
        mixer.uncacheRoot(root);
      },
    };
  }
}
