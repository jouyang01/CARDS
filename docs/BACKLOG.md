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
- **PR #64:** CHASE-FOLLOW, CLASH-CORNER, BASIC-INNER, BLINK-CLASH, AIM-PREVIEW-RANGE.
- **PR #66 (this review):** **CHASE-LOS** (chase sees by line of sight, not vision range — reported
  bug verified fixed), **BLINK-ADJ** (blocked/contested blink lands nearest-legal), **CLASH-CONGA**
  (nowhere to bounce → cancel to origin), **AUTO-PREVIEW** (reworked autos show footprint + numbers),
  **AIM-RANGE-TELL** (refused square marked), **M3-LOBBY** three halves — **server** (pick model in
  the room record), **protocol** (blind-across-teams picks over the socket), **client** (the network
  client as a pure reducer).

Current suite: **1618 tests** (engine 762 + client 687 + server 169), typecheck + build clean.

> **This batch: finish the lobby (the pick SCREEN), add manual move waypoints, and the small guards.**
> M3-LOBBY-UI is the spine — the pick screen over `RoomClient`, wiring `app.ts` to the socket,
> retiring the full-room auto-start, and deleting the temporary start route. Then WAYPOINTS (Dev Note
> #1) and SEAT-ZERO-GUARD.

### Build order and dependencies

**M3-LOBBY-UI → WAYPOINTS → SEAT-ZERO-GUARD.** M3-LOBBY-UI is large (likely a full session);
WAYPOINTS and SEAT-ZERO-GUARD are independent and can land in either order after (or before, if the
Builder wants a warm-up). **BASIC-BEAM stays blocked** on a Designer number.

---

## M3 — the lobby screen (owner: "continue building out the lobby" — Dev Note #2)

### M3-LOBBY-UI. The pick screen + socket wiring + start button (SERVER + CLIENT) — UNBLOCKED (large; the spine)
**Addresses Dev Note: "Continue building out the lobby."** The data model, protocol, and network
client (`RoomClient`) all landed in PR #66; what remains is the client UI and the start-trigger
cutover. *AC:*
- *A **lobby screen** renders over `RoomClient`: each seat picks **map + format**, then its **N
  characters** and **each character's catalyst triad** (per the ruled pick model — a seat picks N,
  catalysts per-character, R3 unique across the whole team); the screen shows **own-team picks in
  full** and the **enemy only as a finished-seat count** (BLIND-PICK).*
- *`app.ts` is wired to the socket: it consumes the per-seat **`lobby`** message and the **`decision`
  + filtered `turnResolved`** stream (proving M3-HIDDEN end-to-end from the real client).*
- *A **start button** calls `RoomHub.start()`, **gated on `lobbyReady`** (every seat's picks
  complete, ⌈N/2⌉-seat coverage); the **full-room auto-start is retired** for lobby rooms (a full
  room mid-pick does not start itself); the temporary **`POST /rooms/:code/start` route is deleted**
  in this same slice (so a networked match always has a reachable start — never before).*
- *Tests: the pick screen composes a valid per-seat pick set the server accepts; an enemy seat shows
  as a count, never character ids (BLIND-PICK); start is refused until `lobbyReady`; a full un-picked
  room does not auto-start; an end-to-end path picks → starts → resolves one turn over the socket.*
**Spec Notes.** Files: `packages/client/src/` (a new lobby view + `app.ts` socket wiring, over the
existing `RoomClient` reducer), `packages/server/src/` (`hub.ts` `#startIfReady` — retire the
full-room trigger for lobby rooms, keep it for short/legacy; `worker.ts` — delete the `POST …/start`
route). Reuse `lobbyReady`/`teamCovered` (Decision 7) and the `LobbyView` split already shipped —
**do not recompute** the pick/coverage logic client-side; render what the protocol sends. Ruled in
edge-cases (LOBBY-START, BLIND-PICK, and the route-deletion ruling). **Out of scope:** reconnect
(M3-RECONNECT), server-authoritative timing (M3-TIMER), spectators. **Cross-item:** SEAT-ZERO-GUARD
(below) closes the empty-seat corner this screen would otherwise surface — land it in the same
session if time allows, but it is independent.

