"""
rodin_prop_lowpoly.py — turn a high-poly TEXTURED hard-surface prop (Rodin/Tripo
PBR export: a weapon, not a body) into a light, on-budget, textured prop asset.

    python3 tools/art/rodin_prop_lowpoly.py -- \
        --in build/art/_rodin_in/vex_rifle_pbr.glb \
        --id vex --kind mainHand \
        --target 2000 --tex-res 512 \
        --emissive build/art/_rodin_in/rifle_unzip/texture_emissive.png

WHY THIS IS NOT rodin_bake_lowpoly.py
  The body baker VOXEL-REMESHES, which rebuilds the surface as smooth organic
  topology — correct for a face, fatal for a rifle: it rounds every hard edge and
  eats thin barrels. A hard-surface prop instead wants PLANAR DISSOLVE (merge
  coplanar faces, keep the crisp silhouette) and its OWN Rodin UVs kept intact, so
  no re-unwrap and no bake are needed — the original diffuse just gets downsized.

  EMISSIVE. A weapon's glowing parts (Vex's amber emitter/heat-sinks) live in the
  separate emissive map Rodin exports. The client renders flat-lit (Workbench), so
  a plain diffuse would drop the glow. We additively composite the emissive into
  the base colour, so the amber reads bright even with no lighting. The actual
  bloom/beam is client VFX (ART_PIPELINE §8/§13); this just keeps the metal amber.

  NO RIG. A prop never goes to Mixamo (ART_PIPELINE §12/§14) — it is parented to a
  hand bone at runtime. This writes geometry + texture only.
"""
import argparse, math, os, pathlib, sys
os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")
os.environ.setdefault("GALLIUM_DRIVER", "llvmpipe")
os.environ.setdefault("EGL_PLATFORM", "surfaceless")
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from mathutils import Vector  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def import_mesh(path):
    ext = path.suffix.lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    else:
        raise SystemExit(f"unsupported input: {ext}")
    ms = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.context.view_layer.objects.active = ms[0]
    for m in ms:
        m.select_set(True)
    if len(ms) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate(obj, target, planar_deg):
    """Planar-dissolve coplanar faces (keeps hard edges + UVs), then collapse to
    the triangle ceiling only if still over."""
    bpy.context.view_layer.objects.active = obj
    d = obj.modifiers.new("planar", "DECIMATE")
    d.decimate_type = "DISSOLVE"
    d.angle_limit = math.radians(planar_deg)
    d.use_dissolve_boundaries = False
    bpy.ops.object.modifier_apply(modifier=d.name)
    cur = tri_count(obj)
    if cur > target:
        c = obj.modifiers.new("collapse", "DECIMATE")
        c.decimate_type = "COLLAPSE"
        c.ratio = target / cur
        bpy.ops.object.modifier_apply(modifier=c.name)
    bpy.ops.object.shade_flat()  # hard-surface: keep facets crisp, no auto-smooth
    return tri_count(obj)


def recenter(obj):
    """Center X/Y on the geometry, drop base to z=0 — a clean local origin for the
    runtime attach offsets to work from."""
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    cx = (min(v.x for v in vs) + max(v.x for v in vs)) / 2
    cy = (min(v.y for v in vs) + max(v.y for v in vs)) / 2
    zmin = min(v.z for v in vs)
    for v in obj.data.vertices:
        v.co.x -= cx
        v.co.y -= cy
        v.co.z -= zmin


def build_texture(obj, out_png, tex_res, emissive_path):
    """Keep the prop's own UVs. Export the packed diffuse, additively composite the
    emissive amber, downsize, and re-wire as a flat matte base colour."""
    diff = bpy.data.images.get("texture_diffuse")
    if diff is None:
        diff = next((i for i in bpy.data.images if i.size[0] > 1), None)
    tmp = out_png.parent / "_diffuse_src.png"
    diff.filepath_raw = str(tmp)
    diff.file_format = "PNG"
    diff.save()
    base = Image.open(tmp).convert("RGB")
    if emissive_path and pathlib.Path(emissive_path).exists():
        em = Image.open(emissive_path).convert("RGB").resize(base.size)
        base = Image.fromarray(
            np.clip(np.asarray(base, np.int16) + np.asarray(em, np.int16), 0, 255).astype(np.uint8))
        print(f"composited emissive: {pathlib.Path(emissive_path).name}")
    base = base.resize((tex_res, tex_res), Image.LANCZOS)
    base.save(out_png)
    tmp.unlink(missing_ok=True)
    # fresh flat material pointing at the composited atlas
    for m in list(obj.data.materials):
        obj.data.materials.clear()
    mat = bpy.data.materials.new(f"{obj.name}_prop")
    mat.use_nodes = True
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(str(out_png))
    tex.image = img
    bsdf = nt.nodes.get("Principled BSDF")
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    obj.data.materials.append(mat)


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sc.view_settings.view_transform = "Standard"
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.05, 0.055, 1)


def render_shots(obj, out_dir):
    setup_render()
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = (lo + hi) / 2
    r = (hi - lo).length
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.data.type = "ORTHO"
    out_dir.mkdir(parents=True, exist_ok=True)
    shots = [("side", 10, 90), ("three-quarter", 30, 55), ("top", 80, 0)]
    for name, pitch, yaw in shots:
        cam.data.ortho_scale = r * 1.02
        p, y = math.radians(pitch), math.radians(yaw)
        horiz = math.cos(p) * r
        cam.location = Vector((c.x + math.sin(y) * horiz, c.y - math.cos(y) * horiz, c.z + math.sin(p) * r))
        cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.render.resolution_x = 768
        bpy.context.scene.render.resolution_y = 768
        bpy.context.scene.render.filepath = str(out_dir / f"{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", required=True)
    ap.add_argument("--id", default="vex")
    ap.add_argument("--kind", default="mainHand")
    ap.add_argument("--target", type=int, default=2000, help="triangle ceiling")
    ap.add_argument("--planar-deg", type=float, default=5.0, help="coplanar dissolve angle")
    ap.add_argument("--tex-res", type=int, default=512)
    ap.add_argument("--emissive", default=None, help="emissive PNG to composite into base colour")
    args = ap.parse_args(argv)

    infile = pathlib.Path(args.infile).expanduser().resolve()
    if not infile.exists():
        raise SystemExit(f"input not found: {infile}")
    out_dir = ROOT / "build" / "art" / args.id
    out_dir.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    obj = import_mesh(infile)
    print(f"imported {infile.name}: {tri_count(obj):,} tris")
    n = decimate(obj, args.target, args.planar_deg)
    print(f"low-poly prop: {n:,} tris (planar {args.planar_deg}deg + collapse)")
    recenter(obj)
    atlas = out_dir / f"{args.id}_{args.kind}_atlas.png"
    build_texture(obj, atlas, args.tex_res, args.emissive)
    print(f"wrote {atlas.relative_to(ROOT)} ({args.tex_res}px)")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    glb = out_dir / f"{args.id}_{args.kind}.glb"
    bpy.ops.export_scene.gltf(filepath=str(glb), use_selection=True, export_format="GLB")
    print(f"exported {glb.relative_to(ROOT)}")
    render_shots(obj, out_dir / f"{args.kind}_prop")
    print(f"done. renders in {(out_dir / (args.kind + '_prop')).relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
