# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js); every client item consumes
`TurnEvent[]`. Metric is **Manhattan everywhere**. **Open/update a PR to `main` every
session** (CLAUDE.md).

## ✅ COMPLETE

- Engine core, teams/formats, M2 client, MV1–MV4, MET1(+tp), FF1(+charge/delayed), BRUSH1,
  AIM2, RND1, A0(+heal), A1/A2/A3(+re-spec), TT1, C1, MS1, R1–R7, D1(+dash), BUNDLE1.
- **UI1** (hover range + click-commit), **UI2** (two-layer shape+tiles overlay), **UI3**
  (persistent HUD), **AIM1+UI4** (move/dash route line, dash yellow), **UI5** (damage/absorb/
  heal/shield readouts), **UI6** (scrollable combat log). (PR #24)
- **M1** duel-arena redesign, **M1-4v4** `iron-basin`, **Thorn-dash** (Bramble Stride). (PR #22)

Current suite: **468 tests** (engine 325 + client 143), typecheck + build clean, purity green.

> The local 2v2 hot-seat is essentially feature-complete. After **UI1-fix** it is
> playtest-ready; the remaining items are one bug, map guardrails, render verification, and
> polish. Expect the next real signal to be balance/pacing Dev Notes, not features.

---

## Next batch

### UI1-fix. A committed board click must lock the action (stop mouse-follow) — UNBLOCKED (HIGH, first)
**Addresses Dev Note: "Right now, the attack, dash and prep actions cannot be locked in. As I am
moving my mouse around the board, the attack action follows my mouse around. I need to be able to
lock in the action when I click the tile on the board so the action stops following the mouse."**
Root cause: `onBoardClick` commits `draft.aim` but leaves `mode === 'aim'`, so `onBoardHover`
keeps re-setting `hover.square` and `previewAim` keeps rendering the mouse-following aim over the
committed one. *AC: after a board click in aim mode, the aim is fixed at the clicked tile and no
longer follows the mouse; the same for a move/dash click; re-selecting the ability re-arms aim;
a client test asserts that a `mousemove` after a committing click does not change the rendered
aim.*
**Spec Notes.** Files: `packages/client/src/app.ts` — in `onBoardClick`, after committing in
**both** the `aim` and `move` branches, set `mode = 'idle'` and `clearHover()` (then `render()`),
so `previewAim` falls through to the committed `draft.aim` and `onBoardHover` early-returns
(mode idle). Keep `render()` so the committed layer paints. Out of scope: any change to what a
click *commits* (that's correct) or to the Lock-In model. Add the regression test noted in the AC.

### M1-tests. Validate the new maps + build the map guardrails — UNBLOCKED (Builder)
`iron-basin` (4v4) shipped but is not imported by `content.test.ts` (no validation), and
`maps-v1.md` §6's guardrails are unbuilt. *AC: `content.test.ts` imports and validates
`iron-basin` (`validateMap` + `validateMapForFormat('4v4')`) and the redesigned `duel-arena`;
a **roster-derived** test asserts **max turn-1 threat < spawn separation** for each map/format
(computed from `movementBudget` + each ability's `range` via the engine, not hardcoded); the
dash-answer guardrail is **tightened to all archetypes** now that Thorn has Bramble Stride.*
**Spec Notes.** Files: `packages/engine/test/content.test.ts` (+ import the maps). The turn-1
guard is the point of M2 (range cap) — it must derive the threat from the roster so a future
long-range character can't silently reintroduce a turn-1 spawn hit. No engine/data change
expected; if a map fails the guard, that's a Designer fix, not a test relaxation.

### RENDER-VERIFY. Headless screenshot smoke test for the 3D renderer — UNBLOCKED (recommended)
Every UI item this session (and the readability batch) was verified only by scripted browser +
composited screenshots — the sole thing that catches renderer bugs (it caught the
`transparent/needsUpdate` bug); none of it is reachable from a unit test. *AC: a Playwright
devDependency + one CI job drives a scripted hot-seat turn and asserts a few composited pixels
(e.g. a unit rings up, an ability overlay paints, a damage readout appears); runs in CI.*
**Spec Notes.** Files: `packages/client` (Playwright config + test), `ci.yml`. Chromium +
Playwright are already in the environment (`PLAYWRIGHT_BROWSERS_PATH`); do not re-download. Keep
it a thin smoke test (existence/pixel presence), not pixel-perfect goldens (brittle). Renderer
*inputs* stay unit-covered regardless.

## Optional / low priority

- **UI-responsive (optional).** HUD reserves 260px and the log 300px; below ~1100px the board is
  cramped with no breakpoint. Add a responsive layout only if the owner plays on a laptop.
  `index.html`, `app.sizeToContainer`.
- **UI6-cap (optional, playtest).** The combat log is uncapped/unfiltered; add a per-tone filter
  or max-entry window if 4v4 makes it noisy.

## Deferred — do NOT schedule

- **A4** per-ability FX (`"fx"` data blocks; generic consumer via the kept `objectFor()` seam) —
  blocked on **M3 + roster lock**.
- **CL1** (AR clash co-occupancy), **CL2** (vector-sum displacement), **E2** (cover-corner unify).

## M3+ — the next milestone (Analyzer expands when playtest settles v1)

21. Worker + DO rooms; format selection; lobby with team-seat + **duplicate-pick validation
    (R3)**; per-player hidden submission → per-team orders; per-player timer + Time Bank;
    **combat log + decoy get the hidden-information treatment** (UI6 currently shows both teams —
    correct only for hot-seat); reconnect/replay; deploy to Pages + wrangler. Also fold the UI
    polish deferred from this session: **read-only review of a locked character**, **granular
    un-commit** (drop just the move, keep the ability).

## Observed-not-requested (from the reference screenshot; NOT scoped)

Turn countdown timer; top-centre score/objective header; per-unit floating name labels; per-unit
status icons. Owner has not requested these.

## Playtest / balance (not Builder-blocking)

- **`MS_PER_BEAT`** pacing (esp. 4v4). **Wisp/Shadowstep** (4-neighbour strike after MET1-tp).
  **Support anti-stall (R6)** (Lumen+Thorn vs double-Firepower). **Cone raggedness** at shallow
  angles. **Spotlight** hiding off-actor bars. **UI5** readout stacking in heavy AoE.
