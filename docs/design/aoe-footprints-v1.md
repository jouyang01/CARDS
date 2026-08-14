# aoe-footprints-v1.md — ability geometry: cones, circles, and dash impact (Designer)

**Date:** 2026-08-14 · **Status:** RULED (cones approved by the owner; the rest ruled here).
Answers backlog **HITBOX-tune**, sets the **CONE-B** ramp, rules the **aiming metric**, and
adds **dash impact areas**. Companion to the HITBOX1 / CONE-B / MET1 rulings in `edge-cases.md`.

Every number below was **measured against the shipped engine** (`coneSquares` /
`circleSquares` on an empty 41×41 board), not derived from prose.

---

## 1. Measurements

### 1.1 Cones — the inflation is in the LENGTH, not the width

| Direction | r1 | r2 | r3 | r4 | furthest tile @ r4 | max reach @ r4 |
|---|---|---|---|---|---|---|
| **axis-aligned (E)** | **3** | **8** | **15** | **24** | 5.66 | **4 tiles** |
| diagonal (NE) | 3 | 12 | 25 | **42** | 7.07 | **7 tiles** |
| 2:1 | 2 | 7 | 15 | 26 | 6.08 | 6 |
| 3:1 / 1:3 | 2 | 7 | 13 | 23 | 5.83 | 5 |

**A range-4 cone reaches 4 tiles on the axis and 7 on the diagonal.** That is the whole story:
range is metered as a **count of lattice steps along the axis**, so a diagonal "range 4" is 4
*diagonal* steps = 5.66 tile-widths. Length inflates by √2, and since a cone's area scales with
length², the footprint inflates by ~2× — measured, 24 → 42 tiles (1.75×).

**This corrects an earlier reading.** The width ramp (§3) is necessary but **not sufficient**:
if axial depth keeps being counted in lattice steps, the diagonal cone stays 41% longer no
matter what the half-width says, and CONE-B's ±1 rotation-invariance AC is unreachable.

### 1.2 Circles — the full HITBOX1 growth

`circleSquares` tests `4·(dx²+dy²) ≤ (2r+1)²` — a tile is hit if its centre is within Euclidean
**r + 0.5**. The half-tile is *added on top of* the authored radius:

| radius | pre-HITBOX1 (Manhattan disc) | **current** | growth |
|---|---|---|---|
| r1 | 5 | **9** | +80% |
| r2 | 13 | **21** | +62% |
| r3 | 25 | **37** | +48% |

---

## 2. The metric ruling — aiming is Euclidean, movement stays Manhattan

Both problems above share one root cause: **lattice-step metering applied to projected
geometry.** MET1 made everything Manhattan, which is right for walking and wrong for aiming.

> **RULED — Movement is measured in STEPS; aiming is measured in DISTANCE (Designer,
> 2026-08-14). All ability geometry is Euclidean:**
>
> | What | Metric | Change |
> |---|---|---|
> | `line` range | **Euclidean** tile-widths along the axis | was a lattice-step count |
> | `cone` range (axial depth) | **Euclidean** tile-widths along the axis | was a lattice-step count |
> | `cone` half-width | **Euclidean** perpendicular distance (§3) | CONE-B, as ruled |
> | `circle` / `square` **aim range** | **Euclidean** to the aimed square | was Manhattan |
> | `circle` **radius** | **Euclidean** (§4) | was Manhattan pre-HITBOX1 |
> | dash `impact` radii | **Euclidean** (§5) | new |
> | **`path` dash length** | **unchanged — movement steps** (Manhattan, diagonal = 2) | a walked charge *is* movement |
> | **Movement / sprint / reachability** | **unchanged — MET1 stands** | 4 and 8 stay as tuned |
>
> **Why the split is principled, not a compromise.** Movement is a *lattice walk*: you step
> tile to tile, the step is the atom, and a step-count metric is the rule itself. Aiming is
> *projected geometry*: you point a continuous shape into the world, and it should describe
> the same shape whichever way it points. Conflating the two is what produced both bugs — and
> it is also how Atlas Reactor works, where abilities are authored as continuous shapes
> (cones in degrees, ranges in squares) over a tile grid, so rotation preserves area for free.
>
> **Determinism is unaffected.** Every test stays an integer squared-distance comparison
> (`dx² + dy² ≤ r²`) in the existing ×2 lattice — no trig, no `Math.sqrt`, no floats. The AIM2
> no-trig guard still passes.
>
> **Out of scope, flagged:** vision is also a Manhattan radius (a diamond) under MET1. The same
> axis-bias argument applies, but vision is perception, not aiming, and changing it moves
> concealment balance — a separate owner call, not folded in here.

