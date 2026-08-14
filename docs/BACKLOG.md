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
  MET1(+tp), BRUSH1, TT1, C1, MS1, R1–R7, MOVE1, HITBOX1, VISION1, MAPTOGGLE, CI-decouple.
- **PR #33 (this review):** **FREE1** (free-action *engine* — budget independence), **CAT1**
  (catalysts: 3 slots, once-per-match, start-of-phase), **CAT2** (catalyst UI slot),
  **VISION1-opening** (opening frame fogged by construction), **AIM-METRIC** (aiming Euclidean),
  **CONE-B** (`halfWidth(d)=d` + Euclidean axial, measured bound ratified), **CIRCLE-FIX**
  (`dx²+dy²≤r²`), **DASH-IMPACT** (`impact` areas; MET1-tp branch deleted), rotation-invariance
  suite.

Current suite: **628 tests** (engine 423 + client 205), typecheck + build clean, purity green.

> **This batch is a BUG-FIX + polish pass** on PR #33, driven by nine playtest Dev Notes. The
> free-action *engine* shipped but its *client* never did (FREE-UI); Prep beneficial AoE only hits
> the caster (PREP-AOE); and several render/preview gaps make working systems read as broken.
> One Dev Note (#5) is a **Designer** economy call (CAT-DASH-COST).

---

## Engine (do first — correctness)

### PREP-AOE. Prep-phase beneficial AoE applies to all allies in the area (ENGINE) — UNBLOCKED (first)
**Addresses Dev Note: "Aegis Barrier Pulse is only shielding one ally, should shield all allies in
the area of effect."** *AC: a Prep beneficial area ability (`heal`/`shield`/buff on a
`circle`/`square`) applies its effects to **every allied unit whose square is in `a.area`** (the
caster included, exactly once — no double-application); a Prep ability aimed so two allies stand in
its radius shields **both**; self-cast and trap Prep abilities are unchanged; energy-on-use
unchanged.*
**Spec Notes.** Files: `packages/engine/src/resolve.ts` (`firePrep` ~:599-601 — the non-trap
branch currently calls `applySelfEffects(draft, unit, …)`, hitting only the caster). Replace with
the **same beneficial-allies-in-`a.area` loop** the Blast path (`~:1006`) and dash-impact path
(`~:806`) already use — factor the shared loop if clean, but do not change Blast/impact behaviour.
FF1 polarity holds (beneficial → own team only). N-unit-safe (iterate the unit list). Ruled in
edge-cases (FF1 beneficial / PREP-AOE). **Required tests beyond AC:** a Prep shield with the caster
+ one ally in area shields both, once each; a Prep buff aimed at empty space shields nobody; a
harmful Prep ability (trap) is untouched. **Out of scope:** any Blast/impact change; new effect
kinds.

