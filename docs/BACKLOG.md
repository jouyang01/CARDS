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

> ⚠️ **`main` is LIVE** — a green push publishes. Keep the **unit** suites green (`npm test`). The
> **Playwright e2e/render suite is 3/32 red** (known-real, not your regression) — RENDER-SUITE-GREEN-2
> closes them. It is a pre-merge signal, not a release gate (RENDER-VERIFY, review 2026-08-25).

> 🎨 **Art / VFX / camera reference (owner Dev Note 2026-08-21):** anything touching how a unit is
> drawn/animated or how the board is framed — read **`docs/ART_PIPELINE.md`** and **`docs/MAP_PIPELINE.md`**.
> **No engine change** — an apparent one is an `ENGINE ASK`. The camera is a **pure view**: it must never
> read into or write game state.

## ✅ COMPLETE

- Everything through session 14 + the TTK package + INTERCEPT-GUARD + the first-playtest six.
- **PR #135 (session 15):** **DEATH-HANG-3** (the real death-hang: `resolveOutcome` returns before
  `draft.turn += 1`, so the finishing state reused its turn number and `net-boot.ts`'s `turn <= played`
  gate dropped the **last resolution of every networked match** — fixed client-side with a latch, engine
  untouched), **TEAMMATE-MOVE-VISIBLE** (an ally's route in the movement colour + a fog-safe chase link +
  the intent badge names the ability), **VALIDATE-GUARD-IMPACT** (`validate.ts` refuses `guard`+`impact`),
  **RENDER-SUITE-GREEN** (9 red → 3; the UI-VIEWPORT stale-index hang and the framing check both retired).
- **PR #133–#138 (render):** GRAIN (per-tile + within-tile, achromatic), AMBIENT-FREEZE (the stillness
  hook, ahead of its consumer), MOVE-NO-BANNER-BEAT, on-demand rendering (wired, left off), the sky-ramp
  guard. **Engine untouched.**

Current suite: **2981 unit tests** green, typecheck clean, purity clean. Playwright render suite **3/32 red**
(known-real — RENDER-SUITE-GREEN-2).

**DEATH-HANG is resolved pending an owner playtest** — DEATH-HANG-3 fixed the match-wide cause with a
NET-E2E regression. Confirm in the next networked game before it is called closed.

### Build order and dependencies

**CAMERA-CONTROLS → RENDER-SUITE-GREEN-2.** No dependency between them; CAMERA-CONTROLS is first because the
owner marked the Dev Note IMPORTANT. Both are client/test — no engine work this session.

---

## HIGH — the owner's camera ask (marked IMPORTANT)

### CAMERA-CONTROLS. Pan the camera, and auto-centre on the active character (CLIENT) — UNBLOCKED (first)
**Addresses Dev Note: "IMPORTANT: Need to add Camera panning and the auto camera center should be on the
character, not the board."** Two gaps, both confirmed: `renderer3d.ts` has orbit + wheel-zoom but **no pan
gesture**; and the auto-camera centres on the **centroid of all own units** (`fitCamera` =
`focusOn(ownUnits, 1)`, `app.ts:710`) while `selectUnit` (`app.ts:1218`) never recentres and `fitBoard()`
(`app.ts:2605`) centres on the map middle — so the frame reads as "the board". BOARD_ZOOM (the board runs
off the viewport) makes both matter more.

*AC:*
- **Camera panning** — a player gesture translates the view across the board plane (Builder picks the
  gesture — right-drag or middle-drag or two-finger, distinct from orbit's left-drag and past `DRAG_SLOP`);
  the pan is **clamped** so the board never leaves the frame entirely (board extent + a margin); it composes
  with orbit and zoom; and, like orbit, **taking manual control suspends the auto-camera** until a recentre
  (the existing auto-vs-manual model — `orbitEnabled()` gating `fitCamera`). A **recentre affordance**
  returns to the auto framing (reuse the skip/`focusOn` reset already at `app.ts:2331`).
- **Auto-centre on the active character** — during planning, the auto-camera centres on the **selected**
  character, not the all-units centroid and not the board: `selectUnit` recentres (`focusOn([unit.pos], 1)`,
  eased), and switching characters re-centres on the new one. Resolution still **follows the action**
  (`focusSquares`, unchanged). A downed/hold seat and the end screen keep their current framing.
- **Tests through the real wiring** (`app-harness.ts` + the render harness where feasible): selecting a
  character centres the camera on it; a pan gesture moves the view and is clamped at the board edge; a pan
  suspends the auto-camera and the recentre restores it; **the camera never mutates game state** (a
  determinism guard — same orders resolve identically regardless of camera position/pan/zoom).

**Spec Notes.** Files: `packages/client/src/renderer3d.ts` (the pan gesture + clamp + a `panBy`/target
offset on the camera rig; keep it beside orbit in the pointer handler, gated on the button/modifier chosen),
`packages/client/src/app.ts` (recentre on `selectUnit`; point `fitCamera`/the planning auto-frame at the
selected unit rather than `ownUnits()` centroid; audit the `fitBoard()` call at `~2605` — replace with a
character/action-centred focus where it is the planning/turn view, leave it only where "the whole board" is
genuinely wanted). **Gotchas:** pan and orbit share a pointer, so the gesture split must be unambiguous
(button or modifier, not a heuristic that steals orbit's drag); the auto-camera eases via `focusOn`, so a
recentre-on-select must not fight a resolution follow mid-playback (recentre only while planning);
`prefers-reduced-motion` viewers should get an instant recentre, not a long tween (AMBIENT-FREEZE precedent).
**Out of scope:** changing orbit or zoom behaviour; a minimap; saving camera state across turns (each
planning view recentres on the active character — that is the ask). **The camera is view-only** — no game
rule, event, or resolved-state may depend on it.

---

## MED — finish the render signal

### RENDER-SUITE-GREEN-2. The last 3 render failures, and the `same()` idiom they exposed (TEST INFRA) — UNBLOCKED
**Addresses Builder session-15 OQ #1.** RENDER-SUITE-GREEN took the suite 9 → 3; the last three are
**real** (not budget or staleness — the timeouts were hiding them). *AC:* the Playwright render suite is
green on `main`, with each of the three addressed at the right layer:
- **UI1-fix / the `same()` byte-equality idiom (6 callers).** Confirmed **not** a production bug — the
  committed aim does **not** move; byte-equality is unusable here because temporal AA jitters ~2.7k of 205k
  pixels frame-to-frame, deterministically, with no input. **Re-spec the idiom:** instead of comparing whole
  frames, **count and locate the aim overlay's own orange pixels and assert its centroid does not move** (a
  relocated overlay is exactly what the test is for; noise has no centroid shift). Apply it across the six
  `same()` callers, and **re-enable AMBIENT-FREEZE's frame-equality guard on the same footing** (it has been
  unable to work for as long as this has been true — a still scene and a moving one are both "different" by
  byte-equality).
