# rulings-v1-blockers.md — Designer rulings on the seven blocked items

**Date:** 2026-08-13 · **Author:** Designer · **Status:** RULED (approved by the project
owner). Part of the spec, same standing as `edge-cases.md`.

This file closes the "Blocked — needs a Designer ruling" section of `BACKLOG.md`, carried
in every Analyzer review since 2026-08-12 as *"charge combat (first/all/destination + the
amount-1 knockback case), decoy D1, duplicate picks, `combat_roll`, cover-vs-Might, Support
kit, roster §9."*

**How to use this file.** Each ruling below is written to be **lifted verbatim** into
`edge-cases.md` (which the Analyzer owns and grows) or into a backlog item's Spec Notes.
The Designer does not edit `BACKLOG.md` or `packages/` — role boundaries, CLAUDE.md. Where
a ruling needs engine work, it carries an explicit `ENGINE ASK` with the smallest
data-driven shape I could find; where it merely confirms shipped behavior, it says so, and
the Analyzer's job is to record it, not to schedule work.

**Summary — what actually changes:**

| # | Item | Outcome | Engine work? |
|---|---|---|---|
| R1a | Charge damage targeting | First enemy crossed — **confirms shipped code** | No (one optional field for R1b's sibling case) |
| R1b | `chargeHits: "all"` for Tempest Run | New optional ability field | **Yes** — small, data-driven |
| R1c | amount-1 knockback onto the charger | **Carry through** (supersedes the net-zero interim) | **Yes** — small |
| R2 | Decoy entity (D1) | Full spec below | **Yes** — the largest item here |
| R3 | Duplicate picks | Unique within a team; mirrors across teams legal | No (M3 lobby validation) |
| R4 | `combat_roll` path-vs-teleport | `shape` is the authority — **no data change** | No (optional content guardrail) |
| R5 | Cover-vs-Might composition | **Confirm as final**, close the flag | No |
| R6 | Support archetype kit | **Unblocked** — both prerequisites are ruled and built | No |
| R7 | roster-v1 §9 ENGINE ASKs | Closed against what shipped; one real gap (`untargetable`) | Trivial (one table row) |

---

## R1 — Charge combat (bundled: targeting + the amount-1 knockback case)

### R1a. Who a damaging charge hits — RULED: the first enemy crossed

Since MV1 (dashes pass through characters), "stops in front of the first enemy" no longer
defines the victim, so the question became live. **Ruling: a damaging charge hits the first
enemy whose square its path crosses, and only that enemy.** Not the destination, not
everyone crossed.

Rationale: it matches three of the roster's four charges as written (Ram Charge, Bullrush,
Skim all say "the first enemy"), and it keeps a charge a single-target commitment rather
than a free damage line — a charge that hit everyone it ran through would make Frontline
dives strictly better the more crowded the fight, which is backwards for a 2v2 default.
Destination-only is rejected outright: a charge that visibly runs through a body and deals
nothing reads as a bug, not as a rule.

> **RULED — Damaging charges hit the first enemy crossed (Designer, 2026-08-13).** A
> `shape: "path"` dash carrying a `damage` effect damages the **first enemy whose square
> the path crosses** — whether it was passed through or run into — and no others. The
> destination square is not special. This **confirms the shipped behavior** of
> `resolve.walkCharge` (`firstEnemy`), which needs no change.

### R1b. Charges that should hit everyone — `ENGINE ASK`: optional `chargeHits` field

One kit wants the other behavior: Kestrel's ultimate **Tempest Run** is designed as a
full-board sweep ("every enemy passed takes 35 and is Slowed") — that breadth *is* the
ultimate, and it is why the ult costs 100 energy while Skim costs a 2-turn cooldown.

