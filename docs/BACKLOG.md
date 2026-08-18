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
- **PR #66:** CHASE-LOS, BLINK-ADJ, CLASH-CONGA, AUTO-PREVIEW, AIM-RANGE-TELL, M3-LOBBY (three halves).
- **PR #68 (this review):** **CHASE-COLLIDE** (chase routes around bodies + enemy decoys, never
  through — fixes the "phasing"; deliberate `movePath` unchanged), **SEAT-ZERO-GUARD** (`wouldSeatNobody`,
  unreachable today but kept for team-choice), **LOBBY-START** (full-room auto-start retired, temp
  start route deleted), **M3-LOBBY-UI** (the pick screen over the socket, `?room=CODE` boot,
  `lobbyReady`-gated start button), **WAYPOINTS** (*shipped but not usable — see WAYPOINTS-FIX*).

Current suite: **1684 tests** (engine 773 + client 732 + server 179), typecheck + build clean.

> **This batch: make WAYPOINTS actually usable, then make the networked match playable.** The lobby
> can pick and start but cannot render a networked board, and rooms can't be created from the UI.

### Build order and dependencies

**WAYPOINTS-FIX → M3-ROOM-CREATE → M3-NET-BOARD.** WAYPOINTS-FIX and M3-ROOM-CREATE are independent
and small-ish; M3-NET-BOARD is the large controller rewrite and can span sessions. **BASIC-BEAM stays
blocked** on a Designer number. Realistic one-session cut: WAYPOINTS-FIX + M3-ROOM-CREATE, then begin
M3-NET-BOARD.

---

## Client — the waypoint fix (do first)

