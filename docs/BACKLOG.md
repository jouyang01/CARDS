# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit.** **A genuinely new mechanic gets a generic, reusable
implementation** (golden rule #2). **Drive the real UI wiring in tests.** **Open/update a PR to `main`
every session.**

> ⚠️ **`main` is LIVE** — a green push publishes. Deploy is set; QUOTA-RUNAWAY guards the quota. Keep green.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + Dev Notes batch 3 +
  AIM-PREVIEW-TRUE.
- **PR #94 (this review):** **DEATH-HANG** (a downed networked seat holds — with "Hold Position" live —
  instead of auto-submitting into a frozen UI; verified by a reproduction test), **RAVOK-RECOIL** (11
  self), **KESTREL-SLIPSTREAM-2T** (2 turns), **PREVIEW-NUMBERS-AUDIT** (the previewed number is the
  dealt number, incl. self-damage), **BURN-VISIBLE** (+ `healOverTime` pip), **LINE-PREVIEW-SMOOTH**.

Current suite: **2538 tests** (1323 + 921 + 294), typecheck + build clean.

### Build order and dependencies

**WARDING-WALL → BASTION-RAM-LINE → CD-BAND-DASH → CD-BAND-BLAST → CD-BAND-INVARIANT → DOWN-SEAT-SKIP.**
WARDING-WALL is the only real engine work and **must precede CD-BAND-BLAST** (it replaces the ability
CD-BAND-BLAST would retune). CD-BAND-INVARIANT is the test, after its two data items. Realistic
one-session cut: WARDING-WALL + BASTION-RAM-LINE + the three CD-BAND items.

---

## Engine + data — Aegis's new wall (do first; the only new mechanic)

