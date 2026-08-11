# GAME_SPEC.md — Cards v1 Ruleset

This is the normative ruleset. If code and this document disagree, this document wins
(or the code author must propose a spec change via `docs/DECISIONS.md`).
Edge-case rulings live in `docs/design/edge-cases.md` and are part of this spec.

## 1. Match structure

- **1v1.** Each player controls **1 character** in v1. The engine must support N
  characters per side (unit lists, not single-unit fields) — 2v2/3v3 is a planned
  data change, not a rewrite.
- **Win:** first player to **3 kills**, or the kill leader after **turn 12**. If tied
  after turn 12, sudden death: play continues until the next kill. Mutual kills count
  for both players (and can end the game in a draw only if both hit 3 simultaneously —
  see edge-cases).
- **Death & respawn:** a character at 0 HP dies immediately when the damage applies
  (mid-phase). Dead characters skip subsequent phases. Respawn at the start of the
  decision phase **1 full turn later**, at their spawn zone, full HP, energy retained,
  cooldowns continue ticking while dead.

## 2. The turn loop

Every turn = **Decision Phase** then **Resolution**.

### Decision Phase (simultaneous, hidden)

- Both players simultaneously choose for each of their characters: **one ability**
  (optional) with its target, and a **move path** (optional), OR **sprint** (move
  only, longer range).
- **Timer: 30 seconds** (constant `DECISION_SECONDS`, configurable per room later).
  Each player has **1 Time Bank charge** per match: if the timer expires without a
  lock-in, the charge is consumed automatically for **+10 seconds**. After that,
  whatever is validly selected is submitted; nothing selected = the character holds
  position.
- Neither player sees anything about the opponent's choices until resolution.

### Resolution — four phases, strict order

| # | Phase | Resolves | Rules |
|---|---|---|---|
| 1 | **Prep** | Shields, heals, buffs, traps, stances | All Prep effects apply before any damage this turn. |
| 2 | **Dash** | Dashes, charges, teleports | The dashing character is **immune to Blast-phase abilities that were aimed at squares they are no longer in**. Damage-dealing dashes deal their damage in this phase. Dashes trigger traps they cross. |
| 3 | **Blast** | Standard attacks, projectiles | All non-displacement damage resolves simultaneously (both players' attacks always land even if both die — no one is robbed of damage by dying in the same phase). Then all displacement (knockback/pull) resolves simultaneously at the end of the phase. A character that was knocked back or pulled **loses its Move this turn**. |
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
- **Movement:** up to **4 squares** if an ability was also used this turn; up to
  **8 squares** when sprinting (no ability). Orthogonal steps; no diagonal corner
  cutting through walls/cover. Characters cannot enter or pass through the enemy's
  square, walls, or cover.
- **Vision:** characters see **6 squares** (Chebyshev distance), blocked by walls.
  Vision is mutual. A character standing in brush is hidden from enemies outside
  that brush patch unless adjacent, Revealed, or acting (attacking reveals you until
  end of next turn). Free-aimed attacks may still be fired into unseen squares.
- **Cover:** if a defender is **orthogonally adjacent** to a cover square and the
  attack's line from attacker to defender crosses that side, damage is reduced
  **50% (round down)**. Cover is directional. Melee-range attacks (range ≤ 1) ignore
  cover.

## 4. Characters and abilities

- Each character: `maxHp` (baseline ~100), **4 abilities + 1 ultimate**, defined
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
| Untargetable | Cannot be hit this phase/turn (ults only) | |

- Durations are in turns, tick at end of turn. Same-status applications refresh (do
  not stack) unless the ability says otherwise.
- **Shields** are temporary HP consumed before real HP; expire per their duration.

## 7. Baseline constants

All in `packages/engine/src/constants.ts`:
`MOVE_RANGE 4 · SPRINT_RANGE 8 · VISION_RANGE 6 · COVER_REDUCTION 50% · PASSIVE_ENERGY 5 ·
ULT_COST 100 · KILLS_TO_WIN 3 · TURN_LIMIT 12 · RESPAWN_TURNS 1 · DECISION_SECONDS 30 ·
TIMEBANK_CHARGES 1 · TIMEBANK_SECONDS 10`

## 8. Launch roster (v1 targets — Designer refines in docs/design/)

- **Vex** (Firepower): long-range line shots, a delayed grenade, a short roll, an
  overwatch trap. Wins by prediction and spacing.
- **Bastion** (Frontline): cone slam, big shield, knockback charge, chain pull,
  fortress ultimate. Wins by cornering and trading up close.
- **Wisp** (Trickster): melee flurry, blink, decoy+stealth, slowing bola, shadowstep
  ultimate. Wins by ambush and evasion; loses when read.

Draft kits with numbers live in `data/characters/`. Balance is a Designer/playtest
concern; the Builder implements what the data says.
