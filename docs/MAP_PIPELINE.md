# MAP_PIPELINE.md — from a grid of boxes to an arena with life

**Status:** phase 1 built (`BOARD-LIT`, `GRID-SEAMS`, `SCENE-DIORAMA`, `SKY-DOME` — all in
`renderer3d.ts`, `sky.ts` and `textures.ts`). Phases 2, 3 and 5 are unbuilt; phase 4 was
largely shipped by the character pipeline and needs reusing rather than rebuilding.
**Nothing in this pipeline requires an art asset until phase 5**, which is the whole reason
it is sequenced this way.

The counterpart to `docs/ART_PIPELINE.md`, which covers *characters* — modelling, rigging,
animation, weapons. That document says nothing about terrain, and this one says nothing
about characters. They meet in exactly one place: the asset-loading path, which neither
should build twice — and as of `character-model.ts`, one of them has built it.

Read this before changing how the **board** is drawn, before adding scenery or ambient
motion, and before proposing that the maps get "textures".

---

## 1. The idea worth stealing from Atlas Reactor

The reference the owner named is Atlas Reactor's maps, so it is worth being precise about
what makes them work. It is **not** the wall props.

**The arena you play on and the environment you look at are two different things.** The
playable grid is a small platform. Most of what fills the screen — skyline, machinery,
ships crossing overhead, water, distant crowds — is set dressing that no rule ever consults
and no unit can ever reach. The grid is a crisp, readable, almost abstract play surface,
and the *life* lives outside it, where it can be as busy as it likes without ever costing a
player a read.

That separation is the architecture, and it happens to fit this repo's constitution exactly:

- `data/maps/*.json` stays **gameplay truth** — walls, cover, brush, spawns, pads. Untouched
  by anything in this document.
- Scenery is a **decoration layer** keyed to that truth, drawn every frame and consulted by
  nothing.

It also reframes the work. "Replace the boxes with nicer boxes" is a small change with a
disappointing ceiling. "Build a diorama around the board" is where the life actually is.

### The separation is already enforced, not merely intended

`squareFromPoint` raycasts `ground` **specifically** — not the scene, not the `world` group:

```ts
const hits = raycaster.intersectObject(ground, false);
```

So scenery cannot steal a click no matter how far it extends or how solid it looks. That one
line is why this layer is safe to grow into a skyline later without any of it becoming
reachable. Do not "improve" it into a scene-wide raycast.

---

## 2. What a map looks like today

| Element | Today |
|---|---|
| Floor | one `PlaneGeometry`, `MeshStandardMaterial`, flat colour, tile seams drawn over it |
| Wall / cover / brush | one `BoxGeometry` per square, flat colour, roughness per kind |
| Arena | a slab with a lit rim and two team-tinted spawn markers (`SCENERY`) |
| Sky | a vertical gradient (`sky.ts`), screen-space |
| Lighting | ambient floor + hemisphere + one shadow-casting sun + un-shadowed fill |
| Ambient motion | **none** |
| Themes | **none** — one hardcoded `PALETTE` in `app.ts`, shared by both maps |

Both shipped maps are therefore still the same six colours in a different shape. That is the
single most visible gap and phase 2 closes it.

---

## 3. The phases

These are **not a strict fidelity ladder**, and treating them as one is the mistake to avoid.
Phase 2 is schema work and phase 3 is content work; they are independent. Phase 4 turned out
to be infrastructure with nothing to do with textures — which is why the character pipeline
finished it first, and why terrain inherits it.

| Phase | Needs art? | Produces |
|---|---|---|
| 1 · Light, ground, arena, sky | no | form, countable squares, a place — **built** |
| 2 · Themes as data | no | a map declares its own look in JSON |
| 3 · Procedural surfaces + ambient motion | no | grain, and the first thing that moves |
| 4 · Asset loading | no (infrastructure) | **mostly shipped by the character pipeline** — what remains is the asset-weight budget |
| 5 · Props and set pieces | **yes** | the skyline, the machinery, the crowd |

### Phase 2 — themes as data

Golden rule 2 says content is data. A map's *look* is content. `MapDef` gains an optional
`theme` and the client holds a theme table: floor and terrain palette, sky ramp, rim colour,
later a prop set and an ambient set.

**This is the pivot, and it is why phase 3 is not throwaway work.** The thing that would make
a later move to real assets expensive is texture code hardwired into `renderer3d.ts`. The
theme layer is precisely what prevents that: with it, "canvas-drawn or loaded from a file"
becomes a per-theme implementation detail rather than a renderer rewrite. Build it before
either, not after.

