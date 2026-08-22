# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit** — bug fixes ship the regression test in the same commit.
**A genuinely new mechanic gets a generic, reusable implementation** (golden rule #2). **DRIVE THE REAL UI
WIRING IN TESTS** (`app-harness.ts` / the NET-E2E harness end-to-end, not the pure helper). **PR to `main`
every session.**

> ⚠️ **`main` is LIVE** — a green push publishes. Keep the **unit** suites green (`npm test`). The
> **Playwright e2e/render suite is separately RED** and pre-existing — RENDER-SUITE-GREEN fixes it; until
> then it is a broken signal, not your regression.

> 🎨 **Art / VFX reference (owner Dev Note 2026-08-21):** anything touching how a unit is drawn/animated —
> read **`docs/ART_PIPELINE.md`** (esp. §18, the clip-dedup decision the asset budget waits on) and the
> map work in **`docs/MAP_PIPELINE.md`**. **No engine change** — an apparent one is an `ENGINE ASK`.

## ✅ COMPLETE

- Everything through session 13 + the TTK package + INTERCEPT-GUARD.
- **PR #130 (session 14):** **DEATH-HANG-2** (an all-down sudden-death turn resolves itself),
  **INTERCEPT-LANDING-CHOICE** (the player picks Aegis's landing square), **CHASE-AUDIT** (the fog fallback
  now records `lastKnown` at the top of `runMove`, not just the turn boundary), **TEAMMATE-PLAN-VISIBLE**
  (a relayed teammate's committed plan on your board, read-only in `teamPlans`), **WALL-SLOW** (Warding
  Wall slows), **NAMEPLATE-DEPTH** (the plate draws over the model), **ASSET-WEIGHT-BUDGET** (a per-char
  1.5 MB + total 12 MB CI cap).
- **PR #122–#131 (render):** MAP-THEMES / FOG-SHADOW / AOE-CLASH / OVERLAY-BY-THEME / BOARD-LIT /
  SCENE-DIORAMA; Aegis's rigged, animated model. `theme-inert.test.ts` pins golden rule 1. **Engine
  untouched.**

Current suite: **2945 unit tests** (1617 + 1026 + 302) green, typecheck clean, purity clean. The
**Playwright render suite is red** (9/32, pre-existing — RENDER-SUITE-GREEN).

### Build order and dependencies

**DEATH-HANG-3 → TEAMMATE-MOVE-VISIBLE → RENDER-SUITE-GREEN → VALIDATE-GUARD-IMPACT.** No hard
dependencies; the order is severity. DEATH-HANG-3 is the game-breaker and comes first.

---

## CRITICAL — the death hang, the owner's exact scenario

### DEATH-HANG-3. A match-ending kill in sudden death must show the winner, not freeze (CLIENT/SERVER, CRITICAL) — UNBLOCKED (first)
**Addresses Dev Note: "Explanation of the Death Hang: Ravok died to a Lumen attack. Timer Vanished. The
'winning' team's lock in froze."** DEATH-HANG-2 fixed a turn **nobody** can take (a double KO leaves both
teams down, the tie holds, play continues). The owner's scenario is different: a **single** kill (Lumen →
Ravok) makes the killer's team **lead**, which in sudden death **ends the match** (SUDDEN-DEATH ruling) —
and DEATH-HANG-2 does nothing once `status !== 'active'` (`hub.ts:650`). The server clears the clock at
match end (`hub.ts:513` — the *"Timer Vanished"*), so the remaining defect is the **winning client not
transitioning to the end/victory screen** when the finishing turn also downs a seat. Ruled in edge-cases
(SUDDEN-DEATH → "a win and a death on the same turn: the match END wins").

*AC:*
- **A NET-E2E test that reproduces the owner's scenario:** a networked match driven into **sudden death**
  (turn past `turnLimit`, kills tied), then a resolution where **one team lands a match-ending kill on the
  other** (the killed unit's seat goes down **and** the killer's team crosses the win condition on the same
  turn). Assert the **winning** client reaches the end/victory screen — the game-over state, no live Lock
  In, no orphaned Decision window — and the **losing** client reaches the defeat screen. Cover both the
  standard-4-player and asymmetric-3-player shapes.
