# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js); every client item consumes
`TurnEvent[]` and the engine's derived queries (vision, reachability) — never recomputes them.
**Movement is Manhattan (MET1); aiming is Euclidean (AIM-METRIC).** **Open/update a PR to `main`
every session** (CLAUDE.md).

## ✅ COMPLETE

- Engine core, teams/formats, movement (Manhattan + diagonals cost 2), FF1, AIM2, RND1,
  A0(+heal), A1/A2/A3, UI1–UI6, D1(+dash), MET1(+tp), BRUSH1, TT1, C1, MS1, R1–R7.
- **UI1-fix**, **M1-tests**, **RENDER-VERIFY**, **UI-responsive**, **UI6-cap** (PRs #26/#27).
- **MOVE1** (nearest-legal-tile routing), **HITBOX1** (AR central-circular-hitbox coverage),
  **VISION1** (fog during Decision), **MAPTOGGLE** (dev map/format selector — 4v4 on **both**
  maps), **CI-decouple** (deploy off the render gate). (PRs #30/#31)

Current suite: **524 tests** (engine 339 + client 185), typecheck + build clean, purity green.

> **This batch = the Designer's measured AoE-footprints ruling (2026-08-14).** It **supersedes**
> last session's HITBOX-tune (data pass) and CONE-B (angular) items: circles are fixed at the
> *rule* (not data), aiming goes Euclidean, and dashes gain impact areas. **Track A** is the new
> geometry work — do it first (owner combat-feel priority + foundation + un-nerfs Ravok).
> **VISION1-opening** and **Track B (free actions & catalysts)** carry forward unbuilt.

---

## Track A — AoE geometry (do first; strictly ordered — AIM-METRIC is the foundation)

Ruled in edge-cases ("Targeting & vision") from `docs/design/aoe-footprints-v1.md`. All four are
the same **integer squared-distance** style in HITBOX1's ×2 lattice — **no trig, no `Math.sqrt`,
no floats** (the AIM2 no-trig guard must keep passing). Ship a **rotation-invariance test suite**
(§ below). Sequence: **AIM-METRIC → CONE-B → CIRCLE-FIX → DASH-IMPACT.**

### AIM-METRIC. Aiming is Euclidean; movement stays Manhattan (ENGINE) — UNBLOCKED (first, foundation)
The MET1-vs-HITBOX1 conflict is resolved to **Euclidean for aiming**; movement stays Manhattan.
*AC: `line`/`cone` range (axial depth) and `circle`/`square` **aim range** are measured as
**Euclidean tile-widths** (`dx²+dy² ≤ r²` in the ×2 lattice), not lattice-step/Manhattan counts;
`path` dash length, movement, sprint and reachability are **unchanged (MET1 stands)**; a
range-r line reaches r tile-widths in every direction (no diagonal over-reach); `circle`/`square`
aimable region becomes a disc (range 8: 145→197 tiles); vision is **unchanged** (Manhattan
diamond — out of scope); no new trig/sqrt/floats; the no-trig guard passes.*
**Spec Notes.** Files: `packages/engine/src/shapes.ts` (axial-range test for `line`/`cone`),
`resolve.aimIsLegal` (the `circle`/`square` aim-range check — Manhattan → Euclidean squared).
This is the **foundation CONE-B and CIRCLE-FIX consume** — build it first or their rotation
tests can't pass. Ruled in edge-cases (AIM-METRIC; supersedes MET1's circle/square clause and the
line/cone tile-count clause). **Out of scope:** vision metric (perception, separate owner call —
do NOT touch `vision.ts`); movement/sprint/`path` length (MET1 unchanged). Watch: keep the
squared comparison integer — a range r means `dx²+dy² ≤ r²`, a tile exactly r away is included.

### CONE-B. `halfWidth(d)=d` + Euclidean axial range, near-rotation-invariant cones (ENGINE) — BLOCKED on AIM-METRIC
A freely-rotated `cone` covers more off-axis than axis-aligned — and the inflation is in the
**length** (r4: 24 tiles axis vs 42 diagonal), so the width ramp alone is not enough. *AC: a cone
tile at axial depth d is in-cone **iff** its centre is within (Euclidean) axial range **and** its
perpendicular distance to the axis satisfies **`perp² ≤ d²`** (`halfWidth(d)=d`); axis-aligned
counts stay the owner-approved **3 / 8 / 15 / 24**; **every quantized rotation lands within ±1**
of them; **and** the furthest covered tile is within **±0.5 tile-widths** of the axis-aligned
reach in every direction (the *reach* check — the one the tile count alone misses); no cone data
changes; existing shape tests updated.*
**Spec Notes.** Files: `packages/engine/src/shapes.ts` (`coneSquares`/`expandShape`),
`shapes.test.ts` + the rotation-invariance test. Two halves together: the **Euclidean axial
depth** (from AIM-METRIC) kills the √2 length inflation, and **`perp² ≤ d²`** (integer half-plane
/ cross-product) sets the width. No ramp table, no division. HITBOX1's tile-centre circle then
decides which tiles the wedge region hits; `expandShape` composes the two (one authority — UI2
tracks it). `line` = degenerate zero-width wedge. Ruled in edge-cases (CONE-B). **Out of scope:**
cone `range`/data (approved as-is).

### CIRCLE-FIX. An authored `radius` is the final footprint radius (ENGINE) — BLOCKED on AIM-METRIC
HITBOX1 adds its half-tile *on top of* the authored radius, so 13 circles silently grew 48–80%.
*AC: `circleSquares` becomes **`dx² + dy² ≤ r²`** (was `4·(dx²+dy²) ≤ (2r+1)²`), so an authored
`radius: r` reaches exactly r tiles; footprints become **r1=5, r2=13 exactly** (12 of 13 circles
on their pre-HITBOX1 size), r3=29 (accepted); the scan bound drops from `radius+1` to `radius`;
HITBOX1's rule and its halfway guarantee are untouched; no data changes; shape tests updated to
the new counts.*
**Spec Notes.** Files: `packages/engine/src/shapes.ts` (`circleSquares`), `shapes.test.ts`.
**One-line rule change + test updates** — simpler than what it replaces, still pure integer. This
depends on AIM-METRIC only in that both make circles Euclidean; build after it so the metric is
settled. Ruled in edge-cases (CIRCLE-FIX). **Out of scope:** any `radius` data edit (the whole
point is that data does not change).

### DASH-IMPACT. Optional `impact:{origin?,destination?}` on dash abilities (ENGINE) — BLOCKED on CIRCLE-FIX
Dashes gain an AoE at takeoff and/or landing; the hardcoded MET1-tp teleport-strike adjacency
becomes data and is deleted. *AC: (1) `impact?: { origin?: number; destination?: number }` on
`AbilityDef`, members optional integers ≥ 1, **Euclidean radii** reusing `circleSquares`;
(2) `destination` = AoE on the resting square (post pass-through/stop for `path`, landing for
`square`), `origin` = AoE on the takeoff square; (3) composes with both dash models, **effects
apply to the union, each unit at most once**; FF1 polarity + once-per-use/≥1-enemy energy
unchanged; (4) **absent `impact` = today's behaviour exactly**; (5) validation: `impact` legal
only on `phase:"dash"`, radii integers ≥ 1, reject otherwise; (6) the hardcoded Manhattan-1
teleport-strike branch is **deleted** — Shadowstep's `impact:{destination:1}` replaces it; the
three staged data edits (Shadowstep, Intercept, Bullrush) now resolve. Tests: a `path` charge
with `{destination:2}` hits the first body AND the landing AoE, each unit once; a `square` leap
with `{destination:2}` detonates on landing; Aegis Intercept shields allies at the destination;
absent `impact` is unchanged; an `impact` on a non-dash ability is rejected.*
**Spec Notes.** Files: `packages/engine/src/types.ts` (`AbilityDef.impact`), the dash resolver
(`walkCharge` / teleport landing → apply `circleSquares` union), `validateAbility` (new `impact`
validation), delete the MET1-tp adjacency branch. **Validation is genuinely new coverage:**
`validateAbility` currently lets unknown fields pass silently (the suite accepted the inert
`impact` blocks) — add the `impact` check, and consider a "reject unknown `AbilityDef` keys" pass
so future data typos fail loudly (issue 1, review 2026-08-27). Reuses `circleSquares` — **no new
geometry code**. Ruled in edge-cases (DASH-IMPACT; closes MET1-tp). **Out of scope:** new dash
data beyond the three staged; `chargeHits` (already shipped).

### Rotation-invariance test suite (ships with Track A)
One test module over **all four shape families** asserting, for a fixed range swept through
several quantized aim directions: (a) `line`/`cone` tile count within ±1 of axis-aligned; (b) the
**furthest covered tile** within ±0.5 tile-widths of axis-aligned reach (catches the cone
length bug the count hid); (c) `circle` counts match CIRCLE-FIX's 5/13/29; (d) determinism —
identical tile sets across runs. This is the acceptance harness the whole track is verified by.

## Track A′ — fog polish (client, independent of Track A)

### VISION1-opening. Fog the opening frame too — no turn-1 grace reveal (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Enemy team should be removed from opening frame."** VISION1 fogs the
Decision phase, but the **initial** render still shows the full board, flashing the enemy team on
open. *AC: the very first frame applies the seat-on-the-clock team's vision — enemy units the
team cannot see are **not drawn at match start**, exactly as in any later Decision phase; **no
turn-1 grace reveal** (no full-board flash then fog); own units always shown; a client test
asserts the opening frame hides an out-of-sight enemy.*
**Spec Notes.** Files: `packages/client/src/fog.ts` / `app.ts` (apply
`visibleEnemiesForTeam`/`visibleSquaresForTeam` to the initial frame, same path as Decision).
Client computes nothing (pure consumer). Keep/extend the RENDER-VERIFY assertion. Ruled in
edge-cases (VISION1-opening). Out of scope: spawn markers, last-known-ghosts, any vision-*rule*
change.

## Track B — free actions & catalysts (carryover; strictly ordered — Part 1 gates Part 2)

Folded into edge-cases from `docs/design/free-actions-and-catalysts.md`. **FREE1 → CAT1 → CAT2.**
Four rulings that fail *silently* if wrong: budget independence (a free action never reduces Move
/ blocks Sprint); catalysts resolve at the START of their phase; Shift does NOT consume Move;
`free:true` requires `energyGain:0` as a validation error.

### FREE1. Free actions — `free?` on AbilityDef, `freeAbility?` on UnitOrders, budget independence (ENGINE) — UNBLOCKED (gates CAT1)
**Addresses Dev Note: "also include the catalysts from the design engine"** (Part 1 — plumbing).
A `free: true` ability may be declared **in addition to** a normal ability and **never** reduces
the move budget or blocks Sprint. *AC: (1) `free?: boolean` on `AbilityDef` (absent/false =
today); (2) `freeAbility?: AbilityOrder` on `UnitOrders` — validated to a `free:true`, off-
cooldown, owned ability, with **at most one** of `freeAbility`/`catalyst` per unit per turn;
(3) **`movementBudget` computed from `ability`/`sprint` only** — a `freeAbility` never reduces it
and never invalidates Sprint; (4) `free:true` requires `phase==='prep'` **and** `energyGain===0`,
else a validation error. Tests: free ability + Sprint 8 legal; a free ability does not drop the
4-budget; a non-prep or energy-granting `free` ability is rejected.*
**Spec Notes.** Files: `packages/engine/src/types.ts` (`AbilityDef.free`,
`UnitOrders.freeAbility`), `movementBudget` (**the single likeliest bug** — current rule is "any
ability ⇒ 4"), the order-validation path, resolution. The three character edits are **already in
`data/characters/{vex,thorn,wisp}.json`** (Overwatch Trap cd 3→4, Snare Bloom 2→3, Veil & Decoy
4→5, all `energyGain`→0). Ruled in edge-cases (Free actions). Out of scope: catalysts (CAT1); any
free Dash/Blast ability (validation forbids non-prep `free`).

### CAT1. Catalysts engine — 3 slots, once-per-match, start-of-phase resolution (ENGINE) — BLOCKED on FREE1
**Addresses Dev Note: "also include the catalysts from the design engine"** (Part 2). *AC:
(1) catalyst defs load from `data/catalysts.json` (`{prep,dash,blast}`, each an `AbilityDef` with
`cooldown:0, energyGain:0, free:true, oncePerMatch:true`); (2) `UnitState` gains
`catalysts: string[]` (length 3) and `catalystsUsed: string[]` — **arrays, not Sets**;
(3) `UnitOrders.catalyst?: AbilityOrder`, validated to one of the unit's three, not already
spent, ≤1 of `catalyst`/`freeAbility` per unit per turn; (4) in each phase **catalysts resolve
first, then abilities**; marked spent **when it resolves**, not when ordered; (5) a `catalystUsed`
event (unit, catalystId); (6) `createMatch` assigns the **default triad Second Wind / Shift /
Adrenaline** until M3. Tests: **Adrenaline boosts the SAME turn's Blast** (start-of-phase order);
**Shift does NOT consume Move** (dash 3 + walk 4 same turn); a spent catalyst is rejected; a unit
killed in Prep does **not** spend its Blast catalyst.*
**Spec Notes.** Files: `packages/engine/src/types.ts`, the resolver (start-of-phase catalyst step
in each of Prep/Dash/Blast, before that phase's abilities), `createMatch`. All nine catalysts use
**existing effect kinds — no new `EFFECT_KIND`**. Keep state plain-JSON (arrays, not Sets) so
`structuredClone` + the determinism hash stay correct. Ruled in edge-cases (Catalysts). Out of
scope: catalyst **selection** (M3), a flat `energy` effect kind, the client UI (CAT2).

### CAT2. Catalyst UI — three slots, spent-state, free-action selection (CLIENT) — BLOCKED on CAT1
**Addresses Dev Note: "also include the catalysts from the design engine"** (client surface).
*AC: the HUD shows three catalyst slots (Prep/Dash/Blast), greys out spent ones from
`catalystUsed`, and lets the player order a catalyst; selecting a **free** ability or a catalyst
does **not** clear the normal-ability selection (the MS1 mutual-exclusivity trap); a client test
drives selecting a catalyst without clearing the ability draft.*
**Spec Notes.** Files: `packages/client/src/hud.ts`, `app.ts`, `order-mode.ts` (a
`freeAbility`/`catalyst` is a **separate draft slot** from `ability`, not a replacement). Consume
the engine's validation/events; the client derives no catalyst rules. **Out of scope (→ M3): the
Shift teleport-preview** — the world-space "where Shift will land you" targeting overlay for the
free-dash catalyst is deferred to M3 (Builder note 2026-08-27); v1 CAT2 orders the catalyst
without the destination preview. Also out of scope: per-character catalyst picking (M3 lobby).

## Deferred — do NOT schedule

- **A4** per-ability FX (`"fx"` data blocks; generic consumer via the kept `objectFor()` seam) —
  blocked on **M3 + roster lock**.
- **CL1** (AR clash co-occupancy), **CL2** (vector-sum displacement), **E2** (cover-corner unify)
  — deferred; not for v1 without a new decision.
- **Flat `energy` effect kind** (Brainwave direct energy) — optional, only if playtest asks.
- **Vision metric change** (Manhattan diamond → Euclidean disc) — a perception/concealment balance
  question, explicitly out of AIM-METRIC; a separate owner call, not scheduled.

## M3+ — the next milestone

21. Worker + DO rooms; **map + format selection lobby** (supersedes MAPTOGGLE) with **per-
    character catalyst selection** (each player picks one Prep/Dash/Blast catalyst — folds in the
    catalyst-selection ENGINE ASK); **the CAT2 Shift teleport-preview** (world-space landing
    overlay for the free dash — parked from CAT2); team-seat + **duplicate-pick validation (R3)**;
    per-player hidden submission → per-team orders; **per-team hidden information for fog (VISION1)
    and the combat log (UI6)** — the real security boundary the hot-seat only approximates;
    per-player timer + Time Bank; decoy fog; reconnect/replay; deploy to Pages + wrangler.

## Observed-not-requested (from the UI reference screenshot; NOT scoped)

Turn countdown timer; score/objective header; per-unit name labels; per-unit status icons.

## Playtest / balance (not Builder-blocking)

- **Ravok is temporarily undertuned** — Bullrush knockback is nerfed 2→1 now while its
  `impact:{destination:2}` is inert until DASH-IMPACT; don't read "Ravok feels weak" as a real
  balance problem before then (review 2026-08-27, issue 2).
- **8-tile melee cones** (four `range:2` kits doubled under HITBOX1; owner approved the size — if
  oppressive, prefer a **damage** cut to `range 2→1`, an 8→3 cliff — aoe-footprints §7).
- **More generous aim ranges** (§2.1: range 6 85→113) — watch grenade/heal/trap placement.
- **Ravok's three overlapping AoEs** (Bullrush + Shockwave + Seismic Rupture) — if too much, cut
  Shockwave's radius, not Bullrush's. **Seismic Rupture at 29 tiles** (~11% of a 270-tile map).
- **±1 rotation invariance at every quantized step** vs only the 8 compass directions — thin cones
  (2 tiles at r1) may lose a tile near the apex and read as a miss.
- **Free-action / catalyst questions:** one free action per turn too tight? Wisp's free Veil
  oppressive or finally playable? Is Shift the default Yellow (if so drop it to 2)? Catalyst
  hoarding (if last-turn usage is high, add slots, don't buff)? Adrenaline vs Overdrive.
- **Turn-1 spawn margin is one tile** — hold `MAX_ABILITY_RANGE = 8` and the spawn columns.
- **`MS_PER_BEAT`** pacing (esp. 4v4). **Kestrel** untested through MAPTOGGLE (8-of-9 dev draft).
  **Support anti-stall (R6)**. **UI6** per-tone filter if noisy.
