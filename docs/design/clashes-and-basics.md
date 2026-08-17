# clashes-and-basics.md — AR clash parity, the roster refresh, and unique basics (Designer)

**Date:** 2026-08-15 · **Status:** RULED (owner directive; the clash text below is the owner's
verbatim AR source — treat it as primary). Also rules the three Designer items the Builder
left (§4). Companion to `ar-parity-v1.md`.

---

## 1. `CLASH-AR` — the clash system, from the owner's source (IMPORTANT)

The owner supplied AR's actual clash rules. This **promotes CL1 from PROPOSED-deferred to
RULED-scheduled** and amends pad claiming. Measured against the shipped engine first — two of
the three cases already match, and the deltas are exactly locatable:

| AR rule | AR behaviour | Shipped engine | Delta |
|---|---|---|---|
| **1. Both passing through, ending elsewhere** | Both **continue** to their destinations; a pad on the square is denied to **both** | `stepMovers` stops **all** same-step co-targets; pad tie falls to event order | **Two changes** |
| **2. Both ending on the square** | Treated as occupied: all are **forced back to the previous space** they held; pad denied | Contested rule: none enter, each stops on the square it last held | **✅ parity** (same outcome, same words almost) |
| **3. One ending, one passing through** | Ender rests there and **takes the pad**; passer **continues** and is not eligible | Both stop; pad goes to the **earlier claim**, which can be the passer | **Two changes** |

> **RULED — Adopt AR's clash rules exactly (owner, 2026-08-15).**
>
> **Movement half (`stepMovers`):** on a same-step collision, stop a unit only if it is
> **ending** its movement on the contested square (rule 2 — the shipped contested behaviour,
> which stands). Units merely **passing through** continue (rules 1 and 3). The **2-cycle
> swap rule is untouched** — a direct swap is still blocked for both; AR's text is silent on
> swaps and our ruling stands.
>
> **Pad half (`claimsBySquare`):** two amendments to the shipped earliest-entrant model —
> which is otherwise already right (entry-based pickup, dash-beats-move by phase order,
> the dead claim nothing):
> 1. **A same-step simultaneous entry claims nothing** — when two or more units enter the
>    pad square on the same step of the same phase, the pad is denied to all of them (rules
>    1 and 2). Today the tie silently falls to event-emission order, which is deterministic
>    but arbitrary — exactly the kind of tiebreak nobody can predict at the planning screen.
> 2. **An ender outranks a passer on the same turn** (rule 3): a unit that *rests* on the
>    pad square takes the pad even if a passer crossed it at an earlier step. Resting is the
>    stronger commitment; AR rewards it, and so do we.
>
> **Scope:** clashes are per-phase (Dash movers among themselves, Move movers among
> themselves — the phases cannot cross, in AR or in CARDS). Displacement (end of Blast) is
> not movement and keeps its own rules. **Ships with tests:** the three AR cases verbatim,
> each with and without a pad on the contested square; the swap-block regression; and a
> rule-3 case where the passer crossed *earlier* in the step clock and still loses the pad.
>
> **Consequence worth naming:** rule 1 makes crossing paths *safer* than today (both continue
> instead of both stalling), which is a small mobility buff to every through-the-middle
> route — and it makes the Might-room geometry livelier, since a contested sprint through
> the room no longer gridlocks. Consistent with the pass-through movement model throughout.

---

## 2. The roster refresh — every system shipped since roster-v1, applied back to the kits

The kits were authored before: Manhattan movement (MET1) · Euclidean aiming (AIM-METRIC) ·
HITBOX1 + CIRCLE-FIX + CONE-B · `chargeHits` · dash `impact` · free actions · catalysts ·
DoT/HoT · trap `lifetime` · friendly fire (FF1) · the `melee` flag · pads · chase · 2v2
default. Sweep results, kit by kit — most survived the decade of rule changes cleanly;
these did not:

| Kit | Update | Why |
|---|---|---|
| **Thorn — Snare Bloom** | `lifetime: 3` added (data, this PR) | TRAP-LIFETIME-TUNE gave Vex's Overwatch lifetime 3 (cap 4); Thorn's snare was left implicitly eternal. Same rule for both trap kits — an immortal minefield is the stall the caps exist to prevent. |
| **Wisp / Bastion / Ravok / Aegis autos + Ravok Shockwave** | `melee: true` (data, this PR — §4.1) | The MELEE-COVER flag is inert until the Designer marks the strikers. |
| **Lumen / Thorn / Ravok autos** | Redesigned (§3, data, this PR) | The uniqueness pass — these three are expressible with the engine as it stands today. |
| Everything else | **No change** | Verified against each new system: ranges were re-grounded by CIRCLE-FIX/CONE-B (footprints restored to authored intent); Shadowstep's adjacency became data (`impact`); the free/catalyst economy already carries the three setup kits. DoT/HoT is now available kit vocabulary — deliberately unused in kits so far; Regenergy and the Health pad own it until playtest asks for more. |

