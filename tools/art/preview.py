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
import math
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
    p, y = math.radians(pitch_deg), math.radians(yaw_deg)
    horizontal = math.cos(p) * radius
    cam.location = Vector((
        target.x + math.sin(y) * horizontal,
        target.y - math.cos(y) * horizontal,   # -Y is the character's FRONT
        target.z + math.sin(p) * radius,
    ))
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_scene(size, light="STUDIO"):
    """Workbench, lit by default.

    FLAT is *unlit* — it renders pure albedo with no shading at all, so a dome
    and a flat disc come out pixel-identical. An earlier version of this script
    used FLAT throughout, which made it structurally incapable of showing form:
    every judgement about roundness, bevels or taper was being made on an image
    that could not express any of them. Shape questions need light.

    FLAT is still useful for one thing — checking the palette without lighting
    tinting it — so it is emitted once as `palette.png` rather than not at all.
    """
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = light
    shading.color_type = "TEXTURE"
    shading.show_object_outline = False
    shading.show_shadows = False
    # Blender 4.x defaults the view transform to AgX, which is a film emulation:
    # it crushes shadows and desaturates on purpose. That is right for a
    # photographic render and wrong for judging a flat-shaded game asset, where
    # it turned a mid-grey palette into murk. Standard shows the values as lit.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.35 if light == "STUDIO" else 0.0
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("preview") if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world = world
    world.color = (0.16, 0.17, 0.19)
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

    # Posture: applied here for evaluation only. In the real pipeline these are
    # bone offsets after rigging (docs/ART_PIPELINE.md §3); baking them into the
    # T-pose would break Mixamo's symmetry requirement.
    posture = spec.get("posture", {})
    if posture:
        body.rotation_euler[0] = math.radians(posture.get("hunchDeg", 0)) * 0.5

    # Props, placed for evaluation only (the real attach is a bone parent at
    # runtime, docs/ART_PIPELINE.md §12). Dispatch on kind so a door hangs off
    # one arm and a pair of daggers sit in both hands.
    prop_objs = []
    weapon = spec.get("weapon") or {}
    b = spec["build"]
    if weapon.get("mainHand", {}).get("kind") == "door":
        w = weapon["mainHand"]
        door_obj = gc.build_door(spec)
        gc.attach_material(door_obj, atlas, f"{cid}_preview_door_mat")
        side = -1 if posture.get("dropShoulder", "left") == "left" else 1
        # Dragged, not carried: low, tilted off vertical, held out from the body.
        door_obj.location = (side * (b["shoulderWidth"] * 0.30 + w["thickness"] * 2.2),
                             -b["torsoDepth"] * 0.30,
                             w["heightTiles"] * 0.34)
        door_obj.rotation_euler = (math.radians(-6), math.radians(side * -9), math.radians(side * 4))
        prop_objs.append(door_obj)
    else:
        # Estimate the hand position from the same build maths the body uses, so
        # daggers land in the T-pose hands. Reversed grip: blade points down.
        shoulder = 0.20 * b["shoulderWidth"]
        limb = 0.055 * b["limbThickness"]
        arm_z = b["height"] * 0.72 + 0.005
        seg = b["height"] * 0.224 * 0.52
        hand_x = shoulder * 0.86 + limb * 0.60 + seg * 2 + 0.045
        for slot, sign in (("mainHand", 1), ("offHand", -1)):
            w = weapon.get(slot)
            if not w:
                continue
            dg = gc.build_prop_mesh(spec, w)
            gc.attach_material(dg, atlas, f"{cid}_preview_{slot}_mat")
            dg.location = (sign * hand_x, -b["torsoDepth"] * 0.06, arm_z - 0.02)
            reversed_grip = w.get("grip") == "reversed"
            dg.rotation_euler = (math.radians(180 if reversed_grip else 0),
                                 0, math.radians(sign * 8))
            prop_objs.append(dg)

    tris = gc.tri_count(body)
    print(f"\n  {cid}: {tris} tris")

    # Frame on the character's real bounds rather than assuming its height.
    parts = [body] + prop_objs
    zs = [(o.matrix_world @ v.co).z for o in parts for v in o.data.vertices]
    xs = [(o.matrix_world @ v.co).x for o in parts for v in o.data.vertices]
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

    # One unlit frame, purely as a palette reference.
    setup_scene(512, light="FLAT")
    place_camera(cam, target, ISO_PITCH, 0, radius=10.0)
    scene.render.filepath = str(out_dir / "palette.png")
    bpy.ops.render.render(write_still=True)
    print(f"  {'palette':<12} unlit — colour reference only, shows no form")
    setup_scene(512)

    # The honest test: how big a unit actually is on screen.
    scene.render.resolution_x = scene.render.resolution_y = 48
    place_camera(cam, target, ISO_PITCH, 0, radius=10.0)
    scene.render.filepath = str(out_dir / "token-scale.png")
    bpy.ops.render.render(write_still=True)
    print(f"  {'token-scale':<12} 48px — what the player really sees")
    print(f"\n  -> {out_dir}")


if __name__ == "__main__":
    main()
