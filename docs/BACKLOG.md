# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit.** **Drive the real UI wiring in tests** (`app-harness.ts`
/ two-net-client tests — the death hang is exactly this class). **Open/update a PR to `main` every
session.**

> ⚠️ **`main` is LIVE** — a green push publishes. Deploy is set; QUOTA-RUNAWAY (PR #89) guards the
> Cloudflare quota. Keep it green.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + Dev Notes batch 3.
- **PR #89 (Designer/infra):** **QUOTA-RUNAWAY** — abandoned matches stop the DO alarm ticking, no-op
  writes are skipped, Worker errors are CORS'd (the Cloudflare-quota guard; tested in every area).
- **PR #92 (this review):** **AIM-PREVIEW-TRUE** (the aim preview's shape is now the engine's own
  tile-centre predicate, congruence-swept — Aegis's beam reads as a 3-wide lane; boundary has square
  ends matching the predicate), **HARNESS-LOBBY-MATCH** (the lobby→match handoff is harness-driven).

Current suite: **2393 tests** (1191 + 910 + 292), typecheck + build clean.

### Build order and dependencies

**DEATH-HANG → RAVOK-RECOIL → KESTREL-SLIPSTREAM-2T → PREVIEW-NUMBERS-AUDIT → BURN-VISIBLE →
LINE-PREVIEW-SMOOTH.** The two data items (RAVOK-RECOIL, KESTREL-SLIPSTREAM-2T) are one-line each and
should land **before** PREVIEW-NUMBERS-AUDIT so the audit checks the final numbers. DEATH-HANG is
CRITICAL and first. Realistic one-session cut: DEATH-HANG + the two data items + PREVIEW-NUMBERS-AUDIT.

---

## Client — the death hang (CRITICAL, do first)

### DEATH-HANG. A character dying must not freeze the turn (CLIENT bug) — UNBLOCKED (first, CRITICAL)
**Addresses Dev Note: "BIG BUG: IMPORTANT: Something breaks when a character dies, the lock-in is not
possible and the timer bar goes away, forcing game to go on forever."** Investigated: the hot-seat
turn-boundary is robust (`seatRoster()` filters `alive`); the suspect is the **networked** path —
`playResolution` runs `beginTurn()` for both modes (`app.ts:1932`), and `openSeat`'s *"no living roster
→ `endTurn()`"* branch (`app.ts:925-932`) **auto-submits** `net.submit([])` the instant a resolution
leaves this seat's unit(s) **downed** (respawning), leaving the client locked with no actionable window
— "lock-in impossible, timer gone." *AC: after a resolution that downs a unit, the **next** turn is
playable — the timer (from the server window) shows and lock-in works — for **both** the downed seat
and its opponent, in **hot-seat and networked**; a seat with all units currently down presents an
honest **waiting/hold** state (not an auto-submit that reads as frozen); the match still ends on the
kill target, not on a transient down. Tests: **drive a death through the harness** (a two-net-client
match and a hot-seat) and assert the following turn opens with a live timer and a working lock-in; a
downed seat does not silently auto-submit into a frozen UI.* **Spec Notes.** Files:
`packages/client/src/app.ts` (`playResolution`/`beginTurn`/`openSeat`/`adoptWindow` — the networked
turn-boundary; separate the networked next-turn open from the hot-seat seat-iteration), possibly the
server window re-arm after a death-resolution (verify `#sendDecision` sends a fresh window when status
stays active). **Reproduce before fixing** — this is a wiring bug, not a pure-function bug. Out of
scope: the engine (death/respawn correct); the end-screen (correct).

## Data — the two number tweaks (before the preview audit)

### RAVOK-RECOIL. Whirling Cleave costs Ravok 11 (DATA) — UNBLOCKED
**Addresses Dev Note: "Ravok whirling cleave should do 11 damage to himself."** *AC:
`data/characters/ravok.json` `cleave` gains `selfDamagePct: 50` (Ravok takes floor(22×50/100)=11 —
RECOIL, bypasses cover, shields first); Shockwave unchanged (0 self / 12 enemies); Seismic Rupture
unchanged (19/38); the content + engine suites stay green.* **Spec Notes.** One data field; the RECOIL
mechanic already exists. Ruled in edge-cases (RAVOK-RECOIL). The **preview** of the self number is
PREVIEW-NUMBERS-AUDIT's job. Out of scope: Shockwave/Seismic (correct).

