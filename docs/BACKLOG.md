# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js; **server may depend on the Workers
runtime**); client/server consume `TurnEvent[]` and the engine's derived queries — never recompute
them. **`@cards/server` imports `@cards/engine` only, never the client.** **Movement is Manhattan
(MET1); aiming is Euclidean (AIM-METRIC).** **Open/update a PR to `main` every session** (CLAUDE.md).

## ✅ COMPLETE

- The full local hot-seat game (engine core through SCORE1 — see prior backlogs; AR parity: chase,
  pads, DoT/HoT, scoreboard, viewport, timer, 4/4/4 catalysts, vision/stealth/camo, DASH-OCCUPIED).
- **PR #47 (this review):** **PADS-INDICATOR** (pads drawn, public terrain, taken/respawn state),
  **RENDER-COVERAGE** (multi-turn e2e over chase route / ghost / pad marker), **M3-ROOM**
  (`packages/server`: a Worker + one Durable Object per room, join-by-4-letter-code, seat bounds,
  rules behind a `Sink` seam, injected randomness).

Current suite: **1090 tests** (engine 603 + client 437 + server 50), typecheck + build clean
(run `npm install` after pulling — the server added `@cloudflare/workers-types`), purity green.

> **This batch: three owner Dev Notes + the next M3 slice.** Trap re-tune, decoy previews, and
> smoother aim rotation are quick owner wins; **M3-PROTOCOL** is the milestone item and is now
> unblocked (the control-map and `mergeSeatOrders` rulings are in its Spec Notes). **Do not touch
> vision** (per-format `visionRange` is superseded by ar-parity §3).

### Build order and dependencies

Independent quick wins first, then the server milestone: **TRAP-LIFETIME-TUNE → PREVIEW-DECOY →
AIM-SMOOTH → CAMO-SEED** (all independent), then **M3-PROTOCOL** (blocked only on its own
`mergeSeatOrders`-to-engine refactor, which is step 1 inside it). Realistic one-session cut:
everything except possibly M3-PROTOCOL, which may carry if the merge + submission + broadcast is
larger than it looks.

---

## Owner Dev Notes (quick, independent — do first)

### TRAP-LIFETIME-TUNE. Traps last 3 turns, cap 4 (DATA + CONSTANT) — UNBLOCKED (first)
**Addresses Dev Note: "Trap should last 3 turns, max of 4 turns."** Re-tunes the shipped
TRAP-LIFETIME (Overwatch 2 / cap 3). *AC: Vex Overwatch Trap trap-effect `lifetime: 2 → 3`;
`TRAP_MAX_LIFETIME 3 → 4` (validation now accepts `lifetime: 4`, rejects `5`); an untriggered
Overwatch Trap is gone by `placedTurn + 3`; a `lifetime: 5` trap fails validation, `lifetime: 4`
passes; a trap still triggers within its life.*
**Spec Notes.** Files: `data/characters/vex.json` (Overwatch Trap `lifetime`), the constant
`TRAP_MAX_LIFETIME` (`constants.ts` or wherever validate reads it), and the existing
`trap-lifetime.test.ts` expectations flip (`placedTurn + 2 → +3`; `lifetime: 4` now valid). Owner
ruling, overrides "never rebalance". Ruled in edge-cases (Traps expire → RE-TUNED). Out of scope:
the expiry mechanism (unchanged); any other trap.

