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

**DEATH-HANG → RAVOK-RECOIL → KESTREL-SLIPSTREAM-2T → CD-BAND-DASH → CD-BAND-BLAST →
CD-BAND-INVARIANT → PREVIEW-NUMBERS-AUDIT → BURN-VISIBLE → LINE-PREVIEW-SMOOTH.** DEATH-HANG is
CRITICAL and first — a balance pass is unverifiable until a death stops freezing the game. All five
data items (RAVOK-RECOIL, KESTREL-SLIPSTREAM-2T, and the three CD-BAND items — the owner's 2026-09-23
cooldown directive) are one field each and should land **before** PREVIEW-NUMBERS-AUDIT so the audit
checks the final numbers. CD-BAND-INVARIANT is the test and goes last of the three. Realistic
one-session cut: DEATH-HANG + the five data items + PREVIEW-NUMBERS-AUDIT.

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

## Data — the cooldown bands (owner directive 2026-09-23, after the two number tweaks)

> **Owner directive, verbatim:** *"1. Dashes should be a 4-5 turn cooldown with only a few exceptions,
> use your judgement for the exceptions. 2. Non-basic blasts should have 3-4 turn cooldown with only a
> few exceptions use your judgement for the exceptions. 3. Prep cooldowns are correct right now."*
> Full evidence, the Atlas Reactor measurements behind it, and the reasoning for every number:
> **`docs/reviews/2026-09-23.md`**. Numbers below are final — the Builder implements them, does not
> re-derive them.

