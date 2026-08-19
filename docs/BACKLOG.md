# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit.** **Drive the real UI wiring in tests, not just pure
functions** (the recurring "green-but-broken" lesson). **Open/update a PR to `main` every session.**

> ⚠️ **`main` is LIVE** — a green push publishes the Worker + client. Keep it green.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy.
- **PR #82 (this review) — the entire Dev Notes batch 3:** MENDING-RANGE, TIMER-EVERY-PHASE,
  **CASTER-SAFE + RECOIL**, **PHASE-STATUS-FIRST** (statuses batch then damage, simultaneity intact),
  **TRAP-CENTRE**, **TRAP-HALT**, **ALLY-SAFE**, **BRUSH-BREAK**, MODE-BASE-INVARIANT, DASH-FLOOR-GUARD,
  RESOLVE-PARTIAL, **TIMER-BAR**, LOBBY-BOUNDS, LOBBY-INSPECT, **LOBBY-READY**.

Current suite: **2124 tests** (949 + 900 + 275), typecheck + build clean.

## 🔧 OWNER ACTION (still open) — fix the deploy variable

- **`WORKER_ORIGIN` is set to the wrong value.** Correct it to **`cards-rooms.lockstepcards.workers.dev`**
  (GitHub → Settings → Secrets and variables → Actions → **Variables** → edit `WORKER_ORIGIN`), then
  re-run the Pages deploy. Until then the deployed client reaches no server.

### Build order and dependencies

**KESTREL-CONE → DASH-STATUS → PREVIEW-AUDIT → LOBBY-DETAIL-PANEL → ABLATIVE-40.** KESTREL-CONE and
PREVIEW-AUDIT overlap (mode/shape rendering) — do KESTREL-CONE first, it may share the fix. DASH-STATUS
is independent engine. Realistic one-session cut: KESTREL-CONE + DASH-STATUS + PREVIEW-AUDIT.

---

## Client — the cone bug (do first)

