"""
generate_dagger.py — build Wisp's reversed-grip dagger as an FBX for build_prop.py.

    python3 tools/art/generate_dagger.py -- --id wisp

The procedural roster's weapons are built inside generate_character.py (build_door
is Aegis's, bespoke). Wisp comes from the Rodin import path, which has no weapon
step, so her dagger is generated here instead. One dagger geometry serves BOTH
hands: build_prop.py mounts the same wisp_dagger.glb on the left and right hand
bones with mirrored rotation (data/art/wisp.json weapon.mainHand / offHand).

The dagger is a matte blade: all its UVs map to ONE dark-neutral texel of Wisp's
atlas (sampled at uv≈0.170,0.609, a dark plum-grey), so build_prop.py's atlas
pass paints it a flat cold blade — one accent plus neutrals (brief §5), the metal
staying neutral. Held reversed (icepick), so it is authored blade-UP from the
grip and the attach rotation (180° X) flips it to point down past the fist.
"""

import argparse
import math
import pathlib
import sys

import bpy

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]

BLADE_UV = (0.170, 0.609)   # a dark-neutral atlas texel — see module docstring


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def add_box(name, loc, scale):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    return o


def build_dagger():
    # Authored in ~tiles, grip at the origin. heightTiles in the spec rescales it.
    # primitive_cube_add(size=1) is a UNIT cube, so a scale S gives full length S.
    # Handle (grip): a shaft from z≈-0.14 up to the guard, so the three pieces meet.
    handle = add_box("handle", (0, 0, -0.068), (0.032, 0.032, 0.150))
    # Guard: a small crossbar where the hand meets the blade.
    guard = add_box("guard", (0, 0, 0.010), (0.100, 0.024, 0.020))
    # Blade: a 4-sided cone (square pyramid) tapering to a point, flattened in Y
    # into a blade, rotated 45° so the diamond cross-section faces front/edge.
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.046, radius2=0.0,
                                    depth=0.38, location=(0, 0, 0.205))
    blade = bpy.context.active_object
    blade.name = "blade"
    blade.rotation_euler = (0, 0, math.radians(45))
    blade.scale = (1.0, 0.30, 1.0)     # flatten into a blade

    for o in (handle, guard, blade):
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Join into one mesh.
    bpy.ops.object.select_all(action="DESELECT")
    for o in (handle, guard, blade):
        o.select_set(True)
    bpy.context.view_layer.objects.active = handle
    bpy.ops.object.join()
    dagger = bpy.context.active_object
    dagger.name = "dagger"
    return dagger


def flat_uvs(obj, uv):
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    layer = me.uv_layers.active.data
    for loop in me.loops:
        layer[loop.index].uv = uv


def steel_material(obj):
    # A FLAT material — a cold dark plum-steel, no texture. The weapon slot is
    # marked "flat": true so build_prop.py keeps this instead of embedding the
    # ~1 MB character atlas into a 30-tri blade (which would blow the per-character
    # asset budget). One accent plus neutrals (brief §5); the blade stays neutral.
    mat = bpy.data.materials.new("wisp_dagger_mat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    # sRGB #41404f (the dark-neutral tone sampled from the atlas), as linear.
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    bsdf.inputs["Base Color"].default_value = (lin(0x41), lin(0x40), lin(0x4f), 1.0)
    bsdf.inputs["Roughness"].default_value = 0.5      # a little sheen on the metal
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="generate_dagger")
    ap.add_argument("--id", default="wisp")
    args = ap.parse_args(argv)

    clear()
    dagger = build_dagger()
    flat_uvs(dagger, BLADE_UV)
    steel_material(dagger)
    # Origin at the grip (world origin) so the attach offset places the hand there.
    dagger.location = (0, 0, 0)

    tris = sum(len(p.vertices) - 2 for p in dagger.data.polygons)
    out_dir = ROOT / "build" / "art" / args.id
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{args.id}_dagger.fbx"
    bpy.ops.object.select_all(action="DESELECT")
    dagger.select_set(True)
    bpy.context.view_layer.objects.active = dagger
    bpy.ops.export_scene.fbx(filepath=str(out), use_selection=True,
                             path_mode="COPY", mesh_smooth_type="FACE",
                             add_leaf_bones=False)
    print(f"  dagger  {tris} tris  ->  {out.relative_to(ROOT)}")
    print("  Next: build_prop.py -- {0} mainHand  and  -- {0} offHand".format(args.id))


if __name__ == "__main__":
    main()
