/**
 * A headless harness for the **real** controller (`startHotSeat`).
 *
 * Not a Vitest file (no `.test.` in the name) — fixtures only.
 *
 * `startHotSeat` is where the HUD, the draft reducer, the preview and the order
 * builder are actually wired together, and until KESTREL-CONE it had no test at
 * all: `createRenderer` builds a `WebGLRenderer` eagerly, which throws in any
 * headless DOM. So every piece it wires had several tests and the one question
 * that mattered — does pressing the button reach them — could not be asked. The
 * Kestrel cone bug is exactly what that gap hides.
 *
 * The seam is a renderer factory on `HotSeatUI`. This file supplies a stub that
 * satisfies `Renderer` in full and, crucially, **records what it was asked to
 * draw**: the `aim` highlight layer IS the ability preview the player sees, so
 * asserting on it is asserting on the preview rather than on a function that
 * happens to feed it.
 *
 * `squareFromPoint` maps a client point straight to a board square, so a test
 * "clicks square (7,10)" by dispatching a pointer event at (7, 10).
 */

import type { MapDef, TeamId, UnitOrders, Vec2 } from '@cards/engine';
import type { HotSeatUI, NetPlay } from '../src/app.js';
import type { HighlightLayer, PathLayer, ProjectionName, Renderer } from '../src/renderer3d.js';

/** What the stub renderer was told to draw, by layer. */
export interface DrawLog {
  highlights: Map<HighlightLayer, Vec2[]>;
  paths: { squares: Vec2[]; layer: PathLayer | undefined }[];
  shapes: Vec2[][];
}

export interface StubRenderer extends Renderer {
  readonly draw: DrawLog;
}

/**
 * A `Renderer` that draws nothing and remembers everything.
 *
 * Deliberately implements the whole interface rather than being cast from a
 * partial: a stub that satisfied only what today's controller happens to call
 * would go quietly out of date the first time the controller called something
 * else, and the failure would look like a renderer bug rather than a stale stub.
 */
export function stubRenderer(): StubRenderer {
  const draw: DrawLog = { highlights: new Map(), paths: [], shapes: [] };
  let orbit = false;
  return {
    draw,
    show: () => {},
    highlight: (layer, squares) => { draw.highlights.set(layer, squares.map((p) => ({ ...p }))); },
    // A board square per client pixel, so a test aims by naming the square.
    squareFromPoint: (clientX, clientY) => ({ x: Math.round(clientX), y: Math.round(clientY) }),
    screenPosition: (x, y) => ({ x, y }),
    setProjection: (_name: ProjectionName) => {},
    lookAt: () => {},
    fitBoard: () => {},
    objectFor: () => undefined,
    setUnitAt: () => {},
    setUnitFade: () => {},
    setSpotlight: () => {},
    setOrbitEnabled: (on) => { orbit = on; },
    orbitEnabled: () => orbit,
    focusOn: () => {},
    drawPath: (squares, _color, _dashed, layer) => {
      draw.paths.push({ squares: squares.map((p) => ({ ...p })), layer });
    },
    drawShape: (outline) => { draw.shapes.push(outline.map((p) => ({ ...p }))); },
    start: () => {},
    stop: () => {},
    onFrame: () => {},
    resize: () => {},
    setSafeInsets: () => {},
    render: () => {},
    dispose: () => {},
  };
}

/** The four DOM nodes the controller mounts into, plus the recording renderer. */
export function mountUI(): { ui: HotSeatUI; renderer: StubRenderer; controls: HTMLElement; board: HTMLElement } {
  const board = document.createElement('div');
  const status = document.createElement('div');
  const controls = document.createElement('div');
  const log = document.createElement('div');
  document.body.append(board, status, controls, log);
  const renderer = stubRenderer();
  return {
    ui: { board, status, controls, log, createRenderer: () => renderer },
    renderer,
    controls,
    board,
  };
}

/**
 * A `NetPlay` whose `submit` records the orders instead of sending them.
 *
 * Networked rather than hot-seat on purpose: the hot-seat resolves its own turn,
 * so the orders never exist as a value a test can hold. One seat, one submit,
 * and the exact `UnitOrders[]` the server would have received.
 */
export function recordingNet(seatId: string, team: TeamId, unitIds: string[]): {
  net: NetPlay;
  submitted: UnitOrders[][];
  resolve: (state: never, events: never) => void;
} {
  const submitted: UnitOrders[][] = [];
  let onResolved: (state: never, events: never) => void = () => {};
  const net: NetPlay = {
    seatId,
    team,
    unitIds,
    submit: (orders) => { submitted.push(orders.map((o) => structuredClone(o))); },
    onResolved: (handler) => { onResolved = handler as typeof onResolved; },
    onStatus: () => {},
    onTimer: () => {},
    onPresence: () => {},
    onControl: () => {},
    extend: () => {},
  };
  return { net, submitted, resolve: (state, events) => { onResolved(state, events); } };
}

/** Click a DOM node the way the HUD's own buttons are clicked. */
export const click = (node: Element | null | undefined): void => {
  if (node === null || node === undefined) throw new Error('nothing to click');
  (node as HTMLElement).click();
};

/** Point at a board square: the stub maps one client pixel to one square. */
export const aimAt = (board: HTMLElement, square: Vec2, type = 'click'): void => {
  board.dispatchEvent(new MouseEvent(type, {
    clientX: square.x, clientY: square.y, bubbles: true,
  }));
};

/** An empty field big enough for any aim, with spawns far apart. */
export const OPEN_MAP: MapDef = {
  id: 'harness', name: 'harness', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 2, y: 10 }, { x: 2, y: 12 }, { x: 2, y: 8 }, { x: 2, y: 14 }],
    [{ x: 18, y: 10 }, { x: 18, y: 12 }, { x: 18, y: 8 }, { x: 18, y: 14 }],
  ],
};
