# ART_PIPELINE.md — from `data/art/*.json` to rigged, armed, animated characters

**Status:** phase 1 partially built — see `tools/art/`. Aegis is the spike character
(`data/art/aegis.json`). Nothing in this document exists in `packages/` yet.

`paint_atlas.py` is written and verified — it produces Aegis's atlas today.
`generate_character.py` is written but **not yet executed**: it needs Blender, which the
authoring session did not have. First run is on the owner's machine and may need fixes.
**Owner directive:** characters are to be *generated*, not hand-modelled. The repo owner has
no Blender, animation or art skills, and the pipeline is designed around that constraint
rather than in spite of it.

Read this before touching `renderer3d.ts` unit rendering, before adding VFX, and before
proposing anything that changes how a unit is drawn.

---

## 1. What a unit looks like today

`renderer3d.ts:541` — a unit is a box:

```ts
new BoxGeometry(TILE * 0.55, UNIT_HEIGHT, TILE * 0.55)
```

The board is already an orthographic Three.js scene (`ARCHITECTURE.md` §RND1). The camera
is a real camera, not a projection trick: `PITCH = { top: 90, isometric: 35.264 }`
(`renderer3d.ts:58`), and free-orbit runs yaw modulo 360 with no clamp (`renderer3d.ts:782`)
with pitch clamped by `PITCH_LIMITS` down to roughly 8° before the board goes edge-on.

**Every art decision below follows from that camera.** Players see all sides of a character,
from near-ground-level to straight down.

## 2. The pipeline

| Phase | Owner | Produces |
|---|---|---|
| 0 · Setup & style lock | human | Blender installed, spike character chosen |
| 1 · Character generator | Builder | `<id>.fbx` (Blender) + `<id>_atlas.png` (no Blender) |
| 2 · Rigging & clips | human, in Mixamo | 1 rigged FBX + 8 animation FBX |
| 3 · Asset build | Builder | one `.glb`, all clips named |
| 4 · Renderer integration | Builder | boxes replaced |
| 5 · Weapon props | Builder | meshes bound to hand bones |
| 6 · VFX | Builder | hit feel, tracers, impacts |

Exactly one phase is hands-on: dragging five markers onto a model in Mixamo's web uploader.

### Blender is a build dependency, not a tool anyone opens

Blender runs headless — `blender --background --python script.py`. It is in the pipeline
because **Mixamo exports FBX and the client needs glTF**, and something has to convert,
merge clips onto one skeleton, and optimize. Nobody opens its interface.

Require 4.2 LTS or newer. Verified working on **5.2.0 LTS / macOS**. Since 4.2 Blender has
been migrating bundled add-ons to its extensions system, so confirm the two exporters this
pipeline needs are actually present before assuming they are:

```
blender --background --python-expr "import bpy; print(hasattr(bpy.ops.export_scene,'fbx'), hasattr(bpy.ops.export_scene,'gltf'))"
```

## 3. Character generation (Phase 1)

Art parameters live in **`data/art/<id>.json`**, deliberately separate from
`data/characters/<id>.json`, which holds balance numbers. Role boundaries in `CLAUDE.md`
say Builder never touches balance; separate files mean nobody has to open a balance file
to change a coat.

```json
{
  "id": "aegis",
  "height": 1.82, "headScale": 1.4, "shoulderWidth": 1.35,
  "garment": "longcoat", "hood": false, "shoulderPads": "heavy",
  "palette": { "primary": "#3b6ea5", "trim": "#d4a24c", "skin": "#c68642" },
  "face": { "eyes": "narrow", "brow": "grim", "mouth": "set" },
  "weapon": { "mainHand": "towershield", "offHand": "mace" }
}
```

### The four Mixamo guarantees

Mixamo's auto-rigger has four hard requirements. Procedural generation satisfies all four
*by construction*, which is the whole reason this beats AI mesh generators — those fail
every one of them routinely.

| Requirement | How it is met |
|---|---|
| Clean T-pose | Limbs placed at exact angles, never posed |
| Left/right symmetry | Mirrored by construction |
| Limbs not fused to torso | Explicit gaps at armpit and crotch |
| Single mesh, < 150k tris | Joined on export, ~2k tris |

### The face is painted, not modelled

Nobody models a face at this scale. The face is drawn into a texture, and because the
script builds the head it also **assigns the UVs** — the layout is a decision, not a
discovery. No unwrapping, no seams, no Blender UI.

