# ar-parity-v1.md — Atlas Reactor parity audit across six systems (Designer)

**Date:** 2026-08-14 · **Status:** ALL DECIDED (owner, 2026-08-14). Every item is either **RULED** (spec it — see the
list in §7) or explicitly not-wanted-now. One item remains **VERIFY** (§1.3) — it is the only
thing here still waiting on anything, and nothing depends on it.

Sources: the project's own `atlas-reactor-reference.md` (research branch
`claude/atlas-reactor-cards-research-n553wi`, compiled with citations — **still unmerged**),
plus measurements against the shipped engine and data. Where I am working from memory rather
than a source, I say so — AR shut down in 2019, the community wiki is unreachable from this
environment, and I would rather flag a gap than invent parity.

**Read §7 first if you only read one section** — it is the spec list, with acceptance criteria.

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

### 1.2 APPROVED — no damage-over-time or heal-over-time

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

**APPROVED by the owner.** Full acceptance criteria in **§7.1 (`DOT-HOT`)**. It unblocks both
the Regenergy catalyst (§8) and the Health power-up (§7.3).

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

### 2.1 APPROVED — Chase orders are the one genuine phase-level gap

AR lets you right-click an enemy to issue a **chase** rather than a fixed path: you move toward
wherever they actually ended up, and **chasers resolve at the end of the Move phase**, after
all normal movement. It is the answer to "I cannot path to a square I cannot predict," and it
is a real part of AR's Move phase.

CARDS has fixed paths only. **APPROVED** — spec in **§7.2 (`CHASE1`)**, which lists the four
edge cases the Analyzer must rule before the Builder starts.

### 2.2 RULED — the decision timer goes to 40 seconds

AR: **20 s**, Time Bank **2× +5 s**. CARDS was **30 s** — and the owner has moved it to **40 s**
(Time Bank unchanged at 1× +10 s). A deliberate widening rather than a drift toward AR: a player
may control two characters, and from FREE1/CAT1 onward a turn can carry a free action, a
catalyst, an ability and a move. Twenty seconds was sized for a strictly smaller decision.
Spec: **§7.4 (`TIMER-40`)**.

---

## 3. Vision — CORRECTED: we are already at parity

**My first draft of this section was wrong, and the owner caught it.** I claimed AR showed every
enemy position at all times. It does not: **Grey's hawk drone Rio "grants vision above and
beyond what the character can see,"** a phrase that only means something if characters have a
limited sight range to begin with. AR also carries a dedicated *Revealed* status.

The error was specific. The project's research doc says positions are *"broadly known"* — a
deliberate hedge — and I hardened it into "you know exactly where all eight enemies are
standing," then built a three-option recommendation on the false premise.

Worth recording the near-miss: the **Probe** catalyst *"reveals a target area for 2 turns and
shows units in camouflage, but does not reveal invisible ones"* — an anti-**camouflage** tool,
perfectly consistent with the concealment-not-distance model. Probe alone would not have caught
this. The drone did.

**Corrected picture:** AR characters have a limited vision range, with camouflage areas and
Invisible layered on top and Revealed as the counter. That is **structurally what CARDS already
does** — 6-tile vision, brush concealment, Stealth, Reveal. One search result put AR's own
figure at **6 squares**, exactly our `VISION_RANGE`; I could not open a source to confirm it,
but it fits everything else.

> **RULED — Vision stands as built (owner, 2026-08-14).** No work. The model is AR parity, not
> a divergence — and this section's job is now to stop a future session from "fixing" it.

Two observations recorded but **deliberately not scheduled**:

- **Vision is a Manhattan diamond under MET1** — 6 tiles straight but only 3 diagonally, where
  AR's continuous world makes its 6 round. Same axis bias the aiming-metric ruling removed, and
  by that ruling's own principle vision is a distance rather than a lattice walk. Playtest note
  only; the owner has approved vision as it plays.
- **No vision-*granting* tools.** AR built a Freelancer (Grey) around extending sight; we have
  Reveal-as-a-debuff but nothing that grants it. Explicitly **not wanted now** — recorded so the
  design space is known to exist. The new **Probe** catalyst (§8) covers the area-reveal half.

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

### 4.1 `UI-NAMEPLATES` — the overhead nameplate, specified from the AR screenshot

The owner supplied an in-game AR screenshot (Decision phase, mid-match) as the reference.
What AR renders above every visible character, and what we adopt:

