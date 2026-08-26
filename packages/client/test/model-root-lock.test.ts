import { describe, expect, it } from 'vitest';
import {
  AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack,
  Vector3, VectorKeyframeTrack,
} from 'three';
import { CharacterModels, applyRootLock, measureRootLock } from '../src/character-model.js';

/**
 * MODEL-ROOT-LOCK — **a clip may raise and drop a character; it may not walk
 * them off their tile.**
 *
 * The engine owns unit position; the renderer places (and during playback lerps)
 * each unit's *group* on its board square. A character clip therefore supplies
 * **in-place** motion only. Horizontal root travel is cancelled; vertical is
 * kept, because a death that collapses and a crouch that drops are the clip
 * doing its job.
 *
 * **Re-specced (2026-10-08).** The previous version of this file pinned every
 * axis and argued the vertical had to go too, from measurements of the shipped
 * `wisp.glb`: Hips tracks 22 units out, "so any fix phrased as neutralise the
 * horizontal, keep the vertical leaves her under the floor". That was true of
 * that file and the file was broken — the Blender export had corrupted the root
 * translation, and the rebuild (`build_glb_fbx2gltf.py`) put her clips back
 * within 3 cm of bind. Pinning every axis was the right call while the asset
 * was garbage and the wrong one after, which is Dev Note 8: *"Aegis's dying
 * animation makes him float above the board."* His hips were held at standing
 * height while his body folded up underneath them.
 *
 * **Both rigs are real geometry**, read out of the two shipped `.glb` files,
 * and they disagree about which local axis is up — Aegis came through Blender
 * and carries an `Armature` +90° X, so his local **−Z** is the world vertical;
 * Wisp came through fbx2gltf and has no such node, so hers is local **+Y**.
 * That disagreement is the reason the lock measures a basis instead of naming
 * an axis, and it is why both are in this file.
 */

/** Blender's Mixamo export: `Armature` +90° X, so local (x, y, z) → world (x, −z, y). */
const ARMATURE_ROT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/** Aegis's bind Hips translation, from the shipped `aegis.glb`. */
const AEGIS_BIND = new Vector3(0, 0.008325105533003807, -0.9525884389877319);
/** `sword_and_shield_death` frame 0 — standing, about to fall. */
const AEGIS_DEATH_F0 = new Vector3(0, 0, -0.82);
/**
 * …and its last frame: local Z has risen to −0.17 (through the Armature, the
 * hips have dropped from 0.82 to 0.17 — the collapse) while local Y has run out
 * to 1.04 (a metre of world +Z — the fall carrying him sideways).
 */
const AEGIS_DEATH_F1 = new Vector3(-0.31, 1.04, -0.17);

/** Wisp's bind Hips, from the REBUILT `wisp.glb`: metres, Y-up, no Armature. */
const WISP_BIND = new Vector3(-0.00101128255482763, 1.09193217754364, 0.143072947859764);
/** `wisp_death` at the end — Y down to 0.12, and 0.86 of horizontal Z with it. */
const WISP_DEATH_F1 = new Vector3(-0.2, 0.12, -0.86);

/**
 * A rig: model root → [Armature] → Hips → Spine.
 *
 * The Spine is there so the tests can tell "the root was put back" from "the
 * clip stopped playing" — a lock that froze the whole skeleton would pass every
 * position assertion and be useless.
 */
const rig = (bind: Vector3, armature: boolean): { root: Group; hips: Bone; spine: Bone } => {
  const root = new Group();
  let parent: Group = root;
  if (armature) {
    const node = new Group();
    node.name = 'Armature';
    node.quaternion.copy(ARMATURE_ROT);
    root.add(node);
    parent = node;
  }
  const hips = new Bone();
  // The SANITISED spelling. glTF node names carry a colon (`mixamorig:Hips`)
  // and `GLTFLoader` rewrites both the object and its tracks to `mixamorigHips`
  // — three's `PropertyBinding` parses `node.property` and a raw colon binds to
  // nothing at all, silently. Using the colon form here makes every clip in the
  // fixture a no-op and every assertion below pass for free; that cost twenty
  // minutes once, so it is written down.
  hips.name = 'mixamorigHips';
  hips.position.copy(bind);
  const spine = new Bone();
  spine.name = 'mixamorigSpine';
  spine.position.set(0, 0.2, 0);
  hips.add(spine);
  parent.add(hips);
  root.updateMatrixWorld(true);
  return { root, hips, spine };
};