`theme` is inert to the engine — same as `powerups?` — so this costs golden rule 1 nothing.
`validate.ts` needs to tolerate the field.

### Phase 3 — procedural surfaces, and the first motion

Canvas-drawn textures via the cache pattern already in `textures.ts`: build a canvas, draw,
wrap in `CanvasTexture`, key it on everything that changes the pixels. `SURFACE` in
`renderer3d.ts` is the hook — each entry already carries a material's roughness and metalness
and is where a `map`/`normalMap` hangs.

**Procedural is not a placeholder for "real" textures.** It stays useful permanently, because
it is the only path that works with no network: every Vitest suite and all 32 Playwright tests
run without fetching anything, and a theme that loads a `.png` will need this as its
headless fallback.

Ambient motion belongs here too, and see §4 for the prerequisite it carries.

### Phase 4 — asset loading (**mostly already built — reuse it**)

This section originally said no asset-loading path existed anywhere in the repo, and argued
that terrain and characters should share one rather than build two. Between that being
written and this being merged, the character pipeline shipped exactly that path. The argument
holds; the work is largely done, and **terrain should reuse it rather than write a second one.**

`packages/client/src/character-model.ts` already carries every hard part:

- **Dynamic import of the loader.** `GLTFLoader` + `SkeletonUtils` are ~77 kB gz — over half
  the bundle headroom — so they are imported only when a match actually contains a character
  with a model. A terrain-asset path should stay behind the same kind of gate.
- **A manifest fetched `no-cache`, carrying a content hash** that cache-busts the `.glb` beside
  it. That solves the stale-mesh-against-fresh-manifest problem terrain will have too.
- **Failure is ordinary, not exceptional.** A missing or 404ing asset is recorded and the
  character keeps its box; it warns rather than throwing. Terrain wants the identical posture —
  a theme whose texture does not arrive should fall back to phase 3's procedural surface, not
  break the board.

`packages/client/public/models/` exists and ships `aegis.glb`.

**What is still missing is the budget number.** `scripts/bundle-budget.mjs` counts gzipped
**JS** only; nothing in CI watches `public/`. That is `BACKLOG.md`'s **ASSET-WEIGHT-BUDGET**,
and it is now the whole of this phase rather than a footnote to it. Two pipelines are shipping
bytes it does not see.

### Phase 5 — props and set pieces

Walls and cover become themed meshes; the space beyond the platform gets a skyline. Two rules:

- **Selection is deterministic** — hashed from `(mapId, x, y)`, never `Math.random()`. Same
  rule as `ART_PIPELINE.md` §"Seed the randomness", same reason: stable screenshots, stable
  e2e, and a board that looks the same to both teams.
- **The read survives.** A player must still see "this square is cover" instantly. Atlas
  Reactor keeps props tile-aligned with clear silhouettes for exactly this reason. A prop
  that is beautiful and ambiguous is a downgrade.

---

## 4. What this codebase imposes

Six constraints, all discovered the expensive way. Read them before designing anything.

### The camera is orthographic — a sky *dome* does not work

Every ray is parallel, so a dome large enough to enclose the camera is sampled across only a
few degrees of its own curve: the gradient painted on it arrives very nearly flat, which is
the thing being fixed. `SKY-DOME` is therefore a **screen-space** background texture, drawn
as a full-screen quad, where the ramp lands exactly as authored. Any future sky work inherits
this.

### The orbit reaches ~8° pitch — there is nowhere to hide

`PITCH_LIMITS` allows pitch down to roughly 8° and yaw runs modulo 360 with no clamp. So the
player can put the camera near ground level and look at the horizon from any angle. Scenery
silhouettes are fully exposed, and **tall scenery near the board will occlude the board**.
`ART_PIPELINE.md` §"Scale" flags the same hazard for 1.73-unit characters; set pieces have it
worse. Constrain height near the platform, or cull/fade at low pitch.

### Anything lit that stays on screen must be dim

`e2e/pixels.ts` counts colour *families*, and `isTeamBlue`, `isTeamRed` and `isAimOrange` all
gate on a channel above 130 — because those marks are things a player is meant to look **at**.
A bright, permanent piece of furniture lands inside one of those families whatever hue it is
given, and then "team 0's units are on screen" is satisfied by the scenery and the assertion
stops meaning anything. Worse: `isTeamRed` is asserted **equal to zero** to prove the unseen
enemy team is not drawn, so a saturated red fixture breaks a hidden-information guard.

The arena rim is deliberately under that gate. Contrast against a near-black sky is what makes
an edge read, not brightness. Follow the same rule for every fixture that is always on screen.

### Overlays are UI and must stay unlit

