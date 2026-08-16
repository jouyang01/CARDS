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
- **M3 so far:** M3-ROOM, M3-PROTOCOL, M3-HIDDEN, M3-JOIN-GUARD, M3-START, **M3-LOCKLIST**.
- **PR #54 (this review):** **STATUS-ICONS** (glyphs), **UI-NAMEPLATES** (vision-gated), **UI-INSPECT**
  (hover any visible unit), **UI-INTENT** (teammate plans), **UI-TOPBAR** (portraits/score/turn +
  a scoreboard-measurement fix), **UI-TIMER** (countdown + bank pip), **PREVIEW-MODIFIERS** (the
  preview shows Might/Weaken/cover-adjusted damage).

Current suite: **1354 unit tests** (engine 628 + client 602 + server 124), typecheck + build clean.
**Two RENDER-COVERAGE e2e drives fail (pre-existing on `main`)** — see RENDER-DRIVE-FIX.

> **This batch is COMBAT-CORRECTNESS FIRST** (four Dev Notes are real engine/spec bugs: attacks
> through walls, melee vs cover, a move-preview hidden-info leak, sprint-chase), then client polish,
> the pad schedule, the e2e fix, and a small refactor — then **M3-LOBBY**. **Do not touch vision**
> (per-format `visionRange` superseded by ar-parity §3).

### Build order and dependencies

**LOS-OCCLUSION → MELEE-COVER → CHASE-SPRINT** (engine) → **MOVE-FOG** (client) → **PADS-LIGHTS,
STATUS-ICONS-SIZE, ANIM-SLOW** (client polish, independent) → **RENDER-DRIVE-FIX** (green the e2e) →
**RENDERER-SPLIT** (small refactor) → **M3-LOBBY** (large). **PADS-SCHEDULE** + the melee list are
Designer data. Realistic one-session cut: the engine bugs + client polish + RENDER-DRIVE-FIX;
M3-LOBBY carries.

---

## Engine — combat correctness (do first)

