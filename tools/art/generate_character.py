"""
generate_character.py — build a Mixamo-ready character mesh from data/art/<id>.json.

Run headless. Never open Blender's UI:

    blender --background --python tools/art/generate_character.py -- aegis

Builds geometry and assigns UVs against the rectangles in atlas_layout.json.
It never generates textures — paint_atlas.py does that, without Blender.

WHAT THIS GUARANTEES, and why each one matters to Mixamo's auto-rigger:

  1. Clean T-pose        arms exactly along +/-X, legs along -Y. Marker placement
                         depends on the rigger finding limbs where it expects.
  2. L/R symmetry        every part is built once and mirrored. A lopsided mesh
                         confuses skinning.
  3. Limbs separated     explicit gaps at armpit and crotch. Fused limbs are the
                         single most common auto-rig failure.
  4. One mesh, low tris  all body parts joined on export, well under 150k.

The DOOR is exported separately and is NOT part of the rigged upload. A held prop
breaks marker placement and gets skinned to the spine. It attaches to the hand
bone at runtime — see docs/ART_PIPELINE.md §7.

The HUNCH is likewise not baked here. `posture` in the JSON is applied after
rigging as bone offsets, so the T-pose stays symmetric and the asymmetry still
survives every Mixamo clip.
"""

import json
import math
import os
import pathlib
import sys

import bpy  # noqa: F401  (only resolvable inside Blender)
import bmesh
from mathutils import Vector


# ── atlas contract ──────────────────────────────────────────────────────────

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
LAYOUT = json.loads((HERE / "atlas_layout.json").read_text())
ATLAS = LAYOUT["size"]


def uv_rect(region: str):
    """Region pixels -> Blender UV floats.

    Blender's V axis runs bottom-up while the atlas is addressed top-down, so V
    is flipped here. Getting this wrong renders the character upside-down in
    texture space and is maddening to debug from a screenshot.
    """
    x0, y0, x1, y1 = LAYOUT["regions"][region]
    return (x0 / ATLAS, 1.0 - y1 / ATLAS, x1 / ATLAS, 1.0 - y0 / ATLAS)


def swatch_uv(name: str):
    """The centre of one flat-colour cell — a single point every dull face samples."""
    grid = LAYOUT["swatchGrid"]
    order = LAYOUT["swatchOrder"]
    i = order.index(name)
    r, c = divmod(i, grid["cols"])
    x0, y0, x1, y1 = LAYOUT["regions"]["swatches"]
    cw = (x1 - x0) / grid["cols"]
    ch = (y1 - y0) / grid["rows"]
    px = x0 + cw * (c + 0.5)
    py = y0 + ch * (r + 0.5)
    return (px / ATLAS, 1.0 - py / ATLAS)


# ── mesh building ───────────────────────────────────────────────────────────

# Cube face order used throughout: -X, +X, -Y, +Y, -Z, +Z
FACE_KEYS = ("left", "right", "front", "back", "bottom", "top")


