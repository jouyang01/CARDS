# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit** (golden rule #3). **Open/update a PR to `main` every
session.**

> ⚠️ **`main` is LIVE** — a green push publishes the Worker + client automatically. Keep it green.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop (lobby, net board, timer,
  reconnect/handoff, end screen) + deploy.
- **PR #79 (this review):** **SUBMISSIONS-PERSIST** (locked orders survive a DO eviction — the turn
  survives, not just the clock), **NET-PRESENCE-ENEMY** (enemy present-count, no id/pick leak),
  **BASIC-MODES** (aim-time `modes` on an ability; Kestrel returns to the roster).
- **PR #80 (Designer — Dev Notes batch 3, data shipped):** Stoke the Flame → **free** (cd 3→4, e0),
  Cinder's two DoTs (**Flare Burst** 10+6×2+reveal2, **Solar Flare** 30+8×2+weaken1), **Snare Bloom**
  root→slow(2) (interim until TRAP-HALT), the **range-4 dash floor** on five repositions.

Current suite: **1980 tests** (911 + 813 + 256), typecheck + build clean.

## 🔧 OWNER ACTION — fix the deploy variable (multiplayer is blocked on this)

- **The `WORKER_ORIGIN` variable is set to the WRONG value.** It is currently
  `cards-lockstepcards.worker.dev`; the **correct value is `cards-rooms.lockstepcards.workers.dev`**
  (the Worker name is `cards-rooms`, and the TLD is `workers.dev` **with an "s"**). Fix it at GitHub →
  Settings → Secrets and variables → Actions → **Variables** → edit `WORKER_ORIGIN`, then re-run the
  Pages deploy. Until then the deployed client reaches no server. (The Worker's root 404 is expected —
  it is the backend.)

---

> **This batch = the Designer's Dev Notes batch 3** (`docs/design/dev-notes-batch-3.md`). Large and
> realistically multi-session. Order below is the designer's, ratified. **Realistic one-session cut:
> the two bugs + CASTER-SAFE/RECOIL + PHASE-STATUS-FIRST** (the engine core); the traps, ALLY-SAFE,
> BRUSH-BREAK and the client/server flow batch carry. Every engine item ships **with its data edit and
> tests in the same commit**.

## Engine — bugs (do first)

### MENDING-RANGE. Mending Light heals outside its range (ENGINE bug) — UNBLOCKED (first)
**Addresses Dev Note #12 (`dev-notes-batch-3.md`): "Mending Light heals outside its range."** *AC: a
heal ability's effect only reaches targets within its Euclidean aim gate + area (r1); the exact
observed over-range heal no longer lands; a regression test pins the reported case.* **Spec Notes.**
Likely candidates (designer): the range **envelope vs `aimInRange` disagreement**, or the heal reaching
the **caster regardless of area**. Files: `packages/engine/src/resolve.ts`/`shapes.ts`/aim gate. Verify
against the Euclidean metric. Out of scope: retuning the heal; the FF/ally rules (ALLY-SAFE, separate).

### TIMER-EVERY-PHASE. The lock-in timer must render on EVERY Decision phase, not only turn 1 (CLIENT bug) — UNBLOCKED
**Addresses Dev Note #5: "Lock-in timer disappears after turn 1."** (Renamed from the note's
"TIMER-PERSIST" to avoid collision with the shipped server item.) *AC: the countdown/timer renders on
**every** Decision phase for the whole match, not just the first; a test drives two consecutive turns
and asserts the timer is present on turn 2+.* **Spec Notes.** Client regression — the timer render is
gated to first turn somewhere. Files: `packages/client/src/` (the HUD timer render / phase transition).
Cross-item: **TIMER-BAR** (below) redesigns this timer — do TIMER-EVERY-PHASE first (fix the bug), then
TIMER-BAR (redesign the now-correctly-rendering timer). Out of scope: the bar redesign.

## Engine — the core rulings (CASTER-SAFE + RECOIL, then PHASE-STATUS-FIRST)