---

## 3. `BASICS-UNIQUE` — every auto attack should feel like its owner

**The owner is right, and the numbers prove it:** our nine autos are four lines and five
cones differing only in range and damage. AR made the no-cooldown basic the kit's signature.

### 3.1 The parity table — AR basic mechanics vs the CARDS engine

| AR example | Mechanic | CARDS engine today | Adopted by |
|---|---|---|---|
| **Aurora** — heals allies it passes through, damages enemies | Mixed-polarity area | **✅ expressible NOW** — FF1 polarity: one ability, `damage` + `heal` effects, each finding its own targets | **Lumen** (this PR) |
| **Zuki** — AoE attached to the end (lob) | Aimed blast | **✅ expressible NOW** — `circle` shape as an auto; circles detonate at the aimed area, walls notwithstanding | **Thorn** (this PR) |
| **Asuna** — a cone that is almost a circle | Point-blank all-around | **✅ expressible NOW** — self-centred `circle` r1 (`melee`) | **Ravok** (this PR) |
| **Orion** — circle, more damage in the centre | Damage falloff | **ENGINE ASK `BASIC-INNER`** — `innerRadius`/`innerAmount` on `circle` | **Cinder** (when the knob lands) |
| **Titus** — cone AND line, extra damage in the line | Axis bonus | **ENGINE ASK `BASIC-AXIS`** — `axisBonus: amount` on `cone`: tiles on the central line take `amount` extra. The axis is already computed (CONE-B measures perpendicular distance from it) | **Bastion** (when the knob lands) |
| **PUP** — close rectangle instead of a cone | Constant-width wedge | **ENGINE ASK `BASIC-BEAM`** — `beamWidth: n` on `cone`: half-width becomes the constant n instead of CONE-B's `halfWidth(d)=d` ramp. Same integer test, one substitution | **Aegis** (when the knob lands) |
| **Elle** — shotgun toggles wide-short ↔ thin-long | Aim-time mode select | **ENGINE ASK `BASIC-MODES`** — the largest ask: an ability carrying two profiles, chosen at aim time (`modes: [AbilityProfile, AbilityProfile]`; order carries the index). UI is real work (AIM2 toggle) | **Kestrel** (when the knob lands) |
| **Lockwood** — bounces off walls | Reflected line geometry | **❌ not adopted** — new geometry in the shape resolver, already catalogued as the highest-cost candidate; worth it only when a kit is built *around* it | — |
| **Helios** — bounces enemy-to-enemy | Chain targeting | **❌ not adopted** — target-graph resolution is a genuinely new mechanic; same verdict | — |

Two AR mechanics per tier: three adoptable today, four behind small knobs, two rejected as
not worth their engine cost yet. **Every ask reuses the existing integer lattice — no new
geometry kernels, no trig, no floats.**

### 3.2 The nine autos after the pass

| Character | Auto | Shape after | Status |
|---|---|---|---|
| **Vex** | Rail Shot | line 8 — **unchanged** | The pure sniper line is Vex's identity; one kit gets to own the vanilla |
| **Wisp** | Dagger Flurry | cone 2, `melee` — unchanged geometry | Becomes the roster's **only** pure melee cone once the others migrate |
| **Lumen** | **Radiant Lash** | line 6 · **14 damage to enemies + 12 heal to allies in the path** | Aurora. The Mender's auto finally does Mender work — firing *through* your frontliner at the enemy behind them is the whole fantasy |
| **Thorn** | **Barbed Sling** | **circle range 5 r1 · 15 damage** (lob) | Zuki. The zone kit pokes over the walls it fights around; pairs with her traps' area denial |
| **Ravok** | **Whirling Cleave** | **circle self r1 · 22 damage**, `melee` | Asuna. The Berserker hits *everyone* adjacent — dive the middle, swing all around; distinct from Shockwave (r2 + slow, cd 2) |
| **Bastion** | Crushing Slam | cone 2, `melee` now; **+ `axisBonus` when BASIC-AXIS lands** (proposed +8 on the centre line) | Titus. The Anchor's hammer rewards the straight-on read |
| **Aegis** | Shield Bash | cone 2, `melee` now; **→ beam 1×2 when BASIC-BEAM lands** | PUP. A shield edge is a wall, not a fan |
| **Cinder** | Ember Bolt | line 7 now; **→ circle r1 with `innerAmount` when BASIC-INNER lands** (proposed 22 centre / 14 ring) | Orion. The Amplifier's flare burns hottest at its heart |
| **Kestrel** | Twin Bolts | line 6 now; **→ two-mode when BASIC-MODES lands** (wide cone 2 ↔ thin line 6) | Elle. The Skirmisher adapts her gun to her spacing — the mode *is* the movement decision |

