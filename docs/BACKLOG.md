# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit** — and a **bug fix or a reversed ruling ships with the
regression / flipped test in that same commit.** **A genuinely new mechanic gets a generic, reusable
implementation** (golden rule #2). **Drive the real UI wiring in tests.** **Open/update a PR to `main`
every session.**

> ⚠️ **`main` is LIVE** — a green push publishes. Deploy is set; QUOTA-RUNAWAY guards the quota. Keep green.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + Dev Notes batches 1–3 +
  AIM-PREVIEW-TRUE + DEATH-HANG.
- **PR #97 (this review):** **WARDING-WALL** (Aegis's Grounding Strike → a Prep, freely-placed 4-tile
  line-hazard: a new `wall` shape, `perTile` trap placement, and a **per-trap `triggers` list** —
  `move`/`dash`/`teleport`/`displacement` — so a wall catches a shove and a mine keeps the v1 rule),
  **BASTION-RAM-LINE** (`chargeHits:"all"` + a line preview with a landing marker), **CD-BAND-DASH**,
  **CD-BAND-BLAST**, **CD-BAND-INVARIANT** (the bands, enforced by a band-naming test),
  **DOWN-SEAT-SKIP** (a seat with no living units is not waited on).

Current suite: **2600 tests** (1341 + 957 + 302), typecheck clean.

### Build order and dependencies

**TRAP-SHOVE-DEFAULT** is the only scheduled work — one engine field, one flipped test, one new test.
Everything else this session is flags/Designer routing. No dependencies.

---

## Engine — traps now catch a shove (the whole session)

### TRAP-SHOVE-DEFAULT. An ordinary mine triggers on a knock-through; a blink past it never does (ENGINE) — UNBLOCKED (first)
**Addresses Dev Note: "Traps should trigger if an enemy is knocked through the trap or if they blink
onto the trap or dash onto/through the trap."** and **Dev Note: "Trap should not trigger if enemy blinks
PAST the trap."** PR #97 already built the whole mechanism (`triggerTrapsOnEntry` takes an entry kind;
displacement is walked square-by-square; teleport fires only at the landing square). The **only** gap is
that `DEFAULT_TRAP_ENTRIES` omits `displacement`, so an ordinary mine ignores a shove — which this Dev
Note reverses. Ruled in edge-cases (**TRAP-TRIGGER**, superseding the 2026-08-14 knockback-exclusion).

*AC:*
- **`DEFAULT_TRAP_ENTRIES` becomes `['move','dash','teleport','displacement']`** (`packages/engine/src/types.ts`).
  No other production change is needed — `applyDisplacements` already calls `triggerTrapsOnEntry(..., 'displacement', square)`
  for every square a shove crosses, and `triggerTrapsOnEntry` already filters by `(t.triggers ?? DEFAULT_TRAP_ENTRIES).includes(entry)`.
- **A knock-through fires an ordinary mine.** A knockback/pull that carries an enemy **onto or across** a
  mine tile triggers it (damage lands, the trap is consumed), for the three default-trap abilities: Vex
  `overwatch_trap`, Thorn `barbed_sling`, Thorn `snare_bloom`. Knocked *through* and knocked to *rest on*
  both count (the resting square is the last square in the walked path).
- **A blink PAST a mine does NOT fire it** — a teleport whose landing square is **beyond** the mine's
  tile leaves the mine armed and the blinker unhurt (it occupies only its landing square, crosses nothing).
- **A blink ONTO a mine still fires it, and a dash onto/through still fires it** — unchanged.
- **The wall is untouched.** `aegis.warding_wall`'s explicit `triggers: ['move','dash','displacement']`
  overrides the default, so its authored *"a blink goes around it"* exception stands (a blink neither onto
  nor past the wall fires it). **Do not add `teleport` to the wall** — see the flag below.

*Tests (same commit — this reverses a v1 ruling):*
- **FLIP** the shipped guard *"an ordinary mine still ignores a shove — the RULED v1 behaviour"*
  (`packages/engine/test/warding-wall.test.ts`, ~line 286) to assert the mine **now fires** on the same
  Bullrush shove: the victim loses HP beyond the charge alone and `shoved.traps` is empty (the mine is
  consumed). Rename it to reflect the reversal (e.g. *"an ordinary mine now fires on a shove — TRAP-TRIGGER"*).
