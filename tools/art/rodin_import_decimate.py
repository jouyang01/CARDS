"""
rodin_import_decimate.py — bring an externally-generated mesh (Rodin, Tripo,
Meshy, a scan) down to the roster's triangle budget, and render a turnaround so
you can see what survived.

This is the FIRST step of the "import" art path — the parallel to the procedural
path in generate_character.py. The procedural roster is built from
data/art/<id>.json and is already on-budget; an imported mesh arrives at 20-100x
budget with scan topology, so it has to be inspected and reduced before anything
else (retopo before rigging, always — you rig the final mesh).

    # runs under bpy-as-a-module (no Blender binary needed):
    python3 tools/art/rodin_import_decimate.py -- \
        --in  /path/to/rodin.obj \
        --id  wisp \
        --target 1800 \
        --method collapse

    # or, if a Blender binary is present, identically:
    blender --background --python tools/art/rodin_import_decimate.py -- --in ... --id wisp

WHAT IT DOES
  1. Imports the mesh and prints an honest report: triangles, verts, bounds,
     whether it has UVs, loose geometry, and how far over budget it is.
  2. Reduces it to --target triangles by one of two methods:
       collapse  — a Decimate/COLLAPSE modifier. Fast, keeps UVs, but on scan
                   topology it produces stretched triangles. Fine for a blockout
                   / silhouette proxy, NOT a substitute for real retopo.
       remesh    — voxel remesh (uniform quad-ish topology, deforms far better)
                   then decimate to hit the exact count. UVs are DISCARDED by the
                   remesh, so this is for geometry you will re-unwrap and texture.
  3. Exports the reduced mesh to build/art/<id>/<id>_reduced.glb.
  4. Renders a turnaround at the game's real camera angles (from preview.py:
     iso 35.264 deg, a shallow 8 deg, and 90 deg top-down) plus a true
     token-scale frame — the only honest test of whether a detail survives at the
     size Wisp actually renders on the board (ART_PIPELINE.md D-Deliverable B).

WHAT IT DELIBERATELY DOES NOT DO
  No rigging, no materials, no smoke geometry. Those come after you have accepted
  a reduced base. Decimation is lossy on scan meshes; treat the output as a proxy
  to judge the silhouette, and reach for true retopo (quad draw / a remesh pass +
  cleanup) if the token read fails the top-down test.
"""

import argparse
import math
import os
import pathlib
import sys

# llvmpipe software rendering — this container has no GPU. Set before the first
# render context is created. Harmless where a real GPU exists.
os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")
os.environ.setdefault("GALLIUM_DRIVER", "llvmpipe")
os.environ.setdefault("EGL_PLATFORM", "surfaceless")

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]

# Camera angles copied from preview.py so the import path and the procedural path
# are judged through the identical lens. Keep these in sync with preview.py.
ISO_PITCH = 35.264   # renderer3d.ts:58 — the true isometric angle
LOW_PITCH = 8.0      # renderer3d.ts:62 — below this the board is edge-on
TOP_PITCH = 90.0
SHOTS = [
    ("iso-front",   ISO_PITCH,   0),
    ("iso-right",   ISO_PITCH,  90),
    ("iso-back",    ISO_PITCH, 180),
    ("low-profile", LOW_PITCH,  90),
    ("top-down",    TOP_PITCH,   0),
]

# The repo's own budget: Aegis is 1,772 triangles (ART_PIPELINE.md ~line 1037).
DEFAULT_TARGET = 1800


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_mesh(path: pathlib.Path):
    ext = path.suffix.lower()
    if ext == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    elif ext == ".stl":
        bpy.ops.wm.stl_import(filepath=str(path))
    else:
        raise SystemExit(f"unsupported input extension: {ext}")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("no mesh found in the imported file")
    # Join everything into one object — the roster ships a single mesh per char.
    bpy.context.view_layer.objects.active = meshes[0]
    for m in meshes:
        m.select_set(True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def tri_count(obj) -> int:
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def report(obj, label: str):
    me = obj.data
    tris = tri_count(obj)
    vs = [obj.matrix_world @ v.co for v in me.vertices]
    xs = [v.x for v in vs]
    ys = [v.y for v in vs]
    zs = [v.z for v in vs]
    dims = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    has_uv = bool(me.uv_layers)
    print(f"--- {label} ---")
    print(f"  triangles : {tris:,}")
    print(f"  vertices  : {len(me.vertices):,}")
    print(f"  uv layers : {len(me.uv_layers)} ({'present' if has_uv else 'NONE'})")
    print(f"  materials : {len(me.materials)}")
    print(f"  bounds WxDxH: {dims[0]:.3f} x {dims[1]:.3f} x {dims[2]:.3f}")
    return tris, dims


def normalize_to_height(obj, target_height=1.72):
    """Scale + drop so the model stands ~1.72 tiles tall with feet at z=0, the
    convention the procedural bodies use, so the shared camera framing lands."""
    bpy.context.view_layer.update()
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    zs = [v.z for v in vs]
    height = max(zs) - min(zs)
    if height > 1e-6:
        obj.scale *= target_height / height
    bpy.context.view_layer.update()
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    obj.location.z -= min(v.z for v in vs)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)


