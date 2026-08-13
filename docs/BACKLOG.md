# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists** (never single-unit); engine is
pure/deterministic and **dependency-free** (client may depend on Vite/render libs); every
client item consumes `TurnEvent[]`. **Open/update a PR to `main` every session** (CLAUDE.md).

## ✅ COMPLETE

- **M1 (1–12,+3a,+E1); M1.5 teams (13–16); M2 client (17–20)+T1; S1; MV1/MV2/MV1-fix; MV3;
  TT1; C1; MS1; MV4; R1–R7 rulings; R1c/R1b/R4/R7/D1/MS1-test.**
- **A0** damage source attribution; **M2** range≤8 guardrail; **D1-dash** dash-onto-decoy
  destroys; **A1** keyed SVG nodes *(SVG impl superseded by RND1 — principle survives)*; **A2**
  `choreograph()` pure cue timeline; **A3** play cues + camera + skip==watch. (PR #17)

Current suite: **341 tests** (engine 270 + client 71), typecheck + build clean, purity green.

**Superseded in flight (see edge-cases for the rulings):** MV3's diagonal 1/2-alternation
**cost model** and **MV4** → replaced by **MET1** (every diagonal costs 2). **A1's keyed-SVG**
implementation → replaced by **RND1** (orthographic 3D); the keyed-scene-object principle
carries forward.

---

# Client/movement re-scope batch (owner directive 2026-08-21)

**Cross-cutting (read before building):** (1) **AIM2 and MET1 are ruled together** — a rotated
cone inside a Manhattan envelope needs one range definition (done in edge-cases); do not ship
one before the other is ruled. (2) MET1 and AIM2 touch the **same files** (`shapes.ts`,
`movement.ts`) — sequence them, don't run concurrent branches. (3) **RND1 blocks the A1/A2/A3
re-spec.** (4) **AIM1 folds into AIM2.** (5) The **no-trig-in-engine** guard is a standing test
regardless of when AIM2 lands.

## Next batch — engine (in order)

### MET1. Distance metric → Manhattan, including vision (ENGINE) — UNBLOCKED (do first; supersedes MV3 cost/MV4)
**Addresses Dev Notes: "We want to mimic the manhattan-distance system of AR."** + **"Vision is
manhattan too."** Ruled in edge-cases. *AC: `board.ts` distance fn is Manhattan;
`shapes.aimInRange` for `circle`/`square` uses Manhattan; movement reachability uses Manhattan
cost where **a diagonal step is legal but costs 2**; **vision range (`VISION_RANGE`) is a
Manhattan radius and the brush/stealth perception-adjacency exception becomes Manhattan-≤1 (4
orthogonal neighbours, not the 8 surrounding)**; the 4/8 budgets are unchanged; reachable-area
tests updated (move 4 → 41 tiles, sprint 8 → 145); MV4 diagonal charge steps also cost 2; the
determinism harness still passes.*

**Spec Notes.** Files: `board.ts` (distance), `shapes.ts` (`aimInRange`, `direction8`,
`lineSquares`), `movement.ts` (`reachableSquares`/`reconstructPath` — the parity-state search
collapses to a plain Manhattan cost search; charge paths), **`vision.ts` (`canSee` range check
+ `isAdjacent` for the brush exception → Manhattan)**, `validate.ts`, **every movement + dash +
vision test**. **Mark superseded, don't delete:** the MV3 1/2-alternation cost — the corner-cut
rule (illegal if either flank is solid) and the X-crossing/2-cycle rules **survive**
(occupancy, metric-independent). Cover adjacency is already orthogonal (unchanged). Update
GAME_SPEC §3 to the Manhattan model (record in DECISIONS). Out of scope: AIM2 (next); friendly
fire (FF1, independent).

### AIM2 (+AIM1). Free-rotation aiming with partial-tile coverage (ENGINE + CLIENT) — BLOCKED BY MET1
**Addresses Dev Notes:** *"Attacking commands should not always be a full square. You should be
able to rotate your attacks 360 degrees… hit 'half' a tile"* and (AIM1, folded in) *"Move
commands should be a thin line ending in a marker of the final location."* Largest item. Scope:
`cone` and `line` only (`circle`/`path` unaffected). Ruled in edge-cases (quantized-integer
direction; centre-in binary full damage; directional range = tile-count-along-axis). *AC:*
- Aim direction reaches the engine as a **quantized integer step** (256 or 360), never a
  float/radian; `AbilityOrder` carries it; `validateAbility` rejects out-of-range step values.
- `coneSquares`/`lineSquares` compute coverage from the integer step via a **committed integer
  direction-vector table or integer half-plane/cross-product tests** — **no trig in the engine**.
- A tile is hit iff its **centre** is inside the shape; covered tiles take **full** damage.
- **Determinism/cross-engine regression:** a fixed step + shape yields the identical tile set
  (guard against transcendental drift).
- Client: **drag-to-rotate** aiming replaces click-to-aim for cone/line; the **drawn move path
  renders as a stroked polyline + endpoint marker** (AIM1), reachability tiles unchanged; sprint
  vs normal move visually distinct.

**Spec Notes.** Files: `types.ts` (aim/step on `AbilityOrder`), `shapes.ts`
(`coneSquares`/`lineSquares`/`shapeSquares`), `validate.ts`, `targeting.ts`+`app.ts` (drag UI —
the client does mouse→step trig, presentation only), shapes tests + the cross-engine regression.
**Standing guard (add now, item AIM2-guard):** a test asserting `packages/engine` contains no
`Math.cos/sin/atan2/tan`. Fold AIM1 in — do not ship it separately (same targeting surface).
Gotcha: reconcile with MET1's range definition (directional shapes = tile count along axis).

### FF1. Friendly fire — harmful effects hit all units in-area (ENGINE) — UNBLOCKED (independent, parallel)
**Addresses Dev Note: "friendly fire should be possible, allies can hit allies with damage."**
Reverses the "no friendly fire" ruling; ruled in edge-cases (FF1). Independent of MET1/AIM2
(different file). *AC: an aimed AoE covering an ally and an enemy **damages both** (and applies
harmful riders — knockback/pull/slow/root/weaken — to both); **beneficial** effects still apply
to own-team only; energy is still granted only on hitting ≥1 **enemy** (ally-only hits pay
nothing); a **friendly kill** kills+respawns the ally but moves **no team's kill tally**; a
team's **traps stay team-safe**; tests cover ally-damaged, ally-only-hit grants no energy, and
friendly-kill scores nobody.*

**Spec Notes.** Files: `resolve.ts` (the Blast polarity loop — drop the `if (!enemy) continue`
for `HARMFUL_KINDS`; keep the beneficial `if (enemy) continue`; keep `hitEnemy` gated on a real
enemy so energy stays enemy-only), the dash-strike and trap paths (harmful there already targets
enemies — extend the *directly-aimed* harmful to allies too, but **leave trap triggering
team-safe**), `killUnit` (add a no-credit path when killer-team == victim-team; do not increment
`draft.kills`), `ally-effects.test.ts`. **Two flags to confirm with the owner, don't block:**
(1) harmful **riders** ride along with friendly-fire damage (default yes); (2) traps stay
team-safe (default yes). Out of scope: making beneficial effects hit enemies (not requested).

## Data / Designer (parallel — unaffected by MET1/AIM2/FF1)

### M1. Map redesign (DESIGNER, data-only) — UNBLOCKED
**(A) Spawn separation ≥ 13** (turn-1 spawn hits impossible, turn-2 engagement reliable); target
**18×15, symmetric spawns x=2 / x=15**. Add a test asserting **max turn-1 threat < spawn
separation, DERIVED FROM THE ROSTER** (not hardcoded). **(B)** Replace the 18 isolated single
tiles with **~4–6 multi-square formations** (walls length 3–5 that cut a lane, holdable cover
clusters, flank-concealing brush); structure over density; preserve mirror symmetry; give the
flank rows a reason to exist. *AC: both constraints met; roster-derived turn-1 test present.*
**Spec Notes.** Files: `data/maps/duel-arena.json`, `content.test.ts`. M2 (range cap, shipped)
protects the geometry. Unchanged by MET1 (spawn separation is measured head-on along a row where
Manhattan = Chebyshev). MET1 makes the terrain-formation argument *stronger* (diagonals costly →
lanes matter more).

### M1-4v4. A dedicated 4v4 map (DESIGNER, data-only) — UNBLOCKED
**Addresses Dev Note: "Does 4v4 need its own map? — Yes."** A larger map sized for 4 units/side
(≥4 spawns/team, `validateMapForFormat('4v4')` passes) rather than reusing duel-arena. *AC: a new
map in `data/maps/`; passes content + format validation; mirror-symmetric; M1's spawn-separation
and formation principles applied at 4v4 scale.*
**Spec Notes.** Files: new `data/maps/*.json`, `content.test.ts`. Coordinate sizing with M1's
geometry rules. Designer owns the layout.

### Thorn-dash (DESIGNER, data-only) — UNBLOCKED
**Addresses Dev directive: "remove one of Thorn's abilities and add a dash."** Thorn (Support)
is the only dash-less kit. *AC: `thorn.json` has exactly one Dash-phase ability (drop one to keep
4 + ult); validation passes; then the dash guardrail tightens to **all** archetypes (no Support
exemption).* Ruled in edge-cases. Files: `data/characters/thorn.json`, `content.test.ts`.

## Renderer track (client) — RND1 then re-spec

### RND1. Swap to an orthographic 3D renderer (CLIENT) — UNBLOCKED (blocks A1/A2/A3 re-spec)
**Addresses Dev Note: "swap to an orthographic renderer."** Replace hand-built SVG with a real
orthographic renderer (Three.js `OrthographicCamera` or equivalent). Top-down (pitch 90°) and
isometric (35.264°) become one camera at two pitch values → projection is a runtime parameter.
*AC: the board, units, terrain and playback render through the new renderer; the client bundle
still fits the GitHub Pages budget (CI builds it); engine untouched (renderer-only); existing
engine tests + the renderer-agnostic client logic (`choreograph`, `playback`, `hotseat`,
`targeting`) pass unchanged.*
**Spec Notes.** Files: replace `render.ts`/`stage.ts` with a renderer module; `app.ts` wiring.
`squareFromPoint` becomes a **ray/plane intersection** against the ground plane (the old
`getBoundingClientRect` version is deleted, not fixed). The A3 camera targets the renderer's
camera (pan/zoom/depth-sort/face-visibility come from the renderer). **Client deps are allowed
(engine stays dependency-free).** **Update ARCHITECTURE.md's "SVG rendering" line** to the
orthographic renderer. Out of scope: per-ability FX (A4).

### A1/A2/A3 re-spec — BLOCKED BY RND1
- **A1-respec:** persistent scene objects keyed by `unitId` (the principle from the SVG A1),
  reconciled/tweened in the new renderer. Decoys become keyed scene objects too (folds in the
  "decoys have no keyed node" Open Question).
- **A2:** `choreograph()` is renderer-agnostic — **reused verbatim**. Confirm the **A2 amendment**
  (owner): *"each character's blast and prep animation plays at a different time but is calculated
  at the same time"* — already satisfied by disjoint Prep/Blast cue ranges; keep death-defers-to-
  end-of-phase and Blast-displacement-shares-one-`t`.
- **A3-respec:** re-target the WAAPI camera + cue playback to the renderer; **skip==watch** invariant
  preserved. **Owner amendments:** phase banner is a **persistent corner label** with a phase-change
  animation (not a full-width interrupt); **spotlight-dim applies to Prep/Dash/Blast only**, not
  Move; **4v4 accepts a longer cutscene** (sequential Blast up to 8 abilities; no per-ability time
  scaling). HP bars/labels **billboard** independently of world zoom (resolves the A3 bars-scaling
  Open Question).

## Deferred — do NOT schedule

- **A4. Data-driven per-ability FX.** `"fx"` blocks in `data/characters/*.json` consumed
  generically (golden rule #2 — no `switch` in the client). RND1 **settles the renderer question**
  A4 used to carry; A4's remaining blockers are **M3 + roster lock** (D1 art, cut abilities). When
  built, bundle the additive `sourceUnitId`/`abilityId` on `heal`/`statusApplied` (the A0 follow-up)
  so shield/heal flourishes can anchor.
- **CL1** (AR clash co-occupancy), **CL2** (vector-sum displacement), **E2** (cover-corner unify)
  — deferred; not for v1 without a new decision.

## M3+ — placeholder

21. Worker + DO rooms; format selection; lobby with team-seat + **duplicate-pick validation (R3)**;
    per-player hidden submission → per-team orders; per-player timer + Time Bank; **decoy fog
    rendering** (enemy sees the decoy as Wisp); reconnect/replay; deploy to Pages + wrangler.

## Playtest / balance (not Builder-blocking)

- **Support anti-stall (R6):** Lumen+Thorn vs double-Firepower at 2v2; tune via per-format turn limit.
- **`MS_PER_BEAT`** pacing constant in `stage.ts` — tune at playtest.
