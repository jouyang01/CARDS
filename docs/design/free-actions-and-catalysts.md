# free-actions-and-catalysts.md — two new systems (Designer)

**Date:** 2026-08-13 · **Status:** RULED (owner directive). Part of the spec.
**Analyzer:** this is a spec to schedule, not a finished feature — the engine supports
neither system yet. Every `ENGINE ASK` below is required; the data in `data/` is already
written against the final design and is inert until the engine reads it.

**Reverses** DECISIONS 2026-08-11 *"Catalysts and ability mods deferred (M6+)"* — catalysts
come forward to v1 at the owner's direction. **Ability mods stay deferred**; only catalysts
move.

---

# Part 1 — Free actions

## 1.1 What a free action is

> **RULED — A free action does not consume your turn (Designer, 2026-08-13).** An ability
> marked `free: true` may be used **in addition to** a normal ability, and **does not reduce
> the move budget or block Sprint**. The legal turn shapes become:
>
> | Turn | Legal? |
> |---|---|
> | free action + normal ability + 4-square move | ✅ |
> | free action + **Sprint 8** | ✅ |
> | free action + dash ability (the dash is the move) | ✅ |
> | free action alone + 4-square move | ✅ (nothing else spent) |
> | **two free actions in one turn** | ❌ — see the one-per-turn rule (§1.4) |
>
> A free action resolves in its own phase exactly like any other ability. "Free" is purely
> about **what it costs you to declare it**, not about how it resolves.

## 1.2 Which abilities may be free — the rule, not a list

An ability may carry `free: true` **only if all three hold**:

1. **It is Prep phase.** Free Dash/Blast actions are the catalysts' job (Part 2), which are
   once-per-match and therefore self-limiting. A repeatable free Blast is a second attack.
2. **It deals no immediate damage and grants no immediate HP** (no `damage`, `heal`, or
   `shield`).
3. **Its payoff is deferred or conditional** — it does not decide *this turn's* exchange.

The point of the mechanic is to make **setup plays viable without losing tempo**. A trap turn
is currently a turn you don't shoot, for a payoff that may never arrive; that is the problem
free actions exist to fix. Anything that wins the current exchange is not a setup play.

## 1.3 Where free actions fit the existing roster

Applying the rule to all ten Prep abilities in the roster, exhaustively:

| Ability | Owner | Effects | Free? | Why |
|---|---|---|---|---|
| **Overwatch Trap** | Vex | trap + reveal | ✅ **yes** | The archetype: conditional, deferred, may never trigger. |
| **Snare Bloom** | Thorn | trap + root | ✅ **yes** | Same. This is Thorn's whole identity and it currently competes with her own auto attack. |
| **Veil & Decoy** | Wisp | stealth + decoy | ✅ **yes** | Grants no HP and no damage; and free-Veil-plus-attack is *self-defeating* (attacking breaks Stealth), so the only thing it really buys is Veil + Sprint — reposition while hidden. That is exactly the assassin fantasy, and it costs a whole turn today. |
| Bulwark | Bastion | shield 30 | ❌ | Immediate HP. |
| Barrier Pulse | Aegis | shield 20 | ❌ | Immediate HP. |
| Mending Light | Lumen | heal 25 | ❌ | Immediate HP. |
| Verdant Veil | Thorn | heal 20 | ❌ | Immediate HP. |
| Blood Frenzy | Ravok | heal + might | ❌ | Immediate HP **and** immediate damage. |
| Stoke the Flame | Cinder | might + energized | ❌ | Might decides this turn's exchange. |
| Slipstream | Kestrel | haste + energized | ❌ | Haste decides this turn's movement. |

**Three free actions, and they are the three setup kits** — the two trap layers and the
stealth ambusher. That is not a coincidence; it is the rule doing its job.

### The price — free is paid for in cooldown and energy

> **RULED — A free action grants no energy, and pays for itself in cooldown.** `free: true`
> requires `energyGain: 0` (a **validation error** otherwise, not a runtime special case —
> otherwise a free action is strictly better in every dimension at once). Each converted
> ability also takes a cooldown increase:

| Ability | Cooldown | Energy | Net effect |
|---|---|---|---|
| Vex — Overwatch Trap | 3 → **4** | 5 → **0** | Traps on turns 1/5/9 instead of 1/4/7, but **never at the cost of a Rail Shot**. |
| Thorn — Snare Bloom | 2 → **3** | 5 → **0** | 3 snares per 8 turns instead of 4 — plus ~7 Barbed Slings she could not previously fire. |
| Wisp — Veil & Decoy | 4 → **5** | 6 → **0** | Vanishes less often, but the vanish turn is no longer a blank turn. |

All three are clear net buffs to the kits that most needed one. The cooldown is the honest
tax; the energy loss protects the ult clock from free acceleration.

## 1.4 The one-free-action-per-turn rule

