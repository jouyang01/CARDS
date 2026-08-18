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

## 2026-08-26 — CONE-B (Builder)

**(1) The ramp is one tile of half-width per tile of axial depth, and that value is not a
balance call.** The ruling asks the Designer to set `halfWidth` so the axis-aligned footprint
matches the reach the damage was tuned against. A 45° ramp is exactly that value: with it,
an axis-aligned cone covers 3 / 8 / 15 / 24 tiles at ranges 1–4 — **tile for tile what it
covered before CONE-B**. So the Builder did not pick a number; it picked the one that changes
nothing on-axis, which is what the ruling asked for. A test pins those four counts.

**(2) The ramp is fixed in the engine, not a data field — retuning it is an ENGINE ASK.** The
45° edge direction is baked into the integer predicate (the `(1,1)` edge, the `2·perp² ≤ d2`
comparison, the corner at `(range, range)`). A general slope is derivable but pushes the
squared intermediates up by a factor of k⁴, which needs its own overflow audit. Nobody has
asked for a different cone angle, so the minimal compliant version hard-codes 45° and says so.
Raised in Open Questions.

**(3) A cone's range is now a Euclidean distance; a line's is still a tile count.** That
asymmetry is the ruling ("the `line` half stands"), and it is worth stating plainly because it
is the visible trade: a 45° cone no longer stretches √2 further than an axis-aligned one, so
it reaches fewer diagonal *steps* than it used to. That is the point — the extra reach was
where the extra area came from.

**(4) "Within ±1 of the axis-aligned count" is not attainable, and the test says what is.**
The AC asks for ±1. The covered set is the lattice points within half a tile of the region;
the region's area is now exactly rotation-invariant, so what remains is how the lattice
samples the **boundary band**, whose area scales with the perimeter and therefore with range.
The axis-aligned case is not the mean of that distribution — it is the bottom of it, because
the lattice lines up with the edges. Measured over all 256 quantized rotations:

| range | before: axis → worst | after: axis → worst |
|---|---|---|
| 2 | 8 → 12 (+50%) | 8 → 10 (+25%) |
| 3 | 15 → 25 (+67%) | 15 → 19 (+27%) |
| 4 | 24 → 42 (+75%) | 24 → 29 (+21%) |
| 8 | 80 → 150 (+88%) | 80 → 88 (+10%) |

The old excess grew **quadratically** with range; the new one grows with the perimeter. The
shipped roster's cones are all `range: 2`, where the spread is now +2/−0 tiles. The test
asserts the derived bound `[axis − 1, axis + range + 1]`, verified to hold for every one of
the 256 rotations at ranges 1–8, rather than a ±1 it cannot honestly claim. Flagged for the
Analyzer to confirm or re-spec.

**(5) Verification.** The integer predicate was cross-checked against an exact floating-point
reference (distance from the tile centre to the triangle) over all 256 aim steps × the 8
compass directions × ranges 1–8 × the full offset box: **582,912 comparisons, zero
mismatches**. Largest intermediate 3.7e13, comfortably below 2^53. Every comparison against
`|V| = √d2` is resolved by a sign guard plus a squared comparison, so there is still no
`Math.sqrt` and no trig anywhere in the engine.

**(6) The HITBOX1 cross-engine signature changed on purpose.** It is a golden value over every
shape at every aim; a deliberate change to the cone rule moves it. Regenerated in the same
commit, which is the point of having it — the number moving is the review signal.

## 2026-08-26 — VISION1-opening (Builder)

**The leak was not reproducible on any reachable configuration — but the code only avoided it
by accident, so it is now avoided on purpose.** Driving the shipped build in a real browser
and sampling the canvas from the first drawn frame onward, the enemy team never appeared:
zero team-1 pixels at every sample, on `duel-arena` 2v2/4v4 and `iron-basin` 4v4 (spawn
separation 13, `VISION_RANGE` 6, so no seat can see the other team at open). The reason it
held is worth writing down, because it is not a reason to rely on: `startHotSeat` runs
`renderer.start()` and `beginTurn()` inside the **same task**, so the first Decision frame was
painted before the first `requestAnimationFrame` ever fired. Any `await` landing between them
— a font, an asset, an M3 lobby handshake — would have reintroduced the full-board flash
silently, and nothing would have caught it.

So VISION1-opening ships as a structural fix rather than a bug fix: one `paintFog(team)` is
now the single place fog is applied, and it is called explicitly **before the render loop
starts**, so the opening frame is correct by construction rather than by scheduling. Tests
pin both halves — a client test that turn 1 with no orders hides exactly what a later turn
hides (and that both shipped maps open with the enemy team invisible in every format), and an
e2e that samples from the first drawn frame instead of settling for 600ms first, which is
precisely long enough to miss a one-frame flash.

If the owner saw the enemy team on open, the most likely explanation is a Pages build from
before VISION1 — worth confirming with them rather than assuming, since a fix for a bug that
was never there is a fix that can regress unnoticed. Raised in Open Questions.

## 2026-08-26 — CAT1 catalysts (Builder)

**(1) `free: true` outside Prep is legal exactly when `oncePerMatch` is set.** FREE1's
validation says free abilities must be Prep; CAT1 says every catalyst is `free: true` and
three of them are Dash/Blast. Both texts are in edge-cases, so this is a genuine conflict and
the minimal compliant resolution is the one the FREE1 ruling gives its own reason for: the
restriction exists because a *repeatable* free attack is too strong, and `oncePerMatch` is
precisely the property that removes that ("repeatable free Dash/Blast actions are the
catalysts' job — once-per-match, self-limiting"). So the check is now "Prep **unless**
oncePerMatch", `energyGain: 0` stays unconditional, and nothing else relaxed.

**(2) The catalyst pool reaches the engine as an optional fifth argument to `resolveTurn`.**
Catalysts are content, so they cannot live in `GameState`, and they are not on any character,
so `Roster` cannot find them. Widening `Roster` into an object would have touched 25 call
sites across 20 files and buried the actual change; an additive parameter touches none. With
no pool passed, a `catalyst` order is dropped exactly like any other unusable component —
deterministic, never a throw — so an older caller keeps working and simply has no catalysts.
A test pins that.

**(3) `data/catalysts.json` is a transcription, not a design.** The AC names the file and
assigns CAT1 to the Builder, but `data/` is the Designer's. Every value in it — the nine
catalysts, their effects, amounts and durations — is copied verbatim from
`docs/design/free-actions-and-catalysts.md` §2.2, and the file says so at the top. The
Designer owns any change. Flagged in Open Questions.

**(4) A range-0 catalyst with no aim targets its own caster.** Suppression is a `circle` of
range 0 centred on the caster, so the caster's square is the *only* legal aim — rejecting an
absent one would make it undeclarable, which is the kind of silent nothing this batch exists
to avoid. Scoped to catalyst planning; ordinary abilities are untouched.

**(5) A Shift is planned for, not planned around.** A Shift resolves at the start of Dash, so
everything the unit does from Dash onward happens at its landing square: the dash/blast
ability and the move path are validated from there, and only the Prep ability keeps the
original square. The ruling ("a Shift resolves before a dash ability the same unit declared")
means nothing otherwise — the dash would simply be dropped as non-adjacent. Because a
teleport can be blocked, `runDash` then checks the unit actually arrived and discards those
plans if it did not; and `runMove` re-checks that the first step is adjacent to where the unit
really is, so a Move can never become a second teleport.

**(6) When a free ability and a catalyst are ordered together, the catalyst yields.** The
one-free-action-per-turn rule needs a tiebreak and the ruling does not give one. A catalyst is
once per match and a free ability is on cooldown, so burning the catalyst is the worse of the
two mistakes to make on the player's behalf. It stays unspent.

**(7) `AbilityOrder.target` is now optional.** A `self` shape has nothing to aim at, and the
resolver already read it as `order.target ?? []`. Requiring an empty array to declare Fade or
Adrenaline was a papercut with no upside. Strict widening — no existing caller changes.

**(8) A Blast-applied Haste cannot extend the same turn's walk — flagged, not fixed.** Move
paths are validated against the pre-turn budget and only re-clamped *downward* at Move time,
so Overdrive's Haste can offset a Slow but cannot buy squares. That makes Overdrive read
slightly weaker than its description ("the Haste lands on the Move that follows it"). Fixing
it means validating moves optimistically and letting the Move-phase clamp be the only
enforcement, which changes move semantics for every ability — out of scope for CAT1 and not
the Builder's call. Pinned by a test so the behaviour is stated rather than discovered.

## 2026-08-26 — CAT2 catalyst UI (Builder)

**(1) A catalyst has its own draft slot, its own aim and its own overlay layer.** The MS1 trap
one layer up: if selecting a catalyst cleared the chosen ability, a catalyst could only be
used *instead of* your turn, which is the opposite of a free action — and it would look like
a working feature the whole way through, because the button highlights, the order sends and
the engine accepts it. So `OrderDraft` gains `catalystId` + `catalystAim` beside `abilityId` +
`aim`, `interaction.mode` gains a `'catalyst'` value, and the board paints a separate green
overlay. A Shift's destination and a Rail Shot's beam are two decisions on one turn and have
to be readable at the same time.

**(2) Re-picking the selected catalyst gives the slot back.** There is no other way to change
your mind: a catalyst is once per match, so a player who armed the wrong one needs to
un-arm it without clearing the rest of the turn. Swapping to a different one clears the old
aim, so a Shift destination can never be sent with an Adrenaline.

**(3) Spent slots keep their name and go dim rather than disappearing.** An empty box tells
you nothing about what you spent, and "what did I already use" is exactly the question a
once-per-match resource makes you ask. `spent` is read from the engine's `catalystsUsed`, not
inferred from the event log — a slot greyed out because an event was missed would be a lie
the player cannot argue with.

**(4) The pool is validated at startup like the map is.** `main.ts` runs `validateCatalysts`
and refuses to start on a bad pool, listing the problems. A catalyst that silently fails to
resolve is the worst outcome for a once-per-match resource, and the check costs nothing.

## Open Questions for the Analyzer — 2026-08-26 (CONE-B / VISION1-opening / FREE1 / CAT1 / CAT2)

1. **HITBOX-tune was NOT done — it is routed to the Designer, per your own note.** The item is
   `data/characters/*.json` only and both the Analyzer Note and the Spec Notes say the Builder
   must not set the numbers. Nothing in `data/characters/` was touched. The reach CONE-B
   preserves is today's axis-aligned cone footprint (3/8/15/24 tiles at ranges 1–4), so the
   Designer's cone retune should be measured against those, not against the inflated off-axis
   numbers. Circles are untouched by CONE-B and still carry the full HITBOX1 growth (r1 5→9,
   r2 13→21, r3 25→37) — they are the bigger half of the retune.

2. **CONE-B cannot hit "±1 of the axis-aligned count" and the test says what it does hit.**
   The region's *area* is now exactly rotation-invariant; what varies is how the lattice
   samples the half-tile boundary band, which scales with the perimeter and so with range. The
   axis-aligned case sits at the **bottom** of that distribution because the lattice lines up
   with the edges, so it is not the centre to be ±1 of. Measured over all 256 rotations: range
   2 → 8..10 (was 6..12), range 4 → 24..29 (was 20..42), range 8 → 80..88 (was 74..150). The
   shipped test asserts `[axis − 1, axis + range + 1]`, verified for every rotation at ranges
   1–8. Confirm or re-spec the tolerance.

3. **The cone half-width ramp is a fixed 45°, in the engine, not in data.** It is the value
   that leaves the axis-aligned footprint untouched, so it was not a balance pick — but the
   edge direction is baked into the integer predicate, and a different slope needs its own
   overflow audit (the squared intermediates scale as k⁴). If the Designer wants a tunable
   ramp, that is an **ENGINE ASK**, not a data change.

4. **VISION1-opening: I could not reproduce the leak.** Sampling a real browser from the first
   drawn frame, the enemy team never appears on any reachable config. The old code held only
   because `beginTurn()` ran in the same task as `renderer.start()`; it is now explicit, so it
   holds on purpose. Worth confirming with the owner whether they saw it on a Pages build from
   before VISION1 — a fix for a bug that was never there is a fix that can regress unnoticed.

5. **`free: true` + non-Prep now requires `oncePerMatch`.** FREE1's ruling says free abilities
   are Prep-only; CAT1 ships three free Dash/Blast catalysts. Both are in edge-cases, so the
   conflict is real. Resolved with the reason FREE1 itself gives — the restriction exists
   because a *repeatable* free attack is too strong — so the check is "Prep unless
   oncePerMatch". `energyGain: 0` stays unconditional. Please ratify or re-word the ruling.

6. **`data/catalysts.json` was authored by the Builder as a transcription.** The CAT1 AC names
   the file and assigns the item to me, but `data/` is the Designer's. Every value is copied
   verbatim from `docs/design/free-actions-and-catalysts.md` §2.2 and the file says so. The
   Designer should own it from here.

7. **The one-free-action tiebreak is mine and needs ratifying.** When a unit orders both a free
   ability and a catalyst, the ruling says at most one may resolve but does not say which. The
   catalyst yields and stays **unspent** — it is once per match, so burning it is the worse
   mistake to make on the player's behalf. CAT2's UI does not yet prevent ordering both.

8. **A Blast-applied Haste cannot extend the same turn's walk.** Move paths are validated
   against the pre-turn budget and only re-clamped downward at Move time, so Overdrive's Haste
   can offset a Slow but cannot buy squares — which makes Overdrive read weaker than "the Haste
   lands on the Move that follows it". Fixing it means validating moves optimistically and
   letting the Move-phase clamp be the only enforcement, changing move semantics for every
   ability. Out of scope here; pinned by a test so it is stated, not discovered.

9. **Shift changes where the rest of your turn happens, and that needed a rule.** A dash/blast
   ability and the move path are now planned from the Shift's landing square (only Prep keeps
   the original), because "a Shift resolves before a dash ability the same unit declared" means
   nothing otherwise. A blocked teleport discards those plans. **CAT2 does not yet preview
   this** — the client still aims the ability from the unit's current square, so a Shift +
   dash combination is orderable but not previewable. Flagging as the natural CAT2 follow-up.

10. **`AbilityOrder.target` is now optional** (a `self` shape has nothing to aim at). Strict
    widening, no caller changed — noting it because it is a schema change M3's wire format
    inherits.

11. **Catalyst selection is still the default triad for everyone.** `createMatch` assigns
    Second Wind / Shift / Adrenaline; the other six are shipped, validated and unreachable
    until the M3 lobby. Worth confirming that is still the plan rather than, say, a dev URL
    param in the meantime.
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

## 2026-08-27 — Track A geometry: AIM-METRIC, CONE-B, CIRCLE-FIX, DASH-IMPACT (Builder)

**(1) The line keeps its half-tile band; only its range becomes a distance.** AIM-METRIC makes
`line` axial depth Euclidean, and CONE-B's `perp² ≤ d²` would make a line (a zero-width wedge)
cover only tiles exactly on the axis — a rotated beam would hit almost nothing. So the band is
HITBOX1's, unchanged, and only the cap moved. The visible consequence, asserted rather than
left to be found: a **diagonal beam covers fewer tiles** than an axis-aligned one of the same
range, because its tiles are √2 apart. Reach is the invariant; count is not.

**(2) CONE-B needed no geometry change — the predicate already shipped in this branch was
exactly the re-spec.** `b² ≤ a²` with `a² ≤ range²·|V|²` in the `(a = P·V, b = V×P)` frame *is*
`perp² ≤ d²` with Euclidean axial range. What was missing was the acceptance check, now added:
the **reach**, projected onto the axis, lands within **0.5 tile-widths** of the axis-aligned
figure at every one of the 256 rotations for ranges 1–8. That is the check the tile count
misses and the one that catches the 4-vs-7 length bug.

**(3) The ±1 cone tile-count AC is not attainable, and the suite asserts the measured bound
instead.** The region's area is exactly rotation-invariant now; what varies is how the lattice
samples the half-tile boundary band, which grows with the perimeter and so with range. The
axis-aligned case is **the bottom of that distribution, not its centre** — the lattice lines up
with the wedge's edges, so `≤` picks up a whole extra row for free. Measured over all 256
rotations: r1 3..4, r2 8..10, r3 14..19, r4 24..29, r8 80..88. The suite asserts
`[axis − 1, axis + range + 1]`, verified for every rotation at ranges 1–8. Making it ±1 would
require moving the axis-aligned footprint off the owner-approved 3/8/15/24, which is a Designer
call, not a Builder one. Raised in Open Questions.

**(4) The line's reach check needed its own tolerance.** A beam is one tile wide, so its last
covered centre can sit up to √2/2 inside the endpoint — measured worst case 1.30 tiles at
range 8. The suite asserts **over-reach ≤ 0** (the hard half — over-reach was the bug) and
**shortfall < 1.5** (the soft half, which is the lattice rather than the rule).

**(5) A dash `impact` is an AREA, so FF1 polarity applies to it — and that changes one shipped
behaviour.** The deleted teleport-strike branch was a "directly aimed" strike and hit allies;
a blast radius is an area, and harmful area effects reach enemies only. So Shadowstep no longer
catches an adjacent ally. The same ruling is what makes Aegis's Intercept work: beneficial
effects reach allies in the blast, which is the Bodyguard fantasy the ability never delivered.
The caster is excluded from the ally pass and picked up by the existing self-effects, so nobody
is shielded twice. Asserted both ways.

**(6) `impact.destination` is centred on where the dasher ACTUALLY came to rest.** A charge that
passes through bodies and stops short detonates where it stopped, not where it aimed. The
alternative — blasting the ordered square — would let a player detonate on a square they never
reached. A test drives a charge stopped two squares short.

