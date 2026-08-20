# tools/art

Generates character meshes and texture atlases from `data/art/<id>.json`.
Read `docs/ART_PIPELINE.md` first — it explains why the pipeline is shaped this way.

## The two scripts, and why they are two

| Script | Needs Blender | Produces |
|---|---|---|
| `paint_atlas.py` | **no** | `<id>_atlas.png` |
| `generate_character.py` | yes, headless | `<id>.fbx`, `<id>_door.fbx` |

Painting a face into a PNG is 2D image drawing. Blender builds geometry and
assigns UVs; it never touches pixels. Splitting them means the texture step runs
and tests on its own, and nothing depends on what Blender's bundled Python ships.

`atlas_layout.json` is the contract between them — both read it, so the painted
rectangles and the assigned UVs cannot drift apart. **Change it and you change
both.**

## Running

```bash
# 1. paint the atlas (plain Python, needs Pillow)
python3 tools/art/paint_atlas.py aegis

# 2. build the mesh (Blender 4.2+, headless — never opens the UI)
blender --background --python tools/art/generate_character.py -- aegis
```

Both write to `build/art/<id>/`, which is gitignored. `data/art/<id>.json` is the
source of truth; the outputs are always rebuildable.

Output is deterministic: weathering and tally placement seed from the character
id, so the same character weathers identically on every machine.

## Then what

Zip `<id>.fbx` together with `<id>_atlas.png` and upload **that** to Mixamo.

**Upload the body only.** `<id>_door.fbx` is a prop — a held object breaks
auto-rig marker placement and gets skinned to the spine. It attaches to the hand
bone at runtime.

Mixamo download settings, and the "In Place" rule that will otherwise silently
ruin locomotion, are in `docs/ART_PIPELINE.md` §4.

## What each script guarantees

`generate_character.py` satisfies all four of Mixamo's auto-rig requirements by
construction — clean T-pose, left/right symmetry, limbs separated from the torso
(explicit armpit and crotch gaps), one mesh well under 150k tris.

It deliberately does **not** bake the `posture` block. Aegis's dropped shoulder
and hunch are applied after rigging as bone offsets, so the T-pose stays
symmetric for the rigger and the asymmetry still survives every Mixamo clip.

## Running these in a container (CI, or a remote Claude session)

The scripts work headless on Linux, but a bare container needs three things the
macOS build bundles for you:

```bash
apt-get install -y blender python3-numpy libegl1 libgl1-mesa-dri libosmesa6
LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe \
  blender --background --python tools/art/preview.py -- aegis
```

`python3-numpy` because the distro Blender uses system Python rather than a
bundled one, and the GL packages because Workbench needs a rendering context even
in `--background`. Without the software-GL environment variables you get
`Couldn't open libEGL.so.1` or `EGL_NOT_INITIALIZED`.

## Verifying

```bash
python3 tools/art/paint_atlas.py aegis --verify
```

Checks that every swatch cell samples the colour the mesh expects. The failure
this catches — the grid here disagreeing with the UV maths in
`generate_character.py` — renders as a silently wrong-coloured limb, which looks
like an art problem and is really an index bug.
