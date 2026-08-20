# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit** — and a **bug fix ships with the regression test in that
same commit.** **A genuinely new mechanic gets a generic, reusable implementation** (golden rule #2).
**DRIVE THE REAL UI WIRING IN TESTS** (see the ⚠⚠ box). **Open/update a PR to `main` every session.**

> ⚠️ **`main` is LIVE** — a green push publishes. Deploy is set; QUOTA-RUNAWAY guards the quota. Keep green.

> ⚠️⚠️ **The bug class that keeps shipping green: "pure function passes, real UI broken."** WALL-CAST-FIX
> (top of this backlog) is the newest instance: WALL-ROTATE's engine + preview are correct and fully
> tested, yet the ability **cannot be cast**, because the ONE untested seam — the client building and
> submitting the order (`toUnitOrders` → lock-in → resolve) — drops the wall's rotation. **No client test
> drives select → click → lock-in → resolve for `warding_wall`.** Every fix below ships a test that drives
> **`app-harness.ts` end-to-end**, not the pure helper. If a test would still pass with the order-build
> unwired, it is the wrong test.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + Dev Notes batches 1–3 +
  AIM-PREVIEW-TRUE + DEATH-HANG.
- **PR #97:** WARDING-WALL (a new `wall` shape + `perTile` trap placement + a per-trap `triggers` list),
  BASTION-RAM-LINE (`chargeHits:"all"` + a landing marker), CD-BAND-DASH/BLAST/INVARIANT, DOWN-SEAT-SKIP.
- **PR #98 (docs):** the TRAP-TRIGGER ruling.
- **PR #99 (Builder session 9):** **TRAP-SHOVE-DEFAULT** (`DEFAULT_TRAP_ENTRIES` = all four; an ordinary
  mine now fires on a knock-through, the guard flipped, blink-past still inert — verified against
  TRAP-TRIGGER) and **WALL-ROTATE** (the wall aim now carries anchor **+** rotation; anchored-at-click,
  runs along the chosen cardinal; a four-button rotate row; ruled in edge-cases — WALL-ROTATE). *(WALL-ROTATE
  is correct in the engine and preview but exposed a client order-build bug — see WALL-CAST-FIX.)*
- **PR #100:** a character-art-pipeline doc (generation → Mixamo → weapons → VFX). Docs only.

Current suite: **2610 tests** (1347 + 961 + 302), typecheck clean, purity clean.

### Build order and dependencies

**WALL-CAST-FIX → RAM-LINE-PREVIEW-FIX**, then the **Path A** milestone (PLAYTEST → tuning → NET-E2E).
Both bug fixes are first and **blocking**: they gate the playtest — a playtest of Warding Wall and Ram
Charge is worthless while one cannot be cast and the other cannot be read. No dependency between them; do
them in the listed order (severity).

---

## Client bugs — the two abilities that don't work for a human (do first; they gate the playtest)