## Client — manual move waypoints (Dev Note #1)

### WAYPOINTS. Shift-click a tile-by-tile move path with a live budget readout (CLIENT) — UNBLOCKED
**Addresses Dev Note: "You should be able to manually set different waypoints to move your unit around
an enemy, a trap, or any obstacle … Hold down the Shift key while executing a movement command on each
tile you want to step on sequentially … Every time you click on a tile, your effective movement range
should change (decrease typically), as you move on sequential tiles."** **The engine already accepts
this** — `validateMovePath` walks an arbitrary ordered step list and `runMove` walks a given
`movePath` verbatim, so this is a pure client input mode. *AC: while **Shift** is held, each click
**appends the clicked tile as the next step** of `draft.movePath`; a tile that is not a legal step
from the previous one (not adjacent, a wall, a diagonal-corner cut, or over the remaining budget) is
**refused/marked**, exactly as the engine would reject it; the displayed **remaining movement
decrements by that step's cost** (1 orthogonal, 2 diagonal) on each accepted click; releasing Shift
and clicking normally keeps today's forgiving direct-line route (`pathTo`); the composed path submits
as the ordinary `movePath`. Tests: a Shift-click sequence builds the exact tile list; an illegal next
tile is refused and the budget is unchanged; the running readout equals `movementBudget − Σ step
costs`; a diagonal leg costs 2; the engine accepts the submitted hand-built path.*
**Spec Notes.** Files: `packages/client/src/` (`targeting.ts` — a waypoint-append path builder beside
`pathTo`; `order-mode.ts`/`intent.ts`/`app.ts` — the Shift-held click handler and the budget readout;
the move preview render). **No engine change** (already validated). Reuse `validateMovePath`'s cost
model (MET1: 1/2) and `movementBudget` for the readout — do not re-derive. **MOVE-FOG still holds:** a
waypoint must not treat a **fogged** enemy's tile as an obstacle at plan time (the invisible-enemy
leak stays closed). Ruled in edge-cases (WAYPOINTS). **Out of scope:** any engine change;
auto-connecting non-adjacent waypoints (v1 is one adjacent step per click — a non-adjacent click is
refused, keeping "tile-by-tile" literal); touch input.

## Server — the empty-seat guard

### SEAT-ZERO-GUARD. Refuse a join that would create a zero-character seat (SERVER, small) — UNBLOCKED (low)
**Addresses Builder OQ 2026-09-11 #6.** `deriveSeats` can hand a second player on a one-character
team an empty list (`?? []`) — reachable only in 1v1, a pick screen that asks for nothing. *AC: the
room refuses a join that would create a seat owed **zero** characters (at most one player per
character on a team); the socket is told the team is full; a test asserts the second join to a
one-character team in 1v1 is refused, and a normal 2v2 fourth join still succeeds.*
**Spec Notes.** File: `packages/server/src/room.ts` (the `join` guard, beside the started-room
refusal). Deterministic; N-safe (derive from `deriveSeats`, do not special-case 1v1 by number). Ruled
in edge-cases (SEAT-ZERO). **Out of scope:** spectators (post-v1); reconnect.

## Engine — the unique-basics uplift (each ships with its one data edit)

### BASIC-MODES. Two aim-time profiles on one ability (ENGINE + CLIENT) — UNBLOCKED (large; returns Kestrel to the roster)
*AC: an ability may carry `modes: [AbilityProfile, AbilityProfile]` chosen at aim time (order carries
the index); ships with **Kestrel's Twin Bolts** (wide cone 2 ↔ thin line 6) and **returns Kestrel to
the client's default `CATALOG`**; the client offers the toggle (AIM2 UI). Tests: each mode resolves
its own profile.* **Spec Notes.** The largest BASIC-\* ask (real UI work). A separate session from the
lobby. Out of scope: other kits.

