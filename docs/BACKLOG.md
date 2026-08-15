# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js; **server may depend on Workers runtime**);
every client/server view consumes `TurnEvent[]` and the engine's derived queries (vision,
reachability) — never recomputes them. **Movement is Manhattan (MET1); aiming is Euclidean
(AIM-METRIC).** **Open/update a PR to `main` every session** (CLAUDE.md).

## ✅ COMPLETE — the local hot-seat game is feature-complete

- Engine core, teams/formats, movement, FF1, AIM2, RND1, A0(+heal), A1–A3, UI1–UI6, D1(+dash),
  MET1(+tp), BRUSH1, TT1, C1, MS1, R1–R7, MOVE1, HITBOX1, VISION1(+opening), MAPTOGGLE,
  CI-decouple, AIM-METRIC, CONE-B, CIRCLE-FIX, DASH-IMPACT, FREE1, CAT1, CAT2, PREP-AOE,
  VALIDATE-KEYS, FREE-UI, DECOY-RENDER, STATUS-AUDIT(+UNTGT1), FOG-ZORDER, DASH-PREVIEW,
  PREVIEW-NUMBERS, CAT-DASH-COST, AIM-RANGE, DASH-CAT-ROUTE, PREVIEW-FOG, TRAP-INDICATOR,
  CAT-COST-LABEL, LOG-STATUS, STEALTH-CONFIRM, STEALTH-DURATION, CAMO-REVEAL, DASH-OCCUPIED,
  LAST-KNOWN.
- **PR #45 (this review):** **TIMER-40**, **CAT-DASH-FULL** (a Dash catalyst is the whole turn),
  **TRAP-LIFETIME** (Overwatch 2, cap 3), **MAP-CAPS** (brush ≤3 / cover ≤4 / wall ≤5),
  **UNTGT-DOC**, **UI-VIEWPORT** (canvas is the app frame, HUD overlays it, ≥44px targets),
  **DOT-HOT** (`damageOverTime`/`healOverTime`, tick before status decrement), **PADS1** (power-up
  pads, first-occupier at end of Move), **Regenergy** (4/4/4 catalyst pool), **CHASE1** (chase
  orders + engine per-team last-known, hidden-info-safe), **SCORE1** (in-match + end-of-match
  readout, folded from the event log).

Current suite: **1030 tests** (engine 603 + client 427), typecheck + build clean, purity green.

> **The single-machine game is done.** This batch is the last client polish (make pads visible;
> close the render-coverage gap), then **M3 begins** — the Cloudflare Worker + Durable Object room
> and the real per-team hidden-information boundary the hot-seat only approximates. M3 is decomposed
> into ordered items below; **M3-ROOM is the first buildable slice.** **DO NOT touch vision** — the
> old DECISIONS audit's per-format `visionRange` is superseded by ar-parity §3 ("vision stands as
> built").

### Build order and dependencies

1. **PADS-INDICATOR** (client, independent) 2. **RENDER-COVERAGE** (client e2e, independent) —
both quick, ship first. Then **M3, strictly ordered:** **M3-ROOM → M3-PROTOCOL → M3-HIDDEN →
M3-LOBBY → M3-TIMER → M3-RECONNECT → M3-DEPLOY.** Each M3 item blocks the next. Take the batch
top-down; the realistic cut for one session is **PADS-INDICATOR + RENDER-COVERAGE + M3-ROOM
(+ M3-PROTOCOL if room allows)**.

---

## Client polish (do first — independent, quick)

### PADS-INDICATOR. Draw power-up pads on the board (CLIENT) — UNBLOCKED (first)
**Addresses Builder OQ 2026-09-02 #4: pads are invisible — a pickup shows only in the combat log.**
*AC: each `MapDef.powerups` pad shows a ground marker, colour-coded by `type` (Health / Might /
Energy); a consumed pad is visually distinct from an armed one and its marker returns when it
respawns (`everyTurns`); the marker is drawn for both teams (a pad is public terrain, not hidden
info); a client test asserts a pad is drawn at its square and reflects taken/respawned state.*
**Spec Notes.** Files: `packages/client/src/renderer3d.ts` (a pad plate — reuse the TRAP-INDICATOR
plate/overlay-band pattern, do not invent a third), `app.ts` (read `map.powerups` + the
`powerupTaken` events / `state.powerups` to know which are consumed). Pure consumer. **Out of
scope:** pad placement/timings (Designer — see below); a pickup animation (SCORE1/A4 territory).

