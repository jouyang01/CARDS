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

- The full local hot-seat game (engine core through SCORE1; AR parity; vision/stealth/camo;
  DASH-OCCUPIED; PADS-INDICATOR/RENDER-COVERAGE).
- **M3-ROOM** (PR #47): `packages/server` — a Worker + one Durable Object per room, join-by-code,
  seat bounds, rules behind a `Sink` seam.
- **PR #49 (this review):** **TRAP-LIFETIME-TUNE** (Overwatch 3, cap 4), **PREVIEW-DECOY** (a decoy
  previews like the character it impersonates — client fiction), **AIM-SMOOTH** (`AIM_STEPS 256 →
  512`, tests parameterised on the constant, reach rule made exact), **CAMO-SEED** (a `?scenario=`
  dev hook; the e2e was cut as untestable-by-pixel-count — see CAMO-E2E-FINISH), **M3-PROTOCOL**
  (`mergeSeatOrders`/`deriveSeats` → `packages/engine/src/orders.ts`; the DO merges per-seat →
  two `PlayerOrders` → `resolveTurn` → broadcast; persistence = state per turn + order history).

Current suite: **1136 tests** (engine 612 + client 449 + server 75), typecheck + build clean
(run `npm install` after pulling), purity green.

> **M3 continues, SECURITY FIRST.** The networked build currently broadcasts full state to every
> seat (the M3-PROTOCOL interim), so it leaks strictly more than the hot-seat until **M3-HIDDEN**
> lands — that is the top item and **nothing deploys (M3-DEPLOY) before it.** Two small M3 enablers
> and one render-coverage gap round out the batch. **Do not touch vision** (per-format `visionRange`
> is superseded by ar-parity §3).

### Build order and dependencies

**M3-HIDDEN** (the priority) → **M3-JOIN-GUARD** (small, independent) → **M3-START** (small,
independent) → **CAMO-E2E-FINISH** (small, low). All four are unblocked; M3-HIDDEN is the substance.
Then the roadmap: **M3-LOBBY → M3-TIMER → M3-RECONNECT → M3-DEPLOY.**

---

## M3 — the hidden-information boundary (top priority)

### M3-HIDDEN. The DO sends each seat only what its team may see (SERVER) — UNBLOCKED (first)
**The real golden-rule-#5 security boundary.** Today `turnResolved` broadcasts full state to all
seats. *AC: during the **Decision phase** the DO sends each seat **only its own team's** orders and
a **fog-filtered view** (per-team `visibleEnemiesForTeam`/`visibleSquaresForTeam` — hidden enemies
absent, fogged squares dark); the opposing team's orders/plans are revealed **only after all seats
lock in or the timer fires**; **teammates see each other's plans** (hidden info is team-vs-team,
never within a team); the **resolution/playback** broadcast then reveals what happened (acting
reveals, per the existing rules); a server test asserts a pre-lock-in payload to a team-0 seat
contains **no team-1 orders and no fogged team-1 positions**, and that post-lock-in reveals them.*
**Spec Notes.** Files: `packages/server/src/hub.ts` (the broadcast — replace the full-state send
with a **per-seat, per-team filtered** payload), reusing the engine's vision queries **server-side**
(never trust a client to filter). Fold in the per-team treatment the hot-seat approximates:
**traps, previews, last-known ghosts, decoys, and the combat log** all filtered per team. The
Decision-phase payload must carry teammates' submitted orders but withhold the enemy team's until
the reveal. **Determinism is the engine's, not the server's** — the DO filters *views*, it does not
re-simulate. **Required tests beyond AC:** a stealthed/brush-hidden enemy is absent from the
Decision payload; a teammate's order IS present; the reveal payload after lock-in contains the enemy
orders. **Out of scope:** the lobby (M3-LOBBY), per-player timing (M3-TIMER — a stub trigger is
fine), reconnect (M3-RECONNECT). Ruled: hidden info is team-vs-team (edge-cases, Teams & control).

## M3 — small enablers (independent, quick)

### M3-JOIN-GUARD. A started room refuses fresh joins (SERVER) — UNBLOCKED
**Addresses Builder OQ 2026-08-16 #4.** A post-start joiner gets an empty control map and still
counts toward the lock total, so the turn can never complete. *AC: a `join` to a **started** room is
**refused** (a clear error, not a silent drop); the lock total counts only seated-and-controlling
players; a freed seat (from a disconnect) is **held for its original occupant to reclaim via
M3-RECONNECT**, never handed to a new socket; a server test drives join-after-start → refused, and
that the lock total is unaffected by a refused socket.*
**Spec Notes.** Files: `packages/server/src/room.ts` (the `join` path — a `started` guard). This is
the guard half; the **reclaim** half is M3-RECONNECT (identity-matched re-attach). Spectators are
out of scope v1 (recorded in edge-cases as the future option). Ruled in edge-cases (started room
refuses joins). Out of scope: reconnect itself.

### M3-START. A "start now" message for short rooms (SERVER + minimal CLIENT) — UNBLOCKED
**Addresses Builder OQ 2026-08-16 #3.** The auto-start trigger is a **full** room (correct), so a
deliberately short 2-player 2v2 can't start over the network. `RoomHub.start()` is already public.
*AC: a **"start" protocol message** invokes `RoomHub.start()` for a room that has at least the
format's minimum players; a match started this way seats present players and deals characters
deterministically (the M3-PROTOCOL interim deal); a server test drives a 2-player 2v2 → start
message → match begins; a minimal client control (or dev affordance) sends it.*
**Spec Notes.** Files: `packages/server/src/hub.ts` (handle the `start` message), a minimal client
send. This exists so **M3-HIDDEN is exercisable on a 2-player room** before M3-LOBBY. M3-LOBBY's
start button will call the same path. Ruled in edge-cases (start escape hatch). Out of scope: the
full lobby / character selection (M3-LOBBY).