### CASTER-SAFE. A unit is never a target of its own ability's harmful effects (ENGINE, global) + RECOIL — UNBLOCKED
**Addresses Dev Notes #16+#18 (CASTER-SAFE) and #17 (RECOIL).** Verified live: Whirling Cleave self-hits
Ravok for the full 22 and Shockwave for 12 (self-damage *and* self-slow) — FF1's "ally or enemy" was
never meant to include the caster. *AC: (a) **CASTER-SAFE (global):** the caster is excluded from its
own ability's **harmful** effects (damage, debuff statuses, knockback) — beneficial effects (heals,
own buffs) unchanged; fixes Ravok's Whirling Cleave and Shockwave self-hits. (b) **RECOIL (opt-in
exception):** a new ability field `selfDamagePct: N` makes the caster take `floor(amount × N / 100)` of
the ability's damage, **bypassing cover** (no cover from the ground under you) but **consuming shields
normally**; Seismic Rupture carries `selfDamagePct: 50` (19 of 38). Validation: `selfDamagePct` only on
an ability with damage. Tests: Ravok's auto/Shockwave no longer self-harm; Seismic Rupture deals 19 to
its caster through cover, shields absorbing first; an ally in the same area is still hit (CASTER-SAFE is
self-only, not ally-only — that is ALLY-SAFE).* **Spec Notes.** Files: `packages/engine/src/resolve.ts`
(the harmful-effect target filter), `types.ts`/`validate.ts` (`selfDamagePct`), `data/characters/ravok.json`
(Seismic Rupture). **Distinguish from ALLY-SAFE:** CASTER-SAFE excludes only the *caster*; ALLY-SAFE
excludes the caster's *team*. Deterministic. Ruled in `dev-notes-batch-3.md` §B.

### PHASE-STATUS-FIRST. Within each phase, all statuses land, THEN all damage computes against post-status state (ENGINE, deepest) — UNBLOCKED (HIGH RISK; tests are the deliverable)
**Addresses Dev Note #21.** Today a Blast-applied Weaken affects nothing until next turn; the owner
wants it to blunt the same phase's attack. *AC: within each of Prep/Dash/Blast, resolution runs **two
simultaneous sub-steps** — (1) **all** status applications in the phase (both teams, at once), then (2)
**all** damage/heal applications (both teams, at once, computed against the **post-status** state). So a
Weaken from this turn's Dazzling Ray blunts the victim's attack **in the same Blast**, and a Prep Might
boosts that unit's Prep-phase trap as it arms. **Simultaneity MUST survive:** both teams' statuses
apply together; the damage sub-step reads a **pre-damage HP snapshot** so mutual attacks both land and
**mutual kills still land in full**; nobody is order-privileged. Displacement keeps its end-of-Blast
slot; catalysts still resolve at phase start (before both sub-steps). Slow (movement) still does not
touch the same phase's damage; a Blast slow biting this turn's Move is unchanged. Tests (the
deliverable): the **mutual-Weaken symmetry** test (both apply, both attacks blunted, result identical
under team swap), a **mutual-kills regression** (both die), and updates to every existing test the new
timing flips.* **Spec Notes.** Files: `packages/engine/src/resolve.ts` (`runPrep`/`runDash`/`runBlast`
— restructure each into apply-all-statuses → snapshot → apply-all-damage). **Highest-risk item this
batch** — determinism hinges on both sub-steps being **order-independent batches** (keep the fixed
unit-list iteration; do not privilege a team). This flips many existing combat tests — that is expected
and they update in the same commit (golden rule #3). Ruled in `dev-notes-batch-3.md` §C #21. Out of
scope: cross-phase timing (already correct); displacement's slot.

## Engine — the traps and the ally flag

### TRAP-CENTRE. A trap effect on an AREA shape places ONE trap at the aimed centre (ENGINE) + Thorn's auto-mine — UNBLOCKED
**Addresses Dev Note #9.** *AC: a `trap` effect on an area shape (circle/cone/line) places **one** trap
at the **aimed centre square**, never one per covered tile; then **Barbed Sling** gains `{ trap,
amount: 8, lifetime: 2 }` — every shot leaves a mine on its centre for 2 turns. The shipped per-team
trap cap (4) still applies. Tests: an area-shape trap ability places exactly one trap at centre;
Barbed Sling leaves a live mine; the cap holds.* **Spec Notes.** Files: `packages/engine/src/resolve.ts`
(trap placement), `data/characters/thorn.json`. Balance lever if oppressive: the mine's `amount` 8→0
(reveal-only), not the cap (designer). Out of scope: TRAP-HALT (separate).

### TRAP-HALT. A halting trap ends a unit's movement on entry (ENGINE) + Snare Bloom — UNBLOCKED
**Addresses Dev Note #10b.** *AC: a new trap field `halt: true` — a unit **entering** a halting trap
**ends its movement on that square immediately** (remaining path/dash discarded; **not** a displacement,
so no Move-cancel semantics beyond the discard); **Snare Bloom** carries `halt` (completing #10 — it
currently ships slow-only, interim); **Unstoppable ignores** the halt (as it already ignores the slow).
Tests: a mover entering a halt trap stops there with its remaining path dropped; a dasher likewise; an
Unstoppable unit passes through.* **Spec Notes.** Files: `packages/engine/src/resolve.ts` (trap trigger
→ movement stop), `types.ts`/`validate.ts` (`halt`), `data/characters/thorn.json` (Snare Bloom).
Compose with the existing trap trigger (damage/slow apply, then halt). Out of scope: displacement rules.

### ALLY-SAFE. An ability may skip friendly fire (ENGINE) + Lumen's Radiant Lash — UNBLOCKED
**Addresses Dev Note #11.** *AC: a new ability flag `noFriendlyFire: true` — the ability's **harmful**
effects skip the caster's **own team** (beneficial effects unchanged); **Radiant Lash** carries it (a
Mender whose heal-beam friendly-fires was self-contradictory). FF1 stays the global default; this is
the per-ability exception. Validation: `noFriendlyFire` is **meaningless without a harmful effect —
reject** on an ability with none. Tests: Radiant Lash damages enemies in its line, heals allies, and
does **not** damage allies; the flag rejects on a heal-only ability.* **Spec Notes.** Files:
`packages/engine/src/resolve.ts` (harmful-effect team filter), `types.ts`/`validate.ts`,
`data/characters/lumen.json`. **Distinct from CASTER-SAFE** (self-only): ALLY-SAFE is team-scoped and
per-ability. Ruled in `dev-notes-batch-3.md` §B #11.