const aegis = (): ReturnType<typeof rig> => rig(AEGIS_BIND, true);
const wisp = (): ReturnType<typeof rig> => rig(WISP_BIND, false);

/** A clip that moves the Hips from `a` to `b` and swings the Spine. */
const clip = (name: string, a: Vector3, b: Vector3): AnimationClip => new AnimationClip(name, 1, [
  new VectorKeyframeTrack('mixamorigHips.position', [0, 1], [a.x, a.y, a.z, b.x, b.y, b.z]),
  new QuaternionKeyframeTrack('mixamorigSpine.quaternion', [0, 1], [
    0, 0, 0, 1,
    ...new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5).toArray(),
  ]),
]);

/** Put a bone at `at`, apply the lock, and report the Hips in WORLD space. */
const lockedAt = (built: ReturnType<typeof rig>, at: Vector3): Vector3 => {
  const lock = measureRootLock(built.root);
  built.hips.position.copy(at);
  applyRootLock(lock);
  built.root.updateMatrixWorld(true);
  return built.hips.getWorldPosition(new Vector3());
};

/**
 * Where the bind pose puts a rig's Hips in world space.
 *
 * Built fresh and read rather than written out by hand, so the two rigs' very
 * different local conventions never have to be transcribed into a constant that
 * could quietly disagree with the fixture.
 */
const worldBind = (build: () => ReturnType<typeof rig>): Vector3 => {
  const built = build();
  return built.hips.getWorldPosition(new Vector3());
};

const AEGIS_BIND_WORLD = worldBind(() => rig(AEGIS_BIND, true));
const WISP_BIND_WORLD = worldBind(() => rig(WISP_BIND, false));

/** How far a world position sits from a bind footprint, ignoring height. */
const flatFrom = (at: Vector3, bind: Vector3): number => Math.hypot(at.x - bind.x, at.z - bind.z);

describe('MODEL-ROOT-LOCK: the fixtures are real geometry, and they disagree about up', () => {
  it('AEGIS: the Armature rotation makes local −Z the world vertical', () => {
    // The measurement the whole item turns on. Through a +90° X rotation a
    // local −Z becomes a world +Y, so his hips stand 0.95 up at bind.
    expect(AEGIS_BIND_WORLD.y).toBeCloseTo(0.9526, 4);
  });

  it('WISP: the rebuilt rig has no Armature at all — local +Y is the vertical', () => {
    // The same character of measurement on the other export path. Two assets,
    // two answers, one lock: this pair is why it may not name an axis.
    expect(WISP_BIND_WORLD.y).toBeCloseTo(1.0919, 4);
  });
});

describe('MODEL-ROOT-LOCK: the vertical survives — Dev Note 8', () => {
  it('THE NOTE: Aegis’s death drops his hips, and the lock lets it', () => {
    // "Aegis's dying animation makes him float above the board." The clip takes
    // his hips from 0.82 to 0.17 as he collapses; a lock that kept him at 0.95
    // is a pelvis standing over a folded body, which is what floating looks like.
    expect(lockedAt(aegis(), AEGIS_DEATH_F1).y, 'collapsed, not standing')
      .toBeCloseTo(0.17, 4);
  });

  it('THE OLD BEHAVIOUR, stated: pinning every axis holds him at full height', () => {
    // What this replaced, executable so the file records what "floating"
    // measures rather than describing it. Restoring the bind translation
    // outright puts the hips back at 0.95 whatever the clip was doing.
    const built = aegis();
    built.hips.position.copy(AEGIS_DEATH_F1);
    built.hips.position.copy(AEGIS_BIND); // the every-axis pin, in one line
    built.root.updateMatrixWorld(true);
    expect(built.hips.getWorldPosition(new Vector3()).y, 'still standing').toBeCloseTo(0.9526, 4);
  });

  it('and the same for Wisp, whose vertical is a different local axis', () => {
    // The generality claim. Nothing about the fix knows that Aegis's up is −Z
    // and Wisp's is +Y; both drop because both bases were measured.
    expect(lockedAt(wisp(), WISP_DEATH_F1).y).toBeCloseTo(0.12, 4);
  });
});

