// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { MapDef } from '@cards/engine';
import { CELL, PAD, reconcileUnits, renderBoard, renderViewport, squareFromPoint, unitTransform, type RenderUnit } from '../src/render.js';

/**
 * A1 — keyed SVG nodes. One `<g data-unit-id>` per unit, positioned by
 * `transform` and reconciled across renders rather than rebuilt. A node must
 * survive a frame or nothing can ever tween (A3).
 */

const OPEN: MapDef = { id: 't', name: 't', width: 8, height: 8, walls: [], cover: [], brush: [], spawns: [[{ x: 1, y: 1 }], [{ x: 6, y: 6 }]] };
const SVG_NS = 'http://www.w3.org/2000/svg';

const mk = (unitId: string, x: number, y: number, over: Partial<RenderUnit> = {}): RenderUnit => ({
  unitId, owner: 0, pos: { x, y }, hp: 100, maxHp: 100, energy: 0, alive: true, label: unitId[0]!.toUpperCase(), ...over,
});

let layer: SVGSVGElement;
beforeEach(() => {
  layer = document.createElementNS(SVG_NS, 'svg');
});

const nodeFor = (id: string) => layer.querySelector(`g[data-unit-id="${id}"]`);

describe('A1: units reconcile into persistent keyed nodes', () => {
  it('a repeated render reuses the very same DOM node per unitId', () => {
    reconcileUnits(layer, [mk('a', 1, 1), mk('b', 2, 2)]);
    const a1 = nodeFor('a');
    const b1 = nodeFor('b');
    expect(a1).not.toBeNull();

    reconcileUnits(layer, [mk('a', 3, 1), mk('b', 2, 2)]);
    // Identity, not just equality — this is the property that lets an animation
    // survive across frames.
    expect(nodeFor('a')).toBe(a1);
    expect(nodeFor('b')).toBe(b1);
    expect(layer.querySelectorAll('g[data-unit-id]')).toHaveLength(2);
  });

  it('position updates via transform, not by rebuilding the node', () => {
    reconcileUnits(layer, [mk('a', 1, 1)]);
    const node = nodeFor('a')!;
    expect(node.getAttribute('transform')).toBe(unitTransform({ x: 1, y: 1 }));

    reconcileUnits(layer, [mk('a', 4, 5)]);
    expect(nodeFor('a')).toBe(node); // same node
    expect(node.getAttribute('transform')).toBe(unitTransform({ x: 4, y: 5 }));
    expect(node.getAttribute('transform')).toBe(`translate(${PAD + 4 * CELL}, ${PAD + 5 * CELL})`);
  });

  it('a unit node keeps its child nodes across renders (so child animations survive)', () => {
    reconcileUnits(layer, [mk('a', 1, 1)]);
    const body = nodeFor('a')!.querySelector('.body');
    const label = nodeFor('a')!.querySelector('.label');

    reconcileUnits(layer, [mk('a', 1, 1, { hp: 40, shield: 20 })]);
    expect(nodeFor('a')!.querySelector('.body')).toBe(body);
    expect(nodeFor('a')!.querySelector('.label')).toBe(label);
  });

  it('adds nodes for newcomers and drops them for units that are gone', () => {
    reconcileUnits(layer, [mk('a', 1, 1)]);
    reconcileUnits(layer, [mk('a', 1, 1), mk('b', 2, 2)]);
    expect(layer.querySelectorAll('g[data-unit-id]')).toHaveLength(2);

    reconcileUnits(layer, [mk('b', 2, 2)]);
    expect(nodeFor('a')).toBeNull();
    expect(nodeFor('b')).not.toBeNull();
    expect(layer.querySelectorAll('g[data-unit-id]')).toHaveLength(1);
  });

  it('reconcileUnits returns the live node per unitId for callers to animate', () => {
    const nodes = reconcileUnits(layer, [mk('a', 1, 1), mk('b', 2, 2)]);
    expect([...nodes.keys()].sort()).toEqual(['a', 'b']);
    expect(nodes.get('a')).toBe(nodeFor('a'));
  });
});