> **RULED (v1, conservative) — At most one free action per turn per character**, counting
> free abilities **and** catalysts together. So a Vex may place her trap *or* fire a catalyst
> in a given turn, not both.
>
> Rationale: it keeps a turn readable (at most three declared things: one free action, one
> ability, one move) and prevents a single turn from dumping a whole kit. **Flagged as the
> first lever to relax** if playtests find setup kits feel catalyst-starved — allowing "one
> free ability + one catalyst" is a one-line change to the same check.

## 1.5 `ENGINE ASK` — Part 1

1. **`free?: boolean` on `AbilityDef`.** Absent/false = today's behaviour.
2. **Order shape.** A free ability cannot ride in `UnitOrders.ability` — that slot is the
   turn's one normal ability. Add **`freeAbility?: AbilityOrder`** to `UnitOrders`, parallel
   to `ability`. Validation: the referenced ability must have `free: true`, be off cooldown,
   and belong to the unit; at most one of `freeAbility`/`catalyst` per unit per turn (§1.4).
3. **Budget independence.** `movementBudget` must be computed from `ability`/`sprint` only —
   a `freeAbility` never reduces it and never invalidates Sprint. This is the single most
   likely place to introduce a bug, because the current rule is "any ability ⇒ 4."
4. **Validation.** `free: true` requires `phase === 'prep'` and `energyGain === 0`; reject
   otherwise so a future kit cannot quietly grant a free Blast.

---

# Part 2 — Catalysts

## 2.1 The system

> **RULED — Three catalyst slots, one per phase, each once per match (Designer,
> 2026-08-13).** Every character carries exactly **three** catalysts — one **Prep (Green)**,
> one **Dash (Yellow)**, one **Blast (Red)**. Each is **consumed on use and gone for the rest
> of the match** — not a cooldown. Each is a **free action** (§1.1) and grants **no energy**.
> Death does not refund a spent catalyst, and unused catalysts survive death and respawn.

**Catalysts are chosen, not fixed to a character.** All nine are available to every
character — they are the customization layer, the reason two Vex players can differ.
Selection belongs to the **M3 lobby** (backlog item 21). Until that exists, every character
uses the **default triad: Second Wind / Shift / Adrenaline** — the three most neutral picks,
so the system is playable the moment the engine supports it.

## 2.2 The pool — nine catalysts

Shipped in `data/catalysts.json`. **Every one is built from effect kinds the engine already
implements — this system needs no new `EFFECT_KIND`.**

### Prep (Green) — *Preparations*: set up, survive, accelerate

| Catalyst | Effect | The play |
|---|---|---|
| **Second Wind** | heal 30, self | The emergency button. Read their burst, survive it, and still act. |
| **Ablative Field** | shield 35 (1 turn), self | Pre-empt a predicted burst. Bigger than any kit shield, but once. |
| **Brainwave** | Energized 3 turns, self | Buy your ultimate ~2 turns early. The tempo pick. |

### Dash (Yellow) — *Maneuvers*: get out

| Catalyst | Effect | The play |
|---|---|---|
| **Shift** | teleport up to 3 squares (`square` shape — ignores walls) | The universal escape. Gives a dash to kits that have spent theirs, and **does not consume your Move** (§2.4). |
| **Fade** | Untargetable 1 turn, self | Dodge without moving — you keep your position *and* your attack. The counter to a read. |
| **Unshackle** | Unstoppable 2 turns, self | Walk out of Root/Slow, ignore knockback and pull. The answer to Thorn, Bastion and Ravok. |

### Blast (Red) — *Surges*: push

| Catalyst | Effect | The play |
|---|---|---|
| **Adrenaline** | Might 2 turns, self | The straightforward damage push — and it boosts **this turn's** attack (§2.4). |
| **Suppression** | Weaken 2 turns, enemies within 2 (`circle` self r2) | Blunt the counter-swing instead of raising your own. The frontliner's pick. |
| **Overdrive** | Might 1 + Haste 1, self | Reads off the phase order: the Might lands on this turn's Blast, and the Haste lands on the Move that follows it. Hit hard, then leave. |

## 2.3 Why these nine

Each colour offers the same three-way choice — **survive / deny / accelerate** — so the pick
is a read on the matchup rather than a power ranking:

- **Green:** survive now (Second Wind) · survive a *predicted* hit (Ablative Field) · spend
  the slot on tempo instead (Brainwave).
- **Yellow:** escape by moving (Shift) · escape by not being there (Fade) · escape by being
  immune (Unshackle).
- **Red:** more damage out (Adrenaline) · less damage in (Suppression) · both, smaller, plus
  a reposition (Overdrive).

**Brainwave is deliberately not a flat energy grant.** AR's Brain Juice hands you energy
directly; we have no `energy` effect kind, and adding one for a single catalyst is a poor
trade. `Energized 3` is the same idea (roughly +12–15 energy over its life) with **zero**
engine cost. Listed as an optional ENGINE ASK in §2.5 if playtests want the punchier version.

## 2.4 Two ordering rulings the engine must get right

