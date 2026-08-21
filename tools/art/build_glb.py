"""
build_glb.py — merge a Mixamo rig and its clips into one .glb for the client.

    blender --background --python tools/art/build_glb.py -- aegis path/to/mixamo/folder

Expects that folder to contain, from Mixamo:
  - exactly one FBX exported **With Skin**   (the rigged mesh, usually "T-Pose")
  - any number exported **Without Skin**     (one clip each)

Clip names come from the filenames, lowercased and slugged, so
"Falling Back Death.fbx" becomes the animation "falling_back_death".

WHY THE SPLIT MATTERS. Every character rigs to the identical Mixamo humanoid
with identical bone names, so a clip is just bone rotations and plays on any of
them. Downloading Without Skin keeps the clips mesh-free, which is what lets one
animation set serve the whole roster instead of one set per character.
"""

import json
import os
import pathlib
import re
import sys

import bpy

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return re.sub(r"_+", "_", s)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                  bpy.data.armatures, bpy.data.actions):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def import_fbx(path):
    """Import one FBX and return what it added to the scene."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(path),
        automatic_bone_orientation=True,   # Mixamo bones need this to line up
        ignore_leaf_bones=True,
    )
    added = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in added if o.type == "ARMATURE"), None)
    meshes = [o for o in added if o.type == "MESH"]
    return arm, meshes, added


def normalise_scale(arm, meshes):
    """Mixamo exports in centimetres; the client works in metres.

    Left alone this lands a 1.7 m character at 170 units tall, which is not
    subtly wrong — it is off the board entirely.
    """
    if arm is None:
        return 1.0
    factor = arm.scale.x
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return factor


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        print("usage: blender --background --python tools/art/build_glb.py "
              "-- <id> <mixamo-folder>")
        sys.exit(2)
    cid, folder = argv[0], pathlib.Path(argv[1]).expanduser()
    if not folder.is_dir():
        print(f"  ! not a folder: {folder}")
        sys.exit(1)

    fbx = sorted(folder.glob("*.fbx")) + sorted(folder.glob("*.FBX"))
    if not fbx:
        print(f"  ! no FBX files in {folder}")
        sys.exit(1)

    clear_scene()

    # ── the skinned base ──
    # Whichever file brings a mesh with it is the With Skin export; the rest are
    # clips. Detecting it beats trusting a filename convention the user did not
    # agree to.
    base_path = base_arm = None
    base_meshes = []
    for path in fbx:
        arm, meshes, added = import_fbx(path)
        if meshes:
            base_path, base_arm, base_meshes = path, arm, meshes
            break
        for o in added:
            bpy.data.objects.remove(o, do_unlink=True)

    if base_arm is None:
        print("  ! no FBX in that folder carried a mesh.\n"
              "    One clip must be downloaded WITH Skin — that is the base.")
        sys.exit(1)

    factor = normalise_scale(base_arm, base_meshes)
    print(f"  base   {base_path.name}  (scale x{factor:.4f} applied)")

    # Keep the base's own pose out of the exported animation list.
    if base_arm.animation_data and base_arm.animation_data.action:
        base_arm.animation_data.action = None

    # ── material ──
    atlas = ROOT / "build" / "art" / cid / f"{cid}_atlas.png"
    if atlas.exists():
        img = bpy.data.images.load(str(atlas))
        for mesh in base_meshes:
            mesh.data.materials.clear()
            mat = bpy.data.materials.new(f"{cid}_mat")
            if mat.node_tree is None:
                mat.use_nodes = True
            bsdf = mat.node_tree.nodes["Principled BSDF"]
            bsdf.inputs["Roughness"].default_value = 0.85
            tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
            tex.image = img
            tex.interpolation = "Closest"
            mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            mesh.data.materials.append(mat)
        print(f"  atlas  {atlas.name} re-applied")
    else:
        print(f"  ! atlas missing at {atlas} — run paint_atlas.py first")

    # ── clips ──
    # Import each clip, steal its action, throw the duplicate armature away. The
    # action retargets for free because the bone names are identical.
    clips = []
    for path in fbx:
        if path == base_path:
            continue
        arm, meshes, added = import_fbx(path)
        action = arm.animation_data.action if arm and arm.animation_data else None
        if action is None:
            print(f"  ! {path.name}: no animation found, skipped")
        else:
            action.name = slug(path.stem)
            action.use_fake_user = True          # survives the armature's deletion
            clips.append(action.name)
            print(f"  clip   {action.name:<24} {len(action.fcurves):>4} curves")
        for o in added:
            bpy.data.objects.remove(o, do_unlink=True)

    if not clips:
        print("  ! no clips found. Downloads must be Without Skin, one per clip.")

    # Every action must be reachable from the base armature or the exporter
    # will not see it.
    if base_arm.animation_data is None:
        base_arm.animation_data_create()

    out_dir = ROOT / "packages" / "client" / "public" / "models"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{cid}.glb"

    bpy.ops.object.select_all(action="DESELECT")
    base_arm.select_set(True)
    for m in base_meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = base_arm

    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",   # one glTF animation per action
        export_apply=False,                # never apply modifiers to a rigged mesh
        export_yup=True,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )

    size = out.stat().st_size // 1024
    print(f"\n  -> {out}  ({size} kB, {len(clips)} clips)")
    manifest = out_dir / f"{cid}.clips.json"
    manifest.write_text(json.dumps({"id": cid, "clips": sorted(clips)}, indent=2) + "\n")
    print(f"  -> {manifest.name}")


if __name__ == "__main__":
    main()
