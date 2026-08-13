# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.
A player controls 1–2 characters on one team.

**Standing directives:** engine iterates unit **lists** (never single-unit); every client
item is a pure `TurnEvent[]` consumer; the engine is player-count-blind. **Open/update a PR
to `main` at the end of every session** (CLAUDE.md "Session workflow").

## ✅ COMPLETE

- **M1 (1–12,+3a,+E1); M1.5 teams (13–16); M2 client (17–20)+T1; S1; MV1/MV2/MV1-fix; MV3;
  TT1; C1; MS1; MV4.**
- **Designer rulings R1–R7** folded into edge-cases (2026-08-19).
- **R1c** displacement carry-through; **R1b** `chargeHits` `"first"|"all"`; **R4/R7**
  content guardrails (polarity table total, `path` never resolves as teleport); **D1** Wisp
  decoy entity (separate `GameState.decoys`); **MS1-test** pure `nextDraft` reducer. (PR #15)

Current suite: **291 tests** (engine 259 + client 32), typecheck + build clean, purity green.

---

# ANIMATION · CAMERA · MAP batch (settled Dev directive, 2026-08-20)

**Why urgent (batch preamble — addresses Dev Note):** *playback today is a slideshow —
`app.ts` folds a whole phase into one snapshot and sleeps; `render.ts` rebuilds the SVG each
frame and `replaceChildren` means no DOM node survives a frame, so nothing tweens.
Consequence: golden rule #4 (dash immunity at the origin square) is literally invisible — a
player who dodges a blast cannot tell whether it was the dash, cover, or a miss. This is a
PLAYTEST BLOCKER, not polish.* Presentation model (settled, from Atlas Reactor): resolution
stays fully simultaneous in the engine; only the **showing** is serialized — **Prep
SEQUENTIAL, Dash SIMULTANEOUS, Blast SEQUENTIAL, Move SIMULTANEOUS**. Reconciling rule: **a
unit that died during the gather step REMAINS STANDING until it has played its own action —
death visuals defer to the end of the phase.** **No timing budget** — pacing is a single
tunable constant deferred to playtest; A2 tests assert **ordering and concurrency only**,
never absolute times or track length.

## Next batch — readability slice (must land before first real playtest)

### A0. Attribute damage to its source (ENGINE) — HARD BLOCKER, DO FIRST — UNBLOCKED
Add `sourceUnitId` + `abilityId` to the `damage` `TurnEvent`. Purely additive, no outcome
change. Blast emits every `abilityFired` before any `damage`, so damage cannot be attributed
to its ability by log adjacency — without this, **both** sequential Blast presentation and
"shooter in frame" camera framing are unimplementable (A2/A3 depend on it). *AC: every
`damage` event carries the `unitId` of the attacker and the `abilityId` that caused it
(including trap and delayed-detonation damage); no game-state/outcome change; existing tests
updated for the new event shape.*

**Spec Notes.** Files: `types.ts` (`TurnEvent` `damage` variant), `resolve.ts` (the Blast
damage emit ~:605, the dash-damage emit ~:457, the trap-damage emit ~:245). Thread the
source through every `applyDamage`→`damage`-event site (Blast, dash strike, trap, delayed
detonation). Trap damage's source is the trap's owner/ability; delayed detonation's is the
original caster+ability. Check every test asserting the `damage` event shape and update.
Out of scope: any presentation logic (that's A2/A3). This is the only engine item in the
readability slice — it ships with the R-batch cadence.

### M2. Cap non-ultimate ability range at 8 (ENGINE validation) — UNBLOCKED (parallel)
Spawn separation (M1) is currently hostage to one balance number — retune Vex's Rail Shot to
9 and M1's geometry silently breaks. *AC: `validateAbility` rejects a non-ultimate ability
with `range > 8`; ultimates are exempt (Lance of Dawn is range 99 by design); a content test
covers both.* 

**Spec Notes.** Files: `validate.ts` (`validateAbility`), `content.test.ts`. Distinguish the
ultimate via the same path the roster uses (a character's `ultimate` vs `abilities[]`).
Independent of the animation work; can run in parallel. Out of scope: changing any existing
range value (Rail Shot stays 8).

### D1-dash. Decoy also destroyed by a Dash ending on its square — UNBLOCKED (small)
Ruled in edge-cases (2026-08-20). *AC: an enemy Dash (charge or teleport) ending on a decoy's
square destroys it and emits `decoyDestroyed`, same as a Move-onto; an involuntary
knockback/pull onto the square does **not**; test covers dash-end-destroys and
knockback-does-not.*

**Spec Notes.** Files: `resolve.ts` (call the decoy-under-enemies check after the Dash phase
resolves final dash positions, alongside the existing Move-phase call `destroyDecoysUnderEnemies`),
`decoy.test.ts`. Reuse the existing predicate. Out of scope: knockback (deliberately excluded).

### A1. Keyed SVG nodes (CLIENT, prerequisite, no visible change) — UNBLOCKED
`render.ts` gains a persistent-node path: **one `<g data-unit-id>` per unit, positioned by
`transform`, reconciled across renders instead of rebuilt.** `renderBoard`/`renderState` keep
build-fresh semantics for the Decision screen. *AC: repeated renders reuse the same DOM node
per `unitId`; positions update via `transform`; no visual change; existing client tests pass.*

**Spec Notes.** Files: `packages/client/src/render.ts`. This is the substrate A3's tweening
needs (a node must survive a frame to animate). No behavior change; purely structural.
Out of scope: any animation (A3).

### A2. `choreograph()` — pure timeline module (CLIENT, tested) — BLOCKED BY A0, A1
New **pure** module: `choreograph(events: TurnEvent[]) => Cue[]`, each cue `{t, dur, kind, …}`.
**No DOM, no wall clock.** This is the layer that satisfies golden rule #3 for animation and
that a future 3D renderer reuses verbatim. **DISCIPLINE (the rule that makes it survive a 3D
port): cues stay renderer-agnostic** — `{kind:'impact', unitId, at}` is correct;
`{flashHex:'#f00'}` is leaked renderer detail and forbidden. *AC (ordering/concurrency only —
never absolute times):*
- Prep and Blast cues for **different units occupy DISJOINT, non-overlapping time ranges**,
  ordered by the **log's emission order** (deterministic via `orderedPlans`) — not by unitId
  or team.
- **Dash cues for all units share a start `t`; Move cues for all units share a start `t`.**
- **Every `death` cue is scheduled at or after the END of that phase's last ability cue**,
  regardless of where the death event sits in the log. Explicit test: a unit that dies in
  Blast but also fired in Blast still gets its own ability cue, and its death cue follows it.
- **`displaced` cues in Blast all share a single start `t` at the end of the phase**, after
  every ability cue (mirrors the engine rule that knockbacks resolve last).
- A **damage cue anchors to its source ability's cue via `sourceUnitId` (A0), never by log
  adjacency.**

**Spec Notes.** Files: new `packages/client/src/choreograph.ts` + `test/choreograph.test.ts`.
Pure function of the event log; timing is a single tunable constant (one cue duration), so
tests assert relative ordering/overlap, not milliseconds. Reuse `PHASES` and the log's phase
segmentation (`playback.segmentByPhase`). Out of scope: rendering the cues (A3).

### A3. Play the cues + camera (CLIENT) — BLOCKED BY A2
Renderer consumes `Cue[]` via the **Web Animations API**. Ships: tweened movement from
`moveStep`, dash streak, knockback/pull arc from `displaced`, hit flash + floating damage
number, deferred death fade, per-phase banner, speed control, skip button. **REQUIRED
INVARIANT: skipping lands on a `ViewState` identical to watching** — `applyEvent` stays the
single source of truth; cues only decorate it. **Decouple turn progression from animation
completion** (`app.ts` currently `await sleep()`, wrong once M3 owns the decision clock).
*AC: playback tweens each cue; skip produces the exact `playEvents` final `ViewState`; a
client test asserts skip == watch final state; camera framing test per below.*

**Spec Notes — camera (auto-pan, shooter AND target both in frame).** Files: `render.ts`,
`app.ts`.
- World content moves into a single `<g class="world">`; `viewBox` fixed to the **VIEWPORT**;
  container `overflow:hidden`.
- Camera = CSS `transform` on that group (`transform-origin: 0 0`), animated via **WAAPI** so
  it inherits `playbackRate`/`finish()` and participates in skip like every other cue — **not**
  the SVG `transform` attribute, **not** a rAF `viewBox` loop.
- Framing: target frame = bbox over the cue's subjects, where a **Prep/Blast cue's subjects
  are the SHOOTER's square ∪ `abilityFired.area`** (both in frame); **Dash/Move cues frame the
  union bbox of all movers and hold.** Then pad 1–2 squares → expand to **VIEWPORT ASPECT
  RATIO** → clamp to a **minimum 7×7-square frame** → clamp to board bounds.
- Camera easing **overlaps the previous cue's outro** (pan and action are not consecutive
  beats). Ship an **auto-camera / free-camera toggle** (AR had both).
- **REQUIRED FIX (silently breaks otherwise):** `render.ts:141-148` `squareFromPoint` does
  manual `getBoundingClientRect` + viewBox math and returns **wrong squares under any camera
  transform** — replace with `svg.getScreenCTM().inverse()` + `DOMPoint.matrixTransform()`.
- Keep HP bars, labels and damage numbers **OUT of `<g class="world">`** (or they scale with
  zoom); use `vector-effect="non-scaling-stroke"` on strokes that must stay fixed.
- Accepted tradeoff (do not "fix"): with range 6–8 abilities, `bbox(shooter, area)` spans 7–9
  squares, so the camera reads as a **tracking shot with mild zoom**, not dramatic zoom-ins —
  causality was chosen over spectacle deliberately.

## Designer / data (parallel, non-blocking)

### M1. Map redesign (DESIGNER, data-only, no engine change) — UNBLOCKED
**Problem A — spawn separation is 12 and max turn-1 threat is also 12** (Vex: 4 move +
Rail Shot 8), so Vex hits the enemy spawn turn 1. Owner's constraint: **turn-1 spawn hits
impossible, turn-2 engagement reliable.** *AC: spawn separation (Chebyshev) **≥ 13**; target
geometry **18×15, symmetric spawns at x=2 and x=15** (separation 13, two depth columns behind
each spawn). 13 is floor **and** ceiling — at 14+, a range-2 frontliner (Aegis, turn-2 threat
6) can no longer reliably engage on turn 2. Add a test asserting **max turn-1 threat < spawn
separation, DERIVED FROM THE ROSTER (not hardcoded)**, so a future long-range character can't
silently reintroduce the turn-1 spawn hit.*
**Problem B — terrain is 18 isolated single squares in a symmetric rosette**; no formation
exceeds 1 tile, rows 0–1 and 13–14 are empty (27% of the board), brush pinned to dead edges.
*AC: replace with **~4–6 MULTI-SQUARE formations** — walls of length 3–5 that cut a lane,
cover clusters forming holdable positions, brush patches wide enough to conceal a flank route.
Total blocked count may stay similar or fall — the requirement is **structure, not density**.
Give the flank rows a reason to be entered. Preserve mirror symmetry.*

**Spec Notes.** Files: `data/maps/duel-arena.json`, `content.test.ts` (the roster-derived
turn-1-threat test — reuse `movementBudget` + shape `range` via `shapes.ts` Chebyshev, per the
Dev Note's derivation). Designer owns `data/`; no engine change. **Open question, do not solve
speculatively:** 4v4 may warrant its own map rather than reusing duel-arena — raise it, don't
build it.

### Thorn-dash (DESIGNER, data-only) — UNBLOCKED
**Addresses Builder OQ + Dev directive: "We want to remove one of Thorn's abilities and add a
dash."** Thorn (Support) is the only kit with no Dash-phase ability. *AC: `thorn.json` has
exactly one Dash-phase ability (remove one existing ability to make room, keep 4 abilities +
ult); `validateCharacter`/`content.test` pass; after this lands, the dash guardrail is
tightened to **all** archetypes (no Support exemption).* 

**Spec Notes.** Files: `data/characters/thorn.json`, then `content.test.ts` (drop the
non-support scoping once Thorn has its dash). Every beneficial effect on the kit must stay
self-aimable (1v1 constraint, edge-cases R6). Designer picks which ability to cut and the
dash's shape (`path` walked or `square` blink) per Thorn's identity. Keep the auto-damage in
the 16–18 Support band.

## Deferred — do NOT schedule

- **A4. Data-driven per-ability FX.** Per-ability flourishes (projectile travel, beam, decoy
  poof) belong in `data/characters/*.json` as an `"fx"` block consumed **generically** by the
  client (golden rule #2 — never a `switch` in `packages/client`). **Blocked on M3 + roster
  lock** (D1 decoy unbuilt art, cut abilities would waste art). **A4 is the 2D-vs-3D decision
  point** — A1–A3 are renderer-agnostic (~200 of ~900 client lines are renderer-specific;
  `playback.ts`, `choreograph()`, `hotseat.ts`, ~95% of `targeting.ts` port unchanged); A4 is
  the first renderer-specific output. **Decide 2D-polish vs 3D BEFORE writing a single fx
  block, and not before.**
- **CL1** (AR clash pass-through co-occupancy), **CL2** (vector-sum displacement), **E2**
  (cover-corner unify) — all deferred; not for v1 without a new decision.

## M3+ — placeholder

21. Worker + Durable Object rooms; format selection; **lobby with team-seat + duplicate-pick
    validation (R3)**; per-player hidden submission merged into per-team orders; per-player
    timer + Time Bank; **decoy fog rendering** (enemy sees the decoy as Wisp — needs per-team
    hidden info); reconnect/replay; deploy to Pages + wrangler. A1–A3 are **not** invalidated
    by M3 — the network path delivers the same `TurnEvent[]` and reuses the same choreographer.

## Playtest / balance (not Builder-blocking)

- **Support anti-stall (R6):** Lumen+Thorn vs double-Firepower at 2v2; tune via per-format
  turn limit, not the kits.

## Notes

- Research branch `claude/atlas-reactor-cards-research-n553wi` adds
  `docs/design/atlas-reactor-reference.md`; Designer/reference content, merges separately.