> **`ENGINE ASK` — Optional `chargeHits` on `AbilityDef` (Designer, 2026-08-13).** Add
> `chargeHits?: "first" | "all"` to `AbilityDef`, **defaulting to `"first"`** when absent.
> On `"all"`, a damaging `path` dash applies its effects to **every** enemy whose square
> the path crosses; on `"first"` (and when absent) behavior is exactly as ruled in R1a.
> Energy is unchanged — still once per use on hitting ≥1 enemy (`edge-cases`, "Energy on
> multi-hit"). Validation: reject any value other than the two literals; the field is
> meaningless on non-`path` shapes and should be rejected there rather than ignored.
>
> Rationale for a data field over a new effect kind: golden rule #2 — this is a knob on an
> existing mechanic, so it belongs in data, and every future charge picks its own breadth
> without an engine change.
>
> **Interim (documented, not silent):** `data/characters/kestrel.json` already carries
> `"chargeHits": "all"` on `tempest_run`. Until the field is implemented the engine ignores
> it and Tempest Run hits only the first enemy crossed — weaker than designed, never
> stronger, so it is safe to ship in the meantime. `validate.ts` ignores unknown keys, so
> the data passes today's content tests unchanged (verified: 262 tests green with the field
> present).

### R1c. The amount-1 knockback that lands on the charger — RULED: carry through

The residual from MV1-fix: with pass-through, a charge can land *beyond* its victim, and if
the victim's knockback distance equals the overshoot, the victim's landing square is the
charger's own square. The v1 interim was "victim stops one short" — a net-zero displacement
that makes Ram Charge look like it did nothing.

**Ruling: carry through — the charger's square is skipped, not counted.**

