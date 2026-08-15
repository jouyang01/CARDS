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

---

## Data (do first — one line, unblocks Wisp playtest)

### STEALTH-DURATION. Wisp's Stealth lasts one turn after the cast (DATA) — UNBLOCKED (first)
**Addresses Dev Note Ruling: "Veil & Decoy effects, Stealth/Decoy should last one turn AFTER the
skill is used. Make whatever changes needed to make this happen in the spec."** Stealth ships at
`duration: 1`, so it is ticked off the same turn it is cast and the enemy never sees it (the decoy,
at `castTurn + 1`, stands a turn longer — so the enemy sees a Wisp + a decoy, reading as "stealth
broken"). *AC: Wisp's `veil_and_decoy` Stealth effect is `duration: 2`, covering the cast turn AND
the following turn (aligned with the decoy's `castTurn + 1`); the STEALTH-CONFIRM e2e now passes
with the shipped value (the stealthed Wisp is absent from the enemy seat on the turn after the
cast); the decoy value is unchanged.*
**Spec Notes.** File: `data/characters/wisp.json` — `veil_and_decoy` → the `stealth` effect's
`duration: 1 → 2`. **Owner-ruled, so it overrides "never rebalance"** (Analyzer/Designer own data;
this is a one-line owner directive). Update the STEALTH-CONFIRM test's expectation (it was pinned as
a *reproduction* against `duration: 1` + a `duration: 2` counterfactual — flip it to assert the
shipped value now hides Wisp next turn). Resolves Builder OQ 2026-08-29 #1 and Dev Note #4. Ruled in
edge-cases (Decoy → Stealth duration). Out of scope: any other roster value.

## Engine

### CAMO-REVEAL. Acting/being hit while concealed reveals you this turn + next (ENGINE + CLIENT) — UNBLOCKED
**Addresses Dev Note: "If you used an offensive ability, used a catalyst, or took damage while
inside a camouflage zone, the tile you were standing on turned bright red … Turning the tile red
immediately deactivated your invisibility and revealed you to the enemy team for the rest of that
turn, as well as the following turn."** Today `reveal` is applied only on **dealing damage**; a
brush-hidden unit that takes damage or fires a catalyst is not revealed. *AC: a unit that is
**concealed** (in a brush patch OR carrying `stealth`) at the moment it (a) uses a **harmful**
ability, (b) uses a **catalyst**, or (c) **takes damage** gains `reveal` for `REVEAL_ON_ATTACK_TURNS`
(= 2: rest of this turn + all of next) and its `stealth` breaks; a unit doing the same **in the open**
gains no reveal; **movement** through brush (no offensive action) does not reveal; the client renders
the camouflage tile the unit stood on as **bright red** for the reveal's duration.*
**Spec Notes.** Engine files: `packages/engine/src/resolve.ts` — factor a single `revealIfConcealed(unit)`
helper (checks `brushPatchAt(...) !== undefined || hasStatus(unit,'stealth')`, then applies `reveal`
+ `breakStealth` + the `statusApplied` event) and call it from: the damage-dealt loop (already
reveals — narrow it to the concealed gate), the **damage-taken** path (`~:1079`, `~:495`), and
`fireCatalyst` (`~:340`). Needs the `Vision`/board to test brush — thread it in or pass a
`brushPatchAt` closure (keep the engine pure). **Gotcha:** "harmful ability" = deals damage OR
carries a debuff/displacement — not damage alone; but do NOT reveal on a pure self-buff or a Move.
Client: `renderer3d.ts`/`app.ts` — a red tile at the revealed unit's square, driven off the `reveal`
`statusApplied` event. Ruled in edge-cases (Camouflage-tile reveal penalty). **Required tests:** a
brush-hidden unit that takes damage is revealed next turn; a brush-hidden unit that fires a catalyst
is revealed; a unit acting in the open gains no reveal; a stealthed unit that only *moves* is not
revealed; determinism unaffected (no new float/RNG). **Out of scope:** positional-fog behaviour
(LAST-KNOWN); changing the 2-turn duration.

### DASH-OCCUPIED. A dash can't end on an occupied square (unless its knockback clears it) (ENGINE tests + CLIENT) — UNBLOCKED
**Addresses Dev Note: "Also, you should not be able to dash onto the same square as another
character unless there's a knockback associated with the skill."** The prohibition already holds
(teleport fizzles on an occupant `resolve.ts:292`; a charge rests on the furthest free square
`walkCharge:933`). *AC: (1) regression tests pin the prohibition across **teleport, charge, and the
Shift catalyst** — each refuses/rests-short of a square held by a living character; (2) the
**knockback exception** — a dash whose own effect knocks the destination's occupant away resolves
that displacement **in the Dash phase before the dasher settles**, then lands on the vacated square
(a synthetic test drives a teleport-with-knockback onto an occupied square and asserts the occupant
is pushed and the dasher lands); (3) the **client refuses committing** a teleport/dash aim onto an
occupied square (it silently fizzles otherwise), same as AIM-RANGE refuses out-of-range clicks;
(4) — small, from Builder OQ #4 — a `line`/`cone` click on the caster's **own square is a no-op**,
not a commit-east.*
**Spec Notes.** Engine: `packages/engine/src/resolve.ts` (`teleport`, `walkCharge`, the Dash-phase
displacement ordering). The knockback exception has **no current roster user** (charges rest-short
and carry knockback as an area `impact`; no teleport aims at an occupied square with a clearing
knockback) — so implement the resolution *order* + a synthetic test **now** so a future
knockback-dash works, OR, if the ordering change is invasive, ship the prohibition tests + client
gate and leave the exception as the documented ruling to implement when a skill needs it (say which
you chose). Client: `targeting.ts`/`app.ts` — gate the teleport/dash aim commit on destination
occupancy (reuse the AIM-RANGE commit-gate path); the self-click no-op is in the same commit path.
Ruled in edge-cases (dash may not end on an occupied square). **Out of scope:** decoys (a dash
ending on a decoy destroys it — R2, unchanged); the charge pass-through rule (unchanged).

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
