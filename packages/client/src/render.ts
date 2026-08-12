/**
 * Render live game state to SVG. Pure view layer (Dev Note 1 / ARCHITECTURE
 * "Rendering"): it reads only the engine's `GameState`, `MapDef` and types and
 * derives NO game logic — no vision, cover or reachability is recomputed here.
 * `renderState` builds a fresh SVG each call, so re-rendering is idempotent.
 *
 * Written for N units per team (GAME_SPEC §1): everything loops `state.units`
 * and colours by `unit.owner`; nothing assumes one unit per side.
 */

import { ULT_COST, type GameState, type MapDef, type UnitState, type Vec2 } from '@cards/engine';

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

function renderUnit(svg: SVGSVGElement, unit: UnitState): void {
  const teamColor = cssVar(unit.owner === 0 ? '--team0' : '--team1');
  const cxx = cx(unit.pos.x);
  const cyy = cy(unit.pos.y);

  // Body — a team-coloured token; dead units render as a faint ghost.
  svg.appendChild(el('circle', {
    cx: cxx, cy: cyy, r: CELL / 3,
    fill: unit.alive ? teamColor : 'none',
    stroke: teamColor, 'stroke-width': 2, opacity: unit.alive ? 1 : 0.35,
  }));
  svg.appendChild(el('text', {
    x: cxx, y: cyy + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-family': 'system-ui, sans-serif',
    fill: cssVar('--bar-bg'), opacity: unit.alive ? 1 : 0.4,
  })).textContent = (unit.characterId[0] ?? '?').toUpperCase();

  if (!unit.alive) return;

  // Bars: HP (with a shield overlay) above the token, energy below.
  const bw = CELL - 8;
  const bx = PAD + unit.pos.x * CELL + 3;
  const topY = PAD + unit.pos.y * CELL - 6;
  bar(svg, bx, topY, bw, 3, unit.hp / unit.maxHp, cssVar('--hp'));
  const shield = shieldAmount(unit);
  if (shield > 0) bar(svg, bx, topY - 4, bw, 3, shield / unit.maxHp, cssVar('--shield'));
  bar(svg, bx, PAD + unit.pos.y * CELL + CELL - 2, bw, 3, unit.energy / ULT_COST, cssVar('--energy'));
}

/**
 * Build a fresh SVG for `state` on `map`. Idempotent: two calls with the same
 * inputs produce equivalent DOM, so a re-render is just "replace the node".
 */
export function renderState(map: MapDef, state: GameState): SVGSVGElement {
  const width = map.width * CELL + PAD * 2;
  const height = map.height * CELL + PAD * 2;
  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
  renderTerrain(svg, map);
  for (const unit of state.units) renderUnit(svg, unit);
  return svg;
}

/** Mount (or replace) the rendered state inside `container`. */
export function mountState(container: Element, map: MapDef, state: GameState): void {
  container.replaceChildren(renderState(map, state));
}
