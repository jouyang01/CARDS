# DECISIONS.md — append-only log of judgment calls

## 2026-08-11 — Project scoping (Jerry + Claude)

- **1 character per player in v1; engine architected for N per side.** Fastest path to
  a playable duel; 2v2/3v3 becomes a data/UI change later.
- **Zero-cost hosting is a hard constraint.** GitHub Pages (client) + Cloudflare
  Workers free tier (rooms). PeerJS P2P is the documented fallback, not the primary.
- **No RNG in v1.** Full determinism simplifies netcode and makes duels feel fair.
- **Integer-only math for game values.** Percentage modifiers round down. Avoids
  float-ordering desyncs.
- **No Support archetype at launch** — healing an ally is meaningless in 1v1. Every
  kit gets some self-defense instead. Support returns with 2v2.
- **First to 3 kills / 12-turn limit / sudden death.** Scaled down from AR's 5/20 for
  a 2-character match.
- **Catalysts and ability mods deferred** (M6+). Balance layers, not core loop.
- **SVG rendering, no game framework.** Functional art; keeps agent effort on gameplay.
- **Cover simplification for v1:** cover occupies a full square, blocks movement, does
  not block LoS, grants directional 50% reduction to adjacent defenders. AR's
  edge-mounted half-walls are finer-grained; revisit only if playtests demand it.
- **Root does not cancel an already-locked dash in v1.** Simpler, and preserves the
  dash-as-escape read. Revisit if it plays badly (flagged in edge-cases.md).

## 2026-08-11 — Movement rulings (Builder, BACKLOG item 1)

Implementing board + movement surfaced four gaps the spec and `edge-cases.md` do not
cover, each resolved with the smallest call that keeps the engine deterministic.
**(1) Orthogonal-only, so corner-cutting is structural, not policed.** GAME_SPEC §3 says
"orthogonal steps; no diagonal corner cutting" — since a diagonal is never a legal step,
a unit walking around a wall corner simply pays for both orthogonal squares; there is no
separate corner rule and no diagonal movement anywhere in the engine.
**(2) Haste and Slow are summed as percentage deltas before a single round-down**
(`floor(base * (100 + haste − slow) / 100)`), so holding both nets back to the base
budget — the same shape as the Might/Weaken net-zero rule in BACKLOG item 5, rather than
applying two sequential round-downs whose result would depend on order.
**(3) Dead units block nothing.** `edge-cases.md` rules that walls, cover, enemies and
(in v1) allies block entry and pass-through; a unit at 0 HP is off the board until
respawn, so it neither occupies nor blocks its square. **(4) Self-intersecting move paths
are legal**, costing one budget point per square entered. Looping is never advantageous,
and forbidding it would be an extra rule to specify against contested-square and trap
resolution later. Root is enforced by zeroing the movement budget, so the same helper
answers both "is this path legal" and "what may the UI highlight".

## 2026-08-12 — Line-of-sight and concealment rulings (Builder, BACKLOG item 2)

Implementing vision surfaced five gaps the spec and `edge-cases.md` do not cover.
**(1) Line of sight is exact segment geometry, and corner grazes are permissive.**
Square centres are placed at odd coordinates in a doubled grid so the segment/square
test is pure integer arithmetic with no epsilon; a wall blocks only when the sightline
enters its *interior*, so a line passing exactly through a wall's corner still sees
through. The alternative (a touched corner blocks) is equally symmetric but makes
single wall squares cast surprisingly wide shadows. Flagged for playtest: two walls set
diagonally do not seal the seam between them. **(2) "Vision is mutual" (GAME_SPEC §3)
is a statement about range and line of sight, not about concealment.** Range and LoS
are symmetric by construction, so neither player ever has a longer sight radius;
concealment is deliberately one-way, since a unit that could not see out of brush while
hidden inside it would make brush useless. **(3) Brush patches use orthogonal
connectivity**, matching movement: brush squares touching only at a corner are separate
patches, so "we are in the same brush" never means brush a unit could not have walked
between. **(4) Adjacency for perception is Chebyshev — the eight surrounding squares —
even though movement adjacency is orthogonal.** Vision range is already Chebyshev, and
a unit standing diagonally against another is not plausibly unaware of them. **(5)
Adjacency does not break Stealth.** GAME_SPEC §6 ties the adjacency exception to brush
specifically, and Stealth is described as hiding a unit anywhere; only Reveal, attacking,
or taking damage should end it. This is the ruling most likely to want revisiting — if
Wisp proves oppressive, breaking Stealth at range 1 is the first lever to pull.
Consequently a dead unit is neither seen nor a seer (it is off the board until respawn,
the same rule that makes it block nothing during movement), and a player always sees
their own units regardless of terrain, which keeps the N-per-side architecture honest.

