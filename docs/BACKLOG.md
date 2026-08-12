# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance):
gotchas, files, out-of-scope lines, required tests beyond the AC.

**Standing architectural directive (Dev Note 1 — captured in `docs/ARCHITECTURE.md`):**
*"Cards is A simultaneous-turn PvP tactics duel (1v1 now; 2v2/3v3 later — never hardcode
single-unit assumptions). One character controlled per player in v1 (two later). 2D SVG
visuals now; the engine emits an event log so a 3D renderer can be swapped in later
without touching game logic."* Every engine item iterates unit **lists**; every client
item is a pure consumer of `TurnEvent[]`.

## M1 — Engine core ✅ COMPLETE (reviewed 2026-08-14)

The full deterministic combat core shipped on `claude/cards-engine-builder-h4ws0r`
(reimplemented from `aaaf7be`). 203 tests, typecheck clean, purity guard green.

- [x] **1. Board + movement** — `board.ts`, `movement.ts`.
- [x] **2. Line of sight + vision** — `vision.ts`.
- [x] **3. Cover mechanics** — `combat.isBehindCover` (`ec…`→`0b40585`).
- [x] **4. Turn pipeline** (Prep→Dash→Blast→Move, event log) — `resolve.ts` (`65dffbb`).
- [x] **3a. No head-on edge swap** — `resolve.stepMovers` swap check; verified.
- [x] **5. Damage / shields / heal / energy** — `combat.ts` (`0b40585`).
- [x] **5a. Ability shape expansion** (line/cone/circle/square/self/path) — `shapes.ts` (`31732b3`).
- [x] **6. Status system** (apply/refresh/tick, Unstoppable, stealth-clear-on-attack) — `status.ts` (`a63bcff`).
- [x] **7. Dash phase** (charge/teleport/dash-damage, emergent immunity) — `resolve.runDash` (`63c499a`).
- [x] **8. Knockback / pull** (simultaneous, end-of-Blast, wall-stop, Move-cancel) — `resolve.applyDisplacements` (`319485b`).
- [x] **9. Traps** (Prep place, trigger-on-entry any phase, raw damage + effects) — `resolve.triggerTrapsOnEntry` (`e7f622d`).
- [x] **10. Deaths / respawn / win** (mid-phase death, mutual damage, 3-kill / turn-12 / sudden-death / Double-KO, turn advance) — `resolve.ts`.
- [x] **11. Determinism harness** + widened CI purity guard — `determinism.test.ts`, `ci.yml` (`c21b6a7`).
- [x] **12. Load real characters** + delayed abilities (grenade) — `setup.ts`, `real-characters.test.ts` (`7a9df9f`).

Open Questions from the build were resolved in `docs/design/edge-cases.md` and this
session's review (`docs/reviews/2026-08-14.md`). See that review for the mapping.

---

## M1.1 — Engine fixes from review 2026-08-14 (do first; small)

