# dev-notes-batch-3.md — 21 owner Dev Notes, triaged and ruled (Designer)

**Date:** 2026-08-16 · **Status:** RULED (owner directives, verbatim below in condensed
form). Grouped: **A** lobby & turn flow (#1–8), **B** kit changes (#9–18, #20), **C** two
systems rulings (#19, #21). Data expressible today ships in this PR; everything needing a
schema field is gated behind its engine item, per the standing data-must-not-lead convention.

---

## A. Lobby & turn flow (#1–8) — client/server items, no Designer numbers needed

| # | Note | Item | Spec sketch |
|---|---|---|---|
| 1 | "Your Team" bar extends past into the log | `LOBBY-BOUNDS` (client) | Container overflow fix; AC: the team bar clips/wraps inside its panel at both map sizes and 8 seats |
| 2 | Hover a character in the lobby → details | `LOBBY-INSPECT` (client) | Reuse the shipped UI-INSPECT panel (kit, HP, energy) in the lobby — same component, no vision gate in the lobby |
| 3 | Hover a catalyst in the lobby → what it does | `LOBBY-INSPECT` (same item) | The catalyst tooltip already exists in-match (TT1/CAT2); surface it in the lobby picker |
| 4 | Seat 0 starts; others "ready up" | `LOBBY-READY` (server + client) | Seat 0 (room creator) holds the Start button, enabled only when every other occupied seat has readied; readying is revocable until start |
| 5 | Lock-in timer disappears after turn 1 | `TIMER-PERSIST` (client bug) | Regression: the timer must render every Decision phase, not only the first |
| 6+7 | Timer = a draining bar above the skills, flowing into a **bigger** Lock In | `TIMER-BAR` (client) | One redesign, not two: a horizontal depletion bar spanning the hotbar's width, visually joined to an enlarged Lock In at its right end (the AR arrangement — see the owner's screenshot from the UI batch); tenths + colour shift under 10 s and Time Bank pips carry over from UI-TIMER |
| 8 | Locked characters act even if others didn't lock | `RESOLVE-PARTIAL` (ruled) | See below |

> **RULED — #8, partial lock-in (Designer, 2026-08-16).** When the Decision phase ends —
> timer expiry, or every seat locked — the turn **always resolves**: characters whose orders
> were locked act exactly as locked; characters never locked **hold** (no ability, no move,
> no free action, no catalyst). This confirms GAME_SPEC §2's "nothing selected = hold" and
> closes the OPEN "simultaneous disconnect/timeout" lean the same way. A seat that locked
> *some* of its characters and not others: the locked ones act, the unlocked ones hold —
> per-character, not per-seat. No turn ever waits on a player.

---

## B. Kit changes (#9–18, #20)

### Shipped in data this PR (no schema gap)

| # | Change | Data |
|---|---|---|
| 13 | **Stoke the Flame becomes a free action** | `free: true`, cooldown 3 → **4**, energy 6 → **0** — the standard free-conversion price (+1 cd, no energy). **Note:** this is an owner override of the free-action criteria in `free-actions-and-catalysts.md` §1.2, which excluded immediate-combat-power buffs. The rule now reads: *Prep phase, no immediate damage/HP, deferred-or-conditional payoff — **or owner-designated**.* Cinder's identity is the amplifier who buffs *and* acts; recorded as the deliberate exception, not a drift. |
| 14 | **Flare Burst: DoT + Reveal 2** | `damage 10 + damageOverTime 6×2 + reveal 2` (was flat 18 + reveal 1). 22 total over three turns — the burn is the fire kit's texture, and the 2-turn Reveal restores the stealth-counter role at full strength |
| 15 | **Solar Flare (ult): DoT added** | `damage 30 + damageOverTime 8×2 + weaken 1` (was flat 35 + weaken 1). 46 total across three turns against the old 35 — more total, slower to arrive; the ult ceiling (45 flat) is respected because over-time damage is answerable (Second Wind, Regenergy, Lumen) in a way burst is not. Playtest flag regardless |
| 10a | **Snare Bloom: Root → Slow that bites next turn** | `trap 12 + slow (duration 2)` — duration 2 so the slow survives the trigger turn's end-of-turn tick and shortens the *next* turn's move, per the owner's "slow for the next turn." The **halt** half is engine-gated (below); interim the snare is control-lighter than designed, never stronger |
| 20 | **Every dash/blink minimum range 4** | Combat Roll 3→4, Backdraft 3→4, Glimmer Step 3→4, Bramble Stride 3→4, **Shift catalyst 3→4**. Cooldowns and costs unchanged (owner directive is a flat mobility floor). Builder: add the content-test guard — every `phase: "dash"` reposition has `range ≥ 4` — so a future kit cannot undercut it |

### Engine-gated (each ships with its data edit in the same commit)

| # | Item | Spec |
|---|---|---|
| 9 | **`TRAP-CENTRE`** (engine) — then Thorn's auto lays a mine | Rule: **a `trap` effect on an area shape places ONE trap, at the aimed centre square** — never one per covered tile. Then Barbed Sling gains `{ trap, amount: 8, lifetime: 2 }`: every shot leaves a mine on its centre square for 2 turns. The zone kit carpets the ground it shoots at — up to two live auto-mines plus the snare. Trap cap note: the shipped per-team trap cap (4) applies and is the balance backstop; if the carpet is oppressive the lever is the auto-mine's `amount` 8 → 0-with-reveal, not the cap |
| 10b | **`TRAP-HALT`** (engine) — the snare stops movement | New trap field `halt: true`: a unit entering a halting trap **ends its movement on that square immediately** (remaining path/dash discarded; not a displacement, so no Move-cancel semantics beyond the discard). Snare Bloom carries it. Unstoppable ignores the halt (it ignores the slow already) |
| 11 | **`ALLY-SAFE`** (engine) — Lumen's auto never damages allies | New ability flag `noFriendlyFire: true`: the ability's **harmful** effects skip the caster's own team (beneficial unchanged). FF1 stays the global default; this is the per-ability exception, and Radiant Lash is its first carrier — a Mender whose heal-beam friendly-fires was self-contradictory. Validation: meaningless without a harmful effect; reject on abilities with none |
| 16+18 | **`CASTER-SAFE`** (engine, global) — verified live: Whirling Cleave self-hits for the full 22, Shockwave for 12 | Rule: **a unit is never a target of its own ability's harmful effects.** Global, not per-ability — no kit wants accidental self-harm, and FF1's "ally or enemy" was never meant to read "including yourself." Fixes Ravok's auto and Shockwave (damage *and* self-slow) in one rule |
| 17 | **`RECOIL`** (engine) — Seismic Rupture hurts Ravok at half | The deliberate exception to CASTER-SAFE: ability field `selfDamagePct: 50` — the caster takes `floor(amount × pct / 100)` of the ability's damage (19 from 38), bypassing cover (you cannot take cover from the ground under you) but consuming shields normally. Seismic Rupture carries it: shattering the earth under your own feet should cost something, and it prices the 38-damage r3 ult honestly |
| 12 | **`MENDING-RANGE`** (bug — Builder) | Owner report: Mending Light heals outside its range. Verify against the Euclidean aim gate + r1 area; likely candidates: envelope vs `aimInRange` disagreement, or the heal reaching the caster regardless of area. Regression test with the exact observed case |

---

## C. Two systems rulings (#19, #21)

### #19 — `BRUSH-BREAK`: being hit in brush suppresses the brush, not the unit

> **RULED.** Taking damage while concealed by brush must **not** apply the Revealed status.
> Instead the unit's **brush concealment is suppressed for the current and next turn** — the
> unit is drawn for the enemy team even while standing in brush — modelled as a unit-level
> `brushBroken` marker with duration 2 (survives the tick, expires end of next turn).
>
> The distinction matters: **Reveal pierces everything, everywhere, including Stealth and
> future hiding spots; brush-break negates only brush, only for this unit, only for two
> turns.** Getting shot proves where you *were* — it should not install a tracking beacon.
> Walking out of the broken brush and into another patch next turn: still visible (the
> suppression is on the unit, not the patch — simpler, and the owner's "would show your
> character" reads as unit-scoped). Stealth (the status) is unchanged: damage still breaks
> it outright, per the standing ruling. Interaction: a unit with `brushBroken` **and**
> active Stealth is still hidden by the Stealth — brush-break removes one veil, not both.

### #21 — `PHASE-STATUS-FIRST`: statuses land before damage inside every phase

> **RULED.** Within each of Prep, Dash and Blast, resolution runs **two simultaneous
> sub-steps: first every status application in the phase (buffs and debuffs, all at once),
> then every damage/heal application (all at once, computed against the post-status
> state).** So a Weaken landed by this turn's Dazzling Ray blunts the victim's attack *in
> the same Blast*, and a Might granted in Prep boosts that unit's Prep-phase trap the
> moment it arms.
>
> **Simultaneity survives** — that is the entire trick. Both teams' status applications
> land together, then both teams' damage computes together: mutual Weakens both apply and
> both attacks arrive blunted; nobody is order-privileged and mutual kills still land in
> full. Displacement keeps its end-of-Blast slot; catalysts already resolve at phase start
> (before both sub-steps), unchanged.
>
> This **extends** the ruled "a status takes effect when applied" reading from
> across-phases (Blast slow bites this turn's Move — already true) to within-phase, and it
> **supersedes** the current behaviour where a Blast-applied Weaken affects nothing until
> the next turn. Consequences to name: Dazzling Ray and Suppression become same-trade
> defensive tools (their whole point, per the kit sheets); Bola's slow still cannot touch
> the same phase's damage (slow is movement, not damage); Overdrive's same-turn Might is
> unchanged (it already landed at phase start). Ships with the mutual-Weaken symmetry test
> and a regression on mutual kills.

---

## D. Handoff — suggested sequencing

1. **`TIMER-PERSIST`** (bug) + **`MENDING-RANGE`** (bug) — both are broken promises, first.
2. **`CASTER-SAFE`** — one global rule, fixes two observed wrongs; **`RECOIL`** rides with it (Seismic data in the same commit).
3. **`PHASE-STATUS-FIRST`** — the deepest engine change here; its tests are the deliverable.
4. **`TRAP-CENTRE` + `TRAP-HALT`** — Thorn's mine and halt, data in the same commits.
5. **`ALLY-SAFE`** — Lumen's flag.
6. **`BRUSH-BREAK`** — vision-adjacent; touches `canSee` and the fog renderer.
7. **`TIMER-BAR`** (+#7), **`LOBBY-BOUNDS`**, **`LOBBY-INSPECT`**, **`LOBBY-READY`**, **`RESOLVE-PARTIAL`** — client/server batch; RESOLVE-PARTIAL is ruled above and mostly falls out of M3-TIMER's hold-on-expiry.

Shipped in data this PR: Stoke free (+1 cd, e0), Cinder's two DoTs, Snare root→slow 2
(interim, control-light until TRAP-HALT), and the range-4 dash floor across five abilities.