**Three items, in order: CD-BAND-DASH → CD-BAND-BLAST → CD-BAND-INVARIANT.** Data + one test. **No
engine change and no client change** — `cooldown` is already a plain data field the resolver reads
(`resolve.ts:625`, `:903`) and the HUD/inspect panel renders it from data. **PREP COOLDOWNS ARE FROZEN
for this batch** (directive #3): do not touch a `prep` ability's cooldown, including the four free
actions (Vex Overwatch Trap 4, Thorn Snare Bloom 3, Wisp Veil & Decoy 5, Cinder Stoke the Flame 4).
**Do not retune `energyGain`** — the review proves the ult clock is neutral-to-faster under these
numbers (one ability per turn means cast *count* is unchanged; dashes are the roster's cheapest energy
abilities at 4–5 and the basic pays 8), so there is nothing to compensate for.

### CD-BAND-DASH. Every dash costs 4 or 5 turns (DATA) — UNBLOCKED
**Addresses owner directive #1.** Today the nine dashes run 2–3 (mean 2.67, median 3) against Atlas
Reactor's 4.81 / 5 — no CARDS dash reaches AR's modal value. The rule: **a dash with an enemy-facing
effect (damage / knockback / root) costs 4; a dash with no enemy-facing effect — pure teleport, or a
self/ally shield — costs 5.** A self-shield is escape insurance, not commitment, so it does not buy the
discount. *AC: the nine `phase: "dash"` abilities carry exactly these cooldowns —* `bastion.ram_charge`
**3→4**, `ravok.bullrush` **3→4**, `kestrel.skim` **2→4**, `thorn.bramble_stride` **3→4**,
`wisp.blink` **2→4**, `aegis.intercept` **3→5**, `cinder.backdraft` **3→5**, `lumen.glimmer_step`
**3→5**, `vex.combat_roll` **2→5**; *no other field on any of them changes; the engine + client suites
stay green.* **Spec Notes.** Nine one-field edits in `data/characters/*.json`. **Wisp's Blink at 4 is a
deliberate exception** to the rule (it is a pure teleport, so the rule says 5): Wisp is the only
character who is both lowest-HP (85) and holds a range-2 basic, so Blink is her approach *and* her
exit — at 5 the archetype is deleted rather than taxed. AR kept the same exception for PuP. It stays
inside the owner's band at the floor; **do not move it to 3**. Aegis's Intercept going to 5 is safe
because **Barrier Pulse (Prep 2, shield 20, r4) is unchanged** and remains the every-other-turn
bodyguard button. Out of scope: `energyGain`, ranges, damage, Prep, ultimates.

### CD-BAND-BLAST. Every non-basic blast costs 3 or 4 turns (DATA) — UNBLOCKED
**Addresses owner directive #2.** Six of the eight non-basic blasts sit at 2 — a value Atlas Reactor
used once in 29. The rule: **a non-basic blast costs 3; it costs 4 only if its damage exceeds the
undelayed skill ceiling of 24 (`roster-v1.md` §4).** *AC: the eight non-basic `phase: "blast"`
abilities carry exactly these cooldowns —* `aegis.grounding_strike` **2→3**, `cinder.flare_burst`
**2→3**, `kestrel.kite_shot` **2→3**, `lumen.dazzling_ray` **2→3**, `ravok.shockwave` **2→3**,
`wisp.bola` **2→3**, `vex.frag_grenade` **3→4**, `bastion.chain_hook` **unchanged at 3**; *every
`abilities[0]` auto-attack stays at* `cooldown: 0`; *no other field changes; both suites stay green.*
**Spec Notes.** Seven one-field edits in `data/characters/*.json` (Chain Hook is already in band —
touch nothing). **Nothing is priced below 3 and that is deliberate:** every non-basic blast already
carries a status rider (slow / weaken / reveal / DoT / pull) on top of damage, so none is a plain shot
— **the plain shot is the 0-cooldown basic**, and restoring that hierarchy is the point of the
directive. **Frag Grenade at 4** is the single upward exception: 34 damage is the roster's named skill
nuke ceiling and the only skill above the undelayed cap of 24. Out of scope: `energyGain` (Frag's 10
stays), the auto-attacks, Prep, ultimates.

### CD-BAND-INVARIANT. The bands are enforced by a test, not by prose (TEST) — BLOCKED on the two above
**Why:** `roster-v1.md` §1 states the kit constraint as *"Skills | 3 | `cooldown ≥ 2`"*. That bare
floor is why the roster clustered at 2 — nothing in the repo ever said a dash should cost more than a
heal. The new numbers satisfy it (5 ≥ 2), so the prose does not block the data change, but it cannot
stop the next character shipping at 2 either. *AC: `packages/engine/test/content.test.ts` asserts, over
all nine shipped characters:* `abilities[0]` *is* `phase: "blast"` *with* `cooldown: 0`*; every*
`ultimate` *has* `cooldown: 0`*; and for the three skills —* **dash ⇒ 4 ≤ cd ≤ 5**, **blast ⇒ 3 ≤ cd ≤
4**, **prep ⇒ 2 ≤ cd ≤ 5** *(the current Prep range, frozen per directive #3). The test names the band
in its failure message so a future character author reads the rule, not a bare number.* **Spec Notes.**
`content.test.ts` already imports all nine characters and is where the roster's structural rules live —
extend it, do not add a file. **The invariant needs no allow-list**: with Blink at 4 rather than 3,
every value in the roster is inside its band, and an exception list is exactly the thing that lets the
next drift in. Out of scope: `validate.ts` (the engine's schema check stays value-agnostic — a band is
roster policy, not a data-format rule, and content tests are where policy belongs).

### The one risk, and it is mechanical
Any existing test that advances turns to wait an ability off cooldown will need its turn count raised.
Run the full suite. **Do not adjust a data value to keep a test green** — the numbers above are the
owner's, the turn counts in tests are not.

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
- **`roster-v1.md` §1 kit rule is now too loose** — it says *"Skills | 3 | `cooldown ≥ 2`"*, which is
  the floor that let the roster cluster at 2. The owner's 2026-09-23 directive supersedes it: **dash
  4–5, non-basic blast 3–4, prep unchanged**, with the commitment gradient behind it (a dash carrying
  an enemy-facing effect costs 4; a pure disengage costs 5). **Designer-owned prose** — CD-BAND-INVARIANT
  enforces the numbers in `content.test.ts` meanwhile, so this is documentation debt, not a blocker.
  Evidence and reasoning: `docs/reviews/2026-09-23.md`.
- **Bastion's Chain Hook — 3 or 4?** The roster's only pull ≥ 2 ("the strongest soft-CC in the game",
  `roster-v1.md` §4). Left at 3 because it is already inside the owner's band; AR priced its
  hard-displacement blasts at 4. **Owner's call** if the blast band should carry a second 4.
- **Wisp's Blink at 4** — the one deliberate exception to the dash rule (a pure teleport that should
  cost 5). Justified by Wisp being the only lowest-HP + range-2-basic character. **Playtest flag:**
  first number to revisit after a real two-machine game.
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
