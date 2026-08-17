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

- The full local hot-seat game + AR parity + the screenshot UI batch + M3-ROOM…M3-LOCKLIST.
- **PR #59 (this review):** **NAMEPLATE-LAYOUT** (name left, status row beside it, polarity tint
  from the FF1 table, `+N` overflow), **MOVE-SPRINT-FIRST** (not reproducible — guarded at both
  layers; see CLASH-AR), **RENDER-CHECKS-GREEN** (the red render checks were the tests, not the
  renderer — surfaced the pad-shadow problem, fixed in PR #60).
- **PR #60 (Designer):** **CLASH-AR** ruled (scheduled below); **BASICS-UNIQUE** data — three autos
  redesigned (Lumen damage+heal line, Thorn lobbed circle, Ravok self-circle whirl), the **melee
  pass** (Dagger Flurry, Crushing Slam, Whirling Cleave, Shield Bash, Shockwave — **MELEE-COVER is
  no longer inert**), **Thorn snare `lifetime: 3`**, and the **shadow-row pad moves**; **BODY-CLICK**
  ruled; the **BASIC-\*** engine knobs specced.

Current suite: **1435 tests** (engine 669 + client 642 + server 124), typecheck + build clean.

> **This batch: engine correctness bugs first, then the M3-LOBBY unblocker, then the roster uplift.**
> Two owner-directed engine fixes (REVEAL-FIX, CLASH-AR), a client targeting fix (BODY-CLICK), a
> content guard (SHADOW-ROW-TEST), and CAT-SELECT (the engine ASK that unblocks M3-LOBBY). **Do not
> touch vision** (per-format `visionRange` superseded by ar-parity §3).

### Build order and dependencies

**REVEAL-FIX → CLASH-AR → BODY-CLICK → SHADOW-ROW-TEST → CAT-SELECT** (bugs + the M3 unblocker),
then **BASIC-AXIS → BASIC-BEAM → BASIC-INNER** (small engine knobs, each with its data edit) →
**M3-LOBBY** (large, unblocked by CAT-SELECT) → **BASIC-MODES** + the M3 roadmap. Realistic
one-session cut: the four bug/fix items + CAT-SELECT; the rest carries.

---

## Engine — correctness bugs (do first)

### REVEAL-FIX. Reveal-on-attack fires only when the attacker was concealed (ENGINE) — UNBLOCKED (first, HIGH)
**Addresses Dev Note: "Why are characters being debuffed with 'revealed' when they hit an enemy.
This is incorrect … when a character attacks from an area where enemies lack line of sight or
vision, attack and movement remain completely hidden."** *AC: a unit that deals damage gains
`reveal` **iff it was concealed by brush or Stealth** at the moment of the attack (the
`revealIfConcealed` gate); an attacker on **open ground** gains no `reveal`; an attacker from
**positional fog** (out of range / behind a wall) gains no `reveal` and stays fully hidden; a
**brush/Stealth** attacker is still revealed this turn + next (CAMO-REVEAL, unchanged); `breakStealth`
on taking/dealing damage is unchanged (GAME_SPEC §6). The `attribution.test.ts` case asserting an
open unit gains `reveal` on attack **flips** to assert it does not; a new test asserts a brush
attacker does.*
**Spec Notes.** Files: `packages/engine/src/resolve.ts` — replace the two unconditional `hitEnemy`
reveal blocks (`~:1138-1141` Blast + the dash branch) with
`revealIfConcealed(board, attacker, attackerPos, abilityId, events)` (the helper already exists —
`~:240`). Keep `breakStealth` where it is. **Reverses the 2026-08-31 unconditional-reveal
correction** (owner-directed). Ruled in edge-cases (REVEAL-FIX). **Out of scope:** the `reveal`
status mechanics; `breakStealth`-on-damage; the positional-fog *client* render (already correct —
LAST-KNOWN).

### CLASH-AR. Adopt AR's clash rules: a passer continues, only an ender stops (ENGINE) — UNBLOCKED (IMPORTANT)
**Addresses Dev Note: "the sprint bug happened because of clashing movement patterns which the
designer spec should fix."** *AC: on a same-step collision `stepMovers` stops a unit **only if it
is ending** on the contested square (both enders bounce to their last-held square — the shipped
rule); units **passing through continue**; the **2-cycle direct-swap block is unchanged**; pads —
a **same-step simultaneous entry claims nothing**, and an **ender outranks a passer** (takes the pad
even if the passer crossed at an earlier step); clashes are **per-phase** (Dash movers among
themselves, Move among themselves); displacement (end of Blast) is unchanged. Tests: the three AR
cases verbatim, each with and without a pad on the square; the swap-block regression; a rule-3 case
where the passer crossed earlier and still loses the pad. **Re-verify the MOVE-SPRINT-FIRST report is
gone.***
**Spec Notes.** Files: `packages/engine/src/resolve.ts` (`stepMovers`, `claimsBySquare`),
`movement`/`resolve` tests. Deterministic (integer step clock, fixed order). Ruled in edge-cases
(CLASH-AR — supersedes the PROPOSED CL1). **Out of scope:** the swap block (unchanged); displacement
rules; cross-phase clashes (phases never cross).

## Client — targeting

### BODY-CLICK. Clicking a unit's body selects that unit's square (CLIENT) — UNBLOCKED
**Addresses Dev Note: "BUG: When moving to a location that another character occupies … the
character does not move at all."** `squareFromPoint` raycasts the ground plane only, so a click on a
lifted body resolves to the tile behind it. *AC: `squareFromPoint` raycasts the **unit meshes
first** and prefers a **visible** unit hit over the ground plane — clicking a character selects that
character's square (and, for a chase, that unit); a fogged unit has no mesh to hit (fog leaks
nothing); MOVE1's nearest-legal routing then applies to the (occupied) selected tile so the mover
steps to the closest legal square and **moves**; a client test asserts a click on a unit's body
resolves to its square, and that a move toward an occupied tile yields a non-empty path to the
nearest legal stop.*
**Spec Notes.** Files: `packages/client/src/renderer3d.ts` (`squareFromPoint` — raycast the unit
group before the ground plane), `targeting.ts`/`app.ts` (the chase/move consumers). **Verify MOVE1's
`pathTo` still routes to nearest-legal** for a directly-clicked occupied tile — if it returns `[]`,
that is a separate MOVE1 regression to fix here. Ruled by the Designer (clashes-and-basics §4.3).
Out of scope: touch input; last-known-ghost clicks (no mesh).