Tile highlights are `MeshBasicMaterial`. They were `MeshLambertMaterial`, which under the old
`ambient 1.6` rig was full-brightness *by accident*; dropping ambient to a floor would have
darkened every aim, range and fog wash along with the board. If scene fog is ever added, the
same sweep is needed again — `fog` defaults to `true` on basic and line materials, so every
plate, route line, pad, trap and nameplate needs `fog: false` or the HUD dims with distance.

### Ambient motion breaks the pixel tests — fix that first

`render.spec.ts` asserts frames are **byte-identical**:

```ts
expect(same(await frame(page), committed), `pointer at ${fx},${fy} must not move a committed aim`).toBe(true);
```

One rotating fan or drifting mote makes that fail permanently. Ship a freeze hook — a
`?ambient=off` flag or a reduced-motion path the tests drive — **before** adding the first
moving thing, not as cleanup after. The render loop itself is already continuous
(`requestAnimationFrame` re-queues unconditionally), so motion needs no architectural change;
only the tests do.

Second rule for motion: **ambient must never be confusable with gameplay motion.** A drifting
particle near a unit that reads as a status effect is worse than no particle.

### Post-processing is not free here

Bloom over emissives is most of Atlas Reactor's look, and it is genuinely the next big visual
win. But it changes the render path every pixel test depends on, and it **lightens
neighbouring pixels** — `isFogged` requires `r < 18 && g < 20 && b < 26`, which bloom bleeding
off a bright fixture will violate. The e2e also runs under SwiftShader, in software, where 32
tests already take ten minutes.

So bloom is its own change, with the pixel predicates retuned deliberately alongside it. It is
not a line to append to a scenery commit. The same caution applies to scene fog, for the same
reason: both shift global pixel values that tightly-tuned matchers depend on.

---

## 5. Role briefs

### Builder
Owns phases 1–4 and the mechanical half of 5. Keep the rendering decisions **exported as pure
data** — `LIGHTING`, `SURFACE`, `SCENERY`, `shadowFrustum()`, `gridPositions()`, `spawnEdge()`,
`skyAt()` — following the precedent `renderer3d.test.ts` set: the renderer needs WebGL, its
decisions do not. `sky.ts` deliberately has **no `three` import** so `e2e/pixels.ts` can share
the exact ramp the renderer draws from; a hand-copied hex in the test would drift silently.

### Analyzer
**ASSET-WEIGHT-BUDGET is now overdue rather than upcoming.** `public/models/aegis.glb` ships
today and `scripts/bundle-budget.mjs` counts gzipped JS only, so CI already watches none of
it; terrain will be the second pipeline feeding the same blind spot. Also worth a review: whether the tile-seam and rim contrast survive on a poor
monitor, and whether `boardSpan()` framing the *arena* rather than the board changed anything
about how the auto-camera follows the action.

### Designer
Owns the theme vocabulary in phase 2 and every prop set in phase 5. Themes are `data/`, so
they are Designer-writable by the `CLAUDE.md` table. Mark anything needing a renderer
capability that does not exist as **ENGINE ASK** — though note that nothing in this pipeline
touches `packages/engine`, so the ask is to the *renderer*, not the simulation.

---

## 6. Known risks

1. **Art sourcing is the real bottleneck for phase 5.** `ART_PIPELINE.md` records that the
   owner has no art skills and was built around that constraint rather than in spite of it.
   Terrain is genuinely easier than characters — CC0 kits cover stylized props well, which is
   why terrain needs no equivalent of the character generator — but it introduces licensing
   and attribution obligations into a repo that currently has none. Decide that deliberately,
   not at the moment someone needs a wall texture.
2. **The board is still dark.** `palette.open` is `#20242f` and composites at about
   `rgb(18, 20, 27)`; no lighting rig makes a near-black floor bright without blowing out
   everything standing on it. This is a palette decision, and it belongs to phase 2.
3. **Scenery competing with gameplay** is the failure mode to watch across all of it. Every
   constraint in §4 is a specific instance of it.
4. **e2e wall-clock.** 32 tests, ten minutes, single-worker under SwiftShader. Each phase adds
   scene complexity to every one of them.

---

## 7. First steps

1. Phase 2, themes as data — small, unblocks everything, and immediately stops Duel Arena and
   Iron Basin looking identical.
2. The ambient freeze hook, before any motion exists to need it.
3. Then phase 3. Phase 4 is no longer a decision point of its own now that the loader exists —
   but **ASSET-WEIGHT-BUDGET should land before terrain starts shipping bytes too**, since a
   second pipeline feeding an unwatched directory is how that gap turns into a regression
   nobody sees.