## Engine/vision — brush-break

### BRUSH-BREAK. Being hit in brush suppresses the brush for that unit, not Reveal (ENGINE + client) — UNBLOCKED
**Addresses Dev Note #19.** *AC: taking damage while concealed by **brush** applies **no** Revealed
status; instead the unit gains a unit-level **`brushBroken` marker (duration 2)** — its brush
concealment is suppressed for the **current and next turn** (drawn for the enemy even while in brush),
expiring end of next turn. **Reveal is unchanged** (still pierces everything, everywhere); **Stealth is
unchanged** (still broken outright by damage); a unit with `brushBroken` **and** active Stealth stays
hidden by the Stealth (brush-break removes one veil, not both). The suppression is **unit-scoped**, not
patch-scoped (walking into a fresh brush patch next turn: still visible). Tests: a brush-concealed unit
that takes damage gains `brushBroken` and no `reveal`; it renders to the enemy this turn and next, then
re-hides; a stealthed+brushBroken unit stays hidden.* **Spec Notes.** Files: `packages/engine/src/vision.ts`
(`isConcealedFrom`/`canSee` consult `brushBroken`), the reveal-on-damage path in `resolve.ts` (route
brush-concealed attackers to `brushBroken` instead of `reveal`), the fog render (client). **Reconcile
with REVEAL-FIX + CAMO-REVEAL** — those govern reveal-on-*attack*; this governs the effect of *taking*
damage in brush. Deterministic (integer duration). Ruled in `dev-notes-batch-3.md` §C #19.

## Client / server — the lobby & turn-flow batch

### RESOLVE-PARTIAL. Locked characters act; never-locked hold — per character (confirm) — UNBLOCKED (likely mostly done)
**Addresses Dev Note #8 (ruled).** When a Decision phase ends (timer expiry or all locked), the turn
**always resolves**: locked characters act as locked; never-locked characters **hold** (no ability/
move/free/catalyst) — **per character, not per seat**. No turn waits on a player. *AC: a seat that
locked some characters and not others resolves the locked ones acting and the unlocked ones holding; a
test asserts per-character partial resolution.* **Spec Notes.** M3-TIMER's missed→hold already does
this per-seat at expiry; verify it is **per-character** and add the confirming test — likely a test +
small gap, not a rebuild. Files: `packages/server/src/hub.ts` (`mergeSeatOrders`)/`packages/engine`.
Ruled in `dev-notes-batch-3.md` §A #8.