- **Name above the model** (player name in AR; character name in CARDS until M3 gives us
  player names), sitting above the HP bar. RULED.
- **HP as a number inside the HP bar** — the bar shows the numeral (57, 114, 40 in the
  shot), not just a fill fraction. Shield, when present, renders as a distinct segment
  appended to the fill with its own colour, since shields are consumed first. RULED.
- **Energy as a thin bar under the HP bar**, and an **"ULT" tag at the bar's end when
  energy ≥ 100** — in the shot both enemy nameplates carry the ULT tag, which is exactly
  the information that makes an ult a *threat you can play around* rather than a surprise.
  RULED.
- **Status icons in a row under the bar** (the shot shows a dash glyph and an eye) — see
  §4.2 for the vocabulary.
- **Vision gates all of it.** A nameplate renders only while your team can see the unit
  (`canSee`); fogged and stealthed units show nothing. Your own team's nameplates always
  render. The damage-preview numbers already ship fog-gated (PREVIEW-FOG) — same rule,
  same reason: a nameplate over an unseen unit would leak the position fog exists to hide.
- **Decoys carry a full fake nameplate** — name, frozen cast-time HP, empty status row
  (statuses would leak: the enemy client would have to know Wisp's real buffs). The decoy
  already renders as Wisp to the enemy team; a Wisp-shaped model with no nameplate would
  un-disguise it instantly. Needs one edge-cases line: **the decoy snapshot includes the
  nameplate fields.**

### 4.2 `STATUS-ICONS` — replace the colour pips with AR's icon vocabulary

The owner's directives: **Might is a sword; Revealed is an eye.** Extending to the whole
drawable set so the vocabulary is total (the client's `PIP_ORDER` already fixes display
order — debuffs first — and stays):

| Status | Icon | | Status | Icon |
|---|---|---|---|---|
| Root | chained boot | | Might | **sword** (owner) |
| Slow | hourglass | | Haste | wing |
| Weaken | broken sword | | Energized | lightning bolt |
| Reveal | **eye** (owner) | | Unstoppable | battering ram |
| Shield | bubble **with the remaining amount as a numeral** | | Untargetable | ghost outline |
| | | | Stealth | mask — **rendered to the owning team only** (the enemy sees nothing; that is the point) |

Weaken/Might and Root/Haste read as broken/whole pairs on purpose — the counter-relation
is legible at a glance. Icons are drawn glyphs (canvas/SVG textures), no external assets;
each keeps the pip system's fixed slot so position stays learnable. Durations render as a
small numeral on the icon.

### 4.3 `UI-INSPECT` — cooldowns and state of any visible character (owner directive)

*"Player can see cooldowns of other characters and the buffs/debuffs/energy/hp status when
they have vision of the character."*

- **Hover (or click-hold) any visible unit** → an inspect panel: their five ability slots
  with **current cooldown numbers**, ultimate charge state, **catalysts remaining vs
  spent** (spent slots greyed — the same read AR gives via the nameplate row), and active
  statuses with durations.
- **Own team: always inspectable.** Enemies: only while `canSee` holds — the same gate as
  nameplates, so fog and Stealth hide the panel too. No "last known" ghost data in v1.
- All of it reads straight off engine state the client already holds; **zero engine
  change.** The one wrinkle: **inspecting a decoy** must show Wisp's kit as of the cast
  snapshot (cooldowns frozen), not live data and not a refusal — either would un-disguise
  it. Rides on the same snapshot as §4.1.

### 4.4 `UI-TOPBAR` — the match strip, straight from the screenshot

AR's top edge is: **friendly portraits · team score · turn number · enemy score · enemy
portraits**. This is SCORE1's in-match half given a concrete layout:

- Portrait strips per team, each portrait carrying a mini HP bar and a dead/respawn-count
  state — the at-a-glance "who is winning the attrition war" read.
- Centre: **kills vs target for both teams, with the turn counter between them** (the
  screenshot's `1 · 10 · 1`). Turn X of Y stays the load-bearing element — it is the
  clock the Support anti-stall balance depends on.

### 4.5 `UI-TIMER` — the countdown with urgency, and Time Bank pips

From the shot: a large countdown adjacent to LOCK IN showing **tenths under 20 s**
(`16:95`), with the **Time Bank charge rendered as pips** beside it. Adopt: whole seconds
above 10 s, tenths + a colour shift below 10 s, Time Bank pips (we have 1 charge; AR shows
2 — ours renders one pip). The +10 s bank extension animates visibly when it fires, so its
consumption is never silent. `TIMER-40` (§7.4) sets the base value this counts from.

### 4.6 `UI-INTENT` — teammates' plans, visible on the board

In the screenshot, small numbered action tiles float above an allied character — AR shows
you **what your teammates have queued**. CARDS already rules that teammates see each
other's planned orders (edge-cases, "Teammate information"); today that ruling has no UI.
Render above each allied unit during Decision: the queued ability's slot number (plus a
free-action/catalyst marker when one is declared), and a lock-state tick once they lock in.
2v2 is the default format — a duo that cannot see each other's plan is planning blind,
so this is the difference between a team turn and two solo turns.

### 4.7 Already shipped, for the record

The screenshot's **damage-preview numbers** (the 20 / 12 / 10 beside targets) already
exist (`preview-numbers.ts`), fog-gated and polarity-aware. The **power-up pads** on AR's
floor land with `PADS1`, which should include their board rendering (pad glyph plus a
respawn countdown on the tile).

### 4.8 `NAMEPLATE-LAYOUT` — revision to the shipped UI-NAMEPLATES (owner directives)

UI-NAMEPLATES shipped (PR #54); the owner's follow-up adjusts its arrangement and colours:

- **Name is left-justified above the HP bar** (it was centred). The bar keeps its width; the
  name aligns to its left edge.
- **The status icon row moves from under the bar to beside the name** — same line, to the
  name's right, growing rightward. The icons stop competing with the energy bar below.
- **Polarity is the colour: buffs are BLUE, debuffs are RED.** The glyph carries *identity*
  (sword, eye, wing…), the tint carries *polarity* — two channels, one read. Mapping is the
  FF1 polarity table verbatim: harmful kinds (`weaken, slow, root, reveal` + `damageOverTime`)
  red; beneficial kinds (`shield, might, haste, energized, unstoppable, untargetable, stealth`
  + `healOverTime`) blue. Shield keeps its numeral, now blue; Stealth's mask stays
  own-team-only, now blue. `PIP_ORDER` (debuffs first) survives — with the row beside the
  name, debuffs-first means **red icons sit nearest the name**, which is the urgent-first read.
- STATUS-ICONS-SIZE (already backlogged) should land as part of this rather than separately —
  one repaint of the same row, not two.

### 4.9 Health power-up — AR parity CONFIRMED, no change

The owner asked for the healing power-up to match AR's. **It already does**, verified against
the shipped table (`powerups.ts`): ours grants `heal 10` + `healOverTime 10 × 2 turns` — AR's
is *"10 healing on pickup, +20 more over 2 turns."* Identical: 10 now, 20 over two ticks, 30
total. Recorded here so nobody "fixes" it into divergence.

## 5. Map design — my own maps break the rule you named

**Your principle:** AR maps never have too much cover, too many pillars, or **too many stealth
blocks in a row**.

I measured both shipped maps against it:

| map | walls (longest run) | cover (longest run) | **brush (longest run)** | blocked % |
|---|---|---|---|---|
| `duel-arena` 18×15 | 18 (3) | 8 (4) | 24 (**6**) | 9.6% |
| `iron-basin` 22×19 | 18 (3) | 8 (4) | 32 (**8**) | 6.2% |

**The brush corridors were the violation, and they were mine.** I built 6-wide and 8-wide
unbroken brush runs as "concealed flank routes." Under the rule that is exactly too many stealth
blocks in a row: an 8-long brush corridor is not a route with a concealment *option*, it is a
lane where a unit is unhittable for eight tiles.

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

**FIXED in this PR (data-only).** Both maps' brush was re-cut into runs of exactly 3, keeping
mirror symmetry:

| map | brush before | brush after | longest run |
|---|---|---|---|
| `duel-arena` | 24 tiles, runs of **6** | 24 tiles, two 3-wide patches per row | **3** ✅ |
| `iron-basin` | 32 tiles, runs of **8** | 24 tiles, two 3-wide patches per row | **3** ✅ |

Re-verified against the engine after the change: mirror symmetry holds, spawn separation is
still exactly 13, every head-on spawn sightline is still wall-broken, and a turn-1 spawn hit is
still impossible on both maps. Walls (3) and cover (4) were already inside their caps.

**Still owed by the Builder:** a `content.test.ts` guard enforcing the three caps, so the next
map cannot reintroduce this. That is the half that stops it happening again.

### 5.1 APPROVED — power-up pads are AR's map clock, and we have nothing like them

AR power-ups spawn **only at fixed, colour-coded pads, on a timer**: Health (10 on pickup, +20
over 2 turns), Might (+25% damage, 2 turns), Energy (Energized, 2 turns), each with a
single-turn minor variant.

This is what stops a symmetric map from being a stalemate — fixed pads on a fixed schedule
create contested squares at predictable times, so **the map generates fights without any RNG**.
It is fully deterministic and would reuse the existing `heal` / `might` / `energized` effects.

Health's "+20 over 2 turns" needs the `healOverTime` kind from §1.2, so these two travel
together. **APPROVED** — spec in **§7.3 (`PADS1`)**.

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

## 7. Decisions taken (owner, 2026-08-14) — the spec list

All seven questions are answered. Nothing in this document is blocked.

| # | Item | Decision | Where it lands |
|---|---|---|---|
| 1 | Vision | **Keep as built** — it is parity (§3) | No work |
| 2 | DoT / HoT | **Add** | `DOT-HOT` (engine) |
| 3 | Chase orders | **Add** | `CHASE1` (engine + client) |
| 4 | Power-up pads | **Add** | `PADS1` (engine + data) |
| 5 | Decision timer | **40 seconds** | `TIMER-40` (one constant) |
| 6 | Maps | **Fix** | Done in this PR (data) |
| 7 | UI + scoreboard | **Fix** | `UI-VIEWPORT`, `SCORE1`, and the screenshot batch: `UI-NAMEPLATES`, `STATUS-ICONS`, `UI-INSPECT`, `UI-TOPBAR`, `UI-TIMER`, `UI-INTENT` (§4.1–4.6, all client) |
| — | Catalysts | **Add the AR ones we lack** | Two shipped here; Regenergy rides `DOT-HOT` (§8) |

### 7.1 `DOT-HOT` — damage- and heal-over-time (engine)

Two new effect kinds, `damageOverTime` and `healOverTime`, each `{ amount, duration }`.

*AC: both apply at **end of turn**, in the engine's existing fixed unit order, **before** the
status duration tick — so a `duration: 2` DoT ticks on the turn it lands and the turn after.
Damage credits the applying unit's team for the kill tally, exactly as traps do (attribution
already exists). Both are subject to FF1 polarity: `damageOverTime` is harmful, `healOverTime`
beneficial. Neither is affected by Might/Weaken (they are not outgoing hits) — flag for playtest
rather than assume. Refresh-not-stack, like every other status. Tests: a 2-turn DoT deals its
amount twice; a unit that dies mid-DoT stops ticking; the tick order is deterministic across
runs.*

**Blocks:** Regenergy (§8) and the Health power-up (§7.3), both of which need `healOverTime`.

### 7.2 `CHASE1` — chase orders (engine + client)

AR lets you target an enemy rather than a square: you move toward wherever they **actually
ended up**, and chasers resolve **at the end of the Move phase**, after all normal movement.

*AC: a `UnitOrders` may carry a chase target (a unit id) in place of `movePath`. Normal
movement resolves first; then chasers path toward their target's **final** position using the
mover's remaining budget, stopping short of occupied squares per the standing Collisions rule.*

**Edge cases the Analyzer must rule before the Builder starts** — this is why it is its own item:
- **Chase vs chase** (A chases B, B chases A): both resolve against post-Move positions, so
  neither target has moved by then. Deterministic, but confirm it does not read as a stalemate.
- **Chase a target that died** this turn: the order is dropped (the unit holds).
- **Chase a target you cannot see** (fog): legal or not? Given vision is limited (§3), this is a
  real question — a chase is a way to track someone you have lost, which may be exactly right or
  exactly too strong. **Designer lean: legal**, since it is AR's answer to "I cannot path to a
  square I cannot predict," but it wants an explicit ruling.
- **Chase + a dash ability** in the same turn: the dash is the movement, so the chase is dropped.

### 7.3 `PADS1` — power-up pads (engine + data)

Fixed, colour-coded pads on a timer — AR's answer to symmetric-map stalemate, and fully
deterministic.

*AC: `MapDef` gains `powerups: [{ x, y, type, firstTurn, everyTurns }]`. A pad grants its effect
to the **first unit to occupy it**, resolved at a fixed point in the Move phase (end of Move,
after chasers — so the last mover can contest it). A consumed pad respawns `everyTurns` later.
Types reuse existing effects plus §7.1: **Health** (heal 10 + `healOverTime` 10×2), **Might**
(Might 2 turns), **Energy** (Energized 2 turns).*

**Contested pads:** two units on one pad cannot happen (Collisions), so first-occupier is
well-defined. Both maps need pad squares added — Designer work once the schema lands.

### 7.4 `TIMER-40` — decision timer

`DECISION_SECONDS` **30 → 40**. Time Bank unchanged (1 charge, +10 s). One constant; the client
already reads it.

### 7.5 `UI-VIEWPORT` and `SCORE1`

Unchanged from §4 and §6 — both were already ready to spec.

### 7.6 `PADS-PLACEMENT` — Might is the centre prize (Designer ruling; answers the Builder)

The Builder implemented PADS-SCHEDULE (Might spawns turn 2) and correctly routed placement
here: with Might pads at (6,3)/(11,3), each team had its **own** safe pickup — *"the clock
alone does not make a race if each side has its own."* The Builder computed the centre-most
legal mirrored pairs — (7,y)/(10,y) on duel-arena, (9,y)/(12,y) on iron-basin, the closest
non-adjacent pairs under PADS-SPREAD — and left the y and the swap to the Designer.

**RULED — Might moves into the central strongpoint on both maps; health takes the vacated
flank row.** Shipped in this PR (data-only):

| map | Might (turn 2) | Health (turn 4) | Energy (turn 4, unchanged) |
|---|---|---|---|
| `duel-arena` | **(7,7) / (10,7)** — the room's interior row | (6,3) / (11,3) — the old Might row | (6,11) / (11,11) |
| `iron-basin` | **(9,9) / (12,9)** — the room's interior row | (8,5) / (13,5) — the old Might row | (8,13) / (13,13) |

Why this shape, rather than just sliding Might inward on its old row:

1. **The pair is now a prize, not two pickups.** Both Might pads sit 3 tiles apart inside one
   room; from each team's nearest spawn the near pad is Manhattan 6 and the *far* pad 9 — both
   teams genuinely reach both pads on turn 2, so holding "your" pad means standing where the
   enemy contests it. Schedules stayed with the **type** (Might turn 2 — the rush; utility
   turn 4), not the position.
2. **It answers maps-v1's open playtest question** — "is the central room worth taking?" The
   room now has a reason: the damage buff spawns inside it, every 4 turns, forever.
3. **Health belongs on the flank.** A heal you collect while disengaging is doing its job; a
   heal in the centre of the fight is just more fighting. The swap gives each pad type the
   geometry its purpose wants.

Placement invariants re-verified after the edit: mirror-paired, on open tiles, PADS-SPREAD
clean, full suite green (1420 tests). **Playtest flag:** two Might pads in one room every 4
turns may make the room *too* important at 4v4 — if so, the lever is `everyTurns` 4 → 5 on
iron-basin, not moving the pads back out.

## 8. Catalysts — moving toward AR's four-per-phase pool

AR's real pool is **four per phase**, not three:

| Prep | Dash | Blast |
|---|---|---|
| Critical Shot, Brain Juice, **Second Wind**, Regenergy | **Shift**, Fetter, **Fade**, Regroup | **Adrenaline**, Probe, Echo Boost, Chronosurge |

Four of our nine already matched AR by name (Second Wind, Shift, Fade, Adrenaline) and Brainwave
is Brain Juice renamed — better parity than expected, arrived at independently. **Two more ship
in this PR**, both built from effect kinds the engine already has:

- **Fetter** (dash) — Root every enemy within 2 for a turn. The fourth way out of a collapse:
  don't move, stop them following. Distinct from Shift (move), Fade (untargetable) and Unshackle
  (immunity).
- **Probe** (blast) — Reveal every enemy in the aimed area for 2 turns, brush included. Answers
  the ambush you know is coming, and covers the area-reveal gap noted in §3.

**Regenergy** (prep) — heal 12 at end of turn for 3 turns — was specced here and **withheld
until `DOT-HOT` landed** (shipping it earlier would have put content in `data/` that fails
validation). *Update: DOT-HOT has since shipped and Regenergy with it — the pool is now the
full flat 4/4/4.*

Not adopted: **Echo Boost** and **Chronosurge** need buff-extension and turn-manipulation
mechanics we do not have; **Critical Shot** needs a "next attack" hook; **Regroup** overlaps
Shift.