- **The floated-readout failure (`render.spec.ts:284`).** *"Needs one look"* — a sampling race against
  playback, or UI5's floating readout genuinely not appearing. Diagnose; fix the test race **or** the real
  missing readout.
- **STEALTH-CONFIRM (`render.spec.ts:811`).** A click waits on `.hud-skip` that never becomes visible — the
  playback row is not up when the test expects it. Diagnose; fix the test timing **or** the real
  playback-row bug.

**Spec Notes.** The `same()` rework is the substance and the reason this is the Analyzer's to spec, not a
unilateral test edit — it changes the shared idiom, not one assertion. **Do not** relax `same()` with a
pixel tolerance (loose enough to absorb the jitter, it can no longer tell a relocated overlay from noise —
the Builder tried and removed it). Keep production behaviour fixed: a failure that measures as a **test**
flaw is fixed in the test; only the readout/STEALTH cases might be real, and each gets a look before it is
called either way. **Out of scope:** new visual assertions; the retired UI-VIEWPORT framing check (correctly
gone — the board overflows by design). This is a pre-merge signal, so it does not block other work, but a
green baseline is the point — a suite red before you start cannot tell anyone if they broke it.

## Routed to Designer / Owner / flags

- **Intent badge shows the ability name, not a digit (Builder OQ #3) — owner confirmation.** Kept (it is
  clearer, and drives the "make it VERY CLEAR what your ally is doing" note); it also changed the player's
  **own** badges. One line reverts to the digit if the owner prefers it; `slot` stays on the badge either
  way.
- **ASSET-BUDGET numbers (1.5 MB/char, 12 MB total) + CLIP-DEDUP (§18)** — still awaiting the owner/Designer
  decision; decide the two caps together, before the other eight characters are rigged.
- **300 kB JS budget headroom stale** (233 kB, 1.29×) — ratchet/raise/hold-and-split, a deliberate call.
- **CHASE-SECOND-CLOCK (design, flagged)** — only if a playtest shows the chase miss is the chasing-target
  case (CHASE-AUDIT fixed the stale-`lastKnown` one). **NET-E2E-EXPAND-2 (flagged)** — timer over the wire,
  disconnect during playback, reconnect handoff. **DO-E2E (flagged).**
- **RAVOK-RECOIL punishing (playtest); Warding Wall power; Skim 30 / Chain Hook 23; FRAG-SELF zoning;
  WALL-BLINK-ONTO; INTERCEPT shield 18→14 lever; Aegis beam distinctness; self-lethal recoil warning;
  burn/regen pip glyphs; Warding Halo dead `weaken`; trap count cap; inspect chips hoverable; Solar Flare
  DoT ceiling; Thorn mine carpet** — unchanged flags.

## Flagged future (not scheduled)

- **The rest of the art pipeline** — the other eight characters (gated on CLIP-DEDUP); hitstop/flash/shake
  VFX; MAP_PIPELINE phase 5 (props + the first ambient motion — the AMBIENT-FREEZE hook now makes it safe to
  attempt one element at a time). **M3-REMATCH, IDLE-KICK, LOBBY-TEAM-CHOICE**; **same-turn-buff preview**;
  **route-around-bodies dash impact preview**.

## Observed-not-requested / playtest (not Builder-blocking)

- Confirm DEATH-HANG-3 in a live networked game (the match now reaches its end for the winner). The standing
  watch-list continues (TTK burst goal, 20-turn pacing, Skim/Chain Hook/Lumen, wall power, RAVOK-RECOIL,
  clock-vs-kills) — and now the camera: does character-centred framing + pan read better than the board
  frame once CAMERA-CONTROLS ships.
