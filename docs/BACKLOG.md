# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js); every client item consumes
`TurnEvent[]`. Metric is **Manhattan everywhere** (MET1). **Open/update a PR to `main` every
session** (CLAUDE.md).

## ✅ COMPLETE

- **M1–M2 core; M1.5 teams; M2 client + T1; S1; MV1–MV4; TT1; C1; MS1; R1–R7; D1 decoy;
  A0/A1/A2/A3; M2 range cap; D1-dash.**
- **MET1** Manhattan distance everywhere (incl. vision + brush adjacency); **FF1** friendly
  fire for direct-Blast harmful effects (+ no-credit friendly kill); **AIM2** free-rotation
  aiming via quantized integer direction (+ no-trig-in-engine guard); **RND1** orthographic
  3D renderer (SVG deleted; `choreograph`/`playback`/`hotseat`/`targeting` reused verbatim;
  engine still dependency-free). (PR #19)

Current suite: **366 tests** (engine 301 + client 65), typecheck + build clean, purity green.

---

## Next batch — engine follow-ups (small, parallel-safe, do first)

### FF1-charge. Friendly fire extends to charges (ENGINE) — UNBLOCKED
Ruled in edge-cases (FF1). *AC: a damaging charge strikes the **first UNIT crossed — ally or
enemy** (not first enemy); `chargeHits: "all"` hits **every unit** crossed; energy is still
granted only when ≥1 **enemy** is among them; a charge that hits only allies pays no energy and
can friendly-kill (no tally credit); tests cover ally-rammed and ally-only-charge.*
**Spec Notes.** Files: `resolve.walkCharge` (~:588 — drop the `u.owner !== unit.owner` enemy
filter → first *unit*), `runDash` (the `chargeHits` collection), `dash.test.ts`. Supersedes the
"first enemy crossed" wording of R1a/R1b for the FF era. Keep charge pass-through (MV1) and cost
(MET1) unchanged.

### FF1-delayed. Friendly fire extends to delayed detonations (ENGINE) — UNBLOCKED
*AC: a delayed blast (grenade) applies its harmful effects to **all** units in its locked area,
ally or enemy; beneficial stay own-team; energy still enemy-only; test covers an ally standing
in a detonation area.*
**Spec Notes.** Files: `resolve.detonateDelayedBlasts` (~:768 — drop the
`enemy.owner === caster.owner` skip for harmful effects, matching the direct-Blast loop),
`resolve.test.ts`. Mirror the FF1 direct-Blast polarity exactly.

### MET1-tp. Teleport-strike adjacency → Manhattan-≤1 (ENGINE) — UNBLOCKED
Ruled in edge-cases. *AC: Shadowstep hits every unit (FF1) at **Manhattan distance 1** (4
orthogonal neighbours) of the landing, not Chebyshev-8; `dash.test.ts` updated.*
**Spec Notes.** Files: `resolve.runDash` (the teleport-strike adjacency check → `manhattan(...)
=== 1` or the 4-neighbour set). **Flag to Designer:** Wisp rebalance — Shadowstep catches 4
squares now, not 8; tune its damage/energy if the fantasy needs it (playtest).

### BRUSH1. Dash (and move) into brush works end-to-end (ENGINE test + CLIENT) — UNBLOCKED
**Addresses Dev Note: "You should be able to dash into bushes."** The engine already permits it
(`blocksMovement`/`teleport` exclude brush); the client targeting likely doesn't offer brush
squares as dash destinations. *AC: an engine test asserts a dash/teleport/move ending in brush
succeeds and the unit gains brush concealment; the client offers brush squares as valid dash
and move destinations.*
**Spec Notes.** Files: `dash.test.ts`/`movement.test.ts` (the engine regression),
`targeting.ts`/`renderer3d.ts` (ensure the dash/move target set includes brush tiles). If the
engine test passes unchanged, the fix is entirely client-side — confirm which and fix there.

## Next batch — client readability + aiming (RND1 unblocked these)

### A1/A2/A3 re-spec — tweened playback + camera on the 3D renderer — UNBLOCKED
Playback currently steps phase-by-phase with a plain pause (correct but untweened). *AC:
`choreograph` cues drive tweened playback in the renderer; **skip == watch** final `ViewState`
holds; per-phase **persistent corner label** (owner) animates phase changes; **spotlight-dim on
Prep/Dash/Blast only** (owner), not Move; HP bars/labels **billboard** (don't scale with zoom);
death visuals defer to end-of-phase; Blast `displaced` cues share one end-of-phase `t`.*
**Spec Notes.** Files: `renderer3d.ts`, `app.ts`, `stage`-equivalent. `choreograph` needs **no
change** (renderer-agnostic). **Camera = free-orbit (owner directive):** a free-orbit camera
control plus the auto-camera (shooter ∪ ability area in frame); ship an **auto / free-orbit
toggle**. The camera rides the renderer's own camera (pan/zoom/depth from the renderer), animated
so it participates in skip/`playbackRate`. `MS_PER_BEAT` stays the single pacing constant. 4v4
accepts a longer cutscene (no per-ability time scaling). Out of scope: per-ability FX (A4).

### AIM1. Draw the move order as a line, not filled tiles (CLIENT) — UNBLOCKED
**Addresses Dev Note: "AIM1 movement line — spec it out"** / *"Move commands should be a thin
line ending in a marker of the final location."* *AC: a drawn move renders as a single stroked
**polyline through tile centres + a distinct endpoint marker** in the 3D renderer; reachability
tiles (stops/through) stay as tiles; sprint vs normal move visually distinct.*
**Spec Notes.** Files: `renderer3d.ts`, `targeting.ts`/`app.ts`. A line drawn in the renderer
(the SVG polyline plan from the old AIM1 is superseded by RND1 — draw it as renderer geometry).
Only the **drawn path** becomes a line; the reachability overlay is unchanged.

### AIM2-UX. Mouse-follow live aiming for cone/line (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Free rotating aiming should follow your mouse after you click the attack
so you can see the range instead of clicking into each square."** After selecting a cone/line
ability, the aim **tracks the mouse live** (hover/drag-to-rotate), previewing covered tiles in
real time; a click locks it in. *AC: selecting a cone/line ability enters a mouse-follow aim mode
that updates the covered-tile preview each mouse-move via `expandShape` at the quantized step
(client trig → integer step, engine unchanged); a click commits the `AbilityOrder` step;
`circle`/`square` keep click-to-aim.*
**Spec Notes.** Files: `targeting.ts`, `app.ts`, `renderer3d.ts`. The client already computes
mouse→quantized-step (AIM2); this is the interaction change (continuous preview vs click). Reuse
`expandShape`; no engine change. Cone raggedness at shallow angles is a known playtest question,
not a blocker.

## Data / Designer (parallel — pending the Designer)

### M1. Map redesign (DESIGNER, data-only) — UNBLOCKED
Spawn separation ≥ 13 (18×15, spawns x=2/x=15) + roster-derived turn-1-threat test; replace the
18 isolated tiles with ~4–6 multi-square formations; mirror-symmetric. Ruled in prior backlog;
unchanged by MET1 (spawn separation measured head-on where Manhattan = Chebyshev; MET1 makes
lanes matter *more*). Files: `data/maps/duel-arena.json`, `content.test.ts`.

### M1-4v4. A dedicated 4v4 map (DESIGNER, data-only) — UNBLOCKED
**Addresses Dev Note: "Does 4v4 need its own map? — Yes."** ≥4 spawns/team,
`validateMapForFormat('4v4')` passes, mirror-symmetric, M1's principles at 4v4 scale. Files:
new `data/maps/*.json`, `content.test.ts`.

### Thorn-dash (DESIGNER, data-only) — UNBLOCKED
Remove one Thorn ability, add a Dash-phase ability; then tighten the dash guardrail to all
archetypes. Ruled in edge-cases. Files: `data/characters/thorn.json`, `content.test.ts`.

## Optional / deferred

- **BUNDLE1 (optional).** Bundle is 145 kB gzipped (Three.js). Fine for Pages; add a **soft CI
  guard at ~300 kB gzipped** so a regression is caught; code-split the renderer only if exceeded.
- **RND1 render verification (deferred, tooling-blocked).** `readPixels`/`drawImage` give
  all-black false negatives headless; add a composited-screenshot smoke test when the harness
  supports it. Renderer *inputs* (cues, view-model) are already covered.
- **A4** per-ability FX (`"fx"` data blocks, generic consumer) — RND1 settled the renderer; still
  blocked on **M3 + roster lock**. Bundle the `heal`/`statusApplied` source fields (A0 follow-up)
  here.
- **CL1** (AR clash co-occupancy), **CL2** (vector-sum displacement), **E2** (cover-corner unify)
  — deferred; not for v1 without a new decision.

## M3+ — placeholder

21. Worker + DO rooms; format selection; lobby with team-seat + **duplicate-pick validation (R3)**;
    per-player hidden submission → per-team orders; per-player timer + Time Bank; **decoy fog
    rendering**; reconnect/replay; deploy to Pages + wrangler.

## Playtest / balance (not Builder-blocking)

- **Wisp / Shadowstep** after MET1-tp (4-neighbour strike). **Support anti-stall (R6).**
  **`MS_PER_BEAT`** pacing. **Cone raggedness** at shallow rotation angles.