- **The fix makes that scenario end cleanly.** If the shipped code already does, the test **locks** it; if
  it freezes, fix the client's game-over transition for a turn that ends the match while downing a seat.

**Spec Notes.** **Reproduction FIRST — do not assume DEATH-HANG-2 covers this; it is a different turn
state** (match finished, not all-down). Files: `packages/client/src/app.ts` (the resolution-playback →
game-over path; check whether a downed-seat `holdDownedSeat()`/`openSeat()` can pre-empt the `gameEnd`
event when both land on the same turn — the end screen must win), `packages/server/src/hub.ts` (confirm a
finished match opens **no** new window and broadcasts the end to **both** teams). **Analyzer leads:** the
suspect is the order in which the client processes a resolution that carries **both** a `death`/`downed`
outcome and a `gameEnd` — if the downed-hold branch runs before the game-over branch, the winner sees a
hold instead of victory. Reuse the DEATH-HANG-2 harness (`death-hang-2.test.ts` fixtures reach sudden death
already). Out of scope: the SUDDEN-DEATH *ruling* (correct); DEATH-HANG-2's all-down path (correct — keep
its tests green). **If the reproduction cannot be made to fail, report that** — it means the shipped code
already handles it and the owner saw a pre-DEATH-HANG-2 build; say so rather than inventing a fix.

---

## MED — ally movement visibility

### TEAMMATE-MOVE-VISIBLE. You see a teammate's move route and chase (CLIENT) — UNBLOCKED
**Addresses Dev Note: "We need to be able to see ally's movement commands as well to know where they're
moving."** TEAMMATE-PLAN-VISIBLE draws a teammate's move route (`theirs.movePath`, `app.ts:1481`) **only for
a relayed plan** — the guard at `app.ts:1478` (`if (relayed === undefined) continue`) skips the route for a
**locally-locked** teammate (hot-seat), and a **chasing** teammate shows nothing (a chase has no plan-time
route). *AC:*
- **A locked teammate's move route draws for both local and relayed plans** — in hot-seat, locking your
  first character with a move and switching to the second shows the first's route; networked, a relayed
  move shows (already works — keep it).
- **A chasing teammate shows a chase indicator** — a link/line from the teammate to the enemy they are
  chasing (the chase target is known at plan time even though the route is not), so "this ally is going
  after that enemy" reads on the board.
- **A test through the real wiring** for both: a locked local move is visible; a relayed move is visible; a
  chasing teammate shows the chase link.

**Spec Notes.** Files: `packages/client/src/app.ts` (the teammate loop, `~1458–1491` — drop/relax the
`relayed === undefined` gate for the **route** so a locally-locked teammate's `movePath` draws too; add the
chase link from `theirs.chaseTargetId`). The route already routes through `draftFromOrders`/the local
draft, both of which carry `movePath` and `chaseTargetId`. Reuse `drawPaths`/the `teamPath` layer — do not
add a layer. **Builder OQ #3 folds in:** a relayed route is drawn as the router's path, not the teammate's
clicked corners — acceptable, do not chase pixel parity. Out of scope: showing **enemy** movement (hidden —
golden rule #5); the ability-area half (shipped and correct).

---

## Test infra — restore the render signal

### RENDER-SUITE-GREEN. The Playwright e2e/render suite is green again (TEST INFRA) — UNBLOCKED
**Addresses Builder session-14 OQ #6.** The suite is RED on `main` (9/32), pre-existing (verified against a
`4da3c19` worktree), so it cannot tell anyone whether they broke rendering — the state RENDER-CHECKS-GREEN
existed to end. *AC:* the Playwright render suite passes on `main`; the fixes are to the **tests** (or to
real render regressions if any of the four non-viewport failures turn out to be real), not to production
behaviour changed to satisfy a stale assertion. **Spec Notes.** The Builder diagnosed the shape: the four
**UI-VIEWPORT** failures are a **stale-index test bug** — `controls.count()` is read once, then
`controls.nth(i).boundingBox()` blocks the full 60 s when the HUD rebuilds mid-loop and index `i` is gone
(re-query per iteration, or snapshot the handles); that 60 s hang is most of the 26-minute runtime. The
other four are **timeouts inside `resolveTurn`'s wait loop** (the fogged opening frame, UI1-fix, the
resolved-turn readout, STEALTH-CONFIRM) and want their own look — decide per failure whether the assertion
drifted (e.g. under MAP-THEMES/FOG-SHADOW/OVERLAY-BY-THEME, which moved real colours) or the wait is racing.
MOVE-SPRINT-FIRST is a cascade — recheck it once the others pass. **This is a pre-merge signal, not a
release gate** (RENDER-VERIFY, review 2026-08-25), so it does not block other work — but a green baseline is
the point. Out of scope: rewriting the suite; adding new visual assertions.