### SHADOW-ROW-TEST. Content guard: no pad in the camera's occlusion shadow (ENGINE TEST) — UNBLOCKED
**Addresses Builder OQ 2026-09-08 #1 / Designer §4.2.** The pads were moved off the shadow rows in
data; the guard is owed. *AC: `content.test.ts` fails a map with a pad on a square whose **south
neighbour (y+1) is wall or cover** (the shadow-row rule); both shipped maps pass; the guard sits
next to PADS-SPREAD.*
**Spec Notes.** File: `packages/engine/test/content.test.ts`. Small. Out of scope: the renderer
lever (rejected — a pad drawn over a wall lies about occlusion); pad placement (Designer's).

## Engine — the M3-LOBBY unblocker

### CAT-SELECT. Seed per-unit catalyst triads at match creation (ENGINE ASK) — UNBLOCKED (unblocks M3-LOBBY)
**Addresses Builder OQ 2026-09-08 #4.** The engine seeds every unit `DEFAULT_CATALYSTS` and
`createMatch` takes no catalyst argument, so a lobby's per-character picks have nowhere to land.
*AC: a match-creation path seeds each unit's `catalysts` from a **per-character** triad (an optional
per-unit catalyst map on `createMatch`, or a post-create setup that sets `unit.catalysts` before
turn 1); each triad is validated to **three distinct phases** (one Prep/Dash/Blast); an absent pick
falls back to `DEFAULT_CATALYSTS`; a test seeds a non-default triad and asserts the unit carries it
and the validation rejects a two-Dash triad.*
**Spec Notes.** Files: `packages/engine/src/setup.ts` (`createMatch`/`spawnUnit`), `validate.ts`.
Keep it plain-JSON/deterministic (arrays, not Maps). **This is the prerequisite that lets M3-LOBBY
store the right pick model in `room.ts`** — build it before M3-LOBBY. Ruled in edge-cases (M3-LOBBY
pick model: a seat picks N characters, catalysts per-character, R3 spans the team). Out of scope:
the lobby UI/wire format (M3-LOBBY); character selection (M3-LOBBY).

## Engine — the unique-basics uplift (Designer §3; each ships with its one data edit)

### BASIC-AXIS. `axisBonus` on a cone (ENGINE + data) — UNBLOCKED
*AC: a `cone` may carry `axisBonus: amount`; tiles on the central axis take `amount` extra damage
(the axis is already computed — CONE-B measures perpendicular distance from it); integer, no new
geometry; ships with **Bastion's Crushing Slam** carrying it (+8 proposed). Tests: an axis tile
takes base+bonus, an off-axis tile base.* **Spec Notes.** `shapes.ts`/the damage path; `validate.ts`.
Reuse the CONE-B axis test. Out of scope: other kits.

