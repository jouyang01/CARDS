# CHARACTER_PLAYBOOK.md — what building Aegis taught, for whoever builds character #2

`ART_PIPELINE.md` is the **mechanics**: the commands, the phases, the traps, the anatomy
numbers. Read it. This file is the **judgment** — what we now know that we did not know
when Aegis started, in the order a new session needs it.

One character exists. Eight stubs carry a `weaponClass` and nothing else. Everything below
is written for the session that turns the second stub into a character.

---

## 0. Read this order, then stop reading and go write a thesis

1. `CLAUDE.md` — golden rules, role boundaries
2. `docs/ART_PIPELINE.md` §3 (art direction), §6b (the anatomy spec), §14 (traps)
3. This file
4. `data/art/aegis.json` — the only complete worked example

Do **not** start by opening `generate_character.py`. The single most expensive mistake
available is generating geometry before the thesis exists.

---

## 1. The thesis is load-bearing, and it reaches further than you think

`ART_PIPELINE.md` §3 says write a thesis first. What it does not say is **how far down
the stack the thesis actually propagates**. For Aegis, one paragraph decided:

| Decision | Ruled by the thesis |
|---|---|
| No heroic silhouette | "exhaustion and a little contempt, not devotion" |
| `headScale` 1.25, not 1.62 | 1.62 read chibi, which fights exhaustion |
| Magic is pale and sickly, never warm | "a paladin's light is given to him; Aegis forces his" |
| `warmthForbidden: true` | the same sentence, encoded as a constraint a test can check |
| Weapon is a salvaged bulkhead, not a shield | "he'd rather eat the hit than trust you to avoid it" |
| The door rides the **forearm**, not the hand | a hand grip would let him put it down; that arm is never free |
| 47 tally marks, lower third | he has been doing this a long time and is counting |
| **Every VFX is a slab at 0.85 × 1.55** | the same proportion as the door. He has one idea and he keeps having it. |

That last row is the one to internalise. **The thesis has to survive all the way into
the VFX**, and the mechanism for that is `vfxLanguage`:

```json
"vfxLanguage": {
  "primitive": "slab",
  "slabAspect": [0.85, 1.55],
  "shared": true
}
```

A character has **one visual idea and repeats it**. Aegis's is the slab. Character #2
needs its own primitive chosen *from its thesis* — not picked off a menu of effects.
If you cannot name the primitive in one word, the thesis is not finished.

**Write the thesis before anything else, and get it approved.** The theses for the other
eight are unwritten and are the owner's call (`ART_PIPELINE.md` §17). That, not tooling,
is the real blocker on character #2.

---

## 2. Know what is roster-wide before you touch a parameter

The most common way to waste a session is re-deciding something that was already settled
for the whole roster. Mixed values across a team **read as a bug, not as variety**.

### Settled roster-wide — do not re-open per character

| Parameter | Value | Where it was decided |
|---|---|---|
| `build.headScale` | **1.25** | §4, by rendering 1.00/1.20/1.40/1.62 side by side at close range and at 44px |
| `style.blockiness` | **3.4** (superellipse exponent) | §4 — one knob moves the whole roster between silhouette languages |
| `style.sides` | **10** | §4 |
| Hand roundness | exponent ≈ 2.1, below the armour's | §6b — a hand has no flat planes at all |
| Every row of the anatomy spec | §6b | 19 rules, most enforced by `validate.py` |
| Posture is applied **after** rigging | never baked into the T-pose | §4 |
| Feet near origin, T-pose symmetric | `validate.py` | Mixamo requirements |

### Per character — this is your actual design surface

`thesis`, `build` (minus `headScale`), `posture` offsets, `garment`, `palette`, `magic`,
`face`, `weapon`, `vfxLanguage`, `clips`.

`ART_PIPELINE.md` §6b exists because **every one of its 19 rows was got wrong once and
found by looking at a render**. Treat it as the shape of the problem, not as a checklist
someone else already cleared. `validate.py` catches most of it before you ever reach
Mixamo; run it.

---

## 3. Two decisions to make BEFORE character #2, not after

Both are cheap now and expensive once a second rig exists.

**One clip set, or nine copies of it** (`ART_PIPELINE.md` §18). The build writes every
clip into every `.glb`, including the four generic ones (`sword_and_shield_run/impact/death`,
`knocked_down`) that any character of the same weapon class shares. Nine characters means
nine copies of `knocked_down`. The estimate is roughly **1 MB wasted per match and ~1.2 MB
across the roster** — and the per-match number is the one that hurts, because a shared file
is fetched once and cached for every match forever, while a duplicated one is re-downloaded
the first time a player picks a character they have not played. §18 recommends Option A
(split the export). **Retrofitting means re-exporting every character.** Decide first.

**Whether Aegis's kit matches his thesis** (`ART_PIPELINE.md` §17). The thesis says
redirection — "he doesn't shield you, he takes it." But `barrier_pulse` grants allies a
shield and `intercept` is teleport + shield. Mechanically he is the shielder his thesis
rejects. The art works either way, so it was left open — but character #2 should not
inherit the ambiguity. **Settle the kit and the thesis together**, so art and mechanics
agree from the first commit rather than being reconciled after both exist.

