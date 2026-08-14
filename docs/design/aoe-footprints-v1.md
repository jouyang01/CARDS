# aoe-footprints-v1.md — cone and circle footprints after HITBOX1 (Designer)

**Date:** 2026-08-14 · **Status:** RULED (cones approved by the owner; circles ruled here).
Answers backlog **HITBOX-tune** and sets the **CONE-B** ramp. Companion to the HITBOX1 and
CONE-B rulings in `edge-cases.md`.

Every number below was **measured against the shipped engine** (`coneSquares` /
`circleSquares` on an empty 41×41 board), not derived from prose.

## 1. Measurements

### Cones — the off-axis inflation CONE-B fixes

| Direction | r1 | r2 | r3 | r4 |
|---|---|---|---|---|
| **axis-aligned (E)** | **3** | **8** | **15** | **24** |
| diagonal (NE) | 3 | 12 | 25 | **42** |
| 2:1 | 2 | 7 | 15 | 26 |
| shallow 3:1 / steep 1:3 | 2 | 7 | 13 | 23 |

A range-4 cone covers **24 tiles axis-aligned and 42 on the diagonal — 75% more for the same
number.** That is the bug, and it confirms the Builder's framing: the axis-aligned column is
the real reach, the diagonal column is inflation.

### Circles — the full HITBOX1 growth, unmitigated

`circleSquares` currently tests `4·(dx²+dy²) ≤ (2r+1)²` — i.e. a tile is hit if its centre is
within Euclidean **r + 0.5**. The half-tile is *added on top of* the authored radius:

| radius | pre-HITBOX1 (Manhattan disc) | **current** | growth |
|---|---|---|---|
| r1 | 5 | **9** | +80% |
| r2 | 13 | **21** | +62% |
| r3 | 25 | **37** | +48% |

## 2. Cones — CONE-B approved, ramp specified

**Owner has approved the axis-aligned footprint (3 / 8 / 15 / 24). No cone data changes.**
CONE-B's job is only to make every rotation match that column.

Reading the per-depth widths off the measurement — 3, 5, 7, 9 — the cone is exactly **2d+1
tiles wide at axial depth d**, which pins the ramp:

> **RULED — The CONE-B half-width ramp is `halfWidth(d) = d` (Designer, 2026-08-14).** A tile
> at axial depth *d* is in-cone iff its centre is within axial range **and** its perpendicular
> distance to the axis is **≤ d tiles**. This is the ramp that reproduces today's axis-aligned
> footprint exactly:
>
> | depth d | half-width | tiles at that depth (2d+1) | cumulative |
> |---|---|---|---|
> | 1 | 1 | 3 | **3** |
> | 2 | 2 | 5 | **8** |
> | 3 | 3 | 7 | **15** |
> | 4 | 4 | 9 | **24** |
>
> Because the half-width is a **distance** and grows linearly with depth, the wedge is the
> same shape under every rotation — which is the whole point of option (b).
>
> **Determinism:** `halfWidth(d) = d` needs no ramp table and no division — the test is the
> integer comparison `perp² ≤ d²` in the same ×2 lattice HITBOX1 uses, with `perp` the
> integer cross-product. No trig, no `Math.sqrt`; the AIM2 no-trig guard still passes.
>
> **Acceptance:** axis-aligned counts stay exactly 3 / 8 / 15 / 24, and every quantized
> rotation lands within ±1 of them (today the diagonal is +18 at range 4). If `halfWidth(d) =
> d` cannot hit ±1 at some rotation, **the ramp is the knob to turn, not the tile counts** —
> come back to the Designer rather than adjusting ability ranges.

## 3. Circles — the fix is the rule, because the data cannot do it

### Why HITBOX-tune's data lever fails here

HITBOX-tune says to lower `range`/`radius` until footprints come back to their old size. For
circles that is **arithmetically impossible**: `radius` is an integer, and the steps are far
too coarse.

| ability radius | keep it | drop it by 1 | target (pre-HITBOX1) |
|---|---|---|---|
| r2 | 21 tiles (**+62%**) | 9 tiles (**−31%**) | **13** |
| r3 | 37 tiles (**+48%**) | 21 tiles (**−16%**) | **25** |

There is no integer that lands on the target. Every circle in the roster is either far too big
or noticeably too small — so a data pass cannot deliver what the owner asked for, and would
churn thirteen abilities to arrive somewhere still wrong.

### The actual cause, and the one-line fix

The growth is not the metric — it is that **the half-tile hitbox is added on top of the
authored radius**. `radius: 2` is drawn as a disc of radius 2, then HITBOX1 grants every tile
within another half-tile, so the real reach is 2.5.

