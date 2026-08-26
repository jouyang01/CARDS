"""
rodin_bake_lowpoly.py — turn a high-poly TEXTURED mesh (Rodin/Tripo PBR export)
into a smooth, on-budget, textured board token, optionally with a painted
blindfold. This is the pipeline that actually produced Wisp's board asset; the
earlier rodin_import_decimate.py (raw collapse) is kept only for untextured
blockouts and the silhouette test.

    python3 tools/art/rodin_bake_lowpoly.py -- \
        --in  /path/to/wisp_pbr.glb \
        --id  wisp \
        --target 4200 \
        --blindfold --blindfold-band 0.907,0.938

WHY EACH STEP EXISTS (learned the hard way — see docs/DECISIONS.md)
  1. VOXEL REMESH, not collapse. Blind Decimate/COLLAPSE on a scan mesh produces
     spikes and shredded topology at token budget. A voxel remesh rebuilds the
     surface as uniform, even, watertight geometry that reads smooth. Collapse is
     used only afterwards, to trim the remesh output to the exact triangle target.
  2. SHADE SMOOTH. Flat/faceted normals exaggerate every triangle; smooth vertex
     normals remove most of the "low-poly crunch" for free, before any budget cost.
  3. BAKE, don't reuse UVs. Collapse/remesh distort the original UVs, so the
     2048 atlas smears (worst on the face). Re-unwrapping the low mesh (Smart UV)
     and baking the high mesh's DIFFUSE onto it transfers colour faithfully onto
     clean UVs. Baked COLOR-only (no lighting) so it stays flat-lit for Workbench.
  4. PAINT the blindfold into the texture, never as geometry. A geometry band is
     a rigid ellipse that floats where the face recedes and clips where it juts
     (the nose) — it cannot conform. Painting a plum band onto the eye-height
     texels follows the face surface exactly. Done at pixel resolution (each
     texel's true 3D height is tested) and dilated a few px to close UV seams.

BUDGET NOTE (ART_PIPELINE.md §7)
  Default target 4200 tris is ABOVE the roster's ~1800 floor: smoothness costs
  geometry on an organic scan. §7 says propose-and-confirm, not treat as fixed —
  flag this for RND1 confirmation. Push --target lower for the roster number; the
  remesh + smooth-normals keep it smooth, with softer fine detail.

DECOY SAFETY (ART_PIPELINE.md §8)
  Everything here is constant colour/geometry — no state-driven visuals. The
  blindfold is ambient and decoy-safe. Keep it that way.
"""

import argparse
import math
import os
import pathlib
import sys

# llvmpipe software rendering (headless, no GPU). Set before first render.
os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")
os.environ.setdefault("GALLIUM_DRIVER", "llvmpipe")
os.environ.setdefault("EGL_PLATFORM", "surfaceless")

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from mathutils import Vector  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BOARD_BG_LIN = (0.0045, 0.0052, 0.0087, 1.0)  # #12141a in linear


def clear():
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
        raise SystemExit(f"unsupported input: {ext}")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.context.view_layer.objects.active = meshes[0]
    for m in meshes:
        m.select_set(True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def build_lowpoly(high, target, voxel_div):
    """Voxel remesh -> decimate to target -> smooth. Returns the new low object."""
    low = high.copy()
    low.data = high.data.copy()
    bpy.context.scene.collection.objects.link(low)
    low.name = "LOW"
    bpy.context.view_layer.objects.active = low
    vs = [v.co for v in low.data.vertices]
    diag = (Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
            - Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))).length
    rm = low.modifiers.new("rm", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = diag / voxel_div
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    bpy.ops.object.modifier_apply(modifier=rm.name)
    cur = tri_count(low)
    if cur > target:
        dm = low.modifiers.new("dm", "DECIMATE")
        dm.ratio = target / cur
        bpy.ops.object.modifier_apply(modifier=dm.name)
    bpy.ops.object.shade_smooth()
    return low


def unwrap_and_bake(high, low, res):
    """Smart-UV the low mesh, then bake the high mesh's diffuse COLOR onto it."""
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("wisp_baked", res, res)
    mat = bpy.data.materials.new("low_baked")
    mat.use_nodes = True
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    mat.node_tree.nodes.active = tex           # bake target
    low.data.materials.clear()
    low.data.materials.append(mat)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 1
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.cage_extrusion = 0.08
    sc.render.bake.max_ray_distance = 0.15
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_selected_to_active=True)
    # wire the baked image to base color for render + export
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    return img, tex