The head is **not** a box. An earlier version made it one, on the reasoning that mapping a
rectangle onto a face needs a flat quad. That constraint is not real: instead of handing one
quad the whole rectangle, the portrait is **planar-projected** from the front onto a tapered
form, so it wraps around the skull the way a face actually sits on one. Each face of the head
picks its projection from where it sits — front gets the portrait, back gets hair, the sides
get their own region, and the horizontal caps project from above rather than from the front
(project a cap from the front and every vertex shares one `v`, so the whole cap samples a
one-pixel strip). The painted face region carries a **hairline** across its top, because the
projection runs chin-to-crown and the top of that rectangle lands where hair belongs.

Atlas layout (1024²):

| Region | Pixels | Contents |
|---|---|---|
| Head front | `0,0–256,256` | Eyes, brows, mouth |
| Head back | `256,0–512,256` | Hair, hood interior |
| Head sides | `512,0–768,256` | Ears, hair wrap |
| Torso | `0,256–512,512` | Coat, belt, trim |
| Flat swatches | `512,256–1024,512` | Solid colours for limbs, boots, gloves |

That last row is the economy of the whole approach: most of the body points at a single
solid-coloured pixel. Only the face earns real pixel detail.

**Texture generation is a separate script that does not use Blender.** Painting a face into a
PNG is plain 2D image drawing; Blender builds geometry and assigns UVs, and never touches
pixels. That split is deliberate — the texture step then runs and tests without launching
Blender, it mirrors how `textures.ts` already generates textures in the client, and it
removes any question about what Blender's bundled Python does or does not ship. Plain Python
with Pillow, or Node with canvas to match the client, are both fine.

### Rules the rotating camera imposes

- **No billboard face plane.** It swims visibly when the camera orbits.
- **No untextured back of head.** The camera is behind the model half the time.
- **No flat cards** for hair or cloth — they vanish edge-on near 8° pitch.
- **Supporting geometry under the face** — a shallow nose wedge, a brow ridge, slightly
  inset eye sockets. ~40 extra triangles, and the difference between a 3D character and a
  ball with a decal.
- **Front/back asymmetry is a feature.** A rotating camera destroys the "up is north"
  anchor, so hoods, packs and cloak clasps are how a player reads facing. Mixamo needs only
  *left/right* symmetry; front-to-back is free.

### Two things that break auto-rigging

- **Weapons must not be in the uploaded mesh.** A held prop confuses marker placement and
  gets skinned to the spine. Rig the bare body; attach weapons in Phase 5.
- **Mixamo emits only its standard humanoid skeleton.** No cape bones, no skirt bones,
  ever. Coats and skirts skinned to the hips are fine; a free-flowing cape is attached in
  Phase 3, after rigging. Anything needing cape bones is an `ENGINE ASK`.

## 4. Mixamo (Phase 2 — the human step)

**Mixamo is two separate screens.** Conflating them is the single most confusing thing
about this step, so they are documented separately here.

### Screen 1 — the Auto-Rigger

1. mixamo.com, free Adobe account.
2. **Upload Character** → the `.zip` from Phase 1 (FBX + atlas together, so the texture is
   visible in the preview and you can confirm UVs survived).
3. Drag five markers: chin, both wrists, both elbows, both knees, groin.
4. Choose the **"No Fingers"** skeleton — fewer bones, smaller file, and fingers are
   invisible at isometric distance.
5. Confirm the preview walks correctly, then accept the rig.

There are **no animation options on this screen** — no format, no fps, no "In Place".
Nothing has been animated yet. Accepting the rig moves you to screen 2.

### Screen 2 — the animation library

Your character in a viewport, a searchable animation list down the left. The clip names in
the table below are **search terms**, not sections or categories.

Selecting a clip opens a **settings panel on the right** with sliders for that clip
(Overdrive, Character Arm-Space, Trim). **"In Place" is a checkbox in that panel**, and it
appears only for clips that actually travel — idle, attack and death clips do not offer it,
because they have no root motion to strip.

Download the base character once (search `T-Pose`, apply, download **With Skin**), then each
clip **Without Skin** so they all share one skeleton.

| Setting | Base character | Each animation |
|---|---|---|
| Format | FBX Binary (.fbx) | FBX Binary (.fbx) |
| Pose / Skin | T-pose, **With Skin** | **Without Skin** |
| Frames per second | — | 30 |
| Keyframe Reduction | — | None |
| In Place | not offered | **Checked**, on travelling clips only |

> **"In Place" is the failure mode that hides.** The engine owns unit positions on the grid.
> If the animation also translates the character, the two fight and units drift off their
> squares. In Place strips the root motion and leaves pure leg movement. A clip downloaded
> without it looks fine in isolation and is wrong in the game.

