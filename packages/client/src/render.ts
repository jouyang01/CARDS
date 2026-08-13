/**
 * Render live game state to SVG. Pure view layer (Dev Note 1 / ARCHITECTURE
 * "Rendering"): it reads only the engine's `GameState`, `MapDef` and types and
 * derives NO game logic — no vision, cover or reachability is recomputed here.
 * `renderState`/`renderBoard` build a fresh SVG each call, so re-rendering is
 * idempotent.
 *
 * Written for N units per team (GAME_SPEC §1): everything loops units and
 * colours by team; nothing assumes one unit per side. `renderBoard` takes a
 * plain `RenderUnit[]` so both a `GameState` and a playback `ViewState` render
 * through the same path.
 */

import { ULT_COST, type GameState, type MapDef, type TeamId, type UnitState, type Vec2 } from '@cards/engine';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const CELL = 34;
export const PAD = 10;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Read a CSS custom property from :root (the palette lives in index.html). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const cx = (x: number) => PAD + x * CELL + (CELL - 2) / 2;
const cy = (y: number) => PAD + y * CELL + (CELL - 2) / 2;

/** Total remaining shield absorb across a unit's shield statuses. */
export function shieldAmount(unit: UnitState): number {
  return unit.statuses.filter((s) => s.kind === 'shield' && s.remaining > 0).reduce((sum, s) => sum + (s.amount ?? 0), 0);
}

/** The minimum a unit needs to draw (team, position, bars) — from state or a view. */
export interface RenderUnit {
  /** Identity for keyed reconciliation (A1) — one persistent `<g>` per unit. */
  unitId: string;
  owner: TeamId;
  pos: Vec2;
  hp: number;
  maxHp: number;
  energy: number;
  alive: boolean;
  label: string;
  shield?: number;
}

function toRenderUnit(u: UnitState): RenderUnit {
  return { unitId: u.unitId, owner: u.owner, pos: u.pos, hp: u.hp, maxHp: u.maxHp, energy: u.energy, alive: u.alive, label: (u.characterId[0] ?? '?').toUpperCase(), shield: shieldAmount(u) };
}

function paint(svg: SVGSVGElement, squares: readonly Vec2[], color: string, inset = 0): void {
  for (const p of squares) {
    svg.appendChild(el('rect', {
      x: PAD + p.x * CELL + inset, y: PAD + p.y * CELL + inset,
      width: CELL - 2 - inset * 2, height: CELL - 2 - inset * 2, rx: 4, fill: color,
    }));
  }
}

function renderTerrain(svg: SVGSVGElement, map: MapDef): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      svg.appendChild(el('rect', { x: PAD + x * CELL, y: PAD + y * CELL, width: CELL - 2, height: CELL - 2, rx: 4, fill: cssVar('--open') }));
    }
  }
  paint(svg, map.brush, cssVar('--brush'));
  paint(svg, map.cover, cssVar('--cover'), 4);
  paint(svg, map.walls, cssVar('--wall'));
}

/** A small labelled bar; `frac` is clamped to [0,1]. */
function bar(svg: SVGSVGElement, x: number, y: number, w: number, h: number, frac: number, color: string): void {
  svg.appendChild(el('rect', { x, y, width: w, height: h, rx: 1, fill: cssVar('--bar-bg') }));
  const filled = Math.max(0, Math.min(1, frac)) * w;
  if (filled > 0) svg.appendChild(el('rect', { x, y, width: filled, height: h, rx: 1, fill: color }));
}

// ── Keyed unit nodes (A1) ───────────────────────────────────────────────────
//
// Each unit is ONE `<g data-unit-id>` positioned by `transform`, holding a fixed
// child structure. Renders reconcile that node (update attributes) instead of
// rebuilding it, so a node — and any animation running on it — survives a frame.
// That persistence is the substrate A3's tweening needs; `replaceChildren` on a
// freshly built SVG can never tween because no node outlives the frame.
//
// Children are drawn in LOCAL coordinates, origin = the cell's top-left corner,
// so moving a unit is a transform change and nothing else.

/** The `transform` that places a unit's group on its square. */
export const unitTransform = (pos: Vec2): string => `translate(${PAD + pos.x * CELL}, ${PAD + pos.y * CELL})`;

const BAR_W = CELL - 8;
const BAR_X = 3;
const HP_Y = -6;
const SHIELD_Y = -10;
const ENERGY_Y = CELL - 2;

/** Build the fixed child structure once; `updateUnitNode` then only sets attributes. */
function buildUnitNode(unitId: string): SVGGElement {
  const g = el('g', { 'data-unit-id': unitId });
  g.appendChild(el('circle', { class: 'body', cx: (CELL - 2) / 2, cy: (CELL - 2) / 2, r: CELL / 3, 'stroke-width': 2 }));
  g.appendChild(el('text', {
    class: 'label', x: (CELL - 2) / 2, y: (CELL - 2) / 2 + 4, 'text-anchor': 'middle',
    'font-size': 11, 'font-family': 'system-ui, sans-serif',
  }));
  // Bars: each is a background + a fill rect, always present so the structure is
  // stable; an absent shield is expressed as zero width, never a removed node.
  for (const [cls, y] of [['hp', HP_Y], ['shield', SHIELD_Y], ['energy', ENERGY_Y]] as const) {
    const group = el('g', { class: `bar-${cls}` });
    group.appendChild(el('rect', { class: 'bg', x: BAR_X, y, width: BAR_W, height: 3, rx: 1 }));
    group.appendChild(el('rect', { class: 'fill', x: BAR_X, y, width: 0, height: 3, rx: 1 }));
    g.appendChild(group);
  }
  return g;
}