### WALL-CAST-FIX. Warding Wall cannot be cast — the client drops the rotation from the order (CLIENT, HIGH) — UNBLOCKED (first)
**Addresses Dev Note: "Aegis's Warding Wall does not cast successfully."** **Root cause found.** WALL-ROTATE
(PR #99) made a wall's aim require **both** an anchor square and a rotation step — the engine's `aimIsLegal`
for `'wall'` ends `... && isAimStep(aimStep)` (`resolve.ts`), so a wall order **with no step is refused**.
The client computes the rotation into `draft.aimStep` (`aimFor` `'wall'`) and shows the rotate row
(`isPlacedRotatable`), **but `toUnitOrders` only copies `aimStep` into the order when `isRotatable(ability)`
is true**, and `isRotatable` is `line || cone` only (`targeting.ts:176`, used at `:995`). A wall is
`isPlacedRotatable`, **not** `isRotatable`, so the rotation is **dropped at order-build**, the engine gets a
stepless wall, and refuses it → the wall never casts. The preview reads `aimFor` directly, so it draws
correctly and hides the bug.

*AC:*
- **A failing test, added first, driving the REAL controller end-to-end** (`app-harness.ts`): select
  Warding Wall the way the UI does, click a target square, (optionally pick a rotation), **Lock In**, and
  **resolve** — assert a 4-tile wall of traps is in the resolved state, anchored at the clicked tile,
  running in the selected (or default) direction. This must **fail on `main`** (the order has no `aimStep`,
  the engine refuses it, no wall appears) and pass after the fix.
- **The fix carries the step for a placed-rotatable shape.** In `toUnitOrders` (`targeting.ts:995`), gate
  the `aimStep` write on `isRotatable(ability) || isPlacedRotatable(ability)` (or simply on
  `isAimStep(draft.aimStep)` — the engine ignores a step on shapes that don't read one). A wall's chosen
  rotation reaches the engine.
- **A defaulted wall still casts:** a player who never touches the rotate row commits with `aimFor`'s
  default (`WALL_ROTATIONS[0]`), so the order carries that step and the wall lands.
- **The selected rotation is the one that lands:** picking a different arrow and committing produces a wall
  running that way (assert against the resolved trap tiles).

**Spec Notes.** Files: `packages/client/src/targeting.ts` (the `toUnitOrders` gate), tests in
`packages/client/test/` driving `app-harness.ts` through **lock-in and resolve** (not preview). **No engine
change** — the engine is correct; the client drops the field. Keep the existing preview tests green. The
real lesson to bank: `warding_wall` had 24 engine + a preview test and still could not be cast, because the
order-build seam had no coverage — this fix closes that seam for the wall for good. Out of scope: the wall's
geometry/mechanics (correct per WALL-ROTATE); other abilities.

### RAM-LINE-PREVIEW-FIX. Ram Charge does not preview as a line attack (CLIENT) — UNBLOCKED (after WALL-CAST-FIX)
**Addresses Dev Note: "Bastion's Ram Charge is still not a linear dash/attack preview."** The **engine is
correct** (`bastion.ram_charge` has `chargeHits:"all"`; `walkCharge` damages every enemy the path crosses).
The preview draws the route tiles (`covered`, `app.ts`) and the landing marker (the BASTION-RAM-LINE
addition), **but nothing marks the crossed ENEMIES as hit and no damage number shows along the line** —
`ram_charge` has no `impact` field, so `impactPreview`'s discs are empty, and there is **no client mirror of
`walkCharge`/`chargeHits`.** A real `line` attack lights its whole tile run (`lineSquares`) and
`previewNumbers` stamps every enemy on it; a `path` charge never reaches that path, so it reads as a
movement route, not an attack.

*AC:*
- **The preview reads as a line attack:** every enemy the charge path crosses is marked with its **15**
  damage (the same tell a `line`/blast attack shows — reuse that path, do not invent a second), **plus** the
  existing landing marker. A `chargeHits:"all"` dash previews **all** crossed enemies, not just the first.
- **A test driving the REAL preview** (`app-harness.ts`): with enemies along Bastion's charge line, aim Ram
  Charge and assert the preview reports **every** crossed enemy hit for 15 (and the landing marker present).
  Property-style (PREVIEW-NUMBERS-AUDIT): the previewed hit set == the set the engine's `chargeHits:"all"`
  resolution damages, for the roster.
- **A non-`chargeHits:"all"` dash is unchanged** (a first-enemy-only or teleport dash previews as before).

**Spec Notes.** Files: `packages/client/src/targeting.ts` (compute the crossed-enemy hit set for a
`chargeHits:"all"` path the way `walkCharge` does — **read the engine's derivation, don't recompute a
parallel one**), `packages/client/src/app.ts` (draw the damage tell on the crossed enemies, same layer a
line attack uses). Preview-only — the engine already hits everyone. Ties off session-7 OQ #3 for real. Out
of scope: the `chargeHits` engine mechanic (correct); Ram Charge's numbers/cooldown (correct); other dashes.

---

## Path A — validate before you build (the session direction; owner-chosen)

The game is feature-complete for a 2v2 duel and **deployed live**, but the recent mechanics (cooldown
bands, Warding Wall + rotation, Ram Charge's line, TRAP-SHOVE, DEATH-HANG, AIM-PREVIEW-TRUE) are
**unvalidated by real play**. Path A retires that risk before adding more.

### PLAYTEST (owner + humans; not a Builder code item) — AFTER the two bug fixes ship
A real **two-machine internet playtest** of the live deploy — ideally the **asymmetric 3-player 2v2**, the
least-exercised path. **Prerequisite:** WALL-CAST-FIX and RAM-LINE-PREVIEW-FIX merged first — otherwise two
abilities under test are unusable. Watch: does a mid-match death stay playable for both sides (DEATH-HANG);
do dashes at 4–5 and blasts at 3–4 improve the tempo; does the rotatable Warding Wall read and matter (and
is its ~7-tile reach too long — session-9 OQ #2); does Ram Charge's line read as an attack; does a
shove-into-trap play feel good (TRAP-SHOVE). **Output: a short list of felt problems → a tuning pass**,
mostly data (numbers), not engine.

### NET-E2E. Automated end-to-end networked test harness (SERVER + CLIENT) — FLAGGED, size TBD after playtest
The biggest latent risk: DEATH-HANG was a networking-wiring bug pure-function tests could not catch, and
session-9 OQ #4 (a committed wall's rotation across a replay) was "verified by reading the protocol, not a
two-client test" — the same gap. There is **no automated two-client coverage** of the networked loop (lobby
→ both clients submit → resolve → next turn → a death → reconnect → a rotated-wall order relayed). Path A's
infrastructure payoff. **Not fully specced** — its shape depends on what the playtest surfaces and a
Builder/owner call on the seam (two `app-harness.ts` controllers over a loopback transport, or the real
Durable Object in a test worker). Scope it into a full item after the playtest.

## Routed to Designer / flags

- **WALL-REACH (session-9 OQ #2, Designer).** After WALL-ROTATE, `warding_wall`'s far end can sit ~7 tiles
  from Aegis (anchor within 4, wall extends 4 along the cardinal); it was ~5 under the old centred geometry.
  No number changed and the Builder did not rebalance. **Designer/playtest call** whether `range` should
  come down. Ruled in edge-cases (WALL-ROTATE flag). Watch it in the playtest.
- **WALL-BLINK-ONTO (owner confirmation; session-9 OQ #3).** After TRAP-SHOVE-DEFAULT every mine bites a
  blink that lands on it, but the wall still does not (its authored *"a blink goes around it"*). This is now
  the *only* trap-trigger divergence. **Kept as authored; flag to owner** — one array entry (`teleport` on
  `warding_wall.triggers`) + flipping the *"blink onto a wall tile"* test aligns them if wanted.
- **Aegis has no cooldown'd Blast** (session-8 OQ #5) — **closed as intended** (owner "Aegis skill set is
  good"). **Aegis beam distinctness** (now a 3-wide lane). **Self-lethal recoil warning** (a design call,
  not scheduled). **Burn/regen pip glyphs** (art, a look on a real plate). **Warding Halo's dead `weaken`**,
  **trap count cap**, **inspect-panel chips hoverable**, **chase-preview detour**, **Solar Flare DoT
  ceiling**, **Thorn mine carpet** — unchanged flags.

## Flagged future (not scheduled)

- **All-seats-downed resolves on the timer, not at once** (session-8 OQ #4) — rare, safe; schedule only
  with the resolve-loop guard specified. **M3-REMATCH**, **IDLE-KICK**, **LOBBY-TEAM-CHOICE** (room
  lifecycle — the natural follow to NET-E2E). **same-turn-buff preview**, **route-around-bodies dash impact
  preview** — unchanged.

## Observed-not-requested / playtest (not Builder-blocking)

- Folded into **Path A / PLAYTEST**: exercise a death; shove-into-trap combos; the cooldown-band feel; the
  rotatable Warding Wall and its reach; Ram Charge's line; the new HUD; AIM-PREVIEW-TRUE; Ravok's recoil.