Clips, mapped onto the cue kinds in `choreograph.ts`:

| Game moment | Search term | In Place |
|---|---|---|
| Resting | `idle` | not offered |
| Prep phase | `casting spell` | not offered |
| Dash phase | `running` | **tick it** |
| Blast phase | `shooting` / `sword slash` | not offered |
| Move phase | `walking` | **tick it** |
| Taking damage | `hit reaction` | not offered |
| Death | `falling back death` | not offered |
| Knockback | `knocked out` | not offered |

If a clip you expect to travel offers no In Place checkbox, it has no root motion and needs
nothing done — that is not a problem.

## 5. Asset build (Phase 3)

A second headless Blender script imports the rigged base plus every animation FBX, merges
clips onto one skeleton as named actions, re-attaches loose cloth, re-applies the
authoritative material, and exports one optimized `.glb` to
`packages/client/public/models/`.

**One skeleton, many bodies.** Every character rigs to the identical Mixamo humanoid with
identical bone names, so the clips are downloaded *once* and shared across the roster —
they retarget for free via `SkeletonUtils`. Asset cost is `N meshes + 1 shared clip set`,
not `N × (mesh + clips)`. With nine characters and 4v4 supported, that is the difference
between shipping and not.

**Budget note.** `scripts/bundle-budget.mjs` caps gzipped **JS** at 300 kB, currently
around 145 kB. `GLTFLoader` adds roughly 15–20 kB gz to that. The `.glb` files are separate
static assets and are **not** counted by that script — see the Analyzer brief below.

## 6. Renderer integration (Phase 4)

The box at `renderer3d.ts:541` becomes a `GLTFLoader`-loaded `SkinnedMesh` with an
`AnimationMixer`, cloned per unit via `SkeletonUtils.clone`, driven from the existing cue
timeline.

> **Clip selection lives in the renderer, never in `sampleFrame()`.** That function is pure,
> Three-free and unit-tested, and its contract is that dropping every frame changes nothing
> about where the board lands. Animation is presentation. Golden rule #1 is untouched and
> **no engine change is required by any phase of this pipeline.**

## 7. Weapons and VFX (Phases 5–6)

Mixamo supplies the *gesture* — the swing, the recoil, the brace. It supplies nothing that
leaves the body. VFX is a separate subsystem and is entirely code: no Blender, no Mixamo,
no downloaded assets.

### Weapons are geometry on a bone

Mixamo bones carry a `mixamorig` prefix:

```ts
model.getObjectByName('mixamorigRightHand').add(swordMesh);
```

The weapon mesh comes from the same generator reading the `weapon` field of
`data/art/<id>.json`. Adding a weapon stays a data change.

### The cue seam already exists

`choreograph.ts:7` states the rule: cues "describe WHAT happens, never HOW it looks." The
payloads already carry what effects need:

```ts
{ kind: 'ability', phase, unitId, abilityId, area: Vec2[] }
{ kind: 'impact', unitId, amount, absorbed, sourceUnitId, abilityId }
```

**Projectile flight time is already in the data.** The `ability` cue fires at `t`; its
`impact` cue fires later at `impactT` (`choreograph.ts:163` and `:169`). That gap *is* the
flight duration; source position comes from `sourceUnitId`, destination from `unitId`. A
bullet needs no new engine event and no spec change.

More of the dispatch is derivable than it looks. Abilities already declare `shape`,
`range`, `melee` and `effects[].kind`, so `melee: true` means no projectile,
`shape: "cone"` means a cone burst, and `kind: "shield"` means a shield effect rather than
a damage one.

### What actually sells a hit

Two of the top five are already built.

| Technique | Cost | Payoff |
|---|---|---|
| Hitstop — freeze playback 2–3 frames | ~10 lines | enormous |
| Victim flash — material to white, ~80 ms | ~10 lines | huge |
| Screen shake — jitter camera target, fast decay | ~15 lines | huge |
| Knockback arc | **built** — `UnitPose.lift` | — |
| Damage numbers | **built** | — |
| Particles and sparks | few hundred lines | moderate |

### Effect families

- **Weapon meshes** — Phase 5 above.
- **Projectiles** — a stretched mesh lerped across the ability→impact window with a
  trailing ribbon. For hitscan, a tracer faded over ~150 ms; `drawPath` (`renderer3d.ts:1154`)
  already proves the `Line` primitive works here.
- **Impacts** — additive-blended quads with procedurally drawn radial-gradient textures,
  same approach as the face atlas.
- **Area telegraphs** — *already built.* `drawShape` renders `area: Vec2[]` from ability cues.

