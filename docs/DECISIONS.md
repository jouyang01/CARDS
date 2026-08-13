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
