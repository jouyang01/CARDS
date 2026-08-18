# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js; **server may depend on the Workers
runtime**); client/server consume `TurnEvent[]` + the engine's derived queries — never recompute
them. **`@cards/server` imports `@cards/engine` only, never the client** (the client may import
server protocol **types only**, `import type`). **Movement is Manhattan (MET1); aiming is Euclidean
(AIM-METRIC).** **Open/update a PR to `main` every session** (CLAUDE.md).

## ✅ COMPLETE

- The full local hot-seat game + AR parity + the screenshot UI batch + M3-ROOM…M3-LOCKLIST.
- **PR #71:** WAYPOINTS-FIX, M3-ROOM-CREATE, M3-NET-BOARD.
- **PR #73 (this review):** **WAYPOINT-TELL** (the composed route stays on screen while you build it —
  the "invisible" waypoint was a preview bug, order was always right), **M3-WAIT-STATE + M3-CONN-STATE**
  (a networked client says why the board stopped taking orders; `WaitView` holds enemy-as-count by
  type; board disarms before submit), **CREATE-LINK** (a Play-online link from the hot-seat page),
  **BASIC-BEAM** (a constant-width odd-only lane on a cone; Aegis Shield Bash `beamWidth: 3`, range 2).

Current suite: **1788 tests** (813 + 792 + 183), typecheck + build clean.

> **Multiplayer status:** the loop is create → pick → play → resolve, playable locally. This batch
> takes it from "playable" to "robust": clear the dash/waypoint marks, add the end screen, the server
> timer, and reconnect. **M3-DEPLOY** (internet play) still needs owner infra.

### Build order and dependencies

**WAYPOINT-DASH-CLEAR → M3-END-SCREEN → M3-TIMER → M3-RECONNECT.** The first two are small/independent;
M3-TIMER is unblocked by M3-WAIT-STATE (shipped); M3-RECONNECT is unblocked by M3-CONN-STATE (shipped)
and is the largest. Realistic one-session cut: WAYPOINT-DASH-CLEAR + M3-END-SCREEN + M3-TIMER, with
M3-RECONNECT carrying.

---

## Client — the tiny cleanup (do first)

### WAYPOINT-DASH-CLEAR. A committed dash clears the composed move route + marks (CLIENT, small) — UNBLOCKED
**Addresses Builder OQ 2026-09-14 #2.** A composed move route correctly survives a *non-dash* ability
(the move is still part of the turn), but a **dash IS the movement** — the engine already drops the
`movePath` when a dash is armed — so a dash that supersedes the move must also clear the on-screen
route or the board draws a path that won't execute. *AC: committing a **dash ability or a Dash
catalyst** clears both `movePath` **and** `waypointMarks`; a **non-dash** ability commit leaves both;
a test asserts a dash after a composed waypoint route leaves no move marks and the resolved order
carries no `movePath`.* **Spec Notes.** Files: `packages/client/src/app.ts` (the dash-commit path;
`waypointMarks`). Client-only — the order is already correct at resolve; this is the preview catching
up. Ruled in edge-cases (WAYPOINT-DASH-CLEAR). Out of scope: engine (unchanged); non-dash abilities.

## Client — close the player-facing loop

### M3-END-SCREEN. An end-of-match screen on a resolved match (CLIENT) — UNBLOCKED
**Addresses Builder OQ 2026-09-14 #4.** The loop closes (create → pick → play → resolve) but a decided
match leaves the player on the final board — no winner, no way out. *AC: on a terminal match `status`
(`won`/`lost`/`draw`, already on the resolved state) the client shows an **end-of-match screen** — the
outcome for **this seat** and a **way back** (to the create / hot-seat front door); it reads the
engine's terminal status (`resolveOutcome`) and recomputes nothing; it applies to the **hot-seat game
too** (same missing ending); a test asserts the screen shows on a terminal status with the correct
per-seat outcome, and does not show mid-match.* **Spec Notes.** Files: `packages/client/src/app.ts`
(the resolution path — detect terminal status, show the screen), a small end-screen view. Reuse the
engine's `status`/win queries — do not recompute the winner. Out of scope: rematch wiring, stats,
spectator end views (later nicety). Ruled in edge-cases (M3-END-SCREEN).

## Server + client — the turn clock (unblocked by M3-WAIT-STATE)