- **ADD** a blink-**past**-a-mine test: arm an Overwatch Trap, have Wisp blink to a square **beyond** it
  in the same line; assert the mine is still armed (`traps` length 1) and the blinker took no damage.
- **KEEP GREEN** the existing *"an ORDINARY mine still fires on a blink"* (blink-onto) and the dash /
  move trap tests, and **both wall guards** (a shove through the wall fires it; a blink onto/past the wall
  does not).

**Spec Notes.** This is one production line plus the tests — resist widening it. **Determinism / N-safety
are already proven** (the displacement path walk and per-square firing shipped for the wall in PR #97;
this only routes mines through the same integer path). Trap-list order is stable; traps consumed by id.
**Do not** try to distinguish "knocked through" from "knocked to rest on" — both put the victim on the
tile and both trigger; splitting them is a hair the Dev Note does not ask for and the path walk does not
draw. Out of scope: the wall's trigger list (unchanged); any new trap ability; changing how far a shove
travels.

## Routed to Designer / flags

- **WALL-BLINK-ONTO (owner confirmation, from TRAP-SHOVE-DEFAULT).** After this change, a blink that
  lands **on a mine** fires it, but a blink that lands **on a wall tile** does not — the wall keeps the
  owner's session-8 *"but not blinks"* exception. This is the one place the new general trap rule and the
  wall's authored behaviour diverge. **Kept as authored; flag to owner** — say if the wall should now
  also bite a blink that lands on it (it would be one array entry: add `teleport` to `warding_wall`'s
  `triggers`, and flip the *"nor is a blink that lands ON a wall tile"* test).
- **WARDING-WALL free rotation (session-8 OQ #1).** Orientation is **derived** (perpendicular to the
  caster's line), not truly aimed. Correct and deterministic for v1; **true free rotation is an
  ENGINE/CLIENT ASK** (needs an aim carrying a square **and** a step — an `aimFor`/`OrderDraft` change),
  **not scheduled**. Designer call whether it is wanted.
- **WARDING-WALL even-length centring (session-8 OQ #2).** A 4-tile wall puts the aimed square 2nd of 4
  (offsets −1,0,+1,+2). A one-character change to 3rd, or an odd-lengths-only data rule, if the Designer
  wants it. Not blocking.
- **Aegis has no cooldown'd Blast (session-8 OQ #5).** Intended (the owner asked for the wall), but Aegis
  is now the only character with no non-basic Blast — CD-BAND-BLAST's band has one fewer population. A
  Designer look-before-playtest note.
- **Aegis beam distinctness** (Shield Bash now reads as a 3-wide lane — re-ask if distinct enough).
  **Self-lethal recoil warning** (a "this whirl will kill you" tell — a design call, not scheduled).
  **Burn/regen pip glyphs** (new art, worth a look on a real plate).
- **Warding Halo's dead `weaken`**, **trap count cap**, **inspect-panel chips hoverable**,
  **chase-preview detour**, **Solar Flare DoT ceiling**, **Thorn mine carpet** — unchanged flags.

## Flagged future (not scheduled)

- **All-seats-downed resolves on the timer, not at once** (session-8 OQ #4). DOWN-SEAT-SKIP closed the
  partial case; the all-downed case is rare and safe (it already waited the window), and resolving
  eagerly from `#sendDecision` risks a resolve→send→resolve loop (QUOTA-RUNAWAY territory). Only schedule
  if the owner wants it, and then **only with the loop guard specified**.
- **NET-E2E**, **M3-REMATCH**, **IDLE-KICK**, **LOBBY-TEAM-CHOICE**, **CAMO-E2E-FINISH** (low),
  **same-turn-buff preview**, **route-around-bodies dash impact preview** — unchanged.

## Observed-not-requested / playtest (not Builder-blocking)

- **A real two-machine internet playtest** (DEATH-HANG shipped — exercise a death). **Shove-into-trap
  combos** (TRAP-SHOVE-DEFAULT — a Bullrush into an Overwatch Trap is now a real play), **the cooldown
  bands feel** (dashes at 4–5 change the tempo), **Warding Wall**, **Ram Charge's line**, **the new HUD**,
  **AIM-PREVIEW-TRUE**, **Ravok's recoil**.
