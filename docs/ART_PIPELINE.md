# ART_PIPELINE.md — characters, start to finish

How a character gets from a written thesis to a rigged, textured, animated mesh on the
board. Written for an owner with no Blender, animation or art skills: everything except one
browser step is a command.

**Status: proven end to end on Aegis.** The generator, atlas painter, validator and preview
are built and verified. Aegis has been through Mixamo's auto-rigger successfully, with the
texture surviving and the deformation holding. `build_glb.py` (Phase 7) is written; its
glTF export half is verified against a synthetic rig, its FBX import half is not yet run
against real Mixamo output. Phases 8–10 are planned, not built.

Read this before touching unit rendering in `renderer3d.ts`, before adding VFX, and before
changing how anything is drawn.

---

## 0. Quick reference

```bash
# once, per machine
brew install --cask blender          # or blender.org; 4.2 LTS+, verified on 5.2
python3 -m pip install --user Pillow

# per character, from the repo root
python3 tools/art/paint_atlas.py aegis --verify
blender --background --python tools/art/generate_character.py -- aegis
blender --background --python tools/art/validate.py     -- aegis
blender --background --python tools/art/preview.py      -- aegis

# hand off to Mixamo
cd build/art/aegis && zip -j aegis-mixamo.zip aegis.fbx aegis_atlas.png

# after Mixamo
blender --background --python tools/art/build_glb.py -- aegis ~/Downloads/mixamo-aegis
```

| Script | Blender? | Produces |
|---|---|---|
| `paint_atlas.py` | **no** | `<id>_atlas.png` |
| `generate_character.py` | yes | `<id>.fbx`, `<id>_door.fbx` |
| `validate.py` | yes | 9 pass/fail checks |
| `preview.py` | yes | 8 render frames |
| `build_glb.py` | yes | `<id>.glb` + clips manifest |
| `atlas_layout.json` | — | the UV contract two scripts share |

Everything writes to `build/art/<id>/`, which is gitignored. `data/art/<id>.json` is the
source of truth; every output is rebuildable from it.

---

## 1. Where the client is today

`renderer3d.ts:541` — a unit is still a box:

```ts
new BoxGeometry(TILE * 0.55, UNIT_HEIGHT, TILE * 0.55)
```

The board is already an orthographic Three.js scene. The camera is a real camera, not a
projection trick:

- `PITCH = { top: 90, isometric: 35.264 }` (`renderer3d.ts:58`)
- Free orbit runs **yaw modulo 360, unclamped** (`renderer3d.ts:782`)
- Pitch clamps by `PITCH_LIMITS`, down to roughly 8° before the board goes edge-on (line 62)
- `TILE = 1`, `UNIT_HEIGHT = 0.6` (lines 52–53)

**Every art decision below follows from that camera.** Players see all sides of a character,
from near-ground-level to straight down. There is no "back" that stays hidden.

---

## 2. Prerequisites

### On the owner's Mac

Blender **4.2 LTS or newer**; verified on 5.2.0. Confirm it is on `PATH`, which the macOS
installer does not do:

```bash
blender --version
```

If that says `command not found`, Blender is installed but not exposed. Test the real
binary, then alias it:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --version
echo 'alias blender="/Applications/Blender.app/Contents/MacOS/Blender"' >> ~/.zshrc && source ~/.zshrc
```

Confirm the two exporters this pipeline needs are present. Since 4.2 Blender has been
migrating bundled add-ons to its extensions system, so do not assume:

```bash
blender --background --python-expr "import bpy; print(hasattr(bpy.ops.export_scene,'fbx'), hasattr(bpy.ops.export_scene,'gltf'))"
```

`paint_atlas.py` needs Pillow in *system* Python (not Blender's):

```bash
python3 -m pip install --user Pillow
# if that fails with externally-managed-environment:
python3 -m venv .venv-art && .venv-art/bin/pip install Pillow
```

### In a container (CI, or a remote Claude session)

```bash
apt-get install -y blender python3-numpy libegl1 libgl1-mesa-dri libosmesa6
LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe blender --background --python tools/art/preview.py -- aegis
```

`python3-numpy` because the distro Blender uses system Python rather than a bundled one.
The GL packages because Workbench needs a rendering context **even in `--background`** —
without the software-GL environment variables you get `Couldn't open libEGL.so.1` or
`EGL_NOT_INITIALIZED`. The headless build also ships **no studio lights**, so assigning one
by name silently does nothing.

### Blender is a build dependency, not a tool anyone opens

It runs headless. It is in the pipeline because **Mixamo exports FBX and the client needs
glTF**, and something must convert, merge clips onto one skeleton, and optimize. Nobody
opens its interface at any point.

---

## 3. Phase 0 — art direction (human)

Before any file exists, write the character's **thesis**: one paragraph on who they are,
and one on what they look like. Aegis's is stored in `data/art/aegis.json` under `thesis`.

