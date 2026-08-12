# edge-cases.md — rulings for simultaneous-turn edge cases

Part of the spec. Status: **RULED** (implement as stated) or **PROPOSED** (implement
as stated, but flag in playtests) or **OPEN** (needs a ruling before implementing).
The Analyzer grows this file every review; the Builder must not invent unlisted rulings.

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
- **RULED — Pass-through.** Units never pass through the enemy unit, walls, or cover —
  including the edge-swap case above. With 2 units this only matters for path planning;
  keep the rule general for N units (allies: also no pass-through in v1 — revisit at
  2v2).
- **RULED — Contested square (both Move to the same square).** Neither enters it.
  Each unit stops on the last square of its own path before the contested square.
  Deterministic and symmetric; no priority coin-flip.
- **RULED — Pass-through.** Units never pass through enemy units, walls, or cover.
  Allies are ruled separately — see "Ally pass-through" under Teams & control below,
  which supersedes the earlier "allies also block" lean now that 2v2 is the default.
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
- **RULED — Walked dash vs teleport (implemented 2026-08-14, items 7).** Two dash
  models, distinguished by `shape`:
  - **Walked charge** (`shape: "path"`, e.g. Bastion Ram Charge): traverses each path
    square in order during Dash; **stops on the square in front of the first unit it
    reaches** (does not enter it). If that unit is an enemy and the ability deals damage,
    it is the one struck. Triggers every trap it *enters* en route. Damage lands in Dash.
  - **Teleport** (`shape: "square"`, e.g. Wisp Blink, Shadowstep): ignores intervening
    squares and walls, appears at the destination; requires an open, unoccupied
    destination or it fizzles harmlessly. Triggers a trap only on the destination. A
    teleport-strike (Shadowstep) hits every enemy Chebyshev-adjacent to the landing.
  Rationale: GAME_SPEC §2 "dashes trigger traps they cross" is about walked charges; a
  teleport crosses nothing. Flag in playtest if teleports dodging trap lines feel oppressive.
- **RULED — Knockback/pull do NOT trigger traps in v1 (closes Builder OQ, review
  2026-08-14).** Trap triggers list dash and move (entry under a unit's own power); a unit
  *shoved* onto a trap by knockback or pull does not trigger it. Keeps end-of-Blast
  displacement simple and deterministic. This is the first lever to pull if
  "shove-into-trap" combos are wanted later — a deliberate v1 simplification, not an
  oversight.

## Targeting & vision

- **RULED — Free-aim into fog.** Players may aim any ability at any legal square,
  seen or unseen. Hitting a stealthed/hidden unit works normally — stealth hides
  position, it is not a dodge.
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
- **RULED (v1 interim) — Decoy is a no-op beyond its Stealth (closes Builder OQ, review
  2026-08-14).** Wisp's Veil & Decoy applies Stealth; the `decoy` effect is currently a
  no-op (no decoy entity spawned). This ships Wisp on Stealth alone without blocking the
  engine. The **full decoy entity** (a fake unit rendered only to the opponent, that
  absorbs a hit and expires) is a separate backlog item pending a Designer spec — the
  roster-v1 design branch is the place that spec should land. Until then the engine models
  no decoy, and content may carry the `decoy` effect harmlessly.

## Teams & control (2v2 default, 4v4 — GAME_SPEC §1)

- **RULED — Kill credit is team-level.** A kill increments the killing unit's team
  tally. Traps and delayed abilities credit their caster's team even if the caster
  has since died.
- **PROPOSED — No friendly fire.** Harmful effects (damage, negative statuses,
  knockback/pull) never affect the casting unit's own team, even inside the aimed
  area, and a team's traps do not trigger for that team's units. Beneficial effects
  (heal, shield, positive statuses) apply to allies in the area and never to enemies.
  Free-aim is unchanged — the area is the area; team allegiance only filters which
  effects apply to whom. (Atlas Reactor's model.)
- **PROPOSED — Ally pass-through.** Units may move and dash *through* allies but may
  not end movement on an occupied square. Enemies still block both entry and
  pass-through.
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
- **OPEN — Duplicate picks.** May a team (or both teams) field the same character
  twice? Designer to rule before the lobby is built at M3.
- **OPEN — Partial-team disconnect (matters at M3).** If one player on a multi-player
  team disconnects, does a teammate gain control of the abandoned characters? Current
  lean: yes, after one fully missed turn. Decide when building the server.

## Economy & timing

- **RULED — Damage composition order (confirms Builder OQ, review 2026-08-13).** A landed
  hit composes as **outgoing modifiers (Might/Weaken) → cover reduction → shields → HP**,
  each an *independent* `floor`. Two floors, outgoing-before-defensive; this is the
  engine convention and matches how Haste/Slow already round. It is a balance-affecting
  convention, not just a correctness one — if playtest balance wants cover applied to raw
  base before Might, that is a one-line change (Designer's call), but the default stands.
- **RULED — Energized scales earned energy, not the passive drip (reaffirmed
  2026-08-14 — current impl deviates, fix = backlog item E1).** `Energized (+50%)` boosts
  energy *gained from abilities* (on-hit `energyGain` and self-buff-on-use), not the flat
  `+5` passive tick — GAME_SPEC §5 lists the passive as a separate mechanic from "energy
  gained." **The 2026-08-14 engine (`combat.grantEnergy`, applied to `PASSIVE_ENERGY` in
  `resolve.endOfTurn`) currently DOES scale the passive by Energized (5 → 7)** — this
  contradicts the ruling. Fix in item E1: the passive tick must bypass Energized. If a
  future playtest wants the passive boosted, flip the ruling instead; do not leave code
  and ruling disagreeing.
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
