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

> ⚠️ **`main` is LIVE** — a green push publishes. Keep `npm test` green. **The Playwright e2e/render suite is
> GREEN again** (RENDER-SUITE-GREEN-2) — keep it that way; it is a pre-merge signal, not a release gate.

> 🎨 **Art / VFX / camera reference (owner Dev Note 2026-08-21):** anything touching how a unit is
> drawn/animated, how a hit reads, or how the board is framed — read **`docs/ART_PIPELINE.md`** and
> **`docs/MAP_PIPELINE.md`**. **No engine change** — an apparent one is an `ENGINE ASK`. The camera and all
> VFX are **pure view**: seeded, display-only, no path back into game state (the shake-into-`target`, not
> `centre`, precedent).

## ✅ COMPLETE

- Everything through session 15 + the TTK package + INTERCEPT-GUARD + the whole first-playtest set +
  DEATH-HANG-3 (the match-wide final-resolution drop).
- **PR #145 (session 16):** **CAMERA-CONTROLS** (a clamped pan gesture via `camera-pan.ts` + the auto-camera
  frames the **selected character**, not the roster centroid), **RENDER-SUITE-GREEN-2** (the `same()` idiom
  re-specced to an aim-overlay **centroid** assertion; the suite is green), **FOG-ZORDER**, **RENDER-ON-DEMAND**
  (the dirty-flag loop — shipped wired + tested; on-demand is now the default).
- **PR #140–#146 (VFX + render):** **impact** — hitstop, victim flash, screen shake (deterministic, seeded
  by `${unitId}@${t}`, display-only) with its pixel verification closed (`paint-flash`, a player-aiming film
  harness); the `SkeletonUtils` shared-material fix (`detach-materials`); camera easing in seconds.
  **Engine untouched.**

Current suite: **3052 unit tests** green, typecheck clean, purity clean, Playwright render suite green.
Engine src unchanged for two sessions.

### Build order and dependencies

**PAN-RELEASE-PLAYBACK → RENDER-IDLE-QUIET → SETTLED-BOARD-INVARIANT.** All client/test — no engine work.
SETTLED-BOARD-INVARIANT tests the behaviour RENDER-IDLE-QUIET completes, so it comes after it. No critical
bugs and no Dev Notes this session: this is a **polish + perf** batch, and the owner's **PLAYTEST** of the
new camera/VFX/DEATH-HANG-3 runs alongside.

---

## Camera — the resolution-playback ruling

### PAN-RELEASE-PLAYBACK. Resolution playback follows the action; a planning pan releases (CLIENT) — UNBLOCKED (first)
**Addresses Builder session-16 OQ #1.** Today a planning-time pan **survives** into resolution (`panned` is
cleared only by Recentre or the Auto toggle), so the resolution's own `focusOn` calls — the ones that follow
each actor — are frozen out, and a player who panned away watches the fight off-screen. **Ruling:**
resolution **playback follows the action** — the camera's job during playback is to show what just happened,
which is the whole point of the character/action framing the owner asked for. *AC:*
- **At the start of resolution, a planning-time pan releases** so playback's `focusOn` drives the camera
  centre through each actor/impact; when planning resumes, the auto-camera re-centres on the active
  character (as CAMERA-CONTROLS already does).
- **Orbit (rotation) and zoom (span) persist** across the boundary — they do not fight centre-following, so
  they need no release; only the pan's centre override yields. (This is why pan and orbit differ here — not
  an inconsistency, they act on different axes.)
- **A test through the real wiring:** pan during planning, then resolve — assert the camera centre follows
  the resolution's focus (not the panned centre), and that orbit/zoom are unchanged; planning resumes
  centred on the active character.

**Spec Notes.** Files: `packages/client/src/app.ts` (release the pan — `resetPan()` or equivalent — on the
planning→resolution transition, before the first playback `focusOn`; leave orbit/zoom), possibly
`renderer3d.ts` if the release needs a renderer entry point. **Determinism guard stands:** the camera is
view-only. **Playtest note in the item:** if a released camera during resolution reads as *lost control*
rather than *shown the fight*, the reverse (pan persists, add a "follow" toggle) is the fallback — but the
default should show the action. Out of scope: orbit/zoom behaviour; the Recentre affordance (correct).

---

## Perf — finish what RENDER-ON-DEMAND was built for

