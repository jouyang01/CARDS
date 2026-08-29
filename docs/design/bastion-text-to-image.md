# Bastion — text-to-image summary for the Rodin pipeline

**Purpose.** This is the Phase 0 entry point for building Bastion the same way Vex and Wisp
were built: generate a reference image with a text-to-image model, feed that image to Rodin
(image→3D), then bake down and rig through `tools/art/rodin_*.py` + Mixamo (`docs/DECISIONS.md`,
"Rodin import art path for Wisp — 2026-08-26"; `docs/design/vex-text-to-image.md`). Nothing here
is engine work; it is the art direction from the owner's brief distilled into a prompt.

**Read alongside:** `docs/ART_PIPELINE.md` §3/§6/§6b (a Rodin sculpt still has to survive
Mixamo's four auto-rig guarantees and the anatomy spec), and `docs/CHARACTER_PLAYBOOK.md` §1
(the thesis must reach all the way into the silhouette and VFX).

Everything below marked **(proposed)** is a propose-and-confirm value per `ART_PIPELINE.md` §7
— owner to confirm before the sculpt is committed to. In particular the hex codes are intended
targets for the reference image; the shipped `data/art/bastion.json` palette is later **sampled
from the baked texture**, exactly as Wisp's and Vex's were.

---

## 0. One-paragraph thesis (the load-bearing summary)

**Bastion doesn't predict where you'll be — he decides.** A buff, oversized industrial
frontliner who is the only character on the board with **no weapon and no magic**: everything he
does is muscle and machinery, and **nothing he does glows**. His hands are the kit — a matched
pair of massive, blunt, mechanical gauntlets — and a heavy chain is coiled across both forearms
and shoulders, built into his arms, ready to fire and hook you across the board. He is the
**Anchor**: not a wall that stands still but the thing you are attached to and cannot get away
from. He reads as **skin and iron** — the darkest, heaviest, widest mass on the board, warm bare
muscle above the gauntlets doing the value contrast against near-black metal — and he leans
**toward** the fight, chest out, chin up, eager. He is the exact opposite of the two big
characters he must never converge with: not hunched, burdened or grim like **Aegis**, and not
red-hot blood-and-rage like **Ravok**. He is cold, colourless, upright and pleased to see you.

**VFX primitive, named in one word (per PLAYBOOK §1): the hot white impact flash.** He emits
force, not light — a hard white flash and compression at the single instant of contact (knuckle
strike, shoulder hit, hook bite), short and violent and gone. He is dead grey until he connects.
The **chain is not an effect** — it is a real physical object with weight, the primary silhouette
identifier, coiled when idle and spanning the whole board when it hooks.

---

## 1. The primary generation prompt (copy-paste)

Generate this as a **full-body character reference on a plain neutral background** — this is the
image that feeds Rodin. Keep the pose clean and near-symmetric (a relaxed A-pose, arms slightly
away from the body) so the sculpt reimports cleanly and survives Mixamo auto-rig; his signature
**forward, leaning-in lean** is added later as `posture` bone offsets, never baked
(`ART_PIPELINE.md` §4). The matched gauntlets make symmetry easy — do not generate him mid-swing
or braced.

> Full-body character concept of a huge, muscular, industrial brawler, game character reference
> sheet, front view, standing upright and relaxed in a loose A-pose on a plain flat mid-grey
> background, even neutral studio lighting, no dramatic shadows, orthographic-style flat framing,
> whole body and feet visible.
>
> He is **buff and large — the broadest, heaviest body on the board**, built like a dock worker,
> not a knight. **Bare, muscular arms and shoulders**; armour covers only the **torso and the
> forearms**. His build is bolted-on industrial hardware — thick worn plate, exposed rivets,
> scuffed near-black gunmetal — dock and salvage equipment, not a suit of armour and not fantasy
> plate. Head **bare** or minimally covered, face visible, an **eager, confident, pleased**
> expression — he wants this fight. Posture upright, chest out, chin up.
>
> On his hands he wears **TWO IDENTICAL, matched, oversized, blunt mechanical gauntlets** — a
> symmetric pair, heavy working tools, NOT one hook and one fist, NOT knight's gauntlets. A
> **heavy iron chain is coiled thickly across both forearms and both shoulders**, a mass of
> chunky links wrapping the arms, with a small **winch / spool housing at each shoulder** where
> the chain feeds from; the chain visibly **feeds into a housing inside each forearm gauntlet**
> through vents in the plating, so it has an obvious source. He carries **no held weapon of any
> kind** and there is **nothing in his hands** — his hands and the chain are the whole kit.
>
> Colour is **skin and iron only**, no accent colour anywhere: **warm, bright bare skin** on the
> arms and shoulders against **near-black worn gunmetal** armour and chain. **No glow, no energy,
> no magic, no light source of any kind.** Matte iron with slight worn-edge specular for weight;
> skin is the only soft surface. Clean readable silhouette, low-poly-friendly forms, stylized
> game art, PBR, neutral pose, symmetrical, T-pose-adjacent, full character in frame.

**Negative / avoid prompt:**

> held weapon, hammer, mace, sword, axe, shield, gun, staff, anything in his hands, one hook arm,
> asymmetric arms, mismatched gauntlets, knight, plate armour, fantasy armour, sci-fi power armour,
> mech, robot, glow, glowing, energy, magic, runes, light source, neon, emissive, red, blood,
> rage, hunched, stooped, burdened, grim, brooding, tired, helmet covering the face, full face
> mask, covered arms, sleeves, slim build, thin, lean, cape, cloak, cartoon proportions, chibi,
> big head, action pose, mid-swing, motion blur, dynamic angle, cropped legs, multiple characters,
> background clutter, text, watermark.

---

## 2. Why the prompt is shaped this way (do not "simplify" these)

Each of these is a rule the brief makes non-negotiable, translated into an image constraint:

| The image must… | Because (brief §) |
|---|---|
| Show a **coiled chain across both forearms and both shoulders**, with a **spool at each shoulder** and a **housing inside each forearm** | §3/§4/§6 — the chain is the character and the **primary all-angle identifier**; it must have an obvious source so the hook reads as paying out of his arm, not from a held object. |
| Give him **two identical, matched, oversized gauntlets** — never one hook + one fist | §4/§6 — the matched pair is the owner's direction *and* the better call under a rotating camera: a symmetric low-and-wide arm profile reads the same from every yaw; an asymmetric one changes character as the camera orbits. |
| Put **nothing in his hands** — no held weapon at all | §1/§4 — he is the **only character with no weapon and no magic**; anything held undermines the entire identity. His hands are the kit. |
| Keep **arms and shoulders bare and muscular**; armour only on **torso + forearms** | §4 — he is buff and the design must show it; bare skin above the gauntlets is the value contrast, and it separates him from Aegis, who is fully covered. |
| Read **skin and iron, no accent colour, warm bright skin vs near-black iron** | §5 — he is the only character with **no accent colour and no light source**; his readability lives entirely in the skin/iron value split against the cool slate board. |
| Carry **no glow, no energy, no magic** anywhere | §1/§5/§8 — the character with no power source is instantly identifiable in a roster of glowing things; his only colour is the impact flash, which is not in the reference. |
| Stand **upright, chest out, chin up, eager** — never hunched or grim | §2/§4 — "buff, large, and not afraid to fight," played eager; hunched + grim is **Aegis's** silhouette and register and the two large Frontliners must not converge. |
| Stay **cold and colourless — no red, no rage** | §5/§6 — red is **Ravok's** blood-and-rage register; the two big bruisers are the single biggest identification risk in the roster and must diverge on colour and posture. |
| Give a **clean, near-symmetric, full-body** frame | `ART_PIPELINE.md` §6 (Mixamo needs a clean symmetric T-pose) + §4 (his forward lean is applied after rigging as posture offsets). |

---

## 3. Palette targets for the reference (proposed)

Test against the real board (`#12141a` background, cool slate terrain), never against white
(§5). These are targets for the generation, not the final shipped palette — that is sampled
from the baked texture as Wisp's and Vex's were. He has **no accent colour** at all — the whole
palette is two materials, iron and skin, plus a contact-only white.

| Role | Hex (proposed) | Notes |
|---|---|---|
| Iron base (near-black gunmetal) | `#1a1c20` | He must be the **darkest, heaviest mass** on the board. |
| Iron worn edge / specular highlight | `#3a3d43` | Slight specular on worn metal edges sells mass (unlike the other characters' flat treatments). |
| Chain links (iron, slightly lifted) | `#26282e` | Reads as chunky metal, a touch lighter than the plate so the coil is legible against it. |
| Skin mid (warm, bright) | `#c88a5e` | The **value contrast** — warm skin vs near-black iron and cool slate is what separates him from the board. |
| Skin highlight | `#e2a97c` | Keeps the muscle reading soft and lit at token size. |
| Skin shadow | `#8a5638` | Stops the arms going flat; still clearly warm. |
| Impact flash (contact only, NOT in the reference) | `#ffffff` → `#ffe6c0` | His only colour and his only effect; authored in `data/vfx.json`, never a persistent glow on the body. |

Separation checks this must pass: **warm skin vs. the cool slate board** at 44px (his entire
readability rests on this — a grey character on a grey board disappears), **iron mass vs. Ravok**
(cold near-black vs. Ravok's warm/red register), and **upright cold silhouette vs. Aegis's
hunched covered one**, without the palette touching the friend/foe UI hues (`ART_PIPELINE.md`
§12b palette rule).

---

## 4. Silhouette / 360° note for Rodin (brief §6)

Rodin builds all sides at once, and the free-rotating isometric camera (35°, unclamped yaw)
means back and profile are first-class — occlusion from terrain height is real. If the
text-to-image model supports multi-view, also generate a **back** and a **side** with the same
prompt (the shoulder spools and the coiled chain read especially well from behind) so the sculpt
has real reference for every angle; otherwise let Rodin infer them and check the silhouette test
after import (`rodin_import_decimate.py` blockout).

Three all-angle identifiers the sculpt must preserve — distribute them, because terrain
occlusion is real and any visible fragment still has to read:

1. **The coiled chain across both forearms and shoulders** — chunky, irregular, unmistakable,
   no bad angle. **Primary identifier.**
2. **The matched oversized gauntlets** — a symmetric low-and-wide arm profile no one else has;
   the symmetry is the point (it reads the same from every yaw).
3. **Mass and width** — he should be the **broadest footprint and the tallest bulk** on the
   board; the flat black shape alone should read "this one is the problem." Build **height and
   bulk** rather than fighting for footprint — vertical extent is visible at this pitch and he
   benefits most.

Silhouette test (§6): render him as a flat black shape at a spread of rotations and confirm he
is identifiable — **and distinct from Ravok and Aegis** — at every one. Ravok and Aegis are the
single biggest identification risk in the roster; check all three silhouettes side by side at
every rotation before signing off. Bastion is the **upright, wide, chain-wrapped** one.

---

## 5. Chain build budget — the one place that will tempt over-spend (brief §6, flag to confirm)

Two different chains, two different builds — **both flagged for owner confirmation** per
`ART_PIPELINE.md` §7 before the sculpt is committed:

- **The idle coiled chain** (across forearms + shoulders) is an **all-angle identifier**, so it
  must be **real geometry baked into the body sculpt**, not an effect. Propose Rodin sculpts it
  as part of the body and it bakes down with the mesh. Body baked **heavier than the others** —
  he is the biggest mass: **(proposed) 9000–10000 tris / 1024 atlas** (vs. Vex's body at 8000 /
  1024), the coiled chain reading as chunky silhouette rather than individually modelled links.
- **The in-flight hook chain** (Chain Hook — crosses the whole board, must read from any yaw
  including near-parallel to its own axis, the hard case) is **not in the reference image** and
  is a **runtime-generated object**, not baked. **(Proposed)** build it as a **segmented
  low-poly tube / instanced links swept along the hook spline** so it has real cross-section from
  any angle (an alpha-card ribbon fails the near-parallel view). Rough budget **(proposed)** a
  few hundred tris for the whole span + a **512 tiling link texture**; it must sag when slack and
  snap taut, and read as **metal, never a beam or energy tether**. Owner to confirm geometry vs.
  instanced-links vs. shader and the triangle/texture budget before build.

---

## 6. What this does *not* cover (downstream, not the summary)

Unlike Vex's rifle, **the gauntlets are worn, not held** — they move with the arms, so they are
**part of the body sculpt and rig**, not a separated hand-bone prop. `weaponClass: "unarmed"` is
already set in `data/art/bastion.json`; there is no held-prop attach step. This keeps the rig
simpler than the armed characters'.

The following are **animation + VFX** concerns (brief §7/§8) handled in `data/vfx.json` and the
clip set after the mesh exists — they are **not** part of the character reference image, and are
recorded here only so the sculpt isn't built in a way that forecloses them:

- **The white impact flash** (his only effect) — knuckle, shoulder, hook bite. Short, violent,
  gone; never a persistent glow on the baked body.
- **Chain Hook is split across two beats with a taut hold between them** (constraint §7.1) —
  fire, an indeterminate-length taut hold while other Blast abilities resolve, then the
  end-of-phase yank. The in-flight chain (see §5) must persist and stay connected through it.
- **Ram Charge is a walked dash that hits the first enemy in its path** (constraint §7.2) — the
  animation must show him crossing the ground and connecting with whoever is first, not
  teleporting to the destination.
- **Both control tools delete the victim's planned Move** (constraint §7.3, "the single most
  important readability problem in his kit") — the displacement must sell "your movement was
  taken from you," via drag, stagger and ground scuff.
- **Bulwark / Fortress Protocol shields read as physical** — plates and bracing that clamp into
  place, never a magic bubble (he has no power source; this also separates him from Aegis, whose
  shields are explicitly magical).
- **Idle is impatient, not watchful; the ult is "walk at them"** — no roar, no explosion, he
  simply sets himself and starts walking.

These live downstream so the reference stays what it is: one clean, symmetric, full-body image of
a buff iron brawler wrapped in chain, carrying nothing, that Rodin can turn into a mesh.