## 2026-08-12 — Two vision rulings added after self-review (Builder, BACKLOG item 2)

**(6) Units do not block line of sight.** `hasLineOfSight` takes only a board, so a
body can never occlude a sightline — the Atlas Reactor behaviour, and the one that
keeps free-aim honest: if standing behind the enemy granted cover, the mind-game would
become a positioning puzzle about hiding *behind* people. GAME_SPEC §3 lists only walls
as blockers and is silent on units, so this records the reading rather than inventing a
rule. **(7) Reveal masks Stealth; it does not end it — and that is a trap for BACKLOG
item 6.** GAME_SPEC §6 says Stealth is "broken by attacking or taking damage", while
`edge-cases.md` rules that attacking applies Reveal for one turn. Because `canSee`
checks Reveal before Stealth, an attack *looks* like it breaks Stealth: the unit is
visible that turn. But the Stealth status is still on the unit, so it re-hides the
moment Reveal expires. Whoever implements status application must clear Stealth
outright on attack and on damage rather than relying on the Reveal it grants. Flagged
here because the bug would surface a milestone later, in a file that looks correct.

## 2026-08-12 — Cover geometry ruling (Builder, BACKLOG item 3)

**Cover inherits line-of-sight's corner-permissive geometry.** GAME_SPEC §3 says cover
protects when "the attack's line from attacker to defender crosses that side"; it does
not say what a line grazing the corner shared by the defender and its cover does. Rather
than invent a second convention, `isBehindCover` reuses `segmentCrossesSquare` — the same
doubled-coordinate kernel `hasLineOfSight` is built on — and asks whether the attacker→
defender segment enters the cover square's interior. Because that segment ends inside the
defender's square and the two squares are orthogonally adjacent, entering the cover
interior is exactly crossing the side they share. The consequence, which the spec leaves
open: a perfectly diagonal shot that touches the defender–cover corner without entering
either square grants no cover (it enters neither the north nor the west cover interior).
This matches the ruling that a sightline grazing a wall corner still sees through — one
geometry, one boundary convention, no epsilon to disagree about across machines. If
playtests find corner-hugging too easy to shoot around, the lever is the same one flagged
for line of sight: make a touched corner count as crossing. `range <= 1` (melee) ignores
cover per spec, and a flat 50% applies regardless of how many cover squares a defender
hugs — the reduction is a boolean, not a stack.

## 2026-08-12 — Turn pipeline skeleton: two calls the docs left open (Builder, BACKLOG item 4)

**(1) `resolveTurn` takes a fourth argument, a `Roster`.** ARCHITECTURE.md sketches
`resolveTurn(state, map, orders)`, but a unit's `GameState` entry carries only a
`characterId`, and the pipeline cannot bucket an order into its phase (or check its
cooldown, range, or ultimate cost) without the `AbilityDef`. Rather than fatten
`GameState` with content on every wire message — content is data, not state (golden rule
#2), and the netcode syncs *orders*, a few hundred bytes — I pass a `Roster`: a read-only
index from `characterId` (and `abilityId`) to definitions, built once from
`data/characters/*.json`. Signature is now `resolveTurn(state, map, orders, roster)`.
ARCHITECTURE.md's three-arg sketch should be updated to match (flagged for whoever owns
that doc; the Builder does not edit it). Item 12 builds the shipped roster from JSON;
until then tests use a dummy.

