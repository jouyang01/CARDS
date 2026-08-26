"""
rodin_region_material.py — assign flat, matte materials to an imported mesh by
SPATIAL REGION, and render palette + lit checks against the real board colour.

The second step of the import art path, run AFTER rodin_import_decimate.py and
BEFORE rigging (materials and the skeleton are orthogonal, but colour must come
after any retopo/remesh because that regenerates UVs). It exists because a Rodin
.obj arrives with NO material at all — Wisp's uploaded mesh had mtllib:0,
usemtl:0 — so her colour is added here, fresh.

    python3 tools/art/rodin_region_material.py -- \
        --in  build/art/wisp/wisp_reduced.glb \
        --id  wisp

WHAT "BY REGION" MEANS AND ITS LIMIT
  With no viewport, a texture cannot be hand-painted, and per-UV-island colour
  can't be picked blind. What CAN be done reliably is colour by position: norm_z
  (height) separates hair-crown / torso / legs; distance from the mid-plane and
  from centre separates sash and accents. This produces a correct, matte,
  low-chroma BOARD-TOKEN colour scheme — which is all the token needs, because at
  token scale the face is a few pixels. Facial features and the bored, half-lidded
  expression belong to the PORTRAIT (Deliverable A), never to this mesh texture.

PALETTE (from the character brief §5; data/art/wisp.json is still a stub)
  One saturated accent — cold desaturated PLUM/MAUVE smoke — against low-chroma
  neutrals. Matte only; specular fights the orthographic camera. When
  data/art/wisp.json gains a "palette" block, this script reads it instead of the
  built-in default, so the colours live in data, not code (CLAUDE.md golden rule
  2). The plum is tested against the real board background #12141a, not white.

DECOY SAFETY (ART_PIPELINE.md §8)
  Every colour here is CONSTANT, never state-driven. No wound tint, no charge
  glow — those would make the decoy diverge from the real Wisp and give it away.
  Ambient-only colour is decoy-safe; keep it that way.
"""

import argparse
import json
import math
import os
import pathlib
import sys

os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")
os.environ.setdefault("GALLIUM_DRIVER", "llvmpipe")
os.environ.setdefault("EGL_PLATFORM", "surfaceless")

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]

BOARD_BG = "#12141a"   # the real board background the plum must separate from

# Palette tuned to the owner's reference render: plum wrap + sash, purple hair,
# warm asian skin on every bare part. Migrate into data/art/wisp.json when the
# Designer writes the spec.
DEFAULT_PALETTE = {
    "plum":        "#824f66",   # the wrap/haori and dress — the signature garment
    "plumDeep":    "#6b3f54",   # the sash, one shade down so it reads as tied
    "hair":        "#8a6d9c",   # purple hair; ends drift lighter toward smoke
    "fabric":      "#824f66",   # kept == plum: the garment is one plum, not neutral
    "fabricLight": "#8f5972",   # underlayer / inner wrap, a touch brighter
    "skin":        "#e6c2a5",   # warm asian skin — shoulders, arms, legs, feet
    "skinShadow":  "#c99f82",
    "metal":       "#6d727a",   # reversed daggers — cold matte steel
    "collar":      "#6b3f54",   # high collar of the wrap — plum, one shade down
}

ISO_PITCH = 35.264
TOP_PITCH = 90.0


def hex_to_lin(h):
    """sRGB hex -> linear RGBA, the space Blender material colours want."""
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, 1.0)


