/**
 * The orthographic renderer (RND1) — the one renderer-specific module.
 *
 * Replaces the hand-built SVG board with a real orthographic camera, which is
 * what makes the projection a **runtime parameter** rather than a rewrite:
 * top-down and isometric are the same camera at two pitch values (90° and
 * ~35.264°, the true isometric angle), so switching is a number, not a new
 * drawing path.
 *
 * Everything above it stays renderer-agnostic and is reused verbatim — the
 * engine, `choreograph`, `playback`, `hotseat` and `targeting` know nothing
 * about Three.js. That boundary is the point: a different renderer replaces
 * this file and nothing else.
 *
 * Scene objects are **keyed by `unitId`** and reconciled rather than rebuilt
 * (the principle carried over from the SVG A1), so an object survives a frame
 * and can be tweened by the A3 re-spec.
 */

import {
  AmbientLight,
  CanvasTexture,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Color,
  DoubleSide,
  DirectionalLight,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  MeshStandardMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  RingGeometry,
  Raycaster,
  Scene,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import type { CharacterModels, ModelInstance } from './character-model.js';
import { FLASH_SECONDS, shakeOffset } from './vfx.js';
import { chamferFor, chamferedBox } from './chamfer.js';
import { jitterFor } from './jitter.js';
// NOTE the name collision with `rimBreath` below: that is the *arena rim*, a map
// fixture (MAP_PIPELINE §5). This is the edge light on a unit. Unrelated things
// that English gave the same word.
import { RIM_COLOUR, RIM_POWER, RIM_STRENGTH } from './rim.js';
import type { ClipChoice, ClipSet } from './character-clips.js';
import { ULT_COST, type MapDef, type PowerupType, type Vec2 } from '@cards/engine';
import { DEAD_ALPHA } from './animate.js';
import { type Nameplate } from './nameplates.js';
import {
  fofColour, fofFor, sideColour, unitColour, type Fof, type FofPalette, type Viewer,
} from './fof.js';
import { intentTexture, plateTexture, grainTexture, grainNormalTexture, contactTexture, skyTexture } from './textures.js';
import { type SkyRamp } from './sky.js';
import { overlayBoost } from './themes.js';
import { seedOf, tileTint, type GrainSpec } from './grain.js';
import { browserRenderOnDemand } from './render-flags.js';
import { rimBreath } from './ambient-motion.js';
import { placeProp, propOpacity } from './prop-placement.js';
import { easeCamera } from './camera-ease.js';
import { clampCentre, panDelta } from './camera-pan.js';

/** One board square is one world unit; heights are fractions of it. */
const TILE = 1;
/**
 * How tall a character stands, in tiles.
 *
 * NOT the realistic answer, and that is the point. 1.15 came from "a tile is
 * 1.5m, a person is 1.78m" — arithmetic that is correct and reads wrong: a
 * vertical metre projects by cos(pitch), so a 1.15-tile character is **0.94
 * tile-widths tall on screen**, i.e. shorter than its own square is wide, with
 * a torso a third of a square across. A small figure adrift in a big empty
 * tile, wearing a nameplate wider than itself.
 *
 * Atlas Reactor sizes the square to the character, not the character to a
 * metre: the body owns its square and the figure clearly stands taller than the
 * square is wide. 1.9 puts the torso at about half a tile and the silhouette at
 * ~1.55 tile-widths of screen height, which is what makes it read as a
 * character standing on a board rather than a token sitting in a cell.
 *
 * Scaling here rather than in the asset keeps the source at the size Mixamo and
 * the animations were authored for.
 */
export const MODEL_HEIGHT_TILES = 1.9;

/** How bright a victim flash goes. Emissive is additive, so 1 is already a lot. */
export const FLASH_STRENGTH = 0.55;

/**
 * How tall a unit with no model yet stands.
 *
 * The same height as a character, deliberately. Eight of the nine are still
 * boxes, so almost every board is a mix — and at 0.6 against a 1.9-tile
 * character the two read as different species standing on the same floor, which
 * looks like a bug in the game rather than a gap in the art. Matching heights
 * makes a placeholder read as *this character, not modelled yet*.
 */
const UNIT_HEIGHT = TILE * MODEL_HEIGHT_TILES;

/**
 * How much tighter than "the whole board" the default framing sits.
 *
 * 1 frames the entire map, which is what shipped — and at 18x15 that put a
 * 1.15-tile character at a few dozen pixels: correctly scaled against the
 * board, and too small to read as a character. Owner's call (2026-08-22):
 * scale everything up and let the map run off the edges. The auto-camera
 * already follows the action and `clampToBoard` already keeps the frame on the
 * board, so a frame smaller than the map is a supported state, not a new one.
 */
const BOARD_ZOOM = 1.75;
const WALL_HEIGHT = 0.9;
const COVER_HEIGHT = 0.45;
// Directional edge cover draws taller and thinner than a full-block crate: a
// chest-high barricade that hides a crouching model (Aegis stands 1.73 tiles, so
// a crouch ≈ 1.0 and its torso ≈ 0.8), sitting ON the tile boundary so it reads
// as a low wall you walk up to, not a block filling the square (COVER-EDGE).
const EDGE_COVER_HEIGHT = 0.8;
const EDGE_COVER_THICK = 0.16;

/** The two shipped projections. Isometric is the true 35.264° arctan(1/√2). */
export const PITCH = { top: 90, isometric: 35.264 } as const;
export type ProjectionName = keyof typeof PITCH;

/**
 * How far a free orbit may tilt. Below ~8° the board is edge-on and unreadable;
 * 90° is straight down, the top-down projection.
 */
export const PITCH_LIMITS = { min: 8, max: 90 } as const;
/** Zoom bounds, in board squares of visible height. */
export const SPAN_LIMITS = { min: 6, max: 60 } as const;
/** Pointer travel (px) past which a drag is an orbit, not a click. */
const DRAG_SLOP = 4;
/** Degrees of yaw/pitch per pixel dragged. */
const ORBIT_SENSITIVITY = 0.4;

/** Board-height (in squares) at which billboarded bars are their design size. */
const BAR_REF_SPAN = 14;
/** Fraction of the way to the action the auto-camera pans (1 = centre on it). */
const AUTO_PAN = 0.35;
/** The auto-camera never zooms tighter than this fraction of the whole board. */
const AUTO_ZOOM_FLOOR = 0.85;
/** Alpha applied to everything outside a spotlight. */
const DIM_ALPHA = 0.22;
/** A decoy, seen by its OWNER: unmistakably theirs, unmistakably not a unit. */
const DECOY_PURPLE = 0xa06bd6;
/**
 * A last-known-position ghost (LAST-KNOWN). Fainter than a dead unit, so the
 * three states a body can be in — alive, dead, remembered — never read alike.
 */
const GHOST_ALPHA = 0.22;
/** The owner's decoy plate sits just above the trap marker in the overlay band. */
const DECOY_PLATE_LIFT = 0.05;
/**
 * UI-NAMEPLATES: the plate hangs above the unit inside the billboarded `bars`
 * group, so it faces the camera and cancels zoom. Since NAMEPLATE-LAYOUT the
 * status row is *part of that plate* rather than a second thing hanging under
 * it — see `nameplates.ts`.
 */
/** Plate size in world units. Its canvas resolution lives in `textures.ts`. */
const PLATE_W = 1.7;
const PLATE_H = 0.66;
/**
 * NAMEPLATE-DEPTH: where the overhead label sits in the transparent pass.
 *
 * Well above anything else the renderer draws, because a nameplate that loses a
 * sort to a highlight quad is the same bug in a different costume — and the
 * plate is the one thing on screen whose entire purpose is to be read.
 */
export const PLATE_ORDER = 1000;

/**
 * NAMEPLATE-DEPTH — *"Nameplate still is hidden by Aegis' character model."*
 *
 * The plate hangs `topY + 0.34` above the unit, which clears a BOX and does
 * not clear a rigged character: Aegis's shield and shoulders reach into that
 * band, and because the plate is a camera-facing quad *inside* the scene, the
 * mesh in front of it wins the depth test and eats the name.
 *
 * Raising it would only move the problem to the next taller model and the
 * next steeper camera angle. The plate is **UI drawn in world space** — its
 * whole job is to be readable — so it opts out of depth entirely and
 * composites after the scene. `renderOrder` orders it against the other
 * transparent things rather than leaving it to sorting, and it is per-MESH
 * because a Group's `renderOrder` does not reach its children.
 */
const asOverlay = (mesh: Mesh, order: number): Mesh => {
  (mesh.material as MeshBasicMaterial).depthTest = false;
  mesh.renderOrder = order;
  return mesh;
};

/**
 * The overhead furniture: one nameplate quad and the intent tile above it.
 *
 * UI-NAMEPLATES replaced three coloured strips with a single **drawn plate**,
 * because half of what the screenshot shows cannot be done with quads at all —
 * the HP numeral lives *inside* its bar and the ULT tag is a word. One texture
 * also means one draw and one cache entry per distinct plate, instead of three
 * meshes whose widths are re-set every frame. Since NAMEPLATE-LAYOUT the status
 * row is part of that plate rather than a second thing hanging under it.
 *
 * Both live in their own group so they billboard and resist zoom: a nameplate is
 * only useful if it is the same legible size at any framing.
 *
 * `topY` is the height of the thing being labelled. Passed rather than fixed at
 * the box's height: a model stands MODEL_HEIGHT_TILES tall, so a plate pinned to
 * UNIT_HEIGHT sat across its chest.
 *
 * **Exported for NAMEPLATE-DEPTH's test.** The renderer as a whole needs a WebGL
 * context; the object graph it hangs over a unit does not, so the depth policy
 * can be asserted on the real meshes rather than on a description of them.
 */
export const buildBars = (topY: number): Group => {
  const bars = new Group();
  bars.name = 'bars';
  bars.position.y = topY + 0.34;
  const plate = asOverlay(new Mesh(
    new PlaneGeometry(PLATE_W, PLATE_H),
    new MeshBasicMaterial({ transparent: true, depthWrite: false }),
  ), PLATE_ORDER);
  plate.name = 'plate';
  bars.add(plate);
  // UI-INTENT's tile sits above the nameplate — the plan is the newest thing
  // on screen and the one a teammate is scanning for, so it leads.
  // The intent tile rides the same overlay pass, one step above the plate it
  // sits on: two pieces of the same label, and half of it clipping behind a
  // shoulder while the other half floats free is worse than either.
  const intent = asOverlay(new Mesh(
    new PlaneGeometry(0.62, 0.2),
    new MeshBasicMaterial({ transparent: true, depthWrite: false }),
  ), PLATE_ORDER + 1);
  intent.name = 'intent';
  intent.position.y = PLATE_H / 2 + 0.14;
  intent.visible = false;
  bars.add(intent);
  return bars;
};

/**
 * Trap markers: a little smaller than a tile so the grid still reads, and lifted
 * into the overlay band so brush cannot eat them the way it ate the highlights
 * (FOG-ZORDER). Below `select`, so the selected-unit ring still reads on top.
 */
const TRAP_SIZE = 0.5;
/** PADS-INDICATOR: a pad plate is bigger than a trap's — it is an invitation. */
const PAD_SIZE = 0.62;

/**
 * Tile-overlay layers, listed bottom-up — the order is the draw order, so a
 * covered tile always reads on top of the envelope that contains it.
 */
export type HighlightLayer =
  | 'fog' | 'camo' | 'range' | 'reach' | 'aim' | 'band' | 'impact' | 'free' | 'catalyst'
  | 'waypoint' | 'chase' | 'select'
  // AIM-PREVIEW-TRUE: a character on this side that has already locked in. Its
  // own layer so it can be dimmer than the aim being composed over it.
  | 'locked';

/**
 * Route lines get their own layers for the same reason the aim overlays do: a
 * dash ability and a Dash catalyst are two repositions that can be drafted on
 * one turn (DASH-CAT-ROUTE), and one shared layer would mean the second erased
 * the first.
 */
// INTERCEPT-GUARD adds `guardPath`: the line from a bodyguard to the square he
// will interpose on. Its own layer rather than sharing the route line, because
// both can be on the board at once and they mean opposite things — one is where
// this unit is going, the other is who it is going to stand in front of.
// TEAMMATE-PLAN-VISIBLE adds `teamPath`: the routes teammates on other clients
// have already locked in. Its own layer because it is somebody else's finished
// statement rather than the thing this player is editing, and because it can
// carry SEVERAL routes at once — hence `drawPaths` rather than `drawPath`.
export type PathLayer = 'path' | 'catalystPath' | 'guardPath' | 'teamPath';

/**
 * AIM-PREVIEW-TRUE's boundary layers. Three families, three colours: the
 * ability's own shape, the sub-band inside it that pays a different number, and
 * a dash's impact disc — each a locus of its own engine predicate, so each is
 * drawn rather than left for the eye to infer from a tile wash.
 */
export type ShapeLayer = 'shape' | 'shapeBand' | 'shapeImpact' | 'shapeLocked' | 'tracer';

/**
 * Terrain heights. Brush is the only *walkable* terrain with a body, which makes
 * its top surface the floor every tile overlay has to clear (FOG-ZORDER).
 */
export const TERRAIN_HEIGHT = { brush: 0.02, cover: COVER_HEIGHT, wall: WALL_HEIGHT } as const;

/**
 * BOARD-LIT — the lighting rig, as data rather than four literals in the middle
 * of scene construction.
 *
 * The board ran `AmbientLight(1.6)` against a `DirectionalLight(1.1)`: an
 * ambient-*dominant* rig, where every face of every box receives nearly the same
 * energy. Form is read from the difference between faces, so under that rig a
 * wall is a flat rectangle and the map is "black and boxes" no matter what
 * colour or texture is put on it. Ambient drops to a floor whose only job is to
 * keep a shadowed face readable, and the directional light becomes the light
 * that actually models the scene.
 *
 * The hemisphere light is what makes it cheap: cool from the sky, warm from the
 * ground, so a box *top* and a box *side* differ in hue as well as in value
 * before the sun reaches either. One light, and the silhouette reads.
 *
 * **The sun and the fill are tinted, and for a while they were not.** Both were
 * `0xffffff`, which made the paragraph above only half true: the hemisphere's
 * warm end is `#2b2118`, a very dark brown, so against a cool `#a8c4ec` sky it
 * contributes almost nothing and the rig was cool-only. Measured off a real
 * composite, lit surfaces came back at `R − B = −2` and shadowed ones at `−14` —
 * no warm/cool separation anywhere, just neutral and slightly-cooler-neutral.
 *
 * A warm key against a cool fill is the oldest trick there is and it costs two
 * constants. Both are kept close to white on purpose: this is meant to read as
 * *daylight*, not as a colour grade, and the terrain has already given up its
 * chroma so the UI can own saturated hues (see the theme note). A strongly
 * tinted key would take that chroma straight back.
 *
 * The `fill` is deliberately not a caster. It exists so the side facing away
 * from the sun keeps an edge instead of going to ambient flat, and a second
 * shadow map to buy that would be paying real per-frame cost for a detail
 * nobody can point at.
 *
 * Intensities are physically scaled: three has been physically-correct by
 * default since r165 and this workspace is on 0.185, which is why the sun is
 * ~2 rather than the ~1 a legacy-lit scene wanted.
 */
export const LIGHTING = {
  ambient: { intensity: 0.35 },
  hemisphere: { sky: 0xa8c4ec, ground: 0x2b2118, intensity: 1.0 },
  sun: { colour: 0xfff1dc, intensity: 2.2, position: [6, 11, 5] },
  fill: { colour: 0xc6d8ff, intensity: 0.45, position: [-7, 6, -6] },
} as const;

/**
 * The RIM term, as GLSL, generated from the same constants `rimFactor` uses.
 *
 * Written out of `rim.ts`'s numbers rather than typed as literals so the shader
 * and the Node-testable curve cannot drift apart: `rim.test.ts` pins
 * `rimFactor`, and this string is the only other place the expression exists.
 *
 * `vViewPosition` is the fragment's position relative to the eye, so normalising
 * it gives the direction *to* the viewer; `normal` is view-space and already
 * normalised by `<normal_fragment_begin>`.
 */
export const RIM_GLSL = [
  '{',
  '  vec3 rimV = normalize( vViewPosition );',
  '  float rimNdotV = clamp( dot( normal, rimV ), 0.0, 1.0 );',
  `  float rimF = pow( 1.0 - rimNdotV, ${RIM_POWER.toFixed(4)} );`,
  `  totalEmissiveRadiance += vec3( ${(((RIM_COLOUR >> 16) & 0xff) / 255).toFixed(4)}, `
    + `${(((RIM_COLOUR >> 8) & 0xff) / 255).toFixed(4)}, `
    + `${((RIM_COLOUR & 0xff) / 255).toFixed(4)} ) * ( rimF * ${RIM_STRENGTH.toFixed(4)} );`,
  '}',
].join('\n');

/**
 * BOARD-LIT — how each surface answers the light.
 *
 * Every mesh on the board was `MeshLambertMaterial`, which has no notion of
 * roughness: cover and floor and wall all scatter light identically and so all
 * read as the same substance in three colours. Standard materials cost a little
 * more per pixel and let a material say what it *is* — cover is a scuffed metal
 * barricade, brush is matte foliage that should never catch a highlight, floor
 * is dry stone.
 *
 * These are the Tier-0 values: no maps, no textures, no bytes. A later tier
 * hangs canvas-drawn `map`/`normalMap` textures off these same entries without
 * moving anything else.
 */
export const SURFACE = {
  open: { roughness: 0.94, metalness: 0.02 },
  wall: { roughness: 0.78, metalness: 0.14 },
  cover: { roughness: 0.52, metalness: 0.42 },
  brush: { roughness: 1.0, metalness: 0.0 },
  unit: { roughness: 0.44, metalness: 0.22 },
} as const;

/** Shadow-map resolution. One 1024 map — the e2e opens several renderers. */
const SHADOW_MAP_PX = 1024;

/**
 * The sun's shadow camera, sized to the board it has to cover.
 *
 * A `DirectionalLight` shadows through an orthographic camera that defaults to
 * a ±5 box. Every shipped map is larger than that in both axes, so the default
 * would shadow a patch in the middle and leave the rest unshadowed — which
 * looks like a rendering bug, not like lighting. The radius is the board's
 * half-diagonal (the light is off-axis, so the diagonal is the extent that
 * matters) plus a margin for the shadow a wall throws past the last row.
 *
 * Pure and exported so the sizing is testable without a WebGL context, the way
 * the board↔world mapping already is.
 */
export const shadowFrustum = (map: { width: number; height: number }): {
  radius: number; near: number; far: number;
} => ({
  radius: Math.hypot(map.width, map.height) / 2 + 2,
  near: 0.5,
  far: 60,
});

/** How far the seam ink is darkened from the floor colour it sits on. */
const GRID_DARKEN = 0.55;
/** Seam opacity — present when looked for, invisible when not. */
const GRID_OPACITY = 0.5;
/**
 * The seams sit just off the floor to beat z-fighting, and stay well under
 * `OVERLAY_BASE` so no highlight has to compete with them (FOG-ZORDER).
 */
const GRID_LIFT = 0.004;

/** One colour, scaled per channel. Clamped, so a factor over 1 stays a colour. */
export const shade = (hex: number, factor: number): number => {
  const channel = (shift: number): number =>
    Math.max(0, Math.min(255, Math.round(((hex >> shift) & 0xff) * factor))) << shift;
  return channel(16) | channel(8) | channel(0);
};

/**
 * Recolour a glowing edge bar — **both** of the properties that carry its hue.
 *
 * Exported and separate for the reason `paintFlash` is: the bug it fixes is
 * invisible from the closure that had it. An edge bar is built glowing
 * (`emissive: colour` at `spawnEmissive` intensity), so a repaint that set only
 * `color` left the bar burning whatever it was constructed with — the owner saw
 * two white bars and no sides at all, on a board where the colour was in fact
 * being computed correctly and thrown away.
 *
 * The two properties are one colour on this material. Setting one is always a
 * bug, and this is the only place that has to remember it.
 */
export function paintEdgeBar(material: MeshStandardMaterial, hex: number): void {
  material.color.setHex(hex);
  material.emissive.setHex(hex);
}

/** Seam ink: the floor colour, darkened. A grid is a shade of its floor. */
export const gridInk = (open: number): number => shade(open, GRID_DARKEN);

/**
 * SCENE-DIORAMA — the arena the board sits on.
 *
 * The board was a plane in a void: geometry that stops at the last rank with
 * nothing underneath, which reads as an unfinished render rather than a place.
 * A slab with a lit edge is the cheapest thing that turns it into an object —
 * the same trick Atlas Reactor's maps use, where the playable grid is a small
 * platform and everything around it is set dressing no rule ever consults.
 *
 * **Nothing here is ever asked about the rules.** Picking raycasts `ground`
 * specifically (see `squareFromPoint`), not the scene, so scenery cannot steal a
 * click no matter how far it extends. That separation is the whole reason this
 * layer is safe to grow: it can become a skyline later without any of it
 * becoming reachable.
 */
export const SCENERY = {
  /** How far the ledge runs past the last rank, in tiles. */
  margin: 1.5,
  /** Slab depth. Only its top edge is seen, even at the orbit's lowest pitch. */
  depth: 0.8,
  /** The slab's top sits fractionally under the floor so the two cannot z-fight. */
  top: -0.02,
  /** How dark the slab is against the floor it carries. */
  shade: 0.55,
  /**
   * The rim is deliberately **dim**. Every colour family the e2e counts —
   * `isTeamBlue`, `isTeamRed`, `isAimOrange` — gates on a channel above 130,
   * because those marks are things a player is meant to look *at*. A bright
   * arena edge lands inside one of those families however its hue is chosen, and
   * then "team 0's units are on screen" is satisfied by the furniture. Contrast
   * against a near-black sky is what makes an edge read, not brightness, so the
   * rim stays under the gate and loses nothing.
   */
  rim: { height: 0.1, thickness: 0.18, colour: 0x1e4552, emissive: 0.85 },
  /** A team's marker, as a fraction of the edge it runs along. */
  spawnSpan: 0.42,
  /** Markers are a tint on the arena, not a second set of units: dimmer still. */
  spawnShade: 0.3,
  spawnEmissive: 0.7,
} as const;

/** Which side of the board a team enters from. */
export type BoardEdge = 'west' | 'east' | 'north' | 'south';

/**
 * The platform edge a team spawns against.
 *
 * Read from `map.spawns` rather than assumed to be left/right: a map is free to
 * put its spawns on the short axis, and a marker painted on the wrong edge is
 * worse than no marker — it tells the player their back is somewhere it is not.
 * Ties keep the first of a fixed order, so the answer is stable for a spawn
 * cluster sitting dead centre rather than depending on iteration luck.
 */
export const spawnEdge = (map: MapDef, team: 0 | 1): BoardEdge => {
  const spawns = map.spawns[team];
  if (spawns.length === 0) return team === 0 ? 'west' : 'east';
  const mx = spawns.reduce((sum, p) => sum + p.x, 0) / spawns.length;
  const my = spawns.reduce((sum, p) => sum + p.y, 0) / spawns.length;
  const gaps: ReadonlyArray<readonly [BoardEdge, number]> = [
    ['west', mx],
    ['east', map.width - 1 - mx],
    ['north', my],
    ['south', map.height - 1 - my],
  ];
  let best = gaps[0] as readonly [BoardEdge, number];
  for (const gap of gaps) if (gap[1] < best[1]) best = gap;
  return best[0];
};

/**
 * GRID-SEAMS — the tile seams the renderer has always claimed to draw.
 *
 * The comment above the terrain loop said "faint tile seams so squares are
 * countable — the grid IS the ruleset here", and nothing under it drew any: the
 * floor was one undifferentiated plane, and a square only became visible when
 * something was hovered over it. On a game where every rule is quoted in
 * squares, a board at rest that cannot be counted is the bug.
 *
 * Returns the line-segment endpoints as a flat XYZ buffer. Squares are centred
 * on integers by `squareToWorldXZ`, so tile *edges* land on half-integers and
 * the board spans ±width/2 by ±height/2 — that is where the seams go.
 *
 * Pure and exported for the same reason `squareToWorldXZ` is: a grid that
 * disagrees with the mapping is the click-target bug wearing a new coat.
 */
export const gridPositions = (map: { width: number; height: number }): Float32Array => {
  const halfW = map.width / 2;
  const halfH = map.height / 2;
  const out: number[] = [];
  for (let i = 0; i <= map.width; i++) {
    const x = -halfW + i;
    out.push(x, 0, -halfH, x, 0, halfH);
  }
  for (let i = 0; i <= map.height; i++) {
    const z = -halfH + i;
    out.push(-halfW, 0, z, halfW, 0, z);
  }
  return new Float32Array(out);
};

/**
 * Where the overlay band starts. FOG-ZORDER: the highlight layers used to run
 * 0.002–0.022, which is *under* the brush box's 0.02-high lid — so every aim,
 * AoE and move envelope drawn over a green square lost the depth test to the
 * brush and simply vanished. That reads as "the ability cannot reach there",
 * which is a rules bug as far as the player is concerned, and it is exactly the
 * reported one. Overlays now begin above the brush lid with a margin, so no tile
 * you can stand on can eat a highlight.
 */
const OVERLAY_BASE = TERRAIN_HEIGHT.brush + 0.006;
/** Height above the ground plane per layer, so they never z-fight. */
export const LAYER_LIFT: Record<HighlightLayer, number> = {
  fog: OVERLAY_BASE,
  // CAMO-REVEAL's red thicket sits just above the fog and below every planning
  // overlay: it is board state, not something you are aiming, so an aim drawn
  // over it must still read on top.
  camo: OVERLAY_BASE + 0.002,
  range: OVERLAY_BASE + 0.004,
  reach: OVERLAY_BASE + 0.008,
  // AIM-PREVIEW-TRUE: a plan already locked in on this side. Under the live
  // aim, because it is context for the decision being made rather than the
  // decision itself — and a locked shape that painted over the one you are
  // composing would be the loudest thing on the board for the least reason.
  locked: OVERLAY_BASE + 0.010,
  aim: OVERLAY_BASE + 0.014,
  // AUTO-PREVIEW: the subset of an aim that hits *harder* — a cone's axis line
  // (BASIC-AXIS) or a circle's core (BASIC-INNER). Directly above the aim it
  // qualifies, because it is a reading of those same tiles rather than a
  // separate area, and below `impact` so a dash's detonation still leads.
  band: OVERLAY_BASE + 0.015,
  impact: OVERLAY_BASE + 0.016,
  free: OVERLAY_BASE + 0.018,
  catalyst: OVERLAY_BASE + 0.020,
  // CHASE1's quarry ring sits just under the selection ring: it marks a unit
  // rather than a target area, so it must read above every aim overlay and
  // still yield to "this is the character you are ordering".
  // WAYPOINT-TELL: the squares a player deliberately clicked while composing a
  // move. Above every aim overlay because it is a record of decisions rather
  // than an area, and below `chase`/`select` for the same reason those two lead:
  // marking a unit outranks marking a square.
  waypoint: OVERLAY_BASE + 0.021,
  chase: OVERLAY_BASE + 0.022,
  select: OVERLAY_BASE + 0.024,
};
/**
 * Overlay tiles are inset so the grid reads through them — except fog, which
 * has to meet its neighbours edge to edge or the darkness comes out as a mesh
 * of lit seams (VISION1).
 */
const LAYER_INSET: Record<HighlightLayer, number> = {
  fog: 1, camo: 1, range: 0.92, reach: 0.92, locked: 0.78, aim: 0.92, band: 0.62, impact: 0.86, free: 0.8, catalyst: 0.72, waypoint: 0.5, chase: 0.98, select: 0.92,
};
/**
 * FOF-COLORS' foot ring — the bottom of the *unit-marker* stack.
 *
 * Above every aim overlay, because it marks a unit rather than an area; below
 * `chase` and `select`, which keep their louder "this is the one you are
 * ordering / chasing" meaning. A player should be able to read allegiance and
 * selection at the same glance without the two competing.
 */
export const FOF_RING_LIFT = LAYER_LIFT.chase - 0.0005;
/**
 * Radii as a fraction of a tile — a **thin** ring at the feet, not a puddle
 * under them.
 *
 * Owner playtest: *"the circles should be thinner lines, it's too big and bulky
 * right now."* The first pair spanned 0.12 of a tile, which at this zoom is a
 * band rather than an outline: on a crowded square it read as a coloured floor
 * tile and competed with the selection ring it is supposed to sit under. Same
 * outer radius — the ring still meets the feet — at a third of the weight.
 */
const FOF_RING_INNER = 0.38;
const FOF_RING_OUTER = 0.42;

/** A trap marker rides in the overlay band, just under the selection ring. */
const TRAP_LIFT = LAYER_LIFT.select - 0.001;
/**
 * PADS-INDICATOR — a power-up pad sits low, just above CAMO-REVEAL's red
 * thicket and **below** every planning overlay. Same argument the camo tile
 * makes: a pad is *board state*, not something you are aiming, so a range
 * envelope or an AoE drawn over it must still read on top. A trap earns its
 * near-the-top lift by being a warning; a pad is terrain with a colour.
 */
export const PAD_LIFT = LAYER_LIFT.camo + 0.001;
/** UI2's continuous shape sits just above the covered tiles it explains. */
export const SHAPE_LIFT = LAYER_LIFT.select + 0.004;
/**
 * Height a tracer flies at, in world units.
 *
 * Roughly the chest of a unit sized to `MODEL_HEIGHT_TILES`, so a streak leaves
 * and arrives at about the height of the things it connects. Not the head:
 * shots that pass a bystander should read as passing them, and a line level with
 * everyone's eyes reads as hitting all of them.
 */
export const TRACER_LIFT = TILE * MODEL_HEIGHT_TILES * 0.55;
/**
 * How far past a solid's footprint its contact patch reaches.
 *
 * Enough for the falloff to finish. Tighter and the patch has a visible edge of
 * its own — which replaces one hard seam with another.
 */
export const CONTACT_SPREAD = 1.9;
/** Just clear of the floor, under everything else that draws there. */
export const CONTACT_LIFT = 0.004;
/**
 * How tall a Warding Wall stands, in world units.
 *
 * Chest-to-shoulder on a unit rather than over their heads: it has to read as
 * something you push through, and a panel taller than the characters reads as
 * cover — a thing that stops line of sight, which this explicitly does not do.
 */
export const WALL_PANEL_HEIGHT = TILE * MODEL_HEIGHT_TILES * 0.72;
/**
 * How solid the field between the posts is.
 *
 * Raised from 0.34 on the owner's read: too transparent to see. It still has to
 * be see-through — the board behind it is information, and anyone can walk
 * through it — so this is as far as it can go before it starts hiding units,
 * and the pillars carry the rest of the legibility.
 */
export const WALL_FIELD_OPACITY = 0.55;
/**
 * The posts at each end: concrete, solid, and shorter than the field.
 *
 * Shorter on purpose. A post as tall as the haze reads as a doorframe, which
 * says "go around"; a post at waist height reads as an anchor holding something
 * up, which is what it is. The wall stops nobody.
 */
export const WALL_PILLAR_HEIGHT = TILE * MODEL_HEIGHT_TILES * 0.5;
export const WALL_PILLAR_WIDTH = TILE * 0.19;
/** Poured concrete — deliberately inert, so the field is what carries colour. */
export const WALL_PILLAR_COLOUR = 0x9a9c99;

/**
 * A decoy, as one viewer should see it (DECOY-RENDER). `asEnemy` decides the
 * whole appearance: a decoy's job is to be mistaken for a real Wisp, so to the
 * team being fooled it is drawn exactly like an enemy unit — same box, same
 * team colour, same solidity. Only its owner sees the purple ghost.
 */
export interface RenderDecoy {
  id: string;
  pos: Vec2;
  /** The team that placed it — an impersonated enemy wears *their* colour. */
  owner: 0 | 1;
  asEnemy: boolean;
  /**
   * UI-NAMEPLATES: the **fake** plate an impersonated decoy wears, frozen at the
   * cast (edge-cases: the decoy snapshot carries the nameplate fields). On a
   * board where every visible unit has a plate, the one body without one is
   * un-disguised by its absence — the same tell the missing preview number was
   * before PREVIEW-DECOY. Only used when `asEnemy`; the owner's own purple
   * ground plate is a marker, not a unit, and wants no nameplate.
   */
  nameplate?: Nameplate;
}

/**
 * A placed trap, as one viewer should see it (TRAP-INDICATOR). Drawn flat on the
 * ground and marked with a cross, so it reads as *a square you should not step
 * on* rather than as a unit or as another aim overlay.
 */
export interface RenderTrap {
  id: string;
  pos: Vec2;
  owner: 0 | 1;
  /** The viewing team's own trap — team-safe, and something to route over. */
  own: boolean;
  /**
   * The ability that laid it, carried through from `TrapState` so presentation
   * can tell one kind of trap from another. A Warding Wall's tiles are drawn as
   * a standing barrier; an Overwatch Trap's single square is not.
   */
  abilityId?: string;
}

/**
 * A power-up pad, as the board shows it (PADS-INDICATOR). **Public terrain** —
 * both teams see every pad, so unlike a trap there is no per-viewer variant and
 * no fog question to ask. `armed` is the only state: a consumed pad is still
 * *there*, it just has nothing to give until it respawns, and drawing it as
 * absent would make a square that is about to matter disappear from the plan.
 */
export interface RenderPad {
  pos: Vec2;
  type: PowerupType;
  armed: boolean;
  /**
   * PADS-LIGHTS: turns until respawn, drawn as that many lit pips along the
   * pad's edge. Zero (or absent) draws none, which is what a live pad wants.
   */
  lights?: number;
}

/**
 * Pad colours by flavour — the marker's only identifier.
 *
 * Chosen to sit **outside every family the render tests already match on**, so
 * a pad on the board can never be counted as a unit, an aim overlay, a decoy or
 * lit brush. The obvious picks all collided: a green pad reads as brush, an
 * orange one as the aim overlay, a plain blue one as a team-0 unit. Teal,
 * magenta and cyan are the three unclaimed hues.
 */
const PAD_COLOUR: Record<PowerupType, number> = {
  health: 0x2fe0a0,
  might: 0xff4f9d,
  energy: 0x3fe8ff,
};

/** What the renderer needs to draw one unit — the same shape the SVG used. */
export interface RenderUnit {
  unitId: string;
  /** Which character this is, so the renderer can find its model. */
  characterId?: string;
  owner: 0 | 1;
  pos: Vec2;
  hp: number;
  maxHp: number;
  energy: number;
  alive: boolean;
  label: string;
  shield?: number;
  /**
   * UI-NAMEPLATES: the name / HP / energy plate to float above this unit.
   *
   * Absent means *draw no plate* — which is how a fogged unit, a last-known
   * ghost and a unit the caller simply has no name for are all handled by the
   * same rule. The renderer never decides who gets one: `fogView` already chose
   * which units exist in this frame, and a plate is drawn for exactly those.
   */
  nameplate?: Nameplate;
  /**
   * UI-INTENT: an allied unit's queued plan, as a short label. Absent means the
   * unit has nothing queued — or, for an enemy, that plans are never drawn.
   * The renderer does not decide which: it is handed the badge or it is not.
   */
  intent?: { label: string; locked: boolean };
  /**
   * A last-known-position **ghost** (LAST-KNOWN) rather than a live sighting:
   * this is where the unit *was*, not where it is. Drawn faint and stripped of
   * its bars and pips — a ghost that carried a live HP bar would be reporting
   * information the viewer does not have.
   */
  ghost?: boolean;
}

export interface Renderer {
  /** Draw/refresh the board for these units and decoys. Objects are reconciled. */
  /**
   * FOF-COLORS: whose seat the board is drawn for.
   *
   * Idempotent and cheap to call every frame — it compares before it repaints.
   * Colour is pure view: this never reaches game state, and two clients on
   * opposite teams resolve the same board to mirrored colours with neither
   * being wrong.
   */
  setViewer(viewer: Viewer): void;
  show(units: readonly RenderUnit[], decoys?: readonly RenderDecoy[], traps?: readonly RenderTrap[], pads?: readonly RenderPad[]): void;
  /**
   * Highlight squares. Layers stack bottom-up in the order listed here:
   * `fog` is the unseen board (VISION1) and sits underneath everything, so your
   * own aim still reads over darkness — you may shoot where you cannot see.
   * `camo` is a camouflage tile burning red because the unit on it gave itself
   * away (CAMO-REVEAL) — board state, so it sits under the planning layers.
   * `range` is the hover envelope (UI1 — where an ability *could* go), `reach`
   * the move envelope, `aim` the tiles an aim actually covers, `impact` a dash's
   * previewed blast discs (DASH-PREVIEW), `select` the current unit and impact
   * flashes.
   */
  highlight(layer: HighlightLayer, squares: readonly Vec2[], color: number, opacity?: number): void;
  /** The board square under a client-space point, via a ray/plane intersection. */
  squareFromPoint(clientX: number, clientY: number): Vec2 | undefined;
  /**
   * The inverse: where a (fractional) board position lands on screen, in pixels
   * relative to the canvas. UI5's floating readouts are DOM anchored to world
   * positions, so they stay crisp and need no font atlas.
   */
  screenPosition(x: number, y: number, lift?: number): { x: number; y: number } | undefined;
  /** Switch projection at runtime — the whole reason for an orthographic camera. */
  setProjection(name: ProjectionName): void;
  /** Frame the camera on a board-space rectangle (A3's camera targets this). */
  /**
   * AMBIENT-FREEZE — whether decorative motion may run. See `ambient.ts`.
   *
   * Deliberately shipped **ahead of its consumer**: nothing moves yet, and the
   * point is that when the first thing does, the guard already exists. Phase 5
   * gates every ambient element on this, and the browser suite runs with it
   * false so `render.spec.ts`'s byte-identical frame comparisons keep working.
   * Retrofitting it later means first debugging a scenery bug wearing the
   * costume of an aim bug.
   */
  readonly ambient: boolean;

  /**
   * Frames actually drawn since `start()`.
   *
   * Exposed so RENDER-ON-DEMAND can be *proved* rather than asserted: an idle
   * board should hold this still. A number that keeps climbing with nothing
   * happening is the optimisation silently not working.
   */
  frameCount(): number;

  lookAt(centre: Vec2, spanSquares: number): void;
  /** Frame the whole board, allowing for the current pitch's foreshortening. */
  fitBoard(): void;
  /** The live scene object for a unit, so an animator can drive it (A1 principle). */
  objectFor(unitId: string): Group | undefined;
  /**
   * Place a unit at an arbitrary *fractional* board position — the hook a tween
   * drives between whole squares. `show()` snaps everything back to its square.
   */
  setUnitAt(unitId: string, x: number, y: number, lift?: number): void;
  /** Fade a unit (deferred death visuals). 1 = solid. */
  setUnitFade(unitId: string, alpha: number): void;
  /**
   * Fetch rigged models for these characters. Resolves either way — a character
   * with no `.glb` keeps the box, which is the ordinary case for eight of nine.
   */
  preloadCharacters(characterIds: readonly string[]): Promise<void>;
  /** Play an animation on a unit. A no-op for units still drawn as boxes. */
  setUnitClip(unitId: string, choice: ClipChoice, beatSeconds: number): void;
  /**
   * Turn a unit to look along a **board-space** direction.
   *
   * The board→world→mesh conversion lives here because the rest facing is a
   * property of the asset: Blender's front is -Y, `export_yup` makes that +Z,
   * and board +y is world +z — so a model at rest looks along board +y.
   */
  setUnitFacing(unitId: string, dx: number, dy: number): void;
  /** This character's clip names, or undefined if it has no model loaded. */
  clipsFor(characterId: string | undefined): ClipSet | undefined;
  /** Light a unit up for a moment — the victim flash on a hit (VFX step 1). */
  flashUnit(unitId: string, seconds: number): void;
  /**
   * Rattle the camera. `amplitude` is in tiles, `seed` makes it repeatable —
   * a replayed turn must shake identically or watching twice disagrees.
   */
  shakeCamera(amplitude: number, seconds: number, seed: number): void;
  /**
   * Spotlight: dim everything except these units. Used on Prep/Dash/Blast only —
   * Move is simultaneous and dimming it would hide the whole point (owner).
   */
  setSpotlight(unitIds: readonly string[] | null): void;
  /** Free-orbit on/off. When off, the auto-camera drives framing. */
  setOrbitEnabled(on: boolean): void;
  orbitEnabled(): boolean;
  /**
   * Drag the view across the board plane by a screen delta, in CSS pixels.
   *
   * Exposed as well as bound to a gesture so the app can offer a pan that is
   * not a mouse drag — a keyboard nudge, a touch fling — without either caller
   * re-deriving the projection maths.
   */
  panBy(dxPx: number, dyPx: number): void;
  /** Whether the player has taken the camera by panning it. */
  panned(): boolean;
  /** Hand the camera back to the auto-framing. */
  resetPan(): void;
  /**
   * Keep a run of squares in frame (auto-camera). Empty = whole board.
   *
   * `pan` overrides how far the camera leans toward them: the A3 default of
   * 0.35 keeps a four-shooter Blast readable by refusing to chase each actor,
   * but planning wants the seat's own characters actually **in** the frame, and
   * at BOARD_ZOOM a third of a lean does not get there.
   */
  /**
   * Frame these squares.
   *
   * `hold` picks which clamp bounds the result, and the two are genuinely
   * different jobs. `'frame'` keeps the whole frustum over the board — what
   * the resolution follow wants, since a turn is watched rather than worked on
   * and a frame that swings off the edge to chase an actor is disorienting.
   * `'centre'` only keeps the *centre* on the board, which is what lets the
   * planning camera actually sit on a character standing on a spawn rank; with
   * `'frame'` it cannot, because since BOARD_ZOOM the frame is tighter than the
   * board and the clamp pins it near the middle.
   */
  focusOn(squares: readonly Vec2[], pan?: number, hold?: 'frame' | 'centre'): void;
  /** A stroked path through tile centres plus an endpoint marker (AIM1). */
  drawPath(squares: readonly Vec2[], color: number, dashed: boolean, layer?: PathLayer): void;
  /**
   * TEAMMATE-PLAN-VISIBLE: **several** paths into one layer, the way `drawShape`
   * already takes several outlines. A layer is replaced wholesale on every draw,
   * so a per-teammate `drawPath` would leave only the last one on the board —
   * and at 4v4 a seat has up to three teammates, each with a route and possibly
   * a guard link. Empty clears the layer.
   */
  drawPaths(
    routes: readonly (readonly Vec2[])[], color: number, dashed: boolean, layer?: PathLayer,
  ): void;
  /**
   * UI2 Layer 1: fill a closed polygon given in **fractional board coordinates**
   * on the ground plane — the continuous cone/beam/disk the covered tiles
   * approximate. Empty clears it.
   */
  /**
   * AIM-PREVIEW-TRUE: a **list** of closed outlines, because one armed ability
   * now draws more than one locus — the outer shape, and the sub-band (Bastion's
   * axis, Cinder's core) that pays a different number inside it. `layer` keeps
   * each family in its own group so they can carry their own colour.
   */
  drawShape(outlines: readonly (readonly Vec2[])[], color: number, opacity?: number, layer?: ShapeLayer): void;
  /**
   * Per-ability auras: outlines that each carry their OWN colour and fade.
   *
   * Separate from `drawShape` because a shape layer is one colour and one
   * opacity for the whole draw, which is exactly what a footprint wants and
   * exactly what an aura cannot use — a ring's whole job is to fade, and two
   * characters acting in one phase are two different palettes on screen at
   * once. Replaces the layer wholesale, like every other draw here; empty
   * clears it.
   */
  drawAuras(auras: readonly { outline: readonly Vec2[]; hole?: readonly Vec2[]; color: number; opacity: number }[]): void;
  /**
   * WARDING WALL: standing translucent panels, raised from a footprint.
   *
   * The only thing this renderer draws that is *vertical* and not a unit. A
   * barrier lying flat on the floor reads as a hazard on those tiles; the
   * ability raises a wall, and a wall has a face. Deliberately see-through —
   * the board behind it is information, and anyone can walk through it, which
   * is the whole point of it. Replaces the layer wholesale; empty clears it.
   */
  drawWalls(panels: readonly { from: Vec2; to: Vec2 }[], color: number, opacity?: number): void;
  /**
   * IMPACT PARTICLES: camera-facing fragments at a board position and height.
   *
   * Billboarded, by the same rule the health bars follow — a flat quad lying on
   * the ground is a decal, and debris in the air has to face the viewer or it
   * disappears edge-on exactly when it is highest. Replaces the layer wholesale;
   * empty clears it.
   */
  drawParticles(particles: readonly {
    x: number; y: number; lift: number; size: number; color: number; opacity: number;
  }[]): void;
  /** Start/stop the animation loop (orbit and tweens need continuous frames). */
  start(): void;
  stop(): void;
  /**
   * Run `cb` after every drawn frame, or clear it with `undefined`.
   *
   * The camera eases, so anything anchored to a *screen* position — the DOM
   * readout layer — has to be re-placed once per frame or it lags behind the
   * board it is labelling. Playback already does this from its own tween loop;
   * this is the same hook for the decision phase, which has no loop of its own.
   */
  onFrame(cb: (() => void) | undefined): void;
  resize(width: number, height: number): void;
  /**
   * Tell the camera how much of the canvas the overlaid chrome covers, in CSS
   * pixels (UI-VIEWPORT). The board is then framed into what is left, so no rank
   * of it hides behind the hotbar or the log.
   */
  setSafeInsets(next: { top: number; right: number; bottom: number; left: number }): void;
  render(): void;
  dispose(): void;
}

/**
 * Board square → world XZ, with the board centred on the origin. Exported as
 * plain numbers (no Three types) so the mapping — the part picking depends on —
 * is testable without a WebGL context.
 */
export const squareToWorldXZ = (map: { width: number; height: number }, p: Vec2): { x: number; z: number } => ({
  x: p.x - (map.width - 1) / 2,
  z: p.y - (map.height - 1) / 2,
});

/** World XZ → board square: the exact inverse, snapped to the nearest tile. */
export const worldXZToSquare = (map: { width: number; height: number }, x: number, z: number): Vec2 => ({
  x: Math.round(x + (map.width - 1) / 2),
  y: Math.round(z + (map.height - 1) / 2),
});

/** True when a square is on the board. */
export const onBoard = (map: { width: number; height: number }, p: Vec2): boolean =>
  p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;

const toWorld = (map: MapDef, p: Vec2): Vector3 => {
  const { x, z } = squareToWorldXZ(map, p);
  return new Vector3(x, 0, z);
};

const toSquare = (map: MapDef, v: Vector3): Vec2 => worldXZToSquare(map, v.x, v.z);

/**
 * How tall the model actually draws, and where its feet are.
 *
 * NOT `Box3.setFromObject`. That walks the node hierarchy and multiplies each
 * mesh's bounds by its world matrix — and a Blender-exported Mixamo rig carries
 * a **+90° X rotation on the `Armature` node** (the Z-up to Y-up conversion),
 * with the inverse on `mixamorigHips`. The two cancel out through the skeleton,
 * so the character renders upright; they do not cancel out for a bounding box
 * taken off the nodes, which reports the model's 0.33-unit DEPTH as its height.
 * Scaling to that made Aegis 5x too big, and it read as "the model is wrong"
 * rather than "the measurement is".
 *
 * Geometry bounds are the honest answer: authored Y-up, in the same space the
 * skinned vertices land in, and independent of whether any matrix happens to
 * have been updated yet — which is the other half of why the old reading was
 * unpredictable. The cost is that node-level offsets are ignored, which is
 * correct for a single skinned body and would need revisiting for a model built
 * from several separately-placed pieces.
 *
 * Lives here rather than beside the model code so the main bundle can call it
 * without a static import of the dynamically-loaded `character-model` module.
 */
export function modelBounds(root: Object3D): { minY: number; height: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  root.traverse((o) => {
    // `Mesh`/`SkinnedMesh` both carry one; anything else in the tree (bones,
    // groups) does not, and contributes nothing.
    const geometry = (o as Partial<Mesh>).geometry as BufferGeometry | undefined;
    if (geometry === undefined) return;
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) return;
    minY = Math.min(minY, box.min.y);
    maxY = Math.max(maxY, box.max.y);
  });
  return maxY > minY ? { minY, height: maxY - minY } : { minY: 0, height: 0 };
}

