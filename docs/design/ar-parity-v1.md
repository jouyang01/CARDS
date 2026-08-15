# ar-parity-v1.md — Atlas Reactor parity audit across six systems (Designer)

**Date:** 2026-08-14 · **Status:** MIXED — each item below is tagged **RULED** (spec it),
**CONFIRM** (owner decision needed before speccing), or **VERIFY** (my AR knowledge is not
solid enough to build on).

Sources: the project's own `atlas-reactor-reference.md` (research branch
`claude/atlas-reactor-cards-research-n553wi`, compiled with citations — **still unmerged**),
plus measurements against the shipped engine and data. Where I am working from memory rather
than a source, I say so — AR shut down in 2019, the community wiki is unreachable from this
environment, and I would rather flag a gap than invent parity.

**Read §7 first if you only read one section** — it is the list of decisions I need from you.

---

## 1. Statuses — duration and types

**Current:** ten statuses (Might, Weaken, Haste, Slow, Root, Reveal, Energized, Unstoppable,
Stealth, Untargetable), durations in whole turns, ticking at end of turn, **refresh-not-stack**.
Shields are temporary HP consumed before real HP. All eleven drawable kinds have status pips.

**Verdict: ✅ close parity on the core set, with three concrete gaps.**

### 1.1 RULED — GAME_SPEC §6 is stale on Untargetable

§6 still annotates Untargetable as *"(ults only)"*. That stopped being true when the **Fade**
catalyst shipped. One-line doc fix, no engine change — but the Builder reads §6 as normative,
so leaving it invites a wrong validation rule later.

### 1.2 CONFIRM — no damage-over-time or heal-over-time

Every effect in CARDS is instantaneous or a flat modifier. AR has **over-time effects**, and
the project's own research confirms at least one concretely: the Health power-up is
*"10 healing on pickup, **+20 more over 2 turns**"*. Nothing in `EFFECT_KINDS` can express that.

This matters beyond power-ups: over-time damage is the standard counter to turtling, and CARDS
currently has no answer to a Bastion sitting in Fortress Protocol other than out-positioning
him.

**Proposal if approved:** two new effect kinds, `damageOverTime` and `healOverTime`, each
`{ amount, duration }`, applying **at end of turn** in a fixed unit order (before the status
tick, so a 2-turn DoT ticks twice). Damage attribution credits the applying unit's team, like
traps. No new geometry, no float math, deterministic.

**Why I am not just speccing it:** it is two new `EFFECT_KIND`s and a new resolution step —
the kind of change golden rule #2 says needs an explicit decision, not a Designer assumption.

### 1.3 VERIFY — incoming-damage modifiers (a "Vulnerable")

CARDS has Might/Weaken (outgoing only). I believe AR also had effects that modify damage
**taken**, which would be the natural pair. I could not confirm this from any source I can
reach, and I do not want to add an effect kind on a hunch. **If you can confirm AR had one, I
will spec it** as `vulnerable` (+25% damage taken) composing after Might/Weaken and before
cover, per the ruled damage order.

### 1.4 RULED — duration semantics already match