def load_palette(cid):
    spec_path = ROOT / "data" / "art" / f"{cid}.json"
    if spec_path.exists():
        spec = json.loads(spec_path.read_text())
        if isinstance(spec.get("palette"), dict) and spec["palette"]:
            print(f"palette: from data/art/{cid}.json")
            return spec["palette"]
    print("palette: built-in default (brief §5) — data/art spec has no palette yet")
    return DEFAULT_PALETTE


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_mesh(path):
    ext = path.suffix.lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    else:
        raise SystemExit(f"unsupported extension: {ext}")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.context.view_layer.objects.active = meshes[0]
    for m in meshes:
        m.select_set(True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def matte_material(name, hexcol):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = hex_to_lin(hexcol)
    # Matte: kill specular, max roughness. Specular fights the fixed ortho camera
    # (brief §5). Input names differ across Blender 4.x/5.x — set what exists.
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    # Also set viewport display colour so Workbench SINGLE/TEXTURE shows it.
    mat.diffuse_color = hex_to_lin(hexcol)
    return mat


def region_of(co_local, dims, lo):
    """Map a vertex to a palette region by position, matching the reference:
    purple hair, skin face, bare skin shoulders/arms/legs/feet, plum wrap + sash.

    The key over the naive height-only split is RADIAL distance from the spine
    (ax): at torso height the arms (skin) and the dress (plum) share a height
    band, so height alone can't tell them apart — lateral distance can. Front/back
    (ny, where -Y is the character's front) separates the skin face from the hair
    behind it. co_local: vertex/centroid; dims:(w,d,h); lo: min corner."""
    w = dims[0] if dims[0] > 1e-6 else 1.0
    d = dims[1] if dims[1] > 1e-6 else 1.0
    h = dims[2] if dims[2] > 1e-6 else 1.0
    nz = (co_local.z - lo.z) / h                    # 0 feet .. 1 crown
    ax = abs(((co_local.x - lo.x) / w - 0.5) * 2)   # 0 spine .. 1 far side
    ny = ((co_local.y - lo.y) / d - 0.5) * 2        # -1 front .. +1 back

    # Height bands follow real human proportions (nz, crown=1, feet=0):
    #   chin ~.87   shoulder ~.82   bust ~.74   waist ~.60   hip ~.50
    #   mid-thigh ~.40   knee ~.28   ankle ~.04

    # HEAD: face (front, below the crown) is skin; crown/back/sides are hair.
    if nz > 0.86:
        if nz < 0.96 and ny < -0.05:
            return "skin"        # the face
        return "hair"            # purple hair

    # NECK: bare, uncovered skin (a thin band above the shoulders, no collar);
    # back and sides of the head above it are hair.
    if nz > 0.82:
        return "hair" if ny > 0.12 else "skin"

    # CHEST + TORSO down to mid-thigh: the plum wrap covers it all, EXCEPT bare
    # shoulders/arms at the sides and a narrow skin V-neck at the centre front.
    if nz > 0.40:
        # bare shoulders and upper arms across the chest band
        if nz > 0.72 and ax > 0.42:
            return "skin"
        # arms hanging at the sides lower down
        if ax > 0.52:
            return "skin"
        # V-NECK: a skin wedge, apex on the sternum (~.72), widening to the throat.
        if nz > 0.72 and ny < -0.02:
            v_halfwidth = 0.16 * (nz - 0.72) / 0.10
            if ax < v_halfwidth:
                return "skin"    # the open V neckline / cleavage
        # the tied sash sits at the waist
        if 0.58 < nz < 0.63:
            return "plumDeep"
        return "plum"            # the wrap dress everywhere else

    # HEM: hands can reach here laterally (skin); dress hem stays central.
    if nz > 0.34:
        return "skin" if ax > 0.52 else "plum"

    # LEGS + FEET: all bare skin.
    return "skin"


def assign_regions(obj, palette):
    me = obj.data
    bpy.context.view_layer.update()
    vs = [obj.matrix_world @ v.co for v in me.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    dims = (hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)

    # One material slot per region key that actually appears.
    order = ["hair", "collar", "skin", "skinShadow", "fabric", "fabricLight",
             "plum", "plumDeep", "metal"]
    me.materials.clear()
    slot_index = {}
    for key in order:
        if key in palette:
            slot_index[key] = len(me.materials)
            me.materials.append(matte_material(f"wisp_{key}", palette[key]))
    fallback = slot_index.get("fabric", 0)

    counts = {}
    for poly in me.polygons:
        # region by the polygon's centroid
        c = obj.matrix_world @ poly.center
        key = region_of(c, dims, lo)
        idx = slot_index.get(key, fallback)
        poly.material_index = idx
        counts[key] = counts.get(key, 0) + 1
    print("region face counts:", {k: counts[k] for k in sorted(counts)})


def setup_render(size, flat):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.color_type = "MATERIAL"
    sh.light = "FLAT" if flat else "STUDIO"   # FLAT = pure albedo, palette check
    sh.show_object_outline = False
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.view_settings.view_transform = "Standard"
    # Board background so the plum is judged in context, not on white (§5).
    scene.render.film_transparent = False
    if scene.world is None:                       # empty-scene startup has none
        scene.world = bpy.data.worlds.new("board")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = hex_to_lin(BOARD_BG)


def place_camera(cam, target, pitch_deg, yaw_deg, radius):
    p, y = math.radians(pitch_deg), math.radians(yaw_deg)
    horiz = math.cos(p) * radius
    cam.location = Vector((
        target.x + math.sin(y) * horiz,
        target.y - math.cos(y) * horiz,
        target.z + math.sin(p) * radius,
    ))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = radius * 1.1
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_checks(obj, out_dir):
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
    out_dir.mkdir(parents=True, exist_ok=True)

    shots = [("palette-iso", ISO_PITCH, 0, True),     # flat albedo vs board bg
             ("lit-iso",     ISO_PITCH, 0, False),    # studio-lit, form + colour
             ("lit-back",    ISO_PITCH, 180, False),
             ("top-down",    TOP_PITCH, 0, False)]
    for name, pitch, yaw, flat in shots:
        setup_render(512, flat)
        place_camera(cam, center, pitch, yaw, radius)
        bpy.context.scene.render.filepath = str(out_dir / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  rendered {name}.png")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="rodin_region_material")
    ap.add_argument("--in", dest="infile", required=True)
    ap.add_argument("--id", default="wisp")
    args = ap.parse_args(argv)

    infile = pathlib.Path(args.infile).expanduser().resolve()
    if not infile.exists():
        raise SystemExit(f"input not found: {infile}")
    out_dir = ROOT / "build" / "art" / args.id

    palette = load_palette(args.id)
    clear_scene()
    obj = import_mesh(infile)
    assign_regions(obj, palette)

    glb = out_dir / f"{args.id}_colored.glb"
    out_dir.mkdir(parents=True, exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=str(glb), use_selection=True,
                              export_format="GLB")
    print(f"Exported {glb.relative_to(ROOT)}")

    render_checks(obj, out_dir / "material")
    print(f"\nDone. Inspect {(out_dir / 'material').relative_to(ROOT)}/")
    print("palette-iso.png judges the plum against the board #12141a; if it "
          "doesn't separate, shift the accent, not the neutrals.")
    print("Region colour is positional and approximate — it is a token scheme, "
          "not a painted texture. The face/expression live in the portrait.")


if __name__ == "__main__":
    main()