**(2) Movement resolves in synchronised steps, and a "contested square" is a same-step
collision.** `edge-cases.md` rules that when two units Move to the same square, neither
enters and each stops on its last square before it — but it does not say whether "the same
square" means the same *destination* or the same square *at the same instant*. The engine
walks every unit's path one synchronised step at a time: a square is contested only when
two or more units would step onto it on the *same* step (then all of them stop there); a
unit that reaches a shared square a step earlier holds it, and the later arrival is blocked
and stops. This is the reading that makes the four-phase simultaneous model coherent — a
single global clock, no per-unit priority coin-flip — and it falls out cleanly because a
path validated against the starting board never even targets another unit's *start* square,
so the only conflicts left are squares that were empty when the turn began. A unit blocked
or contested stops for the rest of the phase (remaining path dropped), matching "stops on
the last square before the contested square." Trap triggers, knockback's Move-cancellation,
and mid-path death are later items (7–10) and are not in the resolver yet. The skeleton
also does **not** run end-of-turn bookkeeping (energy tick, cooldown tick, respawn, win
check) or advance the turn counter — those arrive with items 5, 6, and 10 — so item 4
changes state only through the Move phase.

## 2026-08-12 — Combat economy: three rounding/scope calls (Builder, BACKLOG item 5)

**(1) Damage rounding order is fixed: outgoing modifiers → cover → shields → HP, each an
independent floor.** GAME_SPEC gives Might/Weaken as "±25% outgoing (round down)" and cover
as "50% (round down)" but does not say how they compose. I apply the attacker's Might/Weaken
first (`scaleDamage`, summed as `floor(base·(100+might−weaken)/100)` so both held nets to
base, mirroring Haste/Slow), then the defender's cover reduction (`coverReducedDamage`,
item 3), then shields, then HP. Two separate floors, outgoing-before-incoming — the natural
reading and the one that keeps each modifier's own round-down independent and machine-stable.
`applyDamage` reports HP *actually* lost (not overkill) as the `damage` event's `amount`, so
a health bar animates the real drop; shields fully drained are removed, partial ones keep
their amount and duration.

**(2) Energized scales ability-granted energy, not the passive drip.** GAME_SPEC §5 says
"+50% energy gained (round down)" and, separately, "+5 passive per turn." I read Energized as
boosting energy *earned from abilities* (on-hit `energyGain`, and self-buff-on-use later) —
not the flat passive tick, which is a fixed baseline drip rather than "gained" energy.
Treating the passive as Energized-boosted would silently hand a +2/turn bonus to anyone
holding the status, which is not what a combat buff should do. If playtests want the passive
boosted too, it is a one-line change in the end-of-turn step.

**(3) The passive +5 goes to living units only; the dead retain but do not gain.** GAME_SPEC
§1 says a dead character keeps its energy through respawn and its cooldowns keep ticking, but
is silent on whether it also earns the passive while down. A unit at 0 HP is off the board
(the same rule that makes it neither block movement nor cast sight), so it banks nothing until
it respawns. Minimal call; revisit if respawn timing makes it feel punishing.

Scope, for the Analyzer: item 5 wires **Blast damage + on-hit/passive energy + the ultimate's
on-use energy reset** into the pipeline. Until shape expansion exists, "the aimed squares" are
the order's raw target squares (a hit is an enemy standing on one), so line/cone/circle are not
yet spread across their full footprint — an interim contract flagged in `resolveBlastDamage`.
Non-damage ability effects (buffs, shields, heals via `addShield`/`applyHeal`, dash movement)
are logged as `abilityFired` but not applied; a unit reduced to 0 HP is left alive at 0 for the
deaths/respawn/win system (item 10). The turn counter still does not advance here.
