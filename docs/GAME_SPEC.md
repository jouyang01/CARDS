# GAME_SPEC.md — Cards v1 Ruleset

This is the normative ruleset. If code and this document disagree, this document wins
(or the code author must propose a spec change via `docs/DECISIONS.md`).
Edge-case rulings live in `docs/design/edge-cases.md` and are part of this spec.

## 1. Match structure

- **Team duel.** Two teams of equal character count fight on one map. Formats are
  defined by **characters per team**, not by player count. The default format is
  **2v2**; **4v4** is fully supported; 1v1 remains available as a development and
  testing format. The engine supports N characters per side (unit lists, not
  single-unit fields) and is blind to player count.
- **Players control characters; teams own them.** Every character is controlled by
  exactly one player for the whole match, and a player controls **1 or 2 characters**,
  always on the same team. The two teams may split control differently — a 3-player
  2v2 (a two-player team versus one player running both characters) is legal.

| Format | Characters per team | Players per team | Total players |
|---|---|---|---|
| **2v2 (default)** | 2 | 1–2 | 2–4 |
| **4v4** | 4 | 2–4 | 4–8 |
| 1v1 (dev/testing) | 1 | 1 | 2 |

  Because a player controls at most 2 characters, 4v4 requires a minimum of **4
  players** (2 per team, each controlling 2 characters) and supports up to 8 (each
  controlling 1). Any mix in between is allowed per team (e.g., a 4v4 team of three
  players splits control 2+1+1).
- **Win:** first **team** to the format's kill target, or the kill-leading team after
  the format's turn limit. If tied after the limit, sudden death: play continues until
  the next kill. Mutual kills count for both teams (and can end the game in a draw
  only if both teams hit the target simultaneously — see edge-cases). Kill targets and
  turn limits are per-format (Designer-tunable):

| Format | Kills to win | Turn limit |
|---|---|---|
| 2v2 | 4 | 20 |
| 4v4 | 5 | 20 |
| 1v1 | 3 | 12 |

- **Death & respawn:** a character at 0 HP dies immediately when the damage applies
  (mid-phase). Dead characters skip subsequent phases. Respawn at the start of the
  decision phase **1 full turn later**, at the first unoccupied spawn square of the
  team's spawn zone (map order — see edge-cases), full HP, energy retained, cooldowns
  continue ticking while dead.

## 2. The turn loop

Every turn = **Decision Phase** then **Resolution**.

### Decision Phase (simultaneous, hidden)

- All players simultaneously choose, for **each character they control**: **one
  ability** (optional) with its target, and a **move path** (optional), OR **sprint**
  (move only, longer range).
- **Timer: 40 seconds** (constant `DECISION_SECONDS`, configurable per room later),
  per player, regardless of how many characters that player controls. Each player has
  **1 Time Bank charge** per match: if the timer expires without a lock-in, the charge
  is consumed automatically for **+10 seconds** (extending only that player's
  deadline). After that, whatever is validly selected is submitted; nothing selected =
  the character holds position. Resolution begins once every player has locked in or
  timed out.
- No player sees anything about the opposing team's choices until resolution.
  Teammates' planned orders are visible to each other — hidden information is team
  vs. team, never within a team.

### Resolution — four phases, strict order

| # | Phase | Resolves | Rules |
|---|---|---|---|
| 1 | **Prep** | Shields, heals, buffs, traps, stances | All Prep effects apply before any damage this turn. |
| 2 | **Dash** | Dashes, charges, teleports | The dashing character is **immune to Blast-phase abilities that were aimed at squares they are no longer in**. Damage-dealing dashes deal their damage in this phase. Dashes trigger traps they cross. |
| 3 | **Blast** | Standard attacks, projectiles | All non-displacement damage resolves simultaneously (every locked attack lands even if its attacker also dies this phase — no one is robbed of damage by dying in the same phase). Then all displacement (knockback/pull) resolves simultaneously at the end of the phase. A character that was knocked back or pulled **loses its Move this turn**. |
| 4 | **Move** | Normal movement | Characters walk their chosen paths. Traps trigger on entry. Contested squares: see edge-cases. |

- **Delayed abilities** (e.g., a grenade with `delayTurns: 1`) resolve in the stated
  phase of a **later** turn, at the originally aimed squares.
- All targeting is **free-aim at squares/directions**, chosen during Decision. Attacks
  do not track: if the target dashes or moves out of the aimed area, they are missed
  (this is the core mind-game).

## 3. Board

- Grid map, default arena **15×15**. Squares are either open, **wall** (blocks
  movement and line of sight), **cover** (blocks movement, does NOT block LoS,
  grants damage reduction — see below), or **brush** (concealment).
- **Distance is MANHATTAN** (as in Atlas Reactor): every distance — movement,
  ability range, vision — is counted orthogonally, so a **diagonally adjacent tile
  is distance 2**. This is the single metric the whole ruleset uses.
- **Movement:** a **4-square budget** if an ability was also used this turn; an
  **8-square budget** when sprinting (no ability). Movement is **8-directional**,
  but an orthogonal step costs 1 and **every diagonal costs 2** — a diagonal is a
  convenience, never a shortcut. So a 4-budget move covers the **41-tile** diamond
  and a sprint the **145-tile** one. A diagonal may **not** cut the corner of a
  wall or cover square (it is blocked if either orthogonally-adjacent square it
  passes between is solid). Walls and cover block entry and pass-through; any
  **character — ally or enemy — may be moved *through* but never *ended* on**
  (edge-cases "AR movement model"). Reachability is an integer shortest-cost
  search, kept deterministic.
