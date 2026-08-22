import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, SkinnedMesh } from 'three';
import { detachMaterials } from '../src/character-model.js';

/**
 * Regression: two units of the same character must not share one material.
 *
 * `SkeletonUtils.clone` copies nodes and bones but hands every clone the *same*
 * material objects. That is invisible until something writes to a material per
 * unit — and two effects do: the deferred-death fade writes `opacity`, and the
 * victim flash writes `emissive`. Shared, one Aegis dying fades both, and one
 * Aegis being hit lights up both.
 */
describe('detachMaterials', () => {
  const meshTree = (shared: MeshStandardMaterial): Group => {
    const root = new Group();
    const mesh = new Mesh(undefined, shared);
    root.add(mesh);
    return root;
  };

  it('DETACH-NOT-SHARED: two subtrees off one source stop sharing a material', () => {
    const shared = new MeshStandardMaterial({ color: 0x445566 });
    const a = meshTree(shared);
    const b = meshTree(shared);

    detachMaterials(a);
    detachMaterials(b);

    const matA = (a.children[0] as Mesh).material as MeshStandardMaterial;
    const matB = (b.children[0] as Mesh).material as MeshStandardMaterial;
    expect(matA).not.toBe(matB);
    expect(matA).not.toBe(shared);
    expect(matB).not.toBe(shared);
  });

  it('DETACH-FLASH-IS-LOCAL: flashing one unit leaves the other dark', () => {
    const shared = new MeshStandardMaterial();
    const victim = meshTree(shared);
    const bystander = meshTree(shared);
    detachMaterials(victim);
    detachMaterials(bystander);

    // What refreshFlash does to the unit that was hit.
    ((victim.children[0] as Mesh).material as MeshStandardMaterial).emissive.setScalar(0.55);

    const dark = ((bystander.children[0] as Mesh).material as MeshStandardMaterial).emissive;
    expect(dark.r).toBe(0);
    expect(dark.g).toBe(0);
    expect(dark.b).toBe(0);
  });

  it('DETACH-FADE-IS-LOCAL: fading one unit leaves the other opaque', () => {
    const shared = new MeshStandardMaterial();
    const dying = meshTree(shared);
    const living = meshTree(shared);
    detachMaterials(dying);
    detachMaterials(living);

    // What refreshOpacity does to a unit part-way through the death fade.
    ((dying.children[0] as Mesh).material as MeshStandardMaterial).opacity = 0.25;

    expect(((living.children[0] as Mesh).material as MeshStandardMaterial).opacity).toBe(1);
  });

  it('DETACH-KEEPS-VALUES: the copy starts out looking like the original', () => {
    const shared = new MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4 });
    const root = meshTree(shared);
    detachMaterials(root);

    const copy = (root.children[0] as Mesh).material as MeshStandardMaterial;
    expect(copy.color.getHex()).toBe(0x8899aa);
    expect(copy.roughness).toBe(0.4);
  });

  it('DETACH-MULTI-MATERIAL: a mesh with a material array detaches every slot', () => {
    const one = new MeshStandardMaterial();
    const two = new MeshStandardMaterial();
    const root = new Group();
    root.add(new Mesh(undefined, [one, two]));

    detachMaterials(root);

    const mats = (root.children[0] as Mesh).material as MeshStandardMaterial[];
    expect(mats).toHaveLength(2);
    expect(mats[0]).not.toBe(one);
    expect(mats[1]).not.toBe(two);
    expect(mats[0]).not.toBe(mats[1]);
  });

  it('DETACH-SKINNED: reaches SkinnedMesh, which is what a rigged body is made of', () => {
    const shared = new MeshStandardMaterial();
    const root = new Group();
    const skinned = new SkinnedMesh(undefined, shared);
    root.add(skinned);

    detachMaterials(root);

    expect(skinned.material).not.toBe(shared);
  });

  it('DETACH-NESTED: reaches meshes below the top level', () => {
    const shared = new MeshStandardMaterial();
    const root = new Group();
    const mid = new Group();
    const deep = new Mesh(undefined, shared);
    mid.add(deep);
    root.add(mid);

    detachMaterials(root);

    expect(deep.material).not.toBe(shared);
  });

  it('DETACH-NO-MESHES: a subtree of bones and groups is left alone', () => {
    const root = new Group();
    root.add(new Group());
    expect(() => detachMaterials(root)).not.toThrow();
  });
});