> **RULED — Catalysts resolve at the START of their phase, before that phase's abilities.**
> Uniform across all three colours. This is what makes **Adrenaline and Overdrive do what
> they say**: a Blast-phase Might must land before the Blast damage step, or the catalyst
> boosts nothing until next turn and is simply broken. It also means Ablative Field's shield
> is up before any Prep-phase trap damage, and a Shift resolves before a dash ability the
> same unit declared.

> **RULED — A free dash catalyst does NOT consume your Move.** Shift is genuinely additive:
> a unit may Shift 3 squares in Dash **and** walk its normal 4 in Move (or dash *and* Shift).
> This is a real burst of mobility and it is meant to be — it happens **once per match**.
> Precedent: Overdrive's Haste already boosts the same turn's Move, per the ruled
> "debuff-now-bites-now" reading of Blast-applied statuses.

## 2.5 `ENGINE ASK` — Part 2

1. **Catalyst definitions.** `data/catalysts.json` is `{ prep: [...], dash: [...], blast: [...] }`,
   each entry shaped as an `AbilityDef` with `cooldown: 0`, `energyGain: 0`, `free: true`,
   `oncePerMatch: true` — so `validateAbility` can be reused nearly as-is.
2. **`UnitState`** gains the unit's three chosen ids and which are spent. Suggested:
   `catalysts: string[]` (length 3, one per phase) and `catalystsUsed: string[]`. Keep both
   as **arrays, not Sets** — `structuredClone` and the determinism hash already assume
   plain JSON-shaped state.
3. **`UnitOrders`** gains **`catalyst?: AbilityOrder`**, parallel to `ability` and
   `freeAbility`. Validation: the id must be one of the unit's three, must not already be
   spent, and at most one of `catalyst`/`freeAbility` per unit per turn (§1.4).
4. **Resolution.** In each phase, resolve catalysts first (§2.4), then abilities. Mark the
   catalyst spent **when it resolves**, not when it is ordered — a unit killed in Prep does
   not spend its Blast catalyst (consistent with "a unit killed in an earlier phase does not
   act in later phases").
5. **Events.** A `catalystUsed` event (unit, catalystId) so playback can show it; the
   existing `statusApplied` / `heal` / `damage` events carry the rest. The HUD needs to show
   three slots and grey out spent ones — the event log is the only channel for that.
6. **Selection is M3.** Until the lobby exists, `createMatch` assigns the default triad. Add
   the per-player catalyst picks to backlog item 21's scope.
7. **Optional, not required:** a flat `energy` effect kind, which would let Brainwave grant
   energy directly instead of via Energized. Only worth it if playtests say so.

---

## 3. Handoff summary

**Data already written** (inert until the engine reads it):

- `data/catalysts.json` — all nine catalysts.
- `data/characters/{vex,thorn,wisp}.json` — `free: true` plus the paid-for cooldown and
  `energyGain: 0` from §1.3.

**Interim, documented not silent:** until `free` is implemented, those three abilities read
as ordinary Prep abilities on a *longer* cooldown with *no* energy — i.e. **weaker than they
are today, and weaker than designed, never stronger.** That is the safe direction to fail in
(the same convention `chargeHits` shipped under), and it self-corrects the moment the engine
lands. If the Analyzer would rather not carry even that, the alternative is to hold the three
character edits and land them in the Builder's implementation commit — but then the numbers
must not be forgotten, which is the riskier failure.

**Suggested sequencing** — Part 1 is a prerequisite for Part 2 (catalysts *are* free actions,
so the free-action plumbing must exist first):

1. **FREE1** — `free?: boolean`, `UnitOrders.freeAbility`, budget independence, validation.
   Ships with the three character data edits. Tests: free ability + Sprint in one turn; free
   ability does not reduce the 4-budget; a non-prep or energy-granting `free` ability is a
   validation error.
2. **CAT1** — catalyst definitions, `UnitState` slots, `UnitOrders.catalyst`, once-per-match
   consumption, start-of-phase ordering, `catalystUsed` event. Tests: Adrenaline boosts the
   **same** turn's Blast; Shift does not consume Move; a spent catalyst is rejected; a unit
   killed in Prep does not spend a Blast catalyst.
3. **CAT2 (client)** — three catalyst slots in the HUD, spent-state rendering, and the
   free-action UI (a free ability must not clear the ability selection — the same
   mutual-exclusivity trap that MS1 fixed for move-and-shoot).
4. **M3 lobby** — catalyst selection per character (fold into item 21).

## 4. Playtest questions

1. **Is one free action per turn too tight?** (§1.4 — the designed first lever.)
2. **Does Wisp's free Veil make her oppressive**, or finally playable? She is the kit most
   changed by Part 1.
3. **Is Shift the default Yellow pick for everyone?** If Fade and Unshackle never get taken,
   Shift is overtuned — reduce it to 2 squares before touching the others.
4. **Do catalysts get hoarded?** A once-per-match resource players never spend is a failed
   design. If the last-turn usage rate is high, they are too precious — the fix is more
   slots per match, not stronger catalysts.
5. **Adrenaline vs Overdrive** — if Overdrive's split (Might 1 + Haste 1) is always worse
   than Adrenaline's Might 2, raise Overdrive's Haste to 2 turns.
