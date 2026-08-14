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
    **Confirmed 2026-08-20 (implemented `expiresOnTurn = draft.turn + 1`):** this outlives
    the accompanying 1-turn Stealth by a turn, and that is correct — the decoy must stand
    through the enemy's *next* decision to fool anyone; the "matching the 1-turn Stealth"
    phrasing was imprecise, `castTurn + 1` stands. Cast-turn-only remains the playtest lever.
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

## Economy & timing

- **RULED — Damage composition order is FINAL (R5, Designer 2026-08-13; retires the flag).**
  A landed hit composes as **outgoing modifiers (Might/Weaken) → cover reduction → shields →
  HP**, each an *independent* `floor`. The candidate orders differ by at most 1 point on the
  biggest hits (Lance of Dawn+Might into cover: 28 shipped vs 27 reversed); the shipped order
  matches Haste/Slow, tells the more intuitive story, and is tested. Flag closed — revisit
  only on a concrete playtest complaint (the known one-line change).
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
- **RULED — A free dash catalyst (Shift) does NOT consume your Move.** Genuinely additive: a
  unit may Shift 3 in Dash **and** walk its normal 4 in Move (or dash *and* Shift). A real burst
  of mobility, affordable because it is once per match. Precedent: Overdrive's Haste already
  boosts the same turn's Move (the "debuff-now-bites-now" reading of Blast-applied statuses).
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
