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

import { strideTimeScale, type ClipChoice, type ClipSet } from './character-clips.js';

/** What `build_glb.py` writes next to each `.glb`. */
export interface CharacterManifest {
  id: string;
  clips: string[];
  /** Absent in manifests written before the map existed — treated as unusable. */
  map?: ClipSet;
  posture?: PostureSpec;
  /** Content hash of the `.glb` beside it. See `modelUrl`. */
  version?: string;
  /** Weapons and held objects, parented to bones at load. */
  props?: PropSpec[];
}

/**
 * A prop that rides a bone.
 *
 * Props are NOT in the rigged upload — Mixamo places its auto-rig markers off
 * the silhouette, and a held object either fails that placement or gets skinned
 * to the spine. So the body is rigged alone and the prop is parented afterwards,
 * which is also why adding one costs no re-rig.
 */
export interface PropSpec {
  slot: string;
  file: string;
  version?: string;
  /** Mixamo bone name, e.g. `mixamorigLeftForeArm`. */
  bone: string;
  /** Authored size, in TILES, like the rest of the art spec. */
  heightTiles?: number;
  /** Offset in the bone's local space, in tiles. */
  position?: [number, number, number];
  /** XYZ degrees. */
  rotation?: [number, number, number];
}

/**
 * How big a prop must be in its bone's local space to end up `heightTiles` tall
 * on the board.
 *
 * A prop hangs inside the character's own scaled space: the renderer scales the
 * whole model so the BODY stands MODEL_HEIGHT_TILES high, and everything
 * parented to a bone inherits that. So a door authored at 1.55 tiles would come
 * out 1.55 x modelScale tiles unless the model's scale is divided back out —
 * which is what makes a prop's size independent of how tall its owner happens
 * to be, and keeps the art spec talking in tiles.
 */
export function propLocalScale(
  authoredHeight: number,
  heightTiles: number | undefined,
  tile: number,
  modelScale: number,
): number {
  if (heightTiles === undefined || authoredHeight <= 0 || modelScale <= 0) return 1;
  return (tile * heightTiles) / authoredHeight / modelScale;
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

/** A loaded prop's own height, in the units it was authored in. */
const measuredHeight = (root: Object3D): number => {
  let min = Infinity;
  let max = -Infinity;
  root.traverse((o) => {
    const geometry = (o as { geometry?: { boundingBox: { min: { y: number }; max: { y: number } } | null; computeBoundingBox: () => void } }).geometry;
    if (geometry === undefined) return;
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) return;
    min = Math.min(min, box.min.y);
    max = Math.max(max, box.max.y);
  });
  return max > min ? max - min : 0;
};

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
  /**
   * Parent, size and place the props, once the caller knows how much the body
   * was scaled by.
   *
   * Deliberately NOT done in `instance()`. The renderer decides that scale by
   * measuring the model it has just been handed, and the measurement walks the
   * whole tree — so a prop attached before it is measured as part of the body,
   * and the character shrinks to keep man-plus-door at the target height.
   */
  attachProps(modelScale: number, tile: number): void;
  /** Play a choice, seeking rather than restarting if it is already running. */
  play(choice: ClipChoice, beatSeconds: number): void;
  /** Advance the mixer, then re-apply posture on top of whatever it wrote. */
  update(deltaSeconds: number): void;
  dispose(): void;
}

export class CharacterModels {
  private readonly loaded = new Map<string, {
    scene: Group;
    clips: AnimationClip[];
    manifest: CharacterManifest;
    /** slot -> the prop's scene and its authored height, for `propLocalScale`. */
    props: Map<string, { scene: Group; height: number }>;
  }>();
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
          // Props are best-effort: a character whose door 404s is still a
          // character. Failing the whole model over a missing prop would trade
          // a visible gap for an invisible one.
          const props = new Map<string, { scene: Group; height: number }>();
          for (const spec of manifest.props ?? []) {
            try {
              const url = spec.version === undefined || spec.version === ''
                ? `${base}/${spec.file}`
                : `${base}/${spec.file}?v=${encodeURIComponent(spec.version)}`;
              const propGltf = await loader.loadAsync(url);
              const scene = propGltf.scene as Group;
              props.set(spec.slot, { scene, height: measuredHeight(scene) });
            } catch (err) {
              console.warn(`[cards] ${id}: prop "${spec.slot}" did not load: ${String(err)}`);
            }
          }
          this.loaded.set(id, { scene: gltf.scene as Group, clips, manifest, props });
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

    // Props are cloned per instance like the body: two Aegises must not share
    // one door, or the second to be built steals it off the first.
    const props: { root: Object3D; spec: PropSpec; height: number; bone: Bone }[] = [];
    for (const spec of entry.manifest.props ?? []) {
      const loadedProp = entry.props.get(spec.slot);
      const bone = findBone(root, spec.bone);
      if (loadedProp === undefined) continue;
      if (bone === undefined) {
        console.warn(`[cards] ${characterId}: no bone "${spec.bone}" for prop "${spec.slot}"`);
        continue;
      }
      // Cloned now, PARENTED LATER. The renderer measures the body to decide
      // its scale, and that measurement walks the whole tree — a door attached
      // here counts as part of the man, so he shrinks until man-plus-door is
      // MODEL_HEIGHT_TILES tall. Attaching in `attachProps`, after the scale is
      // known, keeps the body the thing being sized.
      props.push({ root: this.cloneFn(loadedProp.scene), spec, height: loadedProp.height, bone });
    }

    let current: AnimationAction | undefined;
    let currentName = '';

    const inst: ModelInstance = {
      root,
      attachProps(modelScale, tile) {
        for (const { root: propRoot, spec, height, bone } of props) {
          propRoot.scale.setScalar(propLocalScale(height, spec.heightTiles, tile, modelScale));
          // Offsets are authored in tiles too, so they need the same conversion:
          // one tile of bone-local space is `tile / modelScale` units.
          const perTile = modelScale > 0 ? tile / modelScale : 1;
          const [px, py, pz] = spec.position ?? [0, 0, 0];
          propRoot.position.set(px * perTile, py * perTile, pz * perTile);
          const [rx, ry, rz] = spec.rotation ?? [0, 0, 0];
          const rad = (d: number): number => (d * Math.PI) / 180;
          propRoot.rotation.set(rad(rx), rad(ry), rad(rz));
          bone.add(propRoot);
        }
      },
      play(choice, beatSeconds) {
        const clip = byName.get(choice.clip);
        if (clip === undefined) return;
        if (choice.clip === currentName && current !== undefined) {
          current.loop = choice.loop ? LoopRepeat : LoopOnce;
          return; // already running — do not restart, or it hitches every frame
        }
        const next = mixer.clipAction(clip);
        next.reset();
        // Locomotion has to keep up with the board rather than with itself: the
        // engine moves a unit one tile per beat, and a clip authored at some
        // other cadence will take the wrong number of steps to cross it.
        next.timeScale = choice.stride === undefined
          ? 1
          : strideTimeScale(clip.duration, choice.stride, beatSeconds);
        next.loop = choice.loop ? LoopRepeat : LoopOnce;
        next.clampWhenFinished = !choice.loop; // a corpse holds its last frame
        // Seek to where the cue says we are, so joining mid-clip looks right —
        // through the time scale, because `since` counts BEATS of ground time
        // and the clip is no longer advancing one second per second.
        next.time = Math.min(choice.since * beatSeconds * next.timeScale, clip.duration);
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
