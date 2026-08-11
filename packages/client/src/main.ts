/**
 * M0 client: renders the Duel Arena map from data as an SVG grid, with spawn
 * markers. This is the rendering foundation the M2 targeting UI builds on.
 * No game logic here — the engine's TurnEvent log will drive everything later.
 */
import { validateMap, type MapDef, type Vec2 } from '@cards/engine';
import duelArena from '../../../data/maps/duel-arena.json';

const map = duelArena as unknown as MapDef;

const errors = validateMap(map);
if (errors.length > 0) {
  document.getElementById('app')!.innerHTML =
    `<pre style="color:#ff6b5e">Map validation failed:\n${errors.join('\n')}</pre>`;
  throw new Error('invalid map');
}

const CELL = 34;
const PAD = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const width = map.width * CELL + PAD * 2;
const height = map.height * CELL + PAD * 2;
const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}` });

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Base grid
for (let y = 0; y < map.height; y++) {
  for (let x = 0; x < map.width; x++) {
    svg.appendChild(
      el('rect', {
        x: PAD + x * CELL,
        y: PAD + y * CELL,
        width: CELL - 2,
        height: CELL - 2,
        rx: 4,
        fill: cssVar('--open'),
      }),
    );
  }
}

const paint = (squares: Vec2[], color: string, inset = 0) => {
  for (const p of squares) {
    svg.appendChild(
      el('rect', {
        x: PAD + p.x * CELL + inset,
        y: PAD + p.y * CELL + inset,
        width: CELL - 2 - inset * 2,
        height: CELL - 2 - inset * 2,
        rx: 4,
        fill: color,
      }),
    );
  }
};

paint(map.brush, cssVar('--brush'));
paint(map.cover, cssVar('--cover'), 4);
paint(map.walls, cssVar('--wall'));

// Spawn markers
map.spawns.forEach((squares, player) => {
  const color = cssVar(player === 0 ? '--spawn0' : '--spawn1');
  for (const p of squares) {
    svg.appendChild(
      el('circle', {
        cx: PAD + p.x * CELL + (CELL - 2) / 2,
        cy: PAD + p.y * CELL + (CELL - 2) / 2,
        r: CELL / 3,
        fill: color,
      }),
    );
  }
});

document.getElementById('board')!.appendChild(svg);

// Legend
const legend = document.getElementById('legend')!;
const entries: Array<[string, string]> = [
  ['--wall', 'Wall (blocks move + sight)'],
  ['--cover', 'Cover (50% reduction)'],
  ['--brush', 'Brush (concealment)'],
  ['--spawn0', 'Player 1 spawn'],
  ['--spawn1', 'Player 2 spawn'],
];
for (const [varName, label] of entries) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.innerHTML = `<span class="swatch" style="background:${cssVar(varName)}"></span>${label}`;
  legend.appendChild(chip);
}