/** One built unit group, as the rebuild check sees it. */
export interface BuiltUnit {
  characterId: string | undefined;
  /** Whether the group it built is a rigged model rather than the fallback box. */
  hasModel: boolean;
}

/**
 * Which built unit groups are now out of date because their model has landed.
 *
 * `buildUnit` decides box-or-model **once**, when the group is created, and
 * `show()` caches that group by unit id forever after. Models arrive over the
 * network, so on any cold load the first paint happens first — and the opening
 * paint is deliberately synchronous (VISION1-opening in `app.ts`: nothing may
 * await before it, or the enemy team flashes unfogged). "The models land late"
 * is therefore the normal case, not the exception, and without this every unit
 * would keep the box it was born with for the whole match.
 *
 * Dropping the group is the whole fix: the next `show()` rebuilds it, and
 * `show()` runs on every paint.
 */
/**
 * Write a unit's flash onto its meshes. `left` is the seconds remaining, so the
 * lit amount decays to nothing on its own and `left <= 0` is a clean release.
 *
 * Exported, and separate from the closure that calls it, for the same reason
 * `modelBounds` and `staleUnitGroups` are: the renderer needs a WebGL context
 * that Node has not got, so anything left inside the factory can only be
 * verified by photographing a browser. This is the half that decides what the
 * pixels become, and it is checkable in a unit test.
 *
 * Emissive rather than colour: the material's colour is the character's
 * identity (team tint on a box, the atlas on a model), and writing to it means
 * remembering what to put back. Emissive is additive light with a natural rest
 * value of black, so releasing it is setting it to zero.
 */
