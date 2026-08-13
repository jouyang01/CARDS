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
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import type { MapDef, Vec2 } from '@cards/engine';

/** One board square is one world unit; heights are fractions of it. */
const TILE = 1;
const UNIT_HEIGHT = 0.6;
const WALL_HEIGHT = 0.9;
const COVER_HEIGHT = 0.45;

/** The two shipped projections. Isometric is the true 35.264° arctan(1/√2). */
export const PITCH = { top: 90, isometric: 35.264 } as const;
export type ProjectionName = keyof typeof PITCH;

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
  /** Highlight squares (previews, reachability, ability areas). */
  highlight(layer: 'reach' | 'aim' | 'select', squares: readonly Vec2[], color: number, opacity?: number): void;
  /** The board square under a client-space point, via a ray/plane intersection. */
  squareFromPoint(clientX: number, clientY: number): Vec2 | undefined;
  /** Switch projection at runtime — the whole reason for an orthographic camera. */
  setProjection(name: ProjectionName): void;
  /** Frame the camera on a board-space rectangle (A3's camera targets this). */
  lookAt(centre: Vec2, spanSquares: number): void;
  /** Frame the whole board, allowing for the current pitch's foreshortening. */
  fitBoard(): void;
  /** The live scene object for a unit, so an animator can drive it (A1 principle). */
  objectFor(unitId: string): Group | undefined;
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

  const buildUnit = (unit: RenderUnit): Group => {
    const g = new Group();
    g.name = unit.unitId;
    const body = new Mesh(
      new BoxGeometry(TILE * 0.55, UNIT_HEIGHT, TILE * 0.55),
      new MeshLambertMaterial({ color: unit.owner === 0 ? palette.team0 : palette.team1 }),
    );
    body.name = 'body';
    body.position.y = UNIT_HEIGHT / 2;
    g.add(body);
    world.add(g);
    return g;
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
      if (child instanceof Mesh) {
        child.geometry.dispose();
        (child.material as Material).dispose();
      }
    }
  };

  const raycaster = new Raycaster();
  let projection: ProjectionName = 'isometric';
  let span = Math.max(map.width, map.height);
  let centre: Vec2 = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
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
    // gives true isometric. Both are the same camera, so switching is a number.
    const pitch = (PITCH[projection] * Math.PI) / 180;
    const target = toWorld(map, centre);
    const dist = 60;
    camera.position.set(
      target.x,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(pitch) * dist,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }

  applyCamera();
  renderer.setSize(width, height);

  return {
    show(units, decoys = []) {
      const live = new Set<string>();
      for (const unit of units) {
        let g = unitObjects.get(unit.unitId);
        if (g === undefined) {
          g = buildUnit(unit);
          unitObjects.set(unit.unitId, g);
        }
        g.position.copy(toWorld(map, unit.pos));
        g.visible = true;
        const body = g.getObjectByName('body');
        if (body instanceof Mesh) {
          // Dead units read as hollow/faded rather than vanishing, so a corpse
          // still tells you where the fight happened.
          const mat = body.material as MeshLambertMaterial;
          mat.opacity = unit.alive ? 1 : 0.3;
          mat.transparent = !unit.alive;
        }
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
          new PlaneGeometry(TILE * 0.92, TILE * 0.92),
          new MeshLambertMaterial({ color, transparent: true, opacity }),
        );
        tile.rotation.x = -Math.PI / 2;
        tile.position.copy(toWorld(map, p)).setY(0.01 + (layer === 'aim' ? 0.01 : 0));
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

    setProjection(name) {
      projection = name;
      applyCamera();
    },

    lookAt(next, spanSquares) {
      centre = next;
      span = Math.max(spanSquares, 4);
      applyCamera();
    },

    fitBoard() {
      centre = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
      // Depth foreshortens by sin(pitch) — at true isometric the board is only
      // ~58% as tall on screen as it is deep, so framing by raw height would
      // leave the board floating in a letterbox.
      const pitch = (PITCH[projection] * Math.PI) / 180;
      const projectedDepth = map.height * Math.sin(pitch);
      const aspect = width / height;
      span = Math.max(projectedDepth, map.width / aspect) * 1.08;
      applyCamera();
    },

    objectFor: (unitId) => unitObjects.get(unitId),

    resize(w, h) {
      width = w;
      height = h;
      renderer.setSize(w, h); // updates the CSS size too, so layout follows
      applyCamera();
    },

    render() {
      renderer.render(scene, camera);
    },

    dispose() {
      renderer.dispose();
    },
  };
}
