# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js); every client item consumes
`TurnEvent[]` and the engine's derived queries (vision, reachability) — never recomputes them.
**Movement is Manhattan (MET1); aiming is Euclidean (AIM-METRIC).** **Open/update a PR to `main`
every session** (CLAUDE.md).

## ✅ COMPLETE

- Engine core, teams/formats, movement, FF1, AIM2, RND1, A0(+heal), A1–A3, UI1–UI6, D1(+dash),
  MET1(+tp), BRUSH1, TT1, C1, MS1, R1–R7, MOVE1, HITBOX1, VISION1(+opening), MAPTOGGLE,
  CI-decouple, AIM-METRIC, CONE-B, CIRCLE-FIX, DASH-IMPACT, FREE1, CAT1, CAT2, PREP-AOE,
  VALIDATE-KEYS, FREE-UI, DECOY-RENDER, STATUS-AUDIT(+UNTGT1, +`statusRemoved`), FOG-ZORDER,
  DASH-PREVIEW, PREVIEW-NUMBERS, CAT-DASH-COST.
- **PR #39 (this review):** **AIM-RANGE** (range envelope on every aimable slot + refuse
  out-of-range clicks), **DASH-CAT-ROUTE** (Shift draws a yellow route), **PREVIEW-FOG** (previews
  gated by team vision), **TRAP-INDICATOR** (traps drawn, fogged by team vision), **CAT-COST-LABEL**
  (Dash "costs Move" / Prep+Blast "free"), **LOG-STATUS** (`statusRemoved` in the combat log),
  **STEALTH-CONFIRM** (render path proven correct — and surfaced the Stealth-duration bug below).

Current suite: **830 tests** (engine 479 + client 351), typecheck + build clean, purity green.

> **This batch is a VISION / STEALTH pass** on the owner's new vision rules + one Dev Note Ruling.
> STEALTH-CONFIRM proved the decoy/stealth *render* is correct but caught that Wisp's Stealth value
> makes it unobservable — fixed by the owner's ruling. The rest folds in fog-of-war fidelity
> (last-known ghosts, the camouflage reveal penalty) and pins the dash-onto-occupied rule.
>
> **Unchanged in scope from 2026-08-30 — the Builder has not run since.** Review 2026-08-31 is a
> spec-verification pass that found five defects in these Spec Notes (wrong ability id, a
> shipped-behaviour reversal nobody asked for, a `Vision` dependency the resolver does not have,
> a wrong file pointer, and an AC naming an e2e that does not exist). All five are corrected
> below. **Read the corrections — the uncorrected drafts would have cost a broken test suite and
> a pointless plumbing change.**

### Build order and dependencies

Four items, one session. They are **independent** — nothing here blocks anything else — so the
order is by cost and by what unblocks playtest soonest:

1. **STEALTH-DURATION** (data, one line) — first, because it unblocks Wisp playtest immediately
   and because it *inverts an existing test file*, which is cleaner to do on a quiet tree.
2. **CAMO-REVEAL** (engine + client) — the engine half and the red-tile client half land together;
   splitting them ships an invisible rule change.
3. **DASH-OCCUPIED** (engine tests + client) — parts (3) and (4) both live in `commitAim`, so they
   are one commit; part (1) is tests-only; part (2) is the deferrable one.
4. **LAST-KNOWN** (client) — last, the largest piece, and the only genuinely new stateful code.

**Shared surface to watch:** DASH-OCCUPIED (3)(4) and the AIM-RANGE gate are the same function
(`commitAim`); CAMO-REVEAL's red tile and LAST-KNOWN's ghosts are both new render styles — reuse
the TRAP-INDICATOR plate/overlay-band pattern rather than inventing a third.

---

## Data (do first — one line, unblocks Wisp playtest)

