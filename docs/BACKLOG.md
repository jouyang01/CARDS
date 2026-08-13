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

- **M1 — Engine core (1–12, +3a, +E1).**
- **M1.5 — Teams & formats (13–16).**
- **M2 client (17–20) + T1.** Render, targeting, playback, hot-seat seats/merging; TeamId rename.
- **S1 — Event schema for HUD** (shield `amount` + `energySpent`).
- **MV1 — Dashes/charges pass through characters.** (Dev Note: *"Dashes should be able to go
  through other characters."*)
- **MV2 — Normal movement AR pass-through model.** Verified against the AR wiki.
- **MV1-fix — Displacement ignores the charger's own body.** Ram Charge displaces again
  (amount-1-onto-charger is a documented net-zero interim; see edge-cases).
- **MV3 — 8-direction diagonal movement, AR cost model.** Parity-state Dijkstra, corner-cut
  blocked by either solid flank, GAME_SPEC §3 updated. (Dev Note: *"Movement rules should
  follow this."*)
- **TT1 — Ability tooltips.** (Dev Note: *"Need to have tooltips when hovering over ability."*)
- **C1 — Headless hot-seat smoke test.**

Current suite: **262 tests** (engine 238 + client 24), typecheck + build clean, purity green.

---

## Next batch

### MS1. Move-and-shoot in one turn (client UI) — UNBLOCKED (priority)
**Addresses Dev Note: "Yes - you should be able to move and shoot in one turn and this needs
to be built out in the next build… Ability + move: you get a 4-square move budget. Sprint
(move only, no ability): you get 8 squares… using a skill doesn't cost you your move — it
just halves how far you can go (4 instead of 8). Sprint and abilities are mutually
exclusive… Dash abilities are the exception — a dash is your movement that turn… If you get
knocked back or pulled during Blast, you lose your Move that turn… Root blocks Move-phase
movement entirely (but doesn't cancel a dash)… Haste/Slow adjust the budget (+50% / −50%)."**

The engine and `targeting.toUnitOrders` already support ability + move together; only the UI
flow blocks it. *AC: with a non-dash ability selected, the player can also draw a Move path
previewed at the ability-turn budget (4, Haste/Slow-adjusted) and lock in a `UnitOrders`
carrying **both** `ability` and `movePath`; selecting a **dash** ability drops the separate
move (dash is the move); **Sprint** stays move-only and clears any ability (8 budget); Root
shows a 0 move budget; a client test asserts an ability+move draft round-trips to a
`UnitOrders` with both fields.*

**Spec Notes.** Files: `packages/client/src/app.ts` (the mutual-exclusivity is here:
`selectAbility` wipes `movePath`, `selectMove` wipes `abilityId`; the move preview is gated
on `draft.sprint || mode==='move'` at ~line 118), `targeting.ts` (`toUnitOrders` already
emits both — reuse it; extend `movePreview` to run with an ability selected using
`movementBudget(unit, /*sprint*/ false)`), `test/targeting.test.ts`. **Engine unchanged** —
`planUnit`/`movementBudget` already give 4-with-ability / 8-sprint and drop the move for a
dash. Model: allow `abilityId` and `movePath` to coexist in `OrderDraft`; only `sprint`
(and a dash ability) forces move-only. Gotcha: an ability-turn move must preview the
**4-budget** reachable set (walk-through occupied squares, per MV2), not the 8-sprint set.
Out of scope: hidden info / timers (M3).

### MV4 (optional). Diagonal charge paths — UNBLOCKED
Move is 8-direction but charge paths (`aimIsLegal` `path` case) are still orthogonal, so a
unit can move but not charge diagonally. *AC: a diagonal charge path validates (with the
same corner-cut rule as movement) and resolves; dash tests cover a diagonal charge.*

**Spec Notes.** Files: `resolve.ts` (`aimIsLegal` `path` case — accept `isAdjacentStep` +
`diagonalCornerBlocked` instead of orthogonal-only), `dash.test.ts`. Independent of the
charge-*damage* Designer ASK (this is path geometry only). Keep charge cost/first-enemy
behavior unchanged. Confirmed intent (Builder OQ 2026-08-17).

### CL1 (optional). AR "Clashes": pass-through co-occupancy — UNBLOCKED
AR lets two units both *pass through* the same square (neither ending) and both continue;
ours stops all same-step co-targets. *AC (if taken): two units crossing the same square on
the same step, each ending elsewhere, both complete; both-ending-on-it still stops both;
2-cycle swaps still blocked.* PROPOSED in edge-cases. Only if playtests want exact AR clashes.

### CL2 (optional). Multiple simultaneous displacements sum as a vector — UNBLOCKED
AR sums concurrent knockbacks/pulls into one vector; ours applies them sequentially. Rare in
v1. Would also resolve the amount-1 Ram Charge net-zero case cleanly.

### E2 (optional, low). Unify cover corner convention with LoS — UNBLOCKED
Carried; `isBehindCover` corner-inclusive vs LoS corner-exclusive (ruled acceptable).

## M3+ — placeholder

21. Worker + Durable Object rooms; format selection; lobby with team seats and 1–2 characters
    per player; per-player hidden submission merged into per-team orders; per-player timer +
    Time Bank; reconnect/replay; deploy to Pages + wrangler.

## Blocked — needs a Designer ruling (NOT in the unblocked set)

- **Charge combat (bundled).** With pass-through: does a damaging charge hit the *first*
  enemy crossed, *all* crossed, or the destination? And for the amount-1 knockback-onto-
  charger case — victim stays (current), is carried through to the far side, or swaps? Rule
  these together. Files: `resolve.walkCharge`/`runDash`/`applyDisplacements`.
- **D1. Decoy entity** (Wisp) — v1 no-op beyond Stealth; needs a Designer spec. `ENGINE ASK`.
- **Duplicate picks** — lobby/UX rule for M3 (engine already gives unique unit ids).
- **`combat_roll` path-vs-teleport; cover-vs-Might composition; Support archetype kit;
  roster-v1 §9 ENGINE ASKs** (effect target affinity; energy-on-ally-benefit) — do NOT build
  in v1 without a ruling.

## Notes

- Research branch `claude/atlas-reactor-cards-research-n553wi` adds
  `docs/design/atlas-reactor-reference.md` (AR source research); Designer/reference content,
  merges separately.