def paint_blindfold(low, png_path, band, color_hex, front_thresh=0.20, dilate=3):
    """Paint a horizontal band (nz in `band`) onto the front-facing face texels
    of the baked texture PNG, in place.

    Pixel-resolution: each texel's true world height is interpolated per triangle
    and thresholded, so the band edges are clean and follow the face. Dilated a
    few px to close UV-island seams. Operates on the saved PNG via PIL (Blender's
    in-memory image buffer round-trips unreliably). `band` is (lo_nz, hi_nz)."""
    me = low.data
    uv = me.uv_layers.active.data
    M = low.matrix_world
    N = M.to_3x3()
    vs = [M @ v.co for v in me.vertices]
    mnz = min(v.z for v in vs)
    h = max(v.z for v in vs) - mnz
    lo_nz, hi_nz = band
    im = Image.open(png_path).convert("RGB")
    arr = np.array(im)
    H, W = arr.shape[:2]
    col = np.array([int(color_hex.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)], np.uint8)
    mask = np.zeros((H, W), bool)

    # Back-of-skull cutoff (‑Y is front): the band must wrap the head but STOP at
    # the back of the skull, never continuing onto the ponytail behind it. The
    # ponytail skews a Y-range estimate, so size the skull from its X-width (which
    # the ponytail barely affects at eye height) and cut off one head-depth back.
    def _pct(a, p):
        a = sorted(a)
        return a[min(len(a) - 1, max(0, int(p * len(a))))]
    band_vs = [v for v in vs if lo_nz <= (v.z - mnz) / h <= hi_nz]
    if band_vs:
        bxs = [v.x for v in band_vs]
        bys = [v.y for v in band_vs]
        rx = (_pct(bxs, 0.80) - _pct(bxs, 0.20)) / 2      # skull half-width
        y_front = _pct(bys, 0.03)                          # frontmost (face)
        back_cutoff = y_front + 2.4 * rx                   # ~one head-depth back
    else:
        back_cutoff = float("inf")

    def tris(poly):
        idx = list(poly.loop_indices)
        for i in range(1, len(idx) - 1):
            yield (idx[0], idx[i], idx[i + 1])

    for poly in me.polygons:
        n = N @ poly.normal
        if n.length == 0:
            continue
        n.normalize()
        if n.y >= front_thresh:            # front/temple facing only (‑Y is front)
            continue
        for (a, b, c) in tris(poly):
            wp = [M @ me.vertices[me.loops[l].vertex_index].co for l in (a, b, c)]
            zs = [p.z for p in wp]
            if (min(zs) - mnz) / h > hi_nz or (max(zs) - mnz) / h < lo_nz:
                continue
            if sum(p.y for p in wp) / 3 > back_cutoff:     # behind the skull -> ponytail
                continue
            P = [(uv[l].uv[0] * W, (1 - uv[l].uv[1]) * H) for l in (a, b, c)]
            (x0, y0), (x1, y1), (x2, y2) = P
            minx = max(0, int(math.floor(min(x0, x1, x2))))
            maxx = min(W - 1, int(math.ceil(max(x0, x1, x2))))
            miny = max(0, int(math.floor(min(y0, y1, y2))))
            maxy = min(H - 1, int(math.ceil(max(y0, y1, y2))))
            if maxx < minx or maxy < miny:
                continue
            den = ((y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2))
            if abs(den) < 1e-9:
                continue
            gx, gy = np.meshgrid(np.arange(minx, maxx + 1) + 0.5,
                                 np.arange(miny, maxy + 1) + 0.5)
            b0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den
            b1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den
            b2 = 1 - b0 - b1
            z = b0 * wp[0].z + b1 * wp[1].z + b2 * wp[2].z
            nz = (z - mnz) / h
            m = (b0 >= 0) & (b1 >= 0) & (b2 >= 0) & (nz >= lo_nz) & (nz <= hi_nz)
            if m.any():
                mask[miny:maxy + 1, minx:maxx + 1] |= m
    d = mask.copy()
    for _ in range(dilate):
        d = (d | np.roll(d, 1, 0) | np.roll(d, -1, 0)
             | np.roll(d, 1, 1) | np.roll(d, -1, 1))
    arr[d] = col
    Image.fromarray(arr).save(png_path)
    return int(d.sum())


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.color_type = "TEXTURE"
    sh.light = "STUDIO"
    sh.show_object_outline = False
    sc.view_settings.view_transform = "Standard"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("board")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = BOARD_BG_LIN


