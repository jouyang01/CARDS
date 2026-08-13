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
- **RULED — Distance metric is MANHATTAN for movement and ability range (MET1, owner
  directive 2026-08-20; backlog MET1).** Mimics Atlas Reactor: all range and movement are
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
    an open, unoccupied destination or it fizzles. Triggers a trap only on the destination.
    A teleport-strike (Shadowstep) hits every enemy Chebyshev-adjacent to the landing.
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
- **RULED — Partial-tile coverage = centre-in, binary full damage (AIM2, owner default
  2026-08-20).** A tile is covered iff its **centre** falls inside the rotated shape;
  coverage is **binary** — a covered tile takes **full** damage (no partial/fractional
  damage). "Hit half a tile" is a visual/coverage nuance, not a damage split.
- **RULED — Range definition for rotated shapes under Manhattan (joint AIM2 × MET1, per the
  owner's "rule them together" flag).** To keep a rotated shape's reach consistent under the
  Manhattan metric: **directional shapes (`line`, `cone`) measure range as a TILE COUNT along
  the shape's axis** (a range-8 line reaches 8 tiles along its quantized direction,
  rotation-invariant; a cone of range r extends r tiles deep) — *not* a Manhattan/Chebyshev
  envelope. **Target-square shapes (`circle`, `square`) use MANHATTAN** distance to the aimed
  square (MET1). This is the single consistent definition the owner asked be ruled before
  AIM2 builds; adjust only with a new owner decision.
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
  - **Rendering:** shown to the **enemy** as Wisp (frozen cast-time HP bar); to Wisp's team
    as a decoy.
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
    and you hit them. *(Default reading: the harmful **riders** ride along with the damage —
    Chain Hook damaging an ally also pulls it. **Flag:** narrow to damage-only if the owner
    prefers.)* `reveal` on an ally is harmless-but-legal (it does nothing useful to a unit
    your team already sees).
  - **Beneficial effects still apply to the caster's own team only** (`heal`, `shield`,
    `might`, `haste`, `energized`, `unstoppable`, `stealth`, `untargetable`) — friendly fire
    means your *attacks* endanger allies; it does **not** mean you heal/buff enemies. *(Flag:
    make beneficial symmetric-to-all only on a new owner decision.)*
  - **Neutral (self/placement, unfiltered):** `teleport`, `decoy`, `trap`.
  - **Energy is unchanged — granted only on hitting ≥1 ENEMY.** Splashing an ally pays
    nothing; an ability that hits only allies grants no energy (like hitting nobody).
  - **A friendly kill scores NO kill for any team** — the ally dies and respawns normally
    (a pure tempo loss), but neither team's kill tally moves. This avoids the exploit of
    farming your own respawning ally for wins. Needs a "no-credit" path in `killUnit`.
  - **Traps stay team-safe by default** (a team's trap does not trigger for its own units) —
    friendly fire is about directly-aimed attacks, not placed hazards; a self-team minefield
    wiping your own team is a bigger swing than intended. **Flag:** extend friendly fire to
    traps only on a new owner decision.
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