### WARDING-WALL. Aegis's Grounding Strike becomes a Prep line-hazard (ENGINE + data, ENGINE ASK) — UNBLOCKED (first)
**Addresses Dev Note: "Change Aegis's Grounding Strike to be a prep phase, 4 cool down skill named
Warding Wall which puts down a 4 tile long wall that lasts until the end of this turn that does 25
damage to those who walk through it and weakens them for the next turn."** Replaces the Blast
`grounding_strike` (line, dmg 14 + slow) with a Prep **line-hazard** — a new, reusable mechanic. *AC:
`aegis.grounding_strike` becomes **`warding_wall`** — `phase: "prep"`, `cooldown: 4`, a **4-tile
line/wall** placed at aim; the engine places a **trap on every tile of the wall** (generalise
TRAP-CENTRE's single placement to a wall placement), each carrying `onTrigger: [{damage: 25},
{weaken, duration: 2}]`, with a **lifetime that covers only the placement turn** (armed in Prep, active
through this turn's Dash/Move, gone at end of turn); it is a **hazard, not a blocker** (units walk
through, taking the hit — no pathing/LoS change); a unit **entering** any wall tile under its own power
(dash or move — not knockback/pull, the v1 trap rule) takes 25 and gains weaken(2, so it bites next
turn); the **caster's own team is unharmed** (existing trap team-exclusion); the wall is gone next turn.
Tests: a unit walking through takes 25 + weaken(2); a teammate is unharmed; the wall expires end of
turn; the four tiles all trigger.* **Spec Notes.** Files: `packages/engine/src/resolve.ts` (`placeTraps`
→ a wall/line placement over the shape's tiles, not just the centre — the reusable generalisation),
`types.ts`/`validate.ts` (a `wall`/line-trap shape or a flag on the trap effect), `data/characters/aegis.json`
(the ability rewrite + name + description). Keep it deterministic, integer, N-safe. **Design
confirmations owed to the Designer/owner** (flag before finalising): the **aim** (a line from the caster
along a direction, or a freely-placed 4-tile segment?), whether a **dasher** crossing it is hit (default
**yes** — traps fire on dash entry), and that Aegis trading a Blast for a Prep wall is intended.
**Cross-item: this removes `grounding_strike` as a Blast — CD-BAND-BLAST must NOT retune it** (see
below). Ruled PROPOSED (WARDING-WALL). Out of scope: making it a movement/LoS blocker (it is a hazard);
other kits.

## Data + client — Bastion's line charge

### BASTION-RAM-LINE. Ram Charge hits all in the line and previews as a line + landing marker (DATA + CLIENT) — UNBLOCKED
**Addresses Dev Note: "Bastion's Ram Charge should be a linear aoe dash that affects all players in a
line, not just the first enemy hit the preview should be like a line attack that also shows the ending
dash location."** The engine already supports it (`chargeHits: "all"`, validated, read at
`resolve.ts:1347`). *AC: `bastion.ram_charge` gains **`chargeHits: "all"`** — it applies its damage 15 +
knockback 1 to **every** enemy its path crosses (CASTER-SAFE/ALLY-SAFE filter as always); the client
**previews the charge as a line** over the tiles the path crosses **plus a marker at the dash landing
square**; a test asserts the charge hits every enemy in the line and the preview draws the line + the
end marker (drive the real preview).* **Spec Notes.** Files: `data/characters/bastion.json`
(`chargeHits: "all"`), `packages/client/src/` (the dash/charge preview — draw the crossed-tile line +
the landing marker for a `chargeHits:"all"` path). Ram Charge stays a dash → **CD-BAND-DASH sets its cd
to 4** (composes). Ruled (BASTION-RAM-LINE); resolves session-7 OQ #3 for this ability. Out of scope:
the `chargeHits` engine mechanic (shipped); other charges.

## Data — the cooldown bands (owner directive; PR #95, Dev Note #1)

> **Owner directive, verbatim:** *"1. Dashes should be a 4-5 turn cooldown with only a few exceptions …
> 2. Non-basic blasts should have 3-4 turn cooldown with only a few exceptions … 3. Prep cooldowns are
> correct right now."* Evidence + reasoning: **`docs/reviews/2026-09-23.md`**. Numbers are final — the
> Builder implements, does not re-derive. **PREP is FROZEN** (directive #3): do not touch a `prep`
> ability's cooldown. **Do not retune `energyGain`** (the review proves the ult clock is neutral).

### CD-BAND-DASH. Every dash costs 4 or 5 turns (DATA) — UNBLOCKED
**Addresses owner directive #1.** Rule: **a dash with an enemy-facing effect (damage/knockback/root)
costs 4; a dash with no enemy-facing effect (pure teleport, or a self/ally shield) costs 5.** *AC: the
nine `phase: "dash"` abilities carry exactly —* `bastion.ram_charge` **3→4**, `ravok.bullrush` **3→4**,
`kestrel.skim` **2→4**, `thorn.bramble_stride` **3→4**, `wisp.blink` **2→4**, `aegis.intercept` **3→5**,
`cinder.backdraft` **3→5**, `lumen.glimmer_step` **3→5**, `vex.combat_roll` **2→5**; *no other field
changes; suites stay green.* **Spec Notes.** Nine one-field edits. **Wisp's Blink at 4 is the deliberate
exception** (pure teleport, but Wisp is lowest-HP with a range-2 basic, so Blink is approach *and* exit
— AR kept the same PuP exception; do not move to 3 or 5). Aegis Intercept→5 is safe (Barrier Pulse
Prep-2 shield is unchanged). Out of scope: `energyGain`, ranges, damage, Prep, ults.

### CD-BAND-BLAST. Every non-basic blast costs 3 or 4 turns (DATA) — UNBLOCKED (after WARDING-WALL)
**Addresses owner directive #2.** Rule: **a non-basic blast costs 3; 4 only if its damage exceeds the
undelayed skill ceiling of 24 (`roster-v1.md` §4).** *AC: the non-basic `phase: "blast"` abilities carry
exactly —* `cinder.flare_burst` **2→3**, `kestrel.kite_shot` **2→3**, `lumen.dazzling_ray` **2→3**,
`ravok.shockwave` **2→3**, `wisp.bola` **2→3**, `vex.frag_grenade` **3→4**, `bastion.chain_hook`
**unchanged at 3**; *every* `abilities[0]` *auto-attack stays* `cooldown: 0`; *no other field changes.*
**⚠ `aegis.grounding_strike` is REMOVED from this list — WARDING-WALL replaces it with a Prep ability, so
it is no longer a Blast. Do not touch it here.** **Spec Notes.** Six one-field edits (Chain Hook already
in band). Nothing below 3 is deliberate (every non-basic blast carries a status rider; the plain shot is
the 0-cooldown basic). Frag Grenade at 4 is the single upward exception (34 dmg > the 24 cap). Out of
scope: `energyGain`, auto-attacks, Prep, ults.

### CD-BAND-INVARIANT. The bands are enforced by a test (TEST) — BLOCKED on the two CD-BAND data items
*AC: `packages/engine/test/content.test.ts` asserts, over all nine characters:* `abilities[0]` *is*
`phase:"blast"` `cooldown:0`*; every* `ultimate` `cooldown:0`*; and* **dash ⇒ 4 ≤ cd ≤ 5**, **blast ⇒
3 ≤ cd ≤ 4** *(non-basic)*, **prep ⇒ 2 ≤ cd ≤ 5** *(frozen). The failure message names the band so a
future author reads the rule.* **Spec Notes.** Extend `content.test.ts` (don't add a file). No
allow-list (with Blink at 4 every value is in band; **Warding Wall is Prep cd 4 — inside the prep
band**, so it needs no exception). Out of scope: `validate.ts` (schema stays value-agnostic).
**Mechanical risk:** any test that advances turns to wait an ability off cooldown needs its turn count
raised — **do not adjust a data value to keep a test green.**

## Server — the downed-seat wait

### DOWN-SEAT-SKIP. A seat with no living units is not waited on (SERVER) — UNBLOCKED
**Addresses Builder session-7 OQ #1.** DEATH-HANG's downed seat holds correctly, but the room waits the
full 40s on a turn it cannot act in. *AC: `#answering()` (and the lock total) **excludes a seat that
controls no living units this turn**, so the turn resolves as soon as every seat that *can* act has
locked; the downed seat's units hold; "Hold Position" stays for a seat with some units still alive. A
test: a match where one seat's only unit is down resolves as soon as the other seat locks.* **Spec
Notes.** Files: `packages/server/src/hub.ts` (`#answering` — intersect the seat's `controlledUnits`
with alive). Deterministic; N-safe; the "no turn ever waits on a player" principle applied to a downed
seat. Ruled (DOWN-SEAT-SKIP). Out of scope: the client hold UI (correct); the timer.