### LOS-OCCLUSION. A cone/line is occluded by walls, not clipped at them (ENGINE) — UNBLOCKED (first, HIGH)
**Addresses Dev Note: "LoS should block make it so attacks cannot hit you. There are some weird
cases where my conal/straight line attacks are going past the gray blocks."** `coneSquares` drops
wall tiles but does **not** occlude tiles behind them, so a cone reaches through a wall; a line's
half-tile side-band can too. *AC: a `line`/`cone` covered tile is dropped when the caster has **no
line of sight** to it — filter by `hasLineOfSight(board, casterCentre, tileCentre)` (walls block,
**cover does not**); a cone aimed through a wall covers nothing behind it; a cone aimed past a
**cover** block still covers behind it; a line's side-band behind a wall is dropped; `circle`/
`square` are **unchanged** (lobbed over walls); the HITBOX1 cross-engine golden signature is
regenerated; the no-trig guard still passes.*
**Spec Notes.** Files: `packages/engine/src/shapes.ts` (`coneSquares`/`lineSquares`/`expandShape` —
apply the LoS filter after wedge/band membership), `shapes.test.ts` + the regression. Reuse
`hasLineOfSight` from `vision.ts` (integer, deterministic — do **not** reinvent it). **Determinism-
critical** — a fixed shape+aim+board must yield the identical tile set. Ruled in edge-cases
(LOS-OCCLUSION). **Out of scope:** `circle`/`square` occlusion (lobbed — unchanged); cover as a
sight blocker (it is not — GAME_SPEC §3); any damage-number change (that's the shape only).

### MELEE-COVER. Melee attacks ignore cover, by an ability flag (ENGINE + Designer data) — UNBLOCKED
**Addresses Dev Note: "Melee attacks should ignore COVER, but not the full vision."** The `range ≤ 1`
heuristic misfires because a Manhattan melee ability is often range 2 (diagonal reach). *AC:
`AbilityDef` gains **`melee?: boolean`**; when an ability is `melee: true`, `computeDamage` is
called with `behindCover = false` (cover reduction skipped) **regardless of range**; LoS/walls still
apply (a melee attack cannot hit through a wall — LOS-OCCLUSION); validation accepts the flag; a
`melee` ability into a cover-protected target deals full damage, a non-melee one is still reduced,
neither hits through a wall.*
**Spec Notes.** Files: `packages/engine/src/types.ts` (`AbilityDef.melee`), `resolve.ts` (the
damage path passes `melee ? false : isBehindCover(...)`), `validate.ts` (accept the flag). The
range-≤1 heuristic in `isBehindCover` may stay as a harmless fallback or be removed — Builder's
call. **The "which abilities are `melee`" data pass routes to the Designer** (mark the short-range
strikers). Ruled in edge-cases (MELEE-COVER). **Out of scope:** the melee data (Designer); redefining
cover geometry.

### CHASE-SPRINT. A chase may sprint when the turn spends no normal ability (ENGINE + CLIENT) — UNBLOCKED
**Addresses Dev Note: "Chase should be able to sprint or move depending on how many actions the
character has. If I choose chase and haven't used an attack or only a free action, I should get full
sprinting chase."** *AC: a chase's budget is `movementBudget(chaser, sprint=true)` (**8**) when the
unit declared **no normal ability**, and move budget (**4**) when it did; a **free action does not
block** the sprint-chase; a dash ability still cancels the chase; the client offers/defaults a chase
to sprint-budget when no ability is armed; a chase with no ability closes up to 8, with an ability
at most 4, with only a free action still sprints.*
**Spec Notes.** Files: `packages/engine/src/resolve.ts` (`planChases` already reads
`movementBudget(chaser, plan.sprint)` — the gap is that a chase order carries the sprint flag under
the same "sprint iff no ability" validation a move uses), `targeting.ts`/`app.ts` (the chase control
defaults to sprint when no ability is armed). Ruled in edge-cases (CHASE-SPRINT). Out of scope: the
chase target rules (unchanged).

## Client — hidden-info leak

### MOVE-FOG. Plan-time reachability must not use a fogged enemy's position (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Move command is blocked if an enemy is out of line of sight but on the tile
that you are trying to move. This is giving unintentional information."** The client's move preview
treats fogged enemies as obstacles, leaking their position. *AC: at plan time `reachableSquares`/
`pathTo` use the **team-visible unit set only** (own units + `visibleEnemiesForTeam`); a path
planned toward a tile held by an out-of-sight enemy is drawn as if the tile were free (no reveal);
the engine (true board) stops the mover short at resolution, which is where the enemy is revealed; a
client test asserts the plan does not reroute around an invisible enemy.*
**Spec Notes.** Files: `packages/client/src/targeting.ts` (feed `pathTo`/`reachableSquares` a
fog-filtered occupancy), `app.ts`/`fog.ts` (the visible-unit set — reuse `fogView`). **Engine
unchanged** — resolution uses the true board (the reveal-at-contact is correct). Ruled in edge-cases
(MOVE-FOG). Out of scope: the engine collision rule (unchanged); showing the enemy before contact.

## Client — polish (independent)

### STATUS-ICONS-SIZE. Bigger buff/debuff glyphs (CLIENT) — UNBLOCKED
**Addresses Dev Note: "The icons for buffs/debuffs are too small on the screen UI."** *AC: the
floating status glyphs (and the HUD strip) render at a larger, legible size; interactive elements
respect UI-VIEWPORT's 44×44 minimum where clickable; the vocabulary/order is unchanged.*
**Spec Notes.** Files: `status-pips.ts`/`renderer3d.ts` (glyph texture size + billboard scale).
Small. Out of scope: the icon set (STATUS-ICONS shipped it).

### ANIM-SLOW. Slow the resolution playback so it reads (CLIENT) — UNBLOCKED
**Addresses Dev Note: "The resolution animations are hard to tell what's going on. We should slow
them down."** *AC: resolution playback is slowed (raise `MS_PER_BEAT` / per-phase pacing) so a
turn's Prep→Dash→Blast→Move is legible; skip==watch still holds (no board state in the animation
layer); a test pins the pacing constant.*
**Spec Notes.** Files: `packages/client/src/app.ts` (`MS_PER_BEAT` / playback pacing). Presentation
only. Consider per-phase or per-event beats if a flat slowdown drags quiet turns. Out of scope: the
engine (pacing is client).

### PADS-LIGHTS. Four-light respawn countdown on a pad (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Respawn Timer: 4 turns (tracked visually by four colored lights on the
spawning pad)."** *AC: a consumed pad shows **four coloured lights**, one per remaining turn until
respawn, counting down each turn; a live pad shows its glyph; extends PADS-INDICATOR; a client test
asserts the light count matches the turns-to-respawn.*
**Spec Notes.** Files: `renderer3d.ts`/`app.ts` (the pad marker). Reads `state.powerups` +
`everyTurns`. Ruled in edge-cases (PADS-SCHEDULE / PADS-LIGHTS). Out of scope: pad placement/timings
(Designer — PADS-SCHEDULE).

## e2e + refactor

