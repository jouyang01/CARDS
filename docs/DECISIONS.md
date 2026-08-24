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

## 2026-09-13 — Builder: the waypoint gesture works, rooms can be made, and a networked match renders

1. **WAYPOINTS shipped green and did nothing, and neither fault was in the function its tests
   covered.** The Shift branch was nested inside the "move is already armed" arm of `onBoardClick`,
   so a player who had merely selected a unit never reached it; and `appendWaypoint` took one
   adjacent step per click, refusing anything further with a bare `undefined`. Thirteen unit tests
   passed over the half that worked. The gate is now `waypointClick()` — a named rule with the
   broken case (nothing armed) as its first test — and the routing is `appendWaypointRouted`, which
   delegates to `pathTo` from the last waypoint on the remaining budget. **The lesson recorded, not
   just the fix:** a rule expressed as a nesting level is a rule no test can hold.

2. **The AC asked for the real click handler to be driven, so there is a browser test, and it was
   verified to fail without the fix.** I sabotaged `waypointClick` to return `'ignore'`, watched
   the new e2e go red, and reverted. A test that cannot fail is worth less than no test, and this
   item exists precisely because the previous batch's tests could not fail on the thing that was
   broken.

3. **PR #66 shipped a render regression that nothing caught, and it is fixed here.** The
   AIM-RANGE-TELL commit **deleted** `renderer.highlight('impact', …)` while adding its own version,
   and the replacement never landed — so DASH-PREVIEW's landing discs silently stopped drawing and
   AIM-RANGE-TELL's own marker never appeared, with `refusedAim` and `REFUSED` sitting in the file
   as dead code through a green suite and a green render e2e. The decision is `impactLayer()` now:
   three things share that layer and none can be wanted at once, which is a fact a pure function can
   state and a render loop cannot. WAYPOINTS-FIX needed the marker, which is how it surfaced.

4. **A waypoint refusal is click-driven, unlike AIM-RANGE-TELL's hover-driven one.** It is an answer
   to something the player *did*, so it survives the pointer moving off the square; a hover-scoped
   marker would flash and vanish. Cleared by the next click that does anything.

5. **`occupied` stays non-fatal mid-route, and that is now load-bearing rather than incidental.**
   The verdict is about where a path *ends*; refusing it mid-segment would make routing around a
   body — the Dev Note's own example — impossible. Whether the finished path ends legally is settled
   by the engine at submit, as it always was.

6. **M3-ROOM-CREATE needed the map to become real.** `POST /rooms` took only a format and the DO
   hard-coded `duel-arena`, so a host's map chooser would have been a control over nothing. The room
   record now carries a `mapId` — an **id, not a `MapDef`**, because the record is persisted and
   shipped over the wire and re-sending a board of terrain the client already has is paying for
   nothing — and the DO builds its `MatchConfig` per room from it.

7. **An unknown map is a 400, not a fallback.** MAPTOGGLE's rule one layer up: creating a room on a
   different board than the host asked for is the one outcome a chooser must not have.

8. **The create form narrows formats by the chosen map's spawn counts.** A two-spawn map cannot seat
   a 4v4, and `validateMapForFormat` would only say so at match creation — by which point the room
   exists and everybody has picked. Derived from `map.spawns` rather than tabulated, so a map that
   grows a spawn starts offering the bigger format without anyone editing a list.

9. **M3-NET-BOARD forks the controller at exactly one point.** `resolveAndPlay` became
   `collectOrders` / `endTurn` / `playResolution`, and only `endTurn` differs: the hot-seat resolves
   because it *is* both sides, a networked client submits because it is one seat of two. Everything
   downstream takes the same `(prev, events, next)`, so the board cannot tell which produced them —
   which is what let a networked match render on the renderer the hot-seat already had, rather than
   growing a second one.

10. **The networked fog is the seat's by construction, not by a flag.** The state the board renders
    *is* the server's team-filtered view, so an enemy outside vision is **absent from the data**
    rather than present-and-hidden. There is no local view for a bug to widen. `visibleSquares` is
    still sent and still unused by the board — flagged below rather than wired for the sake of it,
    because `fogView` over an already-filtered state computes the same answer.

11. **`RoomView` gained `mapId` because the client must draw the board the server is resolving on.**
    Public information by definition — it is the terrain everybody is about to look at — so it rides
    the broadcast view rather than the per-seat one.

## Open Questions for the Analyzer — 2026-09-13

1. **BASIC-BEAM is no longer blocked, and the backlog has not caught up.** (`docs/design/
   clashes-and-basics.md` §3.4, commit `a2d94d5` on `main`.) The Designer ruled it while this batch
   was being written: **`beamWidth` is the TOTAL width in tiles, odd only** (even is a validation
   error — no centre axis), the engine maps it to `halfWidth = (beamWidth-1)/2`, and **Aegis's
   Shield Bash is `beamWidth: 3`, range 2**. BACKLOG.md still says "BLOCKED on a Designer number"
   and your notes for this session repeated it, so I did not build it — the number exists now and
   the item is a `coneSquares` substitution plus one data edit. **Please reschedule it.**

2. **`visibleSquares` is sent to the board and not read.** (M3-NET-BOARD AC; `main.ts`
   `startNetworkedMatch`, `app.ts` `paintFog`.) The AC says the board should show "server-filtered
   `visibleSquares`… not the local `fogView`". What shipped is equivalent but arrives differently:
   the *state* is filtered, so `fogView` over it computes this seat's own vision and nothing wider.
   Using `visibleSquares` directly would be one less derivation and would survive a future
   filtering change on the server — but it is a second source of truth for the same fact today.
   **Confirm which you want**; I did not add a second path speculatively.

3. **A networked match has no timer and no "waiting for the other side" state.** (`app.ts`
   `endTurn`.) After submitting, the board sits on the last frame with the HUD still armed —
   nothing says the turn is locked or that anybody is being waited for. UI-TIMER is per-seat and
   client-side, and M3-TIMER (server clock) is blocked on this item. The gap is small and the fix
   is a HUD state, but "what does a networked client show while it waits" is not specced. **Worth
   an item** — suggest "M3-WAIT-STATE".

4. **The networked path has no reconnect and no disconnect handling in the UI.** A closed socket
   sets `phase: 'closed'` and the board simply stops responding. M3-RECONNECT owns the rejoin; what
   is unowned is the *client* saying it happened. Same shape as #3.

5. **`?create` has no link to it from anywhere.** A host still has to know to type it. One link on
   the hot-seat page would close the loop end-to-end; not in the AC, so not built.