## Routed to Designer / flags

- **WARDING-WALL design confirmations** — aim direction, dasher-through (default yes), kit-reshape
  intent. **Aegis beam distinctness** (now a 3-wide lane — re-ask if it reads distinct enough).
- **Self-lethal recoil warning** (session-7 OQ #4) — a "this whirl will kill you" tell is a design call,
  not scheduled. **Burn/regen pip glyphs** (OQ #6) — new art, worth a look on a real plate.
- **Warding Halo's dead `weaken`**, **trap count cap**, **inspect-panel chips hoverable**,
  **chase-preview detour**, **Solar Flare DoT ceiling**, **Thorn mine carpet** — unchanged flags.

## Flagged future (not scheduled)

- **NET-E2E**, **M3-REMATCH**, **IDLE-KICK**, **LOBBY-TEAM-CHOICE**, **CAMO-E2E-FINISH** (low),
  **same-turn-buff preview** (OQ #2), **route-around-bodies dash impact preview** (OQ #3) — unchanged.

## Observed-not-requested / playtest (not Builder-blocking)

- **A real two-machine internet playtest** (DEATH-HANG shipped — exercise a death). **The cooldown bands
  feel** (dashes at 4–5 change the tempo), **Warding Wall**, **Ram Charge's line**, **the new HUD**,
  **AIM-PREVIEW-TRUE**, **Ravok's recoil**.
