# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.
A player controls 1–2 characters on one team.

**Standing architectural directive (Dev Note, ARCHITECTURE.md):** *"…never hardcode
single-unit assumptions… 2D SVG visuals now; the engine emits an event log so a 3D
renderer can be swapped in later without touching game logic."* Every engine item iterates
unit **lists**; every client item is a pure `TurnEvent[]` consumer. The engine is
player-count-blind — the room layer owns the player→character map.

## ✅ COMPLETE

- **M1 — Engine core (1–12, +3a, +E1).** Board, vision, cover, pipeline, shapes/5a,
  status, dash, knockback, traps, deaths/respawn/win, determinism, real characters +
  delayed abilities; no-edge-swap; passive energy bypasses Energized. Reviews 08-13/14/15.
- **M1.5 — Teams & formats (13–16).** `FORMATS`/per-format win config, ally-aware effects
  (no friendly fire), team movement + shared vision, multi-unit spawns/respawns. Review 08-15.
- **M2 client (17–20) + T1.** Live-state render (17), targeting logic (18), event-log
  playback (19), hot-seat seats + per-player order merging (20); `PlayerId → TeamId` rename
  complete (T1). Client Vitest runner added; root `npm test` runs both workspaces.
  **244 tests** (engine 226 + client 18), typecheck clean, build green. Review 08-16.

---

## Next batch — movement alignment + HUD completion (the human's priority)

### S1. Complete the event schema for shields & post-ult energy — UNBLOCKED (do first)
Playback reproduces the board but not shield pools / post-ultimate energy — the log lacks
the facts (ruled in edge-cases "Rendering contract"). *AC: `statusApplied` carries an
optional `amount` populated with the shield pool when `status==='shield'`; a new
`{type:'energySpent';unitId;amount}` event fires whenever an ability removes energy (the
ult reset emits it); engine tests assert both; `playback.ts` consumes them so the HUD shows
shields and correct post-ult energy; existing 244 tests stay green.*

**Spec Notes.** Files: `types.ts` (TurnEvent + statusApplied), `resolve.ts` (emit `amount`
on shield `statusApplied`; emit `energySpent` where `markAbilityUsed`/ult zeroes energy),
`combat.ts` if energy-spend is centralized, `resolve.test.ts`, `packages/client/src/playback.ts`
+ `test/playback.test.ts`. Keep events **delta-based** (client does `energy -= amount`) so
replay stays order-robust. Out of scope: any non-shield status carrying an amount.

### MV1. Dashes pass through characters — UNBLOCKED
**Addresses Dev Note: "Dashes should be able to go through other characters."** Today a
walked charge stops in front of the first unit it reaches. Change dashes/charges to pass
*through* any character (ally or enemy); they still may not *end* on an occupied square
(stop on the last free square; teleport still fizzles). Walls/cover still block. *AC: a
charge whose path crosses an occupied square continues past it; a charge whose destination
is occupied stops on the last free square before it; a dash over an ally no longer halts;
new dash tests cover cross-through and blocked-destination.*

