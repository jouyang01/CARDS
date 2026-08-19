# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit.** **Drive the real UI wiring in tests** (use
`app-harness.ts` / two-net-client tests — the standing "green-but-broken" lesson). **Open/update a PR
to `main` every session.**

> ⚠️ **`main` is LIVE** — a green push publishes. Deploy is set (`WORKER_ORIGIN` correct). Keep it green.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + Dev Notes batch 3.
- **PR #86 (this review):** **LOBBY-READY-FIX** (a second tab is a second player, not a refused
  reclaim — confirmed by a two-net-client test), **CATALYST-TIP-FAST** (instant hover tooltip via the
  new `tooltip.ts`), **HARNESS-BROADEN** (the controller harness drives the real flows), **DEV-CHARSELECT**
  (`?chars=`), **LOBBY-PANEL-RESPONSIVE** (the kit panel collapses instead of vanishing).

Current suite: **2284 tests** (1099 + 910 + 275), typecheck + build clean.

### Build order and dependencies

**HUD-LAYOUT → SOCKET-ID-STABLE → TOOLTIP-SWEEP → DEV-CHARSELECT-ERROR → HARNESS-HOTSEAT.** All
independent; ordered by owner-visible value (the re-layout first, the restart bug second). Realistic
one-session cut: HUD-LAYOUT + SOCKET-ID-STABLE + TOOLTIP-SWEEP.

---

## Client — the HUD re-layout (do first)

### HUD-LAYOUT. Reflow the in-match HUD so the board dominates the screen (CLIENT) — UNBLOCKED (first)
**Addresses Dev Note: "The main game screen is too small in comparison to the buttons. Look at
screenshot as reference and make the changes listed below and on screenshot. 1. Catalysts move to the
left of the bottom next to character 2. Movement/clear moves to the right of the bottom. 3. Lock in bar
and timer moves to where catalyst used tod be 4. SCore and teams move to the top of the window. 5. Board
expands and is bigger and covers as much screen as possible where the timer/lock in bar was."** *AC (the
five, from the owner's annotated screenshot):*
1. *The **catalyst row** moves to the **bottom-left**, beside the character portrait/HP block.*
2. *The **movement controls** (Move / Sprint / Chase / Clear) move to the **bottom-right**.*
3. *The **Lock In bar + timer** move to the **centre-bottom** (where the catalyst row used to be), above
   the ability row.*
4. *The **score + team pips** (V/W · 0 · 0 · B/A · "Turn N of 16 · First to 4") move to the **top** of
   the window.*
5. *The **board expands** to fill the space the timer/lock-in bar vacated — as large as fits, dominating
   the screen (the board was the "gigantic rectangle" in the screenshot).*
*Nothing changes behaviourally — the timer-bar, score, catalyst and movement components **move**, not
change. A layout test asserts each block's new region and that the board's rect grew.*
**Spec Notes.** Files: `packages/client/src/` — the HUD component tree + CSS/layout (`hud.ts`, the
in-match container, the board sizing that `renderer3d`/`fitCamera` reads). The board's canvas resize
must re-fit the camera (it already reacts to viewport). **Fold in OQ #5:** rename the Skip-during-playback
control's `hud-lock` class to **`hud-skip`** while restructuring the rows. Out of scope: engine/protocol;
the lobby screen (a different layout); new controls. Cross-item: none — pure client layout.

## Server — the DO-restart collision (real bug)

### SOCKET-ID-STABLE. Socket/seat ids must not collide after a Durable Object restart (SERVER bug) — UNBLOCKED
**Addresses Builder OQ 2026-09-20 #2.** `durable-object.ts` mints socket ids from a **module-level
counter** (`seat-${nextSocketId++}`) that **resets to 0 on eviction**. A room restored from storage
still holds `seat-0`, `seat-1`; the next socket to connect is *also* minted `seat-0`, so its join is
refused as `duplicateSeat` and its socket closed — the room looks **unjoinable** to a real player after
a restart. *AC: after a DO evict/reconstruct, a new socket connecting to a restored room gets a
**non-colliding** id (derive the next from the **persisted** seat set — max existing index + 1 — or a
non-resetting source) and joins/reclaims correctly; a test evicts/reconstructs a DO with seats present
and asserts the next socket is not refused as `duplicateSeat`.* **Spec Notes.** Files:
`packages/server/src/durable-object.ts` (the id source), possibly `room.ts`. Keep it deterministic and
plain-JSON. Same family as RECLAIM-SCOPE; a production bug (eviction is normal), so do it before the
next networked playtest. Out of scope: the ticket/reclaim logic (fixed); seat identity semantics.

