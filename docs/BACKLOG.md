# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit** — bug fixes ship the regression test in the same commit.
**A genuinely new mechanic gets a generic, reusable implementation** (golden rule #2). **DRIVE THE REAL UI
WIRING IN TESTS.** **PR to `main` every session.**

> ⚠️ **`main` is LIVE** — keep `npm test` green. **The Playwright e2e/render suite regressed to 7 red** from
> the Proving Grounds map rebuild (coordinate/format-coupled tests) — RENDER-SUITE-GREEN-3 restores it.

> 🎨 **Art / VFX / camera / colour reference (owner Dev Note 2026-08-21):** `docs/ART_PIPELINE.md`,
> `docs/MAP_PIPELINE.md`. **No engine change** for art/render — an apparent one is an `ENGINE ASK`. Camera
> and VFX are **pure view**. **Team/FoF colour is now viewer-relative** (edge-cases FOF-COLORS) — friend/foe
> from the viewer's seat is the global identity, replacing absolute team0/team1.

## ✅ COMPLETE

- Everything through session 16 + the TTK package + INTERCEPT-GUARD + DEATH-HANG-3 + CAMERA-CONTROLS +
  RENDER-SUITE-GREEN-2 + the VFX impact set.
- **PRs #148–#164 (map/render/VFX):** **COVER-EDGE** (directional edge cover — the AR half-wall: walk-on,
  can't cross the faced edge, 50% to the occupant across it, doesn't block LoS, melee ignores; one shared
  `geometry.ts` for movement + combat; iron-basin's full-block untouched; integer-exact, tested), **Proving
  Grounds** (duel-arena rebuilt 17×11, 2 spawns/side, 1v1/2v2, 180° rotational fairness), board material
  polish (chamfers, normal maps, contact shading, hashed jitter), VFX (Intercept blink, auras, impact
  particles/debris, the first ambient motion). Engine change was **COVER-EDGE only**, verified sound.

Current suite: **3219 unit tests** green, typecheck clean, purity clean. **Playwright render suite 7 red**
(the map rebuild — RENDER-SUITE-GREEN-3).

### Build order and dependencies

**FOF-UNITS → FOF-OVERLAYS → RENDER-SUITE-GREEN-3 → PAN-RELEASE-PLAYBACK → RENDER-IDLE-QUIET →
SETTLED-BOARD-INVARIANT.** FoF is the owner's ask and comes first; FOF-OVERLAYS reuses FOF-UNITS' viewer-
relative colour resolver, so it follows it; **RENDER-SUITE-GREEN-3 follows the FoF items** because it must
re-point the colour-family e2e predicates for the new FoF colours as well as the new map. The three camera/
render items are carried unchanged from 2026-10-04 (no Builder session ran that cycle). All client/test —
no engine work.

---

## HIGH — friend-or-foe colour (the owner's ask; the mirror-matchup solver)

### FOF-UNITS. Colour units by viewer-relative friend/foe, with a foot ring (CLIENT) — UNBLOCKED (first)
**Addresses Dev Note: "We want to solve for the issue of mirror matchups and identifying if it's friend or
foe. It should be similar to Atlas Reactor … 1. The Friend-or-Foe (FoF) Outline System … Your Team: … bright
blue (yourself) or green ring (ally) beneath their feet, blue outline highlights, and blue player
nameplates. The Enemy Team: … a bright red ring beneath their feet, red outline highlights, and red player
nameplates. This red tint remained consistent even if they were playing the exact same character as you."**
Ruled in edge-cases (FOF-COLORS). Today the client colours by **absolute team** (`team0=blue`, `team1=red`,
`renderer3d.ts:1645`), so a **team-1 viewer sees themselves red and the enemy blue** — the exact bug (see
also the `renderer3d.ts:2306` "only right when the viewer is team 0" comment).

*AC:*
- **A single viewer-relative colour resolver** decides, for any unit, one of three from the **viewer's
  seat**: **self (blue)** = a unit the viewer's seat controls; **ally (green)** = another unit on the
  viewer's team; **foe (red)** = the enemy team. Every place that currently reads `owner === 0 ? team0 :
  team1` for a unit routes through it. In a mirror (both teams the same character), the enemy still reads
  **red**.
- **A ring beneath each unit's feet** in its FoF colour (self blue / ally green / foe red), distinct from
  and beneath the existing selection ring and CHASE quarry ring (which keep their "this is the one you are
  ordering / chasing" meaning).
- **Model outline/tint and the nameplate** take the FoF colour (the nameplate's name/number band reads
  friendly-blue / foe-red from the viewer).
- **Fog and decoys compose unchanged:** a fogged enemy is not drawn; a decoy wears its impersonated unit's
  FoF colour **from the viewer** (fix the team-1-assuming decoy path at `renderer3d.ts:2306`).

**Spec Notes.** Files: `packages/client/src/renderer3d.ts` (the unit/decoy/trap tint at `:1645`/`:2272`/
`:2306`, a new foot-ring layer, the outline), `packages/client/src/nameplates.ts` + its draw (viewer-
relative band colour — `unitNameplate` already takes `viewer`), `packages/client/src/app.ts` (thread the
viewer's team — `currentSeat()?.team` — to the resolver). **The viewer's team already exists** (fog is
already viewer-relative); this reuses it, it does not invent a new source of truth. **Determinism guard:**
colour is pure view — it must not read into or write game state, and two clients on opposite teams resolve
the *same* board to mirrored colours without either being "wrong". **Test through the real wiring:** a unit
owned by the viewer's team renders friendly, an enemy renders foe, **and flipping the viewer's team flips
the colours** (the regression the bug is); the mirror case (same character both teams) still reads foe as
red. Out of scope: the overlay colours (FOF-OVERLAYS); the e2e colour predicates (RENDER-SUITE-GREEN-3);
changing the actual palette hues (blue/green/red already exist — team0/team1 are blue/red; green is the new
ally hue).

### FOF-OVERLAYS. Colour committed plans and AoE by friend/foe (CLIENT) — UNBLOCKED (after FOF-UNITS)
**Addresses Dev Note: "2. Ability Target Lines and Prediction Markers … Directional Arrows: … Blue lines
meant your ally was moving or aiming there; red lines tracked enemy placements and trajectories from the
previous turn. Blast Phase Overlays: Area-of-effect (AoE) templates were heavily color-coded so you
wouldn't confuse an ally's ultimate with an enemy mirror character's ultimate."** *AC:*
- **A committed teammate's plan reads friendly (blue)** — the ability line/area, move arrow and guard link
  that TEAMMATE-PLAN-VISIBLE already draws take the friendly FoF colour, and its **move arrow** reads as a
  friendly directional arrow.
- **Enemy telegraphs read foe (red)** — where the client shows what the enemy did last turn (their
  resolved placements/trajectories, already public), draw them in foe-red. **Confirm first what enemy
  last-turn info the client currently surfaces** — if none, scope this to what is cheaply available (e.g. a
  faded red trail of the enemy's last resolved move) and flag anything net-new rather than inventing a
  telegraph system; golden rule #5 keeps *this-turn* enemy plans hidden until resolution.
- **Blast/AoE templates for committed/telegraphed actions are FoF-coloured** so an ally's ult and an enemy
  mirror's ult are distinguishable at a glance.
- **The viewer's own in-progress aim is unchanged** — it keeps the meaning-coded palette (amber aim, blue
  range, etc.); only **committed** plans and **enemy** telegraphs take FoF colour.
- **A test through the real wiring:** a committed ally AoE renders friendly, an enemy telegraph/AoE renders
  foe; the viewer's own live aim is unchanged.

**Spec Notes.** Files: `packages/client/src/app.ts` (the teammate-plan draw — reuse FOF-UNITS' resolver for
the line/area/arrow colour; the AoE overlay colour for committed vs enemy), `renderer3d.ts` (the path/shape
layers). **Reuse FOF-UNITS' colour resolver** — one source of truth for friend/foe. **Designer-flagged
tension:** FoF overlay colours (blue/red) overlap the meaning-coded overlay vocabulary (AOE-CLASH /
OVERLAY-BY-THEME reserved amber=aim/AoE, blue=range, etc.). Keeping the viewer's *own live aim*
meaning-coded and only FoF-colouring **committed/telegraphed** overlays is the reconciliation this item
takes; if it still clashes on a real board, the exact hues/weights are a **Designer** call — flag, don't
guess a new palette. Out of scope: a full enemy-prediction/telegraph system (scope to what's already
public); the unit colours (FOF-UNITS).

---

## HIGH — restore the render signal (regressed by the map rebuild)

### RENDER-SUITE-GREEN-3. Re-point the coordinate/colour-coupled render tests (TEST INFRA) — UNBLOCKED (after the FoF items)
**Addresses the Proving Grounds regression.** The Playwright suite is 7 red, all reproducing on a clean
control: two boot `?map=duel-arena&format=4v4` (a setup error now — Proving Grounds has 2 spawns/side), the
rest hard-code screen fractions or assert "a mirrored pair of Health pads" against the old 18×15 layout.
*AC:* the render suite is green again; the fixes are **test-side** (re-point coordinates/formats to Proving
Grounds; the pad assertions to its single-column pads), not production changes to satisfy stale assertions.
**Also update the colour-family predicates** (`isTeamBlue`/`isTeamRed`, `e2e/pixels.ts`) to the **viewer-
relative** FoF semantics FOF-UNITS/FOF-OVERLAYS introduce (`isFriendly`/`isFoe`), which is why this follows
them. **Spec Notes.** Files: `packages/client/e2e/*`. Keep production behaviour fixed. Out of scope: new
visual assertions; the retired UI-VIEWPORT framing check (correctly gone). This is a pre-merge signal, not a
release gate (Pages gates on CI, which is green) — but a green baseline is the point.

---

## Carried from 2026-10-04 — camera/render polish (no Builder session ran that cycle)

### PAN-RELEASE-PLAYBACK. Resolution playback follows the action; a planning pan releases (CLIENT) — UNBLOCKED
**Addresses Builder session-16 OQ #1.** Resolution playback follows the action (a planning-time **pan**
releases so `focusOn` drives the centre through each actor/impact; orbit rotation and zoom persist);
planning resumes auto-centred on the active character. Test: pan during planning, resolve, assert the centre
follows the resolution's focus, orbit/zoom unchanged. **Spec Notes.** `app.ts` (release the pan on the
planning→resolution transition, before the first playback `focusOn`). Playtest can reverse it if a released
camera reads as lost control. Full rationale in `docs/reviews/2026-10-04.md`.

### RENDER-IDLE-QUIET. An idle board stops re-issuing render commands (CLIENT) — UNBLOCKED
**Addresses the RENDER-ON-DEMAND finding.** On-demand is the default, but the **app** re-issues ~49 camera
marks + 15 highlights over 5 idle seconds, so the loop can't quiet the board. *AC:* over a settled idle
board, the app issues no render marks and the loop draws no new frames. **Spec Notes.** The counts point at
the camera ease first (confirm it terminates and un-marks); guard `highlight`/`focusOn` re-issued with
unchanged inputs. **Pure queries must not mark** (`screenPosition` runs per frame). The app-side half
RENDER-ON-DEMAND shipped as a prerequisite for — not new scope.

### SETTLED-BOARD-INVARIANT. A named test that an idle board is byte-stable (TEST, LOW) — UNBLOCKED (after RENDER-IDLE-QUIET)
**Addresses Builder session-16 OQ #4.** Three `same()` callers (the ambient guard + two motion assertions)
depend on an idle board being byte-identical; write it down as a named test so a missed `markDirty()` fails
clearly. Depends on RENDER-IDLE-QUIET (the property must hold first).

## 🎮 PLAYTEST — the standing validation loop (owner + humans)

Confirm DEATH-HANG-3 in a live networked game; feel-read the character-centred camera + VFX impact; and now
the **new Proving Grounds map and COVER-EDGE** — do directional half-walls read (you can see over but not
shoot/walk across the faced edge), does the tighter 17×11 board play better than the old stadium, and does
FoF colour actually make a mirror legible. Standing balance watch-list continues (TTK burst, 20-turn pacing,
Skim/Chain Hook/Lumen, RAVOK-RECOIL, clock-vs-kills). Output: felt problems → Dev Notes.

## Routed to Designer / Owner / flags

- **FoF overlay colours vs the meaning-coded palette (Designer, from FOF-OVERLAYS).** If FoF blue/red on
  committed overlays clashes with the reserved overlay vocabulary on a real board, the hues/weights are the
  Designer's to settle — flagged, not guessed.
- **The map lane crossed into `packages/engine` for COVER-EDGE.** It shipped clean and tested, so no action
  — noting that a genuine engine mechanic came through the map session rather than a Builder/ENGINE-ASK path.
- **Camera-follow-on-select** (one-line lever if the playtest wants it); **zoom beyond wheel**; **intent
  badge name vs digit**; **ASSET-BUDGET caps + CLIP-DEDUP (§18)**; **300 kB JS budget headroom**;
  **CHASE-SECOND-CLOCK; NET-E2E-EXPAND-2; DO-E2E; RAVOK-RECOIL; Warding Wall power; Skim/Chain Hook;
  FRAG-SELF zoning; WALL-BLINK-ONTO; INTERCEPT shield lever; Aegis beam distinctness; self-lethal recoil
  warning; burn/regen pip glyphs; Warding Halo dead `weaken`; trap count cap; inspect chips hoverable; Solar
  Flare DoT ceiling; Thorn mine carpet** — unchanged flags.

## Flagged future (not scheduled)

- **The rest of the VFX pipeline** (projectiles/casts/status VFX; more ambient motion). **The other eight
  characters' art** (gated on CLIP-DEDUP). **A second COVER-EDGE consumer** (iron-basin could adopt
  directional cover if the owner wants — not scheduled). **M3-REMATCH, IDLE-KICK, LOBBY-TEAM-CHOICE**;
  **same-turn-buff preview**; **route-around-bodies dash impact preview**.
