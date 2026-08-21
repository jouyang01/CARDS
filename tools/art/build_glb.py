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

# World units a clip's root may drift before it counts as root motion. Generous:
# a genuine idle sways a little, a walk cycle travels metres.
ROOT_MOTION_LIMIT = 0.15

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))


def curve_count(action) -> int:
    """Number of F-curves in an action, across Blender's two Action layouts.

    Up to 4.3 an Action owned `fcurves` directly. From 4.4 onward actions are
    "slotted": curves live in layers -> strips -> channelbags. Reading the old
    attribute on a new Blender raises AttributeError.

    This is only used for a progress line, so it must never be able to fail —
    an earlier version let a cosmetic counter kill the whole build.
    """
    try:
        fcurves = getattr(action, "fcurves", None)
        if fcurves is not None:
            return len(fcurves)
        total = 0
        for layer in getattr(action, "layers", []) or []:
            for strip in getattr(layer, "strips", []) or []:
                for bag in getattr(strip, "channelbags", []) or []:
                    total += len(getattr(bag, "fcurves", []) or [])
        return total
    except Exception:
        return -1


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


def root_travel(arm, action):
    """How far the root bone travels over a clip, in world units.

    This is the "In Place" check. A clip exported without it carries root motion,
    which fights the engine for control of position and drifts units off their
    squares — and it looks completely fine in isolation, which is what makes it
    worth catching here rather than in playtesting.

    Sampled from the pose rather than read out of fcurves, so it works the same
    on Blender's old and slotted action layouts.
    """
    try:
        root = None
        for name in ("mixamorig:Hips", "mixamorigHips", "Hips"):
            if name in arm.pose.bones:
                root = arm.pose.bones[name]
                break
        if root is None:
            root = arm.pose.bones[0]

        start, end = (int(round(v)) for v in action.frame_range)
        if end <= start:
            return 0.0

        positions = []
        for frame in (start, (start + end) // 2, end):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            co = (arm.matrix_world @ root.matrix).translation
            positions.append((co.x, co.y))
        xs = [p[0] for p in positions]
        ys = [p[1] for p in positions]
        return max(max(xs) - min(xs), max(ys) - min(ys))
    except Exception:
        return -1.0


def read_glb_animations(path):
    """Animation names actually present in a written GLB, read from its JSON chunk."""
    try:
        import struct
        blob = pathlib.Path(path).read_bytes()
        if blob[:4] != b"glTF":
            return []
        length, _ = struct.unpack_from("<II", blob, 12)
        doc = json.loads(blob[20:20 + length].decode("utf-8"))
        return [a.get("name", "?") for a in doc.get("animations", [])]
    except Exception as exc:
        print(f"  ! could not read back {path}: {type(exc).__name__}: {exc}")
        return []


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
    rooted = []
    for path in fbx:
        if path == base_path:
            continue
        arm, meshes, added = import_fbx(path)
        try:
            action = arm.animation_data.action if arm and arm.animation_data else None
            if action is None:
                print(f"  ! {path.name}: no animation found, skipped")
            else:
                action.name = slug(path.stem)
                action.use_fake_user = True      # survives the armature's deletion
                clips.append(action.name)
                n = curve_count(action)
                travel = root_travel(arm, action)
                flag = ""
                if travel > ROOT_MOTION_LIMIT:
                    flag = f"  <-- ROOT MOTION {travel:.2f}u, re-export In Place"
                    rooted.append(action.name)
                print(f"  clip   {action.name:<24} {n if n >= 0 else '?':>4} curves{flag}")
        except Exception as exc:
            # One bad file must not cost the other seven clips.
            print(f"  ! {path.name}: {type(exc).__name__}: {exc}")
        finally:
            for o in added:
                bpy.data.objects.remove(o, do_unlink=True)

    if not clips:
        print("  ! no clips found. Downloads must be Without Skin, one per clip.")

    if rooted:
        print(f"\n  ! {len(rooted)} clip(s) carry ROOT MOTION: {', '.join(rooted)}")
        print("    The engine owns unit position; a clip that also moves the character")
        print("    fights it and drifts units off their squares. Re-download those from")
        print("    Mixamo with the In Place checkbox ticked.")

    # Every action must be reachable from the base armature or the exporter
    # will not see it.
    if base_arm.animation_data is None:
        base_arm.animation_data_create()

    # Purge everything we did not collect. The FBX importer leaves its own
    # actions behind — "Armature|mixamo.com|Layer0" and friends from the base
    # and from any file that carried more than one — and ACTIONS export mode
    # ships every action in the blend, not just the ones we named. Without this
    # the .glb carries phantom clips the client would have to know to ignore.
    wanted = set(clips)
    strays = [a for a in bpy.data.actions if a.name not in wanted]
    for a in strays:
        bpy.data.actions.remove(a)
    if strays:
        print(f"  purged {len(strays)} stray action(s) left by the importer")

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

    # Read the animations back out of the GLB rather than trusting the export.
    # Blender 4.4+ moved to slotted actions, and an action whose slot the
    # exporter cannot bind is skipped SILENTLY — the file is written, it just has
    # no animations in it. Reporting what actually landed turns that into a loud
    # failure instead of one discovered in the browser.
    exported = read_glb_animations(out)
    size = out.stat().st_size // 1024
    print(f"\n  -> {out}  ({size} kB)")
    print(f"     collected {len(clips)} clip(s), {len(exported)} in the .glb")
    if exported:
        print(f"     {', '.join(sorted(exported))}")
    missing = sorted(set(clips) - set(exported))
    if missing:
        print(f"\n  ! {len(missing)} clip(s) did NOT make it into the .glb:")
        print(f"    {', '.join(missing)}")
        print("    On Blender 4.4+ this is usually a slotted-action binding the")
        print("    exporter could not resolve. The mesh is fine; the clips are not.")
    manifest = out_dir / f"{cid}.clips.json"
    manifest.write_text(json.dumps({"id": cid, "clips": sorted(clips)}, indent=2) + "\n")
    print(f"  -> {manifest.name}")


if __name__ == "__main__":
    main()
