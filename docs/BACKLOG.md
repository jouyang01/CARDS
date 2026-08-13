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

- **M1 (1–12, +3a, +E1); M1.5 teams/formats (13–16); M2 client (17–20) + T1.**
- **S1** event schema; **MV1/MV2** AR pass-through; **MV1-fix**; **MV3** diagonal movement;
  **TT1** tooltips; **C1** smoke test.
- **MS1 — move AND shoot in one turn** (client). Dev Note satisfied.
- **MV4 — diagonal charge paths.**
- **Designer rulings R1–R7** (`rulings-v1-blockers.md`) folded into `edge-cases.md`
  2026-08-19; the seven-item "Blocked" section is retired. Engine work they created is
  scheduled below (R1c, R1b, D1); the rest confirm shipped behavior or are M3/playtest.

Current suite: **266 tests** (engine 240 + client 26), typecheck + build clean, purity green.

---

## Next batch — engine work from the Designer rulings (smallest first)

### R1c. Displacement skips the displacer's own square (carry-through) — UNBLOCKED (first)
Ruled in edge-cases (R1c, supersedes the amount-1 "stays put" interim). *AC: a Ram Charge
overshooting its target by exactly 1 now displaces the victim to the far side (past the
charger); the wall-blocked variant still yields the documented net-zero (last free square);
"no two units at rest on one square" never violated.*

**Spec Notes.** Files: `resolve.applyDisplacements` (when the computed landing square is the
displacement's own `attackerId`, advance one more along the same line, repeating while it's
the displacer's; else fall back to last-free-square), `dash.test.ts`. **⚠ UPDATE THE
EXISTING TEST:** `dash.test.ts:182` ("MV4… strikes the crossed enemy") asserts the victim
stays at `(2,2)` "nets zero (MV1-fix interim)"; under R1c that victim is carried to `(4,4)` —
change the expectation and the comment. Add a wall-blocked regression that keeps net-zero.
Out of scope: charge *damage* targeting (already R1a-shipped) and multi-displacement
vector-sum (CL2, deferred).

### R1b. Optional `chargeHits: "first" | "all"` on `AbilityDef` — UNBLOCKED
Ruled in edge-cases (R1b). *AC: `chargeHits` defaults to `"first"`; on `"all"` a damaging
`path` dash applies its effects to **every** enemy crossed (Kestrel's Tempest Run now sweeps
all); energy still once-per-use on ≥1 enemy; `validateAbility` rejects any value other than
the two literals and rejects the field on non-`path` shapes; a content test covers a `"all"`
charge hitting two lined-up enemies.*

**Spec Notes.** Files: `types.ts` (`chargeHits?` on `AbilityDef`), `validate.ts` (literal +
shape checks), `resolve.walkCharge`/`runDash` (collect all crossed enemies when `"all"`,
else `firstEnemy`), `data`-driven (no per-character code), `dash.test.ts` + `content.test.ts`.
`kestrel.json` already carries `"chargeHits": "all"` — no data change needed. Keep charge
*range* a step count (not parity cost), per the shipped model. Out of scope: applying `"all"`
to non-damage riders differently — riders follow the same crossed-enemy set.

### D1. Decoy entity (Wisp's Veil & Decoy) — UNBLOCKED (largest)
Ruled in edge-cases (R2). *AC: casting Veil & Decoy spawns a decoy at Wisp's square that
(a) expires end of next turn or when any damage / an enemy ending a move on its square
destroys it, emitting `decoyDestroyed`; (b) blocks nothing, triggers nothing, grants no
energy/kill when hit; (c) is rendered to the enemy team as Wisp. Tests: spawn+expiry timing,
destruction by damage and by move-onto, and "ability hitting only a decoy grants no energy."*

**Spec Notes.** Files: `types.ts` (`DecoyState {id,teamId,pos,expiresOnTurn}`,
`GameState.decoys`, `decoyDestroyed` TurnEvent), `resolve.ts` (spawn in Prep alongside the
Stealth effect; check decoys after `units` in damage + move-end resolution; tick expiry in
`endOfTurn`), `setup.ts` (init `decoys: []`), new `decoy.test.ts`, and `playback.ts` +
render for the reveal event (client). **Keep decoys OUT of `state.units`** — a separate list
means no phase loop / vision union / spawn picker / win check needs an "is this real?" guard.
Deterministic: append in unit order, remove by index. Out of scope: giving decoys HP or any
interaction beyond "any damage / move-onto destroys it."

### Content guardrails (bundle with the above; tiny) — UNBLOCKED
R4: a test asserting no `shape: "path"` ability resolves through the teleport branch (so a
refactor can't make Combat Roll wall-crossing). R7: a test asserting every `EFFECT_KIND`
appears in exactly one polarity row (total table). *AC: both tests present and green.*

### MS1-test (optional). Pure `nextDraft` reducer for the move/shoot toggle — UNBLOCKED
Builder-offered. Extract `selectAbility`/`selectMove`/`selectSprint` logic from `app.ts`
into a pure `nextDraft(action, draft)` and unit-test the toggle (ability↔move↔sprint
mutual-exclusivity; dash drops the move). *AC: reducer tested; `app.ts` calls it.*

## Deferred (not for v1 — do NOT build without a new decision)

- **CL1 — AR "Clashes" pass-through co-occupancy.** Our same-step-stop is deterministic and
  sufficient; no playtest demands AR-exact clashes. Stays PROPOSED in edge-cases.
- **CL2 — vector-sum displacement.** Motivation (Ram Charge net-zero) resolved by R1c; no
  other v1 driver. Revisit only if a kit ships ≥2 concurrent displacements on one victim.
- **E2 — unify cover corner convention with LoS.** Ruled acceptable; optional polish.

## M3+ — placeholder

21. Worker + Durable Object rooms; **format selection**; **lobby with team-seat + duplicate-
    pick validation (R3: unique within a team, mirrors across teams)**; per-player hidden
    submission merged into per-team orders; per-player timer + Time Bank; reconnect/replay;
    deploy to Pages + wrangler.

## Playtest / balance (not Builder-blocking)

- **Support anti-stall (R6).** Lumen + Thorn vs a double-Firepower comp at 2v2 — confirm the
  kill-leader tiebreak forces action; tune via the per-format turn limit, not the kits.
- Roster balance passes remain a Designer/playtest concern.

## Notes

- Research branch `claude/atlas-reactor-cards-research-n553wi` adds
  `docs/design/atlas-reactor-reference.md`; Designer/reference content, merges separately.
