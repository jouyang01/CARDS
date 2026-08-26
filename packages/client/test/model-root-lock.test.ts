import { describe, expect, it } from 'vitest';
import {
  AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack,
  Vector3, VectorKeyframeTrack,
} from 'three';
import { CharacterModels, applyRootLock, measureRootLock } from '../src/character-model.js';

/**
 * MODEL-ROOT-LOCK — **an animation clip never moves a unit off its square.**
 *
 * The engine owns unit position; the renderer places (and during playback lerps)
 * each unit's *group* on its board square. A character clip therefore supplies
 * **in-place** motion only. Wisp is the first model down the Rodin import path
 * and every one of her ten clips breaks that: her Hips carry a large translation
 * baked in a space unrelated to the bind skeleton, `instance()` plays idle the
 * moment she loads, and the mixer flings her off the board. She shipped in
 * PR 180 completely invisible.
 *
 * **The fixture below is Wisp's real geometry**, read out of the shipped
 * `wisp.glb` rather than invented — the `Armature` +90° X rotation, her bind
 * Hips at local `(0.00, 0.14, −1.09)`, and `wisp_idle`'s frame-0 at local
 * `(−0.40, 2.13, 22.52)`. That rotation is the whole trap: it makes local **Z**
 * the world vertical, so her 22.5-unit displacement is *downward*, and any fix
 * phrased as "neutralise the horizontal, keep the vertical" leaves her under the
 * floor. The numbers are in the test so that claim is checkable, not asserted.
 */

/** `Armature` carries a +90° X rotation: local (x, y, z) → world (x, −z, y). */
const ARMATURE_ROT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/** Wisp's bind Hips translation, from the shipped `.glb`. */
const BIND = new Vector3(-0.0010112825548276305, 0.1430729478597641, -1.0919321775436401);
/** `wisp_idle` frame 0, likewise. */
const IDLE_F0 = new Vector3(-0.40, 2.13, 22.52);
/** …and the far end of its Z swing, which is a 13-unit "bob". */
const IDLE_F1 = new Vector3(-0.40, 2.13, 9.94);

/**
 * A rig shaped like Wisp's: model root → Armature (+90° X) → Hips → Spine.
 *
 * The Spine is there so the tests can tell "the root was put back" from "the
 * clip stopped playing" — a lock that froze the whole skeleton would pass every
 * position assertion and be useless.
 */
const rig = (): { root: Group; hips: Bone; spine: Bone } => {
  const root = new Group();
  const armature = new Group();
  armature.name = 'Armature';
  armature.quaternion.copy(ARMATURE_ROT);
  const hips = new Bone();
  // The SANITISED spelling. glTF node names carry a colon (`mixamorig:Hips`)
  // and `GLTFLoader` rewrites both the object and its tracks to `mixamorigHips`
  // — three's `PropertyBinding` parses `node.property` and a raw colon binds to
  // nothing at all, silently. Using the colon form here makes every clip in the
  // fixture a no-op and every assertion below pass for free; that cost twenty
  // minutes once, so it is written down.
  hips.name = 'mixamorigHips';
  hips.position.copy(BIND);
  const spine = new Bone();
  spine.name = 'mixamorigSpine';
  spine.position.set(0, 0.2, 0);
  hips.add(spine);
  armature.add(hips);
  root.add(armature);
  root.updateMatrixWorld(true);
  return { root, hips, spine };
};

/** A clip that displaces the Hips like `wisp_idle` does, and swings the Spine. */
const wispIdle = (): AnimationClip => new AnimationClip('wisp_idle', 1, [
  new VectorKeyframeTrack('mixamorigHips.position', [0, 1], [
    IDLE_F0.x, IDLE_F0.y, IDLE_F0.z,
    IDLE_F1.x, IDLE_F1.y, IDLE_F1.z,
  ]),
  new QuaternionKeyframeTrack('mixamorigSpine.quaternion', [0, 1], [
    0, 0, 0, 1,
    ...new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5).toArray(),
  ]),
]);

