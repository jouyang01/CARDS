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
WIRING IN TESTS.** **PR to `main` every session.**

> ⚠️ **`main` is LIVE** — keep `npm test` green. The Playwright e2e/render suite is down to **~3 red**
> (RENDER-SUITE-GREEN-3 closed the rest); RENDER-SUITE-GREEN-4 + VFX-FLASH-VERIFY finish it. Pre-merge
> signal, not a release gate (Pages gates on CI, which is green).

> 🎨 **Colour is viewer-relative friend/foe (edge-cases FOF-COLORS, RULED).** Self blue / ally green / foe
> red on units; friendly blue on committed overlays; hot-seat's whole team is self (green is networked-only).
> Art/VFX/camera are **pure view** — no engine change; an apparent one is an `ENGINE ASK`.

## ✅ COMPLETE

- Everything through the map/COVER-EDGE cycle + the TTK package + INTERCEPT-GUARD + DEATH-HANG-3.
- **PRs #167–#174 (session 17 + playtest):** **FOF-UNITS** + **FOF-OVERLAYS** (viewer-relative friend/foe;
  ruled FOF-COLORS), hardened by a **same-day owner playtest** — the lock-in green flip, the white edge
  bars, the bulky ring, and **FOF-LOCAL** (hot-seat identity: self is the person) all fixed with regression
  tests proven against the unfixed code; **PAN-RELEASE-PLAYBACK**, **RENDER-IDLE-QUIET** +
  **SETTLED-BOARD-INVARIANT**, **RENDER-SUITE-GREEN-3** (most of the map-rebuild regressions); MODEL-PRELOAD
  (enemy models), a value-budget/rim-light render pass, prop variety, CHARACTER_PLAYBOOK. **Engine
  untouched.**

Current suite: **3292 unit tests** green, typecheck clean, purity clean. Playwright render suite **~3 red**
(FOG-ZORDER aim, the single-pad test, VFX-FLASH — see below).

### Build order and dependencies

**VFX-FLASH-VERIFY → RENDER-SUITE-GREEN-4 → FOF-OUTLINE.** VFX-FLASH-VERIFY leads (it may be a real hit-feel
bug, not test drift); RENDER-SUITE-GREEN-4 closes the last render tests with the re-specs ruled below;
FOF-OUTLINE completes the FoF ask if the playtest wants it. All client/test — no engine work. FOF-OVERLAY-HUE
is a **Designer** flag, not a Builder item until the hue is chosen.

---

## MED — a hit must read as a hit (possible real regression)

### VFX-FLASH-VERIFY. Confirm the victim flash lands on screen (CLIENT, reproduction-first) — UNBLOCKED (first)
**Addresses Builder session-17 OQ #4.** `e2e/vfx.spec.ts:71` (VFX-FLASH-ON-SCREEN) measures no localised
brightness spike when a hit lands — best spike 165 against a floor of 800, lit-pixel counts flat across the
resolution (6670 → 3544 → ~6600, a step change in *scene* brightness, not one victim lighting and releasing).
The flash's decision (`vfx.ts`), delivery (`vfx-wiring`), material (`detach-materials`) and paint
(`paint-flash`) are each unit-tested; the *unoccluded-on-screen* inch is exactly what this catches, and it
says nothing spiked. **This is NOT obviously test drift like its render-suite neighbours** — it may be a real
regression. *AC:*
- **Diagnose first, through the film harness** (which now aims like a player): does the victim flash actually
  appear as a localised bright spike on the hit unit during resolution, or not?
- **If it's a real bug** (the flash occluded, the paint not reaching the lit mesh, or a later render pass —
  the value-budget/rim-light or ACES revert — clamping it away): fix it so a landed hit produces a visible,
  localised flash, and make the e2e assert a **local** spike on the victim (not global scene brightness).
- **If it's test drift** (the flash is visible but the assertion measures the wrong thing): fix the
  assertion to sample the victim's own pixels for a spike, and say so.

**Spec Notes.** Files: `packages/client/src/vfx.ts`/`renderer3d.ts` (only if the flash is genuinely not
landing), `packages/client/e2e/vfx.spec.ts` (the measurement). **Suspect the recent render passes first** —
the value-budget, the tinted rig/rim light, and the ACES-tone-mapping revert all moved scene luminance and
any could have swallowed a per-unit emissive spike. Do not "fix" the test into passing over a flash that
isn't there — the whole point of the impact work is that a hit reads as a hit. Out of scope: the other VFX
steps; the flash's unit-tested internals (correct).

---

## MED — close the render suite

