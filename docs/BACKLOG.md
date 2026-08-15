# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js); every client item consumes
`TurnEvent[]` and the engine's derived queries (vision, reachability) — never recomputes them.
**Movement is Manhattan (MET1); aiming is Euclidean (AIM-METRIC).** **Open/update a PR to `main`
every session** (CLAUDE.md).

## ✅ COMPLETE

- Engine core, teams/formats, movement, FF1, AIM2, RND1, A0(+heal), A1–A3, UI1–UI6, D1(+dash),
  MET1(+tp), BRUSH1, TT1, C1, MS1, R1–R7, MOVE1, HITBOX1, VISION1(+opening), MAPTOGGLE,
  CI-decouple, AIM-METRIC, CONE-B, CIRCLE-FIX, DASH-IMPACT, FREE1, CAT1, CAT2, PREP-AOE,
  VALIDATE-KEYS, FREE-UI, DECOY-RENDER, STATUS-AUDIT(+UNTGT1, +`statusRemoved`), FOG-ZORDER,
  DASH-PREVIEW, PREVIEW-NUMBERS, CAT-DASH-COST, AIM-RANGE, DASH-CAT-ROUTE, PREVIEW-FOG,
  TRAP-INDICATOR, CAT-COST-LABEL, LOG-STATUS, STEALTH-CONFIRM.
- **PR #42 (this review):** **STEALTH-DURATION** (Wisp Stealth `duration: 2`), **CAMO-REVEAL**
  (acting/being-hit while concealed reveals + red tile), **DASH-OCCUPIED** (prohibition pinned +
  knockback exception + client aim-gate), **LAST-KNOWN** (client last-seen ghosts).
- **PR #43 (Designer):** AR-parity audit (`ar-parity-v1.md`); both maps re-cut (brush runs ≤3);
  **Fetter** + **Probe** catalysts (pool 3/4/4; **Regenergy** withheld until DOT-HOT).

Current suite: **892 tests** (engine 509 + client 383), typecheck + build clean, purity green.

> **This batch = the AR-parity specs + two owner rulings.** Six Designer specs (DOT-HOT, CHASE1,
> PADS1, TIMER-40, UI-VIEWPORT, SCORE1) plus CAT-DASH-FULL and TRAP-LIFETIME (owner Dev Notes),
> MAP-CAPS and UNTGT-DOC (owed). **CHASE1's four edge cases are now RULED** (edge-cases → "Chase
> orders") — it is unblocked. **DO NOT touch vision** — the DECISIONS audit block recommending a
> per-format `visionRange` is *superseded* by ar-parity §3 ("vision stands as built"); building it
> would "fix" something the owner ruled correct.

### Build order and dependencies

Large batch; take top-down. **DOT-HOT blocks PADS1** (Health pad + Regenergy need `healOverTime`) —
build DOT-HOT before PADS1. Everything else is independent. Recommended order = owner rulings +
quick wins, then the highest-value client item, then the engine foundation and its dependent, then
the remaining client work:

1. **TIMER-40** (one constant) 2. **CAT-DASH-FULL** (owner) 3. **TRAP-LIFETIME** (owner)
4. **MAP-CAPS** + **UNTGT-DOC** (owed, small) 5. **UI-VIEWPORT** (owner: highest value)
6. **DOT-HOT** → 7. **PADS1** (+ Regenergy data) 8. **CHASE1** (engine last-known + client)
9. **SCORE1**. Cut line if the session fills: after CHASE1; SCORE1 carries.

---

## Quick + owner rulings (do first)

### TIMER-40. Decision timer 30 → 40s (CONSTANT) — UNBLOCKED (first)
**Addresses ar-parity §7.4.** *AC: `DECISION_SECONDS` is `40` (was 30); Time Bank unchanged (1
charge, +10 s); the client reads the constant (it already does — no client change expected). A test
asserts the value.*
**Spec Notes.** File: `packages/engine/src/constants.ts` (`DECISION_SECONDS`). One line + a test.
Out of scope: Time Bank size; any per-format timer.