/** Advance a mixer, apply the lock, and report the Hips' WORLD position. */
const worldHipsAfter = (
  seconds: number, locked: boolean,
): { world: Vector3; spineX: number } => {
  const { root, hips, spine } = rig();
  const lock = measureRootLock(root);
  const mixer = new AnimationMixer(root);
  mixer.clipAction(wispIdle()).play();
  mixer.update(seconds);
  if (locked) applyRootLock(lock);
  root.updateMatrixWorld(true);
  return { world: hips.getWorldPosition(new Vector3()), spineX: spine.quaternion.x };
};

/** Where the bind pose puts the Hips in world space — the answer we want back. */
const BIND_WORLD = new Vector3(BIND.x, -BIND.z, BIND.y);

describe('MODEL-ROOT-LOCK: the fixture is Wisp’s real geometry', () => {
  it('the Armature rotation makes local Z the WORLD VERTICAL', () => {
    // The measurement the whole item turns on, asserted first so the rest of
    // the file can be read as consequences of it. Through a +90° X rotation a
    // local +Z becomes a world −Y: Wisp's 22.5 is *down*, not sideways.
    const { root, hips } = rig();
    hips.position.set(0, 0, 22.52);
    root.updateMatrixWorld(true);
    const world = hips.getWorldPosition(new Vector3());
    expect(world.y).toBeCloseTo(-22.52, 5);
    expect(Math.hypot(world.x, world.z), 'and nothing horizontal at all').toBeCloseTo(0, 5);
  });

  it('so the bind pose puts her hips a metre UP, which is where hips go', () => {
    const { root, hips } = rig();
    root.updateMatrixWorld(true);
    expect(hips.getWorldPosition(new Vector3()).y).toBeCloseTo(1.0919, 3);
  });
});

describe('MODEL-ROOT-LOCK: the bug, and the lock that closes it', () => {
  it('THE BUG: unlocked, one mixer frame flings the hips 22.5 units below the board', () => {
    // The reported defect, reproduced. `instance()` plays idle on load, so this
    // is the very first frame of Wisp's existence on the board.
    const { world } = worldHipsAfter(0, false);
    expect(world.y, 'under the floor — this is "completely invisible"').toBeCloseTo(-22.52, 2);
    expect(world.distanceTo(BIND_WORLD)).toBeGreaterThan(20);
  });

  it('THE FIX: locked, the hips sit exactly where the bind pose put them', () => {
    const { world } = worldHipsAfter(0, true);
    expect(world.distanceTo(BIND_WORLD), 'back on the tile, at hip height').toBeLessThan(1e-6);
  });

  it('and stays there across the clip, not just on frame one', () => {
    // `wisp_idle` swings 13 units of local Z over its length. Sampling mid-clip
    // is what separates "the lock ran once" from "the lock holds".
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(worldHipsAfter(t, true).world.distanceTo(BIND_WORLD), `t=${t}`).toBeLessThan(1e-6);
    }
  });

  it('THE HORIZONTAL-ONLY FIX WOULD NOT HAVE WORKED — the reason this is not that', () => {
    // Stated as an executable claim because it is the one place this build
    // departs from the ruling as written (edge-cases MODEL-ROOT-LOCK says
    // "neutralise the horizontal, keep the vertical"). Simulate that rule and
    // watch Wisp stay under the floor.
    const { root, hips } = rig();
    const lock = measureRootLock(root)!;
    const mixer = new AnimationMixer(root);
    mixer.clipAction(wispIdle()).play();
    mixer.update(0);
    root.updateMatrixWorld(true);
    // "Keep the animated world Y, restore the bind world X/Z" — in world space,
    // exactly as the ruling specifies.
    const animated = hips.getWorldPosition(new Vector3());
    const horizontalOnly = new Vector3(BIND_WORLD.x, animated.y, BIND_WORLD.z);
    expect(horizontalOnly.y, 'still 22.5 units below the board').toBeCloseTo(-22.52, 2);
    expect(horizontalOnly.distanceTo(BIND_WORLD), 'still invisible').toBeGreaterThan(20);
    // …and the lock that ships does close it.
    applyRootLock(lock);
    root.updateMatrixWorld(true);
    expect(hips.getWorldPosition(new Vector3()).distanceTo(BIND_WORLD)).toBeLessThan(1e-6);
  });
});