**Balance notes on the three shipping now:** Lumen 18 → 14 damage, paying for the 12-heal
rider (the Support auto band was 16–18; a heal-attached auto sits under it on purpose).
Thorn 17 → 15, paying for the lob (a no-cooldown attack that ignores wall occlusion is
positional power, priced in damage). Ravok 22 unchanged (the whirl trades the cone's 2-range
reach for all-around coverage — lateral, not upward). Energy stays 8 across all autos.
**Playtest flag:** Thorn's lob is the one to watch — free-aim into fog plus wall-ignoring
circles means she can poke blind corners every turn; if oppressive, range 5 → 4 first.

### 3.3 Interim rule (the standing convention)

Bastion, Aegis, Cinder and Kestrel keep their current autos until their knob lands — the
data must not carry fields the engine cannot read. Each BASIC-* ask ships with its one data
edit in the same commit, exactly as `chargeHits`, `impact` and `free` did.

---

## 4. Rulings on the Designer items the Builder left

### 4.1 MELEE-COVER data pass — RULED, shipped in this PR

`melee: true` on: **Dagger Flurry, Crushing Slam, Whirling Cleave, Shield Bash** (the
contact strikers) and **Shockwave** (a point-blank stomp; cover between you and a unit
standing on your own doorstep is not cover). **Not marked:** Seismic Rupture (an r3 quake —
bracing behind cover against an earthquake is a fair read), all dashes (contact damage in
the Dash phase is its own question — flagged for playtest, not folded into this flag), and
every ranged shape. The flag stops being inert the moment this merges.

### 4.2 Pad visibility (Builder OQ 2026-09-08 #1) — RULED, fixed in data this PR

The Builder is right that this is placement, not rendering: a ground mark one row **north**
of a raised block is hidden by it under the shipped camera. Ruling: **a pad may not sit on a
square whose south neighbour (y+1) is wall or cover** — call it the *shadow-row rule*, and
it belongs in the map-caps content test alongside PADS-SPREAD.

Moves (both maps, mirror-paired, all invariants re-verified):

| map | Might | Health | Energy |
|---|---|---|---|
| `duel-arena` | (7,7)/(10,7) → **(6,7)/(11,7)** — still the room's interior row, now on the tiles whose south neighbours are the doorways, so they render | (6,3)/(11,3) → **(4,3)/(13,3)** — off the wall-shadow row | (6,11)/(11,11) unchanged (already clear) |
| `iron-basin` | (9,9)/(12,9) → **(8,9)/(13,9)** — same logic | (8,5)/(13,5) → **(5,5)/(16,5)** | (8,13)/(13,13) unchanged |

The centre-prize ruling survives intact: the Might pair still sits inside the strongpoint,
near pad Manhattan 5 / far pad 10 from each team's closest spawn — both reachable turn 2,
still one contested prize. **The renderer lever is explicitly rejected** — a pad marker
drawn over a wall is a lie about occlusion, and the HUD-level marker is redundant once
placement respects the camera.

### 4.3 Body-click targeting (Builder OQ 2026-09-08 #2) — RULED

**Clicking a unit's body selects that unit's square** (and, for a chase, that unit).
Raycast the unit meshes first and prefer a unit hit over the ground plane. A player who
clicks a character means the character — resolving the pixels at a unit's waist to the tile
*behind* it is the geometry lying about intent. This is a client targeting change
(`squareFromPoint`) and applies to every board click, not only chase. One care: the
preference is for *visible* units — a fogged unit has no mesh to hit, so fog leaks nothing.

---

## 5. Handoff — suggested sequencing

1. **`CLASH-AR`** (engine — §1). The owner marked it IMPORTANT; it is also the smallest.
2. **`BODY-CLICK`** (client — §4.3). Every click benefits; chase stops being guesswork.
3. **`BASIC-AXIS` → `BASIC-BEAM` → `BASIC-INNER`** (engine knobs, smallest first — each
   ships with its one character data edit from §3.2).
4. **`BASIC-MODES`** (engine + client — the largest; Kestrel waits on it).
5. Shipped in this PR as data, fold the records: melee pass, Thorn lifetime, the three
   redesigned autos, the shadow-row pad moves (+ the shadow-row content-test guard is
   Builder work, same commit as CLASH-AR or the caps test — either home works).