### M3-TIMER. The server enforces a per-turn decision clock (SERVER + CLIENT) — UNBLOCKED
*AC: the DO enforces **`DECISION_SECONDS` (40)** per turn; a seat that has not submitted when the clock
expires **holds position** (its orders are whatever it had locked, empty if none) and the turn
resolves; a **Time Bank** grants `TIMEBANK_CHARGES = 1` per seat (one extension per match window); the
client renders the countdown **in the `UI-TIMER` slot beside the wait banner** (banner = what you wait
for, timer = how long — do NOT overwrite the banner text); the clock is the **server's**, not the
client's (the client displays it). Tests: a seat that never submits resolves as hold-position at
expiry; the countdown renders beside the banner without replacing it; the Time Bank extends once and
no more.* **Spec Notes.** Files: `packages/server/src/durable-object.ts` / `room.ts` (the DO clock +
timeout→resolve), `packages/client/src/` (`waiting.ts`/`hud.setBanner`'s sibling `UI-TIMER` slot —
the seam is ready, one place to land). Deterministic resolution unchanged (the timeout just fixes each
seat's orders and calls the same resolve). Ruled in edge-cases (M3-TIMER placement; missed → hold).
**Cross-item:** renders onto M3-WAIT-STATE's banner (shipped). Out of scope: reconnect; per-seat clock
drift beyond the one server clock.

## Server + client — reconnect (unblocked by M3-CONN-STATE)

### M3-RECONNECT. Rejoin a match by code and reclaim the held seat (SERVER + CLIENT, larger) — UNBLOCKED
*AC: a client whose socket closed can **rejoin by room code** and **reclaim its held seat** (the room
already reserves a disconnected seat for its occupant — ruled), then **re-syncs** to the current match
state (the server sends the seat its filtered view); the reconnect banner (M3-CONN-STATE) clears on
success; a **partial-team disconnect** control-handoff is decided here (edge-cases OPEN — current lean:
a teammate gains the abandoned characters after one fully missed turn). Tests: a dropped seat rejoins
and receives its filtered state; a stranger still cannot take a started seat (M3-JOIN-GUARD holds); the
lock total counts the reclaimed seat.* **Spec Notes.** Files: `packages/server/src/room.ts` /
`durable-object.ts` (rejoin + reseat + resync), `packages/client/src/main.ts`/`app.ts` (the rejoin
flow behind M3-CONN-STATE's banner). Identity-matched reseat, never an arbitrary socket. Larger; may
span sessions. Ruled in edge-cases (started-room reserve + NET-CONN-STATE). **Decide the partial-team
handoff** as part of this (it is the last OPEN in Teams & control). Out of scope: spectators; deploy.

## M3 — the deploy gate (blocked on owner infra)

### M3-DEPLOY — BLOCKED (needs owner infra decisions)
`wrangler deploy` + Pages; a `wrangler dev`/miniflare smoke check (first real runtime); confirm the
`POST …/start` route is gone (done PR #68); make the Pages deploy gate legible. **The real-world gate
for internet multiplayer — needs a Cloudflare account + owner go-ahead. Flag when reached.**

## Engine — the last roster knob

### BASIC-MODES. Two aim-time profiles on one ability (ENGINE + CLIENT) — UNBLOCKED (large; returns Kestrel)
*AC: an ability may carry `modes: [AbilityProfile, AbilityProfile]` chosen at aim time (order carries
the index); ships with **Kestrel's Twin Bolts** (wide cone 2 ↔ thin line 6) and **returns Kestrel to
the client's default `CATALOG`**; the client offers the toggle (AIM2 UI). Tests: each mode resolves its
own profile.* **Spec Notes.** The largest BASIC-\* ask (real UI work); its own session, after the M3
polish. Out of scope: other kits.

## LOBBY-TEAM-CHOICE — UNBLOCKED (future, flag)
Let a seat choose its team; makes `wouldSeatNobody` (kept in PR #68) live. Not scheduled until asked.

## CAMO-E2E-FINISH — UNBLOCKED (low)
Before/after-delta at fixed coords (reuse `largestCluster`). Low; the rule is unit-covered.

## Routed to Designer / flags

- **AXIS-MODIFIERS-CHECK** — **CLOSED** (Designer: "scales, confirmed, no change", `clashes-and-basics`
  §3.4). No longer open.
- **Beam + axisBonus** — compose legally (axis = centre file); allowed, no validator owed (ruled).
- **Chase-preview detour** — deferred; the chase tell is a destination marker, not a drawn route, so
  nothing visibly disagrees. Wire `chaseObstacles` if a drawn chase route is ever added.
- **Decoy as a universal obstacle** — CHASE-COLLIDE is minimal (enemy decoy solid to the chase router
  only; deliberate `movePath` still destroys it). Universal-obstacle reverses R2 — Designer call.
- **Host-only in-lobby map control** — default set-at-creation (MAP/FORMAT room-level). **Public draft
  / counter-pick** — default BLIND-PICK. Both are reversals; flag if wanted.
- **Dash melee-cover** (Designer-deferred). **Thorn's lobbed auto** (5→4 first nerf lever). **Pad
  tuning** (`everyTurns` 4→5 on iron-basin). **Kestrel out of default `CATALOG`** until BASIC-MODES.
- **UI-TIMER hot-seat auto-lock**, **touch input**, **PREVIEW-MODIFIERS shields**, **AIM-SMOOTH**,
  `killerUnitId`/`gameEnd`, **A4**, **spectators**, **`vulnerable`** — unchanged, not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **The networked loop end-to-end** (a real two-machine playtest — worth doing once M3-TIMER lands so
  a stalled seat can't hang the game), **Aegis's beam feel** (a wall, not a fan), **WAYPOINT feel**,
  **CHASE-COLLIDE** (sealed-corridor stops), **melee vs cover**, **Might centre contest**.
