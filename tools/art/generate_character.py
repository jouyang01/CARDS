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


def swatch_cell(name: str):
    """One swatch cell as a UV rect, inset so neighbours cannot bleed in.

    Armour unwraps ACROSS this rect rather than sampling its centre pixel, which
    is what lets a plate carry scratches at all — one pixel cannot be scratched.
    """
    grid = LAYOUT["swatchGrid"]
    i = LAYOUT["swatchOrder"].index(name)
    r, c = divmod(i, grid["cols"])
    x0, y0, x1, y1 = LAYOUT["regions"]["swatches"]
    cw = (x1 - x0) / grid["cols"]
    ch = (y1 - y0) / grid["rows"]
    pad = LAYOUT.get("swatchInset", 4)
    px0, py0 = x0 + cw * c + pad, y0 + ch * r + pad
    px1, py1 = x0 + cw * (c + 1) - pad, y0 + ch * (r + 1) - pad
    return (px0 / ATLAS, 1.0 - py1 / ATLAS, px1 / ATLAS, 1.0 - py0 / ATLAS)


def swatch_uv(name: str):
    """Centre of a swatch cell, for faces too small to be worth unwrapping."""
    u0, v0, u1, v1 = swatch_cell(name)
    return ((u0 + u1) / 2, (v0 + v1) / 2)


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


def finish(obj, mesh, bm, bevel=0.006, smooth_angle=38.0):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    # A perfectly sharp 90° corner reads as a hard black line and is most of why
    # untreated geometry looks like a stack of cubes. A small bevel gives every
    # edge a highlight strip.
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(30.0)
        mod.harden_normals = False

    # Smooth shading above a threshold: curved surfaces round out, genuine
    # corners stay crisp.
    for poly in mesh.polygons:
        poly.use_smooth = True
    if hasattr(mesh, "auto_smooth_angle"):        # Blender < 4.1
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = math.radians(smooth_angle)
    else:                                          # 4.1+ uses a modifier
        try:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
        except Exception:
            pass
    return obj


# ── rounded forms ───────────────────────────────────────────────────────────
#
# The move away from blocky is not "more polygons" — it is cross-sections that
# are not squares and profiles that are not constant. A superellipse
#
#     |x/a|^n + |y/b|^n = 1
#
# is a circle at n=2, a squircle around n=4, and approaches a rectangle as n
# grows. So a single number in data/art/<id>.json takes the whole character from
# rounded to blocky, which is exactly the knob a designer wants.

AXIS_VECTORS = {
    "x": ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
    "y": ((0, 1, 0), (1, 0, 0), (0, 0, 1)),
    "z": ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
}


def superellipse(n_points: int, exponent: float):
    """Unit superellipse as (u, v) pairs. n=2 circle, n≈4 squircle, high n box."""
    pts = []
    for i in range(n_points):
        t = 2.0 * math.pi * i / n_points
        ct, st = math.cos(t), math.sin(t)
        # Signed power keeps the shape symmetric through all four quadrants.
        u = math.copysign(abs(ct) ** (2.0 / exponent), ct)
        v = math.copysign(abs(st) ** (2.0 / exponent), st)
        pts.append((u, v))
    return pts


