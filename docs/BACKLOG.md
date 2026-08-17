# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js; **server may depend on the Workers
runtime**); client/server consume `TurnEvent[]` + the engine's derived queries — never recompute
them. **`@cards/server` imports `@cards/engine` only, never the client.** **Movement is Manhattan
(MET1); aiming is Euclidean (AIM-METRIC).** **Open/update a PR to `main` every session** (CLAUDE.md).

## ✅ COMPLETE

- The full local hot-seat game + AR parity + the screenshot UI batch.
- **M3 so far:** M3-ROOM, M3-PROTOCOL, M3-HIDDEN, M3-JOIN-GUARD, M3-START, M3-LOCKLIST.
- **PR #56 (this review):** **LOS-OCCLUSION** (a wall shadows the whole cone/line via
  `hasLineOfSight`), **MELEE-COVER** (a `melee` flag skips cover — *inert until the Designer marks
  abilities*), **CHASE-SPRINT** (a chase runs at sprint budget when no ability is spent), **MOVE-FOG**
  (plan-time reachability filters unseen units — leak closed), **STATUS-ICONS-SIZE**, **ANIM-SLOW**
  (460→760 ms/beat), **PADS-LIGHTS**, **PADS-SCHEDULE** (Might turn 2 / regular turn 4),
  **RENDERER-SPLIT** (`textures.ts`), **RENDER-DRIVE-FIX** (drives reach contact; LAST-KNOWN green).
- **PR #57 (Designer):** **PADS-PLACEMENT** (Might → central strongpoint (7,7)/(10,7) & (9,9)/(12,9),
  Health/Energy → flanks) — resolves Might-contestability; **health-pad parity** confirmed;
  **NAMEPLATE-LAYOUT** specced (§4.8 — scheduled below).

Current suite: **1420 unit tests** (engine 669 + client 627 + server 124), typecheck + build clean.
**Verify the chase RENDER-COVERAGE e2e is green** (Builder added `largestCluster` — OQ #5).

> **This batch: a HIGH-priority movement bug, the Designer's nameplate revision, then M3-LOBBY.**
> **Do not touch vision** (per-format `visionRange` superseded by ar-parity §3).

### Build order and dependencies

**MOVE-SPRINT-FIRST** (bug, HIGH) → **NAMEPLATE-LAYOUT** (client, PR #57) → verify the **chase e2e**
→ **M3-LOBBY** (large, multi-session). The **melee-ability data pass** routes to the Designer.

---

## Bug (do first)

### MOVE-SPRINT-FIRST. Vex's first sprint does not move the character (CLIENT) — UNBLOCKED (first, HIGH)
**Addresses Dev Note: "BUG: Vex's first sprint action does not move the character."** *AC: a unit's
first Sprint order of the match produces a non-empty `movePath` and the unit **moves at resolution**;
a client regression test drives select-Sprint → board-click on turn 1 and asserts the committed path
is non-empty (budget 8) and the unit's resolved position changed.*
**Spec Notes.** **REPRODUCE EMPIRICALLY BEFORE TOUCHING CODE.** I traced the path statically and it
reads correct at every step — `selectSprint` sets `sprint:true` + clears the ability
(`targeting.ts:887`), `sprintAllowed` is true for a fresh unit, `onBoardClick` commits
`pathTo(map, planningState(...), unit, sq, movementBudget(unit, draft.sprint))` with budget 8
(`app.ts:1352-1360`) — so either it is a **subtle state/timing interaction**, a **pre-existing** bug,
or a **stale build** (the UI1 "still broken" report was a cached bundle, not a defect — reviews
2026-08-24/25). **First establish code-vs-environment in the running hot-seat.** **Prime suspect:
MOVE-FOG** (the newest movement change): the committed path is planned against
`planningState(state, currentFog(...).units)` — check the object identity of the acting unit in that
filtered set, the `currentFog` memo on the first frame, and whether the turn-1 opening frame produces
an empty/short reachable set for the first sprint specifically. Files: `packages/client/src/app.ts`
(`onBoardClick` move branch, `selectMove`), `fog.ts` (`planningState`), `targeting.ts`
(`pathTo`/`reachableSquares`, `sprintAllowed`). **Required test:** the regression above, plus — if
MOVE-FOG is the cause — a test that a first sprint against a fog-filtered planning state still yields
the full-budget path. **Out of scope:** the engine (resolution walks the true board — unchanged
unless repro proves otherwise).

## Client — the Designer's nameplate revision (PR #57)

### NAMEPLATE-LAYOUT. Revise the shipped nameplate; polarity-tint the status row (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Make sure to address pull #57 from the designer."** (ar-parity §4.8.) *AC:
the nameplate is revised — **name left-justified above the HP bar; the status icon row sits beside
the name** (not below the bar); **buffs tinted BLUE, debuffs RED** per the **FF1 polarity table
verbatim** (`healOverTime` blue, `damageOverTime` red) — glyph carries identity, tint carries
polarity; `PIP_ORDER` (debuffs-first) survives, now reading as **red-nearest-the-name**;
STATUS-ICONS-SIZE's sizing/wrap folds into this **one repaint**; all still vision-gated (own team
always, enemies on `canSee`); the decoy's fake nameplate follows the same layout. A client test
asserts a buff glyph tints blue and a debuff red, and the row sits beside the name.*
**Spec Notes.** Files: `packages/client/src/renderer3d.ts`/`textures.ts` (the nameplate plate raster
— now including the icon row beside the name), `status-pips.ts` (polarity tint from the **existing
FF1 polarity table** — do NOT introduce a second colour table to drift). Supersedes STATUS-ICONS-SIZE
+ the wrap-at-six decision (Builder OQ 2026-09-07 #6) — one layout, not two. Ruled in edge-cases
(banner, folded 2026-09-07). Out of scope: the icon vocabulary (STATUS-ICONS shipped it); UI-INSPECT
/ UI-TOPBAR (unchanged).

## M3 — the lobby (the remaining unblocked M3 work)

### M3-LOBBY. Map/format/catalyst/character selection + team-seat + R3 + the network client (SERVER + CLIENT) — UNBLOCKED (large, multi-session)
*AC: a lobby picks map + format + each player's catalyst triad + character, seats players, enforces
**R3 duplicate-pick**; its start button calls `RoomHub.start()` and **deletes the temporary `POST
/rooms/:code/start` route**; the **client consumes a `decision` and a filtered `turnResolved`** over
the socket (proving M3-HIDDEN end-to-end) — written against M3-LOCKLIST's shape (`locked.length/of`
own team, `enemyLocked/enemyOf` the other half); supersedes MAPTOGGLE and M3-START's interim.*
**Spec Notes.** The first item to build the **network client** (socket layer) — the client is
hot-seat only today and has never consumed M3-HIDDEN's payloads (chosen to be a `GameState` with
things missing, so the existing renderer reads it). Large; explicitly multi-session. Out of scope:
reconnect (M3-RECONNECT), server-authoritative timing (M3-TIMER).

