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
WIRING IN TESTS** (`app-harness.ts` / the NET-E2E harness end-to-end, not the pure helper). **PR to `main`
every session.**

> ⚠️ **`main` is LIVE** — a green push publishes. Keep green.

> 🎨 **Art / animation / VFX reference (owner Dev Note 2026-08-21).** Anything touching how a unit is drawn,
> rigged, animated, or how a hit is sold — read **`docs/ART_PIPELINE.md`** (pipeline, §7 order, §8 role
> briefs, §18 the clip-duplication decision) **and PR #100/#108/#109** first. **No engine change** — an
> apparent one is an `ENGINE ASK` for the owner. Clip selection is pure and lives in the renderer.

> 🩹 **These six items are the first human playtest's findings.** One is game-breaking (DEATH-HANG-2). They
> are the priority; art expansion waits behind them.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + AIM-PREVIEW-TRUE + all Dev
  Note batches through session 12 + the TTK package.
- **PR #116 (session 13):** **INTERCEPT-GUARD** (Aegis's redirect — a new `guard` EFFECT_KIND),
  **SUDDEN-DEATH-TEST**, **NET-E2E-EXPAND** (two seats on one team, over the wire), **BOTPLAY-SWEEP**.
- **PR #112–#121 (art + render):** Aegis's rigged model + the MODEL-PRELOAD/LATE/AUDIT/CACHE load path;
  MAP-THEMES / FOG-BY-THEME / AOE-CLASH / OVERLAY-BY-THEME; BOARD-LIT / GRID-SEAMS / SCENE-DIORAMA /
  SKY-DOME; board zoom + facing. **Engine untouched.**

Current suite: **2875 tests** (1557 + 1016 + 302), typecheck clean, purity clean. Engine src unchanged for
three sessions.

### Build order and dependencies

**DEATH-HANG-2 → INTERCEPT-LANDING-CHOICE → CHASE-AUDIT → TEAMMATE-PLAN-VISIBLE → WALL-SLOW →
NAMEPLATE-DEPTH**, then **ASSET-WEIGHT-BUDGET** as capacity allows. No hard dependencies between them; the
order is severity (DEATH-HANG-2 is game-breaking and first). WALL-SLOW and NAMEPLATE-DEPTH are quick.

---

## CRITICAL — the game-breaking playtest bug

### DEATH-HANG-2. A death in sudden death freezes lock-in (CLIENT/SERVER, CRITICAL) — UNBLOCKED (first)
**Addresses Dev Note: "The Death bug and then not being able to lock-in and breaking the game is still
happening, playtest made it happen during sudden death."** DEATH-HANG (PR #94) made a downed networked seat
*hold* instead of auto-submitting; it works for the case it was tested on, but **nothing covers a death in
sudden death**, and it recurred in a real playtest there. **Reproduce FIRST — the prior fix shipped without
this coverage and that is why it returned.** *AC:*
- **A NET-E2E test that fails on `main`:** a networked match driven into **sudden death** (turn past the
  format `turnLimit`, kills tied), then a resolution that **downs a seat's last living unit**; assert the
  surviving side(s) can still lock in, the turn resolves, and the match continues/ends correctly — for
  **both** the downed seat and its opponents. Cover the asymmetric-3-player and the standard-4-player
  shapes.
- **The fix makes that scenario resolve cleanly** — no frozen lock-in, no vanished timer, no turn that
  waits forever on a seat that will never submit.

**Spec Notes.** Files: `packages/client/src/app.ts` (`openSeat`/`holdDownedSeat`/`beginTurn`, `~1076–1191`),
`packages/server/src/hub.ts` (`#answering`/`#canAct`/`#allIn`, `~572–602`), and the harness
(`packages/client/test/net-harness.ts` / `net-e2e.test.ts`). **Analyzer leads (traced, not confirmed):**
(1) `holdDownedSeat()` starts **no timer** and relies on the server's DOWN-SEAT-SKIP (`#canAct`) to resolve
on the living seats — verify that chain holds when `state.turn >= turnLimit` and `suddenDeath` is set;
(2) NET-E2E-EXPAND found `playTurn` conflating *seat* and *character* lock-in — the same seat-vs-character
confusion may bite the real client when a seat controls multiple units and one dies; (3) a turn where a
double-KO downs one unit on **each** team in sudden death is the shape most likely to wedge `#allIn`. **Do
not guess a fix — let the failing repro point.** Out of scope: the sudden-death *ruling* (correct — see
SUDDEN-DEATH); redesigning the timer. Golden-rule reminder: a downed seat still *holds* (never auto-submits).

---

## HIGH — the Intercept the owner actually wants