6. **Confirm the chase-preview gap is still acceptable.** (Prior OQ 2026-09-12 #3, unruled.) The
   chase now routes around bodies but the drawn chase route does not, so a player can be shown a
   pursuit that will detour. Unchanged this session; re-flagged because it is the last known
   preview/resolution disagreement.

## 2026-09-14 — Builder: the waypoint line, the two networked banners, a front door, and Aegis's beam

1. **The waypoint Dev Note was a preview bug, not an order bug.** `previewMovePath` answered
   `pathTo(hover)` **from the unit** whenever move was armed and the pointer was over the board —
   which is precisely the state a Shift-click leaves you in. So the composed route was replaced on
   screen by a fresh direct line at the next `mousemove`, while the waypoints sat in the draft,
   invisible, and resolved perfectly. The order was always right; only the drawing was wrong, which
   is why it read as "invisible" rather than "broken".

2. **The drawn route now depends on the modifier, and `Hover` carries it.** With Shift the line is
   the committed path plus the segment the next click would append; without it, the direct route a
   plain click would produce. Both come from the functions the click itself uses
   (`appendWaypointRouted` / `pathTo`), so preview and commit cannot describe different moves —
   AIM-PREVIEW-RANGE's rule applied to the move. `hoverBoard` also had to stop comparing squares
   alone: pressing Shift without moving the mouse changes what the line means, so it is a repaint.

3. **Waypoint marks are the clicked squares, not every step.** A segment is routed, so most of the
   path is the router's choice; the marks record the player's. Kept beside the draft rather than in
   it, because the *order* carries a `movePath` and which of those squares were chosen is a fact
   about the gesture that only the board needs.

4. **The wait/connection banner is one string, and it is the one string that mentions the other
   team.** So `WaitView` carries own-team as a **list of seat ids** and the enemy as a **number** —
   M3-HIDDEN's count-only rule held by the type rather than by remembering. There is no enemy id in
   scope to leak even by accident.

5. **A closed socket outranks the waiting line**, and that ordering is a decision rather than a
   fall-through: once the socket is gone the resolution this client claims to be waiting for is
   never coming, so "waiting for 1 opponent" would be the more misleading of the two true things.

6. **The board disarms *before* the submit is sent, not after the reply.** A live aim on screen
   while the packet is in flight is a turn the player thinks they can still change. Board clicks and
   Lock In are refused while a banner is up, rather than accepted-and-ignored.

7. **`CREATE-LINK` had to opt back into pointer events.** `#app` is `pointer-events: none` so the
   board can be clicked through the chrome, which means a link inside it is invisible to the mouse
   by default — a link nobody can click would have been the same bug one layer down, so the browser
   test clicks it rather than merely finding it. Hidden on the create form and inside a room, where
   it is noise and a way to walk out of a match by accident.

8. **BASIC-BEAM is one substitution, as scoped.** The wedge already measures each tile's
   perpendicular offset; `beamCovers` compares that same integer against a constant instead of
   against the depth. Both tests stay exact — the half-tile tolerance lives *inside* the width
   comparison as `4b² ≤ (2h+1)²·|V|²` rather than being bolted on as the cone's separate edge skirt,
   which is why a beam needs no `nearEdge`/`nearCap` of its own.

9. **Even `beamWidth` is refused rather than rounded.** An even lane has no centre axis to rotate
   around, so `beamWidth: 2` is not a wider beam but an ill-defined one. Refused as data for the
   reason every validator here exists: a number the engine quietly reinterprets is a number the
   designer cannot reason about.

10. **Aegis's data edit is two lines, and the description changed with the shape.** `beamWidth: 3`
    plus the text — "a short crushing arc" described a fan and this is a wall. Range, damage and
    `melee: true` are untouched, as the ruling requires. The engine change is separately covered, so
    the data edit is the only thing that had to be got right by hand.

## Open Questions for the Analyzer — 2026-09-14

1. **`AXIS-MODIFIERS-CHECK` is answered and the backlog has not caught up.** The Designer closed it
   in the same section that unblocked BASIC-BEAM (`clashes-and-basics.md` §3.4, last paragraph):
   *"AXIS-MODIFIERS-CHECK is answered: scales, confirmed, no change."* BACKLOG.md still lists it as
   an open Designer decision. **No work needed — please close it.**

2. **The waypoint marks are cleared on a plain move click but not on an ability commit.**
   (`app.ts`, `waypointMarks`.) Arming and committing an ability leaves a composed route and its
   marks on screen, which is correct — the move is still part of the turn — but I have not tested
   the interaction of a *dash* replacing the move. Low risk, and I would rather flag it than assert
   a behaviour nobody has ruled.

3. **M3-TIMER's seam is ready, and it is narrower than it looks.** (`waiting.ts`, `hud.setBanner`.)
   The banner is a single string the controller re-renders on every status change, so the server
   clock has one place to land. What is *not* decided: whether the countdown replaces the banner
   text, sits beside it in the existing `UI-TIMER` slot, or turns the banner into a structure.
   **Worth one line in the M3-TIMER spec** before it is built.

4. **A networked match still has no end-of-match screen.** Out of scope everywhere so far and not a
   bug, but with the loop now closed (create → pick → play → resolve) it is the next thing a player
   hits and there is nothing there. Not scheduled; flagging because the loop is otherwise finished.

5. **`beamWidth` is on the ability, so a `beamWidth` cone with an `axisBonus` is legal.** Aegis has
   no axis bonus so nothing ships in that combination, and the geometry composes fine (the axis of a
   3-wide lane is its centre file). Recorded rather than forbidden — if a beam is never meant to
   carry an axis bonus, that is a validator line, not a bug.

## 2026-09-15 — Builder: a dash takes its route, a match ends properly, the clock is the server's, and a seat can be reclaimed

1. **A dash's route follows the dash, and it is derived rather than cleared.** `nextDraft` already
   drops `movePath` for both a dash ability and a Dash catalyst, so the order was always right; the
   *marks* were the only thing left drawing a path that would not execute. Rather than adding a
   second place that has to remember to clear them, `liveWaypointMarks(marks, movePath)` keeps only
   the marks still on the live route. A mark can then never outlive the path it annotates, which is
   the class of bug rather than the instance.

2. **The end screen's verdict is per seat, so it only exists where a seat does.** "Team 2 wins on
   kills, 4–2" is exactly right for a hot-seat, where one screen holds both sides, and useless to a
   networked player who does not know whether they *are* Team 2. So `outcomeFor(state, viewer)`
   turns the engine's own `status`/`winner` into a point of view, the headline is drawn only for a
   networked seat, and nothing anywhere recomputes who won.

3. **The way out is the front door, not a rematch.** Re-entering a room is a protocol conversation
   nobody has specced; the create form is one click from a new match and already exists. A hot-seat
   goes to a fresh hot-seat, a networked match to the create screen, and the label says which.

4. **The decision clock is injected, exactly like `mintCode`'s randomness.** `RoomHub` takes
   `now: () => number`; the Durable Object passes `Date.now` and every test passes a counter. A hub
   that read a wall clock could only be tested by sleeping, and a sleeping test is a flaky test.

5. **One deadline per turn, for the whole room — and the Time Bank extends *that*.** A per-seat
   deadline would give a simultaneous turn four different moments at which it resolved, which is not
   a thing a simultaneous turn can have. So a charge is per seat (you may only spend your own) and
   the ten seconds it buys are everybody's. It is *added* to what is left rather than resetting the
   window: banking at 8 seconds leaves 18, not 40.

6. **Expiry is the same resolve the last lock-in would have triggered.** "Missed → hold" needed no
   code of its own: `mergeSeatOrders` already contributes nothing for a seat with no submission, and
   a unit with no orders holds. `expire()` re-checks the clock itself and clears the deadline at the
   resolve, so an alarm that fires early or late is harmless — which is what lets the DO's alarm be
   best-effort.

7. **The window goes over the wire as a duration, not an instant.** An absolute deadline is in the
   *server's* epoch, and a browser five seconds fast would draw it five seconds short. `remainingMs`
   is measured at send time and is the same number on both machines. The clock is still the
   server's: it is the thing that acts when the number reaches zero.

8. **The Time Bank asks; it does not apply.** The client sends `extend` and changes nothing locally.
   An optimistic +10 s that the server then refused would be the one lie a clock must never tell —
   time on screen the server does not believe in, and a turn that resolves while the readout still
   reads 9. The extension flash fires off the charge count *falling*, so it can only ever celebrate
   a charge that was actually spent.

9. **The countdown does not stop when a networked seat locks in.** The hot-seat's clock does — its
   window is that seat's — but a networked window is the room's and is still running: it is now what
   bounds the opponent. That is the pairing M3-TIMER asks for, with the banner saying what you are
   waiting for and the countdown saying how long it can last.

10. **A disconnect in a match holds the seat; a disconnect in a lobby deletes it.** `leave` owns the
    split. A lobby seat is nothing but a socket, and freeing it re-prices everybody's picks. A match
    seat is a team, a name and a control map the match still needs — deleting it would strand its
    characters and make the ruled reclaim impossible, because there would be nothing left to
    reclaim.

11. **A dropped seat keeps the submission it already made.** This used to be binned. Wrong direction
    once a seat can come back: a player who locked in and *then* dropped had already taken their
    turn, and throwing the orders away punishes them for a socket closing after the decision.

12. **The turn is not owed an answer by an empty chair.** A disconnected seat with no submission
    stops counting toward the lock total, so the three players still there resolve between them
    instead of waiting out the full 40 seconds every turn after a permanent drop. The absent seat
    contributes nothing to the merge either way; the only thing that changed is how long everybody
    else waits to find out.

13. **The reclaim is a socket→seat binding, not a rename.** The Durable Object hands the hub the
    socket id *it* minted on every frame and has no idea a reclaim happened, so `#bound` maps one to
    the other and everything downstream stays keyed by seat. A fresh socket binds to itself, which
    is why nothing but a reconnect can tell the difference.

14. **The resync is `matchStarted`, not a message of its own** — and `matchStarted` now carries the
    seat. A rejoining client needs precisely what a starting one needs (the board as its team may see
    it, and what it controls), and a second message saying the same thing is a second one to keep in
    step. It carries `seat` because a reclaimed seat never sees a `joined`: the resync is the first
    thing it hears and has to be able to say who you are.

15. **The partial-team handoff is DERIVED, which is what makes the return free.** M3-RECONNECT's AC
    says to decide the last OPEN in "Teams & control" — *"if one player on a multi-player team
    disconnects, does a teammate gain control of the abandoned characters? Current lean: yes, after
    one fully missed turn"* — so the standing lean is taken as the ruling and implemented as
    written. **`docs/design/edge-cases.md` is not the Builder's to edit**; this is the record, and
    the ruling wants promoting into the edge-cases file by whoever owns it. `controlledUnits`
    computes the answer
    from `connected` and `missedTurns` rather than moving `unitIds` between seats, so reclaiming —
    which clears both — un-does the loan by making it no longer derivable. There is no hand-back step
    to get wrong. The stand-in is the **first connected seat on that team in join order**, so every
    client and the server agree on who is holding what without anybody being told.

16. **The control map now rides every Decision phase.** It used to appear once, in `matchStarted`,
    which was fine while it could not change. It can now — a teammate drops, a teammate returns — and
    a map sent once at the start would leave a stand-in unable to order characters the server has
    already given them.

17. **A ticket is tried *instead of* an ordinary join, never after one.** A ticket that failed must
    not quietly seat the client somewhere else: the whole point of a reclaim is *which* seat it is,
    and being put in a stranger's chair is worse than a refusal. The client clears a ticket the room
    refuses, which is also what stops the retry loop spinning on the same refusal.

18. **"Reconnecting…" and "reload to rejoin" are two different sentences.** One is "hold on", the
    other is "that is that", and a single "connection lost" for both leaves a player reloading over a
    rejoin that was about to land — and sitting patiently through one that never will. Hence a
    `reconnecting` phase distinct from `closed`, and a finite retry budget so the first sentence
    always eventually becomes the second.

19. **Storage that throws is expected, not exceptional.** `localStorage` throws in private browsing
    and with cookies disabled. A reconnect that is not offered is a worse outcome than one that is
    not remembered — but a match that dies on `localStorage` throwing is worse than both, so every
    ticket call is wrapped.

## Open Questions for the Analyzer — 2026-09-15

1. **The DO's deadline does not survive hibernation.** `#deadline` is in-memory; the room record on
   disk carries seats and state but not the open window. A Durable Object evicted mid-decision comes
   back with no deadline, so `expire()` finds no window and the turn waits for players instead of
   for the clock. **No regression** — that is exactly the pre-M3-TIMER behaviour — and the alarm
   re-arms on the next frame. Persisting it is one field on `Room` plus a line in `#arm`; I did not
   add it because the AC does not ask and it changes the record's shape. **Worth a backlog line.**

2. **`missedTurns` counts absence, not slowness, and only for a disconnected seat.** A *connected*
   seat that silently never locks in is timed out by M3-TIMER every turn and never loses its
   characters. That is deliberate — the ruling is about a disconnect — but "connected and idle
   forever" is a real griefing shape, and the two rules now sit next to each other. Flagging rather
   than deciding: an idle-player rule is a different item.

3. **A reclaimed seat gets the room's Time Bank charge count, which it never lost.** Charges live in
   the hub keyed by seat id, so a player who spends a charge, drops and comes back correctly has
   none. But the charges are **not** in the persisted record either (see #1), so a DO eviction hands
   everybody a fresh charge. Same fix, same reason it is not done here.

4. **The handoff is server-side and the *client* has no UI for it.** The stand-in's control map
   updates and the characters become orderable, but nothing on screen says "you are covering for
   Bo". The board just grows two more characters. Correct and playable; not explained. **A small
   client item** — a line in the wait banner, or a mark on the borrowed nameplates.

5. **`RoomView.seats` now carries `connected`, and no screen draws it.** The lobby and the topbar
   both have the data to mark a disconnected player and neither does. Same shape of gap as #4 and
   probably the same item.

6. **A rematch is still the missing half of the end screen.** M3-END-SCREEN sends a decided match to
   the create form, which is honest but throws the room away. A rematch needs a protocol
   conversation (both players agreeing to re-enter) that nobody has specced. Not urgent; the loop
   closes without it.

## 2026-09-16 — Builder: the clock survives eviction, absence is visible, and the deploy is one credential away

1. **TIMER-PERSIST is a location, not a save step.** The deadline and the Time Bank charges moved onto
   the `Room` record, which the Durable Object already writes after every frame. So "persisted" is done
   by code that was already there, and a hub reconstructed from storage is rehydrated by its
   constructor with nothing to remember. Keeping a private field *beside* the record would have made
   two copies of one fact, and one of two copies is always the stale one.

2. **The stored deadline is an absolute instant; the wire still carries a duration.** They are
   different problems with opposite answers. Storage needs an absolute — a remaining duration would
   have to be re-anchored to a wake time nobody recorded — and it is already the number `setAlarm`
   takes, so it rehydrates unchanged. The *wire* needs a duration, because the alternative is asking
   every browser to model its skew against the server's clock.

3. **A closed window is the absence of the key.** `withDeadline(room, undefined)` deletes it rather
   than setting `undefined`. Under `exactOptionalPropertyTypes` the two are different types, and after
   a JSON round-trip they are the same value — so the bug would be invisible in storage and loud
   everywhere else. Pinned by a test rather than left to a convention.

4. **A judgment call beyond the AC: the restore also detaches every seat.** `Seat.connected` means "a
   socket is attached to this seat", and a room rebuilt from storage has none — the instance holding
   them stopped existing without anything running `close`. Left alone, the record came back claiming
   everybody was present and refused each returning player's own ticket as `seatTaken`: **reconnect
   after an eviction was broken by the very restore meant to survive it.** This is the existing rule
   made true again after a restart, not a new one, and it is self-correcting in the other direction
   too (a reclaim clears `missedTurns`, so a room that woke empty and filled again leaves nobody's
   characters on loan). Flagged to the Analyzer as #1 below because it touches M3-RECONNECT's ruling.

5. **What eviction is, in a test, is doing what the runtime does.** `new RoomHub(detachAll(JSON.parse(
   JSON.stringify(hub.room))))`. The JSON round-trip is load-bearing rather than decorative: it is what
   catches a field that is a `Map`, which looks fine in memory and comes back as `{}`.

6. **NET-PRESENCE-UI reads; it never re-derives the handoff.** The client computes exactly one thing —
   "which of the characters I am ordering are not on my own seat" — which is set arithmetic on ids the
   server sent. It never asks *whether* the handoff should have happened; that is `controlledUnits`,
   and a second implementation of a rule that exists to be agreed on is worse than no display at all.
   The test that holds this is the turn of the drop: `connected` false, `missedTurns` still 0, control
   map unchanged, and the client says nothing — which a client that had guessed the rule could not do.

7. **`away` and `borrowed` are two marks because they are two facts.** One says this character's
   *player* is gone; the other says the handoff has put them in your hands. A character is usually
   both, and that is the point — the second is the explanation for the first. Collapsing them into one
   "absent" state would lose the sentence the item exists to say.

8. **A disconnected opponent is shown.** How many people are in the room has always been public
   (the lobby has always counted them), and a match that quietly continued against an empty chair is
   the most confusing version available. What stays own-team is *who is covering*, and only because
   the enemy's control map is not something this client is sent.

9. **The cover notice is third in the banner, behind the connection state and the wait line.** It
   explains a standing situation rather than announcing an event, so it is the one worth saying while
   nothing more urgent is happening — and the portrait marks say it too, and they are on screen
   regardless.

10. **The deployed client and the deployed Worker are different origins, so the server is
    configuration.** `VITE_WORKER_ORIGIN`, read once in `main.ts`; everything that uses it takes it as
    an argument, which is what keeps `room-url.ts` testable without a bundler.

11. **Absent means unchanged, and that is the load-bearing half.** With no origin configured the
    socket stays same-origin and the API path stays **relative** — relative specifically because
    Vite's proxy matches on the request path, and absolutising it would send the request back to the
    dev server instead of through it. So local play does not move because a deploy exists.

12. **A bare configured host is https, not the page's scheme.** The only value ever put here is a
    TLS-only `workers.dev` name; guessing `http` would build a URL an https page is not permitted to
    open at all, which is a silent failure rather than a working default. `ws://`/`wss://` are
    accepted and normalised, because the socket URL is the shape somebody will paste.

13. **The dev proxy is what makes "same origin" true locally.** `/rooms` (with `ws: true`, or the
    lobby connects forever) goes to a local `wrangler dev`. That is deliberate: a dev setup that also
    had to configure an origin would be a second way to get the same thing wrong, and the local path
    would stop resembling the deployed one in the way that matters.

14. **The smoke check answers the one question no unit test can: is this a Worker at all.** A missing
    binding, a Durable Object without its migration, an import the bare runtime cannot resolve — all
    of them pass `npm test` and fail a deploy. So it is deliberately shallow and deliberately real:
    boot workerd, mint a room, read it back from its DO, confirm the removed start route is still
    gone. Out of `npm test` because it boots a runtime.

15. **It kills wrangler's process group, not the process.** `wrangler dev` is a supervisor over
    `workerd`, so the first run passed every check and left a Worker holding the port. Recorded
    because the failure was invisible from inside the script — everything it asserted was true.

16. **The Pages workflow takes the origin as a repository VARIABLE, not a secret.** It is a public
    hostname that ships in the bundle, and a variable can be changed without a commit. Empty until the
    owner sets it, and empty is same-origin, so the Pages build keeps working meanwhile.

17. **M3-DEPLOY-LIVE took path A: the owner confirmed the API token is already a repository secret.**
    So the workflow landed this session rather than waiting. Two choices inside it worth arguing with.
    **The smoke check gates the publish** — it is the one check that can only fail at deploy time
    (binding, migration, an import the bare runtime cannot resolve), so running it *before* the push
    rather than discovering it after is the whole reason it exists. And **`cancel-in-progress: false`**,
    unlike the Pages deploy: a half-applied Durable Object migration is a worse outcome than a queued
    job. The client's `WORKER_ORIGIN` is still a human step — the workflow prints the host to copy
    rather than writing a repository variable, because a deploy that edits the repo's own settings is
    a surprise nobody asked for.

## Open Questions for the Analyzer — 2026-09-16

1. **I made a call inside M3-RECONNECT's territory: a restored room detaches every seat.** (Decision
   4 above; `room.ts` `detachAll`, `durable-object.ts`.) Without it, reconnect-after-eviction is
   broken — the record claims everyone is present and refuses each returning player's own ticket as
   `seatTaken`. I believe this is the existing `connected` rule made true again rather than a new
   ruling, but it interacts with HANDOFF (a room that wakes and sits empty for a turn accrues
   `missedTurns` for everybody, harmlessly, since a disconnected seat controls nothing and a reclaim
   clears it). **Please confirm or re-spec** — and if it stands, it wants a line in edge-cases beside
   the started-room reserve.

2. **Submissions still do not survive an eviction.** (`hub.ts` `#submissions`.) TIMER-PERSIST's AC
   named the deadline and the charges, and both are done; the third in-memory thing is this turn's
   locked-in orders. A DO evicted mid-turn resumes the right window but everybody reads as unlocked
   and has to lock in again. Cheap to persist (a plain object on the record, same shape as `bank`) and
   deliberately **not** done here because it was not in scope. **Worth a backlog line** — it is the
   remaining gap between "the clock survives" and "the turn survives".

3. **M3-DEPLOY-LIVE is built but UNVERIFIED, and two things need a human.** The owner picked path A
   and confirmed the `CLOUDFLARE_API_TOKEN` secret is already in the repo, so
   `.github/workflows/deploy-worker.yml` shipped this session. **I cannot check either half from
   here:** secrets are unreadable to a workflow author, so if the secret is named anything other than
   `CLOUDFLARE_API_TOKEN` the deploy fails on the first run and one line changes. And the deploy
   itself has never run — **merging this makes a push to `main` publish to the internet**, which is
   the first time that has been true of this repository. Worth saying out loud in the review.

4. **The `workers.dev` host is a guess until the deploy happens, and the client is not pointed at it
   yet.** `wrangler.toml`'s `name` is `cards-rooms` and the subdomain is `lockstepcards`, so the origin
   should be `cards-rooms.lockstepcards.workers.dev` — derived, not observed. The workflow prints the
   real host in its job summary; somebody has to paste it into the `WORKER_ORIGIN` repository variable
   before the Pages client talks to anything. **Until that happens the deployed client is same-origin
   and the networked path does not reach a server** — it will look broken, and it is one setting.

5. **The presence marks are not in the Playwright suite.** The e2e harness drives the hot-seat, which
   has no sockets and therefore no absence; exercising a marked seat in a browser needs two clients
   against a running Worker, which is a shape the render suite does not have. Unit- and
   integration-covered (15 tests, including an end-to-end drop against a real hub). Flagging the
   coverage boundary rather than proposing a harness.

6. **`connected` is on `RoomView` and the *enemy* side of the lobby still shows only a count.**
   BLIND-PICK keeps enemy picks hidden, and I did not extend the enemy block to say "1 of 2 present" —
   it is arguably useful and arguably an information change, so I left it. **A one-line ruling** would
   settle it either way.

## 2026-09-17 — Builder: the turn survives an eviction, the enemy has a count, and Kestrel gets her toggle

1. **SUBMISSIONS-PERSIST finishes the pattern TIMER-PERSIST started, and finishes it the same way.**
   The record is the single copy and the in-memory `Map` is **gone** rather than mirrored — a cache
   beside the authority is two copies of one fact, which is the lesson the last item recorded.
   `submissionsOf` builds a `Map` on demand for the two callers that want lookup semantics; a room has
   at most eight seats, so this is not a cost worth a bug.

2. **An absent key, not an empty object.** `clearSubmissions` removes `submissions` entirely, matching
   `withDeadline`'s closed window: `{}` and absent round-trip through JSON identically, and only one of
   them is the shape a fresh room has. Stated as a test rather than left to a convention, because the
   difference is invisible in storage and loud under `exactOptionalPropertyTypes`.

3. **Stored orders are copied on the way in.** `withSubmission` shallow-copies each order, so a caller
   that keeps its array cannot edit a plan that is already locked. Cheap, and it closes the one way a
   "committed" turn could still change.

4. **The enemy present count only appears when somebody is missing.** "2 of 2 present" on a healthy
   lobby is reassurance nobody asked for, and a line that is always on is a line the eye learns to
   skip — which would cost exactly the moment it exists for. Same instinct as NET-PRESENCE-UI's marks,
   which also appear only on an absence.

5. **The count is over THEIR seats, and it lies toward silence.** Filtering the whole room for
   disconnects would report the other side short because *you* blinked; and before this client has a
   seat to compare against it reports everybody present, because claiming an absence you cannot see is
   worse than not mentioning presence at all.

6. **BASIC-MODES is one function at one place, on both sides.** `abilityProfile` overlays the chosen
   profile; `planAbility` calls it once and `draftAbility` calls **the same function** once. Every
   consumer downstream sees an ordinary `AbilityDef`. A knob threaded through the geometry would be a
   knob every future shape has to remember, and a client with its own overlay could draw a cone the
   server resolves as a line.

7. **`AbilityProfile` is spelled out rather than `Partial<AbilityDef>`.** A mode may change where an
   ability reaches and what footprint it leaves; it may not change what it costs, what it does or how
   often. `Partial<AbilityDef>` would permit `modes: [{ cooldown: 0 }, …]`, which is not a mode but two
   abilities sharing a slot. The type carries the rule so no future kit has to be trusted with it.

8. **A malformed mode is checked by re-validating the MERGED ability.** A mode that turns a line into a
   circle has to satisfy the circle's rules, and the range cap has to hold for both profiles. Writing
   those rules out a second time inside the `modes` branch is how two copies drift, so the branch calls
   `validateAbility` on the merge instead — every knob's own rule, for free. Two identical profiles are
   also refused: a toggle that does nothing is a data mistake that looks like a feature.

9. **The index is the identity, and an impossible index is not a refusal.** `modes[0]` is mode 0 in
   `data/`, in the order, in the log and in a replay — so reordering the array reinterprets every order
   in flight, which is why the doc comment says so. Absent, negative, fractional and out-of-range all
   resolve to the ability's own profile: the ability still exists and still has a default, and an order
   that lost its mode should lose the *mode*, not the turn.

10. **Flipping the toggle clears the aim.** The two profiles have different shapes and ranges, so a
    square that was a legal aim for one is very often not one for the other. Keeping it would leave a
    preview drawn for an order the server refuses — the worst of the three outcomes, because it looks
    like it worked. The **move** is kept: a mode is a targeting choice, and the walk beside it is a
    decision the player already made (MS1).

11. **Kestrel's base profile IS mode 1, deliberately.** An order from a client that has never heard of
    modes resolves exactly as it did before this existed, and the toggle's initial highlight (mode 0)
    is only honest because of it. That is a rule about *content* rather than about the engine, recorded
    beside `DEFAULT_MODE` where the dependency lives.

12. **Kestrel is appended LAST to both catalogues.** `dealTeams` takes the first `perTeam * 2` entries,
    so at the end she joins the pool a lobby picks from without moving anybody in the hot-seat's 2v2 or
    4v4 deal — every existing test and every render screenshot keeps its cast. The client's and the
    server's lists have to move together, or a character the lobby offers is a pick refused at the last
    moment.

## Open Questions for the Analyzer — 2026-09-17

1. **`AbilityProfile` deliberately cannot change `effects`, `cooldown` or `energyGain`** — a mode is
   aim-time geometry only (`types.ts`; validator enforces it for hand-written data). The Designer's
   spec for Twin Bolts is shape+range only, so nothing shipped needs more. **Confirm the boundary** —
   if a future two-mode ability is meant to trade damage for reach, that is a different (larger) knob
   and wants its own item, not a widened `AbilityProfile`.

2. **A content rule is load-bearing and unenforced: mode 1 must equal the ability's own profile.**
   (`targeting.ts` `DEFAULT_MODE`.) The engine treats an absent mode as the base profile and the client
   highlights mode 0, so the two agree only because Kestrel's base *is* Focus. If that is meant to be a
   rule, it belongs in `validateAbility`; if it is meant to be a coincidence, the client should send
   `DEFAULT_MODE` explicitly instead of relying on it. **I did neither — please rule.**

3. **`modes` is only reachable on a normal ability, not on a catalyst.** Catalysts are `AbilityDef`s
   and `abilityProfile` would work on one, but `order.catalyst`/`order.freeAbility` carry no `mode` and
   the client offers no toggle for them. Deliberate (the ask is one ability), and cheap to extend if
   ever wanted. Flagging so it is not discovered as a bug.

4. **The mode toggle is not in the Playwright suite.** The render harness drives the hot-seat's default
   2v2 (Vex + Wisp vs Bastion + Aegis), and Kestrel is not in it — reaching her needs `?map=…&format=…`
   plumbing the harness does not have, or the lobby. Unit-covered (19 client tests incl. the real HUD
   row). Same coverage boundary as the presence marks; NET-E2E would close both.

5. **SUBMISSIONS-PERSIST closes the eviction gap I flagged; nothing in-memory is load-bearing now**
   except `#sinks`, `#joined` and `#bound`, which are *sockets* and cannot survive by definition.
   Recording it as done rather than leaving OQ 2026-09-16 #2 open.

6. **`WORKER_ORIGIN` is still the one owner action** (backlog's own note). Nothing in this session
   depends on it, but the deployed client still reaches no server until it is set.
## 2026-08-16 — Dev Notes batch 3: 21 owner notes triaged and ruled (Designer)

Full triage in `docs/design/dev-notes-batch-3.md` — lobby/flow (client), kit changes (data
now where the schema allows, engine-gated where not), and two systems rulings. The calls
worth remembering. **(1) CASTER-SAFE was verified before ruling:** a scratch probe against
the shipped engine showed Whirling Cleave hitting Ravok himself for the full 22 and
Shockwave for 12 — FF1's "ally or enemy" was never meant to read "including yourself," so
the exclusion is global, with `selfDamagePct` as the deliberate opt-in (Seismic Rupture at
half, bypassing cover because you cannot take cover from the ground under your own feet).
**(2) PHASE-STATUS-FIRST keeps simultaneity by splitting each phase into two simultaneous
sub-steps** — all statuses land together, then all damage computes together against
post-status state. Mutual Weakens both apply and both attacks arrive blunted; nobody is
order-privileged; mutual kills still land in full. This is what makes Dazzling Ray and
Suppression same-trade tools, which was always their design intent. **(3) BRUSH-BREAK
distinguishes proof from beacon:** getting shot in brush proves where you were — it should
not install the Revealed tracking status. The unit's brush concealment is suppressed for
current + next turn instead; Reveal stays the piercing status it is, Stealth stays broken by
damage. **(4) Stoke the Flame going free is an owner-designated exception** to the
free-action criteria (it grants immediate combat power, which §1.2 excluded) — the rule now
carries an "or owner-designated" clause and the roster test asserts four free kits with the
reason in a comment, rather than silently widening the rule. Standard price paid (cd 3→4,
energy 0). **(5) The range-4 dash floor is a flat owner directive** applied to all five
sub-4 repositions including the Shift catalyst; the guard test keeps future kits honest.
**(6) RESOLVE-PARTIAL is per-character, not per-seat:** locked characters always act,
never-locked characters hold — no turn ever waits on a player, and the OPEN
disconnect/timeout question closes the same way.

## 2026-09-18 — Builder: the batch-3 backlog, and where the AC and the code disagreed

Twelve items in one session, so the record here is only the calls the code could not make for
itself.

**MENDING-RANGE's fix is one rule with no exceptions, and it costs seven abilities a freebie.**
The aim gate and the r1 area were both correct; the bug was that `applyAreaBoons` applied the
caster's beneficial effects unconditionally, so Lumen was healed by her own Mending Light from
anywhere on the board. The caster is now in the area or it is not, exactly like an ally. Every
self-buff the old exception defended still lands — a `self` shape's area *is* the caster's square,
a dash ends inside its own path, a range-0 circle is centred on the caster — and what changes is
the seven abilities aimed *away* from their caster, which stop buffing them for free. Named rather
than hidden: Mending Light, Sanctuary, Barrier Pulse, Stoke the Flame, Verdant Veil, Overgrowth,
Radiant Lash.

**RECOIL is a cost of firing, not an area effect.** `selfDamagePct` bills the caster whether or
not it is standing in its own blast. Seismic Rupture is a `range: 0` circle so the distinction
never shows on shipped content, but the alternative reading — recoil only when you are in your own
area — would make an ability aimed away from itself free, and "shattering the earth under your own
feet" is a description of the cast rather than of the footprint. Implemented as a `fixedDamage`
hit, which is what makes it bypass cover *and* Might/Weaken: it is the authored number scaled, not
an attack aimed at yourself. Shields still absorb it, and `killUnit` already credits nobody when
the killer owns the victim.

**PHASE-STATUS-FIRST puts shields in batch one and heals in batch two.** The AC splits a phase
into "all statuses" then "all damage/heal". A shield is a status, so it lands before the damage and
absorbs the volley it was thrown in front of; a heal is named with the damage, so it stays after it
and a heal arriving alongside a lethal blow is still too late. Both readings are defensible for the
shield; the status one was taken because that is what a shield *is* in this engine, and because the
alternative leaves a bodyguard ability that cannot bodyguard.

**A trap's damage is stamped at arming, from the owner's Might or Weaken.** The AC's own example is
"a Prep Might boosts that unit's Prep-phase trap as it arms", and trap damage was previously flat —
no modifier, ever, at either end. Stamping at placement makes the example true and keeps the trap
deterministic three turns later, when its owner's statuses are somebody else's business.

**TRAP-CENTRE: the backlog's "shipped per-team trap cap (4)" does not exist.** There is no count
cap anywhere in the engine; the shipped 4 is `TRAP_MAX_LIFETIME`, the lifetime ceiling from
TRAP-LIFETIME-TUNE. The tests pin that. A per-team count cap would be new scope and is flagged
below rather than invented.

**MODE-BASE-INVARIANT required a data edit the AC implied but did not spell out.** Kestrel's Twin
Bolts shipped with Spread (cone 2) at index 0 against a line-6 base, so "absent mode = base = mode
0" was false for the only two-mode ability in the game. Focus now leads. It is an index change, not
a balance one — both profiles, both numbers and the base geometry are untouched — but it moves
every test that referenced the old indices, including the client one that asserted an unarmed mode
previews *mode 1*.

**CASTER-SAFE reaches delayed detonations; traps are left alone.** A grenade you armed two turns
ago is still your own ability, so the rule applies there too. A trap you laid triggering on you is
a different question — traps are placements with owners, not effects with casters — and nothing in
the notes rules on it, so it is untouched and flagged.

**Owner Dev Note, recorded because the backlog contradicts it:** *"The Repo Variable is set
correctly, I mistyped it in the prompt with the analyzer, multiplayer should be working."* The
backlog's `🔧 OWNER ACTION` block (and my own OQ 2026-09-17 #6) say `WORKER_ORIGIN` is still
wrong and multiplayer is blocked on it. Per the owner, it is not: the variable is set and the
deployed client reaches its server. I cannot edit `BACKLOG.md`, so this is the record — the owner
action is closed and the block is stale.

## Open Questions for the Analyzer — 2026-09-18

1. **TRAP-CENTRE's AC names a per-team trap cap of 4 that the engine has never had.** I read it as
   `TRAP_MAX_LIFETIME` and tested that. If a **count** cap was actually intended — "four live traps
   per team, oldest evicted" or "the fifth placement is refused" — it is unimplemented and needs its
   own item, because eviction policy is a design decision and I will not guess it. Thorn can now arm
   two per turn (auto-mine + free Snare Bloom), so the question has teeth it did not have last week.

2. **A trap triggering on the unit that laid it is unruled.** CASTER-SAFE now covers abilities,
   including delayed ones; traps still fire on anyone who is not on the owner's *team* — which
   already excludes the owner, so there is no live bug. Flagging because the two rules now look like
   one rule with a hole in it, and the next trap item will trip over it.

3. **The Dash phase applies no debuffs to its victims at all.** Bramble Stride's Root and Tempest
   Run's Slow are in the data and reach nobody: `runDash` applies damage and displacement and
   nothing else. Untouched here — it is neither in the batch nor a simultaneity question — but it is
   two shipped kits doing less than they say. Worth an item.

4. **Warding Halo's `weaken` now applies to nobody.** Prep has no enemy-facing branch, so before
   CASTER-SAFE its only recipient was ever Aegis himself; after it, none. The ability is a shield
   with a dead rider. Either the Weaken wants an enemy-facing Prep path (a real engine ask) or it
   should come out of the data — Designer's call, not mine.

5. **PHASE-STATUS-FIRST does not re-check Untargetable.** The gather loop reads `isUntargetable` at
   gather time, i.e. before batch one lands, so an Untargetable applied in the same phase does not
   protect against that phase's damage. Left as-is because the AC does not name it and moving it
   would also move the energy gate that rides on it. Consistent with "damage computes against
   post-status state"? Probably not. Ruling wanted.

6. **LOBBY-READY excludes disconnected seats from the handshake.** A held seat cannot ready, and
   waiting on one would let a dropped player freeze a lobby indefinitely — so `everyoneReady`
   skips them. That means a room can start while a seat is away, and its characters are then run by
   the reconnect rules. I think that is right (it matches "no turn ever waits on a player") but it
   is a lobby decision I made rather than one that was ruled.

7. **The lobby has no browser coverage.** LOBBY-BOUNDS is tested by matching the shipped stylesheet
   against a real rendered lobby in happy-dom, which proves the rules *reach the elements* but
   computes no layout; LOBBY-INSPECT and LOBBY-READY are unit-tested against a real hub. Actual
   pixel overflow at 8 seats is still unverified by anything. NET-E2E would close it, as it would
   the mode toggle and the presence marks (OQ 2026-09-17 #4).

## 2026-09-19 — Builder: the cone that was already fixed, and the seam that proves it

**KESTREL-CONE was a lie in the HUD, not a broken cone — and it was already
closed.** The data was right and every pure function was right: `abilityProfile`
merges the Spread profile, `modeOptions` offers both, `draftAbility` picks the armed one,
`toUnitOrders` sends the index. What was wrong is that `modeOptions` marks `chosen ??
DEFAULT_MODE` — index 0 — as live, and an order carrying no `mode` resolves the ability's
**own** profile. Kestrel shipped with Spread (cone 2) at index 0 against a line-6 base, so the
HUD lit up "Spread" while an untouched toggle previewed and resolved a **line 6**. A player who
never pressed anything saw a cone named and a line drawn, which is exactly why it read as "not
working as a cone at all" rather than as a toggle nobody had found. MODE-BASE-INVARIANT (shipped
2026-09-18, one item after this note was written) fixed it by making `modes[0]` equal the base
profile and teaching `validateAbility` to refuse anything else. This session's contribution is the
tests that connect the guard to the symptom — including a reproduction against the pre-swap data,
which now fails validation.

**`startHotSeat` had no test at all, and that is the shape of this whole class of bug.**
`createRenderer` builds a `WebGLRenderer` eagerly, which throws in any headless DOM, so the one
file where the HUD button, the draft reducer, the preview and the order builder are wired together
could not be driven — while every piece it wires had several tests each. `HotSeatUI` now takes an
optional renderer factory (absent in production) and `test/app-harness.ts` supplies a stub that
satisfies `Renderer` in full and records what it was told to draw. The `aim` highlight layer **is**
the preview a player sees, so the tests assert on that rather than on a function that feeds it.

**PREVIEW-AUDIT: the footprint needed nothing; the numbers needed four things.** Preview and
resolution both go through `expandShape`, so a sweep over all 45 roster abilities at a fixed aim
found **zero** footprint mismatches — that sweep is now the audit's spine. The gaps were all in
`damageTell`, which knew the core/ring split and the axis bonus and nothing else: Aegis's Shield
Bash read "20 dmg" with no mention of its constant-width lane (the named Dev Note #3 gap — the lane
already *resolved* correctly under BASIC-BEAM), Solar Flare read "30" when it is 30 and then 8
twice, and Snare Bloom and Overwatch Trap read **nothing at all** while burying a 12- and a
20-damage mine. Burns and mines are numbers a damage preview owes the player, so they are in;
statuses are not, because the glyph row and the description already carry those and a tell that
listed everything would be a second description.

**DASH-STATUS: the victim list is now built for a rider-only dash.** Gating it on a damage effect
is precisely what made Bramble Stride's Root and Tempest Run's Slow invisible, so a dash whose only
effect is a status now finds its victims and pays enemy-only use energy for reaching one. No
shipped content is rider-only; the alternative was leaving a field the engine reads and then does
nothing with, which is the bug this item is.

**LOBBY-DETAIL-PANEL is fixed to the left margin and hides below 1320px.** `.lobby` is a centred
860px column, so the left third is empty on a wide screen — the space the owner pointed at. Fixed
rather than in the flow because the lobby scrolls on its own and a panel that scrolled with the
character grid would leave the screen while being read. Below the width where that margin stops
existing it hides entirely: overlapping the pick screen with a description of it would be worse
than the hover tooltip alone, which still works at every size.

## Open Questions for the Analyzer — 2026-09-19

1. **KESTREL-CONE shipped as tests, not as a behaviour change.** The symptom was cured by
   MODE-BASE-INVARIANT the session before the item was written. Nothing in the client changed
   except the renderer seam. If the owner is still seeing a line, it is a **different** bug and I
   need the build they saw it on — please confirm the report post-dates PR #82.

2. **Kestrel is unreachable in the hot-seat.** The default roster is Vex + Wisp vs Bastion + Aegis
   and there is no character-selection query parameter, so the mode toggle can only be reached
   through the **lobby**, which needs a working Worker origin. Worth an item either way (a dev
   `?chars=` route, or the roster in MAPTOGGLE) — otherwise the one two-mode ability in the game
   is untestable by hand.

3. **`WORKER_ORIGIN`: the backlog and the owner disagree, still.** The owner's Dev Note last
   session said *"The Repo Variable is set correctly, I mistyped it in the prompt with the
   analyzer, multiplayer should be working"* (recorded 2026-09-18). This session's backlog repeats
   the OWNER ACTION block claiming it is wrong. One of the two is stale and I cannot edit
   `BACKLOG.md` to say which. **Please reconcile** — several items' reachability depends on it.

4. **PREVIEW-AUDIT went past the AC's literal list.** It named centre/axis/beam, DoT and
   heal-vs-damage; I also added **traps**, because Snare Bloom and Overwatch Trap previewed *no
   number at all* while dealing 12 and 20. That reads to me as squarely inside "audit all skills to
   ensure damage preview is correct", but it is scope I added — confirm or trim.

5. **A beam has no sub-band, only a narrower footprint.** `previewBands` marks the axis and the
   core because those tiles pay a *different number*; every tile of a beam pays the same. So Aegis
   reads apart from Bastion by shape and by the tell, and by nothing else on the board. If the
   owner wants the lane visually distinct from a wedge beyond its outline, that is a Designer/render
   ask, not a preview bug.

6. **The app controller has one test file now, where it had none.** `app-harness.ts` can drive
   anything `startHotSeat` does — aiming, catalysts, free actions, the chase, playback. Everything
   in it is currently exercised only through KESTREL-CONE. An item to broaden that would be the
   cheapest insurance available against the exact pattern that produced three of this batch's five
   items ("pure function passes, wiring is broken").

7. **The lobby detail panel's breakpoint is a guess.** It hides under 1320px, which is where the
   860px column plus a 300px panel stops fitting. If the owner plays windowed at 1280 they will
   never see it, and the answer is probably a collapsed/toggled panel rather than a lower
   breakpoint — Designer's call on which.

---

## 2026-09-20 — Builder, session 4 (LOBBY-READY-FIX → LOBBY-PANEL-RESPONSIVE)

**A reconnect ticket is a match-only thing; presented to a lobby it is ignored, not refused.**
The hub tried a `join` carrying a `seatId` as a reclaim *instead of* an ordinary join —
deliberately, because a reclaim is about *which* seat it is and a failed one must not put a
returning player in somebody else's chair. But a **lobby holds no seat for anybody**: `leave`
deletes a lobby seat outright, so there is never a held one to come back to, and the reasoning
does not apply because there is no chair to be put in by mistake. The refusal it produced
(`noMatch`, socket closed) is how a second tab of the same browser — one `localStorage`, one
ticket — ended up with no seat, no `lobby` frame and no ready button. Now `room.state === undefined`
means the ticket is skipped and the client is seated normally. The match rules are untouched: a
live seat still refuses a ticket as `seatTaken`, a held one still comes back to its owner.
**This reverses** the encoded behaviour in `reconnect.test.ts` ("a ticket before the match has
started has nothing to reclaim"), which now asserts the seating; the test says so and why.

**The reconnect ticket moved to `sessionStorage`.** Per browsing context is the lifetime the
ticket actually wants: a reload of this tab keeps it (the case it exists for), a second tab does
not get it (a second player, not a returning one). Same-browser two-seat testing is the normal way
this game gets played locally, so a store two tabs share was the wrong store.

**The reported symptom was not reproduced as stated, but the cause was.** The Analyzer's PROPOSED
RECLAIM-SCOPE reasoned from *"Both Seat 0 and seat 1 have a 'start game'"* to "both tabs believe
they are the creator". Driving two real clients through a real hub shows something different and
worse: the second tab is **refused outright** and never gets a seat at all — a client with no seat
renders the unjoined screen, which carries a Ready button, not a Start. The likeliest path to two
disabled Start buttons is two tabs each on `?create`, i.e. **two different one-seat rooms**, which
is what a person does after the second tab fails to join the first room. Either way the defect is
the same one and the fix is the one the ruling proposed; the hypothesis about *how it looked*
should be corrected in edge-cases (Analyzer's file) when RECLAIM-SCOPE is promoted from PROPOSED.

**`?chars=` falls back with a notice, where every other setup parameter errors out.**
`match-setup.ts` treats a bad `map`, `format`, `players` or `scenario` as an error that refuses to
load, on the stated principle that silently loading `duel-arena` because you mistyped is the one
outcome a dev toggle must not have. DEV-CHARSELECT's AC asks for a fallback instead. Taken as
written, and made safe by the half that is not optional: the notice is rendered in the page as a
persistent `.setup-note`, not into the status line the controller rewrites on the next render. The
substitution is **all-or-nothing** — one bad id does not seat the three good ones, which would be
precisely the silent mis-seat DECISIONS 2026-09-18 rules out, with most of the roster right to
make it look deliberate. If the Analyzer would rather have consistency with the file, the change
is one line (push the note into `errors`), and I would mildly prefer that.

**The lobby's responsive breakpoint stays in CSS and only in CSS.** LOBBY-PANEL-RESPONSIVE needs
"is the panel collapsed" to agree with "does the panel fit", and the second is a question about the
viewport that the stylesheet already answers at 1320px. A JS copy of that number would be a second
one to keep in step, and the two would part the day somebody edited the stylesheet alone. So the
toggle button is in the DOM at every width and *shown* by a media query, and `renderDetail` clears
the panel's inline `display` rather than setting `block` — an inline `block` would beat the media
query and leave the toggle with nothing to do.

**The collapsed panel opens only when pressed.** Choosing or hovering a character fills it at every
width, but below the breakpoint filling it must not also open it: opening covers the character grid,
and a panel that appeared over what you were pointing at because you pointed at it is the hover
tooltip's job done badly. The toggle is `disabled` rather than hidden when nothing is chosen —
a control that came and went as the pointer moved would be a moving target.

**One tooltip placement rule, not two.** CATALYST-TIP-FAST needed a floating element beside the
pointer, which `inspect-panel.ts` already had inline. `placeBeside` was lifted into `tooltip.ts`
and both callers now share it: "stay inside the viewport, flip left at the right edge" is a rule,
and two copies of a rule is one copy that is wrong.

## Open Questions for the Analyzer — 2026-09-20

1. **RECLAIM-SCOPE's symptom explanation needs correcting when it is promoted.** As above: the
   two-client reproduction shows the second tab **refused and seatless**, not two clients both
   believing they are the creator — an unjoined client renders Ready, not Start. The cause and the
   remedies in the ruling are right; the "both tabs are the creator" sentence is not. Please
   reword it as you promote PROPOSED → RULED, since `docs/design/` is yours.

2. **A lobby that survives a Durable Object restart looks unjoinable, and it is not in any item.**
   `durable-object.ts` mints socket ids from a **module-level counter** (`seat-${nextSocketId++}`)
   which resets when the DO is evicted. A room restored from storage still holds seats named
   `seat-0`, `seat-1`; the next socket to connect is *also* `seat-0`, so its ordinary join is
   refused as `duplicateSeat` and its socket closed. I did not touch it — it is outside
   LOBBY-READY-FIX's AC and I could not reproduce it against a real DO from here — but it is the
   same family as the bug I did fix, and it would look identical to a player. Worth an item.

3. **`?chars=` falls back where its neighbours error.** See the DECISIONS entry above. I
   implemented the AC as written and flagged the inconsistency rather than quietly making it an
   error; your call which way it should settle.

4. **The board's remaining `title` attributes were left alone.** CATALYST-TIP-FAST's AC names the
   lobby's catalyst buttons, and its Spec Note adds "the character/ability tooltips **if they use
   `title`**" — in the lobby they do not (they already use the instant hover panel). But
   `hud.ts:410` (status chips), `hud.ts:346` (the Time Bank button), `app.ts:1255–1268` (topbar
   portraits) and `inspect-panel.ts:90` (catalyst chips inside the inspect panel) still do, and all
   four have the same delay. `tooltip.ts` now exists to make converting them small. Out of scope
   here; an item would close the family.

5. **The Skip-during-playback control shares the `hud-lock` class with Lock In.** The harness has
   to address them by their rows (`.hud-lockrow .hud-lock` vs `.hud-playback .hud-lock`) because
   "the first `.hud-lock`" would silently start pressing the wrong one if the two rows ever swap.
   Not a bug, but a rename to `hud-skip` would make the DOM say what it means. Trivial if wanted.

6. **`app-harness.ts` now covers aiming/commit, catalysts, free actions, the chase and playback,
   but not the second seat.** Everything is driven through a *networked* seat (`recordingNet`), so
   the hot-seat's own `deriveSeats` handover — pass-the-device between players between turns — is
   still untested at the controller level. It is the one flow in `startHotSeat` a harness can reach
   and does not. Cheap follow-on if you want the coverage completed.

## 2026-08-19 — QUOTA-RUNAWAY: the production outage, and what a decision window is for (Builder + owner)

Room creation died in production with `Exceeded allowed rows written in Durable Objects free
tier` — surfaced in the browser as `could not reach the server (TypeError: Failed to fetch)`,
because the runtime's 1101 error page carries no CORS header and a cross-origin browser may not
read it. Root cause: `#sendDecision` reopened a decision window after **every** resolve of an
active match, sinks or no sinks, and hold-position turns never score the kill sudden death needs
to end — so every abandoned mid-match room became an alarm loop, each tick a persist plus a
`setAlarm`, each of those a metered row write, until the account's daily allowance was gone and
every room in it broke. Three rulings, one per layer. **(1) A decision window exists for people:
no attached sockets, no window, no alarm.** The match freezes; `#reclaim` and `start` both run
`#sendDecision`, so the first returning player resumes the clock at a full window. The window
open at the moment of the last drop deliberately survives it — one trailing alarm fire resolves
it for nobody and then the room is silent, which also self-heals every already-stuck production
room the first time its alarm fires after this deploys. **(2) A write that changes nothing is
not written.** The DO keeps the serialized form of the last record persisted and the alarm time
last armed, and skips the storage call when either is unchanged — pings and spurious wakes now
cost nothing; rows written are the budget the free tier meters. **(3) The Worker may not throw.**
`fetch` is wrapped so any exception returns CORS'd JSON naming the cause — an outage must arrive
in the client's error path as a sentence, not as "Failed to fetch"; the room-record lookup gets
the CORS header stamped on its way through for the same reason. Regression suite:
`test/quota-runaway.test.ts`. Operational note: the daily allowance resets at midnight UTC —
until then production creates fail even with this fix deployed, since the fix stops the burn
but cannot un-spend the day's budget.
---

## 2026-09-21 — Builder, session 5 (HUD-LAYOUT → HARNESS-HOTSEAT)

**The HUD's re-layout is a move, and the board's growth is a consequence rather than a setting.**
`sizeToViewport` already measures the HUD and the top chrome and hands the camera what is left, so
AC 5 ("the board expands") needed no board code at all: the centre column went from five stacked
rows to three (the catalysts left, the movement right), and the top band went from two rows to one
(the score beside the title rather than under it). Both are height the board takes back
automatically. Nothing about the board's sizing was touched, which is the property worth keeping —
a re-layout that also tuned the camera would have two places to disagree.

**The score band is a row, not a stack, and the top inset is measured off the band.**
`#topchrome` holds the dev chrome on the left and the match readout filling the rest. The inset used
to be read off the scoreboard alone; side by side, whichever of the two is taller sets the bottom
edge, so it is read off the band. Reading the score alone would frame the board under the status
line whenever the status line ran longer than the readout.

**The small-screen rule now hides the character panel's children, not the left column.**
`.hud-left { display: none }` below 820px was correct when the column held only the portrait and the
bars, whose HP and energy are also on the unit's own billboarded bars. With the catalyst strip moved
in, the same rule would have deleted three once-per-match controls from every narrow screen as a
side effect of moving them — a control with no second home cannot be dropped the way a duplicated
readout can.

**Skip is `hud-skip` (OQ 2026-09-20 #5, folded in).** It styles identically to Lock In because it
plays the same role — the one button that ends what you are watching — but it is a different control
and a selector must be able to name one without catching the other. The old `.hud-lockrow .hud-lock`
qualifier stays in the harness anyway: it says *which* control this is rather than relying on there
happening to be only one.

**The next socket id is derived from the room's seats, not persisted separately.** A socket id
becomes a seat id on join, so the seats are already the authoritative record of which ids are spoken
for, and they are written after every frame. A stored counter beside them would be a second field to
keep in step and the one that goes stale. It takes the **highest** id rather than the count, because
`leave` deletes a lobby seat outright and the list is not a dense range.

**The tooltip sweep is delegated, and that is load-bearing rather than tidy.** The HUD's nodes are
keyed and re-filled every update (UI3) and the topbar strip is rebuilt wholesale every render, so a
listener attached at build time reads stale text and one attached per update stacks. `data-tip` is
written by the update that already writes the text, and one listener per region reads it.

**`?chars=` now errors instead of falling back, reversing DEV-CHARSELECT.** Shipped as
fallback-with-a-notice (the original AC), flagged by me the same session, and the Analyzer settled
it the other way. Every neighbouring parameter refuses to load on a typo, and a notice beside a
board that is already running is a notice you play past. The `.setup-note` mechanism and
`MatchSetup.notes` were deleted with it rather than left as dead code that looks like a feature.

**The inspect panel's catalyst chips cannot show a tooltip, and never could.** `.inspect` is
`pointer-events: none` — it follows the pointer, so a panel you could hover would chase itself off
the unit it describes — so no pointer event has ever reached those chips and the `title` there was
already dead. TOOLTIP-SWEEP carries the text as `data-tip` so the panel's record is complete and one
`delegateTooltips` call is the whole of the work if the panel ever gains a pinned mode. I did not
make the panel interactive to reach it: that is a behaviour change nothing asked for.

## Open Questions for the Analyzer — 2026-09-21

1. **HUD-LAYOUT's AC 4 was read as "beside the title", not "instead of it".** The owner's line is
   *"SCore and teams move to the top of the window"* and I could not see the annotated screenshot.
   I put the score in a top band **sharing a row with** the existing title/status chrome, which puts
   it at the top and costs a title's height less than the old stack. The alternative reading is that
   the dev chrome should move or go entirely and the score should own the top strip. If the
   screenshot says the latter, it is a small follow-up — confirm against the image.

2. **The e2e's "the board got the space" thresholds are mine, not the owner's.** `render.spec.ts`
   now asserts the HUD is under 25% of a 900px window and the clear band between the top band and
   the HUD is over 66%. Both pass comfortably today. They are the only numeric statement of "the
   board dominates the screen" anywhere, so if the owner wants a specific proportion, that is where
   to put it.

3. **`.inspect` is `pointer-events: none`, so TOOLTIP-SWEEP's fourth site is unreachable** (see
   above). The AC is satisfied in the sense that no `title` remains and the text is carried, but
   nothing new became visible there. If the intent was that those chips *become* hoverable, that is
   a separate item and it needs a ruling on how a pointer-following panel stops chasing itself —
   probably a pinned mode, which is a design question.

4. **A DO whose room record predates SOCKET-ID-STABLE is still fine, but only by luck of naming.**
   `nextSocketIndex` skips seat ids that are not `seat-<n>`, so a record from an older build seats
   new sockets from 0 again if none of its ids match the pattern. Every shipped build has used
   `seat-<n>`, so this is theoretical — but it is the one input that would put the collision back,
   and it is worth knowing before the next production playtest rather than after.

5. **Nothing else in the client uses `title` now, and there is a test that keeps it that way.**
   `tooltip-sweep.test.ts` reads the sources and fails if `hud.ts`, `app.ts`, `inspect-panel.ts` or
   `lobby-screen.ts` grows a new `.title =`. `main.ts` still sets one on the `<h1>` — that is the
   page heading naming the loaded setup, not a control tooltip, and I left it. Say if you would
   rather that were in the sweep too.

6. **The harness is now complete against `startHotSeat` as far as I can see.** Networked seats,
   hot-seat handover, aiming, catalysts, free actions, the chase and playback all have specs driving
   the real controller. The remaining untested-by-harness surface is the **lobby → match transition**
   in `main.ts` (`joinRoom`'s subscribe handler tearing down the lobby screen and calling
   `startNetworkedMatch`), which is real wiring with no test. Not blocking anything; worth an item
   if you want the class of bug closed rather than reduced.

## 2026-08-17 — AIM-PREVIEW-TRUE: the preview shape becomes the predicate (Designer)

The owner reported that the aim preview "feels like the highlight preview plus the squares
that get affected" — two different things. The diagnosis: they ARE two different things.
The smooth AIM2 graphic draws the ability's input region; the tiles draw the answer; and
under HITBOX1 (hit = the region touches the tile's central ½-circle) those disagree at
every edge by up to half a tile, at every rotation. My first suggestion was to delete the
smooth graphic and let the tile set be the preview; the owner pushed back wanting the
smooth shape kept and the tiles true to it — and the push-back found the better design.
The key identity: "region touches a ½-circle at p" ⟺ "p is inside the region inflated by
½" — so there EXISTS a continuous shape against which "tile lights iff its centre is
inside" holds exactly: the Minkowski sum of the region with the half-tile disc. Drawing
that instead of the raw region makes the graphic the rule rather than a picture of the
input. Per shape it is even cleaner than the general statement: circles draw at exactly
their authored radius (CIRCLE-FIX already folded the hitbox into the number — graphic,
data value and tile set all agree), while cones, beams and lines draw their region
inflated by ½ with rounded corners, matching the shipped `wedgeCovers` "inside the wedge,
or within half a tile of it" predicate verbatim. The keystone acceptance criterion is a
congruence sweep — lit tiles equal tiles-with-centres-inside-the-boundary for every shape
at every quantized rotation — which is simultaneously the feature's proof and a standing
regression guard on the whole aiming geometry stack. Client-only; the engine's integer
tile selection is untouched, and the float outline is presentation, per the AIM2
precedent. This closes the last surface where the client draws something the engine never
promised — the same trust rule as PREVIEW-NUMBERS and PREVIEW-FOG, applied to the most
used UI surface in the game.

---

## 2026-09-22 — Builder, session 6 (AIM-PREVIEW-TRUE, HARNESS-LOBBY-MATCH)

**The drawn boundary is tested as the drawn boundary, not as an analytic stand-in.**
`aimBoundaries` returns the polygon the renderer is handed, and the congruence sweep runs
point-in-polygon over *that*. The alternative — describe the locus analytically, test the
description, tessellate separately for drawing — would leave the one gap the ruling exists to close:
the tessellation could cut inside the curve and no test would notice. Arcs are therefore
**circumscribed** (each chord tangent to the true arc rather than secant), so erring is always
outward by a sliver far thinner than the gap between two tiles the engine tells apart.

**Every inclusive edge is pushed out by a hair (`EPS = 1e-4`); the one exclusive edge is pulled in
by it.** The engine's comparisons are `≤`, so a tile centre sitting exactly on the boundary is lit —
and a polygon test cannot answer "exactly on my edge" reliably in floating point. The near edge of a
directional shape is the exception (`a > 0` is strict) and is inset instead. The size is chosen
against the smallest gap the engine can produce: coordinates are integers over `|V| ≤ AIM_STEPS/4`,
so two tiles it separates differ by at least `4/512 ≈ 0.0078`, two orders of magnitude more.
**This is load-bearing** — set it to zero and most of the roster fails the sweep immediately, which
was checked rather than assumed. (Circumscription, checked the same way, is *not* load-bearing
today; the comment in the source says so rather than claiming credit for it.)

**Two rows of the Designer's boundary table are wrong about the shipped engine, and the engine
wins.** The spec calls `line` "a capsule of half-width ½" and `cone`+`beamWidth` "a rounded-corner
rectangle" — both being the shape ⊕ disc(½). But `lineSquares` and `beamCovers` fold the half tile
into the **width** only and cap the depth with a bare `a ≤ range`, so their true loci have **square**
ends and corners: a tile just past the far end is out even when it is within ½ of the endpoint. Only
`wedgeCovers` is a genuine Minkowski inflation, and it is drawn as one. Drawing the rounded version
would put an unlit sliver inside the outline at every cap — the same lie in a new place — and AC #1
is the binding form of the ruling, while the table is its shorthand. The spec's own §2 says the
boundary was "verified against the shipped engine", so I read this as the table over-generalising
from the wedge rather than as a ruling I am overriding. Flagged below.

**Congruence is claimed on an open board only, and occlusion gets a weaker, true claim.** A wall
removes tiles for reasons that are not geometric — the wall tile itself is dropped, and LOS-OCCLUSION
shadows what is behind one — so no drawn boundary could be congruent on a board with a wall in it;
the spec says as much for `circle` ("draws whole… the missing tiles beneath it are the point"). The
occlusion block asserts what is actually true: the boundary shortens to the deepest tile the shape
reached, and nothing still lit is left outside it. Tiles going dark *inside* the outline is the
design.

**A `radius: 0` circle is drawn as its tile.** Cinder's Ember Bolt authors `innerRadius: 0` — a core
of exactly the aimed tile — and the locus of `d² ≤ 0` is a single point, which cannot be drawn. The
tile outline is the smallest figure containing that one centre and no other, so the congruence claim
survives intact and something is visible.

**Locked orders are drawn own-team only, and that filter is load-bearing.** AC #5 asks that a locked
plan re-render from the same derivation. In a hot-seat `drafts` outlives the seat handover, so an
unfiltered read would show the previous seat's committed shot to the player it is aimed at. The rule
is `intentBadges`'s: hidden information is team vs team. There is a test that hands the device across
the table and asserts the incoming seat sees nothing.

**`net-boot.ts` exists so the lobby→match handoff can be reached at all.** `main.ts` runs its whole
boot on import — it reads `window.location`, mounts into `#app`, and starts a hot-seat if no query
says otherwise — so nothing in it was ever reachable from a test. The handoff moved out with the
renderer seam threaded one level further; `main.ts` keeps the page (the query string, the socket, the
element ids), which is the part a test has no business driving.

## Open Questions for the Analyzer — 2026-09-22

1. **The Designer's boundary table is wrong for `line` and `cone`+`beamWidth`** (see above). I drew
   the shipped predicate — square ends — because AC #1 is the binding form and the rounded version
   would enclose tiles that never light. Please reconcile `docs/design/aim-preview-true.md` §2's
   table with the engine, or rule that the *engine* should gain the rounded caps (which would be a
   real balance change to reach, not a drawing change, and an ENGINE ASK).

2. **`aegis.shield_bash` now reads as a lane — re-ask the Designer about beam distinctness.** The
   backlog flags this as cross-item ("may resolve the Designer's Aegis beam distinctness flag —
   re-ask after"). It is now a rounded-free rectangle three tiles wide, visibly not a wedge. My read
   is that the flag is resolved, but it is a look-at-it judgement and not mine to close.

3. **The congruence sweep's rotation density is a judgement call.** Every one of the 512 quantized
   steps for shapes at range ≤ 3 (which is both cones, the beam and Kestrel's Spread), every 8th for
   longer lines — a range-99 line at 512 steps is minutes of CPU for a shape whose geometry is a
   rectangle that rotates. If you want all 512 everywhere, say so and I will move the long lines to
   their own slower suite rather than quietly making the fast one slow.

4. **The old `shapeOutline` and its tests are deleted, not deprecated.** A second, hand-drawn answer
   living beside the derived one is exactly how these two came apart in the first place. The claims
   its tests made are all re-made (more strongly) in `aim-boundary.test.ts`; if you want the old
   assertions kept verbatim somewhere for audit, that is a five-minute job, but I would argue against.

5. **AC #4's "tiles pop as their centre crosses the line" is now literally true and may read oddly
   at first.** The outline passes through the *centres* of the boundary tiles, so a lit tile's outer
   half sits outside the drawn shape. That is the ruling working as specified rather than a defect,
   but it is a visible change from the old over-drawn silhouette and the owner should see it before
   anyone "fixes" it. Worth a playtest note.

6. **One e2e flake, not reproduced in the rerun.** `UI-VIEWPORT … duel-arena at 1920x1080` failed
   once with "no `#board canvas`" — a WebGL context that never came up, in the `beforeEach`, while
   vitest was running concurrently on the same box. Every other size and map passed in the same run.
   Recorded here so a future intermittent failure is not diagnosed from scratch.

## 2026-09-22 — ART-PIPELINE: characters are generated, not modelled (owner + Claude, brainstorm session)

The owner has no Blender, animation or art skills and wants character art produced ~99% by AI and
tooling. `docs/ART_PIPELINE.md` is the full plan; the judgment calls behind it are here.

1. **Procedural generation beats AI mesh generators, specifically because of Mixamo.** The
   auto-rigger has four hard requirements — clean T-pose, left/right symmetry, limbs not fused to
   the torso, single mesh under 150k tris. Text-to-3D and image-to-3D tools (Meshy, Tripo, TRELLIS)
   fail all four routinely and need Blender cleanup to recover, which is exactly the skill the owner
   does not have. A parametric Blender script satisfies all four by construction. The constraint
   that we can only make blocky characters happens to align with what the rigger wants and with what
   reads at isometric distance.

2. **Blender is a build dependency, not a tool anyone opens.** `blender --background --python`.
   It is required because Mixamo exports FBX and the client needs glTF; something has to convert,
   merge clips onto one skeleton and optimize. Rejecting the install would mean depending on web
   converters for a step that runs on every asset rebuild. Require 4.2 LTS or newer; verified on
   5.2.0 LTS / macOS. **Blender builds geometry only — it never generates textures.** Painting the
   face atlas is plain 2D image drawing, so it is a separate script that runs without Blender:
   testable on its own, mirrors how `textures.ts` already works, and sidesteps any dependence on
   what Blender's bundled Python happens to ship.

3. **Faces are painted into a texture, never modelled.** Because the generator builds the head it
   also assigns the UVs, so the atlas layout is a decision rather than a discovery — no unwrapping,
   no seams, no Blender UI. Most of the body points at a single solid-coloured pixel; only the face
   earns real detail. This is the same trick Quaternius and KayKit use and it is why their models
   ship with one tiny texture.

4. **Art parameters get a new `data/art/<id>.json`, not a block inside `data/characters/<id>.json`.**
   The role table says Builder never touches balance numbers. Separate files mean changing a coat
   never requires opening a file full of damage values, and Designer can own art wholesale.

5. **No engine change is required by any phase of this, and that is load-bearing.** Projectile
   flight time falls out of the gap between the `ability` cue at `t` and its `impact` cue at
   `impactT` (`choreograph.ts:163`, `:169`); source and destination units are both already in the
   payloads. Much of the VFX dispatch is derivable from `shape`, `range`, `melee` and
   `effects[].kind`, which abilities already declare. If a future session believes it needs an
   engine change for art, that is an `ENGINE ASK`, not a commit.

6. **Clip selection and VFX dispatch live in the renderer, never in `sampleFrame()`.** That module
   is pure, Three-free and unit-tested, and its contract is that dropping every frame changes
   nothing about where the board lands. Renderer randomness is legal — golden rule #1 binds the
   engine, not the view — but it must be seeded from `cue.t + unitId` so a replayed turn looks the
   same twice. Unseeded jitter would make `skip == watch` true in state and false to the eye.

7. **The free-orbit camera, not the isometric preset, is what constrains the art.** `renderer3d.ts:782`
   runs yaw modulo 360 unclamped and pitch reaches ~8°. That kills billboarded faces, untextured
   backs of heads and flat cards for hair and cloth, and it makes front/back asymmetry a facing cue
   rather than a flourish. An earlier draft of this plan proposed pre-rendering animations to 2D
   sprite sheets; a rotating camera makes that impossible, and it is recorded here so nobody
   re-proposes it.

8. **"In Place" on Mixamo locomotion downloads is a correctness requirement, not a preference.**
   The engine owns unit positions. A clip carrying root motion fights it and units drift off their
   squares. The clip looks fine in isolation, which is what makes this worth writing down.

9. **`CLAUDE.md` said "SVG rendering" long after the Three.js swap, and it cost real work.** The
   stale line sent this very session down a wrong path — recommending sprite sheets and warning
   about the cost of adding a 3D renderer that had already been added. Fixed in the same commit.
   `ARCHITECTURE.md` was already correct; the constitution was not, and the constitution is what
   every session reads first.

10. **Not decided: whether the generated characters will look good enough.** The honest expectation
    is "competent low-poly indie", not stylized AAA. The mitigation is structural rather than
    optimistic — every phase after generation is mesh-agnostic, so if the output disappoints, CC0
    packs (Quaternius, KayKit, Kenney) drop in and nothing downstream changes. Spike one character
    before generating a roster.
---

## 2026-08-20 — Builder, session 7 (DEATH-HANG, the two data tweaks, the preview-number audit, burn pips, line-preview memo)

**DEATH-HANG's discrimination is `net !== undefined && seatIdx === 0`, not "the roster is empty".**
An empty roster reaches the bottom of `openSeat` meaning two different things and the shipped code
could only see one. Walking *off the end* of the seat list means the turn is answered, and networked
that is the **only** way a submission is ever made — which is why the first attempt at this fix
(hold whenever the roster is empty and `net` is set) broke the ordinary lock-in and was caught by the
reproduction's "the turn after the respawn is fully playable" case. Arriving at `seatIdx === 0` in a
networked match is the other meaning: the walk has not started and this player is simply down.

**A downed networked seat holds rather than auto-submitting.** The AC's parenthetical is explicit —
"not an auto-submit that reads as frozen" — and the ruled treatment of a seat that submits nothing is
*hold position*, which produces the identical game result. The cost is that the room now waits the
full decision window on a turn the downed player cannot act in, where the old (broken) behaviour
resolved as soon as the opponent locked. Mitigated by keeping **Lock In live as "Hold Position"**, so
one click still resolves the turn early; the packet leaves only when the player sends it, which is
the whole difference from the bug. Flagged as an open question below.

**Ravok's Whirling Cleave description was rewritten to name the 11.** The backlog's AC is the one
data field, but Seismic Rupture's description already says "and Ravok takes 19 himself", and a tell
that stays silent about a cost the engine charges is the same class of defect as a wrong preview
number. Same for Slipstream's "for a turn" → "for two turns". Neither is a balance change; both are
the tell catching up with the data beside it.

**`previewNumbers` composes damage the way `runBlast` does, and takes its bands from the engine.**
The audit's whole discipline is that the client never works out for itself which tiles are the core
or the axis — `previewBandSets` hands over `axisSquares`/`innerSquares`, and `previewBands` is now
that pair flattened, so the glow a player sees and the figure written on it come from one derivation.

**The floating number is the immediate blow; a burn is the pip and the tell.** `damageOverTime` is
not a `PreviewKind`, so the audit compares against the *first* damage event on a target rather than
the sum — a DOT-HOT tick emits an ordinary `damage` event at end of turn, and folding it into the
number would make "30" mean "30 now then 8 twice". A roster-wide guard asserts no ability burns
without also hitting immediately, which is what keeps "first event" honest.

**`healOverTime` shipped alongside the burn pip.** The backlog puts it out of scope "unless cheap".
It is one row in each of four tables, and the two kinds are the same mechanic pointed in opposite
directions — shipping one would have left the asymmetry as a thing to explain later.

**`status-pips.test.ts` asserted the vocabulary was total against a hand-written list**, which is how
BURN-VISIBLE's gap survived: `damageOverTime` became a status when DOT-HOT shipped and nobody added
it to the list. It now derives from the engine's own `isStatusKind`.

**The boundary cache is several slots, not one, and bounded.** A render draws more than one boundary
(the live aim plus AC #5's locked teammate plans), so a single slot would be evicted by each in turn
and never hit — a memo that makes things slower. The key is a deliberate **superset** of what any one
shape reads: erring that way costs a miss that recomputes an identical polygon, erring the other way
hands back the wrong outline silently.

## Open Questions for the Analyzer — 2026-08-20

1. **A downed networked seat now costs the room its full decision window.** The hold is what the AC
   asks for, and "Hold Position" gives the player a one-click way out, but a player who has *nothing
   to do* is exactly the player least likely to be watching the screen. The clean fix is
   server-side — `#answering()` could exclude a seat with no living units, so the turn resolves as
   soon as everyone who *can* act has — but that is `hub.ts` scope the item's Files list does not
   name, and it changes what "all in" means. Please rule: leave it to the button, or open a server
   item.

2. **`previewNumbers` still cannot know a status that lands this turn.** Unchanged from
   PREVIEW-MODIFIERS and re-stated because the audit now claims equality with the resolution: the two
   diverge exactly when a Prep-phase Might/Weaken resolves after the plan is locked. The audit sweeps
   fixed states, so it does not exercise that gap. It is documented in `preview-numbers.ts` as an
   honest limit; if you want the preview to predict same-turn buffs, that is a new item and a
   different kind of promise.

3. **The dash impact preview is a plan-time estimate, and the audit records the hole.** A unit
   standing on a charge's route stops it short, so the aimed landing — and the disc centred on it —
   is not where the blast goes off. The audit excludes route tiles for impact-carrying dashes and
   says so; `dashRoute`'s own comment has always called this out. Worth a decision on whether the
   preview should route around bodies (it would need the engine's stop rule, an ENGINE ASK) or keep
   saying "where you aimed".

4. **Ravok's recoil is not previewed as *refused* when it would kill him.** The number is on his own
   tile and it is correct, but a whirl that would take his last 11 looks exactly like one that would
   not. AIM-RANGE-TELL established that the board should say "no" out loud; whether a self-lethal
   recoil deserves the same treatment is a design call, not mine.

5. **`overTimeBlurb` is the only blurb that carries a number.** Every other `STATUS_BLURBS` entry
   describes the effect and refuses to restate a magnitude, deliberately, so a balance pass cannot
   leave a lie behind. This one is allowed to because the figure is the engine's own instance amount
   rather than a client constant — but it is a precedent, and if you would rather the tooltip said
   "takes damage each turn" and put the number only in the chip's `amount` span, say so.

6. **The burn and regen glyphs are new artwork and have had no eyes on them.** A flame and a cross
   over a rising arc, both schematic at pip size. `PIP_COLORS` gains ember orange and mint; the mint
   sits a step cooler than Haste's leaf green, which is the closest pair on the row and the one worth
   looking at on a real plate before it is called settled.

## 2026-09-23 — Cooldown bands: the commitment gradient, and the three judgement calls (Analyzer)

The owner directed that dashes cost 4–5 turns, non-basic blasts 3–4, and Prep stay as it is. Measured
against the real Atlas Reactor numbers (31 Freelancers × 5 abilities, parsed from the `wiskerz/ar-builds`
scrape of the wiki — AR's kit structure is identical to ours: a 0-cooldown Blast auto, three cooldown
skills, an energy ult), the directive is exactly right: AR's 93 skills run mean 3.80 / median 4 with 89%
at ≥3, while our 27 run 2.70 / 3 with 56% — and the phase-level gap is almost entirely Dash (AR median
5, ours 3) and non-basic Blast (AR median 4, ours 2). Prep was already the tightest match (3.10 vs 3.47),
which is why directive #3 says leave it, and it is now recorded as frozen so a future pass does not
"fix" it. Full evidence: `docs/reviews/2026-09-23.md`; the numbers ship as CD-BAND-DASH,
CD-BAND-BLAST and CD-BAND-INVARIANT in BACKLOG.

The interesting finding was *why* AR priced dashes highest, because it is not a flat tax. AR's dash
cooldowns track direction of travel: a dash carrying an enemy-facing payload — the frontliner's engage —
sits at 4 (Asana, Garrison, Titus, Rask, Phaedra, Tol-Ren all exactly 4), while a dash that is pure
repositioning *away* climbs to 5–7 (Blitz 5, Slip Away 6, Backup Plan 7, Bombing Run 7). Planting
yourself in front of the enemy is its own price; getting out is not, so it is paid for in cooldown. I
adopted that as the rule — **enemy-facing effect ⇒ 4, no enemy-facing effect ⇒ 5** — rather than a flat
+2, and ruled explicitly that a *self*-shield does not buy the discount (it is escape insurance, not
commitment), which is what sends Lumen's Glimmer Step and Aegis's Intercept to 5 alongside the pure
teleports. Aegis surviving that is not luck: Barrier Pulse (Prep 2, shield 20, r4) is untouched and
remains the every-other-turn bodyguard button, so Intercept can become the expensive repositioning save.

Three judgement calls the directive's "use your judgement for the exceptions" licensed, and all three
stay inside the owner's bands — the exceptions are deviations from *my own sub-rules*, not from the
directive. (1) **Wisp's Blink is 4, not the 5 the rule gives a pure teleport.** She is the only character
who is both lowest-HP (85) and holds a range-2 basic, so Blink is her approach and her exit; at 5 the
archetype is deleted rather than taxed. AR kept precisely this exception for PuP, its low-HP harasser
and one of only two lancers in the game with a sub-4 dash. It sits at the band floor, not under it, and
is flagged for playtest. (2) **No blast is priced below 3.** Every non-basic blast in the roster already
carries a status rider — slow, weaken, reveal, DoT, or a pull — on top of damage, so none of them is a
plain shot deserving the cheap slot; the plain shot is the 0-cooldown basic, and restoring that hierarchy
is the whole point of the directive. (3) **Vex's Frag Grenade goes to 4**, the only upward exception: at
34 it is the roster's named skill-nuke ceiling and the one skill above the undelayed cap of 24, and AR
priced its equivalents higher still. Bastion's Chain Hook I left at 3 — it is already in band and it is
not the Analyzer's place to change a number nobody complained about — but it is the roster's only pull ≥
2 and therefore the open question if the blast band should carry a second 4.

One second-order result is worth pinning because the intuition runs the wrong way: **these cooldowns do
not slow the ultimate clock, they speed it up slightly.** GAME_SPEC §3 fixes one ability per turn, so
raising a cooldown never reduces cast *count* — it only changes which ability is cast. In this roster
dashes are the cheapest energy abilities we have (`energyGain` 4–5) and every basic pays 8, so pushing
dashes out replaces a 4–5 turn with an 8. Net positive for seven of nine characters, neutral for Bastion
and Ravok (whose dashes already pay 8), and the blast band is energy-neutral apart from Frag Grenade's
−2, covered several times over. `roster-v1.md` §4's "ultimates come online turns 8–10" therefore survives
unmodified, and the backlog says in as many words not to retune `energyGain` to compensate for a problem
that does not exist. Finally, the rule that permitted the drift — `roster-v1.md` §1's bare
*"Skills | 3 | `cooldown ≥ 2`"* — is superseded but not violated (5 ≥ 2), so it blocks nothing; the fix
is a per-phase band invariant in `content.test.ts` (Builder, CD-BAND-INVARIANT) with the prose update
routed to the Designer. The invariant deliberately carries **no allow-list**: with Blink at 4 every value
in the roster is inside its band, and an exception list is exactly the mechanism that lets the next drift
in unnoticed.

---

## 2026-08-20 — Builder, session 8 (Warding Wall, Ram Charge's line, the cooldown bands, the downed-seat skip)

**Warding Wall's orientation is derived, not aimed.** The owner's dev note settled the aim —
*"a freely placed, 4 tile line"* — which is why the new `wall` shape takes a **square** (a circle's
aim, anywhere in `range`) rather than a direction. What the note did not say is which way the segment
lies, so it is laid **across** `dominantCardinal(caster → aimed square)`: one click puts the whole
wall down, and across-your-facing is the orientation the ability wants nearly always (between them and
you, or over the lane they are coming down). An **even** length has no centre tile, so the segment runs
from `-⌊(L-1)/2⌋` to `+⌊L/2⌋` along the perpendicular — for `L = 4` the aimed square is the second of
the four. Arbitrary, deterministic, written down. **Flagged below**: if the Designer wants true free
rotation, that is a position *and* a rotation in one aim, which the client's aim model does not carry.

**The wall's trigger list is per-trap, and that is how the dev note and the RULED trap rule are both
honoured.** The note says the wall *"will hit dashes, moves, and displacements, but not blinks"*. Both
halves depart from the v1 trap rule (RULED: entry under your own power; knockback/pull never), and in
**opposite directions** — it catches a shove and misses a teleport. Rather than move the global rule,
`AbilityEffect.triggers` lets a hazard name its own arrivals, and `DEFAULT_TRAP_ENTRIES`
(`move`/`dash`/`teleport`) keeps every shipped mine exactly as ruled — Overwatch Trap still fires on a
blink landing, still ignores a shove, and there are two tests that say so. The reading behind the
split: a mine is something you **tread on**, so a shove onto one is not your doing; a wall is something
you are pushed **through**. This is the "first lever to pull" the knockback ruling anticipated, pulled
for one ability rather than for all of them.

**A blink that LANDS on a wall tile is not caught either.** The note does not spell this corner out.
Ruled the same way for the same reason: the wall hurts what passes through it, and nothing passed.

**Displacements fire wall traps square by square along the path travelled**, not only at the resting
square, so a shove that carries somebody clean across the wall pays for the crossing. The
carry-through fix-up can walk a victim back one square; that square was already crossed on the way out,
so it is in the list once and its trap is consumed once.

**`perTile` is opt-in rather than derived from the shape.** TRAP-CENTRE exists because an *area* shape
burying a mine under each of thirteen tiles is a minefield nobody authored — the count fell out of the
radius. A wall is the opposite case: four tiles because the ability says four. So the generalisation is
a field on the effect, and the count stays something a human wrote down.

**Two description rewrites rode with their data changes.** Ram Charge said "the first enemy hit", which
`chargeHits: "all"` was about to make a lie; Warding Wall's names its 25 and its blink exception. A tell
that contradicts the engine is the same class of defect as a wrong preview number.

**A charge's landing goes on the impact layer.** `impactPreview` now reports a `landing` for every
dash, and a `path` charge draws it. That layer already answers "what does the arrival *do*" against the
aim layer's "where does the dash *go*", which is exactly the split the item asks for. A teleport gets
nothing extra — its aimed square is the landing and is already the only tile lit.

**The cooldown edits are nine and six single-line changes.** The first pass reserialised the JSON and
produced a 73-line diff of reformatting around nine real changes; re-done as targeted edits. No test
needed its turn count raised.

**`#canAct` asks `controlledUnits`, not the seat's own `unitIds`.** Those are two different lists once
M3-RECONNECT has handed an absent player's characters to a stand-in, and the question the lock count
needs is what the seat may order *now* — the same question `#receiveSubmit` already asks.

## Open Questions for the Analyzer — 2026-08-20

1. **WARDING-WALL orientation: derived, not aimed** (backlog WARDING-WALL; `packages/engine/src/shapes.ts`
   `wallSquares`). The owner ruled the *position* ("freely placed"); I derived the *facing* as
   perpendicular to the caster's line. Please confirm, or route to the Designer: true free rotation
   needs an aim carrying a square **and** a step, which `aimFor`/`OrderDraft` do not currently
   express — that is a client aim-model change, not a shape change.

2. **The even-length centring is a coin-flip I called.** A 4-tile wall puts the aimed square second of
   four (offsets −1,0,+1,+2). If the Designer wants it third, it is a one-character change; if they
   want odd lengths only, that is a data call.

3. **WARDING-WALL is now the only ability whose trap can be set off by a shove** (edge-cases: RULED —
   knockback/pull do NOT trigger traps in v1). I implemented it as a per-trap opt-in so the ruling
   stands for every mine, but the ruling's text now needs a sentence saying the *hazard* may say
   otherwise. Please amend it rather than leaving the two to be read as contradicting.

4. **A turn on which EVERY seat is downed resolves on the timer, not at once** (backlog DOWN-SEAT-SKIP;
   `hub.ts` `#answering`/`#allIn`). The answering set is empty, and `#allIn` deliberately refuses to
   resolve on an empty set. Not a regression — it waited the full window before too — and resolving
   eagerly from `#sendDecision` risks a resolve → send-decision → resolve loop, which is
   QUOTA-RUNAWAY territory. If you want it closed, it wants its own item with the loop guard specified.

5. **Aegis has lost his only non-basic Blast.** After WARDING-WALL his kit is one Blast (the free
   basic), two Preps and a dash. That is the kit reshape the owner asked for, but it means Aegis is the
   only character with no cooldown'd Blast at all, and `CD-BAND-BLAST`'s band now has one fewer
   population. Worth a Designer look before playtest concludes anything from it.

6. **Ram Charge at `chargeHits: "all"` plus cooldown 4 is two buffs and a nerf landing together.** The
   Analyzer sequenced them deliberately and I implemented both as specified; flagging only that the
   playtest note should read them as one change rather than two.

---

## 2026-08-20 — Builder, session 9 (traps catch a shove; the wall is placed and turned)

**TRAP-SHOVE-DEFAULT was one production line, and the interesting part is what it did *not* change.**
The v1 trap rule was about **whose idea the movement was** — your own power yes, a shove no. TRAP-TRIGGER
replaces it with a rule about **crossing**: a shove drags you over every square between here and there,
so it crosses; a blink occupies only its landing square and crosses nothing. That is why blinking *past*
a mine still leaves it armed while blinking *onto* it sets it off, and it needed no code — the teleport
path only ever offers the landing square to `triggerTrapsOnEntry`. Pads already worked this way; the two
rules now agree, and `edge-cases` records that the historical pad-vs-trap difference is gone.

**The wall had to be re-anchored to honour "rotated in 4 directions", and that is a shape change, not a
control change.** The owner's note is *"placed on a tile and then rotated in 4 directions for
placement"*. Keeping the shipped geometry — a segment **centred** on the aimed tile, lying **across** a
facing — and merely letting the player pick the facing would satisfy the words and fail the intent: a
symmetric segment laid across a facing is identical north and south, so the four buttons would produce
two walls and a one-tile nudge. Anchoring at the clicked tile and running **along** the chosen cardinal
makes the tile a pivot and the four rotations four genuinely different arms. Flagged below, because it
is the one place I changed geometry the owner did not explicitly ask me to change.

**It dissolves session-8 OQ #2.** There is no centre left, so the even-length centring coin-flip (was the
aimed square 2nd or 3rd of 4?) has no question to answer: the aimed square is always the first tile.

**`wall` is the only shape whose aim needs both halves.** A `line` accepts either a step or a target,
because for a line each implies the other. A wall's position and orientation are independent, so an aim
carrying one of them is not an under-specified wall — it is not a wall, and `aimIsLegal` refuses it. The
old refusal of the caster's own square is gone with the reason for it (there was no direction to derive
from that square; there is now one authored).

**An off-cardinal aim step snaps rather than being refused.** `AIM_STEPS` is 512 and a wall wants four.
The client only ever sends one of `WALL_ROTATIONS`; snapping is what makes a hand-rolled or replayed
order deterministic instead of an error case — the same treatment a cone already gives
`dominantCardinal`.

**`selectRotation` does not clear the aim, and `selectMode` still does.** A mode change makes the old
target meaningless (a line's target is often illegal for a cone); a rotation is a change *to* an aim
about a square the player has already picked. Clearing it would make "turn the wall" mean "put the wall
away and start again".

**The rotate row is a sibling of the mode row, not an extension of it.** Both qualify the armed ability
and both are hidden unless one is armed that wants them, so neither costs the board any height in the
common case — but they answer different questions (*what the ability is* vs *which way this placement
points*), and an ability could one day want both. `hud-layout`'s exact-list assertion now names four
rows, so the next one has to be argued for too.

## Open Questions for the Analyzer — 2026-08-20

1. **The wall's geometry changed from centred-across to anchored-along** (Dev Note 2026-09-26 #1;
   `packages/engine/src/shapes.ts` `wallSquares`, `WALL_ROTATIONS`, `wallDirection`). The owner asked for
   four rotations; four rotations of a *centred* symmetric segment are two walls, so the anchor moved.
   The clicked tile is now the **first** tile of the wall rather than the second of four. Please confirm
   this reading, and close session-8 OQ #2 as moot if you agree.

2. **`aegis.warding_wall`'s range now means something slightly different.** `range: 4` still bounds where
   the *anchor* may go, but the wall then extends 4 tiles further in the chosen direction, so its far end
   can sit up to 7 squares from Aegis (it could reach ~5 before). No number changed and I did not
   rebalance — flagging because the effective reach did move, and it is a Designer call whether `range`
   should come down.

3. **WALL-BLINK-ONTO is still open and is now the *only* divergence** (backlog flag). After
   TRAP-SHOVE-DEFAULT every mine bites a blink that lands on it; the wall still does not, per the owner's
   session-8 *"but not blinks"*. One array entry (`teleport` on the wall's `triggers`) plus flipping the
   *"nor is a blink that lands ON a wall tile"* test if the owner wants them aligned.

4. **No rotate control exists for a *committed* wall aimed by a different seat's replay.** The rotation
   rides on `AbilityOrder.aimStep`, which the server already relays, so networked play needs nothing —
   flagging only that I verified this by reading the protocol rather than by a two-client test.

5. **Dev Note "Aegis skill set is good"** — taken as confirmation of the WARDING-WALL kit reshape, so
   session-8 OQ #5 (Aegis has no cooldown'd Blast) is closed as intended. No action taken; recording the
   reading in case the Analyzer wants it recorded differently.

## 2026-09-27 — TTK: the HP lever, and why a 1.25× skill ceiling is safe (Analyzer)

The owner asked how our damage, healing, shielding and TTK compare to Atlas Reactor, with the stated goal
that *"time to kill is similar so that one error doesn't cause an instant death"*, and then directed a
four-part package. Measured against the AR wiki scrape (31 lancers; HP from `Actual Health`, damage and
heal and shield values read off ability descriptions; Isadora excluded as incomparable), sustained TTK was
never really the problem: a basic takes 22.0% of one of our health bars against AR's 17.3%, so we kill in
4.5 connected hits against their 5.8 — fast, but a tuning nicety. **The fault was burst, and it was
specific to the 2v2 default.** Our ultimates take 38% of a bar against AR's 23%, and two ults in one turn
deal exactly 85 damage to Wisp's 85 HP. That is a kill from full with no error required beyond standing in
line of sight, and it is precisely the failure the owner named. Our 4v4 is fine and matches AR — four
basics come to 122% of the squishiest bar against AR's 115%, and one-turn focus kills were AR's design
too. Full working: `docs/reviews/2026-09-27.md`; the numbers ship as TTK-HP-BAND, TTK-SKILL-DAMAGE,
TTK-LUMEN-HEAL, TTK-TURN-LIMIT and TTK-INVARIANT.

The earlier analysis proposed capping ultimate damage at 35. **The owner chose the HP lever instead and it
is the better one**, because the problem is a ratio and HP is its denominator: raising the bars fixes it at
the source rather than shaving five numbers, and it simultaneously restores the archetype ladder AR had and
we had lost (AR put supports 33% above firepower; we had them 11% above, so Lumen and Thorn were
firepower-durable while doing a healer's job). At the new bars the double-ult lands at 85% of the squishiest
against AR's 83%, the basic bite is 16.9% against 17.3%, and TTK is 5.9 hits against 5.8. **No ultimate is
being nerfed, and the backlog says so explicitly** so a Builder does not apply both fixes.

The interesting result was directive #2. A flat 1.25× skill ceiling would have raised sustained output
about 10% and clawed back part of the HP gain — the two levers would have fought. **The owner's own two
ordering rules are what make 1.25× safe:** pulling area skills below single-target ones and ridered skills
below clean ones drags most of the roster back under the ceiling, and a greedy damage-max simulation over a
20-turn match puts median sustained output at 22.0/turn — *exactly* today's figure. I added one rule the
owner did not name, that **displacement is its own rider class below status (0.76 against 0.88)**, on
`roster-v1.md` §4's own authority that displacement is "the strongest soft-CC in the game" because it
cancels the victim's Move; it is the reason Ram Charge and Chain Hook land on 23 rather than 26, and
dropping it is a one-line change. I also **excluded traps from the multiplier entirely** — a trap only pays
out if an enemy walks into it, which the formula has no term for, and pricing conditional damage as if it
were guaranteed would have been the wrong kind of tidy. The batch therefore does not touch Aegis at all:
since PR #97 replaced Grounding Strike with Warding Wall he has no direct-damage skill, and session-8 OQ #5
already closed that as intended.

Two parts of the package are load-bearing rather than cosmetic, and the backlog marks both as
must-ship-together. **The turn limit** is arithmetic: at two attackers and §4's 60% hit rate, 2v2 already
paces to 15.2 turns for four kills against a 16-turn limit, and after a 30% HP raise it is 19.7 — every
match would end on the clock. AR had slack only because 4v4 supplies four attackers per kill target where
our default supplies two. **Lumen's heal** is the counterintuitive one: heals are absolute numbers and do
not scale with a bigger bar, so raising HP alone makes a healer comp *worse* — two attackers net 7.9
damage per turn through her, which at the new bars is 16.5 turns for a single kill, longer than the match.
At 20 it is 12.5, and her sustained throughput becomes 11.4% of a bar per turn, inside AR's support band
(median 9.7%, max 12.5%) for the first time. Only the amount moves; Mending Light stays on `cooldown: 2`,
so the 2026-09-23 ruling that Prep cooldowns are correct survives intact. Everything else — shields,
catalysts, `energyGain`, `ULT_COST` — needed no compensating change, because once the bars grow those
values land in AR's band on their own; the backlog lists them as out of scope for exactly that reason.
---

## 2026-08-20 — Builder, session 10 (the two client bugs, and the grenade that bites back)

**WALL-CAST-FIX: the gate stays a shape gate.** The AC allowed either
`isRotatable || isPlacedRotatable` or a bare `isAimStep(draft.aimStep)`. I took the first, because
`targeting.test.ts` asserts a circle sends no step and it is right to — a stale step on the wire is noise
a reader has to rule out. The bug was not that the gate was a shape gate; it was that the gate knew about
one kind of rotation and the game had grown two.

**The wall test asserts HP lost, not traps on the board.** `warding_wall` has `lifetime: 1`, so the hazard
is swept by the same turn's end-of-turn tick — a test reading `traps` after the turn sees zero whether or
not the cast worked, and would have certified the bug as fixed. The enemy walks into it instead, and
crosses it **perpendicular**: walking along its length runs over three separate traps for 75, which is
correct and would make the number a statement about the route rather than about the cast. Verified by
reverting the gate — four of the six go red.

**`app-harness.ts` now records `show()`.** Every layer it recorded before was a *plan*; the board itself
was invisible to tests, which is how a correct preview hid a broken cast for a release.

**RAM-LINE-PREVIEW-FIX: the backlog's diagnosis was wrong, and I did not implement it.** The item says
nothing marks the crossed enemies and no damage number shows. Driving the real controller shows the route
lit and a `15` on each crossed enemy, and has since BASTION-RAM-LINE. What I found instead, both real:
(1) **a charge drew no outline at all** — `path` was the only attack shape returning `[]` from
`tessellate`, so it had tiles and a route line and nothing on the shape layer, which is exactly the
difference between "an attack covering this lane" and "a way to walk over there"; and (2) **the numbers
ignored `chargeHits`** — Kestrel's Skim is first-only and the preview was stamping 12 on every enemy on
the route. The second is a preview that lies, and PREVIEW-NUMBERS-AUDIT could not see it because it
sweeps one enemy at a fixed aim and one enemy cannot tell "first" from "all".

**The charge outline is one lane per straight run**, not one rectangle: a route may bend (MV4 diagonals,
waypoints), and a chain of lanes still contains exactly the path's tiles. The boundary memo key gains the
route for `path` shapes only — it is the one shape whose outline depends on the whole aim rather than on
`aim[0]`.

**`chargedUnits` / `chargeVictims` are exported from the engine and `runDash` now calls them.** The
Spec Notes said read the engine's derivation rather than recompute one; there was no exported derivation
to read, so the inline code in `runDash` became the shared function both sides call.

**FRAG-SELF is a second exit from CASTER-SAFE, not a widening of the first.** `selfHarm` means the caster
is **just another unit standing in the area**; `selfDamagePct` (RECOIL) is a **cost of firing**. Presence
versus price — so `selfHarm` costs nothing if you are not in the blast, and RECOIL is charged even on a
whiff. Validation refuses the pair. Applied at both sites CASTER-SAFE excludes a caster from an *area*
(`runBlast`, `detonateDelayedBlasts`) so a delayed grenade and an undelayed one agree; the Prep/Dash
`applySelfEffects` path is untouched, because that is about self-*targeted* effects and the note does not
ask about them.

## Open Questions for the Analyzer — 2026-08-20

1. **RAM-LINE-PREVIEW-FIX's stated root cause was not the defect** (backlog RAM-LINE-PREVIEW-FIX). The
   crossed-enemy damage numbers already worked. I fixed the two things that were actually wrong (no
   outline on the shape layer; `chargeHits` ignored by the numbers). Please confirm this satisfies the
   dev note *"still not a linear dash/attack preview"* — if the owner meant something else again, the
   next report wants a screenshot, because the third guess is expensive.

2. **`chargeHits` was previewed wrong for every first-only charge, not just Skim** — Ravok's Bullrush,
   Thorn's Bramble Stride, any `path` dash without `chargeHits: "all"`. Fixed generally, flagged because
   it is a behaviour change nobody asked for and playtesters may notice fewer numbers on a charge.

3. **FRAG-SELF reverses a RULED edge case** (`docs/design/edge-cases.md` CASTER-SAFE; dev note 2026-09-27
   #1). Implemented as a per-ability opt-out so the ruling stands for everything else, and the flipped
   test ships in the same commit — but the ruling's text needs a sentence saying an ability may opt out,
   the way TRAP-TRIGGER got one.

4. **Frag Grenade is now materially harder to use and no number moved.** 34 damage in a radius-2 disc
   that no longer spares its thrower is a real nerf to Vex's zoning, delivered by a rules change rather
   than a balance pass. I did not rebalance. **Designer/playtest call.**

5. **`selfHarm` applies its riders too.** Frag Grenade is damage-only so nothing turns on it today, but
   the next ability to take the flag will weaken/slow/root its own caster. Flagging the general rule
   before content depends on it.

6. **The `.hud-rotate` row and WALL-CAST-FIX close session-9 OQ #4 only half way.** A rotated wall's
   order is now proven to survive lock-in and resolve in a **hot-seat**; the networked relay is still
   verified by reading the protocol. NET-E2E remains the real answer.

## 2026-08-21 — Builder session 11 (RAM-PREVIEW-REVERT, WALL-HIT-ONCE, the TTK package)

**RAM-PREVIEW-REVERT: no app.ts change was needed, and the Spec Notes expected one.** The notes name
`app.ts` as a site to "remove the path-outline draw" from. There is no path-outline draw there —
`app.ts`'s shape-layer call is generic over `aimBoundaries`, so the outline appeared and disappears
entirely with `tessellate`'s `path` case. The only files touched are `aim-boundary.ts` (the case + the
memo key) and the test file. Recorded because "the third file in the Spec Notes was already correct" is
the kind of thing that looks like an omission in review.

**The reverted outline left a comment saying why a charge is unlike every other shape.** A charge's aim
is a *route*, not a direction and a reach, so its locus depends on the whole aim rather than on `aim[0]`
— which is why re-adding an outline would also need the route back in `boundaryKey`. That is the one
piece of the reverted work worth keeping, and it is now four lines of prose instead of thirty of code.

**WALL-HIT-ONCE's dedup set is threaded, not stored.** The ruling allows either. It is threaded from
`resolveTurn` through the trap-trigger callers, beside `displaced` and `pending`, because it is scratch
belonging to one resolution: storing it on `GameState` would ship per-turn bookkeeping to every client
and every saved room, and would need remembering to clear — a future `perTile` hazard with `lifetime: 2`
would silently become "once per cast, ever" the day somebody removed the clear. Cost: one parameter on
thirteen functions. The parameter is named `trapHits` rather than `hits` because `runBlast` already has a
local `hits` (its blast-hit list), and two different `hits` in one file is a bug waiting to happen.

**A `groupId` is "I am one tile of a bigger hazard", not an id every trap carries.** A single-tile trap
is consumed by the first unit to set it off, so "once per unit" is already true of it; giving it a group
would be an id that never changes an answer, and would invite a future reader to think the dedup is what
makes a mine one-shot. The id is the trap id with the square left off — the part that is the *cast*
rather than the tile — so two walls from two casters in one turn stay distinct and the same ability
re-cast next turn is a new hazard.

**The cross-phase WALL-HIT-ONCE test needed a bent charge, and the AC's own example would have been
vacuous.** The AC suggests "dashes through in Dash and is shoved through in Blast". Built literally with
a straight charge, that hits the *same* tile twice — consumed the first time — so it passes identically
with and without the dedup. Only a victim who changed lane mid-turn can reach a second live tile of the
same wall, so the test charges through, bends off the lane, and is hooked back across a different tile.

**The TTK package shipped as one commit, against the "commit per item" habit.** The backlog says the five
items "are one change and must land together — do not ship a partial package". Split into five commits,
the middle three are red: the HP change alone breaks twelve tests that name old numbers. One green commit
beats five where four cannot be bisected through.

**Ten ability descriptions were updated to quote their new damage.** Not in any AC, and adjacent to
"never rebalance" — but a description is what the inspect panel shows the player, and Skim reading "takes
12 damage" beside a 30 is a tooltip that lies. Only the moved figure changed in each sentence; no other
number, and no balance value.

**Twelve tests asserted the old numbers; most now read them off the character def.** "Fix the tests, not
the data" was the instruction. Where the literal was incidental — what a shield soaks, who a charge
carries past whom — the assertion now derives from the data, so the next balance pass does not break it
again. Where the number *is* the claim (the format table; the two turn-limit boundary assertions) it
stays a literal.

## Open Questions for the Analyzer — 2026-08-21

1. **The first-only charge preview is the one bit of "before" not restored** (backlog RAM-PREVIEW-REVERT,
   flagged in its own Spec Notes). Skim/Bullrush/Bramble Stride still preview one number, not one per
   enemy on the route. Confirm with the owner that "go back to how it was before" did not include the
   lying preview — I read the Spec Notes as saying it did not.

2. **`groupId` is a new field on `TrapState` and therefore on the wire.** Traps reach the client in state.
   Nothing renders it and nothing needs to, but it is a protocol-visible addition made without a protocol
   item — flagging in case `docs/ARCHITECTURE.md`'s state contract should name it.

3. **WALL-HIT-ONCE makes the wall meaningfully weaker and no number moved.** Walking its length cost 75
   and now costs 25; the ~7-tile reach flagged as WALL-REACH (session-9 OQ #2) was partly justified by
   that. Both are playtest calls, but they should be judged *together* rather than as two separate
   nerfs/keeps. **Designer/playtest.**

4. **The AC's cross-phase example cannot be built as written** (backlog WALL-HIT-ONCE AC, last bullet).
   A straight dash-then-shove re-enters the tile the dash consumed, so the test would pass with the dedup
   removed. My version bends the charge; worth re-spec'ing the bullet so the next reader does not write
   the vacuous one.

5. **TTK-INVARIANT enforces the tier rule, so the rule is now load-bearing for new content.** Any future
   damaging skill must sit at `round_half_up(basic × shape × rider × delay)` exactly, or the build fails.
   That is what the item asked for and I think it is right — but it means the Designer cannot author a
   deliberate outlier without either a named exception in the test or a change to the rule. Confirm that
   is intended before a tenth character is designed.

6. **`roster-v1.md` §4's ceilings are now stale in four places** (already routed to the Designer in the
   backlog). Restating only because the numbers landed this session: undelayed skill cap is 30, nuke
   ceiling 33, sustain ceiling 20, and "4–5 connected hits on a 100 HP target" is now ~5.9 on bars of
   100–175.

7. **`GAME_SPEC.md:119` still says `maxHp` (baseline ~100)** — the median is 130 now and the band runs
   100–175. I changed only §1's format-table cell, which is what TTK-TURN-LIMIT's AC named; widening a
   docs edit in a file I do not own felt like the wrong call for one adjective. One-word fix, whoever's
   it is.

8. **PLAYTEST is unblocked as of this branch.** RAM-PREVIEW-REVERT, WALL-HIT-ONCE and all five TTK items
   are in; WALL-CAST-FIX shipped in PR #103. Nothing in the Builder backlog blocks it.

## 2026-08-21 — Builder session 12 (NET-E2E, the two doc items, and a botted playtest)

**NET-E2E's transport is a loopback, not a socket, and that is the whole call.** The AC left the seam to
the Builder: two `app-harness.ts` controllers over a fake transport, or the real Durable Object in a test
worker. A `Loopback` that hands a frame straight to the other side's `receive` keeps the **real** server
(`RoomHub` + `createRoom`), the **real** client reducer (`RoomClient`), and the **real** controller
(`watchForMatch` → `startNetworkedMatch` → `startHotSeat`) — everything except latency and a scheduler,
neither of which any bug in this class depends on. A DO in a test worker would add a second runtime and a
second failure mode to catch the same bugs more slowly.

**"Both clients reach the same resolved state" had to be redefined before it could be asserted.** M3-HIDDEN
filters every payload to the receiving team, so the two clients are *supposed* to hold different objects —
a client that saw the whole board would be the bug the filter exists to prevent. `agreement()` therefore
compares the two views **where they overlap**: any unit both can see must have the same HP and square on
both. Every test that uses it also asserts the overlap is non-empty, because a client that drew nothing
would otherwise agree with everybody.

**The wall-relay tests are paired on purpose.** "Turned south, the x=13 column is bare" passes whether or
not `aimStep` survives the wire — no wall and a wall pointing elsewhere both deal zero. It only means
something beside "…and the southward wall bites where it actually runs". Verified by reverting
WALL-CAST-FIX's gate: exactly the two "the wall bit" tests go red.

**The downed seat's Lock In stays enabled, and that is what "not frozen" means.** Reaching for `canAct()`
as a revive detector did not work: a seat with no units can still lock in an empty turn, which is precisely
what stops the match waiting on a player who cannot move. Recorded because it looks like a bug from the
outside and is the opposite.

**BOTPLAY is a floor, not an estimate, and the file says so in three places.** The bot walks at the nearest
enemy and fires the biggest thing that reaches. Two bad players finish a fight faster than two good ones,
so every pacing number below is a lower bound on a human match. Its own failure rate (proposals the engine
refused) is reported alongside, so the numbers can be discounted rather than trusted blindly — and it is
high for the charge-heavy comp (~3 refusals per match for Bastion/Ravok vs ~0.4 for the healer comp), which
is a bot limitation and not an engine one.

**Two engine behaviours the bot harness had to learn rather than assert against.** (1) *Sudden death has no
cap*: a tie at the turn limit sets the flag and play continues until somebody scores, so a match running
past its limit is the ruleset. My first backstop called that a broken outcome check. (2) *Deaths ≠ kills*:
FF1 scores a friendly kill for nobody, so the two reconcile only with the unscored ones added back — a
sharper assertion than the equality I first wrote, and it now pins FF1 over whole matches.

### What 400 bot matches measured (2v2, duel-arena, seeds 1–200 per comp)

Read every line with the floor caveat above. Reproduce with `npm run botplay`; any seed replays exactly.

| | brawl (Vex+Bastion v Kestrel+Ravok) | healer (Lumen+Aegis v Vex+Bastion) |
|---|---|---|
| ended on **kills** | 37 (19%) | 27 (14%) |
| ended on **clock** | 151 (76%) | 173 (87%) |
| reached sudden death | 43 | 20 |
| still open at 3× the limit | 12 (6%) | 0 |
| turns | median 20, mean 22.8, range 13–61 | median 20, mean 20.1, range 15–32 |
| deaths per match | 4.3 | 4.5 |
| worst single-turn burst | 112 HP (Ravok, 175 bar — 64%) | 117 HP (Aegis, 155 bar — 75%) |

- **The TTK burst goal looks met.** The worst turn anywhere in 400 matches took 75% of a bar. Nothing
  approached a kill from full, which is what TTK-HP-BAND was for.
- **Matches end on the clock, not on kills** — the opposite of what TTK-TURN-LIMIT was raised to achieve.
  Heavily caveated: the bot spreads damage instead of focusing, and 4.3 deaths per match split across two
  teams is exactly how you get 20 turns with neither side reaching 4. A human playtest is the test.
- **Sudden death can run forever** (6% of brawls unresolved at 60 turns). The rules have no tiebreak beyond
  "play until somebody scores".

## Open Questions for the Analyzer — 2026-08-21

1. **Sudden death is unbounded** (`resolveOutcome`, `formats.ts`; found by BOTPLAY). Tied at the turn limit,
   play continues with no cap — 6% of bot brawls were still going at 3× the limit. Needs a ruling: a
   hard cap with a tiebreak (total damage? first blood?), or "accept it, humans will break a tie". Not
   changed — inventing a tiebreak is a rules decision, not a Builder call.

2. **76–87% of bot matches end on the clock, not on kills** — the thing TTK-TURN-LIMIT (16→20) was meant to
   fix. Caveated hard (the bot does not focus fire), but it is the one measurement that disagrees with the
   review's model, and the human playtest should be asked the same question directly.

3. **NET-E2E covers three scenarios, not the networked surface.** Per the Spec Notes, breadth was left to
   grow later. Not covered: the per-player timer expiring over the wire, two seats on one team
   (asymmetric 3-player 2v2 — the least-exercised path and the one PLAYTEST prioritises), a mid-match
   disconnect during *playback* rather than during Decision, and the lobby→match handoff for a
   **reconnecting** seat.

4. **The two-client harness is client-side** (`packages/client/test/net-harness.ts`). The Durable Object
   wrapper around `RoomHub` is still only covered by the miniflare smoke test. If the DO is where a
   networked bug is most likely to live, that is the next item, and it is a different one.

5. **`ROSTER-CEILINGS-UPDATE` touched a Designer-owned doc** (`docs/design/roster-v1.md`). Kept strictly to
   numbers read off the data plus writing down two rules that already ship and are already enforced by
   `TTK-INVARIANT`. Flagging so the Designer knows it moved.

6. **BOTPLAY costs ~1s in CI and could be a lot more useful.** It is currently 48 matches on one map with
   two fixed comps. Worth an item if the Analyzer wants it: sweep every character pairing for outliers,
   run 4v4 and 1v1, or run it on both maps. Not built — the dev note asked whether it could be done, and
   scope beyond that is the Analyzer's to set.

## 2026-08-17 — INTERCEPT-GUARD: Aegis's thesis ability (Designer, owner directive)

The owner rebuilt Intercept from a generic teleport-plus-self-shield into the Bodyguard's
thesis: teleport adjacent to an ally within 5, and for the rest of that turn damage that
ally would take is dealt to Aegis instead, with an 18 self-shield sized to cover most but
not all of one regular attack (the shipped non-support basic band is 20–26; 18 covers 90%
of a 20 and 69% of a 26). Full spec in `docs/design/intercept-guard.md`. The owner's
one-line argument is recorded because it IS the design: **Dash resolves before Blast — he
arrives, and then the damage lands on him.** The phase order makes bodyguarding mechanically
real: the enemy aimed at the ally during Decision, and their locked Blast finds Aegis
standing there. It turns the game's core read (aim where they will be) into a kit.

Calls worth remembering. **(1) `guard` is the first new EFFECT_KIND since DOT-HOT**, and it
clears the same bar: no composition of existing kinds expresses "your damage goes to him."
**(2) The redirect is bounded on three sides** — damage only (a bodyguard takes the bullet,
not the leash: statuses and displacement still land on the ally), enemy-dealt only (the
ally's own recoil is their recklessness, and redirecting Ravok's selfDamagePct to Aegis was
a degenerate combo waiting to be found), and live-turn only (end-of-turn DoT ticks are not
hits). **(3) The amount is what would have reached the ally** — attacker's mods and the
ally's cover compose as if the hit landed, then Aegis's shields and HP absorb it; his own
cover is not recomputed because he is not where the shot was aimed. **(4) Ally-bound
targeting reuses the chase pattern** (unit id in the order) rather than square-aim-near-an-
ally, which is ambiguous at 4v4. Landing is the nearest open orthogonal adjacent at Dash
start, fixed-order tiebreak, fizzle if surrounded. **(5) The 1v1 fallback keeps the
self-applicability rule honest**: with no living ally the ability degrades to exactly the
square-target escape it used to be. **(6) The playtest lever is the shield, never the
redirect** — if the guarded carry proves unkillable at 2v2, 18 becomes 14; the redirect is
the identity and does not move.

---

## 2026-08-21 — Builder session 13 (the model load path: the missing call site, and four decisions around it)

**(MODEL-PRELOAD) A fail-soft asset path needs its call site pinned by a spec.** Phase 8 shipped
`character-clips.ts`, `character-model.ts` and the `renderer3d.ts` wiring, all tested, all
working — and nothing ever called `preloadCharacters`. The board drew boxes exactly as it had
before, silently, because a fallback that fires quietly is indistinguishable from a feature
nobody switched on. `app.ts` now kicks the preload off with the match's distinct character ids,
and `character-preload.test.ts` asserts it: one call per match, deduplicated by character id,
never the whole roster. Verified by removing the call — all three specs fail.

**(MODEL-LATE) Models arrive after the first paint, and the renderer rebuilds rather than the
app awaiting.** The opening paint must stay synchronous (VISION1-opening: anything awaited
before it reintroduces the frame where the enemy team is unfogged), and a `.glb` is a network
fetch, so on any cold load the board is drawn before the models exist. `buildUnit` decides
box-or-model once and `show()` caches the group, so `preloadCharacters` ends by dropping the
groups of units whose model has since landed (`staleUnitGroups`, pure and unit-tested) and the
next paint rebuilds them. The alternative — awaiting the preload before the opening paint —
trades a correctness invariant for a loading screen, which is the wrong direction. Dropping is
safe only for box-drawn units, and that is why the check excludes rigged ones: a box owns its
geometry and materials outright, while a `SkeletonUtils.clone` shares both with the scene it
came from, so disposing one would blank every later instance of that character.

**(MODEL-AUDIT) A model with no idle clip falls back to the box; any other missing clip only
warns.** Idle is what a unit plays whenever nothing else is happening, so a `.glb` without it
leaves the unit in its bind pose — a T-pose standing on the board, which reads far more broken
than the box it replaced. Every other clip costs one animation and nothing structural. The
same pass also warns per character when no model loads at all: eight of nine having no art yet
is ordinary, but "no art yet" and "the path is wrong" draw the identical box, and only one of
them is fine.

**(MODEL-CACHE) The mesh URL carries a content hash from the manifest.** Vite fingerprints
`dist/assets/` and not `public/`, where the models live, so `aegis.glb` ships under that exact
name every build and a browser holding the previous rig keeps serving it. `build_glb.py` now
stamps a 12-hex hash of the exported bytes into the manifest; the client revalidates the
manifest (`cache: 'no-cache'` — it is a few hundred bytes) and appends the hash to the mesh
URL. Mesh and manifest can then never disagree about which clips exist, which is the stale case
that matters: the model loads and the clip the manifest names is not in it.

## Open Questions for the Analyzer — 2026-08-21 (art assets)

1. **One clip set, or nine copies of it?** `build_glb.py` writes every clip into every
   character's `.glb`, including the generic ones the roster shares — four of Aegis's nine are
   stock Mixamo. Estimated cost is ~1 MB per 4v4 cold load and ~1.2 MB across the roster, spent
   on duplicates; animation keyframes, not the mesh, are the bulk of these files. Written up in
   full with three options in `ART_PIPELINE.md` §18. **Owner/Designer call, and it wants making
   before the other eight characters are rigged** — retrofitting means re-exporting all of them.
   Not decided here: it changes the shape of what the build emits, which is past a Builder call.

2. **`ASSET-WEIGHT-BUDGET` is now live, not hypothetical.** The 300 kB gz budget counts `.js`
   in `dist/assets/` and nothing in `public/`. Phase 8 means `public/models/` is a real,
   growing directory that no CI number watches. The backlog item exists; the models now exist
   too.

3. **The 2× headroom argument for the 300 kB budget is stale.** `bundle-budget.mjs` and the
   BUNDLE1 entry above both justify 300 kB as roughly double the then-current 145 kB. It is
   210.1 kB today, so the margin is 1.43×, and "you have to double the bundle to trip it" no
   longer holds. Not changed — whether to raise it, ratchet it, or hold at 300 and code-split
   `renderer3d.ts` when it trips is a call worth making deliberately rather than in passing.


## 2026-08-21 — Builder session 13 (INTERCEPT-GUARD, SUDDEN-DEATH-TEST, NET-E2E-EXPAND, BOTPLAY-SWEEP)

**INTERCEPT-GUARD's redirect is one chokepoint, and the two paths that do NOT call it are the ruling.**
`landDamage` is called by Blast hits, Dash hits and enemy traps; `tickOverTime` and the recoil path
deliberately still call `applyDamage` directly. Writing the exclusions as *absences* rather than as
`if (!isTick && !isRecoil)` inside the chokepoint means a future damage source has to opt **in** to the
redirect, which is the safe direction: a new source that forgets lands where it was aimed, rather than
silently redirecting something the ruling excludes.

**The guard dies with its guardian, enforced at the READ.** `guardianOf` returns nothing when the named
unit is dead, rather than the death path hunting down and stripping the status. One place to be right, and
a new way of dying cannot miss it.

**A fizzled Intercept does nothing at all — no teleport, no guard, no shield — but spends its cooldown.**
The design says *"fizzles harmlessly (teleport precedent: fizzle, cooldown spent)"*. The teleport precedent
strictly covers only the *movement*, so this is an interpretation: I took the whole-ability reading because
"fizzles harmlessly" reads that way and because it is the minimal-power option — never grant something on a
failure. Flagged below; the other reading (shield still lands) is one line away.

**`allyTarget` is a def flag on a `square` shape, not a new shape.** The 1v1 fallback aims at a bare
square, so both halves of the contract are the one-square shape and a new `ally` shape would have needed
the square case anyway. `validate.ts` refuses `allyTarget` on any other shape for the same reason
`wallLength` is refused off a wall: a field the engine cannot read on that shape is a number nobody can
find.

**The landing is resolved once, at the start of Dash, into a map keyed by unit id.** The ruling says "the
ally's position at the start of the Dash phase", and it is also the only order-independent reading —
computing it inside the resolution loop would make Aegis's landing depend on whether the ally happened to
dash earlier in `orderedPlans`, which is a rule nobody could reason about from the board.

**The plan-time area had to move with the landing.** `expandShape` runs at plan time around the *ally's*
square, and `applySelfEffects` gates the shield on the caster standing inside the area — so swapping the
aim without swapping the area produced a bodyguard who arrived with no shield. Caught by the thesis test,
worth writing down because it is invisible from the diff.

**Two `duration: 1` statuses cannot be asserted from post-turn state** — the WALL-HIT-ONCE lesson, one
ability later. Guard and shield are applied in Dash and swept by the same turn's end-of-turn tick, so
`state.statuses` afterwards is empty whether or not the ability worked. The tests read `statusApplied` off
the event log instead.

**`playTurn` in `net-e2e.test.ts` had a latent bug NET-E2E-EXPAND found:** it locked in once per **seat**,
and Lock In advances one **character** at a time. Every previous test was 1v1, where those are the same
number; the asymmetric 3-player 2v2 is the first case where they are not.

**SUDDEN-DEATH-TEST needed no production change.** The Spec Notes said a required change would be a finding
rather than a test edit — the ruling and `resolveOutcome` agree exactly, including the Double-KO draw.

### BOTPLAY-SWEEP, first run (2v2, duel-arena, every ordered pairing, 1 match each)

cinder 100% · bastion 81% · vex 69% · kestrel 56% · thorn 50% · wisp 31% · aegis 25% · lumen 25% ·
ravok 0%. **Read with the standing caveat**: greedy bots, no focus fire, no baiting, no held cooldowns.
Both extremes look like bot artifacts rather than balance — Cinder's burn ticks whether or not the bot
plays well, and Ravok's Whirling Cleave charges him half its damage, which a policy that always fires the
biggest available thing pays over and over. Reproduce with `npm run botplay`; every row replays exactly.

## Open Questions for the Analyzer — 2026-08-21

1. **The fizzle reading is an interpretation** (`docs/design/intercept-guard.md` §3, backlog
   INTERCEPT-GUARD). I made all-four-blocked mean the **whole ability** does nothing but spend its
   cooldown. The doc's parenthetical cites the *teleport* precedent, which strictly covers the movement
   only — so "no teleport but the shield still lands" is also a defensible read. Confirm which, or the
   playtest will discover it the hard way.

2. **`guard` is beneficial, so a future ability carrying BOTH `impact` and `guard` would hand a guard to
   every ally in the blast** — plural bodyguarding from one cast, which the ruling never considered.
   Intercept has no `impact` so nothing turns on it today. Worth a sentence in edge-cases before a second
   `guard` ability is authored.

3. **A guarded ally who is *untargetable* is not specially handled.** UNTGT1 skips the victim before the
   damage is composed, so the guard never sees the hit — correct, I think, but it is a composition of two
   rulings rather than either of them, and it is the kind of interaction a playtest surfaces as "my
   bodyguard did nothing".

4. **BOTPLAY-SWEEP's two extremes want a human eye** (Cinder 100%, Ravok 0%). My reading is that both are
   bot artifacts and neither is a balance finding, but the sweep exists precisely so that call is not mine.
   Ravok in particular: the sweep is the first evidence that RAVOK-RECOIL is punishing, and a greedy bot is
   the worst possible pilot for a recoil kit.

5. **NET-E2E-EXPAND covered the asymmetric 2v2 only.** Still uncovered, from the item's "then, if time"
   list: the per-player timer expiring over the wire, a disconnect during **playback** rather than
   Decision, and a reconnecting seat's lobby→match handoff.

6. **The `guardPath` render layer is new** (`renderer3d.ts`). One more `PathLayer`; nothing else uses it.
   Flagging because render layers are a small shared vocabulary and a new one should be deliberate.
## 2026-08-21 — Builder session 13 (BOARD-LIT / GRID-SEAMS: the board stops being black boxes)

**The complaint was "the maps are just black and boxes"; the cause was not missing textures.**
Three things were making the board flat, and only the third is an art problem. Tier 0 fixes the
first two and costs no asset bytes at all.

**BOARD-LIT — the rig was ambient-dominant.** `AmbientLight(1.6)` against `DirectionalLight(1.1)`
means every face of every box receives nearly the same energy. Form is read from the *difference*
between faces, so under that rig a wall is a flat rectangle no matter what colour or texture is put
on it — a texture pass would have been money spent on a problem it could not solve. Ambient is now
a floor (0.35) whose only job is keeping a shadowed face readable, the sun models the scene at 2.2
and is the only shadow caster, a `HemisphereLight` separates tops from sides by *hue* as well as
value, and an un-shadowed fill keeps the dark side's silhouette. Intensities are physically scaled:
three has been physically-correct by default since r165 and this workspace is on 0.185.

**Materials now say what a thing is made of.** Every board mesh was `MeshLambertMaterial`, which has
no notion of roughness, so floor and cover and wall scattered light identically and read as one
substance in three colours. `SURFACE` gives each a roughness/metalness pair — cover is scuffed metal,
brush is fully matte, floor is dry stone. The entries are the hook a later tier hangs canvas-drawn
`map`/`normalMap` textures off without moving anything else.

**Overlays are unlit now, and this was the one real trap in the change.** The tile-highlight
material was also `MeshLambertMaterial`, which under `ambient 1.6` was full-brightness *by accident*.
Dropping ambient to a floor would have darkened every aim, range and fog wash along with the board and
quietly cost them the contrast they exist for — a lighting change turning into a rules-legibility bug.
Overlays are UI, not scenery, so they are `MeshBasicMaterial`: what they were always pretending to be.
Pads, traps, nameplates and intent tiles were already unlit and are untouched.

**GRID-SEAMS — the seams were a comment, not a feature.** The line above the terrain loop has always
read "faint tile seams so squares are countable — the grid IS the ruleset here", and nothing under it
drew any. The floor was one undifferentiated plane and a square only became visible while something was
hovered over it. On a game that quotes every rule in squares, a board at rest you cannot count is the
bug; the seams are now drawn, as floor-coloured ink darkened 45%, below the overlay band so nothing the
player is asked to read has to compete with them.

**Judgment call — the shadow camera is sized from the map, not left at three's default.** A
`DirectionalLight` shadows through a ±5 orthographic box, and *both* shipped maps are larger than that
in both axes, so the default would shadow a patch in the middle of the board and leave the rest lit —
which reads as a broken renderer rather than as lighting. `shadowFrustum()` takes the board's
half-diagonal (the light is off-axis, so the diagonal is the extent that matters) plus a margin for the
shadow a wall throws past the last row. One 1024 map, because the e2e opens several renderers.

**Judgment call — the new configuration is exported as data and tested pure.** `renderer3d.test.ts`
established that the renderer needs WebGL but its *decisions* do not: the board↔world mapping is pure
and tested. `LIGHTING`, `SURFACE`, `shadowFrustum()`, `gridInk()` and `gridPositions()` follow that
precedent, so the ambient-vs-sun ratio, the shadow coverage and the seam geometry all have real
assertions without a GL context. The seam test checks the grid against `squareToWorldXZ` specifically:
a grid that disagrees with the mapping is the old SVG click-target bug wearing a new coat.

**Cost:** +0.8 kB gzipped (191.4 → 192.2, budget 300). No new assets, so `ASSET-WEIGHT-BUDGET`
(`BACKLOG.md`) is not yet in play — the first `.glb` or `.png` is what triggers that item, and Tier 0
deliberately does not add one.

**Not done, and deliberately.** Tier 1 (procedural canvas textures via the `textures.ts` cache pattern),
Tier 2 (`theme` as a `MapDef` field so a map's look ships as JSON per golden rule 2 — both shipped maps
currently share one hardcoded `PALETTE` in `app.ts`, so Duel Arena and Iron Basin are the same six
colours in a different shape), and Tier 3 (real assets, which needs the asset-weight CI number specced
first). Also noted: `docs/ART_PIPELINE.md` covers *characters* only — there is no equivalent document for
terrain, and Tier 2 onwards wants one.

## 2026-08-21 — Builder session 13b (SCENE-DIORAMA / SKY-DOME: the board becomes a place)

Follow-on to BOARD-LIT, and the first phase of the new `docs/MAP_PIPELINE.md` — the terrain
counterpart to `ART_PIPELINE.md`, written this session because the owner asked for maps with
the life Atlas Reactor's have and there was no document saying what that would take.

**The idea the pipeline is built on.** In Atlas Reactor the arena you *play on* and the
environment you *look at* are two different things: the playable grid is a small platform, and
most of the screen is set dressing no rule ever consults. That separation is the architecture
worth copying, and it fits the constitution exactly — `data/maps/*.json` stays gameplay truth
and scenery is a decoration layer keyed to it. It also reframes the work: "replace the boxes
with nicer boxes" has a disappointing ceiling; "build a diorama around the board" is where the
life is. The separation is already *enforced* rather than merely intended, because
`squareFromPoint` raycasts `ground` specifically rather than the scene — so scenery cannot
steal a click however far it extends. That one line is why this layer is safe to grow.

**SKY-DOME is screen-space, and that is the projection's decision, not a shortcut.** Under an
orthographic camera every ray is parallel, so a dome large enough to enclose the camera is
sampled across only a few degrees of its own curve and the gradient painted on it arrives very
nearly flat — which is the thing being fixed. A background texture is drawn as a full-screen
quad, so the ramp lands as authored.

**`sky.ts` has no `three` import on purpose.** The e2e reads composited pixels and has to know
what the sky should be; the alternative is a hand-copied hex in `e2e/pixels.ts` that silently
stops matching the first time anyone retunes the ramp, and whose failure would look like a
clipped board rather than a stale constant. Keeping the palette and ramp maths dependency-free
lets the browser test import the same source the renderer draws from.

**The ramp was retuned to make an existing test mean something.** Measured off a real
composite, the lit floor arrives at `rgb(18, 20, 27)` and the old flat background was
`#12141a` — within one count on every channel. So `isSceneBackground` matched the floor as
readily as the void, and "no rank of the board is clipped" could not actually fail. The first
ramp chosen passed close enough to the floor to keep that hole open; it was moved to a more
saturated blue until the floor is off-ramp by a wide margin. The check is now stronger than
the literal it replaces, not merely different.

**Judgment call — every permanent fixture stays dim, and this is a constraint rather than a
taste.** `e2e/pixels.ts` counts colour *families*, and `isTeamBlue`, `isTeamRed` and
`isAimOrange` all gate on a channel above 130, because those marks are things a player is
meant to look *at*. The first rim drawn was a bright cyan and composited at `(79, 173, 223)`,
which satisfies `isTeamBlue` — so "team 0's units are on screen" would have been satisfied by
the furniture. Worse, `isTeamRed` is asserted **equal to zero** to prove the unseen enemy team
is not drawn, so a saturated red spawn marker would have broken a hidden-information guard
outright. Every bright hue collides with *some* family, so the fix is not a different hue but
a lower one: contrast against a near-black sky is what makes an edge read, not brightness. The
rim now composites at `(49, 94, 112)` and the markers at about `(42, 60, 101)`. This is also
the better design — furniture should be quieter than units.

**Judgment call — `boardSpan()` now frames the *arena*, not the board.** The platform and its
rim were built correctly and drawn every frame, and were invisible: the camera fits the board
exactly, so a 1.5-tile ledge sits outside the frustum. Fixing it at the initial `span` did
nothing because the auto-camera overwrites it, so the allowance belongs in `boardSpan()`,
where "frame the whole board" is defined. The Analyzer may want to check whether that changed
how the auto-camera follows the action.

**A bug worth recording because the class of it will recur.** The rim bars were first placed at
`SCENERY.top - height / 2`, which is *inside* the slab — the slab runs from `top` downward, so
the bars were buried in the geometry they were meant to edge. Nothing errored and nothing
looked wrong; the rim was simply absent. Scenery has no test that can catch "drawn but
occluded", which is why the verification loop here was screenshot-and-scan rather than
screenshot-and-look.

**Deferred, deliberately: scene fog and bloom.** Both are in the original sketch of this step
and both are held for the same reason — they shift *global* pixel values that tightly-tuned
matchers depend on. `isFogged` requires `r < 18 && g < 20 && b < 26`, which bloom bleeding off
a bright fixture will violate and which fog blending toward a horizon colour will violate too.
Bloom also changes the render path every pixel test runs through, and the e2e is already ten
minutes single-worker under SwiftShader. They want their own change, with the predicates
retuned deliberately alongside — not a line appended to a scenery commit.

**Cost:** the sky adds one 8×256 canvas texture and the arena adds seven meshes, on any map.
No new assets, so `ASSET-WEIGHT-BUDGET` is still not in play — `MAP_PIPELINE.md` phase 4 is
what triggers it, and it now has two callers, since `ART_PIPELINE.md` §5 needs the same loader
and the same budget number for character `.glb` files.

## 2026-08-22 — Builder session 14 (MAP-THEMES / FOG-BY-THEME: a map declares its own place)

Phase 2 of `docs/MAP_PIPELINE.md`. Owner directives for this phase: Duel Arena may be as bold
as it needs to be ("the current board is bad"), brush stays green-ish, and a theme carries the
arena and sky as well as the terrain, with fog derived from the theme's floor colour.

**The themed/global boundary is the same line phase 1 drew between lit and unlit.** The world
is themed — floor, walls, cover, brush, the material each is made of, the sky, the platform.
The UI vocabulary is not — team colours, aim orange, the range wash, pad teals, status inks.
Two reasons, both about the player. Team colour is *identity*: a map that re-tints the teams
changes friend-from-foe reading per map, and `TEAM_CSS` in the HUD plus the e2e's colour
families both encode it. And the overlay palette is a vocabulary learned once; re-teaching it
per map is a cost with no upside. Getting one boundary to do both jobs is why `BoardPalette`
splits into a themed half and two constants rather than becoming one bag of colours.

**Themes live in `data/themes/*.json`, named by `MapDef.theme`.** Considered and rejected:
inline in the map (duplicated the moment two maps share a look) and a table in client code
(that is code, not data — it fails golden rule 2 outright). A separate directory matches the
shape already there for characters and maps, keeps map files about geometry, and lands the
whole thing in the Designer's lane per the `CLAUDE.md` role table: a new theme touches no
`packages/` file.

**`theme-inert.test.ts` pins golden rule 1 from outside.** Putting a purely visual string on an
engine type is a standing invitation to branch on it one day, so the guard does not trust the
comment on the field: same orders, two maps identical but for `theme`, and the resolved state
*and event log* must match. The event check matters separately — two runs could agree on the
final state and still disagree about what they claimed happened, which is what attribution and
the combat log are built from.

**FOG-BY-THEME — fog now darkens *to* a value rather than *by* one.** The wash was a fixed 62%
of near-black, a number tuned against one dark floor. Over Proving Floor's limestone the same
alpha leaves fogged squares plainly readable: VISION1 quietly stops holding, and the failure
surfaces as a colour-matcher complaint that reads like a renderer bug rather than the rules
problem it is. The overlay is unlit and composites linearly, so the alpha is solvable —
`α ≥ (floor − target) / (floor − ink)` per channel, binding channel wins. A dark theme still
lands on exactly 0.62 and looks unchanged; a pale one gets what it needs.

**Judgment call — the fog cap came down from 0.96 to 0.9, for two reasons at once.** Fog hides
*units*; terrain under it is public knowledge, and a wash approaching opaque erases the board's
shape along with the information. Separately, at 0.96 *no* floor could fail the VISION1 contract
check — the validator had a rule nothing could violate, which is decoration. At 0.9 a near-white
floor genuinely fails and an author is told at authoring time.

**Themes ship with a validator, because phase 1 earned it.** That session lost real time to an
arena rim that satisfied `isTeamBlue` and a spawn marker that would have broken the fog test's
`isTeamRed === 0` assertion — a hidden-information guard. A theme is a far easier way to hit
the same wall, and Designers can now add themes without touching `packages/`. So the contract
is a test: terrain kinds separated in luma, brush green-dominant, nothing inside a UI colour
family, the fogged floor inside the VISION1 bound, and the sky ramp clear of terrain. It also
ships with tests that the validator *rejects* things, because a rule nothing fails is not a rule.

**The contract is separation, not ordering — and the fallback fails it.** An earlier draft
pinned the ranking the built-in palette happens to use (floor darkest), but Proving Floor's
whole idea is a floor brighter than what stands on it, and a rule forbidding that protects an
accident rather than the player. Measured, the pre-theme palette's **wall and cover sit 11.9
luma apart against a minimum of 18** — the worst pair on the old board, and a concrete piece of
evidence for the owner's "the current board is bad". `FALLBACK_THEME` is therefore exempt from
the contract *and asserted to fail it*, naming the number. Raising the threshold to fit it would
have thrown the finding away; hiding the exemption would have been worse.

**A coupling bug worth recording.** `e2e/pixels.ts` imports `themes.ts` so the browser test and
the renderer cannot drift on what the sky is. Playwright transforms that file for **Node**,
where a JSON import needs `with { type: 'json' }`; Vite and Vitest do not. So the suite died
with "No tests found" — a module-loading error wearing the costume of an empty suite. Import
attributes satisfy Node, TypeScript 5.9, Vite and Vitest at once. The general lesson: a module
shared between the bundled client and a Node-side test lives under both sets of rules.

**Not done.** Props, ambient motion and the freeze hook it needs (phase 3), and the terrain
prop sets a theme will eventually name. `MAP_PIPELINE.md` is updated.

## 2026-08-22 — Builder session 14b (owner corrections: FOG-SHADOW, AOE-CLASH, OVERLAY-BY-THEME)

Three corrections from the owner on seeing session 14 running, and one of them says a piece of
that session's reasoning was simply wrong.

**FOG-SHADOW — fog is a shadow, not a blackout, and FOG-BY-THEME was solving the wrong
problem.** Owner: *"the rest of the map is too fogged up. You should still be able to see the
general textures, the tiles should just be slightly shadowed."* Session 14 derived a per-theme
alpha that drove every floor to one very dark absolute value, justified by VISION1. That
justification does not hold: hidden units are **never drawn at all** — `fogView` decides who
reaches the renderer — so the wash is a statement about what you cannot see, never the mechanism
that hides it. Darkening past legibility buys no secrecy and destroys terrain the player already
knows, since walls and cover are public and static.

And once fog is a shadow, the derivation has nothing left to do. Blending toward near-black is
**already proportional** (`out ≈ floor·(1−α)` with the ink near zero), so one constant is one
constant shadow on every theme. `FOG_OPACITY = 0.5`, and roughly sixty lines of solver deleted.
The complexity was paying for a target that should not have existed.

**AOE-CLASH — terrain must leave the saturated hues to the UI.** Owner: *"the pale sand color on
Duel Arena is conflicting with the yellow aoe previews."* Correct, and the contract had a hole:
it checked terrain against the *counting predicates* in `e2e/pixels.ts`, which are narrow
machine tests, not against whether a colour **looks like** an overlay. Warm sand `#b8a781`
passed every one of them and still fought the amber AoE wash on sight.

The rule that closes it is a **chroma cap** rather than per-overlay hue distances, because the
overlay vocabulary has already claimed most of the wheel — amber for aim and AoE, blue for
range, yellow for a dash route, green for a catalyst, teal for free actions, red for the camo
alarm, purple for a decoy. Desaturated terrain is compatible with all of them at once and needs
no case analysis. Proving Floor was rebuilt as bleached limestone that keeps its *value* and
gives up its *chroma*: still the bold bright departure the owner asked for, no longer competing.
Notably `FALLBACK_THEME` now fails this rule too — its cover is a saturated brown at chroma 45 —
which is the same complaint arriving about the old palette from a different direction.

**OVERLAY-BY-THEME — a wash is only as visible as the distance it moves the floor.** The e2e
found this before the owner did: the range envelope at 16% over pale stone composited to
`b − r = −10`, meaning the "blue" envelope was not blue and a player could not see their own
range. Colour stays global — an envelope must be the same blue on every map or it stops being a
word the player knows — but *opacity* is not vocabulary, so it scales per theme. One factor for
all layers rather than a per-layer solve, which preserves their authored relative weights (aim
louder than range).

**Judgment call — a measured constant beat a physical model, twice.** Predicting composites
needs a lighting factor, and there is no single one: three converts albedo sRGB→linear, lights
it, and converts back, so a dark floor loses much more of itself than a pale one. A factor
fitted on the dark palette predicted Proving Floor's fogged floor at 55 where it actually
composites at **86**, and the range envelope at (116,125,141) where it actually lands at
**(161,172,191)**. Two different fixes followed. `foggedColour` is now fitted **end to end from
albedo to composite** — the rig's brightening and the fog's darkening pull opposite ways and
largely cancel, so `albedo × 0.49` holds across two deliberately unalike themes. And
`isRangeWash` stopped predicting a value at all: it asserts the *relationship* the wash creates —
cool-shifted by an amount no unit reaches — which measured out at `b − r = 30` over **both**
palettes, the constant-strength goal landing where it can be seen.

**Judgment call — `MIN_FOG_DROP` is small and absolute.** A proportional rule would be checking
`FOG_OPACITY` rather than the theme, and so could never fail. What can fail is a floor so dark
there is nothing left to take: at `#060606` the ink is brighter than the terrain and fog
*lightens* the square. Six luma clears both shipped dark themes with room and catches that.

## 2026-08-22 — Builder session 15 (GRAIN and AMBIENT-FREEZE: phase 3, and the guard before the hazard)

**GRAIN — two scales, because one does not work at this zoom.** A tile is about 37 screen
pixels at the default framing, so fine noise aliases into mush and buys nothing. What reads is
per-tile variation (each square a shade off its neighbours) and coarse within-tile grain
(mottle, brushing, a cut edge). Both shipped; the first is the one that actually stops a floor
looking like a single painted plane.

**The floor is de-indexed and vertex-coloured, and that choice has a reason.** The obvious
implementation is a texture spanning several tiles, so each square differs. It does not work:
the board is `width × height` squares and a multi-tile texture only lands on square boundaries
when the board divides by its size — 18 ÷ 4 does not, so the pattern slides half a square out of
register and grain cuts *across* tiles instead of sitting in them. So the texture is exactly one
tile (`repeat` is then always integral and always aligned) and the per-tile variation is done
with flat per-quad vertex colours instead, which cannot fall out of register at all. Indexed
geometry shares vertices between neighbours and would blend the colours into a smooth wash, so
the grid is `toNonIndexed()` — about 1600 vertices on the largest shipped map, which is nothing.

**Grain is achromatic, and that is load-bearing rather than tasteful.** Every colour predicate
in `e2e/pixels.ts` that survived MAP-THEMES survived by testing a *hue* relationship —
`isRangeWash` is `b − r`, `isTeamRed` is `r − g`. A grain that tinted would put every one of them
back in play at once. `tileTint` returns a single scalar applied to all three channels, so hue
is preserved by construction; the test pins the property rather than the implementation.

**Judgment call — the raster centres on 246, not mid-grey.** A `map` *multiplies* the material
colour in three, so a mid-grey texture would halve every albedo in every theme and the palette
would stop meaning what it says. Centring near white keeps the theme as the source of the colour
with grain as a slight darkening either side. The residual is a uniform ~3% dim, comfortably
inside the ±14 slack `isFogged` allows.

**Judgment call — grain has ceilings, clamped at the door.** A theme is Designer-authored data,
and grain rides *under* every overlay the player reads; past a point it stops being surface and
starts competing with the marks that carry meaning. The ceiling is also what keeps the measured
constants in `themes.ts` inside their tolerances — `foggedColour` is a two-point fit matched
within ±14, and a floor swinging wider than that would eat the slack.

**A test of mine was wrong, and the hash was fine.** The first draft asserted that every adjacent
pair of squares differed by at least 0.02, and it failed. That assertion was the bug: a genuinely
uniform hash produces occasional near-collisions, and forbidding them demands *structure* rather
than the absence of it. Replaced with the statistic that actually characterises good mixing —
mean neighbour `|Δ|`, which lands at 0.30–0.37 against a uniform-random expectation of 1/3 —
plus a run-length check, since a mean can be propped up by big jumps elsewhere while a region
sits flat.

**AMBIENT-FREEZE — shipped deliberately ahead of its consumer.** Nothing moves decoratively yet.
`render.spec.ts` asserts frames are byte-identical to prove a committed aim stops following the
pointer, and that can only be checked by comparing whole frames — so the first rotating fan
breaks it permanently, with a failure message accusing the *aim* rather than the scenery.
Retrofitting the freeze after that happens means debugging a false accusation first. Building
the guard before the hazard costs one pure module and removes the trap entirely.

Three ways to ask for stillness, all honoured: `?ambient=off` (what the browser suite now uses,
via `baseURL`), `prefers-reduced-motion: reduce` (ambient motion is decoration by definition, so
it is exactly what that setting exists to suppress — and it outranks the query, because a viewer
who asked their OS for stillness should not be overridden by a link someone sent them), and an
explicit argument. The decision is a pure function of the environment; only `browserAmbient()`
touches `matchMedia`, guarded, because a missing accessibility API means "no preference
expressed" and must never be a crash on boot.

**Not done.** Phase 5 — props, set pieces, and the first thing that actually moves. The freeze
hook now makes that safe to attempt: start with one element and confirm the browser suite stays
green before adding a second.

---

## 2026-08-22 — Builder session 14 (the door's clearance, and stride-matching reversed)

**(PROP-SURFACE) A prop sits on the surface of its bone, not on its axis.** Centring the door
on `mixamorigRightForeArm` put the arm through the middle of the panel — the pauldron came out
the front. The offset that fixes it is along the prop's own **face normal**, which after the
attach rotation is the bone's −Z, by roughly the limb's radius plus half the prop's thickness
(0.10 tiles here). Worth stating as a rule because the natural reading of "attach to the
forearm" is the bone's origin, and the bone's origin is inside the arm.

**(STRIDE-MATCH reversed) Locomotion plays at its authored rate.** Aegis's run cycle is 0.733 s
for two strides against a 0.76 s beat — 2.07 steps per tile — and `strideTimeScale` scaled the
clip so one cycle covered exactly two tiles, giving one step per tile. The owner ruled against
coupling them at all (2026-08-22): the character walks to the square using the animation.

The ruling is right and the reason is worth keeping. A Mixamo clip is exported **In Place**, so
it carries no ground speed. Slowing it to hit a steps-per-tile target does not slow the
character — the engine still moves it one tile per beat — it slows the *feet* under a body
travelling at the same speed, so a busy cadence becomes outright foot-sliding. The tidy number
was buying a worse picture.

`strideTimeScale` is deleted rather than left exported-and-unused: it was written in Phase 8,
tested, never called, then wired in and reversed within the hour, and a tested helper sitting
there is an invitation to wire it again. The lever for gait, if it reads wrong, is
`MS_PER_BEAT` — how long a unit takes to cross a square — which moves the whole turn's pacing
and is a design call, not a rendering one.

## 2026-08-22 — Builder session 14 (the first playtest's six, plus ASSET-WEIGHT-BUDGET)

DEATH-HANG-2 → INTERCEPT-LANDING-CHOICE → CHASE-AUDIT → TEAMMATE-PLAN-VISIBLE → WALL-SLOW →
NAMEPLATE-DEPTH, then ASSET-WEIGHT-BUDGET. All seven shipped; nothing was skipped.

**DEATH-HANG-2 — the turn nobody can take resolves itself.** DOWN-SEAT-SKIP removes a seat with
no living character from `#answering()`. When *every* seat is down that set is empty and
`#allIn()`'s `answering.length > 0` guard makes the room wait — so the first Hold Position press
puts that seat alone in the answering set and resolves the whole turn by itself, and the second
player's press lands on the window that has already replaced it. Sudden death is the only place
this is reachable, because a double KO is the one death that does not end the match. The fix
resolves the turn *before* a window nobody can use is ever opened, gated on `#sinks.size > 0` so
QUOTA-RUNAWAY still stops an abandoned room, and bounded by `MAX_AUTO_RESOLVES` so it can never
run away.

**Judgment call — BLINK-ADJ's nudge does not apply to an Intercept.** INTERCEPT-LANDING-CHOICE
gives the landing square to the player; BLINK-ADJ lands a blocked blink on the *nearest legal*
square instead of failing. Composed naively they produce a bodyguard standing diagonally off his
teammate — outside the ability's own area, so `applySelfEffects` refuses him the shield — with the
guard bound anyway: a half-cast that reads on the board as a working Intercept. The ruling gave
the square to the player, so for a guard cast it is that square or a whole-ability fizzle. The
ordinary 1v1 fallback teleport keeps the nudge, unchanged.

**Judgment call — an ally-targeted aim skips the caster-to-aim range check.** A landing beside an
ally at exactly range 5 can sit six squares from Aegis, so the ordinary `aimIsLegal` envelope
would refuse legal picks at the edge of the reach. The range constraint belongs to the *ally*
(`allyTargetOf`), and the square is checked by `guardLandingIsLegal`; both run, so nothing is
unchecked. Client-side `aimLegal` widens to `range + 1` — the tightest bound that never rejects
what the engine accepts — and the exact set stays `guardLandings`, which `commitAim` and the range
envelope both read.

**CHASE-AUDIT — the cause was `lastKnown`, not the chase.** *"Sometimes the character chases
directly to the tile the last character was on even if we know where the chase target went."*
`recordLastKnown` ran only at the turn boundary, so the fog fallback a chase reached for during
Move described the board as it stood at the end of the *previous* turn. An enemy nobody could see
at that boundary, brought into view during this turn's Prep/Dash/Blast and then slipping into
cover in Move, was chased to a square from turns ago — in the repro, eight squares in the opposite
direction. Fixed by recording again at the top of `runMove`, against the post-Blast board the
client has just played back. Golden rule #5 is untouched: `recordLastKnown` still only ever writes
a square the team can see, and an enemy nobody has eyes on leaves the record alone.

**Judgment call — the chase snapshot stays frozen (suspect (a), examined and declined).** The
backlog named a second suspect: the chase snapshot is the post-*normal*-move board, so a target
that is itself chasing is pursued to its pre-chase tile. That is CHASE1's convergence design, not
a defect — every chaser reads one frozen board precisely so that A-chases-B and B-chases-A cannot
depend on which of them `orderedPlans` visits first. Making the snapshot live would trade a
cosmetic lag against a mutual chase whose outcome depends on iteration order, which is the worse
fault. Left alone, and the reasoning is pinned in `chase-audit.test.ts` so the next audit does not
re-open it from scratch.

**Judgment call — TEAMMATE-PLAN-VISIBLE keeps relayed plans out of `drafts`.** The obvious
implementation merges a teammate's relayed order into the same `drafts` map the render loop
already reads, and one line of code would have done it. It is wrong in a way that would not show
up for a while: `drafts` is what this seat is *editing* and what `collectOrders`/`toUnitOrders`
send at Lock In, so a relayed entry in it is a plan this client could submit on somebody else's
behalf. Kept in `teamPlans`, replaced wholesale on every relay (an empty list is how the wire
says "the turn resolved"), and read-only at every use.

**Judgment call — `drawPaths` beside `drawPath` rather than more path layers.** A path layer is
cleared and rewritten on every draw, so a per-teammate `drawPath` call leaves only the last route
on the board. At 4v4 a seat has three teammates, each with a route and possibly a guard link. The
shape already existed one method along: `drawShape` takes a *list* of outlines into one layer for
exactly this reason, and `drawPaths` mirrors it.

**Judgment call — the asset budget is two caps, not one.** ASSET-WEIGHT-BUDGET's AC asks for "the
total `public/models/` byte weight … with a cap", and a total-only cap does not work as a guard
here: the roster is *expected* to grow from one rigged character to nine, so any total generous
enough to admit that growth cannot tell "one more character" from "one character got twice as
heavy". So the per-character ceiling (1.5 MB, ~25% over Aegis's 1.16 MB) is the live guard, and
the total (12 MB) is the ceiling the finished roster must fit inside — set above nine at today's
weight (~10.5 MB) and below nine at the per-character cap (13.5 MB). **Both numbers are Builder
estimates and want an owner's eye**, because the honest total depends on `ART_PIPELINE.md` §18's
still-open clip-duplication decision: Option A would drop it by ~1.2 MB across the roster and make
a much tighter cap the right one.

**Judgment call — `bundle-budget.mjs` checks that GLTFLoader is still split, without changing its
total.** The AC asks that the loader "stays code-split and out of the main JS number". Making the
budget cap only the *entry* chunk would have done that and would also have quietly loosened the
300 kB cap by ~17 kB, which is a deliberate call the backlog explicitly puts out of scope. So the
total still counts every chunk, and the split is checked by the existence of a `GLTFLoader-*.js`
chunk instead — if it were statically imported, Vite would have no reason to emit one.

## Open Questions for the Analyzer — 2026-08-22 (Builder session 14)

1. **`validate.ts` still does not refuse `guard` alongside `impact`** — RULED in
   `docs/design/edge-cases.md` (closing my session-13 OQ #2), with no backlog item to carry it. I
   did not implement it this session: it is a ruling rather than a scheduled item, and the brief
   says not to invent scope. It is small (one check in `validateAbility` plus a content test) and
   nothing in `data/` violates it today, so it is a guard against a future kit rather than a fix.
   Worth an item, or worth closing as "covered by review"?

2. **The asset budget's two numbers want an owner's ratification** (see the judgment call above).
   1.5 MB per character and 12 MB total are mine, derived from Aegis and from §18's arithmetic. If
   §18 lands on Option A, both should come down — and the tighter they are, the more the budget is
   actually doing. Related: the 300 kB JS budget is now 1.29× the real 233 kB, which the backlog
   already flags as a stale-headroom call.

3. **A relayed teammate plan is drawn from the plan, not from a preview the teammate saw.** The
   two agree today because both go through `abilityPreview`, but the relayed order carries no
   `aimStep` for shapes that do not send one and no waypoint marks at all — so a teammate's
   composed route is drawn as the router's path rather than as the corners they clicked. That is
   correct (the corners are gesture state, and golden rule #5 aside, nobody else needs them), but
   it means a teammate's line can differ in shape from the one they are looking at. Worth a look
   in the next playtest before anybody calls it a bug.

4. **CHASE-AUDIT's declined suspect is a design fork, not a closed question.** A chaser pursuing a
   *chasing* target still goes to that target's pre-chase square, because every chaser reads one
   frozen board (CHASE1's convergence design). I left it alone and wrote the reasoning into
   `chase-audit.test.ts`. If the owner's report turns out to have been about that case rather than
   the stale-memory one I fixed, the fix is a second chase clock — chasers who are themselves
   chased resolve first — and that is a design item, not a bug fix.

5. **DEATH-HANG-2's `MAX_AUTO_RESOLVES = 4` is a backstop with no test that reaches it.** Four
   consecutive all-down turns inside one message is not a state I could construct — respawns land
   before it — so the constant is there to bound a runaway rather than to implement a rule. If the
   Analyzer can build a case that hits it, the right cap might be different; if not, it is dead
   weight that is still cheaper than the alternative.

6. **The Playwright render suite is RED on `main`, and has been before this branch.** Nine of
   thirty-two failed on my branch; I checked eight of them against a worktree at `origin/main`
   (4da3c19) and all eight reproduce there unchanged — the four `UI-VIEWPORT` sizes, the fogged
   opening frame, UI1-fix, the resolved-turn readout, and STEALTH-CONFIRM. The ninth
   (MOVE-SPRINT-FIRST) passes in isolation on my branch and only fell over inside the full run,
   so it is a cascade from the ones before it rather than a failure of its own.

   The `UI-VIEWPORT` four have a diagnosable shape worth writing down: `controls.count()` is read
   once and then `controls.nth(i).boundingBox()` blocks for the full 60 s when the HUD is rebuilt
   mid-loop and index `i` no longer exists. That is a **test** bug — a stale index, not a HUD that
   runs off the screen — and its 60 s timeout is most of why the suite now takes 26 minutes. The
   remaining four are timeouts inside `resolveTurn`'s wait loop and want their own look.

   None of this blocks the merge (RENDER-VERIFY is a pre-merge signal, not a release gate — ruled
   in `docs/reviews/2026-08-25.md`), but a suite that is red before you start cannot tell anybody
   whether they broke it, which is the state RENDER-CHECKS-GREEN existed to end. **Worth an item.**
   I did not fix it this session: it is not in the backlog and repairing e2e assertions is exactly
   the "never guess or invent scope" line.

---

## 2026-08-22 — Builder session 15 (DEATH-HANG-3, TEAMMATE-MOVE-VISIBLE, RENDER-SUITE-GREEN, VALIDATE-GUARD-IMPACT)

**DEATH-HANG-3 was not the bug the spec notes predicted, and the difference matters.** The
suspect named was ordering: a resolution carrying both a downed seat and a `gameEnd`, with the
downed-seat hold running before the game-over branch. That could not happen —
`playResolution` already checks `status !== 'active'` and returns `renderGameOver()` *before*
`beginTurn()`, so the hold is unreachable while the match is over. The real cause is one line
earlier in the pipe: `resolveOutcome` **returns before `draft.turn += 1`** on every path that ends
the match, so the finishing state carries the *same* turn number as the turn before it — and
`net-boot.ts` gates the handoff on `now.state.turn <= played`. The last resolution of every
networked match was dropped before the client ever saw it. Fixed in the client (the gate now
forwards on "turn advanced **or** match ended", latched so a repeating end state fires once); the
engine is untouched, because not numbering a turn that will never be played is correct.

**Judgment call — the end-of-match latch lives in `net-boot.ts`, not in the engine.** The
tempting fix is to bump `draft.turn` on the way out so the existing comparison works. That would
make `state.turn` mean "turns played + 1" for a finished match and "turns played" for a live one,
which is a worse contract than the one line it saves — and it is an engine change to fix a client
gate. The client is where "have I already animated this?" is asked, so that is where the answer
was widened.

**Judgment call — `pressable()` in the DEATH-HANG-3 test checks visibility, not just `disabled`.**
`hud.clear()` retires the HUD by hiding its rows, so every button survives in the DOM, enabled,
behind a `display: none`. A test asserting on `disabled` alone would have demanded the end screen
*dismantle* the HUD rather than put it away — a production change to satisfy a test's idea of
tidiness. What a player can press is what the assertion should mean.

**TEAMMATE-MOVE-VISIBLE — the intent badge now names the ability instead of numbering it.** This
goes beyond the item's AC and is driven by the Dev Note (*"it should be VERY CLEAR what action your
ally is taking"*), so it is flagged rather than buried. `intent.ts`'s own rationale for the number
was that "a teammate glancing at the board is matching it against their own hotbar" — which is
exactly backwards when the ally is a **different character**, and in a 2v2 they almost always are.
"3" over Aegis's head is a lookup; "Intercept" is the sentence. The `slot` field stays on the badge
(it is what a player presses, and `abilitySlot` has other callers); only the drawn label changed,
and `intentTexture` shrinks the type to fit rather than growing the tile into the nameplate under
it. **If the Analyzer or owner wants the number back, it is one line** — but the note asked for
clarity and a digit is not it.

**Judgment call — a teammate's route draws in the movement colour, not the committed-plan one.**
`LOCKED` is deliberately "cooler and dimmer" because it is the colour of an ability *area* that has
already been decided. A route answers a different question — *where is my ally going* — and the
owner's note is that precisely this does not read. Same layer, same call, one constant swapped to
`MOVE_LINE`. No new layer (the spec notes forbid one) and no per-route colour, which `drawPaths`
could not express anyway: one call paints one colour, so a sprint and a walk cannot be told apart
on this layer. That is a real limitation and it is deliberate — telling them apart would cost a
second layer for a distinction nobody has asked for yet.

**Judgment call — the teammate chase link is fog-safe by construction rather than by a check.** A
chase names an enemy, and drawing a line to it could leak a position the fog is hiding. No
visibility test was added: a networked client's `state.units` contains only the enemies its team
can see, so an unseen target is simply not found and nothing is drawn. The check that would have
been written is the one the server already performed.
## 2026-08-22 — Builder session 15 (Move loses its banner beat)

**(MOVE-NO-BANNER-BEAT) Move starts the moment its banner does; the other three phases keep
their beat.** `choreograph` gave every phase a leading `BEAT` — "the banner reads before the
phase acts" — which is right for Prep, Dash and Blast: those are announcements, and the pause
is what makes the naming land. Move announces nothing. Everyone goes at once and the board
already shows where, so the beat was a full 760 ms of every character standing under a MOVE
label before anyone stepped. On a one-tile move that is **half the phase**, and it read as
characters hesitating before they walked. Owner's call.

**How it was found is the more useful part.** Three rounds of static screenshots blamed the
animation — first its cadence, then its seek — and both readings were wrong, because a
screenshot cannot show motion and this container renders at ~10 fps, so "a frame every 110 ms"
really means "a frame whenever the renderer got round to it". `npm run film -w @cards/client`
replaces `performance.now` and `requestAnimationFrame` in the page before any app code loads,
so stepping 33 ms advances the animation by exactly 33 ms however slow the render is. The
first film showed 23 frames of `aegis_idle` at the top of the Move phase — which no amount of
looking at the renderer would have explained, because the bug was in the timeline.

Nothing asserted the leading beat in either direction, which is why it survived a rewrite of
this area. It is asserted now, both ways: the first move cue sits at its banner, and a Prep
cast still sits after one.


**RENDER-SUITE-GREEN — two structural causes, one dead assertion, three real failures left.** The
suite went 9 red → 3. The UI-VIEWPORT four were a **stale-index hang** (`controls.nth(i)` re-runs
the selector, so a HUD rebuilt mid-loop left the index gone and `boundingBox()` waited out the full
60 s) — replaced by one `page.evaluate` measuring every control at once, which is both atomic and
~60 protocol round trips cheaper. That cost is why only the 1920×1080 sizes timed out while the
1280×720 ones got further, which is the tell I should have read last session instead of reporting
all four as one thing.

**Judgment call — `test.slow()` per test, not the global raise.** A composited screenshot of a
1400×950 canvas under SwiftShader costs 8–12 s, measured; three tests take several and were failing
on a 60 s budget having done nothing wrong. f71044a tried a global 120 s and rejected it (4
timeouts became passes, the suite went 33 → 40 minutes, 10 still red). The difference is that a
global raise also doubles what a genuinely *hung* test burns — and the hangs are now gone, so a
per-test budget reaches only tests that will finish.

**Judgment call — the UI-VIEWPORT framing check is deleted, not weakened.** It asserted scene
background at three corners of the uncovered region and read that as "no rank of the board is
clipped". Measured on both shipped maps at both required sizes, that region now contains **no sky
at all**: `proving-floor`'s `terrain.open` is `#b0aca4` against rgb(165,166,165) at the top-left,
`drained-works`' is `#232a33` against rgb(33,39,47). The board is not clipped — since SCENE-DIORAMA
and MAP-THEMES the camera fills the region it was fitted to, which is what "the scene fills the
viewport" asked for in the first place. I tried a narrower version first ("sky somewhere along the
top edge") and it is *also* false. A check that can only be made to pass by asserting less than it
claims is worse than no check, and the failure it guarded — a board pushed under the chrome — is
what step 5 proves directly. **This loses a claim, and losing it is the Analyzer's to ratify.**

## Open Questions for the Analyzer — 2026-08-22 (Builder session 15)

1. **RENDER-SUITE-GREEN is not finished: 3 of 32 still fail, and they are real.** The timeouts were
   hiding them, so these are new information rather than known-bad. None is budget or staleness; I
   did not guess at fixes.
   - **UI1-fix** (`render.spec.ts`) — *"pointer at 0.3,0.25 must not move a committed aim"*.
     **Measured, and it is NOT a production bug: the aim does not move.** Two screenshots of an
     untouched, settled board differ by themselves — 2,674 of ~205,000 sampled pixels by more than
     4 counts, 524 of them by more than 16, spread over the *entire* frame. The bucket counts come
     out **bit-identical** whether the pointer moved between the shots or nothing happened for
     2.5 s, so it is deterministic and independent of both time and input: a per-frame jitter
     (temporal AA), not the board moving. **Byte-equality is therefore not a usable technique in
     this suite**, which also means AMBIENT-FREEZE's frame-equality guard has not been able to work
     for as long as this has been true. I tried a tolerance and removed it: loose enough to absorb
     this, it can no longer tell a relocated aim overlay from noise, which is the only thing the
     test is for. **The repair is a different assertion** — count/locate the aim overlay's own
     orange pixels and assert the centroid does not move — and that is a re-spec of the idiom
     (`same()` has six callers), not a test fix I should make unilaterally.
   - **a resolved turn … floats a readout** (`render.spec.ts:284`) — the readout is not caught
     during resolution. Likely a sampling race against playback, but it could equally be UI5's
     floating readout not appearing; needs one look before it is called a test bug.
   - **STEALTH-CONFIRM** (`render.spec.ts:811`) — still a click timeout, but on a different thing:
     I fixed it clicking the playback *row* (a div whose centre `.hud-centre` overlays) instead of
     `.hud-skip`, and it now waits on `.hud-skip` never becoming visible. So the playback row is
     not up when the test expects it.
2. **UI-VIEWPORT's "whole board in frame" claim is gone, and it should be — resolved on merge, not
   by me.** I retired it from measurement (the region contains no sky at either size on either map)
   and inferred the camera now fills the region it was fitted to. A parallel branch had already
   retired the same check with the *authoritative* reason, which is better than my inference: the
   owner's BOARD_ZOOM call, *"scale everything up and let the map run off the edges"* — the board
   deliberately overflows now, so corners showing board or platform is the design. I took their
   version. **No question left here**; recorded because two sessions independently deleted the same
   assertion and the next reader should not think it was lost twice.
3. **The intent badge now names the ability instead of numbering it** (TEAMMATE-MOVE-VISIBLE, on
   the Dev Note). This goes beyond the item's AC and changes shipped UI-INTENT behaviour for the
   player's own characters as well as teammates'. One line to revert if the owner prefers the digit;
   `slot` is still on the badge either way.
4. **DEATH-HANG-3's cause was not the one specced, and the specced one was unreachable.** The
   suspect was a downed-seat hold pre-empting the game-over branch; `playResolution` already returns
   `renderGameOver()` before `beginTurn()`, so it could not. The real cause was `resolveOutcome`
   returning before `draft.turn += 1`, so the finishing state reuses its turn number and
   `net-boot.ts`'s `turn <= played` gate dropped the last resolution of **every** networked match.
   Worth noting for the next item that reasons about turn numbering: `state.turn` on a finished
   match is the turn that ended it, not one past.
5. **`MAX_AUTO_RESOLVES = 4` still has no test that reaches it** (carried from session 14 OQ #5).
## 2026-08-22 — Builder session 16 (RENDER-ON-DEMAND: the gate that said no)

The board runs at **3.3 fps** under SwiftShader — a 302ms median frame, p90 583ms, max 938ms —
because `start()` called `drawFrame()` on every `requestAnimationFrame` whether anything had
changed or not. That single fact explains the whole of the browser suite's condition: the
uniform ~3× slowdown, why tests that never render a board stayed fast, why disabling character
models changed nothing, why shadows and grain accounted for only ~25%, why two workers made it
worse, and why `boundingBox()` could time out on an element it had already resolved as
*visible* — every Playwright call queues behind a 300–900ms frame.

**The plan was staged deliberately: dirty-flag the loop behind a switch defaulting to current
behaviour, prove an idle board stops drawing, then flip the default. The proof failed.**

| mode | frames drawn over 5 idle seconds |
|---|---|
| on-demand | 17 |
| always | 14 |

No improvement, and the instrumentation says why. Over five seconds of an untouched page the
*app* issued 49 camera updates, 15 `highlight` calls, and a scattering of `focusOn`,
`drawShape` and `setUnitFacing`. The renderer is not what keeps the board busy. A loop that
skips redundant frames cannot help while something upstream keeps saying the scene changed.

**So the default did not flip, and that is the gate working rather than the work failing.** The
machinery is correct — measured directly, one `highlight()` call draws exactly one frame — and
it is a genuine prerequisite, because once the app stops re-issuing, the loop still has to stop
drawing. It ships wired, tested, and off, behind `?render=ondemand` so the app-side fix can be
measured when it lands. Turning it on today would add a wrapper and a flag for a benefit
measured at zero, which is how a codebase accumulates things nobody can later justify removing.

**Judgment call — the mutators are wrapped from a list, not marked one by one.** The failure
mode of this optimisation is a *missed* mark: one method that forgets, and the board silently
stops updating in whatever narrow case it covers. A list sits next to the interface and can be
audited in a glance by the next person adding a method; eighteen scattered `markDirty()` calls
cannot. Camera changes are deliberately absent from it because every one routes through
`applyCamera`, which marks there — including the auto-camera's own easing, which is what keeps
frames coming until it settles.

**Judgment call — pure queries must NOT mark, and this is load-bearing.** `screenPosition` is
called from the `onFrame` callback on every drawn frame (`placePreviewNumbers`). Marking it
would make every frame request another one: the optimisation would appear to be installed and
do nothing, which is worse than not having it, because the next person would have to rediscover
that it never worked.

**The next step is app-side, and it is now specific:** find what re-issues render commands into
an idle page. The counts point at the camera first — 49 marks in five seconds, against a board
nobody touched.

## 2026-08-22 — Builder session 17 (impact: hitstop, victim flash, screen shake)

The first of the five VFX steps. A hit currently reads as a number changing; these three make it
read as a hit. All three decisions live in `packages/client/src/vfx.ts` as pure functions, so the
tuning is testable without a browser and the renderer only ever executes what it is told.

**Judgment call — hitstop freezes the presentation clock, never the schedule.** `playPhase` keeps
one wall clock and one animation clock, and hitstop widens the gap between them (`heldMs`) instead
of shortening the phase. Cues therefore all still fire, in order, with their authored spacing; the
phase simply takes 35–85 ms longer per landed hit in real time. The alternative — skipping ahead
after the freeze to "catch up" — would drop frames of the very animation the freeze exists to sell.

**Judgment call — every effect scales with damage, and saturates.** `REFERENCE_HIT = 30` is the
point at which hitstop reaches `HITSTOP_MAX_MS` and shake reaches `SHAKE_MAX_TILES`. Without a
ceiling a big ultimate would freeze the game long enough to feel like a hitch, and the shake would
throw the board off screen. With one, a chip hit and a heavy hit are *distinguishable* — which is
the whole point — but neither is disruptive.

**Judgment call — the shake is deterministic per impact, seeded by `${unitId}@${t}`.** No
`Math.random()` anywhere near presentation: the same replay shakes identically on every machine,
which is what makes the film harness able to test it at all. `shakeOffset` decays to *exactly*
`{0, 0}` at the end of its window rather than asymptotically, so the camera provably returns to
where it was and successive shakes cannot accumulate drift.

**Judgment call — the shake is added to `target`, not to `centre`.** `centre` feeds the camera's
own easing; a shake written there would be eased *toward*, and the easing would then chase its own
output. Offsetting at the last moment inside `applyCamera` keeps the shake a pure display effect
with no path back into the state that produced it.

**Bug found by reading the flash path, not by a failing test.** `SkeletonUtils.clone` shares
materials between clones. The deferred-death fade already wrote `opacity` per unit and the new
flash writes `emissive` per unit, so with two Aegises on a board, one dying faded both and one
being hit lit both. Fixed by `detachMaterials` on the body clone and on each prop clone, at a cost
of one material per mesh per unit. Regression test: `test/detach-materials.test.ts`, which fails on
six of eight cases if the clone is removed.

**Known gap, stated plainly:** the flash is verified as far as the renderer call — `vfx-wiring`
proves `flashUnit` is reached with the victim's id — but *not* at the pixel. The film harness
cannot yet order an attack that lands, so filming a Blast produces no impact to photograph. The
next tooling step is teaching `film.mjs` to aim an ability at a unit; until then, no one should
claim the flash has been seen.

## 2026-08-23 — Builder session 17 (closing the flash's verification gap)

The impact work shipped with an honest hole: the flash was proven as far as the renderer call and
no further. Two changes close it, and neither is a new feature.

**The film harness now aims like a player does.** It used to click a fixed fraction of the
viewport, which on this map is empty floor — so filming a Blast produced a Blast with nothing in
it, and the effects it existed to photograph were never triggered. Nothing was broken; the camera
was pointed at the wrong thing, which is worse, because the film still looked like evidence.
`findTarget` now sweeps a coarse grid, hovering, and stops where the game offers a
`.readout.preview.damage` node — the same offer a human reads. No debug hook, nothing
special-cased for being filmed, which is the rule the harness was built under.

**`paintFlash` is extracted and exported**, for the same reason `modelBounds` and
`staleUnitGroups` were: the renderer needs a WebGL context Node has not got, so anything left
inside the factory closure can only be checked by photographing a browser. Pulling out the half
that decides what the pixels become makes it a unit test — full strength at a fresh flash, linear
decay, *exactly* black on release, no overshoot above or below, and every mesh of a rigged body
rather than only the torso. The extraction also fixed a latent gap: the old inline version read
`o.material` as a single material, so a multi-material mesh would have flashed only its first slot.

**What is now true, precisely:** the flash's decision (`vfx.ts`), its delivery (`vfx-wiring`), the
material it lands on being the unit's own (`detach-materials`), and the paint itself
(`paint-flash`) are each verified. What remains unverified is only the last inch — that the lit
material is on screen and unoccluded — which is what `render-verify` exists for.

**Not ours: `render` is red on `main`.** Every Render-verify run since #114 has failed on the base
branch, including on `d3d1797`, the commit this branch was cut from, and each burns ~60 minutes to
the job timeout. It is a pre-merge signal rather than a release gate by design (Pages gates on CI,
which is green), and RENDER-SUITE-GREEN-2 is already specced with the Analyzer. No changes pushed
for it from here.
## 2026-08-23 — Builder session 17 (the render suite's hour, and where it actually went)

Written after merging the entry below, which fixes the same root cause from the other side. That
entry has the ease right and this one does not repeat it. What follows is only the part it does
not cover: *why the browser suite in particular was paying for it*, and the one change still needed
to stop.

**The suite's cost was never the render — it was `page.screenshot` waiting for one.** A screenshot
cannot return until the compositor hands it a frame, and a board that redraws unconditionally makes
that wait enormous. Measured on this scene:

| page | screenshot |
|---|---|
| blank page, no canvas | 40 ms |
| board, render loop drawing | **2200 ms** |
| board, rAF loop cancelled outright | 165 ms |

Nearly every test in `render.spec.ts` is a sequence of screenshots, so the whole suite ran at that
price and the long ones crossed their 60s budget. All seventeen failures were timeouts; not one was
a failed assertion. That is the whole of RENDER-VERIFY's red since #114, and the hour per push.

**The ease fix alone does not collect on it, and this is the trap.** `renderOnDemand` is still off
by default and the e2e fixture did not ask for it, so the loop draws every frame whatever the dirty
flag says. Measured after the ease fix: `always-draw` still ~2200 ms a screenshot; `ondemand`
~165 ms. A settled camera saves nothing if nobody is checking whether the scene settled. So
`e2e/fixtures.ts` now attaches `render=ondemand` alongside `ambient=off` and `models=off` — the
suite's third "hold still" flag, and the one that makes the other two affordable.

**Judgment call — the flag goes on for the browser suite, not for the shipping game.** The ease fix
is a straight bug fix and applies everywhere. Flipping the product default is a separate question
that wants its own measurement on real hardware, where a frame is cheap and the tradeoff is
different. The suite is where a 2.2s frame is costing something today; that is where it is turned
on, and the product default is left for the owner.

**Judgment call — a duplicated `stepCamera` call was repaired in this merge, not reported and left.**
Merging the two independent camera fixes produced `stepCamera(); stepCamera(delta);` on adjacent
lines — textually clean to git, invalid to `tsc`, and the same class of break as the `boardSpan`
merge that took main down at #119/#120. Worth naming again: two sessions editing one function is
exactly when a clean merge means least.


## 2026-08-22 — Session 17 (Builder): the camera ease was denominated in frames, not seconds

The previous entry ended by pointing at the camera and guessing the culprit was app-side. It was
not. Per-call-site instrumentation over five seconds of a genuinely idle board attributed 59 of
the ~90 dirty marks to a single line: the `applyCamera()` inside `stepCamera`. The other eight
camera call sites contributed seven marks between them.

**The ease was not broken; its unit was wrong.** It closed a constant fraction of the remaining
distance *per frame* and stopped at a 0.002-square threshold. From a typical `focusOn` delta that
is 62 frames of travel — a pleasant 1.0s glide at 60fps, and a **five second** one under
SwiftShader at 12fps. Under RENDER-ON-DEMAND that is worse than slow, because each of those
frames is one the ease itself requested: the renderer paid for its own slowness twice, once in
the frame and again in the extra frames the frame's duration bought. It also explains why the
on-demand gate measured no benefit at all when it landed — the machinery was correct and the
camera simply never stopped asking.

**So the ease is time-based.** `EASE` still means "fraction closed per 1/60s", but a frame that
took four times as long closes four sixtieths' worth. A glide takes the same wall-clock time on
any machine, which is what a player wants independently of any of this, and is the whole of the
fix. It lives in `packages/client/src/camera-ease.ts` rather than in the renderer because it
needs no `three` and therefore can carry a test — and this is precisely the kind of arithmetic
that should not be re-derived by reading a GL file.

**Judgment call — it snaps, and the settled test is exact equality.** The old threshold returned
*without assigning*, so the camera parked a hair off its target permanently and every later frame
had to re-establish that it was close enough. Landing exactly on the target makes "settled" an
exact-zero comparison that cannot drift, and lets a settled camera return `undefined` — no pose,
no `applyCamera`, no dirty flag. The snap distance of 0.01 squares is a quarter of a screen pixel
at the default framing; it buys about ten frames off a tail where the camera is provably not
moving on screen but is still redrawing to say so.

**Measured, on `?map=iron-basin&render=ondemand`, before and after, same build pipeline:** idle
frames across five seconds went 20 → **0**, and frames from load to settled went 54 → 11. The
board is byte-comparable to the always-render build apart from the DOM countdown.

**This is also the right shape for the panning camera.** A player-driven pan already bypasses the
ease entirely (`orbitOn` returns early) and marks dirty per pointer event, which is exactly what
on-demand wants: frames while the hand moves, none after it stops. The frame-denominated ease
would have made a *player's* pan feel slower on a slower machine too; that bug is gone with the
same change.

## 2026-08-23 — Session 17b (Builder): on-demand rendering is the default now

The gate set in session 16 was "prove an idle board stops drawing, then flip". With the camera
ease fixed, the proof holds — 0 idle frames across five seconds, down from 20 — so the flag flips
and `?render=always` becomes the opt-out.

**The full browser suite, which is the number that mattered:** ~40 minutes with 10 failures →
**9.3 minutes with 2**. Eight of the ten failures were timeouts, not assertions; they dissolved
because a 60-second limit stops binding when every Playwright call is no longer queued behind a
300–900ms frame.

**The two survivors are pre-existing, and this was verified rather than assumed.** Both were re-run
with `?render=always` and failed identically, which is the whole reason the opt-out was kept: the
failure mode of this optimisation is a *missed* `markDirty`, and "does it still happen with
`?render=always`?" is the single question that separates one from a real rendering bug. It answered
that question on its first use. Both failures are in playback (`.hud-playback` never becoming
visible), and they are now the honest top of the e2e list rather than being lost among eight
timeouts.

**Judgment call — an unrecognised `?render=` value keeps the default.** `renderOnDemand` opts out
on `always` and on the `off/none/0/false` vocabulary the other two flags already use, and returns
the default for anything else. A typo in a debug flag should not silently hand a player a 3.3 fps
board, and the asymmetry is deliberate: the old spelling failed *closed* (any typo left it off,
which was then the safe state), and the new one must fail *open* for the same reason.

## 2026-08-23 — Builder session 17 (the last two red tests were races, not bugs)

With the camera ease fixed and `render=ondemand` attached, the browser suite went from 17 failed /
17 passed in 59.7 minutes to 2 failed / 32 passed in 9.9. Both survivors turned out to be races in
the tests, and both had been failing on `main` all along — hidden behind timeouts, and only legible
once the suite was fast enough to lose them differently.

**A readout that was there all along, watched too late.** `a resolved turn animates` polled for
`.readout` *after* a two-screenshot frame comparison. A screenshot of an animating board waits
~2.2s for the compositor — legitimately, the board really is redrawing — so the poll began at
~4.8s. Instrumenting the DOM through a whole resolution shows the number floats from ~1.4s to
~2.9s, during Blast. The test was failing for the one thing it was not testing: that it arrived
late. It now starts a `waitForFunction` at the first frame of playback and awaits it after the
comparison — in-page, concurrent, free, and impossible to outrun.

**Judgment call — the watch tightened to `.readout:not(.preview)` while it was being moved.** The
old selector also matched plan-time preview numbers, so an assertion about *resolution* could have
been satisfied by a number the planning phase left on screen. Nothing was relying on that; it is
strictly a stronger test.

**A check-then-act race against a control that removes itself.** `STEALTH-CONFIRM` did
`if (await skip.isVisible()) await skip.click()`. Playback can end in the gap, and Playwright then
spends the entire 60s budget waiting for an element that is never coming back — reported as a click
timeout, which reads like the Skip button is broken rather than like the turn is already over. One
`click({ timeout: 5_000 }).catch(() => {})` says the real intent: skip the resolution if it is
still running, and finding nothing to press is success.

**Correction, recorded because the wrong version was stated out loud first.** While chasing this I
reported that Move playback hangs forever. It does not. The probe asked
`document.querySelector('.hud-playback') !== null` — but that element is built once at boot and
always exists — and read `.phase-label.textContent`, which keeps its last value after the label is
hidden. Both are true forever regardless of playback. The Playwright suite uses `isVisible()` and
was right; the probe was wrong. Instrumenting the playback clock settled it: the move phase reaches
`t >= end` and resolves normally, 26 ticks and ~6s for the whole turn. Worth writing down as the
shape of the mistake: a presence check against a container that is never removed proves nothing,
and it fails in the direction that looks alarming.
## 2026-08-23 — Session 17c (Builder): the last two e2e failures were the tests, and the suite is green

With on-demand rendering on, two failures survived. Both were re-run under `?render=always` and
failed identically, so neither was a missed `markDirty`. Both turned out to be the tests
mis-observing a correct app, and in both cases the mistake was **treating a point-in-time sample
as if it held**.

**`a resolved turn animates…` could not have passed on this runner.** Measured with a DOM-only
poll that takes no screenshots: playback lasts ~7.2s, and UI5's readouts exist only between ~4.4s
and ~6.7s of it — a 2.3 second window. A screenshot of an *animating* board costs ~3.5s under
SwiftShader, because the compositor cannot hand one over until it has a frame and the board is
redrawing every one. The test took two of them and *then* began polling for readouts, so the poll
started at ~8.1s against a window that shut at 6.7s. Not flake: it could not observe a readout on
any run, at any speed, because the observation it depended on was scheduled after the thing it
was looking for had gone.

The fix is to record the readout's **insertion** with a `MutationObserver` installed before the
window opens, rather than sampling for its presence after. That cannot miss a node that lived
between two samples, costs nothing while the screenshots block, and removes the ordering
dependency entirely rather than re-tuning it.

**`STEALTH-CONFIRM` was a check-then-act race.** `if (await skip.isVisible()) await skip.click()`
samples visibility, and playback ends on its own clock — so between the sample answering yes and
the click starting, the row can hide, at which point `click()` auto-waits for it to return for
the full 60s timeout. The button vanishing *is* the outcome the click was for, so it is now a
bounded `click({ timeout: 3_000 }).catch(() => {})`. Grepped: this was the only instance of the
pattern in the suite.

**The browser suite is now 34/34 in 7.5 minutes**, from 10 failures in ~40 minutes three commits
ago. Worth stating plainly why the ordering matters: eight of those ten were timeouts that the
rendering work dissolved, and only once they were gone was it possible to see that the remaining
two were never about rendering at all. A slow suite does not just cost time — it hides which of
its failures are real.

## 2026-08-23 — Builder session 18 (the flash, photographed — and the test that did not test it)

The flash shipped with an admitted hole: proven as far as the renderer call and no further. It is
closed now, and closing it was more interesting than expected.

**The flash is longer: 0.08s → 0.18s.** The owner's read of it in the running game — "too short".
Five frames at 60fps registers only if you already know to look, and the flash's whole job is to
catch an eye that is somewhere else on the board. At 0.18s it is ~11 frames, still an event rather
than a glow and still well inside a beat, so a four-shooter Blast reads as four distinct hits. The
guard test now pins the *bounds* (0.1s to half a beat) rather than the value, so the next person to
tune it is told what the range is for.

**The instrument had to be the virtual clock.** A flash is 0.18s; a screenshot of an animating
board waits ~2.2s for the compositor. The shutter is twelve times slower than the subject, so
sampling for it is not a flaky test but an impossible one. Freezing the page's clock inverts it:
between steps nothing moves, the render loop idles, and the same screenshot costs ~0.17s and shows
exactly the millisecond asked for. `tools/virtual-clock.js` is now shared by path between
`film.mjs` and `e2e/vfx.spec.ts` rather than copied — two clocks that drifted apart would make a
film and a test disagree about the same frame, and the one that was wrong would be whichever
nobody had looked at recently.

**The first version of the test passed with the feature removed.** Stubbing `paintFlash` to never
light anything left it green. Twice, for two different reasons, both worth writing down:

1. **The readout is DOM.** UI5's floating damage numbers live inside `#board`, are near-white, and
   appear at exactly the moment of impact — so "the board got brighter when the hit landed" was
   satisfied by the number, not the flash. The measurement now hides every non-canvas child of
   `#board`, so the renderer is the only thing that can move the count.
2. **A peak is not a spike.** Comparing the brightest frame to the median passes on a build with no
   flash in it, because the phase *ends* with the board brightening as the camera pulls back. What
   is specific to a flash is that a frame is brighter than the frames on **both** sides of it: it
   arrives and leaves inside the window, which a camera move and a phase change do not.

**And the signal had to be aimed.** Whole-board counts could not see it: one lit unit is a few
hundred pixels of 1400x950, smaller than the jitter the screen *shake* puts into the same count.
Cropping to 320px around where the hit was aimed, at full sample density, makes those pixels the
majority of what is measured. With that framing the two builds differ at exactly one frame and are
byte-identical everywhere else — impact frame 4595 against 3215, a rise above both neighbours of
1458 against 78. The threshold is 800: 1.8x under the real signal, 10x over the noise.

**The general lesson, and it is the second time this session:** a green test proves nothing until
it has been run against a build with the feature removed. Both of this one's false positives were
invisible from the code and obvious from the mutant.
## 2026-08-23 — Session 18 (Builder): CAMERA-CONTROLS, and the clamp that was quietly defeating it

`BACKLOG.md`'s top item, from the owner's note: *"Need to add Camera panning and the auto camera
center should be on the character, not the board."*

**The pan gesture is the middle button, and that is the only binding that moves.** Middle and
right did the identical thing — both orbited — so orbit loses nothing a player can notice, while
every alternative took something real. A modifier+drag would have collided with Shift-click's
move route (WAYPOINTS-FIX); the wheel is zoom; taking the right button would have been an actual
change to orbit rather than a nominal one, and the backlog puts that out of scope. The projection
maths lives in `camera-pan.ts` with no `three` import, so the property that matters — *the tile
you grabbed stays under the pointer, at every yaw and pitch* — is a unit test rather than
something you can only find by feel.

**The auto-centre change was almost a no-op, and finding that out is the substance of this
entry.** Pointing `focusOn` at the selected character instead of the roster centroid moved the
camera by **one square** on Duel Arena 4v4 (9,8 → 8,8) and not at all on 2v2. `clampToBoard`
required the whole frustum to sit inside the board rectangle, and since BOARD_ZOOM the frame is
*tighter* than the board — about 15 columns of 21 — so the centre could only ever travel ±3
columns from the middle. A character on a spawn rank stayed pinned against the frame edge. The
frame still read as "the board", which is precisely the complaint the note was making. Shipping
the one-square version would have closed the item without doing the thing.

**So the clamp changed from being about the frame to being about the centre: it may reach any
square on the board and no further.** That is `BACKLOG.md`'s stated requirement — *the board never
leaves the frame entirely* — said exactly, since the square under the middle of the screen is
always a board square. Duel Arena 4v4 now frames at (3,7) with the seat's four characters fully
visible instead of clipped against the left edge.

**Judgment call — the old clamp's justification had expired.** Its comment said an unclamped
camera "shows a band of void next to half a board", and that was fair when it was written: the
space past the last rank was black nothing. Phases 1–3 of `MAP_PIPELINE.md` put a lit platform,
a rim and a sky gradient out there. What the camera now shows past the edge is the set, not an
error — and the cost is real and visible: on Duel Arena the left fifth of the frame is arena slab.
That is the trade the owner's note asks for, and it is one number to dial back (`clampCentre`'s
`margin`, where `Infinity` restores the old rule exactly and is tested as doing so).

**One test moved, and only after measuring that the behaviour had not.** FOG-ZORDER asserts
`bestCovered > brush.length / 4` — a quarter of *all brush pixels the camera happens to show*.
Reframing changed that denominator and it failed at 1274 against 1518. But its sharp assertion,
`bestAimed > 20`, measured **1034**: the aim overlay is compositing over brush exactly as it
should, and the z-order property the test exists for is intact. A denominator that depends on
framing is not a statement about z-order, so it is restated in absolute terms.

**Also worth writing down: a screenshot-equality check is not a valid instrument here, and I
nearly mis-diagnosed my own clamp with one.** A probe comparing two frames after shoving the
camera into the edge reported "not clamped"; reading the camera's actual centre square showed it
saturating at (7,7) and staying there across four more shoves. `BACKLOG.md` already records why —
temporal AA jitters ~2.7k of 205k pixels frame-to-frame with no input at all. The centre is the
instrument; the pixels are not.

### Session 18 addendum — what the framing change cost the browser suite, and the two it is still costing

Re-aiming the planning camera broke four browser tests, and every one of them broke the same way:
**the instrument moved with the camera.** These drives navigate and measure by *screen* coordinates,
which meant "somewhere on the board" only while the camera framed the board. Two are fixed, two are
not, and the two that are not are worth naming precisely rather than leaving as "flaky".

**Fixed — `closeTheDistance` (the chase and last-known drives).** It clicked the middle of the
screen to walk a seat toward the enemy. That is now the character's *own tile*, so a Sprint ordered
there moved nobody: measured across eight turns and four seats, every unit still on its spawn.
Naming the board's middle square instead does not work — it is further than a Sprint reaches, and an
order beyond the budget is not taken at all rather than walked partway. Deriving the character's
tile from its pixels is exact and costs a screenshot per seat per turn, which turned the drive into
a timeout. What works is the cheap thing the feature itself makes correct: the character is at the
middle of the frame, so a click a fifth of the way toward the enemy's side is a few squares in the
right direction at any zoom. The drive now closes the distance in two turns instead of never.

**Fixed — FOG-ZORDER.** Its coarse assertion was a fraction of *all brush pixels on screen*, which
is a statement about framing rather than about z-order. Restated in absolute pixels, plus a new and
sharper ratio check: of the brush pixels something drew on, the aim overlay must own most of them.

**Still red — `a resolved turn animates…` and MOVE-SPRINT-FIRST.** Both drive several turns by
screen fraction and both need the same treatment; MOVE-SPRINT-FIRST additionally compares blue
*bodies* before and after a Sprint, which a character-following camera defeats by construction — the
unit walks four squares and lands on the pixels it left. It hits its own 150s cap.

**A change I made and reverted, because I made it for the wrong reason.** A character switch could
reasonably *cut* rather than glide — it is a deliberate act with a destination, and the ~0.85s ease
is both slower to read and, since every frame of a glide is a redraw, measurably more expensive
(a screenshot of a moving board is ~3.5s against ~0.17s for a still one). But I reached for it to
fix a timeout rather than because a player had asked, it did not fix the timeout, and it broke a
third test. Changing how the game feels to make a test pass is the wrong trade, so it is out. It may
still be a good idea on its own merits, and if so it should arrive as its own change with its own
argument.

**Open question for the owner, which the backlog does not settle.** Centring on the selected
character means the seat's *other* character can be off-screen — on Duel Arena's 4v4 spawns they are
in one column and both stay visible, but that is a fact about those spawns rather than a guarantee.
The note asked for the character rather than the centroid, and that is what is implemented; whether
a player planning for one character wants the other in frame is a real design call and not one to
make from a test failure.

## 2026-08-23 — Session 19 (Builder): the last two red tests, and a quadratic that had been waiting

Both survivors of CAMERA-CONTROLS are fixed, and neither was the camera's fault in the end — the
camera only moved the conditions under which two pre-existing weaknesses stopped being survivable.

**The readout drive was passing on an accident.** It aimed each seat's first ability at a fixed
screen fraction, 0.78 across. The teams spawn **thirteen** squares apart with abilities that reach
about eight, so no turn-1 shot can cross the map — what was actually happening is that 0.78 landed
on the *enemy pair's own tiles*, and the log the test then asserted on read "Bastion hit Aegis":
two units on the same team, catching each other in a blast. Re-aiming the camera at the character
being planned for made that fraction land nowhere at all; measured, two of the four seats aimed at
a point `squareFromPoint` resolved to **null**, off the board. So the aim now names a body on
purpose — the furthest blue body from the frame centre, which under a character-centred camera is
the teammate, and a teammate two squares away is the one target certainly in range on turn 1. Four
readouts and two logged hits, deterministically, instead of an accident that held for a while.

**MOVE-SPRINT-FIRST was not hanging on the game.** Driven by hand, the whole flow — arm Sprint,
order, lock four seats, watch playback, HUD returns — takes **13.9 seconds**. The test was hitting
its 150s cap before it got there, and the timing said where: `pixels()` 187ms, and
`blueBodies()` **135,954ms**.

`largestCluster` was quadratic, by a decision its own comment recorded: *"small frames, so the
quadratic scan is cheaper than building an index."* It also rescanned the whole unvisited set,
spread into a fresh array, for every point of every blob. That bet was sound while the frames were
small; centring the camera on a character near a spawn rank brought much more of the team-coloured
spawn edge into view, the blue point count rose, and the cost went with it. Bucketing the points by
the neighbour gap so a flood fill only looks at the nine cells around a point takes the same call
to **331ms** — a 410x difference, on an algorithm nobody had reason to look at until the framing
changed. The frames were never guaranteed small; they had only been small so far.

**Found and not fixed: `blueBodies` counts furniture.** Measured blob extents on the default 2v2
board: the two characters are 60x192 and 54x186, and alongside them sit three identical 92x110
blocks — the spawn-edge markers, which are drawn in the team's own colour and therefore satisfy
`isTeamBlue`. This is the exact hazard `SCENERY`'s rim comment already records ("a bright arena edge
lands inside one of those families however its hue is chosen, and then 'team 0's units are on
screen' is satisfied by the furniture"), arriving from the one direction that was not guarded. It
weakens BODY-CLICK's premise — `before.length > 1` can be met by markers — without failing anything
today. The fix is the established one, dimming the markers out of the family, and it is a
production visual change that should not be made blind at the end of a long session.

**The JS budget: 300 kB -> 350 kB, on the owner's call, chosen rather than rounded.** The original
300 was "roughly 2x" a 145 kB bundle, with the stated fix on breach being to code-split rather than
to raise. Honest growth to 235 kB had turned that margin into 1.27x. 350 keeps the guard real
because the failure it exists to catch has a size: a second copy of `three` is ~145 kB gzipped,
which from 235 lands at ~380 — over 350, under 400. The budget still fails loudly on the one
mistake it was built for while leaving 115 kB for deliberate growth. It cannot be raised twice by
this reasoning; at ~280 kB there is no number that both clears the code and catches a duplicated
three, and the answer then is the renderer split the original note named.
## 2026-08-24 — Builder session 19 (tracers: the shot crossing the gap)

VFX step 2. A hit used to teleport — the ability played, and a beat later the victim flashed, with
nothing crossing the gap for the player to connect.

**Nothing new was scheduled for it.** `choreograph.ts` already puts an `ability` cue at `t` and
binds its impacts to `sourceUnitId` at the end of that beat, so a hit belongs to the ability that
caused it (A0). That binding *is* the flight window; `tracer.ts` reads it rather than inventing a
parallel timeline. Pairing is on `sourceUnitId` **and** `abilityId`, and to the LATEST qualifying
cast: a unit with two abilities in one phase otherwise dates its second shot to the first cast — a
tracer that leaves before the gun does.

**The geometry is in the pure module, not the renderer.** What reaches `drawShape` is a quad in
fractional board coordinates, which is what it already takes for an AoE footprint — so a tracer
needs no new drawing primitive, and every decision about where the streak is and how long it runs
is arithmetic a Node test can check. The only renderer change is a lift: every other shape layer is
a *footprint* and belongs flat on the floor, while a tracer is the one that describes something in
the air, and at `SHAPE_LIFT` it ran under the feet of both units as a scorch mark.

**Every constant here was measured off a filmed Blast, and the first set was wrong.** At
`STREAK_TILES = 0.9` and a half width of 0.055 the streak came out **9x46 screen pixels** — legible
in a difference image, invisible to anyone watching the board. It also emerged from Aegis's waist
and was cut in half by his own legs, because a line from centre to centre spends its first half
tile inside the model. Hence `MUZZLE_TILES`, held back at *both* ends: the far end too, so the
streak stops short of the victim rather than burying its head in the unit at the moment the flash
is trying to own.

**`MIN_FLIGHT_TILES` is a stand-in and should be replaced.** Below 1.6 tiles nothing is drawn,
which excludes orthogonal (1.0) and diagonal (1.41) neighbours. The honest version of this belongs
in the per-ability VFX table: a melee ability should *declare* that it has no projectile, rather
than being filtered out by how far apart its two units happened to end up. Shield Bash is a cone at
range 2 and draws no tracer today for the second reason, which gives the right picture for the
wrong cause.

**Verified in three places, and the middle one is the one that keeps being skipped in this lane:**
`tracer.test.ts` for the geometry, `TRACER-WIRING` for the call actually reaching the renderer
(mutation-checked: stubbing the draw fails it), and a filmed Blast differenced against a build with
the draw stubbed out, which shows the streak growing over ~19 frames of the beat and then handing
over to the flash. The wiring test had to move to a RANGED ability to keep meaning anything —
`duel()` stands its two units adjacent so a melee cone connects, which is now correctly no tracer
at all.
---

## 2026-08-23 — Builder session 16 (RENDER-SUITE-GREEN-2)

**CAMERA-CONTROLS was built twice, and this branch is not the copy that shipped.** A parallel
session implemented it as `eb48811` and it reached `main` through PR #146 while this branch was
building its own. Merging `main` in produced files that no longer parsed — two independent
implementations of the same feature interleaved into the same declarations with no conflict
markers, which is the one merge failure git cannot flag. The resolution was to take `main`'s
implementation wholesale and drop this branch's: `main` is the source of truth, its version is
complete (and carries a `hold: 'frame' | 'centre'` mode this one lacked), and it covers the
"recentre affordance" by making the existing view button double as recentre while panned rather
than adding a button. Re-litigating a merged feature in an unrelated PR would be the worse error.
**The process finding is the useful one: two sessions took the same top-priority item off the
backlog at the same time, and neither could see the other.** That is the Analyzer's to solve, not
the Builder's — recorded here because the cost was a full session's work.

**RENDER-SUITE-GREEN-2 — `same()` is kept and narrowed, not replaced.** The measurement behind
the old doc comment (~2,674 of ~205,000 pixels differing on an untouched board, deterministic and
input-independent) was taken under the always-draw loop. RENDER-ON-DEMAND fixed that at the
source: a board with nothing to draw does not draw, so a still scene is byte-identical again. But
that is a property of the render loop, not of the assertion, so the split is by **what is being
claimed**: a claim about the whole scene (it animated, the orbit moved it, it held still) is
byte-equality's, and a claim about one overlay is `aimPatch`'s centroid. Comparing frames for an
overlay asks 205k pixels a question about a few thousand and answers it with whatever else moved —
which is how UI1-fix came to accuse the aim of following the pointer when it was not. `main`'s own
comment on `same()` called for exactly this and called it "a re-spec, not a repair"; this is that
re-spec.

**AMBIENT-FREEZE's guard is a real test for the first time.** It could not have worked before:
under the always-draw loop "the scene is still" and "the scene is moving" were both "different", so
a guard built to catch the first piece of ambient motion would have fired on the bare board. It now
asserts that a settled board with ambient off draws the same frame twice, and the first moving prop
(MAP_PIPELINE phase 5) will break it unless it is gated on the flag — which is the entire point.

**Judgment call — FOG-ZORDER's coarse floor is restored, and the fix is in the search.** Both
copies of this test hit the same failure and diagnosed it differently. `main` read it as the
denominator growing under a reframed camera and dropped the floor from a quarter of visible brush
(1742 px) to an absolute 200. The measured cause is narrower: the sweep stopped at the first
candidate that landed *any* aim-orange, which froze `bestCovered` at whatever that one ability had
washed. Rail Shot is a line — 1355 covered on its first hover — while the Frag Grenade behind it
washes 4423 of 6970 (63%, comfortably clear) and was never reached. So the fraction was never the
problem; the search was. Sweeping until *both* floors are met keeps a floor that a real z-order
regression (which puts the number at zero) still trips, at roughly nine times the strength of an
absolute 200.

**Judgment call — `main`'s ratio assertion is kept, but measured per frame.** `bestAimed /
bestCovered` divides two independent maxima that can come from different abilities and different
hovers, so it only looked like a ratio. Tracking the best *within-frame* share instead makes it the
framing-independent check it was meant to be, and it is the sharpest of the three: FOG-ZORDER drives
it to zero however the board is pointed.

## Open Questions for the Analyzer — 2026-08-23

**1. Two sessions built CAMERA-CONTROLS simultaneously.** Nothing in the workflow prevented it and
nothing surfaced it until a merge produced unparseable files. Worth a mechanism — an in-progress
marker in `BACKLOG.md`, or assigning items per session — before it happens on an engine item, where
the merge would be silent rather than syntactic.

**2. `main`'s FOG-ZORDER floor was weakened to 200 and this PR restores it.** If the Analyzer
prefers the absolute floor, this is the place to say so; the two are not compatible and the stronger
one is now in the branch. Flagging it because it edits a test another session had already "fixed".

**3. Three `same()` callers remain, and they now rest on an unwritten invariant.** The ambient guard
and the two motion assertions all depend on RENDER-ON-DEMAND holding a settled board byte-identical.
That is true today and measured, but it is not an invariant anybody has named, and the first missed
`markDirty()` turns those three into confusing failures rather than clear ones. `?render=always` is
the diagnostic; whether the invariant deserves its own test is the Analyzer's call.

**4. No engine work this session, as instructed.** Every change is in `packages/client`.

## 2026-08-24 — Builder session 20 (Aegis's own light, and Intercept as a blink)

VFX step 3, and the first character identity to reach the screen.

**`data/vfx.json` is the table, and the tracer default is deliberately asymmetric.** An ability
with no entry gets **no aura** but **keeps its tracer**. An aura is identity — a placeholder one on
every unstyled ability would make the roster look finished and hide which characters nobody has
designed yet, so absence should be visible. A tracer is legibility, it says a shot crossed the
board, and it shipped for the whole roster last session; defaulting it off would have quietly
deleted a feature from eight characters as the price of styling one. The wiring test caught that,
because Vex has no entry.

**The palette is copied from `data/art/aegis.json`, not imported, and a test holds the copy
honest.** That file is an art *source* — thesis, build, garment, face — and has no business in the
browser bundle. `VFX-PALETTE-MATCHES-ART` asserts the three tones agree, so the duplication cannot
drift.

**`warmthForbidden` is enforced for the first time.** "Never warm. A paladin's light is given to
him; Aegis forces his." has sat in his art data since he was authored, unenforceable — the kind of
intent that erodes the first time somebody picks a colour by eye. `isWarm` judges hue, and only
once saturation makes hue mean anything: his palette is desaturated green-grey, and a near-grey has
a hue the maths reports and the eye cannot see.

**Intercept blinks, and the engine cannot tell us so.** `resolve.ts` teleports the caster and emits
a plain `moveStep` — the identical event a walk emits — so playback interpolated it and Aegis
crossed five squares at walking pace. The one reading of a teleport that is definitely wrong is the
one that says he ran. `isBlink` is therefore geometric: a walked step is always to a touching
square, so anything further is a teleport. **The gap this leaves is real:** an Intercept landing on
a square adjacent to where he stood is indistinguishable from a step and will slide. Closing it
means the event saying so, which is an engine change and the Builder's call.

**A ring needs a real hole; a keyhole does not work.** Tracing the inner circle back along the same
outline is the classic trick and it was tried here first — ear clipping fills it straight in and
the "ring" comes out a disc. Filmed and differenced against a stubbed build, the centre row read as
one solid run. `Shape.holes` is what Three provides, so `drawOneShape` takes an optional hole and
the same measurement now reads **14px band, 54px gap, 14px band**. Worth the trouble: a filled
circle is a wash sitting under the unit, where a band reads as something leaving them, and the
empty middle stops the aura greying out the character it exists to draw attention to.

**Verified by mutation, first rather than last, on both new paths.** Stubbing `drawAuras` fails
`AURA-WIRING`; disabling the blink branch fails `BLINK-NEVER-BETWEEN`, which samples the whole beat
and asserts he is only ever at one end or the other.

**Not seen on screen: the blink.** The film harness aims by sweeping for a damage preview, and
Intercept targets an ally, so it produces no such preview to aim at. The unit tests are strong and
the aura path is filmed, but nobody has watched Aegis actually blink. Teaching the harness to aim
at an ally is the next tooling step.

## 2026-08-24 — Builder session 21 (auras that read, and a wall that stands)

Both from the owner's eye on the running game: the auras were technically on screen and practically
invisible, and only Warding Halo registered.

**The fade envelope was backwards.** Opacity ran `peak * (1 - p)` from the moment the ring was
born, and the radius ran `0 → full` over the same window — so the ring was at its *brightest* when
it was at its *smallest*. A bright dot and a broad ghost, never both bright and broad. It now holds
full strength through the first 55% (`AURA_HOLD`) and is born at 40% of its radius
(`AURA_BIRTH_RADIUS`), so it arrives already readable and the fade reads as dissipation rather than
as never having been there. Peak opacity 0.5 → 0.85, band thickness 0.34 → 0.45, and the per-ability
radii roughly doubled. Measured against a build with `drawAuras` stubbed: the peak aura frame went
from **1,187 differing pixels to 19,292**, about 16x.

**Warding Halo was the one that worked, and that was the clue.** It is the ability with the big
radius; nothing about it was better tuned. Scaling the rest toward it was the whole fix.

**The wall is the first vertical thing on this board that is not a unit.** Drawn flat, a wall is
four hazard markers — "these tiles hurt" rather than "there is a thing here". It is deliberately
see-through (the board behind it is information, and a solid slab hides a unit) and it stops
nobody, which is what the ability is: anyone who charges through takes 25 and is Slowed. The panel
runs from the OUTER edge of the first square to the outer edge of the last, not centre to centre —
a face that stops at the middle of the end tiles leaves half a tile of gap at each end that a player
would reasonably read as a way past.

**Two sources, because neither covers the whole life.** While it is cast, the squares come from the
`ability` cue's own `area`. Once it stands, from the traps — `TrapState` carries the `abilityId`
that laid it, which is how a wall's tiles are told from an Overwatch Trap's. The view was simply
dropping that field. **`trapPlaced` does not carry it**, so a trap folded from the event log has no
ability and raises nothing; adding it to the event is an engine change and the Builder's call. That
is why the cue-driven source exists rather than being redundant.

**Contiguous runs, not one panel per board.** Two walls can stand at once — the same Aegis on
consecutive turns, or two of him at 4v4 — and treating every wall tile as one set draws a single
face stretching between them, straight through whatever is in the way.

**The film harness can only aim at things that bleed.** Its sweep hunts for a damage preview, which
is right for anything that hurts somebody and useless for the rest of the kit: Warding Wall goes on
the ground and Intercept goes on an ally, and neither offers a number to aim by. `--aim fx,fy` names
a square outright. Finding a legal one still took five tries — a wall needs a square in range with
room to stand — which is worth knowing before the next ground-targeted ability gets filmed.