def add_tube(bm, uv_layer, axis, start, end, profile, swatch,
             sides=10, exponent=4.0, cap_start=True, cap_end=True):
    """A tapered tube between two points, with a superellipse cross-section.

    `profile` is a list of (t, half_width, half_depth) with t running 0→1 along
    the axis, so a limb can swell at the shoulder and narrow at the wrist. This
    replaces the constant-section box that made everything read as stacked
    cubes.
    """
    main, side_a, side_b = AXIS_VECTORS[axis]
    start_v, end_v = Vector(start), Vector(end)
    span = end_v - start_v
    unit = superellipse(sides, exponent)
    u0, v0, u1, v1 = swatch_cell(swatch)

    rings = []
    for t, hw, hd in profile:
        centre = start_v + span * t
        ring = []
        for u, v in unit:
            offset = (Vector(side_a) * (u * hw)) + (Vector(side_b) * (v * hd))
            ring.append(bm.verts.new(centre + offset))
        rings.append(ring)

    ts = [t for t, _, _ in profile]

    def cyl_uv(ring_i, t):
        """Cylindrical unwrap: around the tube -> u, along it -> v."""
        fu = (ring_i % sides) / float(sides)
        return (u0 + (u1 - u0) * fu, v0 + (v1 - v0) * min(max(t, 0.0), 1.0))

    made = []
    for k, (a, b) in enumerate(zip(rings, rings[1:])):
        ta, tb = ts[k], ts[k + 1]
        for i in range(sides):
            j = (i + 1) % sides
            try:
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
            except ValueError:
                continue
            for loop, uv in zip(f.loops, (cyl_uv(i, ta), cyl_uv(i + 1, ta),
                                          cyl_uv(i + 1, tb), cyl_uv(i, tb))):
                loop[uv_layer].uv = uv
            made.append(f)

    centre_uv = ((u0 + u1) / 2, (v0 + v1) / 2)
    for ring, want in ((rings[0], cap_start), (rings[-1], cap_end)):
        if not want:
            continue
        try:
            f = bm.faces.new(ring)
        except ValueError:
            continue
        for loop in f.loops:
            loop[uv_layer].uv = centre_uv
        made.append(f)
    return made


def taper(*stops):
    """Readable shorthand for a profile: taper((0,.9,.9),(1,.6,.6))."""
    return list(stops)


FRONT_ARC = 0.52      # lower = the portrait wraps further around the head
FACE_ZOOM = 1.34      # >1 magnifies the features on the front of the head
FACE_ANCHOR = 0.42    # the v the zoom is centred on: where the features sit


def add_head(bm, uv_layer, centre_z, r, sides=14, exponent=2.7):
    """A rounded head with the painted portrait projected onto its front.

    The head used to be a box, because per-face UV assignment needs a flat quad
    to map a rectangle onto. That constraint is not real: instead of giving one
    face the whole rectangle, project the texture PLANAR-ly from the front, so
    the portrait wraps around the curve the way a face actually sits on a skull.

    Each face picks its projection from its own normal:
      - facing -Y  ->  head_front   (the portrait), projected from the front
      - facing +Y  ->  head_back    (hair), mirrored so it is not reversed
      - facing +/-X ->  head_sides  , projected from the side
      - facing +Z  ->  crown

    One tapered profile then does the work three separate pieces used to: chin,
    jaw, cheekbone, temple, crown.
    """
    bottom = centre_z - r * 0.80
    top = centre_z + r * 1.16
    profile = taper(
        (0.00, r * 0.52, r * 0.54),   # chin
        (0.14, r * 0.74, r * 0.78),   # jaw
        (0.36, r * 0.90, r * 0.93),   # cheekbone, the widest point
        (0.60, r * 0.95, r * 0.95),   # temple
        (0.82, r * 0.88, r * 0.86),
        (1.00, r * 0.58, r * 0.56),   # crown
    )
    faces = add_tube(bm, uv_layer, "z", (0, 0, bottom), (0, 0, top), profile,
                     "skin", sides=sides, exponent=exponent,
                     cap_start=True, cap_end=True)

    half_w = r * 0.95
    half_d = r * 0.95
    span_z = top - bottom

    def place(face, region, axis, flip=False):
        u0, v0, u1, v1 = uv_rect(region)
        for loop in face.loops:
            co = loop.vert.co
            if axis == "z":                       # horizontal cap, seen from above
                fu = (co.x / (2 * half_w)) + 0.5
                fv = (co.y / (2 * half_d)) + 0.5
            else:
                lateral = co.x if axis == "y" else co.y
                fu = (lateral / (2 * (half_w if axis == "y" else half_d))) + 0.5
                fv = (co.z - bottom) / span_z
            if flip:
                fu = 1.0 - fu
            if region == "head_front":
                fu = 0.5 + (fu - 0.5) / FACE_ZOOM
                fv = FACE_ANCHOR + (fv - FACE_ANCHOR) / FACE_ZOOM
            loop[uv_layer].uv = (u0 + (u1 - u0) * min(max(fu, 0.0), 1.0),
                                 v0 + (v1 - v0) * min(max(fv, 0.0), 1.0))

    for face in faces:
        c = face.calc_center_median()
        if c.z > top - span_z * 0.04:
            place(face, "crown", "z")
        elif c.z < bottom + span_z * 0.04:
            place(face, "head_sides", "z")
        elif c.y < 0 and abs(c.y) >= abs(c.x) * FRONT_ARC:
            place(face, "head_front", "y")          # the portrait
        elif c.y > 0 and abs(c.y) >= abs(c.x) * FRONT_ARC:
            place(face, "head_back", "y", flip=True)
        else:
            place(face, "head_sides", "x", flip=c.x < 0)
    return faces


