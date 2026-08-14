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
- **UI1-fix** (board click locks the action), **M1-tests** (both maps validated + roster-derived
  turn-1 spawn-safety guard + dash guardrail tightened to all archetypes), **RENDER-VERIFY**
  (headless Playwright render smoke test), **UI-responsive**, **UI6-cap**. (PRs #26/#27)

Current suite: **489 tests** (engine 333 + client 156), typecheck + build clean, purity green.
The local 2v2 hot-seat is playtest-ready; this batch is bug-fix + AR-fidelity + fog + enablers.

---

## Next batch

### MOVE1. A move click on an occupied/unreachable tile routes to the nearest legal tile (CLIENT) — UNBLOCKED (first, bug)
**Addresses Dev Note: "When clicking to move on the square an existing character is on, the move
command is not input and character stays still."** `pathTo` returns `[]` when the target isn't a
legal stop (occupied → `canStop:false`, out of budget, blocked), so the move silently drops.
*AC: clicking an occupied/out-of-range/blocked tile moves the unit **as far as legally possible
toward it** (the reachable tile nearest the clicked target); clicking a normal reachable tile is
unchanged; a client test covers click-on-occupied → non-empty path ending on the nearest legal
tile.*
**Spec Notes.** Files: `packages/client/src/targeting.ts` (`pathTo`) — when `reconstructPath` to
the exact target is null, pick the reachable square **closest to the target** (min Manhattan to
target, ties by lowest path cost, then fixed direction order for determinism) and path there.
Engine unchanged (the "can't end on an occupied square" rule stands). Ruled in edge-cases. Out
of scope: AR "follow a teammate" (the richer future version — noted, not now).

### HITBOX1. Tile coverage → Atlas Reactor central-circular-hitbox (ENGINE) — UNBLOCKED (determinism-critical)
**Addresses Dev Note: "let's use the same rules as Atlas Reactor… circular hitbox in the middle
of each tile… nicking the corner doesn't count… if an AoE cuts at least halfway along the edge
it's guaranteed to hit."** Replace the AIM2 centre-in coverage with the AR hitbox rule. *AC: a
tile is hit **iff the AoE region intersects a circle of radius half-a-tile at the tile centre**;
a shape that only nicks a corner (does not reach within half a tile of the centre) does NOT hit;
a boundary crossing an edge at/after its midpoint DOES hit; coverage stays binary/full-damage;
existing shape tests updated to the new rule; a **cross-engine determinism regression** asserts a
fixed shape+aim yields the identical tile set.*
**Spec Notes.** Files: `packages/engine/src/shapes.ts` (`coneSquares`/`lineSquares`/
`circleSquares`/`expandShape`), `shapes.test.ts` + the regression. **Determinism (hard):** integer
only — work in a scaled lattice (e.g. ×2 so the half-tile radius is the integer 1); test
shape∩circle with **squared distances** and integer half-plane (cross-product) perpendicular
distances; **no `Math.sqrt`, no trig** (the AIM2 no-trig-in-engine guard must still pass). For a
`circle` AoE: disk∩disk via squared distance. For `line`/`cone` (quantized-int direction, AIM2):
perpendicular distance from the tile centre to the ray/edges ≤ radius, plus the axial-range
bound. `expandShape` stays the single authority — UI2's Layer-2 tiles read it, so the overlay
tracks the new rule automatically. Out of scope: fractional/partial damage (coverage is binary);
`path`/`square`/`self` shapes (unaffected). Watch: FF1 + friendly units now sit on more/fewer
tiles under the new rule — the existing FF1 tests should still pass.

### VISION1. Fog of war in the client from the engine's vision (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Let's input vision rules and line of sight. Model this after Atlas
Reactor."** The engine already has AR-style vision (LoS via walls, Manhattan sight radius, brush
concealment + adjacency, Stealth/Reveal, team-shared sight); the client draws everything.
*AC: during the **Decision phase**, enemy units the seat-on-the-clock's **team** cannot see are
hidden and tiles outside team sight are fogged/dimmed (own team always visible); **resolution
playback reveals** what happens; the client computes nothing about visibility — it consumes
`canSee`/`visibleEnemiesForTeam`/`visibleSquaresForTeam`; a client test drives a walled/brush
setup and asserts a hidden enemy is not drawn during Decision and appears in playback.*
**Spec Notes.** Files: `packages/client/src/renderer3d.ts` (fog/dim + hide hidden units),
`app.ts` (feed the active team + `visibleEnemiesForTeam`/`visibleSquaresForTeam` into the render
during Decision; full board during playback), `hotseat.ts` if the active team isn't already to
hand. Ruled in edge-cases. **Hot-seat fog is a local approximation, NOT the security boundary** —
true per-team hidden info across the network is M3. Out of scope: last-known-ghost markers
(optional AR nicety — add only if the owner asks) and any vision-*rule* change (the engine rules
already match AR; raise rule changes separately).

