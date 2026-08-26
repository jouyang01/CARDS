# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit** — bug fixes ship the regression test in the same commit.
**A genuinely new mechanic gets a generic, reusable implementation** (golden rule #2). **DRIVE THE REAL UI
WIRING IN TESTS.** **PR to `main` every session.**

> ⚠️ **`main` is LIVE** — keep `npm test` green (**3338** unit tests as of 2026-10-07). The Playwright
> e2e/render suite is **37/37 green** (VFX-FLASH-VERIFY + RENDER-SUITE-GREEN-4 closed the last of it).
> Pre-merge signal, not a release gate (Pages gates on CI, which is green).

> 🎨 **Colour is viewer-relative friend/foe (edge-cases FOF-COLORS, RULED).** Self blue / ally green / foe
> red on units; friendly blue on committed overlays; hot-seat's whole team is self (green is networked-only).
> Art/VFX/camera are **pure view** — no engine change; an apparent one is an `ENGINE ASK`.

## ✅ COMPLETE

- Everything through the map/COVER-EDGE cycle + the TTK package + INTERCEPT-GUARD + DEATH-HANG-3 + the FoF
  cycle (PRs #167–#174).
- **AOE-LoS (PR #181, session-19 Builder).** Walls shelter from explosions, the blast reads LoS + cover from
  its **centre**, aiming needs team vision of the centre, `lobbed` picks the aim rule, delayed detonations
  stamp the amount at cast and resolve shelter/cover at detonation. Built exactly to the #179 spec; the
  centre-LoS filter lives in `circleSquares` so every circle inherits it. Verified 2026-10-07 — matches
  spec, purity/determinism intact, phase order + dash immunity untouched, ships with `aoe-los.test.ts` +
  four mutation-checked re-specced fixtures. Scope clarified by three rulings (AOE-LoS-SCOPE,
  AOE-LoS-SELF-BURST, AIM-VISION-SHAPE).
- **VFX-FLASH-VERIFY (PR #177).** The victim flash lands; the e2e now measures a **local** spike so it stays
  measurable.
- **RENDER-SUITE-GREEN-4.** Both halves found already implemented and green; the pad test is **accepted on
  Iron Basin** and the "re-spec to `everyTurns`" ruling is **retired** (it is green and observes real pad
  behaviour). Render suite is 37/37.
- **W4 — dagger_flurry +8-vs-no-cover ENGINE ASK: already removed.** `wisp.json` `dagger_flurry` is a single
  clean `damage: 22` + `melee: true`, no bonus text anywhere. No Builder work — verified 2026-10-07.

Current suite: **3338 unit tests** green (engine 1063 + client 1973 + server 302), typecheck clean, purity
clean. Playwright render suite **37/37**.

### Build order and dependencies

**WISP-INVISIBLE-FIX (CRITICAL) → HITS-RENAME → BOLA-HITS → W1-DECOY-TARGET → BOLA-OVERLAY.**
WISP-INVISIBLE-FIX and HITS-RENAME are independent (different files) — take the CRITICAL visible bug first if
you prefer. BOLA-HITS depends on HITS-RENAME; BOLA-OVERLAY depends on BOLA-HITS' impact-point semantics.
W1-DECOY-TARGET is unblocked (its DECOY-PLACEMENT ruling is made). **W3 records an invariant, no build.**
W5 / LOBBED-SWEEP / AIM-VISION-SHAPE / WISP-GLB-REBAKE / P1 are Designer/Owner/ART — flagged, not Builder
work.

---

## CRITICAL — Wisp is invisible; a clip must never move a unit off its square

### WISP-INVISIBLE-FIX. Lock the model root to its tile (CLIENT) — UNBLOCKED (CRITICAL, first)
**Addresses Dev Note: _"BUG IMPORTANT: Wisp shipped in PR 180, she is completely invisible on the screen.
Fix this."_** Ruled **MODEL-ROOT-LOCK** in edge-cases — read it; this is the build contract.

**Root cause (diagnosed from the shipped `wisp.glb`, 2026-10-07).** Wisp loads as a model (she has
`wisp_idle`, so she is **not** the box fallback) and `modelBounds` measures her **correctly** (geometry
Y-extent 1.897, feet at `minY ≈ 0`) — she is not mis-scaled and her material is clean. She is **animated
off the board**: she is the first Rodin-import-path model, and **every one of her ten clips carries a large
`Hips` translation** in a space unrelated to the bind skeleton (bind `Hips` `Z ≈ −1.09`; `wisp_idle` track
`Z ≈ +22`; others to `Z ≈ +101`). `instance()` plays `idle` immediately on load (`character-model.ts:410`),
so the mixer overwrites the Hips translation with the ~22-unit value and — through the `Armature` +90° X
convention — flings the mesh ~22 units off-screen. `build_glb.py --in-place` does not save it: it pins
per-clip *drift* to frame-0 (itself 22u off) and assumes local-Y is world-up (false — veil/bola carry large
Y offsets).

*AC:*
- **A unit's model root stays centred on its board tile for every clip.** After `mixer.update`, the renderer
  neutralises the root bone's (`mixorig:Hips`) **horizontal** translation to its **bind-pose** value each
  frame, keeping the **vertical** component (a death fall / crouch is preserved). Do it in **world space** so
  it is robust to the model's authoring axis (do not assume which local index is "up" — that assumption is
  what shipped the bug).
- **Wisp renders on the board, idling in place,** in the local hot-seat and in a networked game (she is a
  cloned instance per unit — the lock is per instance).
- **No regression to Aegis** (the procedural-path model whose clips sit near bind) — its idle/run/death read
  unchanged.
- **Ships with a Vitest test** (golden rule #3): construct a `ModelInstance` (or the extracted pure helper)
  over a clip whose `Hips` track is displaced by a large horizontal offset, advance the mixer, and assert
  the root's **world XZ** is at the tile origin (within an epsilon) while a vertical fall is preserved. The
  test must **fail on the current code** (mutation check: with the lock removed, the root lands ~22u away).

**Spec Notes.** Files: `packages/client/src/renderer3d.ts` (the per-frame lock in the unit `update`/animation
loop, around where `instance.update(delta)` is called at `:2403`, and `modelBounds`/placement at
`:1854–1887`) and/or `packages/client/src/character-model.ts` (`ModelInstance.update`, `:390`, is where the
mixer advances and posture is re-applied after it — the same "after the mixer" seam is the natural home).
Prefer factoring the correction into a **pure, exported helper** (like `paintFlash`/`modelBounds` already
are) so it is unit-testable without a WebGL context — the renderer's own guidance is that anything left
inside the closure can only be checked by photographing a browser. **The load-bearing subtlety:** "vertical"
is the world up-axis (Y), not a fixed local bone index — read the bind translation once at instance build,
and each frame replace the animated Hips **world** X/Z with the bind world X/Z while keeping animated Y.
Keep it deterministic and allocation-light (runs every frame for every unit). **Out of scope:** rebuilding
the `.glb` or touching `tools/art` (that is WISP-GLB-REBAKE, an ART item); any engine change (unit position
is already engine-owned — this is pure view); dash/blink *travel* (the group lerp already provides it — the
clip is in-place by design, confirmed by the art note "the vanish/reappear itself is VFX"). **Why the client
lock and not just a rebuild:** it fixes Wisp with a test the Builder can land without Blender, and makes
every future imported model immune however its clips were baked — the whole roster comes down this path.

---

## HIGH — one charge/line-breadth field, not two

### HITS-RENAME. Rename `chargeHits` → `hits`, widen to `line` (ENGINE + data + client) — UNBLOCKED (first of the W-batch)
**Addresses Dev Note (W2): _"Bola should slow and only hit the first enemy in the line."_** Ruled **HITS**
in edge-cases. **CORRECTION to the owner's W2 premise:** the note says "R1b is UNBUILT" — it is **built and
shipped** (`chargeHits` is in `validate.ts:245`, `resolve.ts`, `types.ts`, five engine tests, two client
files, and **two** data files). So this is a **rename-in-place of a live field**, done as one atomic commit,
not a pre-ship edit.

*AC:*
- **Rename** `chargeHits` → `hits` everywhere: `types.ts`, `validate.ts` (field + the error message),
  `resolve.ts`, the engine tests that name it (`content`, `dash`, `dash-status`, `bastion-ram-line`,
  `validate-keys`), the client (`targeting.ts`, `preview-numbers.ts`), and the data files
  (`kestrel.json`, `bastion.json`). **`chargeHits` must not survive anywhere** (grep clean).
- **Widen the shape rule:** `hits` is valid on **`line` and `path`**; still rejected on
  cone/circle/square/self.
- **`line` semantics:** `hits: "first"` applies the ability's effects to the **first enemy encountered
  walking the line outward** — `lineSquares` already returns depth-ordered squares, so it is deterministic
  with no new machinery; `hits: "all"` (or absent, keeping the existing default) hits every enemy on the
  line. **Allies never block or absorb** (no-friendly-fire + "units never block"; state it — no new ruling).
- **Ships with a test:** a `line` ability with `hits: "first"` against two enemies in a row hits only the
  nearer; `hits: "all"` hits both; the field is rejected on a circle. Mutation-check that "first" actually
  stops (delete the stop and the far enemy takes damage).

**Spec Notes.** The default value: R1b's ruling made `chargeHits` default `"first"`; keep `hits` defaulting
to `"first"` so Kestrel/Bastion (`"all"`, explicit) are unchanged and any un-annotated `line`/`path` keeps
first-only behaviour. Verify `preview-numbers.ts`/`targeting.ts` preview the same first-enemy stop the
resolver applies (preview parity). **Out of scope:** changing Kestrel/Bastion behaviour (pure rename for
them); the bola data (BOLA-HITS); the overlay length (BOLA-OVERLAY). This unblocks BOLA-HITS.

### BOLA-HITS. Bola hits the first enemy in the line (DATA-ONLY) — BLOCKED on HITS-RENAME
**Addresses Dev Note (W2): _"BOLA becomes DATA-ONLY once this lands: add `"hits": "first"` to wisp.json
bola. Damage 12 and slow 1 are unchanged."_** *AC:* `wisp.json` `bola` gains `"hits": "first"`; it is a
`line` (already), so the effects apply to the first enemy walked to. **Spec Notes / FLAG:** the owner's note
says "Damage 12 … unchanged," but `wisp.json` bola currently has **`amount: 24`** (slow duration 1 matches).
**Keep 24 — do not silently change balance** — and surface the 12-vs-24 discrepancy to the owner for
confirmation (the AC is "damage unchanged," and the "12" is the owner's recollection, not an instruction to
re-tune). No test beyond the content fairness guard; the mechanic is tested by HITS-RENAME.

---

## HIGH — the decoy is placed, not worn

### W1-DECOY-TARGET. Per-effect `target`; decoy placeable at range 3 (ENGINE additive + data) — UNBLOCKED
**Addresses Dev Note (W1): _"She can place her decoy at a range of 3 — keep the decoy static."_** Ruled
**DECOY-PLACEMENT** in edge-cases (the occupied-square question the owner flagged is now answered: **may not
be placed on a square occupied by any unit at Prep; the aim is refused, not routed**).

*AC (engine, additive and generic — golden rule #2, not a decoy special case):*
- **`AbilityEffect` gains optional `target: "self" | "aimed"`, defaulting to `"self"`.** Defaulting means
  **no existing character data changes.** Any future ability that buffs the caster while placing something
  at an aimed square gets this for free.
- **`validate.ts`:** `target: "aimed"` requires a non-`self` shape.
- **`data/characters/wisp.json` `veil_decoy`** becomes shape **`square`**, range **3**; the stealth effect
  gets `target: "self"`, the decoy effect gets `target: "aimed"`. It **stays `free: true`** (the free-action
  compose is unchanged — Wisp can still vanish and Sprint).
- **DECOY-PLACEMENT:** an `aimed` decoy at a square occupied by any unit is refused at Prep (not routed to
  nearest). Aiming into fog stays legal (free-aim ruling).
- **R2 otherwise stands UNCHANGED** — the decoy remains static, dies to any damage, blocks nothing, grants
  no energy. **Only its spawn location changes.** Do not reopen R2's other clauses.
- **Ships with tests:** stealth lands on the caster while the decoy spawns at the aimed square; an aim onto
  an occupied square is refused; `target: "aimed"` on a `self`-shape ability is a validation error; the
  default (`"self"`) leaves every other character's effects untouched (a broad no-change assertion).

**Spec Notes.** Files: `packages/engine/src/types.ts` (`AbilityEffect.target?`), `validate.ts` (the shape
rule), `resolve.ts` (effect application reads `target` — `self` → caster, `aimed` → the ability's aimed
square; the decoy spawn already exists as a `GameState.decoys` entry, so this reroutes its position),
`data/characters/wisp.json`. **Determinism/purity:** additive field, integer square, N-safe — no floats.
**Out of scope:** the decoy's enemy-side ring (**P1**, deferred to RND1 — see flags); any change to R2's
lifetime/static/no-block clauses; the decoy's animation set (**W3**, invariant below).

---

## MED — the drawn line must not over-promise

### BOLA-OVERLAY. The line overlay terminates at the impact point (CLIENT, amends UI2) — BLOCKED on BOLA-HITS
**Addresses Dev Note (W2 UI consequence): _"the drawn line overlay must TERMINATE AT THE IMPACT POINT, not
extend to the full range 6 — otherwise the overlay promises reach the ability no longer has."_** *AC:* for a
`hits: "first"` line, the previewed/committed line overlay is drawn only to the **first enemy** the line
reaches (the impact tile), not to full `range`. If no enemy is in the line, it draws to full range (nothing
to stop it). **Spec Notes.** Files: the line-overlay path in the client targeting/overlay renderer. This is
the same first-enemy stop the engine computes — **read it from the engine's resolved coverage, do not
recompute** (preview parity). Depends on BOLA-HITS' data + HITS-RENAME's line semantics. If the world-space
line overlay (UI2) is not yet built for lines, scope this to the overlay that exists and note the gap.

---

## Record now, build later

### W3-DECOY-PARITY. Idle/ambient parity is a standing invariant (NO BUILD NOW)
**Addresses Dev Note (W3): _"Wisp will have all the animations, decoy should get the full animation set."_**
The scope is narrower than it sounds: the decoy is static, so it never plays run or attack — **only IDLE and
AMBIENT must be pixel-identical** to a real Wisp holding position (a motionless decoy is correct, not a
tell). **Invariant to enforce when animation work starts:** any ambient or idle effect added to Wisp must be
wired to the decoy **in the same commit**, or the tell silently reappears the first time someone adds (e.g.)
a smoke shader. Recorded here, not scheduled — there is no idle/ambient VFX on Wisp yet. **Playtest flag
(not a build):** the real tell is **duration**, not animation — R2 gives the decoy the cast turn plus the
next, and two turns of a Wisp doing nothing is readable at high skill; R2 already names the fix (drop
lifetime to the cast turn only). No action now.

## Routed to Designer / Owner / ART / flags

- **WISP-GLB-REBAKE (ART, pairs with WISP-INVISIBLE-FIX).** Rebuild `packages/client/public/models/wisp.glb`
  so the asset is honest, and fix `tools/art/build_glb.py --in-place`: it must **re-base** the `Hips`
  translation to the bind pose (subtract the baseline), not pin per-clip drift to a frame-0 that is itself
  ~22 units off, and it must **not assume local-Y is world-up** (veil/bola carry large Y offsets). Verify by
  re-reading the rebuilt `.glb`'s `Hips` tracks sit near the bind translation. The client MODEL-ROOT-LOCK is
  the guarantee; this keeps the source clean. Not Builder (Vitest) work — it needs the art toolchain.
- **W5 — Firepower "Phantom" exception (Designer, `docs/design/roster-v1.md` §2).** _"roster-v1.md §2 states
  Firepower gets 'exactly ONE signature survival tool — a dash, stealth, or a shield.' Wisp has THREE: Blink
  (dash), Veil (stealth), and Shadowstep Strike (dash + untargetable), on the joint-lowest HP pool … the
  most evasive character in the roster."_ Write an explicit **Phantom exception** into §2 (recommended —
  evasion IS the theme) or convert one tool. Right now the contract is silently violated, so a future
  balance pass could "fix" her by mistake. Designer doc change, **not Builder work.**
- **LOBBED-SWEEP (Designer, per-ability).** After AOE-LoS, the `range > 0` circles default to **direct**
  (require caster→centre LoS): `cinder.ember_bolt`/`flare_burst`/`solar_flare`/`stoke_the_flame`,
  `thorn.barbed_sling`/`verdant_veil`/`overgrowth`, `lumen.mending_light`/`sanctuary`, `aegis.barrier_pulse`.
  Each needs a deliberate `lobbed: true`-or-`direct` call (most supports rarely notice; Cinder's Flare Burst
  is the enemy-facing one the owner named). Default `direct` stands until ruled. The `range: 0` self-circles
  need no call (AOE-LoS-SELF-BURST). `data/characters/*.json`.
- **AIM-VISION-SHAPE / ember_bolt (Owner balance).** The aimable set is a Manhattan-vision diamond clipped
  from a Euclidean-range disc (ruled intended, flagged). Concrete casualty: `cinder.ember_bolt` at `range:
  7` exceeds `VISION_RANGE` (6), gating off ~43% of its aimable area and a full tile of axial reach. Lever:
  `range: 6`, or change the AIM-VISION-SHAPE rule (state vision-capped aiming, or make vision Euclidean).
  Owner/Designer call — not touched (no rebalancing).
- **P1 — decoy enemy-side ring (defer into RND1).** _"the decoy renders to the enemy team as Wisp, so it
  must carry the ENEMY-SIDE ring from their point of view. If the ring is derived from the decoy's true
  owner, the ring becomes the tell that defeats the entire ability."_ The FoF ring must be resolved from the
  **viewer's** seat for a decoy exactly as for a real unit (FOF-COLORS already resolves viewer-relative — the
  decoy must go through the same resolver, appearing as an enemy to the enemy). **Defer into RND1** unless
  RND1 is far out; the ground ring lives on the same plane as UI2's AoE shapes, so build it there. Flag it
  now so the decoy is never accidentally given an owner-derived ring.
- **RENDER-LUMA-GUARD (flag, from session-18 OQ #3).** The victim-flash regression was caught only by a test
  failing for an unrelated reason after scene luminance moved ~16×. A luminance guard on the render passes
  that move grading would let the next re-grade report itself rather than surfacing as a broken VFX
  assertion. Not scheduled — recorded as a gap.
- **FOF-OVERLAY-HUE (Designer, still open).** Friendly committed-overlay blue shares the `REACH` hue,
  separated only by weight. If an ally's committed plan under a live aim reads ambiguous on a real board, the
  Designer picks a distinct friendly hue. Playtest question first.
- **Long-standing flags (unchanged):** the map lane owns e2e render tests it moves; camera-follow-on-select;
  zoom beyond wheel; intent badge name vs digit; ASSET-BUDGET caps + CLIP-DEDUP (§18); JS budget headroom;
  CHASE-SECOND-CLOCK; NET-E2E-EXPAND-2; DO-E2E; RAVOK-RECOIL; Warding Wall power; Skim/Chain Hook; FRAG-SELF
  zoning; WALL-BLINK-ONTO; INTERCEPT shield lever; Aegis beam distinctness; self-lethal recoil warning;
  burn/regen pip glyphs; Warding Halo dead `weaken`; trap count cap; inspect chips hoverable; Solar Flare DoT
  ceiling; Thorn mine carpet.

## 🎮 PLAYTEST — the standing validation loop (owner + humans)

**First look owed: Wisp on the board once WISP-INVISIBLE-FIX lands** — does she read, does the decoy at
range 3 deceive, does idle/ambient stay a non-tell. Then: **AOE-LoS in a real game** — do walls shelter as
expected, does the diamond-clipped-from-disc aimable shape (AIM-VISION-SHAPE) read as a rule or a bug, is
ember_bolt's gated reach a problem. Still owed: **FoF in a real mirror** (does ring+nameplate suffice
without FOF-OUTLINE; friendly-blue vs range-blue legibility — FOF-OVERLAY-HUE); **DEATH-HANG-3** networked;
**Proving Grounds + COVER-EDGE** (do half-walls read); character-centred camera + VFX impact; the balance
watch-list. Output: felt problems → Dev Notes.

## Flagged future (not scheduled)

- **The rest of the VFX pipeline** (projectiles/casts/status VFX; more ambient motion — remember W3's
  decoy-parity invariant when any Wisp ambient lands). **The other eight characters' art** (CHARACTER_PLAYBOOK
  records what building Aegis taught; the Rodin import path now has WISP-GLB-REBAKE's lessons too; gated on
  CLIP-DEDUP). **M3-REMATCH, IDLE-KICK, LOBBY-TEAM-CHOICE**; **same-turn-buff preview**;
  **route-around-bodies dash impact preview**.
