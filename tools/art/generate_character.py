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

# Which palette/magic keys the swatch cells hold, in grid order. Aegis's set is
# the default in atlas_layout.json; a character with a different material story
# (Wisp's fabric-and-smoke instead of Aegis's iron-and-rust) declares its own
# `swatchOrder` in data/art/<id>.json. set_swatch_order() points the whole module
# at the right list before any geometry is built, so swatch_cell() indexes into
# the same order paint_atlas.py painted. Same grid (4×3) either way — a character
# may use up to 12 cells; unused trailing cells just repeat the last colour.
ACTIVE_SWATCH_ORDER = LAYOUT["swatchOrder"]


def set_swatch_order(spec: dict) -> None:
    global ACTIVE_SWATCH_ORDER
    ACTIVE_SWATCH_ORDER = spec.get("swatchOrder", LAYOUT["swatchOrder"])


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
    i = ACTIVE_SWATCH_ORDER.index(name)
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
    for stop in profile:
        t, hw, hd = stop[0], stop[1], stop[2]
        shift = stop[3] if len(stop) > 3 else 0.0
        centre = start_v + span * t + Vector(side_b) * shift
        ring = []
        for u, v in unit:
            offset = (Vector(side_a) * (u * hw)) + (Vector(side_b) * (v * hd))
            ring.append(bm.verts.new(centre + offset))
        rings.append(ring)

    ts = [stop[0] for stop in profile]

    def cyl_uv(ring_i, t):
        """Cylindrical unwrap: around the tube -> u, along it -> v.

        NO modulo on ring_i. The VERTEX index wraps — face `sides-1` closes the
        ring back onto vertex 0 — but its UV must not. Wrapping the UV made the
        closing quad run u from (sides-1)/sides straight back to 0, squeezing the
        whole texture cell backwards into a single face: a bright seam stripe
        down the length of every arm, leg and torso.
        """
        fu = ring_i / float(sides)
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


