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
- **PR #68:** CHASE-COLLIDE, SEAT-ZERO-GUARD, LOBBY-START, M3-LOBBY-UI, WAYPOINTS (unusable).
- **PR #70 (Designer):** **BASIC-BEAM unblocked** — `beamWidth` = total odd width, Aegis Shield Bash
  `beamWidth: 3` range 2 (scheduled below).
- **PR #71 (this review):** **WAYPOINTS-FIX** (Shift-click drops a routed waypoint, auto-arms move,
  shows a tell — with a browser test proven to fail without the fix), **M3-ROOM-CREATE** (a Create-room
  form that mints a code and follows `?room=CODE`; room record carries `mapId`; unknown map = 400),
  **M3-NET-BOARD** (a server-authoritative match renders on the 3D board; fog is the seat's by
  construction). Also fixed a PR #66 render regression (impact layer deleted) via `impactLayer()`.

Current suite: **1745 tests** (789 + 773 + 183), typecheck + build clean. Engine source untouched.

> **Multiplayer status:** the lobby's core loop is BUILT and playable end-to-end locally — create room
> → share code → both sides pick → start → networked match renders with per-seat fog. What remains is
> turn-loop **polish** (waiting/disconnect UI, a create link), the **server timer**, and **deploy**.

### Build order and dependencies

**M3-WAIT-STATE → M3-CONN-STATE → CREATE-LINK → BASIC-BEAM.** All small and independent; do them in
any order (listed by user-visible value). **M3-TIMER** is blocked on M3-WAIT-STATE; **M3-RECONNECT**
and **M3-DEPLOY** follow. Realistic one-session cut: all four of the top items.

---

## Client — close the networked turn loop

### M3-WAIT-STATE. A locked / waiting-for-opponent state after submit (CLIENT) — UNBLOCKED (first)
**Addresses Builder OQ 2026-09-13 #3.** A networked client that has submitted sits on the last frame
with the HUD **still armed** — nothing says the turn is locked or that anyone is being waited for.
*AC: on a networked submit the client enters a **locked** state — the order HUD **disarms** (no
re-aiming a sent turn) and a **waiting indicator** shows what it is waiting for, driven by the Decision
payload's lock state (own-team **per-seat**, enemy **count-only** — the M3-HIDDEN split, so no new
information crosses); the lock clears when the turn's `turnResolved` arrives and the next collection
opens. A test asserts the HUD disarms on submit and re-arms on resolve, and that no enemy seat id
appears in the waiting view.* **Spec Notes.** Files: `packages/client/src/app.ts` (`endTurn` /
`collectOrders` — the networked branch), the HUD waiting indicator. Client-only; **no protocol change**
(the lock state is already in the Decision payload). Ruled in edge-cases (NET-WAIT-STATE). **This is
the seam M3-TIMER renders onto — build it first.** Out of scope: the server clock (M3-TIMER);
reconnect.

### M3-CONN-STATE. Show a closed/disconnected socket instead of freezing silently (CLIENT) — UNBLOCKED
**Addresses Builder OQ 2026-09-13 #4.** A dropped connection sets `phase: 'closed'` and the board
simply stops responding — indistinguishable from a freeze. *AC: the client **surfaces** a
closed/disconnected state (a banner/overlay — "connection lost" / "reconnecting…") so the stall is
legible; the board's non-response is explained rather than silent; a test asserts the banner shows on
a `closed` phase.* **Spec Notes.** Files: `packages/client/src/app.ts`/`main.ts` (the socket phase
handling). **Client-only, "say it happened" — the actual rejoin/resync is M3-RECONNECT's** (blocked,
below). Ruled in edge-cases (NET-CONN-STATE). Out of scope: reconnect logic; server-side seat hold
(already ruled — the seat is reserved for its occupant).

### CREATE-LINK. A Create-room link from the hot-seat page (CLIENT) — UNBLOCKED (tiny)
**Addresses Builder OQ 2026-09-13 #5.** `?create` exists (M3-ROOM-CREATE) but nothing links to it — a
host has to know to type it. *AC: a visible **Create room / Play online** link on the hot-seat page
navigates to the create form (`?create`); a test asserts the link is present and points at the create
route.* **Spec Notes.** File: `packages/client/index.html` / the boot page. Trivial; closes the
end-to-end loop (hot-seat → create → share code → play). Out of scope: styling polish; matchmaking.

## Engine — the last unblocked roster knob

