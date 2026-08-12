# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder takes the **top unblocked item**, implements it
with tests, commits, and stops. Items must stay small and independently shippable.

## M1 — Engine core

1. **Board + movement.** BFS reachability within move range; orthogonal steps; walls,
   cover, and the enemy unit block movement and pass-through; sprint range; Haste/Slow
   modify range. *AC: tests for 4/8 range, blocked paths, haste/slow rounding, no
   corner-cutting.*
2. **Line of sight + vision.** Square-grid LoS blocked by walls (not cover); vision
   radius 6 Chebyshev, mutual; brush concealment incl. adjacency exception; Reveal and
   Stealth interactions. *AC: tests incl. brush-edge and mutual-vision cases.*
3. **Cover mechanics.** Directional adjacency check; attack line crossing the covered
   side; 50% reduction round-down; melee (range ≤1) ignores cover. *AC: tests for all
   four directions + diagonal attack lines + melee exception.*
4. **Turn pipeline skeleton.** Order validation, phase bucketing, Prep→Dash→Blast→Move
   execution loop emitting a `TurnEvent[]` log. No abilities yet beyond a test dummy.
   *AC: scripted turn produces events in exact phase order; invalid orders rejected
   deterministically.*
5. **Damage / shields / heal / energy.** Damage application order (shield first),
   integer rounding rules, on-hit energy, passive +5, Energized. *AC: tests incl.
   Might+Weaken stacking (net 0) and shield overflow.*
6. **Status system.** Apply/refresh/tick for all statuses in GAME_SPEC §6 with
   durations; Unstoppable immunity set. *AC: tests for refresh-not-stack, expiry
   timing, Unstoppable vs knockback/root/slow.*
7. **Dash phase rules.** Dash immunity to Blast abilities aimed at vacated squares;
   damage-dealing dashes; dashes trigger traps. *AC: the signature test — unit dashes,
   Blast line at origin square misses; also dash-into-trap.*
8. **Knockback/pull.** Simultaneous displacement at end of Blast; wall-stop rule;
   Move cancellation for displaced units; Unstoppable immunity. *AC: tests incl.
   knockback-into-wall and both-units-displaced.*
9. **Traps.** Prep placement, hidden from opponent, trigger on entry any phase,
   damage + Reveal. *AC: tests for move-through, dash-through, standing on it.*
10. **Deaths, respawn, win conditions.** Mid-phase death, simultaneous mutual damage
    (no one robbed of damage), per-team kill tally, respawn turn 1 later at spawn,
    kill-target / turn-limit / sudden-death logic per the format table in GAME_SPEC
    §1 (constants come from item 13's format config; if built first, take the config
    shape from item 13 rather than hardcoding 2v2). *AC: tests incl. mutual-kill turn
    and win checks at more than one format's target/limit.*
11. **Determinism harness.** Replay a recorded 12-turn order log; assert final state
    hash across 100 runs; lint/grep guard for Math.random/Date in engine. *AC: harness
    in CI.*
12. **Load real characters.** Wire `data/characters/*.json` through the pipeline;
    delayed abilities (`delayTurns`); full Vex-vs-Bastion scripted match test.
    *AC: scripted match completes with a winner and a sane event log.*

## M1.5 — Teams & formats (2v2 default, 4v4 — GAME_SPEC §1)

13. **Format config.** Engine `FORMATS` config: characters per team, kills to win,
    turn limit for 2v2 (default), 4v4, and 1v1 (dev/testing), per the GAME_SPEC §1
    tables. Win checks and order/state validation read the match's format, not global
    constants; retire `KILLS_TO_WIN` / `TURN_LIMIT` as globals. Rename `PlayerId` →
    `TeamId` where it means the team (orders/state are per-team; player→character
    control mapping is not the engine's concern — see ARCHITECTURE "Teams vs.
    players"). *AC: win-check tests at each format's kill target and turn limit.*
14. **Ally-aware effects.** Heals/shields/buffs apply to allies in the aimed area;
    no friendly fire per edge-cases (harmful effects and displacement skip the
    caster's team; own-team traps don't trigger for allies); energy-on-hit still
    requires ≥1 *enemy* hit. *AC: one AoE covering ally+enemy damages only the enemy
    and heals only the ally; a unit crossing its own team's trap doesn't trigger it.*
15. **Team movement & vision.** Ally pass-through (PROPOSED ruling in edge-cases),
    allied contested squares, team-shared vision. *AC: path through an ally is legal
    but ending on one is not; two allies contesting a square both stop; a teammate's
    position grants vision of its surroundings.*
16. **Multi-unit spawns & respawns.** Place units on team spawn squares in map order
    at match start; respawn to the first unoccupied team spawn square; map validation
    requires spawns-per-team ≥ characters-per-team for supported formats. *AC:
    deterministic placement; respawn while the first spawn square is occupied.*

## M2 — Local playable (expand when M1 nears done)

17. Render units, HP/shield/energy bars, terrain from map JSON — team-colored for up
    to 4 units per side.
18. Decision-phase targeting UI: shape previews, path drawing, per-character order
    entry for players controlling 2 characters, lock-in button.
19. Resolution playback from `TurnEvent[]` with per-phase steps.
20. Hot-seat dev harness (pass-the-device, orders entered one player at a time;
    supports 2–4 players in 2v2, incl. the 3-player split).

## M3+ — placeholder (Analyzer expands after M2)

21. Worker + Durable Object rooms, WebSocket protocol, room codes, format selection
    (default 2v2; 4v4), lobby with team seats and 1–2 characters claimed per player,
    per-player hidden submission merged into per-team orders, reconnect/replay;
    deploy client to Pages + server via wrangler.