### BASIC-BEAM. `beamWidth` constant half-width on a cone (ENGINE + data) — BLOCKED on a Designer number
The engine substitution is ready; blocked on the Designer stating the field's meaning (`beamWidth: 1`
gives a **3**-wide lane while "Shield Bash as a 1×2 beam" wants width **1**) and Aegis's footprint. Do
**not** guess. *AC (once answered): a `cone` may carry `beamWidth: n` giving a constant-width wedge;
ships with Aegis's Shield Bash at the ruled footprint; coverage constant-width, rotation-invariant.*
**Spec Notes.** `shapes.ts` (`coneSquares`). Out of scope: other kits.

## Engine — flag to the Designer

### AXIS-MODIFIERS-CHECK. Confirm `axisBonus` scales with Might/Weaken/cover (DESIGNER decision)
BASIC-AXIS folded the axis bonus into raw damage (Decision 8), so modifiers scale it. If the Designer
meant "+8 flat, unmodified," that is a separate field on `Hit`. *AC: the Designer confirms "scales"
(no change) or requests "flat" (a one-line Builder follow-up).* Non-blocking.

## M3 — the rest of the roadmap (blocked in sequence)

### M3-TIMER / M3-RECONNECT / M3-DEPLOY — BLOCKED on M3-LOBBY-UI
- **M3-TIMER:** the DO enforces `DECISION_SECONDS` (40); missed submission → hold-position; Time
  Bank per-seat per window (`TIMEBANK_CHARGES = 1`); UI-TIMER driven by the server clock.
- **M3-RECONNECT:** rejoin by code, reclaim the held seat (M3-JOIN-GUARD reserved it), re-sync;
  partial-team disconnect control-handoff (edge-cases OPEN — decide here).
- **M3-DEPLOY:** `wrangler deploy` + Pages; a `wrangler dev`/miniflare smoke check; confirm the `POST
  …/start` route is gone (deleted in M3-LOBBY-UI); **make the Pages deploy gate legible** (the
  post-merge publish X is not a missed merge — surface pass/fail clearly). **Needs owner infra
  decisions.**

## CAMO-E2E-FINISH — UNBLOCKED (low)
Before/after-delta at fixed coords (reuse `largestCluster`). Low; the rule is unit-covered.

## Routed to Designer / flags

- **BASIC-BEAM number** and **axisBonus scaling** (→ AXIS-MODIFIERS-CHECK) — await Designer decisions.
- **Chase admissibility gate** — **ratified range-capped** (OQ 2026-09-11 #1); if the owner later
  wants sightline-based *targeting* (order a chase on anything down a clear lane), that is a new
  ENGINE + client vision-widening item, not a bug.
- **Public draft / counter-pick** — the default is BLIND-PICK (blind across teams); a public draft
  phase would be a deliberate design reversal, flag if wanted.
- **Dash melee-cover** (Designer-deferred, §4.1). **Thorn's lobbed auto** (range 5, wall-ignoring) —
  playtest flag; 5→4 is the first nerf lever. **Pad tuning** — 4v4 lever is `everyTurns` 4→5 on
  iron-basin. **Kestrel out of the default `CATALOG`** — intended until BASIC-MODES.
- **UI-TIMER hot-seat auto-lock**, **touch input**, **PREVIEW-MODIFIERS shields**, **AIM-SMOOTH**,
  `killerUnitId`/`gameEnd`, **A4**, **spectators**, **`vulnerable`** — unchanged, not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **CHASE-LOS feel** (a chase now follows down open corridors past normal vision — watch the tell),
  **BLINK-ADJ** landings, **new autos** (Lumen heal-line, Thorn lob, Ravok whirl, Cinder core/ring),
  **melee vs cover**, **Might centre contest**, **turn-1 spawn margin**, **vision Manhattan diamond**.