This is not decoration. Every downstream parameter — proportions, palette, whether the
magic is warm or cold — is decided by it, and a character generated without one comes out
generic. The thesis for Aegis ("he doesn't shield you, he takes it; exhaustion and a little
contempt, not devotion") is what ruled out a heroic silhouette, warm gold magic, and
ultimately a chibi head.

> **Spike one character before generating a roster.** If rigging surfaces a geometry
> problem, the fix goes in the generator and every character has to be regenerated.

---

## 4. Phase 1 — parameters

Art parameters live in **`data/art/<id>.json`**, deliberately separate from
`data/characters/<id>.json`, which holds balance numbers. Role boundaries say Builder never
touches balance; separate files mean changing a coat never requires opening a file full of
damage values.

```json
{
  "id": "aegis",
  "thesis": "...",
  "weaponClass": "door",

  "build": {
    "height": 1.78,          "headScale": 1.25,
    "shoulderWidth": 1.32,   "neckLength": 0.82,
    "torsoDepth": 1.15,      "limbThickness": 1.55
  },

  "style": { "blockiness": 3.4, "sides": 10 },

  "posture": {
    "dropShoulder": "left", "dropShoulderDeg": 9,
    "hunchDeg": 13,         "headForwardDeg": 7
  },

  "garment": { "kind": "layered-plate", "skirt": "tassets",
               "shoulderPads": { "left": "heavy-riveted", "right": "light" },
               "collar": "high" },

  "palette": { "iron": "#4a5058", "...": "..." },
  "magic":   { "core": "#c9d2c4", "warmthForbidden": true },
  "face":    { "eyes": "narrow-hooded", "brow": "heavy-flat", "scar": {...} },
  "weapon":  { "mainHand": { "kind": "door", "tallies": 47, "...": "..." } }
}
```

### `style.blockiness` is the roster-wide silhouette knob

Cross-sections are **superellipses**: `|x/a|ⁿ + |y/b|ⁿ = 1`.

| n | reads as |
|---|---|
| 2.0 | circular, soft, organic |
| 3.4 | **current** — squircle, rounded with implied structure |
| 5.0 | chamfered blocks |
| 8+ | effectively boxes |

One number moves the whole roster between silhouette languages, as a data edit.

### `headScale` is a roster-wide decision

**1.25.** Chosen by rendering 1.00 / 1.20 / 1.40 / 1.62 side by side at both close range and
44px. 1.62 carried a chibi tilt that fights a character built on exhaustion and contempt.

Note what that comparison also disproved: a realistic head does **not** "disappear at
isometric distance" — at 44px it is smaller but plainly present. What head size buys at
range is *silhouette distinctiveness*, not readable expression; the face resolves to a brow
line at that size whatever the scale.

Mixed head scales across a team read as a bug, not variety. **1.25 is the house proportion.**

### `posture` is applied AFTER rigging, never baked

Mixamo's auto-rigger needs a symmetric T-pose. Aegis's dropped shoulder and hunch are bone
offsets applied on top of the mixer at runtime, which is strictly better anyway: the hunch
then survives idle, walk, dash *and* death, instead of being one baked pose.

---

## 5. Phase 2 — the texture atlas (no Blender)

```bash
python3 tools/art/paint_atlas.py aegis --verify
```

Painting a face into a PNG is 2D image drawing. Blender builds geometry and assigns UVs; it
**never touches pixels**. Keeping them apart means this step runs and tests on its own, and
nothing depends on what Blender's bundled Python ships.

### The layout is a contract

`atlas_layout.json` is read by *both* the painter and the generator, so painted rectangles
and assigned UVs cannot drift apart. Change it and you change both.

```
┌───────────┬───────────┬───────────┬───────────┐  0
│ head      │ head      │ head      │ crown     │
│ front     │ back      │ sides     │ / top     │
├───────────┴───────────┼───────────┴───────────┤  256
│ torso                 │ swatch cells (4 × 3)  │
├───────────────────────┼───────────────────────┤  512
│ THE DOOR              │ door reverse          │
└───────────────────────┴───────────────────────┘  1024
0                       512                   1024
```

### Swatch cells are worn patches, not flat colours

Armour pieces **unwrap across a whole cell**. They used to sample a single centre pixel,
which made scratched plate impossible by construction — one pixel cannot be scratched. Each
cell now carries tonal variation, fine scratches, small chips, and scuffing instead of
scratches on leather and skin. Cells are inset 4px so neighbours cannot bleed in.

`--verify` compares each cell's **median** against the palette. It used to sample the centre
pixel, which after cells became textured reported four false mismatches — the centre is
often a scratch.

The failure this guards against — the swatch grid here disagreeing with the UV maths in
`generate_character.py` — renders as a silently wrong-coloured limb, which looks like an art
problem and is really an index bug.

### Determinism

Weathering and tally placement seed from the character id, so a character weathers
identically on every machine.

---

## 6. Phase 3 — geometry

```bash
blender --background --python tools/art/generate_character.py -- aegis
```

Builds the body and the door as **separate** FBX files, and assigns UVs against the layout
above.

### The four Mixamo guarantees, met by construction

| Requirement | How |
|---|---|
| Clean T-pose | limbs placed at exact angles, never posed |
| Left/right symmetry | mirrored by construction |
| Limbs not fused to torso | explicit armpit and crotch gaps |
| Single mesh, < 150k tris | joined on export, ~1.8k tris |

This is precisely why procedural generation beats AI mesh generators here — Meshy, Tripo and
TRELLIS fail all four routinely, and recovering costs exactly the Blender skill the owner
does not have.

### `add_tube` — the one primitive that matters

Everything except the head and the door is a tapered tube with a superellipse
cross-section. A profile stop is `(t, half_width, half_depth, lateral_shift)`:

- **taper** kills the "stack of cubes" read more than any other single change; constant
  cross-section is what looks blocky, not polygon count
- **the fourth value** offsets that ring sideways, which is how the occiput projects
  backward past the neck. A superellipse ring is symmetric about its own centre, so no
  combination of radii alone can express front-back asymmetry.
- **`cap_start` / `cap_end`** — set `False` where an end is buried inside another form. A
  capped buried end is an interior face: invisible, costs triangles, and casts shadow from
  inside the character.

### The head is not a box

An early version made it one, reasoning that mapping a rectangle onto a face needs a flat
quad. That constraint is not real. The portrait is **planar-projected** from the front onto
a tapered form, so it wraps the skull the way a face actually sits on one.

Each face of the head picks its projection from **where its centre sits**, not from its
normal — `bm.normal_update()` does not run until `finish()`, so reading `face.normal` during
construction gets a stale value and every face misclassifies. Centre position is exact on a
convex form and needs no normals computed.

- front → the portrait
- back → hair, mirrored so it is not reversed
- sides → their own region
- **horizontal caps → projected from above.** Project a cap from the front and every vertex
  shares one `v`, so the whole cap samples a one-pixel strip.

Three constants at the top of `add_head()` control the face's apparent size:

| Constant | Now | Effect |
|---|---|---|
| `FRONT_ARC` | 0.46 | lower = portrait wraps further around |
| `FACE_ZOOM` | 1.52 | >1 magnifies the features |
| `FACE_ANCHOR` | 0.42 | the `v` the zoom centres on |

The painted face region carries a **hairline** across its top, because the projection runs
chin-to-crown and the top of that rectangle lands where hair belongs.

### The crown must dome, not cap

`add_tube` closes a tube with an n-gon **whatever radius the last ring happens to be**, so a
wide final ring leaves a literal flat disc on top of the skull. One smaller ring gives a
cone instead — no better. The radius falls off on a circular arc, `sqrt(1 - u²)`, across five
stops: 100 / 90 / 72 / 52 / 31 / 12 % of the occiput radius.

**Every tube in the model ends this way.** Boots, hands and pauldrons get away with it
because their end rings are already small. If any of them ever reads as chopped off, this is
the cause and this is the fix.

### Bevel and smooth shading

A perfectly sharp 90° corner renders as a hard black line and is most of why untreated
geometry looks like stacked cubes. `finish()` adds a small bevel modifier (angle-limited) and
angle-based smooth shading, so curved surfaces round out while genuine corners stay crisp.

### Rules the rotating camera imposes

- **No billboard face plane** — it swims when the camera orbits
- **No untextured back of head** — the camera is behind the model half the time
- **No flat cards** for hair or cloth — they vanish edge-on near 8° pitch
- **Supporting geometry under the face** — a shallow nose wedge; ~40 triangles, and the
  difference between a 3D character and a ball with a decal
- **No brow-ridge wedges.** They were sized for a flat-faced box; on a curved head they punch
  through the surface beside each eye and read as spikes. The painted brow carries it.
- **Front/back asymmetry is a feature** — a rotating camera destroys the "up is north"
  anchor, so hoods, packs and cloak clasps are how a player reads facing. Mixamo needs only
  *left/right* symmetry.

### Anatomy constraints that bit

- **Shoulders sit at the top of the ribcage.** At 81% up the torso the arms read as
  sprouting from mid-chest. 93% is right.
- **Pauldrons are caps over the top of the joint, not sleeves around it.** An early one had a
  cross-section radius of 0.207 against a torso half-depth of 0.130 and was 0.414 tall
  against a 0.473-tall torso — it swallowed the shoulder and punched out front and back.
- **Legs hang INSIDE the pelvis.** Widening the stance to unfuse the feet pushed them
  outboard of the hip. Narrow the boots instead; give the torso a real pelvis flare.
- **Arm length**: a lowered fingertip should reach mid-thigh. Measure it; do not eyeball it.
- **Hands need their own exponent.** They read blocky because they inherited the armour's;
  a hand is the one part of the body with no flat planes at all.
- **Head height depends on head radius** (`head_z = neck_z + head_r`), so shrinking the head
  lowers it — Aegis's jaw sank onto the collar at `+0.001` clearance.

### Two things that break auto-rigging

- **Weapons must not be in the uploaded mesh.** A held prop confuses marker placement and
  gets skinned to the spine. `<id>_door.fbx` is exported separately for this reason.
- **Mixamo emits only its standard humanoid skeleton.** No cape bones, no skirt bones, ever.
  Coats and skirts skinned to the hips are fine; a free-flowing cape is attached after
  rigging. Anything needing cape bones is an `ENGINE ASK`.

---

## 6b. The anatomy spec — every proportion, as a number

Prose gets skipped. These are the numbers, and **most of them are enforced by
`validate.py`**, so a regression fails the build rather than waiting to be spotted by eye.

Each row exists because it was got wrong once and had to be found by looking at a render.

| Rule | Target | Enforced | Why it exists |
|---|---|---|---|
| **Head scale** | 1.25, roster-wide | data | 1.62 read chibi and fought the character's thesis. Mixed values across a team read as a bug. |
| **Shoulder height** | 72–86% of total height | ✅ `shoulder height` | At 81% *up the torso* the arms read as sprouting from mid-chest. |
| **Arm reach** | lowered fingertip lands 31–47% of height (mid-thigh ≈ 39%) | ✅ `arm reach` | Arms were 0.692 long, landing the fingertip at 31% — past mid-thigh, ape-like. |
| **Shoulder bulk** | pauldron depth ≤ 1.45 × torso depth | ✅ `shoulder bulk` | One pauldron was 0.207 deep against a 0.130 torso and 0.414 tall against a 0.473 torso. It swallowed the shoulder and punched out front and back. |
| **Legs inside hips** | leg half-width ≤ hip half-width | ✅ `legs inside hips` | Widening the stance to unfuse the feet pushed the legs outboard of the pelvis. |
| **Pelvis flare** | widest point of the lower torso | data | The torso used to taper to nothing at the hip, so the legs had nothing to hang inside. |
| **Feet separated** | > 0.008 between soles | ✅ `feet separated` | Feet at 0.58 × shoulder with boots 1.9 × limb wide overlapped through the midline. |
| **Crotch gap** | no geometry on the midline through the upper leg | ✅ `crotch gap` | Fused limbs are the most common auto-rig failure. |
| **Armpit gap** | arm clear of torso at chest height | ✅ `armpit gap` | Same reason. |
| **Head clears collar** | > 0.012 | ✅ `head clears collar` | `head_z = neck_z + head_r`, so shrinking the head *lowers* it. Aegis's jaw sat on the collar at +0.001 — fine standing still, clipping on the first head turn. |
| **Joint landmarks mirrored** | exactly | ✅ `joint landmarks` | Decoration may be asymmetric; joints may not. A pauldron's scale was feeding the arm chain's origin. |
| **T-pose arms** | centreline drift < 0.01 | ✅ `T-pose arms` | Measured on the **centreline**; raw z-spread at the tips just measures hand thickness. |
| **Feet near origin** | \|lowest z\| < 0.12 | ✅ `feet near origin` | Mixamo assumes the character stands at the origin. |
| **No UV seam wrap** | no quad with u-span > 8× median | ✅ `no UV seam wrap` | Catches the modulo bug that striped every limb. Verified by reintroducing the bug: 57 failing quads with it, 0 without. |
| **Hand roundness** | exponent ≈ 2.1, below the armour's | data | Hands read blocky because they inherited the armour's superellipse exponent; a hand has no flat planes at all. |
| **Armour wear** | pieces unwrap across a whole swatch cell | `--verify` | Sampling one pixel makes scratched plate impossible by construction. |
| **Buried ends uncapped** | `cap_start` / `cap_end` `False` where an end sits inside another form | — | Capped buried ends are interior faces: invisible, cost triangles, cast shadow from inside. |
| **No brow-ridge wedges** | — | — | Sized for a flat-faced box, they punch through a curved head beside each eye and read as spikes. |

The unenforced rows are the ones no static check can express. They are still rules.

## 7. Phase 4 — validate before you rig

```bash
blender --background --python tools/art/validate.py -- aegis
```

Fourteen checks. Nine cover the ways the auto-rigger fails or builds a bad skeleton; five
enforce the proportion spec in §6b.

```
single mesh · triangle budget · joint landmarks mirrored · T-pose arms
crotch gap · armpit gap · legs inside hips · head clears collar · feet near origin
shoulder height · arm reach · feet separated · shoulder bulk · no UV seam wrap
```

Two seconds here beats discovering the same problem after rigging and collecting eight clips.

### Decoration may be asymmetric; joints may not

Mixamo's markers go on chin, wrists, elbows, knees and groin. If those **landmarks** differ
between sides, the skeleton comes out skewed. A heavier pauldron on one shoulder changes
vertex counts without moving any landmark, and is an art choice.

The validator separates the two and only fails on landmarks. This caught a real bug: the
heavy pauldron's scale factor was feeding the arm chain's **origin**, so the left elbow,
wrist and hand all sat at different coordinates from the right.

### Measure over windows, not slices

A tube has vertices only at its **profile stops**, so a thin z-band can fall between rings
and match nothing. The first "legs inside hips" check reported `0.000 vs 0.000` and passed a
body it had never measured. A check that passes without measuring is worse than no check.

---

## 8. Phase 5 — preview, and how to read it

```bash
blender --background --python tools/art/preview.py -- aegis
```

Eight frames into `build/art/<id>/preview/`: four isometric yaws, a low-pitch profile, a
top-down, a 48px token-scale frame, and one unlit `palette.png`.

### Previews must be lit

Workbench `FLAT` is **unlit** — pure albedo, no shading. A dome and a flat disc render
**pixel-identical** under it. An earlier version used FLAT throughout, which made it
structurally incapable of showing form: several rounds of "this still looks flat" were a
blind tool, not wrong geometry.

`palette.png` is the one unlit frame, because checking colour without lighting tinting it is
the one job FLAT does better. **Use it for colour, never for shape.**

### The view transform matters

Blender 4.x defaults to **AgX**, a film emulation that deliberately crushes shadows and
desaturates. Right for a photographic render, wrong for judging a flat-shaded game asset —
it was mistaken for "STUDIO lighting is too dark" and caused the switch to FLAT in the first
place. The previews set `Standard` with a little exposure.

### What each frame answers

| Frame | Question |
|---|---|
| `iso-front/right/back/left` | does the silhouette hold from all four sides? |
| `low-profile` | does it read at 8° pitch, near edge-on? |
| `top-down` | is the crown textured? is the head an oval or a circle? |
| `token-scale` | 48px — does *anything* survive? |
| `palette` | colour only |

Yaw 0 looks **at the face**. The camera sits on −Y because that is where the portrait is; an
earlier version had it on +Y and cheerfully labelled his back as `iso-front`.

---

## 9. Phase 6 — Mixamo (the one human step)

**Mixamo is two separate screens.** Conflating them is the single most confusing thing here.

```bash
cd build/art/aegis && zip -j aegis-mixamo.zip aegis.fbx aegis_atlas.png
```

Zip the FBX *with* the atlas, so the texture is visible in the preview and you can confirm
the UVs survived. **Upload the body only** — never `<id>_door.fbx`.

### Screen 1 — the Auto-Rigger

1. mixamo.com, free Adobe account
2. **Upload Character** → the zip
3. Drag five markers: chin, both wrists, both elbows, both knees, groin
4. Choose **"No Fingers"** — fewer bones, smaller file, and fingers are invisible at
   isometric distance
5. Confirm the preview walks correctly, then accept the rig

There are **no animation options on this screen**. No format, no fps, no "In Place". Nothing
has been animated yet.

**Check two things in the preview** before going further: do the elbows and knees deform
cleanly, and did the texture come through? Both are cheaper to fix now than after collecting
clips.

### Screen 2 — the animation library

Your character in a viewport, a searchable list down the left. The clip names below are
**search terms**, not categories.

Selecting a clip opens a **settings panel on the right**. **"In Place" is a checkbox in that
panel**, and it appears only for clips that actually travel.

| Setting | Base character | Each animation |
|---|---|---|
| Format | FBX Binary | FBX Binary |
| Pose / Skin | T-pose, **With Skin** | **Without Skin** |
| Frames per second | — | 30 |
| Keyframe Reduction | — | None |
| In Place | not offered | **checked**, travelling clips only |

> **"In Place" is the failure mode that hides.** The engine owns unit positions on the grid.
> A clip that also translates the character fights it and units drift off their squares. The
> clip looks fine in isolation, which is exactly what makes it worth writing down.

Download the base **once** (search `T-Pose`, **With Skin**), then each clip **Without Skin** —
that is what lets one animation set serve the whole roster.

| Game moment | Search term | In Place |
|---|---|---|
| Resting | `idle` | not offered |
| Prep phase | `casting spell` | not offered |
| Dash phase | `running` | **tick it** |
| Blast phase | `shooting` / `sword slash` | not offered |
| Move phase | *(reuses `running`)* | — |
| Taking damage | `hit reaction` | not offered |
| Death | `falling back death` | not offered |
| Knockback | `knocked out` | not offered |

A missing In Place checkbox means the clip has no root motion and needs nothing done.

### One locomotion clip, not two

**There is exactly one ground speed in this game.** `choreograph.ts:199` gives every move step
`dur: BEAT` — 760 ms — whether it belongs to a 4-square move or an 8-square sprint. A sprint
is not faster; it is *longer*.

So a walk and a run cannot coexist: played at the same ground speed, whichever clip's stride
does not match will **foot-slide**. Two clips would guarantee the bug that one clip avoids.

Which clip is correct depends on the board scale (§11), because one square per 760 ms is:

| tile | ground speed | reads as |
|---|---|---|
| 1.0 m | 1.3 m/s | walk |
| 1.5 m | 2.0 m/s | brisk jog |
| 2.0 m | 2.6 m/s | run |

Sprint is already distinguished without animation: `renderer3d.ts:1160` draws a sprint path
**dashed** and a move path solid, and during resolution a sprint simply runs longer.

> **The clip must be time-scaled so its stride matches one square per 760 ms**, via
> `AnimationAction.timeScale` derived from the clip's own cycle length. Skip this and it
> foot-slides regardless of which clip you chose — subtly wrong forever, and nobody will be
> able to say why.

### Animation classes — what the hands are holding

The skeleton is shared; the clips are not. A clip is bone rotations, so any clip plays on any
character. What decides whether a clip **can** play is what the hands are occupied with — a
stricter filter than melee-versus-ranged.

A generic two-handed swing puts both hands on a centreline grip, which would swing Aegis's
door through his own chest. Vex's rifle needs a hand on the foregrip at all times.

| `weaponClass` | Characters | Hands |
|---|---|---|
| `door` | Aegis | a bulkhead on one arm — that arm is never free |
| `unarmed` | Bastion | fists and gauntlets |
| `twohand` | Ravok | both hands on one haft |
| `dual` | Wisp | a blade in each |
| `rifle` | Vex | shouldered, one hand always on the foregrip |
| `bow` | Kestrel | draw and loose, with a hold at full draw |
| `cast` | Cinder, Lumen, Thorn | nothing held |

**Clip tiers.** Universal (all nine): idle, run, hit, death, knocked out — five clips.
Per class: two or three attacks each, ~15 across seven classes. Per phase: prep splits two
ways (outward cast vs self-buff — Ravok's `blood_frenzy`, Bastion's `bulwark`), dash splits
two ways (five teleport, four charge) — four clips.

**≈25 clips for the whole roster, not 8 × 9 = 72.**

---

## 10. Phase 7 — build the .glb

```bash
blender --background --python tools/art/build_glb.py -- aegis ~/Downloads/mixamo-aegis
```

Point it at the folder of Mixamo downloads. It finds the **With Skin** export by detecting
which file brought a mesh — rather than trusting a filename convention nobody agreed to —
takes the action out of every other file, re-applies the atlas, and writes
`packages/client/public/models/<id>.glb` plus a `<id>.clips.json` manifest.

Clip names slug from filenames: `Falling Back Death.fbx` → `falling_back_death`.

The manifest also carries a **`version`** — a 12-hex content hash of the `.glb` beside it.
Vite fingerprints `dist/assets/`; it does **not** fingerprint `public/`, so `aegis.glb` ships
under that exact name every build and a browser holding the previous rig will keep serving it.
The client fetches the manifest with `cache: 'no-cache'` (revalidate — it is a few hundred
bytes) and appends the version to the mesh URL, so the two can never disagree about which
clips exist.

> **Mixamo exports centimetres; the client works in metres.** The script applies the
> armature's scale on import. Skipping that lands a 1.7 m character at 170 units — not
> subtly wrong, off the board entirely.

**One skeleton, many bodies.** Identical bone names mean clips retarget for free via
`SkeletonUtils`. Asset cost is `N meshes + 1 shared clip set`, not `N × (mesh + clips)`.

---

## 11. Phase 8 — renderer integration (shipped)

The box in `buildUnit` is now a `GLTFLoader`-loaded `SkinnedMesh` with an `AnimationMixer`,
cloned per unit via `SkeletonUtils.clone`, driven from the existing cue timeline. `posture`
bone offsets apply on top of the mixer — **after** `mixer.update()`, because the mixer
overwrites bone rotations wholesale each frame.

Three pieces, and the seams between them are where this went wrong once already:

| Piece | File | What it owns |
|---|---|---|
| Which clip | `character-clips.ts` | Pure. Cue → clip, priority `death > knockback > impact > ability > movement > idle`. No Three.js. |
| On screen | `character-model.ts` | Fetch, audit, instance, mixer, posture. |
| Where | `renderer3d.ts` | `buildUnit` box-or-model, `preloadCharacters`, `setUnitClip`, mixer ticks on wall time. |

**The call site is part of the feature.** All three of the above shipped working, wired to each
other, and the board drew boxes for a full session — because nothing in `app.ts` ever called
`preloadCharacters`. A fail-soft asset path produces exactly this failure: every piece passes
its own tests and the missing one is invisible. `character-preload.test.ts` is the spec that
now fails if the call goes away.

**Models arrive after the board is drawn, by design.** `app.ts` kicks the preload off without
awaiting it, because the opening paint has to stay synchronous (VISION1-opening: nothing may
await before it or the enemy team flashes unfogged). `buildUnit` decides box-or-model *once*
and `show()` caches the group forever, so `preloadCharacters` finishes by dropping the groups
of any unit whose model has since landed — `staleUnitGroups` — and the next paint rebuilds
them. Late arrival is the normal path on any cold load, not an edge case.

**Only the match's characters are fetched**, deduplicated by character id: four at most in
2v2, eight in 4v4. Never the roster.

**A model with no idle clip is refused.** `auditClips` checks the manifest's promises against
what the `.glb` actually shipped. A missing ability clip costs one animation and warns; a
missing *idle* means the unit has nothing to play when nothing is happening, so it stands in
its bind pose — a literal T-pose on the board, which reads far worse than the box. That one
falls back.

> **Clip selection lives in the renderer, never in `sampleFrame()`.** That function is pure,
> Three-free and unit-tested, and its contract is that dropping every frame changes nothing
> about where the board lands. Animation is presentation. Golden rule #1 stays intact and
> **no engine change is required by any phase of this pipeline.**

### Open: the board scale

`TILE = 1`, `UNIT_HEIGHT = 0.6`, and Aegis is **1.73 units — 1.73 tiles tall.**

Footprint is fine: the body is 0.486 × 0.310 inside a 1.0 tile. Height is not:

- **Occlusion.** Eight characters nearly two tiles tall on an 18×15 board hide each other and
  the ground, worst at 8° pitch.
- **Nameplates.** `PLATE_H = 0.66`, positioned at `PLATE_H / 2 + 0.14` = **0.47** — mid-thigh
  on this model. Every nameplate would render inside the character.

Author at human metres regardless: Mixamo expects it, and In Place clips carry no root
translation, so a scale applied at load costs nothing and is reversible. The number to pick
is **what a tile represents on the ground** — at 1.5 m per tile a 1.78 m character is 1.19
tiles. That is a game design decision, deferred until characters can be seen on the board.

---

## 12. Phase 9 — weapon props (planned)

A weapon is geometry parented to a bone after rigging:

```ts
model.getObjectByName('mixamorigLeftHand').add(doorMesh);
```

`<id>_door.fbx` already exists. Adding a weapon stays a data change via the `weapon` block.

---

## 13. Phase 10 — VFX (planned)

Mixamo supplies the *gesture*. It supplies nothing that leaves the body. VFX is entirely
code — no Blender, no Mixamo, no downloaded assets.

### The cue seam already exists

`choreograph.ts:7`: cues "describe WHAT happens, never HOW it looks."

```ts
{ kind: 'ability', phase, unitId, abilityId, area: Vec2[] }
{ kind: 'impact', unitId, amount, absorbed, sourceUnitId, abilityId }
```

**Projectile flight time is already in the data.** The `ability` cue fires at `t`; its
`impact` cue at `impactT` (`choreograph.ts:163`, `:169`). That gap *is* the flight duration.
A bullet needs no new engine event and no spec change.

More of the dispatch is derivable than it looks: abilities declare `shape`, `range`, `melee`
and `effects[].kind`, so `melee: true` means no projectile and `kind: "shield"` means a
shield effect rather than a damage one.

### What actually sells a hit

| Technique | Cost | Payoff |
|---|---|---|
| Hitstop — freeze playback 2–3 frames | ~10 lines | enormous |
| Victim flash — material to white, ~80 ms | ~10 lines | huge |
| Screen shake — jitter camera target | ~15 lines | huge |
| Knockback arc | **built** — `UnitPose.lift` | — |
| Damage numbers | **built** | — |
| Particles | few hundred lines | moderate |

**Step 1 needs no assets** — it works on the boxes that exist today, independent of
everything else in this document, and is the correct first commit of the actual work.

### Rules

- **Billboarding flips here.** Phase 3 forbids camera-facing faces; VFX *wants* camera-facing
  quads. Billboard things without form (flashes, sparks); never things with form.
- **Trails need volume** — a flat trail card disappears edge-on at 8° pitch.
- **Seed the randomness** from `cue.t + unitId`. Renderer randomness is legal under golden
  rule #1, but unseeded means a replayed turn looks different every time.
- **Area telegraphs are already built** — `drawShape` renders `area: Vec2[]`.

### Build order

1. Hitstop, victim flash, screen shake
2. Weapon props on hand bones
3. Tracers and projectiles off the ability→impact window
4. Impact particles
5. Per-ability VFX table in `data/`

---

## 14. Traps, in one place

Every one of these cost real time. They are listed because none is discoverable from the
code alone.

| Trap | Symptom | Cause |
|---|---|---|
| UV seam modulo | bright stripe down every limb | `% sides` applied to the ring index when computing `u`. The *vertex* index wraps; the UV must not, or the closing quad runs `u` back to 0. |
| `FLAT` is unlit | "it still looks flat" on correct geometry | Workbench FLAT renders pure albedo. Dome and disc are pixel-identical. |
| AgX view transform | lit renders look like murk | Blender 4.x film emulation crushes shadows on purpose. |
| Stale normals | head renders as an undifferentiated mass | `bm.normal_update()` runs in `finish()`, after classification reads `face.normal`. |
| Cap projected from front | flat disc of texture on the crown | horizontal faces share one `v`; project caps from above. |
| Flat n-gon cap | flat-topped skull | `add_tube` caps at whatever the last ring's radius is. |
| Mixamo centimetres | character 100× too big | apply the armature scale on import. |
| Buried caps | patchy shadow, wasted tris | interior faces cast shadow from inside the model. |
| Brow wedges | "polymers" beside the eyes | geometry sized for a flat face punches through a curved one. |
| Single-pixel swatches | armour cannot show wear | one pixel cannot be scratched. |
| Pauldron scale in the arm chain | skewed skeleton | decoration scale fed a joint origin. |
| Thin z-slices in checks | check passes without measuring | tubes have vertices only at profile stops. |
| Missing "In Place" | units drift off their squares | root motion fights engine-owned position. |
| Weapon in the upload | auto-rig fails or skins to spine | Mixamo cannot rig held props. |
| No studio lights (headless) | brightness setting silently ignored | distro Blender ships none. |
| Fail-soft with no call site | board draws boxes, nothing logs | every piece of the load path worked; nobody called it. A silent fallback cannot tell you it fired. |
| `public/` is not fingerprinted | model and manifest disagree about clips | Vite hashes `dist/assets/` only. Stamp a version and put it in the URL. |
| Box-or-model decided at build time | models load, units stay boxes | `buildUnit` runs once per unit and the group is cached; the fetch had not finished when the first paint ran. |

---

## 15. Role briefs

### Builder

Owns the generator and build scripts, the `renderer3d.ts` integration, the VFX system, tests.

- Ship in the §13 build order. Hitstop and flash first — they need no assets.
- Clip selection and VFX dispatch live in the renderer. Never `sampleFrame()`, never the engine.
- **No engine change is required by this pipeline.** If you think you need one, that is an
  `ENGINE ASK` and it needs the owner, not a commit.
- Renderer randomness must be seeded from `cue.t + unitId`.
- Mixamo clips are In Place: the engine owns position.
- All characters share one skeleton and one clip set.
- Golden rule #3 unchanged: every behaviour change ships with a Vitest test in the same commit.
- Run `validate.py` before handing any mesh to Mixamo.

### Analyzer

- `scripts/bundle-budget.mjs` caps gzipped **JS** at 300 kB. It counts `.js` in `dist/assets/`
  and **nothing else** — models in `public/` are invisible to it. Track `.glb` + texture total
  as a separate number or it grows unwatched.
- Determinism: confirm `skip == watch` holds once VFX lands, and no renderer randomness leaks
  into state.
- Frame budget with 8 skinned characters plus particles — the 4v4 case, not 2v2.
- Drift between the cue→clip mapping and `GAME_SPEC.md` phase semantics.
- Whether Mixamo is still operating and still free. Costing an alternative rigging path before
  it is urgent is cheap insurance.

### Designer

Owns `data/art/<id>.json` for all nine, and the per-ability VFX table.

- Write the **thesis first**. Everything downstream is decided by it.
- Art params are a separate file from balance data. Do not edit `data/characters/*.json`.
- `headScale` 1.25 and `style.blockiness` are **roster-wide**; mixed values read as a bug.
- Silhouette carries recognition at isometric distance — proportion beats surface detail.
- Design for 360° yaw and 8°–90° pitch. Backs and profiles are seen as much as fronts.
- Strong front/back asymmetry so facing reads when the camera rotates.
- Every character declares a `weaponClass`, chosen by what the hands are holding.
- Face expressions are parameters, not drawings.
- Mark anything needing a capability that does not exist as `ENGINE ASK`. Cape bones first.

---

## 16. Known risks

| Risk | Mitigation |
|---|---|
| Generated characters look like programmer art | Everything downstream is mesh-agnostic. CC0 packs (Quaternius, KayKit, Kenney) drop in unchanged. |
| Mixamo shuts down or goes paid | Meshy and Tripo3D ship auto-riggers. The clip library is the harder loss. |
| A mesh change forces a re-rig | Real cost — re-uploading is ~10 minutes. Run `validate.py` and check the previews **lit** before uploading. |
| Asset weight past the JS budget's blind spot | Analyzer tracks `.glb` total separately. |
| A clip downloaded without In Place | Units drift. Obvious once you know to look; invisible if you don't. |

---

## 17. Open decisions

- **One clip set or nine copies of it** (§18) — the build ships every clip inside every
  character's `.glb`, including the generic ones the whole roster shares. Decide before the
  roster exists; retrofitting means re-exporting every character.
- **Board scale** (§11) — what a tile represents on the ground. Deferred until characters
  can be seen on the board.
- **Aegis's abilities contradict his thesis.** The thesis says "he doesn't shield you, he
  takes it — redirection, not shielding." But `barrier_pulse` grants allies a shield and
  `intercept` is `teleport + shield`. Mechanically he is a shielder, which is the version the
  thesis rejects. Owner/Designer call; the art works either way.
- **Art direction for the other eight.** The stub files carry only `weaponClass`; the theses
  are unwritten.

---

## 18. Decision needed — one clip set, or nine copies of it

**Owner/Designer call. Make it before the other eight characters are built.** Everything below
is reversible today and expensive to reverse once nine rigs exist.

### The situation

`build_glb.py` writes one self-contained `<id>.glb` per character: mesh, skeleton, atlas and
**every clip**. That is the right shape for one character and the wrong shape for nine, because
most of those clips are not the character's. Aegis's map:

| Cue | Clip | Whose? |
|---|---|---|
| idle | `aegis_idle` | his |
| ability × 4 | `aegis_smash`, `aegis_ultimate`, `intercept_cast`, `warding_wall_cast` | his |
| run | `sword_and_shield_run` | **generic Mixamo** |
| hit | `sword_and_shield_impact` | **generic Mixamo** |
| death | `sword_and_shield_death` | **generic Mixamo** |
| knockback | `knocked_down` | **generic Mixamo** |

Four of nine are stock clips any character with the same weapon class will use. §10 already
states the principle — *"One skeleton, many bodies… asset cost is `N meshes + 1 shared clip
set`, not `N × (mesh + clips)`"* — and the build does not implement it. Nine characters means
nine copies of `knocked_down`.

### What it costs

Animation is the **majority of the bytes**, which is the part that surprises: Aegis's mesh is
1,772 triangles (~50 kB) and his atlas is 168 kB, while a single second of clip is larger than
either. The arithmetic, for a Mixamo humanoid:

> 65 bones × 30 fps × ~20 B per bone-frame (a float32 quaternion plus its time key)
> ≈ **39 kB per second of clip**, and float keyframes gzip poorly — call it ~30 kB/s over
> the wire. A 1.5 s clip is therefore ~45 kB, and a five-second shared set ~150 kB.

Which gives, as an **order-of-magnitude estimate** — the exact figure lands with the first
`.glb`, and `build_glb.py` already prints it:

| | Duplicated (today) | Shared |
|---|---|---|
| Shared clips across the roster | 9 × ~150 kB ≈ **1.35 MB** | ~150 kB |
| Cold load, 4v4 (8 characters) | 8 × ~150 kB ≈ **1.2 MB** | ~150 kB, then cached |

Roughly **1 MB per match and ~1.2 MB across the roster**, spent on nine copies of four files.

The per-match number is the one that matters more than the total, and for a reason the total
hides: a shared file is fetched once and then cached for **every** match, whatever anyone
picks. A duplicated one is re-downloaded the first time a player picks a character they have
not played, forever.

### Option A — split the export (recommended)

`build_glb.py` grows two modes and writes two kinds of file:

- `shared.glb` — skeleton + the generic clips, **no mesh**. Built once.
- `<id>.glb` — mesh + that character's own clips.

`character-model.ts` loads `shared.glb` once and concatenates its `AnimationClip[]` onto each
character's. Nothing else changes: `AnimationMixer` binds tracks by **node name**, Mixamo gives
every rig identical bone names, and `SkeletonUtils.clone` preserves them — which is the whole
reason the one-skeleton rule exists.

> **The trap in Option A.** Bone names must match *exactly*. Blender renames on collision:
> import two FBX files with a `mixamorigHips` each and the second becomes `mixamorigHips.001`.
> Today's single-blend build sidesteps this by construction; a split build must assert it. The
> check is cheap and belongs in `build_glb.py` — compare the shared file's bone names against
> the character's and fail the build on any difference, rather than shipping a `.glb` whose
> clips bind to nothing and whose units stand in bind pose.

Cost: perhaps half a day, most of it in the build script. `auditClips` already covers the
failure it introduces (a clip named by the manifest and present in neither file).

### Option B — leave it

Defensible if the roster stays at nine and the numbers above land at the low end. Every file
is self-contained, there is no cross-file bone-name contract to get wrong, and ~1 MB per match
on a desktop connection is a second. It gets less defensible with every character added.

### Option C — compress the keyframes (orthogonal to A and B)

`EXT_meshopt_compression` (via `gltfpack -cc`) quantises and compresses animation tracks well —
commonly 4–8× on keyframe data. It costs a ~25 kB decoder in the client bundle and a build
step. This is a *multiplier* on whichever of A or B is chosen, not an alternative to them:
compressed duplicates are still duplicates.

### What the decision needs

1. **Is the roster staying at nine?** Option B scales badly and only badly.
2. **How many clips end up genuinely shared?** Aegis is 4 of 9. If most characters turn out to
   want bespoke run and death animations, the duplication shrinks and B gets stronger.
3. **Is the cold-load budget a real constraint?** There is no target for it — the JS budget
   (300 kB gz) counts `.js` in `dist/assets/` and nothing in `public/`, so today the answer is
   "nobody is measuring". That is the `ASSET-WEIGHT-BUDGET` item already in the backlog, and
   this decision is the reason to schedule it.