### CAT-DASH-FULL. A Dash catalyst is your full action (ENGINE + CLIENT) — UNBLOCKED (owner)
**Addresses Dev Note: "Dash Catalyst should count as your full action."** Supersedes CAT-DASH-COST
(which only spent the Move). *AC: a turn that orders a Dash-phase catalyst carries **no** normal
`ability`, **no** `movePath`, and **no** `sprint` — the catalyst is the unit's whole active turn
(Prep/Blast catalysts unchanged; a free ability is still allowed alongside); the engine drops those
components for a Dash-catalyst turn; the client disables the ability hotbar + Move + Sprint when a
Dash catalyst is armed and hands the slot back if the player picks one of them; tests assert a
Dash-catalyst turn has no ability/move/sprint and that Prep/Blast catalysts still stack with an
ability + move.*
**Spec Notes.** Engine: `packages/engine/src/resolve.ts` `planUnit` — extend the existing
Dash-catalyst Move-drop to also drop `ability` (mirror how a dash ability drops the Move; now a Dash
*catalyst* drops the ability too). Client: `app.ts`/`hud.ts`/`order-mode.ts` — arming a Dash
catalyst disables the hotbar + Move + Sprint (today CAT-DASH-COST disables only Move/Sprint);
CAT-COST-LABEL's "costs Move" tag becomes "costs your action" for the Dash colour. Ruled in
edge-cases (CAT-DASH-FULL, superseding CAT-DASH-COST). **Out of scope:** Prep/Blast catalyst cost
(unchanged); free abilities (separate free action).

