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
- **PR #62:** REVEAL-FIX, CLASH-AR, BODY-CLICK, SHADOW-ROW-TEST, CAT-SELECT, BASIC-AXIS.
- **PR #64 (this review):** **CHASE-FOLLOW** (per-step advancing vision — *incomplete, see CHASE-LOS*),
  **CLASH-CORNER** (a wedged passer bounces off; conga residual ruled below), **BASIC-INNER** (Cinder's
  Ember Bolt → circle r1, 22 centre / 14 ring), **BLINK-CLASH** (two blinks one square → *"neither
  lands"; superseded by BLINK-ADJ below*), **AIM-PREVIEW-RANGE** (hover paints only what a click accepts).

Current suite: **1529 tests** (engine 752 + client 653 + server 124), typecheck + build clean.

> **This batch: finish the chase bug, land the blink fix and the auto previews, then START M3-LOBBY.**
> CHASE-FOLLOW shipped but is capped by vision *range* not *line of sight* — CHASE-LOS completes it.
> Then BLINK-ADJ (owner-directed), AUTO-PREVIEW (Dev Note #1), and begin M3-LOBBY (Dev Note #5).

### Build order and dependencies

**CHASE-LOS → BLINK-ADJ → CLASH-CONGA → AUTO-PREVIEW → AIM-RANGE-TELL → M3-LOBBY.** No hard
dependencies between the first five (independent files); M3-LOBBY is large and starts after. Realistic
one-session cut: CHASE-LOS + BLINK-ADJ + AUTO-PREVIEW, then as much of M3-LOBBY as fits. **BASIC-BEAM
stays blocked** on a Designer number.

---

## Engine — correctness bugs (do first)

### CHASE-LOS. A chase is capped by LINE OF SIGHT, not vision range (ENGINE) — UNBLOCKED (first, HIGH)
**Addresses Dev Note: "Chasing is still not working. If a character is one tile away, it will only
chase 1 tile even if the target sprints 8 tiles away. The chase should get the chasing character AS
CLOSE to the target as possible based on remaining movement and assuming they have vision of the
character. If they lose vision of the chase target, it should get the chasing character as close to
the last place the chase target was seen."** CHASE-FOLLOW (PR #64) re-checks sight each step but the
check is `teamCanSee`, whose first gate is `distance > VISION_RANGE → false` (`vision.ts:253`) — so a
target that outruns range 6 is treated as fogged even while the chaser is directly behind it, and the
per-step re-check cannot rescue it. Reproduced: a chaser one tile behind a target that sprints 8 east
moves exactly one tile, `seen:false`. *AC: the chase's visibility predicate keeps **line of sight**
(`hasLineOfSight`, walls) and **concealment** (`isConcealedFrom`, brush/stealth/reveal) but **drops
the range gate** — a chase sees its target whenever an unobstructed, unconcealed sightline exists at
any distance, and pursues the true (snapshot) square, closing by its full movement budget; a target
hidden by a **wall**, **brush**, or **Stealth** is not seen → the chase falls to the last-known square
and stops (unchanged). Everything else in CHASE-FOLLOW stands (per-step re-derivation on the frozen
snapshot; last-known fallback; determinism). Tests: the reported case — chaser one tile behind, target
sprints 8 in the open — ends **adjacent** with `seen:true`; a wall between chaser and a close target
still drops it to last-known; the brush/Stealth fog cases stay green unchanged; a long open-sightline
pursuit closes by its full budget.*
**Spec Notes.** Files: `packages/engine/src/resolve.ts` (`walkChase`/`seenFrom` — replace the
`teamCanSee` call with a range-less predicate that composes `hasLineOfSight` + `!isConcealedFrom`, e.g.
a `teamHasSightline` helper in `vision.ts` that reuses `canSee`'s last two gates without the range
check), `packages/engine/test/chase.test.ts`. **Change ONLY the chase predicate** — `recordLastKnown`,
`canSee`, and normal vision keep the range cap (the team's persistent memory is unchanged). Keep it
integer/plain-JSON, N-unit-safe, fixed order. Ruled in edge-cases (CHASE-LOS — supersedes the range
portion of CHASE-FOLLOW). **Playtest flag (note, not blocking):** a chase can now travel a long open
corridor normal vision would not light — owner-directed; watch the feel. **Out of scope:** last-known
recording; normal vision range; the client chase tell (renders `chaseResolved` unchanged).

### BLINK-ADJ. A blocked/contested blink lands on the nearest legal square, not nowhere (ENGINE) — UNBLOCKED
**Addresses Dev Note: "BLINK-CLASH — should a blocked blink land adjacent instead of not at all?
Blocked blink should land adjacent instead of not at all."** Supersedes PR #64's "neither lands".
*AC: a blink (dash-phase teleport) whose destination is **blocked** (wall/cover/edge), **occupied**
(a resting unit), or **contested** (another simultaneous blink at the same square) lands on the
**nearest legal square to the destination** — the in-bounds, non-blocked, unoccupied square minimising
Manhattan distance, ties broken by the fixed `direction8`/row-major order (deterministic); a blink
onto a resting unit therefore lands adjacent (distance 1); contested blinkers each take their own
nearest square, and if two would pick the same one the **earlier-ordered** unit takes it and the other
falls to its next-nearest — both land, Collisions preserved. A blink lands in Dash (immunity + pad
semantics unchanged). Tests: a blink onto a resting unit lands adjacent; a blink into a wall lands on
the nearest open square; two blinks at one square both land on distinct nearest squares,
deterministically; the former "neither lands" assertion flips.*
**Spec Notes.** Files: `packages/engine/src/resolve.ts` (`contestedBlinks` / the blink-teleport landing
path), `blink-clash.test.ts`. Reuse the existing legal-square/occupancy helpers; the nearest-legal
scan mirrors MOVE1's nearest-legal routing. Deterministic (fixed scan order). Ruled in edge-cases
(BLINK-ADJ). **Out of scope:** non-blink teleports with their own rules (Shift/leap keep their ruled
behaviour unless equally blocked — apply the same nearest-legal landing for consistency and note it);
2-cycle swap logic.

### CLASH-CONGA. The last-resort bounce cancels the move to the phase-start origin (ENGINE) — UNBLOCKED (low)
**Addresses Builder OQ 2026-09-10 #2.** CLASH-CORNER's bounce can still strand a unit when every
square on its path *and* its origin are occupied by other rests (a conga line). *AC: when a bounced
passer has no free fallback, its move is **cancelled** — it returns to its phase-start origin;
origins are pairwise distinct so a full cancel is collision-free; if the cancel still lands on another
unit's rest, that unit's move is cancelled in turn in **fixed unit order**, each cancel reducing the
count of non-cancelled moves so the cascade terminates. A conga regression asserts no two living units
rest on one square.*
**Spec Notes.** File: `packages/engine/src/resolve.ts` (`bounceOffOccupied`). Small; the
STEP-STACK-INVARIANT property is the guard. Ruled in edge-cases (CLASH-CORNER conga residual). Out of
scope: displacing enders; re-ordering the clock.

## Client — the auto-attack previews (Dev Note #1)

### AUTO-PREVIEW. Preview footprints + numeric damage tells for the redesigned autos (CLIENT) — UNBLOCKED
**Addresses Dev Note: "new auto attacks need new visual indicators in preview and numerical
descriptions for the damage differences."** The five reworked basics carry footprints/differentials
the aim preview does not surface. *AC: the aim preview paints each auto's **real footprint** and a
**numeric damage tell** for the difference — Lumen Radiant Lash (heal tiles vs damage tiles: `14 dmg
+ 12 heal`), Thorn Barbed Sling (the lobbed circle), Ravok Whirling Cleave (the self-circle r1),
Bastion Crushing Slam (the axis line marked, `+8` on it), Cinder Ember Bolt (inner core vs ring, `22
/ 14`); the tell reads off the engine's derived shape/effect data, not a client re-computation; a
client test asserts each auto's preview cells + the numeric label.*
**Spec Notes.** Files: `packages/client/src/` aim/preview/targeting + the ability tooltip/description.
Extend AIM-PREVIEW-RANGE's hover; drive footprints from `expandShape`/`axisSquares`/the effect list
(engine-derived — never recompute geometry client-side). Out of scope: rebalancing the numbers
(Designer's); animation.

### AIM-RANGE-TELL. An out-of-range hover says "no" out loud (CLIENT) — UNBLOCKED (low)
**Addresses Builder OQ 2026-09-10 #4.** AIM-PREVIEW-RANGE paints *nothing* out of range, which reads
as silence. *AC: an out-of-range hover shows a greyed/red "cannot go there" marker instead of blank;
in-range unchanged; a client test asserts the marker appears past the range boundary.* **Spec Notes.**
Client aim preview; small; can ride with AUTO-PREVIEW. Out of scope: changing what counts as in-range.

## M3 — the lobby (owner asked to start it this batch — Dev Note #5)

### M3-LOBBY. Map/format/catalyst/character selection + team-seat + R3 + the network client (SERVER + CLIENT) — UNBLOCKED (large)
**Addresses Dev Note: "We want to start the M3-Lobby patch too."** *AC: a lobby picks map + format +
**each seat's N characters and each character's catalyst triad** (per the ruled pick model — R3 spans
the whole team, catalysts per-character, seeded via CAT-SELECT); its start button calls
`RoomHub.start()` and **deletes the temporary `POST /rooms/:code/start` route**; the **client consumes
a `decision` and a filtered `turnResolved`** over the socket (proving M3-HIDDEN end-to-end), written
against M3-LOCKLIST's shape; supersedes MAPTOGGLE and M3-START's interim.* **Spec Notes.** The first
item to build the **network client** (socket layer). Large and explicitly multi-session — the owner
wants it *started*, not necessarily finished this session; land the socket layer + selection data
model first, then wire start. Unblocked by CAT-SELECT + the pick-model ruling. Out of scope: reconnect
(M3-RECONNECT), server-authoritative timing (M3-TIMER).

## Engine — the unique-basics uplift (each ships with its one data edit)

### BASIC-MODES. Two aim-time profiles on one ability (ENGINE + CLIENT) — UNBLOCKED (large; returns Kestrel to the roster)
*AC: an ability may carry `modes: [AbilityProfile, AbilityProfile]` chosen at aim time (order carries
the index); ships with **Kestrel's Twin Bolts** (wide cone 2 ↔ thin line 6) and **returns Kestrel to
the client's default `CATALOG`**; the client offers the toggle (AIM2 UI). Tests: each mode resolves
its own profile.* **Spec Notes.** The largest BASIC-\* ask (real UI work). Build after M3-LOBBY or as
a separate session. Out of scope: other kits.

### BASIC-BEAM. `beamWidth` constant half-width on a cone (ENGINE + data) — BLOCKED on a Designer number
The engine substitution is ready; blocked on the Designer stating the field's meaning (`beamWidth: 1`
gives a **3**-wide lane while "Shield Bash as a 1×2 beam" wants width **1**) and Aegis's intended
footprint. Do **not** guess the number. *AC (once answered): a `cone` may carry `beamWidth: n` giving
a constant-width wedge; ships with Aegis's Shield Bash at the ruled footprint; coverage constant-width,
rotation-invariant.* **Spec Notes.** `shapes.ts` (`coneSquares`). Out of scope: other kits.

## Engine — flag to the Designer

### AXIS-MODIFIERS-CHECK. Confirm `axisBonus` scales with Might/Weaken/cover (DESIGNER decision)
BASIC-AXIS shipped with the axis bonus folded into raw damage (Decision 8), so modifiers scale it. If
the Designer meant "+8 flat, unmodified," that is a separate field on `Hit`. *AC: the Designer confirms
"scales" (no change) or requests "flat" (a one-line Builder follow-up).* Non-blocking.

## M3 — the rest of the roadmap (blocked in sequence)

### M3-TIMER / M3-RECONNECT / M3-DEPLOY — BLOCKED on M3-LOBBY
- **M3-TIMER:** the DO enforces `DECISION_SECONDS` (40); missed submission → hold-position; Time
  Bank per-seat per window (`TIMEBANK_CHARGES = 1`); UI-TIMER driven by the server clock.
- **M3-RECONNECT:** rejoin by code, reclaim the held seat (M3-JOIN-GUARD reserved it), re-sync.
- **M3-DEPLOY:** `wrangler deploy` + Pages; a `wrangler dev`/miniflare smoke check; the `POST …/start`
  route gone or gated; **make the deploy gate legible** (Dev Note #4 — the Pages deploy X was a
  post-merge publish, not a missed merge; surface pass/fail clearly). **Needs owner infra decisions.**

## CAMO-E2E-FINISH — UNBLOCKED (low)
Before/after-delta at fixed coords (reuse `largestCluster`). Low; the rule is unit-covered.

## Routed to Designer / flags

- **BASIC-BEAM number** (OQ #1 prior) and **axisBonus scaling** (→ AXIS-MODIFIERS-CHECK) — await
  Designer decisions.
- **Dash melee-cover** (contact damage in Dash ignoring cover) — Designer-deferred (§4.1). **Thorn's
  lobbed auto** (range 5, wall-ignoring) — Designer playtest flag; range 5→4 is the first nerf lever.
- **Pad tuning** — 4v4 over-dominance lever is `everyTurns` 4→5 on iron-basin. **Pad colours** stay
  coupled to the render e2e.
- **Kestrel out of the default `CATALOG`** — intended until BASIC-MODES lands (its auto is the
  two-mode ability); reachable via MAPTOGGLE meanwhile.
- **PR #59 Pages deploy X** (Dev Note #4) — code is on `main`; the X was a transient post-merge Pages
  publish that self-healed (latest deploy green). No source change; folded into M3-DEPLOY's legibility.
- **UI-TIMER hot-seat auto-lock**, **touch input**, **PREVIEW-MODIFIERS shields**, **AIM-SMOOTH table**,
  `killerUnitId`/`gameEnd`, **A4**, **spectators**, **`vulnerable`** — unchanged, not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **CHASE-LOS feel** (a chase now follows down open corridors past normal vision — watch it isn't too
  strong a tell), **CLASH-AR mobility**, **new autos** (Lumen heal-line, Thorn lob, Ravok whirl, Cinder
  core/ring — feel), **melee vs cover** live, **Might centre contest**, **turn-1 spawn margin one
  tile**, **vision Manhattan diamond**.