export function paintFlash(body: Object3D, left: number): void {
  const lit = Math.max(0, Math.min(1, left / FLASH_SECONDS));
  // A box is one mesh; a rigged model is a tree of them.
  body.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      const standard = mat as MeshStandardMaterial;
      if (standard.emissive === undefined) continue;
      standard.emissive.setScalar(lit * FLASH_STRENGTH);
    }
  });
}

export function staleUnitGroups(
  built: Iterable<readonly [string, BuiltUnit]>,
  isLoaded: (characterId: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const [unitId, unit] of built) {
    if (unit.hasModel || unit.characterId === undefined) continue;
    if (isLoaded(unit.characterId)) out.push(unitId);
  }
  return out;
}

/**
 * MAP-THEMES — what the renderer needs to draw a board.
 *
 * The themed half (terrain colours, the material each is made of, the sky ramp,
 * the platform) comes from `data/themes/*.json`; the global half (`fof`) does
 * not, and must not. Identity is not decoration: a map that re-tinted it would
 * change friend-from-foe reading per map, and `TEAM_CSS` in the HUD plus the
 * e2e's colour families both encode it.
 *
 * FOF-COLORS sharpened that principle rather than replacing it. The global
 * identity used to be *team number* (`team0`/`team1`); it is now *friend or foe
 * from the viewer*, still global across maps — which is what makes a mirror
 * matchup readable.
 */
