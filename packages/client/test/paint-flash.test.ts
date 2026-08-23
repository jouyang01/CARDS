import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, SkinnedMesh } from 'three';
import { FLASH_STRENGTH, paintFlash } from '../src/renderer3d.js';
import { FLASH_SECONDS } from '../src/vfx.js';

/**
 * The victim flash, checked where it actually becomes pixels.
 *
 * `vfx.ts` decides *whether* to flash and `vfx-wiring` proves the app asks the
 * renderer to — but neither says the emissive write lands on the meshes a unit
 * is made of. The renderer proper needs a WebGL context Node has not got, so
 * this is the seam: `paintFlash` is the whole of the decision that turns
 * "flash this unit" into a changed material.
 */
describe('paintFlash', () => {
  const boxBody = (): { body: Object3D; mat: MeshStandardMaterial } => {
    const body = new Group();
    body.name = 'body';
    const mat = new MeshStandardMaterial();
    body.add(new Mesh(undefined, mat));
    return { body, mat };
  };

  /** What a rigged character is: meshes nested under bones, not one mesh. */
  const riggedBody = (): { body: Object3D; mats: MeshStandardMaterial[] } => {
    const body = new Group();
    body.name = 'body';
    const armature = new Group();
    const torso = new MeshStandardMaterial();
    const door = new MeshStandardMaterial();
    armature.add(new SkinnedMesh(undefined, torso));
    const forearm = new Group();
    forearm.add(new Mesh(undefined, door));
    armature.add(forearm);
    body.add(armature);
    return { body, mats: [torso, door] };
  };

  it('FLASH-FULL: a fresh flash lights the mesh to full strength', () => {
    const { body, mat } = boxBody();
    paintFlash(body, FLASH_SECONDS);
    expect(mat.emissive.r).toBeCloseTo(FLASH_STRENGTH, 9);
    expect(mat.emissive.g).toBeCloseTo(FLASH_STRENGTH, 9);
    expect(mat.emissive.b).toBeCloseTo(FLASH_STRENGTH, 9);
  });

  it('FLASH-DECAYS: half the window left is half the light', () => {
    const { body, mat } = boxBody();
    paintFlash(body, FLASH_SECONDS / 2);
    expect(mat.emissive.r).toBeCloseTo(FLASH_STRENGTH / 2, 9);
  });

  it('FLASH-RELEASES: the window running out puts the mesh back to exactly black', () => {
    const { body, mat } = boxBody();
    paintFlash(body, FLASH_SECONDS);
    paintFlash(body, 0);
    expect(mat.emissive.r).toBe(0);
    expect(mat.emissive.g).toBe(0);
    expect(mat.emissive.b).toBe(0);
  });

  it('FLASH-NO-OVERSHOOT: an over-long window still tops out at full strength', () => {
    const { body, mat } = boxBody();
    paintFlash(body, FLASH_SECONDS * 10);
    expect(mat.emissive.r).toBeCloseTo(FLASH_STRENGTH, 9);
  });

  it('FLASH-NO-NEGATIVE: an overshot decay does not drive emissive below black', () => {
    const { body, mat } = boxBody();
    paintFlash(body, -1);
    expect(mat.emissive.r).toBe(0);
  });

  it('FLASH-WHOLE-BODY: a rigged character lights up everywhere, not just the torso', () => {
    const { body, mats } = riggedBody();
    paintFlash(body, FLASH_SECONDS);
    for (const mat of mats) expect(mat.emissive.r).toBeCloseTo(FLASH_STRENGTH, 9);
  });

  it('FLASH-MULTI-MATERIAL: every slot of a multi-material mesh lights', () => {
    const body = new Group();
    const one = new MeshStandardMaterial();
    const two = new MeshStandardMaterial();
    body.add(new Mesh(undefined, [one, two]));
    paintFlash(body, FLASH_SECONDS);
    expect(one.emissive.r).toBeCloseTo(FLASH_STRENGTH, 9);
    expect(two.emissive.r).toBeCloseTo(FLASH_STRENGTH, 9);
  });

  it('FLASH-SKIPS-UNLIT: a material with no emissive is left alone, not crashed on', () => {
    const body = new Group();
    const basic = new MeshBasicMaterial();
    body.add(new Mesh(undefined, basic));
    expect(() => paintFlash(body, FLASH_SECONDS)).not.toThrow();
  });

  it('FLASH-IS-A-CYCLE: flashing then releasing leaves the body as it was found', () => {
    const { body, mats } = riggedBody();
    const before = mats.map((m) => m.emissive.getHex());
    paintFlash(body, FLASH_SECONDS);
    expect(mats.some((m) => m.emissive.getHex() !== 0)).toBe(true);
    paintFlash(body, 0);
    expect(mats.map((m) => m.emissive.getHex())).toEqual(before);
  });
});