### RENDER-IDLE-QUIET. An idle board stops re-issuing render commands (CLIENT) — UNBLOCKED
**Addresses the RENDER-ON-DEMAND finding (Builder session 16).** On-demand rendering is now the default, but
an idle board still drew ~17 frames over 5 seconds because the **app** re-issues render commands into a
still scene — measured at **49 camera updates, 15 `highlight` calls**, plus scattered `focusOn`/`drawShape`/
`setUnitFacing`, over 5 seconds nobody touched. The dirty-flag loop cannot help while something upstream
keeps saying the scene changed. *AC:* over an idle, settled board (no input, no animation, no ambient
motion), the app issues **no** render marks and the loop draws **no** new frames after the camera has
settled; the counts that RENDER-ON-DEMAND's instrumentation reports drop to zero on an idle page. **Spec
Notes.** The Builder's instrumentation already points the finger: **the camera first** (49 of the ~64 marks).
Likely causes: the auto-camera easing marking every frame until it settles (should stop marking once settled
— confirm the ease terminates and un-marks, per "settle in seconds"); a `highlight`/`focusOn` re-issued on a
render tick with unchanged inputs (memoise/guard on unchanged state). **Pure queries must not mark** —
`screenPosition` is called per drawn frame and marking it would re-arm the loop forever (RENDER-ON-DEMAND's
load-bearing rule; keep it). Files: `packages/client/src/app.ts` (the render loop / `onFrame` and the camera
ease), `renderer3d.ts` (`applyCamera`/the mark list). Out of scope: flipping any flag (on-demand is already
default); changing what a frame draws. **This is the app-side half RENDER-ON-DEMAND shipped as a prerequisite
for — not new scope.**

---

## Test — pin the invariant the render suite now leans on

### SETTLED-BOARD-INVARIANT. A named test that an idle board is byte-stable (TEST, LOW) — UNBLOCKED (after RENDER-IDLE-QUIET)
**Addresses Builder session-16 OQ #4.** Three `same()` callers — AMBIENT-FREEZE's guard and the two motion
assertions ("the resolution must be animating", "a right-drag must orbit") — now depend on an idle board
being byte-identical (true because on-demand stops drawing it), but nothing writes that invariant down, so a
missed `markDirty()` or an ambient prop that forgets the freeze flag turns those three into confusing
failures. *AC:* a **named** test asserts that a settled, idle board draws no new frame and is byte-identical
across a hold; it fails clearly at its own name if the idle-quiet property breaks. **Spec Notes.** Small;
reuse the `?render=ondemand`/`?render=always` seam and the film/frame harness. Depends on RENDER-IDLE-QUIET
(the property must actually hold before it can be pinned). Out of scope: the six centroid-reworked callers
(RENDER-SUITE-GREEN-2 handled those); new visual assertions.

---

## 🎮 PLAYTEST — the standing validation loop (owner + humans)

Not a Builder code item. The new work all wants a human eye: **confirm DEATH-HANG-3** in a live networked
game (the winner now sees the turn that won it); does the **character-centred camera + pan** read better
than the board frame; do the **VFX impact** cues (hitstop/flash/shake) sell a hit without disrupting; and
the standing balance watch-list (TTK burst goal, 20-turn pacing, Skim 30 / Chain Hook 23, Lumen 20, wall
power, RAVOK-RECOIL, clock-vs-kills). **Output:** felt problems → Dev Notes → the Analyzer routes them.

## Routed to Designer / Owner / flags

- **Camera-follow-on-select (flagged, from review observation).** Switching between your two characters
  during planning does not recentre the camera on the newly selected one (`selectUnit` doesn't re-frame). AC
  is met and a forced snap could feel jarring, so not scheduled — one-line `fitCamera()` in `selectUnit` if
  the playtest wants it.
- **Zoom beyond wheel (flagged, from OQ #3).** Wheel-zoom exists; a pinch/touch-zoom or a zoom control is a
  future Dev Note, not invented here.
- **Intent badge shows the ability name, not a digit** — kept (clearer); owner can revert to the digit in
  one line. **ASSET-BUDGET caps (1.5 MB/char, 12 MB total) + CLIP-DEDUP (§18)** — still awaiting the owner's
  call; decide before rigging the other eight. **300 kB JS budget headroom stale** (deliberate call).
- **CHASE-SECOND-CLOCK; NET-E2E-EXPAND-2; DO-E2E; RAVOK-RECOIL; Warding Wall power; Skim/Chain Hook; FRAG-SELF
  zoning; WALL-BLINK-ONTO; INTERCEPT shield lever; Aegis beam distinctness; self-lethal recoil warning;
  burn/regen pip glyphs; Warding Halo dead `weaken`; trap count cap; inspect chips hoverable; Solar Flare DoT
  ceiling; Thorn mine carpet** — unchanged flags.

## Flagged future (not scheduled)

- **The rest of the VFX pipeline** — the next four impact/ability steps (projectiles, casts, statuses); the
  AMBIENT-FREEZE hook now makes the first ambient motion safe to attempt one element at a time (MAP_PIPELINE
  phase 5). **The rest of the character art** — the other eight (gated on CLIP-DEDUP). **M3-REMATCH,
  IDLE-KICK, LOBBY-TEAM-CHOICE**; **same-turn-buff preview**; **route-around-bodies dash impact preview**.
