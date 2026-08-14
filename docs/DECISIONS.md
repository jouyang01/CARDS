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

## 2026-08-12 — Launch roster expanded to 9; Support pulled forward to v1 (Designer)

At the project owner's direction, the launch roster grows from 3 to 9 characters
(`docs/design/roster-v1.md`), organized as three archetypes — Firepower, Frontline,
Support — with a named theme per character and two archetype hybrids (Cinder:
Firepower/Support, Aegis: Frontline/Support). This **reverses the 2026-08-11 "No
Support archetype at launch" decision**: Supports are now designed to hold their own
in 1v1 by requiring every beneficial effect to be self-applicable (aimed circles
include the caster's square), with real-but-lower auto damage and one escape tool
each; their full value unlocks at 2v2 with no kit changes. Kit structure is fixed at
1 auto attack (cooldown 0, Blast) + 3 cooldown skills spanning ≥2 phases + 1
ultimate (100 energy), which fits the existing `4 abilities + 1 ultimate` schema
untouched. Wisp is reclassified `trickster` → `firepower` (theme "Phantom" / Stealth
Firepower) so archetype is a balance class and theme carries the flavor;
`'trickster'` stays in the `Archetype` type as a deprecated label — no engine change.
The roster introduces two `ENGINE ASK`s recorded in roster-v1.md §9 (effect target
affinity in mixed areas; energy gain on ally-benefit) that the Builder must not
improvise around.

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

## 2026-08-14 — Multiplayer-rescope engine build (Builder, E1 + M1.5 13–16, M2 17)

Implemented the 2v2-default rescope in the engine (dev note: "confirm you have the
multiplayer rescope and are implementing those changes"). Judgment calls beyond the
rescope docs:
**(1) Format lives on `GameState.format` (a `FormatId`);** the win check reads
`FORMATS[format]` for kill target + turn limit. Global `KILLS_TO_WIN`/`TURN_LIMIT` were
removed. Tests default to `1v1` so 1v1 dev behaviour is unchanged.
**(2) `TeamId` added; `PlayerId` kept as a deprecated alias.** A full mechanical rename
of the `PlayerOrders.player` field and every `owner: PlayerId` was deferred to avoid
churning ~all tests for no behaviour change — flagged for the Analyzer to schedule.
**(3) Effect polarity (no friendly fire).** Harmful = damage, weaken, slow, root,
knockback, pull, **reveal** (reveal is hostile → enemies only). Beneficial = heal,
shield, might, haste, energized, unstoppable, **stealth**. teleport/decoy/trap are
neither (self/placement). AoE now applies harmful to enemies in-area and beneficial to
own-team in-area (incl. the caster if inside). **Any beneficial-effect ability now pays
its energyGain on use** (support abilities bank energy), extending the self/utility rule.
**(4) Ally pass-through is enforced at the planning layer** (`reachableSquares` marks
ally squares `canStop:false` but walks through them; `validateMovePath` allows an ally as
an intermediate step, rejects it as a destination). At **resolution**, `stepMovers` keeps
the safe no-two-units-on-one-square rule: a mover halts before a *stationary* ally rather
than sliding through it that turn. So "pass-through" is fully a planning affordance in
v1; true slide-through of a stationary ally at resolution is deferred (deterministic and
AC-satisfying as-is). Flagged.
**(5) Only blast-phase delayed abilities detonate** (unchanged from M1); still no
prep/dash delayed content. **(6) Ally-aware effects are wired in Blast only** — an AoE
*prep* buff to allies is not wired (no content; prep abilities are self-shape). Flag if
a Designer drafts one.
**(7) `createMatch` ids are `"<charId>-t<team>-<i>"`** (unique across duplicate picks);
`createInitialState` keeps `"<charId>-0"` for the 1v1 convenience. Respawn goes to the
first team spawn square (map order) no living ally holds.
Client item 17 render reads engine state only and loops `state.units` (N-unit,
team-coloured); no game logic client-side.

## Open Questions for the Analyzer — 2026-08-14

- **Two unreconciled Analyzer branches.** `claude/cards-code-review-h3mwjs` (M1 review,
  based on my HEAD: marks M1 done, numbers 13–16 as the client batch, adds E1/E2) and
  `claude/cards-multiplayer-configs-jcfoxf` (the rescope, based on `main`: renumbers 13–16
  as the M1.5 teams batch, client → 17–20) **conflict on `BACKLOG.md` and
  `edge-cases.md`**. I merged the **rescope** into my branch (per the dev note) and built
  M1.5 13–16 + client 17; the code-review branch's E1 I also did. Please reconcile the
  two into one canonical `BACKLOG.md` (M1 complete ✓ + M1.5 done ✓ + E1 done ✓ + client
  17 done ✓; remaining: 18–20, E2 optional) and one `edge-cases.md`.
- **This session's Analyzer Notes used the pre-rescope numbering** ("13 render → 16
  hot-seat"). I followed the dev note and built the **rescope engine** (13–16 teams) +
  render (17) instead, deferring the interactive client (18–20). Confirm that priority.
- **Confirm the rescope judgment calls above**, esp. (3) effect polarity (is `reveal`
  harmful / `stealth` beneficial for AoE filtering?), (4) ally pass-through at resolution
  (v1 halts before a stationary ally — acceptable, or do you want true slide-through?),
  and the beneficial-abilities-pay-energy-on-use rule.
- **`PlayerId → TeamId` full rename** (fields `PlayerOrders.player`, `owner`): schedule it
  as its own mechanical item so it doesn't ride inside a behaviour commit.
- **Designer follow-ups still open** (unchanged): decoy entity (D1), `combat_roll`
  path-vs-teleport, cover-vs-Might composition, duplicate-pick rule, Support kit draft.

## 2026-08-15 — TeamId rename + M2 client (Builder, T1 + items 18–20)

Integrated `origin/main` (M1 engine + roster-v1's 9 characters + rescope docs) into the
engine branch, then built the interactive client. Judgment calls:
**(1) T1 rename is complete, not aliased.** `PlayerId` was deleted outright (nothing
external depended on it) and `PlayerOrders.player` → `PlayerOrders.team`; the interface
name `PlayerOrders` was kept (per the item's own wording) to bound churn. Pure mechanical
change — all 226 engine tests pass unchanged.
**(2) Client gets its own Vitest runner** (`packages/client/vitest.config.ts`, node env)
so the AC-bearing *pure* logic — order building, event→view reconstruction, per-player
order merging — is actually tested; root `npm test` now runs both workspaces
(`--workspaces --if-present`). This broadens the constitution's "npm test = engine suite"
— flagged. The interactive DOM shell (`app.ts`, `render.ts`) stays typecheck/build-verified
only (no runtime test here), consistent with "client code, no engine tests".
**(3) Playback reproduces the *board* (positions, HP, alive, kills)** purely from the
event log. Two event-schema gaps mean it cannot reconstruct everything (flagged, not
worked around): `statusApplied` carries no shield `amount`, and there is **no event for
an ultimate's energy reset** — so shield pools and post-ult energy drift if derived from
the log alone. HUD-only; the board is exact.
**(4) Seat split** (`deriveSeats`): a team's characters are distributed ≤2 per player, the
first `units−players` players getting 2 — yielding the 3-player 2v2 (1+1 vs 2) and 4v4
(2+1+1). Player→character control is a client/room concern; the engine still sees two
teams. **(5) E2 (cover-corner unify) left undone** — optional, and no cover code was
touched this session.

## Open Questions for the Analyzer — 2026-08-15

- **Event-schema gaps for playback (item 19).** To let the client show shield pools and
  post-ult energy without recomputing, the engine's `TurnEvent` log needs: (a) a shield
  `amount` on `statusApplied` (or a dedicated `shielded` event), and (b) an event for an
  ability spending/zeroing energy (the ult reset emits nothing today). Ruling requested
  before I add them to `resolve.ts` — it's an engine event-schema change.
- **Client test runner.** I added client Vitest and made root `npm test` run both
  workspaces. Confirm that's the desired shape (vs. keeping `npm test` engine-only and a
  separate client test command), and that CI should run client tests too.
- **Main PR + stale branches.** `origin/main` trailed (had M1 engine + roster + rescope
  docs but not M1.5/E1/render); I merged main into this branch and will PR it back.
  After merge, retire `claude/cards-multiplayer-configs-jcfoxf`, `…engine-backlog-t96lxw`,
  and `…code-review-h3mwjs` (their content is now on the engine branch / main).
- **Interactive shell is not runtime-tested here** (no Playwright in the repo). Recommend
  a headless smoke test (drive one hot-seat turn, assert resolve+playback) when tooling
  is available — the pure logic under it is covered.
- **Designer follow-ups still open** (unchanged): decoy (D1), `combat_roll`
  path-vs-teleport, cover-vs-Might, duplicate-pick rule, and the roster-v1 §9 ENGINE ASKs
  (effect target affinity; energy on ally-benefit) — do NOT implement in v1 without a ruling.

## 2026-08-17 — Rendering schema + AR movement + tooltips (Builder, S1/MV1/MV2/TT1/C1)

**(S1) Event schema completed for the HUD.** `statusApplied` gained an optional `amount`
(the shield pool when `status==='shield'`); a new delta-based `energySpent` event fires
when an ability removes energy (the ult reset). `playback.ts` tracks a shield pool
(`statusApplied.amount` − `damage.absorbed`) and applies `energySpent` (`energy -= amount`).
Note: playback folds *deltas* and does not tick status durations (no expiry event), so a
duration-1 shield shows its full pool during that turn's playback; the next turn's
`initView` reflects the ticked-off pool. That's correct for an animation view — flagged
below in case an explicit expiry event is wanted.
**(MV1) Charges pass through characters.** `walkCharge` passes through any unit and rests
on the furthest free path square (occupied destination → last free square before it;
teleport still fizzles). Damage target is unchanged (first enemy crossed or run into).
Knockback is measured from the charge **origin** (not the post-pass-through position) so it
still pushes along the charge — keeping combat semantics as today. **Side effect flagged
for the Designer:** a damaging charge now overshoots its target, so its knockback can be
blocked by the charger's own landing square (Ram Charge: Vex is struck but not displaced).
This is the held ENGINE ASK (charge damage/knockback with pass-through: first/all/dest?).
**(MV2) Movement follows the AR model.** `enemyOccupied`/`allyOccupied` → one
`occupiedByOthers`; the planner (`reachableSquares`/`validateMovePath`) treats *every*
occupied square as walk-through but not a legal endpoint; only walls/cover/edge block a
path. `stepMovers` is unchanged (already team-agnostic; same-step contested + 2-cycle
no-swap invariants hold). As before, planning over-promises vs. resolution when a *crossed*
unit stays put — `stepMovers` halts a mover before a stationary occupant rather than
co-occupying (deterministic). Kept PROPOSED in edge-cases pending AR-wiki verification
(egress was blocked again this session).
**(TT1)** Pure `abilityTooltip(def)`/`effectLabel` read straight off `AbilityDef`; the
shell shows it on hover. **(C1)** Added a headless end-to-end hot-seat smoke test (no DOM):
orders→merge→resolve→playback view equals the engine board. **Also:** updated `CLAUDE.md`'s
`npm test` line to "engine + client test suites" (the Analyzer routed this one-liner to me).

## Open Questions for the Analyzer — 2026-08-17

- **MV1 charge combat (held ENGINE ASK → Designer).** Pass-through makes a damaging charge
  overshoot; its knockback can then be blocked by the charger's own landing (Ram Charge no
  longer displaces its target). Need the ruling: does a charge hit first/all/destination,
  and how should knockback resolve when the charger ends past the target? See
  `resolve.walkCharge`/`runDash`, `dash.test.ts`, `real-characters.test.ts` (Ram Charge test).
- **MV2 AR-wiki verification still pending.** `atlas-reactor.fandom.com/wiki/Movement` was
  egress-blocked again — confirm move-through timing / terrain / range details and then
  promote the edge-cases ruling from PROPOSED to RULED (or correct it). Files: `movement.ts`,
  `resolve.stepMovers`.
- **Playback shield during-turn vs post-tick (S1).** The view shows a shield's full pool
  during its turn (no status-expiry event in the log). Confirm that's acceptable for the
  animation, or add a `statusExpired`/tick event if the HUD should match the post-tick pool
  at end of turn. `types.ts` TurnEvent, `playback.ts`.
- **Review-branch branch protection (relaying the Analyzer's flag 2).** If protection is now
  enforced on `code-review-h3mwjs`, the Analyzer will switch to docs-only commits on a fresh
  branch — no Builder action, noted here for the record.
- **Carried Designer/blocked items unchanged:** decoy (D1), duplicate picks, `combat_roll`
  path-vs-teleport, cover-vs-Might, Support kit, roster-v1 §9 ENGINE ASKs — do NOT build
  without a ruling.

## Movement batch — MV1-fix, MV3 (Builder, 2026-08-17)

**(MV1-fix) Displacement ignores the displacing attacker's own body.** Per the edge-cases
ruling, a charge that passed *through* its victim and settled beyond it "isn't a wall — it
just passed through," so the victim's knockback must not treat the charger's landing square
as an obstacle. `Displacement` now carries `attackerId` (threaded from both the dash and
blast call sites); `applyDisplacements` excludes that unit from the mid-path blocker so the
victim may *cross* the square the charger settled on. **Judgment call (co-occupancy
invariant wins).** The literal "ignore the body" fix co-occupies for an amount-1 knockback
that lands exactly on the charger (Bastion's Ram Charge: victim (5,7) knocked 1 east onto
the charger's (6,7)). Golden-rule #1's "no two units at rest on one square" is
non-negotiable, so the victim may cross the charger but never *end* on it: when its furthest
reachable square is the charger's own, it stops one short. Consequence: the amount-1
Ram-Charge case still shows no *net* displacement (documented, not silently dropped) — the
general amount≥2 case now displaces correctly (new `ram` fixture in `dash.test.ts` proves
the victim crosses the charger to the free square beyond). Fully landing an amount-1 victim
beyond the charger needs the Designer's charge-combat ruling or vector-sum displacement (CL2).

**(MV3) 8-direction movement with the AR cost model.** Supersedes the 2026-08-11
orthogonal-only ruling and the old GAME_SPEC §3 wording (both updated). `board.ts` adds
`MOVE_STEPS` (8 dirs, fixed clockwise order), `DIAGONAL_STEPS`, `isAdjacentStep`,
`isDiagonalStep`, and `diagonalCornerBlocked`; `ORTHOGONAL_STEPS` stays as the basis for
*vision* and *cover* adjacency (unchanged — vision is still Chebyshev, cover still
orthogonal). Cost model: orthogonal = 1; the k-th diagonal along a path costs 2 when k is
even, else 1 ("every second diagonal costs 2"). `reachableSquares` is now a shortest-cost
search (Dijkstra over a small integer bucket queue) whose state is `(square, parity of
diagonals used)` — parity is the only history the next diagonal's cost depends on, so the
state space stays finite, integer, and deterministic (no floats; the "~1.5" is realised as
the 1/2 alternation). Within each cost bucket, parity 0 (cheap-next-diagonal) is finalised
first so per-square `from` links form a coherent min-cost tree and `reconstructPath` yields
a legal path of exactly the reported cost (locked by the agreement test). Corner-cut
default: a diagonal is illegal if *either* orthogonally-adjacent square it passes between is
wall/cover (units never block a corner). `validateMovePath` accepts diagonals, computes cost
with the parity model, and gained `notAdjacent`/`cornerBlocked` error codes (renamed from
`notOrthogonal`). `runMove` re-clamps a planned path by *cost* (new `pathWithinBudget`) so a
Blast-phase Slow shortens diagonal paths correctly. `stepMovers` is untouched (already
direction-agnostic; contested-square + 2-cycle no-swap invariants hold for diagonal steps
too). **Scope note:** dash *charge* paths (`shape: "path"`, `aimIsLegal`) stay orthogonal
this session — the diagonal model is Move-phase movement; extending charges to diagonals
touches the held charge-combat ENGINE ASK and is left for a Designer ruling.

## Open Questions for the Analyzer — 2026-08-17 (movement batch)

- **MV1-fix residual (amount-1 charge knockback → Designer).** A charge whose knockback
  distance equals its overshoot lands the victim exactly on the charger's square; the
  co-occupancy invariant forces "no net displacement" there (Ram Charge). Ruling wanted:
  should such a victim (a) stay (current), (b) be carried *through* the charger to the far
  side (amplifies knockback by the overshoot), or (c) swap with the charger? This is the
  same ENGINE ASK as charge damage targeting — bundle the ruling. Files: `resolve.applyDisplacements`,
  `dash.test.ts` (`ram`/`charge` fixtures), `real-characters.test.ts` (Ram Charge).
- **MV3 corner-cut default — confirm against AR.** Adopted "illegal if either flank is a
  solid" (terrain only; units never block a corner). The edge-cases ruling flagged this as
  an AR detail to confirm. If AR permits single-flank corner-cuts (or blocks on units too),
  say so and I'll adjust `diagonalCornerBlocked` + tests.
- **MV3 dash charges stay orthogonal (flag).** Move-phase movement is now 8-directional but
  charge paths are still orthogonal-only (`aimIsLegal` `path` case). If charges should also
  go diagonal, that rides on the charge-combat ruling above; confirm intent.
- **Diagonal X-crossing during simultaneous Move (noted).** Two units swapping *diagonally*
  through a shared corner (A (0,0)→(1,1), B (1,0)→(0,1)) is currently allowed (pass-through
  model; only the orthogonal 2-cycle edge-swap is blocked). Confirm that's the intended AR
  behaviour, or extend the no-swap check to diagonal crossings. Files: `resolve.stepMovers`.
- **Carried forward:** MV2 AR-wiki verification still pending (egress blocked); playback
  shield during-turn vs post-tick (S1); decoy (D1), duplicate picks, `combat_roll`
  path-vs-teleport, cover-vs-Might, Support kit, roster-v1 §9 — all still blocked on rulings.

## 2026-08-13 — The seven blocked Designer items, ruled (Designer)

All seven cross-role items carried in BACKLOG's "Blocked — needs a Designer ruling"
section since 2026-08-12 are now resolved in `docs/design/rulings-v1-blockers.md`,
written as blocks the Analyzer can lift into `edge-cases.md`. Summary of the calls and
why. **(1) A damaging charge hits the first enemy its path crosses** — not the
destination, not everyone — which confirms the shipped `walkCharge` behaviour rather than
changing it; breadth becomes a data knob instead of a rule, via an optional
`chargeHits: "first" | "all"` field (default `"first"`) so Kestrel's Tempest Run can sweep
without every charge doing so. Golden rule #2: a knob on an existing mechanic belongs in
data. **(2) Displacement skips the displacing attacker's square** rather than stopping
short of it, superseding the net-zero interim: the charger was already ruled transparent
to the victim's displacement *path*, so making it transparent to the *landing* is the
completion of that rule, not a new one. Swap was rejected for moving the victim backwards
along the knockback vector. **(3) The decoy is a static fake unit destroyed by any damage**,
living outside `state.units` in its own list so no existing phase loop, vision union or
win check needs an "is this real?" guard; it grants no energy and blocks nothing, because
its payoff is informational. **(4) Duplicate picks: unique within a team, mirrors legal
across teams** — intra-team stacking is the degenerate case (double-Support stall) and
cross-team mirrors cost nothing. **(5) `combat_roll` needed no data change at all**: the
engine already branches on `shape`, so `shape` is the authority for *how* a reposition
happens and the `teleport` effect only declares *that* the caster repositions. Deleting
the effect would have produced content that fails `validateAbility`'s non-empty-effects
check and silently cost the ability its energy-on-use — the contradiction was in the
reading, not the data. Wall-crossing stays Wisp's identity plus the supports' escape
budget; Firepower repositions stay grounded. **(6) Cover-vs-Might composition is confirmed
as shipped** (outgoing → cover → shields → HP): the alternative differs by at most one
point (Lance of Dawn with Might into cover: 28 vs 27) and no balance goal justifies the
churn. **(7) Support kits are unblocked** — both capabilities they waited on (effect
polarity, energy-on-use for beneficial abilities) shipped in the 2026-08-15 teams build,
and the original "healing an ally is meaningless in 1v1" deferral (2026-08-11) expired
when 2v2 became the default format. Reconciling roster-v1 §9 against what shipped closed
both of its ENGINE ASKs as superseded — the engine's `teleport`-as-neutral and
"any beneficial effect pays on use" readings are better than my drafts — and surfaced one
real gap: `untargetable` was missing from the effect-polarity table and is ruled
**beneficial**, making the table total over `EFFECT_KINDS`.
## Move-and-shoot + diagonal charges — MS1, MV4 (Builder, 2026-08-18)

**(MS1) Move and shoot in one turn (client UI).** The engine and `toUnitOrders` already
emitted a non-dash `ability` + a 4-square `movePath` together; only the hot-seat flow forced
exclusivity. `app.ts`: `selectAbility` keeps the drawn move for a non-dash ability (still
drops it for a dash — the dash *is* the move — and clears sprint); `selectMove` keeps a
non-dash ability when drawing a normal move, while Sprint (move-only, 8) and a dash both stay
exclusive with an ability. The preview paints move reachability + drawn path *under* the
ability's affected squares so both show at once; a dash shows no separate move preview. The
Move row surfaces the live budget from `movementBudget(unit, sprint)` (4 with an ability, 8
sprinting, 0 rooted, Haste/Slow-adjusted) and Sprint is disabled while an ability is
selected. Engine untouched. Tests (`targeting.test.ts`): a draft with both a non-dash ability
and a move round-trips to a `UnitOrders` carrying both (sprint dropped); the ability-turn
move previews at the 4-budget, a strict subset of the 8-sprint set.

**(MV4) Diagonal charge paths.** `aimIsLegal`'s `path` case accepted only orthogonal steps
while Move went 8-directional (MV3). It now accepts orthogonal OR diagonal adjacent steps
with the same corner-cut rule as `validateMovePath` (a diagonal may not cut a wall/cover
corner). Range stays a step count; charge cost / first-enemy behavior unchanged — only path
geometry widened (independent of the charge-*damage* Designer ASK). `walkCharge` and the
`direction8` knockback were already direction-agnostic. Tests (`dash.test.ts`): a diagonal
charge validates, passes through the crossed enemy, and rests beyond (its 1-square knockback
onto the charger nets zero per the MV1-fix interim); a diagonal charge that would cut a wall
corner is rejected and the unit holds.

**Skipped this session (optional/deferred), with reasons:**
- **CL1 (AR clash co-occupancy)** — the underlying rule is **PROPOSED, not RULED**, in
  edge-cases ("align only if playtests want it"). Golden rule: never implement an unlisted/
  non-final ruling. Needs the Analyzer to promote it PROPOSED→RULED first.
- **CL2 (vector-sum displacement)** — deferred + underspecified (no tie-break/order spec),
  and its one concrete benefit (the amount-1 Ram Charge net-zero) is owned by the bundled
  charge-combat Designer ASK. Note: in practice CL2 would *not* change the Ram Charge case
  (a single displacement summed is itself); it only matters for two concurrent displacements
  on one victim, which is rare in v1.
- **E2 (cover corner convention)** — already **ruled acceptable** as-is; no change required.

## Open Questions for the Analyzer — 2026-08-18 (MS1/MV4 batch)

- **MS1 has no DOM-level test (flag).** The move-and-shoot *flow* lives in `app.ts`, which is
  a DOM closure with no unit-test harness; coverage is at the pure boundary (`toUnitOrders`
  round-trip + `movePreview` budget). If you want the `selectAbility`/`selectMove` toggle
  logic itself tested, it needs a small pure extraction (e.g. a `nextDraft(action, draft)`
  reducer) — say the word and I'll refactor `app.ts` for testability next session.
- **CL1 needs promotion to build.** Confirm whether AR clash pass-through co-occupancy is
  wanted for v1; if so, promote the edge-cases entry from PROPOSED to RULED with the exact
  tie-break (both-passing continue / one-ending-wins / both-ending-both-stop) and I'll
  implement `stepMovers` + tests. Until then it stays skipped.
- **CL2 scope, if taken.** If you want vector-sum displacement, specify the summation for a
  victim under ≥2 concurrent knockbacks/pulls (component sum then single walk? clamp order?)
  so it stays deterministic. Reminder it does not resolve the amount-1 Ram Charge case (single
  displacement) — that's still the Designer charge-combat ASK.
- **Carried / still Designer-blocked:** charge damage targeting + amount-1 knockback resolution
  (bundled), decoy (D1), duplicate picks, `combat_roll` path-vs-teleport, cover-vs-Might,
  Support kit, roster-v1 §9. MV2 AR-wiki verification and the S1 playback-shield question
  were closed in the 2026-08-18 review.

## Designer-rulings engine batch — R1c, R1b, D1, R4/R7, MS1-test (Builder, 2026-08-19)

**(R1c) Displacement carries the victim past the displacer.** `applyDisplacements` walks
the line the nominal distance with the displacer's body transparent, then, if the victim
rests on the displacer's own square, advances one more (repeating while still on it); if the
square beyond is blocked it falls back to the last free square (net-zero). Supersedes the
amount-1 "stays put" interim. Ram Charge now knocks Vex past Bastion; wall-blocked variant
still nets zero.

**(R1b) `chargeHits: "first" | "all"`.** Added to `AbilityDef` (+ validation: literal-only,
`path`-shape-only). `walkCharge` returns all crossed enemies in path order; `runDash` applies
effects to the first (default) or all (`"all"`, Kestrel Tempest Run). Energy stays
once-per-use. `content.test.ts` now validates the full 9-char roster.

**(R4/R7) Content guardrails.** R7: `untargetable` moved into the Beneficial polarity row,
closing the hole so harmful/beneficial/neutral partition `EFFECT_KINDS` exactly; the three
sets are exported and a test asserts totality. R4: a behavioral test proves `shape` (not a
teleport *effect*) decides wall-crossing — a `path` dash is walked, a `square` teleport crosses.

**(D1) Decoy entity.** `DecoyState {id, teamId, pos, expiresOnTurn}` on `GameState.decoys`,
kept OUT of `units`. Spawns in Prep at the caster square; destroyed by any damaging ability
whose area covers it (no energy, no riders), by an enemy ending a Move on it, or by expiry;
blocks nothing, never a unit, no kill. `playback.ts` folds `decoySpawned`/`decoyDestroyed`;
client paints a ghost marker. **Judgment calls (flagged below):** (a) expiry = `castTurn + 1`
("end of next turn" per the explicit ruling; the "matching the 1-turn Stealth" parenthetical
reads looser — a 1-turn status covers only its cast turn, so the decoy outlives the Stealth
by one turn); (b) `decoyDestroyed` is emitted on *expiry* too, not just destruction, so the
client has a single removal signal; (c) decoy destruction covers area/dash damage, not only
Blast, to honor "any damage."

**(MS1-test) Pure `nextDraft` reducer.** Extracted the ability/move/sprint toggle from
`app.ts` into a tested pure reducer in `targeting.ts` (closes the MS1 DOM-untested flag).

## Open Questions for the Analyzer — 2026-08-19 (rulings batch)

- **Thorn (Support) has no dash — confirm intended.** Expanding `content.test.ts` to the full
  roster exposed that Thorn is the only kit with no dash-phase ability (Lumen, also Support,
  has one). I scoped the dash-answer guardrail to non-support archetypes rather than
  rebalance content. Confirm Thorn is meant to be dash-less, or add a dash to `thorn.json`.
- **Decoy lifetime wording (D1/R2).** Implemented expiry = end of `castTurn + 1` per the
  explicit "end of the next turn," which outlives the accompanying 1-turn Stealth by a turn.
  If you intended decoy = Stealth (cast turn only), say so and I'll set `expiresOnTurn = castTurn`
  (the playtest lever you named). `resolve.spawnDecoy`, `decoy.test.ts`.
- **Decoy destruction scope (D1).** I destroy a decoy on *Move-onto* (per the ruling) but not
  on a *dash* ending on it or a *knockback* onto it (both are repositions, not "a move").
  Confirm that's the intended reading, or widen the trigger. `resolve.destroyDecoysUnderEnemies`.
- **Decoy fog rendering is M3.** "Enemy sees the decoy as Wisp" needs per-team hidden info;
  the M2 hot-seat paints a neutral ghost marker for both sides. Deferred to M3 (item 21).
- **Carried / still Designer-blocked:** charge damage targeting beyond R1a/R1b (bundled),
  duplicate picks + cover-vs-Might + Support anti-stall are M3/playtest, not engine.

## Animation · Camera batch — A0, M2, D1-dash, A1, A2, A3 (Builder, 2026-08-20)

**(A0) Damage attribution.** `damage` gained `sourceUnitId` + `abilityId`, threaded through
all four damage paths. `TrapState` gained `ownerUnitId`/`abilityId` so a trap credits the
*unit* that placed it (it previously stored only the team). Delayed detonations credit the
original caster. Purely additive; no outcome change.

**(M2) Range cap.** `MAX_ABILITY_RANGE = 8` in `constants.ts`; `validateAbility` gained an
`isUltimate` flag (default **false**, so the cap is the safe default) passed only at the
character's `ultimate` call site. No shipped range changed.

**(D1-dash) Dash destroys a decoy.** `runDash` calls `destroyDecoysUnderEnemies` after the
phase resolves, passing **only units whose position actually changed** (compared against the
origin already captured for knockback). **Judgment call:** the ruling says a *voluntary*
reposition destroys; scoping to units that truly travelled keeps the knockback exclusion
honest even in the obscure case of a fizzled teleport by a unit parked on a decoy by an
earlier turn's knockback.

**(A1) Keyed nodes.** One `<g data-unit-id>` per unit, positioned by `transform`, with a
fixed child structure updated by attribute so both the group *and its children* survive a
frame. Children draw in local coordinates matching the previous absolute offsets exactly —
no visual change. Added **happy-dom** as a client devDependency: the AC requires asserting
real DOM node identity and the client's vitest environment was node-only.

**(A2) `choreograph()`.** Pure `TurnEvent[] → Cue[]`. Prep/Blast sequential (actors in the
log's emission order, disjoint ranges), Dash/Move simultaneous (shared start; a unit's own
steps still sequential). Deaths defer to the end of their phase; Blast displacements share
one beat after every ability cue. Impacts bind to their shooter via `sourceUnitId`, never
adjacency. One timing constant (`BEAT`); tests assert ordering/concurrency only.
**Scope call:** cues are emitted for the events A3 actually ships (phase, ability, move,
displace, impact, death, respawn, decoy). `heal`/`statusApplied`/energy events deliberately
get **no cue** — unlike `damage` they carry no source, so they cannot be placed against the
right actor in Blast (where all `abilityFired` precede all effects). `applyEvent` still folds
them into state; only their *animation* is absent. See OQ below.

**(A3) Cues played + camera.** `turn-player.ts` (state; skip == watch by construction),
`stage.ts` (the only renderer-specific file), `camera.ts` (pure framing). `squareFromPoint`
now uses `getScreenCTM().inverse()` + `DOMPoint` — the required fix, since the old
rect/viewBox maths returns wrong squares under any camera transform. Verified in a real
browser: phases advance, skip lands in the next decision phase, camera pans/zooms, no errors.
**Deviation from the spec, flagged:** the spec asks for HP bars/labels kept OUT of
`<g class="world">` so they do not scale with zoom, but it also forbids a rAF loop for the
camera. Those conflict: with the camera as a WAAPI animation the scale interpolates
continuously, and repositioning an outside-world overlay each frame requires exactly the rAF
loop the spec rules out. I kept bars inside the world (they scale mildly, consistent with the
accepted "tracking shot with mild zoom" tradeoff) rather than invent a third approach.

## Open Questions for the Analyzer — 2026-08-20 (animation batch)

- **HP bars scale with zoom (A3 spec conflict — needs a ruling).** "Bars outside `g.world`"
  and "camera via WAAPI, no rAF loop" cannot both hold; I kept bars in-world. Options if the
  scaling reads badly at playtest: (a) accept it, (b) counter-scale bars per cue with a
  discrete WAAPI animation, (c) allow a rAF loop for the overlay only. Files: `render.ts`
  (`buildUnitNode`), `stage.ts`, `camera.ts`.
- **`heal`/`statusApplied` have no source (A0 follow-up?).** They are unanimated for the
  reason above. If shield/heal flourishes are wanted, they need the A0 treatment
  (`sourceUnitId`/`abilityId` on those events); it is the same small, additive change. Files:
  `types.ts`, `resolve.ts` (`applySelfEffects`, the Blast benefits loop), `choreograph.ts`.
- **`MS_PER_BEAT` = 420 is a placeholder.** Pacing was explicitly deferred to playtest; it is
  one constant in `stage.ts`. Tune it there, not in the choreographer.
- **Decoys still have no keyed node.** They render as overlay rects, so they cannot tween or
  fade; the `decoy` cue exists and is unconsumed. Fine for v1, worth an item if the reveal
  should animate. Files: `stage.ts` (`paintDecoys`).
- **M1 and Thorn-dash are Designer/data items — NOT built this session**, per the role
  boundary (Builder does not write `data/`). Both are unblocked and waiting on the Designer;
  the M2 range cap that M1's geometry depends on has landed.
- **Carried:** CL1/CL2/E2 deferred; A4 blocked on the 2D-vs-3D decision (A1–A3 are
  renderer-agnostic — only `stage.ts` is renderer-specific, which keeps that door open).

## Metric · friendly fire · aiming · renderer batch — MET1, FF1, AIM2(+AIM1), RND1 (Builder, 2026-08-21)

**(MET1) Manhattan everywhere.** `board.ts` exports `distance` (= manhattan) as THE metric so
the choice is one decision, not a dozen call sites. Every diagonal costs a flat 2, so cost no
longer depends on path history and MV3's `(square, parity)` search collapses to a plain
integer Dijkstra. Move-4 = the 41-tile diamond, sprint-8 = 145, matching the AC. Vision is a
Manhattan radius and the brush/stealth exception narrowed to the 4 orthogonal neighbours. A
charge path spends `range` as a movement **cost** budget, so a range-4 charge affords two
diagonal steps. GAME_SPEC §3 rewritten. **Judgment call, flagged:** the teleport-strike's
"every enemy Chebyshev-adjacent to the landing" was LEFT Chebyshev — MET1 explicitly named
vision and movement and did not name it, and narrowing it to 4 neighbours would rebalance
Wisp's ult. Marked in the code.

**(FF1) Friendly fire on.** The harmful row stopped filtering by team; beneficial still
own-team. Energy stays enemy-only, a friendly kill moves no tally (`killUnit` skips when
killer team == victim team), traps stay team-safe. A teleport-strike now catches adjacent
allies (a directly-aimed area). **Judgment call, flagged:** a *charge* still selects victims
from enemies only — "the first enemy crossed" is R1a's selection rule, not an area filter,
and FF1 did not re-rule it. Changing it would silently re-rule R1a/R1b.

**(AIM2) Free rotation via a quantized integer step.** `AbilityOrder.aimStep` in [0,256).
**Design choice worth keeping:** the quantization is onto a **diamond** (|x|+|y| = 64), not a
circle — so `stepToVector` AND its inverse `vectorToStep` are both pure integer. That removes
trig from the *client* too: a drag is converted with the engine's own projection, so the two
can never disagree about which direction a drag meant. (The ruling only required the engine
be trig-free; this is strictly stronger and cheaper than a committed 256-entry table.)
Directional range = tile count along the axis, so rotation never changes reach; coverage is
centre-in/binary. Cardinal aims reproduce pre-AIM2 output exactly and stepless orders keep
click-to-aim, so nothing existing changed shape. Standing AIM2-guard test added.

**(AIM1) Deferred deliberately, not dropped.** AIM1 is the move path drawn as a stroked
polyline + endpoint marker — a purely renderer-specific visual. RND1 replaced the renderer in
this same session, so building it in SVG first would have been thrown away. The move path
renders (as highlighted tiles) and the data is all there; the polyline styling belongs in the
A3 re-spec's renderer pass. **Flagged below.**

**(RND1) Orthographic renderer.** Three.js `OrthographicCamera`; projection is a runtime
parameter (top-down 90 / isometric 35.264). `squareFromPoint` is now a ray/plane
intersection. Scene objects keyed by `unitId` (A1's principle in 3D). The renderer-agnostic
layer was reused verbatim — only the SVG-node and SVG-camera tests were deleted, because
their substrate is gone. Bundle 556 kB / 145 kB gz. **Verification note for the reviewer:**
`gl.readPixels` and `drawImage` off the WebGL canvas both return all-black false negatives
(the drawing buffer is not preserved); only a composited screenshot proves the scene renders.

## Open Questions for the Analyzer — 2026-08-21 (metric/FF/aim/renderer batch)

- **Teleport-strike adjacency stayed Chebyshev (MET1).** Wisp's Shadowstep still hits the 8
  surrounding squares while everything else is Manhattan. Confirm that's intended, or rule it
  to Manhattan-≤1 (4 neighbours) — it is a one-line change plus a Wisp rebalance question.
  `resolve.runDash`, `dash.test.ts`.
- **Does friendly fire extend to a CHARGE's target selection (FF1)?** A charge still strikes
  "the first **enemy** crossed". Under FF1 should it strike the first **unit** crossed (and
  what does `chargeHits: "all"` then mean — all units, or all enemies)? This re-rules
  R1a/R1b, so I did not assume. `resolve.runDash`, `walkCharge`.
- **AIM1's polyline visual is unbuilt** (see above). Fold it into the A3 re-spec's renderer
  pass, or schedule it as its own item now that the renderer exists. `renderer3d.ts`.
- **Cone widening under free rotation — playtest question.** A rotated cone uses the axis walk
  plus its perpendicular, which is faithful but can look slightly ragged at shallow angles
  (integer tiles approximating a rotated wedge). Worth a look at playtest; the alternative
  (a true half-plane test with a wider half-width) changes coverage counts.
- **Bundle is 145 kB gzipped** now that three.js is in. No budget is defined in CI — if one
  matters for Pages, say the number and I will code-split the renderer.
- **A1/A2/A3 re-spec is now unblocked** (RND1 landed). `choreograph` needs no change; the
  A3 work is re-targeting cue playback and the camera onto the renderer, plus the owner's
  amendments (corner phase label, spotlight-dim on Prep/Dash/Blast only, billboarded bars).
  Playback currently steps phase-by-phase with a plain pause — correct but untweened.
- **Designer/data items untouched** (M1, M1-4v4, Thorn-dash) — role boundary; all three are
  unblocked and waiting on the Designer.

## 2026-08-13 — readability batch (engine follow-ups, then the A3 re-spec)

**(BRUSH1) No fix was needed on either side — coverage was.** The Dev Note "you should be able
to dash into bushes" implied a bug. Probing found `blocksMovement(brush) = false` and brush
squares already `canStop = true`, and the client offers them because both the move preview and
dash targets come straight from `reachableSquares` with no terrain filter. So the ruling here is
that brush was already legal end-to-end, and the right deliverable is regression coverage
locking it (`brush.test.ts`, plus three client targeting tests) rather than a change. If the
reported behaviour still reproduces in play, it is a picking/interaction problem, not a rules
one — worth re-reporting with the square that refused.

**(A3) A `Frame` carries presentation only, and that is what preserves skip == watch.**
`sampleFrame(cues, t)` returns fractional positions, alpha, spotlight, lit area and impacts —
and deliberately **no HP, no aliveness, no kills**. Those still come only from folding events
through `applyEvent`. The invariant therefore needs no second code path to defend it: dropping
every animated frame lands on the identical board, because nothing in the animation layer can
reach the board. A test asserts the `Frame` key set to keep it that way.

**(A3) Playback shows the phase's post-fold view, tweened backwards from the cues.** A phase is
folded first, then animated, so HP and aliveness are final for the whole phase while positions
come from the cue timeline. The alternative — folding at cue granularity — would have meant a
second ordering of events beside `segmentByPhase`, i.e. a second place for skip and watch to
disagree. The visible cost is that a bar drops at the top of the phase rather than on the hit;
the deferred-death fade is what keeps a dying unit standing until it has fired.

**(A3) The auto-camera leans, it does not lock on.** Framing hard on each actor makes a Blast
with four shooters unreadable — you spend the phase re-finding the board. It takes 35% of the
pan, never zooms tighter than 85% of the board, and clamps so the frame stays inside the board.
The AC ("shooter ∪ ability area in frame") is satisfied by the clamp; the tight zoom was not
required and read badly.

**(A3) Free orbit binds to the secondary mouse buttons always, and the left button only in
free-orbit mode.** Click-to-select and camera-drag would otherwise compete for the same gesture.
A drag past a 4px slop swallows its own click in the capture phase, so an orbit never also
selects a square.

**(BUNDLE1) The budget fails CI rather than warning.** A warning printed by a job that passes
is a warning nobody reads. 300 kB against today's 145 kB is ~2x headroom, which is what makes
failing safe: you have to double the bundle to trip it, and the fix is to code-split the
renderer, not to raise the constant — the error message says so.

## Open Questions for the Analyzer — 2026-08-13 (readability batch)

- **Playback pacing is now one number: `MS_PER_BEAT = 460` in `app.ts`.** Prep and Dash are one
  beat each when nobody acts, Blast is one beat per actor. A four-shooter Blast is therefore
  ~2.3s and a full turn ~4s. That felt right in a scripted run but has never been played. If
  4v4 turns read as long, this is the single number to turn.
- **Bars are billboarded but unlabelled.** There is no character name or HP number on the board
  — only three bars (hp/shield/energy). Adding text means either a texture atlas or DOM
  overlays tracked against the camera each frame; both are real work and neither is in an AC.
  Say which you want before I build it.
- **The spotlight dims to 22% and hides the dimmed unit's bars.** It reads clearly, but it does
  mean you cannot watch an off-actor's HP during a sequential phase. If that matters at
  playtest, the cheap fix is to keep bars visible while dimming the body.
- **Free orbit persists across a projection change only until you press the projection button.**
  Picking Isometric/Top-down resets pitch and yaw, on the reading that the two presets exist to
  put the camera back. If players expect the projection button to keep their yaw, that is a
  one-line change.
- **`objectFor()` on the `Renderer` interface is now unused.** It was A1's hook for an external
  animator; the animator ended up inside the renderer (`setUnitAt`/`setUnitFade`). Happy to
  delete it, but it is the natural seam for A4's per-ability FX, so I left it.
- **RND1 render verification is still deferred but is no longer un-doable here.** I verified
  this batch with a scripted browser run and composited screenshots (spotlight dim, ability
  area, move line, mouse-follow aim, orbit) — that is how the `transparent`/`needsUpdate` bug
  was caught, which no unit test would have found. If you want it as a standing check, it needs
  Playwright as a devDependency and a CI job; say the word.
- **Designer/data items untouched** (M1, M1-4v4, Thorn-dash) — role boundary; all three remain
  unblocked and waiting on the Designer.

## 2026-08-13 — Maps M1 / M1-4v4 and Thorn's dash (Designer)

The three unblocked Designer/data items, built and verified against the real engine
validators. Full rationale in `docs/design/maps-v1.md`; kit change in `roster-v1.md`.

**(1) Spawn separation is a two-sided constraint, so both maps use exactly 13.** The floor
is max turn-1 threat (4 move + Vex's 8-range Rail Shot = 12, ultimates excluded because
they are energy-gated and cannot fire on turn 1); the ceiling is a range-2 Frontline's
turn-2 reach (sprint 8, then 4 + 2 = 14). 13 satisfies both with one square to spare, which
is why "just make the map bigger" is wrong and why **iron-basin keeps separation 13 despite
being a much larger board** — 4v4 gets more lanes, not more distance.

**(2) Wall versus cover is a functional split, not decoration.** Only walls block line of
sight, and only cover grants the directional 50% reduction. So the sightline-breaker pillars
that hide each spawn row are **walls**, and the central strongpoint they flank is **cover** —
making the central room defensible (its occupants get cover north and south) without making
it blind (they can still shoot along their own row). My first draft used cover for both and
lost the head-on sightline break; the existing vision test caught it, which is the argument
for the test having existed. Every spawn row on both maps is now wall-broken, and rows 5/9 on
duel-arena are left as deliberately open sniper alleys with nothing spawning on them.

**(3) Thorn lost the pull, not the heal.** The dash had to displace one of four abilities.
The auto, the trap (the Warden identity) and the heal (required by the Support 1v1
self-applicability rule — an ult-only heal does not satisfy it) are all load-bearing, so
**Lashing Vine was the only removable slot**. Bramble Stride (dash path 3, 10 damage + Root 1
to the first unit crossed) keeps the theme by landing *control* where the vine landed
*displacement*: the escape still leaves someone stuck to the floor in Barbed Sling range.
Side effect worth noting — the roster's displacement budget now belongs to Bastion and Ravok
alone, which is cleaner than it was. It uses only already-implemented effect kinds on an
existing dash pattern (Bullrush with root in place of knockback), so it is data-only as the
backlog specified.

**(4) Role-boundary note.** The map redesign made four hard-coded test assertions stale
(`board.test.ts` dimensions/probes, `real-characters.test.ts` spawn coordinates,
`vision.test.ts` sweep tally and spawn-to-spawn sightline). Golden rule #6 and the standing
session workflow both require a green suite before pushing, so I re-pointed those coordinates
— mechanical updates only, no new coverage and no logic change. The **new** tests the backlog
assigns (the roster-derived turn-1-threat guard, wiring `iron-basin` into `content.test.ts`,
and tightening the dash guardrail to all archetypes now that Thorn has one) are left to the
Builder, with the verified snippets in `maps-v1.md` §6.

## 2026-08-14 — UI batch (A0-heal, UI1–UI6, AIM1/UI4)

**(A0-heal) A self-cast names the caster as its own source.** Making `sourceUnitId`/`abilityId`
required on `heal`/`statusApplied` forces an answer for self-buffs. "The caster" is not a
placeholder to satisfy a required field — it is the true answer, and it keeps every consumer on
one shape instead of branching on "did anyone do this to me". The combat log then special-cases
only the *wording* ("Aegis healed for 20", not "Aegis healed Aegis"), which is presentation.

**(A0-heal) `dealtDamage` became a Map.** The reveal a damaging attack inflicts on its own
attacker needed an ability id, and the Blast gather step is the last place that knows which
attack landed. Keyed by attacker, valued by ability — no new pass, no new state.

**(UI1) Hover state is separate from the draft, and that is the item.** Previously the live
cone wrote straight into `draft.aimStep`, so looking and choosing were the same action. Now
pointer state lives in a `Hover` record that `renderPreviews` reads *instead of* the draft when
present. This is what lets the range envelope, the live cone and the committed order render at
once. Both hover and click resolve a pointed-at square through one function (`aimFor`), so what
you saw is what you committed by construction rather than by two code paths agreeing.

**(UI1) The range envelope includes wall squares.** The engine lets you aim a circle at a wall
(the neighbours still get hit), so an envelope that excluded walls would disagree with legality
— prettier, and a lie. Directional and area shapes use the Manhattan diamond `aimInRange`
accepts; a `path` ability's range is a movement-cost budget, so its envelope is
`reachableSquares`.

**(UI1/UI3) A locked character cannot be re-selected.** The ruling says a player switches freely
"until all are locked". Read plainly, locking is what ends editing for that character, so a
locked chip is disabled with a ✓ and Lock In auto-advances to the next unlocked one. If the
owner wants a read-only review of a locked character, that is a small addition — flagged below.

**(UI3) The HUD is keyed and updated in place for a correctness reason, not a performance one.**
`replaceChildren` swaps the node under the pointer, so the browser fires `mouseleave` on an
element that no longer exists and UI1's hover state is wiped by its own repaint. Keyed nodes fix
it structurally; a test pins node identity across updates.

**(UI6) Two things the log deliberately does not print.** `reveal` fires on every attacker every
turn they damage someone — a line each would drown the log, and the damage line above already
says they attacked. Movement, energy and phase events are dropped too: the owner asked for
damage and healing, and a move-by-move transcript is a different feature. Entries are never
re-sorted; the log's order is the engine's resolution order, and re-sorting would invent a
causality the turn did not have.

**(UI2) Directional shapes truncate to what they reached; disks do not.** `lineSquares` stops at
the first wall, so an untruncated beam carried on through it — visibly claiming shots pass
walls, the exact two-layer disagreement the item exists to prevent. A circle is different: the
engine drops a walled tile *without shortening the circle*, so keeping the disk whole is what
shows a corner was clipped. Depth is recovered as `max(|dx|,|dy|)` over the covered tiles, which
is exact for any rotation because `alongAxis` divides by the dominant component — no trig, no
projection error.

**(UI2) The cone's apex sits half a tile in front of the caster.** The engine's half-width at
depth `d` is `d − 1` tiles, i.e. `d − 0.5` out to the tile edge; that line reaches zero at
`d = 0.5`. Not an approximation — it is where the widening rule starts.

**(UI5) Readouts are DOM, anchored by projecting the world position to screen.** Sprites would
need a font atlas and would blur under zoom; `screenPosition` is just the inverse of the picking
ray the renderer already owns. They live 2.2 beats — longer than the one-beat cue that spawns
them — which is what makes "a unit that dies later in the phase still shows its numbers" true
against A2's end-of-phase death cue.

## Open Questions for the Analyzer — 2026-08-14 (UI batch)

- **UI1/UI3: a locked character is not re-selectable.** Ruled above as the plain reading of
  "switches freely until all are locked". If the owner expects to review (not edit) a locked
  character before the turn resolves, say so and I will add a read-only selection state.
  `app.ts` (`lockSelected`, the HUD switcher), `hud.ts`.
- **UI1: no explicit "un-commit".** Clearing an action is Clear (the old Hold), which blanks the
  whole draft. There is no way to drop just the move and keep the ability. Wanted?
  `app.ts` handlers, `targeting.nextDraft`.
- **UI6: the log has no filter and no cap.** It grows for the whole match. Fine at 15 turns;
  if 4v4 makes it noisy, the cheap levers are a per-tone filter or a max-entry window. Also,
  the log currently shows **both teams' events** — correct for hot-seat, but at M3 it will need
  the same hidden-information treatment as orders. `combat-log.ts`, room layer.
- **UI2: cone raggedness is now visible, which is a feature and a question.** The continuous
  wedge sits over tiles that only approximate it, so at shallow angles you can see individual
  tiles poking out. That is the honest picture; whether it reads as *deliberate* is a playtest
  call. The old flag about cone geometry stands. `targeting.shapeOutline`, `shapes.coneSquares`.
- **UI5: readouts do not stack when several land on one unit in one beat.** Each is keyed by
  (unit, kind, amount) and positioned by age, so two simultaneous same-kind numbers of different
  amounts overlap slightly rather than queueing. Visible only in heavy 4v4 AoE; say if it
  matters. `app.showReadouts`.
- **UI5 covers `damage`/`absorb`/`heal`/`shield` only.** Non-shield statuses (slow, root, might)
  get a combat-log line but no floating readout, since the AC named three. Status icons were on
  the observed-not-requested list, so I did not invent one. `animate.sampleFrame`.
- **HUD reserves a fixed 260px and the log a fixed 300px.** Below ~1100px wide the board gets
  cramped and there is no responsive breakpoint. Worth an item if the owner plays on a laptop.
  `index.html`, `app.sizeToContainer`.
- **RENDER-VERIFY is now clearly worth doing.** Every item this session was checked with a
  scripted browser run plus composited screenshots — hover envelope, live cone, dash line, both
  overlay layers, floating readouts, the HUD and the log. None of that is reachable from a unit
  test. It needs Playwright as a devDependency and one CI job; the harness is already in the
  environment.
- **Designer/data items untouched** (M1, M1-4v4, Thorn-dash all landed on main before this
  session; the follow-up tests `maps-v1.md` §6 assigns to the Builder — the roster-derived
  turn-1-threat guard, wiring `iron-basin` into `content.test.ts`, and tightening the dash
  guardrail to all archetypes — were **not** in this session's unblocked backlog set. Add them
  to BACKLOG if you want them next session.

## 2026-08-14 (later) — UI1-fix, M1-tests, RENDER-VERIFY, responsive + log cap

**(UI1-fix) The two-line disarm became a module, on purpose.** The fix itself is "set the
interaction to idle on a committing click", in both the aim and move branches. But the AC asks
for a regression test, and the decision it guards — hover previews a hypothetical, a click
commits and *stops* previewing — lived inside a closure in `app.ts` that needs WebGL to
instantiate. `order-mode.ts` now holds `Mode`/`Hover`, `hoverBoard`, `afterCommit`,
`previewAim` and `previewMovePath` as pure functions, so a test can drive them exactly as a
player does: arm, hover, click, hover again, assert the painted aim did not move. The bug was
one arm of that split being wrong; it should not have been untestable.

**(UI1-fix) Re-aiming is by re-selecting, not by a second click.** Disarming means a stray
click after committing does nothing, which is the point of the dev note. `selectAbility`
re-arms, which UI1 already specified as "choosing another ability before Lock In replaces it".

**(M1-tests) The turn-1 threat is measured conservatively, and that is deliberate.**
`movement + longest non-ultimate range` over-estimates: Blast resolves before Move, so a shot
is fired from the pre-move square and movement adds nothing to its reach, and a dash's range is
its own travel rather than a bonus on top. A guard that is exactly tight fails on any Designer
nudge. **Both maps sit at separation 13 against a worst case of 12** — one tile of headroom.
That is the range cap working as designed, but it is not much; flagged below.

**(M1-tests) A third assertion ties the guard to `MAX_ABILITY_RANGE`.** The per-map check only
proves today's roster is safe. Asserting `separation > movement + MAX_ABILITY_RANGE` proves the
maps survive *any* cap-legal roster, which is what makes the guard useful to a future Designer
rather than a snapshot of this one.

**(RENDER-VERIFY) Not golden screenshots, and not PNG size either.** Byte size was the first
idea and is useless here — a flat frame and a full board come out within 20% of each other. The
frames are decoded (a ~40-line PNG reader, no dependency) and sampled for colour *families*,
relationships between channels, because everything is Lambert-shaded and no unit is ever
literally `#4f8cff` on screen. Two traps worth recording: `locator.screenshot()` captures the
element region after scrolling it into view and drags in page chrome — anti-aliased title text
was enough stray colour to keep a "no units drew" mutation passing, so frames are clipped to
the canvas box; and a first-draft `isTeamRed` also matched the orange aim overlay and the brown
of cover, quadrupling on any armed ability. The suite was validated by mutation (hide the unit
groups → it fails with "team 0 units are missing"), not by counting assertions.

**(UI-responsive) The board measures its chrome instead of assuming it.** The HUD and log are
`position: fixed`, so they do not shrink the viewport. Two latent bugs fell out: `#log` and
`#controls` only received their layout when JS added a class, so the *first* fit measured an
unstyled full-width `<aside>` and collapsed the board to its minimum (classes now ship in the
markup, and the fit re-runs once both exist); and below 1100px the log becomes a horizontal
strip, where subtracting its *width* goes negative. Which axis the log costs is read off its
own box rather than branched on a pixel threshold, so the stylesheet stays the single source of
the breakpoint.

**(UI6-cap) A 600-line window, not the filter.** The backlog offers "a per-tone filter or a
max-entry window" *if* 4v4 proves noisy. No such signal has arrived, so I built only the part
that fixes an unconditional defect — an uncapped log grows the DOM for as long as the tab is
open — and left the filter alone rather than guessing at an interaction the owner has not asked
for. 600 lines is roughly three full matches, so nothing scroll-back-able is ever lost.

## Open Questions for the Analyzer — 2026-08-14 (UI1-fix / M1-tests / RENDER-VERIFY)

- **Turn-1 spawn safety has exactly one tile of margin** (separation 13, worst case
  `movement 4 + cap 8 = 12`) on *both* maps. It passes, and the conservative model means the
  true margin is larger — but any spawn nudge inward, or raising `MAX_ABILITY_RANGE`, trips it
  immediately. Worth the Designer knowing the constraint is this tight.
  `content.test.ts`, `constants.MAX_ABILITY_RANGE`, `data/maps/*`.
- **`iron-basin` is validated but unreachable.** `main.ts` still hard-codes `duel-arena`, so the
  4v4 map cannot be played. `maps-v1.md` §6 calls map selection an M3/lobby concern; confirm
  that is still the plan, or schedule a dev-only map toggle so it can be playtested before M3.
- **RENDER-VERIFY adds ~50s and a Chromium download to CI**, in its own job so the fast
  feedback is unaffected. If that is too slow for every PR, the cheap lever is running it only
  on pushes to `main` — say which you want.
- **The e2e suite pins `@playwright/test` to `~1.56`** because the sandbox's preinstalled
  Chromium is revision 1194 and only 1.56 matches it. CI installs its own browser so it does not
  care, but a minor bump will break local runs in this environment until the image updates.
- **UI-responsive shipped despite its "only if the owner plays on a laptop" gate.** The defect
  it describes (board cramped, no breakpoint) is unconditional, and the fix removed two real
  bugs in the fit. If the owner only ever plays full-screen this was cheap; no scope was added
  beyond the breakpoints.
- **UI6's per-tone filter was NOT built** — it is gated on "if 4v4 makes it noisy", and no such
  signal exists. Only the unbounded-growth cap shipped. Re-scope it if playtest asks.
- **No Designer/data items were in scope this session** (M1, M1-4v4, Thorn-dash all landed in
  PR #22). The dash guardrail is now tightened to all archetypes as `maps-v1.md` §6 asked.

## 2026-08-14 (fix) — the render job gates the Pages deploy

**What happened.** The `render` job added in PR #26 failed in CI (`Timed out waiting 120000ms
from config.webServer`), and because `deploy-pages.yml` fires on `workflow_run` of **CI** gated
on `conclusion == 'success'`, the Pages deploy for the #26 merge was *skipped*. A red render
job does not just show a red check — it silently stops the site publishing. That is worth
knowing before adding any further job to the CI workflow.

**Root cause.** Vite's preview server defaults to the hostname `localhost`; since Node 17 DNS
results are returned verbatim rather than IPv4-first, so on a GitHub runner it binds `::1` while
Playwright polls the literal `127.0.0.1`. Binding and polling the same literal address fixes it.
It passed locally because this sandbox resolves `localhost` to IPv4 first — the class of bug
that only appears on the runner.

**I did not un-gate the deploy.** "A red build can never publish" is the documented policy and a
broken renderer is exactly what should stop a release. But the coupling now means a ~280 MB
browser download from a CDN sits between every merge and the live page; the browsers are cached
to reduce that.

## Open Questions for the Analyzer — 2026-08-14 (deploy gating)

- **Should RENDER-VERIFY gate the Pages deploy?** It does now, by being in the CI workflow.
  Arguments both ways: a broken renderer genuinely should not publish, but the job depends on a
  CDN download and a headless GPU stack, so an outage there now blocks releases. Moving it to
  its own workflow un-gates it and is a one-line change — your call, since it is a change to the
  deploy policy rather than to the test. `ci.yml`, `deploy-pages.yml`.
- **The Pages site is currently one merge behind** (the #26 deploy was skipped). Merging the fix
  PR re-runs CI on main and the deploy fires normally; no manual step needed, but if you want it
  sooner, `deploy-pages.yml` still accepts `workflow_dispatch`.

## 2026-08-13 — Free actions and catalysts (Designer, owner directive)

Two new systems specced in `docs/design/free-actions-and-catalysts.md`; data written against
the final design and inert until the engine reads it. **Pulls catalysts forward from M6+**,
reversing DECISIONS 2026-08-11 — ability *mods* stay deferred, only catalysts move.

**(1) Free actions are defined by a rule, not a list.** An ability may be free only if it is
Prep phase, deals no immediate damage and grants no immediate HP, and has a deferred or
conditional payoff. The mechanic exists to make setup plays viable without losing tempo — a
trap turn is currently a turn you do not shoot, for a payoff that may never arrive — so
anything that decides the *current* exchange fails the test. Applied exhaustively to all ten
Prep abilities in the roster, exactly three qualify: **Vex's Overwatch Trap, Thorn's Snare
Bloom, and Wisp's Veil & Decoy** — the two trap layers and the stealth ambusher, which are
precisely the kits that pay a tempo tax to do the thing they are built around. Everything
else is excluded for granting immediate HP (Bulwark, Barrier Pulse, Mending Light, Verdant
Veil, Blood Frenzy) or immediate combat power (Stoke the Flame's Might, Slipstream's Haste).

**(2) Free is paid for in cooldown and energy, not left free.** Each converted ability takes
a cooldown increase (3→4, 2→3, 4→5) and drops to `energyGain: 0`, with "`free: true` requires
`energyGain: 0`" ruled as a **validation error** rather than a runtime special case — without
it a free action is strictly better in every dimension at once, and the ult clock accelerates
for nothing. All three remain clear net buffs; the cooldown is the honest tax. Wisp changes
most: free Veil means **Veil + Sprint 8**, repositioning while hidden. That is safe to give
away precisely because free-Veil-plus-attack is self-defeating — attacking breaks Stealth.

**(3) Catalysts: three slots, one per phase, once per match, all free actions.** Nine
catalysts, three per colour, each colour offering the same three-way choice — survive / deny /
accelerate — so the pick is a read on the matchup rather than a power ranking. **The whole
system needs no new `EFFECT_KIND`**: every catalyst is built from effects the engine already
implements. The one place that tempted a new kind was a flat energy grant (AR's Brain Juice);
`Brainwave` uses `Energized 3` instead — the same idea at zero engine cost, with the flat
grant left as an optional ask if playtests want it punchier. Catalysts are chosen, not bound
to a character, so selection belongs to the M3 lobby; until it exists every character gets
the default triad (Second Wind / Shift / Adrenaline) so the system is playable the moment the
engine lands.

**(4) Two ordering rulings the engine must get right, or the design silently breaks.**
Catalysts resolve at the **start** of their phase, before that phase's abilities — otherwise
a Blast-phase Might (Adrenaline, Overdrive) boosts nothing until next turn and the catalyst
is simply broken. And a free dash catalyst (Shift) does **not** consume the Move phase; it is
genuinely additive, which is affordable exactly because it happens once per match.

**(5) One free action per turn, counting free abilities and catalysts together.** The
conservative v1 call: it keeps a turn readable (one free action, one ability, one move) and
stops a single turn dumping a whole kit. Flagged as the designed first lever to relax.

**(6) Interim, documented not silent.** Until `free` is implemented the three converted
abilities read as ordinary Prep abilities on a longer cooldown with no energy — weaker than
they are today and weaker than designed, never stronger. That is the safe direction to fail
in, and it is the convention `chargeHits` already shipped under.

## 2026-08-14 — MOVE1 and HITBOX1 (Builder)

**(1) A move click that cannot be honoured routes as far as it legally can (MOVE1).** The
Dev Note reported that clicking an occupied square does nothing. Two different mechanisms
produced that one symptom: an occupied square *is* reachable but has `canStop: false`, so
`reconstructPath` returned a path ending on it and the engine rejected the whole order; an
out-of-budget square is simply unreachable and returned `null`. Both now fall back to the
**nearest legal stop** — minimum Manhattan distance to the click, ties broken by lowest path
cost, then y, then x, so the choice is total and deterministic. Clicking your own square
stays a deliberate hold. The engine rule ("you may not end your move on an occupied square")
is untouched; this is purely the client deciding what an unhonourable click *meant*.

**(2) A dash aim still requires an exactly reachable target.** Applying the same forgiveness
to charges would change **who they ram**, which is the whole decision a charge is. So
`pathTo` (forgiving, for the Move order) and `pathToExact` (strict, for `path`-shaped
ability aims) are now separate functions and the dash path uses the strict one.

**(3) HITBOX1 needed the *area* of each shape spelled out, not just the coverage rule.**
"A tile is hit iff the area intersects a half-tile circle at its centre" is only answerable
once you say what the area is. The three continuous regions chosen are the ones the old
discrete rules were approximating, so nothing about a shape's character changes — only which
tiles at its fringe count:
- **line** — the segment from the caster's centre to the point `range` tiles along the axis.
  A zero-width ray, so the covered band comes out exactly one tile wide.
- **cone** — a 45° wedge with its **apex half a tile in front of the caster**, capped `range`
  tiles along the axis. That apex is not a choice: the old "half-width is `d − 1` tiles"
  rule reaches zero width at `d = 0.5`, so it is where the engine's own widening already
  started (the client's Layer-1 outline has drawn it there since UI2).
- **circle** — a true disk of the ability's radius.

**(4) The boundary is inclusive: exactly half a tile away is a hit.** The Dev Note is
explicit ("if an AoE cuts at least halfway along the edge it's guaranteed to hit"), and an
inclusive `≤` also keeps the arithmetic integral — a strict `<` would make the answer depend
on ties that only exist because the lattice is exact. Cardinal cones sit on that boundary at
every row, so this is not a corner case: it is what makes a range-3 cone 3/5/7 tiles wide
instead of 3/5/5.

**(5) The whole predicate is squared-integer, never a distance.** Square roots and float
compares are exactly where two machines disagree, and a shape that covers one extra tile on
one machine desynchronises a match. So every test is a comparison of two squared quantities
scaled by a common integer factor. The cone needed the most care: shifting the origin to the
apex and scaling by `2m` turns the wedge into the triangle `(0,0) → (cap, ±cap)`, whose 45°
edges have direction `(1, 1)` — which is why distances are carried as **twice** the squared
distance, so `2·(perp/√2)²` is the plain integer `perp²`. Every predicate was cross-checked
against an exact floating-point reference over all 256 aim steps × the 8 compass directions ×
ranges 1–8 × the full offset box: **2,078,208 comparisons, zero mismatches**, with the 1,152
exact-boundary cases all resolving to "hit". Largest intermediate is 1.9e11, four orders
below 2^53, so nothing can silently lose precision. A `shapes.test.ts` signature folds every
shape at every aim into one `Math.imul` checksum, which is the cross-engine regression: no
refactor can move a single tile anywhere without changing that number.

**(6) A wall stops a line at its depth, and ties settle y-then-x.** Coverage is no longer
computed by walking outward one step at a time, so "stops at the first wall" needed
restating: candidates are sorted by their projection along the axis and the ray ends at the
first wall in that order. Two tiles the beam grazes at the same depth are ordered y then x —
arbitrary, but fixed, which is all determinism asks. Cones still drop wall squares without
occluding what is behind them (unchanged).

**(7) Coverage grew, and rebalancing is not mine to do.** The new rule is strictly more
generous — the shipped roster's four cones (all `range: 2`) go from 4 tiles to 8, a radius-1
circle from 5 to 9, radius-2 from 13 to 21, radius-3 from 25 to 37. Lines are unchanged.
That is a real balance shift and it belongs to the Designer; it is raised in this session's
Open Questions rather than absorbed by quietly editing `data/`.

## 2026-08-14 — VISION1 fog of war (Builder)

**(1) The client asks, it never derives.** The engine already models AR-style vision in full —
line of sight through cover but not walls, a Manhattan sight radius, brush concealment with
the adjacency exception, Stealth/Reveal, sight shared across a team. `fog.ts` calls
`visibleEnemiesForTeam` and `visibleSquaresForTeam` and paints the answers. There is
deliberately nowhere in the client for the vision *rules* to be wrong differently from the
engine's; if fog looks wrong, the engine is wrong and the fix is an engine test.

**(2) Corpses are not fogged.** A unit that died in front of you was revealed when it died,
and `teamCanSee` returns false for the dead — so a strict reading would have remains blink
out on the next turn's fog check. That reads as a rendering bug, not as information you lost,
so dead units are always drawn. Living enemies are the only thing fog hides.

**(3) Fog sits *under* the aim overlay, not over it.** You may shoot where you cannot see —
that is the whole tension of a simultaneous-turn game — so the ability preview has to read
over darkness. The fog layer is therefore the bottom-most tile layer, and it is the one layer
drawn at full tile size: inset like the others, it came out as a grid of lit seams.

**(4) At turn 1 the enemy team is invisible, on both shipped maps.** Spawn separation is 13
and sight reaches 6, so the first thing a playtester now sees is an empty half of the board.
That is faithful to the reference and it is what the Dev Note asked for, but it is a large
change to how the game *reads* on opening, so it is called out rather than buried — and
RENDER-VERIFY now asserts it in a real browser, which is where it was first noticed.

**(5) One-slot memo, because mouse-follow aiming repaints per pointer move.** `fogView` walks
every unit's line of sight, and AIM2-UX re-renders on every `mousemove`. State cannot change
mid-Decision, so the answer depends only on which seat is looking; caching on
`(state, team)` identity is exact rather than an approximation.

## 2026-08-14 — MAPTOGGLE (Builder)

**(1) A typo is an error, not a fallback.** `?map=iron-bason` renders "unknown map — try one
of: duel-arena, iron-basin" and refuses to start. Quietly loading `duel-arena` because you
mistyped the map you wanted to test is the one behaviour a dev toggle must not have: you get
a whole playtest session's data about the wrong map. Every problem is reported at once
rather than the first, so one reload fixes a URL with two mistakes in it.

**(2) Teams are dealt alternately from one catalogue.** `dealTeams` gives team 0 the even
indices and team 1 the odd. That reproduces the shipped 2v2 demo exactly (Vex + Wisp vs
Bastion + Aegis) from the same list that yields a mixed 4v4, so there is one ordering to
maintain instead of a table per format. Kestrel is the odd one out at nine characters and is
simply left off the dev list — deciding who plays is the M3 lobby's job, not a constant's.

**(3) Default seating is per format, and 2v2's stays asymmetric.** 2v2 keeps `[2, 1]`, the
three-player split this entry point has always shipped, because a seat handover only has a
bug to have when the two teams are seated differently — it is the arrangement most worth
exercising. Everything else takes the fewest seats the format allows so a solo playtester
does the fewest handovers. `?players=a,b` overrides either way.

**(4) Both shipped maps already seat 4v4.** `duel-arena` carries four spawn squares per team,
not two, so `?format=4v4` works on it as well — worth knowing, because the review framed
4v4 as an `iron-basin` feature. The map/format validation is still checked (and unit-tested
against a synthetic one-spawn map), because the next map added is the one that forgets.

## 2026-08-14 — CI-decouple (Builder)

**RENDER-VERIFY moved to its own workflow rather than being reordered inside CI.** The
Analyzer's ruling was "the Pages deploy gates on core CI, not on the render smoke test", and
the cleanest way to make that structurally true is for the render job not to be in the
workflow the deploy watches at all. `deploy-pages.yml` still fires on `workflow_run: [CI]`
concluding success — unchanged, no new gate to get wrong — and `CI` now contains only the
release gates: engine tests, typecheck, client build, bundle budget, determinism guard. A
comment in each of the three files says which side of the line it is on, because the failure
mode this fixes was invisible (a red render job **skipped** the deploy silently) and the next
person adding a job to `ci.yml` needs to know they are adding a release gate.

RENDER-VERIFY still runs on every PR and on `main`; a red check there is the guardrail. What
it no longer does is let a 280 MB browser download or a headless GPU hiccup stop an urgent
engine fix from shipping.

## Open Questions for the Analyzer — 2026-08-14 (MOVE1 / HITBOX1 / VISION1 / MAPTOGGLE / CI-decouple)

1. **HITBOX1 grew every area shape — the Designer needs to retune, or rule that they meant
   it.** Coverage is strictly more generous under the AR hitbox: the roster's four cones (all
   `range: 2`) go 4 → 8 tiles, radius-1 circles 5 → 9, radius-2 13 → 21, radius-3 25 → 37.
   Lines are unchanged. Damage numbers were tuned against the old footprints, so every circle
   and cone in the roster is now meaningfully stronger at the same cost. I did not touch
   `data/`. Is this a Designer pass on `radius`/`range`, or accepted as-is?

2. **A rotated cone now covers more tiles than an axis-aligned one — and that follows from a
   ruling I cannot change alone.** The standing MET1×AIM2 ruling meters directional range as a
   *tile count* along the axis, so at 45° one "tile" of depth is a diagonal step and the wedge
   is √2 longer in real distance — and area goes as the square. At `range: 2` (the whole
   shipped roster) that is 8 tiles axis-aligned vs 12 at 45°; at `range: 4` it would be 24 vs
   42. The old discrete rule hid this by counting a fixed 1+3+5+7 tiles at every rotation
   while spreading them over the same stretched footprint. Two options, both one-line:
   **(a)** accept it — rotated cones reach the same tile count and hit more, or **(b)** meter
   the wedge's *half-width* in Euclidean tiles rather than tile-count units, which narrows a
   diagonal cone's angle and makes its area near-rotation-invariant. I have shipped (a)
   because it is what the standing ruling literally says. Your call, and it wants an
   edge-cases entry either way.

3. **Fog makes the enemy team invisible at turn 1 on both maps.** Spawn separation is 13,
   `VISION_RANGE` is 6. That is faithful to the reference and to the Dev Note, but the first
   thing a playtester sees is now an empty half of the board with no indication anything is
   over there. Is that the intended opening, or does it want a turn-1 grace reveal / spawn
   markers / last-known-position ghosts (the AC put ghosts explicitly out of scope)?

4. **`iron-basin` is not the only 4v4 map — `duel-arena` has four spawn squares per team.**
   Review issue 2 framed 4v4 as an iron-basin feature; in fact `?format=4v4` works on both.
   Worth correcting in the backlog so 4v4 playtest is not scoped to one map.

5. **MOVE1's forgiving routing is client-side only, and deliberately not applied to dashes.**
   A move click that cannot be honoured now walks as far toward it as it legally can; a dash
   aim still requires an exactly reachable target, because re-routing a charge changes who it
   rams. If you would rather charges were forgiving too, that is a rules question — say so and
   it is a one-line change.

6. **`Kestrel` is not in the dev draft.** 4v4 needs exactly eight characters and the roster
   has nine, so the dev catalogue lists eight and Kestrel never plays through MAPTOGGLE.
   Deciding who plays is the M3 lobby's job; flagging it so Kestrel does not go untested by
   accident until then.

7. **The bundle is at 160.6 kB gzipped against a 300 kB budget** after MAPTOGGLE pulled in
   the second map and four more characters. No action needed; noting the trend since every
   future character is another JSON import into the entry chunk.

8. **`docs/design/edge-cases.md` has no HITBOX1 or MOVE1 entry.** Both were ruled in the
   backlog and the review rather than in edge-cases, and that file is the Designer's. The
   rulings as implemented are written up in this file under today's entries — they should
   probably be mirrored there by whoever owns it.

## 2026-08-14 — AoE footprints: CONE-B ramp, and circles fixed at the rule (Designer)

Answers backlog HITBOX-tune and supplies CONE-B's ramp. Every number measured against the
shipped engine on an empty board, not derived from prose. Full workings in
`docs/design/aoe-footprints-v1.md`.

**(1) CONE-B's ramp falls out of the measurement: `halfWidth(d) = d`.** Today's axis-aligned
cone covers 3 / 8 / 15 / 24 tiles at ranges 1–4, whose per-depth widths are 3, 5, 7, 9 — i.e.
exactly `2d+1`, which is the footprint of a wedge whose perpendicular half-width equals the
axial depth. So the ramp that preserves the owner-approved reach needs no table and no
division: the test is `perp² ≤ d²` in HITBOX1's ×2 integer lattice. Measured for context, the
inflation CONE-B removes is larger than the prose suggested — a range-4 cone covers 24 tiles
axis-aligned and **42 on the diagonal**, 75% more for the same number.

**(2) The circle half of HITBOX-tune cannot be done in data, so it is done in the rule.**
`radius` is an integer and the steps are far too coarse: an r2 circle either keeps its
inflated 21 tiles or drops to 9, against a pre-HITBOX1 target of 13. No integer lands on the
target, so the prescribed data pass would churn thirteen abilities to arrive somewhere still
wrong. The real cause is not the metric but that **the half-tile hitbox is added on top of the
authored radius** — `radius: 2` is drawn as a disc of radius 2 and then granted another half
tile, for a true reach of 2.5. Ruling: **an authored `radius` is the final footprint radius,
not the pre-hitbox region radius.** The engine derives the region as `r − 0.5` so composing
HITBOX1 returns exactly `r`, which reduces `circleSquares` to `dx² + dy² ≤ r²` — simpler than
what it replaces, still pure integer. HITBOX1's rule and its halfway guarantee are untouched;
only the interpretation of the authored number changes. Measured result: r1 and r2 land
**exactly** on their pre-HITBOX1 footprints (5 and 13), covering 12 of the roster's 13
circles; r3 goes 37 → 29 against an old 25, accepted for a single ultimate. **No data changes
anywhere**, which removes a thirteen-ability balance pass from the batch.

**(3) The principle worth keeping: a number in `data/` means the footprint you get.** Authored
values are the final reach and the engine derives whatever internal region produces it. The
alternative — data holding pre-composition values the engine then inflates — is precisely how
thirteen circles silently grew 48–80% without anyone editing a file. The CONE-B ramp follows
the same principle.

**(4) A live conflict surfaced, needing an owner call.** MET1 rules that `circle`/`square`
measure **Manhattan** distance to the aimed square; HITBOX1's circular hitbox test made
circles **Euclidean** discs. Both are RULED and they disagree, and nobody following either has
been wrong. Recommended resolution is **Euclidean** (superseding MET1's circle clause), because
HITBOX1's hitbox is itself a circle and a circular region composed with circular hitboxes is
rotation-invariant by construction — the same property CONE-B exists to restore for cones,
whereas a Manhattan diamond bakes in the axis bias we are removing. The alternative (Manhattan,
`|dx| + |dy| ≤ r`) restores all three counts exactly at 5 / 13 / 25 and is the same size of
change in the other direction. Either way **one of the two rulings must be marked superseded**
rather than left in quiet conflict.

## 2026-08-14 — Aiming is Euclidean; dashes get impact areas (Designer, owner directives)

Amends the same-day AoE ruling after measuring cone *reach* rather than only tile counts.
Full workings in `docs/design/aoe-footprints-v1.md`.

**(1) The cone inflation is length, not width — which corrects the ramp guidance I gave.**
Measured, a range-4 cone reaches **4 tiles on the axis and 7 on the diagonal** (furthest tile
5.66 vs 7.07 tile-widths). Range is metered as a count of lattice steps along the axis, so a
diagonal "range 4" is four *diagonal* steps = 5.66 tile-widths; length inflates by √2 and area,
scaling with length², by ~2× — measured 24 → 42 tiles. So `halfWidth(d) = d` is necessary but
**not sufficient**: with axial depth still counted in steps, the diagonal cone stays 41% longer
whatever the width rule says, and CONE-B's ±1 rotation-invariance AC is unreachable. The
acceptance test needs a *reach* check alongside the tile count — that is the check that would
have caught this.

**(2) Movement is measured in steps; aiming is measured in distance.** Both the cone and circle
problems are one root cause: lattice-step metering applied to projected geometry. Ruling: all
ability geometry is **Euclidean** — `line`/`cone` range, `circle`/`square` aim range, `circle`
radius, dash impact radii — while **movement, sprint, reachability and `path` dash length stay
Manhattan (MET1 unchanged)**. The split is principled rather than a compromise: movement is a
lattice walk where the step is the atom and a step count *is* the rule, whereas aiming projects
a continuous shape that should describe the same shape whichever way it points. It is also how
Atlas Reactor works — abilities are authored as continuous shapes (cones in degrees, ranges in
squares) over a tile grid, so rotation preserves area for free and AR never had this class of
bug. Determinism is untouched: every test remains an integer squared-distance comparison in the
existing ×2 lattice. One balance consequence, accepted and flagged: `circle`/`square` aim
regions become discs rather than diamonds, which is a modest buff at long range (range 6:
85 → 113 aimable tiles) with identical axial reach; directional shapes move the other way,
losing the diagonal over-reach that motivated the ruling. Vision is deliberately **not** in
scope — it is perception, not aiming, and changing it moves concealment balance.

**(3) Dash impact areas: `impact: { origin?, destination? }`.** Today a dash affects either the
first unit crossed or units adjacent to the landing; neither expresses "leap into the middle of
them and detonate." The new optional block gives a dash an AoE at its takeoff square, its
landing square, or both, with **Euclidean radii reusing `circleSquares` — no new geometry
code**. It composes with both dash models (a walked charge still hits the first body *and*
detonates where it stops), effects apply to the union with each unit affected at most once, and
absent `impact` is exactly today's behaviour. The architectural win is that **Shadowstep Strike
is the only `square` dash in the roster carrying damage** (audited), so it is the sole user of
the hardcoded Manhattan-1 teleport-strike adjacency; once it carries its own
`impact: { destination: 1 }` that branch can be deleted and the adjacency becomes a tunable
number instead of engine trivia. Applied to three abilities: Shadowstep (formalisation, zero
behaviour change), Aegis's Intercept (the shield now lands on allies at the destination —
"teleport to the ally being dived" previously arrived with nothing for them, which was the
Bodyguard hybrid failing at its one job), and Ravok's Bullrush (charge-and-detonate, radius 2,
knockback 2 → 1 because it now applies to an area and the kit's displacement budget allows one
displacement ≥2). Escapes were deliberately left alone — an escape that also deals AoE is not
an escape, it is an engage.