### BASIC-BEAM. `beamWidth` constant half-width on a cone (ENGINE + data) — UNBLOCKED
*AC: a `cone` may carry `beamWidth: n`; the half-width becomes the constant `n` instead of CONE-B's
`halfWidth(d)=d` ramp (same integer test, one substitution) — a constant-width wedge; ships with
**Aegis's Shield Bash** as a 1×2 beam. Tests: coverage is constant-width, rotation-invariant.*
**Spec Notes.** `shapes.ts` (`coneSquares`). Out of scope: other kits.

### BASIC-INNER. `innerRadius`/`innerAmount` on a circle (ENGINE + data) — UNBLOCKED
*AC: a `circle` may carry `innerRadius`/`innerAmount`; tiles within the inner radius take
`innerAmount`, the ring the base; ships with **Cinder's Ember Bolt** (→ circle r1, 22 centre / 14
ring). Tests: centre vs ring damage.* **Spec Notes.** `shapes.ts`/damage path; squared-distance
integer test. Out of scope: other kits.

### BASIC-MODES. Two aim-time profiles on one ability (ENGINE + CLIENT) — UNBLOCKED (large)
*AC: an ability may carry `modes: [AbilityProfile, AbilityProfile]` chosen at aim time (order
carries the index); ships with **Kestrel's Twin Bolts** (wide cone 2 ↔ thin line 6); the client
offers the toggle (AIM2 UI). Tests: each mode resolves its own profile.* **Spec Notes.** The largest
BASIC-\* ask (real UI work). Build after the smaller knobs. Out of scope: the other kits.

## M3 — the lobby (unblocked once CAT-SELECT lands)

### M3-LOBBY. Map/format/catalyst/character selection + team-seat + R3 + the network client (SERVER + CLIENT) — BLOCKED on CAT-SELECT
*AC: a lobby picks map + format + **each seat's N characters and each character's catalyst triad**
(per the ruled pick model — R3 spans the whole team, catalysts per-character, seeded via
CAT-SELECT); its start button calls `RoomHub.start()` and **deletes the temporary `POST
/rooms/:code/start` route**; the **client consumes a `decision` and a filtered `turnResolved`** over
the socket (proving M3-HIDDEN end-to-end), written against M3-LOCKLIST's shape; supersedes MAPTOGGLE
and M3-START's interim.* **Spec Notes.** The first item to build the **network client** (socket
layer). Large; explicitly multi-session; now unblocked by CAT-SELECT + the pick-model ruling. Out of
scope: reconnect (M3-RECONNECT), server-authoritative timing (M3-TIMER).

## M3 — the rest of the roadmap (blocked in sequence)

### M3-TIMER / M3-RECONNECT / M3-DEPLOY — BLOCKED on M3-LOBBY
- **M3-TIMER:** the DO enforces `DECISION_SECONDS` (40); missed submission → hold-position; Time
  Bank per-seat per window (`TIMEBANK_CHARGES = 1`); UI-TIMER driven by the server clock.
- **M3-RECONNECT:** rejoin by code, reclaim the held seat (M3-JOIN-GUARD reserved it), re-sync to
  current state.
- **M3-DEPLOY:** `wrangler deploy` + Pages; a `wrangler dev`/miniflare smoke check (first real
  runtime); the `POST …/start` route gone or gated. **Needs owner infra decisions — coordinate.**

## CAMO-E2E-FINISH — UNBLOCKED (low)
Before/after-delta at fixed coords (reuse `largestCluster`). Low; the rule is unit-covered.

## Routed to Designer / flags

- **Dash melee-cover** (contact damage in the Dash phase ignoring cover) — deliberately deferred by
  the Designer (§4.1); a playtest question, not folded into the `melee` flag. **Thorn's lobbed auto**
  (range 5, wall-ignoring) — the Designer's playtest flag; range 5→4 is the first nerf lever.
- **Pad tuning** — shipped placement/schedule verified; 4v4 over-dominance lever is `everyTurns` 4→5
  on iron-basin, not moving Might out of the centre. **Pad colours** stay coupled to the render e2e.
- **UI-TIMER hot-seat auto-lock**, **touch input** (UI-INSPECT desktop-only v1), **PREVIEW-MODIFIERS
  shields**, **AIM-SMOOTH table**, `killerUnitId`/`gameEnd`, **A4**, **spectators**, **Lockwood/Helios
  basics** (not adopted), **`vulnerable`** — unchanged, not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **CLASH-AR mobility** (crossing paths now safer — playtest the Might-room liveliness), **new autos**
  (Lumen heal-line, Thorn lob, Ravok whirl — feel + Thorn's blind-corner poke), **melee vs cover**
  now live, **Might centre contest**, **chase prediction tell**, **Fade full-action**, **Kestrel**
  untested via MAPTOGGLE, **turn-1 spawn margin one tile**, **vision Manhattan diamond**.