### 2.1 The one balance consequence — aim ranges get slightly more generous

Making `circle`/`square` aim range Euclidean turns the aimable region from a diamond into a
disc. **Axial reach is identical**; only near-diagonal aiming improves:

| aim range | Manhattan (now) | Euclidean (ruled) | delta |
|---|---|---|---|
| 3 | 25 | 29 | +4 |
| 4 | 41 | 49 | +8 |
| 6 | 85 | 113 | +28 |
| 8 | 145 | 197 | +52 |

This is a real buff to where grenades, heals and traps may be placed — symmetric for both
teams, and it *removes an arbitrary restriction* rather than adding reach. Directional shapes
move the other way: a range-8 line stops reaching 11.3 tile-widths on the diagonal and reaches
8 in every direction, which is a **nerf to diagonal lines and the point of the exercise.**

---

## 3. Cones — CONE-B ramp, plus Euclidean axial range

**Owner has approved the axis-aligned footprint (3 / 8 / 15 / 24). No cone data changes.**

Per-depth widths measure 3, 5, 7, 9 — exactly `2d+1` — which pins the ramp:

> **RULED — `halfWidth(d) = d` (Designer, 2026-08-14).** A tile is in-cone iff its centre is
> within axial range **and** its perpendicular distance to the axis is **≤ d tiles**, where
> *d* is its axial depth. Reproduces today's approved footprint exactly:
>
> | depth d | half-width | tiles at depth (2d+1) | cumulative |
> |---|---|---|---|
> | 1 | 1 | 3 | **3** |
> | 2 | 2 | 5 | **8** |
> | 3 | 3 | 7 | **15** |
> | 4 | 4 | 9 | **24** |
>
> No ramp table and no division — the test is `perp² ≤ d²` in HITBOX1's ×2 lattice.