### INTERCEPT-LANDING-CHOICE. The player picks Aegis's landing square (CLIENT + engine/data) — UNBLOCKED
**Addresses Dev Note: "When Aegis uses intercept, the player should be able to only choose a square that is
adjacent to an ally. Right now you can only choose the ally square and can't choose which adjacent square
to go to."** Ruled in edge-cases (INTERCEPT-LANDING-CHOICE), superseding the auto-landing half of
INTERCEPT-GUARD. *AC:*
- **Aim = an empty square orthogonally adjacent to a living ally within range 5.** The client's aimable set
  is exactly those squares (highlighted); clicking one commits it. The order carries the **chosen square**
  and the **ally id** (the ally adjacent to that square; if two allies are adjacent, the bound ally is the
  one the aim names — keep the `allyTargetId` contract).
- **Aegis lands on the chosen square; the guard binds the named ally; his 18 shield lands** — the redirect
  semantics of INTERCEPT-GUARD are otherwise unchanged.
- **Fizzle (ruled whole-ability):** if at resolution the chosen square is occupied/blocked or the named
  ally is dead, Intercept does nothing — no teleport, no guard, **no shield** — cooldown spent.
- **1v1 fallback unchanged:** no living ally → any square within 5, teleport + shield, no guard; with a
  living ally, a square not adjacent to one is an **invalid** aim.

**Spec Notes.** Files: `data/characters/aegis.json` (targeting stays `square` + `allyTarget`; range 5),
`packages/engine/src/resolve.ts` (replace the auto nearest-open landing with **validate the chosen square**:
empty, orthogonally adjacent to the named ally, ally within 5; the fixed-order tiebreak is gone),
`packages/client/src/targeting.ts` + `app.ts` (the aimable set = empty squares adjacent to an ally-in-5;
the guard-link preview follows the chosen square). **Drive the real controller** — select Intercept, the
board offers adjacent-to-ally squares, click one, lock in, resolve, assert Aegis landed there and the ally
is guarded. **Gotcha:** the shield gate keys on Aegis standing in the ability's area (INTERCEPT-GUARD's
"plan-time area moves with the landing" note) — the area is now the **chosen square**, so keep that gate
honest. Out of scope: the redirect rulings (unchanged); multi-ally guard (refused — see edge-cases).

---

## MED — correctness the playtest exposed

### CHASE-AUDIT. Chase follows to where the target went, not its stale tile (ENGINE) — UNBLOCKED
**Addresses Dev Note: "Chase needs to follow better, sometimes the character chases directly to the tile
the last character was on even if we know where the chase target went. Audit Chasing."** *AC:* a
reproduction test for the reported miss — a chaser whose team can see the target's **new** position walks
toward that position, not the tile the target left — and the fix that makes it pass, with the existing
chase/fog tests still green. **Spec Notes.** The **team-vision** half is already correct
(`teamHasSightline`, `vision.ts`, checks every team unit). Two confirmed suspects: **(a)** the chase
**snapshot** is the post-*normal*-move board (`resolve.ts:2404`), so a target that is itself
chasing/dashing is pursued to its pre-chase tile — decide whether a chaser should track a chasing target to
its final square (ordering/convergence call); **(b)** the fog fallback reads `lastKnown`, written only at
**end of turn** (`resolve.ts:3059`), so a target the team **loses sight of at end of Move** is chased to its
**previous-turn** square. Reproduce the owner's case first and fix whichever it is. **Do not** rewrite chase
pathing wholesale — golden rule #5 (a chase never uses a position the team cannot see) and the CHASE-LOS
convergence design both stand. Out of scope: chase preview at plan time (the route is picked at resolution
by design).

### TEAMMATE-PLAN-VISIBLE. You see a teammate's locked-in plan (CLIENT) — UNBLOCKED
**Addresses Dev Note: "You need to see your teammates actions when they lock in."** Golden rule #5:
teammates see each other's plans, and the server already **relays a team's submissions** to teammates
(`hub.ts:474`) — the gap is the client not **rendering** a relayed teammate order. *AC:* when a teammate
locks in, your board shows their committed plan — the ability area/preview, the move path, and (for Aegis)
the guard link — over the teammate's unit(s); it clears/updates as the turn resolves. **A test through the
real wiring:** two seats on one team, one locks in, assert the other client's board draws the committed
plan (not just a lock count). **Spec Notes.** Files: `packages/client/src/app.ts` (render relayed teammate
orders as committed-plan overlays — the hot-seat path already draws a locked character's plan, `~1269–1290`
region; extend it to a networked teammate whose order arrives over the wire), `packages/client/src/net.ts`
if the relay payload needs the order content surfaced. Reuse `abilityPreview`/the existing plan layers — do
not invent a second preview. Out of scope: showing **enemy** plans (hidden until resolution — golden rule
#5); changing what the server relays if it already carries the orders (confirm first).

---

## LOW — quick wins

### WALL-SLOW. Warding Wall slows instead of weakens (DATA) — UNBLOCKED
**Addresses Dev Note: "AEgis Warding wall should do slow instead of weaken."** *AC:* in
`data/characters/aegis.json`, `warding_wall`'s second effect changes `weaken` → **`slow`** (keep
`duration: 2`); the description's "Weakened next turn" becomes "Slowed"; both suites stay green. **Spec
Notes.** One field + the description string. Slow and weaken are both status kinds the engine already
applies, so no engine change. TTK-INVARIANT is unaffected (a trap is not a measured skill). Out of scope:
the wall's damage, reach, or trigger list (all correct).

