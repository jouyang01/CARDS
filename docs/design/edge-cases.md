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

## Targeting & vision

- **RULED — Free-aim into fog.** Players may aim any ability at any legal square,
  seen or unseen. Hitting a stealthed/hidden unit works normally — stealth hides
  position, it is not a dodge.
- **RULED — Attacking breaks concealment.** Using any damaging ability reveals the
  attacker until the end of the *next* turn (Reveal status, 1 turn).
- **RULED — Delayed abilities.** Resolve at their locked squares in the stated phase
  `delayTurns` later, regardless of whether the caster moved, is stealthed, or died
  in between.
- **OPEN — Decoy behavior.** Wisp's decoy: static dummy at cast square? Does it
  absorb targeted attacks (free-aim means attacks aren't "targeted"...)? Designer to
  spec precisely before Builder implements (likely: decoy is a fake unit rendered to
  the opponent only; engine models it as a `decoy` entity that takes damage and
  expires). `ENGINE ASK` expected.

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

- **RULED — Energy on multi-hit.** `energyGain` is granted once per ability use if it
  hits ≥1 enemy (not per enemy hit) in v1.
- **RULED — Cooldowns while dead.** Continue ticking. Respawn does not reset energy
  or cooldowns.
- **RULED — Turn-12 tiebreak order.** Win check runs at end of turn after all phases:
  kills compared first; if tied, sudden death continues with normal turns.
- **OPEN — Simultaneous disconnect/timeout handling** (matters at M3): if a player
  never submits, does their character sprint-hold or full-hold? Current lean: hold
  position, no ability. Decide when building the server.
