# maps-v1.md — Map design (Designer)

**Date:** 2026-08-13 · **Status:** SHIPPED in `data/maps/`. Covers backlog **M1** (duel-arena
redesign) and **M1-4v4** (a dedicated 4v4 map). Companion to `roster-v1.md`; the numeric
constraints come from the roster, so the two files move together.

## 1. The two constraints that fix the geometry

Both come from the owner's directive recorded in BACKLOG M1: **turn-1 spawn hits impossible,
turn-2 engagement reliable.**

| Constraint | Value | Where it comes from |
|---|---|---|
| **Max turn-1 threat** | **12** | Move budget with an ability (4) + the longest non-ultimate range in the roster (Vex's Rail Shot, 8). Ultimates are excluded — they need 100 energy and cannot fire on turn 1. |
| **Spawn separation — floor** | **≥ 13** | Must exceed max turn-1 threat, or a Firepower shoots the enemy spawn before anyone has moved. |
| **Spawn separation — ceiling** | **≤ 14** | A range-2 Frontline (Aegis) closes 8 sprinting on turn 1 and threatens 4+2 on turn 2 = 14. Past that, melee kits cannot reliably engage on turn 2. |

**Both maps use separation exactly 13** — the floor, because it is also nearly the ceiling.
This is a two-sided constraint, which is why it is not "just make the map bigger."

Distances are **Manhattan** (MET1). Separation is measured head-on along a row, where
Manhattan and Chebyshev agree, so the MET1 change did not move these numbers.

## 2. Structure, not density

The old duel-arena was 18 isolated single squares in a symmetric rosette: no formation
exceeded one tile, the outer rows were empty, and brush was pinned to dead edges. Both maps
now use **four formation types**, each mirrored, and the same design language so a player who
learns one reads the other:

| Formation | Terrain | Job |
|---|---|---|
| **Sightline-breaker pillars** | wall, 1×3 | Flank the central room and **break the head-on spawn-to-spawn sightline**. Walls, not cover — only walls block line of sight. |
| **Lane-cutter runs** | wall, 3 long ×2 per row, central gap | Cut the north and south approaches into distinct lanes; the central gap keeps the middle permeable. |
| **Central strongpoint** | cover, 4 long ×2 | A holdable room. **Cover, not wall** — it grants the 50% directional reduction that makes a position worth holding, and does not blind the room. |
| **Flank brush corridors** | brush, 6–8 wide ×2 deep | Give the outer rows a reason to be entered: the concealed route around the strongpoint. |

**Wall vs cover is a deliberate split, not decoration.** Walls break sight; cover rewards
holding ground. Using cover for the strongpoint and walls for the pillars means the central
room is *defensible* (its occupants get cover from the north and south) but not *blind* (its
occupants can still shoot out along the row).

**Density fell relative to the board.** duel-arena: 26 blocked tiles on 270 (9.6%); iron-basin:
26 on 418 (6.2%). The old map was 18 on 225 (8%). Same order of magnitude, far more structure.

## 3. `duel-arena` — 18 × 15 (1v1 / 2v2 default; 4v4 supported)

Spawns **x=2 and x=15** (separation 13), two depth columns behind each spawn (x=0–1, x=16–17)
kept clear as retreat room.

- **Spawn rows y = 6, 8** (used by 1v1 and 2v2), then **y = 4, 10** (4v4). Every spawn row is
  wall-broken: rows 6 and 8 by the pillars at x=5/x=12, rows 4 and 10 by the lane-cutter runs.
- **Rows 5 and 9 are deliberately open lanes** — the sniper alleys. Nothing spawns on them;
  they are the ground a Firepower fights for and everyone else avoids.
- **The central room is `y=7, x=6..11`**, walled at x=5/x=12 and roofed with cover at y=6/y=8.
  It has **four doorways** — (6,6), (11,6), (6,8), (11,8) — so it is holdable but never sealed,
  and a unit inside cannot be shot down its own row from outside the walls.

## 4. `iron-basin` — 22 × 19 (dedicated 4v4)

Same language, scaled for eight units. Spawns **x=4 and x=17** (separation 13 again — the
constraint does not relax at 4v4), with four depth columns behind each spawn.

- **Spawn rows y = 8, 10, 6, 12**, all wall-broken (8 and 10 by the pillars at x=7/x=14; 6 and
  12 by the lane-cutter runs).
- **418 tiles for 8 units** (52/unit) vs duel-arena's 270 for 4 (67/unit). Slightly tighter per
  unit on purpose: 4v4 should feel crowded, and the extra width is spent on lanes rather than
  on empty midfield.
- Brush corridors are 8 wide (vs 6) so a four-unit flank has somewhere to form up.

## 5. Verification

Both maps were checked against the **real engine validators**, not just by eye:
`validateMap` clean · `formatsSupportedByMap` = `['1v1','2v2','4v4']` for both · every spawn
stand-able · mirror-symmetric in walls, cover and brush · no wall/cover overlap · every
head-on spawn pair's sightline wall-broken · and a Manhattan-cost reachability search
(diagonals cost 2, corner-cuts blocked by either flank) confirms **no unit can reach a square
from which any enemy spawn is within its longest non-ultimate range on turn 1**, on either map.

## 6. Handoff — the test work is the Builder's (role boundaries)

I updated only the assertions that the new geometry made stale, so the suite stays green
(**316 engine + 83 client, all passing**). These were coordinate re-points, not new coverage:

- `board.test.ts` — 15×15 → 18×15 and the terrain probes re-pointed at the new formations.
- `real-characters.test.ts` — first spawns are now (2,6) / (15,6).
- `vision.test.ts` — the Duel Arena probe sweep re-pointed (tally is now 22 clear / 42 blocked,
  asymmetric 0), and the spawn-to-spawn sightline test now asserts **both** 2v2 spawn rows.

**Still owed by the Builder** (backlog M1 / M1-4v4 explicitly assign `content.test.ts`):

1. **The roster-derived turn-1-threat test.** Assert `max(movementBudget + non-ultimate range)
   over the roster < min spawn separation`, **derived, not hardcoded**, so a future long-range
   character cannot silently reintroduce the turn-1 spawn hit. It must exclude ultimates
   (energy-gated) and run over **both** maps.
2. **Wire `iron-basin` into `content.test.ts`.** Nothing imports it yet, so CI does not check
   it. I verified it against the real validators in a scratch test; the permanent version is
   yours. The shape that passed:

   ```ts
   import ironBasin from '../../../data/maps/iron-basin.json';
   const IRON = ironBasin as unknown as MapDef;
   it('iron-basin validates and supports 4v4', () => {
     expect(validateMap(IRON)).toEqual([]);
     expect(validateMapForFormat(IRON, '4v4')).toEqual([]);
   });
   ```
   The existing mirror-symmetry test should loop over both maps rather than just `map`.
3. **Client map selection.** `packages/client/src/main.ts` hard-codes `duel-arena`. Choosing
   `iron-basin` for 4v4 is a client/lobby concern (M3 item 21) — out of scope here, but worth
   a line in the lobby spec so the map does not sit unused.

## 7. Playtest questions these maps raise

1. **Are rows 5 and 9 too strong for Vex?** They are the only uninterrupted east-west lanes on
   duel-arena. If sniping down them dominates, the fix is a single wall tile in each lane, not
   a redesign.
2. **Is the central room worth taking?** Four doorways may make it indefensible at 2v2 (too
   many angles for two units to cover). If so, close the y=6/y=8 doorways to one side each.
3. **Do the brush corridors get used**, or is the direct route always better? If unused, they
   are too far out — pull them one row toward the centre.
4. **Is 52 tiles/unit right for 4v4**, or does iron-basin need another lane of width?