### PREVIEW-DECOY. Damage/heal/shield previews show on a decoy (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Decoy should be a real character for all intents and purposes. Meaning
damage, healing, and shielding previews should show on it."** A decoy renders to the enemy as Wisp,
so an aimed ability covering it must show the same preview number a real unit would — the *absence*
of one is a tell that outs the decoy. *AC: an aimed ability whose area covers a decoy floats the
**nominal** effect number over it (red damage / green heal / blue shield), per-viewer (to the enemy
as Wisp, to Wisp's team on the purple decoy) and **fogged** like PREVIEW-FOG (a decoy in the
viewer's fog shows no number); a client test asserts a damage/heal/shield ability aimed over a
visible decoy shows the coloured number and a fogged decoy shows none.*
**Spec Notes.** Files: `packages/client/src/preview-numbers.ts` (add decoys as preview targets —
iterate the fog view's decoys alongside units, each at its `pos` with the ability's nominal
amount), `app.ts`/`fog.ts` (feed the per-viewer, fogged decoy list — `FogView.decoys` already
exists from DECOY-RENDER). **Client-only preview FICTION — the engine is unchanged:** the decoy
still takes no heals/shields and dies to any damage (edge-cases R2); this shows what the action
*would* do to the character the viewer believes is there. Reuse the same vision gate PREVIEW-FOG
uses. Ruled in edge-cases (Decoy → previews). Out of scope: any engine decoy-mechanics change.

### AIM-SMOOTH. Finer aim rotation via a higher `AIM_STEPS` (ENGINE + CLIENT) — UNBLOCKED
**Addresses Dev Note: "Are we able to make the rotations for attacks even more smooth, like 360
degrees of freedom?"** Aiming is already 360°-free at `AIM_STEPS = 256` (≈1.4°/step); the ask is
finer granularity. *AC: `AIM_STEPS` is raised (recommend **512**, or 1024) — any multiple of 4 so
the Manhattan quantization diamond (`AIM_R = AIM_STEPS / 4`) stays exact; **no trig, no floats, no
`Math.sqrt`** enters the engine (the no-trig guard still passes); the client mouse→step map
(`dragToAimStep`) produces the finer steps; the HITBOX1 cross-engine golden signature is
regenerated in the same commit; the rotation-invariance + determinism tests re-run clean at the new
resolution.*
**Spec Notes.** Files: `packages/engine/src/shapes.ts` (`AIM_STEPS`; the diamond math is already
parameterised by it), the HITBOX1 golden-value test (regenerate), `aim`/`rotation-invariance`
tests (re-run, update any hard-coded step counts). Determinism preserved by construction (integer
diamond). **Known deeper cause, flagged NOT required:** equal steps around a diamond are not equal
angles, so rotation can feel subtly uneven even at high step counts — a truly angle-uniform version
needs a **precomputed integer direction table** (built offline, no runtime trig), which is the
follow-up only if the bump alone doesn't satisfy. Start with the bump. Ruled in edge-cases (AIM2 →
AIM-SMOOTH). Out of scope: the direction table (deferred unless the bump is insufficient).

### CAMO-SEED. A dev scenario hook so the camo red tile is e2e-testable (CLIENT) — UNBLOCKED (low)
**Closes Builder OQ 2026-08-16 #1 / the last RENDER-COVERAGE gap.** *AC: a dev-only `?scenario=`
param (MAPTOGGLE family) starts a match with a unit already standing in brush; RENDER-COVERAGE (or
a sibling e2e) uses it to have that unit act and asserts the **camo red tile** composites; the hook
is dev-only and does not affect a normal match.*
**Spec Notes.** Files: `main.ts`/`app.ts` (the scenario param, reusing `createMatch`), the e2e.
Keep it minimal — a named seed, not a scenario DSL. Also a playtest aid. Out of scope: general
scenario scripting.

## M3 — networking + the hidden-information boundary (the milestone)

### M3-PROTOCOL. Per-player submission → per-team orders → resolve → broadcast (SERVER) — UNBLOCKED
*AC: the DO collects each seat's character orders; when **all seats lock in OR the timer fires** it
merges per-player submissions into the **two per-team order sets**, calls `resolveTurn`, advances
the authoritative `GameState`, and broadcasts the result; a test drives a full 2v2 turn through
`hub.ts` (fake sockets) and asserts the resolved state equals a direct `resolveTurn` call with the
same orders.*
**Spec Notes.** Lands in `hub.ts` (it already owns the joined-seat set + broadcast). **Two rulings
that unblock it (review 2026-09-03):**
- **`mergeSeatOrders` moves to the engine FIRST.** It is pure order-shaping and the server can't
  import the client — move it from `packages/client/src/hotseat.ts` to `packages/engine` (e.g.
  `orders.ts`), re-export, update the client import. Do this as step 1; it is a pure refactor with
  its own test (client behaviour unchanged).
- **The control map (`Seat.unitIds`).** The DO owns it (ARCHITECTURE §45). **Interim until
  M3-LOBBY:** assign characters to seats **on match start** with a deterministic deal — reuse the
  client's `dealTeams`/`createMatch` seating so client and server agree. M3-LOBBY replaces the deal
  with player picks later.