### CAMO-E2E-FINISH. Composited proof of the camo red tile (CLIENT e2e) — UNBLOCKED (low)
Before/after-delta at fixed coords. A real multi-turn browser drive; low priority; the *rule* is
unit-covered (`camo-reveal.test.ts`). Fold with any e2e-harness work (it can reuse `largestCluster`).

## M3 — the rest of the roadmap (blocked in sequence)

### M3-TIMER. Server-authoritative per-player timer + Time Bank (SERVER + CLIENT) — BLOCKED on M3-LOBBY
*AC: the DO enforces each player's `DECISION_SECONDS` (40) deadline; a missed submission resolves as
**hold-position** (settle the OPEN partial-disconnect ruling at build); **Time Bank scope matches
the hot-seat** (per-seat per decision window, `TIMEBANK_CHARGES = 1` — Builder OQ 2026-09-06 #2); the
client shows UI-TIMER's countdown driven by the server clock — this is where a real deadline actually
fires (hot-seat UI-TIMER intentionally does nothing at zero).*

### M3-RECONNECT. Rejoin by code + reclaim a held seat + replay to current (SERVER + CLIENT) — BLOCKED on M3-LOBBY
*AC: a dropped browser rejoins by room code, reclaims its original seat (identity-matched — the seat
M3-JOIN-GUARD reserves), and the DO re-syncs it to the current turn from stored state.*

### M3-DEPLOY. Wrangler deploy + Pages + first real-runtime smoke (CI) — BLOCKED on M3-LOBBY
*AC: a `wrangler deploy` path; the client points at the deployed Worker; core-CI/Pages gates hold; a
`wrangler dev`/miniflare **smoke check** proves the Worker boots (Builder OQ #8); the `POST …/start`
route is gone or gated.* **Needs owner infra decisions — coordinate before building.**

## Routed to Designer (data / balance — not Builder build items)

- **Melee ability list (data, MELEE-COVER):** mark which abilities are `melee: true` — the
  short-range strikers. **Until it lands the MELEE-COVER rule is inert** (every ability still eats
  cover — Builder OQ 2026-09-07 #3). This is the one that makes the shipped engine flag do anything.
- **Pad tuning (data):** the shipped placement/schedule is owner-directed and verified; the flagged
  4v4 lever is **`everyTurns` 4 → 5 on iron-basin**, *not* moving Might pads out of the centre.
- **Pad colours** stay coupled to the render e2e (`isPadTeal`/`isTeamBlue`).

## Flags / deferred (not scheduled)

- **UI-TIMER hot-seat auto-lock** (only if the owner wants a deadline before M3-TIMER), **touch
  input** for UI-INSPECT (desktop-only v1), **UI composited e2e** (unit-covered), **PREVIEW-MODIFIERS
  shields**, **AIM-SMOOTH angle-uniform table**, `killerUnitId`/`gameEnd`, **A4**, **spectators**,
  **CL1/CL2/E2**, **`vulnerable`**, the four un-adopted catalysts — unchanged, not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **Might centre-room contest** (new — playtest the central strongpoint; 4v4 over-dominance lever is
  `everyTurns`), **pad Dash-beats-Move**, **DoT/HoT vs Might/Weaken** (ruled off), **chase prediction
  tell**, **ANIM-SLOW at 760 ms/beat** (confirm it reads without dragging), **8-tile melee cones**,
  **Fade full-action**, **Kestrel** untested via MAPTOGGLE, **turn-1 spawn margin one tile**,
  **vision Manhattan diamond**.