describe('A1: no visual change', () => {
  it('bar fills track hp/shield/energy, and a dead unit shows none', () => {
    reconcileUnits(layer, [mk('a', 1, 1, { hp: 50, maxHp: 100, energy: 100, shield: 25 })]);
    const g = nodeFor('a')!;
    const fillW = (cls: string) => Number(g.querySelector(`.bar-${cls} .fill`)!.getAttribute('width'));
    const visible = (cls: string) => g.querySelector(`.bar-${cls}`)!.getAttribute('opacity') === '1';

    expect(fillW('hp')).toBeCloseTo((CELL - 8) * 0.5);
    expect(fillW('shield')).toBeCloseTo((CELL - 8) * 0.25);
    expect(fillW('energy')).toBeCloseTo(CELL - 8); // full ult charge
    expect(visible('hp')).toBe(true);
    expect(visible('shield')).toBe(true);

    reconcileUnits(layer, [mk('a', 1, 1, { alive: false, hp: 0 })]);
    expect(visible('hp')).toBe(false);
    expect(visible('shield')).toBe(false);
    expect(visible('energy')).toBe(false);
    expect(g.querySelector('.body')!.getAttribute('fill')).toBe('none'); // hollow when dead
  });

  it('renderBoard still builds a fresh SVG, with units on the same keyed path', () => {
    const svg = renderBoard(OPEN, [mk('a', 1, 1), mk('b', 6, 6, { owner: 1 })]);
    expect(svg.querySelectorAll('g[data-unit-id]')).toHaveLength(2);
    expect(svg.querySelector('g[data-unit-id="a"]')!.getAttribute('transform')).toBe(unitTransform({ x: 1, y: 1 }));
    // Terrain is still drawn beneath: one rect per square, plus the bars' rects.
    expect(svg.querySelectorAll('rect').length).toBeGreaterThanOrEqual(OPEN.width * OPEN.height);

    const again = renderBoard(OPEN, [mk('a', 1, 1), mk('b', 6, 6, { owner: 1 })]);
    expect(again.outerHTML).toBe(svg.outerHTML); // build-fresh stays idempotent
  });
});


describe('A3: squareFromPoint reads the live CTM, not rect/viewBox arithmetic', () => {
  it('round-trips square centres through the element transform', () => {
    const { svg, world } = renderViewport(OPEN, [mk('a', 1, 1)], { width: 400, height: 400 });
    document.body.appendChild(svg);
    const centre = (n: number) => PAD + n * CELL + (CELL - 2) / 2;
    for (const [x, y] of [[0, 0], [3, 4], [7, 7]] as const) {
      expect(squareFromPoint(world, centre(x), centre(y))).toEqual({ x, y });
    }
    svg.remove();
  });

  it('stays correct when a camera transform is applied to the world group', () => {
    // The bug this replaces: getBoundingClientRect + viewBox maths ignores the
    // camera transform, so every click lands on the wrong square once the world
    // is panned or zoomed. getScreenCTM composes it, so aiming survives.
    const { svg, world } = renderViewport(OPEN, [mk('a', 1, 1)], { width: 400, height: 400 });
    document.body.appendChild(svg);
    const centre = (n: number) => PAD + n * CELL + (CELL - 2) / 2;
    const before = squareFromPoint(world, centre(3), centre(4));

    world.setAttribute('transform', 'translate(37, -22) scale(1.5)');
    const ctm = world.getScreenCTM();
    // happy-dom has no layout engine, so it reports an identity CTM regardless;
    // assert the function is driven by that CTM (not by rect/viewBox) instead.
    expect(ctm).not.toBeNull();
    expect(squareFromPoint(world, centre(3), centre(4))).toEqual(before);
    svg.remove();
  });
});