# ── the character ───────────────────────────────────────────────────────────

def build_body(spec):
    b = spec["build"]
    g = spec["garment"]
    style = spec.get("style", {})
    exp = style.get("blockiness", 4.0)      # 2 = round, 4 = squircle, 8+ = boxy
    sides = style.get("sides", 10)

    h = b["height"]
    head_r = 0.115 * b["headScale"]
    shoulder = 0.20 * b["shoulderWidth"]
    limb = 0.055 * b["limbThickness"]
    depth = 0.115 * b["torsoDepth"]

    hip_z = h * 0.505
    chest_z = h * 0.72
    neck_z = chest_z + 0.10 * b["neckLength"]
    head_z = neck_z + head_r

    obj, mesh, bm, uv = new_mesh("body")

    def tube(axis, a, c, profile, swatch, **kw):
        return add_tube(bm, uv, axis, a, c, profile, swatch,
                        sides=sides, exponent=exp, **kw)

    # ── head ──
    # One tapered form, portrait projected onto its front. Was a box plus a
    # bolted-on cranium plus a bolted-on jaw; the taper does all three jobs.
    add_head(bm, uv, head_z, head_r, sides=max(sides, 14), exponent=2.7)

    # Nose and brow ridge still get real geometry — without them the projected
    # portrait reads as a decal at any angle off dead-centre.
    fy = -head_r * 0.80
    add_wedge(bm,
              (0, fy - head_r * 0.19, head_z - head_r * 0.06),
              (-head_r * 0.14, fy, head_z + head_r * 0.16),
              (head_r * 0.14, fy, head_z + head_r * 0.16),
              (0, fy, head_z - head_r * 0.40), uv, "skin")
    # No brow-ridge wedges. They were sized for a flat-faced box; on a curved
    # head they punch through the surface beside each eye and read as spikes.
    # The painted brow is heavy enough to carry it without geometry.

    # ── neck ──
    tube("z", (0, 0, neck_z - 0.08), (0, 0, neck_z + 0.04),
         taper((0.0, limb * 1.60, limb * 1.55),
               (0.5, limb * 1.44, limb * 1.40),
               (1.0, limb * 1.34, limb * 1.30)), "leather")

    # ── torso ──
    # Tapered: wide at the chest, narrow at the waist, deeper at the ribs. This
    # single change kills most of the "stack of cubes" read.
    tube("z", (0, 0, hip_z - 0.02), (0, 0, chest_z + 0.04), taper(
        (0.00, shoulder * 0.62, depth * 0.80),
        (0.22, shoulder * 0.58, depth * 0.76),
        (0.55, shoulder * 0.64, depth * 0.92),
        (0.85, shoulder * 0.72, depth * 0.98),
        (1.00, shoulder * 0.66, depth * 0.86),
    ), "iron")

    # Armour as discrete overlapping plates, not lines painted on a flat slab.
    # Layered pieces are what read as armour at a glance.
    for i, (zt, wide, deep) in enumerate((
        (0.86, 0.66, 1.02), (0.68, 0.62, 1.00), (0.50, 0.56, 0.96),
    )):
        z = hip_z + (chest_z - hip_z) * zt
        tube("z", (0, -depth * 0.20, z - 0.035), (0, -depth * 0.20, z + 0.035),
             taper((0.0, shoulder * wide, depth * deep * 0.42),
                   (1.0, shoulder * wide * 1.04, depth * deep * 0.46)),
             "ironDark" if i % 2 else "ironLight")

    tube("z", (0, 0, hip_z - 0.05), (0, 0, hip_z + 0.02),
         taper((0.0, shoulder * 0.66, depth * 0.86), (1.0, shoulder * 0.68, depth * 0.88)),
         "leather")

    if g.get("collar") == "high":
        tube("z", (0, 0, chest_z - 0.01), (0, 0, chest_z + 0.11),
             taper((0.00, shoulder * 0.74, depth * 0.92),
                   (0.55, shoulder * 0.70, depth * 0.86),
                   (1.00, shoulder * 0.62, depth * 0.74)), "ironDark")

    if g.get("skirt") == "tassets":
        for side in (-1, 1):
            tube("z", (side * shoulder * 0.52, 0, hip_z - 0.24),
                 (side * shoulder * 0.52, 0, hip_z + 0.01),
                 taper((0.0, shoulder * 0.26, depth * 0.60),
                       (1.0, shoulder * 0.30, depth * 0.74)), "iron")

    # ── arms, still a strict T-pose ──
    arm_z = chest_z - 0.05
    gap = shoulder * 0.74
    arm_len = h * 0.255
    for side in (-1, 1):
        pads = g.get("shoulderPads", {})
        heavy = pads.get("left" if side < 0 else "right", "light") == "heavy-riveted"
        pad = 1.5 if heavy else 1.1

        # Pauldron: a dome that overhangs the arm, which is most of what makes a
        # stylised silhouette read as armoured rather than as a tube.
        tube("x", (side * gap * 0.94, 0, arm_z + limb * 0.55),
             (side * (gap + limb * 1.35 * pad), 0, arm_z + limb * 0.30),
             taper((0.0, limb * 1.22 * pad, limb * 1.32 * pad),
                   (0.40, limb * 1.52 * pad, limb * 1.62 * pad),
                   (0.78, limb * 1.44 * pad, limb * 1.52 * pad),
                   (1.0, limb * 1.06 * pad, limb * 1.12 * pad)),
             "iron" if heavy else "ironDark")

        # NOTE: deliberately not `pad`. Joint positions must be mirror-identical
        # on both sides or the auto-rigger builds a lopsided skeleton; only the
        # pauldron's own size varies.
        ax = gap + limb * 0.95 * 1.5
        tube("x", (side * ax, 0, arm_z), (side * (ax + arm_len * 0.52), 0, arm_z),
             taper((0.0, limb * 1.62, limb * 1.62),
                   (0.5, limb * 1.44, limb * 1.44),
                   (1.0, limb * 1.28, limb * 1.28)), "iron")

        bx = ax + arm_len * 0.52
        tube("x", (side * bx, 0, arm_z), (side * (bx + arm_len * 0.52), 0, arm_z),
             taper((0.0, limb * 1.34, limb * 1.34),
                   (0.45, limb * 1.16, limb * 1.16),
                   (1.0, limb * 1.05, limb * 1.05)), "iron")

        cx = bx + arm_len * 0.52
        tube("x", (side * cx, 0, arm_z), (side * (cx + 0.098), 0, arm_z),
             taper((0.00, limb * 1.05, limb * 1.20),
                   (0.30, limb * 1.42, limb * 1.62),
                   (0.72, limb * 1.46, limb * 1.66),
                   (1.00, limb * 1.05, limb * 1.24)), "ironDark")

    # ── legs ──
    for side in (-1, 1):
        lx = side * shoulder * 0.66
        tube("z", (lx, 0, hip_z * 0.46), (lx, 0, hip_z + 0.02), taper(
            (0.0, limb * 1.22, limb * 1.30),
            (0.35, limb * 1.36, limb * 1.44),
            (1.0, limb * 1.58, limb * 1.66),
        ), "ironDark")
        tube("z", (lx, 0, 0.055), (lx, 0, hip_z * 0.48), taper(
            (0.0, limb * 1.02, limb * 1.12),
            (0.45, limb * 1.22, limb * 1.32),
            (1.0, limb * 1.28, limb * 1.36),
        ), "leather")
        # Boot: forward-biased so the foot reads as a foot from above.
        tube("y", (lx, depth * 0.34, 0.042), (lx, -depth * 0.72, 0.042), taper(
            (0.00, limb * 1.16, limb * 1.10),
            (0.45, limb * 1.34, limb * 1.26),
            (0.80, limb * 1.30, limb * 1.16),
            (1.00, limb * 1.02, limb * 0.88),
        ), "ironDark")

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
    return finish(obj, mesh, bm, bevel=0.004)


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
