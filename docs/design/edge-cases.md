# edge-cases.md — rulings for simultaneous-turn edge cases

Part of the spec. Status: **RULED** (implement as stated) or **PROPOSED** (implement
as stated, but flag in playtests) or **OPEN** (needs a ruling before implementing).
The Analyzer grows this file every review; the Builder must not invent unlisted rulings.

> **Folded in 2026-08-19 (Analyzer).** The seven Designer rulings in
> `docs/design/rulings-v1-blockers.md` (R1–R7) are now merged into this file below — charge
> combat (R1a first-enemy, R1b `chargeHits`, R1c carry-through), decoy (R2), duplicate picks
> (R3), `combat_roll` (R4), cover-vs-Might (R5), Support (R6), and roster §9 / `untargetable`
> (R7). That file stays as the Designer's rationale of record; the RULED text here is
> authoritative. Engine work created by the rulings is scheduled in BACKLOG (R1c → R1b → D1).

> **Folded in 2026-08-26 (Analyzer).** The two Designer systems in
> `docs/design/free-actions-and-catalysts.md` — **free actions** (Part 1) and **catalysts**
> (Part 2), ruled 2026-08-13 at the owner's direction — are now merged into this file under
> **"Free actions & catalysts"** below, and scheduled in BACKLOG as **FREE1 → CAT1 → CAT2
> (client) → M3 lobby selection** (catalysts *are* free actions, so Part 1's plumbing is a
> prerequisite). That spec file stays as the Designer's rationale of record; the RULED text
> here is authoritative. This **reverses DECISIONS 2026-08-11** ("Catalysts and ability mods
> deferred to M6+") for **catalysts only** — ability mods stay deferred.
> `data/catalysts.json` and the `free: true` flags in `data/characters/{vex,thorn,wisp}.json`
> are already written against the final design and are inert until the engine reads them.

> **Folded in 2026-08-27 (Analyzer).** The Designer's `docs/design/aoe-footprints-v1.md`
> (RULED 2026-08-14; every number measured against the shipped engine) answered **HITBOX-tune**
> and set the **CONE-B** ramp, and the owner ruled the **aiming metric** and **dash impact**
> alongside it. Now merged below under **"Targeting & vision"** (AIM-METRIC, CONE-B ramp,
> CIRCLE-FIX, DASH-IMPACT) and scheduled in BACKLOG as **AIM-METRIC → CONE-B → CIRCLE-FIX →
> DASH-IMPACT** (the metric ruling is the foundation; CONE-B and CIRCLE-FIX are its consumers;
> DASH-IMPACT reuses the fixed circle). That spec file stays the Designer's rationale of record;
> the RULED text here is authoritative. Headline results: **HITBOX-tune needs NO data changes**
> — circles are fixed at the rule (`dx²+dy² ≤ r²`), cones are already owner-approved — and the
> live **MET1-vs-HITBOX1 metric conflict is resolved to Euclidean for aiming** (movement stays
> Manhattan; MET1 stands for walking). The three `impact` fields in
> `data/characters/{aegis,ravok,wisp}.json` are already written and inert until DASH-IMPACT.

> **Folded in 2026-09-07 (Analyzer) — nameplate layout revision + pad placement, from PR #57
> (Designer, owner directives + Builder handoff).** The screenshot UI batch shipped (PR #54);
> these follow-ups (`ar-parity-v1.md` §4.8, §4.9, §7.6) are now scheduled/recorded: **(1)
> NAMEPLATE-LAYOUT is a backlog item** (client); **(2) PADS-PLACEMENT shipped in data** — verified
> below (resolves the Builder's Might-contestability handoff, Builder OQ 2026-09-07 #2); **(3)
> health-pad parity CONFIRMED — nothing to build.**
> 1. **`NAMEPLATE-LAYOUT` (client)** — revise the shipped nameplate: **name left-justified
>    above the HP bar; the status icon row moves to sit beside the name; buffs tinted BLUE,
>    debuffs RED** (glyph = identity, tint = polarity, mapping = the FF1 table verbatim;
>    `healOverTime` blue, `damageOverTime` red). `PIP_ORDER` survives — debuffs-first now means
>    red nearest the name. Fold **STATUS-ICONS-SIZE** into this item: one repaint, not two.
> 2. **`PADS-PLACEMENT` — done in data, record the ruling.** Might pads moved into the central
>    strongpoint on both maps — duel-arena (7,7)/(10,7), iron-basin (9,9)/(12,9) — and health
>    took the vacated flank rows. Answers the Builder's handoff ("two safe pickups rather than
>    one contested prize") and closes maps-v1's "is the central room worth taking?" playtest
>    question. Schedules stayed with the type (Might turn 2, utility turn 4). Playtest lever if
>    the room over-dominates at 4v4: `everyTurns` 4 → 5 on iron-basin, not moving pads out.
> 3. **Health power-up parity: CONFIRMED, nothing to build** — the shipped table already grants
>    heal 10 + healOverTime 10×2 = AR's "10 on pickup, +20 over 2 turns" exactly. Recorded so
>    nobody "fixes" it into divergence.
>
> Still open, nothing depends on it: whether AR had an incoming-damage modifier (§1.3).

> **Folded in 2026-09-08 (Analyzer) — CLASH-AR, the basics pass, and three Builder-OQ rulings
> from PR #60 (Designer; the clash text is the owner's verbatim AR source).** Full spec:
> `docs/design/clashes-and-basics.md`. **CLASH-AR is now RULED in the Movement section** (adopt
> AR's clash rules exactly — passer continues, only an ender stops; the owner attributes the
> "first sprint doesn't move" report to this). All items are scheduled in BACKLOG: **CLASH-AR**
> (engine, IMPORTANT), **BODY-CLICK** (client), the **BASIC-\*** engine knobs, the **shadow-row
> content-test guard** (Builder), and the data records (below) confirmed shipped. Original
> Designer notes retained for reference:
> 1. **`CLASH-AR` (engine — the owner marked it IMPORTANT).** Adopt AR's clash rules exactly.
>    Rule 2 (both ending → all forced back to their previous square; pad denied) is **already
>    shipped behaviour**. The deltas: rule 1 — two units *passing through* the same square on
>    the same step both **continue** (today `stepMovers` stops all same-step co-targets; this
>    supersedes that for passers and promotes CL1 from PROPOSED-deferred); rule 3 — an ender
>    rests, a passer continues, and **the ender takes the pad even if the passer crossed
>    earlier in the step clock**; and a **same-step simultaneous entry claims no pad** (today
>    the tie falls to event order). 2-cycle swap block unchanged. Clashes are per-phase.
> 2. **`BODY-CLICK` (client).** Clicking a unit's body selects that unit's square (chase: that
>    unit) — raycast unit meshes before the ground plane; visible units only, so fog leaks
>    nothing. Rules Builder OQ 2026-09-08 #2.
> 3. **The `BASIC-*` engine knobs** for unique auto attacks, smallest first: `BASIC-AXIS`
>    (`axisBonus` on cone — Bastion), `BASIC-BEAM` (`beamWidth` constant half-width — Aegis),
>    `BASIC-INNER` (`innerRadius`/`innerAmount` on circle — Cinder), `BASIC-MODES` (two
>    aim-time profiles — Kestrel; the largest, UI included). Each ships with its one character
>    data edit. Lockwood wall-bounce and Helios chain are explicitly **not adopted**.
> 4. **Shipped in data this PR, fold the records:** three redesigned autos (Lumen's
>    damage+heal line via FF1 polarity; Thorn's lobbed circle; Ravok's self-circle whirl),
>    the **melee pass** (Dagger Flurry, Crushing Slam, Whirling Cleave, Shield Bash, Shockwave
>    — MELEE-COVER is no longer inert), **Thorn's snare `lifetime: 3`** (parity with the
>    Overwatch tune), and the **shadow-row pad moves** (no pad on a square whose y+1 neighbour
>    is wall/cover — rules Builder OQ 2026-09-08 #1; renderer lever explicitly rejected). The
>    shadow-row rule wants a content-test guard next to PADS-SPREAD (Builder).
>
> Playtest flags: Thorn's no-cooldown lob over walls (range 5 → 4 if oppressive); rule 1
> making mid-board crossings safer.

> **⚠ NOT YET FOLDED IN — BASIC-BEAM unblocked + AXIS-MODIFIERS-CHECK answered, 2026-08-16
> (Designer).** Rulings in `docs/design/clashes-and-basics.md` §3.4:
> 1. **`BASIC-BEAM` is UNBLOCKED.** Semantics: **`beamWidth` is the TOTAL width of the lane in
>    tiles, odd values only** (even = validation error — no centre axis; `< 1` and non-`cone`
>    shapes rejected too). Engine mapping: `halfWidth = (beamWidth − 1) / 2`, constant at
>    every depth — the one-substitution change already scoped. Total-width because a number in
>    `data/` means the footprint you get.
> 2. **Aegis's number: Shield Bash becomes `beamWidth: 3`, `range: 2`, damage 20, `melee`
>    kept** — a 3-wide × 2-deep wall of force, 6 tiles vs the cone's 8. The Designer's earlier
>    "1×2 beam" phrasing is retracted as the source of the ambiguity: a 2-tile auto would be a
>    ~75% area cut no damage bump repairs. AC: axis-aligned footprint exactly 6, every
>    quantized rotation within ±1. Data edit ships in the Builder's BASIC-BEAM commit (the
>    field is not in the schema yet — data must not lead the engine).
> 3. **`AXIS-MODIFIERS-CHECK`: scales, confirmed, no change.** The axis bonus is damage and
>    composes through the ruled order; a flat exception would be the only number outside the
>    composition rules.

> **⚠ NOT YET FOLDED IN — Dev Notes batch 3 (21 owner notes), 2026-08-16 (Designer).**
> Triaged and ruled in `docs/design/dev-notes-batch-3.md`. For the Analyzer to schedule:
> - **Bugs first:** `TIMER-PERSIST` (lock-in timer vanishes after turn 1), `MENDING-RANGE`
>   (Mending Light heals outside its range — regression test with the observed case).
> - **Engine, in order:** `CASTER-SAFE` (**verified live: Whirling Cleave self-hits for 22,
>   Shockwave for 12** — a unit is never a target of its own harmful effects, globally) with
>   `RECOIL` riding it (`selfDamagePct: 50` — Seismic Rupture deliberately keeps half self-hit,
>   bypassing cover, consuming shields); `PHASE-STATUS-FIRST` (within each phase, ALL status
>   applications land simultaneously, THEN all damage computes against post-status state —
>   same-phase Weaken finally works, simultaneity and mutual kills preserved; ships with the
>   mutual-Weaken symmetry test); `TRAP-CENTRE` (a trap effect on an area shape places ONE
>   trap at the aimed centre — then Thorn's auto lays an 8-damage 2-turn mine) and `TRAP-HALT`
>   (`halt: true` — entering the snare ends your movement on that square; Unstoppable
>   immune); `ALLY-SAFE` (`noFriendlyFire: true` — Lumen's auto stops damaging allies);
>   `BRUSH-BREAK` (being hit in brush applies NO Reveal — instead the unit's brush concealment
>   is suppressed for current + next turn; Stealth unchanged, still broken by damage).
> - **Client/server:** `TIMER-BAR` (draining bar above the skills flowing into a BIGGER Lock
>   In), `LOBBY-BOUNDS`, `LOBBY-INSPECT` (character + catalyst hover details), `LOBBY-READY`
>   (seat 0 starts, others ready up), and the `RESOLVE-PARTIAL` ruling (locked characters
>   always act; never-locked characters hold — per-character, not per-seat; closes the OPEN
>   timeout question the same way).
> - **Shipped in data this PR, fold the records:** Stoke the Flame is a free action (cd 3→4,
>   e→0 — an owner-designated exception widening the free-action rule; the FREE1 roster test
>   now asserts four), Cinder's Flare Burst (10 + burn 6×2 + Reveal 2) and Solar Flare
>   (30 + burn 8×2 + Weaken), Snare Bloom Root → Slow-2 (interim control-light until
>   TRAP-HALT), and the **range-4 dash floor** (Combat Roll, Backdraft, Glimmer Step, Bramble
>   Stride, Shift — Builder: add the ≥4 content-test guard).

> **✅ SCHEDULED (Analyzer, 2026-09-21) — `AIM-PREVIEW-TRUE`, 2026-08-17 (Designer; owner-flagged
> VERY IMPORTANT).** Backlogged HIGH as the top item; it is the fix for the owner's live preview
> reports — **Bastion's Crushing Slam centre (Dev Note 2026-09-21 #1)** and **Aegis's Shield Bash
> drawing a cone instead of the 3-wide lane (Dev Note #2)**. Sub-band note added in the backlog: the
> axis/inner tells (`axisSquares`/`innerSquares`) draw congruently from the engine predicate too,
> not only the outer boundary. Full spec with acceptance criteria: `docs/design/aim-preview-true.md`.
> The aim preview currently draws two objects that cannot agree — the smooth AIM2 shape
> (the *input region*) and the `expandShape` tile fill (the *answer*) — because HITBOX1
> hits any tile whose central ½-circle the region touches, so tiles rightly light up
> outside the drawn silhouette. **Ruling: the continuous graphic becomes the analytic
> boundary of the engine's own tile-centre predicate**, so a tile is hit iff its centre is
> inside the drawn shape — exactly, at every rotation. Per shape: circles draw at radius
> **exactly r** (CIRCLE-FIX already folded the hitbox in); cones/beams/lines draw their
> region **inflated by ½ tile** with rounded corners (region ⊕ disc(½) ≡ the shipped
> `wedgeCovers` "within half a tile of it" test); Kestrel's modes each draw their own;
> the boundary **must truncate at walls** where line/cone occlusion stops the tiles.
> Client-only — `expandShape`, HITBOX1, CONE-B, CIRCLE-FIX untouched; the boundary is
> generated from engine parameters, never hand-drawn art. The keystone AC: a congruence
> sweep asserting lit tiles == tiles-with-centres-inside-the-boundary for every shape and
> rotation — which doubles as a geometry regression guard. Schedule HIGH per the owner.
>
> **RULED — AIM-BOUNDARY-CONGRUENCE: congruence (AC #1) wins; the drawn boundary matches the SHIPPED
> engine predicate, SQUARE ends and all (SHIPPED PR #92; corrects the Designer's §2 table per Builder
> OQ 2026-09-22 #1).** `aim-preview-true.md` §2's table described **rounded caps** for `line` and
> `cone`+`beamWidth`, but the shipped `wedgeCovers`/`beamCovers` predicate has **square ends** — a
> rounded cap would enclose tiles whose centres never light, breaking the one AC that is the point.
> The Builder correctly drew the square-ended boundary. Ruling: **the boundary is the predicate's
> locus, exactly — where the predicate has square ends, so does the drawing; the §2 "rounded caps"
> wording is superseded.** The engine is **not** changed to add rounded caps (that would be a real
> balance change — an ENGINE ASK nobody has requested). AC #1 (congruence sweep) is the binding form;
> the prose table serves it, not the reverse. **OQ #3/#4/#5 ratified:** the sweep density (full 512
> for range ≤ 3 shapes, every 8th for long lines) is accepted; deleting the old `shapeOutline` (one
> source of truth) is correct; and AC #4's "the outline runs through the boundary tiles' centres, so a
> lit tile's outer half sits outside the line" is the ruling working as specified — a **playtest note
> for the owner**, not a defect.

## Combat simultaneity

- **RULED — Mutual damage.** All Blast damage resolves simultaneously. A character
  that dies this phase still deals its full locked-in damage. Mutual kills award a
  kill to both teams; if that makes both teams hit the format's kill target at once,
  the game is a draw (display "Double KO").
- **RULED — Mid-phase death from earlier phases.** A character killed in Prep (e.g.,
  trap detonation) or Dash phase does NOT act in later phases this turn. Its locked
  Blast/Move orders are discarded.
- **RULED — Dash immunity scope.** Dash immunity applies to Blast-phase abilities
  whose area, as aimed, no longer contains the dasher's current square. If the aimed
  area covers the dash *destination*, it hits. Prep-phase traps and Dash-phase damage
  can still hit a dasher.
- **RULED — RAVOK-RECOIL: Whirling Cleave takes 50% self (11 of 22), via RECOIL, overriding the pure
  CASTER-SAFE=0 for that one ability (owner Dev Note 2026-09-22 #3; backlog RAVOK-RECOIL — data).**
  CASTER-SAFE excludes the caster from its own harmful effects (so Ravok's whirl deals 0 to himself
  today); the owner wants the whirl to **cost him 11** — the same swing-around-yourself price RECOIL
  already prices for Seismic Rupture. Ruling: **Whirling Cleave carries `selfDamagePct: 50`** (Ravok
  takes `floor(22 × 50/100) = 11`, bypassing cover, shields first — the RECOIL mechanic, unchanged).
  **Shockwave stays CASTER-SAFE (0 self, 12 to enemies)** — no recoil, per the owner. **Seismic
  Rupture is unchanged (19 self / 38 others)**. This is a per-ability opt-in on top of CASTER-SAFE, not
  a reversal of it. **Previews must show the self number** (11 on Ravok's own tile for the whirl, 19
  for Seismic, nothing for Shockwave) — the caster's own square is a previewed victim when
  `selfDamagePct` is present (backlog PREVIEW-NUMBERS-AUDIT).
- **RULED — FRAG-SELF: `selfHarm` is a second, distinct exit from CASTER-SAFE — presence, not price
  (owner Dev Note 2026-09-27 #1; backlog FRAG-SELF shipped PR #103; closes Builder session-10 OQ #3).**
  CASTER-SAFE excludes the caster from its own *area* harmful effects. An ability may now opt a single
  effect out of that exclusion with **`selfHarm: true`**, meaning **the caster is just another unit
  standing in the blast** — it is caught iff it is inside the area, and costs nothing if it is not. This
  is deliberately **not** RECOIL: `selfDamagePct` is a *price of firing* (charged even on a whiff, from
  the caster's own square); `selfHarm` is *presence in the area* (charged only when the caster stands in
  it). **The two are mutually exclusive** and validation refuses the pair. Applied at both sites
  CASTER-SAFE excludes a caster from an area (`runBlast`, `detonateDelayedBlasts`) so a delayed grenade
  and an undelayed one agree; the Prep/Dash `applySelfEffects` path (self-*targeted* effects) is
  untouched. Shipped on **Vex's Frag Grenade** (34 damage, radius-2, delayed — now catches its own
  thrower). This is a per-ability opt-out on top of CASTER-SAFE, not a reversal of it — every other
  area ability still spares its caster.
  - **`selfHarm` applies the effect's RIDERS to the caster too (session-10 OQ #5, flagged forward).**
    Frag Grenade is damage-only so nothing turns on it today, but the next ability to take `selfHarm`
    with a `slow`/`weaken`/`root` rider will apply that status to its own caster — because "just another
    unit standing in the blast" means exactly that. This is the intended reading; recorded before content
    depends on it so it is a decision, not a surprise.
- **RULED — batch-3 combat rulings verified (SHIPPED PR #82) and four Builder OQs closed
  (2026-09-18).** PHASE-STATUS-FIRST (statuses batch, then damage batches against post-status state,
  both teams together — phase order Prep→Dash→Blast→Move intact; mutual Weakens both blunt; mutual
  kills still land), CASTER-SAFE + RECOIL, TRAP-CENTRE, TRAP-HALT, ALLY-SAFE all verified. The
  Open-Question corners:
  - **UNTARGETABLE is GATHER-TIME, not re-checked after batch-1 statuses (OQ #5).** Untargetable is a
    **targeting-eligibility** property ("can this ability hit that unit at all"), resolved when a
    phase gathers its targets — **not** a damage modifier. PHASE-STATUS-FIRST governs how damage
    *computes* against post-status state (Might/Weaken, status riders), **not** who is re-selected as
    a target mid-phase. So an Untargetable applied in the **same** phase does **not** retroactively
    dodge that phase's already-gathered damage — consistent with "targeting locks when the ability
    fires," and it keeps the energy gate that rides on the gather. (Untargetable is a Prep buff that
    protects in later phases — cross-phase, unchanged and correct.) Ruled as-is; no change.
  - **TRAP-CENTRE's "per-team cap of 4" was a misreference — there is NO trap COUNT cap; only
    `TRAP_MAX_LIFETIME` (4 turns) exists (OQ #1).** My AC (echoing the designer note) named a count
    cap the engine has never had. Ruling: **no count cap in v1** — the lifetime cap and the balance
    lever the designer already named (the auto-mine's `amount` 8→0-with-reveal, *not* a cap) are the
    backstops. Thorn arming two traps a turn (auto-mine + free Snare Bloom) is watched in playtest;
    **if the carpet is oppressive, a per-team count cap with an explicit eviction policy is a
    Designer decision** (flagged), not a guess. No item now.
  - **A trap never triggers on its owner's TEAM, which already excludes the owner (OQ #2).** Ratified
    — CASTER-SAFE (self-only) and the trap's team-exclusion compose without a hole; recorded so the
    next trap item does not read them as one rule with a gap.

## Movement

- **RULED — Contested square is a *same-step* collision (step-synchronised movement;
  confirms Builder OQ, review 2026-08-13).** The Move phase advances all paths on one
  global clock, one step at a time. A square is *contested* only when two or more units
  would step onto it on the **same** step — then none of them enter and each stops on
  the square it last held. A unit that reaches a shared square a step *earlier* holds
  it; a later arrival is blocked and stops there. This is the only reading that keeps
  the simultaneous model coherent without a priority coin-flip, and it falls out cleanly
  because a path validated against the starting board never targets another unit's start
  square. A blocked/contested unit stops for the rest of the phase (remaining path
  dropped). Implemented in `resolveMovePhase`.
- **RULED — No head-on edge swap (implemented 2026-08-14, item 3a).** Two units whose
  same-step proposals would exchange their current squares (each targets the other's
  square) are a contested crossing — **both stop**, exactly as a same-square contest.
  Verified: u0 (0,0)→(1,0)→(2,0) vs u1 (3,0)→(2,0)→(1,0) now both halt at the crossing.
  Refinement to the earlier over-broad note: this is a **2-cycle (direct swap)** rule.
  A rotation of ≥3 units around a loop (e.g. four units cycling a 2×2 block) crosses no
  shared edge and IS allowed — nobody passes *through* anyone. Only direct swaps are
  blocked. (Irrelevant at 1v1; matters at 2v2+.)
- **RULED — Pass-through.** Units never pass through *enemy* units, walls, or cover
  (the edge-swap case above included). **Allies** are ruled separately — see "Ally
  pass-through" under Teams & control — now that 2v2 is the default; the earlier
  "allies also block in v1" lean is superseded. (Deduped 2026-08-15: the branch merge
  left two Pass-through entries and a redundant contested-square entry; the same-step
  and edge-swap rulings above are the single contested-square authority.)
- **RULED — A move aimed at an unreachable/occupied tile routes to the nearest legal tile
  (owner directive 2026-08-25; backlog MOVE1; client targeting).** You cannot *end* on an
  occupied square (Collisions), but clicking one must not silently drop the whole move — that
  reads as "the game ignored me." Clicking a tile that is occupied, out of budget, or blocked
  moves the unit **as far as legally possible toward it** (the nearest reachable tile — prefer
  the reachable square closest to the clicked target, ties by lowest cost then fixed
  direction order for determinism). The engine rule is unchanged; this is the **client**
  choosing a legal path instead of `pathTo` returning `[]`. (AR's full "click an ally to
  *follow* them" is the richer future version — noted, not required for v1.)
- **RULED — Atlas Reactor movement model: pass through everyone, never end on an
  occupied square (Dev Notes 1 & 2; implemented MV1/MV2, verified against the AR wiki
  2026-08-17).** The human supplied the AR *Movement* wiki text; these are confirmed:
  - **Any character — ally or enemy — may be moved *through*** during normal Move and
    ground dash/charge. Walls and cover still block; units never do (AR "Collisions").
  - **A unit may not *end* on an occupied square** — "if a path ends on a square already
    inhabited, stop on the square before it… applies even if allied" (AR "Collisions").
    The unit closest to a contested square holds it; later arrivals stop before it.
  - **Ground vs airborne dash = walked charge (`path`) vs teleport (`square`):** ground
    triggers traps and is stopped by walls; airborne ignores traps and crosses walls. ✓
  - **Rooted does not stop a dash; Unstoppable ignores slow/root/displacement.** ✓
- **RULED — Distance metric is MANHATTAN for movement (MET1, owner directive 2026-08-20;
  backlog MET1). PARTIALLY SUPERSEDED 2026-08-14 by AIM-METRIC — see "Targeting & vision":
  aiming (`line`/`cone` range, `circle`/`square` aim range and radius, dash `impact`) is now
  EUCLIDEAN; MET1 stands only for MOVEMENT — walking, sprint, reachability, and `path` dash
  length (a walked charge is movement). Vision stays Manhattan (perception, not aiming — a
  separate owner call).** Mimics Atlas Reactor: all *movement* is
  counted orthogonally — a diagonally-adjacent tile is **distance 2**. **A diagonal step is
  still legal but costs 2** (equivalent to two orthogonal steps). This **supersedes the MV3
  "1/2 alternation" diagonal cost model below** (every diagonal now costs 2, not just the
  even-indexed ones) and re-rules **MV4 diagonal charge paths** the same way (a diagonal
  charge step costs 2). Effect: reachable area ~halves at the same budget (move 4: 81→41
  tiles; sprint 8: 289→145), so the **4/8 budgets need NO retune** (they were AR's own
  numbers under this metric) and **M1's map spec is unchanged** (spawn separation 13 / max
  turn-1 threat 12 are measured head-on along a row, where Manhattan and Chebyshev agree).
  The corner-cut and X-crossing rulings below **survive** (they are occupancy rules, metric-
  independent). **Vision is Manhattan too (owner directive 2026-08-21):** `VISION_RANGE`
  becomes a Manhattan radius, and the brush/stealth perception-adjacency exception moves from
  Chebyshev-≤1 (the 8 surrounding squares) to **Manhattan-≤1 (the 4 orthogonal neighbours)**
  — so `vision.ts` (`canSee` range check, `isAdjacent`) is in scope for MET1. Cover stays
  orthogonally-adjacent (already Manhattan-shaped). Determinism is unaffected (Manhattan is
  pure integer).
- **SUPERSEDED (cost model only) — Diagonal movement, AR 1/2-alternation cost (MV3,
  2026-08-17; superseded by MET1 2026-08-20).** The engine went 8-direction (`MOVE_STEPS`),
  which stands; but the "k-th diagonal costs 2 when k even, else 1" parity cost is replaced
  by MET1's flat "every diagonal costs 2." The parity-state reachability search becomes a
  plain Manhattan cost search. Kept here (not deleted) as the record of what MET1 supersedes.
  Cover stays orthogonally-adjacent (unchanged).
- **RULED — Diagonal corner-cut: blocked by either solid flank (2026-08-17).** A diagonal
  step is illegal if *either* orthogonally-adjacent square it passes between is wall/cover
  (`diagonalCornerBlocked`); units never block a corner. This is the adopted v1 convention —
  the AR excerpt the human supplied did not specify corner-cutting, so this stands as the
  ruling; revisit only if AR's exact rule (e.g. single-flank cuts) is provided.
- **RULED — Diagonal X-crossing is allowed; diagonal swaps are not (2026-08-17).** Two units
  crossing diagonally through a shared corner without trading squares — e.g. A (0,0)→(1,1)
  and B (1,0)→(0,1) — both proceed (pass-through; they never share a square at rest). A
  diagonal *swap* (A and B exchanging diagonally-adjacent squares) is still blocked by the
  position-based 2-cycle rule, same as an orthogonal swap. Consistent with the AR
  pass-through model; flag for playtest if the visual X-cross reads oddly.
- **RULED — Displacement skips the displacer's square: carry through (R1c, Designer
  2026-08-13; supersedes the v1 interim "stays put"; ENGINE ASK, backlog).** Walk the
  displacement line the nominal distance. If the landing square is occupied by **the unit
  that caused the displacement**, advance to the next square along the same line (repeat
  while it is the displacer's) — the displacer's body is skipped, not counted, so the victim
  may travel one square further, only ever *past* the displacer. If no free square exists
  beyond it (wall/cover/edge/third unit), fall back to the last-free-square rule (reproduces
  the old net-zero). Never violates "no two units at rest on one square." This completes the
  2026-08-17 "ignore the displacer's body" ruling: that made the charger transparent to the
  *path*; this makes it transparent to the *landing*. Fixes the visible Ram Charge net-zero.
  (Rejected alternative: swap — moves the victim backwards vs the knockback vector and
  contends badly with simultaneous displacement.)
- **RULED — CLASH-AR: adopt AR's clash rules exactly; a passer-through CONTINUES, only an ENDER is
  stopped (owner directive 2026-08-15, verbatim AR source; Designer `clashes-and-basics.md` §1;
  PROMOTES the former PROPOSED-CL1 from deferred to scheduled; backlog CLASH-AR — engine, IMPORTANT;
  addresses the owner's "sprint bug is clashing movement patterns").** The shipped `stepMovers`
  stops **all** same-step co-targets; AR (and now we) stop a unit **only if it is *ending* its
  movement on the contested square**. Two-thirds already matched — the deltas are surgical:
  - **Movement (`stepMovers`):** on a same-step collision, stop a unit only if it is **ending** on
    the contested square (AR rule 2 — the shipped contested behaviour, which stands: both enders
    bounce to their last-held square). Units merely **passing through** continue (AR rules 1 and 3).
    The **2-cycle direct-swap block is UNCHANGED** (AR is silent on swaps; our ruling stands). This
    is the likely cause of the "first sprint doesn't move" report: a sprint path that co-targeted a
    square with another mover was halted whole under the stops-all rule; now it passes through.
  - **Pads (`claimsBySquare`), two amendments to the earliest-entrant model (otherwise correct):**
    **(a)** a **same-step simultaneous entry claims nothing** — the pad is denied to all who enter
    it on the same step of the same phase (today the tie falls to arbitrary event-emission order);
    **(b)** an **ender outranks a passer** — a unit that *rests* on the pad takes it even if a
    passer crossed it at an earlier step (resting is the stronger commitment, AR rule 3).
  - **Scope:** clashes are **per-phase** (Dash movers among themselves, Move movers among
    themselves — phases never cross). **Displacement (end of Blast) is not movement** and keeps its
    own rules. **Ships with tests:** the three AR cases verbatim, each with and without a pad on the
    contested square; the swap-block regression; and a rule-3 case where the passer crossed *earlier*
    and still loses the pad. **Consequence (named):** crossing paths get *safer* (both continue
    instead of gridlocking), a small mobility buff to through-the-middle routes that livens the
    Might-room geometry. Deterministic (integer step clock, fixed order).
  - **SHIPPED PR #62 (verified 2026-09-09).** `stepMovers` stops only enders; `claimsBySquare`
    carries the two pad amendments via `voided`; suite green. The one corner CLASH-AR left open is
    ruled next.
- **RULED — CLASH-CORNER: a passer that cannot take its next step bounces to its last-held square,
  never rests on an occupied one (Builder OQ 2026-09-09 #2; backlog CLASH-CORNER — engine, small).**
  Under CLASH-AR rule 3 an ender and a passer may share a square *at the end of a step*; normally the
  passer walks on. But if the passer's **next** step is blocked (a stationary unit, a wall, the map
  edge), it would come to rest on the ender's square — and **Collisions forbids two units resting on
  one square**. The ruling matches the ender's own bounce (rule 2, already shipped): **the stuck
  passer bounces back to its last-held square** — the last square it occupied *alone* before entering
  the contested one — rather than resting on the occupied square. If that last-held square is itself
  now claimed by another unit's rest, walk back one more along the passer's own path; a unit always
  has its origin to fall back to, so the recursion terminates. Rationale: rule 3 makes *passing*
  cheap but never promises the pass *completes*; when it cannot, the unit is an ender after all and
  takes the ender's fate (stop before the block), not a new stacking exception. **This preserves the
  Collisions invariant** — the property STEP-STACK-INVARIANT tests — with no floats, no RNG, and a
  fixed walk-back order (N-unit-safe). Pads are unaffected: a bounced passer's claims already settled
  by entry (PADS-PASS), and CLASH-AR (a)/(b) still decide the contested pad. **Ships with tests:** a
  passer wedged against a stationary unit ends on its last-held square (not the occupied one); a
  chain of two blocked passers each fall back one; the two-units-on-one-square assertion that the bug
  would trip. The renderer shows the honest final rest — no transient stack is emitted.
  - **SHIPPED PR #64.** `bounceOffOccupied` walks the passer back off an occupied square; suite green.
  - **RULED — CLASH-CORNER conga residual: the last resort is to CANCEL the move, returning the unit
    to its phase-start origin (Builder OQ 2026-09-10 #2).** The shipped bounce can still strand a unit
    when every square on its own path *and* its origin are occupied by other units' rests (a conga
    line). The terminating rule: when no free fallback exists, **cancel the stuck unit's move entirely
    — it returns to the square it stood on when the phase began.** Phase-start origins are **pairwise
    distinct** (no two units began the phase on one square), so a full cancel is always collision-free;
    if the cancel still lands on another unit's rest, that other unit's move is cancelled in turn, in
    **fixed unit order**, each cancel monotonically reducing the count of non-cancelled moves — so the
    cascade terminates. Deterministic, N-unit-safe, and the STEP-STACK-INVARIANT property is the guard.
    Low priority (needs a conga line to reach); ships with a conga regression that would otherwise trip
    the stack assertion.
- **RULED — BLINK-ADJ: a blink whose destination is unavailable lands on the nearest legal square to
  it, never nowhere (owner Dev Note 2026-09-10, "BLINK-CLASH — should a blocked blink land adjacent
  instead of not at all? Blocked blink should land adjacent instead of not at all"; Builder OQ
  2026-09-10 #1; backlog BLINK-ADJ — engine; SUPERSEDES the shipped "neither lands").** A blink (a
  dash-phase teleport) can find its destination illegal for three reasons: **blocked terrain**
  (wall/cover/edge), **occupied** by a unit that rests there, or **contested** by another simultaneous
  blink aimed at the same square (the case PR #64 resolved as "neither lands"). The owner rules all
  three the same way — **land on the nearest legal square to the intended destination rather than
  failing.** Definition of "nearest legal square" (the AR "square immediately before the destination",
  made precise for a path-less teleport): the in-bounds, non-blocked, unoccupied square minimising
  **Manhattan distance** to the destination; ties break by the fixed `direction8`/row-major order the
  engine already uses, so it is deterministic. A blink to an occupied square therefore lands adjacent
  (distance 1) as the owner asks; a blink into a wall lands on the closest open square outside it.
  **Contested blinks:** each blinker resolves to its own nearest legal square to the shared
  destination; if two would pick the **same** square, the **earlier-ordered** unit takes it and the
  other falls to its next-nearest — no coin flip, no "both vanish". This restores both blinks landing
  (the owner's intent) while keeping Collisions (no two rest on one square). **Golden rule / phase
  order:** unchanged — blinks resolve in Dash, before Blast; a blink that lands adjacent is still a
  Dash-phase teleport for immunity and pad purposes. **Ships with tests:** a blink onto a resting unit
  lands adjacent; a blink into a wall lands on the nearest open square; two blinks at one square both
  land, on distinct nearest squares, deterministically; the former "neither lands" assertion flips.
- **RULED — Displacement ignores the displacing attacker's own body (fixes MV1
  regression, 2026-08-17).** Since a charge now passes through and can land *beyond* its
  target, the victim's knockback path must **not** treat the charger's landing square as an
  obstacle (the charger isn't a wall — it just passed through). Fixes Ram Charge no longer
  displacing its target. The *targeting* question (does a damaging charge hit first/all/
  destination?) remains a Designer ENGINE ASK; this rules only the mechanical knockback fix.
- **RULED — Knockback into wall/cover/edge.** The unit stops on the last open square
  along the knockback line. No collision damage in v1.
- **RULED — Knockback + Move.** A displaced unit loses its Move this turn (per spec).
  Its chosen path is discarded, not deferred.
- **PROPOSED — Root vs locked dash.** Root applied in Prep does not cancel a dash
  locked this turn (dash still executes). Root blocks Move-phase movement only.
- **RULED — Traps.** Trigger when a unit *arrives* on the square — see **TRAP-TRIGGER**
  below for the full list of arrivals that count (move, dash, blink-landing, and — since
  2026-09-25 — displacement, each opt-in-able per trap). Damage applies immediately; if it
  kills, remaining path/actions are discarded. A unit that *starts* on a freshly placed trap
  square does not trigger it until it re-enters.
- **RULED — Traps expire; the mechanism (owner directive 2026-09-01, refined 2026-08-16; backlog
  TRAP-LIFETIME shipped PR #45, re-tuned by TRAP-LIFETIME-TUNE).** A placed trap **expires unfired
  at the end of `placedTurn + lifetime − 1`** (a `lifetime: 3` trap covers the turn it is placed
  and the two after, then is gone), mirroring how a `duration: N` status is measured. `TrapState`
  carries the lifetime/expiry from the ability's trap effect; the client's TRAP-INDICATOR marker
  clears on expiry.
  - **RE-TUNED 2026-08-16 (owner Dev Note: "Trap should last 3 turns, max of 4 turns"; backlog
    TRAP-LIFETIME-TUNE — data + constant).** The shipped values (Overwatch Trap `2`, cap `3`) are
    raised: **Vex Overwatch Trap `lifetime: 2 → 3`**, and **`TRAP_MAX_LIFETIME` `3 → 4`** (the
    general cap validation now rejects `lifetime > 4`, accepts ≤4). This **supersedes** the
    2026-09-01 "Overwatch 2 / cap 3" numbers — the mechanism is unchanged, only the two numbers
    move. Owner-ruled, overrides "never rebalance". Ships with the tests updated: an untriggered
    Overwatch Trap is gone by `placedTurn + 3`, a `lifetime: 5` trap fails validation, `lifetime: 4`
    now passes.
  - **Deterministic** (integer turn arithmetic, N-trap-safe list). Out of scope: re-arming or
    moving traps; per-trap balance beyond the owner's numbers.
- **RULED — Chase orders resolve at the end of Move, and the four edge cases (CHASE1; Designer
  ar-parity §7.2 + owner ruling 2026-09-01; backlog CHASE1 — engine + client).** A `UnitOrders`
  may carry a **chase target** (an enemy unit id) instead of a `movePath`: normal movement resolves
  first, then chasers path toward their target with the mover's **remaining budget**, stopping short
  of occupied squares per Collisions. The four cases:
  - **Chase a target you CANNOT see → go to the last-known square, and STOP there (owner ruling,
    OVERRIDES the Designer's "lean: legal into fog").** *"You cannot chase a target you cannot see;
    you will go to their last known square if possible, but not chase it past where you lost
    vision."* A chase must **never use hidden information** (golden rule #5) — pathing to a target's
    true fogged position would leak exactly what fog hides. So at chase resolution: **if the
    chaser's team currently sees the target, path toward its actual (post-Move) square; otherwise
    path toward the team's LAST-KNOWN square for that target and stop there** — do not continue past
    it toward the unseen true position. This requires **engine-side, per-team last-known state**
    (LAST-KNOWN shipped client-only; the engine needs its own authoritative record because chase
    resolution is engine logic). Define it deterministically: the engine records, per `(team,
    enemyUnitId)`, the enemy's position **as of the most recent turn boundary at which the team
    could see it** (updated in end-of-turn processing, integer, N-unit-safe); a chase against an
    unseen target uses that stored square. If the team has **never** seen the target, the chase is
    dropped (the unit holds) — you cannot chase a rumor. A target seen at plan time but lost during
    this turn's resolution resolves to the last square the team saw it (which, at turn granularity,
    is its start-of-turn square).
  - **Chase vs chase (A chases B, B chases A).** Both chasers resolve against the **same snapshot**
    — positions after all normal movement — so neither target has moved by the time the other paths
    to it. Simultaneous and symmetric; each closes toward the other's post-Move square with its own
    budget, stopping short per Collisions (they cannot co-occupy). Deterministic; not a stalemate
    (they converge). Confirm it reads right in playtest.
  - **Chase a target that died this turn.** The order is **dropped** — the unit holds position
    (Designer lean, ratified). A dead unit has no square to chase.
  - **Chase + a dash ability in the same turn.** The **dash is the movement**, so the chase is
    **dropped** (same rule as a dash dropping a `movePath`). One reposition per turn.
  - **Determinism + N-unit safety:** chasers resolve in a fixed unit order against the frozen
    post-Move snapshot; last-known is integer per-team state. No float, no RNG, no clock. Ships with
    tests: chase-into-fog stops at last-known; never-seen target holds; chase-vs-chase converges;
    dead/dashing target drops the chase.
  - **RULED — vision is a TEAM resource: a unit may chase anything its TEAM can see, even if that
    unit itself cannot (Builder OQ 2026-09-02 #6, ratified).** `teamCanSee` is the gate, matching
    team-shared sight everywhere else (GAME_SPEC §3, golden rule #5) — a teammate spotting the
    quarry is enough. Correct, not a bug; recorded so it does not read as one in playtest.
  - **RULED — a malformed order carrying BOTH `chase` and `movePath` resolves as the chase
    (Builder OQ 2026-09-02 #6/decision 6, ratified).** A well-formed client sends one or the other;
    the chase is the more specific statement of intent, exactly as a dash supersedes a walk. The
    client enforces the same in `nextDraft`, so the two never disagree.
  - **RULED — a chase may SPRINT when the turn spends no normal ability (CHASE-SPRINT; owner Dev
    Note 2026-09-06, "Chase should be able to sprint or move depending on how many actions the
    character has … if I … haven't used an attack or only a free action, I should get full sprinting
    chase"; backlog CHASE-SPRINT — engine + client).** A chase's budget follows the **same
    sprint-availability rule as a normal move**: **`movementBudget(chaser, sprint = true)` (8) when
    the unit declared no normal ability; move budget (4) when it did** — a **free action does NOT
    block the sprint-chase** (it never consumes the turn, FREE1). Chase already reads
    `movementBudget(chaser, plan.sprint)`; the gap is that a chase order can carry the sprint flag
    and the client must offer it — so a chase defaults to sprint-budget when no ability is armed, and
    drops to move-budget when one is. A dash ability still cancels the chase entirely (the dash is
    the movement). Ships with a test: a chase with no ability closes up to 8; a chase with an ability
    closes at most 4; a chase with only a free action still sprints.
  - **RULED — CHASE-FOLLOW: a chase re-evaluates vision as the chaser ADVANCES, so it follows all
    the way until it truly loses sight or runs out of movement (owner Dev Note 2026-09-09, "Chasing
    still isn't working as intended. You should follow the character that you're chasing all the way
    until you lose line of sight or you run out of movement"; backlog CHASE-FOLLOW — engine).** The
    shipped `planChases` judges visibility and picks its goal **once, from the chaser's pre-move
    origin** (`resolve.ts:1552-1556`): `teamCanSee` is measured with the chaser still on its starting
    square, and `pathToward` then walks toward that one frozen goal. So a target that outran the
    *stationary* chaser's vision by even one square is treated as fully fogged, and the chase halts at
    the last-known square **even when arriving there would restore sight and the chaser has budget to
    keep closing**. Observed: on the open map, `a`(5,10) chasing `e` that ran to (12,10) stops at
    (9,10) — three short of catchable, `seen:false` — because (12,10) is 7 from a's origin and vision
    is 6; from (9,10) the target is 3 away and plainly visible, but the chase never re-checks. That is
    the opposite of "follow all the way," and it is why the CHASE1 case *"follows a target that ran"*
    asserts (9,10) while its own comment says the chaser "ends up adjacent" — the assertion was fitted
    to the bug. **The rule:** resolve the chase as an iterative walk on the frozen post-Move snapshot,
    re-deriving the goal from the chaser's **live** square after each step — while the team can see the
    target, step toward its true (snapshot) square; while it cannot, step toward the last-known square.
    **Stop only** when the chaser is adjacent to / cannot get closer to its current goal (caught /
    arrived), when it stands on the last-known square and the target is *still* unseen from there
    (sight genuinely lost), or when movement is exhausted. **Golden rule #5 is preserved** — every
    step is taken toward a square the team can see *from where the chaser actually stands*, or toward
    its own last-known memory; no step is ever taken toward a fogged true position, so nothing leaks.
    This generalizes the existing *"regaining sight re-points the chase"* case to happen **within a
    single chase**: a chaser that closes into vision keeps going; a chaser that closes and still cannot
    see (target in brush, non-adjacent) stops at last-known exactly as the fog cases require.
    **Deterministic** — only the chaser advances (the target and all teammates are frozen), team
    vision changes solely because the chaser moved, and steps follow the fixed reachability order; no
    float, no RNG, no clock. **Ships with tests (behavior change → same commit, golden rule #3):** the
    open-map *"follows a target that ran"* case flips to assert the chaser ends **adjacent** to the
    target with `seen:true`; the brush fog cases (*"goes to the last-known square and STOPS"*,
    *"…short of even that budget"*) stay green unchanged (from last-known the target is still
    brush-hidden → stop); a new case where the chaser starts fogged, advances into vision mid-chase,
    and finishes adjacent. `chaseResolved` reports the **resolved** pursuit (`seen` = target in view
    at the end, `to` = the goal finally pursued).
  - **RULED — CHASE-LOS: a chase's sight is LINE OF SIGHT + concealment, NOT the vision-range cap —
    a chaser locked onto its quarry follows it as far as terrain sightlines and its own movement
    allow (owner Dev Note 2026-09-10, "Chasing is still not working. If a character is one tile away,
    it will only chase 1 tile even if the target sprints 8 tiles away … The chase should get the
    chasing character AS CLOSE to the target as possible based on remaining movement and assuming they
    have vision of the character. If they lose vision of the chase target, it should get the chasing
    character as close to the last place the chase target was seen"; backlog CHASE-LOS — engine, HIGH;
    SUPERSEDES the range portion of CHASE-FOLLOW's visibility test).** CHASE-FOLLOW shipped (PR #64)
    but still calls `teamCanSee`, whose first test is `distance > VISION_RANGE → false`
    (`vision.ts:253`). So a target that outruns **range 6** is treated as fogged **even while the
    chaser is right behind it in the open** — the per-step re-check cannot rescue it, because from
    every square the chaser is allowed to reach the target is still beyond 6. Reproduced against the
    engine: a chaser one tile behind a target that sprints 8 tiles east moves **exactly one tile** and
    stops with `seen:false` — the owner's report verbatim. **Root cause:** the engine conflates *"line
    of sight"* (what the owner keeps writing) with *"vision range"* (the arbitrary 6-tile radius).
    `canSee` composes three independent gates — **range** (`distance ≤ VISION_RANGE`), **line of
    sight** (`hasLineOfSight`, walls), and **concealment** (`isConcealedFrom`, brush/stealth/reveal).
    **The rule:** the chase's visibility predicate keeps line-of-sight and concealment but **drops the
    range gate** — a chase sees its target whenever an unobstructed, unconcealed sightline exists,
    at any distance. Everything else in CHASE-FOLLOW stands (per-step re-derivation on the frozen
    snapshot; true-square goal while seen, last-known while not; stop on caught / genuinely-lost /
    budget). **"Lose vision" now means what the owner means:** the target ducks behind a **wall**
    (`hasLineOfSight` false) or into **brush/Stealth** (`isConcealedFrom` true) — a terrain/status
    break, not merely running far. Then, and only then, the chase falls to the last-known square and
    stops, exactly as the fog cases require. **Golden rule #5 holds where it bites:** a target hidden
    by terrain, brush, or stealth is never pursued to its true square (last-known only); the sole
    behaviour that widens is pursuit along a *clear open sightline* past 6 tiles, which is the chase
    the owner is asking for and reveals only what an open sightline already would. **Note (playtest):**
    a chase can now travel toward a target far down an open corridor that normal (range-capped) vision
    would not light — accepted by owner directive; flag for feel. Only the CHASE predicate changes;
    **last-known *recording* (`recordLastKnown`) keeps the range cap**, so the team's persistent memory
    is unchanged. **Ships with tests (golden rule #3):** the reported case — chaser one tile behind,
    target sprints 8 in the open — now ends **adjacent** with `seen:true`; a wall between chaser and a
    close target still drops it to last-known; the brush/Stealth fog cases stay green unchanged; a
    long open-sightline pursuit closes by its full movement budget.
    - **SHIPPED PR #66 (loop only); admissibility gate RATIFIED as-is (Builder OQ 2026-09-11 #1).**
      `walkChase` now asks `teamHasSightline` (range-less LoS + concealment) — the reported bug is
      fixed (verified: chaser one tile behind, target sprints 8 → ends adjacent, `seen:true`). The
      Builder flags that `planUnit` still *admits* a chase order only when `teamCanSee` (range-capped)
      or a last-known square exists, so a **never-seen** enemy visible only down a long open lane is
      refused at plan time. **Ruled: the range-capped admissibility gate is INTENTIONAL — do not
      widen it.** You may *order* a chase only on a target your team currently sees (normal range+LoS
      vision) or remembers (last-known); CHASE-LOS deliberately widened the **pursuit loop** (once
      locked on, follow a fleeing target by sightline past range), not what you are allowed to lock
      onto. The two layers are meant to differ: the gate mirrors **player/client targeting** (you
      cannot click a fogged enemy — normal vision is range-capped, so a range-10 enemy is not
      rendered to target), while the loop is the resolution mechanic. Widening the gate to
      `teamHasSightline` would be dead code — never reachable through the UI — unless the owner ALSO
      extends what a player can see/target to "anything down a clear sightline," which is a separate,
      larger vision-model change, not part of CHASE-LOS. The reported scenarios (a target seen, then
      fleeing) all carry a last-known and are admitted. **No code change; ratified.** If the owner
      later wants sightline-based targeting, flag a new item (ENGINE + client vision widening).
  - **RULED — CHASE-COLLIDE: the chase router treats other units and ENEMY decoys as solid (routes
    around, never through); a deliberate `movePath` is unchanged (SHIPPED PR #68; confirms Builder OQ
    2026-09-12 #2).** `reachableSquares` marks an occupied square `canStop:false` but still *expands
    through* it — right for a path a **player draws** (the ally pass-through affordance, validated
    later) and wrong for a route **computed and walked in one step**. So the reported chase "phasing"
    was really a chaser that *planned* to phase, got stopped by `stepMovers` on step one, and moved
    **nothing** (reproduced: chaser (5,10), enemy (6,10), target (8,10) → chaser holds). Fix (shipped):
    an opt-in `impassable` set on `reachableSquares`, passed **only by the chase**, containing other
    living units and **enemy** decoys. **The lines drawn, all confirmed:**
    - **Allies are solid to the chase too** — not a reversal of ally-pass-through (which is about a
      *drawn, later-validated* path); at chase time every unit has finished moving, so an ally is as
      immovable as an enemy, and a sealed corridor honestly stops a chase.
    - **An enemy decoy is solid to the chase ONLY** — Wisp veils, the chaser loses the sightline, the
      goal falls to the decoy's (last-known) square, and every such chase used to pop the decoy for
      free. Now the chase routes around it. **R2 is intact:** a deliberate `movePath` onto a decoy
      still destroys it (walking onto one is how a player tests it — a test pins this). **No fog leak:**
      an enemy decoy is *shown* to this team, so routing around it uses only what the team sees.
    - **Own-team decoys stay transparent** — matching R2's asymmetry (a team is not fooled by its own
      illusion); blocking on one would be a tell the enemy could read off the pathing.
    **Ratified as the minimal correct line.** If the owner ever wants a decoy solid to **all** movement
    (a universal obstacle), that **reverses R2's destruction-by-entry** mechanic and is a **Designer**
    call, not this fix. **Note (OQ #3, deferred):** the client's chase tell is a destination marker,
    not a drawn route, so the router's ally/decoy-solidity is invisible at plan time — cosmetic today;
    the moment a drawn chase path is added it must use `chaseObstacles`. Low; not scheduled.
- **RULED — WAYPOINTS: a player may compose a move square-by-square instead of taking the auto-routed
  direct line; the engine already accepts it, so this is a CLIENT input mode (owner Dev Note
  2026-09-11, "You should be able to manually set different waypoints to move your unit around an
  enemy, a trap, or any obstacle … Hold down the Shift key while executing a movement command on each
  tile you want to step on sequentially … Every time you click on a tile, your effective movement
  range should change (decrease typically), as you move on sequential tiles"; backlog WAYPOINTS —
  client).** The engine imposes **nothing new**: `validateMovePath` already walks an arbitrary ordered
  list of steps and checks each for adjacency (orthogonal or diagonal), the MET1 cost (1 / 2), terrain,
  the diagonal-corner rule, and the running budget; `runMove` walks the given `movePath` verbatim
  rather than re-pathfinding. So a hand-built path is a first-class `movePath` — the whole feature is
  the client letting the player build one. **The rule (client):** while **Shift** is held, each click
  **appends the clicked tile as the next step** of `draft.movePath`; a tile must be a legal step from
  the previous one (adjacent, not a wall, not the diagonal-corner-cut, within remaining budget) or it
  is refused/marked, exactly as the engine would reject it; the displayed **remaining movement
  decrements by that step's cost** (1 orthogonal, 2 diagonal) on each accepted click, so the player
  watches the budget draw down; releasing Shift and clicking normally keeps today's forgiving
  direct-line auto-route (`pathTo`, MOVE1 nearest-legal). The composed path submits as the ordinary
  `movePath` — no engine change, no new order field. **Determinism/hidden-info:** unchanged — the
  client already computes paths and the engine re-validates on resolve; a waypoint over a **fogged**
  enemy's tile must still obey MOVE-FOG (the invisible enemy is not treated as an obstacle at plan
  time, so the leak that ruling closes stays closed). **Ships with client tests:** a Shift-click
  sequence builds the exact tile list; an illegal next tile is refused and the budget is unchanged; the
  running-budget readout equals `movementBudget − Σ step costs`; a diagonal leg costs 2; the submitted
  order carries the hand-built path and the engine accepts it. **Out of scope:** any engine change
  (none needed); auto-connecting non-adjacent waypoints (v1 is one adjacent step per click — a clicked
  non-adjacent tile is simply refused, keeping "tile-by-tile" literal); touch input.
  - **RULED — WAYPOINTS-FIX: a Shift-click drops a waypoint at ANY reachable tile and the client
    routes the segment to it; the adjacent-only, silent-refusal v1 is superseded (owner Dev Note
    2026-09-12, "WAYPOINTS is not working. I cannot hold shift + click to move to a waypoint"; backlog
    WAYPOINTS-FIX — client, HIGH).** The shipped `appendWaypoint` accepts **one adjacent step per
    click** and **silently refuses** anything else (`resolve`/`targeting.ts:518`, refusal is a bare
    `undefined`), and the click only runs while **move mode is already armed** (`app.ts:1377,1382`).
    So a player doing the natural gesture — select a unit, Shift-click a tile a few squares away to
    "move to a waypoint" — gets **nothing**: the click is non-adjacent (refused) or move was never
    armed (the branch never runs), with no feedback either way. That is the reported "not working."
    My own v1 ruling ("non-adjacent is refused, keeping tile-by-tile literal") is the cause and is
    **reversed here.** **The rule:**
    - **A Shift-click drops a waypoint at the clicked tile, which need NOT be adjacent.** The client
      routes the **segment** from the previous waypoint (or the unit's square) to it with the
      **remaining** budget, using the same obstacle-aware pathfinder as a normal move (`pathTo` /
      `reachableSquares`, nearest-legal within budget, MOVE-FOG-filtered), and **appends that segment**
      to `draft.movePath`. Clicking an **adjacent** tile is just a one-step segment, so exact
      tile-by-tile control is preserved (drop a waypoint on each corner to thread an obstacle
      precisely); clicking further routes there — both the note's "tile-by-tile path" and its "move to
      a waypoint" are served, the second being the one that was missing.
    - **Shift-click arms move by itself.** When a movable unit is selected and no ability/aim/chase is
      mid-commit, a Shift-click **auto-arms move** and drops the first waypoint — the player does not
      have to find and press "Move" first. A Shift-click while an ability is mid-aim is ignored by
      waypoints (aiming wins).
    - **Every click gives feedback.** The **remaining-movement readout draws down** by the segment's
      cost on each accepted click; a click that **cannot be routed** (nothing legal within remaining
      budget) shows a **tell** (reuse AIM-RANGE-TELL's refused-square marker) rather than doing
      nothing silently. An `occupied` end-tile stays non-fatal mid-route (the shipped choice — you may
      route *past* a body), settled at submit.
    **No engine change** (the composed path is still an ordinary `movePath` the engine re-validates);
    determinism/MOVE-FOG unchanged (segments route against the team-visible board). **Ships with client
    tests:** a Shift-click three tiles away builds a routed three-step path (not a refusal); a
    Shift-click with no prior arm still starts a move; the budget readout equals `movementBudget − Σ
    segment costs`; an unroutable Shift-click shows the tell and leaves the path unchanged; adjacent
    clicks still give exact tile-by-tile control. **Out of scope:** engine changes; touch input;
    drawing the route for a *chase* (separate — CHASE-COLLIDE's `chaseObstacles`, deferred).
- **RULED — Plan-time reachability must NOT use a fogged enemy's position (MOVE-FOG; owner Dev Note
  2026-09-06, "Move command is blocked if an enemy is out of line of sight but on the tile that you
  are trying to move. This is giving unintentional information"; backlog MOVE-FOG — client).** The
  client's move preview (`reachableSquares`/`pathTo`) treats **every** unit as an obstacle,
  including enemies the acting team **cannot see** — so a path that reroutes or stops short around an
  invisible enemy **leaks that the enemy is there**, a hidden-information leak exactly like the
  ones PREVIEW-FOG and M3-HIDDEN close. Ruling: at **plan time** the client computes reachability and
  paths against the **team-visible unit set only** (fogged enemies are not obstacles — you do not
  know they are there). The **engine resolution is unchanged** — it uses the true board, so a move
  planned onto/through a hidden enemy's square **stops short at resolution** (the collision rule),
  and *that* is where the enemy is revealed. The leak moves from plan time (wrong) to resolution
  (right — acting/contact reveals). Client-only: feed `pathTo`/`reachableSquares` a fog-filtered
  occupancy (own units + visible enemies), never the raw `state.units`. Ships with a client test: a
  path planned toward a tile held by an out-of-sight enemy is drawn as if free (does not reveal it),
  and resolution stops the mover short.
- **RULED — Power-up pads: settlement, PADS-PASS pickup, PADS-SPREAD placement, and the
  trap-vs-pad difference (PADS1 + owner Dev Notes 2026-08-16; folding in Builder decisions 7–10).**
  A pad grants its effect once, **settled at a single fixed point at the end of Move** — after the
  chasers and the decoy sweep — so the last mover can contest it. The rules the PADS1 line
  understated:
  - **PADS-PASS — a pad is taken by being on its square at ANY point in the turn (owner Dev Note:
    "When passing through a powerup through any movement, it should be taken, you do not need to
    land on the square to grab it").** This **supersedes** the earlier "resolves on occupancy, not
    on travel" (a Builder call, not the owner's). Eligibility is *travel*, but the **settlement
    point is unchanged** (end of Move, after the dying) — a charger who crossed a Health pad in Dash
    and died in Blast takes nothing. Eligibility is read off the turn's own `TurnEvent[]` (each
    `moveStep`'s `to`; a `displaced` slide walks its whole line).
  - **Contest tie-break — earliest claim wins, by event order.** Two units crossing one pad in a
    turn (now possible under PADS-PASS) resolve to the **first to set foot on it** (event index;
    phase order, then the shared Move step-clock), so a **Dash beats a Move** for the same reason
    Dash resolves before Move; a unit already standing on it when the turn began claims at index −1.
    Deterministic. *(Playtest feel flag: a charge reliably steals a pad from a closer walker —
    Builder OQ 2026-08-16 third #8.)*
  - **A teleport over a pad takes nothing** — it occupies no square in between; "passing through"
    means passing through.
  - **Knockback COUNTS as movement for a pad (owner "any movement").** A unit dragged across a
    pad was on the pad → it takes it. **As of 2026-09-25 this now agrees with the trap rule**
    (TRAP-TRIGGER): a knock-through fires a trap too (`DEFAULT_TRAP_ENTRIES` gained
    `displacement`), so pads and traps both count a shove. They still agree on the *other* half
    for the same reason: a **teleport** over a pad takes nothing and a **blink past** a trap
    fires nothing, because a teleport occupies only its landing square and crosses nothing.
    *(Historical note: this paragraph used to record a deliberate pad-vs-trap difference — a
    shove took a pad but not a trap. That difference is gone; the trap rule moved to meet the
    pad rule.)*
  - **PADS-SPREAD — no two pads within Chebyshev 1 (owner Dev Note: "Powerups should not be next to
    each other").** `validateMap` rejects any pad pair with `max(|dx|,|dy|) ≤ 1` (diagonals
    included). Two touching pads are one double prize taken by standing between them (and, under
    PADS-PASS, swept by walking the line) — the detour a pad is meant to cost vanishes. This is a
    **floor, not a placement policy**: how far beyond touching, and which squares, is the Designer's
    (routed). Both maps' placeholder pads were re-laid as mirrored singles to satisfy it.
  - **PADS-SCHEDULE — Might spawns early to be a rush; regular pads later; respawn is 4 turns
    (owner Dev Notes 2026-09-06 #5/#6).** *"Might powerups should be contestable, meaning that it's
    a rush to get to the might powerup"* + *"Regular power-ups began appearing on turn 4, while
    Might power-ups spawned earlier on turn 2 … Respawn Timer: 4 turns."* So the per-pad schedule
    is: **Might pads `firstTurn: 2`, regular (Health/Energy) pads `firstTurn: 4`, every pad
    `everyTurns: 4`**. The early Might spawn is what makes it *the* turn-2 rush (both teams reach
    for it at once); the later regular spawn keeps the opening about position, not pickups. This is
    **data** — the Designer sets `firstTurn`/`everyTurns` per pad on both maps (routed; the existing
    PADS1 mirror + PADS-SPREAD guards keep it honest); the schema already carries the fields, so no
    engine change. **Client (PADS-LIGHTS):** the respawn countdown renders as **four coloured lights
    on the pad tile**, one per remaining turn (owner: "tracked visually by four colored lights"),
    extending PADS-INDICATOR's marker. Out of scope: RNG spawns; pad types beyond the three.
  - **PADS-PLACEMENT — Might is the CENTRE prize (Designer PR #57, 2026-09-07; done in data;
    resolves Builder OQ 2026-09-07 #2 / owner Dev Note "Might should be contestable — a rush").**
    The turn-2 schedule alone was not enough — two mirror-fair Might pads each *nearer one team*
    are "two safe pickups", punctual not contested. **The Might pair moved into the central
    strongpoint** (duel-arena **(7,7)/(10,7)**, iron-basin **(9,9)/(12,9)** — the centre-most
    non-adjacent mirrored pairs PADS-SPREAD allows), within turn-2 reach of **both** teams (near
    pad Manhattan 6, far 9), so holding "your" Might means standing where the enemy contests it;
    **Health/Energy took the vacated flank rows** (`firstTurn: 4`). Schedules stayed with the
    *type*, not the position. This closes maps-v1's "is the central room worth taking?" question —
    the damage buff now lives there. **Playtest lever if the room over-dominates at 4v4:
    `everyTurns` 4 → 5 on iron-basin, NOT moving the pads back out.** Verified in data (both maps
    pass the PADS1 mirror + PADS-SPREAD + content guards).
- **RULED — Walked dash vs teleport; `shape` is the authority (R4, updated 2026-08-19).**
  Two dash models, distinguished by `shape` — and `shape` alone decides *how* a reposition
  happens; a `teleport` **effect** only says *that* the caster repositions (which makes it a
  self/utility ability for the energy-on-use rule). So Vex's Combat Roll and Cinder's
  Backdraft (`shape: "path"` carrying a `teleport` effect) are **walked** ground dashes, not
  wall-crossers — no data change (R4).
  - **Walked charge** (`shape: "path"`, e.g. Ram Charge; also Combat Roll/Backdraft):
    traverses each path square in Dash; **passes through characters** (MV1) and, if it deals
    damage, strikes the **first enemy whose square it crosses** and no others (R1a — the
    destination is not special). May move diagonally (MV4). Triggers every trap it enters;
    stopped by walls/cover. Damage lands in Dash.
  - **Teleport** (`shape: "square"`, e.g. Wisp Blink/Shadowstep, Lumen Glimmer Step, Aegis
    Intercept): ignores intervening squares and walls, appears at the destination; requires
    an open, unoccupied destination or it fizzles. **Brush is a legal destination** — a unit
    may dash/teleport/move INTO brush and gain its concealment (owner directive 2026-08-22;
    the engine already permits it, `blocksMovement` excludes brush — see BRUSH1 to verify the
    client offers brush squares + add a test). Triggers a trap only on the destination. A
    teleport-strike (Shadowstep) hits every unit (FF1) adjacent to the landing.
    **SUPERSEDED 2026-08-14 by DASH-IMPACT: the hardcoded teleport-strike adjacency branch is
    DELETED and replaced by Shadowstep carrying `impact: { destination: 1 }` in data** (a
    Euclidean radius-1 `circleSquares` region — the same 4 orthogonal neighbours it resolved to
    under the interim Manhattan-1 ruling, now expressed as data, not an engine special case).
    The MET1-tp backlog item is closed by DASH-IMPACT. **Wisp rebalance flag (Designer):**
    confirm Shadowstep's damage/energy still lands the fantasy at the radius-1 footprint.
  Content guardrail (R4, optional): a test may assert no `shape: "path"` ability ever
  resolves through the teleport branch, so a refactor can't silently make Combat Roll
  wall-crossing.
- **RULED — A dash may not END on a square held by another character, EXCEPT when the skill's own
  knockback clears it first (owner directive 2026-08-30, "you should not be able to dash onto the
  same square as another character unless there's a knockback associated with the skill"; backlog
  DASH-OCCUPIED — engine tests + client aim-gating).** The **prohibition already holds in the
  engine** and this ruling pins it: a **teleport** (`square`) onto an occupied square **fizzles**
  (`teleport()` at **`resolve.ts:963`**, occupancy check at **:967** — corrected 2026-08-31; the
  2026-08-30 draft cited `:292`, which is `teleportDestination`, a different function), and a
  **charge** (`path`) **rests on the furthest FREE square** (`walkCharge` :933-937), never on top
  of a unit. Decoys are not in
  `state.units`, so this is about real characters; a dash *ending* on a decoy destroys it (R2).
  The two owed pieces:
  - **The knockback exception (engine).** A dash whose **own effect knocks the destination's
    occupant away** may land on the vacated square: the clearing displacement resolves **as part
    of the dash landing (in the Dash phase, before the dasher settles)**, not deferred to the
    end-of-Blast displacement pass — otherwise the occupant is still standing when the dasher
    tries to land and it fizzles/rests-short. Order: knock the occupant out → land the dasher.
    **No current roster dash exercises this** (charges rest-short and carry their knockback as an
    area `impact`; no teleport both aims at an occupied square and knocks its occupant off it), so
    this is forward-looking — implement the resolution order + a synthetic test now so a future
    knockback-dash works, or, if cheaper, rule it PROPOSED and document the order for when a skill
    needs it. Either way the **prohibition ships with regression tests** across charge, teleport,
    and the Shift catalyst (all three must refuse an occupied destination without the exception).
  - **Client aim-gating.** A teleport/dash aim at an occupied square should be **refused at commit**
    (it silently fizzles otherwise), same as AIM-RANGE refuses out-of-range clicks — the client
    marks an occupied destination illegal rather than sending an order the engine drops.
- **RULED — Charge breadth via optional `chargeHits` (R1b, Designer 2026-08-13; ENGINE ASK,
  backlog).** `AbilityDef` gains `chargeHits?: "first" | "all"`, default `"first"`. On
  `"all"` a damaging `path` dash applies its effects to **every** enemy crossed (Kestrel's
  ult Tempest Run); `"first"` / absent = R1a. Energy is still once-per-use on hitting ≥1
  enemy. Validation rejects any other value and rejects the field on non-`path` shapes.
  **Interim:** `kestrel.json` already carries `"chargeHits": "all"`; until implemented the
  engine ignores it and Tempest Run hits only the first enemy — weaker than designed, never
  stronger, safe to ship.
  - **RULED — BASTION-RAM-LINE: Ram Charge becomes an all-in-line charge and previews as a line +
    landing marker (owner Dev Note 2026-09-24 #3; backlog BASTION-RAM-LINE — data + client).** *"Bastion's
    Ram Charge should be a linear aoe dash that affects all players in a line, not just the first enemy
    hit; the preview should be like a line attack that also shows the ending dash location."* The engine
    already supports this via `chargeHits: "all"` (validated, read by `resolve.ts:1347`). Ruling: add
    **`chargeHits: "all"`** to `bastion.ram_charge` (data) — it hits every enemy its path crosses,
    keeping its damage 15 + knockback 1 on each (CASTER-SAFE/ALLY-SAFE filter as always); the client
    **draws the charge as a line** over the tiles the path crosses **plus a marker at the dash landing**
    (the honest all-hit footprint, not the first-enemy stop). Ram Charge stays a dash — CD-BAND-DASH
    sets its cooldown to **4** (enemy-facing), which composes with this unchanged. Addresses session-7
    OQ #3 for this ability: a line charge that hits everyone has no "stopped short by the first body"
    ambiguity, so its preview is the whole line.
- **PROPOSED — WARDING-WALL: a Prep line-hazard replacing Aegis's Grounding Strike; a new reusable
  mechanic (owner Dev Note 2026-09-24 #2; backlog WARDING-WALL — engine + data; ENGINE ASK).** *"Change
  Aegis's Grounding Strike to be a prep phase, 4 cool down skill named Warding Wall which puts down a 4
  tile long wall that lasts until the end of this turn that does 25 damage to those who walk through it
  and weakens them for the next turn."* This **replaces** the Blast ability `grounding_strike` (line,
  dmg 14 + slow) with a Prep ability. The mechanic is new: a **line of hazard tiles** (a "wall"),
  placed in Prep, that damages + weakens any unit **entering** any of its tiles this turn, then expires.
  Proposed ruling / build shape (reusing traps, per golden rule #2's "generic, reusable"): the ability
  places a **trap on every tile of a line/wall shape** (generalising TRAP-CENTRE's single placement to a
  wall placement), each trap carrying `onTrigger: [{damage: 25}, {weaken, duration: 2}]` (duration 2 so
  the weaken bites **next** turn, per the owner), with a **lifetime that covers only the placement turn**
  (armed in Prep, active through this turn's Dash/Move, gone at end of turn). **It is a HAZARD, not a
  blocker** — units walk *through* it (taking the hit), so it does **not** change movement pathing or
  line of sight (simplest reading of "walk through it"). Trap triggers already fire on **dash or move
  entry** (not on knockback/pull — the v1 rule), and already exclude the owner's team — so Aegis and
  allies are safe by the existing trap rules. **Design confirmations owed to the Designer/owner:** wall
  length (owner says **4**); aim (a line from the caster, or freely placed?); whether a dasher crossing
  it is hit (default **yes** — traps trigger on dash entry); and that Aegis losing a Blast for a Prep
  wall is intended (it reshapes the kit). Prep cd **4** as directed (a new ability sets its own cd; the
  CD-BAND prep-freeze is about not retuning *existing* prep cooldowns). **Because grounding_strike is
  replaced, CD-BAND-BLAST must DROP it from its retune list** (it is no longer a Blast). Ships with a
  test: a unit entering a wall tile takes 25 and gains weaken(2); the wall is gone next turn; the caster's
  team is unharmed.
- **RULED — WALL-ROTATE: a wall is anchored at the clicked tile and runs ALONG a chosen cardinal, not
  centred across a derived facing (owner Dev Note 2026-09-26 #1: "Warding Wall should be able to be placed
  on a tile and then rotated in 4 directions for placement"; shipped `63d613f`; confirms Builder session-9
  OQ #1; CLOSES session-8 OQ #1 and OQ #2).** The `wall` aim now carries **both** halves — a square (the
  anchor) **and** a step (which of four cardinals it runs in) — as independent choices; the caster's
  position no longer factors in. The clicked tile is the wall's **first** tile, and the four rotations are
  four genuinely different arms. **Why the anchor moved:** a segment *centred* on the aimed tile and laid
  *across* a facing is symmetric — identical north and south — so four rotate buttons would produce only
  two distinct walls plus a one-tile nudge. Anchoring at the click and running *along* the cardinal makes
  the tile a pivot and gives four real rotations, which is what "rotated in 4 directions" means. This also
  **dissolves the even-length centring question** (old OQ #2): there is no centre left to place. **Aim
  legality:** `aimIsLegal`/`aimLegal` for `'wall'` now require an in-range anchor **and** a valid step
  (`isAimStep`); neither substitutes for the other (unlike a `line`, where a step and a target each imply
  the other). An off-cardinal step **snaps** to the nearest of `WALL_ROTATIONS` rather than being refused
  (deterministic, like a cone's `dominantCardinal`); the old refusal of the caster's own square is gone
  (there is now an authored direction, so a wall under your own feet is legal, if eccentric). Rotation
  rides `AbilityOrder.aimStep`, which the server already relays, so networked play needs nothing new.
  - **DESIGNER FLAG (session-9 OQ #2) — the effective reach moved.** `range: 4` still bounds the *anchor*,
    but the wall then extends 4 further tiles along the cardinal, so its far end can now sit up to ~7
    squares from Aegis (it reached ~5 under the centred geometry). No number changed and the Builder did
    not rebalance; whether `range` should come down is a **Designer/playtest call**, not an engine bug.
  - **CLIENT WIRING BUG this exposed (backlog WALL-CAST-FIX).** Because a wall order is now *refused*
    without its step, a client that fails to *send* the step makes the ability uncastable — which is
    exactly what shipped: `toUnitOrders` copies `aimStep` only when `isRotatable` (line/cone), and a wall
    is `isPlacedRotatable`, not `isRotatable`, so the rotation is dropped and the engine refuses the order.
    The preview (which reads `aimFor` directly) still draws, so it looks fine. Fixed by carrying the step
    for placed-rotatable shapes too, with an order-build/resolve regression. This is a client defect, not
    a rule question — the ruling above is correct as shipped in the engine.
- **PROPOSED — WALL-HIT-ONCE: a multi-tile hazard hits a given unit at most once per turn; it stays a
  barrier that hits everyone who crosses (owner Dev Note 2026-09-28: "Warding Wall is not a trap that goes
  away after being hit", disambiguated by the owner to "barrier, but each unit hit once"; backlog
  WALL-HIT-ONCE — engine).** Warding Wall is `perTile` — four independent one-shot traps — so a single unit
  can be hit **multiple times by one wall**: walking *along* its length runs over three tiles for 75, and
  even a perpendicular cross that clips two tiles double-hits. The owner wants a unit to take the wall's
  25 + weaken **once**, while the wall **remains a multi-target barrier** — a second, different enemy
  crossing it the same turn is still hit. So the fix is a **per-unit-per-cast dedup, not consumption of the
  whole wall**: the first tile of a wall to catch a unit fires and is consumed; further tiles of the *same
  cast* do **not** fire on *that same unit* this turn (and are **not** consumed — they wait for other
  enemies). This is generic: any future `perTile` hazard inherits it. **Ruling:** a trap carries a
  **group id** stamped at placement (all tiles of one `perTile` cast share it; a single-tile trap needs
  none — it can only hit a unit once anyway); resolution keeps a per-turn set of `unitId × groupId` already
  hit, and `triggerTrapsOnEntry` skips (does not fire, does not consume) a tile whose group has already
  hit this unit this turn. The set spans the whole turn (a unit could dash through in Dash and be shoved
  through in Blast — still one hit from that wall). **The barrier is unchanged in every other respect:**
  it still hits *every distinct* enemy who crosses, still expires end of turn (lifetime 1), and a unit
  crossing **two separate walls** takes 25 from **each**. Not whole-wall-consumption — the owner chose to
  keep the multi-target barrier (see the answered Dev Note). Determinism/N-safety: the dedup is a keyed
  set, order-independent. **Ships with tests:** a unit walking along a 3-tile wall takes 25 once (not 75);
  two different units each crossing it each take 25; a unit crossing two separate walls takes 25 twice; an
  ordinary single-tile mine is unaffected.
- **RULED — TRAP-TRIGGER: what counts as setting off a trap, as a list of arrivals
  (owner Dev Notes 2026-09-25; backlog TRAP-SHOVE-DEFAULT — engine; SUPERSEDES the
  2026-08-14 "knockback/pull do NOT trigger traps in v1" ruling below, and closes
  Builder session-8 OQ #3).** The owner pulled the lever the old ruling named: *"Traps
  should trigger if an enemy is knocked through the trap or if they blink onto the trap
  or dash onto/through the trap,"* and *"Trap should not trigger if enemy blinks PAST the
  trap."* A trap now says **which arrivals set it off**, drawn from four kinds
  (`TrapEntry`, `types.ts`): **`move`** (a Move step onto/through the tile), **`dash`** (a
  charge step onto/through it), **`teleport`** (a blink whose *landing square is the trap
  tile* — see below), and **`displacement`** (a knockback or pull that carries the victim
  onto or across the tile). A trap fires for a given arrival iff that kind is in its list;
  `triggers` unset means **`DEFAULT_TRAP_ENTRIES`**.
  - **The reversal, precisely: `DEFAULT_TRAP_ENTRIES` now includes `displacement`**
    (`['move','dash','teleport','displacement']`), so **every ordinary mine** (Vex's
    Overwatch Trap, Thorn's Barbed Sling and Snare Bloom) now catches a knock-through —
    the "shove-into-trap combos" the old ruling deferred. Knocked *through* and knocked to
    *rest on* both trigger: displacement is walked **square by square** along the path
    actually travelled (`applyDisplacements`, the `shovedThrough` list — a mechanism PR #97
    already shipped for the wall), and the resting square is the last square in that path,
    so crossing a trap costs the crossing and stopping on one costs the stop, each exactly
    once (the carry-through fix-up re-uses a square already in the list; the trap is consumed
    once).
  - **Blink ONTO triggers; blink PAST does not — and this needs no `displacement`-style
    path walk.** A teleport occupies only its **landing square** and crosses nothing (the
    same reason "a teleport over a pad takes nothing"), so `triggerTrapsOnEntry` is called
    once, for the landing tile, with entry `teleport`. Land on the trap → it fires; land
    beyond it → it was never entered. This is why Dev Note #2 ("not if the enemy blinks
    PAST") is the *automatic* consequence of checking only the landing square, not a special
    case — and why the distinction is real for a mine (`teleport` is in the default) but
    moot for the wall.
  - **The wall keeps its authored "a blink goes around it" exception.** Warding Wall's
    `triggers` are `['move','dash','displacement']` — deliberately **no `teleport`** — from
    the owner's session-8 Dev Note *"It will hit dashes, moves, and displacements, but not
    blinks."* A barrier is a thing a blink jumps; a mine is a thing a blink can land on top
    of. So a blink neither onto nor past the wall triggers it, while a blink onto a mine
    does. **Flag to owner:** this is the one place the new general rule ("blink onto → it
    triggers") and the wall's authored exception diverge; kept as the owner last wrote it
    for the wall — say so if the wall should now also bite a blink that lands on it.
  - **Determinism / N-safety:** unchanged. The displacement path walk and per-square trap
    firing already exist and are proven for the wall; widening the default only routes mines
    through the same integer path. Trap-list order is stable, traps are consumed by id.
  - **Ships with tests (backlog TRAP-SHOVE-DEFAULT):** the shipped guard *"an ordinary mine
    still ignores a shove"* (`warding-wall.test.ts`) **flips** to assert the mine now fires
    on a knock-through (damage lands, trap consumed); a **new** test asserts a blink that
    lands **past** a mine does **not** fire it (mine still armed, no damage); the existing
    blink-**onto**-a-mine and dash-through tests stay green.
- **SUPERSEDED 2026-09-25 — Knockback/pull do NOT trigger traps in v1 (closed Builder OQ,
  review 2026-08-14).** *(Kept for the record; reversed by TRAP-TRIGGER above.)* The v1 rule
  listed dash and move only; a unit *shoved* onto a trap did not trigger it. It named itself
  "the first lever to pull if shove-into-trap combos are wanted later" — and that is exactly
  what the owner did.
- **RULED — Every kit needs a dash answer; Thorn is a gap to fix, not to exempt
  (2026-08-20; addresses Builder OQ + Dev directive).** The 1v1 mind-game (and 2v2 spacing)
  assumes each character has a Dash-phase reposition. Expanding `content.test.ts` to the full
  roster surfaced that **Thorn (Support) has no dash**. The Builder's interim — scoping the
  dash guardrail to non-support archetypes — is **accepted only as interim**. The real fix:
  the human/Designer wants **one of Thorn's abilities removed and a dash added** (backlog
  Thorn-dash, Designer/data). Once Thorn has a dash, **tighten the guardrail back to all
  kits** (Lumen, the other Support, already has one). Do not leave Support permanently
  dash-exempt.

## Targeting & vision

- **RULED — Free-aim into fog.** Players may aim any ability at any legal square,
  seen or unseen. Hitting a stealthed/hidden unit works normally — stealth hides
  position, it is not a dodge.
- **RULED — Every aimable skill shows its range and is CLAMPED to it, for EVERY slot (AIM-RANGE;
  owner directive 2026-08-29, "Veil's Blink … should be limited to the range of the skill. Audit
  to make sure all skills are limited to the range of the skill … Aegis's intercept does the same
  thing"; also "Dash catalyst doesn't have a range indicator" / "Overwatch Trap doesn't have a
  range indicator either … audit this to ensure you catch all skills"; backlog AIM-RANGE —
  CLIENT).** The **engine already enforces range** (`aimIsLegal` → `aimInRange` for
  `square`/`circle`; a cost-bounded path for `path`) and drops an out-of-range order — so the bug
  is entirely client-side and has two halves, both of which must hold for **the normal ability,
  the free ability, AND the catalyst** slot alike:
  - **Show the range envelope** whenever an aimable slot is armed. Today it is drawn only for the
    hovered/selected *normal* ability (`app.ts` ~:497 `envelopeAbility = hovered ?? chosen`), so an
    armed **free ability** (#2, Overwatch Trap) and an armed **catalyst** (#1, Dash catalyst) show
    none. Extend it to those slots using the same `rangeEnvelope`.
  - **Reject (or clamp) an out-of-range commit.** `aimFor` for `square`/`circle` returns the raw
    clicked square (`targeting.ts` ~:413) and `onBoardClick` commits it with **no `aimLegal`
    gate** — so Blink and Intercept (both `square` teleports) accept any click and the engine then
    silently drops the order, which reads as "you can use it where you want" but nothing happens.
    A click outside range must **not commit** (leave the slot armed / show it illegal), matching
    how a `path` dash already refuses an unreachable target (`pathToExact` → empty). **Audit all
    shapes × all slots** — the owner asked twice for the audit.
- **RULED — A plan-time preview must not reveal what the acting team cannot see (PREVIEW-FOG;
  owner directive 2026-08-29, "The preview of damage/healing cannot show up if the player taking
  the action does not have vision of the character affected"; backlog PREVIEW-FOG — CLIENT).**
  `preview-numbers.ts` filters affected units by polarity/team but **not by vision**, so a floating
  damage number appears over an enemy the actor cannot see — a hidden-information leak (you learn a
  fogged enemy's exact square by aiming near it). Ruling: a preview number (and any per-unit plan-
  time hint) is shown for an affected unit **only if the acting seat's team can currently see that
  unit** — own units always; enemies only when in team vision (`visibleEnemiesForTeam`, the same
  gate fog uses). You may still *aim into* fog (free-aim stands); you just do not get told what is
  standing there. Hot-seat is not the security boundary (M3 is), but the leak is avoidable now and
  the rule is the right one to carry into M3.
- **RULED — A damage preview accounts for Might, Weaken and Cover — not the nominal amount (owner
  Dev Note 2026-08-16, "Should account for Might + Cover + Weakness"; backlog PREVIEW-MODIFIERS —
  client + a small engine export).** PREVIEW-NUMBERS (and the decoy preview, and any per-unit
  damage hint) currently shows the ability's **nominal** effect amount; the owner wants it to show
  what the hit would **actually deal** given the modifiers knowable at plan time. Compute the
  previewed damage through the **ruled composition** (edge-cases: outgoing **Might/Weaken** →
  **cover** reduction → shields → HP) by **reusing the engine's own `computeDamage` /
  `isBehindCover`** — the client must not reinvent the math, or the preview and the resolution can
  disagree. Scope and limits:
  - **Attacker's Might/Weaken:** apply the attacker's *currently-active* statuses (always known —
    the attacker is an own unit). **Cover:** apply `isBehindCover` for the attacker→target line
    (pure geometry, knowable at plan time).
  - **Plan-time honesty:** a status **applied this turn cannot be known** — Adrenaline (Might)
    resolves at the *start* of Blast, after lock-in — so the preview reflects **current** state,
    not this-turn buffs. That is correct and the same limitation PREVIEW-FOG lives with; do not try
    to predict post-lock statuses.
  - **Shields:** the owner named Might/Cover/Weaken, not shields — showing HP-loss-after-shield is a
    natural extension (the nameplate already shows the shield pool), **flagged** not required this
    item. Keep the number the post-cover damage for v1.
  - **Engine export:** if `computeDamage`/`isBehindCover` are not already exported from
    `@cards/engine`, export them (pure functions — a correct surface-widening, like `orders.ts`),
    so client and server share one damage truth. Ships with a client test: a Might'd attacker's
    preview is higher, a Weakened one lower, and a target in cover shows the reduced number, each
    matching a direct `computeDamage` call. **Out of scope:** engine damage rules (unchanged); this
    is the *preview* catching up to them.
- **RULED — A placed trap is drawn on the ground for whoever may see it (TRAP-INDICATOR; owner
  directive 2026-08-29, "Traps need an indicator on the ground for the team or teams who can see
  it"; backlog TRAP-INDICATOR — CLIENT).** Traps are placed in Prep and currently have **no board
  indicator at all** (only a combat-log line when triggered), so a player cannot see their own
  minefield. Ruling on visibility: **the placing team always sees its own traps** (you planted it,
  and it is team-safe — you must route around/over it knowingly); **the enemy team sees a trap only
  when a unit has vision of its square** (same team-vision gate as units — fogged otherwise). This
  mirrors AR (traps are a hidden threat until seen) and keeps the client a pure consumer: it needs
  the trap list with `teamId` + position from the engine and applies the existing
  `visibleSquaresForTeam` gate. (If the owner later wants own-traps hidden even from their placer,
  that is a separate call; the directive says "the team … who can see it", so own-team-always is
  the reading.)
- **RULED — Client renders fog of war from the engine's existing vision (owner directive
  2026-08-25; backlog VISION1; client).** The engine already models AR-style vision — LoS
  blocked by walls (not cover), Manhattan sight radius (MET1), brush concealment with the
  adjacency exception, Stealth/Reveal, team-shared sight (`canSee`,
  `visibleEnemiesForTeam`, `visibleSquaresForTeam`) — but the client draws everything, so none
  of it is felt. VISION1 **surfaces** it, it does not re-derive it:
  - During the **Decision phase**, apply the vision of the **seat-on-the-clock's team**: enemy
    units the team cannot see are hidden (or shown only at a last-known ghost per AR), and
    tiles outside team sight are fogged/dimmed. Own-team units are always shown.
  - During **resolution playback**, reveal what happens (you learn the enemy's actions that
    turn — acting reveals, per the existing "attacking breaks concealment" ruling). Full
    per-team hidden information across the network is an **M3** concern; hot-seat fog is a
    local approximation of it and is explicitly not the security boundary.
  - **The OPENING frame is fogged too (owner directive 2026-08-26, "enemy team should be
    removed from opening frame"; backlog VISION1-opening).** The very first render — the initial
    board before any turn is planned — must already apply the seat-on-the-clock team's vision:
    enemy units the team cannot see are **not drawn at match start**, exactly as during any
    later Decision phase. There is **no turn-1 grace reveal** — do not flash the full board on
    open and then fog it. On the standard maps spawns are out of mutual sight, so at open each
    team sees only its own units until someone advances into vision. This is the same
    `visibleEnemiesForTeam`/`visibleSquaresForTeam` consumption applied to the initial frame;
    the client still computes nothing (golden rule: pure consumer). Fixes the leak where the
    opposing team was visible on the opening frame before fog engaged.
  - The client must compute nothing about visibility itself — consume the engine's `canSee`/
    `visibleEnemiesForTeam`/`visibleSquaresForTeam` (golden rule: client is a pure consumer).
  If the owner wants specific AR vision-*rule* changes after seeing fog rendered (e.g. cover
  blocking sight, or a different sight radius), those are separate engine rulings — raise them
  then rather than guessing now; the current rules already match AR closely.
- **RULED — Free-rotation aiming via a QUANTIZED INTEGER direction (AIM2, owner directive
  2026-08-20; backlog AIM2; scope: `line` and `cone` only).** `cone`/`line` may be rotated
  freely (360°) instead of snapping to 4/8 compass directions. **Determinism (golden rule
  #1) is non-negotiable:** the aim direction crosses into the engine as a **quantized integer
  step** (e.g. one of 256 or 360), **never a float/radian**. The **client** does the trig
  (mouse → integer step; trig is presentation). The **engine** consumes only the integer step
  and contains **NO trig** in the resolution path — coverage is computed from a committed
  integer direction-vector lookup table or integer half-plane / cross-product tests. A
  **standing test guard** asserts `packages/engine` contains no `Math.cos/sin/atan2/tan`
  (add it regardless of when AIM2 lands). `circle` (target-square Euclidean disk) and `path`
  (dashes) are unaffected.
  - **RULED — Finer rotation is a `AIM_STEPS` bump, and it stays deterministic (owner Dev Note
    2026-08-16, "make the rotations for attacks even more smooth, like 360 degrees of freedom";
    backlog AIM-SMOOTH — engine + client).** Aiming is **already** 360°-free — `AIM_STEPS = 256`
    (`shapes.ts:69`), ≈1.4° per step — so the ask is finer *granularity*, not a new capability.
    **Raise `AIM_STEPS`** (e.g. 256 → **512** or 1024); the quantization is a Manhattan diamond with
    `AIM_R = AIM_STEPS / 4` per quadrant, so any multiple of 4 keeps the integer diamond exact —
    **no trig, no floats, determinism preserved** (the no-trig guard still holds; the HITBOX1
    cross-engine signature will shift, regenerate it). The client's mouse→step map (`dragToAimStep`)
    already scales with the constant. **Known deeper cause, flagged not required:** equal *steps*
    around a diamond are not equal *angles* (steps bunch near the axes vs the diagonals), so
    rotation can feel subtly uneven even at high step counts; making it truly angle-uniform needs a
    **precomputed integer direction table** (built offline, no runtime trig — still deterministic),
    which is the follow-up if a bump alone does not satisfy. Start with the bump — it is one
    constant + regenerated golden values. Ships with the rotation-invariance/determinism tests
    re-run at the new resolution.
- **RULED — Tile coverage = Atlas Reactor central-circular-hitbox (owner directive
  2026-08-25; SUPERSEDES the AIM2 "centre-in" rule below; backlog HITBOX1).** Every tile has a
  hidden **circular hitbox of radius half a tile, centred on the tile**. A tile is hit **iff
  the AoE region intersects that hitbox circle** — not iff the shape merely covers the tile's
  centre point, and not iff it merely touches the tile square. Consequences, per the owner:
  - **The intersect rule:** "nicking" the sharp outer corner of a tile does **not** count —
    the AoE must expand deep enough past the corner to clip the central circle.
  - **The halfway rule (guarantee):** if the AoE boundary cuts at least **halfway along a
    tile's edge**, it is guaranteed to reach the hitbox (the edge midpoint is exactly half a
    tile from centre = the hitbox radius) and deals damage.
  - Coverage stays **binary** (full damage or none) — the hitbox changes *which* tiles are
    hit, not the damage amount.
  - **DETERMINISM (golden rule #1, non-negotiable):** compute the shape∩circle test with
    **integer arithmetic only — no trig, no floats** (the AIM2 no-trig-in-engine guard still
    holds). Work in a scaled integer lattice (e.g. ×2 so the half-tile radius is the integer
    1) and compare **squared** distances / integer half-plane (cross-product) perpendicular
    distances; never `Math.sqrt`. A fixed shape+aim must yield the identical tile set on every
    engine — ship the cross-engine regression alongside it.
  This is more generous than centre-in for a shape that reaches within half a tile of a centre
  without covering it, and stricter for a corner-only nick — exactly AR's feel. `expandShape`
  is the one authority; UI2's Layer-2 tiles read it, so the overlay stays honest for free.
- **SUPERSEDED — "Tune ability ranges DOWN in data" (HITBOX-tune, owner directive 2026-08-26;
  superseded by the Designer's measurement 2026-08-14, aoe-footprints-v1.md).** The owner's
  intent — bring the HITBOX1-inflated footprints back toward their pre-HITBOX1 size, because the
  damage was tuned against the old areas — **stands**; only the *mechanism* changes. The Designer
  measured the shipped engine and proved a **data pass cannot deliver it for circles**: `radius`
  is an integer and the steps are far too coarse (an r2 circle keeps its inflated 21 tiles or
  drops to 9, against a target of 13 — no integer lands on target, and the pass would churn
  thirteen abilities to arrive somewhere still wrong). And **cones need no change at all** — the
  owner already approved their axis-aligned footprint (3/8/15/24). So HITBOX-tune's data half is
  **closed with no data changes**, replaced by two rule-level fixes below: **CIRCLE-FIX** (an
  authored `radius` is the *final* footprint radius) and **CONE-B + AIM-METRIC** (Euclidean
  aiming). The reach the damage was tuned for is restored at the rule, not by editing numbers.
- **SUPERSEDED — Partial-tile coverage = centre-in, binary full damage (AIM2, 2026-08-20;
  superseded by the AR hitbox rule above, 2026-08-25).** Kept as the record of what HITBOX1
  replaces. The binary-full-damage half survives; the centre-point test is replaced by the
  hitbox-circle intersection.
- **RULED — Aiming is EUCLIDEAN; movement stays Manhattan (AIM-METRIC; Designer + owner
  directive 2026-08-14, *"movement is measured in steps; aiming is measured in distance"*;
  SUPERSEDES the tile-count clause for `line`/`cone` and the Manhattan clause for
  `circle`/`square` in the prior joint AIM2×MET1 ruling; backlog AIM-METRIC; ENGINE ASK).**
  Both the cone-inflation and circle-inflation bugs share one root cause — **lattice-step
  metering applied to projected geometry.** MET1 made everything Manhattan, which is right for
  *walking* and wrong for *aiming*. The split is principled, not a compromise: movement is a
  lattice walk where the step is the atom (a step-count metric *is* the rule), while aiming
  projects a continuous shape that must describe the same shape whichever way it points (as in
  Atlas Reactor, where rotation preserves area for free). So **all ability geometry is
  Euclidean:**
  - **`line`/`cone` range (axial depth)** — Euclidean tile-widths along the axis (was a
    lattice-step count). A range-r line/cone reaches r tile-widths in **every** direction.
  - **`circle`/`square` aim range** — Euclidean to the aimed square (was Manhattan). The
    aimable region becomes a **disc, not a diamond** — see the balance note below.
  - **`circle` radius** — Euclidean (CIRCLE-FIX below).
  - **dash `impact` radii** — Euclidean (DASH-IMPACT below).
  - **UNCHANGED — `path` dash length, movement, sprint, reachability** — a walked charge *is*
    movement, so it stays Manhattan (diagonal = 2). **MET1 stands for everything that walks.**
  - **Determinism untouched:** every test stays an integer **squared-distance** comparison
    (`dx²+dy² ≤ r²`) in the existing ×2 lattice — no trig, no `Math.sqrt`, no floats; the AIM2
    no-trig guard still passes.
  - **Balance consequence (accepted, flagged):** Euclidean `circle`/`square` aim ranges get
    modestly more generous at long range (range 6: 85→113 aimable tiles; range 8: 145→197),
    symmetric for both teams — it *removes* the arbitrary diamond restriction. Directional
    shapes move the **other** way: a range-8 line stops over-reaching 11.3 tiles on the diagonal
    and reaches 8 in every direction (the nerf that is the whole point). **Vision is deliberately
    NOT in scope** — it is perception, not aiming; changing the sight diamond is a separate owner
    call (flagged, not folded).
  - **This resolves the live MET1-vs-HITBOX1 conflict** the Designer surfaced: MET1 said
    `circle`/`square` measure Manhattan, HITBOX1's circular hitbox made circles Euclidean discs.
    Both were RULED and disagreed. **Euclidean wins** (a circular region composed with circular
    hitboxes is rotation-invariant by construction — the same property CONE-B restores for
    cones; a Manhattan diamond bakes in the axis bias being removed). MET1's circle/square clause
    is **superseded** here, not left in quiet conflict.
- **RULED — CONE-B ramp is `halfWidth(d) = d`, with Euclidean axial range (Designer 2026-08-14,
  measured; backlog CONE-B; ENGINE ASK; DEPENDS ON AIM-METRIC).** A freely-rotated `cone`
  currently covers more tiles off-axis than axis-aligned — and the Designer's measurement showed
  **the inflation is in the LENGTH, not the width**: a range-4 cone reaches 4 tiles on the axis
  but **7 on the diagonal** (24 vs 42 tiles), because axial depth was counted in lattice steps
  and a diagonal step is √2 longer. So two things together fix it, and the width ramp alone is
  **necessary but not sufficient**:
  1. **Euclidean axial range** (from AIM-METRIC) — a cone of range r reaches r tile-widths in
     every direction, killing the √2 length inflation.
  2. **`halfWidth(d) = d`** — a tile is in-cone iff its centre is within axial range **and** its
     perpendicular distance to the axis is ≤ d tiles at axial depth d. This falls straight out
     of the measured per-depth widths (3, 5, 7, 9 = `2d+1`) and reproduces the **owner-approved**
     axis-aligned footprint **3 / 8 / 15 / 24** exactly — **no cone data changes**. No ramp table
     and no division: the test is **`perp² ≤ d²`** in HITBOX1's ×2 lattice.
  - **Determinism (hard):** integer half-plane / cross-product perpendicular distance, squared
    comparison; no trig, no `Math.sqrt` (AIM2 guard holds).
  - **Interaction with HITBOX1:** the wedge defines the continuous cone *region*; HITBOX1's
    tile-centre circle decides which tiles it hits; `expandShape` composes the two (one
    authority — UI2's overlay tracks it for free).
  - **Acceptance — RATIFIED to the measured bound 2026-08-28 (was "±1 count", unattainable).**
    The Builder proved (OQ 2026-08-26 #2 / 2026-08-27 #1) that the cone *area* is now exactly
    rotation-invariant, so what varies is how the lattice samples the half-tile boundary band —
    which grows with the perimeter, so with range; and the axis-aligned case sits at the **bottom**
    of that spread (the lattice lines up with the wedge edges), not its centre. A literal ±1 is
    therefore impossible without moving the owner-approved 3/8/15/24 footprint. **Ratified AC:**
    (a) axis-aligned counts stay **3/8/15/24**; (b) the tile count over all 256 rotations lands in
    **`[axis − 1, axis + range + 1]`** (verified ranges 1–8); (c) — the meaningful check — the
    **reach** projected on the axis is within **±0.5 tile-widths** of the axis-aligned figure in
    every direction (catches the diagonal-length bug the count alone hides). For a **`line`**
    (degenerate zero-width wedge, Euclidean-metered): count in **`[floor(range/√2), range + 1]`**
    (a diagonal beam's tiles are √2 apart, so it covers fewer than an axis beam — reach, not
    count, is the invariant), with **over-reach ≤ 0** (the hard half — over-reach was the bug) and
    **shortfall < 1.5** (lattice slack). The **45° half-width ramp is hard-coded in the engine**
    (OQ #3): it is the value that leaves the axis footprint untouched, not a balance pick; a
    tunable cone angle is a separate **ENGINE ASK** (squared intermediates scale k⁴ — own overflow
    audit), not a data field. No one has asked for a different angle.
- **RULED — An authored `circle` `radius` is the FINAL footprint radius, not the pre-hitbox
  region radius (CIRCLE-FIX; Designer 2026-08-14, measured; backlog CIRCLE-FIX; ENGINE ASK).**
  HITBOX1's half-tile is *added on top of* the authored radius — `radius: 2` is drawn as a disc
  of radius 2 and then granted another half-tile, for a true reach of 2.5 — which is how thirteen
  circles silently grew **48–80%** with no data edit (r1 5→9, r2 13→21, r3 25→37). **Ruling:
  `radius: r` means "this reaches r tiles."** The engine derives the region as **r − 0.5**, so
  composing HITBOX1's half-tile returns exactly r. Implementation: `circleSquares`' test
  `4·(dx²+dy²) ≤ (2r+1)²` becomes **`dx² + dy² ≤ r²`** (simpler than what it replaces, still pure
  integer; scan bound drops from `radius+1` to `radius`). Restores **r1 = 5 and r2 = 13 exactly**
  (12 of the roster's 13 circles); r3 → 29 (Ravok's ultimate, +4 vs the old 25, accepted — still
  8 smaller than today). **HITBOX1's rule and its halfway guarantee are untouched** — only what
  region an authored number *denotes* changes; a tile exactly r away is still included (its
  hitbox is tangent to the region). **No data changes.** The principle both CIRCLE-FIX and CONE-B
  establish: **a number in `data/` means the footprint you get** — the engine derives whatever
  internal region produces it, never the reverse.
- **RULED — Optional `impact` AoE on dash abilities (DASH-IMPACT; Designer 2026-08-14, owner
  ask *"some dashes should also have hitboxes… Rask's dash and Garrison's Jump"*; backlog
  DASH-IMPACT; ENGINE ASK).** Today a dash affects either the **first unit crossed** (walked
  `path` charge, R1a/`chargeHits`) or **units adjacent to the landing** (`square` teleport-strike,
  a hardcoded Manhattan-1 special case with exactly one user). Neither expresses "leap into the
  middle of them and detonate." New optional block on `phase: "dash"` abilities:
  ```json
  "impact": { "origin": 1, "destination": 2 }
  ```
  - Both members optional, integers ≥ 1, **Euclidean radii** (AIM-METRIC) reusing `circleSquares`
    — **no new geometry code**. `destination` = AoE centred on the square the dasher comes to
    rest on (after pass-through/stop for `path`, or the landing for `square`); `origin` = AoE
    centred on the takeoff square.
  - **Composes with both dash models** — a walked `path` charge still hits the first unit crossed
    *and* detonates where it stops; a `square` teleport lands and detonates. **Effects apply to
    the union, each unit affected at most once.** FF1 polarity filters who each effect touches;
    energy is still once per use, ≥1 enemy. **Absent `impact` = today's behaviour exactly**
    (fully backwards compatible).
  - **Validation:** `impact` legal only on `phase: "dash"`; radii integers ≥ 1; reject otherwise
    (same shape as `chargeHits` validation). *(Note: current `validateAbility` lets unknown
    fields pass silently — the suite accepted the three inert `impact` blocks — so this validation
    is new work, not a tightening of an existing check; add it so a typo'd `impact` can't be
    ignored.)*
  - **Architectural win — a special case becomes data.** Shadowstep Strike is the **only**
    `square` dash in the roster carrying `damage` (audited), so it is the sole user of the
    hardcoded MET1-tp Manhattan-1 teleport-strike adjacency. Once it carries
    `impact: { destination: 1 }`, **that branch has no other user and is deleted** — the adjacency
    becomes a tunable number, not engine trivia. **This closes the MET1-tp backlog item** (its
    hardcoded branch is removed rather than kept).
  - **Three abilities carry `impact` in `data/` already** (inert until the engine reads it):
    Wisp Shadowstep `{destination:1}` (zero behaviour change — formalises the adjacency), Aegis
    Intercept `{destination:1}` (the 12-shield now lands on allies at the destination — the
    Bodyguard fantasy), Ravok Bullrush `{destination:2}` with **knockback 2→1** (charge-and-
    detonate; knockback drops because it now applies to an area, within the kit's displacement
    budget). Ravok's knockback nerf is live now; the `impact` is inert — **weaker than designed,
    never stronger** (the `chargeHits`/`free` interim convention).
  - **SHIPPED 2026-08-27 (PR #33):** DASH-IMPACT is now live — the three `impact` blocks resolve
    and the hardcoded teleport-strike branch is deleted. One live behaviour change ratified: a
    dash `impact` is an **area**, so FF1 filters it — **Shadowstep no longer catches an adjacent
    ALLY** (Builder OQ 2026-08-27 #4). That is correct (an impact is harmful AoE; hitting an ally
    was never the intent) and is what makes Intercept's beneficial impact reach allies. Confirmed.
- **RULED — A dash `impact` area MUST be previewed at plan time (owner directive 2026-08-28,
  "Shadowstep Strike needs to show what boxes are being hit, not just the box of arrival";
  backlog DASH-PREVIEW — client; closes Builder OQ 2026-08-27 #3).** DASH-IMPACT shipped without a
  preview: `expandShape` returns the path (or landing square) for a dash, so UI2's overlay shows
  only the arrival tile for an ability whose whole point is "leap in and detonate." **Ruling:**
  the client draws the impact circle(s) — an `impact.destination` disc centred on the **aimed
  landing square** and, if present, an `impact.origin` disc on the takeoff square — as a preview
  overlay while aiming, using the same `circleSquares` geometry the engine resolves with. **Do not
  overload `expandShape`'s `a.area`** (it means "aimed area" at plan time but the engine detonates
  at the *actual* rest square after pass-through/stop — making them the same field would make the
  preview lie for a charge stopped short). So this is a **client-side overlay** reading the
  ability's `impact` radii, not an engine change; it is a *plan-time estimate* (aimed landing) and
  the resolution playback already shows the true detonation. Ships with a client test that a dash
  with `impact:{destination:r}` paints an r-radius disc at the aimed square.
- **RULED — Attacking breaks concealment; Reveal lasts 2 turns (confirms Builder OQ,
  review 2026-08-14).** Using an ability that *actually deals damage* reveals the attacker
  "until the end of the next turn" — implemented as a **2-turn** Reveal
  (`REVEAL_ON_ATTACK_TURNS = 2`): applied during resolution it survives this turn's
  end-of-turn tick and next turn's. A pure knockback/pull or a missed shot does not
  reveal. (Supersedes the earlier "1 turn" parenthetical, which under-counted the tick.)
  **REFINED 2026-08-30 by the owner's vision rules — reveal is a CAMOUFLAGE penalty, and it
  fires on more than a damaging attack (see the two rulings below).**
- **RULED — Reveal-on-attack fires ONLY when the attacker was CONCEALED; hitting an enemy from
  open ground or from positional fog grants NO reveal (REVEAL-FIX; owner Dev Note 2026-09-08, "Why
  are characters being debuffed with 'revealed' when they hit an enemy. This is incorrect … when a
  character attacks from an area where enemies lack line of sight or vision, attack and movement
  remain completely hidden"; backlog REVEAL-FIX — engine).** The shipped engine applies `reveal`
  **unconditionally when a hit lands** (`resolve.ts:1138-1141` Blast, and the dash `hitEnemy`
  branch) — so a unit shooting from the open, or from behind a wall the enemy can't see past, still
  picks up a `reveal` debuff. It is a **no-op** for a positionally-hidden attacker (`canSee` tests
  range/LoS before `reveal`), and pointless for an already-visible one — but with NAMEPLATE-LAYOUT
  it now **shows** as a red debuff, which reads as "I was punished for attacking", and the owner
  has ruled it wrong. **This REVERSES the 2026-08-31 "dealing damage reveals you whether hidden or
  not" correction:** reveal-on-attack now goes through the **same `revealIfConcealed` gate as
  CAMO-REVEAL** — a unit is revealed by attacking **iff it was concealed by brush or Stealth at the
  moment of the attack**. Consequences, all correct: an **open** attacker gains no reveal (already
  visible — no phantom debuff); a **positional-fog** attacker (out of range / behind a wall) gains
  no reveal and **stays completely hidden**, attack and movement both (the owner's rule); a
  **brush/Stealth** attacker is revealed this turn + next (the camouflage tell — CAMO-REVEAL,
  unchanged). Unify: replace the two unconditional `hitEnemy` reveal blocks with
  `revealIfConcealed(board, attacker, attackerPos, abilityId, events)` (breakStealth stays — losing
  Stealth on damage is GAME_SPEC §6, separate from the reveal debuff). **Engine behaviour change →
  ships with tests, and the `attribution.test.ts` case asserting an open unit gains `reveal` on
  attack FLIPS to assert it does not; a brush/Stealth attacker still gains it.** Out of scope: the
  `reveal` status mechanics (unchanged); breakStealth-on-damage (unchanged).
- **RULED — Positional concealment (fog: out of range / behind walls) is NOT broken by
  attacking (owner vision rule 2026-08-30, "Attacking from the Fog of War"; backlog LAST-KNOWN
  — client).** A unit standing **outside the enemy's vision radius or behind cover/walls** may
  fire abilities freely and **its model stays hidden** — the enemy sees the *trajectory* of the
  attack crossing their visible area, not the attacker. The engine already delivers the hidden
  half for free: `canSee` tests **range then line-of-sight BEFORE concealment** (`vision.ts`
  ~:253-255), and `reveal` overrides only brush/Stealth, never range or walls — so applying
  `reveal` to a positionally-hidden attacker is a harmless no-op, and it stays off the enemy's
  board. Two client pieces are owed:
  - **Last-known position (LAST-KNOWN, client).** An enemy the team has lost sight of stays drawn
    as a **ghost at its last-spotted square** until it re-enters team vision (then the ghost moves
    to the new sighting). This is a per-team, per-enemy memory the client keeps across turns; it
    reveals *nothing new* (only where the unit **was** last seen), so it is not a hidden-info
    leak. Was "out of scope (optional AR nicety)" through 2026-08-25; the owner has now asked for
    it, so it is scoped.
  - **Trajectory through fog (client).** The enemy sees the attack's path/area animate across
    their visible tiles even when the attacker's model is hidden — playback already reveals the
    resolved actions; verify the projectile/area reads even when the source tile is fogged.
- **RULED — Camouflage-tile reveal penalty: acting or being hit WHILE CONCEALED reveals you this
  turn and next, and turns the tile red (owner vision rule 2026-08-30, "The Exception: Camouflage
  Tiles"; backlog CAMO-REVEAL — engine + client).** The rule changes entirely for a unit
  concealed by a **camouflage tile (brush) or by Stealth**: if, *while concealed*, it **uses an
  offensive ability, uses a catalyst, or takes damage**, it is **revealed for the rest of this
  turn and all of the next** (the existing 2-turn Reveal) and its Stealth breaks. Deltas from the
  shipped engine:
  - **Expand the reveal triggers.** Today `reveal` is applied only on **dealing damage**
    (`resolve.ts` :912 dash, :1106 blast). Add: **using a catalyst** while concealed, **taking
    damage** while concealed (today taking damage only calls `breakStealth` — :1079 blast, :495
    trap — so a brush-hidden unit with no `stealth` status is *not* revealed next turn, which is
    the bug the owner is describing), and **using a harmful ability that deals no damage** (a pure
    debuff or displacement) while concealed. "Offensive ability" reads as any *harmful* ability,
    not damage alone.
  - **CORRECTED 2026-08-31 — the new triggers are concealed-gated; the EXISTING one is not.**
    An earlier draft of this ruling said reveal-on-action should fire *iff* concealed, so acting
    in the open would arm no reveal. That is a **reversal of shipped behaviour the owner never
    asked for**, and it is wrong twice over: (a) `attribution.test.ts:178` pins a plain
    open-field attacker gaining `reveal`, so it would break a shipped test; (b) it is **not** the
    no-op that draft claimed — `reveal` lasts 2 turns and beats brush, so dropping it would let a
    unit attack in the open on one turn and hide in brush the next with no penalty at all, which
    is the opposite of what a reveal mechanic is for. Ruling: **dealing damage reveals you,
    concealed or not, exactly as it does today — unchanged.** The three *new* triggers above fire
    **only while concealed**. The rule is purely additive.
  - **RULED — "Concealed" here is a property of the TILE, not of any observer.** The gate is
    "standing on a **brush** square **or** carrying `stealth`", full stop. It deliberately does
    **not** use `isConcealedFrom` (`vision.ts:230`), which is per-observer: the brush adjacency
    exception means a unit in brush is concealed from a distant enemy and not from an adjacent
    one, so "am I concealed?" has no observer-free answer and a per-observer gate would reveal you
    to some enemies and not others off one action. The owner's wording is *"while inside a
    camouflage zone"* — a place you are standing, which is exactly the tile test. Use
    `terrainAt(board, unit.pos) === 'brush' || hasStatus(unit, 'stealth')`.
  - **Client: the tile turns red.** The camouflage tile the unit stood on when it revealed itself
    renders **bright red** for the reveal's duration — the visible tell the owner described. Drive
    it off the `reveal` `statusApplied` event + the unit's tile.
  - Engine behavior change → ships with tests: a brush-hidden unit that takes damage is revealed
    next turn; a brush-hidden unit that fires a catalyst is revealed; a brush-hidden unit that
    lands a pure debuff is revealed; an **open** unit that takes damage or fires a catalyst gains
    **no** reveal; an **open** unit that deals damage **still** gains reveal (unchanged);
    movement through brush (no offensive action) does **not** reveal.
- **RULED — Stealth ends on attack/damage; Reveal only masks it (BACKLOG item 6; see
  review 2026-08-12).** `canSee` checks Reveal before Stealth, so an attacker who gains
  Reveal-for-one-turn merely *appears* to leave Stealth. GAME_SPEC §6 says Stealth is
  "broken by attacking or taking damage" — so status application must **remove the
  `stealth` status outright** when a unit attacks or takes damage, not rely on the
  Reveal it grants. Otherwise the unit silently re-hides when Reveal expires. The
  `vision.ts` precedence is correct as written; this rules the behavior of the code that
  applies the statuses.
- **RULED — Delayed abilities.** Resolve at their locked squares in the stated phase
  `delayTurns` later, regardless of whether the caster moved, is stealthed, or died
  in between.
- **RULED — Decoy is a static fake unit that dies to any damage (R2, Designer 2026-08-13;
  closes the OPEN decoy ruling; ENGINE ASK, backlog D1).** Wisp's Veil & Decoy:
  - **Spawn** in Prep at the caster's square, in the same effect resolution as the Stealth
    it accompanies. It never moves or acts.
  - **Lifetime:** expires at the end of `castTurn + 1` (the literal "end of the next turn").
    **Confirmed 2026-08-20 (implemented `expiresOnTurn = draft.turn + 1`):** the decoy must stand
    through the enemy's *next* decision to fool anyone; `castTurn + 1` stands.
  - **RULED — Stealth lasts one turn AFTER the cast, matching the decoy (owner Dev Note Ruling
    2026-08-30: "Veil & Decoy effects, Stealth/Decoy should last one turn AFTER the skill is
    used"; backlog STEALTH-DURATION — data; resolves Builder OQ 2026-08-29 #1).** Veil & Decoy's
    Stealth ships at **`duration: 1`**, which — because durations tick at end of turn (GAME_SPEC
    §6) — covers *only the cast turn* and is gone by the time the enemy next looks, so stealth is
    **unobservable** (STEALTH-CONFIRM proved the render path is correct; the value is the bug).
    Set Wisp's Stealth to **`duration: 2`** so it covers the cast turn **and the following turn**,
    aligning it with the decoy's `castTurn + 1` — now the decoy stands *and* the caster is hidden
    through the enemy's next Decision, which is the whole point of the ability. The owner has ruled
    the value, so it overrides "never rebalance"; it is a one-line change in
    `data/characters/wisp.json` — the ability id is **`veil_decoy`** (corrected 2026-08-31; this
    ruling and the 2026-08-30 review both said `veil_and_decoy`, which does not exist in the
    roster) → the `stealth` effect's `duration: 1 → 2`.
    **This reverses every prior "1-turn Stealth" note above** — the imprecise phrasing is now a
    ruled `duration: 2`.
  - **NOTE (2026-08-31) — the `decoy` effect's own `duration` is dead data.** `spawnDecoy`
    (`resolve.ts:713`) reads only `draft.turn`, setting `expiresOnTurn = castTurn + 1`; the
    `{ kind: 'decoy', duration: 1 }` entry in `wisp.json` is never consulted. The decoy therefore
    *already* satisfies "one turn after the cast" and needs no change — but do not read the `1`
    there as the thing that makes it so, and do not "align" it to 2 expecting a longer decoy.
    Flagged as a validation gap: `VALIDATE-KEYS` rejects *unknown* keys, not known-but-ignored
    ones, so nothing catches a field that silently does nothing.
  - **Destruction:** *any* damage destroys it (no HP pool). An enemy that **ends a voluntary
    reposition on its square — Move *or* Dash — destroys it** (you walked/dashed onto the
    ghost). **Confirmed/widened 2026-08-20:** the shipped code destroys on Move-onto only;
    extend it to a **Dash ending on the decoy's square** too (backlog D1-dash). An
    *involuntary* knockback/pull onto the square does **not** destroy it — mirrors "knockback
    doesn't trigger traps." Emits a visible `decoyDestroyed` event (the mind-game payout).
  - **Not a unit for any other purpose:** it does not block movement/LoS/occupancy, trigger
    traps, take buffs/heals/displacement, count for kills, or block respawns. Damaging it
    grants **no energy** and no on-hit riders — an ability that hits only a decoy grants
    nothing (like hitting nobody).
  - **Rendering (owner directive 2026-08-28, "decoy should show as an enemy for the enemy team
    and a unique purple color for ally team"; backlog DECOY-RENDER — client, NOT shipped):** to
    the **enemy** the decoy renders **as a normal enemy Wisp** (frozen cast-time HP bar,
    indistinguishable from the real unit — the whole point); to **Wisp's own team** it renders in
    a **unique purple** so allies read it as their decoy at a glance. **And it is subject to fog
    like a real enemy:** the enemy sees the decoy only when a teammate has vision of its square
    (it is a `teamId` object — feed it through the same `visibleSquaresForTeam` gate as units).
    The shipped client (`app.ts` ~409) draws **all** decoys as bare positions with no team/fog
    treatment — so a decoy is currently visible to everyone and styled as neither, which reads as
    "stealth is broken" (Dev Note #2): the enemy sees a marker exactly where the "hidden" Wisp is.
    Fixing the render is half of making Wisp's stealth *read* as working.
  - **Engine shape:** a separate `decoys: DecoyState[]` on `GameState`
    (`{id, teamId, pos, expiresOnTurn}`), **not** in `state.units` (so every phase loop /
    vision union / spawn picker / win check stays correct without an "is this real?" guard).
    Damage resolution checks the decoy list after units. Deterministic, N-unit-safe.
  - **RULED — Plan-time PREVIEWS treat a decoy as a real character (owner Dev Note 2026-08-16,
    "Decoy should be a real character for all intents and purposes. Meaning damage, healing, and
    shielding previews should show on it"; backlog PREVIEW-DECOY — client).** A decoy renders to the
    enemy **as Wisp**, so an aimed ability whose area covers the decoy must float the **same
    damage / heal / shield preview number it would over a real unit** — otherwise the *absence* of a
    preview number is a tell that outs the decoy, defeating the whole ability. So PREVIEW-NUMBERS
    (and any per-unit plan-time hint) includes decoys as preview targets, per-viewer and fogged
    exactly like the render: to the enemy the decoy previews as Wisp (a **nominal** amount — red for
    damage, green for heal, blue for shield); to Wisp's own team it previews on the purple decoy.
    **This is a client-side preview FICTION only — the engine mechanics are unchanged:** the decoy
    still takes no heals/shields/buffs, still dies to *any* damage, still grants no energy (above).
    The preview shows what the action *would* do to the character the viewer believes is there; it
    does not make the decoy mechanically real. Ships with a client test: an enemy damage/heal/shield
    ability aimed over a decoy shows the coloured number; a decoy in the viewer's fog shows none
    (same vision gate as PREVIEW-FOG). Out of scope: any engine change to decoy mechanics.
  - **RULED — the decoy snapshot carries the NAMEPLATE + INSPECT fields (Designer screenshot UI
    batch 2026-08-16; backlog UI-NAMEPLATES/UI-INSPECT).** Once nameplates and inspect panels are
    gated on `canSee` (see "Rendering contract"/UI batch), a decoy rendered as Wisp with **no**
    nameplate — or one that refuses inspection, or shows live data — un-disguises itself instantly.
    So the decoy's snapshot includes the fake nameplate fields (name = Wisp, **frozen cast-time
    HP**, an **empty status row** — real statuses would leak Wisp's buffs) and answers inspection
    with Wisp's kit at **cast-time cooldowns**, never live. Same principle as PREVIEW-DECOY and
    PREVIEW-FOG: the UI must never be a better scout than the vision rules allow. Client-only; the
    engine decoy shape (`{id, teamId, pos, expiresOnTurn}`) is unchanged — the snapshot fields are
    derived by the client from the cast, not stored on the engine decoy.
  - **Playtest lever:** if Wisp is oppressive, shorten the lifetime (cast turn only), not the
    destruction rule.

## Teams & control (2v2 default, 4v4 — GAME_SPEC §1)

- **RULED — Kill credit is team-level.** A kill increments the killing unit's team
  tally. Traps and delayed abilities credit their caster's team even if the caster
  has since died.
- **RULED — Friendly fire is ON: harmful effects hit ALL units in-area; beneficial stay
  own-team (owner directive 2026-08-21; REVERSES the 2026-08-15 "no friendly fire" ruling;
  backlog FF1).** *"friendly fire should be possible, allies can hit allies with damage."*
  So in an aimed area:
  - **Harmful effects apply to every unit in the area — ally OR enemy** (no team filter):
    `damage`, `weaken`, `slow`, `root`, `knockback`, `pull`. Stand your ally in your own AoE
    and you hit them. **Riders ride along (owner-confirmed 2026-08-22):** a harmful ability's
    riders land on the ally too — Chain Hook damaging an ally also pulls it. `reveal` on an
    ally is harmless-but-legal.
  - **This applies EVERYWHERE harmful damage is dealt, not just direct Blast (extends FF1
    2026-08-22):** a **delayed detonation** (grenade) hits allies in its area too, and a
    **charge strikes the first UNIT crossed — ally or enemy** (`chargeHits: "all"` = **all
    units** crossed). This **supersedes the "first enemy crossed" wording of R1a/R1b** for
    the friendly-fire era. Shipped code still filters both to enemies (`detonateDelayedBlasts`
    ~:768, `walkCharge` ~:588) — those are FF1 gaps to fix (backlog FF1-charge, FF1-delayed).
  - **Beneficial effects still apply to the caster's own team only** (`heal`, `shield`,
    `might`, `haste`, `energized`, `unstoppable`, `stealth`, `untargetable`) — friendly fire
    means your *attacks* endanger allies; it does **not** mean you heal/buff enemies. **They
    apply to EVERY allied unit in the aimed area, in EVERY phase — including Prep (BUG, backlog
    PREP-AOE).** A beneficial area ability shields/heals/buffs all allies whose square is in
    `a.area`, exactly as the Blast beneficial loop (`resolve.ts` ~:1006) and the dash-impact ally
    loop (~:806) already do. **The Prep path does NOT (owner directive 2026-08-28, "Aegis Barrier
    Pulse is only shielding one ally, should shield all allies in the area of effect"):**
    `firePrep`'s non-trap branch (`resolve.ts` ~:600) calls `applySelfEffects(draft, unit, …)`,
    applying the effect to **the caster alone** and ignoring `a.area`. So Barrier Pulse (a Prep
    `circle radius 1` shield) only ever shields Aegis — not the aimed ally, not the area. Fix:
    `firePrep` must run the same beneficial-allies-in-`a.area` loop the Blast/impact paths use
    (caster included once, no double-application). This is an **engine** bug; ships with a test
    that a Prep beneficial AoE shields two allies standing in its area.
  - **Neutral (self/placement, unfiltered):** `teleport`, `decoy`, `trap`.
  - **Energy is unchanged — granted only on hitting ≥1 ENEMY.** Splashing/charging only allies
    pays nothing (like hitting nobody).
  - **A friendly kill scores NO kill for any team** (implemented: `killUnit` only increments
    when `killer !== victim.owner`) — the ally dies and respawns as a pure tempo loss, no tally
    moves. Prevents farming your own respawning ally for the win.
  - **Traps stay team-safe (owner-confirmed 2026-08-22):** a team's trap does **not** trigger
    for its own units. Friendly fire is directly-aimed/charged attacks, not placed hazards.
  The polarity **table itself is unchanged** (still total over `EFFECT_KINDS`, R7) — what
  changed is that the *harmful* row no longer filters by team. The R7 confirmations (trap
  riders → triggering unit; dash riders → caster at destination) still hold.
- **RULED — `untargetable` skips the WHOLE harmful half of an AIMED ability; traps still bite
  (UNTGT1; Builder finding + ratified 2026-08-29).** STATUS-AUDIT revealed the engine never read
  `untargetable` on any damage path — only `fireCatalyst` checked it — so a Blast aimed at a
  Fade/Shadowstep unit did full damage. GAME_SPEC §6 ("cannot be hit this phase/turn") means the
  rule existed and was simply unimplemented; the Builder fixed it. **Scope (ratified):** a unit
  carrying `untargetable` is **skipped by the entire harmful half of an aimed ability** — direct
  Blast, a dash's crossed targets and `impact` blasts, a delayed detonation, and a catalyst —
  **damage, displacement riders, and debuffs together** (splitting them would be "half
  targetable", not untargetable), and **the attacker earns no energy** from it (nothing was hit).
  **Beneficial effects still reach it** (hiding from attacks is not hiding from your own support).
  **Traps are EXCLUDED — an Untargetable unit that walks onto a mine still takes it:** edge-cases
  already holds placed hazards apart from directly-aimed attacks (team-safe, outside friendly
  fire), so "untargetable" governs *aimed offence*, not hazards you walk into under your own
  power. (If the owner later wants "cannot be hit" to mean "cannot be hurt", the trap path is one
  `if` — flagged, not changed.)
- **RULED — Beneficial abilities pay `energyGain` on use (confirms Builder OQ,
  2026-08-15).** An ability carrying any beneficial effect banks its energy on use, like
  self/utility abilities — support kits build charge by healing/shielding allies, not only
  by hitting enemies. Still once per use.
- **RULED (v1) — Ally pass-through is a planning affordance; resolution halts before a
  *stationary* ally (implemented + confirmed 2026-08-15, item 15).** A path/dash may be
  planned *through* an ally's square (never ending on it); enemies block entry and
  pass-through outright. At resolution the "no two units share a square on any step"
  invariant holds — so a mover slides past an ally only if that ally is *also vacating*
  the square this step; against a stationary ally the mover halts in front of it.
  **Consequence to watch (flag):** the planner accepts paths through a stationary ally
  that resolution will not fully walk, so a drawn path can under-deliver. Acceptable for
  v1 (keeps the resolver invariant); the targeting UI (item 18) should reflect it, and
  true same-turn slide-through of a stationary ally is a deferred enhancement.
- **RULED — Allied contested square.** Two allies moving to the same square resolve
  exactly like enemies: neither enters; each stops on the last square of its own path
  before the contested square. One symmetric rule for every contested square.
- **RULED — Respawn square.** A unit respawns on the first square of its team's spawn
  list (map order) not occupied by a living unit. Map validation must guarantee
  spawns-per-team ≥ characters-per-team for the formats the map supports.
- **RULED — Timer with 2 characters.** The 30-second decision window is per player
  and does not scale with characters controlled. The Time Bank charge is per player
  and extends only that player's own deadline.
- **RULED — Teammate information.** Teammates see each other's planned orders during
  the Decision Phase. Hidden information is team vs. team, never within a team.
- **RULED — Duplicate picks: unique within a team; mirrors across teams legal (R3,
  Designer 2026-08-13; closes the OPEN entry).** A team may not field the same character
  twice (intra-team stacking — double-Lumen loops, double-Thorn minefields — is the
  degenerate stall case). Both teams **may** field the same character (blind-pick mirrors
  are legal). Lives in **M3 lobby validation**, not the engine (which already mints unique
  unit ids and is indifferent).
- **RULED — M3-LOBBY pick model: a seat picks N characters, catalysts are PER-CHARACTER, R3 spans
  the whole team (Builder OQ 2026-09-08 #4; backlog CAT-SELECT + M3-LOBBY).** The AC's "each player's
  character + catalyst triad" is underspecified against the engine, so ruling it:
  - **A seat is not a character.** In a 2-player 2v2 each player controls **two** characters, so a
    seat makes **N picks** (N = its character count). **R3 (unique within a team) is enforced across
    the team's WHOLE complement**, not per seat — two players on one team cannot bring the same
    character between them.
  - **The catalyst triad is per CHARACTER, not per player** (AR: a loadout belongs to a character).
    Each picked character carries its own Prep/Dash/Blast triad. The engine models catalysts
    **per unit** already (`spawnUnit` seeds `DEFAULT_CATALYSTS`), but **`createMatch` takes no
    catalyst argument** — so this is an **ENGINE ASK (CAT-SELECT):** a match-creation path that
    **seeds each unit's `catalysts` from the lobby's per-character picks** (an optional per-unit
    catalyst map on `createMatch`, or a post-create setup that sets `unit.catalysts` before turn 1),
    validated to three-distinct-phases (one Prep/Dash/Blast). Absent picks fall back to
    `DEFAULT_CATALYSTS` (Second Wind / Shift / Adrenaline). **CAT-SELECT is the prerequisite that
    unblocks M3-LOBBY's data model** — build it first so `room.ts` stores the right shape (the
    Builder correctly stopped rather than guess a wrong model into `room.ts`).
- **RULED — DOWN-SEAT-SKIP: a seat with no living controllable units is not waited on — the turn
  resolves as soon as everyone who CAN act has (session-7 OQ #1, 2026-09-22; backlog DOWN-SEAT-SKIP —
  server, small).** DEATH-HANG made a downed networked seat **hold** (correct — no auto-submit), with
  "Hold Position" as a one-click resolve; but the room now waits the **full decision window** on a turn
  the downed player cannot act in, and a player with nothing to do is the one least likely to be
  watching. Ruling: **`#answering()` (and the lock total) excludes a seat that controls no living units
  this turn** — such a seat contributes nothing to the merge (its absent units hold), exactly as a
  disconnected seat already does, so `#allIn` is true once every seat that *can* act has, and the turn
  resolves without waiting out the clock. This is the standing **"no turn ever waits on a player"**
  applied to a downed seat: it can neither delay nor be delayed. The "Hold Position" button stays (a
  seat with *some* units down and some alive still chooses); this only removes the wait for a seat with
  **zero** living controllable units. Server-side (`hub.ts` `#answering`); deterministic; N-safe (reads
  `controlledUnits` ∩ alive). Ships with a test: a match where one seat's only unit is down resolves as
  soon as the other seat locks, and the downed seat's units hold.
- **RULED — HANDOFF: a teammate covers a disconnected player's characters after ONE fully missed
  turn; the stand-in is the first CONNECTED seat on that team in join order; control is DERIVED, so
  reclaiming un-does the loan with no hand-back step (M3-RECONNECT; SHIPPED PR #75; promotes the
  standing lean to a ruling at the Builder's request — Decision 15, 2026-09-15).** When one player on
  a multi-player team disconnects, its characters are not stranded: **after one fully missed turn**
  (`missedTurns ≥ 1`) they become orderable by a teammate. The stand-in is chosen deterministically —
  **the first connected seat on that team in join order** — so every client and the server agree on
  who holds what without anyone being told. **The loan is computed, not moved:** `controlledUnits`
  derives control from each seat's `connected` + `missedTurns` rather than migrating `unitIds` between
  seats, so when the original player **reclaims** (which clears both), the loan simply stops being
  derivable — there is no hand-back step to get wrong, and no window where two seats or zero seats own
  a character. The control map **rides every Decision phase** (not just `matchStarted`), because a
  drop or a return changes it mid-match. **Determinism/N-safety:** join order is stable and the rule
  is per-team, so it holds for any team size (2v2, 4v4); no float, no clock in the decision (it reads
  `missedTurns`, an integer counter). A disconnected seat with **no submission stops counting toward
  the lock total** (the turn does not wait out the full clock for an empty chair); a seat that locked
  in **before** dropping keeps its submission (it already took its turn). **Client gap (backlog
  NET-PRESENCE-UI):** the handoff is server-correct and playable but the client does not yet *say*
  "you are covering for Bo" or mark a disconnected player — a small display item, not a rule.
- **RULED — A started room refuses fresh joins; a freed seat is reserved for RECONNECT (M3;
  Builder OQ 2026-08-16 #4).** Once a match has started, a new socket may **not** take an empty or
  freed seat — a fresh joiner would get a seat with an **empty control map** and still **count
  toward the lock total**, so the turn could never complete (a real, reachable bug: a player leaves
  mid-match, a stranger joins the freed seat). Ruling: the room **rejects a join to a started
  match**; a seat vacated by a disconnect is **held for its original occupant to reclaim via
  M3-RECONNECT** (identity-matched), never handed to an arbitrary new socket. **Spectators are out
  of scope for v1** — recorded as the future option if the owner wants watchers, but a v1 room is
  its players only. A one-line guard in the room's `join` can land now (cheap, closes the bug); the
  full reclaim path is M3-RECONNECT's. This also settles that **the lock total is over
  seated-and-controlling players only** — a socket that never `join`ed, or is refused, counts for
  nothing (M3-ROOM decision 8 already holds "a socket is not a seat").
  - **RULED — RECONNECT-DETACH: a room restored from storage marks every seat DISCONNECTED (Builder OQ
    2026-09-16 #1; SHIPPED PR #77; confirms the Builder's call inside M3-RECONNECT).** A Durable Object
    that was evicted and wakes from its persisted `Room` record would otherwise claim **everyone is
    still present** — sockets do not survive the eviction, but the `connected` flags on disk do — so
    each returning player's own reclaim ticket is refused as `seatTaken`, and the reconnect the
    persistence was *for* is broken by the very restore meant to survive it. Ruling: on restore
    (`detachAll` in the DO's `blockConcurrencyWhile` constructor, before any request is served) **every
    seat is set disconnected**; a live socket re-announces itself and reclaims its seat by identity
    (the normal reconnect path). This is the `connected` invariant made **true again** after a cold
    wake, not a new rule — a restored room genuinely has no live sockets. **HANDOFF composes
    harmlessly:** a woken room that sits empty for a turn accrues `missedTurns` for everyone, but a
    disconnected seat controls nothing and a reclaim clears it, so no character is mis-assigned.
    Deterministic; server-side. Ratified.
  - **RULED — RECLAIM-SCOPE: a reconnect ticket reclaims only a seat this identity HOLDS; a fresh
    client never reclaims a LIVE seat, and the ticket store is per browsing context (SHIPPED PR #86;
    was the 2026-09-19 ready-button report; corrected per Builder OQ 2026-09-20 #1).** The reconnect
    ticket was stored in **`window.localStorage`** keyed by room code (`main.ts:144`) and every connect
    joined **with** it (`main.ts:167`); two **tabs of the same browser share localStorage**, so a
    second tab read the first tab's ticket and tried to reclaim the creator's — still-live — seat.
    **Corrected mechanism (the two-client repro):** the reclaim was **refused** (the seat was
    connected), leaving the second tab **seatless** — and an unjoined client renders **Ready**, not
    Start; the earlier "both tabs believe they are the creator / both show Start" reading was wrong.
    The **cause and the remedy stand:** a reclaim is honoured only for a seat currently
    **HELD/disconnected** for that identity; a ticket naming a still-connected seat is refused and the
    client **joins FRESH** as a new seat; the ticket store is **per browsing context**
    (`sessionStorage` / a non-colliding key) so a second same-browser tab is a **second player**, not
    a refused reclaim. Confirmed by a two-net-client test (the "pure function passes, wiring is broken"
    pattern). The seat-row `is-ready` display fix rode with it (below).
  - **NOTE — the lobby seat-row `is-ready` marker read the wrong list (fixed PR #86).** `seatRows`
    had marked a seat "ready" off `lobby.ready` (seats that finished **PICKING**), not `readied`
    (seats that **readied**). Corrected to read `readied`.
- **RULED — A networked match starts when the room is FULL, with an explicit "start now" escape
  hatch for short rooms (M3; Builder OQ 2026-08-16 #3, decision 8).** Auto-starting on "both teams
  have someone" deals characters before the later players arrive and seats them controlling nothing,
  so the automatic trigger is a **full** room. But a deliberately short room — a 2-player 2v2 where
  each runs two characters — never fills, so `RoomHub.start()` is exposed as an explicit start, and
  a minimal **"start now" protocol message** (backlog M3-START) lets such a room begin over the
  network before M3-LOBBY exists. Until M3-START/M3-LOBBY, the networked game is effectively
  full-room-only; M3-LOBBY's start button calls the same `start()`.
  - **RULED — LOBBY-START: a room WITH a lobby starts on the START BUTTON, not on being full;
    the full-room auto-start retires when the lobby screen lands (Builder OQ 2026-09-11 #2/#10;
    backlog M3-LOBBY-UI; SUPERSEDES the full-room auto-start above for lobby-capable rooms).** The
    "start when FULL" trigger predates there being anything to pick. With picking in the protocol, a
    4-player 2v2 fills on the fourth join **before anyone has chosen a character**, so an auto-start
    would fire straight over the empty lobby — unreachable in exactly the room that most wants it.
    The ruling: once a room presents a lobby, **being full is not a start trigger** — the room starts
    only when a seat presses start (the socket `start`, which calls `RoomHub.start()`), and start is
    gated on `lobbyReady` (every seat's picks complete, per Decision 7's ⌈N/2⌉-seat coverage). The
    Builder's interim guard (hold while a pick is outstanding) is correct but partial; **retire the
    full-room auto-start entirely, together with the lobby screen** — they must land in the same slice
    so a networked match always has a reachable start. Until then the interim guard stays. Short rooms
    are unaffected (they never filled; they already start on the button). This also settles **OQ #4**:
    the temporary `POST /rooms/:code/start` route is deleted **in the same M3-LOBBY-UI slice** that
    adds the button and retires the auto-start — not before, or the networked match is left with no
    reachable start at all.
    - **RULED — LOBBY-READY: seat 0 (the host) starts once every CONNECTED non-host seat has readied;
      a disconnected seat is SKIPPED, not waited on (SHIPPED PR #82; ratifies Builder OQ 2026-09-18
      #6).** The ready handshake gates the host's Start button on the other seats readying, but a
      **held (disconnected) seat cannot ready**, and waiting on one would let a dropped player freeze
      a lobby forever. So `everyoneReady` **skips disconnected seats** — a room may start with a seat
      away, and that seat's characters are then run by the reconnect/HANDOFF rules. This matches the
      standing principle **"no turn ever waits on a player"** applied one layer earlier, to the lobby.
      Ratified. (Readying is revocable until start; a late/returning seat is un-readied.)
- **RULED — BLIND-PICK: lobby picks are hidden across teams — a team sees its own picks in full and
  the enemy only as a count of finished seats (Builder OQ 2026-09-11 #3; golden rule #5; ratifies the
  shipped `LobbyView` split, Decision 9).** The R3 ruling's "blind-pick mirrors are legal" only means
  anything if neither side watches the other choose: a broadcast pick list would make every pick after
  the first a **counter-pick**, and hidden information is team-vs-team (golden rule #5). So picks are
  **stripped from the broadcast `RoomView`** and delivered by a **per-seat `lobby` message** — own
  team in full (teammates coordinate), the enemy as a **bare count of seats that have finished
  picking**, never enemy character ids. This is M3-HIDDEN's own split (own-team per-seat, enemy
  count-only) applied to picks instead of locks — the same rule, one layer earlier. Written down
  because it is a hidden-information rule and was only *implied* before. (If the owner ever wants a
  public draft / counter-pick phase, that is a deliberate design reversal, not a bug — flag it; the
  default is blind.)
- **RULED — SEAT-ZERO: a would-be seat owed zero characters is refused the join (Builder OQ
  2026-09-11 #6; backlog SEAT-ZERO-GUARD — server, small, low).** `deriveSeats` can hand a seat an
  empty character list — reachable only in **1v1**, where a second player on a one-character team gets
  `?? []` and would face a pick screen that asks for nothing. Ruling: **refuse the join that would
  create a zero-character seat** (the room admits at most one player per character on a team); the
  socket is told the team is full. 1v1 is the dev format, so this is the cheap, honest answer;
  spectators (a seat that watches without controlling) remain the future option (see the started-room
  ruling) but are out of scope for v1. Deterministic guard in the room's `join`, beside the
  started-room refusal.
  - **SHIPPED PR #68; `wouldSeatNobody` KEPT as an exported predicate (confirms Builder OQ 2026-09-12
    #4).** With `nextTeam` filling the emptier side and `roomFull` capping at 2×charactersPerTeam, no
    join sequence can lopside a team, so the guard is unreachable *today* — but **keep it.** The next
    lobby feature the owner is likely to want is **letting a player choose a team**, which produces
    exactly the lopsided room the guard refuses; carrying a tested, exported predicate + its property
    test costs nothing and documents the rule. **Flagged as a future item: LOBBY-TEAM-CHOICE** (let a
    seat pick its team; `wouldSeatNobody` becomes live) — not scheduled until the owner asks.
- **RULED — MAP/FORMAT are ROOM-level, chosen at room creation, NOT per-seat (Builder OQ 2026-09-12
  #5; corrects the M3-LOBBY-UI AC "each seat picks map + format").** The seat pick screen picks
  **characters + catalysts** only. Map and format are a property of the **room**: the Worker already
  takes `format` when it mints the code and the DO fixes the map, and letting one seat change the map
  under another mid-pick needs a conflict rule nobody wants to write (who wins? does it reset picks?).
  So the AC's "each seat picks map + format" was wrong — **map/format belong to the room-creation flow
  (the host's choice as the code is minted), not the seat screen.** This is where they already live;
  the missing piece is the **client UI to create a room** with those choices (backlog M3-ROOM-CREATE),
  not a per-seat picker. If the owner later wants a host-only in-lobby map control, that is a small
  addition to the room record with the host as the single writer — flag it; the default is
  set-at-creation. Amends the M3-LOBBY-UI AC (character/catalyst picks are the seat's; map/format are
  the room's).
- **RULED — the Decision payload shares WHO has locked in, but as a COUNT for the enemy team, not
  seat ids (M3-HIDDEN; Builder OQ 2026-08-16 third #4, refined).** A client must know what it is
  waiting for, so a Decision payload names the lock state — but the resolution splits by team:
  **own-team lock state is per-seat** (a teammate's lock tick is exactly what UI-INTENT needs);
  **the enemy team's readiness is a bare locked-count** ("2/2 enemies locked"), **never enemy seat
  ids**. Who is *ready* is not who is *doing what* (no plan leaks either way), but a seat id is the
  one identity that need not appear in a pre-reveal payload, and dropping it to a count costs the
  client nothing (it can still show a waiting state). The Builder shipped per-seat ids for both
  teams and asked; **ruled to count-only for enemies** — change it now, before M3-LOBBY builds a
  waiting UI on the richer shape. Own-team stays per-seat.
- **RULED — the temporary `POST /rooms/:code/start` route is removed at M3-LOBBY or gated at
  M3-DEPLOY (M3-START; Builder OQ 2026-08-16 third #5).** M3-START's start-a-short-room affordance
  is an **unauthenticated** HTTP route — fine for a local dev build, **not** fine deployed (anyone
  with a room code can start that room). It is not access control. **M3-LOBBY deletes the route**
  when its start button lands; if it somehow outlives the lobby, **M3-DEPLOY must gate or remove
  it** before any deploy. Recorded in both items' ACs.
- **RULED — NET-FOG-SINGLE-SOURCE: the networked board renders the server's already-filtered state;
  `fogView` over it is the seat's own vision, and there is NO second `visibleSquares`-driven path
  (Builder OQ 2026-09-13 #2; ratifies the M3-NET-BOARD shipping choice).** The state the server sends
  a seat **is** its team-filtered view — an enemy outside vision is **absent from the data**, not
  present-and-hidden — so `fogView` over that state computes exactly this seat's fog and nothing
  wider, with **no local unfiltered board a bug could widen** (the strongest form of golden rule #5:
  the leak is structurally impossible, not merely gated). The AC's phrasing "show `visibleSquares`"
  described *one* way to reach that; the shipped way (filter the state, derive fog from it) reaches
  the same answer with **one source of truth**. Ruling: **keep the filter-the-state approach; do not
  add a parallel `visibleSquares` render path** (a second source of the same fact is a desync waiting
  to happen). If `visibleSquares` is genuinely unread by the board, **drop it from that payload** as
  dead weight (small cleanup); if a future client genuinely needs the server's own lit-set (e.g. to
  paint fog the server computed under a rule the client cannot), that is when it gets wired — as the
  single source for *that* view, not a duplicate of this one.
- **RULED — NET-WAIT-STATE: after a networked submit the client shows a LOCKED / waiting-for-opponent
  state; the board disarms (Builder OQ 2026-09-13 #3; backlog M3-WAIT-STATE — client).** Today a
  networked client that has submitted sits on the last frame with the HUD **still armed** — nothing
  says the turn is locked or that anyone is being waited for, so the player cannot tell a submitted
  turn from an un-submitted one. Ruling: on submit, the client enters a **locked** state — the order
  HUD **disarms** (no re-aiming a turn already sent) and a **waiting indicator** shows what it is
  waiting for, driven by the Decision payload's lock state (own-team **per-seat**, enemy **count-only**
  — the M3-HIDDEN split already ruled, so no new information crosses). The lock clears when the
  `turnResolved` for the turn arrives and the next turn's collection opens. **This is the client seam
  M3-TIMER (server clock) renders onto** — build the wait state first. Client-only; no protocol
  change (the lock state is already in the Decision payload).
- **RULED — NET-CONN-STATE: a closed socket is SHOWN, not silent (Builder OQ 2026-09-13 #4; backlog
  M3-CONN-STATE — client).** A dropped connection sets `phase: 'closed'` and the board simply stops
  responding — indistinguishable, to the player, from the game having frozen. Ruling: the client
  **surfaces** a closed/disconnected state (a banner or overlay: "disconnected — reconnecting…" or
  "connection lost"), so the stall is legible. This is **only the client saying it happened**; the
  actual rejoin-and-resync is **M3-RECONNECT's** (larger, still blocked). Split them: M3-CONN-STATE
  (small, client — show the state) now; M3-RECONNECT (rejoin by code, reclaim the held seat, re-sync)
  later. Recorded in both items.
  - **SHIPPED PR #73 (M3-WAIT-STATE + M3-CONN-STATE).** `WaitView` carries own-team as a **seat-id
    list** and the enemy as a **number** — M3-HIDDEN's count-only rule held **by the type**, no enemy
    id in scope to leak; a closed socket **outranks** the waiting line (the resolution it waits for is
    never coming); the board **disarms before the submit is sent**, not after the reply (a live aim
    while the packet is in flight is a turn the player thinks they can still change). All ratified.
- **RULED — M3-TIMER's countdown sits BESIDE the wait banner, not over it (Builder OQ 2026-09-14 #3;
  backlog M3-TIMER).** The banner answers *what* the client is waiting for ("waiting for 1 opponent");
  the server clock answers *how long*. These are two facts, not one — overwriting the banner text with
  a number loses the first, which is the one that says the game is still alive. Ruling: the countdown
  renders in the **existing `UI-TIMER` slot beside the banner**; the banner string is left to the
  status it already carries. The server clock has one place to land (`hud.setBanner`'s sibling slot);
  the banner does not become a structure for this. On timeout the ruled behaviour is unchanged —
  **missed submission → hold position** (the seat's orders are whatever it had locked, empty if none).
  - **SHIPPED PR #75; two robustness gaps ruled.** The clock is **injected** (`RoomHub` takes
    `now: () => number`; the DO passes `Date.now`, tests pass a counter — the pure engine is untouched
    and stays clock-free); one deadline per turn for the whole room; the Time Bank charge is per-seat
    but the ten seconds it buys are everybody's, **added** to what is left (banking at 8s → 18s, not
    40); expiry re-checks the clock so the DO alarm is best-effort. **(a) RULED — TIMER-PERSIST: the
    open window and the Time Bank charges must survive DO hibernation (Builder OQ 2026-09-15 #1/#3;
    backlog TIMER-PERSIST — server, small).** `#deadline` and the charge counts are **in memory only**,
    so a Durable Object evicted mid-decision comes back with no window (the turn waits for players, not
    the clock, until the alarm re-arms) and with everyone's charges reset. No regression vs
    pre-M3-TIMER, but a real gap for **deployed** play (eviction happens in production, rarely locally).
    Persist both on the `Room` record and rehydrate in `#arm`. **(b) RULED — no idle-forfeit in v1
    (Builder OQ 2026-09-15 #2).** `missedTurns` deliberately counts **disconnection**, not slowness; a
    *connected* seat that never locks in is timed out to **hold** every turn (M3-TIMER already prevents
    it from hanging the game) and simply plays badly — which in a tactics duel is its own punishment.
    An explicit idle-kick/forfeit for a connected-but-idle player is a **post-v1** griefing-mitigation
    nicety, **flagged, not scheduled**; do not conflate it with the disconnect handoff.
- **RULED — M3-END-SCREEN: a resolved match shows an end screen; it is the next thing a player hits
  (Builder OQ 2026-09-14 #4; backlog M3-END-SCREEN — client).** The networked loop now closes
  (create → pick → play → resolve) but a decided match leaves the player on the final board with
  nothing — no winner, no way out. Ruling: on a terminal match `status` (`won`/`lost`/`draw`, already
  on the resolved state) the client shows an **end-of-match screen** — the outcome for *this* seat and
  a way back (to the create/hot-seat front door; a rematch is a later nicety, not required). Reads the
  engine's own terminal status (`resolveOutcome`), recomputes nothing. Applies to the **hot-seat game
  too** — it has the same missing ending. Out of scope: rematch wiring, stats, spectator end views.
  - **SHIPPED PR #75.** `outcomeFor(state, viewer)` turns the engine's own `status`/`winner` into a
    point of view (a networked seat sees "you won/lost", not "Team 2 wins" — it does not know which
    team it is); the way out is the front door (hot-seat → fresh hot-seat, networked → create screen).
    **M3-REMATCH remains the missing half (Builder OQ 2026-09-15 #6; flagged future).** Re-entering the
    *same* room needs a protocol conversation — both players agreeing to re-arm the room instead of
    dropping it — that nobody has specced. The loop closes without it (the create form is one click
    from a new match), so it is a **nicety, not scheduled**; flag if the owner wants it.
- **RULED — NET-PRESENCE-UI: the client SHOWS which seats are disconnected and who is covering for
  whom (Builder OQ 2026-09-15 #4/#5; backlog NET-PRESENCE-UI — client, small).** Two shipped-but-silent
  facts: a stand-in's board grows the disconnected teammate's characters with nothing saying "you are
  covering for Bo" (#4), and `RoomView.seats` now carries `connected` that no screen draws (#5). Both
  are the same gap — the data is present, the display is not — and the same small client item. Ruling:
  the lobby and the topbar **mark a disconnected seat** (a dimmed/❌ nameplate), and a seat **covering**
  for a teammate is told so (a line in the wait banner, or a mark on the borrowed nameplates), so the
  extra characters are explained rather than mysterious. Read `connected` + the derived control map
  (HANDOFF) the server already sends — recompute nothing. Client-only; no protocol change. Out of
  scope: the handoff *rule* (server, ruled + shipped); reconnect logic (M3-RECONNECT, shipped).
  - **SHIPPED PR #77 (own-team + own-side); enemy PRESENCE-count ALLOWED (Builder OQ 2026-09-16 #6).**
    The lobby/topbar now mark disconnected own-team seats and tell a stand-in it is covering. The enemy
    block still shows only a pick **count** (BLIND-PICK). Ruling: **showing the enemy's presence as a
    count — "1 of 2 present" — is allowed and is NOT a golden-rule-#5 leak.** Presence is not a *pick*:
    it is coarse connection status, the same category as the "N enemies locked" count M3-HIDDEN already
    exposes, and it never reveals a character choice or a plan. It is also genuinely useful — a player
    staring at a stalled turn deserves to know the far side is a player short, not that the game froze.
    So the enemy block **may** carry a present-count beside its pick-count; enemy character ids and
    picks stay hidden. Small client addition (fold into NET-PRESENCE-UI's follow-up); optional, not
    load-bearing. **What stays hidden:** *which* enemy seat is absent by id, and anything about their
    picks — a bare count only, mirroring the lock-count rule.
- **RULED — a `beamWidth` cone MAY also carry `axisBonus`; the two compose and are not forbidden
  (Builder OQ 2026-09-14 #5; ratifies the shipped geometry).** A beam's axis is its centre file, which
  is exactly where `axisBonus` already adds — so a constant-width lane with a hotter centre line is a
  coherent, fully-defined ability. Aegis ships neither combined (no axis bonus on Shield Bash), but the
  composition is **allowed**, not an accident to be validated away: no validator line is owed. If a
  future kit wants a beam with a hot centre, it works today. Recorded so nobody "fixes" the legality.
- **RULED — WAYPOINT-DASH-CLEAR: committing a DASH clears a composed waypoint route and its marks; a
  non-dash ability leaves them (Builder OQ 2026-09-14 #2; backlog WAYPOINT-DASH-CLEAR — client,
  small).** A composed move route correctly **survives** arming/committing a **non-dash** ability — the
  move is still part of the turn. But a **dash IS the movement** and the engine already drops the
  `movePath`/chase when a dash is armed (`planUnit`), so a dash that supersedes the move must also
  **clear the route and its waypoint marks** on screen, or the board draws a path that will not
  execute (a preview/resolution disagreement — the class of bug this file keeps closing). Ruling: on
  committing a dash ability (or a Dash catalyst), clear `movePath` **and** `waypointMarks`; a non-dash
  commit leaves both. Client-only (the order is already correct at resolve); ships with a test that a
  dash after a composed waypoint route leaves no move marks and the resolved order carries no
  `movePath`. Low risk, but the marks are player-facing.
- **RULED — BASIC-MODES: a mode is AIM-TIME GEOMETRY ONLY, and mode 0 must equal the ability's own
  profile (Builder OQ 2026-09-17 #1/#2; SHIPPED PR #79; ratifies the boundary + adds one invariant).**
  An `AbilityProfile` (a `modes[]` entry) may change **shape and range only** — never `effects`,
  `cooldown` or `energyGain` (`abilityProfile` overlays the profile's own keys; the validator enforces
  it). **Confirmed as the boundary:** a mode is the same ability *aimed* differently. A future
  ability that wants to **trade damage for reach** is a different, larger knob (effects vary per mode)
  and gets **its own item** — do not widen `AbilityProfile` to smuggle it in. **New invariant
  (resolves OQ #2) — MODE-BASE-INVARIANT:** the engine treats an absent `mode` as the base profile and
  the client highlights **mode 0**, so the two agree only because `modes[0]` currently equals the
  ability's own shape/range. Make that a **rule, not a coincidence:** `validateAbility` must reject a
  `modes` ability whose **`modes[0]` geometry does not equal the ability's base `shape`+`range`** — so
  "absent mode = base = mode 0" holds by construction. Tiny validator add (backlog MODE-BASE-INVARIANT).
  **Also ratified:** `modes` is reachable only on a normal ability, not a catalyst (OQ #3) — deliberate,
  the ask was one ability; extend later if wanted. The mode toggle's Playwright gap (OQ #4) is the same
  coverage boundary as the presence marks — NET-E2E (flagged) would close both; unit-covered meanwhile.

## Economy & timing

- **RULED — Damage composition order is FINAL (R5, Designer 2026-08-13; retires the flag).**
  A landed hit composes as **outgoing modifiers (Might/Weaken) → cover reduction → shields →
  HP**, each an *independent* `floor`. The candidate orders differ by at most 1 point on the
  biggest hits (Lance of Dawn+Might into cover: 28 shipped vs 27 reversed); the shipped order
  matches Haste/Slow, tells the more intuitive story, and is tested. Flag closed — revisit
  only on a concrete playtest complaint (the known one-line change).
- **RULED — Over-time effects are NOT modified by Might/Weaken in v1 (DOT-HOT; Builder OQ
  2026-09-02 #2, ratified; ar-parity §7.1 flag closed).** `damageOverTime`/`healOverTime` apply
  their **authored amount** at end of turn — they are not outgoing *hits*, so the Might/Weaken
  outgoing-modifier step does not touch them (the shipped behaviour). A burn is the amount it was
  lit at; it does not swell because the applier later gained Might, nor shrink under Weaken. This
  keeps the tick a pure integer payout with no cross-status coupling, and keeps attribution clean
  (a refresh re-authors — a burn someone re-lit is their kill). **Revisit only if a character is
  designed around a boosted burn** — then it is a two-line change in `tickOverTime`, a Designer
  balance call, not reopened pre-emptively. (Cover and shields still apply to `damageOverTime` at
  tick time as to any damage — this ruling is about the *outgoing* Might/Weaken step only; confirm
  the shipped tick composes cover/shield, which the damage path already does.)
- **RULED — Support archetype is unblocked (R6, Designer 2026-08-13).** Its two engine
  prerequisites shipped (no-friendly-fire polarity + beneficial-on-use energy, 2026-08-15),
  and the 1v1-only deferral no longer applies now that 2v2 is default. Lumen and Thorn ship
  as drafted — **no engine work**. Two permanent constraints: every beneficial effect must be
  self-aimable (1v1 stays a supported format), and Supports pay for sustain in lower auto
  damage (16–18 band). Anti-stall is a **playtest** item (Lumen+Thorn vs double-Firepower at
  2v2), tuned via the per-format turn limit, not the kits.
- **RULED — Energized scales earned energy, not the passive drip (FIXED 2026-08-14, item
  E1).** `Energized (+50%)` boosts energy *gained from abilities* (on-hit `energyGain` and
  self/beneficial-on-use), not the flat `+5` passive tick — GAME_SPEC §5 lists the passive
  as separate from "energy gained." `resolve.endOfTurn` now calls `grantEnergy(u,
  PASSIVE_ENERGY, false)` so the drip bypasses Energized; regression test in
  `resolve.test.ts` ("E1: Energized scales on-hit energy but NOT the flat passive drip").
- **RULED — `energyGain` is granted on hit OR for self/utility abilities (confirms
  Builder OQ, review 2026-08-14).** An ability banks its `energyGain` when it hits ≥1
  enemy, OR when it is inherently self/utility — `shape: "self"`, or it carries a
  `teleport`, `trap`, or `decoy` effect. So a dash-dodge, a self-buff, and a trap
  placement all pay out on use, while a *damaging* shot/charge that connects with nobody
  grants nothing. Energy is still once-per-use, never per enemy.
- **RULED — Passive energy accrues to living units only (confirms Builder OQ).** A unit
  at 0 HP retains its energy (and cooldowns keep ticking, per GAME_SPEC §1) but banks no
  passive `+5` while dead — it is off the board until respawn, the same rule that makes it
  neither block movement nor cast sight. Revisit if respawn timing makes it feel punishing.
- **RULED — Blast is free-aim and does not track, but shape propagation stops at walls
  (closes Builder OQ, review 2026-08-13).** An attack lands on whatever *legal target
  squares* it names, regardless of line of sight to them (free-aim into fog) — a wall
  between attacker and an aimed square does **not** cancel the hit in the abstract. BUT
  when shape expansion exists (BACKLOG item 5a), a `line`/`cone` is occluded by walls: it
  stops at the first wall along its path, so it cannot damage a square behind a wall.
  `circle`/`square` (lobbed grenade, placed zone) are not wall-occluded — they detonate at
  the aimed area. Until shape expansion lands, the interim raw-target contract can
  nominally "shoot through" a wall with a single-square aim; acceptable as interim, fixed
  by item 5a.
- **RULED — A cone is occluded by walls, not just clipped at them (LOS-OCCLUSION; owner Dev Note
  2026-09-06, "LoS should block make it so attacks cannot hit you … my conal/straight line attacks
  are going past the gray blocks"; backlog LOS-OCCLUSION — engine, HIGH).** `coneSquares`
  (`shapes.ts` ~:255-270) currently **drops the wall tiles but does not occlude the squares behind
  them** — so a cone reaches straight through a gray block and hits what is behind it, which is the
  bug the owner is seeing. `lineSquares` stops at the first wall **on its axis** (~:208) but its
  HITBOX1 half-tile side-band can still cover a tile behind a wall. **Ruling — a `line`/`cone`
  covered tile is dropped when the caster has no line of sight to it:** filter every line/cone tile
  by **`hasLineOfSight(board, casterCentre, tileCentre)`** (the engine's own LoS kernel — walls
  block, **cover does NOT**, GAME_SPEC §3), so a wall casts a shadow behind it for the whole wedge,
  not only along the axis. This reuses an existing integer/deterministic kernel (no trig, no float —
  the no-trig guard holds) and makes "walls block attacks, cover only reduces" one rule for sight
  and for shapes. **`circle`/`square` stay un-occluded** (a lobbed grenade / placed zone arcs over a
  wall — unchanged). Ships with tests: a cone aimed through a wall covers nothing behind it; a cone
  aimed past a *cover* block still covers behind it (cover is not a sight blocker); a line's
  side-band behind a wall is dropped; `circle` over a wall is unchanged. **Determinism-critical
  engine change — cross-engine signature will move (regenerate).**
- **RULED — Melee attacks ignore cover, keyed by an ability flag not by range (MELEE-COVER; owner
  Dev Note 2026-09-06, "Melee attacks should ignore COVER, but not the full vision"; backlog
  MELEE-COVER — engine + Designer data).** `isBehindCover` already exempts `range ≤ 1`
  (`combat.ts:175`), but under **Manhattan (MET1)** a melee ability that reaches a diagonal
  neighbour is authored at **range 2**, so the range-≤1 heuristic **misfires** and a point-blank
  melee still eats cover — the owner's report. Ruling: melee-ignores-cover keys off an explicit
  **`melee: true` ability flag** (Designer-authored), not a range threshold — the engine skips the
  cover reduction (`computeDamage` with `behindCover = false`) when the ability is `melee`,
  **regardless of its range**. LoS/walls still apply (the owner: "but not the full vision") — a
  melee attack still cannot hit through a wall (LOS-OCCLUSION); it just isn't *reduced* by a cover
  block. The **Designer marks which abilities are `melee`** (data pass — the short-range strikers);
  validation accepts the flag. This supersedes the range-≤1 heuristic (which stays as a harmless
  fallback or is removed — Builder's call). Ships with a test: a `melee` ability into a
  cover-protected target deals full damage; a non-melee one is still reduced; neither hits through a
  wall.
- **RULED — Energy on multi-hit.** `energyGain` is granted once per ability use if it
  hits ≥1 enemy (not per enemy hit) in v1.
- **PROPOSED — Cover uses a corner-*inclusive* line/edge test (flag, review 2026-08-14).**
  `combat.isBehindCover` tests the attack line against the covered edge with
  `segmentsIntersect`, where an endpoint/corner touch **counts** — so a shot grazing the
  corner shared by defender and cover grants cover. Line-of-sight uses the opposite,
  corner-*exclusive* convention (a graze sees through). Both are internally consistent and
  the asymmetry is defender-favorable, but it breaks the "one geometry, one corner
  convention" principle the engine otherwise holds. Ruling: acceptable for v1; if unified
  later, reuse the LoS kernel so cover and sight agree. Low impact (only exact-corner shots).
- **PROPOSED — A Slow/Root landing in Blast affects the same turn's Move (review
  2026-08-14).** Move budget is computed after Blast, so a Slow applied to a victim in
  Blast shortens (and Root cancels) that victim's Move the same turn. This is intended —
  statuses take effect when applied and tick at end of turn — but is called out because the
  Move path was validated at the un-slowed budget and is silently truncated to the slowed
  budget at Move time. Confirm this "debuff-now-bites-now" reading in playtest.
- **RULED — Cooldowns while dead.** Continue ticking. Respawn does not reset energy
  or cooldowns.
- **NOTE (2v2, not v1) — Ally convoy.** A Move path may not be planned onto a
  currently-occupied square (validation uses present occupancy), so same-direction ally
  "convoys" where a follower steps into a leader's vacating square are not expressible.
  Irrelevant at one unit per side; revisit when 2v2 lands (crossing paths that start on
  free squares already resolve correctly via the step-synchronised resolver).
- **RULED — Turn-12 tiebreak order.** Win check runs at end of turn after all phases:
  kills compared first; if tied, sudden death continues with normal turns.
- **OPEN — Simultaneous disconnect/timeout handling** (matters at M3): if a player
  never submits, does their character sprint-hold or full-hold? Current lean: hold
  position, no ability. Decide when building the server.

## Free actions & catalysts (folded in from `free-actions-and-catalysts.md`, 2026-08-13)

Two systems. **ENGINE shipped (FREE1/CAT1, PR #33); the CLIENT half is broken** — see FREE-UI.
Full rationale in the source spec; the RULED text here is authoritative.

> **⚠ FREE-UI (owner directive 2026-08-28; backlog FREE-UI — CLIENT bug, HIGH).** The engine's
> FREE1 budget-independence is correct, but **the client never built a free-action slot** — there
> are zero `freeAbility` references in `packages/client/src`. A `free: true` ability (Overwatch
> Trap, Snare Bloom, Veil & Decoy) shows in the normal hotbar and, when selected, fills
> `draft.abilityId` (the *normal* ability slot); `toUnitOrders` (`targeting.ts` ~:559) emits it
> as `order.ability`, not `order.freeAbility`. Consequences, exactly the owner's report: *"I
> cannot use overwatch trap and attack/sprint after"* (#6) and *"Veil and Decoy … cannot
> sprint/attack after"* (#7) — the free ability eats the one ability slot and disables Sprint
> (`app.ts` ~:581 `sprintDisabled: draft.abilityId !== undefined`). **Fix (client):** a `free:
> true` ability gets **its own draft slot + arm-mode**, exactly as CAT2 built for catalysts
> (`draft.freeAbilityId` beside `abilityId`; a `'free'` interaction mode; its own overlay layer);
> `toUnitOrders` routes it to `order.freeAbility`; selecting it does **not** disable Sprint or the
> normal ability. This also un-confuses Dev Notes #2/#4 ("stealth not working"): Veil & Decoy is a
> free ability, so today it can only be cast *instead of* the rest of Wisp's turn.

### Free actions

- **RULED — A free action does not consume your turn.** An ability marked `free: true` may be
  used **in addition to** a normal ability, and **never reduces the move budget or blocks
  Sprint**. Legal turn shapes: free action + normal ability + 4-move ✅; free action + Sprint 8
  ✅; free action + dash ability ✅; free action alone + 4-move ✅; **two free actions in one
  turn ❌** (§ one-per-turn). "Free" is about what it costs to *declare*, not how it resolves —
  a free action resolves in its own phase like any ability. **The ENGINE enforces this
  correctly; the CLIENT does not expose it — see FREE-UI above.**
- **RULED — Which abilities may be `free: true` — a rule, not a list.** For a character's own
  abilities: (1) **Prep phase only** (repeatable free Dash/Blast actions are the catalysts' job —
  once-per-match, self-limiting); (2) **no immediate `damage`/`heal`/`shield`**; (3) **payoff
  is deferred or conditional** (does not decide *this* turn's exchange). Applied to the roster,
  exactly three qualify — the three setup kits: **Vex Overwatch Trap**, **Thorn Snare Bloom**,
  **Wisp Veil & Decoy**. The mechanic exists to make setup plays viable without losing tempo.
  **RATIFIED 2026-08-28 (Builder OQ 2026-08-26 #5): the validation is "Prep UNLESS
  `oncePerMatch`."** Catalysts are all `free: true` and three are Dash/Blast, which conflicted
  with "Prep only". The restriction exists because a *repeatable* free attack is too strong, and
  `oncePerMatch` (catalysts) is exactly the property that removes that — so a non-Prep `free`
  ability is legal **iff** it is `oncePerMatch`. **`energyGain: 0` stays unconditional** for every
  `free: true` ability. (This does not license a *character* free Dash/Blast — no roster ability
  is `oncePerMatch`; it is the catalyst carve-out, stated as one rule.)
- **RULED — A free action grants no energy and pays for itself in cooldown.** `free: true`
  **requires `energyGain: 0` as a VALIDATION ERROR** (not a runtime special-case) — otherwise a
  free action is strictly better in every dimension. Each converted ability also takes a
  cooldown tax: Vex Overwatch Trap 3→**4**, Thorn Snare Bloom 2→**3**, Wisp Veil & Decoy 4→**5**
  (all `energyGain`→0). The cooldown is the honest tax; the energy loss protects the ult clock.
  *(These three edits are already in `data/characters/{vex,thorn,wisp}.json`; until FREE1 lands
  the abilities read as ordinary Prep abilities on a longer cooldown with no energy — weaker
  than designed, never stronger. Safe direction to fail.)*
- **RULED (v1, conservative) — At most one free action per turn per character**, counting free
  abilities **and** catalysts together (a Vex places her trap *or* fires a catalyst, not both).
  Keeps a turn readable (≤3 declared things: one free action, one ability, one move) and stops a
  single turn dumping a whole kit. **First lever to relax** if playtests find setup kits
  catalyst-starved — "one free ability + one catalyst" is a one-line change to the same check.
- **ENGINE ASK (FREE1).** (1) `free?: boolean` on `AbilityDef` (absent/false = today). (2)
  `freeAbility?: AbilityOrder` on `UnitOrders`, parallel to `ability` — the referenced ability
  must have `free: true`, be off cooldown, belong to the unit; at most one of
  `freeAbility`/`catalyst` per unit per turn. (3) **Budget independence — the single likeliest
  bug:** `movementBudget` must be computed from `ability`/`sprint` **only**; a `freeAbility`
  never reduces it and never invalidates Sprint (the current rule is "any ability ⇒ 4"). (4)
  Validation: `free: true` requires `phase === 'prep'` **and** `energyGain === 0`; reject
  otherwise so no future kit can quietly grant a free Blast.

### Catalysts

- **PROPOSED / ENGINE ASK → DESIGNER — Dash catalysts should NOT be free actions (owner directive
  2026-08-28, "Dash catalysts should not be free actions"; backlog CAT-DASH-COST, blocked on
  Designer).** Every catalyst currently resolves as a free, additive action; the owner has singled
  out the **Dash** colour (Shift, Fade, Unshackle) as too much when fully free — most pointedly
  **Shift**, a free ≤3 teleport that does **not** consume Move (a unit Shifts 3 *and* walks 4 the
  same turn). The owner's intent is that a Dash catalyst should **cost the unit's Dash economy** —
  i.e. it occupies the Dash phase like a dash ability, so it is *additive with a normal ability
  and a Move but NOT with a dash ability*, and (the likely reading) a free-dash catalyst
  **consumes that turn's Move** rather than stacking on top of it. This **reverses the CAT1 "Shift
  does not consume Move" ruling** for the Dash colour. **Analyzer recommendation to the Designer:**
  make Dash catalysts non-free (they compete with dash abilities and spend the Move for a
  reposition), leaving Prep/Blast catalysts free/additive; confirm whether Fade/Unshackle (no
  reposition) also lose additivity or only Shift does. This is a balance/economy call the Designer
  owns — the Analyzer routes it and the Builder holds until it is ruled. Until then the shipped
  fully-free behaviour stands (weaker constraint, never a broken state).
- **RULED — Three catalyst slots, one per phase, each once per match.** Every character carries
  exactly three catalysts — one **Prep (Green)**, one **Dash (Yellow)**, one **Blast (Red)**.
  Each is **consumed on use and gone for the rest of the match** (not a cooldown), is a **free
  action** (grants no energy), and every catalyst uses effect kinds the engine already
  implements — **no new `EFFECT_KIND`**. Death does not refund a spent catalyst; unused
  catalysts survive death/respawn.
- **RULED — Catalysts are chosen, not fixed to a character.** All nine are available to every
  character (the customization layer). Selection belongs to the **M3 lobby** (item 21); until it
  exists, `createMatch` assigns the **default triad: Second Wind / Shift / Adrenaline**.
- **The nine** (`data/catalysts.json`, all from existing effect kinds): **Prep** — Second Wind
  (heal 30 self) · Ablative Field (shield 35, 1 turn) · Brainwave (Energized 3). **Dash** —
  Shift (teleport ≤3, `square` shape, ignores walls) · Fade (Untargetable 1) · Unshackle
  (Unstoppable 2). **Blast** — Adrenaline (Might 2) · Suppression (Weaken 2 to enemies within 2,
  `circle` self r2) · Overdrive (Might 1 + Haste 1).
- **RULED — Catalysts resolve at the START of their phase, before that phase's abilities.**
  Uniform across all three colours. This is what makes **Adrenaline and Overdrive do what they
  say** — a Blast-phase Might must land before the Blast damage step, or the catalyst boosts
  nothing until next turn and is simply broken. Ablative Field's shield is likewise up before any
  Prep-phase trap damage; a Shift resolves before a dash ability the same unit declared.
- **RETIRED 2026-08-29 — was "A free dash catalyst (Shift) does NOT consume your Move."** This
  ruling is **reversed and shipped** (CAT-DASH-COST, PR #37) on the owner's directive *"Dash
  Catalysts should not be a free action"* + the DO-NOT-HOLD dev overrule. **New rule below.**
- **RULED — A Dash-colour catalyst SPENDS the unit's Move, uniformly per colour (CAT-DASH-COST,
  owner directive; shipped PR #37).** A Dash catalyst (Shift, Fade, Unshackle) costs the unit's
  Move exactly as a dash *ability* does: `planUnit` drops the walk and cancels Sprint for any unit
  that spends one. **Shift 3 in Dash OR walk 4 in Move, never both.** **Prep and Blast catalysts
  are untouched — still fully additive/free** (they never touched movement, so repricing them
  would invent a cost the directive did not ask for); **free *abilities* are untouched** (FREE1's
  budget independence stands — a regression test pins the change did not leak out of the Dash
  colour). The client must make the cost visible *before* it is paid (CAT-DASH-COST client):
  arming a Dash catalyst clears the drawn move, disables Sprint, and the HUD move budget reads 0;
  choosing to move/sprint hands the catalyst slot back rather than silently voiding it.
  - **RATIFIED — uniform per colour (Builder OQ 2026-08-28 #3): all three Dash catalysts pay,
    including Fade and Unshackle, which reposition nobody.** The directive names the *colour*, and
    "yellow costs your Move" is one rule a player can hold in their head vs. "yellow costs your
    Move unless it doesn't move you." My earlier PROPOSED version was narrower (only the
    repositioning catalyst); the shipped uniform reading is accepted as the v1 default.
  - **SUPERSEDED 2026-09-01 — a Dash catalyst is now your FULL action (owner directive, "Dash
    Catalyst should count as your full action"; backlog CAT-DASH-FULL — engine + client).** The
    "spends your Move" cost above is **not enough** — the owner has ruled a Dash catalyst consumes
    the unit's **whole active turn**: it costs the **normal ability slot AND the Move** (and
    Sprint), exactly as if it *were* the unit's ability-and-movement for the turn. So a turn that
    arms a Dash catalyst may **not** also declare a normal ability, a dash, a Move, or a Sprint.
    (Prep/Blast catalysts are unchanged — still free/additive. **CORRECTED 2026-09-02 (Builder OQ
    #1):** a **free ability** is NOT allowed alongside a Dash catalyst — my original parenthetical
    was self-contradictory. The **one-free-action rule** (conservative v1) already makes a catalyst
    and a free ability **mutually exclusive**, and the catalyst yields, so a Dash-catalyst turn
    carries no free ability either. That predates CAT-DASH-FULL and is the correct shipped
    behaviour; making the Dash catalyst the one exception that rides beside a free action would be a
    change to the *one-free-action* ruling and needs an explicit owner call — not assumed here.)
    Rationale: a free
    ≤3 teleport (Shift) or a 2-turn Untargetable (Fade) that only cost a Move was still the
    strongest thing a turn could do; making it the whole action prices it like the once-per-match
    power it is. **Engine:** a unit with a `catalyst` order whose catalyst is Dash-phase drops its
    `ability`, `movePath` and `sprint` (mirror how a dash ability already drops the Move, extended
    to also drop the ability). **Client:** arming a Dash catalyst disables the ability hotbar, Move
    and Sprint (not just Move); choosing any of them hands the catalyst slot back. Ships with a
    test that a Dash-catalyst turn carries no ability/move/sprint, and that Prep/Blast catalysts
    still stack with an ability + move. This **reverses the "Fade at full-Move cost may be
    unplayable" flag** — the owner has decided the cost deliberately, so that flag is closed.
- **ENGINE ASK (CAT1).** (1) Catalyst defs: `data/catalysts.json` is `{prep,dash,blast}`, each
  entry an `AbilityDef` with `cooldown:0, energyGain:0, free:true, oncePerMatch:true` (reuse
  `validateAbility`). (2) `UnitState` gains `catalysts: string[]` (length 3, one per phase) and
  `catalystsUsed: string[]` — **arrays, not Sets** (`structuredClone`/determinism hash assume
  plain JSON). (3) `UnitOrders` gains `catalyst?: AbilityOrder` — id must be one of the unit's
  three, not already spent, ≤1 of `catalyst`/`freeAbility` per unit per turn. (4) Resolution:
  in each phase resolve catalysts first, then abilities; mark spent **when it resolves**, not
  when ordered (a unit killed in Prep does not spend its Blast catalyst). (5) A `catalystUsed`
  event (unit, catalystId) for playback + the HUD's spent-slot greying. (6) Selection is M3 —
  fold the per-player picks into item 21.
- **NOTE — Brainwave is Energized 3, not a flat energy grant.** We have no `energy` effect
  kind; Energized 3 ≈ +12–15 energy over its life at zero engine cost. A flat `energy` kind is
  an optional future ENGINE ASK only if playtests want the punchier version.

## Rendering contract (the event log)

The `TurnEvent[]` log is the sole rendering input (ARCHITECTURE): the client folds stated
deltas and never recomputes game logic. So the log must carry every fact the HUD shows.

- **RULED — Complete the event schema for shields and energy spend (closes Builder OQ,
  review 2026-08-16; backlog item S1).** Playback reproduces the board (position, HP,
  alive, kills) but cannot reconstruct **shield pools** or **post-ultimate energy** from
  the log, because (a) `statusApplied` carries no shield `amount`, and (b) spending/zeroing
  energy (the ult reset) emits no event. Ruling — extend the schema, do not recompute in
  the client:
  - Add an optional **`amount`** to `statusApplied`, populated with the shield pool when
    `status === 'shield'` (undefined otherwise). Combined with the existing `damage`
    event's `absorbed`, the client can then track a shield pool exactly.
  - Add a **`{ type: 'energySpent'; unitId; amount }`** event, emitted whenever an ability
    removes energy (the ultimate's reset-to-0 emits it with the spent amount). Symmetric
    with `energyGained`; playback does `energy -= amount`.
  - This is an engine behavior change → ships with tests (golden rule #3): assert the ult
    emits `energySpent`, and that a shielded unit's `statusApplied` carries the pool. The
    playback client (item 19) then consumes both to show shields/energy. Keep events
    delta-based (consistent with `energyGained`) so replay stays order-robust.
- **RULED — Playback shows a shield's full pool *during* its turn; no expiry event needed
  (closes Builder OQ, 2026-08-17).** Playback folds deltas and does not tick status
  durations, so a duration-1 shield displays its full pool while that turn animates; the
  next turn's `initView` reflects the ticked-off pool. That is correct for an *animation*
  of the turn (the shield was up during it). No `statusExpired`/tick event is needed for
  v1 — the board-authoritative state at each turn boundary already comes from the engine.
  Revisit only if a HUD needs end-of-turn post-tick pools mid-animation.