describe('MODEL-ROOT-LOCK: the horizontal does not', () => {
  it('THE RULE: Aegis’s fall carries him a metre sideways, and the lock takes it back', () => {
    // The half that keeps a unit on its square. His death travels 1.04 of world
    // +Z; the locked hips sit over the bind footprint exactly.
    expect(flatFrom(lockedAt(aegis(), AEGIS_DEATH_F1), AEGIS_BIND_WORLD), 'directly over the tile')
      .toBeLessThan(1e-6);
  });

  it('…and Wisp’s, on the other basis', () => {
    expect(flatFrom(lockedAt(wisp(), WISP_DEATH_F1), WISP_BIND_WORLD)).toBeLessThan(1e-6);
  });

  it('THE FAILURE IT PREVENTS: unlocked, that same frame is a metre off the tile', () => {
    // The pairing that makes the two assertions above about the lock rather
    // than about a clip that happened not to travel.
    const built = aegis();
    built.hips.position.copy(AEGIS_DEATH_F1);
    built.root.updateMatrixWorld(true);
    expect(flatFrom(built.hips.getWorldPosition(new Vector3()), AEGIS_BIND_WORLD)).toBeGreaterThan(1);
  });

  it('a clip that only bobs is left alone entirely', () => {
    // No-regression for a well-baked idle: Aegis's sits at local (0, 0, −0.92)
    // against a bind of (0, 0.008, −0.95), which is 3 cm of vertical and no
    // horizontal at all. The lock must not be something he survives.
    const at = lockedAt(aegis(), AEGIS_DEATH_F0);
    expect(at.y, 'the 3 cm is still there').toBeCloseTo(0.82, 4);
    expect(flatFrom(at, AEGIS_BIND_WORLD)).toBeLessThan(1e-6);
  });
});

describe('MODEL-ROOT-LOCK: the clip still plays', () => {
  it('only the root TRANSLATION is touched — bone rotations are untouched', () => {
    // The property that keeps this from being "freeze the skeleton". A death
    // still collapses and a flurry still swings.
    const sample = (seconds: number): { horizontal: number; spineX: number } => {
      const built = aegis();
      const lock = measureRootLock(built.root);
      const mixer = new AnimationMixer(built.root);
      mixer.clipAction(clip('death', AEGIS_DEATH_F0, AEGIS_DEATH_F1)).play();
      mixer.update(seconds);
      applyRootLock(lock);
      built.root.updateMatrixWorld(true);
      const at = built.hips.getWorldPosition(new Vector3());
      return { horizontal: flatFrom(at, AEGIS_BIND_WORLD), spineX: built.spine.quaternion.x };
    };
    // 0.9, not 1.0: the clip is 1s and loops, so a full second wraps the action
    // back to frame 0 and the spine reads unrotated again.
    const still = sample(0);
    const swung = sample(0.9);
    expect(still.spineX, 'the clip starts unrotated').toBeCloseTo(0, 5);
    expect(Math.abs(swung.spineX), 'and has visibly moved by the end').toBeGreaterThan(0.2);
    expect(still.horizontal, 'on the tile at the start').toBeLessThan(1e-6);
    expect(swung.horizontal, 'and on it at the end').toBeLessThan(1e-6);
  });
});