> **RULED — Axial depth and range are EUCLIDEAN tile-widths, not lattice steps (Designer,
> 2026-08-14; supersedes the "range is a tile count along the axis" half of the MET1×AIM2
> ruling for `line` and `cone`).** A cone or line of range r reaches **r tile-widths** in every
> direction. Without this the ramp alone cannot deliver rotation invariance — see §1.1.
>
> **Acceptance:** axis-aligned counts stay 3 / 8 / 15 / 24, **and** every quantized rotation
> lands within ±1 of them, **and** the furthest covered tile is within ±0.5 tile-widths of the
> axis-aligned figure in every direction (today the diagonal reaches 7 tiles against the
> axis's 4 — that second check is the one that would have caught this).

---

## 4. Circles — fix the rule, because the data cannot

HITBOX-tune says to lower `radius` until footprints shrink. For circles that is
**arithmetically impossible** — `radius` is an integer and the steps are far too coarse:

| radius | keep it | drop by 1 | target (pre-HITBOX1) |
|---|---|---|---|
| r2 | 21 (**+62%**) | 9 (**−31%**) | **13** |
| r3 | 37 (**+48%**) | 21 (**−16%**) | **25** |

No integer lands on target. The prescribed data pass would churn thirteen abilities to arrive
somewhere still wrong. The cause is not the metric — it is that **the half-tile hitbox is
added on top of the authored radius**: `radius: 2` is drawn as a disc of radius 2, then granted
another half-tile, for a true reach of 2.5.

> **RULED — An authored `radius` is the FINAL footprint radius, not the pre-hitbox region
> radius (Designer, 2026-08-14).** `radius: r` means "this reaches r tiles." The engine derives
> the region as **r − 0.5**, so composing HITBOX1's half-tile returns exactly **r**.
>
> **HITBOX1's rule is untouched** — the hitbox-intersection test and the halfway guarantee both
> stand. Only what region an authored number denotes changes. A tile exactly r away is still
> included (its hitbox is tangent to the region).
>
> **Implementation:** `4·(dx²+dy²) ≤ (2r+1)²` becomes **`dx² + dy² ≤ r²`**. Simpler than what
> it replaces, still pure integer. The scan bound drops from `radius + 1` to `radius`.
>
> | radius | pre-HITBOX1 | current | **after fix** |
> |---|---|---|---|
> | r1 | 5 | 9 | **5** ✅ exact |
> | r2 | 13 | 21 | **13** ✅ exact |
> | r3 | 25 | 37 | **29** (+4) |
>
> **12 of the roster's 13 circles land exactly on their pre-HITBOX1 footprint.** The 13th is
> Ravok's r3 ultimate at +4 — accepted, and still 8 smaller than today.

**This also resolves the MET1-vs-HITBOX1 conflict**: MET1 said `circle`/`square` measure
Manhattan; HITBOX1's circular hitbox made circles Euclidean discs. §2 rules Euclidean and marks
MET1's circle clause superseded, so the two rulings stop disagreeing.

### The principle both §3 and §4 establish

**A number in `data/` means the footprint you get.** Authored values are the final reach and
the engine derives whatever internal region produces it. The alternative — data holding
pre-composition values the engine then inflates — is exactly how thirteen circles silently grew
48–80% without anyone editing a file.

---

## 5. Dash impact areas — leaps that land with a bang

**Addresses the owner's ask:** *"some dashes should also have hitboxes, not just the singular
square — Rask's dash in AR and Garrison's Jump and landing all have AoE."*

Today a dash affects either the **first unit crossed** (walked `path` charge, per R1a /
`chargeHits`) or **units adjacent to the landing** (`square` teleport-strike, Manhattan-1 per
MET1-tp — a hardcoded special case with exactly one user). Neither expresses "leap into the
middle of them and detonate."

> **`ENGINE ASK` / RULED — Optional `impact` on dash abilities (Designer, 2026-08-14).**
>
> ```json
> "impact": { "origin": 1, "destination": 2 }
> ```
>
> Both members optional, integers ≥ 1, **Euclidean radii** (§2), reusing `circleSquares` — so
> this adds **no new geometry code**.
>
> - **`destination`** — an AoE centred on the square the dasher comes to rest on (after
>   pass-through/stop resolution for `path`, or the landing square for `square`). The *landing*.
> - **`origin`** — an AoE centred on the square the dasher started the turn on. The *takeoff*.
> - **Composes with both dash models.** A walked `path` charge still hits the first unit
>   crossed *and* detonates where it stops; a `square` teleport lands and detonates.
> - **Effects apply to the union**, each unit affected **at most once** — a unit caught by both
>   the charge and the landing area takes the ability's effects a single time. Consistent with
>   the existing once-per-use conventions.
> - **Polarity and energy unchanged:** FF1 polarity filters who each effect touches; energy is
>   still once per use and still requires ≥1 enemy.
> - **Absent `impact` = today's behaviour exactly** — fully backwards compatible.
> - **Validation:** `impact` is legal only on `phase: "dash"`; radii integers ≥ 1; reject
>   otherwise (same shape as the `chargeHits` validation).
>
> **Architectural win — a special case becomes data.** Shadowstep Strike is the **only**
> `square` dash in the roster carrying a `damage` effect (audited), so it is the sole user of
> the hardcoded Manhattan-1 teleport-strike adjacency. Once it carries
> `impact: { destination: 1 }`, that branch has no other user and **can be deleted** — the
> adjacency stops being engine trivia and becomes a tunable number.

### 5.1 Worked profiles

| Profile | Shape | `impact` | Reads as |
|---|---|---|---|
| **Charge** (today) | `path` | — | Run through them, hit the first body |
| **Charge-and-detonate** | `path` | `{ destination: 2 }` | Run in, stop, shockwave |
| **Leap** (Rask) | `square` | `{ destination: 2 }` | Fly over terrain, land in the middle of them |
| **Jump** (Garrison) | `square` | `{ origin: 1, destination: 1 }` | Blow up where you left *and* where you arrive |
| **Peel-arrival** | `square` | `{ destination: 1 }` | Arrive and shield everyone around you |

### 5.2 Roster application — three abilities

| Ability | Change | Why |
|---|---|---|
| **Wisp — Shadowstep Strike** | `impact: { destination: 1 }` | **Zero behaviour change** — formalises the hardcoded adjacency so the engine branch can go. |
| **Aegis — Intercept** | `impact: { destination: 1 }` | The Bodyguard fantasy, finally delivered: today Intercept shields only Aegis, so "teleport to the ally being dived" arrives with nothing for them. Now the 12-shield lands on allies at the destination too. |
| **Ravok — Bullrush** | `impact: { destination: 2 }`, knockback **2 → 1** | The charge-and-detonate profile: run through the first body, then shockwave where you stop. This is the Rask fantasy on the kit built for it — Ravok's whole identity is hitting everyone adjacent. Knockback drops to 1 because it now applies to an area; the roster's displacement budget (§4 of `roster-v1.md`) allows one displacement ≥2 per kit and Bullrush was already spending it. |

Deliberately **not** changed: Bastion's Ram Charge (single-target hook setup is his identity),
Kestrel's Skim and Tempest Run (the dodge *is* the poke; `chargeHits: "all"` already covers the
ult), Thorn's Bramble Stride, and every pure-escape dash (Blink, Combat Roll, Backdraft,
Glimmer Step, Shift) — an escape that also deals AoE is not an escape, it is an engage.

