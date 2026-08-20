"""
preview.py — render a character turnaround from the game's real camera angles.

    blender --background --python tools/art/preview.py -- aegis

Renders the built FBX (or rebuilds from data/art/<id>.json) through an
orthographic camera at the pitches the client actually uses:

    PITCH.isometric = 35.264°   the default view
    ~8°                         the shallowest free-orbit allows, near profile
    90°                         straight down

...at four yaws, because renderer3d.ts:782 runs yaw modulo 360 unclamped and
players see every side. Also renders one frame at true unit-token scale, which is
the only honest test of whether a detail survives.

Workbench is used deliberately over EEVEE: it is flat-shaded, fast, stable across
Blender versions, and shows the atlas without lighting flattering or hiding it.
"""

import json
import pathlib
import sys

import bpy
from mathutils import Vector

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

import generate_character as gc  # noqa: E402

ISO_PITCH = 35.264   # renderer3d.ts:58 — the true isometric angle
LOW_PITCH = 8.0      # renderer3d.ts:62 — below this the board is edge-on
TOP_PITCH = 90.0

SHOTS = [
    ("iso-front",   ISO_PITCH,   0),
    ("iso-right",   ISO_PITCH,  90),
    ("iso-back",    ISO_PITCH, 180),
    ("iso-left",    ISO_PITCH, 270),
    ("low-profile", LOW_PITCH,  90),
    ("top-down",    TOP_PITCH,   0),
]


def place_camera(cam, target, pitch_deg, yaw_deg, radius):
    import math
    p, y = math.radians(pitch_deg), math.radians(yaw_deg)
    horizontal = math.cos(p) * radius
    cam.location = Vector((
        target.x + math.sin(y) * horizontal,
        target.y + math.cos(y) * horizontal,
        target.z + math.sin(p) * radius,
    ))
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_scene(size):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "TEXTURE"
    shading.show_object_outline = False
    shading.show_shadows = True
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("preview") if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world = world
    world.color = (0.09, 0.10, 0.12)
    return scene


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        print("usage: blender --background --python tools/art/preview.py -- <id>")
        sys.exit(2)
    cid = argv[0]

    spec = json.loads((ROOT / "data" / "art" / f"{cid}.json").read_text())
    out_dir = ROOT / "build" / "art" / cid / "preview"
    out_dir.mkdir(parents=True, exist_ok=True)
    atlas = str(ROOT / "build" / "art" / cid / f"{cid}_atlas.png")

    gc.clear_scene()
    body = gc.build_body(spec)
    gc.attach_material(body, atlas, f"{cid}_preview_mat")

    tris = gc.tri_count(body)
    print(f"\n  {cid}: {tris} tris")

    # Frame on the character's real bounds rather than assuming its height.
    zs = [v.co.z for v in body.data.vertices]
    xs = [v.co.x for v in body.data.vertices]
    lo, hi = min(zs), max(zs)
    target = Vector((0.0, 0.0, (lo + hi) / 2))
    extent = max(hi - lo, (max(xs) - min(xs))) * 1.15

    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.type = "ORTHO"          # same projection the client uses
    cam_data.ortho_scale = extent
    cam = bpy.data.objects.new("preview_cam", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    scene = setup_scene(512)
    for name, pitch, yaw in SHOTS:
        place_camera(cam, target, pitch, yaw, radius=10.0)
        scene.render.filepath = str(out_dir / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  {name:<12} pitch {pitch:>6.2f}°  yaw {yaw:>3}°")

    # The honest test: how big a unit actually is on screen.
    scene.render.resolution_x = scene.render.resolution_y = 48
    place_camera(cam, target, ISO_PITCH, 0, radius=10.0)
    scene.render.filepath = str(out_dir / "token-scale.png")
    bpy.ops.render.render(write_still=True)
    print(f"  {'token-scale':<12} 48px — what the player really sees")
    print(f"\n  -> {out_dir}")


if __name__ == "__main__":
    main()
