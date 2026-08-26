"""
build_prop.py — turn a prop FBX into a .glb the client can hang off a bone.

    blender --background --python tools/art/build_prop.py -- aegis mainHand

Props are NOT part of the rigged upload: Mixamo's auto-rigger places its markers
by looking at the silhouette, and a held object either fails the placement or
gets skinned to the spine (ART_PIPELINE §14). So the body goes to Mixamo alone
and the prop comes back down this path instead — no rig, no clips, just geometry
and the atlas, parented to a bone at runtime.

That also means this script needs nothing from Mixamo. Re-running it does not
require re-rigging, or even the downloads folder.
"""

import hashlib
import json
import pathlib
import sys

import bpy

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 1:
        print("usage: blender --background --python tools/art/build_prop.py -- <id> [slot]")
        raise SystemExit(2)
    cid = argv[0]
    slot = argv[1] if len(argv) > 1 else "mainHand"

    art_path = ROOT / "data" / "art" / f"{cid}.json"
    art = json.loads(art_path.read_text())
    spec = (art.get("weapon") or {}).get(slot)
    if spec is None:
        print(f"  {cid} declares no {slot} — nothing to build")
        return
    attach = spec.get("attach")
    if attach is None:
        print(f"  ! {cid}.{slot} has no `attach` block (bone + offsets). Add one to data/art/{cid}.json.")
        raise SystemExit(1)

    kind = spec.get("kind", slot)
    src = ROOT / "build" / "art" / cid / f"{cid}_{kind}.fbx"
    if not src.exists():
        print(f"  ! {src} missing — run generate_character.py first")
        raise SystemExit(1)

    clear_scene()
    bpy.ops.import_scene.fbx(filepath=str(src))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        print("  ! the FBX brought no mesh")
        raise SystemExit(1)

    # The FBX carries the material but not the image, the same way the body's
    # does — re-point it at the atlas on disk so the export embeds real pixels
    # rather than a pink placeholder.
    #
    # A `"flat": true` weapon slot opts out: a neutral prop (Wisp's daggers) that
    # samples a single tone does not need — and must not embed — the whole
    # character atlas. A ~1 MB atlas baked into a 30-tri blade would blow the
    # per-character asset budget (ART_PIPELINE §18). Such a prop keeps its own
    # flat material from the FBX instead.
    atlas = ROOT / "build" / "art" / cid / f"{cid}_atlas.png"
    if atlas.exists() and not spec.get("flat"):
        img = bpy.data.images.load(str(atlas), check_existing=True)
        for m in bpy.data.materials:
            m.use_nodes = True
            tex = next((n for n in m.node_tree.nodes if n.type == "TEX_IMAGE"), None)
            if tex is None:
                tex = m.node_tree.nodes.new("ShaderNodeTexImage")
                bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                m.node_tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
            tex.image = img

    out_dir = ROOT / "packages" / "client" / "public" / "models"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{cid}_{kind}.glb"

    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        use_selection=True,
        export_animations=False,   # a prop has none; the bone it rides does
        export_skins=False,
        export_apply=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )

    size = out.stat().st_size // 1024
    print(f"\n  -> {out}  ({size} kB)")

    # Merge into the character manifest rather than writing a second one: the
    # client already fetches this file, and a prop is part of what a character
    # IS at runtime. `build_glb.py` preserves this key when it rewrites.
    manifest_path = out_dir / f"{cid}.clips.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"id": cid}
    props = [p for p in manifest.get("props", []) if p.get("slot") != slot]
    props.append({
        "slot": slot,
        "file": out.name,
        "version": hashlib.sha256(out.read_bytes()).hexdigest()[:12],
        "bone": attach["bone"],
        # Authored in TILES, like the rest of the art spec. The client converts:
        # the prop hangs inside the model's own scaled space, so it has to undo
        # that scale to land at a size expressed in board units.
        "heightTiles": spec.get("heightTiles"),
        "position": attach.get("position", [0, 0, 0]),
        "rotation": attach.get("rotation", [0, 0, 0]),
    })
    manifest["props"] = sorted(props, key=lambda p: p["slot"])
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"  -> {manifest_path.name}  (props: {', '.join(p['slot'] for p in manifest['props'])})")


if __name__ == "__main__":
    main()