---

## 4. Character-specific VFX — the architecture that came out of it

VFX shipped this session (`ART_PIPELINE.md` §13 still says "planned"; it is not). The
shape it settled into is the part worth carrying forward.

### Two layers, and the split is the whole design

| Layer | File | Answers | Scope |
|---|---|---|---|
| Universal | `vfx.ts` | what does **any** hit do? | hitstop, victim flash, screen shake — same whoever threw the punch |
| Identity | `ability-vfx.ts` + `data/vfx.json` | what does **this ability** do? | the seam a character's identity comes through |

Aegis's light is pale and effortful, and it says so **in a JSON file** rather than in a
colour constant in the renderer. Adding character #2's VFX must be a `data/vfx.json` edit
— golden rule #2, content is data.

### The default asymmetry — get this right or the whole table lies

**Auras default to OFF. Tracers and debris default to ON.** This is not a detail; it is
the rule that makes the table honest, and we got it backwards once.

- An **aura is identity**. Its absence must be *visible*, so a character with no entry in
  the table looks unfinished rather than looking fine. If auras defaulted on, every
  unstyled character would silently inherit someone else's look and nobody would notice
  the work was never done.
- A **tracer or debris burst is legibility**. Every hit needs it whoever threw it. A hit
  with no tracer teleports; a hit with no debris does not read as having force.

The bug: impact particles initially fired only for abilities with a table entry, so only
Aegis's hits threw debris. The owner's correction was one sentence — *"debris should only
exist when something gets hit"* — and it inverted the default. `DEFAULT_PARTICLES` and
`NEUTRAL_DEBRIS` exist because of it.

### Colours are copied, not imported — deliberately

`data/vfx.json` duplicates each character's `magic` block from `data/art/<id>.json`.
That looks like a mistake and is not: `data/art/` is an art **source** (thesis, build,
garment, face) and does not ship to the browser. Importing it would drag the whole art
direction into the client bundle. `ability-vfx.test.ts` asserts the two agree, so the
copy cannot drift.

### The per-ability vocabulary, as it settled

```json
"shield_bash": {
  "tracer": "none",
  "impact":    { "kind": "ring", "beats": 0.75, "radiusTiles": 1.7, "shade": "core" },
  "particles": { "count": 14, "beats": 0.8, "speedTiles": 2.0, "size": 0.085, "shade": "core" }
}
```

- **`tracer: "streak" | "none"`** — melee and self-cast get `none`. Nothing flies for
  `shield_bash`; the door does the work, and all the effect is at the far end.
- **`cast` vs `impact`** — an ability that pushes something out of the caster and lands it
  on someone else shows **both ends**, and the near end is the effortful one
  (`barrier_pulse`: `cast` in `deep`, `impact` in `edge`).
- **`blink: true`** for teleports. The caster does not travel. A ring at the square he
  leaves *and* the square he arrives at, so the eye can follow a unit that never crossed
  the space between. Without both rings a blink reads as a rendering glitch.
- **The ultimate is bigger and slower than anything else.** `warding_halo` is 1.4 beats
  against 0.75–0.9 for everything else — the one time the effort pays off.
- **Three shades: `core` / `edge` / `deep`.** Effects differentiate against each other
  without anyone inventing a new colour, which is how palettes rot.

### Five rules the modules all obey

1. **Pure. Geometry out, nothing else.** `tracer.ts`, `wall.ts`, `particles.ts` and
   `ability-vfx.ts` emit positions in *fractional board coordinates* with a colour and an
   opacity. The renderer is a dumb applier. This is what makes every timing and placement
   decision checkable in a Node test instead of by eye.
2. **Time in beats, never seconds or frames.** Beats are the timeline's own unit, so
   everything is frame-rate free by construction.
3. **Seed from `${unitId}@${t}`.** Renderer randomness is legal under golden rule #1, but
   unseeded means a replayed turn looks different every time — and, more usefully, the
   flash, shake and debris of one impact become *siblings* rather than three independent
   accidents.
4. **Flight time is already in the data.** The gap between the `ability` cue's `t` and its
   `impact` cue's `impactT` *is* the projectile's flight duration. A bullet needs no new
   engine event and no spec change.
5. **skip == watch.** Presentation can never change an outcome. If a VFX module can move
   the board, it is in the wrong package.

### Billboarding flips at this boundary

Phase 3 geometry *forbids* camera-facing faces. VFX *wants* them. Billboard things
without form — flashes, sparks, debris. Never billboard things with form. And a flat
trail card disappears edge-on at 8° pitch, so trails need volume.

---

## 5. The measurement discipline — the single most transferable thing here

This is the part that generalises past art entirely.

### A green test proves nothing until you run it against a build with the feature removed

**Mutation-check every visual test.** The victim-flash pixel test passed twice with the
flash feature deleted. Two independent causes, both worth knowing:

- The probe sampled `#board`, which contains near-white **DOM readout numbers**, not just
  the canvas. Fix: hide non-canvas children before sampling.