FRONT_ARC = 0.46      # lower = the portrait wraps further around the head
FACE_ZOOM = 1.52      # >1 magnifies the features on the front of the head
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
    # (t, half-width across, half-depth front-to-back, backward shift)
    #
    # Above the occiput the radius falls off on a circular arc — sqrt(1 - u^2) —
    # and converges near zero at the crown. A single jump from a wide ring to the
    # cap leaves a flat disc on top of the skull, because add_tube closes a tube
    # with an n-gon whatever radius the last ring happens to be.
    profile = taper(
        (0.000, r * 0.46, r * 0.56, -r * 0.04),   # chin — narrow, pushed forward
        (0.140, r * 0.66, r * 0.80,  r * 0.00),   # jaw
        (0.340, r * 0.84, r * 1.02,  r * 0.03),   # cheekbone — widest across
        (0.560, r * 0.90, r * 1.10,  r * 0.07),   # temple — deepest
        (0.760, r * 0.86, r * 1.04,  r * 0.11),   # occiput — the skull's overhang
        (0.856, r * 0.77, r * 0.93,  r * 0.11),   # dome begins
        (0.928, r * 0.62, r * 0.75,  r * 0.10),
        (0.972, r * 0.45, r * 0.55,  r * 0.09),
        (0.994, r * 0.27, r * 0.33,  r * 0.08),
        (1.000, r * 0.10, r * 0.12,  r * 0.07),   # crown — all but a point
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
    # Point the swatch helpers at this character's material set before any
    # geometry is built. Aegis has none, so it falls back to the layout default
    # and his output is unchanged.
    set_swatch_order(spec)

    # Garment archetype dispatch. The head, the T-pose skeleton and the anatomy
    # rules validate.py enforces are shared; what changes between characters is
    # the surface — plate versus an open wrap. Each archetype is its own builder
    # so adding one never risks the others (golden rule #2: a new mechanic gets a
    # generic, reusable implementation rather than a special case bolted on).
    if spec.get("garment", {}).get("kind") == "wrap":
        return build_body_wrap(spec)

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
        kw.setdefault("sides", sides)
        kw.setdefault("exponent", exp)
        return add_tube(bm, uv, axis, a, c, profile, swatch, **kw)

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
    tube("z", (0, 0, hip_z - 0.05), (0, 0, chest_z + 0.04), taper(
        (0.00, shoulder * 0.86, depth * 0.84),   # pelvis — the legs hang INSIDE this
        (0.10, shoulder * 0.92, depth * 0.88),
        (0.30, shoulder * 0.62, depth * 0.76),   # waist
        (0.60, shoulder * 0.66, depth * 0.92),
        (0.88, shoulder * 0.74, depth * 0.98),   # chest
        (1.00, shoulder * 0.68, depth * 0.86),
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
        tube("z", (0, 0, chest_z - 0.02), (0, 0, chest_z + 0.072),
             taper((0.00, shoulder * 0.76, depth * 0.94),
                   (0.55, shoulder * 0.72, depth * 0.88),
                   (1.00, shoulder * 0.64, depth * 0.76)), "ironDark")

    if g.get("skirt") == "tassets":
        for side in (-1, 1):
            tube("z", (side * shoulder * 0.60, 0, hip_z - 0.22),
                 (side * shoulder * 0.60, 0, hip_z + 0.01),
                 taper((0.0, shoulder * 0.24, depth * 0.58),
                       (1.0, shoulder * 0.30, depth * 0.76)), "iron")

    # ── arms, still a strict T-pose ──
    #
    # The shoulder sits at the TOP of the ribcage, not partway down it. arm_z was
    # 0.05 below chest height, which put the joint at 81% up the torso and read
    # as arms sprouting from the middle of the chest.
    arm_z = chest_z + 0.005
    gap = shoulder * 0.76           # the shoulder joint, at the torso's edge
    arm_len = h * 0.224             # tuned so a lowered fingertip reaches mid-thigh
    for side in (-1, 1):
        pads = g.get("shoulderPads", {})
        heavy = pads.get("left" if side < 0 else "right", "light") == "heavy-riveted"
        pad = 1.28 if heavy else 1.0

        # Pauldron: a CAP over the top of the shoulder, not a sleeve around it.
        # The previous one had a cross-section radius of 0.207 against a torso
        # half-depth of 0.130 — 0.41 tall, nearly the height of the whole torso —
        # so it swallowed the shoulder and punched out the front and back. It is
        # small now, and offset upward so it covers the top of the joint and
        # leaves the underside of the arm clear.
        pz = arm_z + limb * 0.40
        tube("x", (side * gap * 0.82, 0, pz), (side * (gap + limb * 1.78), 0, pz - limb * 0.30),
             taper((0.00, limb * 1.02 * pad, limb * 0.76 * pad),
                   (0.34, limb * 1.42 * pad, limb * 1.02 * pad),
                   (0.66, limb * 1.50 * pad, limb * 1.06 * pad),
                   (0.86, limb * 1.44 * pad, limb * 0.98 * pad),
                   (1.00, limb * 1.08 * pad, limb * 0.66 * pad)),
             "iron" if heavy else "ironDark")

        # Upper arm starts clear of the torso; the pauldron above bridges the gap.
        ax = gap + limb * 1.02
        seg = arm_len * 0.52
        # cap_start False: that end is buried inside the pauldron, and a capped
        # buried end is an interior face — it costs triangles and casts shadow.
        tube("x", (side * ax, 0, arm_z), (side * (ax + seg), 0, arm_z),
             taper((0.0, limb * 1.26, limb * 1.26),
                   (0.5, limb * 1.14, limb * 1.14),
                   (1.0, limb * 1.02, limb * 1.02)), "iron",
             cap_start=False, cap_end=False)

        bx = ax + seg
        tube("x", (side * bx, 0, arm_z), (side * (bx + seg), 0, arm_z),
             taper((0.0, limb * 1.10, limb * 1.10),
                   (0.16, limb * 1.04, limb * 1.04),
                   (0.45, limb * 0.92, limb * 0.92),
                   (1.0, limb * 0.84, limb * 0.84)), "leather",
             cap_start=False, cap_end=False)

        # Hand: a rounded mitt. It read as blocky because it inherited the
        # armour's superellipse exponent; a hand is the one part with no flat
        # planes at all, so it gets a near-elliptical section and more stops.
        cx = bx + seg
        tube("x", (side * cx, 0, arm_z), (side * (cx + 0.105), 0, arm_z),
             taper((0.00, limb * 0.80, limb * 0.92),
                   (0.18, limb * 1.04, limb * 1.26),
                   (0.46, limb * 1.14, limb * 1.42),
                   (0.72, limb * 1.10, limb * 1.36),
                   (0.90, limb * 0.92, limb * 1.10),
                   (1.00, limb * 0.62, limb * 0.72)), "ironDark",
             exponent=2.1, sides=max(sides, 12))

    # ── legs ──
    for side in (-1, 1):
        lx = side * shoulder * 0.435
        tube("z", (lx, 0, hip_z * 0.46), (lx, 0, hip_z + 0.02), taper(
            (0.0, limb * 1.14, limb * 1.22),
            (0.35, limb * 1.28, limb * 1.36),
            (1.0, limb * 1.45, limb * 1.52),
        ), "ironDark")
        tube("z", (lx, 0, 0.055), (lx, 0, hip_z * 0.48), taper(
            (0.0, limb * 0.96, limb * 1.06),
            (0.45, limb * 1.14, limb * 1.24),
            (1.0, limb * 1.20, limb * 1.28),
        ), "leather")
        # Boot: forward-biased so the foot reads as a foot from above.
        tube("y", (lx, depth * 0.34, 0.042), (lx, -depth * 0.72, 0.042), taper(
            (0.00, limb * 0.94, limb * 1.06),
            (0.45, limb * 1.06, limb * 1.22),
            (0.80, limb * 1.02, limb * 1.12),
            (1.00, limb * 0.80, limb * 0.86),
        ), "ironDark")

    return finish(obj, mesh, bm)


def build_body_wrap(spec):
    """The `wrap` archetype: an open haori over a minimal underlayer, bare
    shoulders and legs, a high closed collar, and long hair that trails behind.

    Built for the same Mixamo T-pose and the same anatomy spec validate.py
    enforces — the skeleton placement mirrors the plate builder, which is why the
    proportion checks pass unchanged — but the surface is fabric and skin instead
    of iron, and there are no pauldrons or plates. The costume's central idea (a
    silhouette that dissolves into smoke) is carried by ambient VFX, not mesh:
    the mesh is a solid, riggable body; the smoke lives in the client's
    ambient-motion layer so the decoy can mimic it (docs/design/wisp.md §8).
    """
    b = spec["build"]
    g = spec["garment"]
    style = spec.get("style", {})
    exp = style.get("blockiness", 4.0)
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
        kw.setdefault("sides", sides)
        kw.setdefault("exponent", exp)
        return add_tube(bm, uv, axis, a, c, profile, swatch, **kw)

    # ── head ──
    add_head(bm, uv, head_z, head_r, sides=max(sides, 14), exponent=2.7)

    # A smaller, softer nose wedge than Aegis's — a lighter face. Still real
    # geometry, or the projected portrait reads as a decal off-centre.
    fy = -head_r * 0.82
    add_wedge(bm,
              (0, fy - head_r * 0.14, head_z - head_r * 0.10),
              (-head_r * 0.10, fy, head_z + head_r * 0.10),
              (head_r * 0.10, fy, head_z + head_r * 0.10),
              (0, fy, head_z - head_r * 0.34), uv, "skin")

    # ── neck ── bare skin; the collar overlaps its lower half.
    tube("z", (0, 0, neck_z - 0.08), (0, 0, neck_z + 0.04),
         taper((0.0, limb * 1.30, limb * 1.26),
               (0.5, limb * 1.18, limb * 1.14),
               (1.0, limb * 1.10, limb * 1.06)), "skin")

    # ── torso ── feminine taper: hip flare, a narrow waist, a modest bust.
    # Swatch is the minimal underlayer, since the haori is open down the front.
    tube("z", (0, 0, hip_z - 0.05), (0, 0, chest_z + 0.04), taper(
        (0.00, shoulder * 0.78, depth * 0.80),   # pelvis — legs hang INSIDE this
        (0.12, shoulder * 0.86, depth * 0.86),   # widest hip
        (0.34, shoulder * 0.50, depth * 0.64),   # waist — cinched
        (0.56, shoulder * 0.58, depth * 0.86),   # bust underline
        (0.72, shoulder * 0.64, depth * 0.98),   # bust
        (0.90, shoulder * 0.58, depth * 0.78),   # upper chest
        (1.00, shoulder * 0.50, depth * 0.62),   # clavicle / bare shoulders
    ), "underlayer")

    # ── high closed collar ── the load-bearing costume piece. A closed ring
    # around the throat, standing up to just under the jaw. Covered throat over
    # exposed torso is what reads as a chosen costume (bible §4).
    tube("z", (0, 0, chest_z + 0.00), (0, 0, chest_z + 0.105),
         taper((0.00, shoulder * 0.56, depth * 0.72),
               (0.55, shoulder * 0.50, depth * 0.62),
               (1.00, shoulder * 0.44, depth * 0.52)), "haoriDark")

    # ── open haori ── two panels down the back and sides that never meet in
    # front, so the underlayer and skin show down the centre and the robe trails
    # behind her. This is most of the top-down silhouette (bible §7).
    for side in (-1, 1):
        px = side * shoulder * 0.52
        tube("z", (px, depth * 0.34, hip_z - 0.30), (px, depth * 0.30, chest_z + 0.02),
             taper((0.00, shoulder * 0.34, depth * 0.30),
                   (0.20, shoulder * 0.40, depth * 0.34),
                   (0.70, shoulder * 0.44, depth * 0.30),
                   (1.00, shoulder * 0.40, depth * 0.26)),
             "haori", cap_start=True, cap_end=False)
    # A yoke across the shoulders at the back joins the two panels, so the robe
    # reads as one open garment rather than two loose strips.
    tube("x", (-shoulder * 0.60, depth * 0.30, chest_z - 0.02),
         (shoulder * 0.60, depth * 0.30, chest_z - 0.02),
         taper((0.0, shoulder * 0.16, depth * 0.30),
               (0.5, shoulder * 0.18, depth * 0.34),
               (1.0, shoulder * 0.16, depth * 0.30)), "haoriDark",
         cap_start=False, cap_end=False)

    # ── one asymmetric sash ── a band at the waist, with a knot on sashSide.
    # The asymmetry is the tell that the outfit was chosen and arranged.
    waist_z = hip_z + (chest_z - hip_z) * 0.30
    tube("z", (0, 0, waist_z - 0.055), (0, 0, waist_z + 0.055),
         taper((0.0, shoulder * 0.54, depth * 0.70),
               (0.5, shoulder * 0.56, depth * 0.72),
               (1.0, shoulder * 0.54, depth * 0.70)), "sash")
    knot = 1 if g.get("sashSide", "right") == "right" else -1
    add_box(bm, (knot * shoulder * 0.52, -depth * 0.30, waist_z),
            (shoulder * 0.20, depth * 0.34, 0.11), {"_default": "sash"}, uv)
    # A short tail of the sash hanging from the knot.
    tube("z", (knot * shoulder * 0.52, -depth * 0.32, waist_z - 0.22),
         (knot * shoulder * 0.52, -depth * 0.30, waist_z),
         taper((0.0, shoulder * 0.09, 0.02), (1.0, shoulder * 0.12, 0.03)),
         "sash", cap_end=False)

    # ── hair ── a long mass behind the head and down the upper back. Real
    # geometry so it reads in the top-down silhouette (bible §7); the ENDS
    # resolving into smoke are VFX, not mesh. Centred on x, so it is symmetric and
    # never trips the landmark check.
    tube("z", (0, head_r * 0.30, chest_z - 0.10), (0, head_r * 0.86, head_z + head_r * 0.60),
         taper((0.00, head_r * 0.70, head_r * 0.30),   # tail end (fades to smoke)
               (0.30, head_r * 0.95, head_r * 0.42),
               (0.62, head_r * 1.15, head_r * 0.52),   # widest — behind the shoulders
               (0.86, head_r * 1.05, head_r * 0.66),   # behind the head
               (1.00, head_r * 0.80, head_r * 0.70)),  # crown
         "hair", cap_start=False, cap_end=True)

    # ── arms ── bare skin, slim, no pauldron. Same T-pose placement as the plate
    # builder so the shoulder-height, arm-reach and armpit-gap checks hold.
    arm_z = chest_z + 0.005
    gap = shoulder * 0.86
    arm_len = h * 0.224
    for side in (-1, 1):
        ax = gap + limb * 0.60
        seg = arm_len * 0.52
        # Upper arm.
        tube("x", (side * ax, 0, arm_z), (side * (ax + seg), 0, arm_z),
             taper((0.0, limb * 1.06, limb * 1.06),
                   (0.5, limb * 0.96, limb * 0.96),
                   (1.0, limb * 0.86, limb * 0.86)), "skin",
             cap_start=True, cap_end=False)
        # Forearm.
        bx = ax + seg
        tube("x", (side * bx, 0, arm_z), (side * (bx + seg), 0, arm_z),
             taper((0.0, limb * 0.90, limb * 0.90),
                   (0.45, limb * 0.80, limb * 0.80),
                   (1.0, limb * 0.70, limb * 0.70)), "skin",
             cap_start=False, cap_end=False)
        # Hand: a rounded mitt, near-elliptical section like the plate builder's.
        cx = bx + seg
        tube("x", (side * cx, 0, arm_z), (side * (cx + 0.09), 0, arm_z),
             taper((0.00, limb * 0.66, limb * 0.78),
                   (0.18, limb * 0.86, limb * 1.06),
                   (0.46, limb * 0.94, limb * 1.18),
                   (0.72, limb * 0.90, limb * 1.12),
                   (0.90, limb * 0.76, limb * 0.92),
                   (1.00, limb * 0.50, limb * 0.60)), "skin",
             exponent=2.1, sides=max(sides, 12))

    # ── legs ── a short covered upper thigh (underlayer), bare skin below, a
    # small foot. Legs hang inside the pelvis; feet stay separated and near the
    # floor.
    for side in (-1, 1):
        lx = side * shoulder * 0.435
        # Upper thigh — short shorts / covered hem.
        tube("z", (lx, 0, hip_z * 0.70), (lx, 0, hip_z + 0.02), taper(
            (0.0, limb * 1.14, limb * 1.22),
            (1.0, limb * 1.30, limb * 1.40),
        ), "underlayer")
        # Thigh (skin) below the hem.
        tube("z", (lx, 0, hip_z * 0.46), (lx, 0, hip_z * 0.72), taper(
            (0.0, limb * 1.02, limb * 1.10),
            (1.0, limb * 1.16, limb * 1.24),
        ), "skin", cap_start=False, cap_end=False)
        # Shin (skin).
        tube("z", (lx, 0, 0.055), (lx, 0, hip_z * 0.48), taper(
            (0.0, limb * 0.72, limb * 0.80),
            (0.45, limb * 0.92, limb * 1.02),
            (1.0, limb * 1.04, limb * 1.12),
        ), "skin", cap_start=False, cap_end=False)
        # Foot: forward-biased so it reads as a foot from above. Dark — a sandal.
        tube("y", (lx, depth * 0.30, 0.040), (lx, -depth * 0.66, 0.040), taper(
            (0.00, limb * 0.80, limb * 0.92),
            (0.45, limb * 0.92, limb * 1.06),
            (0.80, limb * 0.88, limb * 0.98),
            (1.00, limb * 0.66, limb * 0.72),
        ), "haoriDark")

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


def build_dagger(spec, w):
    """A single dagger, built blade-up and centred on the grip so the runtime
    attach offsets place it. Wisp carries one in each hand — the same mesh is
    hung off both hand bones (docs/ART_PIPELINE.md §12), so it is built once.

    Reversed (icepick) grip is a runtime rotation, not baked here: the mesh is a
    plain blade so the same geometry could serve a forward grip on another
    character. Steel reads cold in her palette — the blade samples `hairSmoke`,
    the coolest neutral, rather than a warm iron she does not own.
    """
    blade_len = w.get("bladeLengthTiles", 0.34)
    hw = w.get("bladeWidthTiles", 0.055) / 2
    hd = max(hw * 0.28, 0.006)          # a thin, flat blade
    grip_len = 0.13
    obj, mesh, bm, uv = new_mesh("dagger")

    def tube(axis, a, c, profile, swatch, **kw):
        kw.setdefault("sides", 8)
        kw.setdefault("exponent", spec.get("style", {}).get("blockiness", 3.4))
        return add_tube(bm, uv, axis, a, c, profile, swatch, **kw)

    # Grip: a short wrapped handle below the guard.
    tube("z", (0, 0, -grip_len), (0, 0, -0.01),
         taper((0.00, hw * 0.62, hw * 0.62),
               (0.15, hw * 0.70, hw * 0.70),
               (0.85, hw * 0.66, hw * 0.66),
               (1.00, hw * 0.74, hw * 0.74)), "haoriDark")
    # Pommel cap.
    add_box(bm, (0, 0, -grip_len - 0.01), (hw * 1.5, hw * 1.5, 0.02),
            {"_default": "haoriLight"}, uv)
    # Guard: a slim crossbar.
    if w.get("guard", "slim") != "none":
        add_box(bm, (0, 0, 0.0), (hw * 4.2, hd * 3.2, 0.022),
                {"_default": "haoriLight"}, uv)
    # Blade: tapers to a point, flat cross-section (width >> thickness).
    tube("z", (0, 0, 0.012), (0, 0, 0.012 + blade_len),
         taper((0.00, hw, hd),
               (0.55, hw * 0.9, hd * 0.92),
               (0.82, hw * 0.62, hd * 0.7),
               (1.00, hw * 0.05, hd * 0.18)), "hairSmoke",
         exponent=2.4, sides=6, cap_start=False)
    return finish(obj, mesh, bm, bevel=0.003)


def build_prop_mesh(spec, w):
    """Dispatch a weapon slot to its mesh builder by `kind`."""
    if w.get("kind") == "dagger":
        return build_dagger(spec, w)
    return build_door(spec)


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

    # Props: one mesh per distinct kind. Wisp's off-hand dagger is the same mesh
    # as her main hand, so it is built once and attached to both bones at runtime.
    weapon = spec.get("weapon") or {}
    built_kinds = set()
    for slot in ("mainHand", "offHand"):
        w = weapon.get(slot)
        if not w:
            continue
        kind = w.get("kind", slot)
        if kind in built_kinds:
            continue
        built_kinds.add(kind)
        prop = build_prop_mesh(spec, w)
        attach_material(prop, atlas, f"{cid}_{kind}_mat")
        export_fbx([prop], out_dir / f"{cid}_{kind}.fbx")
        print(f"  {kind:<6}{tri_count(prop):>5} tris  ->  {out_dir / f'{cid}_{kind}.fbx'}")

    print("\n  Upload ONLY the body FBX (zipped with the atlas PNG) to Mixamo.")
    print("  Weapons are props — they attach to hand bones after rigging.")


if __name__ == "__main__":
    main()
