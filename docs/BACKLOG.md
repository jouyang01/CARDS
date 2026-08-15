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
  CI-decouple, AIM-METRIC, CONE-B, CIRCLE-FIX, DASH-IMPACT, FREE1, CAT1, CAT2.
- **PR #37 (this review):** **PREP-AOE** (Prep beneficial reaches every ally in area),
  **VALIDATE-KEYS** (unknown `AbilityDef` key is an error), **FREE-UI** (free abilities get their
  own draft slot), **DECOY-RENDER** (decoy is viewpoint-styled + fogged), **STATUS-AUDIT**
  (every status proved end-to-end + on-board pips; **UNTGT1** — `untargetable` now enforced on
  aimed offence; **`statusRemoved`** event added), **FOG-ZORDER** (overlays lifted above brush),
  **DASH-PREVIEW** (impact disc while aiming), **PREVIEW-NUMBERS** (float damage/heal/shield),
  **CAT-DASH-COST** (a Dash catalyst spends your Move, uniform per colour).

Current suite: **771 tests** (engine 479 + client 292), typecheck + build clean, purity green.

> **This batch is a CLIENT indicator + vision-honesty pass** on eight playtest Dev Notes. The
> engine already enforces range, vision and polarity; the client isn't *showing* it (range
> envelopes, trap markers, Shift's route), is *leaking* it (preview numbers over fogged enemies),
> or isn't *gating* on it (out-of-range teleport clicks the engine then drops). No engine work.

---

## Client — indicators & range (do first)

### AIM-RANGE. Show and enforce range for every aimable slot (CLIENT) — UNBLOCKED (first, HIGH)
**Addresses Dev Notes: "Veil's Blink looks like you can use it where you want, it should be limited
to the range of the skill. Audit to make sure all skills are limited to the range of the skill."**
and **"Aegis's intercept does the same thing."** and **"Dash catalyst doesn't have a range
indicator"** and **"Overwatch Trap doesn't have a range indicator either."** and **"This means that
there are skills that do not have indicators, audit this to ensure you catch all skills."** The
engine enforces range (`aimIsLegal`→`aimInRange`) and drops out-of-range orders; the client neither
shows nor gates it for some slots/shapes. *AC: (1) arming ANY aimable slot — normal ability, **free
ability**, **catalyst** — paints its range envelope (`rangeEnvelope`); (2) a board click **outside
range does not commit** for any shape (today `square`/`circle` commit the raw click and the engine
silently drops it) — the slot stays armed / previews as illegal, exactly as a `path` dash already
refuses an unreachable target; (3) an audit covers **every shape × every slot** — verify each
roster ability, free ability and catalyst shows an envelope and rejects an out-of-range click; a
client test drives an out-of-range click on a `square` teleport (Blink) and asserts nothing
commits, and that an armed catalyst/free ability paints an envelope.*
**Spec Notes.** Files: `packages/client/src/app.ts` (`renderPreviews` ~:491-501 — extend
`envelopeAbility` to the armed free ability / catalyst def, each in its own layer; `onBoardClick`
~:795-816 — gate every commit on `aimLegal(unit, def, aimFor(...))`), `targeting.ts` (`aimFor`
~:413 returns the raw square for `square`/`circle` — either return empty/illegal when out of range
or let the caller gate via `aimLegal`; keep the engine as the single source of the range rule via
`aimInRange`). **Do not re-derive range** — call the engine's `aimInRange`/`aimIsLegal`. Ruled in
edge-cases (AIM-RANGE). **Required tests beyond AC:** a `circle` (grenade) out-of-range click is
refused; an in-range click still commits; the envelope matches `aimInRange` exactly (no square the
engine would reject is drawn as legal). **Out of scope:** engine range rules (correct); clamping
semantics beyond "refuse the commit" (a clamp-to-nearest-legal is optional polish, note it).