### BASIC-BEAM. `beamWidth` constant-width lane on a cone (ENGINE + data) — UNBLOCKED (Designer ruled the number)
**Unblocked by PR #70.** *AC: a `cone` may carry `beamWidth: n` — **n is the TOTAL width of the lane
in tiles and must be ODD** (even is a **validation error** — no centre axis); the engine maps it to
`halfWidth = (beamWidth − 1) / 2`, giving a constant-width lane instead of CONE-B's `halfWidth(d)=d`
ramp; ships with **Aegis's Shield Bash carrying `beamWidth: 3`, range 2** (a 3-wide, 2-long lane).
Tests: coverage is constant-width and rotation-invariant; `beamWidth: 2` fails validation; an axis
tile and an edge tile are both covered at range, a tile outside the half-width is not.*
**Spec Notes.** Files: `packages/engine/src/shapes.ts` (`coneSquares` — substitute the constant
half-width when `beamWidth` is present; reuse the existing integer perpendicular-offset test),
`validate.ts` (odd-only check), `data/characters/aegis.json` (`beamWidth: 3`, range 2 on Shield Bash).
Deterministic, integer, no new geometry. Designer ruling: `docs/design/clashes-and-basics.md` §3.4.
Out of scope: other kits; BASIC-MODES (Kestrel).

## M3 — the rest of the roadmap (blocked in sequence)

### M3-TIMER — BLOCKED on M3-WAIT-STATE
The DO enforces `DECISION_SECONDS` (40); missed submission → hold-position; Time Bank per-seat
(`TIMEBANK_CHARGES = 1`); UI-TIMER driven by the server clock, rendered onto M3-WAIT-STATE's waiting
indicator.

### M3-RECONNECT — BLOCKED on M3-CONN-STATE
Rejoin by code, reclaim the held seat (the room reserves it — ruled), re-sync to current state;
partial-team disconnect control-handoff (edge-cases OPEN — decide here). The rejoin logic behind
M3-CONN-STATE's banner.

### M3-DEPLOY — BLOCKED (needs owner infra decisions)
`wrangler deploy` + Pages; a `wrangler dev`/miniflare smoke check (first real runtime); confirm the
`POST …/start` route is gone (done PR #68); make the Pages deploy gate legible. **The real-world gate
for internet multiplayer — needs a Cloudflare account + owner go-ahead. Flag when reached.**

## Engine — the unique-basics uplift (after the lobby)

### BASIC-MODES. Two aim-time profiles on one ability (ENGINE + CLIENT) — UNBLOCKED (large; returns Kestrel)
*AC: `modes: [AbilityProfile, AbilityProfile]` chosen at aim time; ships with **Kestrel's Twin Bolts**
(wide cone 2 ↔ thin line 6) and **returns Kestrel to the default `CATALOG`**; the client offers the
toggle (AIM2 UI). Tests: each mode resolves its own profile.* **Spec Notes.** The largest BASIC-\* ask;
its own session. Out of scope: other kits.

## LOBBY-TEAM-CHOICE — UNBLOCKED (future, flag)
Let a seat choose its team; makes `wouldSeatNobody` (kept in PR #68) live. Not scheduled until asked.

## Engine — flag to the Designer

### AXIS-MODIFIERS-CHECK. Confirm `axisBonus` scales with Might/Weaken/cover (DESIGNER decision)
BASIC-AXIS folded the axis bonus into raw damage (Decision 8). *AC: the Designer confirms "scales" or
requests "flat" (a one-line follow-up).* Non-blocking.

## CAMO-E2E-FINISH — UNBLOCKED (low)
Before/after-delta at fixed coords (reuse `largestCluster`). Low; the rule is unit-covered.

## Routed to Designer / flags

- **axisBonus scaling** (→ AXIS-MODIFIERS-CHECK) — awaits a Designer decision.
- **Chase-preview detour** (OQ 2026-09-13 #6) — deferred; the chase tell is a destination marker, not
  a drawn route, so nothing visibly disagrees. Wire `chaseObstacles` if a drawn chase route is ever
  added. Not scheduled.
- **Decoy as a universal obstacle** — CHASE-COLLIDE is minimal (enemy decoy solid to the chase router
  only; deliberate `movePath` still destroys it, R2 intact). Universal-obstacle reverses R2 — Designer
  call if wanted.
- **Host-only in-lobby map control** — default is set-at-creation (MAP/FORMAT room-level, ruled); flag
  if wanted. **Public draft / counter-pick** — default is BLIND-PICK; a public draft is a reversal.
- **Render e2e coverage** — the PR #66 impact-layer regression (fixed here) shows pixel e2es should
  assert *presence* of discs/markers, not just absence of crashes, when a new render layer lands.
- **Dash melee-cover** (Designer-deferred). **Thorn's lobbed auto** (5→4 first nerf lever). **Pad
  tuning** (`everyTurns` 4→5 on iron-basin). **Kestrel out of default `CATALOG`** until BASIC-MODES.
- **UI-TIMER hot-seat auto-lock**, **touch input**, **PREVIEW-MODIFIERS shields**, **AIM-SMOOTH**,
  `killerUnitId`/`gameEnd`, **A4**, **spectators**, **`vulnerable`** — unchanged, not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **The networked loop end-to-end** (create → pick → start → play — worth a real two-machine playtest
  once M3-WAIT-STATE lands), **WAYPOINTS-FIX feel**, **CHASE-COLLIDE** (sealed-corridor stops),
  **new autos**, **melee vs cover**, **Might centre contest**, **turn-1 spawn margin**.