### KESTREL-SLIPSTREAM-2T. Slipstream lasts 2 turns (DATA) — UNBLOCKED
**Addresses Dev Note: "Kestrel's slipstream shouldgive a 2T buff for both haste and energized."** *AC:
`data/characters/kestrel.json` `slipstream` — both riders `duration: 2` (was 1); a test asserts the
haste and energized both persist to the turn after the cast.* **Spec Notes.** Two data fields; matches
how durations are measured (a `duration: 2` status survives the cast turn's end-of-turn tick). Out of
scope: other Kestrel abilities.

## Client — the damage-number audit

### PREVIEW-NUMBERS-AUDIT. Every ability's previewed damage number matches its resolution (CLIENT) — UNBLOCKED
**Addresses Dev Notes #2 and #3.** *#2: "Cinder's preview for damage on her auto attack should show the
extra damage to the center correctly. IMPORTANT again, AUDIT ALL DAMAGE PREVIEWS TO ENSURE THEY ARE
CORRECT." #3: "show 11 to himself, 22 to enemies for whirling cleave … 12 to enemies for shockwave and
nothing on Ravok … seismic rupture should show 19 damage to ravok and 38 to others."* AIM-PREVIEW-TRUE
fixed the shape; the **numbers** still hide the centre bonus and the caster's own recoil. *AC: the
damage tell equals the engine's resolution **at every previewed tile** for the whole roster, including:
Cinder's inner (22 centre / 14 ring), Bastion's axis (+8 line), and — the new dimension — the **caster's
own tile** carrying `selfDamagePct` recoil (**11** whirl, **19** Seismic, **nothing** for Shockwave);
DoT/heal tells unchanged. A property-style test: previewed number at tile == resolved number at tile,
for every roster ability at a fixed aim, **including the caster's square when `selfDamagePct` is set.*
**Spec Notes.** Files: `packages/client/src/targeting.ts` (`previewBands`/`damageTell`/`impactPreview`)
— drive numbers from the engine's `axisSquares`/`innerSquares` and the damage composition (incl.
`selfDamagePct` on the caster's tile); **never a client re-guess**. Depends on RAVOK-RECOIL /
KESTREL-SLIPSTREAM-2T landing first so the audit checks final numbers. Out of scope: the shape
(AIM-PREVIEW-TRUE, done); rebalancing.

## Client — the burn debuff & the line smoothness

### BURN-VISIBLE. Cinder's burn (DoT) shows as a visible debuff pip (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Cinder burn should be a debuff that players can see."** The DoT is a
`damageOverTime` **status** on the unit (per-turn amount + source), but the status pips don't render it.
*AC: a unit with a `damageOverTime` status shows a **burn debuff pip** (with its remaining turns), like
root/slow/reveal; hovering it names the per-turn amount; a test asserts a burning unit renders the pip.*
**Spec Notes.** Files: `packages/client/src/status-pips.ts` (+ the pip's tooltip). Read the existing
status — no engine change. Out of scope: HoT (own-team heal-over-time — apply the same treatment if
cheap, but the ask is the burn).

### LINE-PREVIEW-SMOOTH. Line-attack previews track smoothly on hover (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Vex's and other line attack previews seem to be a little laggy, can you make it
more smooth?"** The per-hover boundary re-derivation (AIM-PREVIEW-TRUE) likely re-tessellates every
mousemove for a long line. *AC: the line/beam preview re-derives only when the **quantized aim
direction** changes (not every pixel), so it tracks smoothly; a test/benchmark asserts the derivation
is skipped when the aim step is unchanged.* **Spec Notes.** Files: `packages/client/src/` (the hover →
boundary path — memoise on `aimStep`/direction). Out of scope: the geometry (correct); the congruence
test.

## Routed to Designer / flags

- **Aegis beam distinctness** — now a visible 3-wide rectangle lane; **re-ask the Designer/owner**
  whether it reads distinct enough (Builder OQ 2026-09-22 #2). **Warding Halo's dead `weaken`** (add an
  enemy-facing Prep path or drop it), **trap count cap** — still Designer-owned.
- **Inspect-panel chips hoverable** — needs a pinned-panel design; future. **Beam + axisBonus** compose
  legally. **Chase-preview detour** deferred. **Solar Flare DoT ceiling**, **Thorn mine carpet** —
  playtest. **AC #4 outline-through-centres** look — playtest note (Builder OQ #5).

## Flagged future (not scheduled)

- **NET-E2E** (two-client Playwright), **M3-REMATCH**, **IDLE-KICK**, **LOBBY-TEAM-CHOICE**,
  **CAMO-E2E-FINISH** (low) — unchanged.

## Observed-not-requested / playtest (not Builder-blocking)

- **A real two-machine internet playtest** (after DEATH-HANG — a death is the exact thing to exercise).
  **The new HUD layout**, **AIM-PREVIEW-TRUE feel** (tiles pop as centres cross the outline),
  **PHASE-STATUS-FIRST**, **Ravok's recoil**, **Thorn's mine carpet**.