### DASH-CAT-ROUTE. A dash-phase catalyst renders as a yellow route (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Shift's dash catalyst should show as a yellow movement similar to other
dash/blinks."** `dashRoute` (the yellow route line + marker) is only drawn for the selected normal
ability; a Dash catalyst's aim shows as a catalyst-coloured area overlay, not a route. *AC: arming a
dash-phase catalyst (Shift) and aiming it draws the **same yellow dash route + destination marker**
a blink/dash ability draws (from the unit to the aimed landing); non-dash catalysts are unchanged; a
client test asserts a Shift catalyst aim produces a dash route.*
**Spec Notes.** Files: `packages/client/src/app.ts` (~:593 — the route branch reads `chosen`; add
the catalyst-def case so a dash-phase catalyst feeds `dashRoute`), `targeting.ts` (`dashRoute`
already handles a `square` dash by drawing a segment to the destination — reuse it). **Shares the
catalyst-aim render path with AIM-RANGE — build together.** Note CAT-DASH-COST already clears the
drawn *move* when a Dash catalyst is armed, so the yellow route is the reposition indicator that
replaces it. Out of scope: normal-ability-aimed-from-Shift-landing preview (M3).

## Client — vision honesty (do together — shared team-vision gate)

### PREVIEW-FOG. A preview never reveals what the acting team cannot see (CLIENT) — UNBLOCKED
**Addresses Dev Note: "The preview of damage/healing cannot show up if the player taking the action
does not have vision of the character affected by damage/healing."** `preview-numbers.ts` filters
by polarity/team but not by vision, so a number floats over a fogged enemy — a hidden-info leak.
*AC: a per-unit preview number (and any per-unit plan-time hint) shows for an affected unit **only
if the acting seat's team can currently see it** — own units always, enemies only when in team
vision; aiming *into* fog is still allowed, it just shows no number there; a client test asserts a
damage preview aimed over an unseen enemy shows nothing, and over a seen enemy shows the number.*
**Spec Notes.** Files: `packages/client/src/preview-numbers.ts` (add a vision filter),
`app.ts`/`fog.ts` (feed `visibleEnemiesForTeam` for the acting seat — the same gate `fogView`
already computes; reuse it, don't recompute). Ruled in edge-cases (PREVIEW-FOG). **Out of scope:**
the free-aim rule (you may still aim into fog); cover-adjusted amounts (Builder OQ #6 — separate).

### TRAP-INDICATOR. Draw placed traps on the ground, fogged by team vision (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Traps need an indicator on the ground for the team or teams who can see it."**
Traps are in `state.traps` (`owner`, `pos`) but drawn nowhere. *AC: a placed trap shows a ground
marker; the **placing team always** sees its own traps; the **enemy** sees a trap only when a unit
has team vision of its square (fogged otherwise); the marker clears when the trap is consumed
(`trapTriggered`/expiry); a client test asserts an own-team trap is drawn and an out-of-vision enemy
trap is not.*
**Spec Notes.** Files: `packages/client/src/fog.ts` (extend `FogView` with the visible traps for
the team, styled by own/enemy — mirror the `FogDecoy` pattern DECOY-RENDER added), `app.ts`
(`paintFog` draws them), `renderer3d.ts` (a ground trap marker). Pure consumer: reads `state.traps`
+ `visibleSquaresForTeam`; derives no visibility. **Shares the team-vision gate with PREVIEW-FOG —
build together.** Ruled in edge-cases (TRAP-INDICATOR). Out of scope: hiding own traps from their
placer; trap *rules* (unchanged — team-safe, trigger on entry).

## Client — HUD & verification (smaller)

### CAT-COST-LABEL. Catalyst slots show their cost (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Prep Catalyst and Blast Catalyst are not showing as free actions."** Free
*abilities* show a "free" tag; catalyst slots show none. Post-CAT-DASH-COST the cost differs by
colour. *AC: each catalyst slot shows its cost — **Prep and Blast: "free"** (additive); **Dash:
"costs Move"** (or equivalent, matching CAT-DASH-COST); a client test asserts the tag per colour.*
**Spec Notes.** Files: `packages/client/src/hud.ts` (`HudCatalyst` gains a cost field; render it
beside `phase`), `app.ts` (populate it — Dash colour = costs Move, else free). Trivial; keep the
wording consistent with how free abilities are already tagged. Out of scope: the cost *rules*
(CAT-DASH-COST shipped).

### STEALTH-CONFIRM. Prove Veil's stealth reads correctly in-browser (CLIENT e2e) — UNBLOCKED
**Addresses Dev Note: "Does Veil's Stealth work? It doesn't seem to be working."** STATUS-AUDIT
proved stealth engine-side; FREE-UI (castable) and DECOY-RENDER (fogged, viewpoint-styled decoy)
shipped this batch, so it should now read correctly — most likely a pre-batch build. *AC: an e2e
(RENDER-VERIFY) drives Wisp casting Veil & Decoy, then from the **enemy** seat asserts the stealthed
Wisp is **not** drawn (absent from the render) while the **decoy** is drawn as an enemy Wisp; from
Wisp's **own** seat the real unit is drawn and the decoy shows purple.*
**Spec Notes.** Files: `packages/client/e2e/render.spec.ts` (+ `pixels.ts` families). If the e2e
**fails**, this becomes a real bug — re-open with the specific failing seat/frame; if it passes,
it closes Dev Note #4 with evidence rather than assertion. **Out of scope:** engine stealth
(proved); a rules change.

### LOG-STATUS. Render `statusRemoved` in the combat log (CLIENT) — UNBLOCKED (small)
**Closes Builder OQ 2026-08-28 #4.** The engine now emits `statusRemoved { unitId, status, reason:
'broken' | 'expired' }` but UI6 doesn't render it. *AC: the combat log shows a line when a status is
broken or expires (e.g. "Vex's Haste wore off", "Wisp's Stealth broke"); a client test asserts a
`statusRemoved` event produces a log line with the right tone.*
**Spec Notes.** Files: `packages/client/src/combat-log.ts` (add the `statusRemoved` case, mirroring
`statusApplied`). Pure consumer of the log. Out of scope: filtering/config (UI6 cap already exists).

## Blocked / Designer

- **CAT-DASH-COST — Fade/Unshackle balance flag (Designer/playtest, NOT a build item).** All three
  Dash catalysts pay the Move (uniform per colour, shipped). Fade at the cost of a full Move may be
  unplayable; exempting the non-repositioning Dash catalysts is a one-condition change **only if
  playtest shows it** — a Designer call, watched, not built pre-emptively.
- **UNTGT1 trap carve-out (Designer, if wanted).** `untargetable` skips aimed offence but a walked-
  onto trap still bites. If the owner wants "cannot be hit" = "cannot be hurt", the trap path is
  one `if` — route a Dev Note if so; default stands.

## Deferred — do NOT schedule

- **A4** per-ability FX — blocked on M3 + roster lock.
- **CL1/CL2/E2**, **flat `energy` effect kind**, **vision metric change**, **tunable cone angle**,
  **optimistic move validation** (Blast-Haste extends the same-turn walk) — not scheduled.
- **PREVIEW-NUMBERS cover-adjustment** (show post-cover amounts) — fold in only if playtest reports
  the preview "lying" over a unit in cover (Builder OQ #6).
- **Status-pip pixel test** — add a per-pip colour family only if a pip regression happens (OQ #5).

## M3+ — the next milestone

21. Worker + DO rooms; **map + format selection lobby** (supersedes MAPTOGGLE) with **per-character
    catalyst selection** and the **normal-ability-aimed-from-Shift-landing preview**; team-seat +
    **duplicate-pick validation (R3)**; per-player hidden submission → per-team orders; **per-team
    hidden information for fog (VISION1), previews (PREVIEW-FOG), traps (TRAP-INDICATOR) and the
    combat log (UI6)** — the real security boundary the hot-seat only approximates; per-player timer
    + Time Bank; decoy fog; reconnect/replay; deploy to Pages + wrangler.

## Observed-not-requested / playtest (not Builder-blocking)

- **8-tile melee cones**, **Seismic Rupture at 29 tiles**, **cone raggedness** at shallow angles.
- **Overdrive's Haste** can't buy Move squares this turn (only offset a Slow) — watch if it reads
  weak. **Fade at full-Move cost** (see CAT-DASH-COST flag). **Free-action / catalyst** feel: one
  free action per turn too tight? Shift as default Yellow? Catalyst hoarding? **Kestrel** untested
  through MAPTOGGLE (8-of-9 dev draft). **Turn-1 spawn margin one tile** — hold
  `MAX_ABILITY_RANGE = 8` and the spawn columns.
