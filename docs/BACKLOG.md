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
- **PR #60 (Designer):** **BASICS-UNIQUE** data — three autos redesigned (Lumen damage+heal line,
  Thorn lobbed circle, Ravok self-circle whirl), the **melee pass** (Dagger Flurry, Crushing Slam,
  Whirling Cleave, Shield Bash, Shockwave), **Thorn snare `lifetime: 3`**, the **shadow-row pad
  moves**; **CLASH-AR** and **BODY-CLICK** ruled; the **BASIC-\*** engine knobs specced.
- **PR #62 (this review):** **REVEAL-FIX** (reveal-on-attack gated on concealment — open/positional-fog
  attacker no longer flagged), **CLASH-AR** (a passer continues, only an ender stops; the two pad
  amendments), **BODY-CLICK** (raycast unit meshes first; move-onto-occupied routes to nearest legal),
  **SHADOW-ROW-TEST** (content guard), **CAT-SELECT** (per-unit catalyst triads seeded at match
  creation — unblocks M3-LOBBY), **BASIC-AXIS** (`axisBonus` on a cone; Bastion's Crushing Slam +8).

Current suite: **1498 tests** (engine 725 + client 649 + server 124), typecheck + build clean.

> **This batch: the repeated chase bug first, then the CLASH-AR corner, then the roster uplift and
> M3-LOBBY.** One owner-directed engine fix (CHASE-FOLLOW), one small engine ruling from a Builder OQ
> (CLASH-CORNER), then the remaining unique-basics knobs and the lobby. **Do not touch vision**
> (per-format `visionRange` superseded by ar-parity §3).

### Build order and dependencies

**CHASE-FOLLOW → CLASH-CORNER → BASIC-INNER → M3-LOBBY → BASIC-MODES → M3 roadmap.** **BASIC-BEAM is
BLOCKED** on a Designer number (OQ 2026-09-09 #1) — skip until answered. Realistic one-session cut:
CHASE-FOLLOW + CLASH-CORNER + BASIC-INNER.

---

## Engine — correctness bugs (do first)

### CHASE-FOLLOW. A chase re-evaluates vision as the chaser advances (ENGINE) — UNBLOCKED (first, HIGH)
**Addresses Dev Note: "Chasing still isn't working as intended. You should follow the character that
you're chasing all the way until you lose line of sight or you run out of movement."** The chase
judges visibility and picks its goal **once, from the chaser's pre-move origin** — so a target that
outran the *stationary* chaser's vision is treated as fully fogged and the chase halts at the
last-known square even when arriving there restores sight and budget remains (reproduced: `a`(5,10)
chasing `e`→(12,10) stops at (9,10), `seen:false`, three short of catchable). *AC: the chase
resolves as an iterative walk on the frozen post-Move snapshot, re-deriving its goal from the
chaser's **live** square each step — while the team sees the target, step toward its true (snapshot)
square; while it cannot, step toward the last-known square; **stop only** when adjacent to / unable
to get closer to the current goal (caught/arrived), when standing on the last-known square with the
target still unseen (sight genuinely lost), or when movement is exhausted. Golden rule #5 holds — no
step is ever taken toward a fogged true position. `chaseResolved` reports the resolved pursuit
(`seen` = target in view at the end, `to` = the goal finally pursued). Tests (behavior change → same
commit): the open-map "follows a target that ran" case **flips** to assert the chaser ends
**adjacent** to the target with `seen:true`; the brush fog cases ("goes to the last-known square and
STOPS", "…short of even that budget") stay green unchanged; a **new** case where the chaser starts
fogged, advances into vision mid-chase, and finishes adjacent.*
**Spec Notes.** Files: `packages/engine/src/resolve.ts` (`planChases`/`pathToward` — recompute the
goal per step instead of once at `~:1552-1556`; the target and all teammates are frozen, so team
vision changes solely because the chaser moved — deterministic), `packages/engine/test/chase.test.ts`
(+ `chase-sprint.test.ts` re-verify). Keep it integer/plain-JSON, N-unit-safe, fixed reachability
order. Ruled in edge-cases (CHASE-FOLLOW). **Out of scope:** the fog record (LAST-KNOWN, correct);
CHASE-SPRINT budget (unchanged); the client's chase tell (already renders `chaseResolved`).

### CLASH-CORNER. A blocked passer bounces to its last-held square, never rests on an occupied one (ENGINE) — UNBLOCKED (small)
**Addresses Builder OQ 2026-09-09 #2.** Under CLASH-AR rule 3 an ender and a passer may share a
square at the end of a step; if the passer's **next** step is blocked it would come to rest on the
ender's square, which Collisions forbids. *AC: a passer that cannot take its next step (stationary
unit, wall, or map edge in the way) **bounces to its last-held square** — the last square it held
alone before entering the contested one — rather than resting on the occupied square; if that
square is itself now a rest, walk back one more along the passer's own path (the origin is always a
fallback, so it terminates); the Collisions invariant (STEP-STACK-INVARIANT) holds; pads are
unaffected (entry-based claims already settled; CLASH-AR (a)/(b) still decide the contested pad).
Tests: a passer wedged against a stationary unit ends on its last-held square (not the occupied one);
a chain of two blocked passers each fall back one; a regression asserting no two living units ever
rest on one square.*
**Spec Notes.** Files: `packages/engine/src/resolve.ts` (`stepMovers` — the passer-continue branch),
movement/resolve tests. Deterministic (integer step clock, fixed walk-back order). Ruled in
edge-cases (CLASH-CORNER). **Out of scope:** the ender bounce (shipped, unchanged); the swap block;
displacement.

## Engine — the unique-basics uplift (Designer §3; each ships with its one data edit)

### BASIC-INNER. `innerRadius`/`innerAmount` on a circle (ENGINE + data) — UNBLOCKED
*AC: a `circle` may carry `innerRadius`/`innerAmount`; tiles within the inner radius take
`innerAmount`, the ring the base; ships with **Cinder's Ember Bolt** (→ circle r1, 22 centre / 14
ring). Tests: centre vs ring damage; the squared-distance integer test decides the boundary.*
**Spec Notes.** `shapes.ts`/damage path; `validate.ts`. Reuse the circle's integer distance test.
Out of scope: other kits.