## Client — the tooltip family

### TOOLTIP-SWEEP. Convert the remaining native `title` tooltips to the instant tooltip (CLIENT) — UNBLOCKED
**Addresses Builder OQ 2026-09-20 #4** (and generalises Dev Note 2026-09-19 #1). CATALYST-TIP-FAST
converted the lobby catalysts; `hud.ts:410` (status chips), `hud.ts:346` (Time Bank button),
`app.ts:1255–1268` (topbar portraits) and `inspect-panel.ts:90` (inspect-panel catalyst chips) still
use native `title` with the browser's reveal delay. *AC: those four show their description
**immediately** via `tooltip.ts` instead of `title`; a test asserts each renders on hover without
`title`.* **Spec Notes.** Files: the four sites + `tooltip.ts` (exists). Mechanical. Out of scope:
restyle; touch.

## Dev tooling & tests

### DEV-CHARSELECT-ERROR. `?chars=` fails loudly on a bad id (CLIENT, tiny) — UNBLOCKED
**Addresses Builder OQ 2026-09-20 #3.** DEV-CHARSELECT falls back on an unknown id; its neighbour
toggles error (a dev toggle must not silently seat the wrong roster — DECISIONS 2026-09-18). *AC: an
unknown `?chars=` id shows a **visible error** and does **not** boot a fallback roster; a valid list
seats normally; a test asserts the error path.* **Spec Notes.** File: `packages/client/src/main.ts`.
Tiny; consistency with MAPTOGGLE. Out of scope: the valid path (works).

### HARNESS-HOTSEAT. Cover the hot-seat pass-the-device handover in the controller harness (CLIENT test) — UNBLOCKED (low)
**Addresses Builder OQ 2026-09-20 #6.** `app-harness.ts` drives only a networked seat; the hot-seat's
`deriveSeats` handover (pass-the-device between players between turns) is untested at the controller
level. *AC: a harness test drives a two-seat hot-seat through a turn boundary and asserts the handover
(the next seat's orders, the seat-index advance).* **Spec Notes.** Files: `packages/client/test/`.
Low; completes the harness coverage. Out of scope: networked seats (covered).

## Routed to Designer / flags

- **Aegis's beam distinctness** (a beam has no sub-band; distinct-from-a-wedge beyond outline + tell is
  a render/Designer ask), **Warding Halo's dead `weaken`** (add an enemy-facing Prep path or drop the
  rider), **trap count cap** (none exists; a count cap + eviction is a Designer decision if the mine
  carpet is oppressive) — all still Designer-owned.
- **Beam + axisBonus** compose legally. **Chase-preview detour** deferred. **Decoy-universal-obstacle**
  / **host map control** / **public draft** — reversals, flag if wanted. **Solar Flare DoT ceiling**,
  **Thorn mine carpet** — playtest.

## Flagged future (not scheduled)

- **NET-E2E** — a two-client Playwright harness against a running Worker (pixel coverage). **M3-REMATCH**,
  **IDLE-KICK**, **LOBBY-TEAM-CHOICE**, **CAMO-E2E-FINISH** (low) — unchanged.

## Observed-not-requested / playtest (not Builder-blocking)

- **A real two-machine internet playtest** (deploy works; do it after SOCKET-ID-STABLE so a restart
  can't strand a room). **PHASE-STATUS-FIRST feel**, **CASTER-SAFE**, **DASH-STATUS** (Bramble Stride
  Root / Tempest Run Slow now bite), **BRUSH-BREAK**, **the timer bar**, **Aegis's beam**, **Thorn's
  mine carpet**.
