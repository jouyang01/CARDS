"""
generate_prop.py — build a themed terrain prop as a .glb the board hangs on a tile.

    blender --background --python tools/art/generate_prop.py -- proving-floor
    blender --background --python tools/art/generate_prop.py -- proving-floor wall

Reads data/props/<theme>.json and, for each terrain role it declares (wall,
cover), builds the geometry and writes packages/client/public/models/props/
<theme>_<role>.glb, then merges an entry into that folder's manifest.json with a
content hash for cache-busting.

WHY THIS IS ITS OWN SCRIPT, not part of the character pipeline:

  * No Mixamo, ever. A prop is static geometry — like the weapon props, it skips
    rigging entirely (ART_PIPELINE §9/§12), so there is no FBX intermediate and
    no downloads folder. This exports GLB straight from bmesh.
  * No atlas. Character geometry unwraps onto a shared texture atlas; terrain
    props carry flat per-part material colours straight from the theme, so this
    deliberately does NOT reuse generate_character.py's add_box/add_tube (those
    assign atlas UVs). The primitives here are the same shape, minus that
    coupling.

WHAT IT GUARANTEES, and why each matters to the board:

  1. Authored in TILES, placed 1:1 — the renderer does NOT measure-and-scale a
     wall prop the way it does a character; it stands it at its authored `height`
     with its base on the floor. A wall is a full line-of-sight blocker whatever
     it is DRAWN at (the engine blocks by tile type, not by pixels), so walls are
     authored TALLER than a tile and varied in height (owner, session 25): a
     taller, uneven colonnade reads *more* clearly as wall-not-cover, not less
     (MAP_PIPELINE §5, "the read survives"). Cover is authored at COVER_HEIGHT
     and the renderer normalises it to crouch height on the tile's faced edge
     (COVER-EDGE), so a cover variant's `height` is nominal and its variety is in
     the fence silhouette, not the height.
  2. Base at the floor. Built Z-up with the base at z=0, exported Y-up, so the
     prop sits ON the tile with no per-prop offset to get wrong.
  3. Neutral / dark colours only. Stone greys (r≈g≈b) and dark wood (every
     channel well under 130) stay clear of every saturated UI colour family the
     e2e counts (MAP_PIPELINE §4). The spec's colours are authored under that
     rule; this script does not brighten them.
"""

import hashlib
import json
import math
import pathlib
import sys

import bpy
import bmesh

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]


# ── colour ──────────────────────────────────────────────────────────────────