describe('MODEL-ROOT-LOCK: it is per instance, and it is general', () => {
  it('two instances of one character lock independently', () => {
    // Units are clones, so the lock has to belong to the instance and not to
    // the loaded character — two Wisps on the board must not share one bone.
    const a = wisp();
    const b = wisp();
    const lockA = measureRootLock(a.root)!;
    const lockB = measureRootLock(b.root)!;
    expect(lockA.bone).not.toBe(lockB.bone);
    b.hips.position.set(50, 50, 50); // only B is displaced
    applyRootLock(lockA);
    applyRootLock(lockB);
    a.root.updateMatrixWorld(true);
    b.root.updateMatrixWorld(true);
    const flat = (built: ReturnType<typeof rig>): number =>
      flatFrom(built.hips.getWorldPosition(new Vector3()), WISP_BIND_WORLD);
    expect(flat(a)).toBeLessThan(1e-6);
    expect(flat(b), 'B kept its 50 of height and lost its 50 of travel').toBeLessThan(1e-6);
    expect(b.hips.getWorldPosition(new Vector3()).y, 'the vertical half is B’s own').toBeCloseTo(50, 4);
  });

  it('a rig whose root bone is NOT called Hips still gets locked', () => {
    // "Every future imported model immune however its clips were baked" — the
    // fallback is the topmost bone, so a rig from another pipeline is covered
    // without anybody remembering to add its naming convention.
    const root = new Group();
    const pelvis = new Bone();
    pelvis.name = 'root_pelvis';
    pelvis.position.set(1, 2, 3);
    root.add(pelvis);
    const lock = measureRootLock(root);
    expect(lock?.bone, 'found by shape, not by name').toBe(pelvis);
    pelvis.position.set(99, 99, 99);
    applyRootLock(lock);
    expect(pelvis.position.x, 'horizontal, put back').toBeCloseTo(1, 6);
    expect(pelvis.position.z, 'horizontal, put back').toBeCloseTo(3, 6);
    expect(pelvis.position.y, 'vertical, kept').toBeCloseTo(99, 6);
  });

  it('a model with no skeleton at all is not an error', () => {
    // Eight of the nine characters have no model and draw a box; a static prop
    // has no bones either. An absent lock has to be ordinary.
    expect(measureRootLock(new Group())).toBeUndefined();
    expect(() => applyRootLock(undefined)).not.toThrow();
  });
});

describe('MODEL-ROOT-LOCK: the WIRING — a real ModelInstance, not just the helper', () => {
  /**
   * The helper above is well covered and that was not enough: deleting the
   * `applyRootLock` call from `ModelInstance.update` left the entire suite
   * green. `instance()` is where it has to run — it builds the mixer and
   * **plays idle immediately**, so the first frame of a unit's existence is
   * already animated — and nothing could reach it outside a browser until
   * `adopt()` existed.
   */
  const travelling = (): CharacterModels => {
    const models = new CharacterModels();
    models.adopt('aegis', {
      scene: aegis().root,
      clips: [clip('aegis_idle', AEGIS_DEATH_F0, AEGIS_DEATH_F1)],
      manifest: {
        id: 'aegis',
        clips: ['aegis_idle'],
        // Only `idle` names a real clip — the rest are the shape `ClipSet`
        // requires and are never played here. Idle is the one that matters:
        // `instance()` starts it on load.
        map: {
          idle: 'aegis_idle', run: 'r', hit: 'h', death: 'd', knockback: 'k', abilities: {},
        },
      },
    });
    return models;
  };

  /** How far off its own square an instance's hips are, after `frames`. */
  const driftAfter = (models: CharacterModels, frames: number): { flat: number; y: number } => {
    const inst = models.instance('aegis')!;
    for (let i = 0; i < frames; i += 1) inst.update(1 / 60);
    inst.root.updateMatrixWorld(true);
    const at = inst.root.getObjectByName('mixamorigHips')!.getWorldPosition(new Vector3());
    return { flat: flatFrom(at, AEGIS_BIND_WORLD), y: at.y };
  };

  it('THE ITEM, end to end: instance() plays on load and the unit stays on its tile', () => {
    expect(driftAfter(travelling(), 1).flat, 'frame one').toBeLessThan(1e-6);
  });

  it('and holds through a second of animation, while the height still moves', () => {
    // Both halves in one assertion, because either alone has a trivial way to
    // pass: a frozen skeleton holds the tile, and no lock at all moves the height.
    const late = driftAfter(travelling(), 40);
    expect(late.flat, 'still over its square').toBeLessThan(1e-6);
    expect(late.y, 'and has dropped out of the standing pose').toBeLessThan(0.8);
  });

  it('THE MUTATION GUARD: without the lock this instance walks off its square', () => {
    // Stated as its own assertion so the file records what "broken" measures,
    // and so a future edit that neuters `update()` fails here by name rather
    // than by a browser screenshot nobody takes.
    const built = aegis();
    const mixer = new AnimationMixer(built.root);
    mixer.clipAction(clip('idle', AEGIS_DEATH_F0, AEGIS_DEATH_F1)).play();
    mixer.update(0.9);
    built.root.updateMatrixWorld(true);
    expect(flatFrom(built.hips.getWorldPosition(new Vector3()), AEGIS_BIND_WORLD))
      .toBeGreaterThan(0.8);
  });
});
