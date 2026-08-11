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
    (no one robbed of damage), kill tally, respawn turn 1 later at spawn, 3-kill /
    turn-12 / sudden-death logic. *AC: tests incl. mutual-kill turn.*
11. **Determinism harness.** Replay a recorded 12-turn order log; assert final state
    hash across 100 runs; lint/grep guard for Math.random/Date in engine. *AC: harness
    in CI.*
12. **Load real characters.** Wire `data/characters/*.json` through the pipeline;
    delayed abilities (`delayTurns`); full Vex-vs-Bastion scripted match test.
    *AC: scripted match completes with a winner and a sane event log.*

## M2 — Local playable (expand when M1 nears done)

13. Render units, HP/shield/energy bars, terrain from map JSON.
14. Decision-phase targeting UI: shape previews, path drawing, lock-in button.
15. Resolution playback from `TurnEvent[]` with per-phase steps.
16. Hot-seat dev harness (pass-the-laptop, orders entered one player at a time).

## M3+ — placeholder (Analyzer expands after M2)

17. Worker + Durable Object rooms, WebSocket protocol, room codes, hidden submission,
    reconnect/replay; deploy client to Pages + server via wrangler.