### NAMEPLATE-DEPTH. The nameplate draws on top of the character model (CLIENT RENDER) — UNBLOCKED
**Addresses Dev Note: "Nameplate still is hidden by Aegis' character model."** *AC:* a unit's nameplate
renders **above/in front of** its character, for rigged models and boxes alike — no clipping behind a tall
mesh. **Spec Notes.** Files: `packages/client/src/renderer3d.ts` (the nameplate draw — depth-test off, a
high `renderOrder`, or an overlay pass that composites after the scene). `nameplates.ts` is the *model*
(what the plate says) and does not change. Verify against Aegis (the one rigged model today) and a boxed
unit. Out of scope: what the nameplate contains (UI-NAMEPLATES, correct); fog/decoy visibility rules
(correct).

---

## Scheduled next — asset weight is now live

### ASSET-WEIGHT-BUDGET. `.glb` + texture weight gets its own CI number (TOOLING) — UNBLOCKED (after the six)
**Addresses Builder session-13 (art) OQ #2.** `scripts/bundle-budget.mjs` counts `.js` in `dist/assets/`
and **nothing in `public/`**, where the models live — and `public/models/` is now a real, growing
directory. *AC:* the budget script (or a sibling) tracks the **total `public/models/` byte weight** (`.glb`
+ textures) as its own number with a cap, failing CI on a jump; `GLTFLoader`'s ~77 kB stays code-split and
out of the main JS number. **Spec Notes.** Keep the JS budget and the asset budget as **two** numbers (the
art brief's rule). Set the asset cap with headroom for the roster (§18's clip-duplication decision affects
the total — see the flag). Out of scope: raising/ratcheting the 300 kB JS budget (a separate deliberate
call — flagged).

## Routed to Designer / Owner / flags

- **CLIP-DEDUP decision (owner/Designer, from art OQ #1) — decide before rigging the other eight.**
  `build_glb.py` writes every clip into every character's `.glb`, ~1 MB of duplicate keyframes per 4v4 cold
  load; `ART_PIPELINE.md` §18 has three options (shared clip `.glb`, per-character unique-only, status quo).
  Retrofitting after eight are rigged means re-exporting all of them — **so this wants deciding now.**
- **300 kB JS budget headroom is stale** (210 kB today, 1.43× not 2×). A deliberate call: ratchet to the
  real number, raise it, or hold and code-split `renderer3d.ts` when it trips. Not urgent; decide it.
- **NET-E2E-EXPAND-2 (flagged)** — the still-uncovered networked scenarios (per-player timer over the wire,
  disconnect during *playback*, reconnecting-seat handoff). DEATH-HANG-2 takes the death-in-sudden-death
  slice; the rest follow.
- **RAVOK-RECOIL is punishing (playtest, from BOTPLAY-SWEEP Ravok 0%)** — a greedy bot is the worst pilot
  for a recoil kit, so this is **not** a balance finding from the sweep; watch it with **human** players
  before touching numbers. Cinder 100% is the mirror artifact (burn ticks regardless of skill).
- **DO-E2E; Warding Wall power; Skim 30 / Chain Hook 23; FRAG-SELF zoning; WALL-BLINK-ONTO; INTERCEPT
  shield 18→14 lever; Aegis beam distinctness; self-lethal recoil warning; burn/regen pip glyphs; Warding
  Halo dead `weaken`; trap count cap; inspect chips hoverable; chase-preview detour; Solar Flare DoT
  ceiling; Thorn mine carpet** — unchanged flags.

## Flagged future (not scheduled)

- **The rest of the art pipeline** — the other eight characters (gated on the CLIP-DEDUP decision); hitstop/
  flash/shake VFX. **M3-REMATCH, IDLE-KICK, LOBBY-TEAM-CHOICE**; **all-seats-downed resolves on the timer**
  (needs the resolve-loop guard); **same-turn-buff preview**; **route-around-bodies dash impact preview**.

## Observed-not-requested / playtest (not Builder-blocking)

- The first playtest produced the six items above. The standing watch-list (TTK burst goal, 20-turn pacing,
  Skim/Chain Hook/Lumen numbers, the wall's power, cooldown-band feel, and — new — RAVOK-RECOIL and the
  clock-vs-kills question from BOTPLAY OQ #2) continues into the next playtest, once DEATH-HANG-2 makes a
  full match survivable.