### VALIDATE-KEYS. Reject unknown `AbilityDef` keys at validation (ENGINE) — UNBLOCKED (hardening)
**Closes Builder OQ 2026-08-27 #5.** `validateAbility` rejects unknown `impact` members but still
accepts unknown top-level keys, so a typo'd field (`impcat`, `destinaton`) is silently dropped.
*AC: `validateAbility` rejects an `AbilityDef` carrying any key outside the known set (listing the
offending key); every shipped ability, catalyst and test fixture still validates; a fixture with a
bogus key fails with a clear message.*
**Spec Notes.** Files: `packages/engine/src/validate.ts`. Enumerate the allowed `AbilityDef` keys
in one place. **Gotcha:** run the full `data/` + fixtures through it first — this is why it is its
own item (it touches every ability at once). Out of scope: `data/` value changes (only reject
*unknown* keys, don't retune existing ones).

## Client — playtest blockers (ordered)

### FREE-UI. Free abilities get their own draft slot + arm-mode (CLIENT) — UNBLOCKED (HIGH, unblocks stealth)
**Addresses Dev Notes: "Overwatch trap should be a free action, but I cannot use overwatch trap and
attack/spring after."** and **"Veil and Decoy shoudl be a free action, but cannot sprint/attack
after"** and **"6 & 7 tell me free actions aren't done correctly. I need to be able to use the free
action AND still take my turn as normal."** The engine's FREE1 is correct; the client has **zero
`freeAbility` references** — a `free:true` ability fills the normal `abilityId` slot, is sent as
`order.ability`, and disables Sprint. *AC: selecting a `free:true` ability (Overwatch Trap, Snare
Bloom, Veil & Decoy) arms it in a **separate slot** — it does **not** clear/replace the normal
ability selection and does **not** disable Sprint; a turn can carry a free ability **and** a normal
ability **and** a move/sprint; `toUnitOrders` emits it as `order.freeAbility`; a client test drives
free-ability + normal-ability + sprint in one turn and asserts all three reach `UnitOrders`.*
**Spec Notes.** Mirror CAT2 exactly — it already solved this shape for catalysts. Files:
`targeting.ts` (`OrderDraft` gains `freeAbilityId` + its own aim slot; `toUnitOrders` ~:551 adds
the `order.freeAbility` branch, and `draftHasOrder` counts it), `order-mode.ts` (`Mode` gains
`'free'`; a `previewFreeAim` like `previewCatalystAim`), `app.ts` (a `selectFreeAbility`, a `'free'`
overlay layer, and **remove the Sprint-disable when the only thing chosen is a free ability** —
`sprintDisabled` must key off the *normal* ability, not a free one), `hud.ts` (free abilities read
as their own control, or are tagged `free` in the hotbar so the player knows they're additive).
**Enforce one free action per turn in the UI** (a free ability OR a catalyst, per the ruling — the
engine already yields the catalyst, but the UI should prevent ordering both). Ruled in edge-cases
(FREE-UI). **Required tests:** free + normal + sprint all sent; selecting a free ability leaves an
existing ability draft intact; ordering a free ability + a catalyst is prevented (or the catalyst
visibly yields). **Out of scope:** the engine (FREE1 is correct); new free abilities.

### DECOY-RENDER. Decoy renders team-aware and is fogged (CLIENT) — UNBLOCKED (unblocks stealth read)
**Addresses Dev Note: "decoy should show as an enemy for the enemy team and a unique purple color
for ally team."** (part of "Stealth is not working"). `app.ts:409` draws all decoys as bare
positions — no team styling, no fog. *AC: to the **enemy** team the decoy renders **as a normal
enemy Wisp** (same model/colour as a real enemy unit, frozen cast-time HP bar — indistinguishable);
to **Wisp's own** team it renders in a **unique purple**; the decoy is **only shown to the enemy
when a teammate has vision of its square** (fogged like a real enemy); a client test asserts an
out-of-sight decoy is not drawn for the enemy and a visible one draws as an enemy-styled unit.*
**Spec Notes.** Files: `packages/client/src/app.ts` (the `paintFog`/`renderer.show` decoy path
~:409 — pass decoys through the same `visibleSquaresForTeam` gate `fogView` uses for units, tagged
with viewer-relative styling), `fog.ts` (extend `FogView` to carry the visible decoys for the
team, so the client still derives no visibility itself), `renderer3d.ts` (a purple decoy style +
the enemy-Wisp style). Ruled in edge-cases (R2 rendering). **Out of scope:** decoy engine
behaviour (unchanged — it's already a separate `decoys` list); last-known ghosts.

### STATUS-AUDIT. Verify every buff/debuff end-to-end + surface it in the client (ENGINE tests + CLIENT) — UNBLOCKED (depends on FREE-UI, DECOY-RENDER for stealth)
**Addresses Dev Note: "Stealth and Slow are not working, audit to make sure all buffs and debuffs
work correctly."** The engine status math is correct (Slow shrinks `movementBudget`; Stealth hides
via `canSee`; durations tick at end of turn) — the failures are **surfacing** and the two upstream
bugs. *AC: (1) an engine regression test per status kind proving it changes a **resolved** outcome
— `slow` shortens a resolved Move, `haste` lengthens it, `weaken`/`might` change dealt damage,
`root` zeroes Move, `stealth` removes the unit from `visibleEnemiesForTeam`, `reveal` re-adds it,
`shield` absorbs, `energized` scales earned energy, `unstoppable` ignores displacement,
`untargetable` blocks being targeted; (2) the client shows a **visible indicator** on a unit
carrying a status (icon or tint) during Decision and playback, so a landed debuff is legible.*
**Spec Notes.** Engine: consolidate/extend `status.test.ts` + `resolve.test.ts` — most kinds have
partial coverage; the point is one clear per-kind end-to-end assertion. Client: promote **status
indicators** from "observed-not-requested" to scoped (a small billboarded icon row or a body
tint keyed to `unit.statuses`); read straight off the engine state, derive nothing. **Depends on
FREE-UI + DECOY-RENDER** for stealth specifically to *read* as working (Veil & Decoy is a free
ability; the decoy currently gives away the stealthed square). Out of scope: any status *rule*
change (raise separately if a rule is actually wrong — the audit's job is to prove/reveal, not
re-balance).

### FOG-ZORDER. Brush tiles must not occlude the aim/reach overlays (CLIENT render) — UNBLOCKED
**Addresses Dev Note: "The green stealth squares are STILL hiding aoe effect and movement options.
This needs to be fixed."** The green tiles are **brush** (`BOARD_COLORS.brush`); the highlight
layers lose the z-fight against the brush tile geometry. *AC: an aim/AoE overlay and a move/reach
envelope drawn over brush tiles are **fully visible** (not hidden by the green); brush is still
visually distinct; RENDER-VERIFY asserts a highlight over a brush square is drawn.*
**Spec Notes.** Files: `packages/client/src/renderer3d.ts` (raise the highlight layers above the
base board tiles — a small y-offset or explicit `renderOrder`/`depthTest` on the highlight meshes),
`app.ts` layer list `['fog','range','reach','aim','catalyst','select']`. **This is a WebGL layering
bug unit tests cannot see — verify via RENDER-VERIFY** (composite a frame with an AoE over brush
and assert the highlight pixels are present). Out of scope: changing brush *rules* or colour.

### DASH-PREVIEW. Preview a dash's impact area(s) while aiming (CLIENT) — UNBLOCKED
**Addresses Dev Note: "Shadowstep Strike needs to show what boxes are being hit, not just the box
of arrival."** (also Builder OQ 2026-08-27 #3). DASH-IMPACT shipped without a preview. *AC: aiming a
dash that carries `impact` paints the impact disc(s) — an `impact.destination` circle at the
**aimed landing square** and, if present, an `impact.origin` circle at the takeoff square — using
`circleSquares`, in a preview overlay; a dash with no `impact` is unchanged; a client test asserts a
dash with `impact:{destination:r}` paints an r-radius disc at the aimed square.*
**Spec Notes.** Files: `packages/client/src/targeting.ts` / `app.ts` (a client-side overlay reading
the ability's `impact` radii). **Do NOT overload `expandShape.a.area`** — it means "aimed area" at
plan time but the engine detonates at the *actual* rest square (a charge stopped short), so making
them the same field makes the preview lie. This is a **plan-time estimate** (aimed landing);
resolution playback already shows the true detonation. Ruled in edge-cases (DASH-PREVIEW). Out of
scope: engine change; previewing a normal ability aimed from a Shift landing (M3).

### PREVIEW-NUMBERS. Floating damage/heal/shield numbers on aim, before lock (CLIENT) — UNBLOCKED (new)
**Addresses Dev Note: "I want to implement Preview damage and healing and shielding done above the
character model when confirming action (before locking in). Players should know what their action
is going to do."** and **"It can show as a red (damage), green (healing) or blue (shielding) number
above the affected character's model."** *AC: while an action is aimed (pre-lock), each unit whose
square is in the action's area shows a floating number above its model — **red** for damage,
**green** for healing, **blue** for shielding — of the amount that action would apply to it; the
numbers clear on de-select/lock; polarity/targeting respects FF1 (a harmful action previews on
allies in-area too; a beneficial one only on allies); a client test asserts a damage ability aimed
at a unit shows a red number of the right amount.*
**Spec Notes.** Files: `packages/client/src/app.ts` / `renderer3d.ts` (billboarded text over the
affected units), reading the aimed `expandShape` area + the ability's effect `amount`s. **Derive
nothing new** — the amount is the ability's effect value (before Might/Weaken/cover, unless cheap
to include; keep it the *nominal* number for v1 and note it). Reuse the UI5 float-number machinery
if present. Out of scope: exact post-mitigation math (nominal is fine for a plan-time preview);
DoT/delayed previews.

## Blocked on Designer

### CAT-DASH-COST. Dash catalysts are not free actions (RULING → Designer, then ENGINE) — BLOCKED
**Addresses Dev Note: "Dash catalysts should not be free actions."** Reverses the CAT1 "Shift does
not consume Move" ruling for the Dash colour. **Blocked:** the Designer must rule the economy —
Analyzer recommendation (PROPOSED in edge-cases): a Dash catalyst competes with a dash ability and
**spends the Move** for its reposition (not additive); Prep/Blast catalysts stay free; confirm
whether Fade/Unshackle (no reposition) also lose additivity or only Shift. Once ruled: engine makes
Dash catalysts consume the relevant budget + a test; CAT2/HUD reflects it. Until then the shipped
fully-free behaviour stands. **Do not implement before the Designer rules.**

## Deferred — do NOT schedule

- **A4** per-ability FX — blocked on M3 + roster lock.
- **CL1/CL2/E2**, **flat `energy` effect kind**, **vision metric change**, **tunable cone angle**
  (ENGINE ASK if the Designer ever wants a non-45° cone) — not scheduled.
- **Optimistic move validation** (so a Blast-Haste can *extend* the same-turn walk; Builder OQ #8)
  — changes move semantics for every ability; revisit only if Overdrive reads weak in playtest.

## M3+ — the next milestone

21. Worker + DO rooms; **map + format selection lobby** (supersedes MAPTOGGLE) with **per-character
    catalyst selection** and **the CAT2 Shift teleport-preview / normal-ability-aimed-from-Shift-
    landing preview**; team-seat + **duplicate-pick validation (R3)**; per-player hidden submission
    → per-team orders; **per-team hidden information for fog (VISION1) and the combat log (UI6)** —
    the real security boundary the hot-seat only approximates; per-player timer + Time Bank; decoy
    fog; reconnect/replay; deploy to Pages + wrangler.

## Observed-not-requested / playtest (not Builder-blocking)

- **Ravok undertuned interim** — Bullrush knockback 2→1 is live and `impact` is now live too (PR
  #33), so this is resolved; re-check his three overlapping AoEs (Bullrush + Shockwave + Seismic
  Rupture) — if too much, cut Shockwave's radius, not Bullrush's.
- **8-tile melee cones** (four `range:2` kits) — owner approved; if oppressive prefer a damage cut.
  **Seismic Rupture at 29 tiles** (~11% of the map). **Cone raggedness** at shallow angles.
- **Overdrive's Haste** can't buy Move squares this turn (only offset a Slow) — watch if it reads
  weak. **Free-action / catalyst** feel: one free action per turn too tight? Shift as default Yellow
  (drop to 2)? Catalyst hoarding? **Kestrel** untested through MAPTOGGLE (8-of-9 dev draft).
- **Turn-1 spawn margin one tile** — hold `MAX_ABILITY_RANGE = 8` and the spawn columns.