def reduce_collapse(obj, target: int):
    cur = tri_count(obj)
    ratio = min(1.0, target / max(1, cur))
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)


def reduce_remesh(obj, target: int):
    # Voxel remesh gives uniform topology that deforms cleanly (good pre-rig),
    # but discards UVs. Pick a voxel size from the bounds, then collapse to hit
    # the exact count.
    bpy.context.view_layer.update()
    vs = [v.co for v in obj.data.vertices]
    diag = (Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
            - Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))).length
    mod = obj.modifiers.new("remesh", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = max(diag / 96.0, 1e-4)   # ~96 voxels across the diagonal
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if tri_count(obj) > target:
        reduce_collapse(obj, target)


def cleanup(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def setup_render(size: int):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "SINGLE"          # flat clay — geometry judged without color
    sh.single_color = (0.8, 0.8, 0.82)
    sh.show_object_outline = False
    scene.render.film_transparent = True
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.view_settings.view_transform = "Standard"


def place_camera(cam, target, pitch_deg, yaw_deg, radius):
    p, y = math.radians(pitch_deg), math.radians(yaw_deg)
    horiz = math.cos(p) * radius
    cam.location = Vector((
        target.x + math.sin(y) * horiz,
        target.y - math.cos(y) * horiz,   # -Y is the character's front
        target.z + math.sin(p) * radius,
    ))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = radius * 1.1
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_turnaround(obj, out_dir: pathlib.Path, size=512):
    bpy.context.view_layer.update()
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    center = (lo + hi) / 2
    radius = (hi - lo).length
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    setup_render(size)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, pitch, yaw in SHOTS:
        place_camera(cam, center, pitch, yaw, radius)
        bpy.context.scene.render.filepath = str(out_dir / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  rendered {name}.png")
    # True token scale: frame the whole board-ish area so the unit is tiny, the
    # only honest readability test (ART_PIPELINE.md Deliverable B).
    place_camera(cam, center, ISO_PITCH, 0, radius * 6)
    bpy.context.scene.render.resolution_x = 96
    bpy.context.scene.render.resolution_y = 96
    bpy.context.scene.render.filepath = str(out_dir / "token-scale.png")
    bpy.ops.render.render(write_still=True)
    print("  rendered token-scale.png (96px)")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="rodin_import_decimate")
    ap.add_argument("--in", dest="infile", required=True)
    ap.add_argument("--id", default="wisp")
    ap.add_argument("--target", type=int, default=DEFAULT_TARGET,
                    help=f"target triangle count (roster budget ~{DEFAULT_TARGET})")
    ap.add_argument("--method", choices=["collapse", "remesh"], default="collapse")
    ap.add_argument("--no-normalize", action="store_true",
                    help="skip rescaling to 1.72-tile height")
    args = ap.parse_args(argv)

    infile = pathlib.Path(args.infile).expanduser().resolve()
    if not infile.exists():
        raise SystemExit(f"input not found: {infile}")
    out_dir = ROOT / "build" / "art" / args.id

    clear_scene()
    obj = import_mesh(infile)
    tris0, _ = report(obj, f"IMPORTED  {infile.name}")
    if tris0 <= args.target:
        print(f"\nAlready at/under budget ({tris0:,} <= {args.target:,}); skipping reduction.")
    else:
        over = tris0 / args.target
        print(f"\n{over:.1f}x over the {args.target:,}-tri budget — reducing by '{args.method}'.")
        if not args.no_normalize:
            normalize_to_height(obj)
        if args.method == "remesh":
            reduce_remesh(obj, args.target)
        else:
            reduce_collapse(obj, args.target)
        cleanup(obj)
        report(obj, "REDUCED")

    out_dir.mkdir(parents=True, exist_ok=True)
    glb = out_dir / f"{args.id}_reduced.glb"
    for o in bpy.context.scene.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=str(glb), use_selection=True,
                              export_format="GLB")
    print(f"\nExported {glb.relative_to(ROOT)}")

    render_turnaround(obj, out_dir / "turnaround")
    print(f"\nDone. Inspect: {(out_dir / 'turnaround').relative_to(ROOT)}/")
    print("Judge the top-down.png and token-scale.png first — if you can't tell "
          "it's Wisp there, decimation lost the silhouette and you need true retopo.")


if __name__ == "__main__":
    main()