**(7) The blast is not previewed.** `expandShape` still returns the path (or landing square) for
a dash, so UI2's overlay shows no blast radius for an ability whose whole point is "leap into
the middle of them and detonate". Extending `expandShape` was not in DASH-IMPACT's scoped files
and would change what `a.area` denotes at plan time (aimed) versus resolution (actual rest), so
it is flagged rather than assumed. Raised in Open Questions.

**(8) `validateAbility` now rejects unknown `impact` members, but still accepts unknown
top-level `AbilityDef` keys.** The review suggested a general "reject unknown keys" pass. The
`impact` block is covered; the general pass touches every ability in `data/` and every test
fixture at once, so it is a separate item rather than a rider on this one.

## Open Questions for the Analyzer — 2026-08-27 (Track A + carryover)

1. **CONE-B's ±1 tile-count AC cannot hold; the suite asserts `[axis − 1, axis + range + 1]`,
   verified at every one of the 256 rotations for ranges 1–8.** The axis-aligned case is the
   bottom of the distribution, not its centre (the lattice lines up with the wedge edges). The
   **reach** half of the AC passes exactly — within 0.5 tile-widths everywhere. Confirm the
   count bound, or rule a different axis-aligned footprint (a Designer call).

2. **The line's rotation-invariance clause needs re-wording.** "(a) `line`/`cone` tile count
   within ±1 of axis-aligned" is unattainable for beams by construction: a diagonal beam's tiles
   are √2 apart, so a range-8 line is 8 tiles east and 5 on the diagonal. The suite asserts
   `[floor(range/√2), range + 1]` plus the reach cap. The *reach* clause is the meaningful one
   for lines and it passes.

3. **DASH-IMPACT is not previewed** (DECISIONS (7)). `expandShape` returns the path/landing
   square, so UI2 shows no blast radius. Natural follow-up item: either extend `expandShape` for
   `impact` (one authority, preview for free — but `a.area` then means "aimed" while the
   resolver blasts "actual rest"), or a client-side overlay. Needs a ruling on which.

4. **Shadowstep no longer catches an adjacent ALLY** (DECISIONS (5)) — the deleted branch was a
   directly-aimed strike, an `impact` is an area, and FF1 filters areas. Ruled as a consequence
   rather than a choice; flagging because it is a live behaviour change to a shipped ability,
   and Wisp already carried a rebalance flag.

5. **A general "reject unknown `AbilityDef` keys" pass is not done** (review 2026-08-27 issue 1).
   `impact` is validated; the general pass touches every ability and fixture at once, so it wants
   its own item.

6. **Track B and VISION1-opening are built on this branch, not on `main`.** The backlog lists
   them as carryover because PR #33 is still open — FREE1, CAT1, CAT2 and VISION1-opening are all
   implemented and tested here. Re-review them against the ACs on this PR rather than scheduling
   them again. Their open questions from 2026-08-26 (1–11) are still open — in particular the
   FREE1/CAT1 `free`+`oncePerMatch` conflict resolution, the one-free-action tiebreak, and
   `AbilityOrder.target` becoming optional.

