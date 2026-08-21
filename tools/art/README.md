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

## After Mixamo

```bash
blender --background --python tools/art/build_glb.py -- aegis ~/path/to/mixamo-downloads
```

Point it at the folder of Mixamo downloads. It finds the **With Skin** export by
detecting which file brought a mesh (rather than trusting a filename), takes the action
out of every other file, re-applies the atlas, and writes one `.glb` plus a
`<id>.clips.json` manifest into `packages/client/public/models/`.

Clip names come from filenames: `Falling Back Death.fbx` becomes `falling_back_death`.

Mixamo exports in centimetres and the client works in metres, so the script applies the
armature's scale on import. Skipping that lands a 1.7 m character at 170 units — not
subtly wrong, off the board entirely.

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

## Reading the previews

`preview.py` renders **lit** (Workbench STUDIO). That matters more than it sounds: the
`FLAT` mode it used originally is *unlit* — pure albedo, no shading at all — so a dome and a
flat disc come out pixel-identical. Any question about roundness, taper, bevels or
silhouette depth is unanswerable in a FLAT render, and asking it there wastes rounds
"fixing" geometry that was never wrong.

One unlit frame is still emitted, as `palette.png`, because checking colour is the one job
FLAT does better. Use it for colour, never for shape.

Blender 4.x also defaults the view transform to AgX, a film emulation that deliberately
crushes shadows and desaturates. Right for a photographic render, wrong for a flat-shaded
game asset — the previews set `Standard`.

## Validating before you rig

```bash
blender --background --python tools/art/validate.py -- aegis
```

Every check corresponds to a way Mixamo's auto-rigger fails or builds a bad
skeleton: single mesh, triangle budget, mirrored joint landmarks, T-pose arm
centreline, crotch gap, armpit gap, feet near the origin. Two seconds here beats
discovering the same problem after rigging and collecting eight clips.

It distinguishes **decoration** asymmetry from **landmark** asymmetry. A heavier
pauldron on one shoulder changes vertex counts without moving a joint, and is an
art choice. A wrist or elbow at different coordinates on each side skews the
skeleton, and is a defect — that is the hard failure.

## Verifying

```bash
python3 tools/art/paint_atlas.py aegis --verify
```

Checks that every swatch cell samples the colour the mesh expects. The failure
this catches — the grid here disagreeing with the UV maths in
`generate_character.py` — renders as a silently wrong-coloured limb, which looks
like an art problem and is really an index bug.
