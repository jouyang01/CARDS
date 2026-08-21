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
  /** Absent in manifests written before the map existed — treated as unusable. */
  map?: ClipSet;
  posture?: PostureSpec;
  /** Content hash of the `.glb` beside it. See `modelUrl`. */
  version?: string;
}

/**
 * Where a character's mesh lives, cache-busted by the manifest's version.
 *
 * Vite fingerprints `dist/assets/`; it does NOT fingerprint `public/`, and the
 * models live in `public/models/`. So a re-rigged `aegis.glb` can serve stale
 * from a browser cache while the manifest beside it updates — mesh and manifest
 * then disagree about which clips exist, and the unit stands in bind pose.
 * `build_glb.py` stamps a content hash into the manifest; putting it in the
 * query string makes the URL change exactly when the bytes do.
 */
export function modelUrl(base: string, id: string, version?: string): string {
  const url = `${base}/${id}.glb`;
  return version === undefined || version === '' ? url : `${url}?v=${encodeURIComponent(version)}`;
}

export interface ClipAudit {
  /** False when the model is unusable and the box is the better fallback. */
  usable: boolean;
  /** Every clip the manifest maps that is not actually in the `.glb`. */
  missing: string[];
}

/**
 * Check a manifest's promises against what the `.glb` actually shipped.
 *
 * `usable` turns on the IDLE clip alone, and that asymmetry is the point: idle
 * is what a unit plays whenever nothing else is happening, so a model without it
 * sits in its **bind pose — a literal T-pose on the board**, which reads far more
 * broken than the box it replaced. Any other missing clip costs one animation
 * and nothing else, so it is worth a warning and not a fallback.
 */
export function auditClips(map: ClipSet | undefined, available: readonly string[]): ClipAudit {
  // A manifest written before the map existed, or hand-edited: not a crash, and
  // not a usable model either. Reported as unusable so the caller says so.
  if (map === undefined) return { usable: false, missing: [] };
  const have = new Set(available);
  const wanted = [map.idle, map.run, map.hit, map.death, map.knockback, ...Object.values(map.abilities)];
  return { usable: have.has(map.idle), missing: [...new Set(wanted.filter((n) => !have.has(n)))] };
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
          // `no-cache` revalidates rather than refetches. The manifest is a few
          // hundred bytes and it is the one file that must never be stale,
          // because it carries the version the mesh is then fetched at.
          const res = await fetch(`${base}/${id}.clips.json`, { cache: 'no-cache' });
          if (!res.ok) throw new Error(`manifest ${res.status}`);
          const manifest = (await res.json()) as CharacterManifest;
          // Checked before the mesh is fetched: a manifest with no clip map names
          // nothing to play, so the megabyte behind it would be downloaded only
          // to be discarded. `build_glb.py` writes the map from data/art/<id>.json;
          // one without it was built by an older version of the script.
          if (manifest.map === undefined) {
            throw new Error('the manifest has no clip map — rebuild it with tools/art/build_glb.py');
          }
          const gltf = await loader.loadAsync(modelUrl(base, id, manifest.version));
          const clips = gltf.animations;
          const audit = auditClips(manifest.map, clips.map((c) => c.name));
          if (!audit.usable) throw new Error(`the .glb has no idle clip ("${manifest.map.idle}")`);
          if (audit.missing.length > 0) {
            console.warn(`[cards] ${id}: clip(s) named by the manifest but absent from the .glb — ${audit.missing.join(', ')}`);
          }
          this.loaded.set(id, { scene: gltf.scene as Group, clips, manifest });
        } catch (err) {
          // Ordinary, not exceptional — but not silent either. A character with
          // no art yet and a character whose files 404 because the path is wrong
          // draw the identical box, and only one of the two is fine.
          this.missing.add(id);
          console.warn(`[cards] no model for "${id}", drawing a box: ${String(err)}`);
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

    const inst: ModelInstance = {
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

    // Start idling immediately, before anyone asks.
    //
    // A model with no action playing renders in its BIND POSE — arms straight
    // out, the T-pose Mixamo required for rigging — and that is what shipped:
    // clips were only ever selected during turn playback, so for the whole
    // Decision phase, which is most of a match, every character stood on the
    // board with its arms out. Idle-by-default makes the resting pose a
    // property of having a model rather than of something else remembering.
    const idle = entry.manifest.map?.idle;
    if (idle !== undefined) inst.play({ clip: idle, loop: true, since: 0 }, 1);
    return inst;
  }
}