def add_box(bm, center, size, uvmap, uv_layer, inset_front=0.0):
    """One axis-aligned box with per-face UV assignment.

    `uvmap` maps each of the six face keys to either a region name (the face gets
    that whole rectangle) or a swatch name (the face collapses to one flat pixel).
    `inset_front` pushes the -Y face inward, which is how the eye sockets get
    their shallow recess without extra geometry.
    """
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)

    corners = [
        (cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
        (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
        (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
        (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz),
    ]
    if inset_front:
        for i in (0, 1, 4, 5):
            x, y, z = corners[i]
            corners[i] = (x, y + inset_front, z)

    verts = [bm.verts.new(c) for c in corners]
    quads = {
        "left":   (0, 3, 7, 4),
        "right":  (1, 5, 6, 2),
        "front":  (0, 4, 5, 1),
        "back":   (3, 2, 6, 7),
        "bottom": (0, 1, 2, 3),
        "top":    (4, 7, 6, 5),
    }

    made = []
    for key in FACE_KEYS:
        idx = quads[key]
        face = bm.faces.new([verts[i] for i in idx])
        made.append(face)
        target = uvmap.get(key, uvmap.get("_default", "iron"))
        if target in LAYOUT["regions"]:
            u0, v0, u1, v1 = uv_rect(target)
            corners_uv = [(u0, v0), (u0, v1), (u1, v1), (u1, v0)]
            for loop, uv in zip(face.loops, corners_uv):
                loop[uv_layer].uv = uv
        else:
            uv = swatch_uv(target)
            for loop in face.loops:
                loop[uv_layer].uv = uv
    return verts, made


AXIS_INDEX = {"x": 0, "y": 1, "z": 2}


def segment(bm, faces, axis, cuts, uv_layer):
    """Add loop cuts across a limb so it can actually deform.

    A limb built from a single box has vertices only at its ends, so when Mixamo
    skins it and the elbow bends, the forearm rotates rigidly and shears at the
    joint. Skin weights need intermediate vertices to blend across. This cuts
    `cuts` loops perpendicular to `axis`, which is the cheapest possible fix —
    a few hundred triangles buys every joint in the body.
    """
    ai = AXIS_INDEX[axis]
    edges = set()
    for f in faces:
        for e in f.edges:
            a, b = e.verts
            delta = [abs(a.co[i] - b.co[i]) for i in range(3)]
            # Keep only edges running ALONG the limb; those are the ones whose
            # subdivision produces rings around it.
            if delta[ai] > 1e-6 and delta[ai] >= max(delta) - 1e-6:
                edges.add(e)
    if not edges:
        return
    bmesh.ops.subdivide_edges(bm, edges=list(edges), cuts=cuts, use_grid_fill=False)


def add_wedge(bm, apex, base_a, base_b, base_c, uv_layer, swatch):
    """A flat-shaded tetrahedron. The nose and brow ridge are made of these —
    ~40 triangles total, and the difference between a 3D head and a decal."""
    vs = [bm.verts.new(p) for p in (apex, base_a, base_b, base_c)]
    uv = swatch_uv(swatch)
    for tri in ((0, 1, 2), (0, 2, 3), (0, 3, 1), (1, 3, 2)):
        try:
            face = bm.faces.new([vs[i] for i in tri])
        except ValueError:
            continue
        for loop in face.loops:
            loop[uv_layer].uv = uv
    return vs


def new_mesh(name):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    return obj, mesh, bm, uv_layer


def finish(obj, mesh, bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_flat()
    return obj


# ── the character ───────────────────────────────────────────────────────────

def build_body(spec):
    b = spec["build"]
    g = spec["garment"]

    h = b["height"]
    head_r = 0.115 * b["headScale"]
    shoulder = 0.20 * b["shoulderWidth"]
    limb = 0.055 * b["limbThickness"]
    depth = 0.115 * b["torsoDepth"]

    hip_z = h * 0.47
    chest_z = h * 0.72
    neck_z = chest_z + 0.10 * b["neckLength"]
    head_z = neck_z + head_r

    obj, mesh, bm, uv = new_mesh("body")

    # ── head ──
    # Front face carries the painted face; back, sides and crown each get their
    # own region, because a 360° camera sees all of them constantly.
    add_box(bm, (0, 0, head_z), (head_r * 1.7, head_r * 1.75, head_r * 2.05), {
        "front": "head_front", "back": "head_back",
        "left": "head_sides", "right": "head_sides",
        "top": "crown", "bottom": "skinShadow",
    }, uv)

    # Supporting geometry so the painted face reads at 45° instead of like a sticker.
    fy = -head_r * 0.875
    add_wedge(bm,
              (0, fy - head_r * 0.34, head_z - head_r * 0.10),
              (-head_r * 0.16, fy, head_z + head_r * 0.20),
              (head_r * 0.16, fy, head_z + head_r * 0.20),
              (0, fy, head_z - head_r * 0.48), uv, "skin")          # nose
    for side in (-1, 1):
        add_wedge(bm,
                  (side * head_r * 0.42, fy - head_r * 0.16, head_z + head_r * 0.46),
                  (side * head_r * 0.10, fy, head_z + head_r * 0.34),
                  (side * head_r * 0.78, fy, head_z + head_r * 0.34),
                  (side * head_r * 0.44, fy, head_z + head_r * 0.62), uv, "skinShadow")  # brow ridge

    # Neck — high collar, so it stays dark from every angle.
    add_box(bm, (0, 0, neck_z - 0.02), (limb * 1.9, limb * 1.9, 0.10), {"_default": "leather"}, uv)
    if g.get("collar") == "high":
        add_box(bm, (0, 0, neck_z + 0.01), (shoulder * 0.62, depth * 1.15, 0.07),
                {"_default": "ironDark"}, uv)

    # ── torso ──
    _, trunk = add_box(bm, (0, 0, (chest_z + hip_z) / 2),
                       (shoulder * 1.55, depth * 2, chest_z - hip_z), {
                           "front": "torso", "back": "torso",
                           "left": "ironDark", "right": "ironDark",
                           "top": "ironDark", "bottom": "ironDark",
                       }, uv)
    segment(bm, trunk, "z", 3, uv)

    if g.get("skirt") == "tassets":
        for side in (-1, 1):
            add_box(bm, (side * shoulder * 0.62, 0, hip_z - 0.11),
                    (shoulder * 0.72, depth * 1.9, 0.24), {"_default": "iron"}, uv)

    # ── arms, in a strict T-pose ──
    # The gap at the armpit is deliberate: fused limbs are the most common reason
    # Mixamo's auto-rigger fails.
    arm_z = chest_z - 0.06
    gap = shoulder * 1.55 / 2 + 0.03
    arm_len = h * 0.30
    for side in (-1, 1):
        pads = g.get("shoulderPads", {})
        heavy = pads.get("left" if side < 0 else "right", "light") == "heavy-riveted"
        pad = 1.55 if heavy else 1.12
        add_box(bm, (side * (gap + 0.03), 0, arm_z + 0.03),
                (limb * 2.4 * pad, limb * 2.4 * pad, limb * 2.2 * pad),
                {"_default": "ironLight" if heavy else "iron"}, uv)
        _, upper = add_box(bm, (side * (gap + 0.06 + arm_len * 0.25), 0, arm_z),
                           (arm_len * 0.5, limb * 2, limb * 2), {"_default": "iron"}, uv)
        segment(bm, upper, "x", 3, uv)
        _, fore = add_box(bm, (side * (gap + 0.06 + arm_len * 0.75), 0, arm_z),
                          (arm_len * 0.5, limb * 1.75, limb * 1.75), {"_default": "leather"}, uv)
        segment(bm, fore, "x", 3, uv)
        add_box(bm, (side * (gap + 0.06 + arm_len + 0.045), 0, arm_z),
                (0.09, limb * 2, limb * 2.2), {"_default": "leather"}, uv)

    # ── legs, with a crotch gap for the same reason ──
    for side in (-1, 1):
        leg_x = side * shoulder * 0.52
        _, thigh = add_box(bm, (leg_x, 0, hip_z * 0.72), (limb * 2.5, limb * 2.5, hip_z * 0.56),
                           {"_default": "ironDark"}, uv)
        segment(bm, thigh, "z", 3, uv)
        _, shin = add_box(bm, (leg_x, 0, hip_z * 0.24), (limb * 2.2, limb * 2.2, hip_z * 0.48),
                          {"_default": "leather"}, uv)
        segment(bm, shin, "z", 3, uv)
        add_box(bm, (leg_x, -0.02, 0.035), (limb * 2.4, limb * 3.4, 0.07),
                {"_default": "ironDark"}, uv)

    return finish(obj, mesh, bm)


def build_door(spec):
    """The prop. Exported on its own — it must not be in the rigged upload."""
    w = spec["weapon"]["mainHand"]
    tile = 1.0
    obj, mesh, bm, uv = new_mesh("door")
    add_box(bm, (0, 0, 0),
            (w["widthTiles"] * tile, w["thickness"] * tile, w["heightTiles"] * tile), {
                "front": "door_face", "back": "door_back",
                "left": "ironDark", "right": "ironDark",
                "top": "ironDark", "bottom": "ironDark",
            }, uv)
    if w.get("hingeRemnants"):
        for z in (w["heightTiles"] * 0.30, -w["heightTiles"] * 0.30):
            add_box(bm, (-w["widthTiles"] * 0.52, 0, z),
                    (w["widthTiles"] * 0.14, w["thickness"] * 1.6, 0.10),
                    {"_default": "rustDeep"}, uv)
    return finish(obj, mesh, bm)


# ── material ────────────────────────────────────────────────────────────────

def attach_material(obj, atlas_path, name):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:            # pre-5.x needed the explicit opt-in
        mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.15
    if os.path.exists(atlas_path):
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(atlas_path)
        tex.interpolation = "Closest"   # flat-shaded look; no bilinear mush
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        print(f"  ! atlas missing at {atlas_path} — run paint_atlas.py first")
    obj.data.materials.append(mat)


# ── entry point ─────────────────────────────────────────────────────────────

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def export_fbx(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=True,
        apply_unit_scale=True,
        global_scale=1.0,
        apply_scale_options="FBX_SCALE_ALL",
        object_types={"MESH"},
        mesh_smooth_type="FACE",
        path_mode="COPY",
        embed_textures=True,
        axis_forward="-Z",
        axis_up="Y",
    )


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        print("usage: blender --background --python tools/art/generate_character.py -- <id>")
        sys.exit(2)
    cid = argv[0]

    spec = json.loads((ROOT / "data" / "art" / f"{cid}.json").read_text())
    out_dir = ROOT / "build" / "art" / cid
    out_dir.mkdir(parents=True, exist_ok=True)
    atlas = str(out_dir / f"{cid}_atlas.png")

    clear_scene()

    body = build_body(spec)
    attach_material(body, atlas, f"{cid}_mat")
    export_fbx([body], out_dir / f"{cid}.fbx")
    print(f"  body  {tri_count(body):>5} tris  ->  {out_dir / f'{cid}.fbx'}")

    if (spec.get("weapon") or {}).get("mainHand"):
        door = build_door(spec)
        attach_material(door, atlas, f"{cid}_door_mat")
        export_fbx([door], out_dir / f"{cid}_door.fbx")
        print(f"  door  {tri_count(door):>5} tris  ->  {out_dir / f'{cid}_door.fbx'}")

    print("\n  Upload ONLY the body FBX (zipped with the atlas PNG) to Mixamo.")
    print("  The door is a prop — it attaches to the hand bone after rigging.")


if __name__ == "__main__":
    main()
