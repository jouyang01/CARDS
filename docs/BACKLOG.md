# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 is the **default** (2–4 players), 4v4 is supported (4–8),
1v1 is a dev/testing format. A player controls 1–2 characters on one team.

**Standing architectural directive (Dev Note 1, ARCHITECTURE.md):** *"…never hardcode
single-unit assumptions… 2D SVG visuals now; the engine emits an event log so a 3D
renderer can be swapped in later without touching game logic."* Every engine item
iterates unit **lists** (now literally true — teams of N); every client item is a pure
consumer of `TurnEvent[]`. The engine is **player-count-blind** — the room layer owns the
player→character map (ARCHITECTURE "Teams vs. players").

## M1 — Engine core ✅ COMPLETE (reviewed 2026-08-14)

Items 1–12 (board, vision, cover, pipeline, shapes/5a, status, dash, knockback, traps,
deaths/respawn/win, determinism, real characters + delayed abilities), plus **3a** (no
edge-swap) and **E1** (passive energy bypasses Energized). See reviews 2026-08-13/14.

## M1.5 — Teams & formats ✅ COMPLETE (reviewed 2026-08-15)

Shipped on `claude/cards-engine-builder-h4ws0r` (built on the rescope merge). 226 tests,
typecheck clean, purity guard green.

- [x] **13. Format config** — `formats.ts` (`FORMATS`: 2v2 4/16, 4v4 5/20, 1v1 3/12),
  `GameState.format`, win check reads the format; global `KILLS_TO_WIN`/`TURN_LIMIT`
  retired. `TeamId` added; `PlayerId` kept as a **deprecated alias** → full rename is T1.
- [x] **14. Ally-aware effects (no friendly fire)** — effect polarity in `resolve.ts`
  (harmful→enemies, beneficial→own team, teleport/decoy/trap neutral); beneficial
  abilities pay `energyGain` on use. Ruled in edge-cases.
- [x] **15. Team movement & vision** — ally pass-through (planning affordance; resolution
  halts before a stationary ally — RULED v1), allied contested squares, team-shared
  vision (`teamCanSee`/`visibleEnemiesForTeam`/`visibleSquaresForTeam`).
- [x] **16. Multi-unit spawns & respawns** — `createMatch` places on team spawns in map
  order; respawn to first unoccupied team spawn; `validateMapForFormat`.

## M2 — Local playable

- [x] **17. Render live game state** — team-coloured units, HP/shield/energy bars,
  terrain; loops `state.units` (N-unit), engine-state-only. Done (`dd389bf`).

### T1. `PlayerId` → `TeamId` full rename — UNBLOCKED (do first; mechanical, no behaviour)
The engine models teams; `PlayerId` is a deprecated alias and `PlayerOrders.player` /
`owner: PlayerId` still carry the old name. Do the mechanical rename now, before the
interactive client (18–20) adds more call sites. *AC: no `PlayerId` remains except a
one-line `@deprecated export type PlayerId = TeamId` (or removed entirely if no external
need); `PlayerOrders.player` → `PlayerOrders.team` (or documented keep); all 226 tests
green with no behaviour change; typecheck clean.*

**Spec Notes.** Files: `types.ts` (source of the alias), then every importer —
`resolve.ts`, `movement.ts`, `vision.ts`, `setup.ts`, `combat.ts`, tests. Pure rename:
**no logic changes in this commit** (that's the point of isolating it — a behaviour diff
hiding inside a rename is unreviewable). Decide `PlayerOrders.player`'s new name
(`team` reads best) and update the client (item 17) accordingly. Out of scope: anything
that changes a test's *expected values*. Gotcha: keep the deprecated alias for one release
only if something external needs it; otherwise delete it so the rename is complete.

### 18. Decision-phase targeting UI — BLOCKED BY 17, T1
Build a `UnitOrders` per controlled character: pick ability, aim (shape preview), draw a
move path, or sprint; lock in. A player controlling 2 characters enters orders for each.
**Reuse `expandShape`, `aimInRange`, `validateMovePath`, `movementBudget`,
`reachableSquares`** from the engine — no shape/legality logic in the client. *AC:
aiming Vex's Rail Shot previews exactly `expandShape`'s squares; an illegal path is
rejected in-UI using `validateMovePath`; a 2-character player produces two `UnitOrders`;
sprint disables when an ability is selected.*

