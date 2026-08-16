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

> **⚠ NOT YET FOLDED IN — the screenshot UI batch, 2026-08-14 (Designer, owner reference).**
> Everything else from the AR parity audit (`docs/design/ar-parity-v1.md`) has since been
> **built** — DOT-HOT, CHASE1, PADS1, TIMER-40, UI-VIEWPORT, SCORE1, the MAP-CAPS guard, and
> Regenergy completing the 4/4/4 catalyst pool — so this pointer now covers only what remains:
> **six client items specced from the owner's AR in-match screenshot** (ar-parity §4.1–4.6),
> none of which exist in the client yet (verified: no nameplate/inspect/intent module ships):
> 1. **`UI-NAMEPLATES`** — name above the model, **HP numeral inside the bar**, shield segment,
>    energy bar + **"ULT" tag at 100**, all gated on `canSee`; **decoys carry a full fake
>    nameplate from the cast snapshot** (a Wisp model with no nameplate is un-disguised on
>    sight) — that snapshot rule needs one line here when folded in.
> 2. **`STATUS-ICONS`** — replace the colour pips with AR's icon vocabulary: **Might = sword,
>    Reveal = eye** (owner directives), full table in §4.2; Shield's icon carries the remaining
>    amount; **Stealth's mask renders to the owning team only**. `PIP_ORDER` (debuffs first,
>    fixed slots) survives as the ordering.
> 3. **`UI-INSPECT`** — hover any **visible** unit: five ability slots with live cooldowns,
>    catalysts spent/remaining, statuses with durations. Own team always; enemies only under
>    `canSee`; **a decoy answers with Wisp's frozen cast-time kit** — live data or a refusal
>    would each un-disguise it.
> 4. **`UI-TOPBAR`** — friendly portraits · kills vs target · **turn X of Y** · enemy score ·
>    enemy portraits, per the screenshot layout (SCORE1's data, AR's arrangement).
> 5. **`UI-TIMER`** — tenths + colour shift under 10 s, Time Bank pips, and a visible animation
>    when the bank's +10 s fires.
> 6. **`UI-INTENT`** — teammates' queued ability slot + lock state above allied units during
>    Decision. The "Teammate information" ruling has been in force since the Teams batch and
>    has never had a UI; at 2v2 default, a duo that cannot see each other's plan is two solos.
>
> Damage-preview numbers already ship fog-gated (nothing to do); pad rendering shipped with
> PADS-INDICATOR. Still open, nothing depends on it: whether AR had an incoming-damage
> modifier (ar-parity §1.3).

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
- **PROPOSED — AR "Clashes" are more permissive than our resolver (refinement, lower
  priority).** AR: two units *both passing through* the same square (neither ending there)
  **both continue**; if one *ends* on it and another passes through, the ender stays and
  the other continues; only *both ending* on it forces both back. Our `stepMovers` is
  stricter — any same-step co-target stops all of them. This is a deterministic v1
  simplification; align with AR's pass-through-co-occupancy only if playtests want it
  (backlog item CL1). The 2-cycle no-edge-swap rule still stands regardless.
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
- **RULED — Traps.** Trigger when a unit *enters* the square, in any phase (dash or
  move). Damage applies immediately; if it kills, remaining path/actions are discarded.
  A unit that *starts* on a freshly placed trap square does not trigger it until it
  re-enters.
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
- **RULED — Knockback/pull do NOT trigger traps in v1 (closes Builder OQ, review
  2026-08-14).** Trap triggers list dash and move (entry under a unit's own power); a unit
  *shoved* onto a trap by knockback or pull does not trigger it. Keeps end-of-Blast
  displacement simple and deterministic. This is the first lever to pull if
  "shove-into-trap" combos are wanted later — a deliberate v1 simplification, not an
  oversight.
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
- **OPEN — Partial-team disconnect (matters at M3).** If one player on a multi-player
  team disconnects, does a teammate gain control of the abandoned characters? Current
  lean: yes, after one fully missed turn. Decide when building the server.
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
- **RULED — A networked match starts when the room is FULL, with an explicit "start now" escape
  hatch for short rooms (M3; Builder OQ 2026-08-16 #3, decision 8).** Auto-starting on "both teams
  have someone" deals characters before the later players arrive and seats them controlling nothing,
  so the automatic trigger is a **full** room. But a deliberately short room — a 2-player 2v2 where
  each runs two characters — never fills, so `RoomHub.start()` is exposed as an explicit start, and
  a minimal **"start now" protocol message** (backlog M3-START) lets such a room begin over the
  network before M3-LOBBY exists. Until M3-START/M3-LOBBY, the networked game is effectively
  full-room-only; M3-LOBBY's start button calls the same `start()`.

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