**Interim, documented not silent:** until the engine reads `impact`, all three read as they do
today except Ravok's knockback, which drops to 1 immediately — **weaker than designed, never
stronger**, the convention `chargeHits` and `free` already ship under.

---

## 6. What this means for the backlog

- **CONE-B** — scope **grows slightly**: the ramp (§3) *and* Euclidean axial range (§2). Both
  are the same integer squared-distance comparison, so it is not more code — but the ±1 AC is
  unreachable without the second half, and the acceptance test needs the reach check in §3.
- **HITBOX-tune** — **no data changes needed.** Cones are approved as they stand and circles
  are fixed at the rule level. Suggest re-scoping to **CIRCLE-FIX** (engine, one line + tests)
  and closing the data half — that removes a thirteen-ability balance pass from the batch.
- **New: AIM-METRIC** (engine) — `line`/`cone` range and `circle`/`square` aim range become
  Euclidean. Touches `shapes.ts` and the range validation in `resolve.aimIsLegal`. Ships with
  a rotation-invariance test over all four shape families.
- **New: DASH-IMPACT** (engine) — the `impact` block, plus deleting the hardcoded teleport-
  strike adjacency once Shadowstep carries its own. Ships with the three data edits.
- **Sequencing:** AIM-METRIC → CONE-B → CIRCLE-FIX → DASH-IMPACT. The metric ruling is the
  foundation; CONE-B and CIRCLE-FIX are its two consumers; DASH-IMPACT reuses the fixed circle.

## 7. Playtest questions

1. **Are 8-tile melee cones right?** Four kits share `cone range 2` and all four doubled from
   4 to 8 tiles under HITBOX1. Owner has approved the size; if melee feels oppressive, prefer
   a damage cut to `range 2 → 1` (8 → 3 tiles is a cliff).
2. **Do the more generous aim ranges (§2.1) show up?** Watch grenade and heal placement at
   ranges 6–8, where the diamond→disc change is largest.
3. **Is Ravok's charge-and-detonate too much** on top of Shockwave and Seismic Rupture? He now
   has three overlapping AoEs. If so, the fix is dropping Shockwave's radius, not Bullrush's.
4. **Is Seismic Rupture at 29 tiles too much** on a 270-tile map (~11% of the board)?
5. **Does ±1 rotation invariance hold at every quantized step**, or only the 8 compass
   directions? The shallow-angle rows in §1.1 (2 tiles at r1) suggest thin cones lose a tile
   near the apex, which may read as a miss.