Durations in turns, end-of-turn tick, refresh-not-stack, and Reveal-on-attack lasting 2 turns
(so it survives the applying turn's tick) are all consistent with AR's model as documented. No
change.

---

## 2. Turn phases

**Current:** Prep → Dash → Blast → Move, displacement resolving at the **end** of Blast and
cancelling the victim's Move, dash immunity emerging from resolution order rather than a
special case.

**Verdict: ✅ full parity — this is the system CARDS copied most faithfully.** The reference
doc's comparison table marks phase order, simultaneous hidden planning, 4/8 movement,
dash-forbids-move, and displacement-cancels-Move all as inherited, and I found nothing that
has drifted since.

Two entries in that table are **stale in our favour** and should be closed out:

- **"Ground vs airborne dashes — ❓ open."** Already ruled and shipped: `shape: "path"` is a
  ground charge (traverses squares, triggers traps, stopped by walls) and `shape: "square"` is
  airborne (ignores both). That is exactly AR's distinction. ✅
- **"Free actions — ❓ open."** Shipped (FREE1). ✅

### 2.1 CONFIRM — Chase orders are the one genuine phase-level gap

AR lets you right-click an enemy to issue a **chase** rather than a fixed path: you move toward
wherever they actually ended up, and **chasers resolve at the end of the Move phase**, after
all normal movement. It is the answer to "I cannot path to a square I cannot predict," and it
is a real part of AR's Move phase.

CARDS has fixed paths only. Adding it needs an edge-cases ruling for chase-vs-chase and
chase-into-occupied-square, which is why it is a CONFIRM rather than a spec.

### 2.2 CONFIRM — the decision timer diverges deliberately

AR: **20 s**, Time Bank **2× +5 s**. CARDS: **30 s**, Time Bank **1× +10 s** — chosen because a
player may control two characters. Flagged as deliberate in the reference doc; I have no reason
to change it, but it is a parity divergence you should re-affirm rather than inherit silently.

---

## 3. Vision — the largest divergence in the project

**This is the one I most need a decision on.**

**AR hides *intent*, not *position*.** You know exactly where all eight enemies are standing at
all times; the entire game is guessing what they will *do*. The only exceptions are
**camouflage areas** and **Invisible**, and even then *acting* from concealment gives away your
position.

**CARDS hides position:** 6-tile vision (Manhattan under MET1), team-shared, plus brush
concealment and Stealth, with fog rendered client-side.

**Verdict: ❌ not AR parity, and it changes the game's texture.** The project's own research
called this out and recommended keeping it for 2v2 while treating it as a per-format tunable.
The cost it names is sharp: *"if I can't see you, aiming at where you'll be is a coin flip
rather than a deduction, and a coin flip feels like RNG in a game whose whole pitch is 'no
RNG'."*

**Three options:**

| | Behaviour | Cost |
|---|---|---|
| **A — AR parity** | All enemy positions always visible. Concealment only via brush and Stealth. Fog deleted. | Loses scouting and most of the Phantom archetype's job; brush becomes the *only* concealment |
| **B — keep as-is** | 6-tile fog | Not AR parity; reads become guesses |
| **C — per-format tunable** (my recommendation) | `visionRange` moves into the format config: **unlimited for 4v4** (AR parity, more bodies to track) and **6 for 2v2** (fewer bodies, fog keeps small formats from going static) | One number in a config that already exists per format; playtestable both ways without a rewrite |

C costs almost nothing to build — `VISION_RANGE` becomes a per-format field alongside
`killsToWin` and `turnLimit`, which the engine already carries — and it lets you answer the
question with play instead of argument.

**Also VERIFY:** AR reveals *the action's origin* when you attack from concealment, not the
unit itself; CARDS applies a 2-turn Reveal to the unit. Ours is stricter. I am fairly confident
of the AR behaviour but not enough to spec a change.

---

## 4. UI — the viewport is the bug

**Your report:** the buttons are small and sit off the "screen" of the game, where the screen
is just the map board.

**Diagnosis:** the client renders the board and treats *the board* as the application. AR does
the opposite — the 3D scene fills the entire viewport, and the HUD is **overlaid on top of it**:
ability hotbar centre-bottom, character portrait bottom-left, lock-in bottom-right, team health
across the top. Nothing is ever "off the board," because the board is not the frame.

The HUD module is already well-built for this (UI3 gives a bottom-left character panel, a
bottom-centre hotbar with free-action and catalyst affordances, and a bottom-right Lock In) —
so this is a **layout and sizing** problem, not a rebuild.

**RULED — spec `UI-VIEWPORT`:**

- The renderer canvas fills the **browser viewport** and resizes with it; the board is framed
  *inside* the canvas by the camera, never by the DOM.
- The HUD is an **overlay** positioned against the viewport, not against the board — so no
  control can fall outside the visible area at any board size or zoom. `iron-basin` is 22×19
  against `duel-arena`'s 18×15, which is exactly the case that pushes controls off a
  board-sized frame today.
- **Minimum hit-target 44×44 px** for every button (hotbar, catalysts, Lock In, Sprint) with
  the ability icons scaled up to match; the current controls are well under this.
- Verify at **1280×720 and 1920×1080**, and at both map sizes, that every control is fully
  on-screen and that the whole board is in frame at default zoom.

This is the highest-value item in the document: it is the only one a player hits within ten
seconds of opening the game.

---

## 5. Map design — my own maps break the rule you named

**Your principle:** AR maps never have too much cover, too many pillars, or **too many stealth
blocks in a row**.

I measured both shipped maps against it:

| map | walls (longest run) | cover (longest run) | **brush (longest run)** | blocked % |
|---|---|---|---|---|
| `duel-arena` 18×15 | 18 (3) | 8 (4) | 24 (**6**) | 9.6% |
| `iron-basin` 22×19 | 18 (3) | 8 (4) | 32 (**8**) | 6.2% |

**The brush corridors are the violation, and they are mine.** I built 6-wide and 8-wide
unbroken brush runs as "concealed flank routes." Under your rule that is exactly too many
stealth blocks in a row: an 8-long brush corridor is not a route with a concealment *option*,
it is a lane where a unit is simply unhittable for eight tiles.

**RULED — authoring caps, to be enforced by a content test:**

| Terrain | Max unbroken run | Reasoning |
|---|---|---|
| **brush** | **3** | Long enough to break a sightline and ambush from; short enough that crossing it is a decision, not a free corridor |
| **cover** | **4** | A holdable face; beyond that it is a wall that does not block sight |
| **wall** | **5** | Longer runs make corridors rather than rooms (AR's EvoS Labs is the corridor map — that should be a map's *thesis*, not an accident) |

Plus the principles the research doc already distilled, which I want in the test where they can
be: mirror symmetry, every lane longer than ~8 broken by a wall (our longest non-ult range),
and each map having **one thesis** — corridor, open, or low-cover brawl — rather than averaging
into mush.

**Fix required:** both maps need their brush corridors broken into runs of ≤3. That is my
error to correct, and I will do it as data-only work once the caps are agreed.

### 5.1 CONFIRM — power-up pads are AR's map clock, and we have nothing like them

AR power-ups spawn **only at fixed, colour-coded pads, on a timer**: Health (10 on pickup, +20
over 2 turns), Might (+25% damage, 2 turns), Energy (Energized, 2 turns), each with a
single-turn minor variant.

This is what stops a symmetric map from being a stalemate — fixed pads on a fixed schedule
create contested squares at predictable times, so **the map generates fights without any RNG**.
It is fully deterministic and would reuse the existing `heal` / `might` / `energized` effects.

Health's "+20 over 2 turns" needs the `healOverTime` kind from §1.2, so these two travel
together.

---

## 6. Scoreboard — does not exist

**Current:** nothing. No scoreboard module in the client, no backlog item, no reference in any
doc. The engine tracks per-team kill tallies and the turn number; none of it is presented as a
readable scoreboard.

AR shows a persistent score readout during play and a full end-of-match breakdown.

**RULED — spec `SCORE1`, in two parts:**

**In-match (always visible, top of the viewport):**
- Team kill tally vs. the format's target (e.g. **2 / 4**), both teams
- **Turn X of Y** — currently a player cannot tell how close the turn limit is, which is the
  clock the whole Support anti-stall balance depends on
- Per-character strip: alive/dead, HP, energy toward ultimate, and **respawn countdown**

**End of match:**
- Winner and final score, with "Double KO" handled explicitly (it is already a ruled outcome)
- Per-character: kills, deaths, damage dealt, damage taken, healing and shielding given
- Whether it ended by kill target, turn limit, or sudden death

**Engine note:** kills and deaths are already tracked, but **damage dealt / healing given are
not accumulated anywhere** — they exist only as `TurnEvent`s. Since the event log is the
rendering contract, the client can accumulate them during playback without any engine change,
which is the cheaper half and should be built first. Attribution already exists (A0 gave
damage events a source), so the data is there.

---

## 7. What I need from you before the Analyzer specs these

| # | Item | Question | My recommendation |
|---|---|---|---|
| 1 | **Vision** (§3) | AR parity (all positions visible), keep 6-tile fog, or make it per-format? | **Per-format**: unlimited at 4v4, 6 at 2v2 — cheap, and settles it by playtest |
| 2 | **DoT / HoT** (§1.2) | Add `damageOverTime` / `healOverTime` effect kinds? | **Yes** — AR has them, power-ups need them, and turtling has no counter today |
| 3 | **Vulnerable** (§1.3) | Did AR have an incoming-damage modifier? | Can't verify — **need your recall** before I spec it |
| 4 | **Chase orders** (§2.1) | Add AR's chase? | **Yes, but later** — it needs its own edge-case rulings; after the UI and scoreboard |
| 5 | **Power-up pads** (§5.1) | Add them? | **Yes** — it is AR's answer to symmetric-map stalemate, deterministic, and reuses existing effects |
| 6 | **Decision timer** (§2.2) | Keep 30 s / 1× +10 s, or match AR's 20 s / 2× +5 s? | **Keep ours** — deliberate, for 2-character players |
| 7 | **Map run caps** (§5) | Agree brush ≤3, cover ≤4, wall ≤5? | **Yes** — and I will fix both maps, which currently break it |

**Ready to spec without any decision from you:** §1.1 (stale spec line), §2's two stale
"open" entries, **§4 UI-VIEWPORT**, and **§6 SCORE1**. Those four are unambiguous parity or
usability wins, and UI-VIEWPORT is the one I would put first.