- It compared the brightest frame to the *median*, which passes trivially because the
  phase ends with a camera pull-back that darkens everything. Fix: look for a **local
  spike** — a frame brighter than *both* its neighbours.

### Film on a virtual clock

Replacing `performance.now` and `requestAnimationFrame` via Playwright's `addInitScript`
makes animation deterministic and photographable. Without it you are testing frame timing,
not the effect.

### Eyeballing lost to measurement twice; assume it will again

- I claimed the renderer was clipping highlights and needed ACES tone mapping. Measured:
  **1 pixel** near saturation. Nothing was clipping.
- I read an exposure of 1.15 as "washed out". Measured: contrast had gone **up 20%**.
- The aura fade envelope was backwards — brightest when *smallest*. Nobody spotted it by
  looking. Pixel-differencing did: 1,187 → 19,292 differing pixels once fixed.

Reverting the tone-mapping change cost 3 red render tests. The rule that came out of it:
**report the measurement and give a straight keep-or-revert recommendation, rather than
defending a change because you have already written it.**

### Pure modules that nothing calls are the failure mode of this architecture

The whole design pushes logic into pure, testable modules — which means the load-bearing
risk is a module that is perfect and unwired. It has happened more than once:
`drawWalls`'s opacity default was dead code, because both call sites passed an explicit
value straight past it. **Every VFX module ships with a wiring assertion through the real
controller, and that assertion is mutation-checked too.**

---

## 6. Rendering traps found after §14 was written

Add these to your mental copy of `ART_PIPELINE.md` §14.

| Trap | Symptom | Cause |
|---|---|---|
| Frame-rate-dependent easing | animation settles at different speeds on different machines; screenshots time out | closing a fixed fraction *per frame* makes settling time a function of frame rate. Convert to per-second: `1 - (1-k)^(dt*60)` |
| `page.screenshot` compositor starvation | render suite takes 60 minutes, half of it red | a screenshot cannot return until the compositor produces a frame. An unconditionally-drawing loop at 3.3 fps costs **2.2 s** per shot against 165 ms idle. Render on demand. |
| Earcut keyhole annulus | a ring renders as a filled disc | tracing an inner circle into the same outline gets filled straight in by ear clipping. `Shape.holes` is required. |
| Indexed geometry kills bevels | chamfered edges look smoothed away | `computeVertexNormals()` on indexed geometry averages the bevel into the neighbouring faces. `toNonIndexed()` first. |
| Clamped Sobel on a tiling texture | a seam-coloured strip on every tile boundary | grain **tiles**; a height→normal conversion must wrap its edges, not clamp them |
| Jitter on flush geometry | a rotated tile reads as a misaligned decal | brush is a 0.02 lid flush with the board; rotating a flush lid exposes bare board at the corners. Jitter only what has height. |
| Hand-derived winding | a third of a generated solid's faces are inside-out, invisible in a screenshot | derive winding **programmatically** — on a convex solid centred at the origin, flip any triangle whose normal points back at the centroid |

---

## 7. Repo hygiene that will bite you

**The art lane and the map/visuals lane collide on `main`, repeatedly.** Four times now:
`boardSpan` (#119/#120), `stepCamera` (#140), `app.ts` imports (#161), and duel-arena's
2v2 rebuild (`373b0a1`), which merged cleanly and left **7 e2e tests red on `main`** —
the map went 18×15 → 17×11 with 2 spawns per team, and tests still boot it as 4v4 and
still assert a mirrored pair of Health pads that no longer exists.

The first three were textual merge conflicts. The fourth is worse: git merged it fine and
the result was broken for a lane that never touched the file. **Before you trust a green
local run, check whether `main` is green** — and expect that a change in another lane can
invalidate your pixel baselines without touching your files. A merge queue or a
require-up-to-date-branch rule would end this class of problem; that is the owner's call.

Two smaller ones:

- **Vitest does not typecheck.** `npm run build` does. A test suite can be entirely green
  over code that will not compile.
- **A silent fallback cannot tell you it fired** (§14). Fail-soft paths need a log line,
  or you get a board full of boxes and a clean console.

---

## 8. The order to actually work in

1. **Thesis** — written, and approved by the owner. Blocking; nothing downstream is real
   without it. Name the VFX primitive in the same breath.
2. **Resolve §18** (one clip set vs nine copies) and settle the kit-vs-thesis question.
3. **Parameters** — `data/art/<id>.json`. Reuse every roster-wide value from §2 above.
4. **Atlas → geometry → `validate.py`.** Validate *before* rigging; a geometry fix after
   nine rigs exist means re-exporting nine characters.
5. **Preview, lit.** `FLAT` is unlit and renders dome and disc pixel-identical, so an
   unlit preview will tell you a broken head is fine.
6. **Mixamo** — the one human step. Weapon **not** in the upload; "In Place" checked.
7. **Build the `.glb`**, wire the clip map, attach the weapon to a **bone** in bone-local
   space in tiles.
8. **VFX last** — add a block to `data/vfx.json`. If it needs a renderer change, you have
   found a genuinely new primitive; give it a generic, reusable implementation rather than
   a special case (golden rule #2).
9. **Mutation-check every visual test you added** before calling any of it done.