### RENDER-DRIVE-FIX. Green the two pre-existing RENDER-COVERAGE drives (CLIENT e2e) — UNBLOCKED
**Addresses Builder OQ 2026-09-06 #10.** `arming a chase draws a route` and `an enemy is drawn on a
fogged board (LAST-KNOWN)` fail on `main` — `walkToCentre` advances ~1 square/turn around
`duel-arena`'s central wall, so 5 turns never bring a unit into sight (likely the PADS-SPREAD pad
re-placement made a marginal drive fail). *AC: both drives get a unit into enemy sight and pass;
fix the helper — drive with **`Sprint`**, aim at a **wall-free row**, or **raise the turn cap** —
without weakening what each test asserts.*
**Spec Notes.** Files: `packages/client/e2e/render.spec.ts` (the `walkToCentre` helper). The
screen-to-board mapping is fine (the Builder pinned it off the pads); the fault is budget vs
distance. Out of scope: the render code (it's correct — the drive is the problem).

### RENDERER-SPLIT. Extract `textures.ts` from `renderer3d.ts` (CLIENT refactor) — UNBLOCKED (small)
**Addresses Builder OQ 2026-09-06 #7.** `renderer3d.ts` is ~1250 lines with three texture caches
(glyphs, nameplates, intent tiles). *AC: the texture caches move to `textures.ts` with **no
behavioural change**; the full suite still passes; `renderer3d.ts` imports them.*
**Spec Notes.** Pure extraction; do it **before** M3-LOBBY adds a network client on top. Out of
scope: any behaviour change.

## M3 — the lobby (the remaining unblocked M3 work)

### M3-LOBBY. Map/format/catalyst/character selection + team-seat + R3 + the network client (SERVER + CLIENT) — UNBLOCKED (large, multi-session)
*AC: a lobby picks map + format + each player's catalyst triad + character, seats players, enforces
**R3 duplicate-pick**; its start button calls `RoomHub.start()` and **deletes the temporary `POST
/rooms/:code/start` route**; the **client consumes a `decision` and a filtered `turnResolved`** over
the socket (proving M3-HIDDEN end-to-end) — written against M3-LOCKLIST's shape (`locked.length/of`
= own team, `enemyLocked/enemyOf` the other half); supersedes MAPTOGGLE and M3-START's interim.*
**Spec Notes.** The first item to build the **network client** (socket layer). Large; explicitly
multi-session. Out of scope: reconnect (M3-RECONNECT), server-authoritative timing (M3-TIMER).

### CAMO-E2E-FINISH. Composited proof of the camo red tile (CLIENT e2e) — UNBLOCKED (low)
Re-specced (before/after-delta at fixed coords). A real multi-turn browser drive; low priority; the
*rule* is unit-covered (`camo-reveal.test.ts`). Fold with RENDER-DRIVE-FIX if convenient.

## M3 — the rest of the roadmap (blocked in sequence)

### M3-TIMER. Server-authoritative per-player timer + Time Bank (SERVER + CLIENT) — BLOCKED on M3-LOBBY
*AC: the DO enforces each player's `DECISION_SECONDS` (40) deadline; a missed submission resolves as
**hold-position** (settle the OPEN partial-disconnect ruling at build); **Time Bank scope matches
the hot-seat** (per-seat per decision window, `TIMEBANK_CHARGES = 1` — Builder OQ #2, do not ship a
different answer); the client shows UI-TIMER's countdown driven by the server clock, and this is
where a real deadline actually fires (hot-seat UI-TIMER intentionally does nothing at zero — OQ #1).*

### M3-RECONNECT. Rejoin by code + reclaim a held seat + replay to current (SERVER + CLIENT) — BLOCKED on M3-LOBBY
*AC: a dropped browser rejoins by room code, reclaims its original seat (identity-matched — the seat
M3-JOIN-GUARD reserves), and the DO re-syncs it to the current turn from stored state.*

### M3-DEPLOY. Wrangler deploy + Pages + first real-runtime smoke (CI) — BLOCKED on M3-LOBBY
*AC: a `wrangler deploy` path; the client points at the deployed Worker; core-CI/Pages gates hold; a
`wrangler dev`/miniflare **smoke check** proves the Worker boots (OQ #9); the `POST …/start` route
is gone or gated.* **Needs owner infra decisions — coordinate before building.**

## Routed to Designer (data / balance — not Builder build items)

- **PADS-SCHEDULE (data):** set per-pad **Might `firstTurn: 2`, regular `firstTurn: 4`, every pad
  `everyTurns: 4`** on both maps (owner Dev Notes #5/#6 — Might is the turn-2 rush). Schema already
  carries the fields; no engine change. The PADS1 mirror + PADS-SPREAD guards keep it honest.
- **Melee ability list (data):** mark which abilities are `melee: true` (MELEE-COVER) — the
  short-range strikers.
- **Pad placement** — real squares/lanes (the Builder's are mirror-satisfying placeholders); pad
  **colours** are coupled to the render e2e (`isPadTeal`/`isTeamBlue`).

## Flags / deferred (not scheduled)

- **UI-TIMER hot-seat auto-lock** (OQ #1) — only if the owner wants a deadline that fires before
  M3-TIMER. **Touch input** for UI-INSPECT (OQ #3) — desktop-only v1. **UI composited e2e** (OQ #5)
  — unit-covered for now. **PREVIEW-MODIFIERS shields**, **pad contest feel**, **AIM-SMOOTH table**,
  `killerUnitId`/`gameEnd`, **A4**, **spectators**, **CL1/CL2/E2**, **`vulnerable`**, the four
  un-adopted catalysts — unchanged, not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **Might turn-2 rush** (new — playtest the contest), **pad Dash-beats-Move**, **DoT/HoT vs
  Might/Weaken** (ruled off), **chase prediction tell**, **8-tile melee cones**, **Fade full-action**,
  **Kestrel** untested via MAPTOGGLE, **turn-1 spawn margin one tile**, **vision Manhattan diamond**.