### STEALTH-DURATION. Wisp's Stealth lasts one turn after the cast (DATA) — UNBLOCKED (first)
**Addresses Dev Note Ruling: "Veil & Decoy effects, Stealth/Decoy should last one turn AFTER the
skill is used. Make whatever changes needed to make this happen in the spec."** Stealth ships at
`duration: 1`, so it is ticked off the same turn it is cast and the enemy never sees it (the decoy,
at `castTurn + 1`, stands a turn longer — so the enemy sees a Wisp + a decoy, reading as "stealth
broken"). *AC: Wisp's `veil_decoy` Stealth effect is `duration: 2`, covering the cast turn AND the
following turn (aligned with the decoy's `castTurn + 1`); an engine-or-client test asserts that
after a Veil & Decoy cast the stealthed Wisp is **absent** from the enemy team's view on the
following turn while its decoy is still drawn; the decoy value is unchanged.*

**Spec Notes.** File: `data/characters/wisp.json`.

- **The ability id is `veil_decoy`.** *(Correction 2026-08-31.)* The 2026-08-30 review and the
  edge-cases ruling both wrote `veil_and_decoy`, which **does not exist** — grepping for it finds
  only docs. Change the `stealth` effect's `duration: 1 → 2` on `veil_decoy`.
- **Leave the `decoy` effect's `duration` alone, and know why.** `spawnDecoy` (`resolve.ts:713`)
  never reads it — the lifetime is `expiresOnTurn = castTurn + 1`, computed from the turn counter.
  The `duration: 1` sitting next to it is **dead data**. The decoy already lasts "one turn after
  the cast"; do not bump it to 2 expecting a longer decoy, because nothing would change.
- **Owner-ruled, so it overrides "never rebalance"** — this is a one-line owner directive, not a
  Builder balance call.
- **`packages/client/test/stealth-confirm.test.ts` inverts, and this is the point.** Its first
  `describe` ("the render path honours Stealth") is synthetic — it sets `statuses` by hand — and
  **survives untouched**. Its second `describe` ("but the shipped Veil & Decoy is over before
  anyone can look at it") was written as a *reproduction of the bug* and must now become the
  *proof of the fix*: `:138`'s `expect(...duration).toBe(1)` becomes `2`; the "end-of-turn tick
  takes it away" and "the enemy simply sees Wisp" cases invert; the `duration: 2` counterfactual
  at `:142` is now redundant with the shipped value — fold it into the positive assertion rather
  than keeping two copies of the same claim.
- **The AC no longer names an e2e.** *(Correction 2026-08-31.)* The 2026-08-30 AC said "the
  STEALTH-CONFIRM e2e now passes with the shipped value (the stealthed Wisp is absent from the
  enemy seat)". **No such e2e exists** — `render.spec.ts:530` drives the cast and asserts the
  purple decoy and a log line from *Wisp's own* seat; it never reaches the enemy seat and never
  checks stealth, so it is unaffected by this change. The enemy-seat assertion lives at unit level
  (`fogView`), which is where the Builder already put it and where it belongs; driving the hot-seat
  to an enemy seat for it is not worth the flake. Do not add one.

Resolves Builder OQ 2026-08-29 #1 and Dev Note #4. Ruled in edge-cases (Decoy → Stealth duration).
Out of scope: any other roster value.

## Engine

### CAMO-REVEAL. Acting/being hit while concealed reveals you this turn + next (ENGINE + CLIENT) — UNBLOCKED
**Addresses Dev Note: "If you used an offensive ability, used a catalyst, or took damage while
inside a camouflage zone, the tile you were standing on turned bright red … Turning the tile red
immediately deactivated your invisibility and revealed you to the enemy team for the rest of that
turn, as well as the following turn."** Today `reveal` is applied only on **dealing damage**; a
brush-hidden unit that takes damage or fires a catalyst is not revealed.

*AC: a unit **standing on a brush square or carrying `stealth`** that (a) uses a **harmful**
ability that deals no damage, (b) uses a **catalyst**, or (c) **takes damage** gains `reveal` for
`REVEAL_ON_ATTACK_TURNS` (= 2 — rest of this turn + all of next) and its `stealth` breaks; the
same unit **in the open** gains no reveal from any of those three; **dealing damage still reveals
you whether concealed or not** (unchanged); **movement** through brush reveals nothing; the client
renders the camouflage tile the unit stood on as **bright red** for the reveal's duration.*

**Spec Notes.**

- **CORRECTION 2026-08-31 — this item is purely ADDITIVE. Do not narrow the existing reveal.**
  The 2026-08-30 draft said reveal-on-action should fire *iff* the unit is concealed, so an
  open-field attacker would stop being revealed. That is wrong twice. (a) It **breaks a shipped
  test**: `packages/engine/test/attribution.test.ts:178` drives a plain unconcealed unit at (0,4)
  that attacks and asserts it gains `reveal`. (b) The draft justified itself as "a no-op anyway" —
  **it is not.** `reveal` lasts 2 turns and beats brush, so removing it from open attackers lets a
  unit shoot in the open on turn 1 and vanish into brush on turn 2 with no penalty, gutting the
  mechanic. The owner's rule *adds* camouflage triggers; it never asks to remove the existing one.
  Keep `resolve.ts:912` (dash) and `:1106` (blast) exactly as they are.
- **The concealment gate is the TILE, not an observer.** Use
  `terrainAt(board, unit.pos) === 'brush' || hasStatus(unit, 'stealth')`. Do **not** reach for
  `isConcealedFrom` (`vision.ts:230`): it takes an `observerPos` because the brush adjacency
  exception makes concealment per-observer, so a unit in brush is hidden from a distant enemy and
  not from an adjacent one — there is no observer-free answer, and a per-observer gate would
  reveal you to some enemies and not others off a single action. The owner's wording is "*while
  inside a camouflage zone*", which is a tile you are standing on. Ruled in edge-cases.
- **CORRECTION 2026-08-31 — you do NOT need `Vision`, and threading it in would be wasted work.**
  The 2026-08-30 draft pointed at `brushPatchAt` from `vision.ts`. But **`resolve.ts` never builds
  a `Vision`** — grep it: no `buildVision`, no `Vision` import. Following that note means threading
  a new object through `runPrep`/`runDash`/`runBlast`/`fireCatalyst` for no gain. The resolver
  already has `board` in every one of those, and `terrainAt(board, p)` returns `'brush'` directly
  (`board.ts:150`, brush indexed at `:133`). Use it.
- **Files and the real line numbers** *(the 2026-08-30 draft's were a commit stale)*:
  `packages/engine/src/resolve.ts` — factor one `revealIfConcealed(board, unit, abilityId, events)`
  helper (tile gate → `applyStatus(unit,'reveal',REVEAL_ON_ATTACK_TURNS)` + `breakStealth` + the
  `statusApplied` event, mirroring the existing pair at `:1105-1107`) and call it from:
  `fireCatalyst` (**:333**), the blast damage-taken path (**:1079**, beside the existing
  `breakStealth`), the trap damage-taken path (**:495**), the dash damage-taken path (**:873**),
  and the harmful-non-damaging effect application. `REVEAL_ON_ATTACK_TURNS = 2` lives at
  `constants.ts:26`.
- **"Harmful ability" ≠ damage.** Reuse `HARMFUL_KINDS` (`resolve.ts:132`) — damage, weaken, slow,
  root, knockback, pull, reveal. Do **not** reveal on a pure self-buff or a Move.
- **Client:** `renderer3d.ts`/`app.ts` — a red tile at the revealed unit's square for the reveal's
  duration, driven off the `reveal` `statusApplied` event. The trap marker added by TRAP-INDICATOR
  is the nearest existing pattern (a flat plate in the overlay band, above brush per FOG-ZORDER).
- **Required tests beyond AC:** a brush-hidden unit that takes damage is revealed next turn; one
  that fires a catalyst is revealed; one that lands a pure debuff is revealed; an **open** unit
  that takes damage or fires a catalyst gains **no** reveal; an **open** unit that deals damage
  **still** gains reveal (the regression guard for the correction above — `attribution.test.ts:178`
  must keep passing); a stealthed unit that only *moves* is not revealed; determinism unaffected.
- **N-unit safe:** the helper takes a unit, not "the unit" — it must work when three concealed
  units act in one turn.

Ruled in edge-cases (Camouflage-tile reveal penalty). **Out of scope:** positional-fog behaviour
(LAST-KNOWN); changing the 2-turn duration; the per-observer concealment question (ruled: tile).

### DASH-OCCUPIED. A dash can't end on an occupied square (unless its knockback clears it) (ENGINE tests + CLIENT) — UNBLOCKED
**Addresses Dev Note: "Also, you should not be able to dash onto the same square as another
character unless there's a knockback associated with the skill."** The prohibition already holds;
this item pins it, adds the exception's ordering, and stops the client silently committing a dash
that will fizzle.

*AC: (1) regression tests pin the prohibition across **teleport, charge, and the Shift catalyst** —
each refuses or rests short of a square held by a living character; (2) the **knockback exception**
— a dash whose own effect knocks the destination's occupant away resolves that displacement **in
the Dash phase before the dasher settles**, then lands on the vacated square (a synthetic test
drives a teleport-with-knockback onto an occupied square and asserts the occupant is pushed and the
dasher lands); (3) the **client refuses committing** a teleport/dash aim onto an occupied square,
the way AIM-RANGE refuses an out-of-range click; (4) a `line`/`cone` click on the caster's **own
square is a no-op**, not a commit-east (Builder OQ 2026-08-29 #4).*

**Spec Notes.**

- **The engine already prohibits it — verify before you change anything.** A **teleport** fizzles
  on a living occupant: `teleport()` at **`resolve.ts:963`**, occupancy check at **:967**.
  *(Correction 2026-08-31: the 2026-08-30 draft cited `:292`, which is `teleportDestination` — a
  different, four-line function that only extracts a catalyst's aim. Do not edit that one.)* A
  **charge** rests on the furthest free path square: `walkCharge` at **:933**, `restIndex` loop at
  **:936-937**. Part (1) is therefore *tests only* — no engine change.
- **Part (2) is forward-looking and you may defer it, but say which you chose.** No current roster
  dash exercises it: charges rest short and carry knockback as an area `impact`, and no teleport
  both aims at an occupied square and knocks its occupant off it. Either implement the ordering
  (clear the occupant → land the dasher, inside the Dash phase, *not* deferred to the end-of-Blast
  displacement pass) with a synthetic ability in a test fixture, **or** ship (1)(3)(4) and leave
  (2) as the documented ruling. **State the choice in the commit message** — this is a legitimate
  scope call, not a silent drop.
- **Part (3) reuses the AIM-RANGE gate.** `commitAim` (`targeting.ts`) is already the one place a
  board click becomes a draft aim; add the occupancy test there for `square`-shaped dash abilities
  and the Shift catalyst, so the refusal reads identically to the out-of-range refusal. Do not add
  a second gate elsewhere.
- **Part (4) is in that same commit path.** Today `dragToAimStep(pos, pos)` → `vectorToStep(0,0)`
  → step 0, which `isAimStep` accepts, so clicking your own square with a line/cone commits an
  eastward shot. Ruled a no-op: `commitAim` returns `undefined` when a `line`/`cone` target equals
  the caster's square. `packages/client/test/aim-range.test.ts:100` currently **pins the old
  behaviour** (`expect(...aimStep).toBe(0)`) as an observation — flip it to assert the refusal.
- **Out of scope:** decoys (a dash ending on a decoy destroys it — R2, unchanged); the charge
  pass-through rule (unchanged); allowing a dash to *displace* an occupant without a knockback
  effect.

Ruled in edge-cases (dash may not end on an occupied square). **Required tests beyond AC:** a
teleport onto an **ally** is refused too (the rule is "another character", not "an enemy"); a
charge whose whole path is occupied holds at its origin rather than teleporting.

## Client

### LAST-KNOWN. Last-known-position ghosts + trajectory through fog (CLIENT) — UNBLOCKED
**Addresses Dev Note: "If you were standing completely outside the enemy's 6-tile vision circle, or
tucked entirely behind high cover/solid walls, you could fire projectiles or use abilities freely …
The enemy would see the trajectory of your attack or projectile slicing through their visible area,
but your character model remained hidden … Your character icon would remain at your last spotted
location until you stepped back into their sight."** *AC: an enemy the acting team has lost sight of
is drawn as a **ghost at its last-spotted square** (visually distinct from a live sighting) and stays
there until the team re-sees it, at which point the ghost moves to the new position; a freshly-seen
enemy shows normally; the ghost reveals only the **last-seen** square (no live position leak); during
resolution playback the attack trajectory/area animates across the viewer's visible tiles even when
the attacker's model is fogged; a client test drives a unit leaving vision and asserts a ghost
remains at the last-seen square, then clears on re-sighting.*
**Spec Notes.** Files: `packages/client/src/fog.ts` (a per-team, per-enemy last-seen memory —
`fogView` already computes what's currently visible; layer a remembered-position map over turns),
`app.ts`/`renderer3d.ts` (a ghost style distinct from a live unit). The client keeps this memory
itself — it is *presentation of past sightings*, not a vision rule, so it is not a golden-rule
violation (it re-derives no current visibility; it remembers what was already shown). **This is the
one genuinely new stateful bit** — hold it in the app/fog layer, keyed by `(team, enemyUnitId) →
lastSeenPos`, updated each render from `visibleEnemiesForTeam`. Ruled in edge-cases (Positional
concealment / LAST-KNOWN). **Out of scope:** any engine/vision-*rule* change (the engine already
keeps the model hidden — `canSee` tests range/LoS before concealment); hidden-info security (M3);
ghosts for decoys (a decoy is its own render, DECOY-RENDER).
**Gotcha (2026-08-31):** `fogView` is *pure and stateless*, and `app.ts:196-202` memoises it on
`(state, team)` — it re-runs whenever either changes. Do **not** put the memory inside `fogView`,
or every repaint overwrites it with the current frame. Keep the `(team, enemyUnitId) →
lastSeenPos` map in the app layer and pass it *into* the view builder, so `fog.ts` stays a pure
function of `(state, team, memory)` and stays unit-testable without a render loop.

> **Note:** the **camouflage-tile-red render** and the `line`/`cone` self-click no-op are the client
> halves of CAMO-REVEAL and DASH-OCCUPIED respectively — build them with those items, not here.

## Blocked / Designer / flags (not build items)

- **CAT-DASH-COST Fade/Unshackle** — uniform-per-colour Move cost shipped; Fade-at-full-Move
  playability is a Designer/playtest balance flag, one-condition exemption only if it proves
  unplayable.
- **UNTGT1 trap carve-out** — `untargetable` skips aimed offence; a walked-onto trap still bites.
  Route a Dev Note if the owner wants "cannot be hit" = "cannot be hurt".
- **`statusRemoved` source attribution** (Builder OQ #7) — an expiry has no author; a Stealth broken
  by an attack does. Engine change, flagged not scheduled.

## Deferred — do NOT schedule

- **A4** per-ability FX — blocked on M3 + roster lock.
- **CL1/CL2/E2**, **flat `energy` effect kind**, **vision metric change**, **tunable cone angle**,
  **optimistic move validation**, **PREVIEW-NUMBERS cover-adjustment**, **status-pip pixel test** —
  not scheduled (revisit only on a concrete playtest report).

## M3+ — the next milestone

21. Worker + DO rooms; **map + format selection lobby** (supersedes MAPTOGGLE) with **per-character
    catalyst selection** and the **normal-ability-aimed-from-Shift-landing preview**; team-seat +
    **duplicate-pick validation (R3)**; per-player hidden submission → per-team orders; **per-team
    hidden information — the real security boundary** the hot-seat only approximates for fog
    (VISION1), previews (PREVIEW-FOG), traps (TRAP-INDICATOR), **last-known ghosts (LAST-KNOWN)**
    and the combat log (UI6); per-player timer + Time Bank; decoy fog; reconnect/replay; deploy to
    Pages + wrangler.

## Observed-not-requested / playtest (not Builder-blocking)

- **8-tile melee cones**, **Seismic Rupture at 29 tiles**, **cone raggedness** at shallow angles.
- **Overdrive's Haste** can't buy Move squares this turn. **Fade at full-Move cost** (CAT-DASH-COST
  flag). **Free-action / catalyst** feel: one free action per turn too tight? Shift as default
  Yellow? Catalyst hoarding? **Kestrel** untested through MAPTOGGLE (8-of-9 dev draft). **Turn-1
  spawn margin one tile** — hold `MAX_ABILITY_RANGE = 8` and the spawn columns.