def render_shots(low, out_dir):
    setup_render()
    vs = [low.matrix_world @ v.co for v in low.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = (lo + hi) / 2
    r = (hi - lo).length
    head = [v for v in vs if (v.z - lo.z) / (hi.z - lo.z) > 0.83]
    hz = (min(v.z for v in head) + max(v.z for v in head)) / 2
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.data.type = "ORTHO"
    out_dir.mkdir(parents=True, exist_ok=True)
    shots = [("front", 35.264, 0, c, r * 0.98),
             ("three-quarter", 35.264, 28, c, r * 0.98),
             ("face", 6, 0, Vector((c.x, c.y, hz)), 0.42)]
    for name, pitch, yaw, tgt, osc in shots:
        cam.data.ortho_scale = osc
        p, y = math.radians(pitch), math.radians(yaw)
        horiz = math.cos(p) * r
        cam.location = Vector((tgt.x + math.sin(y) * horiz,
                               tgt.y - math.cos(y) * horiz,
                               tgt.z + math.sin(p) * r))
        cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.render.resolution_x = 768
        bpy.context.scene.render.resolution_y = 768
        bpy.context.scene.render.filepath = str(out_dir / f"{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="rodin_bake_lowpoly")
    ap.add_argument("--in", dest="infile", required=True, help="high-poly TEXTURED glb/obj/fbx")
    ap.add_argument("--id", default="wisp")
    ap.add_argument("--target", type=int, default=4200, help="triangle budget (see ART_PIPELINE §7)")
    ap.add_argument("--voxel-div", type=float, default=240.0, help="remesh fineness: diag/this")
    ap.add_argument("--bake-res", type=int, default=1024)
    ap.add_argument("--blindfold", action="store_true", help="paint a plum eye band")
    ap.add_argument("--blindfold-band", default="0.907,0.938", help="lo,hi as fractions of height")
    ap.add_argument("--blindfold-color", default="#64404d", help="defaults to the dress plum")
    ap.add_argument("--export-fbx", action="store_true", help="also export a rig-ready FBX")
    args = ap.parse_args(argv)

    infile = pathlib.Path(args.infile).expanduser().resolve()
    if not infile.exists():
        raise SystemExit(f"input not found: {infile}")
    out_dir = ROOT / "build" / "art" / args.id
    out_dir.mkdir(parents=True, exist_ok=True)

    clear()
    high = import_mesh(infile)
    high.name = "HIGH"
    print(f"imported {infile.name}: {tri_count(high):,} tris")
    low = build_lowpoly(high, args.target, args.voxel_div)
    print(f"low-poly: {tri_count(low):,} tris (voxel diag/{args.voxel_div:g} + smooth)")
    img, _ = unwrap_and_bake(high, low, args.bake_res)
    print("baked diffuse onto clean UVs")
    # save the baked texture and the body-only baked mesh
    png = out_dir / f"{args.id}_baked.png"
    img.filepath_raw = str(png)
    img.file_format = "PNG"
    img.save()
    body_glb = out_dir / f"{args.id}_body_baked.glb"
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.export_scene.gltf(filepath=str(body_glb), use_selection=True, export_format="GLB")

    # Reimport the exported body: the glTF roundtrip triangulates the mesh and
    # normalises it into exactly the UV/texel space the texture was baked against.
    # Painting on this reloaded mesh (not the in-session one) is what makes the
    # blindfold land cleanly — the in-session mesh rasterises sparsely.
    clear()
    token = import_mesh(body_glb)
    token.name = "TOKEN"
    tex = None
    for nd in token.data.materials[0].node_tree.nodes:
        if nd.type == "TEX_IMAGE":
            tex = nd
    if args.blindfold:
        lo_nz, hi_nz = (float(x) for x in args.blindfold_band.split(","))
        n = paint_blindfold(token, png, (lo_nz, hi_nz), args.blindfold_color)
        print(f"painted blindfold band nz[{lo_nz},{hi_nz}] ({n} texels)")
    if tex is not None:
        tex.image = bpy.data.images.load(str(png))   # painted (or plain) texture
    low = token

    glb = out_dir / f"{args.id}_token.glb"
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.export_scene.gltf(filepath=str(glb), use_selection=True, export_format="GLB")
    print(f"exported {glb.relative_to(ROOT)}")
    if args.export_fbx:
        fbx = out_dir / f"{args.id}_rig.fbx"
        bpy.ops.export_scene.fbx(filepath=str(fbx), use_selection=True,
                                 path_mode="COPY", embed_textures=True,
                                 add_leaf_bones=False, mesh_smooth_type="FACE")
        print(f"exported {fbx.relative_to(ROOT)} (rig-ready)")

    render_shots(low, out_dir / "token")
    print(f"done. renders in {(out_dir / 'token').relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