### BASIC-MODES. Two aim-time profiles on one ability (ENGINE + CLIENT) — UNBLOCKED (large)
*AC: an ability may carry `modes: [AbilityProfile, AbilityProfile]` chosen at aim time (order carries
the index); ships with **Kestrel's Twin Bolts** (wide cone 2 ↔ thin line 6); the client offers the
toggle (AIM2 UI). Tests: each mode resolves its own profile.* **Spec Notes.** The largest BASIC-\*
ask (real UI work). Build after the smaller knobs and M3-LOBBY. Out of scope: the other kits.

### BASIC-BEAM. `beamWidth` constant half-width on a cone (ENGINE + data) — BLOCKED on a Designer number
**Addresses Builder OQ 2026-09-09 #1.** The engine substitution is ready (`axisSquares`/`onConeAxis`
already expose the perpendicular offset as an integer; the change is one comparison in the wedge
test). It is **blocked on the Designer**: as specced, `beamWidth: 1` yields a **3**-wide lane while
"Shield Bash as a 1×2 beam" wants width **1** — the field's meaning (full width vs half-width) and
Aegis's intended footprint are the Designer's call, and they change shipped data. *AC (once the
Designer answers): a `cone` may carry `beamWidth: n` giving a constant-width wedge instead of
CONE-B's `halfWidth(d)=d` ramp; ships with Aegis's Shield Bash at the ruled footprint; tests:
coverage is constant-width and rotation-invariant.* **Spec Notes.** `shapes.ts` (`coneSquares`).
Do **not** guess the number — wait for the Designer. Out of scope: other kits.

## Engine — flag to the Designer

### AXIS-MODIFIERS-CHECK. Confirm `axisBonus` scales with Might/Weaken/cover (DESIGNER decision)
**Addresses Builder OQ 2026-09-09 #3.** BASIC-AXIS shipped with the axis bonus folded into raw damage
(Decision 8), so Might/Weaken/cover scale it. If the Designer intended "+8 flat, unmodified," it wants
a separate field on `Hit`, not a bigger `raw`, and Bastion's slam under Might would land differently.
*AC: the Designer confirms "scales" (no change) or requests "flat" (a one-line Builder follow-up
adding an unmodified component).* Non-blocking; the shipped behavior is the sensible default.

## M3 — the lobby (unblocked by CAT-SELECT)

### M3-LOBBY. Map/format/catalyst/character selection + team-seat + R3 + the network client (SERVER + CLIENT) — UNBLOCKED (large)
*AC: a lobby picks map + format + **each seat's N characters and each character's catalyst triad**
(per the ruled pick model — R3 spans the whole team, catalysts per-character, seeded via CAT-SELECT);
its start button calls `RoomHub.start()` and **deletes the temporary `POST /rooms/:code/start`
route**; the **client consumes a `decision` and a filtered `turnResolved`** over the socket (proving
M3-HIDDEN end-to-end), written against M3-LOCKLIST's shape; supersedes MAPTOGGLE and M3-START's
interim.* **Spec Notes.** The first item to build the **network client** (socket layer). Large;
explicitly multi-session; now unblocked by CAT-SELECT + the pick-model ruling. Out of scope:
reconnect (M3-RECONNECT), server-authoritative timing (M3-TIMER).

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

- **BASIC-BEAM number** (OQ #1) and **axisBonus scaling** (OQ #3, → AXIS-MODIFIERS-CHECK) — both
  await Designer decisions; scheduled above.
- **Dash melee-cover** (contact damage in the Dash phase ignoring cover) — deliberately deferred by
  the Designer (§4.1); a playtest question, not folded into the `melee` flag. **Thorn's lobbed auto**
  (range 5, wall-ignoring) — the Designer's playtest flag; range 5→4 is the first nerf lever.
- **Pad tuning** — shipped placement/schedule verified; 4v4 over-dominance lever is `everyTurns` 4→5
  on iron-basin, not moving Might out of the centre. **Pad colours** stay coupled to the render e2e.
- **UI-TIMER hot-seat auto-lock**, **touch input** (UI-INSPECT desktop-only v1), **PREVIEW-MODIFIERS
  shields**, **AIM-SMOOTH table**, `killerUnitId`/`gameEnd`, **A4**, **spectators**, **Lockwood/Helios
  basics** (not adopted), **`vulnerable`** — unchanged, not scheduled.
- **`data/` formatter** (OQ #5) — accepted as-is (2-space, preserved unicode); a tooling item only if
  the repo ever wants it enforced.

## Observed-not-requested / playtest (not Builder-blocking)

- **CHASE-FOLLOW feel** (the chaser now trails all the way — playtest that the tell isn't too strong),
  **CLASH-AR mobility** (crossing paths now safer — the Might-room liveliness), **new autos** (Lumen
  heal-line, Thorn lob, Ravok whirl — feel + Thorn's blind-corner poke), **melee vs cover** now live,
  **Might centre contest**, **Fade full-action**, **Kestrel** untested via MAPTOGGLE, **turn-1 spawn
  margin one tile**, **vision Manhattan diamond**.