### KESTREL-CONE. Kestrel's Spread mode must resolve AND preview as a cone, not a line (CLIENT bug) — UNBLOCKED (first)
**Addresses Dev Note: "Kestrel's auto attack is not working as a cone at all, it's just a line. It
should be like Elle's auto attack from Atlas Reactor."** The data is correct — Twin Bolts `modes:
[Focus (line 6), Spread (cone 2)]` (Elle's wide-short cone ↔ thin-long line). So the **Spread mode is
not activating**: the client never offers/applies the toggle, or previews/sends mode 0 regardless.
*AC: selecting **Spread** resolves a `cone` range-2 attack AND previews it as a cone; **Focus** stays
line 6; the mode toggle is reachable in the HUD; a test **drives the real toggle** (not just
`abilityProfile`) and asserts the resolved order carries mode 1 and the preview cells are the cone.*
**Spec Notes.** Files: `packages/client/src/` (the AIM2 mode toggle in the HUD; the aim preview reading
the selected mode's profile; the order carrying `mode`). Root-cause whether the toggle exists and is
wired to both preview and commit — the pure `abilityProfile` is verified fine, so this is wiring. Out
of scope: engine `abilityProfile` (shipped, correct); new mode kinds.

## Engine — the Dash-debuff gap

### DASH-STATUS. Dash-phase abilities apply their status riders (ENGINE) — UNBLOCKED
**Addresses Builder OQ 2026-09-18 #3.** `runDash` applies damage and displacement but **no status
effects**, so **Bramble Stride's Root and Tempest Run's Slow reach nobody** — two shipped kits doing
less than their data says. *AC: a Dash-phase ability applies its **status** effects (root, slow, etc.)
to its victims, inside PHASE-STATUS-FIRST's status sub-step (statuses batch before Dash damage);
Bramble Stride roots its target and Tempest Run slows the units it hits; a test asserts each lands.*
**Spec Notes.** Files: `packages/engine/src/resolve.ts` (`runDash` — apply status effects like
`runBlast` does, in the status sub-step). Keep CASTER-SAFE/ALLY-SAFE filters. Deterministic; simultaneity
per PHASE-STATUS-FIRST. Out of scope: new statuses; Dash targeting rules.

## Client — the preview audit

### PREVIEW-AUDIT. Every ability's damage preview matches its resolution (CLIENT) — UNBLOCKED
**Addresses Dev Notes #1 and #3.** *#1: "Damage previews need to account for things like the center of
Cinder's Ember bolt and center of Bastion punch. Audit all skills to ensure damage preview is correct."
#3: "Aegis's auto attack does not have anything special about it. Make sure it shows in both description
and gameplay."* The preview does not surface centre/axis/beam differentials. *AC: **audit every
ability** — the aim preview's footprint and numeric tell match the engine's actual resolution for:
Cinder Ember Bolt (inner 22 / ring 14), Bastion Crushing Slam (axis +8 line), **Aegis Shield Bash
(`beamWidth: 3` constant 3-wide lane, not a plain cone — the named gap)**, DoT abilities, heal-vs-damage
tiles (Radiant Lash); the drawn footprint == the resolved footprint for each; a property-style test
asserts preview cells == resolved cells for every roster ability at a fixed aim.* **Spec Notes.**
Files: `packages/client/src/targeting.ts` (`previewBands`/`impactPreview`/`damageTell`) — drive the
footprint from `expandShape`/`axisSquares`/`innerSquares`/`coneSquares(beamWidth)` (engine-derived,
never a client re-guess). Aegis's description already reads "3-wide wall of force" — the gap is the
**preview/gameplay**, so verify the beam also **resolves** as a 3-wide lane. Cross-item: KESTREL-CONE
may share the mode-preview fix — do it first. Out of scope: rebalancing numbers (Designer).

## Client — the lobby detail panel

### LOBBY-DETAIL-PANEL. A persistent side panel with the selected character's full kit (CLIENT) — UNBLOCKED
**Addresses Dev Note: "When selecting a character in the lobby, the mouseover is going great, but it
should also expand into a bigger window on the side that shows a description of all the skills. There
is space on the left."** LOBBY-INSPECT shipped the hover tooltip; the owner wants a **persistent** panel
too. *AC: selecting (or hovering) a character in the lobby shows a **persistent side panel** (using the
**left-side** space) listing **all** of that character's skills with names + descriptions (+ HP/energy/
archetype); it stays until another character is selected; a test asserts the panel lists every ability
of the selected character.* **Spec Notes.** Files: `packages/client/src/` (the lobby view + a
side-panel component). Reuse the ability tooltip/description content (LOBBY-INSPECT's source) — no new
content. Out of scope: catalyst-triad editing; in-match HUD.

## Data — the shield tune

### ABLATIVE-40. Ablative Field shields 40, not 35 (DATA) — UNBLOCKED
**Addresses Dev Note: "Ablative shielding should shield for 40."** *AC: `data/catalysts.json`
`ablative_field` `amount: 35 → 40`; the description "Shield 35…" → "Shield 40…"; the content suite
stays green.* **Spec Notes.** One data edit; owner directive. Out of scope: other catalyst tuning.

## Routed to Designer / flags

- **Warding Halo's `weaken` applies to nobody (Builder OQ 2026-09-18 #4).** Prep has no enemy-facing
  branch, so after CASTER-SAFE the Weaken hits no one — a shield with a dead rider. **Designer's call:**
  add an enemy-facing Prep path (a real engine ask) **or** drop the Weaken from Aegis's data. Not the
  Analyzer's to guess.
- **Trap count cap (Builder OQ 2026-09-18 #1).** No per-team trap **count** cap exists (only
  `TRAP_MAX_LIFETIME`); ruled no cap in v1. **If playtest shows Thorn's auto-mine carpet is oppressive,**
  a count cap + eviction policy is a Designer decision; the interim lever is the mine's `amount` 8→0.
- **Beam + axisBonus** compose legally. **Chase-preview detour** deferred. **Decoy-as-universal-obstacle**
  / **host map control** / **public draft** — reversals, flag if wanted. **Dash melee-cover** (deferred).
  **Solar Flare DoT ceiling**, **snare control** (TRAP-HALT now shipped) — playtest.

## Flagged future (not scheduled)

- **NET-E2E** — a two-client Playwright harness against a running Worker; closes the lobby pixel
  coverage (OQ #7), the Kestrel mode toggle, and the presence marks in one harness.
- **M3-REMATCH**, **IDLE-KICK**, **LOBBY-TEAM-CHOICE**, **CAMO-E2E-FINISH** (low) — unchanged.

## Observed-not-requested / playtest (not Builder-blocking)

- **A real two-machine internet playtest** once `WORKER_ORIGIN` is fixed. **PHASE-STATUS-FIRST feel**
  (Dazzling Ray / Suppression as same-trade tools; watch mutual-Weaken trades), **CASTER-SAFE**
  (Ravok's whirl no longer self-harms — is he now too safe?), **BRUSH-BREAK** (getting shot in brush),
  **the timer bar**, **Thorn's mine carpet**, **Aegis's beam**.