7. **CAT2's parked "Shift teleport-preview" is ambiguous and half of it already exists.** What
   ships: selecting Shift arms a `'catalyst'` mode and a board click paints its destination in
   its own overlay layer. What does **not**: previewing a *normal ability* aimed from the Shift's
   landing square (the engine plans it from there — CAT1 — but the client still aims from the
   unit's current position). Confirm which one M3 owns; the shipped half is working and would be
   a regression to remove.

8. **Ravok's Bullrush is un-nerfed now.** Its `impact:{destination:2}` is live, so the playtest
   note "Ravok is temporarily undertuned" no longer applies — the knockback is still 2→1 as the
   Designer set it, but the AoE it was traded for now exists.

---

## 2026-08-28 — Builder: `untargetable` is enforced against aimed offence only (UNTGT1)

STATUS-AUDIT's AC required a regression test proving `untargetable` "blocks being targeted".
Writing it revealed that no damage path read the status at all: Fade and Shadowstep applied it,
`fireCatalyst` was the only reader, and a Blast aimed at an Untargetable unit did full damage.
GAME_SPEC §6 says "cannot be hit this phase/turn", so the rule exists — the engine simply never
implemented it, and the audit's job is to reveal exactly that. Fixed rather than reported,
because the AC asks for a passing test and a rule change was never involved.

The judgment call the docs do not cover is **scope**. Ruled: a unit carrying `untargetable` is
skipped by the entire HARMFUL half of an **aimed** ability — direct Blast, a dash's crossed
targets and `impact` blasts, a delayed detonation, and a catalyst — damage, displacement riders
and debuffs together, and the attacker earns no energy from it because nothing was hit. Splitting
that (blocking damage but landing the knockback) is not "untargetable", it is "half targetable".
Beneficial effects still reach it: hiding from attacks is not hiding from your own support.
**Traps are excluded** — edge-cases already holds placed hazards apart from directly aimed
attacks (they are team-safe and outside friendly fire), so an Untargetable unit that walks onto a
mine still takes it. That carve-out is the part worth a second opinion; see Open Questions.

## 2026-08-28 — Builder: status removals are logged, not derived (`statusRemoved`)

STATUS-AUDIT's client half needs an indicator that goes away when the status does. The event log
had `statusApplied` and no counterpart, so a client folding the log could only learn that Stealth
broke by re-implementing "taking damage breaks Stealth" — deriving game logic, which the
rendering contract forbids. Added `statusRemoved { unitId, status, reason: 'broken' | 'expired' }`,
emitted when Stealth is actually broken and for each status that expires at the end-of-turn tick,
and only when the status was really present. `removeStatus` now returns whether it removed
anything and `tickStatuses` returns the expired kinds, so neither caller has to re-inspect the
unit. This is additive to the log; no state, no ordering and no resolution outcome changed.

## 2026-08-28 — Builder: CAT-DASH-COST implemented under a dev overrule, uniformly per colour

**The conflict, stated plainly.** `docs/design/edge-cases.md` carries a shipped ruling —
*"RULED — A free dash catalyst (Shift) does NOT consume your Move. Genuinely additive."* — and
`docs/BACKLOG.md` files CAT-DASH-COST under "Blocked on Designer" with **"Do not implement before
the Designer rules."** The owner's Dev Note for this session says *"Dash Catalysts should not be a
free action,"* and the Analyzer's notes mark the item **DO NOT HOLD (DEV OVERRULE)**. Implemented
on that authority. The edge-cases ruling is now stale on this point; **the Builder does not edit
`docs/design/`**, so the Designer needs to retire it — flagged in Open Questions below.

**What shipped.** A Dash-phase catalyst spends the unit's Move, exactly as a dash ability does:
`planUnit` drops the walk and cancels Sprint for any unit that actually spends one. Shift 3 in
Dash *or* walk 4 in Move, never both. Prep and Blast catalysts are untouched and stay fully
additive — they never touched movement, so repricing them would be inventing a cost the directive
did not ask for. Free *abilities* are also untouched: FREE1's budget independence was never in
question, and a regression test pins that the change did not leak out of the Dash colour.

**The judgment call.** The Analyzer's PROPOSED recommendation was narrower — the Move cost for the
catalyst that *repositions*, with an open question about whether Fade and Unshackle (which move
nobody) also lose additivity. The directive names the **colour**, not Shift, so all three Dash
catalysts pay. One rule per colour is also the version a player can hold in their head: "yellow
costs your Move" is learnable, "yellow costs your Move unless it doesn't move you" is a footnote.
This is the more conservative reading of the directive and the *less* conservative reading of the
economy, so it is exactly the sub-question worth a Designer confirmation — noted below rather than
settled here.

**Client.** The cost has to be visible before it is paid, or it is just a bug: arming a Dash
catalyst clears the drawn move and disables Sprint, the HUD's move budget reads 0, and choosing to
move or sprint hands the catalyst slot back rather than silently voiding it. The CAT2 separate-slot
invariant is otherwise intact — a Dash catalyst still never touches the chosen ability or its aim.

## Open Questions for the Analyzer — 2026-08-28

1. **`untargetable` and traps (UNTGT1).** STATUS-AUDIT's AC required a test that `untargetable`
   blocks being targeted, and writing it found that no damage path read the status at all. It is
   now enforced across **aimed** offence — Blast, dash crossings and impact blasts, delayed
   detonations, catalysts — over the whole harmful half of an ability, with no energy for the
   attacker. **Traps are excluded**, on the reading that edge-cases already holds placed hazards
   apart from aimed attacks (team-safe, outside friendly fire). If the Designer wants "cannot be
   hit" to mean "cannot be hurt", the trap path is one `if`. Route it.

2. **CAT-DASH-COST contradicts a shipped ruling the Builder may not edit.** `edge-cases.md` still
   says *"RULED — A free dash catalyst (Shift) does NOT consume your Move. Genuinely additive."*
   That is now false in the engine, on the owner's directive and the Analyzer's DO-NOT-HOLD.
   The Designer needs to retire or rewrite that bullet, and the BACKLOG entry needs to leave
   "Blocked on Designer". Until then the docs and the code disagree in writing.

3. **CAT-DASH-COST sub-question, still open.** All three Dash catalysts pay the Move, including
   Fade and Unshackle, which reposition nobody. The directive names the colour rather than Shift,
   and one rule per colour is what a player can hold in their head — but the Analyzer's PROPOSED
   version was narrower, and Fade at the cost of a full Move may simply be unplayable. A balance
   call the Designer owns; the engine change is one condition either way.

4. **`statusRemoved` is a new event kind and the log schema is now wider.** Emitted for Stealth
   broken early and for every end-of-turn expiry. Nothing in resolution changed, but the combat
   log (UI6) does not render it and probably should — "Vex's Haste wore off" is exactly the kind
   of thing a player loses track of. Not scoped; raise it if you agree.

5. **Status pips are not pixel-verified.** The vocabulary (`status-pips.ts`) and the playback fold
   are unit-covered, and the row's centring maths with them, but nothing asserts the quads
   composite — they are billboarded meshes, not DOM, so RENDER-VERIFY's pixel families cannot
   isolate them the way FOG-ZORDER's brush test can. A dedicated colour family per pip would make
   it testable; worth it only if a pip regression actually happens.

6. **PREVIEW-NUMBERS shows nominal amounts.** Before Might/Weaken, cover, shields and now
   Untargetable. Deliberate — a plan-time preview cannot know what will be standing at resolution,
   since Adrenaline resolves at the *start* of Blast, after lock. Cover is the one modifier that is
   knowable at plan time and would change the number by half; if playtest reports the preview
   "lying" over a unit in cover, that is the first thing to fold in.

7. **PREVIEW-NUMBERS covers all three armed slots.** Ability, free action and catalyst, summed per
   unit and colour, on the reading that the player's question is what *their turn* does to a unit.
   The AC said "the action's area", singular. If the intent was ability-only, it is one argument.

8. **DASH-PREVIEW is a plan-time estimate and can disagree with resolution.** The disc is centred
   on the *aimed* landing square; a charge stopped short by a body detonates where it stopped.
   That is the ruled behaviour and the reason the disc is not folded into `expandShape`'s area,
   but it does mean the preview can be wrong in exactly the case a player most wants it right.
   Showing the truncated route's real end would need the client to re-run `walkCharge` against
   post-Dash positions, which it cannot know at plan time. Flagging, not proposing.

9. **Carried over, still open:** the FREE1/CAT1 `free` + `oncePerMatch` conflict resolution, the
   one-free-action tiebreak, and `AbilityOrder.target` becoming optional (Builder OQ 2026-08-26,
   1–11). None of this session's work resolved them.

---

## 2026-08-29 — Builder: STEALTH-CONFIRM found a real bug, and it is a data value

STEALTH-CONFIRM was written on the expectation that it would close Dev Note #4 with evidence.
It did the opposite, and the Analyzer's own AC anticipated this: *"If the e2e fails, this becomes
a real bug."*

**The render path is correct.** A stealthed Wisp is absent from the enemy's `fogView` while its
decoy is present and enemy-styled; from Wisp's own seat the real unit is drawn with a purple
marker beside it. DECOY-RENDER and STATUS-AUDIT bought what they were supposed to.

**The ability is nonetheless unobservable.** `data/characters/wisp.json` authors Veil & Decoy's
Stealth as `duration: 1`. GAME_SPEC §6 ticks durations at end of turn, and a duration-1 status
"covers exactly the turn it was cast" — so a Stealth applied in Prep is removed by that same
turn's tick. The enemy's next look at the board is the following Decision phase, by which point
it is gone, while the decoy (which expires on `cast turn + 1`) is still standing. The enemy is
shown a Wisp *and* a decoy in the same square, which reads exactly like "Stealth is not working".
For a status whose only job is to change what the enemy sees on *their* turn, one turn is one
turn too short.

**Not fixed here.** The duration is a roster value and balance is the Designer's ("never
rebalance"). Pinned instead as a regression test naming the value, plus a counterfactual that
hands the engine the identical ability at `duration: 2` and shows the enemy stops seeing Wisp —
so the diagnosis is demonstrated rather than asserted. Both fail the moment the value changes,
which is when they should be re-read. Routed in Open Questions.

## 2026-08-29 — Builder: two DECOY-RENDER bugs found while proving it in a browser

Both shipped in PR #37 and neither had a test that could catch it.

**The impersonated enemy wore the wrong colour.** `renderer3d` painted `asEnemy` decoys with a
hardcoded `palette.team1`. That is only right when the viewer is team 0. To team 1, a team-0
decoy came out in team 1's *own* colour and read as a friendly unit — the exact opposite of
impersonating an enemy, and a straight giveaway. `RenderDecoy`/`FogDecoy` now carry the placing
team and the colour follows it. The old fog tests could not catch this because they asserted the
view model, and the view model was right; only the renderer was wrong.

**The owner could not see their own decoy.** Veil & Decoy leaves the decoy on the caster's own
square, and the owner-view decoy was a body box the same size as a unit at the same position — so
it sat entirely inside Wisp and was invisible. It is now a purple ground plate wider than a unit,
which reads as a ring around its feet while co-located and stands on its own once Wisp moves off.
The browser test that found this asserts purple pixels are on the board after the cast.

## Open Questions for the Analyzer — 2026-08-29

1. **Veil & Decoy's Stealth is `duration: 1` and therefore unobservable (STEALTH-CONFIRM, Dev
   Note #4).** The one that needs a decision. Applied in Prep, gone by that turn's end-of-turn
   tick, so the enemy never sees it — while the decoy stands through the next Decision phase.
   `duration: 2` fixes it and a test demonstrates that; the value is in
   `data/characters/wisp.json` and it is the Designer's. Until it changes, Dev Note #4 stays open
   and STEALTH-CONFIRM is a *reproduction*, not a closure.

2. **Two DECOY-RENDER bugs fixed in this batch, both shipped in PR #37.** An `asEnemy` decoy wore
   a hardcoded `team1` colour (wrong for every team-1 viewer), and the owner's decoy was a body
   box co-located with its own caster and therefore invisible. Worth noting in the review because
   neither was catchable by the tests that item shipped with: the view model was right and only
   the renderer was wrong. RENDER-VERIFY caught both.

3. **AIM-RANGE refuses out-of-range clicks; it does not clamp.** The AC allowed either and called
   clamp-to-nearest-legal optional polish. Refusing is what shipped, matching how a `path` dash
   already behaves. If playtest reports it as unresponsive rather than as bounded, the clamp is a
   small change in `commitAim` alone.

4. **A `line`/`cone` click on your own square commits step 0 (east) rather than refusing.**
   Pre-existing AIM2 behaviour, pinned by a test in `aim-range.test.ts` rather than changed —
   it is not a range question and it is not in the item. Worth a ruling if a self-click should be
   a no-op.

5. **The range envelope follows the *armed* slot, one layer.** Only one slot can be armed at a
   time, so this covers the AC without three envelopes fighting for the same tiles — but a
   *committed* catalyst aim stops showing its envelope once you arm the ability. Confirm that is
   the wanted read; per-slot envelope layers are the alternative.

6. **Hovering a catalyst slot paints no envelope, only arming it does.** `hoverAbility` is wired
   to the hotbar buttons and the catalyst row reuses it for the tooltip, but the envelope keys off
   `findOnCharacter`, which does not know catalysts. Arming covers the Dev Note; hover parity is a
   small follow-up if wanted.

7. **`statusRemoved` log lines carry no source.** Nobody causes an expiry, and crediting the
   original caster for a clock running out would be wrong — but a Stealth *broken* by an attack
   does have an author the event does not carry. Adding one would be an engine change; flagged,
   not proposed.

8. **PREVIEW-FOG uses `fogView().units`, which includes corpses.** A dead unit is never a preview
   target (`previewNumbers` skips `!alive`), so this is currently harmless, but the gate is
   "drawn" rather than "visible" and those diverge if corpses ever stop being drawn.

9. **Carried over, unchanged:** the FREE1/CAT1 `free` + `oncePerMatch` conflict, the
   one-free-action tiebreak, `AbilityOrder.target` becoming optional (OQ 2026-08-26), and the
   PREVIEW-NUMBERS cover-adjustment question (OQ 2026-08-28 #6).

---

## 2026-09-01 — Builder: CAMO-REVEAL's reveal triggers, and what "using an ability" means

The ruled gate is "standing on brush OR carrying `stealth`", evaluated at the moment of acting, and
that part was unambiguous. Three sub-questions it did not cover, decided minimally:

**Using vs. landing.** The owner's wording is *"if you **used** an offensive ability"*, so the
trigger is the use, not the hit. A concealed unit whose Bola misses entirely is still revealed. This
only ever affects concealed units — the pre-existing reveal-on-*dealing*-damage is untouched — and
the alternative ("only if it connected") would mean a thicket that gives you away on a hit and hides
you on a whiff, which is not a rule a player could hold.

**Catalysts reveal regardless of colour.** The owner named catalyst use itself as a trigger, not
"harmful catalyst use", so Second Wind out of a thicket gives you away exactly as Suppression does.
A once-per-match burst is the kind of tell the rule is about.

**A catalyst's tile is read before its teleport.** Shift moves you, and the square that gives you
away is the one you acted from, not the one you land on. Reading it after would mean shifting out of
brush into the open erases the tell, and shifting into brush from the open invents one.

Also: a concealed unit that *deals* damage is revealed exactly **once**. The blast path records
harmful *use* during the gather loop and applies it only to casters the damage pass did not already
reveal, so one action never emits two `statusApplied(reveal)` events for one unit.

## 2026-09-01 — Builder: DASH-OCCUPIED part (2) implemented rather than deferred

The spec offered the choice and asked for it to be stated. Implemented, because it turned out not to
be invasive: `applyDisplacements` is already a self-contained function over `(draft, board, pending,
displaced, events)`, so clearing a landing square is one call with a one-element queue, placed in
`runDash` before the teleport. Deferring would have left a ruling with no executable meaning.

It changes **no current behaviour**: the guard fires only for a non-`path` dash whose def carries a
`knockback`, and no shipped ability matches — every roster teleport is knockback-free and charges
carry their shove as an area `impact`. A synthetic ability in the test fixture drives it.

Two judgment calls inside it. The shove is directed **away from the dasher's origin**, on the
reading that a body arriving at speed can only send you onward. And the occupant is displaced
**once**: the same `knockback` is in `a.def.effects` and would be queued again by the damage pass, so
the pre-landing shove records its victim and the later `collectDisplacement` skips it.

## 2026-09-01 — Builder: the camouflage tile is lit from state, not from a remembered square

CAMO-REVEAL's client half says "the tile you were standing on turned bright red … for the reveal's
duration". The engine's `statusApplied(reveal)` event carries no position, so "the tile it fired
from" is not something the client is told. Rather than invent a per-tile memory, the red tile is
read straight off state: a **living unit carrying `reveal`, standing on brush**. Derives nothing,
and it is gated on the same fog view as everything else, so it can never out a unit the seat cannot
see.

The visible consequence: a revealed unit that walks out of the thicket takes the red with it. That
is a defensible reading of "the tile you were standing on" and it is the only one available without
new state or a new event field. Flagged below — if the owner wants the square to keep burning after
the unit leaves, it needs either a position on the event or a client memory, and that is a spec
decision rather than a Builder one.

## Open Questions for the Analyzer — 2026-09-01

1. **CAMO-REVEAL red tile follows the unit, not the square (DECISIONS above, `fog.ts` `camoTiles`).**
   A revealed unit that steps out of the brush takes the red with it, because the `reveal`
   `statusApplied` event carries no position and I would not invent a memory for it. If "the tile you
   were standing on" must keep burning for the full two turns, the cheapest fix is a `pos` on the
   reveal event (engine, one field) — your call, not mine.

2. **CAMO-REVEAL fires on ability *use*, not on the hit landing (DECISIONS above).** A concealed unit
   whose attack whiffs is still revealed. Confirm — the alternative makes a thicket that gives you
   away on a hit and hides you on a miss.

3. **Catalysts reveal regardless of colour (DECISIONS above).** Second Wind from a thicket reveals
   exactly as Suppression does, since the owner named catalyst *use* as the trigger. Confirm.

4. **DASH-OCCUPIED (2) shipped, not deferred (DECISIONS above; `resolve.ts`
   `clearLandingWithKnockback`).** Zero roster abilities reach it; a synthetic fixture drives it. The
   shove direction (away from the dasher's origin) is a judgment call worth ratifying before a real
   skill is authored against it.

5. **`revealedView` has no `map`, so it reports no camo tiles and no ghosts (`fog.ts`).** Correct for
   its two callers (game-over, flat reveal) but the asymmetry with `fogView` is a trap for the next
   consumer. Worth either threading `map` in or renaming it to say it is the flat view.

6. **Ghost styling is alpha-only (`renderer3d.ts`, `GHOST_ALPHA = 0.22`).** Distinct from live (1.0)
   and dead (`DEAD_ALPHA`), but three states separated only by opacity may not read on a busy board.
   If playtest says so, a wireframe or a desaturated material is the follow-up — not scoped here.

7. **No e2e for ghosts or the red tile.** Both are new render styles and RENDER-VERIFY has caught two
   bugs that unit tests structurally could not. Neither is reachable from turn 1 of the default match
   (a ghost needs an enemy to enter *then leave* vision; the red tile needs a concealed unit to act),
   so both would need a multi-turn drive. Flagged as a coverage gap rather than built blind.

8. **Carried over, unchanged:** `statusRemoved` source attribution (OQ 2026-08-29 #7), the
   PREVIEW-NUMBERS cover-adjustment question (OQ 2026-08-28 #6).

## 2026-08-14 — Atlas Reactor parity audit across six systems (Designer)

Audited statuses, turn phases, vision, UI, map design and the scoreboard against AR at the
owner's request. Full findings and the decision list in `docs/design/ar-parity-v1.md` §7.
Sourced from the project's own (still unmerged) `atlas-reactor-reference.md`, plus
measurements; AR shut down in 2019 and the community wiki is unreachable from this
environment, so items I could not source are marked VERIFY rather than asserted as parity.

**(1) Turn phases are the system we copied most faithfully — no gaps.** Phase order,
simultaneous hidden planning, 4/8 movement, dash-forbids-move, displacement-cancels-Move and
emergent dash immunity all match. Two entries the AR reference still lists as open are stale
in our favour and should be closed: ground-vs-airborne dashes already exist as `path` vs
`square`, and free actions shipped as FREE1. The one genuine gap is **chase orders**, which
need their own edge-case rulings (chase-vs-chase, chase-into-occupied) and so are a decision,
not a spec.

**(2) Vision is the largest divergence in the project, and it is not a bug.** AR hides
*intent*, not *position* — all eight enemies are always visible, and only camouflage and
Invisible conceal. Ours hides position behind 6-tile fog. The project's own research already
flagged the cost: unseen enemies turn reads into coin flips, which feels like RNG in a game
whose pitch is "no RNG." Recommended resolution is to move `visionRange` into the **per-format
config** that already carries `killsToWin` and `turnLimit` — unlimited at 4v4 (AR parity, more
bodies to track), 6 at 2v2 (fog keeps small formats from going static). That settles it by
playtest rather than by argument, for the cost of one field.

**(3) The UI complaint is a viewport bug, not a HUD rebuild.** The client treats *the board* as
the application frame, so controls fall outside it; AR fills the viewport with the scene and
overlays the HUD on top, which is why nothing can be off-board there. The HUD module is already
structured for this, so the fix is layout and hit-target sizing (min 44×44 px). `iron-basin` at
22×19 is the case that exposes it — the bug gets worse as maps get bigger, which is the wrong
direction. This is the highest-value item in the audit: it is the only one a player hits within
ten seconds of opening the game.

**(4) No scoreboard exists anywhere** — not in the client, the backlog, or any doc. Most
notable omission: a player cannot see **turn X of Y**, and the turn limit is the clock the
entire Support anti-stall balance depends on. Damage and healing totals are not accumulated in
engine state, but since the event log is the rendering contract the client can fold them during
playback — so the useful half needs no engine change.

**(5) I broke my own map rule, and the measurement caught it.** The owner's principle — AR maps
never run too much cover, pillar or stealth in a row — is violated by **both maps I authored**:
brush corridors run 6 tiles on `duel-arena` and 8 on `iron-basin`. I built them as "concealed
flank routes," but an 8-long brush run is not a route with a concealment option, it is a lane
where a unit is unhittable for eight tiles. Proposed caps (brush ≤3, cover ≤4, wall ≤5
unbroken) with a content test to enforce them, and both maps are mine to fix.

**(6) Statuses match on the core set; the real gap is over-time effects.** Every CARDS effect
is instantaneous or a flat modifier, while AR has damage- and heal-over-time — confirmed
concretely by AR's Health power-up ("10 on pickup, +20 more over 2 turns"). Beyond power-ups
this is the standard counter to turtling, which CARDS currently answers only by out-positioning.
Two new effect kinds is exactly the sort of change golden rule #2 says needs an explicit
decision, so it is raised rather than assumed. An incoming-damage modifier ("Vulnerable") is
the natural pair but I could not source it, so it waits on the owner's recall.

## 2026-08-14 — AR parity: seven owner decisions, and a vision claim I got wrong (Designer)

All seven questions from the parity audit are answered; `docs/design/ar-parity-v1.md` §7 is now
a spec list rather than a question list. Recording the two things worth remembering.

**(1) I was wrong about AR's vision, and the owner's instinct caught it.** I claimed AR showed
every enemy position at all times and built a three-option recommendation on it. The owner
pushed back citing reveal-type tools, and checking found **Grey's hawk drone "grants vision
above and beyond what the character can see"** — a phrase that is meaningless unless characters
have a limited sight range. The failure was specific and worth naming: the research doc says
positions are *"broadly known"*, a deliberate hedge, and I hardened it into a hard fact. The
correction is happy — our 6-tile vision is **parity, not a divergence**, so the decision is "no
work," and the section now exists to stop a future session from "fixing" it. Two observations
are recorded but explicitly not scheduled: vision is a Manhattan diamond under MET1 (same axis
bias the aiming ruling removed), and we have no vision-*granting* tools (AR built a Freelancer
around it). Neither is wanted now. Note the near-miss — the **Probe** catalyst reveals
*camouflage* specifically, so it is consistent with the model I had and would not have caught
the error; it was the drone that did.

**(2) Content that fails validation does not ship, even when the design is approved.** DoT/HoT
was approved, so AR's **Regenergy** catalyst (heal-over-time) became designable — but
`healOverTime` does not exist in `EFFECT_KINDS` yet, and putting it in `data/catalysts.json`
would have made the shipped pool structurally invalid. So Regenergy is specced in the doc and
withheld from data until `DOT-HOT` lands, while **Fetter** (root) and **Probe** (area reveal)
ship now because they use kinds the engine already has. The pool is deliberately 3/4/4 rather
than a symmetric 4/4/4, and the tests assert that asymmetry with the reason attached — a
lopsided pool with an explanation is better than either invalid content or a silent wait.
Reaching AR's four-per-phase pool is the goal; getting there in two steps is the cost of not
shipping something broken.

**(3) The map rule I broke is fixed, but the guard is the real deliverable.** Both maps' brush
was re-cut from 6- and 8-tile runs into runs of 3, mirror symmetry and all the M1 invariants
re-verified (separation 13, sightlines wall-broken, no turn-1 spawn hit). The `content.test.ts`
guard enforcing brush ≤3 / cover ≤4 / wall ≤5 is owed by the Builder — without it the next map
reintroduces the same error, which is exactly how this one survived two review passes.

**(4) The decision timer goes to 40 s, away from AR's 20 s, deliberately.** A player may control
two characters, and since FREE1/CAT1 a turn can carry a free action, a catalyst, an ability and
a move. AR's 20 seconds was sized for a strictly smaller decision.

---

## Builder session — 2026-09-02

**(1) A Dash catalyst yields the ability slot, so CAT-DASH-FULL's "a free ability is still
allowed alongside" was implemented as-is rather than as an exception.** The AC's parenthetical
reads as though a Dash catalyst and a free ability can be declared together. The shipped
one-free-action rule (edge-cases, conservative v1) already makes them mutually exclusive —
`planUnit` spends the catalyst only when no free ability was declared, and the catalyst is the
one that yields, because burning a once-per-match resource by accident is the worse mistake.
I kept that exclusivity rather than carving CAT-DASH-FULL out of it: the parenthetical is best
read as "a free ability is not the thing CAT-DASH-FULL takes away", which is true — it is the
one-free-action rule that takes it, and that rule predates this one. Flagged for the Analyzer
below in case the owner meant to change it.

**(2) Over-time effects tick before durations decrement, and Might/Weaken do not touch a tick.**
`tickOverTime` runs at end of turn *before* `tickStatuses`, so a `duration: 2` effect pays out
on the turn it lands and the turn after — the same "covers exactly N turns" arithmetic every
other duration uses. Ticking after would silently cost every over-time effect its first turn.
`StatusInstance` gained an optional `sourceUnitId`/`abilityId`, stamped **only** on the two
over-time kinds (`authorOf`), so every other status instance keeps its exact `{kind, remaining}`
shape and nothing about `structuredClone`, the determinism hash or an equality assertion moves.
A refresh re-authors: a burn somebody else re-lit is their kill. Might and Weaken deliberately
do not modify a tick (ar-parity §7.1 flags it for playtest) — applying them would be a balance
call the Builder does not get to make.

**(3) A power-up pad resolves on occupancy, not on travel.** Pads settle at a single fixed point
at the end of Move, **after** chasers and the decoy sweep, and unconditionally rather than
inside the "did anyone move?" branch. A unit knocked onto a pad, or one already standing on a
pad the turn it respawns, has exactly as much claim to it as one that walked there — the
question a pad asks is "who is standing here", and answering "who walked here" would make a
knockback into a way to deny a pad rather than to take one. "Contested is impossible" needed no
tie-break of its own: Collisions already means two units stepping onto one square on the same
step leaves neither in it, so there is no tie, and the pad simply survives to next turn.

**(4) Pad flavours are a rule; pad placement is data.** `MapDef.powerups` places pads and the
Designer owns those squares and timings (the shipped ones are Builder placeholders at
`firstTurn: 2, everyTurns: 4`). What a Health pad *does* is not per-map, so `POWERUP_EFFECTS`
lives in `packages/engine/src/powerups.ts` as one three-entry table — retunable by editing three
literals rather than by finding the branch in `resolve.ts`. `GameState.powerups` is
append-on-take: it records only pads actually picked up, so the state reads as a record of the
match rather than as a copy of the map.

**(5) The engine's chase last-known record is written at the turn boundary, both ends.** The
edge-case ruling says "updated in end-of-turn processing"; the same ruling also says a target
seen at plan time but lost during resolution resolves to "the last square the team saw it, which
at turn granularity is its start-of-turn square". Those agree from turn 2 onward, because nothing
moves between turns — but on turn 1 there has been no end-of-turn yet, so every chase would have
silently dropped. `recordLastKnown` therefore also runs at the start of `resolveTurn`. I chose
that over special-casing turn 1: "the boundary view is recorded at the boundary" is one rule,
and "…except on the first turn" is a bug waiting to be rediscovered. The stored entry carries the
turn it was taken, which resolution does not need — it is there so a client can fade a ghost by
its age rather than inventing a decay of its own.

**(6) An order carrying both a `chase` and a `movePath` resolves as the chase.** The AC says a
chase is declared "instead of" a `movePath`, so a well-formed client never sends both and this is
only a question about malformed input. The chase wins because it is the more specific statement
of intent, exactly as a dash ability's reposition supersedes a walk. The client enforces the same
thing in `nextDraft`, so the two can never disagree about which one survived.

**(7) A chase stops at the last-known square as a consequence of how the route is chosen, not as
a special case.** `pathToward` takes the reachable square *closest to the goal*; every square
past the goal is further from it, so a chase cannot overshoot into the fog beyond. There is no
"and then stop" branch to get wrong, and the fog test asserts on the chaser's final **position**
rather than only on the event, so an implementation that read `target.pos` fails it.

**(8) The scoreboard counts `amount + absorbed` as damage dealt, and credits a kill to the unit
the preceding `damage` named.** A `death` event names a *team*, so a per-character kill count has
to come from somewhere; the immediately preceding `damage` is the same one-step attribution the
combat log already uses, and when nothing precedes it nobody is credited rather than guessed at.
Counting only the HP portion of damage would make a support look like they deleted damage from
the match rather than absorbing it, so the shielded portion counts too. Both are folded from the
event log with no engine change, per the item's own spec note.

## Open Questions for the Analyzer — 2026-09-02

1. **CAT-DASH-FULL's "a free ability is still allowed alongside" (decision 1).** The shipped
   one-free-action rule makes a catalyst and a free ability mutually exclusive, so a Dash
   catalyst turn carries no free ability either. I implemented the minimal compliant version
   (existing exclusivity kept, nothing carved out). If the owner meant that a Dash catalyst
   should be the exception — the one catalyst that *can* ride beside a free action — that is a
   change to the one-free-action ruling, not to CAT-DASH-FULL, and it needs an explicit call.

2. **Might/Weaken vs an over-time tick (decision 2).** ar-parity §7.1 flags it for playtest and I
   left it unmodified. Worth a ruling before a character is designed around a boosted burn:
   whichever way it goes, `tickOverTime` is where it lands and it is two lines.

3. **Power-up pad placement and timings are unreviewed Designer work.** Three mirrored pairs per
   map (one Health, one Might, one Energy) at `firstTurn: 2, everyTurns: 4`. The squares are
   plausible, not designed — the centre-line pairs in particular make the middle of both maps
   worth contesting in a way nobody has playtested. The `content.test.ts` guard asserts a pad's
   mirror exists with the same flavour and timings, so retuning is safe.

4. **Pads are invisible in the client.** PADS1 is scoped ENGINE + DATA and I did not widen it, so
   both shipped maps now carry pads that no player can see. The pickup shows in the combat log
   and nowhere else. A pad marker is the analogue of TRAP-INDICATOR and wants scheduling before
   anyone playtests the maps, or the pads will read as random buffs.

5. **A chase is drawn as a prediction, and the prediction can be wrong.** The client draws the
   route toward where the target is *now*; the engine resolves against where it ends up. That is
   inherent to the mechanic and I think it is correct — but the dashed orange line is the only
   thing on screen saying "this is a guess", and it may want a stronger tell after playtest.

6. **A chase against a target the chaser's team can see, but the *chaser* cannot, is legal.**
   `teamCanSee` is a team-wide question, which is the shipped vision model and what golden rule
   #5 protects. So a unit can chase somebody only its teammate can see. I believe that is right
   (vision is a team resource) but it is not explicitly ruled anywhere, and it is the kind of
   thing that reads as a bug the first time it happens in a playtest.

7. **SCORE1's kill attribution is the log's, not the engine's.** Per-character kills come from
   "whoever last damaged them"; the engine's own `kills` tally is per team and is what decides
   the match. The two can legitimately disagree — a friendly-fire kill scores for nobody in both,
   but a trap or DoT kill credits a team in the engine and a unit in the scoreboard. If a
   per-character kill count ever needs to be authoritative, that is an engine ask (a `killerUnitId`
   on the `death` event), not a client fix.

8. **The end-of-match `reason` is derived, not reported.** `matchResult` infers kill-target vs
   turn-limit vs sudden-death from the finished state, because the engine does not say. It is
   right for every case I could construct, but a `gameEnd` event carrying the reason would remove
   the inference entirely and is a one-field engine change if the Analyzer thinks it is worth it.

---

## Builder session — 2026-08-16

**(1) A pad marker is board state, so it draws under every planning overlay.** `PAD_LIFT` sits just
above CAMO-REVEAL's red thicket and below `range`/`reach`/`aim`/`impact`/`free`/`catalyst`/`chase`/
`select`. Same argument the camo tile already makes: a pad is terrain with a colour, not something
you are aiming at, so an AoE drawn over a pad has to read on top or the overlay is lying about what
it covers. A trap earns its near-the-top lift by being a warning; a pad is an invitation.

**(2) A consumed pad keeps its plate and loses its glyph.** Drawing a spent pad as *absent* would
make a square that is about to matter vanish from the plan — the respawn is the interesting part.
Dormant pads (before `firstTurn`) are deliberately faint: they are real but not yet worth walking to.

**(3) `padViews` takes no viewer.** Pads are public terrain and both teams see every one, so unlike
`fogView`'s traps and decoys there is no per-viewer variant. Adding a fog argument later would be
the moment a pad became hidden information the rules do not give it, so the absence of that
parameter is asserted by a test that puts a pad deep in one team's fog and expects it drawn.

**(4) `ViewState` gained `takenPowerups`, folded from `powerupTaken`.** Reading `state.powerups`
alone would keep a marker lit through the whole Move animation and darken it once the turn was over
— a beat after the only moment anybody was watching that square. The engine's record is the source
of truth for *respawn*; the event is the source of truth for *right now*.

**(5) Pad colours were chosen to sit outside every family the render tests match on.** Green reads
as lit brush, orange as the aim overlay, plain blue as a team-0 unit. Teal / magenta / cyan are the
unclaimed hues. `isTeamBlue` also gained a `g - r < 110` clamp so the cyan Energy pad cannot be
counted as a unit — a tightening, not a loosening: without it "team 0's units are on screen" would
pass on a board with no units.

**(6) The CAMO-REVEAL red tile is still not composited-tested, on purpose.** Reaching it needs a
unit to end a turn inside brush *and* attack; a blind browser drive that hunts for it costs two
minutes and then asserts a tautology, which is worse than no test. The `isCamoRed` predicate is
shipped and ready; what is missing is a way to seed a scenario. Flagged below.

**(7) The server's rules live outside the Durable Object.** `room.ts` (seat bounds, joins, leaves,
codes) and `hub.ts` (message handling, against an abstract two-method `Sink`) hold everything;
`durable-object.ts` is a fetch handler that makes a socket pair and forwards events. The test
harness is therefore plain Vitest with fake sockets rather than
`@cloudflare/vitest-pool-workers` — booting a Workers runtime would test Cloudflare's WebSocket
implementation, which is not ours, and needs an account the sandbox does not have. The spec allows
a DO unit harness; if the DO ever grows logic, that is the signal to move the logic out rather than
to add a runtime.

**(8) A socket is not a seat.** A connection that has not sent `join` occupies nothing and counts
against no bound. Otherwise opening connections would be enough to fill a room, and one
half-loaded client would lock everybody else out.

**(9) Seat bounds are derived from the format, and teams auto-balance on join.** 2v2's 2–4 and
4v4's 2–8 both fall out of `charactersPerTeam * 2`, so a format change cannot strand a stale table.
Balance is automatic because picking a side is M3-LOBBY's job and a room that fills 4–0 before the
lobby opens is a room nobody can start; the tie-break is fixed (team 0) so the same join order
always seats the same way.

**(10) Room-code randomness is injected, and the alphabet drops I/O/Q/U.** `mintCode` takes a byte
source — `crypto.getRandomValues` in the Worker, a counter in tests — so a minted code is a fact a
test can name rather than a shape it has to squint at. I/O/Q are misread as 1/0/O aloud and in a
sans-serif font; U is gone so no four-letter code can spell something the owner has to apologise
for. A code is **not** access control: that is M3-HIDDEN's per-team filtering.

## Open Questions for the Analyzer — 2026-08-16

1. **CAMO-REVEAL's red tile has no composited test (decision 6, RENDER-COVERAGE).** Everything else
   the item named now has one. Reaching camo needs a seeded scenario — a query-param or dev hook
   that starts a match with a unit already in brush, in the MAPTOGGLE family. Worth a small item, or
   worth accepting as unit-covered-only; either is defensible, but it should be a decision rather
   than a gap.

2. **`revealedView`'s rename (carried OQ 2026-09-01 #5) — I did not do it.** The Spec Note said
   "fold in if a client touch makes it convenient". The declaration already carries a doc block
   explaining exactly what it is and why playback gets it for free, so the confusion the OQ named is
   already addressed in prose; renaming would ripple through `app.ts` and `fog.ts` for no behaviour
   change. Recommend closing the OQ as documented-instead-of-renamed unless you disagree.

3. **Pad flavour colours are now load-bearing for the e2e suite (decision 5).** If the Designer
   retunes pad *colours* (not squares or timings — those are safe), `isPadTeal` and the
   `isTeamBlue` clamp need to move with them. Worth a line in the Designer's routing note so the
   coupling is not discovered by a red suite.

4. **M3-PROTOCOL is next and I did not start it** — the session cut line was PADS-INDICATOR +
   RENDER-COVERAGE + M3-ROOM, and starting a half-item was the worse option. `hub.ts` is where it
   lands: it already owns the joined-seat set and the broadcast, so submission, lock-tracking and
   the merge to two `PlayerOrders` attach there. Two things want ruling first:
   - **Where does the control map live?** `Seat` currently has no `unitIds`. ARCHITECTURE §45 says
     the DO stores it, and M3-LOBBY assigns it — so M3-PROTOCOL needs an interim (assign on join?
     assign on start?) or it cannot address orders to characters at all.
   - **Does `mergeSeatOrders` move out of the client?** The Spec Note says "reuse ... if it factors
     cleanly into the engine or a shared util". It is currently `packages/client/src/hotseat.ts`,
     and the server may not import the client. My read: it belongs in the **engine** as a pure order
     utility, but that widens the engine's surface, so it is your call.

5. **`GameState` is not yet persisted by the DO** — `durable-object.ts` stores only the room record.
   M3-PROTOCOL adds the authoritative state, and M3-RECONNECT wants the order history alongside it
   (ARCHITECTURE §77). Worth deciding at M3-PROTOCOL whether the DO stores state-per-turn or
   initial-state-plus-orders, because reconnect's cost depends on it and retrofitting is a migration.

6. **No end-to-end proof the Worker runs under a real Workers runtime.** Everything is unit-tested
   through the `Sink` seam and typechecked against `@cloudflare/workers-types`, but nothing has
   booted miniflare or `wrangler dev` — the sandbox has no account and the spec said local-only. The
   first time this runs for real will be M3-DEPLOY. If you would rather find integration problems
   earlier, a `wrangler dev` smoke check is a small item to schedule before then.

---

## Builder session — 2026-08-16 (second)

**(1) A LINE's reach is a distance, not a tile count.** `rotation-invariance` asserted a beam covers
at most `range + 1` tiles. That held at `AIM_STEPS = 256` by luck, not by geometry: at 512 a slope
just off 1/2 walks a shallow staircase whose shoulder tiles take a range-8 beam to ten squares. I
measured before touching it — exhaustively across all 512 steps and every range, **no tile ever
exceeds `range`** — so the count bound was standing in for the reach rule and doing it
approximately. It is now three assertions: the exact one (no tile further than `range`, at every
rotation), the unchanged `range/√2` floor, and a 1.25× ceiling that is a runaway guard rather than
a claim about the count.

**(2) Tests should name `AIM_STEPS`, not its value.** Most of AIM-SMOOTH's diff is test files,
because cardinals were written as `64` and probe aims as `40`. They now read `AIM_STEPS / 4` and
`(AIM_STEPS / 4) * 0.625` — the same *direction* at any resolution — so the next bump needs none of
this work again. The HITBOX1 golden signature **had** to change (twice as many aims are folded in);
its readable companion, the tile-by-tile cone at a fixed angle, did not, which is the useful signal.

**(3) A decoy previews like the character it impersonates, and that is a client-side fiction.** The
engine is untouched: a decoy still takes no heals, no shields, and dies to any damage (edge-cases
R2). The number shows what the action would do to *the character the viewer believes is there*,
because the **absence** of a number outs a decoy for free to anyone sweeping an aim past it.
Polarity reads the decoy's `owner` exactly as it reads a unit's, so the fiction cannot disagree with
FF1; the fog gate needs no code, since a hidden decoy is simply absent from `FogView.decoys`.

**(4) `PreviewNumber.unitId` became `targetId` and gained `pos`.** Half the targets are not units,
and a decoy is deliberately kept out of `state.units`, so `placePreviewNumbers`' `unitById` lookup
had nothing to find. Carrying the anchor on the number deletes that lookup rather than adding a
second one beside it.

**(5) `isCamoRed` cannot separate a lit thicket from a shaded team-red unit, and the measurement is
recorded.** A thicket composites near `158,45,37`; a Lambert-shaded red body near `179,78,70` — same
hue, same green-above-blue ordering. A frame with no thicket anywhere scores 22 against the
predicate purely from unit edges, and a seeded frame scored the same 22, so a counting assertion
would have passed or failed for reasons unrelated to the feature. Both CAMO-SEED e2e tests were cut
rather than shipped as a second tautology. The predicate stays with its limit documented: with a
seed the unit's square is knowable, so the assertion wants `pixelAt` on that square.

**(6) A scenario seed is a named seed, not a DSL.** `?scenario=in-brush` nudges starting positions
and nothing else — no scripted orders, no injected state — so everything from turn 1 is the ordinary
engine on an ordinary board. It is opt-in, an unknown name is an error rather than a silent normal
match, and a seeded match announces itself in the setup line.

**(7) `mergeSeatOrders`/`deriveSeats` moved to `packages/engine/src/orders.ts`.** Pure order-shaping
that the server needs and may not import from the client. `resolveTurn` still sees two teams and
knows nothing about players — seats are the layer above, which is why this is its own module rather
than part of `resolve.ts`.

**(8) The match starts when the room is FULL, not when both teams are present.** Starting on "both
teams have somebody" deals the characters before the third and fourth players arrive and seats them
controlling nothing — found by a test, not by reasoning. The cost is explicit: a short room (a 2v2
two players intend to run with two characters each) never fills, so `RoomHub.start()` is public as
the escape hatch and as the method M3-LOBBY's start button will call.

**(9) An order naming another seat's character is refused, not filtered.** Silently dropping it
would let a client believe it had ordered a unit and watch the turn resolve as though it had chosen
not to — indistinguishable from the engine ignoring a legal order.

**(10) DO persistence is state AND order history** (ruling from Builder OQ 2026-08-16 #5,
implemented): the authoritative `GameState` per turn so a reconnect is a cheap re-sync, plus each
turn's merged orders appended so replay need not re-simulate. A seat that disconnects mid-turn takes
its submission with it so the room does not wait on a gone socket; the disconnect *rule* (hold vs
forfeit) is M3-TIMER's.

## Open Questions for the Analyzer — 2026-08-16

1. **CAMO-SEED's e2e is still not shipped, and the reason is now measured (decision 5).** The hook
   works; the assertion technique does not. To finish it the seed needs to **report where it put
   things** — e.g. expose the seeded squares on `window` in dev, or have `?scenario=` echo them into
   the title attribute — so the e2e can `pixelAt` that square instead of counting the frame. Small,
   but it is a scope call on a dev hook, not something to invent. Alternatively close the gap as
   unit-covered-only (camo-reveal.test.ts covers the rule; only the *compositing* is unproven).

2. **AIM-SMOOTH: is 512 enough?** Shipped as specced. The deeper cause is untouched and still true —
   equal steps around a diamond are not equal angles, so rotation stays subtly uneven at any
   resolution. The precomputed integer direction table is the fix if the owner still feels it;
   worth a playtest question before scheduling it.

3. **M3-PROTOCOL's start trigger needs M3-LOBBY sooner than the roadmap implies (decision 8).** A
   full room is the only automatic trigger that does not strand a joiner, so a 2- or 3-player 2v2
   currently cannot start over the network without someone calling `start()`. That is fine as an
   interim but it means **the networked game is 4-players-only until M3-LOBBY**. If you want a
   playable 2-player networked match before then, a tiny "start now" message is the smallest
   addition — say so and I will add it rather than guess.

4. **A joiner arriving after the match starts is currently seated with no characters.** The fill
   trigger makes this hard to hit (the room is full), but it is reachable: somebody leaves mid-match,
   freeing a seat, and a new socket joins. They get a seat, an empty control map, and count toward
   the lock total — so the turn can never complete. **This wants a ruling**: refuse joins to a
   started room (and let M3-RECONNECT handle the legitimate case), or seat them as a spectator. I did
   not pick one because it is the same question M3-RECONNECT has to answer, and guessing here would
   pre-empt it.

5. **`turnResolved` broadcasts full state to every seat — the M3-HIDDEN interim, as specced.** Worth
   confirming M3-HIDDEN is genuinely next: the events log contains every enemy action, so until it
   lands the networked build leaks strictly more than the hot-seat does (the hot-seat at least fogs
   its render).

6. **Nothing has still booted a real Workers runtime** (carried from last session, unchanged). All
   50→75 server tests run through the `Sink` seam. M3-DEPLOY's spec already includes a
   `wrangler dev`/miniflare smoke check; this is just a reminder that the first real execution is
   still ahead of us, and it now covers a lot more code than it did.

## Builder session — 2026-08-16 (third: M3-HIDDEN + the three dev notes)

**(1) Hidden information is filtered, not blanked.** `teamView` removes what a team may not see
from the `GameState` it ships — the enemy unit is *absent from the array*, not present with its
fields nulled. A blanked unit still announces that somebody is out there, and the array length
alone counts the hidden enemies, which is most of what a player wanted to know. The same choice
runs through traps, decoys, pending delayed abilities and the other team's `lastKnown`. Power-up
pads are the deliberate exception: they are public terrain (PADS-INDICATOR) and stay whole.

**(2) The server filters views and never re-simulates.** Every visibility question `view.ts` asks
goes to the engine's own `visibleEnemiesForTeam` / `visibleSquaresForTeam` — the same queries the
hot-seat client asks. A second simulation server-side would be a second answer waiting to disagree
with the first, and determinism belongs to the engine.

**(3) The post-turn state stays fogged while the orders are revealed.** Locking in buys you the
enemy's *plan*, which is what the reveal is for; it does not buy you the whole board. Shipping an
unfiltered post-turn state would open the next Decision phase from perfect knowledge, and the
combat log would undo the fog by animation even if the state did not — so `filterEvents` runs over
the log with the same rule. "Acting reveals" needs no special case: the engine already applies
`reveal` to an attacker (CAMO-REVEAL), so an attacker is visible by the time the log is filtered
and its whole exchange survives, while a unit that merely walked in the dark does not.

**(4) The lock list is shared across teams; the plans are not.** A seat's `decision` payload names
every seat that has locked in, enemies included. Who is *ready* is not who is *doing what*, and a
client with no idea what it is waiting for cannot show a waiting state at all. This is the one
place an enemy seat id legitimately appears in a Decision payload, and the M3-HIDDEN test suite
excludes exactly that field when asserting the enemy is nowhere in the message.

**(5) The join guard lives in `join`, not in the hub.** "Can this room be joined" is a fact about
the record, and the reconnect path (M3-RECONNECT) and the lobby will both ask it. `inProgress` is
checked before the duplicate and full checks so the reason a client sees is the one it can act on:
"come back for the next match", not "that seat id is taken".

**(6) M3-START's client affordance is an HTTP route, not a client control.** The AC allows "a
minimal client control (or dev affordance)". The client has no socket layer at all until M3-LOBBY,
so a client control would mean building the network client first — which is M3-LOBBY. Instead
`POST /rooms/:code/start` forwards to the room's object and calls the same `start()`. POST rather
than GET so a link-preview fetcher cannot start somebody's match. It goes away with M3-LOBBY's
button.

**(7) PADS-SPREAD: a map may not place two pads adjacent, diagonals included (dev note).** Owner
note: "Powerups should not be next to each other." Two touching pads are not two pick-ups — they
are one prize worth double, taken by a unit standing between them and (since PADS-PASS) collected
by walking the line. The detour a pad is meant to cost disappears. `validateMap` now rejects any
pair within Chebyshev 1. It is a **floor, not a placement policy**: how far beyond touching, and
which squares, stays the Designer's. Both shipped maps carried my own placeholder pairs, so I
re-laid them as mirrored singles four squares apart at the closest; timings are untouched and the
existing PADS1 mirror guard still passes. **Flagged:** "Pad placement + timings" is routed to the
Designer in the backlog, and a dev note is required scope — I changed only the squares I put
there, and only as far as the new rule forced.

**(8) PADS-PASS: a pad is taken by being on its square at any point in the turn (dev note).** Owner
note: "When passing through a powerup through any movement, it should be taken, you do not need to
land on the square to grab it." This **supersedes decision (3) of the 2026-08-16 session**, "a
power-up pad resolves on occupancy, not on travel" — which was my own call, not an owner one. What
does *not* change is the settlement point: pads still settle once, at the end of Move, after the
chasers and the decoy sweep. Only eligibility widened, so everything PADS1 pins about *when* a pad
resolves and when it comes back still holds. A charger that crossed a Health pad in Dash and died
in Blast takes nothing, because the settlement point is after the dying.

**(9) The travel claim is read off the turn's own events, and ties break on event order.** Rather
than thread a travelled-squares accumulator through five movement paths, `claimsBySquare` walks the
`TurnEvent[]` the turn already produced: one `moveStep` per square entered means `to` is the whole
story, and a future movement kind gets pass-through for free the moment it emits one. A `displaced`
event is emitted once for a whole slide along a straight `direction8` line, so those squares are
walked back out. Contested pads were previously impossible (Collisions forbid co-occupancy) and are
now ordinary, so they needed a tie-break: **the earliest claim wins**, timed by event index, with a
unit already standing on the square when the turn began claiming at −1. Event order is phase order
and, inside Move, one shared step clock — so "earliest" reads as *first to set foot on it*, a Dash
beats a Move for the same reason Dash resolves before Move, and a unit that never moved keeps the
pad exactly as PADS1 gave it. **A teleport over a pad takes nothing**: it occupies no square in
between, and "passing through" has to mean passing through.

**(10) Knockback counts as movement for pads, though it does not for traps.** The dev note says
"any movement", and a unit dragged across a pad was on the pad. Traps stay as they are (edge-cases
lists dash and move only — entry under a unit's own power); the two rules differ because a trap is
something you *walk into* and a pad is something you *are on*, and because the existing pad ruling
already handed a pad to a unit knocked onto one. **Flagged for the Designer**: this belongs in
`docs/design/edge-cases.md` beside the PADS1 line, which is not mine to edit.

**(11) BUFF-UI: the pip row gained a named, counted-down strip rather than a redesign (dev note).**
Owner note: "UI for buffs needs to be more clear." The pips *were* the buff UI — eleven 0.09-unit
coloured squares floating over a model. That is enough to notice a status and not nearly enough to
play around one: "am I slowed, and does it wear off before I commit to this move?" had no answer on
screen, and a colour-blind player got nothing from any of it. The minimal fix is to spell the
existing vocabulary out rather than invent a second one: `status-pips.ts` gained `STATUS_LABELS`,
`STATUS_BLURBS` and `statusChips`, which reuse `PIP_ORDER` and `PIP_COLORS` so the HUD strip and the
floating pips can never disagree about what is on a character or in what order. The strip names each
status, counts it down in turns, tints a dot with the pip colour, and carries a `title` explaining
what the status does. Debuffs additionally get a class and a red left edge, because colour alone is
the thing that was not working. Two judgment calls inside it: the blurbs describe the *effect* and
never the magnitude (the numbers are the engine's constants, and a UI restating them is a second
place to get a balance pass wrong), and duplicate `shield` instances collapse to one chip carrying
the longest remaining and the summed amount — two shields absorb as one pool, which is what the HP
bar already shows. The strip hides entirely when nothing is on the character; a reserved blank row
reads as broken rather than as quiet.

## Open Questions for the Analyzer — 2026-08-16 (third)

1. **CAMO-E2E-FINISH is closed as unit-covered-only, and I think the AC's technique is the wrong
   one.** Reporting the seeded squares is trivial; *using* them is not. The e2e has no board-square
   → screen-pixel mapping — `pointAt`/`clickAt` address fractions of the clipped board region — so
   knowing the seed put a unit on (7,2) does not tell the test which pixel to sample. Making it
   work needs a second dev hook exposing the renderer's projection, which the AC does not authorise
   and I did not invent. **There is a better route that needs no hook at all**: take
   `findPixels(before, isBrushGreen)`, drive the seeded unit to attack, and assert that a
   meaningful number of *those same coordinates* now match `isCamoRed`. A before/after delta at
   fixed coordinates dodges both the projection problem and the counting problem the predicate
   documents. If you want the item reopened, that is the spec I would write — but it is a browser
   drive that has to get a unit to attack from inside brush, so it is not the "small" the current
   entry says it is. The *rule* stays covered by `camo-reveal.test.ts`; only the compositing is
   unproven.

2. **I moved pad squares that the backlog routes to you and then to the Designer.** Dev note 1
   ("powerups should not be next to each other") made the shipped placements illegal under the new
   `validateMap` rule, and they were my own placeholders, so I re-laid them as mirrored singles
   (decision 7). Timings untouched. **This wants Designer eyes**: the new squares satisfy the rule
   and the mirror guard and nothing else — I did not think about lanes, sightlines or which pad is
   worth contesting. `duel-arena` now puts all six pads in the two central columns x=6/x=11, which
   is defensible but is *a* choice.

3. **Two rulings belong in `docs/design/edge-cases.md` and I cannot write them.** PADS-SPREAD (no
   two pads adjacent) and PADS-PASS (a pad is taken by being on its square at any point in the
   turn, earliest claim wins, teleport over it takes nothing) are both live engine rules with
   tests, recorded in DECISIONS 7–10. The PADS1 line in edge-cases §5 now understates the rule, and
   the trap ruling sits one paragraph away saying knockback is *not* entry — the two are
   deliberately different (decision 10) and the doc should say so rather than leave a reader to
   notice the inconsistency.

4. **The Decision payload shares the enemy lock list — confirm that is what you want.** A seat is
   told which seats have locked in, enemies included (decision 4). It leaks nothing about the
   *plans*, and without it a client cannot show what it is waiting for. But it is the one place an
   enemy seat id appears in a pre-reveal payload, and if you would rather it were a bare count I
   would sooner change it now than after M3-LOBBY builds a waiting UI on it.

5. **`POST /rooms/:code/start` is a temporary public route with no auth.** M3-START's AC allows a
   "dev affordance" and the client has no socket layer, so this is how a short room starts today
   (decision 6). Anyone who knows a room code can start that room. That is fine for a dev build and
   is **not** fine at M3-DEPLOY — either M3-LOBBY should delete the route when its button lands, or
   M3-DEPLOY needs it gated. Worth an explicit line in one of those two items.

6. **Nothing has still booted a real Workers runtime** (carried, unchanged). 121 server tests now
   run through the `Sink` seam, including all of M3-HIDDEN. The first real execution is still
   M3-DEPLOY's smoke check, and M3-HIDDEN is the code I would least like to discover a runtime
   difference in.

7. **M3-HIDDEN has no client on the other end of it.** The filtering is unit-tested thoroughly, but
   the client is still hot-seat only and has never consumed a `decision` or a filtered
   `turnResolved`. The payload shape was chosen so it would not have to (`state` is still a
   `GameState`, just with things missing) — but "the client can read it" is currently an argument,
   not a test. M3-LOBBY is where that gets proven; it may be worth saying so in that item's AC.

8. **Pad contest: a Dash beats a Move, by construction (decision 9).** Two units crossing the same
   pad in one turn was impossible before this session and is ordinary now. Earliest-claim is the
   rule I picked because it falls out of phase order, but it does mean a charge reliably steals a
   pad from a walker who was closer to it. That is a **feel** question, not a correctness one —
   worth a playtest note.

9. **BUFF-UI only spells out the *active* character's statuses.** The strip is in the HUD's
   character panel, so an ally's or an enemy's statuses are still pips-only — you can see that
   something is on them and not what. Extending it means either a hover card on a unit or a second
   strip, both of which are real UI design rather than a clarity fix, so I stopped at the note's
   scope. If the owner meant "clearer for every unit on the board", that is a follow-up item.
## 2026-08-14 — The screenshot UI batch (Designer, owner reference)

The owner supplied an AR in-match screenshot as the UI reference and four directives; specced
as six client items in `ar-parity-v1.md` §4.1–4.6 (UI-NAMEPLATES, STATUS-ICONS, UI-INSPECT,
UI-TOPBAR, UI-TIMER, UI-INTENT), extending UI-VIEWPORT/SCORE1 rather than replacing them.
Three calls worth recording. **(1) Everything on a nameplate is gated on `canSee`, and the
decoy therefore needs a snapshot.** Nameplates, inspect panels and status icons all read off
vision — which means a decoy rendered as Wisp with *no* nameplate would un-disguise itself
instantly. The decoy snapshot must carry the nameplate fields (frozen HP, name) and answer
kit inspection with cast-time cooldowns; a refusal or live data would leak either way. Same
principle that gated the damage-preview numbers (PREVIEW-FOG): the UI must never be a better
scout than the vision rules allow. **(2) Stealth's icon renders to the owning team only** —
an enemy-visible stealth marker is a contradiction in terms; the icon exists so *you* know
your own concealment state. **(3) UI-INTENT closes a ruled-but-invisible gap:** teammates
have been entitled to see each other's plans since the Teams rulings, but no UI ever showed
them — at 2v2 default, a duo that cannot see each other's plan is two solo players. Also
recorded: the screenshot's damage-preview numbers already shipped fog-gated (nothing to do),
and AR's "ULT" nameplate tag is adopted because an ultimate you can see coming is a threat
you play around rather than a surprise — the same information-over-surprise principle the
whole simultaneous-turn design rests on.

## Builder session — 2026-09-06 (the screenshot UI batch + PREVIEW-MODIFIERS + M3-LOCKLIST)

**(1) STATUS-ICONS ships the glyphs as path data, not as images.** The vocabulary lives in
`status-pips.ts` as SVG path strings in a fixed 24×24 box because two very different consumers need
the same mark: `renderer3d` rasterises it onto a canvas texture to float over a unit, and the HUD
strip drops it straight into an `<svg>`. An asset would mean two files to keep in step, or a texture
the DOM cannot use. It also keeps `status-pips.ts`'s standing promise — free of Three.js and of the
DOM — intact, since a path string is neither. The owner named two glyphs (Might = sword, Revealed =
eye) and the rest extend them so the set is total; Weaken is Might's sword snapped and Root is a
chained boot against Haste's wing, so the counter-relations read from silhouette before colour.

**(2) A glyph's numeral is turns left, except shield's, which is the pool.** "Two more turns of
Slow" and "twenty more damage of shield" are the two different questions a player asks, and the
shield's answer is never its duration. Playback stamps **no** numeral at all: the event log carries
neither durations nor pools, and a "1t" on a status with three turns left is a lie a player would
plan on.

**(3) Stealth's icon is gated by a shared `viewableStatuses`, applied before both the floating row
and the HUD strip.** An enemy-visible Stealth marker announces "this one is trying to hide", which
is exactly what Stealth buys — and it is reachable, since a revealed stealthed unit is visible and
still stealthed. One gate rather than two so the two readings cannot disagree. Everything else about
a visible unit stays public: if you can see them, you can see that they are Rooted.

**(4) UI-NAMEPLATES replaced the three bar quads with one rasterised plate.** Half of what the
screenshot shows cannot be done with quads — the HP numeral lives *inside* its bar and the ULT tag
is a word. Textures are cached on plate **content**, so `show()` running on every pointer move
during mouse-follow aiming redraws nothing. The vision gate is structural rather than a flag: a
plate is built for exactly the units `fogView` already returned, so there is no visibility branch
that could be written the wrong way round.

**(5) The decoy snapshot is client memory, and it is one snapshot for both lies.** The engine decoy
is `{id, teamId, pos, expiresOnTurn}` and deliberately carries nothing about its caster, so the
client records the cast (alongside `sightings`, the existing precedent) when `decoySpawned` plays
and drops it when the decoy expires. The impersonated character is found **from the kit** — the unit
whose abilities carry a `decoy` effect — not hardcoded to Wisp, so a second decoy character would
not silently wear the first one's name. The snapshot carries the whole cast-time reading (HP,
energy, cooldowns, catalysts) because the nameplate's lie and the inspect panel's lie have to agree:
a plate saying 60 HP over a panel saying 80 outs the decoy more thoroughly than having neither
would. Its status row is empty in both — real buffs would leak, invented ones would be the client
making up game state.

**(6) The cast snapshot is taken from the pre-turn state, one tick early in one corner.** Veil &
Decoy is a Prep-phase free action, so the caster's pre-turn reading *is* its cast-time reading — 
unless a Prep AoE hurt it earlier in the same turn, in which case the plate freezes a few HP high.
The alternative is threading the playback fold back into the resolve path for a difference no player
can observe.

**(7) UI-INSPECT's "ready" means usable this turn, not merely off cooldown.** The owner's question
is "can that character do the thing to me", so a charged ult reads ready and an uncharged one reads
its energy gap rather than a bare 0. Spent catalysts stay listed and grey rather than disappearing,
because what an opponent has already burned is half of what the panel is for. A decoy answers
inspection with the cast-time kit — never live and **never a refusal**: "this one won't open" is a
perfect tell and the louder of the two, since the player went looking.

**(8) UI-INTENT shows enemies nothing at all, not a redacted marker.** The *existence* of a tile is
itself information: it says they have decided. `intentBadges` filters on owner alone, so an enemy
has no entry and the renderer is never asked to make the call. A hold is silent while a player is
deciding and shows once locked — "done, and standing still" is what a teammate needs; an empty draft
is not. Where an ability and a walk are both queued the number leads, since that is the half a
teammate coordinates around, though `move` is still recorded.

**(9) UI-TOPBAR takes the viewing team as an argument.** "Friendly" is a fact about who is looking
rather than about the match, so `topbar()` is a rearrangement of `ScoreReadout` from a seat's point
of view, and the same state from the other seat is the exact mirror. A downed portrait shows its
respawn countdown in place of its initial and reads 0% HP: the bar means "how much fight is left in
them", and while they are down the answer is none.

**(10) UI-TIMER is presentation only, and does not end a turn.** Enforcing a deadline is
server-authoritative and belongs to M3-TIMER, where it is the same deadline for everybody; a
hot-seat clock that resolved the turn by itself would be a second, different rule and the two would
drift. The view reports `expired` and stops. The bank **extends** rather than resets — a player who
banks at 8 seconds ends up at 18, not 40 — and its consumption animates, because a +10 s that
silently changed a number reads as a miscount. The window resets **per seat** rather than per turn,
since Time Bank is a player's resource and in a hot-seat each seat is a player taking its own
decision. Driven by a 10 Hz interval rather than the render loop: the Decision phase has no
animation frame of its own, and repainting the whole HUD ten times a second would tear the DOM out
from under UI1's hover.

**(11) PREVIEW-MODIFIERS needed no engine change — `computeDamage` and `isBehindCover` were already
exported.** The client had simply been ignoring them. Cover is applied to **decoy** previews too: a
decoy showing full damage from behind a wall where the real unit would show half is a tell, and the
fiction only works if it is seamless. Heals and shields keep their authored amounts, since Might,
Weaken and cover are outgoing-*damage* rules and applying them to a heal would be inventing a
mechanic. Shields stay out of the number (flagged in edge-cases, not required) and the nameplate now
shows the shield pool separately, which is the natural division.

**(12) M3-LOCKLIST also closed the same leak one message over.** The item is about the `decision`
payload, but `RoomView` carries a lock list and rides `joined` / `roomUpdated` / `seatLeft` — all
broadcast, the same bytes to both teams. A `seatLeft` mid-match would have handed each team the
other's lock list immediately after the per-seat `decision` withheld it. A room view's lock list is
now **pre-match only**, where nothing is secret yet and a lobby genuinely needs to name who it is
waiting on. `of` in the Decision payload now counts your own team rather than the room, so
`locked.length / of` reads directly.

## Open Questions for the Analyzer — 2026-09-06

1. **UI-TIMER counts down and nothing happens at zero — confirm that is the intended shape.** The
   AC specified the readout, the urgency shift and the Time Bank pip, and routed enforcement to
   M3-TIMER ("server-authoritative timing"). So the hot-seat clock hits 0.0 and sits there. That is
   what the item asked for and I did not invent an auto-lock, but a countdown that does nothing is
   an odd thing to put in front of a playtester. If the owner wants a hot-seat deadline that
   actually fires before M3-TIMER lands, that is a small follow-up — say so and I will spec it as
   "auto-lock at zero" rather than guess which of hold/auto-lock/ignore they meant.

2. **Time Bank scope was a judgment call: one charge per SEAT per decision window.** `TIMEBANK_CHARGES`
   is 1, and AR's bank is a per-player resource, so in a hot-seat each seat gets its own window and
   its own charge when it comes on the clock (decision 10). The plausible alternative is one charge
   per player **per match**, which is closer to AR and much stingier. M3-TIMER has to settle this
   anyway once the clock is server-side; flagging it now so the two do not ship different answers.

3. **UI-INSPECT is hover-only, so it is unreachable on touch.** The AC said "hover (or click-hold)"
   and I built hover, since the client has no touch handling anywhere yet and adding a long-press
   gesture is its own item. Not a gap in the AC — a gap in the platform. Worth an explicit
   touch-input item at some point, or an explicit "desktop only for v1" line.

4. **The decoy snapshot freezes from the pre-turn state, one tick early in one corner** (decision 6).
   Veil & Decoy is a Prep free action so the pre-turn reading is the cast reading — unless a Prep AoE
   hurt the caster earlier in the same turn, in which case the fake plate shows a few HP too many.
   Fixable only by threading the playback fold back into the resolve path. I judged that not worth
   it; if you disagree it is a small, contained change.

5. **None of the new UI has composited (e2e) coverage, and the pixel predicates cannot give it any.**
   Everything this batch shipped is unit-tested at the model layer, which is where the rules are —
   but "the nameplate actually draws" is a compositing question, and `isTeamBlue` already matches the
   nameplate's own name text (`#9dc2ff` passes it). Distinguishing a plate from a unit by
   pixel-counting is the same dead end `isCamoRed` hit. If you want composited proof, the technique
   that works is the one I wrote up for CAMO-E2E-FINISH: a **before/after delta at fixed
   coordinates**. That would be its own item; I did not open one.

6. **M3-LOCKLIST changed `of`'s meaning in the Decision payload** — it now counts your own team, not
   the room, so `locked.length / of` reads directly and `enemyLocked / enemyOf` is the other half.
   M3-LOBBY is the first thing that will build a waiting UI on it, which is why the item was
   scheduled first; just make sure its AC is written against the new shape.

7. **`renderer3d.ts` is now ~1250 lines with three texture caches** (glyphs, nameplates, intent
   tiles). Each is small and they share a pattern, but the file is doing noticeably more than it did.
   A `textures.ts` extraction is the obvious cleanup and touches nothing behavioural. Not scheduled —
   your call whether it is worth an item before M3-LOBBY adds a network client on top.

8. **M3-LOBBY and CAMO-E2E-FINISH are untouched**, as your cut line predicted. M3-LOBBY is the whole
   of the remaining unblocked work and is explicitly multi-session; CAMO-E2E-FINISH stays low and is
   still "not small" per your own re-spec.

9. **Nothing has still booted a real Workers runtime** (carried, unchanged). 124 server tests run
   through the `Sink` seam.

10. **Two RENDER-COVERAGE e2e tests fail, and they fail on `main` too — they are NOT this batch's.**
    `arming a chase draws a route that is not there otherwise` and `an enemy is drawn on a board
    that is still fogged (LAST-KNOWN)` both fail with "never got an enemy into sight". I verified
    this against a worktree at `c6a64ba` (pre-session `main`): **identical failures, identical
    messages**. The other 22 pass on my branch. Both are the long multi-turn drives, and both walk
    the teams together with `walkToCentre` before asserting anything.

    What I measured while chasing it: a unit with `Move (4)` advances **one square** per turn under
    that drive, so five turns closes five of the thirteen squares between the spawns and nobody ever
    comes into vision. The click itself is landing correctly — I pinned the screen-to-board mapping
    off the power-up pads and the board centre is where `clickAt(0.5, 0.5)` puts it — so the fault
    is between "click the centre" and "walk four squares", not in the harness's coordinates. The
    likeliest cause is `duel-arena`'s wall at (5,6)–(5,8) sitting directly between the team-0 spawn
    and the centre: routing around it eats the budget, and the drive was always marginal. **This may
    be the pad re-placement from PR #51 interacting with the drive** (the last green run predates
    the merge), which would make it mine from the *previous* session rather than this one — worth
    checking before anyone rewrites the tests.

    **Not fixed here.** Rewriting a drive helper in two RENDER-COVERAGE tests is a backlog item, not
    something to slip into a UI batch's last commit, and the tests are yours to re-spec. Suggested
    shapes, cheapest first: give `walkToCentre` a target that is not behind a wall (aim at a row the
    spawn can reach in a straight line); raise the 5-turn cap; or drive with `Sprint` instead of
    `Move` so each turn covers more ground.

11. **One real bug did fall out of the investigation and is fixed** (commit `f79ef9a`): both
    `sizeToViewport()` calls run before `beginTurn()` fills the scoreboard, so both measured an empty
    element and fell back to `TOP_CHROME_FALLBACK_PX`. That was harmless while the strip was two
    lines of text — the fallback was *larger* than the real chrome, so the board was framed
    conservatively — but UI-TOPBAR's portrait row is taller than the fallback, which inverts it and
    frames the top rank of the board underneath the strip. A third measurement now runs after
    `beginTurn`. It did **not** fix the two e2e failures, which is part of how I established they
    were not mine.

## Builder session — 2026-09-07 (combat correctness + client polish)

**(1) LOS-OCCLUSION reuses `hasLineOfSight` rather than writing an occlusion routine.**
`coneSquares` dropped wall squares but left everything behind them covered; `lineSquares` broke on
the first wall *on its axis* while HITBOX1's side-band still reached tiles a wall beside the axis
shadowed. Both now filter through the engine's own sight kernel, which makes "walls block, cover
only reduces" **one rule answering one question** — sight and shapes cannot drift apart, and the
kernel is already integer/deterministic so the no-trig guard holds. `circle`/`square` stay
un-occluded: a lobbed grenade arcs over the block, which is what a lobbed shape is for.

**(2) The HITBOX1 golden signature did NOT move, and should not have.** The AC expected a
regeneration. Its fixture board is `openBoard(41)` — wall-free — so nothing occludes and the hitbox
geometry the signature pins is exactly what LOS-OCCLUSION leaves alone. Forcing the number to change
would have meant changing something that should not have changed.

**(3) MELEE-COVER keys off a flag, and the range-≤1 fallback stays.** `isBehindCover`'s
`range <= 1` exemption is left in place: with the flag doing the real work it changes nothing the
flag does not already cover, and it keeps honest any caller that passes no ability. The client
preview follows in the same commit — PREVIEW-MODIFIERS routes through `computeDamage` precisely so
preview and resolution cannot disagree, and leaving the preview cover-reducing a melee hit would
have reintroduced the disagreement by the back door.

**(4) CHASE-SPRINT derives the budget instead of reading `order.sprint`.** A chase's route is
picked at the end of Move, after everyone else has finished, so there is nothing for a player to opt
into at plan time and a client that never set the flag would silently get the short budget. The
condition is Sprint's own — no normal ability, no Dash catalyst — so a free action does not block it.
The client applies the same condition through `chaseSprints`, deliberately a thin alias of
`sprintAllowed`: two rules that must agree are two rules that will eventually disagree.

**(5) Two CHASE1 tests encoded the old budget and were updated, not deleted.** "A chase can still be
sprinted" became "a chase sprints whether or not the order says so" — the flag being redundant *is*
the change. The last-known case kept its real assertion (it stops dead at the remembered square and
does not pursue into fog) and gained a second case pushed back far enough that eight squares is
still short, so the original point survives the new budget.

**(6) MOVE-FOG filters the state rather than special-casing the query.** Plan-time reachability now
runs against `planningState(state, fogView(...).units)` — a state whose unseen units are absent.
Structurally the same move the server makes for M3-HIDDEN, with the same property: no "should I hide
this" branch that could be written the wrong way round. Applied to the reach envelope, the drawn
route, the chase route **and the committed path** — a preview and an order that disagreed would leak
through whichever the player trusted. The engine is untouched: resolution walks the true board and
the contact is the reveal, which is correct.

**(7) STATUS-ICONS-SIZE needed the strip to WRAP.** Doubling the glyphs broke my own invariant that
a full row fits over a unit — eleven at the new size sprawl 2.16 tiles and start labelling the
neighbours. The choice was a token +22% that keeps one line, or wrapping. `pipOffsets` now returns
`{x, y}` slots and wraps at six, each row centred on its own count; the wrap is what buys the size.
Worst case is two tidy rows instead of one illegible one, and most turns show one to three anyway.

**(8) ANIM-SLOW is flat (460 → 760 ms/beat), not per-phase.** A quiet turn is *short* — it has fewer
beats — rather than slow, so per-phase weighting would fix nothing and would make pacing two numbers
instead of one. `MS_PER_BEAT` moved to `animate.ts` so a test can pin it without importing a module
that pulls in Three.

**(9) PADS-LIGHTS shows nothing before a pad's first spawn.** A pad still waiting for `firstTurn` has
never been taken, so counting down to its first appearance would read as "somebody grabbed this" on
turn one. It also shows the full countdown on the turn of pickup, before the record has ticked —
that is exactly when the player is watching the pad go out.

**(10) I implemented PADS-SCHEDULE although the backlog routes it to the Designer — flagged.** The
backlog lists "PADS-SCHEDULE (data)" under *Routed to Designer*, but the owner pasted Dev Note #6
directly into my session, and Dev Notes are required scope for the Builder. It is a two-field data
change the schema already carries (`firstTurn` 2 for Might / 4 for regular, `everyTurns` 4
everywhere), so implementing it costs nothing and leaving it undone would have been silently
dropping a note. Both maps set, guarded by a new content test. **If the Designer intended different
squares alongside these timings, the timings are independent and survive a re-placement.**

**(11) Dev Note #5 ("Might should be contestable — a rush") is satisfied by the TIMING, not by
moving pads — flagged.** The Analyzer's own reading in edge-cases is that "the early Might spawn is
what makes it *the* turn-2 rush", and turn 2 is when both teams are still converging. I did **not**
move the Might pads, because pad *placement* is explicitly the Designer's and the current pair sits
one per side (`duel-arena` (6,3)/(11,3)) — mirror-fair, but each closer to its own team, which is
"two safe pickups" rather than "one contested prize". **If the owner wants a genuine race, the
placement is the lever, not the clock**, and the centre-most legal mirrored columns are (7,y)/(10,y)
on `duel-arena` and (9,y)/(12,y) on `iron-basin` (PADS-SPREAD forbids the truly central pair, which
is adjacent). That is a Designer call and I did not take it.

**(12) RENDER-DRIVE-FIX drives with Sprint and a higher cap, not a re-aim.** The AC offered three
options. Re-aiming at a wall-free row means mapping a board row to a clip fraction, which is exactly
the fragile coordinate reasoning that made the drive brittle in the first place; Sprint (always legal
here — nothing is armed) plus an eight-turn cap is twice the ground per turn with no new geometry
assumption. The helper is now shared by both drives rather than duplicated in each.

## Open Questions for the Analyzer — 2026-09-07

1. **PADS-SCHEDULE: I implemented it, though the backlog routes it to the Designer** (decision 10).
   The owner pasted Dev Note #6 into my session and Dev Notes are Builder scope, so leaving it would
   have been silently dropping a note. It is two fields per pad on two maps, schema unchanged,
   guarded by a new content test. If the Designer had different timings in mind, this is the file to
   overrule — but the timings are independent of placement and survive a re-lay.

2. **Dev Note #5 ("Might should be contestable — a rush") is only HALF satisfied, and the other
   half is yours** (decision 11). The turn-2 spawn is in. But `duel-arena`'s Might pads sit at
   (6,3)/(11,3) — mirror-fair, yet one closer to each team, which is *two safe pickups* rather than
   *one contested prize*. The clock alone does not make a race if each side has its own. **Placement
   is the lever**, and it is explicitly the Designer's, so I did not touch it. If you want the race:
   the centre-most legal mirrored pair is (7,y)/(10,y) on `duel-arena` and (9,y)/(12,y) on
   `iron-basin` — PADS-SPREAD forbids the truly central pair because it is adjacent. Needs a ruling
   before it is worth building anything else on.

3. **MELEE-COVER ships the flag with no ability marked** — the `melee: true` data pass is the
   Designer's (backlog says so). Until it lands the rule is inert in real content: every shipped
   ability still eats cover. Worth confirming that is the intended sequencing rather than a gap.

4. **LOS-OCCLUSION's golden signature did not move** (decision 2). The AC said to regenerate it; the
   fixture board is wall-free so there was nothing to regenerate. Flagging in case the AC's author
   expected the geometry itself to change — it did not, and should not have.

5. **RENDER-DRIVE-FIX needed a second fix the item did not anticipate.** Sprint + a higher cap fixed
   the *premise* (contact now happens on turn 2 instead of never), and LAST-KNOWN passes. But the
   chase test then failed on its own assertion: it clicks the median of all red pixels, and with two
   enemies now in view that median lands in the gap *between* the two bodies. Added
   `largestCluster` to `pixels.ts` so the click targets one body. Mentioning it because it is a
   harness weakness that was masked by the drive never working — anything else that "finds a unit by
   its pixels" has the same bug latent in it.

6. **STATUS-ICONS-SIZE forced a layout change the item did not scope** (decision 7). Doubling the
   glyphs breaks the "a full row fits over a unit" invariant, so the strip now wraps at six. If you
   would rather have one line and smaller icons, the constant is `PIP_ROW_MAX` — but then the Dev
   Note is only token-satisfied.

7. **`MS_PER_BEAT` moved from `app.ts` to `animate.ts`** so the ANIM-SLOW test can pin it without
   importing a module that pulls in Three. Trivial, but it is a public constant now.

8. **Nothing has still booted a real Workers runtime** (carried). 124 server tests through the
   `Sink` seam; M3-DEPLOY still owns the first real execution.

## 2026-08-15 — Might is the centre prize; nameplate layout; health-pad parity (Designer)

Answers the Builder's PADS-SCHEDULE handoff and two owner directives. Specs in ar-parity
§4.8/§4.9/§7.6; pad moves shipped in data. **(1) The Builder's framing was exactly right and
the fix is geometry, not schedule.** Two mirror-fair Might pads, each nearer one team, are two
safe pickups — the turn-2 clock makes them *punctual*, not *contested*. Moving the pair into
the central strongpoint — duel-arena (7,7)/(10,7), iron-basin (9,9)/(12,9), the centre-most
non-adjacent mirrored pairs the Builder computed — puts both pads within turn-2 reach of both
teams (near pad Manhattan 6, far pad 9, from either side), so holding "your" pad means
standing where the enemy contests it. Health took the vacated flank rows: a heal collected
while disengaging is doing its job, a heal in the centre of the fight is just more fighting.
Schedules stayed with the type, not the position. This also closes maps-v1's open playtest
question — the central room is worth taking now because the damage buff lives there. Flagged
lever if the room over-dominates at 4v4: everyTurns 4 → 5, not moving pads back out.
**(2) Nameplate revision: glyph carries identity, tint carries polarity.** Name left-justified
above the bar, icon row beside the name, buffs blue / debuffs red per the FF1 polarity table
verbatim — one mapping already ruled elsewhere, reused rather than a second colour table to
drift. Debuffs-first ordering now reads as red-nearest-the-name, which is the urgent-first
read. STATUS-ICONS-SIZE folds into the same repaint. **(3) The health pad was already at AR
parity** — heal 10 + healOverTime 10×2 is exactly "10 on pickup, +20 over 2 turns" — so the
directive resolves to a confirmation, recorded so nobody fixes it into divergence.

## 2026-09-08 — Builder: the render checks were the tests; the sprint bug is not there

1. **The pad e2e sampled the wrong turn AND the wrong camera.** The schedule half was mine:
   PADS-SCHEDULE moved the regular flavours to `firstTurn: 4` while the test kept sampling turn 2
   and looking for Health teal, so the frame was honestly empty of it. The drive now resolves until
   the plate appears rather than pinning the schedule — those numbers are the Designer's to tune.
   The other half is not mine and is not fixed here: **PADS-PLACEMENT put duel-arena's Health pads
   in the camera's occlusion shadow.** They sit on `y = 3`, directly north of the wall line at
   `y = 4`, and in the default pitched view a raised block hides the ground one row behind it, so
   the pads composite **zero** pixels. Measured, not inferred: the Energy pads on `y = 11` composite
   normally on the same turn, and the Might pads on `y = 7` show only slivers past the cover boxes
   on `y = 8`. The test now samples from the top-down projection, where the question it is actually
   asking ("does an armed pad composite at all") cannot be confounded by geometry. **The placement
   itself is a live problem and belongs to the Designer** — see the Open Questions below.

2. **A ground-plane raycast under a lifted body is a general click-accuracy bug, not a chase bug.**
   `squareFromPoint` intersects the ground plane, and a unit is a box standing 0.6 above it, so the
   pixels at a body's waist resolve to the square *behind* it. That is why the chase e2e armed
   nothing: it clicked the silhouette's median. Measured across one body — the median arms nothing,
   70%–100% down it all arm — and the test now clicks the foot at 85%. Fixed in the test because the
   test is what was wrong, but the same geometry applies to a **player** clicking near or on a unit,
   which is worth a ruling rather than a Builder guess.

3. **MOVE-SPRINT-FIRST does not reproduce**, established in the running hot-seat before touching
   code as the item required. Sprint arms, the Move control re-prices 4 → 8, a route is drawn, and
   the unit resolves eight squares away with no page errors. MOVE-FOG is cleared specifically: on
   turn 1 the fog-filtered plan and the true-board plan are identical, because the filter keeps the
   mover's own entry and its object identity. Shipped as two regression tests instead of a fix — one
   per candidate explanation, since a unit test cannot see the wiring and a browser test cannot see
   the arithmetic — and recorded here so the next report of it starts from "which build".

4. **`HARMFUL_PIPS` is now derived from the engine's FF1 table rather than restated.** It was its own
   literal set of the same four kinds; NAMEPLATE-LAYOUT asked for the polarity mapping "verbatim",
   and the only way to have it verbatim is to not have a copy. `PIP_COLORS` (identity, eleven hues)
   survives untouched for the HUD strip and inspect panel; the plate gets `pipTint`, which is two
   colours and asks `HARMFUL_KINDS` directly.

5. **The floating pip quads are gone, and with them `pipOffsets` and the wrap-at-six decision**
   (2026-09-07 #6, which the Analyzer had already marked superseded). The row is painted into the
   plate's raster now. The size floor STATUS-ICONS-SIZE won is kept as a *conversion* rather than a
   constant: 30 px on a 272 px plate at 160 px per world unit is 0.1875 against the old 0.18, and a
   test pins that arithmetic so the fold cannot quietly hand the size back.

6. **Eleven icons do not fit beside a name**, so the row reports what it cut as a `+N` rather than
   stopping silently. A row that just ends is a plate under-claiming what a unit is carrying, which
   is worse than an honest count; `PIP_ORDER` puts debuffs first, so what survives the cut is what
   is being done to you.

7. **M3-LOBBY was not started.** Reasons in the Open Questions — the short version is that its
   character/catalyst ownership model is genuinely underspecified against what the engine offers,
   and guessing it would put a wrong data model in `room.ts` for the next session to unpick.

## Open Questions for the Analyzer — 2026-09-08

1. **Health pads are invisible on `duel-arena` (and Might is nearly so).** Not a render bug and not
   a test artefact — a flat ground mark one row north of a raised block is completely hidden by it
   under the shipped camera. Today that means the map's Health pads cannot be seen at all from the
   default view, and the central Might prize shows a sliver. Three levers, all outside my lane:
   move the pads off the shadow rows (Designer), lift the pad marker above the block band (renderer
   — but a pad drawn *over* a wall is its own lie), or add a pad marker that reads at the plate/HUD
   level. Needs a ruling before anyone tunes pads further.

2. **Clicking a unit's body selects the square behind it.** Same geometry as #1 from the input side:
   `squareFromPoint` raycasts the ground plane only, so a click anywhere above a body's foot lands a
   tile or two further from the camera. Chase is where it bit hardest (a chase must name a unit),
   but every board click has it. Is the fix "raycast the unit meshes first and prefer a unit hit"?
   That is a real behaviour change to targeting, so I did not make it.

3. **MOVE-SPRINT-FIRST: what should close it?** It does not reproduce and is now guarded at both
   layers. I have left it to you to close or re-scope — if the owner can still reproduce it, the
   thing to capture next time is the build (the bundle hash in the page) rather than the symptom.

4. **M3-LOBBY's pick model is underspecified, and one part of it is an ENGINE ASK.** The AC says the
   lobby picks "each player's catalyst triad + character", but: (a) a *seat* is not a *character* —
   in a two-player 2v2 each player controls two characters, so "a player's character" is really N
   picks per seat, and R3's "unique within a team" has to be enforced across the team's whole
   complement rather than per seat; and (b) the engine models the catalyst triad **per unit**
   (`spawnUnit` gives every unit `DEFAULT_CATALYSTS`) and `createMatch` takes no catalyst argument at
   all — so "a player's triad" either means one triad applied to all of that player's characters, or
   the engine needs a way to seed per-unit triads at match creation. **ENGINE ASK** either way.
   I stopped rather than guess: a wrong pick model in `room.ts` is expensive to unpick, and the item
   is already labelled large/multi-session.

5. **Is the `+N` overflow marker on the nameplate the behaviour you want?** The alternative is
   shrinking the icons until eleven fit, which gives back STATUS-ICONS-SIZE, or wrapping to a second
   line, which is the thing NAMEPLATE-LAYOUT replaced. `+N` is my call and the least bad of the
   three, but it is a call.

## 2026-08-15 — CLASH-AR, the unique-basics pass, and three Builder-OQ rulings (Designer)

The owner supplied AR's clash rules verbatim and asked for a basics-uniqueness pass; the
Builder left three Designer items. Full spec in `docs/design/clashes-and-basics.md`.

**(1) The clash audit found we were two-thirds right, and the deltas are surgical.** AR's
rule 2 (both ending on a square → all bounced to their previous square, pad denied) is
exactly the shipped contested-square behaviour. The deltas: passers-through now continue
instead of gridlocking (rule 1 — promotes CL1, whose deferral is superseded by the owner's
primary source), an ender outranks a passer for the pad even against an earlier step-clock
claim (rule 3 — resting is the stronger commitment), and a same-step simultaneous entry
claims nothing (today the tie falls to event-emission order — deterministic but arbitrary,
the kind of tiebreak nobody can predict at the planning screen). The swap block stands; AR
is silent on swaps. Happy consequence: crossing paths mid-board gets safer, which livens the
Might-room geometry rather than gridlocking it.

**(2) The uniqueness pass proved the owner's complaint with arithmetic: nine autos were four
lines and five cones differing only in numbers.** The parity table maps AR's nine signature
basics onto the engine: three are expressible today and shipped (Lumen's Aurora line —
damage enemies + heal allies in one path, which FF1 polarity gives us for free; Thorn's
Zuki lob — a circle auto that detonates over walls; Ravok's Asuna whirl — a self-circle
melee spin), four need small knobs (axis bonus, constant-width beam, inner-ring damage,
aim-time modes — each reusing the existing integer lattice, each shipping with its one data
edit), and two are rejected as not worth their geometry cost yet (Lockwood's wall bounce,
Helios's chain). Uniqueness also comes from exclusivity: with the others migrated, Vex owns
the only vanilla line and Wisp the only pure melee cone. Pricing: Lumen pays 4 damage for
the heal rider, Thorn pays 2 for the lob — a no-cooldown wall-ignoring poke is positional
power and is priced as such, with range the first nerf lever.

**(3) The Builder's pad-visibility OQ becomes a placement rule, not a render patch.** A pad
may not sit on a square whose south (y+1) neighbour is wall or cover — the shadow-row rule,
enforced alongside PADS-SPREAD. Both maps' Might and Health pads moved accordingly; the
centre-prize ruling survives (the Might pair is still inside the strongpoint, near pad 5 /
far pad 10 from each spawn). The renderer lever was rejected on principle: a pad drawn over
a wall lies about occlusion. **(4) Body clicks select the unit.** Raycast unit meshes before
the ground plane; a player who clicks a character means the character. Visible units only —
fog leaks nothing. **(5) The melee pass makes MELEE-COVER real** — the four contact strikers
plus Shockwave; Seismic Rupture deliberately excluded (bracing behind cover against a quake
is a fair read), dashes deliberately deferred. **(6) Thorn's snare gets lifetime 3** — the
same cap logic as Vex's Overwatch; an immortal minefield is the stall the caps exist to stop.

## 2026-09-09 — Builder: two owner-directed engine reversals, a targeting fix, and the lobby unblocker

1. **REVEAL-FIX kept `breakStealth` without keeping a second branch.** The AC asks for the two
   unconditional reveal blocks to become `revealIfConcealed` *and* for breakStealth-on-damage to be
   unchanged, which looks like a conflict — `revealIfConcealed` only breaks Stealth when concealed.
   It is not one: Stealth alone satisfies `isConcealed` whatever the tile, so every stealthed
   attacker still goes through the gate and the only units it now skips have no Stealth to break.
   Pinned as its own test rather than argued in a comment.

2. **Three existing tests were flipped rather than deleted**, each with the reasoning it used to
   carry written out beside it: `attribution.test.ts`'s open-attacker reveal (now the negative, plus
   a brush counterpart so the suite still owns the attribution), CAMO-REVEAL's "an open unit that
   DEALS damage is still revealed" regression guard, and the client's reveal-spam log case (which
   now shoots from brush, since that is the only way left to emit the event it filters). A reader who
   finds the old argument in `git log` should find its rebuttal in the file.

3. **CLASH-AR: "stop only an ender" means "stop only an ender that another ender is contesting".**
   Read literally, the ruled sentence would stop the lone ender in AR rule 3 — but rule 3's own row
   says that ender *rests there and takes the pad*, and it cannot take a pad it was blocked off. So
   the implemented test is "this step ends my path AND somebody else is also ending here". Flagging
   the reading because the sentence and the table pull in different directions.

4. **CLASH-AR's fixtures cross at right angles, not head-on.** MV2 rejects a path that *ends* on an
   occupied square at validation, so two units walking at each other never reach a clash rule at all
   — the orders are dropped first. Crossing routes are also what the ruling is actually about
   ("through-the-middle routes"), so this is the honest fixture rather than a workaround.

5. **Chase-vs-chase now crosses and swaps sides** instead of gridlocking mid-board (`chase.test.ts`
   moved from (6,10)/(8,10) to (9,10)/(5,10)). That is the mobility consequence the ruling names,
   arriving in a test that was written about something else (snapshot symmetry, unchanged).

6. **`validateCatalystTriad` lives in `catalysts.ts`, not `validate.ts`** where the backlog put it:
   the check needs the pool to know an id's phase, and `catalysts.ts` already imports `validate.ts`,
   so the other direction is an import cycle. Same shape, one file across.

7. **CAT-SELECT's picks are positional, not keyed by character id.** `picks[team][i]` pairs with
   `teams[team][i]`. Keyed would collide on a cross-team mirror, which R3 explicitly allows, and the
   ruled pick model is per *character* rather than per player. Holes mean "has not chosen" — the
   normal state of a lobby, which should not need an invented triad to describe.

8. **`axisBonus` is added to raw damage before Might/Weaken/cover.** The ruling does not say which
   side of the multipliers it lands on. Before is the reading that needs no second code path: the
   bonus behaves exactly as a larger authored number would, which is also how a player will read
   "+8 on the centre line".

9. **VALIDATE-KEYS' "every legal key at once" object became two.** `axisBonus` is the second
   shape-exclusive key (after `chargeHits`), so one object can no longer carry every key and still
   validate. Split into a `path` and a `cone`, with the coverage assertion over their union — the
   guard is exactly as strong and the exclusivity is now stated rather than accidental.

## Open Questions for the Analyzer — 2026-09-09

1. **BASIC-BEAM is blocked on one number, and it is a data number.** The knob is specced as
   *"`beamWidth: n` … the half-width becomes the constant `n`"*, but the same item ships it as
   *"Aegis's Shield Bash as a **1×2** beam"*. Under the stated formula a 1-wide beam is half-width
   **0** (only the axis survives the half-tile test), and `beamWidth: 0` reads like "no beam" — while
   `beamWidth: 1` gives a **3**-wide lane, not 1. So either the field means full width, or Shield
   Bash wants 0, or "1×2" means something else. I did not pick: it changes shipped data and it is
   the Designer's number. Everything else about the knob is ready — `axisSquares`/`onConeAxis`
   already prove the wedge's perpendicular offset is exposed as an integer, and the constant-width
   substitution is one comparison in `wedgeCovers` (`4b² ≤ (2n+1)²·|dir|²`, cap `4a² ≤
   (2·range+1)²·|dir|²`). **BASIC-INNER and BASIC-MODES are untouched and unambiguous** — they
   simply did not fit the session.

2. **CLASH-AR leaves one reachable corner unruled.** With rule 3, an ender and a passer can occupy
   the same square at the end of a step. Normally the passer walks on. If its *next* step is blocked
   (a stationary unit in the way), it halts there — and two units are then resting on one square,
   which Collisions forbids. AR presumably has the same corner; I did not invent a resolution.
   Options: the passer bounces to its last-held square instead of halting on an occupied one, or
   the ender is displaced, or it is accepted as a transient the renderer will show honestly. Needs a
   ruling before somebody hits it in a playtest and files it as a stacking bug.

3. **Is `axisBonus` before or after the damage modifiers?** Decision 8 says before, which is my call,
   not a ruling. If the Designer intended "+8 flat, unmodified", it wants a separate field on `Hit`
   rather than a bigger `raw`, and Bastion's slam under Might would land differently.

4. **REVEAL-FIX: is the dash branch's `origin` measurement what you want?** A dasher that starts in
   brush, charges out and lands in the open is revealed; one that starts in the open and ends in
   brush is not. That is the tile-that-hid-you reading and it matches the adjacent CAMO-REVEAL line,
   but it is now the rule for *damaging* dashes too, which it was not before.

5. **`data/characters/bastion.json` was rewritten by a JSON round-trip** (2-space indent, unicode
   preserved) when `axisBonus` was added. The diff is 3 lines, so nothing moved — but if the repo
   wants a specific formatter for `data/`, now is the time to say so.

## 2026-09-10 — Builder: the chase follows, the corners close, and blinks stop flipping a coin

1. **CHASE-FOLLOW is a re-derivation per step, not a longer leash.** The chase's goal is recomputed
   from the chaser's live square on each step of a walk over the same frozen post-Move snapshot the
   old code used once. Nothing else moves while it runs, so team vision changes for exactly one
   reason — the chaser moved — which is what makes stepping and re-asking meaningful rather than
   circular. Each iteration re-routes with the full reachability search and takes one step of it, so
   the chase is no worse at pathfinding than a plain Move; a greedy one-square hop would have walked
   into walls the search routes around. Termination is the budget, which strictly decreases, so even
   flickering sight cannot loop it.

2. **The flipped chase test was never a budget assertion.** The old expectation read
   `5 + MOVE_RANGE`, which looks like a movement cap and is not: 9 was the *last-known square*. The
   comment has been rewritten to say so, because the number coinciding with a budget is exactly how
   this bug survived a rewrite of the budget rule (CHASE-SPRINT) without anybody noticing.

3. **CLASH-CORNER: only a body can wedge a passer.** The ruling names "a stationary unit, a wall, or
   the map edge". The latter two are unreachable for walked movement — a path through a wall or off
   the board is refused at validation long before any step clock, so there is no passer left to
   wedge. Pinned as a test so nobody later "fixes" the unreachable half.

4. **CLASH-CORNER's residual, left alone deliberately.** If every square a bounced unit covered is
   somebody else's rest, it stays put rather than stacking. Reaching that needs a conga line that
   also blocks the origin; the ruling asserts the origin is always available, and this is the case
   where it might not be. Flagged below rather than resolved by inventing a rule.

5. **BASIC-INNER replaces, BASIC-AXIS adds.** A cone's axis bonus is genuinely additive on top of
   the wedge's damage; a circle's centre is a *different number*, because "22 in the centre, 14 in
   the ring" is how a falloff is authored and read. Both fold into `raw` before Might, Weaken and
   cover, so there is still one multiplier path — and the AXIS-MODIFIERS-CHECK question applies to
   both identically.

6. **Cinder's range stayed at 7.** The AC gave the shape and the two damage numbers and not the
   reach, so the authored range is untouched: the shape change is the item, and re-pricing the range
   would be a rebalance I was not asked for. Its old top-end number survives — a player who lands
   the centre still gets 22, and what changed is that missing by one now costs 8 rather than
   everything.

7. **BLINK-CLASH is narrower than the Dev Note, on purpose.** The note asks for AR's rule: two units
   ending on one square both "stop on the square immediately before their intended final
   destination". A blink has no squares in between to stop on — which is what makes it a blink, and
   what the note itself says ("blinks typically bypass obstacles mid-journey"). Inventing a
   traversal for it would be inventing geometry *and* an unlisted ruling, so I fixed the half that
   is unambiguously wrong — the coin flip, where iteration order decided which of two identical
   orders landed — by refusing the contested square to both, which is CLASH-AR rule 2's shape for a
   movement whose last-held square is its origin. The "land adjacent along the line" half is the
   Designer's and is flagged below.

8. **AIM-PREVIEW-RANGE routed the preview through `commitAim` rather than adding a range check.**
   The preview and the click now share one resolver, so they cannot disagree about whether an order
   exists — a stronger property than "the preview also checks range", and it picked up the
   occupied-landing and own-square refusals for free. One existing UI1 test had been passing only
   because the preview did not check: it hovered 8.25 squares away with a range-6 grenade.

## Open Questions for the Analyzer — 2026-09-10

1. **BLINK-CLASH — should a blocked blink land adjacent instead of not at all?** (Dev Note 3;
   `blink-clash.test.ts`, `contestedBlinks` in `resolve.ts`.) I shipped "neither lands", which fixes
   the reported coin flip and matches CLASH-AR rule 2. The owner's AR text wants both stopped "on
   the square immediately before their intended final destination", which for a teleport needs a
   ruled definition of "before" — nearest legal square along the origin→destination line? nearest
   legal square to the destination? — and that is new geometry plus a tie-break. **Designer/Analyzer
   call**; the engine change is small once the definition exists.

2. **CLASH-CORNER residual: a bounced passer with nowhere behind it.** (`bounceOffOccupied`.) If
   every square on its own path *and* its origin are occupied by other units' rests, it stays on the
   shared square. Needs a conga line to reach. Options: displace the ender, allow the transient, or
   rule the origin permanently reserved. Low priority, but the invariant test would catch it as a stack.

3. **Dev Note 1 — PR #60's character changes are all in `data/` and all supported.** Verified: the
   melee flags, Thorn's `lifetime: 3`, the three redesigned autos and Bastion's `axisBonus` are on
   `main`, and every key the roster uses is in `ABILITY_KEYS`. The one piece that was still owed was
   **Cinder's Ember Bolt**, which is BASIC-INNER's own data edit and shipped this session. Nothing
   outstanding — recorded so the question does not need asking twice. (**Kestrel** remains out of
   the client's default eight-character `CATALOG` by the Designer's own note; reachable only via
   MAPTOGGLE. Confirm that is still intended.)

4. **Does AIM-PREVIEW-RANGE want a "you cannot go there" tell?** Today an out-of-range hover paints
   *nothing*, which reads as "no", but silently. A greyed marker or a red tint would say it out
   loud. Not specced, so not built.

5. **M3-LOBBY was not started this session** — the three scheduled items plus three Dev Notes filled
   it. It is unblocked and unambiguous; it is simply large.

## 2026-09-11 — Builder: the chase sees, blinks land, and the lobby gets a data model

1. **CHASE-LOS changed only the chase's *step* predicate, not its *admissibility* gate.** `walkChase`
   now asks `teamHasSightline` (range-less: line of sight, then concealment), so a chaser closes on a
   target it can see across an open map at any distance — which is what the item asked for. But
   `planUnit` still admits a chase order only when `teamCanSee(...) || lastKnownFor(...) !== undefined`,
   and `teamCanSee`'s *first* gate is range. So a target visible-but-distant at plan time is still
   refused the order before the fixed loop ever runs. The Spec Notes said "change ONLY the chase
   predicate", so I did not widen the plan gate — flagged below rather than guessed at.

2. **BLINK-ADJ supersedes two earlier fizzles, and both test files say so rather than losing the
   case.** DASH-OCCUPIED's "a teleport onto a body does nothing" and BLINK-CLASH's "neither lands"
   were the rulings this one replaces; ten tests asserted them. Each was rewritten with the reason it
   flipped, not deleted, so the history of the rule is readable from the tests. The client's
   `isBlockedDashLanding` veto went with them — it survives as a *tell* (documented as not a gate),
   because a client that refused the click would have made the engine's new landing unreachable.

3. **The blink's landing needs no tie-break of its own.** Teleports resolve in a fixed order and each
   one scans a board the earlier ones have already moved on, so the first blinker takes the nearest
   square and is standing on it when the second scans. The scan itself is Manhattan rings, row-major
   within a ring — deterministic, and the only ordering the rule contains.

4. **CLASH-CONGA terminates because origins are pairwise distinct.** A cancel sends exactly one more
   unit home, and no two units share a phase-start square, so the recursion is bounded by the number
   of movers. Recorded because the function is recursive and the bound is not local to it.

5. **AUTO-PREVIEW's band is the engine's own `axisSquares`/`innerSquares`, never a client guess at
   which tiles look central.** The drawn band and the paid band are then the same set by construction,
   and the property test asserts it for every reworked auto at every aim.

6. **Lumen's difference is a number, not a colour.** FF1 picks each effect's targets by *team*, not by
   square, so the heal covers exactly the damage's tiles. There is no "heal half" of the footprint to
   paint, and the only honest tell is writing both numbers down (`damageTell`).

7. **M3-LOBBY: `lobbyReady` is deliberately stricter than `canStart`, and `teamCovered` is derived
   from GAME_SPEC §1 rather than tabulated.** A player runs at most two characters, so a team of N
   characters needs at least ⌈N/2⌉ seats before its characters have anyone to order them — which is
   where the spec's "4v4 requires a minimum of 4 players" comes from. `canStart` only asks whether both
   teams have somebody, which was enough while `startMatch` dealt characters itself; a lobby that asks
   players to pick has to know the picks will add up. `canStart` is unchanged; the new predicate sits
   beside it.

8. **`teamSplit` states `deriveSeats`' split forwards, and that is load-bearing.** The lobby asks each
   seat for exactly as many characters as `deriveSeats` will hand it back, in the same team-then-join
   order, so a seat's own picks return to it as its own `unitIds`. Two different answers to "how many
   does this seat run" is how a player picks a character somebody else ends up controlling; the test
   asserts the round trip against the engine rather than restating the arithmetic.

9. **Picks are blind across teams, so they are stripped from the broadcast `RoomView` and delivered by
   a per-seat `lobby` message.** The R3 ruling calls cross-team mirrors "blind-pick mirrors", which
   only means anything if neither side watches the other choose — a broadcast pick list would make
   every pick after the first a counter-pick. The split is M3-LOCKLIST's, applied to picks instead of
   locks: own team in full (teammates coordinate; hidden information is team vs team), the enemy as a
   bare count of seats that have finished. Flagged below as a reading of an implication rather than of
   a stated rule.

10. **A full room that is mid-pick now waits instead of auto-starting over the picks.** The ruled
    trigger — a full room starts — predates there being anything to pick, and firing it while a player
    is halfway through choosing would discard their choices silently. The guard is narrow: it holds
    only when some seat has picked *and* the lobby is incomplete, so a room where nobody picks behaves
    exactly as it did. The larger question this exposes is question 2 below.

11. **The client reads the protocol types from `@cards/server` as types only.** Subpath exports
    (`./protocol`, `./room`, `./hub`) were added to the server package so the client can import the
    wire's definition instead of keeping a second copy of it in step by hand. `import type` is erased,
    so nothing of the server reaches the bundle — the budget check is unchanged at 178.7 kB gz. The
    end-to-end test imports the hub for real, which is what makes it an end-to-end test.

## Open Questions for the Analyzer — 2026-09-11

1. **CHASE-LOS is complete in the loop and incomplete at the gate.** (`planUnit` in `resolve.ts`;
   `chase.test.ts`, the case that had to be given a prior sighting to pass.) `walkChase` now follows a
   target it has a sightline to at any range, but `planUnit` still *admits* a chase order only when
   `teamCanSee(...)` — range-capped — or a last-known square exists. So the exact scenario the item
   describes (an enemy visible down an open lane, further away than `VISION_RANGE`) is refused at plan
   time and never reaches the fixed loop. Widening the gate to `teamHasSightline` is a two-word change
   and I did not make it, because the Spec Notes said to change only the chase predicate. **Needs a
   ruling: is the admissibility gate part of CHASE-LOS, or is the range cap on *ordering* a chase
   intentional?**

2. **Does the full-room auto-start retire now that a lobby exists?** (`#startIfReady` in `hub.ts`.)
   The ruled trigger is "a networked match starts when the room is FULL". With picking in the
   protocol, a four-player 2v2 fills on the fourth join *before anyone has picked*, so the auto-start
   fires and the lobby is unreachable in exactly the room that is most likely to want it. I shipped
   the minimal compliant guard (hold only when picks are outstanding), which does not help a room that
   has not started picking yet. The clean answer looks like "a room with a lobby starts on the start
   button, not on being full", but that reverses a stated ruling, so it is yours. Short rooms are
   unaffected either way.

3. **Confirm picks are hidden across teams.** (Decision 9 above; `protocol.ts` `LobbyView`,
   `lobby-protocol.test.ts`.) The edge-cases ruling implies it by calling mirrors "blind-pick", but no
   entry says it outright, and it is a hidden-information rule — golden rule 5 territory, so I would
   rather have it written down than inferred. If picks are meant to be public, the fix is deleting the
   filter, not adding one.

4. **`POST /rooms/:code/start` is still there, and the AC says the lobby's start button deletes it.**
   (`worker.ts`.) The socket now carries `start`, so the route is redundant *for a client with a lobby
   screen* — and the lobby screen is the part of M3-LOBBY that has not been built. Deleting the route
   this session would have left the networked match with no reachable start at all. It goes with the
   UI slice.

5. **M3-LOBBY's remaining scope, for the next batch:** the lobby **screen** (map/format/character/
   catalyst pick UI over `RoomClient`), wiring `app.ts` to the socket, and then the route deletion.
   The data model, the protocol and the network client all landed and are covered; what is left is
   client UI, which is the biggest single piece and wants its own session.

6. **A seat can be owed zero characters, and only in 1v1.** (`teamSplit`.) Two players on a one-
   character team leaves the second with nothing to pick or order. `deriveSeats` has always done this
   (it emits one seat and the second gets `?? []`), so it is not new, but a lobby makes it visible —
   a player staring at a pick screen that asks for nothing. 1v1 is the dev format, so it is cheap
   either way: refuse the second join in 1v1, or let the lobby say "spectating". Not ruled, not built.

## 2026-09-12 — Builder: the chase stops phasing, the lobby gets a screen, and moves get waypoints

1. **The two chase Dev Notes turned out to be one cause, and one of them was the opposite of what
   it looked like.** The router is `reachableSquares`, which marks an occupied square `canStop:
   false` but still *expands through* it — correct for a player drawing a path (the ally
   pass-through affordance) and wrong for a route walked the instant it is computed. So the
   reported "phasing" was not a chaser gliding through a body: it was a chaser that **planned** to,
   got stopped by `stepMovers` on its first step, and therefore moved **nothing**. Reproduced
   before touching anything: chaser (5,10), enemy (6,10), target (8,10) → chaser ends on (5,10).
   `reachableSquares` gained an opt-in `impassable` set; only the chase passes one.

2. **A decoy is solid to the chase and to nothing else.** R2 says a decoy "blocks nothing" and dies
   to an enemy *ending a move* on its square — deliberately, because walking onto one is how a
   player proves it fake. But the chase is not a player choosing to test it: Wisp veils, the chaser
   loses the sightline, the goal falls back to the last-known square, and the decoy is standing on
   that square — so every such chase popped the decoy for free. The minimal compliant fix treats an
   **enemy** decoy as a body **for the chase router only**; a deliberate `movePath` onto one still
   destroys it, and there is a test pinning that. **Own-team decoys stay transparent**, matching
   R2's own asymmetry (own-team decoys are untouched by their team's damage) — a team is not fooled
   by its own illusion, and blocking on one would be a tell the enemy could read off the pathing.
   No fog is leaked: an enemy decoy is *shown* to this team, so routing around it uses only what
   the team already sees.

3. **The chase router treats allies as solid too, and that is not the ally-pass-through ruling
   being reversed.** That ruling is about a path a player *draws* and the engine validates later.
   A chase computes and walks in one step against units that have all finished moving, so an ally
   is exactly as immovable as an enemy at that moment. A sealed corridor therefore stops a chase
   dead, which the test asserts as the honest outcome rather than papering over it.

4. **SEAT-ZERO's guard is unreachable through `join` today, and the tests say so instead of
   pretending.** `nextTeam` always fills the emptier side and `roomFull` caps the room at
   `2 × charactersPerTeam`, so no sequence of joins can saturate one team while the room has space.
   The rule was still worth writing down — the obvious next lobby feature is letting a player
   *choose* a team, which produces exactly the lopsided room the guard refuses — so it is an
   exported predicate (`wouldSeatNobody`) tested directly, plus a property test that no reachable
   join sequence in any format ever creates a zero-character seat.

5. **`MatchConfig.teams` became optional, and the DO dropped it.** LOBBY-START retires the
   full-room auto-start, but a room that could still *deal* characters would let a player press
   start and be handed somebody else's choices — the same defect one layer down. So the interim
   deal is now an explicit opt-in that production does not take: the Durable Object carries the
   full eight-character roster and no `teams`, and a networked match gets its characters from the
   lobby or not at all. Tests that predate picking pass a deal and are unaffected.

6. **The mid-pick guard moved from the auto-start into `start()`.** With the auto-trigger gone the
   guard had nowhere to live, but the hazard it covered did not: a config *with* an interim deal
   would otherwise deal over a half-filled lobby. `start()` now uses the deal only when **no seat
   has picked at all**; once anybody has, `lobbyReady` is the only door. That is what makes the
   AC's "start is refused until `lobbyReady`" true for every room that is actually using its lobby.

7. **The lobby screen renders what the protocol sends and recomputes nothing** — the owed counts,
   R3's greyed characters and `lobbyReady` are all values from the `lobby` message. This is not
   only tidiness: BLIND-PICK means the enemy's picks are not on this client, so it is
   *structurally incapable* of deciding whether the room is ready. One boolean, forwarded.

8. **The pick screen is rebuilt on every update, which is the opposite of the HUD's rule and right
   for the same reason.** The HUD is updated in place because UI1's hover state is load-bearing —
   rebuilding a button under the pointer fires `mouseleave` and wipes the range envelope. A lobby
   has no such state, so the simpler thing is also the correct one.

9. **The client reads `@cards/server`'s protocol as types only, and the lobby tests import the hub
   for real.** `import type` is erased, so nothing of the server reaches the bundle (181.5 kB gz,
   well inside the 300 kB budget). The screen tests deliberately do *not* fake the wire: a click
   goes through `RoomClient` into a real `RoomHub` and is validated by the same `setPicks` a
   production room uses, so a screen that composed a pick the server would refuse fails there.

10. **WAYPOINTS delegates legality to `validateMovePath` and treats exactly one verdict as
    non-fatal.** Adjacency, terrain, the diagonal-corner rule and the budget are all the engine's
    answers rather than a client copy. The exception is `occupied`, which is a rule about where a
    path *ends* rather than whether a step is legal — refusing it mid-route would make walking
    around a body impossible, and that is the Dev Note's own example. Whether the finished path
    ends somewhere legal is still settled by the engine when the order is submitted.

11. **The Move button now reads what is left, not what you started with.** `remainingMove` is
    `movementBudget − Σ stepCost`, using the engine's own `stepCost`, so the number a player
    watches draw down is the number they will be charged. It changes the non-waypoint case too — a
    committed direct route now reads `Move (0)` — which is the same fact stated honestly.

## Open Questions for the Analyzer — 2026-09-12

1. **M3-LOBBY-UI is complete except the networked BOARD, which is the whole remaining piece.**
   (`main.ts` `joinRoom`; `app.ts` `resolveAndPlay`.) Shipped: the pick screen, socket wiring,
   `?room=CODE` boot, the start button gated on `lobbyReady`, the auto-start retirement and the
   route deletion — with an end-to-end test that picks, starts and resolves a turn through a real
   `RoomHub`. **Not shipped:** rendering a *networked* match on the 3D board. `app.ts` merges seat
   orders and calls `resolveTurn` itself; pointing it at a server-authoritative stream means the
   lock-in becomes a `submit`, the fog comes from `visibleSquares` instead of the local `fogView`,
   and the hot-seat handover disappears — a controller rewrite inside a 1750-line file with the
   whole render e2e suite downstream of it. I stopped at a clean seam rather than half-doing it;
   on match start the page says so instead of pretending. **Please size it as its own item** —
   suggest "M3-NET-BOARD".

2. **Dev Note 1 vs the R2 decoy ruling — confirm the line I drew.** (Decision 2 above;
   `chase-collide.test.ts`.) R2 says a decoy blocks nothing and dies to an enemy ending a move on
   it; the owner says a chase must not move onto one. Both are true in what I shipped, because the
   chase is engine-routed and a `movePath` is not. If the owner meant something broader — *no unit
   may ever enter a decoy's square*, i.e. decoys become obstacles — that reverses R2's own
   destruction mechanic and needs a Designer call, not a Builder one.

3. **Should the chase's ally-solidity be visible in the plan-time preview?** (`chaseObstacles`.)
   The chase now routes around teammates, but the client's chase preview does not know that, so a
   player can be shown a pursuit that will actually detour. Cosmetic today (the chase tell is a
   destination marker, not a drawn route), and it becomes real the moment somebody draws the chase
   path. Not built; not specced.

4. **A `wouldSeatNobody` that nothing can reach is a guard or a dead branch, and you should pick.**
   (Decision 4.) I kept it because the team-choice lobby will need it. If team choice is not on the
   roadmap, it is worth saying so and letting the guard go rather than carrying an unreachable
   rejection code through the protocol.

5. **The lobby has no map/format picker, and the AC asked for one.** (`M3-LOBBY-UI` AC bullet 1:
   "each seat picks **map + format**".) Both are fixed at room creation today — the Worker takes
   `format` when it mints the code and the DO hard-codes `duel-arena` — so a picker in the *seat's*
   screen would be picking something already decided, and letting one seat change the map under
   another mid-pick needs a rule nobody has written (who wins? does it reset the picks?). Shipped
   the character/catalyst half; **the map/format half needs a ruling on where it lives** (room
   creation, which is where it already is, or a host-only control in the lobby).

6. **`?room=CODE` has no way to *create* a room from the client.** The Worker's `POST /rooms` mints
   a code, but nothing in the UI calls it — a player needs a link somebody else made with `curl`.
   One button and a redirect; not in this item's AC, so not built. Flagging because it is the last
   thing between the lobby and somebody actually playing over the network.

## 2026-08-16 — BASIC-BEAM unblocked; AXIS-MODIFIERS-CHECK answered (Designer)

The Builder blocked BASIC-BEAM rather than guess, and was right to: my "Shield Bash as a 1×2
beam" phrasing collided with the half-width reading (`beamWidth: 1` → a 3-wide lane), and
those are different abilities. Two rulings unblock it. **(1) `beamWidth` is the TOTAL width
in tiles, odd only.** A designer writing `beamWidth: 3` gets a 3-wide beam — the standing
"a number in data/ means the footprint you get" principle, applied a third time. Even values
are a validation error (an even lane has no centre axis to rotate around); the engine maps
to the existing integer comparison as `halfWidth = (beamWidth − 1) / 2`. **(2) Aegis's
Shield Bash becomes `beamWidth: 3`, range 2, damage 20 — six tiles, not two.** The 1×2 I
originally wrote is retracted as the error here: a 2-tile footprint is a ~75% area cut on an
auto attack, which no damage bump repairs, and it reads as a spear when the fantasy is the
whole shield face hitting the two rows in front of you. 8 → 6 tiles is the honest price of
the shape's identity (the cone's diagonal splash goes); the lever if Aegis whiffs on brawl
corners is `beamWidth` 3 → 5, not a return to the cone. The data edit ships in the Builder's
BASIC-BEAM commit — the field is not in the schema yet, and data must not lead the engine.
**(3) AXIS-MODIFIERS-CHECK: scales, confirmed.** The axis bonus is damage and damage
composes through the ruled order; a flat exception would be the only number in the game
outside the composition rules — invisible to Might and cover alike, and a special case the
engine does not need.