### TIMER-BAR. Redesign the timer as a draining bar joined to an enlarged Lock In (CLIENT) — UNBLOCKED (after TIMER-EVERY-PHASE)
**Addresses Dev Notes #6+#7 (one redesign).** *AC: a horizontal **depletion bar** spanning the
hotbar's width, visually joined to an **enlarged Lock In** button at its right end (the AR arrangement
— owner's UI-batch screenshot); the tenths readout, the colour shift under 10 s, and the Time Bank pips
carry over from UI-TIMER.* **Spec Notes.** Files: `packages/client/src/` (the HUD hotbar + timer).
**Depends on TIMER-EVERY-PHASE** (fix the render bug first, then restyle). Reuse UI-TIMER's tenths/
colour/pips logic. Out of scope: server clock semantics (unchanged).

### LOBBY-BOUNDS. The "Your Team" bar clips inside its panel (CLIENT) — UNBLOCKED
**Addresses Dev Note #1: the team bar extends past into the log.** *AC: the team bar clips/wraps inside
its panel at both map sizes and 8 seats; a test/snapshot asserts no overflow.* **Spec Notes.** Client
CSS/layout. Small. Out of scope: restyling the log.

### LOBBY-INSPECT. Hover a character or catalyst in the lobby → details (CLIENT) — UNBLOCKED
**Addresses Dev Notes #2+#3.** *AC: hovering a character in the lobby shows its kit/HP/energy (reuse the
shipped **UI-INSPECT** panel, **no vision gate** in the lobby); hovering a catalyst shows what it does
(surface the existing in-match catalyst tooltip TT1/CAT2 in the lobby picker).* **Spec Notes.** Reuse
existing components — recompute nothing new. Files: `packages/client/src/` (lobby view + UI-INSPECT/
tooltip). Out of scope: new inspect content.

### LOBBY-READY. Seat 0 starts; other seats "ready up" (SERVER + CLIENT) — UNBLOCKED
**Addresses Dev Note #4.** *AC: **seat 0 (the room creator)** holds the Start button, **enabled only
when every other occupied seat has readied**; readying is **revocable until start**; a returning/late
seat is un-readied. Supersedes the plain `lobbyReady`-only gate with a ready-handshake. Tests: start is
disabled until all non-creator seats ready; un-readying re-disables it; only seat 0 can start.*
**Spec Notes.** Files: `packages/server/src/` (a `ready` protocol message + room state), the lobby
screen. Compose with LOBBY-START (start on the button, ruled). Out of scope: spectators; matchmaking.

## Small guards

### MODE-BASE-INVARIANT. `validateAbility` rejects a `modes` ability whose mode 0 ≠ base profile (ENGINE, tiny) — UNBLOCKED
**Addresses Builder OQ 2026-09-17 #2.** *AC: a `modes` ability whose `modes[0]` shape/range ≠ the
ability's base `shape`+`range` **fails validation** — so "absent mode = base = mode 0" holds by
construction; Kestrel's Twin Bolts passes (mode 0 == Focus). Test: a mismatched mode 0 rejects.*
**Spec Notes.** File: `packages/engine/src/validate.ts`. Tiny. Ruled in edge-cases (BASIC-MODES).

### DASH-FLOOR-GUARD. Content test: every dash reposition has range ≥ 4 (ENGINE test) — UNBLOCKED
**Addresses Dev Note #20 (Builder task).** *AC: `content.test.ts` fails any `phase: "dash"` reposition
(ability or catalyst) with `range < 4`; the five shipped repositions pass.* **Spec Notes.** File:
`packages/engine/test/content.test.ts`. Tiny; keeps a future kit from undercutting the ruled mobility
floor. Out of scope: changing any range (data already at 4).

## Flagged future (not scheduled)

- **NET-E2E** — a two-client Playwright harness against a running Worker (covers the mode toggle +
  presence marks the hot-seat suite can't reach). **M3-REMATCH**, **IDLE-KICK**, **LOBBY-TEAM-CHOICE** —
  unchanged. **CAMO-E2E-FINISH** (low).

## Routed to Designer / flags

- **Playtest flags (designer):** Solar Flare's DoT ceiling, Thorn's auto-mine carpet (lever: mine
  `amount` 8→0, not the trap cap), the interim control-light snare until TRAP-HALT.
- **Free-action criteria** now reads "…or **owner-designated**" (Stoke the Flame is the recorded
  exception). **Chase-preview detour**, **decoy-as-universal-obstacle**, **host map control / public
  draft** — unchanged flags.
- **Dash melee-cover** (deferred). **Pad tuning** (`everyTurns` 4→5 iron-basin). **Kestrel** now back in
  the default `CATALOG` (BASIC-MODES shipped).