**Spec Notes.** Files: client targeting modules. **Ally pass-through gotcha (edge-cases):**
`reachableSquares` marks ally squares `canStop:false` — the UI must show them as
walk-through, not valid endpoints, and reflect that a path through a *stationary* ally may
halt early at resolution. Show cooldown/energy/ult availability from `UnitState`. Out of
scope: hidden info / per-player timers (room layer, M3). Addresses Dev Note 1 (client
computes nothing about legality itself).

### 19. Resolution playback from `TurnEvent[]` — BLOCKED BY 17
Animate a resolved turn phase-by-phase from the event log: `phaseStart`, `moveStep`,
`abilityFired`, `damage`, `heal`, `statusApplied`, `displaced`, `trapPlaced/Triggered`,
`death`, `respawn`, `energyGained`, `gameEnd`. Pure consumer; never recomputes outcomes.
*AC: feeding a scripted `resolveTurn(...).events` reproduces the engine's final board;
the four phases play in Prep→Dash→Blast→Move order; a team AoE shows enemies damaged and
allies healed from the same `abilityFired`.*

**Spec Notes (addresses Dev Note 1 — "the engine emits an event log so a 3D renderer can
be swapped in later without touching game logic").** Build a clean `renderEvent(event)`
interface with **zero game logic** so a 3D renderer drops in behind the same stream. If
playback needs a fact the log lacks, report it as an event-schema gap to the Analyzer —
do not recompute in the client. Files: client playback module.

### 20. Hot-seat dev harness — BLOCKED BY 18, 19
Pass-the-device loop: each player enters orders for their character(s), then run
`resolveTurn` and play back; repeat to `gameEnd`. Supports 2–4 players in 2v2, including
the 3-player split (one player runs both of a team's characters). *AC: a full scripted
2v2 hot-seat match plays turn 1 → winner via the UI, orders entered one player at a time.*

**Spec Notes.** Files: client harness/page. Wire 17–19 + the pipeline; merge one player's
1–2 `UnitOrders` into their team's `PlayerOrders`. Keep order-entry symmetric across
team sizes. Out of scope: hidden info, timers, networking (M3).

### E2 (optional, low). Unify cover corner convention with LoS — UNBLOCKED
`combat.isBehindCover` is corner-*inclusive*; LoS is corner-*exclusive* (ruled acceptable,
edge-cases). Optional polish: reuse the LoS kernel so cover and sight agree on corner
grazes. Skip unless touching cover anyway.

## M3+ — placeholder (Analyzer expands after M2)

21. Worker + Durable Object rooms; format selection (default 2v2; 4v4); lobby with team
    seats and 1–2 characters claimed per player; per-player hidden submission merged into
    per-team orders (teammates' plans mirrored, opponents' hidden); per-player timer +
    Time Bank; reconnect/replay; deploy client to Pages + server via wrangler.

## Blocked — needs a Designer spec (not in the Builder's unblocked set)

- **D1. Decoy entity (Wisp Veil & Decoy).** v1 ships decoy as a no-op beyond Stealth
  (edge-cases). The real feature (a fake unit rendered only to the opponent that absorbs a
  hit and expires) needs a precise Designer ruling before the Builder models a `decoy`
  entity. `ENGINE ASK`.
- **Duplicate picks.** May a team field the same character twice (OPEN in edge-cases)?
  Designer to rule before the M3 lobby. Engine already gives duplicate picks unique unit
  ids (`<charId>-t<team>-<i>`), so it's a lobby/UX rule, not an engine blocker.
- **Roster / Designer follow-ups.** `roster-v1.md` §9 `ENGINE ASK`s (effect target
  affinity; energy-on-ally-benefit) are **2v2-era but must NOT be built without a ruling**
  — energy-on-ally-benefit is partly pre-empted by item 14's beneficial-on-use rule;
  reconcile before drafting Support kits. Also open: `combat_roll` path-vs-teleport;
  cover-vs-Might composition; Support archetype kit (unblocked by the rescope).

## Notes for the Analyzer (next session)

- **Branch reconciliation done this session.** This review branch was rebased onto the
  engine branch's code (newest engine + client render) and the doc/data superset pulled
  from `main` (9-character roster, prior reviews, rescoped GAME_SPEC/ARCHITECTURE, my
  edge-cases rulings). BACKLOG + edge-cases deduped and reconciled here. When this merges
  to `main`, the engine branch and this branch converge; retire stale branches.
- The 3 base characters (vex/bastion/wisp) here are the engine branch's copies; if the
  roster branch retuned them (e.g. Wisp→firepower), take the roster's on merge.