describe('MODEL-ROOT-LOCK: the clip still plays', () => {
  it('only the root TRANSLATION is pinned — bone rotations are untouched', () => {
    // The property that keeps this from being "freeze the skeleton". A death
    // still collapses and a flurry still swings; what is discarded is root
    // motion, which this renderer does not use because the unit group carries
    // travel between tiles.
    const still = worldHipsAfter(0, true);
    // 0.9, not 1.0: the clip is 1s and loops, so a full second wraps the action
    // back to frame 0 and the spine reads unrotated again — a sample that would
    // have made this assertion fail for a reason unrelated to the lock.
    const swung = worldHipsAfter(0.9, true);
    expect(still.spineX, 'the clip starts unrotated').toBeCloseTo(0, 5);
    expect(Math.abs(swung.spineX), 'and has visibly moved by the end').toBeGreaterThan(0.2);
    // …while the root did not budge across the same interval.
    expect(still.world.distanceTo(swung.world)).toBeLessThan(1e-6);
  });
});

describe('MODEL-ROOT-LOCK: it is per instance, and it is general', () => {
  it('two instances of one character lock independently', () => {
    // Units are clones, so the lock has to belong to the instance and not to
    // the loaded character — two Wisps on the board must not share one bone.
    const a = rig();
    const b = rig();
    const lockA = measureRootLock(a.root)!;
    const lockB = measureRootLock(b.root)!;
    expect(lockA.bone).not.toBe(lockB.bone);
    b.hips.position.set(50, 50, 50); // only B is displaced
    applyRootLock(lockA);
    applyRootLock(lockB);
    a.root.updateMatrixWorld(true);
    b.root.updateMatrixWorld(true);
    expect(a.hips.getWorldPosition(new Vector3()).distanceTo(BIND_WORLD)).toBeLessThan(1e-6);
    expect(b.hips.getWorldPosition(new Vector3()).distanceTo(BIND_WORLD)).toBeLessThan(1e-6);
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
    expect(pelvis.position.toArray()).toEqual([1, 2, 3]);
  });

  it('a model with no skeleton at all is not an error', () => {
    // Eight of the nine characters have no model and draw a box; a static prop
    // has no bones either. An absent lock has to be ordinary.
    expect(measureRootLock(new Group())).toBeUndefined();
    expect(() => applyRootLock(undefined)).not.toThrow();
  });
});

describe('MODEL-ROOT-LOCK: Aegis, the model that was already correct', () => {
  /**
   * Aegis came down the procedural path and his clips sit **at** bind — his
   * `aegis_idle` Hips track is local `(0, 0, −0.92)` against a bind of
   * `(0, 0.008, −0.95)`. The AC asks for no regression, so this pins that the
   * lock is a no-op for a well-baked clip rather than something he survives.
   */
  const AEGIS_BIND = new Vector3(0, 0.008325105533003807, -0.9525884389877319);
  const AEGIS_IDLE_F0 = new Vector3(0, 0, -0.92);

  it('a clip already at bind moves by less than a centimetre when locked', () => {
    const { root, hips } = rig();
    hips.position.copy(AEGIS_BIND);
    root.updateMatrixWorld(true);
    const lock = measureRootLock(root)!;
    hips.position.copy(AEGIS_IDLE_F0); // what his mixer writes
    root.updateMatrixWorld(true);
    const before = hips.getWorldPosition(new Vector3());
    applyRootLock(lock);
    root.updateMatrixWorld(true);
    const after = hips.getWorldPosition(new Vector3());
    expect(before.distanceTo(after), 'idle reads unchanged').toBeLessThan(0.04);
  });
});