**Billboarding flips between phases.** Phase 1 forbids camera-facing faces; VFX *wants*
camera-facing quads. The rule: billboard things without form (flashes, sparks, glows), never
things with form (faces, bodies). And trails need volume — a flat trail card disappears
edge-on at 8° pitch, so use a tube or rebuild the ribbon per frame.

### Seed the randomness

Particle spread wants jitter, and in the renderer `Math.random()` is legal — golden rule #1
binds the engine, not the view. But unseeded means a replayed turn looks different each
time. Seed a small PRNG from `cue.t + unitId` and replays become visually reproducible,
keeping `skip == watch` true in spirit as well as in state.

### Build order

1. Hitstop, victim flash, screen shake
2. Weapon props on hand bones
3. Tracers and projectiles off the ability→impact window
4. Impact particles
5. Per-ability VFX table in `data/`

**Step 1 needs no assets at all** — it works on the boxes that exist today. It is the
correct first commit of this whole effort and does not block on Blender, Mixamo, or any
Phase 1 output.

---

## 8. Role briefs

### Builder

Owns the generator and build scripts, the `renderer3d.ts` integration, the VFX system, tests.

- Ship in the §7 build order. Hitstop and flash first — they need no assets.
- Clip selection and VFX dispatch live in the renderer. Never in `sampleFrame()`, never in
  the engine.
- **No engine change is required by this pipeline.** Projectile timing derives from the
  existing `ability`→`impact` cue gap. If you think you need an engine change, that is an
  `ENGINE ASK` and it needs the owner, not a commit.
- Renderer randomness must be seeded from `cue.t + unitId` so replays are reproducible.
- Mixamo clips are exported *In Place*: the engine owns position; animation must never
  translate the unit.
- All characters share one skeleton and one clip set. Do not load per-character animations.
- Golden rule #3 is unchanged: every behaviour change ships with a Vitest test in the same
  commit.

### Analyzer

Watches for regressions this pipeline can introduce.

- `scripts/bundle-budget.mjs` — 300 kB gz JS cap. `GLTFLoader` is the new pressure; flag any
  jump.
- **Asset weight is not in that budget.** Track `.glb` + texture total as a separate number
  or it grows unwatched. Recommending a budget for it is a good first backlog item.
- Determinism: confirm `skip == watch` still holds once VFX lands, and that no renderer
  randomness leaks into state.
- Frame budget with 8 skinned characters plus particles — the 4v4 case, not the 2v2 one.
- Drift between the cue→clip mapping and `GAME_SPEC.md` phase semantics.
- Whether Mixamo is still operating and still free. Adobe has been retiring parts of it;
  costing an alternative rigging path before it is urgent is cheap insurance.

### Designer

Owns `data/art/<id>.json` for all nine characters, and the per-ability VFX table.

- Art params are a **new file per character**, separate from balance data. Do not edit
  `data/characters/*.json`.
- Silhouette carries recognition at isometric distance — proportion and shoulder shape
  matter far more than surface detail.
- Design for 360° yaw and 8°–90° pitch. Backs and profiles are seen as much as fronts.
- Give every character strong front/back asymmetry so facing reads when the camera rotates.
- Face expressions are parameters, not drawings: `eyes`, `brow`, `mouth`.
- Mark anything needing a capability that does not exist as `ENGINE ASK`. Cape bones are the
  likely first one.

## 9. Known risks

| Risk | Mitigation |
|---|---|
| Auto-rig rejects the mesh | The four guarantees in §3 are built in. Spike one character to find out early. |
| Generated characters look like programmer art | Everything downstream is mesh-agnostic. Swap in CC0 models (Quaternius, KayKit, Kenney) and the rest of the pipeline is unchanged. |
| Mixamo shuts down or goes paid | Meshy and Tripo3D ship their own auto-riggers. The clip library is the harder loss, not the rigging. |
| A clip downloaded without "In Place" | Units visibly drift off their squares. Obvious once you know to look; invisible if you do not. |
| Asset weight creeping past the JS budget's blind spot | Analyzer tracks `.glb` total separately. |

## 10. First steps

1. Human: install Blender 4.2 LTS or newer; confirm `blender --version` runs from a terminal,
   then confirm the FBX and glTF exporters are present with the `--python-expr` check in §2.
2. Human: confirm the spike character. **Aegis** is the recommendation — `frontline`
   archetype, shield, chunky silhouette, and `shield_bash` is `melee: true`, so the
   rig-and-animate loop can be proven without any projectile VFX.
3. Builder: §7 step 1 (hitstop, flash, shake) can start immediately and independently.