---

## LOW — enforce a shipped ruling

### VALIDATE-GUARD-IMPACT. `validate.ts` refuses `guard` alongside `impact` (VALIDATION) — UNBLOCKED
**Addresses Builder session-14 OQ #1.** Ruled in edge-cases (a `guard`+`impact` ability would hand a guard
to every ally in the blast — plural bodyguarding the redirect's "amount = what would have reached *the*
ally" language does not describe), but not yet enforced. *AC:* `validateAbility` refuses an ability carrying
both a `guard` effect and an `impact` block (message names both fields); a content test asserts no shipped
ability trips it and that a synthetic one does. **Spec Notes.** One check + a test, mirroring how
`wallLength`-off-a-wall is refused. Nothing in `data/` violates it today — this is a guard against a future
kit, so it is LOW and non-blocking. Out of scope: the `guard` mechanic (correct).

## Routed to Designer / Owner / flags

- **ASSET-BUDGET numbers want owner ratification (Builder OQ #2).** 1.5 MB/character and 12 MB total are
  Builder estimates from Aegis + `ART_PIPELINE.md` §18's arithmetic; **decide §18 (clip dedup) and these
  two caps together** — Option A drops both by ~1.2 MB and makes the budget tighter and more useful.
- **CLIP-DEDUP decision (owner/Designer, §18) — still open, still wants deciding before the other eight are
  rigged** (retrofitting re-exports all of them).
- **300 kB JS budget headroom is stale** (233 kB now, 1.29×). Ratchet, raise, or hold-and-code-split when
  it trips — a deliberate call, not urgent.
- **CHASE-SECOND-CLOCK (design, from Builder OQ #4) — flagged, not scheduled.** If a playtest shows the
  chase miss is a chaser pursuing a *chasing* target (not the stale-`lastKnown` case CHASE-AUDIT fixed), the
  fix is a second chase clock (chased chasers resolve first). Watch it before building it.
- **NET-E2E-EXPAND-2 (flagged)** — the still-uncovered networked scenarios (per-player timer over the wire,
  disconnect during playback, reconnecting-seat handoff). DEATH-HANG-3 takes the sudden-death-end slice.
- **RAVOK-RECOIL punishing (playtest, from BOTPLAY-SWEEP)**; **DO-E2E; Warding Wall power; Skim 30 / Chain
  Hook 23; FRAG-SELF zoning; WALL-BLINK-ONTO; INTERCEPT shield 18→14 lever; Aegis beam distinctness;
  self-lethal recoil warning; burn/regen pip glyphs; Warding Halo dead `weaken`; trap count cap; inspect
  chips hoverable; Solar Flare DoT ceiling; Thorn mine carpet** — unchanged flags.

## Flagged future (not scheduled)

- **The rest of the art pipeline** — the other eight characters (gated on CLIP-DEDUP); hitstop/flash/shake
  VFX; map props + ambient motion (MAP_PIPELINE phase 3). **M3-REMATCH, IDLE-KICK, LOBBY-TEAM-CHOICE**;
  **all-seats-downed timer-resolve** (superseded by DEATH-HANG-2 for the reachable case); **same-turn-buff
  preview**; **route-around-bodies dash impact preview**.

## Observed-not-requested / playtest (not Builder-blocking)

- Once DEATH-HANG-3 makes a sudden-death finish survivable, the standing watch-list continues (TTK burst
  goal, 20-turn pacing, Skim/Chain Hook/Lumen numbers, wall power, RAVOK-RECOIL, clock-vs-kills). Builder
  OQ #3's relayed-route-shape and the FOG-SHADOW/AOE-CLASH/OVERLAY-BY-THEME map look also want a human eye.