> **RULED — Displacement skips the displacing attacker's square (Designer, 2026-08-13;
> supersedes the v1 interim "amount-1 charge knockback onto the charger stays put").** Walk
> the displacement line the nominal number of squares as normal. If the resulting landing
> square is occupied by **the unit that caused the displacement**, advance to the next
> square along the same line, repeating while that square is the displacer's — i.e. the
> displacer's body is skipped rather than counted as the stopping point. The victim may
> therefore travel one square further than the nominal distance, and only ever past the
> displacer.
>
> If no free square exists beyond it (wall, cover, board edge, or a third unit), fall back
> to the existing rule — the victim stops on the last free square along the line, which
> reproduces the old net-zero result. The "no two units at rest on one square" invariant is
> never violated in either branch.
>
> This is the natural completion of the ruling already in force ("displacement ignores the
> displacing attacker's own body") — that ruling made the charger transparent to the
> *path*; this makes it transparent to the *landing* too. Rejected alternative: **swap**
> (victim and charger exchange squares) — it moves the victim *backwards* relative to the
> knockback vector, which is visually incoherent, and it interacts badly with simultaneous
> displacement where two swaps could contend for the same square.
>
> Ships with a regression test (golden rule #3): Ram Charge overshooting its target by
> exactly 1 displaces the victim to the far side, and the wall-blocked variant still
> yields the documented net-zero.

**Balance note for the Analyzer:** R1c makes Ram Charge and Bullrush marginally stronger in
open ground (they now always displace). That is the intent — displacement cancels the
victim's Move, which is the whole point of a Frontline charge — and the roster's
displacement budget (§4 of `roster-v1.md`: max one knockback ≥2 or pull ≥2 per kit) already
accounts for it.

---

## R2 — D1: the Decoy entity (Wisp's Veil & Decoy)

Currently `decoy` is a no-op beyond the Stealth it ships with. Full spec:

> **RULED — Decoy is a static fake unit that dies to any damage (Designer, 2026-08-13;
> closes the OPEN decoy ruling and backlog D1).**
>
> - **Spawn.** Applied in Prep at the caster's square, in the same effect resolution as the
>   Stealth it accompanies. It never moves, acts, or takes a turn.
> - **Lifetime.** Expires at the end of the **next** turn (matching the 1-turn Stealth
>   window it is paired with), or immediately when destroyed — whichever comes first.
> - **Destruction.** **Any** damage destroys it; it has no HP pool. Deliberate: a decoy
>   with hit points is a second balance surface for no gain — the payoff is informational,
>   not attritional. An enemy that *ends a move on its square* also destroys it (you walked
>   through the ghost), which is the only way to kill it without spending an ability.
> - **It is not a unit for any other purpose.** It does not block movement, pass-through,
>   line of sight, or square occupancy (consistent with "units never block"); it does not
>   trigger traps, cannot be healed, buffed, displaced, or killed for a kill-tally credit,
>   and it is not a valid respawn blocker.
> - **No reward for hitting it.** Damaging a decoy grants the attacker **no energy** and
>   applies no on-hit riders — it is not an enemy unit. Consequently an ability that hits
>   *only* a decoy grants nothing, exactly like a shot that hits nobody.
> - **Information.** The decoy is rendered to the **enemy team as Wisp** (her sprite, and
>   an HP bar frozen at her cast-time value, so it is not trivially distinguishable); to
>   Wisp's own team it renders as a decoy. Its destruction emits a visible event — that
>   reveal *is* the mind-game payout, for both sides: the enemy learns they were fooled,
>   and Wisp learns where they aimed.
>
> **Engine shape (`ENGINE ASK`).** Model it as a separate `decoys: DecoyState[]` list on
> `GameState` (`{ id, teamId, pos, expiresOnTurn }`), **not** as an entry in `state.units`
> — keeping it out of `units` means every existing phase loop, vision union, spawn picker
> and win-condition check stays correct without a "is this real?" guard on each. Damage
> resolution checks the decoy list after the unit list and emits
> `{ type: 'decoyDestroyed', decoyId, pos }`. Deterministic and N-unit-safe: decoys are
> appended in unit order and only ever removed by index.
>
> **Playtest flag:** if Wisp proves oppressive, the first lever is the lifetime (drop to
> the cast turn only), not the destruction rule.

---

## R3 — Duplicate picks

> **RULED — Unique within a team; duplicates across teams are legal (Designer,
> 2026-08-13; closes the OPEN duplicate-picks ruling).** A team may not field the same
> character twice. Both teams **may** field the same character (mirror matchups are legal
> and expected in blind pick).
>
> Rationale: intra-team stacking is the degenerate case — a double-Lumen Sanctuary loop or
> a double-Thorn minefield turns 2v2 into a stall comp that the kill target and turn limit
> struggle to police, and it dissolves the kit identity the roster is built on. Cross-team
> mirrors cost nothing, are standard in the genre, and matter for pick psychology (both
> players want Bastion — fine, both get one). Roster math holds at every format: 9
> characters ≥ 4 per team, so even 4v4 never runs out of legal picks.
>
> **Where it lives:** M3 lobby validation, not the engine — the engine already mints unique
> unit ids and is indifferent. The rule is a *selection* constraint; a room whose format
> requires more characters per team than the roster contains is a map/format validation
> error, not a duplicate-pick question.

---

## R4 — `combat_roll`: path vs teleport

Flagged 2026-08-12: Vex's Combat Roll is `shape: "path"` (a walked roll) but carries the
`teleport` effect (which implies skipping the squares between). Cinder's Backdraft has the
same shape. The apparent contradiction dissolves once the two fields are given distinct
jobs — and, importantly, **the engine already behaves correctly**.

> **RULED — `shape` is the authority for *how* a reposition happens; the `teleport` effect
> only says *that* the caster repositions (Designer, 2026-08-13).** `resolve.ts` already
> branches on `a.def.shape === 'path'` (walked charge) vs otherwise (teleport), per the
> 2026-08-14 walked-dash-vs-teleport ruling — so a `path`-shaped ability carrying a
> `teleport` effect is **already** walked: it traverses its squares, triggers traps it
> enters, and is stopped by walls and cover. There is no data mismatch to fix and **no data
> change is made**.
>
> Read the two fields as: **`shape` = the geometry of the reposition** (`path` walked,
> `square` airborne); **`teleport` in `effects` = "this ability moves its caster"**, which
> is what makes it an inherently self/utility ability for the energy-on-use rule.
>
> Consequently: **Combat Roll (Vex) and Backdraft (Cinder) are walked ground dashes** —
> trappable, wall-blocked, and dodging Blast aimed at the vacated square (which walked
> dashes do just as well as teleports; that is a property of resolution order, not of
> geometry). Only Wisp's Blink and Shadowstep (`shape: "square"`), Lumen's Glimmer Step and
> Aegis's Intercept cross walls. This is the intended roster shape: **wall-crossing is
> Wisp's identity and the supports' escape budget; Firepower repositions stay on the
> ground**, which is the counterplay a long-range zoner like Vex owes the opponent.
>
> **Rejected alternative:** removing the `teleport` effect to leave the shape alone.
> `validateAbility` requires `effects.length >= 1`, so an effectless walked dash is invalid
> content; fixing that would mean either a new `reposition` effect kind (an `EFFECT_KINDS`
> change for zero behavioral gain) or relaxing validation. Both are worse than reading the
> two existing fields correctly.
>
> **Optional guardrail for the Analyzer** (content test, not engine): assert that no
> `shape: "path"` ability is ever resolved through the teleport branch, so a future refactor
> can't silently make Combat Roll wall-crossing.
>
> **Energy interaction — already covered.** The ruled energy-on-use conditions include
> "carries a `teleport` effect", so Combat Roll and Backdraft bank their `energyGain` on
> use, as designed. Had the effect been deleted, they would have banked nothing; another
> reason this reading is the right one. *(If a future walked dash ships with no `teleport`
> effect, extend the rule to "any `phase: "dash"` ability pays on use" — a dash is
> inherently utility. Not needed today.)*

---

## R5 — Cover-vs-Might composition order

> **RULED — The shipped order is final: outgoing (Might/Weaken) → cover → shields → HP,
> each an independent `floor` (Designer, 2026-08-13; closes the flag carried since
> 2026-08-13's Builder OQ7).** No change; the PROPOSED status is retired.
>
> The two candidate orders differ by at most **1 point**, and only where both a modifier
> and cover apply to an odd-ish base. Worked examples: Vex's Rail Shot (26) with Might into
> cover is **16 either way**; her ultimate Lance of Dawn (45) with Might into cover is
> **28** under the shipped order versus **27** under the reverse — a 1-point,
> attacker-favorable difference on the single biggest hit in the game.
>
> The shipped order is also the more intuitive story ("the attacker's strength is a
> property of the attack; the defender's cover then reduces what arrives"), it matches how
> Haste/Slow already compose, and it is implemented with tests. No balance goal is served
> by churning it. Revisit only if playtests produce a concrete complaint — and if they do,
> it is the one-line change the 2026-08-13 review already identified.

---

## R6 — Support archetype kit: **unblocked**

> **RULED — Support kits are cleared to build as drafted (Designer, 2026-08-13).** The two
> engine capabilities Support was blocked on are now **both ruled and shipped**: effect
> polarity / no friendly fire (2026-08-15, item 14) and beneficial-abilities-pay-
> `energyGain`-on-use (2026-08-15). The original deferral reason — DECISIONS 2026-08-11,
> *"healing an ally is meaningless in 1v1"* — no longer applies now that **2v2 is the
> default format** (GAME_SPEC §1). Lumen and Thorn ship as drafted in
> `data/characters/`; no kit changes.
>
> Two standing constraints, both permanent:
>
> 1. **Self-applicability is a rule, not a convenience.** Every beneficial effect on a
>    Support (or hybrid) kit must be aimable at the caster's own square — aimed circles
>    include the caster, `self`/`square` shapes work alone. 1v1 remains a supported
>    dev/testing format, and a character that cannot function in it is a broken character.
>    This is already true of every drafted kit; it constrains future ones.
> 2. **Supports pay for their support budget in damage.** Auto attacks stay in the 16–18
>    band against Firepower's 22–26 (`roster-v1.md` §2). If playtests want Supports
>    stronger, the lever is sustain or utility, not auto damage.
>
> **Anti-stall, re-scoped (playtest item, not a blocker).** `roster-v1.md` §8 assumed the
> 1v1 numbers (3 kills / 12 turns). The default format is now 4 kills / 16 turns, and 4v4
> is 5 / 20 — a longer clock is friendlier to double-sustain comps than the one I sized
> against. Priority playtest: **Lumen + Thorn versus a double-Firepower comp at 2v2**, to
> confirm the kill-leader tiebreak still forces action rather than rewarding the team that
> stalls. If it does not, the lever is the per-format turn limit (Designer-tunable per
> GAME_SPEC §1), not the Support kits.

---

## R7 — Reconciling `roster-v1.md` §9 against what shipped

The 2026-08-15 teams build pre-empted both roster ENGINE ASKs. Closing each against the
implemented rulings, and accepting the engine's version where it differs from my draft:

| §9 item | Status | Note |
|---|---|---|
| 1. Effect target affinity | **CLOSED — superseded** | The shipped polarity table (`edge-cases`, "No friendly fire") is authoritative. Two deltas from my draft, **both accepted as better**: `teleport` is **neutral** (self-placement, not a gift — correct), and `trap` is **neutral placement** with team-safe triggering (correct). |
| 2. Energy on ally-benefit | **CLOSED — superseded** | Shipped rule ("any ability carrying a beneficial effect banks on use") is *more* generous than my draft ("must affect ≥1 friendly") and simpler to reason about. Accepted as-is. |
| 3. Trap rider effects | **CONFIRMED** | Sibling effects of a `trap` apply to the **triggering unit at trigger time** (Vex: 20 + Reveal; Thorn: 12 + Root). This is what the shipped trap code does; recording it as an explicit ruling so a refactor can't drift. |
| 4. Dash rider effects | **CONFIRMED** | Riders apply to the **caster at the destination** (Wisp's ult precedent; Lumen's Glimmer Step and Aegis's Intercept shields depend on it). Matches shipped behavior. |
| 5. No life steal in v1 | **UNCHANGED** | Intentionally absent from `EFFECT_KINDS` and from every kit. Firepower survivability is dashes/stealth/shields; Berserker sustain is a self-heal skill. |
| 6. Decoy | **CLOSED** | Superseded by **R2** above. |

### The one genuine gap: `untargetable` has no polarity

The ruled polarity table covers 17 of the 18 `EFFECT_KINDS`. `untargetable` is missing.

> **RULED — `untargetable` is beneficial (own team only) (Designer, 2026-08-13).** Add it
> to the beneficial row of the polarity table so the table is **total** over
> `EFFECT_KINDS`. It appears only on Wisp's self-applied ultimate today, so this has no
> behavioral consequence now — it closes the hole before a future kit falls into it. The
> Analyzer may reasonably pair this with a content test asserting every `EFFECT_KIND`
> appears in exactly one polarity row.

---

## Consolidated handoff — what the Analyzer needs to schedule

Engine work created by this file, smallest first. All are unblocked as of this document;
each ships with tests per golden rule #3.

1. **R1c — displacement skips the displacer's square.** Small, self-contained in
   `resolve.applyDisplacements`. Fixes the visible Ram Charge net-zero. *Do this first.*
   **Heads-up — an existing test asserts the superseded interim.** PR #12 (MS1/MV4) adds
   `dash.test.ts` → *"MV4: diagonal charge paths"* → *"a diagonal charge validates, passes
   through, and strikes the crossed enemy"*, which asserts the victim stays at `(2,2)` with
   the comment *"1-square knockback onto the charger nets zero (MV1-fix interim)"*. Under
   R1c that victim is carried past the charger at `(3,3)` to `(4,4)`. **Update that
   expectation as part of the R1c commit** — it is a deliberate behavior change, not a
   regression. Also check `real-characters.test.ts` (Ram Charge) for the same assumption.
2. **R7 — add `untargetable` to the polarity table** (one row; a test if you want the
   totality guarantee). Trivial.
3. **R1b — `chargeHits?: "first" | "all"`** on `AbilityDef` + `walkCharge` + validation.
   Small; data already carries the field on `tempest_run`.
4. **R2 — the decoy entity (D1).** The only substantial item: new `decoys` list on
   `GameState`, Prep spawn, damage/move destruction, expiry, `decoyDestroyed` event, and
   client rendering (enemy sees Wisp, own team sees a decoy).

No engine work: **R1a** (confirms shipped), **R4** (confirms shipped; optional content
guardrail), **R5** (closes a flag), **R6** (unblocks content already in `data/`), **R3**
(M3 lobby validation — carry it forward to the M3 item's Spec Notes).
