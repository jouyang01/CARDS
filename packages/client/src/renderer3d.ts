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
import type { MapDef, Vec2 } from '@cards/engine';
import { DEAD_ALPHA } from './animate.js';

/** One board square is one world unit; heights are fractions of it. */
const TILE = 1;
const UNIT_HEIGHT = 0.6;
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

/**
 * Tile-overlay layers, listed bottom-up — the order is the draw order, so a
 * covered tile always reads on top of the envelope that contains it.
 */
export type HighlightLayer = 'fog' | 'range' | 'reach' | 'aim' | 'catalyst' | 'select';

/** Height above the ground plane per layer, so they never z-fight. */
const LAYER_LIFT: Record<HighlightLayer, number> = {
  fog: 0.002, range: 0.006, reach: 0.010, aim: 0.016, catalyst: 0.019, select: 0.022,
};
/**
 * Overlay tiles are inset so the grid reads through them — except fog, which
 * has to meet its neighbours edge to edge or the darkness comes out as a mesh
 * of lit seams (VISION1).
 */
const LAYER_INSET: Record<HighlightLayer, number> = {
  fog: 1, range: 0.92, reach: 0.92, aim: 0.92, catalyst: 0.72, select: 0.92,
};
/** UI2's continuous shape sits just above the covered tiles it explains. */
const SHAPE_LIFT = 0.026;

/** What the renderer needs to draw one unit — the same shape the SVG used. */
export interface RenderUnit {
  unitId: string;
  owner: 0 | 1;
  pos: Vec2;
  hp: number;
  maxHp: number;
  energy: number;
  alive: boolean;
  label: string;
  shield?: number;
}

export interface Renderer {
  /** Draw/refresh the board for these units and decoys. Objects are reconciled. */
  show(units: readonly RenderUnit[], decoys?: readonly Vec2[]): void;
  /**
   * Highlight squares. Layers stack bottom-up in the order listed here:
   * `fog` is the unseen board (VISION1) and sits underneath everything, so your
   * own aim still reads over darkness — you may shoot where you cannot see.
   * `range` is the hover envelope (UI1 — where an ability *could* go), `reach`
   * the move envelope, `aim` the tiles an aim actually covers, `select` the
   * current unit and impact flashes.
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
  drawPath(squares: readonly Vec2[], color: number, dashed: boolean): void;
  /**
   * UI2 Layer 1: fill a closed polygon given in **fractional board coordinates**
   * on the ground plane — the continuous cone/beam/disk the covered tiles
   * approximate. Empty clears it.
   */
  drawShape(outline: readonly Vec2[], color: number, opacity?: number): void;
  /** Start/stop the animation loop (orbit and tweens need continuous frames). */
  start(): void;
  stop(): void;
  resize(width: number, height: number): void;
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
    [map.brush, palette.brush, 0.02],
    [map.cover, palette.cover, COVER_HEIGHT],
    [map.walls, palette.wall, WALL_HEIGHT],
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

  /** Bars live in their own group so they can billboard and resist zoom. */
  const buildBars = (): Group => {
    const bars = new Group();
    bars.name = 'bars';
    bars.position.y = UNIT_HEIGHT + 0.28;
    const bar = (name: string, y: number, color: number): void => {
      const bg = new Mesh(new PlaneGeometry(0.8, 0.1), new MeshBasicMaterial({ color: 0x12141a }));
      bg.position.set(0, y, 0);
      const fill = new Mesh(new PlaneGeometry(0.8, 0.1), new MeshBasicMaterial({ color }));
      fill.name = name;
      fill.position.set(0, y, 0.001);
      bars.add(bg, fill);
    };
    bar('hp', 0.12, 0x5ad17f);
    bar('shield', 0.24, 0x62d0e0);
    bar('energy', 0, 0xe0c04f);
    return bars;
  };

  const buildUnit = (unit: RenderUnit): Group => {
    const g = new Group();
    g.name = unit.unitId;
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
  const setBar = (bars: Group, name: string, frac: number, visible: boolean): void => {
    const fill = bars.getObjectByName(name);
    if (!(fill instanceof Mesh)) return;
    const f = Math.max(0, Math.min(1, frac));
    fill.scale.x = Math.max(f, 0.0001);
    fill.position.x = -0.4 + (0.8 * f) / 2; // keep the left edge pinned
    fill.visible = visible && f > 0;
  };

  // ── Highlight layers ──────────────────────────────────────────────────────
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
    if (body instanceof Mesh) (body.material as MeshLambertMaterial).opacity = alpha;
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
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;

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

  /** The span that frames the whole board at the current pitch. */
  const boardSpan = (): number => {
    // Depth foreshortens by sin(pitch) — at true isometric the board is only
    // ~58% as tall on screen as it is deep, so framing by raw height would
    // leave the board floating in a letterbox.
    const projectedDepth = map.height * Math.sin(rad(pitchDeg));
    return Math.max(projectedDepth, map.width / (width / height)) * 1.08;
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

  let frameHandle: number | undefined;
  const drawFrame = (): void => {
    stepCamera();
    billboard();
    renderer.render(scene, camera);
  };

  applyCamera();
  renderer.setSize(width, height);

  return {
    show(units, decoys = []) {
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
        baseAlpha.set(unit.unitId, unit.alive ? 1 : DEAD_ALPHA);
        const bars = g.getObjectByName('bars');
        if (bars instanceof Group) {
          setBar(bars, 'hp', unit.hp / Math.max(1, unit.maxHp), true);
          setBar(bars, 'energy', unit.energy / 100, true);
          setBar(bars, 'shield', (unit.shield ?? 0) / Math.max(1, unit.maxHp), (unit.shield ?? 0) > 0);
        }
        refreshOpacity(unit.unitId);
        live.add(unit.unitId);
      }
      for (const [id, g] of unitObjects) if (!live.has(id)) g.visible = false;

      const decoyLayer = layerGroup('decoy');
      disposeChildren(decoyLayer);
      for (const p of decoys) {
        const ghost = new Mesh(
          new BoxGeometry(TILE * 0.55, UNIT_HEIGHT, TILE * 0.55),
          new MeshLambertMaterial({ color: palette.team1, transparent: true, opacity: 0.35 }),
        );
        ghost.position.copy(toWorld(map, p)).setY(UNIT_HEIGHT / 2);
        decoyLayer.add(ghost);
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

    drawPath(squares, color, dashed) {
      const g = layerGroup('path');
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

    drawShape(outline, color, opacity = 0.18) {
      const g = layerGroup('shape');
      disposeChildren(g);
      if (outline.length < 3) return;
      // Built in the XY plane from board coordinates, then laid flat — the same
      // squareToWorldXZ mapping picking uses, so the fiction and the truth are
      // registered to the same grid and a clipped corner reads as geometry
      // rather than as a bug.
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