### WAYPOINTS-FIX. Shift-click drops a routed waypoint anywhere, auto-arms move, shows a tell (CLIENT) — UNBLOCKED (first, HIGH)
**Addresses Dev Note: "WAYPOINTS is not working. I cannot hold shift + click to move to a waypoint."**
The shipped `appendWaypoint` accepts only **one adjacent step per click** and **silently refuses**
anything else, and the Shift branch runs **only while move mode is already armed** — so the natural
gesture (select a unit, Shift-click a tile a few squares away) produces nothing, with no feedback.
*AC:*
- *A **Shift-click drops a waypoint at the clicked tile** (need NOT be adjacent); the client **routes
  the segment** from the previous waypoint (or the unit's square) to it with the **remaining** budget,
  obstacle-aware and MOVE-FOG-filtered (reuse `pathTo`/`reachableSquares`), and appends it to
  `draft.movePath`. An adjacent click is a one-step segment (exact tile-by-tile control preserved).*
- *A **Shift-click auto-arms move** when a movable unit is selected and nothing is mid-aim
  (aim/free/catalyst/chase win if armed); the player need not press "Move" first.*
- *The **remaining-movement readout draws down** by each accepted segment's cost; a click that
  **cannot be routed** within the remaining budget shows the **AIM-RANGE-TELL refused-square marker**,
  never nothing; the path is left unchanged on a refusal.*
- *The composed path submits as an ordinary `movePath` the engine accepts; releasing Shift + clicking
  keeps today's direct-line auto-route.*
- *Tests: a Shift-click three tiles away builds a routed three-step path (not a refusal); a Shift-click
  with no prior arm starts a move; the budget readout equals `movementBudget − Σ segment costs`; an
  unroutable Shift-click shows the tell and leaves the path unchanged; adjacent clicks still give exact
  tile-by-tile control. **Drive the real click handler (`onBoardClick`), not only `appendWaypoint`** —
  the shipped bug was in the wiring/gating, which the unit tests missed.*
**Spec Notes.** Files: `packages/client/src/targeting.ts` (`appendWaypoint` → segment-routing variant,
or a new `appendWaypointRouted` that composes `pathTo` per segment; keep `occupied` non-fatal
mid-route), `app.ts` (`onBoardClick:1377-1394` — auto-arm move on Shift-click; call the routed append;
show the tell on refusal), the move preview/readout. **No engine change** (the path is still a
`movePath`, re-validated on resolve). Ruled in edge-cases (WAYPOINTS-FIX — supersedes the adjacent-only
v1). Reuse `movementBudget` + the MET1 cost model; do not re-derive. **Out of scope:** engine changes;
touch input; drawing a *chase* route (`chaseObstacles`, deferred).

## Client — the room-creation entry (unblocks reaching a room)

### M3-ROOM-CREATE. A Create-room button + host map/format at creation (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Continue to build out lobby."** `?room=CODE` boots into a room but nothing in
the UI calls `POST /rooms`, so a player needs a `curl`-made link. *AC: a **Create-room** control
`POST`s `/rooms` with the **host's chosen map + format** (map/format are room-level — RULED), receives
the code, and **redirects to `?room=CODE`** (into the existing lobby boot); the format/map choice is
the host's at creation, not a per-seat picker; a test asserts the button posts the chosen config and
navigates to the returned code.* **Spec Notes.** Files: `packages/client/src/main.ts` (the boot path
beside `joinRoom`), a small create form; `packages/server/src/worker.ts` (`POST /rooms` already mints
the code — confirm it accepts map + format). Ruled in edge-cases (MAP/FORMAT room-level). **Out of
scope:** a host-only in-lobby map control (flag if wanted); matchmaking; the networked board render
(M3-NET-BOARD). **Cross-item:** pairs with M3-NET-BOARD (creating a room is only useful once the match
renders), but ships independently (a created room reaches the pick screen today).

## Client — render the networked match (the large piece)

### M3-NET-BOARD. Render a server-authoritative match on the 3D board (CLIENT) — UNBLOCKED (large; the spine)
**Addresses Dev Note: "Continue to build out lobby" / Builder OQ 2026-09-12 #1.** M3-LOBBY-UI stops at
match start: `app.ts` merges seat orders and calls `resolveTurn` itself (hot-seat), and a networked
start currently shows "not built." *AC: a networked match **renders on the 3D board**: lock-in becomes
a **`submit`** over the socket (not a local `resolveTurn`); the board shows **only this seat's fog**
(server-filtered `visibleSquares`/the `turnResolved` the server sends, not the local `fogView`); the
**hot-seat handover is gone** for a networked match (each client is one seat); the `decision` +
filtered `turnResolved` stream drives the turn loop; the render e2e suite stays green. Tests: a
networked turn round-trips submit → resolve → render for one seat without ever calling `resolveTurn`
locally; the fog shown is the seat's, not the union.* **Spec Notes.** Files: `packages/client/src/app.ts`
(the `resolveAndPlay` controller — split the hot-seat and networked paths; this is the 1750-line
rewrite the Builder flagged), `main.ts` (route a started networked room here). Consume the engine's/
server's derived queries — **never recompute fog or resolution client-side**. Large and explicitly
multi-session; land the submit/stream loop first, then the fog, then retire the handover. **Out of
scope:** reconnect (M3-RECONNECT), server timing (M3-TIMER), spectators. **Cross-item:** M3-ROOM-CREATE
gives it a room to render; WAYPOINTS-FIX is independent (works on the hot-seat board today).

## Server — flagged future (not scheduled)

### LOBBY-TEAM-CHOICE. Let a seat choose its team (SERVER + CLIENT) — UNBLOCKED (future, flag)
The likely next lobby feature; makes `wouldSeatNobody` (kept in PR #68) live. Not scheduled until the
owner asks. *AC (when wanted): a seat may pick its team; the room refuses a choice that would seat a
player with no characters (SEAT-ZERO); team balance is the player's, not `nextTeam`'s.* **Spec Notes.**
Server room record + the lobby screen. Flag only.

## Engine — the unique-basics uplift

### BASIC-MODES. Two aim-time profiles on one ability (ENGINE + CLIENT) — UNBLOCKED (large; returns Kestrel)
*AC: `modes: [AbilityProfile, AbilityProfile]` chosen at aim time; ships with **Kestrel's Twin Bolts**
(wide cone 2 ↔ thin line 6) and **returns Kestrel to the default `CATALOG`**; the client offers the
toggle (AIM2 UI). Tests: each mode resolves its own profile.* **Spec Notes.** The largest BASIC-\* ask;
a separate session from the lobby. Out of scope: other kits.

### BASIC-BEAM. `beamWidth` constant half-width on a cone (ENGINE + data) — BLOCKED on a Designer number
Engine substitution ready; blocked on the Designer stating the field's meaning (`beamWidth: 1` gives a
**3**-wide lane while "Shield Bash as a 1×2 beam" wants width **1**) and Aegis's footprint. Do **not**
guess. **Spec Notes.** `shapes.ts` (`coneSquares`). Out of scope: other kits.

## Engine — flag to the Designer

### AXIS-MODIFIERS-CHECK. Confirm `axisBonus` scales with Might/Weaken/cover (DESIGNER decision)
BASIC-AXIS folded the axis bonus into raw damage (Decision 8), so modifiers scale it. *AC: the Designer
confirms "scales" (no change) or requests "flat" (a one-line follow-up).* Non-blocking.

## M3 — the rest of the roadmap (blocked in sequence)

### M3-TIMER / M3-RECONNECT / M3-DEPLOY — BLOCKED on M3-NET-BOARD
- **M3-TIMER:** the DO enforces `DECISION_SECONDS` (40); missed submission → hold-position; Time Bank
  per-seat (`TIMEBANK_CHARGES = 1`); UI-TIMER on the server clock.
- **M3-RECONNECT:** rejoin by code, reclaim the held seat, re-sync; partial-team disconnect handoff
  (edge-cases OPEN — decide here).
- **M3-DEPLOY:** `wrangler deploy` + Pages; a `wrangler dev`/miniflare smoke check; confirm the `POST
  …/start` route is gone (done in PR #68); **make the Pages deploy gate legible**. **Needs owner infra
  decisions.**

## CAMO-E2E-FINISH — UNBLOCKED (low)
Before/after-delta at fixed coords (reuse `largestCluster`). Low; the rule is unit-covered.

## Routed to Designer / flags

- **BASIC-BEAM number** and **axisBonus scaling** (→ AXIS-MODIFIERS-CHECK) — await Designer decisions.
- **Decoy as a universal obstacle** — the CHASE-COLLIDE line is minimal (enemy decoy solid to the
  chase router only; deliberate `movePath` still destroys it, R2 intact). Making a decoy solid to ALL
  movement reverses R2 — Designer call if wanted.
- **Chase admissibility gate** — ratified range-capped (2026-09-11 #1); sightline-based *targeting*
  would be a separate ENGINE + client vision-widening item.
- **Public draft / counter-pick** — default is BLIND-PICK; a public draft is a design reversal, flag
  if wanted. **Host-only in-lobby map control** — default is set-at-creation; flag if wanted.
- **Dash melee-cover** (Designer-deferred). **Thorn's lobbed auto** (5→4 first nerf lever). **Pad
  tuning** (`everyTurns` 4→5 on iron-basin). **Kestrel out of default `CATALOG`** until BASIC-MODES.
- **UI-TIMER hot-seat auto-lock**, **touch input**, **PREVIEW-MODIFIERS shields**, **AIM-SMOOTH**,
  `killerUnitId`/`gameEnd`, **A4**, **spectators**, **`vulnerable`** — unchanged, not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **WAYPOINTS-FIX feel** (routed waypoints vs exact tile-by-tile — watch the drawn route reads
  clearly), **CHASE-COLLIDE** (chases now stop at sealed corridors — honest, verify the tell),
  **new autos** (Lumen/Thorn/Ravok/Cinder feel), **melee vs cover**, **Might centre contest**,
  **turn-1 spawn margin**, **vision Manhattan diamond**.