## Render coverage (small, low)

### CAMO-E2E-FINISH. Make the camo red tile composited-testable (CLIENT e2e) — UNBLOCKED (low)
**Addresses Builder OQ 2026-08-16 #1.** The CAMO-SEED e2e was cut because `isCamoRed` can't separate
a lit thicket (~`158,45,37`) from a shaded red unit (~`179,78,70`) by pixel-counting. *AC: the
`?scenario=in-brush` seed **reports the squares it placed** (echo into the setup title attribute or
a dev-only `window` global); the e2e drives the seeded unit to act and asserts the **camo red tile**
via `pixelAt` on the known camo square (not a frame-wide count); the hook stays dev-only.*
**Spec Notes.** Files: `main.ts`/`app.ts` (the seed reports positions), `e2e/render.spec.ts` +
`pixels.ts` (`pixelAt` the reported square). Small. The *rule* is already unit-covered
(`camo-reveal.test.ts`); this proves the *compositing*. **Alternative accepted:** if reporting the
squares is more than trivial, close this as unit-covered-only — the Builder's call, stated in the
commit. Out of scope: general scenario scripting.

## M3 — the rest of the roadmap (blocked in sequence)

### M3-LOBBY. Map/format/catalyst/character selection + team-seat + R3 (SERVER + CLIENT) — BLOCKED on M3-HIDDEN
*AC: a lobby picks map + format + each player's catalyst triad + character, seats players, enforces
**R3 duplicate-pick** (unique within a team, mirrors legal), and its start button calls
`RoomHub.start()`; supersedes MAPTOGGLE and M3-START's interim; replaces M3-PROTOCOL's deterministic
deal with player picks.* Folds in per-character catalyst selection + the Shift-landing preview.

### M3-TIMER. Server-authoritative per-player timer + Time Bank (SERVER + CLIENT) — BLOCKED on M3-HIDDEN
*AC: the DO enforces each player's `DECISION_SECONDS` (40) deadline; a missed submission resolves as
**hold-position** (settle the OPEN partial-disconnect ruling at build — current lean: hold, then a
teammate gains the abandoned characters after one fully missed turn); Time Bank (1× +10 s) extends
only that player's deadline; the client shows the countdown.*

### M3-RECONNECT. Rejoin by code + reclaim a held seat + replay to current (SERVER + CLIENT) — BLOCKED on M3-JOIN-GUARD
*AC: a dropped browser rejoins by room code, **reclaims its original seat** (identity-matched — the
seat M3-JOIN-GUARD reserved) with its control map intact, and the DO re-syncs it to the current turn
from stored state (not a re-simulation).*

### M3-DEPLOY. Wrangler deploy workflow + Pages integration + first real-runtime smoke (CI) — BLOCKED on M3-HIDDEN
*AC: a `wrangler deploy` path (workflow per ARCHITECTURE §110); the client points at the deployed
Worker; core-CI/Pages gates still hold; a `wrangler dev`/miniflare **smoke check** proves the Worker
boots for real (the first real-runtime proof — Builder OQ #6).* **BLOCKED on M3-HIDDEN — do not
deploy a build that broadcasts full state.** **Needs owner infra decisions (account, route) —
coordinate before building.**

## Routed to Designer (data / balance — not Builder build items)

- **Pad placement + timings** — Builder placeholders (`firstTurn: 2, everyTurns: 4`, mirrored
  pairs); Designer owns squares/timings (mirror guard keeps retuning safe). **Pad COLOURS are
  coupled to the render e2e** (`isPadTeal`/`isTeamBlue` clamp) — squares/timings free to retune,
  colours are not without moving those predicates.

## Flags (optional / playtest-gated — not scheduled)

- **AIM-SMOOTH angle-uniform direction table** (Builder OQ #2) — `AIM_STEPS = 512` shipped; the
  diamond≠angle unevenness is subtle. Precomputed integer direction table is the fix **only if the
  owner still feels it in playtest** — a playtest question, not scheduled.
- `killerUnitId` on `death`, `gameEnd` event, Might/Weaken vs over-time tick (ruled off),
  CAT-DASH-FULL vs one-free-action — unchanged, not scheduled.

## Deferred — do NOT schedule

- **A4** per-ability FX — blocked on M3 + roster lock (revisit after M3-LOBBY).
- **Spectators** (watchers on a started room) — future option, out of scope v1 (edge-cases).
- **CL1/CL2/E2**, **flat `energy` effect kind**, **vision metric change**, **tunable cone angle**,
  **optimistic move validation**, **`vulnerable`**, **Echo Boost / Chronosurge / Critical Shot /
  Regroup catalysts** — not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **Aim-rotation angular evenness** (AIM-SMOOTH follow-up if 512 falls short — get owner feel first).
- **Pad centre-line contest**, **DoT/HoT vs Might/Weaken** (ruled off; watch), **chase prediction
  tell**, **8-tile melee cones**, **Fade now full-action**, **catalyst hoarding**, **Kestrel**
  untested via MAPTOGGLE, **turn-1 spawn margin one tile**, **vision Manhattan diamond**
  (owner-approved).
