# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js); every client item consumes
`TurnEvent[]` and the engine's derived queries (vision, reachability) — never recomputes them.
Metric is **Manhattan everywhere**. **Open/update a PR to `main` every session** (CLAUDE.md).

## ✅ COMPLETE

- Engine core, teams/formats, movement (Manhattan + diagonals cost 2), FF1, AIM2, RND1,
  A0(+heal), A1/A2/A3, UI1–UI6, D1(+dash), MET1(+tp), BRUSH1, TT1, C1, MS1, R1–R7.
- **UI1-fix**, **M1-tests**, **RENDER-VERIFY**, **UI-responsive**, **UI6-cap** (PRs #26/#27).
- **MOVE1** (move click routes to nearest legal tile), **HITBOX1** (AR central-circular-hitbox
  coverage, integer/no-trig, cross-engine regression), **VISION1** (fog during Decision from
  engine vision), **MAPTOGGLE** (`?map=&format=&players=` dev selector — 4v4 reachable on
  **both** maps), **CI-decouple** (Pages deploy off the render gate; RENDER-VERIFY its own
  workflow). (PRs #30/#31)

Current suite: **524 tests** (engine 339 + client 185), typecheck + build clean, purity green.
The local 2v2 hot-seat is playtest-ready. This batch is **combat retune** (HITBOX-tune, CONE-B),
**fog polish** (VISION1-opening), and the **free-actions + catalysts** systems (FREE1→CAT1→CAT2).

---

## Track A — combat retune & fog (do first; gates playtest of the new coverage)

### HITBOX-tune. Lower ability ranges so HITBOX1 footprints ≈ the old sizes (DATA) — UNBLOCKED (first)
**Addresses Dev Note: "hitbox1 from builder, Tune the range a little lower."** HITBOX1's AR
hitbox rule is net more generous than centre-in, so every `cone`/`circle` grew without a number
changing (the four `range:2` cones 4→8 tiles; radius-1 circles 5→9; r2 13→21; r3 25→37; lines
unchanged). Damage was tuned against the **old, smaller** footprints. *AC: `range`/`radius`
values in `data/characters/*.json` are lowered so each shape's post-HITBOX1 footprint is close
to its pre-HITBOX1 centre-in footprint; "a little lower" — conservative, not a rewrite; the
`content.test.ts` turn-1 spawn-safety guard still passes (a range cut only loosens it).*
**Spec Notes.** **Designer/data only — no engine change** (Builder: this is a Designer pass;
route balance numbers to the Designer, do not set them yourself). Files: `data/characters/*.json`.
This is the reach the CONE-B `halfWidth` ramp must also match. Ruled in edge-cases (HITBOX-tune).
Out of scope: any change to the HITBOX1 rule itself (the rule stands; only the numbers move).

### CONE-B. Meter the cone wedge half-width in Euclidean tiles (ENGINE) — UNBLOCKED (near-rotation-invariant)
**Addresses Dev Note: "go with option b and restore the near-rotation-invariant area."** A
freely-rotated `cone` currently covers more tiles at 45° than axis-aligned, because range is
metered as a tile-count along a diagonal axis (√2 longer, area ∝ square). *AC: a `cone` tile at
axial depth d is in-cone **iff** its centre is within axial range **and** its perpendicular
(integer cross-product) distance to the axis ≤ `halfWidth(d)`, a fixed tiles-per-depth ramp
measured as a **Euclidean distance, not a swept angle**; the covered tile count is within **±1
of the axis-aligned count under every quantized rotation** (was several tiles more off-axis); a
rotation-invariance test sweeps a fixed-range cone through several directions and asserts it;
`line`/`circle`/`square` coverage is unchanged; existing shape tests updated.*
**Spec Notes.** Files: `packages/engine/src/shapes.ts` (`coneSquares`/`expandShape`),
`shapes.test.ts` + the new rotation-invariance test. **Determinism (hard):** integer only —
same ×2 scaled lattice as HITBOX1, **squared** distances vs a squared/integer `halfWidth(d)`
ramp, integer half-plane / cross-product perpendicular distance; **no trig, no `Math.sqrt`** (the
AIM2 no-trig guard must still pass). The wedge defines the continuous cone *region*; HITBOX1's
tile-centre circle then decides which tiles it hits — `expandShape` composes the two, so UI2's
overlay tracks it for free. `line` = degenerate zero-width wedge (unchanged). The Designer sets
the `halfWidth` ramp so the axis-aligned footprint matches the HITBOX-tune reach. Supersedes the
**cone** half of the MET1×AIM2 tile-count range ruling. Ruled in edge-cases (CONE-B).

### VISION1-opening. Fog the opening frame too — no turn-1 grace reveal (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Enemy team should be removed from opening frame."** VISION1 fogs the
Decision phase, but the **initial** render (before any turn is planned) still shows the full
board, flashing the enemy team on open. *AC: the very first frame applies the seat-on-the-clock
team's vision — enemy units the team cannot see are **not drawn at match start**, exactly as in
any later Decision phase; there is **no turn-1 grace reveal** (no full-board flash then fog); own
units always shown; a client test asserts the opening frame hides an out-of-sight enemy.*
**Spec Notes.** Files: `packages/client/src/fog.ts` / `app.ts` (apply
`visibleEnemiesForTeam`/`visibleSquaresForTeam` to the initial frame, same path as Decision).
Client computes nothing (golden rule: pure consumer). RENDER-VERIFY already asserts the fogged
board — extend/keep that coverage. Ruled in edge-cases (VISION1-opening). Out of scope: spawn
markers, last-known-ghosts (still out of scope), any vision-*rule* change.

## Track B — free actions & catalysts (new systems; strictly ordered — Part 1 gates Part 2)

Folded into edge-cases from `docs/design/free-actions-and-catalysts.md`. **FREE1 → CAT1 → CAT2.**
The four rulings that fail *silently* if wrong: budget independence (a free action never reduces
Move / blocks Sprint); catalysts resolve at the START of their phase; Shift does NOT consume
Move; `free:true` requires `energyGain:0` as a validation error.

### FREE1. Free actions — `free?` on AbilityDef, `freeAbility?` on UnitOrders, budget independence (ENGINE) — UNBLOCKED (gates CAT1)
**Addresses Dev Note: "also include the catalysts from the design engine"** (Part 1 —
prerequisite plumbing). A `free: true` ability may be declared **in addition to** a normal
ability and **never** reduces the move budget or blocks Sprint. *AC: (1) `free?: boolean` on
`AbilityDef` (absent/false = today's behaviour); (2) `freeAbility?: AbilityOrder` on `UnitOrders`
— validated to reference an ability that is `free: true`, off cooldown, owned by the unit, with
**at most one** of `freeAbility`/`catalyst` per unit per turn; (3) **`movementBudget` computed
from `ability`/`sprint` only** — a `freeAbility` never reduces it and never invalidates Sprint;
(4) `free: true` requires `phase === 'prep'` **and** `energyGain === 0`, else a validation error.
Tests: free ability + Sprint 8 in one turn is legal; a free ability does not drop the 4-budget; a
non-prep or energy-granting `free` ability is rejected.*
**Spec Notes.** Files: `packages/engine/src/types.ts` (`AbilityDef.free`, `UnitOrders.freeAbility`),
`movementBudget` (**the single likeliest bug** — the current rule is "any ability ⇒ 4"), the
order-validation path, resolution (a free ability resolves in its own phase like any ability).
The three character edits are **already in `data/characters/{vex,thorn,wisp}.json`** (Vex
Overwatch Trap cd 3→4, Thorn Snare Bloom 2→3, Wisp Veil & Decoy 4→5, all `energyGain`→0) — FREE1
is what makes them read as free actions instead of nerfed Prep abilities. Ruled in edge-cases
(Free actions). Out of scope: catalysts (CAT1), any free Dash/Blast ability (validation forbids
non-prep `free`).

### CAT1. Catalysts engine — 3 slots, once-per-match, start-of-phase resolution (ENGINE) — BLOCKED on FREE1
**Addresses Dev Note: "also include the catalysts from the design engine"** (Part 2). Every
character carries three catalysts (one Prep/Green, one Dash/Yellow, one Blast/Red), each a free
action, each consumed once per match. *AC: (1) catalyst defs load from `data/catalysts.json`
(`{prep,dash,blast}`, each an `AbilityDef` with `cooldown:0, energyGain:0, free:true,
oncePerMatch:true` — reuse `validateAbility`); (2) `UnitState` gains `catalysts: string[]`
(length 3) and `catalystsUsed: string[]` — **arrays, not Sets**; (3) `UnitOrders.catalyst?:
AbilityOrder`, validated to one of the unit's three, not already spent, ≤1 of
`catalyst`/`freeAbility` per unit per turn; (4) in each phase, **catalysts resolve first, then
abilities**; a catalyst is marked spent **when it resolves**, not when ordered; (5) a
`catalystUsed` event (unit, catalystId); (6) `createMatch` assigns the **default triad Second
Wind / Shift / Adrenaline** until M3. Tests: **Adrenaline boosts the SAME turn's Blast** (proves
start-of-phase order); **Shift does NOT consume Move** (dash 3 in Dash + walk 4 in Move); a spent
catalyst is rejected; a unit killed in Prep does **not** spend its Blast catalyst.*
**Spec Notes.** Files: `packages/engine/src/types.ts` (`UnitState.catalysts`/`catalystsUsed`,
`UnitOrders.catalyst`, `catalystUsed` event), the resolver (start-of-phase catalyst step in each
of Prep/Dash/Blast, before that phase's abilities), `createMatch` (default triad). All nine
catalysts use **existing effect kinds — no new `EFFECT_KIND`**. Keep state plain-JSON (arrays,
not Sets) so `structuredClone` + the determinism hash stay correct. Ruled in edge-cases
(Catalysts). Out of scope: catalyst **selection** (M3 lobby, item 21), a flat `energy` effect
kind (Brainwave stays Energized 3), the client UI (CAT2).

### CAT2. Catalyst UI — three slots, spent-state, free-action selection (CLIENT) — BLOCKED on CAT1
**Addresses Dev Note: "also include the catalysts from the design engine"** (client surface).
*AC: the HUD shows three catalyst slots (Prep/Dash/Blast), greys out spent ones from the
`catalystUsed` event, and lets the player order a catalyst; selecting a **free** ability or a
catalyst does **not** clear the normal-ability selection (the same move-and-shoot mutual-
exclusivity trap MS1 fixed); a client test drives selecting a catalyst without clearing the
ability draft.*
**Spec Notes.** Files: `packages/client/src/hud.ts`, `app.ts`, `order-mode.ts` (the draft
model — a `freeAbility`/`catalyst` is a **separate slot** from `ability`, not a replacement).
Consume the engine's validation/events; the client derives no catalyst rules. Out of scope:
per-character catalyst picking (M3 lobby).

## Deferred — do NOT schedule

- **A4** per-ability FX (`"fx"` data blocks; generic consumer via the kept `objectFor()` seam) —
  blocked on **M3 + roster lock**.
- **CL1** (AR clash co-occupancy), **CL2** (vector-sum displacement), **E2** (cover-corner unify)
  — deferred; not for v1 without a new decision.
- **Flat `energy` effect kind** (would let Brainwave grant energy directly) — optional, only if
  playtest asks (§2.5 of the catalyst spec). Not scheduled.

## M3+ — the next milestone

21. Worker + DO rooms; **map + format selection lobby** (supersedes MAPTOGGLE) with **per-
    character catalyst selection** (each player picks one Prep/Dash/Blast catalyst — folds in the
    catalyst-selection ENGINE ASK); team-seat + **duplicate-pick validation (R3)**; per-player
    hidden submission → per-team orders; **per-team hidden information for fog (VISION1) and the
    combat log (UI6)** — the real security boundary the hot-seat only approximates; per-player
    timer + Time Bank; decoy fog; reconnect/replay; deploy to Pages + wrangler.

## Observed-not-requested (from the UI reference screenshot; NOT scoped)

Turn countdown timer; score/objective header; per-unit name labels; per-unit status icons.

## Playtest / balance (not Builder-blocking)

- **HITBOX-tune calibration** — after the retune, re-check that circles/cones feel like AR (the
  reach the damage was tuned for). **CONE-B** raggedness at shallow angles (the honest picture).
- **Free-action / catalyst questions (from the spec §4):** is one free action per turn too tight?
  Does Wisp's free Veil make her oppressive or finally playable? Is Shift the default Yellow for
  everyone (if so, drop it to 2)? Do catalysts get hoarded (if last-turn usage is high, add slots,
  don't buff)? Adrenaline vs Overdrive.
- **Turn-1 spawn margin is one tile** — hold `MAX_ABILITY_RANGE = 8` and the spawn columns (a
  HITBOX-tune range cut only loosens this).
- **`MS_PER_BEAT`** pacing (esp. 4v4). **Kestrel** untested through MAPTOGGLE (8-of-9 dev draft;
  M3 lobby decides who plays). **Support anti-stall (R6)**. **UI6** per-tone filter if noisy.
