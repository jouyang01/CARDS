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
  BufferGeometry,
  Color,
  DoubleSide,
  DirectionalLight,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import type { CharacterModels, ModelInstance } from './character-model.js';
import type { ClipChoice, ClipSet } from './character-clips.js';
import { ULT_COST, type MapDef, type PowerupType, type Vec2 } from '@cards/engine';
import { DEAD_ALPHA } from './animate.js';
import { type Nameplate } from './nameplates.js';
import { intentTexture, plateTexture } from './textures.js';

/** One board square is one world unit; heights are fractions of it. */
const TILE = 1;
const UNIT_HEIGHT = 0.6;
/**
 * How tall a rigged character stands, in tiles.
 *
 * Characters are authored at human metres because Mixamo expects it, which puts
 * Aegis at 1.73 tiles — nearly two — where eight of them occlude each other and
 * the ground at low pitch. Scaling here rather than in the asset keeps the source
 * at the size the animations were made for.
 *
 * This is the board-scale decision (ART_PIPELINE.md §11) in its cheapest form: a
 * character 1.15 tiles tall implies roughly 1.5 m per tile. Change this number
 * once characters can actually be seen on the board.
 */
const MODEL_HEIGHT_TILES = 1.15;
const WALL_HEIGHT = 0.9;
const COVER_HEIGHT = 0.45;

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
/** How much of the remaining camera distance the auto-camera closes per frame. */
const CAMERA_EASE = 0.14;
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
export type PathLayer = 'path' | 'catalystPath';

/**
 * AIM-PREVIEW-TRUE's boundary layers. Three families, three colours: the
 * ability's own shape, the sub-band inside it that pays a different number, and
 * a dash's impact disc — each a locus of its own engine predicate, so each is
 * drawn rather than left for the eye to infer from a tile wash.
 */
export type ShapeLayer = 'shape' | 'shapeBand' | 'shapeImpact' | 'shapeLocked';

/**
 * Terrain heights. Brush is the only *walkable* terrain with a body, which makes
 * its top surface the floor every tile overlay has to clear (FOG-ZORDER).
 */
export const TERRAIN_HEIGHT = { brush: 0.02, cover: COVER_HEIGHT, wall: WALL_HEIGHT } as const;

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
  /** This character's clip names, or undefined if it has no model loaded. */
  clipsFor(characterId: string | undefined): ClipSet | undefined;
  /**
   * Spotlight: dim everything except these units. Used on Prep/Dash/Blast only —
   * Move is simultaneous and dimming it would hide the whole point (owner).
   */
  setSpotlight(unitIds: readonly string[] | null): void;
  /** Free-orbit on/off. When off, the auto-camera drives framing. */
  setOrbitEnabled(on: boolean): void;
  orbitEnabled(): boolean;
  /** Keep a run of squares in frame (auto-camera). Empty = whole board. */
  focusOn(squares: readonly Vec2[]): void;
  /** A stroked path through tile centres plus an endpoint marker (AIM1). */
  drawPath(squares: readonly Vec2[], color: number, dashed: boolean, layer?: PathLayer): void;
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