**Spec Notes.** Files: `resolve.ts` (`walkCharge`/dash path), `movement.ts` if the charge
reuses move-step logic, `dash.test.ts`. PROPOSED ruling in edge-cases ("AR movement
model"). **ENGINE ASK held for Designer — do NOT implement the damage change here:** when a
damaging charge now passes through enemies, does it hit the *first* crossed, *all* crossed,
or the destination only? Ship the movement (pass-through) change; leave damage targeting as
today (first enemy) until the Designer rules, and flag it in the commit. Out of scope: the
`statusApplied`/energy schema (S1).

### MV2. Movement follows the Atlas Reactor model — BLOCKED BY MV1 (shares the resolver)
**Addresses Dev Note: "Movement should follow this wiki instructions:
https://atlas-reactor.fandom.com/wiki/Movement"** Normal Move (not just dash) may pass
*through* any character; a unit may never *end* on an occupied square. This supersedes the
"enemies block pass-through" rule (enemies become walk-through, still not valid endpoints —
as allies already are). Simultaneous-resolution invariants unchanged (same-step contested
square; 2-cycle no-edge-swap). *AC: `reachableSquares`/`validateMovePath` treat every
occupied square as walk-through but not a legal endpoint; a path that crosses an enemy is
legal, ending on one is not; the contested-square and no-swap tests still pass.*

**Spec Notes.** Files: `movement.ts` (`allyOccupied` generalizes to *all* occupied →
walk-through-not-stop; drop the enemy-blocks-entry branch), `resolve.stepMovers`,
`movement.test.ts`. **Verification caveat (blocking finalize):** the AR wiki was
**egress-blocked** this session — confirm exact edge-details (move-through timing, terrain,
any range changes) against the wiki (human pastes it, or egress is unblocked) before
finalizing; the Analyzer will tighten the ruling next session if needed. Keep the ruling in
edge-cases as PROPOSED until verified. Gotcha: the client targeting UI (item 18) already
shows ally squares as walk-through — extend that to all occupied squares.

### TT1. Ability tooltips on hover — UNBLOCKED (client)
**Addresses Dev Note: "Need to have tooltips when hovering over ability"** Show a tooltip
(name, phase, range, cooldown, energy, effects/description from the `AbilityDef`) when
hovering an ability in the targeting UI. *AC: hovering an ability control shows its data
from the character JSON; no game logic in the tooltip (pure read of `AbilityDef`).*

**Spec Notes.** Files: `packages/client/src/targeting.ts`/`app.ts`/`render.ts`, targeting
test if a pure formatter is extracted. Read fields straight off `AbilityDef` (already in the
roster) — the client computes nothing. DOM hover is shell-level (typecheck/build-verified);
unit-test any pure "format tooltip text" helper. Out of scope: rich icons/art.

### C1 (optional). Headless one-turn smoke test — UNBLOCKED
The interactive DOM shell (`app.ts`/`render.ts`) is typecheck/build-verified only. *AC (if
taken): a headless test drives one hot-seat turn (build orders → `resolveTurn` → playback)
and asserts the rendered final board matches the engine state.* Skip if no headless tooling
is available; note it in CI when it is.

### E2 (optional, low). Unify cover corner convention with LoS — UNBLOCKED
Carried. `combat.isBehindCover` corner-inclusive vs LoS corner-exclusive (ruled acceptable).
Optional polish; skip unless touching cover.

## M3+ — placeholder (Analyzer expands after the client is solid)

21. Worker + Durable Object rooms; format selection (2v2 default; 4v4); lobby with team
    seats and 1–2 characters per player; per-player hidden submission merged into per-team
    orders (teammates' plans mirrored, opponents' hidden); per-player timer + Time Bank;
    reconnect/replay; deploy client to Pages + server via wrangler.

## Blocked — needs a Designer spec (NOT in the Builder's unblocked set)

- **Damage-on-charge (blocks MV1's damage half).** When a charge passes through enemies,
  which does it damage — first crossed, all crossed, or destination? Designer to rule.
- **D1. Decoy entity (Wisp Veil & Decoy).** v1 = no-op beyond Stealth; the real fake-unit
  entity needs a Designer ruling. `ENGINE ASK`.
- **Duplicate picks.** May a team field the same character twice? Engine already gives
  unique unit ids; it's a lobby/UX rule for M3.
- **Roster / Designer follow-ups.** `roster-v1.md` §9 `ENGINE ASK`s (effect target
  affinity; energy-on-ally-benefit — partly pre-empted by item 14's beneficial-on-use rule)
  — **do NOT build in v1 without a ruling**. Also open: `combat_roll` path-vs-teleport;
  cover-vs-Might composition; Support archetype kit.

## Cross-role notes

- **`CLAUDE.md` Commands wording is stale (review 2026-08-16).** Root `npm test` now runs
  engine **and** client suites (confirmed the desired shape). Update the "npm test — engine
  test suite" line to "engine + client suites". Constitution edit — leave to the Builder/human.
- **Branch hygiene.** PR #6 landed the engine/client work on `main`. Retire
  `multiplayer-configs` and `engine-backlog-t96lxw`. Keep `code-review-h3mwjs` until this
  review's docs merge to `main`, then retire it too.