- **DO persistence (Builder OQ #5, ruled):** store the **authoritative current `GameState` per
  turn** AND **append each turn's merged orders to a history log** — reconnect re-syncs from current
  state (cheap), the history serves replay (ARCHITECTURE §77). Decide the shape here so
  M3-RECONNECT doesn't need a migration.
**Out of scope:** withholding orders from the opposing team (M3-HIDDEN — interim may broadcast full
state to all seats, clearly marked); real per-player timing (M3-TIMER — a stub trigger here); the
lobby (M3-LOBBY).

### M3-HIDDEN. The DO reveals nothing to the opposing team until lock-in (SERVER) — BLOCKED on M3-PROTOCOL
*AC: during Decision the DO sends each seat only its own team's orders and a **fog-filtered** view
(per-team `visibleEnemiesForTeam`/`visibleSquaresForTeam`); enemy plans revealed only after all
lock in or the timer fires; teammates see each other's plans; a test asserts a pre-lock-in payload
contains no enemy orders and no fogged enemy positions.* **The real golden-rule-#5 security
boundary.** **Spec Notes.** Reuse the engine's vision queries server-side; fold in traps, previews,
last-known ghosts and the combat log per-team. Out of scope: lobby, timer, reconnect.

### M3-LOBBY. Map/format/catalyst/character selection + team-seat + R3 (SERVER + CLIENT) — BLOCKED on M3-HIDDEN
*AC: a lobby picks map + format + each player's catalyst triad + character, seats players, enforces
**R3 duplicate-pick** (unique within a team, mirrors legal); supersedes MAPTOGGLE; replaces
M3-PROTOCOL's interim deal.* Folds in per-character catalyst selection + the Shift-landing preview.

### M3-TIMER. Server-authoritative per-player timer + Time Bank (SERVER + CLIENT) — BLOCKED on M3-PROTOCOL
*AC: the DO enforces each player's `DECISION_SECONDS` (40) deadline; a missed submission resolves as
hold-position (rule the OPEN disconnect case at build); Time Bank (1× +10 s) extends only that
player's deadline; the client shows the countdown.*

### M3-RECONNECT. Rejoin by code + replay to current (SERVER + CLIENT) — BLOCKED on M3-PROTOCOL
*AC: a dropped browser rejoins by room code and the DO re-syncs it to the current turn from stored
state (not a re-simulation).*

### M3-DEPLOY. Wrangler deploy workflow + Pages integration (CI) — BLOCKED on M3-HIDDEN
*AC: a `wrangler deploy` path (workflow added per ARCHITECTURE §110), the client points at the
deployed Worker, core-CI/Pages gates still hold; a `wrangler dev`/miniflare **smoke check** proves
the Worker boots for real (the first real-runtime proof — Builder OQ #6).* **Needs owner infra
decisions (account, route) — coordinate before building.**

## Routed to Designer (data / balance — not Builder build items)

- **Pad placement + timings** — shipped pads are Builder placeholders (`firstTurn: 2, everyTurns:
  4`, three mirrored pairs/map); the Designer owns squares/timings; the mirror guard keeps retuning
  safe. **NEW coupling (Builder OQ 2026-08-16 #3):** pad *colours* are load-bearing for the render
  e2e — retuning pad **squares/timings is safe, but pad COLOURS require moving `isPadTeal` and the
  `isTeamBlue` clamp** in the pixel tests. Squares/timings free; colours are coupled.

## Flags (optional engine asks — not scheduled)

- `killerUnitId` on `death` (per-character kill authority), `gameEnd` event (end-reason), Might/Weaken
  vs over-time tick (ruled off), CAT-DASH-FULL vs one-free-action (owner call) — unchanged, not
  scheduled.

## Deferred — do NOT schedule

- **A4** per-ability FX — blocked on M3 + roster lock (revisit after M3-LOBBY).
- **CL1/CL2/E2**, **flat `energy` effect kind**, **vision metric change**, **tunable cone angle**,
  **optimistic move validation**, **`vulnerable`** (unconfirmed), **Echo Boost / Chronosurge /
  Critical Shot / Regroup catalysts**, **AIM-SMOOTH angle-uniform direction table** (only if the
  `AIM_STEPS` bump is insufficient) — not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **Pad centre-line contest**, **DoT/HoT vs Might/Weaken** (ruled off; watch), **chase prediction
  tell**, **8-tile melee cones**, **Fade now full-action**, **catalyst hoarding**, **Kestrel**
  untested via MAPTOGGLE, **turn-1 spawn margin one tile**, **vision Manhattan diamond**
  (owner-approved), **aim-rotation angular evenness** (AIM-SMOOTH follow-up if the bump falls short).
