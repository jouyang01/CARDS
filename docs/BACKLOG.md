# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js); every client item consumes
`TurnEvent[]` — never recomputes game rules. Metric is **Manhattan everywhere** (MET1).
**Open/update a PR to `main` every session** (CLAUDE.md).

## ✅ COMPLETE

- Engine core, teams/formats, M2 client, S1, MV1–MV4, TT1, C1, MS1, R1–R7, D1 (+dash),
  A0/A1/A2/A3, M2 range cap; **MET1** (Manhattan incl. vision), **FF1** (friendly fire —
  Blast + charges + delayed), **MET1-tp** (teleport-strike Manhattan-1), **BRUSH1** (brush a
  legal destination), **AIM2** (quantized-int free aiming + no-trig guard), **RND1**
  (orthographic 3D renderer), **A1/A2/A3 re-spec** (tweened playback, spotlight, free orbit),
  **BUNDLE1** (CI fails >300 kB gzipped). (through PR #21)

Current suite: **399 tests** (engine 316 + client 83), typecheck + build clean, purity green.

---

# UI batch (owner directive 2026-08-23) — the Decision-phase HUD + previews

**RND1 dependency split (parallelise on this):** *screen-space DOM, renderer-agnostic* →
**UI1, UI3, UI6**; *world-space, uses the renderer (already built)* → **UI2, UI5, AIM1(+UI4)**.
**Cross-cutting:** UI1's Lock-In ruling shapes UI3 (settle first); UI4 folds into AIM1; UI5 folds
into A3; UI2 needs AIM2's coverage rule (settled: centre-in binary) + RND1 (both landed).

## Next batch — engine (small, first)

### A0-heal. Widen source attribution to `heal` + `statusApplied` (ENGINE) — UNBLOCKED (blocks UI6)
**Addresses Dev Note (UI6): "This log should show damage and healing done to and from
characters."** `damage` already carries `sourceUnitId`/`abilityId` (A0); `heal` and
`statusApplied` do not, so "Aegis shielded Lumen for 30" isn't expressible. *AC: `heal` and
`statusApplied` events carry `sourceUnitId` + `abilityId` (the caster + ability); purely additive,
no outcome/state change; tests asserting those event shapes updated; determinism harness passes.*
**Spec Notes.** Files: `types.ts` (`heal`, `statusApplied` variants), `resolve.ts` (the `heal`
emit in `applySelfEffects`/Blast benefits loop, the `statusApplied` emits — thread caster+ability
through), `resolve.test.ts`. Trap/dash riders: source = the placing/casting unit + ability. Out
of scope: any value/coverage change — attribution only.

## Next batch — client, screen-space DOM (renderer-agnostic, parallel)

### UI1. Hover previews range; click on the board confirms; commit ≠ lock (CLIENT) — UNBLOCKED
**Addresses Dev Note: "All actions should show you the effective range when mousing over the
board, including dashes, prep, and aoe… click the skill to set the mode, hover over the board to
see its effective range (not just the tiles it affects), and then click the tile on the board to
confirm the action… (still need to click end turn)."** Also subsumes the earlier **AIM2-UX**
(mouse-follow aiming for cone/line). *AC: hovering an ability control paints that ability's
**effective-range envelope** on the board, non-committal, cleared on mouse-out, for **every**
phase (prep, dash, blast, AoE); a board click **commits** that character's action and it stays
visibly indicated; choosing another ability before Lock In replaces it; nothing is mutated by
hover; a cone/line ability tracks the mouse live between click-to-set-mode and click-to-confirm.*
**Spec Notes.** Files: `app.ts` (the `'idle'|'aim'|'move'` mode machine gains a **hover** stage
before commit; the click becomes commit, not lock), `targeting.ts`, `renderer3d.ts` (range
envelope + live cone/line preview via `expandShape` at the quantized step — engine unchanged).
**Lock-In ruling (settle before UI3):** **Lock In commits the currently-selected character; the
player switches freely between their 1–2 characters until all are locked; committing an action
does NOT end the turn** (replaces the per-character `lockStep` walk). Out of scope: HUD layout
(UI3), the shape/tile overlay geometry (UI2).

### UI3. HUD layout: portrait+HP+Energy · hotbar · Lock In (CLIENT) — BLOCKED BY UI1 (ruling)
**Addresses Dev Note: "skills on the bottom, lock in to the right of skills, character
information on the bottom left including HP and Energy."** *AC: a **persistent, viewport-anchored**
HUD — bottom-left active-character panel (portrait/identity, HP, Energy bars), bottom-centre
ability hotbar (one control per ability + ultimate, showing availability/cooldown), bottom-right
Lock In immediately right of the hotbar; the HUD is **updated in place, not rebuilt per render**
(so it doesn't fight UI1 hover state); the TT1 ability tooltip survives into the hotbar.*
**Spec Notes.** Files: `app.ts` (`renderControls` → a persistent keyed HUD subtree, same
principle as A1's keyed nodes — do not `replaceChildren` each frame), CSS. Reuse
`abilityOptions` (already returns available + reason — don't re-derive) and the existing bar
treatment (HP/energy already in `UnitState`). Screen-space DOM — **independent of RND1**. Out of
scope: the turn timer / score header (observed-not-requested).

### UI6. Scrollable combat log, right side (CLIENT) — BLOCKED BY A0-heal
**Addresses Dev Note: "Create a log on the right that you can scroll through. This log should show
damage and healing done to and from characters."** *AC: a persistent, independently-scrollable
right-side panel accumulating across turns with a per-turn separator; entries name **both actor
and target** where the event has both (damage, heal, shield — using A0/A0-heal source); entries
are ordered by the log and never re-sorted; deaths and respawns appear; pure consumer of
`TurnEvent[]` (no game logic).* **Spec Notes.** Files: new client log module, `app.ts`. Same
contract as `playback.ts`. Screen-space DOM — **independent of RND1**. Needs **A0-heal** for the
"from" on heals/shields.

## Next batch — client, world-space (renderer already built)

### AIM1 (+UI4). Move & dash drawn as a line + endpoint marker (CLIENT) — UNBLOCKED
**Addresses Dev Notes: "Move commands should be a thin line ending in a marker of the final
location"** and (UI4) **"Dashes should have the same movement indicator as movement, but in
yellow."** *AC: a drawn move renders as a **stroked polyline through tile centres + a distinct
endpoint marker** (renderer geometry, not filled tiles); a drawn **dash** uses identical
line+marker geometry, **yellow**; reachability tiles unchanged; sprint vs normal move visually
distinct; the dash line is suppressed only when no dash is drafted.* **Spec Notes.** Files:
`renderer3d.ts`, `app.ts` (**the `if (!isDash …)` branch at ~:121 that currently suppresses the
dash preview must now draw a yellow dash line instead of nothing**), `targeting.ts`. World-space
(renderer). Out of scope: the AoE shape overlay (UI2).

### UI2. Two-layer ability overlay — continuous shape + affected tiles (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Every action should show you the area in which it affects, not just the
squares affected… the blue cones indicate actions."** *AC: render BOTH — **Layer 1** the
continuous geometric shape (cone wedge / line beam / circle) projected on the ground plane, and
**Layer 2** the resolved affected tiles highlighted beneath it (exactly the engine's coverage:
centre-in binary, AIM2); the two are visually distinct; multiple ability previews can show at
once.* **Spec Notes.** Files: `renderer3d.ts`, `targeting.ts`. Layer 2 = `expandShape` output
(the truth); Layer 1 = the smooth shape from the same quantized-step geometry (the fiction).
**Render the same rule Layer 2 uses** so a clipped-corner never reads as a bug. World-space,
needs RND1 (landed) + AIM2's coverage ruling (settled). Out of scope: engine changes.

### UI5. Damage, shield-absorb and heal readouts during resolution (CLIENT) — UNBLOCKED (folds into A3)
**Addresses Dev Note: "Damage, shields, heals all should show up during the resolution phase."**
A3 already ships a hit flash + floating damage number; extend to all three. *AC: damage, shield
absorption, and healing each surface as **visually distinct** readouts (not three identical white
numbers) anchored to the unit; values read from the log (`damage.amount`/`damage.absorbed`,
`heal.amount`, `statusApplied` shield `amount`) and **never recomputed**; a unit that dies later
in the phase still shows its numbers before the deferred-death fall (A2 rule).* **Spec Notes.**
Files: the A3 playback/`stage` path in `renderer3d.ts`. No engine change (log carries the values).
World-space anchor only (project unit → screen).

## Data / Designer (parallel — pending the Designer)

### M1 / M1-4v4 / Thorn-dash — UNBLOCKED
M1: map redesign (spawn separation ≥13, ~4–6 multi-square formations, roster-derived turn-1
test). M1-4v4: a dedicated 4v4 map. Thorn-dash: remove one Thorn ability, add a dash, then
tighten the dash guardrail to all archetypes. Ruled previously. Files: `data/…`, `content.test.ts`.

## Optional / deferred

- **RENDER-VERIFY (optional).** A Playwright devDependency + one CI job driving a scripted turn
  and asserting a few composited pixels — the batch's screenshot method that caught a real bug,
  made standing. Env has Chromium/Playwright. Renderer inputs stay unit-covered regardless.
- **A4** per-ability FX (`"fx"` data blocks, generic consumer via the unused `objectFor()` seam
  — keep it) — blocked on **M3 + roster lock**.
- **CL1 / CL2 / E2** — deferred; not for v1 without a new decision.

## Observed-not-requested (recorded from the reference screenshot; NOT scoped)

Turn countdown timer bar (flowing into Lock In); top-centre score/objective header ("1 … 1",
"Five kills or most kills after 15 turns wins"); per-unit floating name labels; per-unit status
icons. The owner did not request these — do not build until asked.

## M3+ — placeholder

21. Worker + DO rooms; format selection; lobby with team-seat + **duplicate-pick validation (R3)**;
    per-player hidden submission → per-team orders; per-player timer + Time Bank; **decoy fog
    rendering**; reconnect/replay; deploy to Pages + wrangler.

## Playtest / balance (not Builder-blocking)

- **Wisp/Shadowstep** (4-neighbour strike after MET1-tp). **Support anti-stall (R6).**
  **`MS_PER_BEAT`** pacing (4v4). **Cone raggedness** at shallow angles. **Spotlight** hiding
  off-actor bars.
