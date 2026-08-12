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

## 2026-08-12 — Shape expansion rulings (Builder, BACKLOG 5a)

Turning an aimed order into affected squares needed geometry the spec leaves open.
**(1) Lines fire in one of 8 compass directions** derived from caster→aim, pierce, and
stop at the first wall (cover does not stop them — it blocks movement, not LoS). Snapping
to 8 directions keeps the geometry integer and matches the "lane" feel of Vex's rail
shot and Lance. **(2) Cones snap to the dominant cardinal** of the aim (ties → horizontal)
and widen by one square of half-width per depth step (~45° wedge); wall squares drop out
but do not occlude squares behind them in v1 (cones are melee-short, so this is cheap).
**(3) Circles are Euclidean disks** (`dx²+dy² ≤ r²`) — round, integer, deterministic —
rather than Chebyshev blocks, so a radius-2 grenade is a 13-square blob, not a 5×5 slab.
**(4) Aimed-square reach is Chebyshev**, matching the vision metric the spec already sets.

## 2026-08-12 — Turn pipeline rulings (Builder, BACKLOG items 3/4/5/6 + 3a)

Building `resolveTurn` forced several calls the spec and edge-cases do not state.
**(1) `resolveTurn` takes a fourth argument, a `Roster` (characterId → CharacterDef).**
Abilities are data (golden rule #2) and the engine must resolve an order's `abilityId`
to its def to act on it; the ARCHITECTURE signature `(state, map, orders)` is conceptual.
The roster is read-only content, so determinism is unaffected. **(2) Energy-on-use rule:**
`energyGain` is granted when an ability hits ≥1 enemy (edge-cases) OR when it is
self/utility — `shape: self`, or it carries a `teleport`, `trap`, or `decoy` effect.
This is what lets a dash-dodge, a self-buff, and a trap placement pay out, while a
damaging shot that misses grants nothing. **(3) A dash ability is the unit's movement;**
any separately-submitted Move path is dropped when the chosen ability is dash-phase.
Avoids validating a post-dash Move path against a position not known at Decision time,
and matches intuition (the dash *is* your move). **(4) Invalid order components are
dropped, not the whole order:** an unusable ability (unknown id, on cooldown, ult under
100, illegal aim) is discarded but a legal Move still runs, and vice-versa; rejection is
silent and deterministic. **(5) A Move path may not be planned onto a currently-occupied
square** (validation uses present occupancy), so an ally "convoy" in the same direction
is not expressible in v1 — irrelevant at 1-unit-per-side, revisit at 2v2. Crossing paths
that begin on free squares are still validated and then resolved step-by-step, where the
**swap fix (3a)** applies: two units trading squares mid-resolution both halt (neither
passes through the other), the same "nobody enters" shape as the contested-square ruling.
**(6) Reveal-on-attack lasts 2 turns** (`REVEAL_ON_ATTACK_TURNS`), i.e. "until the end of
the next turn" — applied during resolution it survives this turn's tick and next turn's.
Attacking also clears the attacker's Stealth outright, and taking damage clears the
victim's, resolving the item-2 trap: we do not lean on Reveal to mask Stealth.
**(7) Trap damage is raw** — Might/Weaken and cover do not apply to a trap underfoot; the
placer is not "attacking" at trigger time and cover against the floor is meaningless.
**(8) Passive +5 energy is for the living only;** a corpse retains energy and ticks
cooldowns (edge-cases) but does not build charge while dead. **(9) Respawn misses exactly
one full turn:** a unit that dies on turn T is dead for all of T+1 and returns at spawn,
full HP, fresh statuses (energy and cooldowns retained) for T+2 — implemented by only
counting the respawn timer down for units already dead at the start of a turn.
**(10) Dash immunity is emergent, not special-cased:** Blast resolves against post-Dash
positions, so a unit that dashed off the aimed square is simply not there to be hit.

## 2026-08-12 — Dash / displacement / trap / delayed rulings (Builder, items 7/8/9/12)

**(1) A charge stops in front of the first unit it reaches** (enemy or ally); if that
unit is an enemy and the ability deals damage, it is the one struck. A teleport requires
an open, unoccupied destination (walls may be crossed, per Blink) and fizzles harmlessly
otherwise. A teleport-strike (Shadowstep) hits every enemy adjacent (Chebyshev 1) to its
landing square. **(2) Displacement from any source resolves together at the end of Blast**
(golden rule #4): dash-applied knockbacks (Ram Charge) are queued alongside blast-applied
ones (Chain Hook) and applied in collection order — dash before blast — which is
deterministic. Direction is the 8-way step from source to victim (away for knockback,
toward for pull); the victim stops on the last open square before a wall, cover, edge or
unit, and a pull never lands on the puller. **(3) Being targeted by knockback/pull cancels
the victim's Move even if it could not actually travel** (e.g. shoved into a wall) — the
intent is disrupted. Unstoppable units are immune and keep their Move. **(4) Knockback does
not trigger traps** in v1 — edge-cases lists only dash and move as trigger phases; a unit
shoved onto a trap is not "entering" under its own power. Flagged for a ruling.
**(5) Traps trigger only for enemies of the owner**, are one-shot (consumed on trigger),
deal raw damage (no Might/Weaken/cover), and apply their non-trap effects (Reveal) to the
crosser; the owner's own team is safe. **(6) Reveal-on-attack fires only when damage is
actually dealt** — a pure knockback/pull or a missed shot does not reveal the attacker.
**(7) Delayed abilities are blast-phase only in v1** (the grenade is the only content):
they arm on cast (cooldown starts, area locked, telegraphed via an `abilityFired` event)
and detonate on the stated later turn, folded into that turn's simultaneous Blast. Delayed
damage is the locked base amount with **no attacker scaling and no cover** (an area
detonation has no attack line) and resolves even if the caster moved or died; a living
caster gains the ability's energy on a hit. Delayed prep/dash abilities are **not wired**
(no content needs them) — an ENGINE ASK if a designer wants them.

## Open Questions for the Analyzer — 2026-08-12

- **BACKLOG mismatch (blocking clarity).** The on-disk `docs/BACKLOG.md` is the M0-seeded
  list (items 1–17, no "Spec Notes", no 3a/5a). My session's Analyzer Notes referenced
  items 3a/5a/6–12 with Spec Notes that do not exist in the repo. I treated the Analyzer
  Notes as authoritative and built the full combat core, mapping commits: 5a→shapes,
  6→status, 3+5→combat/cover, 4+3a+10→pipeline, 7→dash, 8→knockback, 9→traps,
  11→determinism, 12→real chars. Please reconcile BACKLOG.md (add the real item text +
  Spec Notes) so future sessions aren't guessing.
- **`resolveTurn` signature (items 4/12).** I added a 4th arg `roster: Record<charId,
  CharacterDef>`; ARCHITECTURE lists `(state, map, orders)`. Confirm this is acceptable or
  specify an alternative (e.g. embedding defs in state). See DECISIONS 2026-08-12 pipeline (1).
- **Energy-on-use rule (spec §4 is terse).** I grant energyGain on hit OR for self/utility
  abilities (shape self, or a teleport/trap/decoy effect). Confirm dash-dodges and trap
  placements should pay energy on use (I ruled yes). Items 6/7/9.
- **Reveal-on-attack duration.** I used 2 turns = "until end of next turn". Confirm vs a
  literal "1". Item 6 / edge-cases.
- **Passive energy while dead.** I grant passive +5 to living units only (corpses keep
  energy + tick cooldowns but don't build charge). Confirm. Item 10.
- **Knockback into traps** (see ruling 4 above) and **decoy** (Wisp veil_decoy: still an
  OPEN ruling in edge-cases; I apply Stealth and skip the decoy entity) — both need a spec.
- **Ally convoy limitation (item 3a/1).** A Move path onto a currently-occupied square is
  rejected at validation, so same-direction ally convoys aren't expressible in v1
  (irrelevant at 1v1). Note for the 2v2 milestone; the swap/contested resolver already
  handles crossing paths.
## 2026-08-12 — Formats rescoped: 2v2 default, 4v4 supported (Jerry + Claude)

Jerry redefined match scope: **2v2 is the default format** (no longer a later
extension) and **4v4 is in scope**. A player controls **1 or 2 characters**, always on
one team, so 2v2 runs with 2–4 players — including the asymmetric 3-player match (a
two-player team versus one player running both characters) — and 4v4 with 4–8 players
(minimum 4, since 8 characters at ≤2 per player needs 4 controllers). Judgment calls
made while cascading this through the docs: **1v1 stays as a dev/testing format**
(hot-seat and scripted engine matches). **Kill targets and turn limits become
per-format** — 2v2: 4 kills / 16 turns (interpolated), 4v4: 5 / 20 (Atlas Reactor's
numbers), 1v1 keeps 3 / 12 — Designer-tunable pending playtests. **The engine stays
player-count-blind**: it models two teams of N units; the room layer owns the
player→character control map and merges per-player submissions into per-team orders
(new "Teams vs. players" section in ARCHITECTURE.md), so per-player timers, Time
Banks, and disconnects are room concerns. **The "no Support archetype" call above is
rescinded** — it assumed 1v1; ally heals now matter from day one. New team rulings
(no friendly fire, ally pass-through, allied contested squares, team-shared vision,
respawn-square order, per-player timer, teammate-visible plans) are drafted in
`edge-cases.md`, the contentious ones as PROPOSED. `duel-arena.json` grew to 4 spawn
squares per side (existing squares kept first, 180°-rotation symmetric) so one map
serves every format. Engine work is queued as BACKLOG **M1.5 (items 13–16)**; no
engine code changed with this rescope.