### TRAP-LIFETIME. Traps expire (Overwatch 2, cap 3) (ENGINE + DATA + VALIDATION) — UNBLOCKED (owner)
**Addresses Dev Note: "Overwatch Traps should only last for 2 turns total. Traps in general should
only last for up to 3 turns max."** *AC: a placed trap expires unfired at the end of `placedTurn +
lifetime − 1` (a `lifetime: 2` trap covers the turn placed + the next, then is gone); `TrapState`
carries the lifetime/expiry, populated from the trap ability's effect; **Vex Overwatch Trap =
`2`**; `validateAbility`/`validate` **rejects any trap `lifetime` > 3**; a trap still triggers
normally within its life; the TRAP-INDICATOR client marker clears when the trap expires; tests: an
untriggered Overwatch Trap is gone by `placedTurn + 2`, a `lifetime: 4` trap fails validation, a
trap triggers within life.*
**Spec Notes.** Engine: `packages/engine/src/resolve.ts` (trap placement stamps expiry; end-of-turn
processing removes expired traps — emit an expiry event or let the client read `state.traps`),
`types.ts` (`TrapState` + the trap-effect `lifetime`), `validate.ts` (the ≤3 cap). Data:
`data/characters/vex.json` (Overwatch Trap trap effect `lifetime: 2`). Integer turn arithmetic,
N-trap-safe. Ruled in edge-cases (Traps expire). **Out of scope:** re-arming/moving traps; other
trap balance.

### MAP-CAPS. Content test for terrain run caps (ENGINE TEST) — UNBLOCKED (owed)
**Addresses ar-parity §5.** Both maps are fixed in data; the enforcing guard is owed. *AC:
`content.test.ts` fails a map with an unbroken run of **brush > 3, cover > 4, or wall > 5** (both
orientations); both shipped maps pass; the test also keeps the existing mirror-symmetry + spawn
checks.*
**Spec Notes.** File: `packages/engine/test/content.test.ts`. Scan each row and column for max
consecutive same-terrain runs. Out of scope: the "one thesis per map" / lane-break heuristics
(record as aspirational; the three numeric caps are the testable core).

### UNTGT-DOC. GAME_SPEC §6 Untargetable is no longer ults-only (DOC) — UNBLOCKED (owed)
**Addresses ar-parity §1.1.** *AC: GAME_SPEC §6 drops the "(ults only)" annotation on Untargetable
(Fade — a catalyst — applies it).* **Spec Notes.** `docs/GAME_SPEC.md` §6, one line. The ruleset is
the Designer's; flagged for whoever edits GAME_SPEC. Doc-only, no code.

## Highest-value client

### UI-VIEWPORT. The scene fills the viewport; the HUD overlays it (CLIENT) — UNBLOCKED
**Addresses ar-parity §4 / §7.5.** The client treats the *board* as the app frame, so controls fall
off-screen (worse as maps grow — `iron-basin` 22×19 exposes it). *AC: the renderer canvas fills the
**browser viewport** and resizes with it (the board is framed by the camera, never the DOM); the HUD
is overlaid against the viewport, so **no control falls outside the visible area** at any map size
or zoom; **every button (hotbar, catalysts, Lock In, Sprint) is ≥ 44×44 px** with icons scaled to
match; verified at **1280×720 and 1920×1080** on **both maps** that all controls are on-screen and
the whole board is in frame at default zoom.*
**Spec Notes.** Files: `packages/client/src/renderer3d.ts` (canvas → viewport size + resize
handler; camera frames the board), `hud.ts`/`app.ts` (overlay positioning against the viewport;
hit-target sizing). The HUD module is already structured for overlay (UI3) — this is layout + sizing,
not a rebuild. Verify via RENDER-VERIFY at both resolutions/maps. Out of scope: new HUD content
(that's SCORE1); mobile/touch layout.

## Engine foundation → dependent

### DOT-HOT. Damage- and heal-over-time effect kinds (ENGINE) — UNBLOCKED (blocks PADS1 + Regenergy)
**Addresses ar-parity §7.1.** *AC: two new effect kinds `damageOverTime` and `healOverTime`, each
`{ amount, duration }`; both apply **at end of turn, in the engine's fixed unit order, BEFORE the
status duration tick** (so a `duration: 2` DoT ticks the turn it lands and the next); `damageOverTime`
credits the applying unit's team for kills (like traps) and is FF1-harmful; `healOverTime` is
FF1-beneficial; **refresh-not-stack** like every status; neither is modified by Might/Weaken (flag
for playtest); tests: a 2-turn DoT deals its amount twice, a unit that dies mid-DoT stops ticking,
the tick order is deterministic across runs.*
**Spec Notes.** Files: `packages/engine/src/types.ts` (`EFFECT_KINDS` + the two kinds), `resolve.ts`
(end-of-turn application before `tickStatuses`; store the pending over-time on the unit like a
status with `remaining`), `status.ts` if the over-time rides the status machinery. Attribution
already exists (A0). Determinism: integer, fixed unit-list order, no float/RNG. Ruled in ar-parity
§1.2. **Out of scope:** `vulnerable`/incoming-damage modifiers (§1.3 VERIFY — not approved);
Might/Weaken interaction (flagged, not applied).

### PADS1. Power-up pads (ENGINE + DATA) — BLOCKED on DOT-HOT
**Addresses ar-parity §7.3.** *AC: `MapDef` gains `powerups: [{ x, y, type, firstTurn, everyTurns }]`;
a pad grants its effect to the **first unit to occupy it**, resolved at a fixed point at **end of
Move (after chasers, so the last mover can contest it)**; a consumed pad respawns `everyTurns`
later; types reuse existing effects + DOT-HOT: **Health** (`heal 10` + `healOverTime 10×2`), **Might**
(Might 2), **Energy** (Energized 2); a `powerupTaken` event for the client; tests: first-occupier
gets it, respawn timing is exact, contested is impossible (Collisions), deterministic.*
**Spec Notes.** Files: `packages/engine/src/types.ts` (`MapDef.powerups`), `resolve.ts` (end-of-Move
pad resolution, after CHASE1's chasers if both land this session — order them), `validate.ts` (pad
schema). Data: both maps need pad squares (Designer work once the schema lands — coordinate; the
Builder can add symmetric placeholders + a test, Designer tunes). **Depends on DOT-HOT** for the
Health pad. Determinism: fixed unit order for "first occupier" ties (there can be no tie —
Collisions forbid co-occupancy — but resolve in unit-list order defensively). Out of scope: RNG
spawns; pad types beyond the three.

## Engine + client (rulings folded in)

### CHASE1. Chase orders, resolving at end of Move (ENGINE + CLIENT) — UNBLOCKED (edge cases ruled)
**Addresses ar-parity §7.2 + Dev Note: "CHASE1 needs Analyzer rulings before the Builder touches
it … you cannot chase a target you cannot see, you will go to their last known square if possible,
but not chase it past where you lost vision."** *AC: a `UnitOrders` may carry a **chase target**
(enemy unit id) instead of `movePath`; normal movement resolves first, then chasers path toward the
target with **remaining budget**, stopping short of occupied squares (Collisions). The four ruled
cases (edge-cases "Chase orders"): **(1) unseen target → path to the team's LAST-KNOWN square and
STOP; never-seen → drop** (no hidden-info leak — golden rule #5); **(2) chase-vs-chase** resolves
against the frozen post-Move snapshot (converges, deterministic); **(3) dead target → drop**;
**(4) chase + dash → drop the chase** (the dash is the movement). Tests: chase-into-fog stops at
last-known; never-seen holds; chase-vs-chase converges; dead/dashing drops the chase; deterministic.*
**Spec Notes.** **New engine state:** a per-team last-known record for each enemy —
`state.lastKnown` keyed by `(teamId, enemyUnitId) → pos`, updated in **end-of-turn** processing to
each enemy's position **iff that team can currently see it** (else left stale). Arrays/plain-JSON,
not Maps, for `structuredClone`/determinism (mirror `catalystsUsed`). Chase resolution
(`resolve.ts`, end of Move): if the chaser's team sees the target now → target's actual post-Move
square; else → `lastKnown[(team,target)]` (drop if absent). Reuse `pathTo`/reachability with the
mover's remaining budget; stop at the last-known square (do not overshoot). Client: `targeting.ts`/
`app.ts` — a chase-order affordance (target an enemy) + a chase indicator distinct from a move line;
the client shows the chase toward the **client's own** last-known ghost (LAST-KNOWN already tracks
this client-side — reuse it; the engine keeps its own authoritative copy). **This is the load-bearing
ruling: the chase must never use the target's true fogged position.** Ruled in edge-cases (Chase
orders). **Out of scope:** chasing allies; chase for a dash; multi-target chase.

## Client

### SCORE1. Scoreboard — in-match readout + end-of-match breakdown (CLIENT) — UNBLOCKED
**Addresses ar-parity §7.5 / §6.** *AC (in-match, top of viewport): team kill tally vs the format's
target (e.g. 2 / 4) for both teams; **Turn X of Y**; per-character strip (alive/dead, HP, energy
toward ult, respawn countdown). (End of match): winner + final score with **Double KO** handled;
per-character kills, deaths, damage dealt, damage taken, healing/shielding given; and whether it
ended by kill target, turn limit, or sudden death. A client test drives a short match and asserts
the readout and the accumulated totals.*
**Spec Notes.** Files: new `packages/client/src/scoreboard.ts` + `app.ts`/`hud.ts` (overlay against
the viewport — depends on UI-VIEWPORT's overlay if built first; otherwise anchor to the viewport
directly). **Fold damage/heal totals from the event log during playback** — they are not in engine
state, but the log is the rendering contract, so no engine change for the useful half (A0 gives
damage a source). Kills/deaths/turn/HP/energy are already in state. Out of scope: any engine
accumulation (client folds the log); historical/replay UI beyond the current match.

## Blocked / flags (not build items)

- **DO NOT change vision** — DECISIONS audit block (2)'s per-format `visionRange` is **superseded**
  by ar-parity §3 (owner: "vision stands as built"). Building it reverses an owner ruling.
- **CAMO-REVEAL red-tile-follows-unit** (Builder OQ #1) — accepted for v1; a fixed-tile version
  needs a `pos` on the reveal event, a Dev-Note-driven refinement, not scheduled.
- **`revealedView` rename** (OQ #5) — fold a rename/comment into any client touch this batch.
- **Regenergy catalyst** (data) — add to `data/catalysts.json` (prep, `healOverTime 12×3`) **once
  DOT-HOT lands**, completing the 4/4/4 pool; a validation test flips from 3/4/4 to 4/4/4.
- **`statusRemoved` source**, **PREVIEW-NUMBERS cover-adjust**, **`vulnerable`** (§1.3 VERIFY) —
  not scheduled; revisit on a concrete playtest report / owner confirmation.

## Deferred — do NOT schedule

- **A4** per-ability FX — blocked on M3 + roster lock.
- **CL1/CL2/E2**, **flat `energy` effect kind**, **vision metric change**, **tunable cone angle**,
  **optimistic move validation**, **status-pip pixel test**, **Echo Boost / Chronosurge / Critical
  Shot / Regroup catalysts** (need mechanics we lack) — not scheduled.

## M3+ — the next milestone

21. Worker + DO rooms; **map + format selection lobby** (supersedes MAPTOGGLE) with **per-character
    catalyst selection** and the **normal-ability-aimed-from-Shift-landing preview**; team-seat +
    **duplicate-pick validation (R3)**; per-player hidden submission → per-team orders; **per-team
    hidden information — the real security boundary** the hot-seat only approximates for fog
    (VISION1), previews (PREVIEW-FOG), traps (TRAP-INDICATOR), last-known ghosts (LAST-KNOWN /
    CHASE1's engine last-known) and the combat log (UI6); per-player timer + Time Bank; decoy fog;
    reconnect/replay; deploy to Pages + wrangler.

## Observed-not-requested / playtest (not Builder-blocking)

- **DoT/HoT vs Might/Weaken** (flagged: over-time is not an outgoing hit — confirm in playtest).
- **8-tile melee cones**, **cone raggedness**, **Overdrive Haste can't buy Move squares**, **Fade
  now full-action** (watch it's not dead), **catalyst hoarding**, **Kestrel** untested via
  MAPTOGGLE, **turn-1 spawn margin one tile**, **vision Manhattan diamond** (owner-approved as-is).