- **Ability range:** for **target-square** shapes (`circle`, `square`) range is
  Manhattan distance to the aimed square. **Directional** shapes (`line`, `cone`)
  measure range as a **tile count along their axis**, so rotating one does not
  change how far it reaches. A **charge path** (`path`) spends its range as a
  movement cost budget — a diagonal charge step costs 2, like any other diagonal.
- **Vision:** characters see **6 squares** (Manhattan distance), blocked by walls.
  Vision is mutual, and **shared within a team**: any square seen by a living team
  character is visible to every player on that team. A character standing in brush is hidden from enemies outside
  that brush patch unless adjacent, Revealed, or acting (attacking reveals you until
  end of next turn) — and **adjacent here means the four orthogonal neighbours**
  (Manhattan ≤ 1), so a diagonal neighbour does not reveal them. Free-aimed
  attacks may still be fired into unseen squares.
- **Cover** comes in two forms, both directional, both reducing crossing damage
  **50% (round down)**, neither blocking line of sight, and both ignored by
  melee-range attacks (range ≤ 1):
  - **Edge cover (half-wall, `{x,y,facing}`).** A barricade on the one `facing`
    edge (N/S/E/W) of its tile. You may **walk onto the tile** to take cover, but
    **movement across that edge is blocked** in both directions (you cannot walk
    *through* it from the side it faces). The occupant standing on it is reduced
    against any attack whose line crosses the faced edge. This is the default
    cover on Proving Grounds.
  - **Full-block cover (`{x,y}`).** Occupies the whole square: blocks entry and
    pass-through like a wall (but not sight), and reduces an **orthogonally
    adjacent** defender when the attack line crosses the shared side. The v1
    form, kept for iron-basin.

## 4. Characters and abilities

- Each character: `maxHp` — the shipped band runs **100–175, median 130**, laid out
  as an archetype ladder **firepower < support < frontline** (TTK-HP-BAND; the
  derivation is in `docs/reviews/2026-09-27.md`, and `content.test.ts` enforces both
  the ladder and the ordering) — plus **4 abilities + 1 ultimate**, defined
  entirely in `data/characters/<id>.json`.
- Ability schema (see `packages/engine/src/types.ts` for the authoritative type):
  `id, name, phase (prep|dash|blast), shape (line|cone|circle|path|square|self),
  range, radius?, cooldown, energyGain, delayTurns?, effects[], description`.
- **Effects** are from a fixed, engine-supported list: `damage, heal, shield, might,
  weaken, haste, slow, root, reveal, energized, unstoppable, knockback, pull, trap,
  stealth, decoy, teleport, untargetable`. New effect kinds require an engine change
  (Designer marks these `ENGINE ASK`).
- **Cooldowns** tick down at end of turn. Using an ability grants its `energyGain`
  only if it hits at least one enemy (self-buffs grant their listed energy on use).

## 5. Energy and ultimates

- Start at 0. **+5 passive per turn** (end of turn). Abilities grant energy on hit.
  `Energized` gives +50% energy gained (round down).
- **Ultimate costs 100 energy**, resets to 0 on use. Ultimates are phase-tagged like
  any ability and follow the same resolution rules.

## 6. Statuses

| Status | Effect | Notes |
|---|---|---|
| Might | +25% outgoing damage (round down) | |
| Weaken | −25% outgoing damage (round down) | |
| Haste | +50% movement (round down) | 4→6, 8→12 |
| Slow | −50% movement (round down) | 4→2, 8→4 |
| Root | Cannot Move-phase move | Does not cancel an already-locked dash (v1 ruling — see edge-cases) |
| Reveal | Visible through brush/stealth | |
| Energized | +50% energy gain | |
| Unstoppable | Immune to knockback/pull/root/slow | |
| Stealth | Hidden even outside brush; broken by attacking or taking damage | |
| Untargetable | Cannot be hit this phase/turn | Ults **and** catalysts (Fade) |

- Durations are in turns, tick at end of turn. Same-status applications refresh (do
  not stack) unless the ability says otherwise.
- **Shields** are temporary HP consumed before real HP; expire per their duration.

## 7. Baseline constants

Global constants in `packages/engine/src/constants.ts`:
`MOVE_RANGE 4 · SPRINT_RANGE 8 · VISION_RANGE 6 · COVER_REDUCTION 50% · PASSIVE_ENERGY 5 ·
ULT_COST 100 · RESPAWN_TURNS 1 · DECISION_SECONDS 40 · TIMEBANK_CHARGES 1 ·
TIMEBANK_SECONDS 10`

`KILLS_TO_WIN` and `TURN_LIMIT` are **per-format** (table in §1) and live in the
engine's format config alongside characters-per-team (BACKLOG item 13), not as single
global constants.

## 8. Launch roster (v1 targets — Designer refines in docs/design/)

- **Vex** (Firepower): long-range line shots, a delayed grenade, a short roll, an
  overwatch trap. Wins by prediction and spacing.
- **Bastion** (Frontline): cone slam, big shield, knockback charge, chain pull,
  fortress ultimate. Wins by cornering and trading up close.
- **Wisp** (Trickster): melee flurry, blink, decoy+stealth, slowing bola, shadowstep
  ultimate. Wins by ambush and evasion; loses when read.

With 2v2 as the default format, ally-targeted play matters from day one: heals,
shields, and buffs may target allies (see the no-friendly-fire ruling in
edge-cases), and the **Support** archetype is unblocked — Designer to draft a fourth,
Support kit in `docs/design/`. Whether duplicate picks are allowed within or across
teams is an open Designer question (edge-cases).

Draft kits with numbers live in `data/characters/`. Balance is a Designer/playtest
concern; the Builder implements what the data says.