### E1. Passive energy must bypass Energized — UNBLOCKED
`resolve.endOfTurn` grants the `+5` passive via `combat.grantEnergy`, which scales by
Energized (5 → 7). The ruling (edge-cases, "Energized scales earned energy, not the
passive drip") says the flat passive is NOT boosted. *AC: a unit holding Energized gains
exactly `PASSIVE_ENERGY` (5) from the end-of-turn drip, while an ability's `energyGain`
that same turn is still Energized-scaled; regression test asserts both in one turn.*

**Spec Notes.** Files: `resolve.ts` (add the passive without `grantEnergy`'s scaling, or a
`grantEnergy(..., {scale:false})` variant), `combat.ts` if you add the flag,
`test/resolve.test.ts` or `combat.test.ts`. Do NOT change ability/on-hit energy — those
stay Energized-scaled. Gotcha: the existing determinism harness and any test currently
asserting `7` for Energized passive must be updated to `5`. Out of scope: changing the
ruling (if playtest later wants passive boosted, that's a Designer flip, not this item).

### E2 (optional, low). Unify cover corner convention with LoS — UNBLOCKED
`combat.isBehindCover` is corner-*inclusive* (a corner graze grants cover); LoS is
corner-*exclusive*. Ruled acceptable for v1 (edge-cases), so this is optional polish, not
a bug. *AC (if taken): cover reuses the LoS doubled-coordinate kernel so a corner-graze
shot resolves identically for sight and cover; existing cover tests still pass or are
updated with a noted rationale.* Skip unless touching cover anyway.

## M2 — Local playable (the main unblocked batch)

Goal: a hot-seat–playable duel driven entirely by the engine's `TurnEvent[]`. Build in
order — each depends on the previous. **Client holds ZERO game logic** (Dev Note 1).

### 13. Render live game state — BLOCKED BY nothing (build on `client/src/main.ts`)
Render units (both players), HP / shield / energy bars, and terrain from the map, over the
existing SVG grid. Drive from a `GameState` (from `createInitialState`). *AC: a fresh 1v1
state renders both characters at their spawns with full HP/energy bars and correct terrain;
resizing/rerender is idempotent.*

**Spec Notes.** Files: `packages/client/src/main.ts` (+ new render modules), `index.html`,
CSS vars already defined. Import `createInitialState`/`buildRoster` from `@cards/engine`
and the three character JSONs. **Addresses Dev Note 1:** render must read only engine
state/types — no re-deriving vision, cover, or reachability in the client. Keep a
`renderState(state)` entry so it generalises to N units (loop `state.units`, don't assume
two). Out of scope: input/targeting (item 14), animation (item 15). Test: this is client
code (no engine tests); keep functions pure where possible and typecheck-clean.

### 14. Decision-phase targeting UI — BLOCKED BY 13
Let a player build a `UnitOrders`: pick an ability, aim it (shape preview), draw a move
path, or sprint; then lock in. **Reuse `expandShape` from the engine for previews** — do
not re-implement shape geometry in the client. *AC: selecting Vex's Rail Shot and aiming
down a row previews exactly the squares `expandShape` returns; a drawn move path is
rejected in-UI when `validateMovePath` rejects it; lock-in produces a well-formed
`PlayerOrders`.*

**Spec Notes.** Files: client input/targeting modules. Use `expandShape`, `aimInRange`,
`validateMovePath`, `movementBudget`, `reachableSquares` from `@cards/engine` — the client
computes nothing about legality itself (Dev Note 1). Show ability availability from
cooldown/energy on the `UnitState`. Out of scope: hiding opponent info (that's the M3
server boundary; hot-seat trusts the local player). Gotcha: sprint is move-only — disable
it when an ability is selected, mirroring `planUnit`.

### 15. Resolution playback from `TurnEvent[]` — BLOCKED BY 13
Animate a resolved turn by walking the event log phase-by-phase: `phaseStart`, `moveStep`,
`abilityFired`, `damage`, `displaced`, `death`, `respawn`, `energyGained`, `gameEnd`. The
renderer is a pure function of events; it never recomputes outcomes. *AC: feeding the log
from a scripted `resolveTurn` reproduces the final board the engine returned; the four
phases play in Prep→Dash→Blast→Move order; a Double-KO shows both deaths.*

**Spec Notes (addresses Dev Note 1 — verbatim: "2D SVG visuals now; the engine emits an
event log so a 3D renderer can be swapped in later without touching game logic").** Build a
clean `renderEvent(event)` / event-stream interface with **zero game logic** so a future 3D
renderer is a drop-in behind the same `TurnEvent[]`. Files: client playback module.
Consume the log from `resolveTurn(...).events`. Out of scope: netcode. Gotcha: the log is
the whole contract — if playback needs a fact the log doesn't carry, that's an engine
event-schema gap to report back to the Analyzer, not a reason to recompute in the client.

### 16. Hot-seat dev harness — BLOCKED BY 14, 15
Pass-the-laptop loop: player 0 enters orders, then player 1, then run `resolveTurn` and
play back; repeat until `gameEnd`. *AC: a full scripted hot-seat match plays from turn 1 to
a winner using only the UI, with orders entered one player at a time.*

**Spec Notes.** Files: client harness/page. Wire items 13–15 together with the pipeline.
Keep both players' order-entry symmetric (N-unit ready). Out of scope: hidden information /
timers (M3). This is the milestone that makes the game actually playable — keep it thin.

## Blocked — needs a Designer spec (not in the Builder's unblocked set)

### D1. Decoy entity (Wisp Veil & Decoy) — BLOCKED on Designer spec
v1 ships decoy as a no-op beyond its Stealth (ruled in edge-cases). The real feature — a
fake unit rendered only to the opponent that absorbs a hit and expires — needs a precise
Designer ruling (the `roster-v1` design doc / branch is where it should land) before the
Builder models a `decoy` entity. `ENGINE ASK`. Do not implement without the spec.

## M3+ — placeholder (Analyzer expands after M2)

17. Worker + Durable Object rooms, WebSocket protocol, room codes, hidden submission,
    reconnect/replay; deploy client to Pages + server via wrangler.

## Cross-role follow-ups (not Builder-blocking)

- **Designer — v1 roster branch (`claude/cards-character-roster-v1-kfuwt2`).** 6 new
  character drafts + `docs/design/roster-v1.md`, Wisp reclassified to firepower. Not yet
  merged; it edits `docs/design/edge-cases.md` and `data/` independently — **serialize the
  doc merge** with this branch to avoid clobbering rulings. Its §9 `ENGINE ASK`s (effect
  target affinity; energy on ally-benefit) are **2v2-era and must NOT be implemented in v1
  without a ruling.** New characters need `validateCharacter` to pass and `content.test`
  to cover them when merged.
- **Designer — reconcile `combat_roll`.** Vex's Combat Roll flavor ("roll") vs its
  `teleport` effect; pick `path` (walked, triggers traps) or keep `teleport` (skips them).
- **Designer — cover-vs-Might composition.** Engine convention is outgoing → cover, two
  floors; confirm the default or request the alternative (one-line change).