### RENDER-COVERAGE. One multi-turn RENDER-VERIFY drive for the new render styles (CLIENT e2e) — UNBLOCKED
**Addresses the carried coverage gap (chase route, last-known ghost, camo red tile) + the new pad
marker.** *AC: an e2e drives a multi-turn match that exercises a **chase route**, an enemy entering
then leaving vision (a **ghost**), a concealed unit acting (the **red tile**), and a **pad marker**,
and asserts each renders (pixel families, as FOG-ZORDER does).*
**Spec Notes.** Files: `packages/client/e2e/render.spec.ts` + `pixels.ts`. Reuse the existing
composited-pixel harness. **Build after PADS-INDICATOR** so the pad marker exists to assert. Also
fold the carried **`revealedView` rename/comment** (Builder OQ 2026-09-01 #5) here if a client
touch makes it convenient. Out of scope: new engine behaviour.

## M3 — networking + the real hidden-information boundary (the milestone)

ARCHITECTURE §"Match flow from M3" is the source of truth. The engine is already pure and produces
per-team views (`fogView`, `visibleEnemiesForTeam`, per-team combat log); M3 moves the
authority server-side so hidden information is **enforced**, not approximated.

### M3-ROOM. `packages/server` — Worker + Durable Object room skeleton (SERVER) — UNBLOCKED (first M3 slice)
*AC: a new `packages/server` workspace builds a Cloudflare Worker with one Durable Object per room;
"create room" mints a **4-letter code** and spins up the DO; players connect by code over
**WebSocket**; the DO holds a room record (code, format, connected seats) and echoes a join/leave
protocol; 2–8 seat bounds per format (GAME_SPEC §1) are enforced on join; `wrangler.toml` +
`npm run` scripts build and typecheck it; a test (Vitest + `@cloudflare/vitest-pool-workers` or a
DO unit harness) drives create → join → join-past-bound-rejected.*
**Spec Notes.** New workspace `packages/server` (npm workspaces — add to root). **Depends on
`@cards/engine` only** (never on client). Keep the DO a thin room-lifecycle shell this item — **no
game logic yet** (that is M3-PROTOCOL). `wrangler deploy` stays manual/deferred (ARCHITECTURE §110
— the deploy *workflow* is M3-DEPLOY, not now); this item just needs to build + test locally.
Determinism is not a server concern (the engine owns it), but the DO must call the *same*
`resolveTurn` later, so import the engine, don't reimplement. **Out of scope:** order submission,
resolution, per-team filtering (M3-PROTOCOL/M3-HIDDEN), the lobby (M3-LOBBY), deploy (M3-DEPLOY).
**Gotcha:** the sandbox has no Cloudflare account — everything must run under the local Workers test
runtime / miniflare, never a real deploy.

### M3-PROTOCOL. Per-player submission → per-team orders → resolve → broadcast (SERVER) — BLOCKED on M3-ROOM
*AC: the DO owns the **player → character control map** (ARCHITECTURE §45); each seat submits its
character orders; the DO holds them and, when **all seats lock in OR the timer fires**, merges
per-player submissions into the **two per-team order sets**, calls `resolveTurn`, advances the
authoritative `GameState`, and broadcasts the result; a test drives a full 2v2 turn through the DO
and asserts the resolved state matches a direct `resolveTurn` call with the same orders.*
**Spec Notes.** The merge is the room layer's job (the engine takes two `PlayerOrders`). Reuse
`mergeSeatOrders` from the client's hot-seat if it factors cleanly into the engine or a shared util.
**Out of scope:** withholding orders from the opposing team (that is M3-HIDDEN — this item may
broadcast full state to all seats as an interim, clearly marked, so the boundary is one focused
item). Timer is a stub here; real per-player timing is M3-TIMER.

### M3-HIDDEN. The DO reveals nothing to the opposing team until lock-in (SERVER) — BLOCKED on M3-PROTOCOL
*AC: during the Decision phase the DO sends each seat **only its own team's** orders and a
**fog-filtered** view (per-team `visibleEnemiesForTeam`/`visibleSquaresForTeam`); the opposing
team's plans are revealed only after all lock in or the timer fires; teammates see each other's
plans; a test asserts a seat's pre-lock-in payload contains none of the enemy team's orders and no
fogged enemy positions.* **This is the real security boundary CLAUDE.md golden rule #5 names.**
**Spec Notes.** Server-side filtering reuses the engine's vision queries — never a client trust.
Fold in **traps, previews, last-known ghosts and the combat log** per-team (the hot-seat
approximates all of these). **Out of scope:** lobby, timer, reconnect.

### M3-LOBBY. Map/format/catalyst selection + team-seat + duplicate-pick (SERVER + CLIENT) — BLOCKED on M3-HIDDEN
*AC: a lobby picks map + format + each player's **catalyst triad** and **character**, seats players
to teams, and enforces **R3 duplicate-pick** (unique within a team, mirrors across teams legal); the
match starts from the lobby's config; supersedes MAPTOGGLE.* **Spec Notes.** Folds in the deferred
**per-character catalyst selection** and **normal-ability-aimed-from-Shift-landing preview**. R3 is
already ruled (edge-cases) and the engine mints unique ids — this is lobby validation, not engine.

### M3-TIMER. Server-authoritative per-player decision timer + Time Bank (SERVER + CLIENT) — BLOCKED on M3-PROTOCOL
*AC: each player has a `DECISION_SECONDS` (40) deadline the DO enforces; a missed submission
resolves as hold-position (edge-cases OPEN — rule at build); the Time Bank (1 charge, +10 s)
extends only that player's own deadline; the client shows the countdown.*

### M3-RECONNECT. Rejoin by room code + replay to current (SERVER + CLIENT) — BLOCKED on M3-PROTOCOL
*AC: a dropped browser rejoins by room code and the DO replays the match to the current turn
(ARCHITECTURE §77); state is the DO's, so a reconnect is a re-sync, not a re-simulate.*

### M3-DEPLOY. Wrangler deploy workflow + Pages integration (CI) — BLOCKED on M3-HIDDEN
*AC: a `wrangler deploy` path for the Worker/DO (workflow added now per ARCHITECTURE §110) and the
client points at the deployed Worker; the core-CI/Pages gates (CI-decouple) still hold.*
**Spec Notes.** Needs owner infra decisions (account, route) — **coordinate before building.**

## Routed to Designer (data / balance — not Builder build items)

- **Pad placement + timings** (Builder OQ 2026-09-02 #3) — the shipped pads are Builder
  placeholders (`firstTurn: 2, everyTurns: 4`, three mirrored pairs/map). The Designer owns the
  squares/timings; the MAP-CAPS-style mirror guard makes retuning safe. Playtest the centre-line
  contest.

## Flags (optional engine asks — not scheduled)

- **`killerUnitId` on the `death` event** (OQ #7) — only if per-character kills must be authoritative
  (today SCORE1 folds them from the log, engine keeps the per-team tally). Not needed yet.
- **`gameEnd` event carrying the end reason** (OQ #8) — only if `matchResult`'s inference proves
  fragile. Works today.
- **Might/Weaken vs over-time tick** — ruled NOT modified (v1, edge-cases); a two-line change in
  `tickOverTime` if a character is ever designed around a boosted burn.
- **CAT-DASH-FULL vs one-free-action** (OQ #1) — a Dash catalyst is exclusive with a free ability
  today; making it the exception is an owner call, not scheduled.

## Deferred — do NOT schedule

- **A4** per-ability FX — blocked on M3 + roster lock (now approaching — revisit after M3-LOBBY).
- **CL1/CL2/E2**, **flat `energy` effect kind**, **vision metric change**, **tunable cone angle**,
  **optimistic move validation**, **status-pip pixel test**, **`vulnerable` status** (ar-parity
  §1.3 VERIFY — unconfirmed), **Echo Boost / Chronosurge / Critical Shot / Regroup catalysts** —
  not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **Pad centre-line contest** (new — playtest), **DoT/HoT vs Might/Weaken** (ruled off; watch),
  **chase prediction tell** (OQ #5 — stronger if playtest wants it), **8-tile melee cones**,
  **Fade now full-action** (watch it isn't dead), **catalyst hoarding**, **Kestrel** untested via
  MAPTOGGLE, **turn-1 spawn margin one tile**, **vision Manhattan diamond** (owner-approved as-is).
