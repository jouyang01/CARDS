# Vex — text-to-image summary for the Rodin pipeline

**Purpose.** This is the Phase 0 entry point for building Vex the same way Wisp was built:
generate a reference image with a text-to-image model, feed that image to Rodin (image→3D),
then bake down and rig through `tools/art/rodin_*.py` + Mixamo (`docs/DECISIONS.md`,
"Rodin import art path for Wisp — 2026-08-26"). Nothing here is engine work; it is the art
direction distilled into a prompt.

**Read alongside:** `docs/ART_PIPELINE.md` §3/§6/§6b (a Rodin sculpt still has to survive
Mixamo's four auto-rig guarantees and the anatomy spec), and `docs/CHARACTER_PLAYBOOK.md` §1
(the thesis must reach all the way into the silhouette and VFX).

Everything below marked **(proposed)** is a propose-and-confirm value per `ART_PIPELINE.md` §7
— owner to confirm before the sculpt is committed to. In particular the hex codes are intended
targets for the reference image; the shipped `data/art/vex.json` palette is later **sampled
from the baked texture**, exactly as Wisp's was.

---

## 0. One-paragraph thesis (the load-bearing summary)

**Vex doesn't shoot you — she shoots where you're going to be.** A slender, futuristic
sharpshooter carrying a rifle far too big for her frame, one-handed and completely relaxed,
because she did the maths three turns ago and is waiting for you to catch up. Every tool is a
bet on your next move: the rifle fires a line you have to already be standing on, the grenade
detonates next turn where you'll be, the aerial mine triggers on your pathing. She is loud,
delighted and insufferably right — the comedy is the gap between a job that is all patient
arithmetic and a person who will not shut up about it. She reads **light against a dark board**
and is the exact mirror of Wisp: Wisp is dark, dissolving and removes information; Vex is light,
amber-armed and adds it. **The big rifle is the whole silhouette** — it has to carry her
identity alone, from every angle, because half her board presence is invisible to the enemy.

**VFX primitive, named in one word (per PLAYBOOK §1): the hovering amber mine/mote.** One
ordnance language — armed, glowing, left hanging in the air with a ground shadow under it —
repeated across beam, grenade, trap and ult. (Wisp's primitive removed light; Vex's is a warning
light that stays lit.)

---

## 1. The primary generation prompt (copy-paste)

Generate this as a **full-body character reference on a plain neutral background** — this is the
image that feeds Rodin. Keep the pose clean and near-symmetric (a relaxed A-pose, arms slightly
away from the body) so the sculpt reimports cleanly and survives Mixamo auto-rig; her signature
off-axis slouch is added later as `posture` bone offsets, never baked (`ART_PIPELINE.md` §4).

> Full-body character concept of a slender futuristic female military sharpshooter, game
> character reference sheet, front view, standing relaxed in a loose A-pose on a plain flat
> mid-grey background, even neutral studio lighting, no dramatic shadows, orthographic-style
> flat framing, whole body and feet visible.
>
> She is light and lean — a credible recon soldier, not an armoured hero. She wears a thin
> light exosuit / recon rig in **bone and pale worn-grey neutrals**, built from panels, seams
> and straps rather than bulky plates. No pauldrons, no chest plate, no backpack, no pouches,
> nothing slung — she carries nothing but the gun. A targeting monocle / half-visor is
> **pushed up off her eyes** onto her forehead; her face is clearly visible with a wry,
> amused, confident half-smile. Practical hair, short or tied back. The suit is **dead matte**
> and takes no shiny highlights.
>
> She holds an **oversized, long, heavy futuristic laser rifle** — clearly more gun than one
> person should carry — down low in **one hand**, muzzle toward the ground, arm relaxed, as if
> its weight is nothing. The rifle is the single strongest shape in the design: a long
> emitter-and-heat-sink weapon (glowing vents and an emitter, not magazines or brass) with
> **hot amber glowing working parts**. A few small **amber indicator lights** dot the rig and
> the visor. Amber is sparse on her body and appears only as these emissive points and the
> rifle's glow.
>
> Clean readable silhouette, low-poly-friendly forms, stylized game art, PBR, neutral pose,
> symmetrical, T-pose-adjacent, full character in frame.

**Negative / avoid prompt:**

> bulky armour, pauldrons, shoulder pads, power armour, chest plate, backpack, bristling
> pouches, ammo belts, grenades on the body, holstered weapons, cape, heavy boots, mech, robot,
> cartoon proportions, chibi, big head, exaggerated hips, cleavage, jokey costume, mascot,
> clown, grimdark, spec-ops balaclava, face mask, helmet covering the face, glossy shiny suit,
> wet look, brass casings, muzzle flash, action pose, motion blur, dynamic angle, cropped legs,
> multiple characters, background clutter, text, watermark.

---

## 2. Why the prompt is shaped this way (do not "simplify" these)

Each of these is a rule the brief makes non-negotiable, translated into an image constraint:

| The image must… | Because (brief §) |
|---|---|
| Put the **rifle huge and one-handed, low, muzzle-down, relaxed** | §1/§3/§4 — the gun is her primary all-angle identifier and the reason it is big; half her territory is invisible to the enemy, so the body-side read rests on the rifle alone. |
| Keep the **body slim, matte, unarmoured** — panels/seams/straps, no bulk | §4 — bulk reads Frontline; the contrast of a big gun on a light frame *is* the character. |
| Carry **nothing but the gun** — no worn ordnance | §3/§4 — the mines and grenades are *deployed*, never worn; that is what keeps "slender" true. |
| Show the **face**, monocle **pushed up**, wry amused expression | §4/§7 — she is the talker; the humour lives in expression, never in the costume. Pushed-up visor also reads "already finished aiming." |
| Read **light against dark** with **amber sparse on her, emissive only** | §5 — deliberate opposition to Wisp's dark, dissolving plum; amber = armed/warning; dead-matte person, hard-emissive equipment. |
| **Not** put the humour in the costume — stay credible military | §4 — personality-as-costume is the trap; a ridiculous gun handled with total nonchalance is funnier than a ridiculous outfit. |
| Give a **clean, near-symmetric, full-body** frame | `ART_PIPELINE.md` §6 (Mixamo needs a clean symmetric T-pose) + §4 (posture is applied after rigging). |

---

## 3. Palette targets for the reference (proposed)

Test against the real board (`#12141a` background, cool slate terrain), never against white
(§5). These are targets for the generation, not the final shipped palette — that is sampled
from the baked texture as Wisp's was.

| Role | Hex (proposed) | Notes |
|---|---|---|
| Suit / body neutral (light) | `#e6e0d2` bone, `#c2c6cc` pale grey | She must read **light** at token size. |
| Suit shadow / straps | `#8f9299` | Keeps the rig from going flat white. |
| Signature amber (armed) | `#f2a23c` | Sparse on her: emitter, heat-sink vents, indicator points. |
| Amber emissive hot core | `#ffd486` → white | The rifle's working parts and the beam glow this. |
| Rifle body (dark neutral) | `#3a3d44` | A dark tool so the amber vents pop off it. |

Separation checks this must pass: **light body vs. Wisp's dark plum** (`#64404d`) at 44px, and
**amber vs. the slate board** without touching the friend/foe UI hues (`ART_PIPELINE.md` §12b
palette rule).

---

## 4. Silhouette / 360° note for Rodin (brief §6)

Rodin builds all sides at once, and the free-rotating isometric camera (35°, unclamped yaw)
means back and profile are first-class. If the text-to-image model supports multi-view, also
generate a **back** and a **side** with the same prompt so the sculpt has real reference for
every angle; otherwise let Rodin infer them and check the silhouette test after import
(`rodin_import_decimate.py` blockout).

Three all-angle identifiers the sculpt must preserve — distribute them, because terrain
occlusion is real and a slim body won't carry recognition alone:

1. **The oversized rifle** — readable as itself from any yaw. Primary identifier.
2. **The loose, off-axis stance** — hip cocked, shoulders unsquared (added as posture offsets
   after rigging, but the build must leave room for it — don't generate her braced and square).
3. **A constellation of small amber indicator points** arranged so some are visible from every
   angle.

Silhouette test (§6): render her as a flat black shape at a spread of rotations and confirm she
is identifiable — and distinct from the other seven — at every one.

---

## 5. What this does *not* cover (downstream, not the summary)

The rifle is authored into the reference for the design read, but at rig time it becomes a
**separated prop** on a hand bone — a held weapon breaks Mixamo marker placement
(`ART_PIPELINE.md` §12/§14). `weaponClass: "rifle"` is already set in `data/art/vex.json`
(shouldered, one hand always on the foregrip — note the *combat* grip is two-handed even though
her *idle* carry is the one-handed low slouch this reference shows).

The ordnance visibility split (mine = owner-side only until it fires; grenade = shared, both
teams), the persistent hovering armed states, the walked Combat Roll, and the instant ult are
**animation + VFX** concerns (brief §7/§8) handled in `data/vfx.json` after the mesh exists —
they are not part of the character reference image. They are recorded here only so the sculpt
isn't built in a way that forecloses them (e.g. keep the amber emissive language on the rifle
consistent with the deployed ordnance so she reads as one character, not four effects).