describe('MODEL-ROOT-LOCK: the WIRING — a real ModelInstance, not just the helper', () => {
  /**
   * The helper above is well covered and that was not enough: deleting the
   * `applyRootLock` call from `ModelInstance.update` left the entire 1984-test
   * suite green. `instance()` is where the bug actually lives — it builds the
   * mixer and **plays idle immediately**, which is the frame Wisp vanished on —
   * and nothing could reach it outside a browser until `adopt()` existed.
   */
  const wispModels = (): CharacterModels => {
    const models = new CharacterModels();
    const { root } = rig();
    models.adopt('wisp', {
      scene: root,
      clips: [wispIdle()],
      manifest: {
        id: 'wisp',
        clips: ['wisp_idle'],
        // Only `idle` names a real clip — the rest are the shape `ClipSet`
        // requires and are never played here. Idle is the one that matters:
        // `instance()` starts it on load, which is the frame Wisp vanished on.
        map: {
          idle: 'wisp_idle', run: 'wisp_run', hit: 'wisp_hit',
          death: 'wisp_death', knockback: 'knocked_down', abilities: {},
        },
      },
    });
    return models;
  };

  /** The Hips of a live instance, in world space, after `frames` of animation. */
  const hipsAfter = (inst: NonNullable<ReturnType<CharacterModels['instance']>>, frames: number): Vector3 => {
    for (let i = 0; i < frames; i += 1) inst.update(1 / 60);
    inst.root.updateMatrixWorld(true);
    const hips = inst.root.getObjectByName('mixamorigHips')!;
    return hips.getWorldPosition(new Vector3());
  };

  it('THE ITEM, end to end: instance() plays idle on load and she stays on her tile', () => {
    // The reported bug is "she is completely invisible the moment she loads",
    // and `instance()` playing idle is why. One frame is the whole reproduction.
    const inst = wispModels().instance('wisp')!;
    expect(hipsAfter(inst, 1).distanceTo(BIND_WORLD), 'on the board, frame one')
      .toBeLessThan(1e-6);
  });

  it('and holds through a second of animation', () => {
    const inst = wispModels().instance('wisp')!;
    expect(hipsAfter(inst, 60).distanceTo(BIND_WORLD)).toBeLessThan(1e-6);
  });

  it('THE MUTATION GUARD: without the lock this instance is 20+ units off', () => {
    // Stated as its own assertion so the file records what "broken" measures,
    // and so a future edit that neuters `update()` fails here by name rather
    // than by a browser screenshot nobody takes.
    const { root, hips } = rig();
    const mixer = new AnimationMixer(root);
    mixer.clipAction(wispIdle()).play();
    mixer.update(1 / 60);
    root.updateMatrixWorld(true);
    expect(hips.getWorldPosition(new Vector3()).distanceTo(BIND_WORLD)).toBeGreaterThan(20);
  });

  it('two units of the same character each stay on their own tile', () => {
    // Units are per-instance clones; the lock has to be too. A shared bone
    // would make the second Wisp built drag the first one's hips around.
    const models = wispModels();
    const a = models.instance('wisp')!;
    const b = models.instance('wisp')!;
    a.root.position.set(3, 0, 0); // stand them on different squares
    b.root.position.set(-3, 0, 0);
    for (let i = 0; i < 10; i += 1) { a.update(1 / 60); b.update(1 / 60); }
    a.root.updateMatrixWorld(true);
    b.root.updateMatrixWorld(true);
    const at = (inst: typeof a, dx: number): number => inst.root
      .getObjectByName('mixamorigHips')!
      .getWorldPosition(new Vector3())
      .distanceTo(new Vector3(BIND_WORLD.x + dx, BIND_WORLD.y, BIND_WORLD.z));
    expect(at(a, 3), 'the first Wisp is over her own square').toBeLessThan(1e-6);
    expect(at(b, -3), 'and the second over hers').toBeLessThan(1e-6);
  });
});
