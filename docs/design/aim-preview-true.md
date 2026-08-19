# aim-preview-true.md — `AIM-PREVIEW-TRUE`: one shape that cannot lie (Designer)

**Date:** 2026-08-17 · **Status:** RULED, owner-flagged **VERY IMPORTANT** · **Scope:** client
(engine unchanged; one optional engine export). Addresses the owner's report verbatim:

> *"Right now it feels like there's the highlight preview + the squares that get affected,
> and it feels different."*

## 1. The diagnosis

The client draws **two objects that cannot agree**: a smooth continuous shape (the AIM2
free-rotation graphic) and the `expandShape` tile fill. Under HITBOX1 a tile is hit when the
ability's region touches the tile's **central circle of radius ½** — not when the region
covers the tile — so tiles legitimately light up to half a tile *outside* the drawn
silhouette, and slivers of the silhouette cover tiles that don't light. The graphic depicts
the *input region*; the tiles are the *answer*. They are different shapes, and the eye
correctly reports it.

## 2. The ruling — draw the predicate, not the region

> **RULED — The aim preview's continuous graphic is the analytic boundary of the engine's own
> tile-centre predicate, so that a tile is hit *iff its centre is inside the drawn shape*.
> Exactly, for every shape, at every rotation.**

Every shape's tile selection is an integer predicate over the tile centre. The truthful
graphic is that predicate's locus, drawn in continuous space. Verified against the shipped
engine, the boundary per shape is:

| Shape | Shipped predicate (tile centre `p`) | **Truthful drawn boundary** |
|---|---|---|
| `circle` (radius r) | `dx² + dy² ≤ r²` (CIRCLE-FIX folded the hitbox into the authored number) | **A circle of radius exactly r** — the authored number, drawn as-is |
| `cone` (CONE-B ramp) | *"inside the wedge, or within half a tile of it"* (`wedgeCovers` — hitbox-composed) | **The wedge inflated by ½ tile**: edges offset outward by ½, apex and far corners rounded with radius-½ arcs (the Minkowski sum with the half-tile disc) |
| `cone` + `beamWidth` | same, over the constant-width lane (`beamCovers`) | **The lane inflated by ½**: a rounded-corner rectangle |
| `line` | degenerate zero-width wedge, same ½ grace | **A capsule of half-width ½** around the axis segment |
| `modes` (Kestrel) | each mode's own profile | Each mode draws **its own** boundary; the toggle switches graphics with the profile |
| dash `impact` | `circle` at origin/destination | Same circle rule, centred on the previewed landing |

The mathematical identity doing the work: *region touches a ½-circle at p* ⟺ *p lies within
½ of the region* ⟺ *p is inside region ⊕ disc(½)*. The inflated shape is not an
approximation of the rule — it **is** the rule, restated in continuous space. Against it,
"tile lights iff centre inside" holds with no exceptions, which is precisely the congruence
AR's hand-tuned targeter art achieved per ability; ours falls out of three formulas.

## 3. Acceptance criteria

1. **Congruence (the test that is the point):** for every shipped ability shape — circle,
   cone, beam, line, both Kestrel modes, dash impact — and a sweep of quantized rotations
   (reuse the AIM2 step sweep), the lit tile set from `expandShape` equals **exactly** the
   set of tiles whose centres fall inside the drawn boundary. No tile outside, none missing
   inside. This test doubles as a regression guard on HITBOX1/CONE-B/CIRCLE-FIX geometry.
2. **The boundary is generated from the ability's engine parameters** (`range`, `radius`,
   the `halfWidth(d)=d` ramp, `beamWidth`, quantized `aimStep` direction) — never hand-drawn
   art that merely resembles the ability. If art and math come from different places, the
   congruence rots silently.
3. **Wall occlusion is drawn.** `line`/`cone` coverage stops at the first wall
   (LOS-OCCLUSION); the drawn boundary must visibly truncate there — a smooth shape gliding
   over a wall while the tiles stop at it re-creates the exact lie this item removes.
   `circle` is not occluded and draws whole.
4. **Both layers render, AR-style:** the smooth boundary outline *plus* the tile fills
   inside it. Tiles pop in and out as the shape rotates — each pop happens exactly as that
   tile's centre crosses the drawn line, which reads as legible, not wrong. The
   damage-preview numbers are unchanged.
5. **Locked orders re-render the same boundary + tiles** in the locked style — preview,
   confirmation and resolution all draw from one derivation.
6. **Determinism boundary is respected:** tile selection stays the engine's integer
   `expandShape`, untouched. The drawn outline is client presentation — floats and curves
   are fine there, exactly as AIM2 already ruled for mouse trig. The congruence test is the
   proof the float drawing and the integer selection never disagree *about tiles*.

## 4. Implementation notes (for the Analyzer's Spec Notes)

- The cleanest shape for the code: the engine (or a small client module reading engine
  constants) exports a per-shape **analytic boundary description** — centre + radius for
  circles; apex, axis, ramp/width, cap and the ½ inflation for wedges — and the renderer
  tessellates it. Keep the derivation in ONE module so AC #2 is structural.
- The wedge ⊕ disc(½) outline is two offset edges, two or three arcs, and a cap: a dozen
  points and three arc segments, not a general Minkowski implementation.
- The **range envelope** (where you may aim) stays a separate, *quieter* channel — thin
  border tint, faded once a live aim exists. The competition between two similar fills was
  the second half of the owner's "two things" feeling.
- Out of scope: any change to `expandShape`, HITBOX1, CONE-B or CIRCLE-FIX. This item draws
  what they already compute.

## 5. Why this is worth the owner's "very important"

Free-aim is the game's core mind-game, and the aim preview is the single most-used UI
surface in a turn. Every place the client shows something the engine does not deliver is a
trust leak — the project has spent three rulings closing them (PREVIEW-NUMBERS' nominal
amounts, PREVIEW-FOG, the honest range envelope). This is the last and largest one: the
shape a player commits to should be the shape the game resolves, to the tile, at every
angle. After this item, it is — provably, by AC #1.