export interface BoardPalette {
  /** Which theme this came from — the grain hash is seeded from it. */
  themeId: string;
  open: number; wall: number; cover: number; brush: number;
  /** FOF-COLORS: the three viewer-relative identity hues. */
  fof: FofPalette;
  /** Clear colour if the sky raster cannot be built (no 2d context). */
  background: number;
  surface: Record<'open' | 'wall' | 'cover' | 'brush', { roughness: number; metalness: number }>;
  grain: Record<'open' | 'wall' | 'cover' | 'brush', GrainSpec>;
  sky: SkyRamp;
  arena: { shade: number; rim: number };
}

export function createRenderer(
  container: HTMLElement, map: MapDef, palette: BoardPalette,
  options: { ambient?: boolean; renderOnDemand?: boolean; props?: boolean } = {},
): Renderer {
  const scene = new Scene();
  // AMBIENT-FREEZE: resolved once. `?ambient=off` (every browser test) and a
  // reduced-motion viewer both arrive here as `false`, and everything
  // decorative that moves is gated on it — so the tests, and anyone who asked
  // their OS to stop motion, get a board frozen byte-identical to a static one.
  const ambientOn = options.ambient ?? true;
  // PROP-FREEZE: whether themed terrain props may load. Off by default so a
  // direct caller (the jsdom renderer tests) never kicks off a fetch; the app
  // passes `browserProps()`, which is off for `?props=off` (the whole e2e).
  const propsOn = options.props ?? false;
  // SKY-DOME: a ramp rather than a flat clear colour. The fallback keeps a
  // headless context (no 2d canvas) drawing something rather than nothing.
  scene.background = skyTexture(palette.sky) ?? new Color(palette.background);

  // An orthographic camera has no perspective divide, so a tile is the same size
  // wherever it sits — which is exactly what a tactics board wants.
  const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.borderRadius = '8px';
  container.replaceChildren(renderer.domElement);

  // BOARD-LIT — see `LIGHTING`. Ambient is a floor, not a fill; the sun models
  // the scene and is the only caster; the hemisphere splits tops from sides by
  // hue; the fill keeps the dark side's silhouette without a second shadow map.
  scene.add(new AmbientLight(0xffffff, LIGHTING.ambient.intensity));
  scene.add(new HemisphereLight(
    LIGHTING.hemisphere.sky, LIGHTING.hemisphere.ground, LIGHTING.hemisphere.intensity,
  ));

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const sun = new DirectionalLight(LIGHTING.sun.colour, LIGHTING.sun.intensity);
  sun.position.set(...LIGHTING.sun.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);
  const frustum = shadowFrustum(map);
  sun.shadow.camera.left = -frustum.radius;
  sun.shadow.camera.right = frustum.radius;
  sun.shadow.camera.top = frustum.radius;
  sun.shadow.camera.bottom = -frustum.radius;
  sun.shadow.camera.near = frustum.near;
  sun.shadow.camera.far = frustum.far;
  // Boxes sitting flush on a plane are the classic shadow-acne case; the normal
  // bias is what keeps a wall from striping the floor it stands on.
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.02;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  const fill = new DirectionalLight(LIGHTING.fill.colour, LIGHTING.fill.intensity);
  fill.position.set(...LIGHTING.fill.position);
  scene.add(fill);

  // ── Static terrain ────────────────────────────────────────────────────────
  const world = new Group();
  scene.add(world);

  const grainSeed = seedOf(palette.themeId);
  /** One raster per (theme, style, amplitude) — the tint varies per tile, not per texel. */
  const grainSeedFor = (spec: GrainSpec): number => grainSeed ^ seedOf(spec.style);

  /**
   * A grain texture as material options, repeated to land one tile per square.
   *
   * `repeat` is always integral because the texture is exactly one tile wide —
   * see `grainTexture`. An empty object when the theme grains nothing, so a flat
   * theme allocates no texture and keeps phase 2's look exactly.
   */
  const grainClones = new Map<string, ReturnType<typeof grainTexture>>();
  /** The normal-map twin of `grainClones`, keyed identically. */
  const grainNormals = new Map<string, ReturnType<typeof grainTexture>>();
  const grainMap = (spec: GrainSpec, repeatX: number, repeatY: number): {
    map?: ReturnType<typeof grainTexture>;
    normalMap?: ReturnType<typeof grainTexture>;
  } => {
    const base = grainTexture(grainSeedFor(spec), spec);
    if (base === null) return {};
    // **Cached by repeat, not cloned per mesh.** `repeat` lives on the texture
    // rather than the material, so a different repeat genuinely needs a
    // different texture object — but every terrain box wants the same (1, 1),
    // and the first draft cloned regardless. That put ~50 copies of one 64px
    // image on the GPU per board, which is invisible on real hardware and very
    // much not under SwiftShader: it doubled the browser suite's wall clock and
    // starved the timing-sensitive tests into failing.
    const key = `${grainSeedFor(spec)}|${spec.style}|${spec.speckle}|${repeatX}|${repeatY}`;
    const cached = grainClones.get(key);
    if (cached !== undefined) return { map: cached, normalMap: grainNormals.get(key) ?? undefined };
    const cloned = base.clone();
    cloned.needsUpdate = true;
    cloned.repeat.set(repeatX, repeatY);
    grainClones.set(key, cloned);

    // The same pattern, read as a height field, so the sun can find it. Cloned
    // and cached exactly like the albedo — a normal map with a different repeat
    // from the colour it belongs to would slide across it.
    const normalBase = grainNormalTexture(grainSeedFor(spec), spec);
    let normal: typeof cloned | undefined;
    if (normalBase !== null) {
      normal = normalBase.clone() as typeof cloned;
      normal.needsUpdate = true;
      normal.repeat.set(repeatX, repeatY);
      normal.wrapS = cloned.wrapS;
      normal.wrapT = cloned.wrapT;
      grainNormals.set(key, normal);
    }
    return { map: cloned, normalMap: normal };
  };

  /**
   * GRAIN — the floor, one quad per square, tinted per square.
   *
   * Segmented and de-indexed so each tile can carry a flat colour of its own:
   * an indexed grid shares vertices between neighbours, so a per-vertex colour
   * would blend across the seam and give a smooth wash rather than the
   * square-by-square variation that actually stops a floor reading as one
   * painted plane. De-indexing costs ~1600 vertices on the largest shipped map,
   * which is nothing, and buys variation that can never fall out of register
   * with the grid the way a multi-tile texture would.
   *
   * The tint is hashed from `(theme, x, y)` — never `Math.random()` — so both
   * teams see the same floor and a screenshot is reproducible.
   */
  const groundGeometry = new PlaneGeometry(
    map.width * TILE, map.height * TILE, map.width, map.height,
  ).toNonIndexed();
  const groundColours = new Float32Array(groundGeometry.attributes.position!.count * 3);
  {
    const openGrain = palette.grain.open;
    // Two triangles per tile, three vertices each, laid out row-major from the
    // plane's top-left — which is board y = 0 once the plane is laid flat.
    for (let i = 0; i < groundColours.length / 3; i++) {
      const quad = Math.floor(i / 6);
      const tint = tileTint(grainSeed, quad % map.width, Math.floor(quad / map.width), openGrain.tint);
      groundColours[i * 3] = tint;
      groundColours[i * 3 + 1] = tint;
      groundColours[i * 3 + 2] = tint;
    }
  }
  groundGeometry.setAttribute('color', new BufferAttribute(groundColours, 3));

  const ground = new Mesh(
    groundGeometry,
    new MeshStandardMaterial({
      color: palette.open,
      ...palette.surface.open,
      vertexColors: true,
      ...grainMap(palette.grain.open, map.width, map.height),
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  // GRID-SEAMS — faint tile seams so squares are countable. The grid IS the
  // ruleset here, and until now this comment was the only part of it that
  // existed: nothing drew seams, so a board at rest had no squares in it.
  const grid = new LineSegments(
    new BufferGeometry().setAttribute('position', new BufferAttribute(gridPositions(map), 3)),
    new LineBasicMaterial({
      color: gridInk(palette.open), transparent: true, opacity: GRID_OPACITY, depthWrite: false,
    }),
  );
  grid.position.y = GRID_LIFT;
  world.add(grid);

  // A prop may later stand in for a wall/cover box (MAP_PIPELINE phase 5); keep
  // the boxes it might replace so the swap can hide the box it covers and fall
  // back to it if the prop never loads.
  /**
   * A block, with its edges taken off.
   *
   * CHAMFER — every solid on this board was a raw `BoxGeometry`, and a raw box
   * has one thing wrong with it that no colour, texture or light rig can fix:
   * its edges are perfectly sharp, and nothing real is. A 90° corner presents
   * exactly two surfaces to the light, so lit face meets shadowed face across
   * zero pixels and reads as a line drawn on the screen rather than an edge in
   * the world. The narrow third surface a bevel adds catches a highlight the
   * other two cannot, and that thin bright line along the top of a wall is most
   * of what says a thing was *made*.
   *
   * Falls back to a plain box when the bevel would be sub-pixel: below
   * `CHAMFER_MIN` the chamfered form is forty-four triangles drawing the same
   * silhouette as twelve, and its corner triangles degenerate to zero area.
   */
  const solidGeometry = (w: number, h: number, d: number): BufferGeometry => {
    const bevel = chamferFor(w, h, d);
    if (bevel <= 0) return new BoxGeometry(w, h, d);
    const { positions, indices } = chamferedBox(w, h, d, bevel);
    const indexed = new BufferGeometry();
    indexed.setAttribute('position', new Float32BufferAttribute(positions, 3));
    indexed.setIndex(indices);
    // FLAT-SHADED, and `toNonIndexed` is what makes it so.
    //
    // `computeVertexNormals` averages the normals of every triangle meeting at
    // a vertex, and in a chamfered box every vertex is shared between a face
    // and its bevels — so on indexed geometry it smooths the bevel *into* the
    // face and the crisp highlight this exists to create becomes a soft
    // gradient, which is the look being got away from. Splitting the vertices
    // first gives each triangle its own, so each face keeps its true normal.
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    return geometry;
  };

  /**
   * The soft darkening where a solid meets the floor.
   *
   * The sun's shadow map handles the shadow a block *throws*; what it cannot
   * resolve at this resolution is the crevice at the base, where the block
   * occludes almost the whole sky. Without it every box meets the floor along a
   * hard seam and reads as sitting *on* the scene rather than being *in* it.
   *
   * Scaled past the footprint so the falloff has somewhere to happen, and
   * `depthWrite: false` like every other overlay here so it cannot occlude what
   * is behind it.
   */
  const contactPatch = (width: number, depth: number): Mesh | undefined => {
    const texture = contactTexture();
    if (texture === null) return undefined;
    const mesh = new Mesh(
      new PlaneGeometry(width * CONTACT_SPREAD, depth * CONTACT_SPREAD),
      new MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false, opacity: 1,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  };

  const terrainBoxes = new Map<string, Mesh>();
  for (const [role, squares, colour, height, surface, grain] of [
    ['brush', map.brush, palette.brush, TERRAIN_HEIGHT.brush, palette.surface.brush, palette.grain.brush],
    ['cover', map.cover, palette.cover, TERRAIN_HEIGHT.cover, palette.surface.cover, palette.grain.cover],
    ['wall', map.walls, palette.wall, TERRAIN_HEIGHT.wall, palette.surface.wall, palette.grain.wall],
  ] as const) {
    for (const p of squares) {
      // Directional cover (COVER-EDGE) is a half-wall on one edge you walk onto,
      // not a full block: draw a thin barricade slab pushed to its faced side so
      // the tile reads as "cover from the east" rather than "solid". A bare
      // {x,y} cover entry (and every wall/brush) keeps the full 0.96 box.
      const facing = role === 'cover' ? (p as { facing?: 'N' | 'S' | 'E' | 'W' }).facing : undefined;
      // Edge cover: a chest-high barricade panel, thin across its faced axis and
      // full-width along the edge, standing EDGE_COVER_HEIGHT tall. Everything
      // else (walls, full-block cover, brush) keeps the full 0.96 box.
      const h = facing ? EDGE_COVER_HEIGHT : height;
      const dims: [number, number, number] = facing
        ? facing === 'E' || facing === 'W'
          ? [EDGE_COVER_THICK, h, TILE * 0.96]
          : [TILE * 0.96, h, EDGE_COVER_THICK]
        : [TILE * 0.96, h, TILE * 0.96];
      // Each block gets its own hashed tint, so a wall reads as a run of placed
      // blocks rather than one shape stamped along a line. A material apiece is
      // affordable here in a way it would not be for the floor: the shipped maps
      // carry fifty-odd terrain squares between them, not several hundred.
      const box = new Mesh(
        solidGeometry(...dims),
        new MeshStandardMaterial({
          color: shade(colour, tileTint(grainSeed, p.x, p.y, grain.tint)),
          ...surface,
          ...grainMap(grain, 1, 1),
        }),
      );
      box.position.copy(toWorld(map, p)).setY(h / 2);
      // JITTER. A run of identical blocks at a fixed pitch reads as tiling,
      // which is a property of software rather than of places.
      //
      // Solids only, and both exclusions are load-bearing. Faced cover is
      // placed exactly on the boundary it guards (COVER-EDGE), and nudging it
      // misreports which side is protected. Brush is a 0.02 LID lying flush on
      // its tile — it has no form for a nudge to flatter, and rotating it just
      // slides a floor covering off its floor, showing bare board at the
      // corners. Filmed: it read as a misaligned decal, not as variation.
      if (facing === undefined && h > TERRAIN_HEIGHT.brush) {
        const nudge = jitterFor(p.x, p.y);
        box.rotation.y = nudge.yaw;
        box.position.x += nudge.dx * TILE;
        box.position.z += nudge.dy * TILE;
      }
      if (facing) {
        // Sit the panel ON the tile boundary it guards, so the square stays
        // visibly walk-onto-able and the wall reads as the line between tiles.
        const off = TILE * 0.5;
        if (facing === 'E') box.position.x += off;
        else if (facing === 'W') box.position.x -= off;
        else if (facing === 'S') box.position.z += off;
        else box.position.z -= off; // N
      }
      // Brush is a 0.02-high lid: it has no silhouette to throw and casting from
      // it only buys shadow acne on the tile it is lying on.
      box.castShadow = h > TERRAIN_HEIGHT.brush;
      box.receiveShadow = true;
      world.add(box);

      // CONTACT. Brush is flush with the floor and occludes nothing, so it gets
      // none — a patch under a 0.02 lid is a smudge with no cause.
      if (h > TERRAIN_HEIGHT.brush) {
        const patch = contactPatch(dims[0], dims[2]);
        if (patch !== undefined) {
          patch.position.copy(box.position).setY(CONTACT_LIFT);
          world.add(patch);
        }
      }
      if (role !== 'brush') terrainBoxes.set(`${role}:${p.x},${p.y}`, box);
    }
  }

  // ── FOF-COLORS: who is looking ────────────────────────────────────────────
  /**
   * The seat the board is being drawn for.
   *
   * Defaults to team 0 driving nothing, which is the honest answer before
   * `setViewer` is called: the opening paint happens during boot, and a
   * renderer that guessed would put the wrong colours on screen for one frame.
   * Every unit reads `foe` under that default rather than `self`, so the
   * failure mode of forgetting to call `setViewer` is a board that looks
   * uniformly hostile — loud, and impossible to mistake for working.
   */
  let viewer: Viewer = { team: 0, seatUnitIds: new Set() };
  /** The two arena end-bars, kept so a seat change can repaint them. */
  const sideMaterials = new Map<0 | 1, MeshStandardMaterial>();

  function paintSides(): void {
    for (const [team, material] of sideMaterials) {
      paintEdgeBar(material, shade(sideColour(team, viewer, palette.fof), SCENERY.spawnShade));
    }
  }

  // ── Scenery (SCENE-DIORAMA) ───────────────────────────────────────────────
  // Purely decorative: drawn, never consulted. It lives in `world` so it tracks
  // the board's own transform, and in its own group so a later set piece has an
  // obvious home that nothing rules-facing can reach into.
  const boost = overlayBoost(palette.open);

  const scenery = new Group();
  scenery.name = 'scenery';
  world.add(scenery);

  const slabW = map.width * TILE + SCENERY.margin * 2;
  const slabH = map.height * TILE + SCENERY.margin * 2;

  const slab = new Mesh(
    new BoxGeometry(slabW, SCENERY.depth, slabH),
    new MeshStandardMaterial({
      color: shade(palette.open, palette.arena.shade), roughness: 0.95, metalness: 0.05,
    }),
  );
  slab.position.y = SCENERY.top - SCENERY.depth / 2;
  slab.receiveShadow = true;
  scenery.add(slab);

  /**
   * A lit bar laid along the platform's top edge.
   *
   * Emissive rather than lit: the rim's job is to be the brightest line in the
   * frame and describe the arena's extent at a glance, and a surface that only
   * catches the sun loses that job the moment the orbit swings it away.
   */
  const edgeBar = (
    width: number, depth: number, x: number, z: number, colour: number, emissive: number,
  ): Mesh => {
    const bar = new Mesh(
      new BoxGeometry(width, SCENERY.rim.height, depth),
      new MeshStandardMaterial({
        color: colour, emissive: colour, emissiveIntensity: emissive,
        roughness: 0.35, metalness: 0.1,
      }),
    );
    // ON TOP of the slab, not inside it. The slab runs from `top` downward, so a
    // bar centred below `top` is buried in the very geometry it is meant to edge.
    bar.position.set(x, SCENERY.top + SCENERY.rim.height / 2, z);
    return bar;
  };

  const inset = SCENERY.rim.thickness / 2;
  // AMBIENT-MOTION: the four neutral arena bars breathe. The team spawn markers
  // below do NOT — they are orientation ("which way is home"), and a pulsing
  // team-coloured edge is exactly the gameplay-adjacent motion §4 forbids.
  const rimMaterials: MeshStandardMaterial[] = [];
  for (const [w, d, x, z] of [
    [slabW, SCENERY.rim.thickness, 0, -slabH / 2 + inset],
    [slabW, SCENERY.rim.thickness, 0, slabH / 2 - inset],
    [SCENERY.rim.thickness, slabH, -slabW / 2 + inset, 0],
    [SCENERY.rim.thickness, slabH, slabW / 2 - inset, 0],
  ] as const) {
    const bar = edgeBar(w, d, x, z, palette.arena.rim, SCENERY.rim.emissive);
    rimMaterials.push(bar.material as MeshStandardMaterial);
    scenery.add(bar);
  }

  // Each team's end of the arena, in its own colour. This is orientation, not
  // gameplay: after a free orbit has spun the board 180° "which way is home"
  // stops being obvious, and the fix belongs in the scenery rather than in
  // another HUD element competing for the same corner.
  //
  // FOF-COLORS / the owner's note — *"the colored bars on each side of the map
  // should be blue for ally and red for enemy side. This should change
  // depending on player perspective."* A bar is a **side**, so it takes the two
  // side colours rather than the three unit ones: an end of the arena is not
  // "the character you are ordering", so the ally green would be a category
  // error. The materials are kept because the answer changes when the seat
  // does — in hot-seat that is every Lock In, and a board that kept team 0's
  // reading after the pass would be worse than the absolute colours were.
  for (const team of [0, 1] as const) {
    const edge = spawnEdge(map, team);
    const lengthwise = edge === 'west' || edge === 'east';
    const span = (lengthwise ? slabH : slabW) * SCENERY.spawnSpan;
    const offset = (lengthwise ? slabW : slabH) / 2 - SCENERY.rim.thickness * 1.6;
    const [w, d, x, z] = lengthwise
      ? [SCENERY.rim.thickness, span, edge === 'west' ? -offset : offset, 0] as const
      : [span, SCENERY.rim.thickness, 0, edge === 'north' ? -offset : offset] as const;
    const bar = edgeBar(w, d, x, z, 0xffffff, SCENERY.spawnEmissive);
    sideMaterials.set(team, bar.material as MeshStandardMaterial);
    scenery.add(bar);
  }
  paintSides();

  // ── Terrain props (MAP_PIPELINE phase 5) ──────────────────────────────────
  // A wall tile becomes a stone pillar, a cover tile a wooden barricade — loaded
  // from `public/models/props/` and placed over the plain box that is already
  // standing there. Fail-soft, exactly like a character model: the box is drawn
  // first and synchronously, so the gameplay read is right from frame one, and a
  // manifest or `.glb` that 404s simply leaves the box. Nothing here is consulted
  // by any rule — a prop is scenery that happens to sit on a played square.
  const propGroup = new Group();
  propGroup.name = 'props';
  world.add(propGroup);
  // PROP-FADE: the distinct materials the loaded props share, so a single
  // opacity per material ghosts every pillar and barricade at a low camera
  // angle (see `applyCamera`). Collected as templates load; empty until then,
  // which is why the fade in `applyCamera` is a no-op on a board with no props.
  const propMaterials = new Set<MeshStandardMaterial>();

  const loadProps = async (): Promise<void> => {
    try {
      const base = 'models';
      const res = await fetch(`${base}/props/manifest.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`props manifest ${res.status}`);
      const manifest = (await res.json()) as {
        props?: {
          theme: string; role: string; yawSteps?: number; height?: number;
          // Several interchangeable variants per role; the board picks one per tile.
          variants?: { file: string; version?: string }[];
          // Legacy single-file format, read as a one-variant list so an older
          // committed manifest still renders while a rebuild is pending.
          file?: string; version?: string;
        }[];
      };
      const mine = (manifest.props ?? []).filter((e) => e.theme === palette.themeId);
      if (mine.length === 0) return; // this theme has no props yet — boxes it is
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();

      const url = (file: string, version?: string): string =>
        version === undefined || version === '' ? `${base}/${file}` : `${base}/${file}?v=${encodeURIComponent(version)}`;

      for (const entry of mine) {
        const squares = entry.role === 'wall' ? map.walls : entry.role === 'cover' ? map.cover : [];
        if (squares.length === 0) continue;
        const files = entry.variants ?? (entry.file !== undefined ? [{ file: entry.file, version: entry.version }] : []);
        if (files.length === 0) continue;

        // Load every variant mesh for the role, dropping any that fail — a role
        // with even one usable variant still dresses its tiles.
        const templates: Group[] = [];
        for (const v of files) {
          try {
            templates.push((await loader.loadAsync(url(v.file, v.version))).scene as Group);
          } catch (err) {
            console.warn(`[cards] terrain prop "${entry.theme}/${entry.role}" variant ${v.file} did not load: ${String(err)}`);
          }
        }
        if (templates.length === 0) continue;
        for (const t of templates) {
          t.traverse((o) => {
            const mesh = o as Mesh;
            if (!mesh.isMesh) return;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            // Clones share these materials, so one opacity fades every instance —
            // exactly the global pitch-fade we want.
            for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              propMaterials.add(mat as MeshStandardMaterial);
            }
          });
        }

        for (const sq of squares) {
          // Pick which variant this tile shows (my hashed variety), then place it.
          const choice = placeProp(map.id, sq.x, sq.y, { yawSteps: entry.yawSteps, variants: templates.length });
          const inst = templates[choice.variant]!.clone(true);
          inst.position.copy(toWorld(map, sq)); // prop base sits at local y=0 = the floor
          const facing = entry.role === 'cover' ? (sq as { facing?: 'N' | 'S' | 'E' | 'W' }).facing : undefined;
          if (facing) {
            // COVER-EDGE: a faced cover tile is a half-wall on ONE edge. Sit the
            // barricade on that tile boundary, turn it to run ALONG the edge
            // (stakes span +x, so N/S keep yaw 0 and E/W turn a quarter), and
            // stretch it to crouch-cover height. The map's authored facing is the
            // orientation here — not the hashed yaw, which a directional fence has
            // no use for.
            const off = TILE * 0.5;
            if (facing === 'E') { inst.position.x += off; inst.rotation.y = Math.PI / 2; }
            else if (facing === 'W') { inst.position.x -= off; inst.rotation.y = Math.PI / 2; }
            else if (facing === 'S') { inst.position.z += off; inst.rotation.y = 0; }
            else { inst.position.z -= off; inst.rotation.y = 0; } // N
            inst.scale.y = EDGE_COVER_HEIGHT / (entry.height ?? COVER_HEIGHT);
          } else {
            // A full-block cover tile or a wall: hashed quarter-turn for variety.
            inst.rotation.y = choice.yawRadians;
          }
          propGroup.add(inst);
          // Hide the box this prop now stands for. Kept (not removed) so a future
          // theme swap could bring it back without rebuilding the board.
          const box = terrainBoxes.get(`${entry.role}:${sq.x},${sq.y}`);
          if (box !== undefined) box.visible = false;
        }
      }
      fadeProps();   // set the opacity for the pitch the camera is already at
      markDirty();
    } catch (err) {
      // The whole load failing is ordinary — an older build with no props, a
      // path typo — and it must never break the board: every tile keeps its box.
      console.warn(`[cards] terrain props not loaded, drawing boxes: ${String(err)}`);
    }
  };
  if (propsOn) void loadProps();

  // ── Keyed unit objects (A1's principle, in 3D) ────────────────────────────
  const unitObjects = new Map<string, Group>();
  /** Loose meshes that must face the camera — decoy nameplates, so far. */
  let billboards: Mesh[] = [];

  /** Point a unit's intent tile at the right texture, or hide it. */
  const setIntent = (bars: Group, intent: { label: string; locked: boolean } | undefined): void => {
    const mesh = bars.getObjectByName('intent');
    if (!(mesh instanceof Mesh)) return;
    mesh.visible = intent !== undefined;
    if (intent === undefined) return;
    (mesh.material as MeshBasicMaterial).map = intentTexture(intent.label, intent.locked);
    (mesh.material as MeshBasicMaterial).needsUpdate = true;
  };

  /**
   * Point a unit's plate at the right texture, or hide it.
   *
   * Hidden rather than blank for the absent case: a dark rectangle over a
   * fogged square is still a marker saying "something is here", which is the
   * whole thing the fog is for.
   */
  const setPlate = (bars: Group, plate: Nameplate | undefined, fof: Fof): void => {
    const mesh = bars.getObjectByName('plate');
    if (!(mesh instanceof Mesh)) return;
    mesh.visible = plate !== undefined;
    if (plate === undefined) return;
    (mesh.material as MeshBasicMaterial).map = plateTexture(plate, fof);
    (mesh.material as MeshBasicMaterial).needsUpdate = true;
  };

  /**
   * Undefined until a match actually needs rigged characters.
   *
   * Importing this module eagerly pulls Three's animation and skinning systems
   * into the main bundle — around 66 kB gzipped on top of the loaders, for a
   * feature eight of the nine characters do not use yet. Deferring it keeps the
   * cost with the matches that pay it.
   */
  let models: CharacterModels | undefined;
  const instances = new Map<string, ModelInstance>();
  /** unitId → the character its group was built for, for `staleUnitGroups`. */
  const unitCharacter = new Map<string, string | undefined>();
  /** Characters whose scaling has been reported. One line each, not one per unit. */
  const measured = new Set<string>();
  /** unitId -> seconds of victim flash left. */
  const flashing = new Map<string, number>();
  /** The camera rattle in flight, if any. */
  let shake: { seed: number; elapsed: number; duration: number; amplitude: number } | undefined;
  /**
   * The direction each unit was last told to look.
   *
   * Renderer state, like `baseAlpha` and `fadeOf`, and for the same reason: a
   * unit's group is rebuilt whenever its model arrives, and anything not
   * re-applied on rebuild is silently lost. Facing was applied straight to the
   * object and nothing held it, so every character snapped back to its rest
   * direction the moment its model loaded — which is the one rebuild that
   * always happens.
   */
  const facingOf = new Map<string, { dx: number; dy: number }>();

  /**
   * Give every mesh under a unit the RIM edge term — see `rim.ts`.
   *
   * A shader patch rather than a light, because three tests a light's layers
   * against the **camera** and not against each mesh, so there is no such thing
   * as a light that only reaches units. The patch is injected after
   * `<emissivemap_fragment>`, which is the first point in the standard fragment
   * shader where `normal` exists (`<normal_fragment_begin>` runs just above it)
   * and where `totalEmissiveRadiance` is still open to be added to.
   *
   * Adding to *emissive* is what makes the rim compose correctly with the two
   * things already writing to these materials: the victim flash raises
   * `emissive` and the rim rides on top of it rather than fighting it, and the
   * deferred-death fade scales `opacity`, which emissive does not touch. Both
   * are safe here only because `detachMaterials` has already given each unit its
   * own copies (`character-model.ts`) — patching shared materials would put the
   * rim on every unit of a character at once, which is the same bug that
   * function exists to prevent.
   */
  const applyRim = (root: Object3D): void => {
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of list) {
        material.onBeforeCompile = (shader: { fragmentShader: string }): void => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>\n${RIM_GLSL}`,
          );
        };
        // Patched and unpatched standard materials must not share a compiled
        // program. Without a distinct key three reuses whichever was compiled
        // first, and the rim either applies to nothing or to everything.
        material.customProgramCacheKey = () => 'rim';
        material.needsUpdate = true;
      }
    });
  };

  /**
   * FOF-COLORS' ring beneath a unit's feet.
   *
   * **Parented to the unit, not drawn as a highlight layer.** A highlight is
   * keyed to a board *square*, and units do not live on squares during
   * playback — `setUnitAt` slides them between tiles a frame at a time. A
   * square-keyed ring would jump a whole tile at the end of a move while the
   * body it belongs to glided, which reads as the ring belonging to the ground
   * rather than to the character.
   *
   * `MeshBasicMaterial` so it does not take the scene lighting: this is a UI
   * mark that happens to live in the world, and a friend/foe read that dimmed
   * in shadow would fail exactly where the board is hardest to parse.
   */
  const buildFootRing = (): Mesh => {
    const ring = asOverlay(new Mesh(
      new RingGeometry(TILE * FOF_RING_INNER, TILE * FOF_RING_OUTER, 28),
      new MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }),
    ), PLATE_ORDER - 1);
    ring.name = 'fofRing';
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = FOF_RING_LIFT;
    return ring;
  };

  /**
   * Paint one unit's friend/foe colour — body tint where there is one, and the
   * foot ring always.
   *
   * Runs on every `show()` rather than at build time, so a seat change repaints
   * instead of rebuilding. See the note where the body material is created.
   */
  const paintFof = (g: Group, subject: { unitId: string; owner: 0 | 1 }): Fof => {
    const fof = fofFor(subject, viewer);
    const colour = fofColour(fof, palette.fof);
    const ring = g.getObjectByName('fofRing');
    if (ring instanceof Mesh) (ring.material as MeshBasicMaterial).color.setHex(colour);
    // Only the box body takes the tint. A rigged model keeps its own texture —
    // repainting a character's skin in team colour is not what "outline" means,
    // and the ring plus the nameplate carry the read for those.
    const body = g.getObjectByName('body');
    if (body instanceof Mesh) (body.material as MeshStandardMaterial).color.setHex(colour);
    return fof;
  };

  const buildUnit = (unit: RenderUnit): Group => {
    const g = new Group();
    g.name = unit.unitId;
    unitCharacter.set(unit.unitId, unit.characterId);

    const instance = unit.characterId === undefined ? undefined : models?.instance(unit.characterId);
    if (instance !== undefined) {
      // Scale from the model's own bounds rather than a hard-coded factor, so a
      // taller or shorter character still stands MODEL_HEIGHT_TILES high.
      // `modelBounds`, not `Box3.setFromObject` — see the note on that function.
      const { minY, height } = modelBounds(instance.root);
      const scale = height > 0 ? (TILE * MODEL_HEIGHT_TILES) / height : 1;
      // Reported once per character, because "he looks too big" and "the box
      // measured wrong" are indistinguishable by eye and this is the number
      // that separates them. `height` is the model's own metres; the last
      // figure is what it ends up occupying on the board.
      if (!measured.has(unit.characterId!)) {
        measured.add(unit.characterId!);
        console.info(
          `[cards] ${unit.characterId}: model ${height.toFixed(3)}u -> scale ${scale.toFixed(3)}` +
          ` -> ${(height * scale).toFixed(2)} tiles tall`,
        );
      }
      instance.root.scale.setScalar(scale);
      instance.root.position.y = -minY * scale;
      // AFTER the measurement above, not before: a door parented earlier counts
      // as part of the body, and the man shrinks to fit the pair into
      // MODEL_HEIGHT_TILES. Props are authored in tiles and hang inside this
      // scaled space, so they divide that scale back out.
      instance.attachProps(scale, TILE);
      instance.root.name = 'body';
      instances.set(unit.unitId, instance);
      // RIM goes on the model only — never on the foot ring, which is a UI
      // mark in MeshBasicMaterial with no emissive to add to.
      applyRim(instance.root);
      // The ring matters MORE on the model path, not less: a rigged character
      // wears its own texture, so the body carries no team tint at all and the
      // ring is the whole friend/foe read at the unit itself.
      g.add(instance.root, buildBars(TILE * MODEL_HEIGHT_TILES), buildFootRing());
      world.add(g);
      return g;
    }

    const body = new Mesh(
      new BoxGeometry(TILE * 0.55, UNIT_HEIGHT, TILE * 0.55),
      // Always `transparent`, even at full opacity: flipping the flag later
      // needs a shader recompile (`needsUpdate`), and forgetting it makes every
      // fade and dim silently do nothing. Paying for blending up front is the
      // cheap, un-forgettable version.
      // Colour is NOT set here. FOF-COLORS is viewer-relative, and a unit
      // group outlives the seat that built it — in hot-seat the same body is
      // reused across a Lock In that swaps which side is "self". Tinting on
      // build would freeze the first viewer's answer onto the mesh; `show()`
      // re-applies it every paint instead, which is also what makes
      // `setViewer` a repaint rather than a rebuild.
      new MeshStandardMaterial({ transparent: true, ...SURFACE.unit }),
    );
    body.name = 'body';
    body.castShadow = true;
    body.position.y = UNIT_HEIGHT / 2;
    applyRim(body);
    g.add(body, buildBars(UNIT_HEIGHT), buildFootRing());
    world.add(g);
    return g;
  };

  /** A bar's fill is scaled from its left edge, so width reads as a fraction. */
  // ── Highlight layers ──────────────────────────────────────────────────────
  /**
   * One closed outline, filled on the ground plane.
   *
   * Built in the XY plane from board coordinates and then laid flat — the same
   * `squareToWorldXZ` mapping picking uses, so the fiction and the truth are
   * registered to the same grid and a clipped corner reads as geometry rather
   * than as a bug.
   */
  /**
   * One stroked route: a line through the tile centres plus a diamond on the
   * last square. Shared by `drawPath` and `drawPaths`, so a single route and one
   * of several are drawn by the same code — clearing the layer is the caller's
   * job, because that is the only part the two differ on.
   */
  const strokeRoute = (g: Group, squares: readonly Vec2[], color: number, dashed: boolean): void => {
    if (squares.length === 0) return;
    // A drawn move is a LINE through tile centres, not a field of tiles: it says
    // which way you go and in what order, which reachability shading cannot
    // (AIM1). Sprint is the dashed one.
    const points = squares.map((p) => toWorld(map, p).setY(0.08));
    const line = new Line(
      new BufferGeometry().setFromPoints(points),
      dashed
        ? new LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.2 })
        : new LineBasicMaterial({ color }),
    );
    if (dashed) line.computeLineDistances();
    g.add(line);

    const last = squares[squares.length - 1]!;
    const marker = new Mesh(
      new PlaneGeometry(TILE * 0.4, TILE * 0.4),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.rotation.z = Math.PI / 4; // a diamond, so the endpoint reads as an endpoint
    marker.position.copy(toWorld(map, last)).setY(0.09);
    g.add(marker);
  };

  const drawOneShape = (g: Group, outline: readonly Vec2[], color: number, opacity: number, lift = SHAPE_LIFT, hole?: readonly Vec2[]): void => {
    if (outline.length < 3) return;
    const shape = new Shape();
    outline.forEach((p, i) => {
      const w = squareToWorldXZ(map, p);
      if (i === 0) shape.moveTo(w.x, w.z);
      else shape.lineTo(w.x, w.z);
    });
    shape.closePath();
    // A real hole, not a keyhole. Tracing the inner circle back along the same
    // outline and hoping the triangulator reads it as an annulus does not work
    // — ear clipping fills it straight in, and the "ring" comes out a disc.
    // `Shape.holes` is what Three provides for exactly this.
    if (hole !== undefined && hole.length >= 3) {
      const path = new Path();
      hole.forEach((p, i) => {
        const w = squareToWorldXZ(map, p);
        if (i === 0) path.moveTo(w.x, w.z);
        else path.lineTo(w.x, w.z);
      });
      path.closePath();
      shape.holes.push(path);
    }
    const mesh = new Mesh(
      new ShapeGeometry(shape),
      new MeshBasicMaterial({ color, transparent: true, opacity, side: DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = Math.PI / 2; // XY plane -> ground plane
    mesh.position.y = lift;
    g.add(mesh);
  };

  const layers = new Map<string, Group>();
  const layerGroup = (name: string): Group => {
    let g = layers.get(name);
    if (g === undefined) {
      g = new Group();
      layers.set(name, g);
      world.add(g);
    }
    return g;
  };

  /**
   * Throw away a unit's scene object so `show()` rebuilds it.
   *
   * Only ever called for a unit currently drawn as a BOX (see
   * `staleUnitGroups`), which is why disposing the whole tree is safe: a box and
   * its bars own their geometry and materials outright. A model instance shares
   * both with the loaded scene it was cloned from — `SkeletonUtils.clone` copies
   * the bones and nothing else — so disposing one of those would blank every
   * later instance of that character.
   */
  const dropUnitGroup = (unitId: string): void => {
    const g = unitObjects.get(unitId);
    if (g === undefined) return;
    g.traverse((child) => {
      if (child instanceof Mesh || child instanceof Line) {
        child.geometry.dispose();
        (child.material as Material).dispose();
      }
    });
    world.remove(g);
    unitObjects.delete(unitId);
    unitCharacter.delete(unitId);
  };

  /**
   * Turn a unit's body to its stored direction.
   *
   * `atan2(x, z)` rather than the usual `atan2(y, x)`: the angle is measured
   * from +z, which is where the model already looks — Blender's front is -Y,
   * `export_yup` makes that +Z, and board +y is world +z.
   */
  const applyFacing = (unitId: string): void => {
    const f = facingOf.get(unitId);
    const body = unitObjects.get(unitId)?.getObjectByName('body');
    if (f !== undefined && body !== undefined) body.rotation.y = Math.atan2(f.dx, f.dy);
  };

  const disposeChildren = (g: Group): void => {
    for (const child of [...g.children]) {
      g.remove(child);
      if (child instanceof Mesh || child instanceof Line) {
        child.geometry.dispose();
        (child.material as Material).dispose();
      }
    }
  };

  // ── Unit opacity: three independent inputs, one result ────────────────────
  // `base` is aliveness (set by show()), `fade` is the cue-driven deferred-death
  // fade, `spotlight` is the phase dim. Keeping them separate is what lets a
  // unit be visibly dying and spotlit at the same time without either clobbering
  // the other.
  const baseAlpha = new Map<string, number>();
  const fadeOf = new Map<string, number>();
  let spotlight: Set<string> | null = null;

  /**
   * Paint a unit's flash. `left` is the seconds remaining, so the lit amount
   * decays to nothing on its own.
   *
   * Emissive rather than colour: the material's colour is the character's
   * identity (team tint on a box, the atlas on a model), and writing to it
   * means remembering what to put back. Emissive is additive light with a
   * natural rest value of black, so releasing it is setting it to zero.
   */
  const refreshFlash = (unitId: string, left: number): void => {
    const body = unitObjects.get(unitId)?.getObjectByName('body');
    if (body === undefined) return;
    paintFlash(body, left);
  };

  const refreshOpacity = (unitId: string): void => {
    const g = unitObjects.get(unitId);
    if (g === undefined) return;
    const dimmed = spotlight !== null && !spotlight.has(unitId);
    const alpha = (baseAlpha.get(unitId) ?? 1) * (fadeOf.get(unitId) ?? 1) * (dimmed ? DIM_ALPHA : 1);
    const body = g.getObjectByName('body');
    // A box has one mesh; a rigged model is a tree of them. Traverse either way.
    // The cast follows BOARD-LIT: board meshes are `MeshStandardMaterial` now,
    // and a Lambert cast here would be a lie the compiler happens not to catch.
    body?.traverse((o) => {
      if (o instanceof Mesh) {
        const mat = o.material as MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = alpha;
      }
    });
    const bars = g.getObjectByName('bars');
    if (bars !== undefined) bars.visible = alpha > 0.5;
  };
  const refreshAllOpacity = (): void => { for (const id of unitObjects.keys()) refreshOpacity(id); };

  const raycaster = new Raycaster();
  const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
  const rad = (deg: number): number => (deg * Math.PI) / 180;

  let projection: ProjectionName = 'isometric';
  // Pitch and yaw are the camera's real state; a projection is just a preset
  // pitch. Once the orbit can move them, the two stop being the same thing.
  let pitchDeg: number = PITCH.isometric;
  let yawDeg = 0;
  // SCENE-DIORAMA: the opening frame allows for the ledge. Fitting the board
  // exactly put the platform and its lit rim just outside the frustum — drawn
  // every frame and never once seen.
  let span = Math.max(map.width, map.height) + SCENERY.margin * 2;
  let centre = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
  // Where the auto-camera is heading. The live camera eases toward it so the
  // frame glides between actors instead of cutting.
  let wantCentre = { ...centre };
  let wantSpan = span;
  let orbitOn = false;
  /**
   * Whether a pan has taken the camera off the auto-framing.
   *
   * Separate from `orbitOn` because they are different kinds of manual: orbit
   * is a *mode* the player switches into and out of deliberately, while a pan
   * is a one-off act that happens to imply "stop moving my camera". Folding a
   * pan into `orbitOn` would flip the HUD's toggle underneath the player, who
   * asked for neither.
   */
  let panOn = false;
  let width = 900;
  let height = 560;

  /**
   * RENDER-ON-DEMAND — whether the next `requestAnimationFrame` has anything to do.
   *
   * The loop used to call `drawFrame()` on **every** frame, whether or not
   * anything had changed. Measured under SwiftShader that is a median 302ms
   * frame — 3.3 fps — so the main thread never idles. A player pays a core to
   * look at a board that is not moving, and the browser suite pays worse: every
   * Playwright operation queues behind a 300–900ms frame, which is why
   * `boundingBox()` could time out on an element it had already resolved as
   * *visible*. That one fact explains the whole of the suite's slowness, why
   * disabling character models changed nothing, and why a second worker made it
   * worse rather than better.
   *
   * Starts true so the opening frame always draws.
   */
  let dirty = true;
  const markDirty = (): void => { dirty = true; };

  /** Frames actually drawn. The proof that an idle board stops costing anything. */
  let framesDrawn = 0;
  const onDemand = options.renderOnDemand ?? browserRenderOnDemand();

  function applyCamera(): void {
    markDirty();
    const aspect = width / height;
    const halfH = span / 2;
    const halfW = halfH * aspect;
    // UI-VIEWPORT: an **asymmetric** frustum, so the board is centred in the
    // *uncovered* part of the canvas rather than in the canvas. A bottom inset
    // (the hotbar) shifts the world window down, which moves the board up and
    // clear of it. Symmetric when there are no insets, which is the old
    // behaviour to the pixel.
    const shiftX = ((insets.left - insets.right) / width) * halfW;
    const shiftY = ((insets.bottom - insets.top) / height) * halfH;
    camera.left = -halfW - shiftX;
    camera.right = halfW - shiftX;
    camera.top = halfH - shiftY;
    camera.bottom = -halfH - shiftY;

    // Pitch is the whole projection story: 90° looks straight down, ~35.264°
    // gives true isometric. Yaw swings that same camera around the board, so a
    // free orbit is two more numbers, not a second camera path.
    const pitch = rad(pitchDeg);
    const yaw = rad(yawDeg);
    const target = toWorld(map, centre);
    // The rattle is added HERE rather than to `centre`, so it never feeds back
    // into the auto-camera's easing: `centre` stays exactly where framing put
    // it and the shake decays to nothing on top, which is what makes the camera
    // land back where it started instead of drifting a little with every hit.
    if (shake !== undefined) {
      const o = shakeOffset(shake.seed, shake.elapsed, shake.duration, shake.amplitude);
      target.x += o.x;
      target.z += o.z;
    }
    const dist = 60;
    const horizontal = Math.cos(pitch) * dist;
    camera.position.set(
      target.x + Math.sin(yaw) * horizontal,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(yaw) * horizontal,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    fadeProps();
  }

  // PROP-FADE: ghost the props toward transparent as the orbit drops to a low
  // angle, so a tall pillar never hides the unit behind it (Atlas Reactor does
  // the same). Runs from `applyCamera`, i.e. on every camera change, so it costs
  // nothing on a still board and needs no per-frame tick. `transparent` is
  // flipped only when it actually changes — that flag forces a shader recompile,
  // the opacity does not — and depth is written only while essentially opaque so
  // a ghosted pillar does not occlude what is drawn behind it.
  const fadeProps = (): void => {
    if (propMaterials.size === 0) return;
    const opacity = propOpacity(pitchDeg);
    const ghost = opacity < 0.99;
    for (const mat of propMaterials) {
      mat.opacity = opacity;
      if (mat.transparent !== ghost) {
        mat.transparent = ghost;
        mat.depthWrite = !ghost;
        mat.needsUpdate = true;
      }
    }
  };

  /**
   * UI-VIEWPORT — how much of the canvas is covered by chrome, in CSS pixels.
   *
   * The canvas fills the whole viewport now, so the HUD and the log sit *over*
   * it rather than beside it. The camera has to know that, or the bottom rank of
   * the board is framed perfectly and then hidden behind the hotbar.
   */
  let insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const visibleW = (): number => Math.max(1, width - insets.left - insets.right);
  const visibleH = (): number => Math.max(1, height - insets.top - insets.bottom);

  /** The span that frames the whole board **in the uncovered region**. */
  const boardSpan = (): number => {
    // Depth foreshortens by sin(pitch) — at true isometric the board is only
    // ~58% as tall on screen as it is deep, so framing by raw height would
    // leave the board floating in a letterbox.
    // SCENE-DIORAMA: the thing to frame is the *arena* — the board plus the
    // ledge it sits on. Framing the board alone left the platform and its lit
    // rim just outside the frustum, drawn every frame and never once seen.
    const arenaW = map.width + SCENERY.margin * 2;
    const arenaD = map.height + SCENERY.margin * 2;
    const projectedDepth = arenaD * Math.sin(rad(pitchDeg));
    // `span` is the world height of the FULL canvas, so fitting the arena into a
    // fraction of that canvas means scaling the requirement up by the reciprocal
    // of that fraction. With no insets both terms collapse to
    // `max(projectedDepth, arenaW / aspect)` exactly.
    //
    // BOARD_ZOOM then divides that: the frame is deliberately tighter than the
    // arena, so the map runs off the edges and everything on it reads bigger.
    // Floored at SPAN_LIMITS.min so a small map cannot zoom past the wheel's
    // own limit.
    return Math.max(
      Math.max(
        projectedDepth * (height / visibleH()),
        arenaW * (height / visibleW()),
      ) * 1.08 / BOARD_ZOOM,
      SPAN_LIMITS.min,
    );
  };

  /**
   * Pull a camera centre back so the frame stays inside the board. Without this
   * the auto-camera happily pans off the edge and shows a band of void next to
   * half a board — which is worse than not following the action at all.
   */
  const clampToBoard = (
    c: { x: number; y: number },
    spanValue: number,
    margin = Infinity,
  ): { x: number; y: number } =>
    clampCentre(c, spanValue, width / height, pitchDeg, map, margin);

  /**
   * Ease the live camera one frame toward the auto-camera's target.
   *
   * `delta` is the frame's own duration in seconds, because the ease is
   * denominated in wall time and not in frames — see `camera-ease.ts` for why
   * that distinction is the difference between a 1s glide and a 5s one. A
   * `undefined` result means the camera is already on target, and that is the
   * only path here that does **not** mark the scene dirty: on an idle board it
   * is the path taken every frame.
   */
  const stepCamera = (delta: number): void => {
    if (orbitOn) return; // the player owns the camera; don't fight them
    const next = easeCamera(
      { x: centre.x, y: centre.y, span },
      { x: wantCentre.x, y: wantCentre.y, span: wantSpan },
      delta,
    );
    if (next === undefined) return;
    centre = { x: next.x, y: next.y };
    span = next.span;
    applyCamera();
  };

  /**
   * Bars face the camera and hold a constant on-screen size. Under an
   * orthographic camera the visible height IS `span`, so scaling by
   * `span / BAR_REF_SPAN` exactly cancels zoom — a bar reads the same at any
   * framing, which is the point of billboarding it.
   */
  const billboard = (): void => {
    const scale = span / BAR_REF_SPAN;
    for (const g of unitObjects.values()) {
      const bars = g.getObjectByName('bars');
      if (bars === undefined) continue;
      bars.quaternion.copy(camera.quaternion);
      bars.scale.setScalar(scale);
    }
    // A decoy's fake plate is not inside a keyed unit object — the decoy layer
    // is rebuilt wholesale each `show()` — so it is registered here instead. It
    // has to billboard by exactly the same rule, or the one plate that does not
    // turn with the camera is the one that gives the decoy away.
    for (const plate of billboards) {
      plate.quaternion.copy(camera.quaternion);
      plate.scale.setScalar(scale);
    }
  };

  // ── Free-orbit input ──────────────────────────────────────────────────────
  // Secondary buttons always orbit; the left button orbits only in free-orbit
  // mode, so click-to-select never competes with a camera drag.
  const canvas = renderer.domElement;
  let dragging: 'orbit' | 'pan' | undefined;
  let dragged = 0;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    // CAMERA-CONTROLS: the middle button pans; the right button orbits, and so
    // does the left one in free-orbit mode.
    //
    // Middle is the one binding that moves, and it moves off a duplicate:
    // middle and right did the identical thing, so orbit loses nothing a player
    // could notice. That mattered — the ask was to *add* a pan, not to redesign
    // the two camera gestures that already worked, and every alternative took
    // something. A modifier+drag would have collided with Shift-click's move
    // route (WAYPOINTS-FIX); the wheel is zoom; and taking the right button
    // would have been a real change to orbit rather than a nominal one.
    const button = e.button === 1 ? 'pan'
      : e.button === 2 || (orbitOn && e.button === 0) ? 'orbit'
      : undefined;
    if (button === undefined) return;
    dragging = button;
    dragged = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging === undefined) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragged += Math.abs(dx) + Math.abs(dy);
    if (dragging === 'pan') return void api.panBy(dx, dy);
    yawDeg = (yawDeg + dx * ORBIT_SENSITIVITY) % 360;
    pitchDeg = clamp(pitchDeg - dy * ORBIT_SENSITIVITY, PITCH_LIMITS.min, PITCH_LIMITS.max);
    applyCamera();
  });
  const endDrag = (e: PointerEvent): void => {
    if (dragging === undefined) return;
    dragging = undefined;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  // A drag that moved the camera must not also count as a click on a square.
  // Capture phase on the canvas beats the app's listener on the container.
  canvas.addEventListener('click', (e) => {
    if (dragged > DRAG_SLOP) {
      e.stopPropagation();
      dragged = 0;
    }
  }, true);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    span = clamp(span * (e.deltaY > 0 ? 1.1 : 1 / 1.1), SPAN_LIMITS.min, SPAN_LIMITS.max);
    wantSpan = span;
    applyCamera();
  }, { passive: false });

  const performanceNow = (): number =>
    typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();

  let frameHandle: number | undefined;
  let afterFrame: (() => void) | undefined;
  let lastFrameMs: number | undefined;
  // Wall-clock zero for the ambient breath, so `elapsed` starts at 0 and the
  // first animated frame lands on the base intensity.
  const ambientStartMs = performanceNow();
  // Ambient wakes the loop at most this often. The breath is a 5-second cycle,
  // so 30 fps of scalar updates is indistinguishable from 60 and honours what
  // RENDER-ON-DEMAND exists for: not burning a core when nothing needs it. The
  // camera ease and mid-clip models still draw at full rate — this throttles
  // only the frames ambient alone would have requested on an otherwise idle board.
  const AMBIENT_FRAME_MS = 1000 / 30;
  let lastAmbientMs: number | undefined;
  const drawFrame = (): void => {
    // Mixers advance on WALL time, not on cue time. Clip selection is already
    // driven from the timeline; playback just has to run at the rate the clip
    // was authored for, or it judders whenever the frame rate does.
    const nowMs = performanceNow();
    const delta = lastFrameMs === undefined ? 0 : Math.min((nowMs - lastFrameMs) / 1000, 0.1);
    lastFrameMs = nowMs;
    if (delta > 0) {
      for (const [id, instance] of instances) {
        // `show()` hides departed units rather than removing them, so without
        // this every unit that ever existed keeps animating off-screen forever.
        if (unitObjects.get(id)?.visible !== false) instance.update(delta);
      }
    }

    // VFX decay on WALL time like the mixers: a flash is 80ms of real time
    // whatever the frame rate, and hitstop freezes the cue clock, not this one.
    if (delta > 0) {
      for (const [id, left] of flashing) {
        const next = left - delta;
        if (next <= 0) { flashing.delete(id); refreshFlash(id, 0); }
        else { flashing.set(id, next); refreshFlash(id, next); }
      }
      if (shake !== undefined) {
        shake.elapsed += delta;
        if (shake.elapsed >= shake.duration) shake = undefined;
        applyCamera();
      }
    }

    // AMBIENT-MOTION: the arena rim breathes on wall time. Gated on `ambientOn`,
    // so a frozen board (tests, reduced motion) leaves every rim material at its
    // constructed `SCENERY.rim.emissive` and stays byte-identical to a still
    // rim. `rimBreath` is 1 at elapsed 0 and never rises above the base, so the
    // first animated frame equals the frozen one and no frame is brighter than
    // the value the pixel tests already accept.
    if (ambientOn && rimMaterials.length > 0) {
      const elapsed = (nowMs - ambientStartMs) / 1000;
      const intensity = rimBreath(SCENERY.rim.emissive, elapsed);
      for (const mat of rimMaterials) mat.emissiveIntensity = intensity;
    }

    stepCamera(delta);
    billboard();
    renderer.render(scene, camera);
    // After the camera has moved, so anything DOM-anchored to a world position
    // is repositioned against the frame that was actually just drawn.
    afterFrame?.();
  };

  applyCamera();
  renderer.setSize(width, height);

  /**
   * The last board `show()` was given, so a late-arriving model can repaint it.
   *
   * Nothing else drives a rebuild: `drawFrame` renders the scene graph but never
   * reconciles it, and `show()` only runs on a state change. Without this, the
   * groups dropped when a model finishes loading stay dropped — the units simply
   * vanish until the player next clicks something. Found by driving the built
   * client in a real browser: Aegis was missing from the board entirely until an
   * unrelated click repainted it.
   */
  let lastShown: Parameters<Renderer['show']> | undefined;

  const api: Renderer = {
    setViewer(next) {
      // Cheap identity check first: `show()` runs on every pointer move during
      // mouse-follow aiming, and the app calls this beside it. Repainting the
      // board because nothing changed is exactly the kind of idle work
      // RENDER-IDLE-QUIET exists to remove.
      const same = next.team === viewer.team
        && next.seatUnitIds.size === viewer.seatUnitIds.size
        && [...next.seatUnitIds].every((id) => viewer.seatUnitIds.has(id));
      if (same) return;
      viewer = { team: next.team, seatUnitIds: new Set(next.seatUnitIds) };
      paintSides();
      // Re-run the last paint so live units, decoys and traps pick the new
      // answer up immediately — a seat change that only took effect on the next
      // unrelated redraw would leave the board lying about whose side it is on.
      if (lastShown !== undefined) this.show(...lastShown);
      markDirty();
    },

    show(units, decoys = [], traps = [], pads = []) {
      lastShown = [units, decoys, traps, pads];
      // `show()` is the snap-to-truth call: it places every unit on its whole
      // square and drops any in-flight tween state. Cue-driven overrides
      // (`setUnitAt`, `setUnitFade`) are applied *after* it, per frame.
      fadeOf.clear();
      const live = new Set<string>();
      for (const unit of units) {
        let g = unitObjects.get(unit.unitId);
        if (g === undefined) {
          g = buildUnit(unit);
          unitObjects.set(unit.unitId, g);
          applyFacing(unit.unitId); // a fresh body starts at its rest direction
        }
        g.position.copy(toWorld(map, unit.pos));
        g.visible = true;
        // Dead units read as hollow/faded rather than vanishing, so a corpse
        // still tells you where the fight happened.
        baseAlpha.set(unit.unitId, unit.ghost === true ? GHOST_ALPHA : unit.alive ? 1 : DEAD_ALPHA);
        // FOF-COLORS, every paint: the body tint, the foot ring and the plate
        // all read from the viewer, and the viewer can change under a group
        // that already exists.
        const fof = paintFof(g, unit);
        const bars = g.getObjectByName('bars');
        if (bars instanceof Group) {
          // A ghost reports nothing live: its HP, energy and statuses are all
          // things the viewer stopped being able to see when it went dark.
          const known = unit.ghost !== true;
          setPlate(bars, known && unit.alive ? unit.nameplate : undefined, fof);
          setIntent(bars, known && unit.alive ? unit.intent : undefined);
        }
        refreshOpacity(unit.unitId);
        live.add(unit.unitId);
      }
      for (const [id, g] of unitObjects) if (!live.has(id)) g.visible = false;

      // PADS-INDICATOR: a plate per pad, coloured by flavour. Rebuilt wholesale
      // each `show` like the trap layer — a handful of static meshes with no
      // tween state, so reconciling them would be ceremony.
      const padLayer = layerGroup('pad');
      disposeChildren(padLayer);
      for (const pad of pads) {
        const colour = PAD_COLOUR[pad.type];
        const at = toWorld(map, pad.pos);
        const plate = new Mesh(
          new PlaneGeometry(TILE * PAD_SIZE, TILE * PAD_SIZE),
          // A consumed pad keeps its square and loses its glow: still there,
          // nothing to give yet. Drawing it as absent would make a square that
          // is about to matter vanish from the plan.
          new MeshBasicMaterial({ color: colour, transparent: true, opacity: pad.armed ? 0.5 : 0.14 }),
        );
        plate.rotation.x = -Math.PI / 2;
        plate.position.copy(at).setY(PAD_LIFT);
        padLayer.add(plate);

        // PADS-LIGHTS: a consumed pad wears one lit pip per turn until it comes
        // back. A dark pad said nothing about *when*, so contesting one was
        // guesswork; the lights turn the respawn into a clock you can plan
        // against, which is the whole reason a pad is on a timer.
        if (!pad.armed && (pad.lights ?? 0) > 0) {
          const lights = pad.lights ?? 0;
          const pitch = TILE * PAD_SIZE * 0.26;
          for (let i = 0; i < lights; i++) {
            const pip = new Mesh(
              new PlaneGeometry(TILE * 0.11, TILE * 0.11),
              new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.92 }),
            );
            pip.rotation.x = -Math.PI / 2;
            // Centred as a row along the pad's near edge, so four of them read
            // as a countdown rather than as a second glyph.
            pip.position.copy(at)
              .setY(PAD_LIFT + 0.001)
              .add(new Vector3((i - (lights - 1) / 2) * pitch, 0, TILE * PAD_SIZE * 0.34));
            padLayer.add(pip);
          }
        }

        if (!pad.armed) continue;
        // An armed pad wears a plus. The plate alone is one more coloured tile
        // among many; the cross is what says "stand here and get something".
        for (const spin of [0, Math.PI / 2]) {
          const bar = new Mesh(
            new PlaneGeometry(TILE * PAD_SIZE * 0.78, TILE * 0.09),
            new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.95 }),
          );
          bar.rotation.x = -Math.PI / 2;
          bar.rotation.z = spin;
          bar.position.copy(at).setY(PAD_LIFT + 0.001);
          padLayer.add(bar);
        }
      }

      // TRAP-INDICATOR: flat ground markers, in the owning team's colour so
      // "whose trap" is answered without a legend. Visibility was already
      // decided by `fogView` — an enemy trap that reaches here is one this team
      // can see, and one it cannot is simply absent from the list.
      const trapLayer = layerGroup('trap');
      disposeChildren(trapLayer);
      for (const trap of traps) {
        // Friend/foe from the viewer, and the two SIDE colours rather than the
        // three unit ones: a mine is not a character you order, so the
        // self/ally split has nothing to separate here.
        const colour = sideColour(trap.owner, viewer, palette.fof);
        const at = toWorld(map, trap.pos);
        const plate = new Mesh(
          new PlaneGeometry(TILE * TRAP_SIZE, TILE * TRAP_SIZE),
          new MeshBasicMaterial({ color: colour, transparent: true, opacity: trap.own ? 0.28 : 0.42 }),
        );
        plate.rotation.x = -Math.PI / 2;
        plate.position.copy(at).setY(TRAP_LIFT);
        trapLayer.add(plate);
        // A cross on top: the plate alone is another coloured tile among many,
        // and the whole point is that this one square is dangerous.
        for (const spin of [Math.PI / 4, -Math.PI / 4]) {
          const bar = new Mesh(
            new PlaneGeometry(TILE * TRAP_SIZE * 1.1, TILE * 0.08),
            new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9 }),
          );
          bar.rotation.x = -Math.PI / 2;
          bar.rotation.z = spin;
          bar.position.copy(at).setY(TRAP_LIFT + 0.001);
          trapLayer.add(bar);
        }
      }

      const decoyLayer = layerGroup('decoy');
      disposeChildren(decoyLayer);
      billboards = [];
      for (const decoy of decoys) {
        const at = toWorld(map, decoy.pos);
        if (decoy.asEnemy) {
          // To the team being fooled: a normal enemy unit, indistinguishable —
          // same geometry, same colour a real one gets, fully opaque. Drawing it
          // as a translucent ghost is what gave every decoy away for free.
          //
          // The colour is resolved from the VIEWER, exactly like a real unit's
          // (FOF-COLORS). It was hardcoded to `team1` once, then to the decoy's
          // own team number — both of which read correctly from only one of the
          // two seats. `asEnemy` already means "the viewer is the team being
          // fooled", so this lands on foe-red; deriving it rather than asserting
          // it is what keeps the decoy indistinguishable from a real enemy, which
          // is the entire mechanic.
          const fof = fofFor({ unitId: decoy.id, owner: decoy.owner }, viewer);
          const body = new Mesh(
            new BoxGeometry(TILE * 0.55, UNIT_HEIGHT, TILE * 0.55),
            new MeshStandardMaterial({ color: fofColour(fof, palette.fof), ...SURFACE.unit }),
          );
          body.position.copy(at).setY(UNIT_HEIGHT / 2);
          decoyLayer.add(body);
          // …and its lie, in full: name, frozen HP, no statuses. A nameplate is
          // most of what a player reads a unit by, so the impersonation is only
          // as good as this.
          if (decoy.nameplate !== undefined) {
            // The same overlay treatment as a real unit's plate, because the
            // impersonation is only as good as the thing it copies: a decoy
            // whose name clipped where a character's did not would be a tell.
            const plate = asOverlay(new Mesh(
              new PlaneGeometry(PLATE_W, PLATE_H),
              new MeshBasicMaterial({
                map: plateTexture(decoy.nameplate, fof),
                transparent: true,
                depthWrite: false,
              }),
            ), PLATE_ORDER);
            plate.position.copy(at).setY(UNIT_HEIGHT + 0.34);
            billboards.push(plate);
            decoyLayer.add(plate);
          }
          continue;
        }
        // To its owner: a purple **ground plate**, not a body. Veil & Decoy
        // leaves the decoy on the caster's own square, so a purple box sat
        // exactly inside Wisp's own unit and was invisible — the owner could not
        // see the thing they had just placed. A plate wider than a unit shows as
        // a ring around its feet, and still reads on its own once Wisp moves off.
        const plate = new Mesh(
          new PlaneGeometry(TILE * 0.9, TILE * 0.9),
          new MeshBasicMaterial({ color: DECOY_PURPLE, transparent: true, opacity: 0.75 }),
        );
        plate.rotation.x = -Math.PI / 2;
        plate.position.copy(at).setY(DECOY_PLATE_LIFT);
        decoyLayer.add(plate);
      }
    },

    highlight(layer, squares, color, opacity = 0.4) {
      const g = layerGroup(layer);
      disposeChildren(g);
      // OVERLAY-BY-THEME: a wash is only as visible as the distance it moves the
      // floor, and a pale floor sits much closer to these colours than the dark
      // one they were tuned against. Scaling strength here rather than at each
      // call site keeps their *relative* weights — aim louder than range — as
      // authored. Fog is exempt: `fogOpacity` already solved for it, and
      // boosting a derived alpha would be solving the same problem twice.
      const alpha = layer === 'fog' ? opacity : Math.min(0.98, opacity * boost);
      for (const p of squares) {
        const tile = new Mesh(
          new PlaneGeometry(TILE * LAYER_INSET[layer], TILE * LAYER_INSET[layer]),
          new MeshBasicMaterial({ color, transparent: true, opacity: alpha }),
        );
        tile.rotation.x = -Math.PI / 2;
        tile.position.copy(toWorld(map, p)).setY(LAYER_LIFT[layer]);
        g.add(tile);
      }
    },

    squareFromPoint(clientX, clientY) {
      // A ray/plane intersection against the ground plane — the only correct way
      // to pick under an arbitrary camera. The old SVG version did
      // getBoundingClientRect + viewBox arithmetic and broke under any transform.
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return undefined;
      const ndc = new Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);

      // BODY-CLICK: unit bodies are asked **before** the floor.
      //
      // Owner Dev Note: *"BUG: When moving to a location that another character
      // occupies … the character does not move at all."* A unit is a box
      // standing 0.6 above the ground, and the camera is pitched — so the pixels
      // of a body cover the floor *behind* it, and a ray that only ever met the
      // floor answered with that square. Clicking a character therefore selected
      // a tile one or two squares past it: a chase armed nothing (a chase must
      // name a unit, and there was none on the resolved square), and a move
      // aimed at somebody's tile walked somewhere else entirely.
      //
      // Only **drawn** bodies are offered. A unit the seat cannot see has its
      // group hidden by `show()`, so it is not in this list and cannot be picked
      // out of the fog — the ray is as blind as the renderer is.
      //
      // The square comes from the unit's own position rather than from where the
      // ray struck the box: a body is nearly a tile wide and a hit near its top
      // edge is still that unit's square, which is the whole point.
      const bodies: Mesh[] = [];
      for (const g of unitObjects.values()) {
        if (!g.visible) continue;
        const body = g.getObjectByName('body');
        if (body instanceof Mesh) bodies.push(body);
      }
      const onBody = raycaster.intersectObjects(bodies, false)[0];
      if (onBody !== undefined) {
        // `g.position` is already in `world`'s local space — it was set from
        // `toWorld` — so unlike a ray hit it needs no conversion back.
        const g = onBody.object.parent;
        if (g !== null) {
          const sq = toSquare(map, g.position);
          if (onBoard(map, sq)) return sq;
        }
      }

      const hits = raycaster.intersectObject(ground, false);
      const hit = hits[0];
      if (hit === undefined) return undefined;
      const sq = toSquare(map, world.worldToLocal(hit.point.clone()));
      return onBoard(map, sq) ? sq : undefined;
    },

    screenPosition(x, y, lift = 0) {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return undefined;
      const w = squareToWorldXZ(map, { x, y });
      const ndc = new Vector3(w.x, lift, w.z).project(camera);
      // Behind the camera, or off the board's plane entirely: nothing to anchor.
      if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return undefined;
      return {
        x: ((ndc.x + 1) / 2) * rect.width,
        y: ((1 - ndc.y) / 2) * rect.height,
      };
    },

    setProjection(name) {
      projection = name;
      // Picking a projection resets the orbit: the two presets are the reason
      // the camera has a pitch at all, so choosing one means "put it back".
      pitchDeg = PITCH[name];
      yawDeg = 0;
      applyCamera();
    },

    ambient: ambientOn,

    lookAt(next, spanSquares) {
      centre = { x: next.x, y: next.y };
      span = Math.max(spanSquares, SPAN_LIMITS.min);
      wantCentre = { ...centre };
      wantSpan = span;
      applyCamera();
    },

    fitBoard() {
      centre = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
      span = boardSpan();
      wantCentre = { ...centre };
      wantSpan = span;
      applyCamera();
    },

    objectFor: (unitId) => unitObjects.get(unitId),

    setUnitAt(unitId, x, y, lift = 0) {
      const g = unitObjects.get(unitId);
      if (g === undefined) return;
      // Fractional squares go through the same mapping whole ones do, so a tween
      // can never drift away from where a click would land.
      const w = squareToWorldXZ(map, { x, y });
      g.position.set(w.x, lift, w.z);
    },

    setUnitFade(unitId, alpha) {
      fadeOf.set(unitId, Math.max(0, Math.min(1, alpha)));
      refreshOpacity(unitId);
    },

    async preloadCharacters(characterIds) {
      if (characterIds.length === 0) return;
      try {
        if (models === undefined) {
          const mod = await import('./character-model.js');
          models = new mod.CharacterModels();
        }
        await models.load(characterIds);
      } catch (err) {
        // The interface promises this resolves either way. `load()` already
        // swallows a missing model per character; this catches the one thing it
        // cannot — the dynamic import itself failing, on a stale chunk after a
        // deploy or an offline reload. A board of boxes beats a dead frame loop.
        console.warn(`[cards] character models unavailable, drawing boxes: ${String(err)}`);
        return;
      }
      // Anything already on the board as a box, whose model has now arrived, is
      // rebuilt on the next paint. Without this the first paint's decision —
      // taken before the fetch could possibly have finished — would stand for
      // the whole match.
      const loaded = models;
      for (const unitId of staleUnitGroups(
        [...unitCharacter].map(([id, characterId]) => [id, { characterId, hasModel: instances.has(id) }] as const),
        (characterId) => loaded.has(characterId),
      )) dropUnitGroup(unitId);
      // Repaint, or those units are gone until something else happens to.
      if (lastShown !== undefined) api.show(...lastShown);
    },

    setUnitClip(unitId, choice, beatSeconds) {
      instances.get(unitId)?.play(choice, beatSeconds);
    },

    flashUnit(unitId, seconds) {
      flashing.set(unitId, seconds);
      refreshFlash(unitId, seconds);
    },

    shakeCamera(amplitude, seconds, seed) {
      if (amplitude <= 0 || seconds <= 0) return;
      // A bigger hit during a smaller rattle takes over; a smaller one does not
      // cut the bigger one short. Four shooters in one Blast should build, not
      // reset each other.
      if (shake !== undefined && shake.amplitude > amplitude) return;
      shake = { seed, elapsed: 0, duration: seconds, amplitude };
    },

    setUnitFacing(unitId, dx, dy) {
      if (dx === 0 && dy === 0) return;
      facingOf.set(unitId, { dx, dy });
      applyFacing(unitId);
    },

    clipsFor(characterId) {
      return characterId === undefined ? undefined : models?.manifest(characterId)?.map;
    },

    setSpotlight(unitIds) {
      spotlight = unitIds === null ? null : new Set(unitIds);
      refreshAllOpacity();
    },

    panBy(dxPx, dyPx) {
      const before = { x: centre.x, y: centre.y };
      const step = panDelta(dxPx, dyPx, { yawDeg, pitchDeg, span, heightPx: height });
      // A pan reaches any square: the player is asking to look somewhere, and
      // the frame-inside-board rule would stop them at roughly the third rank.
      centre = clampToBoard({ x: centre.x + step.x, y: centre.y + step.y }, span, 0);
      // A pan that the clamp fully absorbed is not a pan: the player pushed
      // against the edge and the view did not move. Claiming the camera on that
      // would stand the auto-framing down for a gesture with no visible effect,
      // and the player would be left wondering why the camera stopped
      // following — having, as far as they can tell, done nothing.
      if (centre.x === before.x && centre.y === before.y) return;
      panOn = true;
      // The ease is measured against these, so leaving them behind would have
      // the auto-camera immediately drag the view back to where the pan started
      // — the frame fighting the hand that just moved it.
      wantCentre = { x: centre.x, y: centre.y };
      wantSpan = span;
      applyCamera();
    },

    panned: () => panOn,

    resetPan() {
      panOn = false;
    },

    setOrbitEnabled(on) {
      orbitOn = on;
      // Leaving a pan latched here would make the orbit toggle a dead control
      // for anyone who had panned: `focusOn` would still be standing down and
      // the auto-camera would never come back.
      panOn = false;
    },

    orbitEnabled: () => orbitOn,

    focusOn(squares, pan = AUTO_PAN, hold = 'frame') {
      // Free orbit or a pan: the player has the camera, so the auto-framing
      // stands down until they hand it back.
      if (orbitOn || panOn) return;
      const reach = hold === 'centre' ? 0 : Infinity;
      if (squares.length === 0) {
        wantCentre = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
        wantSpan = boardSpan();
        return;
      }
      const xs = squares.map((s) => s.x);
      const ys = squares.map((s) => s.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      // The auto-camera *leans* toward the action rather than snapping onto it:
      // it takes half the pan and never zooms past AUTO_ZOOM_FLOOR of the board.
      // A camera that reframes hard every actor is unreadable in a phase where
      // four of them act in a row — you spend the turn re-finding the board.
      const board = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
      wantCentre = {
        x: board.x + ((minX + maxX) / 2 - board.x) * pan,
        y: board.y + ((minY + maxY) / 2 - board.y) * pan,
      };
      // Same foreshortening correction as fitBoard, plus padding so the action
      // never sits against the edge — and never tighter than the board itself.
      const depth = (maxY - minY + 1) * Math.sin(rad(pitchDeg));
      const wide = (maxX - minX + 1) / (width / height);
      const full = boardSpan();
      wantSpan = clamp(Math.max(depth, wide) * 1.6 + 4, full * AUTO_ZOOM_FLOOR, full);
      wantCentre = clampToBoard(wantCentre, wantSpan, reach);
    },

    drawPath(squares, color, dashed, layer = 'path') {
      const g = layerGroup(layer);
      disposeChildren(g);
      strokeRoute(g, squares, color, dashed);
    },

    drawPaths(routes, color, dashed, layer = 'path') {
      const g = layerGroup(layer);
      disposeChildren(g);
      for (const route of routes) strokeRoute(g, route, color, dashed);
    },

    drawParticles(particles) {
      const g = layerGroup('particles');
      disposeChildren(g);
      for (const p of particles) {
        if (!(p.size > 0) || !(p.opacity > 0)) continue;
        const w = squareToWorldXZ(map, { x: p.x, y: p.y });
        const mesh = new Mesh(
          new PlaneGeometry(p.size * TILE * 2, p.size * TILE * 2),
          new MeshBasicMaterial({
            color: p.color, transparent: true, opacity: p.opacity,
            side: DoubleSide, depthWrite: false,
          }),
        );
        mesh.position.set(w.x, p.lift * TILE, w.z);
        // Face the camera. Set once here rather than in `billboard()` because
        // the layer is rebuilt every frame anyway — there is nothing persistent
        // to keep turning.
        mesh.quaternion.copy(camera.quaternion);
        g.add(mesh);
      }
    },

    drawWalls(panels, color, opacity = WALL_FIELD_OPACITY) {
      const g = layerGroup('wall');
      disposeChildren(g);
      for (const panel of panels) {
        const a = squareToWorldXZ(map, panel.from);
        const b = squareToWorldXZ(map, panel.to);
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (!(length > 0)) continue;
        const mesh = new Mesh(
          new PlaneGeometry(length, WALL_PANEL_HEIGHT),
          new MeshBasicMaterial({
            color, transparent: true, opacity, side: DoubleSide,
            // Like every overlay here: it must not occlude what is behind it in
            // the depth buffer, or units on the far side vanish into it.
            depthWrite: false,
          }),
        );
        mesh.position.set((a.x + b.x) / 2, WALL_PANEL_HEIGHT / 2, (a.z + b.z) / 2);
        // A plane is born in XY facing +Z; turn it about Y so its face is
        // perpendicular to the run it stands along.
        mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
        g.add(mesh);

        // PILLARS. The field alone was too easy to miss: it is deliberately
        // see-through, and a see-through thing over a busy board reads as a
        // smudge rather than as a structure. Two SOLID posts give it ends, and
        // ends are what make a barrier legible — the eye reads "this runs from
        // here to here" from the posts and then accepts the haze between them
        // as the wall. It also answers the question the field cannot: where
        // does it stop, and therefore where can I go round it.
        //
        // Opaque and depth-writing, unlike every other overlay in this file.
        // They are small enough to hide nothing that matters, and a translucent
        // pillar would defeat the whole point of adding them.
        for (const end of [a, b]) {
          const pillar = new Mesh(
            new BoxGeometry(WALL_PILLAR_WIDTH, WALL_PILLAR_HEIGHT, WALL_PILLAR_WIDTH),
            new MeshStandardMaterial({ color: WALL_PILLAR_COLOUR, roughness: 0.92, metalness: 0 }),
          );
          pillar.position.set(end.x, WALL_PILLAR_HEIGHT / 2, end.z);
          pillar.castShadow = true;
          pillar.receiveShadow = true;
          g.add(pillar);
        }
      }
    },

    drawAuras(auras) {
      const g = layerGroup('aura');
      disposeChildren(g);
      // At the tracer's height rather than the floor's: an aura is something a
      // unit gives off, and on the ground it reads as a decal on the tile.
      for (const a of auras) drawOneShape(g, a.outline, a.color, a.opacity, TRACER_LIFT, a.hole);
    },

    drawShape(outlines, color, opacity = 0.18, layer = 'shape') {
      const g = layerGroup(layer);
      disposeChildren(g);
      // TRACER-LIFT: a shot crosses the board at chest height, not along the
      // floor. Every other shape layer is a footprint — an AoE, a band, a locked
      // aim — and belongs flat on the ground where the squares it names are. A
      // tracer is the one that describes something in the air, and left at
      // `SHAPE_LIFT` it runs under the feet of both the unit that fired it and
      // the one it hits, which reads as a scorch mark rather than as travel.
      const lift = layer === 'tracer' ? TRACER_LIFT : SHAPE_LIFT;
      for (const outline of outlines) drawOneShape(g, outline, color, opacity, lift);
    },

    onFrame(cb) {
      afterFrame = cb;
    },

    start() {
      if (frameHandle !== undefined) return;
      const loop = (): void => {
        frameHandle = globalThis.requestAnimationFrame(loop);
        // RENDER-ON-DEMAND. Four things can make a frame worth drawing: the
        // scene changed, the camera is still easing toward its target, a rigged
        // model is mid-clip, or ambient motion is running. `applyCamera` marks
        // the second for us — the easing calls it every step and stops once
        // settled — so only the third and fourth need asking about here.
        //
        // Ambient is throttled: it wakes an otherwise-idle board at ~30 fps
        // rather than 60, which the 5-second breath cannot tell apart and which
        // keeps a living map from costing what a static one used to. With
        // `?ambient=off` (every browser test) `ambientOn` is false, so this term
        // vanishes and the idle-frame behaviour the on-demand tests pin is exact.
        const now = performanceNow();
        const ambientDue = ambientOn && rimMaterials.length > 0
          && (lastAmbientMs === undefined || now - lastAmbientMs >= AMBIENT_FRAME_MS);
        if (onDemand && !dirty && instances.size === 0 && !ambientDue) {
          // Drop the clock as well. A skipped stretch is not elapsed animation
          // time, and feeding it back in would make the next mixer step jump.
          lastFrameMs = undefined;
          return;
        }
        if (ambientDue) lastAmbientMs = now;
        dirty = false;
        framesDrawn += 1;
        drawFrame();
      };
      frameHandle = globalThis.requestAnimationFrame(loop);
    },

    frameCount() {
      return framesDrawn;
    },

    stop() {
      if (frameHandle === undefined) return;
      globalThis.cancelAnimationFrame(frameHandle);
      frameHandle = undefined;
    },

    setSafeInsets(next) {
      insets = { ...next };
      applyCamera();
    },

    resize(w, h) {
      width = w;
      height = h;
      renderer.setSize(w, h); // updates the CSS size too, so layout follows
      applyCamera();
    },

    render() {
      drawFrame();
    },

    dispose() {
      if (frameHandle !== undefined) globalThis.cancelAnimationFrame(frameHandle);
      frameHandle = undefined;
      renderer.dispose();
    },
  };

  /**
   * RENDER-ON-DEMAND — every method that changes the picture, marked in one place.
   *
   * Wrapped from a list rather than by putting `markDirty()` at the top of each
   * body, because the failure mode here is a *missed* mark: one mutator that
   * forgets, and the board silently stops updating in whatever narrow case that
   * method covers. A list can be read against the interface in one glance and
   * audited by anyone adding a method; eighteen scattered call sites cannot.
   *
   * The camera is deliberately absent — every camera change routes through
   * `applyCamera`, which marks there, including the auto-camera's easing.
   *
   * Pure queries are absent too, and that is load-bearing rather than tidy:
   * `screenPosition` is called from the `onFrame` callback on every drawn frame
   * (`placePreviewNumbers`), so marking it dirty would make every frame request
   * another one and the loop would never idle — the optimisation would look
   * like it worked and do nothing.
   */
  const MUTATORS = [
    'show', 'highlight', 'drawPath', 'drawPaths', 'drawShape',
    'setProjection', 'lookAt', 'fitBoard', 'focusOn', 'resize', 'setSafeInsets',
    'setUnitAt', 'setUnitFade', 'setUnitClip', 'setUnitFacing', 'drawAuras', 'drawWalls', 'drawParticles',
    'setSpotlight', 'setOrbitEnabled', 'preloadCharacters', 'render',
  ] as const satisfies readonly (keyof Renderer)[];

  for (const name of MUTATORS) {
    const original = api[name];
    if (typeof original !== 'function') continue;
    (api as unknown as Record<string, unknown>)[name] = (...args: unknown[]): unknown => {
      markDirty();
      return (original as (...a: unknown[]) => unknown).apply(api, args);
    };
  }

  return api;
}