> **RULED — An authored `radius` is the FINAL footprint radius, not the pre-hitbox region
> radius (Designer, 2026-08-14; backlog HITBOX-tune, circle half).** `radius: r` means "this
> reaches r tiles." The engine derives the continuous region as radius **r − 0.5**, so that
> composing HITBOX1's half-tile hitbox brings the effective reach back to exactly **r**.
>
> **HITBOX1's rule is untouched** — the hitbox-intersection test and the halfway guarantee
> both stand. What changes is only what continuous region an authored number denotes. A tile
> whose centre is exactly r away is still included (its hitbox is tangent to the region), so
> the halfway rule reads the same.
>
> **Implementation** (`shapes.circleSquares`): the test `4·(dx²+dy²) ≤ (2r+1)²` becomes
> `dx² + dy² ≤ r²`. Simpler than what it replaces, still pure integer, no sqrt. The `span`
> scan bound drops from `radius + 1` to `radius`.
>
> **Result — measured:**
>
> | radius | pre-HITBOX1 | current | **after fix** |
> |---|---|---|---|
> | r1 | 5 | 9 | **5** ✅ exact |
> | r2 | 13 | 21 | **13** ✅ exact |
> | r3 | 25 | 37 | **29** (+4) |
>
> **Twelve of the roster's thirteen circles land exactly on their pre-HITBOX1 footprint.** The
> thirteenth is Ravok's r3 ultimate Seismic Rupture at +4 tiles, which is accepted as-is: an
> ultimate that reads "stand in the middle of them and detonate" is the one place a little
> generosity is on-theme, and it is 8 tiles smaller than today.

### Design principle this establishes

**A number in `data/` means the footprint you get.** Authored values are the final reach, and
the engine derives whatever internal region produces it. The alternative — data holding
pre-composition values that the engine then inflates — makes every balance number a puzzle,
which is exactly how thirteen circles silently grew 48–80% without anyone editing a file.
The CONE-B ramp in §2 follows the same principle.

### A latent conflict this resolves — Analyzer, please note

MET1 rules that **"target-square shapes (`circle`, `square`) use MANHATTAN distance to the
aimed square"**, but HITBOX1's circular hitbox test made circles **Euclidean discs** in
practice. Both rulings are live and they disagree; nobody has been wrong to follow either.

**Recommendation: circles are Euclidean, and MET1's circle clause is superseded** — which is
what the fix above implements. Reasons, in order:

1. HITBOX1's hitbox is itself a **circle**. A circular region composed with circular hitboxes
   is rotation-invariant by construction — the very property CONE-B is being built to restore
   for cones. A Manhattan diamond has axis bias baked in, which is the class of bug we are
   removing, not adding.
2. A thing called a circle should look like one in the 3D renderer.
3. It restores r1 and r2 exactly, covering 12 of 13 circles.

**If the owner prefers strict MET1 consistency instead**, the alternative is a Manhattan test
(`|dx| + |dy| ≤ r`), which restores **all three** counts exactly — 5 / 13 / **25** — and is
the same size of change in the other direction. It is a better fit for r3 and a worse fit for
the geometry; the choice is the owner's, and either way **one of the two rulings must be
marked superseded** rather than left in quiet conflict.

## 4. What this means for the backlog

- **CONE-B** — unchanged in scope; §2 supplies the ramp it was waiting on.
- **HITBOX-tune** — **no data changes are needed.** Cones are approved as they stand, and the
  circle problem is fixed at the rule level in §3. Suggest re-scoping the item from "lower
  `range`/`radius` in `data/characters/*.json`" to "**CIRCLE-FIX** (engine, one line +
  tests)", and closing the data half. This removes a thirteen-ability balance pass from the
  batch and leaves `data/characters/*.json` untouched — verify by re-running the
  `content.test.ts` turn-1 spawn-safety guard, which a smaller footprint only loosens.
- **Tests the fix needs** (golden rule #3): the three measured counts (r1=5, r2=13, r3=29) as
  a regression, and a cross-engine determinism case since the comparison changed.

## 5. Playtest questions

1. **Are 8-tile melee cones right?** Four kits share `cone range 2` (Crushing Slam, Cleave,
   Dagger Flurry, Shield Bash) and all four doubled from 4 to 8 tiles under HITBOX1. The owner
   has approved the size; this is the first thing to look at if melee feels oppressive, and
   the lever is `range 2 → 1` (8 → 3 tiles), which is a big step — prefer damage first.
2. **Is Seismic Rupture at 29 tiles too much** on a 270-tile map? It is ~11% of the board.
3. **Does the ±1 rotation invariance actually hold** at every quantized step, or only at the
   8 compass directions? The shallow-angle rows in §1 (2 tiles at r1) suggest thin cones lose
   a tile near the apex; that may read as a miss to players.
