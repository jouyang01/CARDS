# Wisp — character bible

Character #2. Firepower / phantom. `weaponClass: dual`. Owner's direction dated
2026-08-25; built to the Mixamo handoff in the same session.

> **Read order:** `docs/CHARACTER_PLAYBOOK.md` (judgment) and `docs/ART_PIPELINE.md`
> (mechanics) first. This file is the character-specific record — the thesis, the
> parameters and why, and the decisions a maintainer must not silently undo.

Art source of truth is `data/art/wisp.json`; balance is `data/characters/wisp.json`
(not touched by art work). Everything under `build/art/wisp/` is regenerable.

---

## 1. Thesis

**Every one of her tools is a lie about where she is.** The decoy is a lie about
position; stealth a lie by omission; the teleport a truth that changes *after* the
enemy has committed. She performs flirtation and helplessness as deliberate
misdirection and is ruthlessly self-interested underneath — and she is a little
tired of how well it keeps working.

The read is **bored**: half-lidded, faintly amused, unimpressed. Seductive with
contempt rather than with effort. Played **knowing, never eager**. Reference is
Yuzuriha (Hell's Paradise) for posture and attitude — the mask *is* the weapon,
which is mechanically the same idea as the decoy — not a copy of her design.

The one-word VFX primitive (CHARACTER_PLAYBOOK §1) is **smoke**.

---

## 2. Silhouette thesis — the one big idea

**She never fully has a silhouette.** Her outline is fabric in some places and
smoke in others — a hem that dissolves, a sleeve half there, hair that trails off
into smoke rather than into tips. Even standing still she reads as half-present.

It does four jobs at once:

- renders the thesis ("a lie about where she is") as visual language;
- keeps the silhouette **coherent at token size**, because smoke fills the gaps
  bare skin would otherwise leave as holes;
- makes the decoy trivially consistent — the decoy is the same smoke holding a shape;
- carries the scanty costume **structurally** (§4).

**How it is split between mesh and VFX.** The mesh is a solid, riggable body:
Mixamo needs a single closed mesh with a symmetric T-pose, so the geometry cannot
literally dissolve. The dissolving-into-smoke is **ambient VFX** layered on the
model at runtime (§9). The mesh carries the *hard* silhouette (crown, shoulders,
hair mass, daggers); the smoke softens and completes it. This split is also what
makes the decoy safe (§8).

---

## 3. Costume

Owner's brief: **scantily clad, sexy, but tasteful.** Operative principle:
**deliberate reads as tasteful, accidental reads as cheap.** She chose this
outfit, it works, and she is faintly bored that it works.

- Wrap / haori worn **open** over a minimal underlayer, held by **one asymmetric
  sash** so the smoke escapes on the open side.
- **Bare shoulders. Bare legs from mid-thigh.**
- **HIGH CLOSED COLLAR** — the load-bearing piece. A covered throat against an
  exposed torso reads as a *chosen* costume; uniform exposure reads as the absence
  of one. The contrast is what makes it deliberate.
- Twin daggers held **reversed** (icepick), low and loose, as though she has not
  decided to use them.
- Long dark hair, the ends resolving into smoke rather than into tips.

**Avoid** anything torn, slipping, falling off, or defying gravity. Clothing that
looks like it is *failing* is the cheap register and wrong for her. No
armour-bikini. No accidental exposure — accidental is the opposite of who she is.

**Motion carries it.** Because the outline is always drifting, the appeal lives in
movement, not a held pose — which matters because she spends most of her screen
time as a small token. The idle clip does this work (§8), not a baked posture.

Encoded in `data/art/wisp.json` as the new `wrap` garment archetype
(`garment.kind: "wrap"`), built by `build_body_wrap` in
`tools/art/generate_character.py`.

---

## 4. Palette and materials

**One accent — cold plum smoke — over low-chroma neutrals.** She reads as one
saturated colour plus greys. Fabric is matte; specular highlights fight
readability under the fixed orthographic light. The smoke is **cold and
weightless** — not fire, not steam; slow drift, no upward buoyancy.

| Role | Hex | Notes |
|---|---|---|
| haori / dark / light | `#2b2833` `#1a1820` `#3b3745` | cool charcoals, faint plum cast |
| underlayer | `#4a4653` | the minimal layer under the open robe |
| sash | `#5a4a63` | the one asymmetric band |
| skin / shadow | `#cdb1a4` `#9d8074` | low-chroma |
| hair / hair-smoke | `#1d1b24` `#6a5c78` | tips bleed toward smoke |
| **smoke core / edge / deep** | `#9a7fb0` `#6f5c86` `#44394f` | the accent; her `magic` block |

**Tested against the real board colours** (`packages/client/src/themes.ts`), not
on white, as the brief requires. RGB distance of each smoke tone from the terrain
it must separate from:

| smoke | floor `#20242f` | wall `#4a5065` | brush `#2e4632` | bg `#12141a` |
|---|---|---|---|---|
| core `#9a7fb0` | 200 | 119 | 175 | 229 |
| edge `#6f5c86` | 130 | 51 | 108 | 160 |
| deep `#44394f` | 53 | 32 | 39 | 82 |

**Reading:** `core` separates cleanly from everything and is the primary read.
`deep` is a shadow tone and, as expected, sits close to the cool-slate wall — so
effects **lead with `core`** and use `deep` only as the low / near-caster tone.
The ability VFX (§9) are authored that way: blink's effortful *near* end is `deep`,
its arrival is `core`; ambient smoke peaks in `core`. This is a constraint on
future edits, not just an observation — do not restyle an effect to read in `deep`
against terrain.

Warmth is forbidden (`magic.warmthForbidden: true`) and enforced by
`ability-vfx.test.ts` (`VFX-NEVER-WARM`): plum is a violet hue, so it holds.

---

## 5. Deliverable A — portrait (HUD)

**Destination: HUD panel, bottom-left (backlog UI3). This is where the design
actually lands** — allure does not survive scaling to a board token, so the
portrait carries it.

- Bust / half-figure, face fully rendered. The bored, half-lidded expression is
  the priority read.
- Legible at small HUD size, against both light and dark UI surfaces.

**Status: NOT built here.** The portrait is a separate 2D deliverable, not this
mesh. The board face painted into the atlas (`paint_face_bored`) establishes the
canonical expression — half-lidded plum eyes, relaxed brows, winged liner, a faint
asymmetric smirk, a beauty mark under the left eye, hair bleeding to smoke — and is
the reference the portrait should match. Painting the HUD portrait is the next
Designer task.

---

## 6. Deliverable B — board model

Silhouette-first, designed top-down. Built and validated in this session.

- Identity comes from the **crown + shoulder line + ground footprint**, plus the
  hair mass and the two daggers held out. The top-down render
  (`build/art/wisp/preview/top-down.png`) reads as a dark-haired figure with two
  blades out — distinct from Aegis's door slab.
- **The smoke trail is her strongest top-down identifier**, and it is VFX (§9):
  the mesh hair gives a plan-view anchor; the plum trail completes it. Verify this
  again once ambient smoke is wired.
- Readable at pitch 90 and pitch 35 (checked in the turnaround); front/back are
  strongly asymmetric (collar+sash vs. hair+open-haori trail) so facing reads
  under the 360° camera.

### Technical budget — PROPOSED, confirm against RND1 once the renderer lands

Per the owner's instruction, this is a proposal with reasoning, not an assertion.
Units render small on a bundle-constrained browser game, so low-poly is correct,
not a compromise.

| Asset | Measured | Proposed cap | Reasoning |
|---|---|---|---|
| Body mesh | **1688 tris** | ≤ ~1800 | In line with Aegis (1772). Enough for a rounded feminine form at token scale; more is invisible. |
| Atlas | 1024² PNG, ~87 kB | 1024² (roster convention) | Shares the layout contract; she uses head + swatches, no door region. |
| Dagger | **124 tris**, one mesh | ≤ ~150 | Built once, hung off both hands (~112 kB `.glb` uncompressed). |

Flag for confirmation, not fixed. The asset-weight budget
(`packages/client/scripts/asset-budget.mjs`, cap 1.5 MB/character) is the number
that will actually bind once her rigged `.glb` exists.

---

## 7. Deliverable C — animation set

Clips derived from her kit. Mixamo search terms are proposals (ART_PIPELINE §9);
**"In Place" must be ticked on every travelling clip** or units drift off their
squares.

| Game moment | Ability | Search term | In Place | Notes |
|---|---|---|---|---|
| Resting | — | `idle` | not offered | also the decoy's only clip (§8) |
| Move / Dash | Blink, Shadowstep | `dual blades run` / `sword run` | **tick** | one locomotion clip only (ART_PIPELINE §9) |
| Blast | Dagger Flurry | `dagger slash` / `stab combo` | not offered | close cone, no wind-up |
| Blast | Bola | `throw` | not offered | the one thing that leaves her hands |
| Prep | Veil & Decoy | `casting spell` (short) | not offered | the vanish; self-cast |
| Dash | Blink / Shadowstep | `teleport` (out+in) | — | both teleports share the pair |
| Taking damage | — | `hit reaction` | not offered | shared/generic |
| Death | — | `falling back death` | not offered | generic |
| Knockback | — | `knocked out` | not offered | generic |

Reversed grip is a runtime attach rotation, not a clip constraint — generic
dual-blade clips play fine. Clip names as they'll appear in the `.glb` are in
`wisp.json`'s `clips` block.

---

## 8. The decoy constraint — read before changing anything

**Veil & Decoy leaves a decoy that renders TO THE ENEMY TEAM AS WISP.** The
deception is the entire ability, and art can break it.

- **The decoy is not a separate asset.** It is the same model playing the same
  idle clip. That makes visual parity automatic instead of a rule to remember.
- **The decoy is static** — it only ever needs `idle`. Run and attack clips never
  play on it. A real Wisp who holds position looks identical to a decoy, which is
  correct and intended.
- **NO STATE-DRIVEN VISUALS ON HER MODEL.** The decoy's HP is frozen at cast time
  and it has no energy. So if Wisp's model carried a damage state, a wound overlay,
  or an ultimate-charge glow, the two would visibly diverge and the decoy would
  give itself away instantly. **All state feedback lives in the HUD and the ground
  ring** — layers the decoy mimics — never baked into the model or its materials.
- Her ambient smoke is safe **because it is constant**, not state-driven.

> **STANDING RULE:** any ambient or idle effect added to Wisp must be added to the
> decoy in the same change. Any state-driven visual is forbidden on the model.

This rule is now a live test: `packages/client/test/wisp-decoy.test.ts` fails if
her art or VFX data grows an HP/energy/charge-keyed visual, and pins the ambient
smoke as constant.

---

## 9. Deliverable D — VFX language (smoke)

**One smoke language, reused at different intensities**, so the whole kit reads as
one character. Colours are cold plum (§4). Shipped part lives in `data/vfx.json`
under `wisp`, read by the existing `ability-vfx.ts` (content, not code):

- **Dagger Flurry** — melee cone; nothing flies, all effect at the impact.
- **Bola** — the one thing that crosses the board; keeps its tracer, slow lands as
  a lingering low ring.
- **Blink / Shadowstep Strike** — `blink: true`: a ring where she leaves (`deep`,
  the effortful near end) and where she arrives (`core`), so the eye follows a unit
  that never crossed between. Shadowstep is bigger and slower and bursts on the hit.
- **Veil & Decoy** — a single soft fade at her square: the same material the decoy
  is made of.

### Two pieces still to build (post-Mixamo, renderer integration)

1. **Ambient smoke** — the constant, decoy-safe drift that dissolves her
   silhouette (§2). Deferred deliberately: a VFX module with no live model to
   attach to would be a pure module nothing calls, which CHARACTER_PLAYBOOK §5
   names as the failure mode of this architecture. Build it *with* the renderer
   integration, seeded from `unitId + t` only (never state), with a wiring
   assertion through the real controller and mutation-checked visual test. Its
   home is a pure geometry-out module in the tracer/particles style; the client's
   `ambient-motion.ts` is the precedent for a pure, testable curve.
2. **`decoyDestroyed` beat** — the decoy's destruction emits a visible event; that
   reveal is the mind-game payout for **both** players (the enemy learns they were
   fooled; Wisp learns where they aimed), so it deserves a distinct, readable beat
   in the smoke language. Engine already emits the event; this is its VFX.

---

## 10. What was built here, and the handoff

**Built and verified in this session** (Blender 4.0.2 headless; note the pipeline
targets 4.2+, but all four scripts run correctly on 4.0.2):

- `data/art/wisp.json` — full parameters + thesis.
- Generalised the generator/painter to be multi-character (per-character
  `swatchOrder`; `wrap` archetype; `bored-seductive` face; generic weapon props),
  **Aegis output byte-identical**.
- `paint_atlas.py wisp --verify` → 12/12 swatches.
- `validate.py wisp` → **14/14, "ready for Mixamo."**
- 8 lit preview frames (`build/art/wisp/preview/`).
- Twin-dagger mesh; `build_prop.py wisp mainHand|offHand` verified (both hands →
  one `wisp_dagger.glb`).
- `data/vfx.json` smoke entry + tests; decoy-safety guard. `npm test` + typecheck
  green.

**The Mixamo handoff (the one human step, ART_PIPELINE §9):**

```bash
cd build/art/wisp && zip -j wisp-mixamo.zip wisp.fbx wisp_atlas.png
# Upload wisp.fbx ONLY (not the dagger). "No Fingers". Tick "In Place" on run.
# Then, back with the downloads folder:
blender --background --python tools/art/build_glb.py  -- wisp ~/Downloads/mixamo-wisp
blender --background --python tools/art/build_prop.py -- wisp mainHand
blender --background --python tools/art/build_prop.py -- wisp offHand
```

**Remaining after Mixamo:** the rig + `.glb`; renderer wiring; the ambient smoke
and `decoyDestroyed` VFX (§9); the HUD portrait (§5); in-client tuning of the
dagger attach offsets (`wisp.json` `weapon.*.attach`, per ART_PIPELINE §12).

> Do **not** commit `wisp.clips.json` or any Wisp `.glb` until the body `.glb`
> exists: `model-manifest.test.ts` requires a manifest to ship its mesh + full
> clip map, and `asset-budget.test.ts` asserts the character list is exactly
> `[aegis]`. The dagger and body ship together, post-Mixamo.

---

## 11. Decisions / open

- **Kit vs. thesis (CHARACTER_PLAYBOOK §3, resolved).** Unlike Aegis, Wisp's kit
  *is* her thesis: blink, decoy, stealth and shadowstep are all "a lie about where
  she is." Art and mechanics agree from the first commit. No ambiguity inherited.
- **§18 one-clip-set vs. nine copies** is still the owner's call and still applies;
  Wisp is the second character that would duplicate the four generic clips
  (`run/hit/death/knockback`). Decide before the roster grows further.
- **headScale 1.25 / blockiness 3.4 / sides 10** kept at the roster-wide values
  (CHARACTER_PLAYBOOK §2); mixed values read as a bug.