def srgb_to_linear(c):
    """One 0..1 sRGB channel to linear. glTF baseColorFactor is linear, and a
    Principled base colour is linear, so a hex authored as sRGB must convert or
    it ships too bright."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hex_str):
    h = hex_str.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


class Palette:
    """Registers hex colours in first-seen order and, at the end, appends one
    flat material per colour so a face's `material_index` lines up with its slot.
    """

    def __init__(self):
        self._index = {}
        self._order = []

    def index(self, hex_str):
        if hex_str not in self._index:
            self._index[hex_str] = len(self._order)
            self._order.append(hex_str)
        return self._index[hex_str]

    def apply(self, obj):
        for hex_str in self._order:
            mat = bpy.data.materials.new(f"prop_{hex_str.lstrip('#')}")
            if mat.node_tree is None:
                mat.use_nodes = True
            bsdf = mat.node_tree.nodes["Principled BSDF"]
            bsdf.inputs["Base Color"].default_value = hex_to_linear_rgba(hex_str)
            bsdf.inputs["Roughness"].default_value = 0.9
            if "Specular IOR Level" in bsdf.inputs:
                bsdf.inputs["Specular IOR Level"].default_value = 0.15
            obj.data.materials.append(mat)


# ── primitives (atlas-free) ──────────────────────────────────────────────────

def box(bm, center, size, mat_i):
    """One axis-aligned box; every face gets material slot `mat_i`."""
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    corners = [
        (cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
        (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
        (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
        (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz),
    ]
    v = [bm.verts.new(c) for c in corners]
    quads = [(0, 3, 7, 4), (1, 5, 6, 2), (0, 4, 5, 1),
             (3, 2, 6, 7), (0, 1, 2, 3), (4, 7, 6, 5)]
    for q in quads:
        try:
            f = bm.faces.new([v[i] for i in q])
        except ValueError:
            continue
        f.material_index = mat_i


def superellipse(n_points, exponent):
    """Unit superellipse (u, v): n=2 circle, n≈4 squircle, high n → square."""
    pts = []
    for i in range(n_points):
        t = 2.0 * math.pi * i / n_points
        ct, st = math.cos(t), math.sin(t)
        u = math.copysign(abs(ct) ** (2.0 / exponent), ct)
        v = math.copysign(abs(st) ** (2.0 / exponent), st)
        pts.append((u, v))
    return pts


def column(bm, z0, z1, w0, w1, sides, exponent, mat_i, flutes=0, flute_depth=0.0, top_jag=0.0):
    """A vertical tapered column with a superellipse cross-section, from z0 to
    z1, half-width w0 at the base easing to w1 at the top. Optional `flutes`
    press shallow vertical grooves around it; `top_jag` drops the top ring
    unevenly (a snapped-off, ruined crown). Ring vertices wrap; UVs are moot
    (flat material), so this only bridges quads and caps the ends."""
    profile = superellipse(sides, exponent)

    def ring_at(z, hw, jag=0.0):
        ring = []
        for k, (u, val) in enumerate(profile):
            r = 1.0
            if flutes > 0:
                # A groove per lobe: pull the radius in on the troughs only, so
                # the column stays convex and never pinches to a point.
                r = 1.0 - flute_depth * (0.5 - 0.5 * math.cos(flutes * 2.0 * math.pi * k / sides))
            # A deterministic, seam-closing wobble on the break: two lobes down,
            # phased so vertex 0 and vertex `sides` land on the same height.
            zk = z - (jag * (0.5 - 0.5 * math.cos(2.0 * 2.0 * math.pi * k / sides)) if jag else 0.0)
            ring.append(bm.verts.new((u * hw * r, val * hw * r, zk)))
        return ring

    bottom = ring_at(z0, w0)
    top = ring_at(z1, w1, top_jag)
    for i in range(sides):
        j = (i + 1) % sides
        try:
            f = bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
        except ValueError:
            continue
        f.material_index = mat_i
    for ring in (bottom, top):
        try:
            f = bm.faces.new(ring if ring is top else list(reversed(ring)))
        except ValueError:
            continue
        f.material_index = mat_i


# ── finish ───────────────────────────────────────────────────────────────────

def new_mesh(name):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj, mesh, bmesh.new()


def finish(obj, mesh, bm, palette, bevel=0.006, smooth_angle=34.0):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    palette.apply(obj)
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(30.0)
    for poly in mesh.polygons:
        poly.use_smooth = True
    if hasattr(mesh, "auto_smooth_angle"):
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = math.radians(smooth_angle)
    else:
        try:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
        except Exception:
            pass
    return obj


# ── the two props ─────────────────────────────────────────────────────────────

def build_pillar(spec):
    """A colosseum column. `capital` is optional (a broken column has none), and
    `broken` snaps the crown short and uneven and scatters a little rubble at the
    base — the same builder, ruined."""
    p = Palette()
    obj, mesh, bm = new_mesh("pillar")
    h = spec["height"]
    plinth, shaft = spec["plinth"], spec["shaft"]
    cap = spec.get("capital")
    ph = plinth["height"]
    ch = cap["height"] if cap else 0.0
    broken = spec.get("broken")

    box(bm, (0, 0, ph / 2), (plinth["width"], plinth["width"], ph),
        p.index(spec["palette"]["plinth"]))
    column(bm, ph, h - ch,
           shaft["bottomWidth"] / 2, shaft["topWidth"] / 2,
           shaft.get("sides", 16), shaft.get("exponent", 4.0),
           p.index(spec["palette"]["shaft"]),
           flutes=shaft.get("flutes", 0), flute_depth=shaft.get("fluteDepth", 0.0),
           top_jag=(broken.get("jag", 0.0) if broken else 0.0))
    if cap:
        box(bm, (0, 0, h - ch / 2), (cap["width"], cap["width"], ch),
            p.index(spec["palette"]["capital"]))
    if broken:
        # A few fallen chunks around the base, deterministically placed so the
        # ruin is the same for both teams and every screenshot.
        chunk = p.index(spec["palette"].get("rubble", spec["palette"]["plinth"]))
        for i, (dx, dy, sz) in enumerate(broken.get("rubble", [])):
            box(bm, (dx, dy, sz / 2), (sz, sz * 0.8, sz), chunk)
    return finish(obj, mesh, bm, p, bevel=0.008)


def build_block(spec):
    """A stone block / low altar for cover: a wide base course with a narrower
    slab on top, so it reads as placed masonry rather than a plain cube."""
    p = Palette()
    obj, mesh, bm = new_mesh("block")
    h = spec["height"]
    foot = spec["footprint"]
    base_h = spec.get("baseHeight", h * 0.7)
    stone = p.index(spec["palette"]["stone"])
    cap_hex = spec["palette"].get("cap", spec["palette"]["stone"])
    box(bm, (0, 0, base_h / 2), (foot, foot, base_h), stone)
    cap_h = h - base_h
    if cap_h > 0:
        inset = spec.get("capInset", 0.12)
        box(bm, (0, 0, base_h + cap_h / 2), (foot - inset, foot - inset, cap_h),
            p.index(cap_hex))
    return finish(obj, mesh, bm, p, bevel=0.01)


def build_barricade(spec):
    p = Palette()
    obj, mesh, bm = new_mesh("barricade")
    h = spec["height"]
    foot = spec["footprint"]
    posts, stakes, rail = spec["posts"], spec["stakes"], spec["rail"]
    wood, dark = p.index(spec["palette"]["wood"]), p.index(spec["palette"]["woodDark"])

    half = foot / 2
    # Two heavier end posts, the full height. Centred half a post-width inside
    # the footprint so their OUTER faces land on the footprint edge rather than
    # past it — otherwise the barricade is wider than the tile it sits on.
    post_x = half - posts["width"] / 2
    for x in (-post_x, post_x):
        box(bm, (x, 0, h / 2), (posts["width"], posts["thickness"], h), dark)
    # Evenly spaced stakes between the posts, each a little shorter and uneven.
    n = stakes["count"]
    jit = stakes.get("topJitter", [0.0] * n)
    inner = foot - posts["width"]
    for i in range(n):
        fx = -inner / 2 + inner * (i + 0.5) / n
        sh = h + (jit[i] if i < len(jit) else 0.0)
        box(bm, (fx, 0, sh / 2), (stakes["width"], stakes["thickness"], sh), wood)
    # A crossbar lashing them together.
    box(bm, (0, 0, h * rail["atFrac"]), (foot, rail["thickness"], rail["height"]), dark)
    return finish(obj, mesh, bm, p, bevel=0.005)


BUILDERS = {"pillar": build_pillar, "barricade": build_barricade, "block": build_block}


# ── export ────────────────────────────────────────────────────────────────────

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export_glb(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=False,
        export_apply=True,       # bake the bevel + smooth modifiers into the mesh
        export_yup=True,         # Z-up author space -> Y-up runtime; base lands at y=0
        export_cameras=False,
        export_lights=False,
    )


def tri_count(obj):
    return sum(len(poly.vertices) - 2 for poly in obj.data.polygons)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        print("usage: blender --background --python tools/art/generate_prop.py -- <theme> [role]")
        raise SystemExit(2)
    theme = argv[0]
    only = argv[1] if len(argv) > 1 else None

    spec_path = ROOT / "data" / "props" / f"{theme}.json"
    if not spec_path.exists():
        print(f"  ! no spec at {spec_path}")
        raise SystemExit(1)
    spec = json.loads(spec_path.read_text())

    out_dir = ROOT / "packages" / "client" / "public" / "models" / "props"
    out_dir.mkdir(parents=True, exist_ok=True)
    # Clear this theme's old single-file props (`<theme>_<role>.glb`) so the
    # variant files (`<theme>_<role>_<i>.glb`) do not leave orphans behind.
    for stale in out_dir.glob(f"{theme}_*.glb"):
        # keep the variant-numbered files this run is about to (re)write; drop a
        # bare `<theme>_<role>.glb` with no trailing index.
        tail = stale.stem[len(theme) + 1:]
        if "_" not in tail or not tail.rsplit("_", 1)[1].isdigit():
            stale.unlink()
    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"props": []}

    roles = [only] if only else list(spec["props"].keys())
    for role in roles:
        role_spec = spec["props"].get(role)
        if role_spec is None:
            print(f"  ! {theme} declares no '{role}'")
            continue
        # A role is a list of interchangeable variants — the board picks one per
        # tile by hash. A single-object role (the old format) is read as a
        # one-variant list so an older spec still builds.
        variants = role_spec.get("variants", [role_spec])
        yaw_steps = role_spec.get("yawSteps", variants[0].get("yawSteps", 1))
        height = role_spec.get("height", variants[0].get("height"))

        built = []
        for i, prop in enumerate(variants):
            builder = BUILDERS.get(prop["kind"])
            if builder is None:
                print(f"  ! unknown kind '{prop['kind']}' for {theme}.{role}[{i}]")
                continue
            clear_scene()
            obj = builder(prop)
            out = out_dir / f"{theme}_{role}_{i}.glb"
            export_glb(obj, out)
            version = hashlib.sha256(out.read_bytes()).hexdigest()[:12]
            size = out.stat().st_size // 1024
            print(f"  {theme}.{role}[{i}]  {prop['kind']:<9} {tri_count(obj):>5} tris  {size:>4} kB  -> {out.name}")
            built.append({"file": f"props/{out.name}", "version": version, "kind": prop["kind"]})

        if not built:
            continue
        entry = {
            "theme": theme, "role": role,
            "yawSteps": yaw_steps, "height": height,
            "variants": built,
        }
        manifest["props"] = [e for e in manifest.get("props", [])
                             if not (e["theme"] == theme and e["role"] == role)]
        manifest["props"].append(entry)

    manifest["props"] = sorted(manifest["props"], key=lambda e: (e["theme"], e["role"]))
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(len(e.get("variants", [])) for e in manifest["props"])
    print(f"  -> {manifest_path.relative_to(ROOT)}  ({len(manifest['props'])} roles, {total} meshes)")


if __name__ == "__main__":
    main()
