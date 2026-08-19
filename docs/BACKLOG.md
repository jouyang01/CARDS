# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit.** **Drive the real UI wiring in tests, not just pure
functions** (the recurring "green-but-broken" lesson — now there is `app-harness.ts` to do it with).
**Open/update a PR to `main` every session.**

> ⚠️ **`main` is LIVE** — a green push publishes the Worker + client. Keep it green. **Deploy is
> working** (`WORKER_ORIGIN` is set correctly — the earlier "wrong value" was a prompt typo, not the
> repo variable; confirmed by the owner 2026-09-18).

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + Dev Notes batch 3.
- **PR #84 (this review):** **KESTREL-CONE** (the HUD-highlighted mode is the mode a turn fires),
  **DASH-STATUS** (a dash applies its status riders — Bramble Stride Root, Tempest Run Slow now land),
  **PREVIEW-AUDIT** (every ability's damage numbers surface — inner/ring, axis, beam, DoT, and traps
  that previewed nothing), **LOBBY-DETAIL-PANEL** (the kit in the left-side space), **ABLATIVE-40**.

Current suite: **2216 tests** (1031 + 910 + 275), typecheck + build clean.

### Build order and dependencies

**LOBBY-READY-FIX → CATALYST-TIP-FAST → HARNESS-BROADEN → DEV-CHARSELECT → LOBBY-PANEL-RESPONSIVE.**
LOBBY-READY-FIX and HARNESS-BROADEN pair (the fix's regression lives in the broadened harness).
Realistic one-session cut: LOBBY-READY-FIX + CATALYST-TIP-FAST + HARNESS-BROADEN.

---

## Client — the lobby ready bug (do first)

### LOBBY-READY-FIX. A non-creator seat sees Ready, not a dead Start; a fresh tab doesn't steal a seat (CLIENT bug) — UNBLOCKED (first)
**Addresses Dev Note: "There is no 'ready' button. Both Seat 0 and seat 1 have a 'start game' but it
cannot be clicked."** The lobby code is correct in isolation (creator → "Start match" gated on
`canStart`; others → "Ready up" → `client.ready`), so the symptom means **`isCreator` is true for both
seats**. **Leading root cause:** the reconnect ticket is in **`window.localStorage`** keyed by room code
(`main.ts:144`) and every connect joins with it (`main.ts:167`); two **tabs of the same browser share
localStorage**, so a second tab reclaims the first's (creator's) seat — both become the creator. *AC:
(a) a second client opening a room whose creator seat is still **connected** joins a **fresh seat**, not
a reclaim (the reclaim is honoured only for a **held/disconnected** seat of that identity — a live seat
refuses the ticket as `seatTaken`); (b) the reconnect ticket is scoped **per browsing context**
(`sessionStorage`, or a key that two live tabs don't collide on) so same-browser two-seat testing
works; (c) the non-creator seat renders **"Ready up"** and readying enables the creator's Start;
(d) the seat-row `is-ready` marker reads **`readied`**, not `lobby.ready` (= *picked* seats,
`lobby.ts:210`). Tests: **drive two real net clients** through a real hub — one creates, one joins;
assert the joiner is a distinct seat, sees Ready, and readying flips the creator's Start to enabled.*
**Spec Notes.** Files: `packages/client/src/main.ts` (ticket store → `sessionStorage`/scoped; the
join-vs-reclaim decision), `packages/server/src/room.ts` (refuse a reclaim of a connected seat, if not
already), `lobby.ts`/`lobby-screen.ts` (the `readied` display). Ruled PROPOSED RECLAIM-SCOPE in
edge-cases — **confirm the root cause with the two-client test before fixing blind.** Cross-item:
its regression lives in **HARNESS-BROADEN**. Out of scope: the ready protocol (correct); spectators.

## Client — the tooltip speed

### CATALYST-TIP-FAST. Catalyst tooltips appear immediately, not on the browser's delay (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Catalyst descriptions on mouseover appear very slowly, can we speed up how soon
they show up?"** The catalyst buttons use the native HTML `title` attribute (`lobby-screen.ts:275`),
whose ~0.5–1 s reveal delay the browser owns. *AC: hovering a catalyst shows its description
**immediately** (on `mouseenter`) via a **custom tooltip**, not the native `title`; leaving hides it; a
test asserts the description renders on hover without relying on `title`.* **Spec Notes.** Files:
`packages/client/src/lobby-screen.ts` (drop `button.title`; reuse the LOBBY-INSPECT hover-panel
mechanism, which already fires instantly). Apply the same to the character/ability tooltips if they use
`title`. Out of scope: tooltip restyle; touch.

## Client — test insurance

### HARNESS-BROADEN. Extend the controller harness across the real UI flows (CLIENT test) — UNBLOCKED
**Addresses Builder OQ 2026-09-19 #6.** `app-harness.ts` can drive the whole controller but is exercised
only by KESTREL-CONE — yet three of last batch's five items were "pure function passes, wiring broken."
*AC: harness coverage for aiming/commit, catalysts, free actions, the chase, playback, **and the lobby
ready flow** (two net clients through a real hub); LOBBY-READY-FIX's regression lives here; each test
drives the **real handler**, not the pure helper.* **Spec Notes.** Files: `packages/client/test/`
(the harness + new specs). The cheapest insurance against the recurring wiring-bug class. Out of scope:
Playwright/pixel coverage (that is NET-E2E, still flagged).

## Dev tooling

### DEV-CHARSELECT. A dev route to reach any character in the hot-seat (CLIENT) — UNBLOCKED
**Addresses Builder OQ 2026-09-19 #2.** The hot-seat roster is fixed (Vex+Wisp vs Bastion+Aegis) and
**Kestrel — the only two-mode ability — is reachable only through the lobby**, so the mode toggle can't
be hand-tested locally. *AC: a dev query param (e.g. `?chars=kestrel,…`) seats a chosen roster in the
hot-seat; invalid ids fall back with a visible message (a dev toggle must not silently seat the wrong
thing — DECISIONS 2026-09-18); Kestrel's Focus/Spread is reachable by hand.* **Spec Notes.** Files:
`packages/client/src/main.ts` (the hot-seat boot + roster). Dev-only; keep it obvious it's a dev route.
Out of scope: the lobby (that path works); persisting the selection.

### LOBBY-PANEL-RESPONSIVE. The kit panel collapses instead of vanishing under a hard breakpoint (CLIENT) — UNBLOCKED (low)
**Addresses Builder OQ 2026-09-19 #7.** LOBBY-DETAIL-PANEL hides under 1320px, so a player windowed at
1280 never sees the kit. *AC: below the width where the panel doesn't fit, it becomes a **collapsed/
toggled** panel (a button that opens it) rather than disappearing; a test asserts the toggle exists at
the narrow width.* **Spec Notes.** Files: `packages/client/src/` (the lobby layout). Small. Designer's
call on the exact collapsed form; a toggle is the safe default. Out of scope: a full responsive redesign.

## Routed to Designer / flags

- **Aegis's beam distinctness (Builder OQ 2026-09-19 #5).** A beam has no sub-band — every tile pays the
  same — so Aegis reads apart from Bastion by **shape + the tell** only, not a coloured band. If the
  owner wants the lane visually distinct from a wedge beyond its outline, that is a **render/Designer**
  ask, not a preview bug. Flag.
- **Warding Halo's dead `weaken`** (Prep has no enemy-facing branch — add one or drop the rider),
  **trap count cap** (none exists; a count cap + eviction is a Designer decision if the mine carpet is
  oppressive) — both from 2026-09-18, still Designer-owned.
- **Beam + axisBonus** compose legally. **Chase-preview detour** deferred. **Decoy-universal-obstacle**
  / **host map control** / **public draft** — reversals, flag if wanted. **Solar Flare DoT ceiling**,
  **Thorn mine carpet** — playtest.

## Flagged future (not scheduled)

- **NET-E2E** — a two-client Playwright harness against a running Worker (pixel coverage the happy-dom
  harness can't reach). **M3-REMATCH**, **IDLE-KICK**, **LOBBY-TEAM-CHOICE**, **CAMO-E2E-FINISH** (low).

## Observed-not-requested / playtest (not Builder-blocking)

- **A real two-machine internet playtest** (deploy works now). **PHASE-STATUS-FIRST feel**, **CASTER-SAFE**
  (Ravok's whirl no longer self-harms), **DASH-STATUS** (Bramble Stride's Root / Tempest Run's Slow now
  bite), **BRUSH-BREAK**, **the timer bar**, **Aegis's beam**, **Thorn's mine carpet**.