### MAPTOGGLE. Dev-only map + format selection (CLIENT) — UNBLOCKED
`iron-basin` (4v4) and the redesigned `duel-arena` exist but `main.ts` hard-codes `duel-arena`,
so 4v4 is unplayable/untested before M3. *AC: a dev-only control (query param or a small menu)
picks the map + format and starts a match on it, seating the right unit count per team;
`iron-basin` + 4v4 is reachable and playable in hot-seat.*
**Spec Notes.** Files: `main.ts`, `app.ts`/`hud.ts`. Reuse `createMatch`/`FORMATS`/
`validateMapForFormat`; no engine change. This is scaffolding for playtest, not the M3 lobby —
keep it minimal (a `?map=iron-basin&format=4v4` URL is enough). Out of scope: character pick,
duplicate-pick validation (M3).

### CI-decouple. The Pages deploy gates on core CI, not on RENDER-VERIFY (CI) — UNBLOCKED
A red/flaky render job (CDN browser download + headless GPU) currently blocks all publishing.
*AC: the Pages deploy fires on success of the **core** checks (engine tests, typecheck, client
build); RENDER-VERIFY still runs on PRs as a signal but a render-only failure no longer blocks
the deploy.*
**Spec Notes.** Files: `.github/workflows/ci.yml`, `deploy-pages.yml`. Cleanest: split
RENDER-VERIFY into its own workflow (or its own job the deploy `workflow_run` does not depend on).
Keep "a broken *engine/build* never publishes." Ruled in review 2026-08-25. Owner may override if
they'd rather a broken renderer also block release.

## Deferred — do NOT schedule

- **A4** per-ability FX (`"fx"` data blocks; generic consumer via the kept `objectFor()` seam) —
  blocked on **M3 + roster lock**.
- **CL1** (AR clash co-occupancy), **CL2** (vector-sum displacement), **E2** (cover-corner unify)
  — deferred; not for v1 without a new decision.

## M3+ — the next milestone

21. Worker + DO rooms; **map + format selection lobby** (supersedes MAPTOGGLE); team-seat +
    **duplicate-pick validation (R3)**; per-player hidden submission → per-team orders;
    **per-team hidden information for fog (VISION1) and the combat log (UI6)** — the real
    security boundary the hot-seat only approximates; per-player timer + Time Bank; decoy fog;
    reconnect/replay; deploy to Pages + wrangler.

## Observed-not-requested (from the UI reference screenshot; NOT scoped)

Turn countdown timer; score/objective header; per-unit name labels; per-unit status icons.

## Playtest / balance (not Builder-blocking)

- **Turn-1 spawn margin is one tile** — hold `MAX_ABILITY_RANGE = 8` and the spawn columns.
- **`MS_PER_BEAT`** pacing (esp. 4v4). **Wisp/Shadowstep** (4-neighbour strike). **Support
  anti-stall (R6)**. **Cone raggedness** at shallow angles. **UI6** per-tone filter if noisy.