### RENDER-SUITE-GREEN-4. The last render tests, re-specced to the moved board (TEST INFRA) — UNBLOCKED
**Addresses Builder session-17 OQ #3 + the FOG-ZORDER finding.** Two tests are "a suite written against a
board that framed everything, asked to work on one where the camera and the map both moved" — they need
re-specs, not re-points, and the Analyzer's choices are ruled here:
- **The single-pad test (RENDER-COVERAGE, "a pad marker survives the next turn boundary"):** Proving Grounds
  has one Health pad at (8,1) and a consumed pad drops to 0.14 opacity, below `isPadTeal`'s floor, so "still
  drawn" is unobservable. **Re-spec the assertion to "the pad re-arms on its `everyTurns` cycle"** — the
  actual pad behaviour, map-agnostic. (Not moving it to Iron Basin for its pad pairs — that couples the test
  to one map's layout.)
- **FOG-ZORDER's aimed half:** `bestAimed` sits at 1 (floor 20) because the nearest lit brush is at the very
  edge of a turn-1 reach and most brush is fogged on the opening frame — no candidate choice fixes it.
  **Re-spec to DRIVE a character toward a brush band over a turn or two, then measure** the aim overlay's
  z-order against brush from range. (The coarse-floor half already passes on Iron Basin at 4v4.)

*AC:* both tests pass on `main` by asserting the real behaviour on the current maps; the render suite is
green (VFX-FLASH is its own item above). **Spec Notes.** Files: `packages/client/e2e/render.spec.ts`.
Test-side only — production behaviour is correct. Out of scope: VFX-FLASH (VFX-FLASH-VERIFY); new visual
assertions.

---

## MED — complete the FoF read (the owner asked for outlines)

### FOF-OUTLINE. The character body/rim takes its friend/foe colour (CLIENT) — UNBLOCKED (after the render items)
**Addresses Builder session-17 OQ #1 and the FoF Dev Note's "blue/red **outline highlights**."** FOF-UNITS
shipped the foot ring + nameplate but **not** the model outline — `emissive` is the victim flash's, and an
inverted-hull outline is per-mesh geometry on an already-slow render path. *AC:* a unit's **body reads its
FoF colour** (self blue / ally green / foe red) as an outline/tint, without conflicting with the victim
flash or adding per-mesh geometry. **Spec Notes.** The clean technique is to **tint the achromatic rim light**
shipped in `5e022a8` by the unit's FoF colour — the rim already outlines the silhouette, costs no new
geometry, and does not touch `emissive`. Reuse FOF-UNITS' viewer-relative colour resolver (one source of
truth). **Confirm in the playtest first** whether ring + nameplate already read clearly enough — if so, this
can wait; if the owner wants the fuller AR outline, the rim tint is it. Out of scope: `emissive`-based
outlines (reserved for the flash); a second inverted-hull pass. **Determinism guard:** pure view, no path
into state.

## Routed to Designer / Owner / flags

- **FOF-OVERLAY-HUE (Designer, from OQ #2).** The friendly committed-overlay blue is the same hue as the
  `REACH` range envelope, separated only by weight. If an ally's committed plan under a live aim reads
  ambiguous on a real board, the Designer picks a distinct friendly hue (a teal or a different blue). Playtest
  question first; not a Builder item until the hue is chosen.
- **The map lane owns e2e render tests it moves.** Proving Grounds broke the render suite and it took two
  Analyzer cycles to close — note for the map lane: a map reshape should re-point its own coordinate/format-
  coupled render tests in the same change, as COVER-EDGE shipped its engine tests.
- **Camera-follow-on-select; zoom beyond wheel; intent badge name vs digit; ASSET-BUDGET caps + CLIP-DEDUP
  (§18); 300 kB JS budget headroom; CHASE-SECOND-CLOCK; NET-E2E-EXPAND-2; DO-E2E; RAVOK-RECOIL; Warding Wall
  power; Skim/Chain Hook; FRAG-SELF zoning; WALL-BLINK-ONTO; INTERCEPT shield lever; Aegis beam distinctness;
  self-lethal recoil warning; burn/regen pip glyphs; Warding Halo dead `weaken`; trap count cap; inspect
  chips hoverable; Solar Flare DoT ceiling; Thorn mine carpet** — unchanged flags.

## 🎮 PLAYTEST — the standing validation loop (owner + humans)

The FoF work has already had one round; a second confirms **FoF reads cleanly in a real mirror** (and
whether ring+nameplate suffices without FOF-OUTLINE, and whether friendly-blue vs range-blue is legible —
FOF-OVERLAY-HUE). Also still owed a live look: **DEATH-HANG-3** in a networked game, the **Proving Grounds
map + COVER-EDGE** (do half-walls read), the character-centred camera + VFX impact, and the balance
watch-list (TTK burst, 20-turn pacing, Skim/Chain Hook/Lumen, RAVOK-RECOIL, clock-vs-kills). Output: felt
problems → Dev Notes.

## Flagged future (not scheduled)

- **The rest of the VFX pipeline** (projectiles/casts/status VFX; more ambient motion). **The other eight
  characters' art** (CHARACTER_PLAYBOOK now records what building Aegis taught; gated on CLIP-DEDUP).
  **M3-REMATCH, IDLE-KICK, LOBBY-TEAM-CHOICE**; **same-turn-buff preview**; **route-around-bodies dash impact
  preview**.