/** Point an existing unit node at `unit`'s current values. No nodes are replaced. */
function updateUnitNode(g: SVGGElement, unit: RenderUnit): void {
  const teamColor = cssVar(unit.owner === 0 ? '--team0' : '--team1');
  g.setAttribute('transform', unitTransform(unit.pos));

  const body = g.querySelector('.body')!;
  body.setAttribute('fill', unit.alive ? teamColor : 'none');
  body.setAttribute('stroke', teamColor);
  body.setAttribute('opacity', String(unit.alive ? 1 : 0.35));

  const label = g.querySelector('.label')!;
  label.setAttribute('fill', cssVar('--bar-bg'));
  label.setAttribute('opacity', String(unit.alive ? 1 : 0.4));
  label.textContent = unit.label;

  // Dead units show no bars (matching the pre-A1 early return).
  const frac = (n: number) => Math.max(0, Math.min(1, n));
  const setBar = (cls: string, value: number, color: string, visible: boolean): void => {
    const group = g.querySelector(`.bar-${cls}`)!;
    group.setAttribute('opacity', visible ? '1' : '0');
    group.querySelector('.bg')!.setAttribute('fill', cssVar('--bar-bg'));
    const fill = group.querySelector('.fill')!;
    fill.setAttribute('width', String(frac(value) * BAR_W));
    fill.setAttribute('fill', color);
  };
  setBar('hp', unit.hp / unit.maxHp, cssVar('--hp'), unit.alive);
  setBar('shield', (unit.shield ?? 0) / unit.maxHp, cssVar('--shield'), unit.alive && (unit.shield ?? 0) > 0);
  setBar('energy', unit.energy / ULT_COST, cssVar('--energy'), unit.alive);
}

/**
 * Reconcile `units` into `layer`: reuse the `<g data-unit-id>` for a unit that is
 * already there, create one for a newcomer, drop nodes for units that are gone.
 * Returns the node per unitId so a caller (A3) can animate them.
 */
export function reconcileUnits(layer: SVGElement, units: readonly RenderUnit[]): Map<string, SVGGElement> {
  const existing = new Map<string, SVGGElement>();
  for (const node of layer.querySelectorAll('g[data-unit-id]')) {
    existing.set(node.getAttribute('data-unit-id')!, node as SVGGElement);
  }
  const live = new Map<string, SVGGElement>();
  for (const unit of units) {
    let g = existing.get(unit.unitId);
    if (g === undefined) {
      g = buildUnitNode(unit.unitId);
      layer.appendChild(g);
    }
    updateUnitNode(g, unit);
    live.set(unit.unitId, g);
  }
  for (const [unitId, node] of existing) if (!live.has(unitId)) node.remove();
  return live;
}

/**
 * Build a fresh SVG for `map` with the given units drawn on top of terrain.
 * Build-fresh semantics are kept for the Decision screen, but the units go
 * through the same keyed path as playback, so both look identical (A1).
 */
export function renderBoard(map: MapDef, units: readonly RenderUnit[]): SVGSVGElement {
  const width = map.width * CELL + PAD * 2;
  const height = map.height * CELL + PAD * 2;
  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
  renderTerrain(svg, map);
  reconcileUnits(svg, units);
  return svg;
}

/**
 * Build a fresh SVG for a `GameState`. Idempotent: two calls with the same
 * inputs produce equivalent DOM, so a re-render is just "replace the node".
 */
export function renderState(map: MapDef, state: GameState): SVGSVGElement {
  return renderBoard(map, state.units.map(toRenderUnit));
}

/** Mount (or replace) the rendered state inside `container`. */
export function mountState(container: Element, map: MapDef, state: GameState): void {
  container.replaceChildren(renderState(map, state));
}

/** Translucent overlay squares (previews, reachable tiles) appended onto an SVG. */
export function paintOverlay(svg: SVGSVGElement, squares: readonly Vec2[], color: string, opacity = 0.4): void {
  for (const p of squares) {
    svg.appendChild(el('rect', {
      x: PAD + p.x * CELL, y: PAD + p.y * CELL, width: CELL - 2, height: CELL - 2, rx: 4,
      fill: color, opacity, 'pointer-events': 'none',
    }));
  }
}

/** The grid square under a client-space point on `svg` (for click-to-aim). */
export function squareFromPoint(svg: SVGSVGElement, clientX: number, clientY: number): Vec2 | undefined {
  const rect = svg.getBoundingClientRect();
  const scaleX = svg.viewBox.baseVal.width / rect.width || 1;
  const scaleY = svg.viewBox.baseVal.height / rect.height || 1;
  const x = Math.floor(((clientX - rect.left) * scaleX - PAD) / CELL);
  const y = Math.floor(((clientY - rect.top) * scaleY - PAD) / CELL);
  return { x, y };
}