export function createRenderer(container: HTMLElement, map: MapDef, palette: {
  open: number; wall: number; cover: number; brush: number; team0: number; team1: number; background: number;
}): Renderer {
  const scene = new Scene();
  scene.background = new Color(palette.background);

  // An orthographic camera has no perspective divide, so a tile is the same size
  // wherever it sits — which is exactly what a tactics board wants.
  const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.borderRadius = '8px';
  container.replaceChildren(renderer.domElement);

  scene.add(new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.1);
  sun.position.set(4, 10, 6);
  scene.add(sun);

  // ── Static terrain ────────────────────────────────────────────────────────
  const world = new Group();
  scene.add(world);

  const ground = new Mesh(
    new PlaneGeometry(map.width * TILE, map.height * TILE),
    new MeshLambertMaterial({ color: palette.open }),
  );
  ground.rotation.x = -Math.PI / 2;
  world.add(ground);

  // Faint tile seams so squares are countable — the grid IS the ruleset here.
  for (const [squares, colour, height] of [
    [map.brush, palette.brush, TERRAIN_HEIGHT.brush],
    [map.cover, palette.cover, TERRAIN_HEIGHT.cover],
    [map.walls, palette.wall, TERRAIN_HEIGHT.wall],
  ] as const) {
    for (const p of squares) {
      const box = new Mesh(
        new BoxGeometry(TILE * 0.96, height, TILE * 0.96),
        new MeshLambertMaterial({ color: colour }),
      );
      box.position.copy(toWorld(map, p)).setY(height / 2);
      world.add(box);
    }
  }

  // ── Keyed unit objects (A1's principle, in 3D) ────────────────────────────
  const unitObjects = new Map<string, Group>();
  /** Loose meshes that must face the camera — decoy nameplates, so far. */
  let billboards: Mesh[] = [];

  /**
   * The overhead furniture: one nameplate quad and the status row under it.
   *
   * UI-NAMEPLATES replaced three coloured strips with a single **drawn plate**,
   * because half of what the screenshot shows cannot be done with quads at all
   * — the HP numeral lives *inside* its bar and the ULT tag is a word. One
   * texture also means one draw and one cache entry per distinct plate, instead
   * of three meshes whose widths are re-set every frame.
   *
   * Both live in their own group so they billboard and resist zoom: a nameplate
   * is only useful if it is the same legible size at any framing.
   */
  const buildBars = (): Group => {
    const bars = new Group();
    bars.name = 'bars';
    bars.position.y = UNIT_HEIGHT + 0.34;
    const plate = new Mesh(
      new PlaneGeometry(PLATE_W, PLATE_H),
      new MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    plate.name = 'plate';
    bars.add(plate);
    // UI-INTENT's tile sits above the nameplate — the plan is the newest thing
    // on screen and the one a teammate is scanning for, so it leads.
    const intent = new Mesh(
      new PlaneGeometry(0.62, 0.2),
      new MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    intent.name = 'intent';
    intent.position.y = PLATE_H / 2 + 0.14;
    intent.visible = false;
    bars.add(intent);
    return bars;
  };

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
  const setPlate = (bars: Group, plate: Nameplate | undefined, team: 0 | 1): void => {
    const mesh = bars.getObjectByName('plate');
    if (!(mesh instanceof Mesh)) return;
    mesh.visible = plate !== undefined;
    if (plate === undefined) return;
    (mesh.material as MeshBasicMaterial).map = plateTexture(plate, team);
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

  const buildUnit = (unit: RenderUnit): Group => {
    const g = new Group();
    g.name = unit.unitId;
    unitCharacter.set(unit.unitId, unit.characterId);

    const instance = unit.characterId === undefined ? undefined : models?.instance(unit.characterId);
    if (instance !== undefined) {
      // Scale from the model's own bounds rather than a hard-coded factor, so a
      // taller or shorter character still stands MODEL_HEIGHT_TILES high.
      const box = new Box3().setFromObject(instance.root);
      const height = box.max.y - box.min.y;
      const scale = height > 0 ? (TILE * MODEL_HEIGHT_TILES) / height : 1;
      instance.root.scale.setScalar(scale);
      instance.root.position.y = -box.min.y * scale;
      instance.root.name = 'body';
      instances.set(unit.unitId, instance);
      g.add(instance.root, buildBars());
      world.add(g);
      return g;
    }

    const body = new Mesh(
      new BoxGeometry(TILE * 0.55, UNIT_HEIGHT, TILE * 0.55),
      // Always `transparent`, even at full opacity: flipping the flag later
      // needs a shader recompile (`needsUpdate`), and forgetting it makes every
      // fade and dim silently do nothing. Paying for blending up front is the
      // cheap, un-forgettable version.
      new MeshLambertMaterial({ color: unit.owner === 0 ? palette.team0 : palette.team1, transparent: true }),
    );
    body.name = 'body';
    body.position.y = UNIT_HEIGHT / 2;
    g.add(body, buildBars());
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
  const drawOneShape = (g: Group, outline: readonly Vec2[], color: number, opacity: number): void => {
    if (outline.length < 3) return;
    const shape = new Shape();
    outline.forEach((p, i) => {
      const w = squareToWorldXZ(map, p);
      if (i === 0) shape.moveTo(w.x, w.z);
      else shape.lineTo(w.x, w.z);
    });
    shape.closePath();
    const mesh = new Mesh(
      new ShapeGeometry(shape),
      new MeshBasicMaterial({ color, transparent: true, opacity, side: DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = Math.PI / 2; // XY plane -> ground plane
    mesh.position.y = SHAPE_LIFT;
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

  const refreshOpacity = (unitId: string): void => {
    const g = unitObjects.get(unitId);
    if (g === undefined) return;
    const dimmed = spotlight !== null && !spotlight.has(unitId);
    const alpha = (baseAlpha.get(unitId) ?? 1) * (fadeOf.get(unitId) ?? 1) * (dimmed ? DIM_ALPHA : 1);
    const body = g.getObjectByName('body');
    // A box has one mesh; a rigged model is a tree of them. Traverse either way.
    body?.traverse((o) => {
      if (o instanceof Mesh) {
        const mat = o.material as MeshLambertMaterial;
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
  let span = Math.max(map.width, map.height);
  let centre = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
  // Where the auto-camera is heading. The live camera eases toward it so the
  // frame glides between actors instead of cutting.
  let wantCentre = { ...centre };
  let wantSpan = span;
  let orbitOn = false;
  let width = 900;
  let height = 560;

  function applyCamera(): void {
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
  }

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
    const projectedDepth = map.height * Math.sin(rad(pitchDeg));
    // `span` is the world height of the FULL canvas, so fitting the board into a
    // fraction of that canvas means scaling the requirement up by the reciprocal
    // of that fraction. With no insets both terms collapse to the old
    // `max(projectedDepth, map.width / aspect)` exactly.
    return Math.max(
      projectedDepth * (height / visibleH()),
      map.width * (height / visibleW()),
    ) * 1.08;
  };

  /**
   * Pull a camera centre back so the frame stays inside the board. Without this
   * the auto-camera happily pans off the edge and shows a band of void next to
   * half a board — which is worse than not following the action at all.
   */
  const clampToBoard = (c: { x: number; y: number }, spanValue: number): { x: number; y: number } => {
    const halfW = (spanValue / 2) * (width / height);
    // Depth is foreshortened on screen, so the visible run of *squares* along y
    // is larger than the visible height by 1/sin(pitch).
    const halfD = spanValue / 2 / Math.max(Math.sin(rad(pitchDeg)), 0.2);
    const axis = (v: number, extent: number, half: number): number =>
      extent <= half * 2 ? (extent - 1) / 2 : clamp(v, half - 0.5, extent - 0.5 - half);
    return { x: axis(c.x, map.width, halfW), y: axis(c.y, map.height, halfD) };
  };

  /** Ease the live camera one frame toward the auto-camera's target. */
  const stepCamera = (): void => {
    if (orbitOn) return; // the player owns the camera; don't fight them
    const dx = wantCentre.x - centre.x;
    const dy = wantCentre.y - centre.y;
    const ds = wantSpan - span;
    if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002 && Math.abs(ds) < 0.002) return;
    centre = { x: centre.x + dx * CAMERA_EASE, y: centre.y + dy * CAMERA_EASE };
    span += ds * CAMERA_EASE;
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
  let dragging = false;
  let dragged = 0;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    const secondary = e.button === 1 || e.button === 2;
    if (!secondary && !(orbitOn && e.button === 0)) return;
    dragging = true;
    dragged = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragged += Math.abs(dx) + Math.abs(dy);
    yawDeg = (yawDeg + dx * ORBIT_SENSITIVITY) % 360;
    pitchDeg = clamp(pitchDeg - dy * ORBIT_SENSITIVITY, PITCH_LIMITS.min, PITCH_LIMITS.max);
    applyCamera();
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
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

    stepCamera();
    billboard();
    renderer.render(scene, camera);
    // After the camera has moved, so anything DOM-anchored to a world position
    // is repositioned against the frame that was actually just drawn.
    afterFrame?.();
  };

  applyCamera();
  renderer.setSize(width, height);

  return {
    show(units, decoys = [], traps = [], pads = []) {
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
        }
        g.position.copy(toWorld(map, unit.pos));
        g.visible = true;
        // Dead units read as hollow/faded rather than vanishing, so a corpse
        // still tells you where the fight happened.
        baseAlpha.set(unit.unitId, unit.ghost === true ? GHOST_ALPHA : unit.alive ? 1 : DEAD_ALPHA);
        const bars = g.getObjectByName('bars');
        if (bars instanceof Group) {
          // A ghost reports nothing live: its HP, energy and statuses are all
          // things the viewer stopped being able to see when it went dark.
          const known = unit.ghost !== true;
          setPlate(bars, known && unit.alive ? unit.nameplate : undefined, unit.owner);
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
        const colour = trap.owner === 0 ? palette.team0 : palette.team1;
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
          // The colour is the DECOY'S OWN team, not a constant. It used to be
          // hardcoded to `team1`, which is only right when the viewer is team 0:
          // to team 1, a team-0 decoy came out in team 1's own red and read as a
          // friendly unit — the opposite of impersonating an enemy.
          const body = new Mesh(
            new BoxGeometry(TILE * 0.55, UNIT_HEIGHT, TILE * 0.55),
            new MeshLambertMaterial({ color: decoy.owner === 0 ? palette.team0 : palette.team1 }),
          );
          body.position.copy(at).setY(UNIT_HEIGHT / 2);
          decoyLayer.add(body);
          // …and its lie, in full: name, frozen HP, no statuses. A nameplate is
          // most of what a player reads a unit by, so the impersonation is only
          // as good as this.
          if (decoy.nameplate !== undefined) {
            const plate = new Mesh(
              new PlaneGeometry(PLATE_W, PLATE_H),
              new MeshBasicMaterial({
                map: plateTexture(decoy.nameplate, decoy.owner),
                transparent: true,
                depthWrite: false,
              }),
            );
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
      for (const p of squares) {
        const tile = new Mesh(
          new PlaneGeometry(TILE * LAYER_INSET[layer], TILE * LAYER_INSET[layer]),
          new MeshLambertMaterial({ color, transparent: true, opacity }),
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
    },

    setUnitClip(unitId, choice, beatSeconds) {
      instances.get(unitId)?.play(choice, beatSeconds);
    },

    clipsFor(characterId) {
      return characterId === undefined ? undefined : models?.manifest(characterId)?.map;
    },

    setSpotlight(unitIds) {
      spotlight = unitIds === null ? null : new Set(unitIds);
      refreshAllOpacity();
    },

    setOrbitEnabled(on) {
      orbitOn = on;
    },

    orbitEnabled: () => orbitOn,

    focusOn(squares) {
      if (orbitOn) return; // free-orbit mode: the auto-camera stands down
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
        x: board.x + ((minX + maxX) / 2 - board.x) * AUTO_PAN,
        y: board.y + ((minY + maxY) / 2 - board.y) * AUTO_PAN,
      };
      // Same foreshortening correction as fitBoard, plus padding so the action
      // never sits against the edge — and never tighter than the board itself.
      const depth = (maxY - minY + 1) * Math.sin(rad(pitchDeg));
      const wide = (maxX - minX + 1) / (width / height);
      const full = boardSpan();
      wantSpan = clamp(Math.max(depth, wide) * 1.6 + 4, full * AUTO_ZOOM_FLOOR, full);
      wantCentre = clampToBoard(wantCentre, wantSpan);
    },

    drawPath(squares, color, dashed, layer = 'path') {
      const g = layerGroup(layer);
      disposeChildren(g);
      if (squares.length === 0) return;
      // A drawn move is a LINE through tile centres, not a field of tiles: it
      // says which way you go and in what order, which reachability shading
      // cannot (AIM1). Sprint is the dashed one.
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
    },

    drawShape(outlines, color, opacity = 0.18, layer = 'shape') {
      const g = layerGroup(layer);
      disposeChildren(g);
      for (const outline of outlines) drawOneShape(g, outline, color, opacity);
    },

    onFrame(cb) {
      afterFrame = cb;
    },

    start() {
      if (frameHandle !== undefined) return;
      const loop = (): void => {
        frameHandle = globalThis.requestAnimationFrame(loop);
        drawFrame();
      };
      frameHandle = globalThis.requestAnimationFrame(loop);
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
}
