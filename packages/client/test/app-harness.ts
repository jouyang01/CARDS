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
import type {
  HighlightLayer, PathLayer, ProjectionName, RenderDecoy, RenderTrap, RenderUnit, Renderer,
} from '../src/renderer3d.js';

/** What the stub renderer was told to draw, by layer. */
export interface DrawLog {
  highlights: Map<HighlightLayer, Vec2[]>;
  paths: { squares: Vec2[]; layer: PathLayer | undefined }[];
  shapes: Vec2[][];
  /** Every animation the app asked for, in order — Phase 8's assertable half. */
  clips: { unitId: string; clip: string; loop: boolean }[];
  /** Each `preloadCharacters` call, as the ids it was given. */
  preloads: string[][];
  /**
   * WALL-CAST-FIX — the **board itself**, as of the last `show()`: the units,
   * decoys and traps the viewing seat can currently see.
   *
   * The layers above are all *plans* — what an aim would do. This is what is
   * actually there, which is the only place a resolved turn shows up. Warding
   * Wall shipped with a correct preview and a broken cast precisely because
   * nothing in the harness could tell those two apart; recording `show()` is
   * what closes that.
   */
  board: { units: RenderUnit[]; decoys: RenderDecoy[]; traps: RenderTrap[] };
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
  const draw: DrawLog = {
    highlights: new Map(), paths: [], shapes: [], clips: [], preloads: [],
    board: { units: [], decoys: [], traps: [] },
  };
  let orbit = false;
  return {
    draw,
    show: (units, decoys = [], traps = []) => {
      draw.board = {
        units: units.map((u) => ({ ...u })),
        decoys: decoys.map((d) => ({ ...d })),
        traps: traps.map((t) => ({ ...t, pos: { ...t.pos } })),
      };
    },
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
    // Headless: there are no models to fetch and no mixer to drive. Recording
    // the requests rather than dropping them keeps them assertable — which
    // characters a match asks for is a decision worth pinning down.
    preloadCharacters: async (ids) => { draw.preloads.push([...ids]); },
    setUnitClip: (unitId, choice) => {
      draw.clips.push({ unitId, clip: choice.clip, loop: choice.loop });
    },
    // No models headless, so no character has clips — which is exactly the
    // fallback path every unit takes today, and the one that must stay working.
    clipsFor: () => undefined,
    setSpotlight: () => {},
    setOrbitEnabled: (on) => { orbit = on; },
    orbitEnabled: () => orbit,
    focusOn: () => {},
    drawPath: (squares, _color, _dashed, layer) => {
      draw.paths.push({ squares: squares.map((p) => ({ ...p })), layer });
    },
    // AIM-PREVIEW-TRUE: a list of outlines per call, one per locus.
    drawShape: (outlines) => {
      for (const outline of outlines) draw.shapes.push(outline.map((p) => ({ ...p })));
    },
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
export function mountUI(): {
  ui: HotSeatUI;
  renderer: StubRenderer;
  controls: HTMLElement;
  board: HTMLElement;
  status: HTMLElement;
  log: HTMLElement;
} {
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
    status,
    log,
  };
}

// ── HARNESS-BROADEN: the HUD, named ─────────────────────────────────────────
//
// The controller's own DOM, addressed by the classes `hud.ts` gives it. Here
// rather than in each spec because every flow starts by pressing one of these,
// and a spec that grew its own selector would be one rename away from testing
// nothing while still passing — `click(undefined)` throws, but
// `querySelectorAll('.hud-gone')` quietly returns an empty list.

/** Ability buttons in the hotbar, in the order the HUD lists them. */
export const abilityButtons = (controls: HTMLElement): HTMLButtonElement[] =>
  [...controls.querySelectorAll<HTMLButtonElement>('.hud-ability')];

/** Arm the ability whose button names it. Throws if the hotbar has no such button. */
export const armAbility = (controls: HTMLElement, name: string): void => {
  click(abilityButtons(controls).find((n) => (n.textContent ?? '').includes(name)));
};

/** The catalyst row (CAT1) — three slots, once per match. */
export const catalystButtons = (controls: HTMLElement): HTMLButtonElement[] =>
  [...controls.querySelectorAll<HTMLButtonElement>('.hud-catalyst')];

export const armCatalyst = (controls: HTMLElement, name: string): void => {
  click(catalystButtons(controls).find((n) => (n.textContent ?? '').includes(name)));
};

/** Move / Sprint / Chase / Clear, by their labels. */
export const moveButton = (controls: HTMLElement, label: string): HTMLButtonElement | undefined =>
  [...controls.querySelectorAll<HTMLButtonElement>('.hud-move')]
    .find((n) => (n.textContent ?? '').startsWith(label));

/** BASIC-MODES' aim-time profiles, shown only while a multi-mode ability is armed. */
export const modeButtons = (controls: HTMLElement): HTMLButtonElement[] =>
  [...controls.querySelectorAll<HTMLButtonElement>('.hud-mode')];

/**
 * LOCK IN.
 *
 * Skip used to wear `hud-lock` too, so this had to be addressed through
 * `.hud-lockrow` to avoid catching it; HUD-LAYOUT renamed Skip to `hud-skip`,
 * and the row qualifier stays anyway — it says *which* control this is rather
 * than relying on there happening to be one of them.
 */
export const lockIn = (controls: HTMLElement): void => {
  click(controls.querySelector('.hud-lockrow .hud-lock'));
};

/** The playback row, and its one control. */
export const playbackRow = (controls: HTMLElement): HTMLElement =>
  controls.querySelector<HTMLElement>('.hud-playback')!;
export const skipPlayback = (controls: HTMLElement): void => {
  click(playbackRow(controls).querySelector('.hud-skip'));
};

/** Aim at a square and commit it — hover then click, the two halves of UI1. */
export const aimAndCommit = (board: HTMLElement, square: Vec2): void => {
  aimAt(board, square, 'mousemove');
  aimAt(board, square, 'click');
};

/**
 * WALL-CAST-FIX — the traps standing on the board, as the last `show()` drew
 * them, sorted `"x,y"`. The resolved state, not a plan.
 *
 * Note what this cannot see: a hazard whose `lifetime` covers only the turn it
 * was placed — Warding Wall — is swept by the end-of-turn tick, so it is gone
 * from the board a test looks at *after* the turn. Proving that one cast means
 * proving it did something (see `unitHp`), not that it is still standing.
 */
export const boardTraps = (renderer: StubRenderer): string[] =>
  renderer.draw.board.traps.map((t) => `${t.pos.x},${t.pos.y}`).sort();

/** A unit's HP as the board last drew it — the resolved state, per unit. */
export const unitHp = (renderer: StubRenderer, unitId: string): number | undefined =>
  renderer.draw.board.units.find((u) => u.unitId === unitId)?.hp;

/** Where the board last drew a unit. */
export const unitAt = (renderer: StubRenderer, unitId: string): Vec2 | undefined =>
  renderer.draw.board.units.find((u) => u.unitId === unitId)?.pos;

/** The tiles the player is looking at: the renderer's own layers. */
export const layer = (renderer: StubRenderer, name: HighlightLayer): Vec2[] =>
  renderer.draw.highlights.get(name) ?? [];

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
  /**
   * DEATH-HANG — deliver a server Decision window, the way `net-boot.ts` does
   * when a `decision` frame arrives. The controller has no clock of its own in
   * a networked match (`startTimer` returns early), so a test that wants to ask
   * "is the timer running" has to play the server's part.
   */
  openWindow: (remainingMs: number | undefined, charges?: number) => void;
  /** The control map the server last sent — a death can change it. */
  setControl: (unitIds: string[]) => void;
} {
  const submitted: UnitOrders[][] = [];
  let onResolved: (state: never, events: never) => void = () => {};
  let onTimer: (remainingMs: number | undefined, charges: number) => void = () => {};
  let onControl: (unitIds: string[]) => void = () => {};
  const net: NetPlay = {
    seatId,
    team,
    unitIds,
    submit: (orders) => { submitted.push(orders.map((o) => structuredClone(o))); },
    onResolved: (handler) => { onResolved = handler as typeof onResolved; },
    onStatus: () => {},
    onTimer: (handler) => { onTimer = handler; },
    onPresence: () => {},
    onControl: (handler) => { onControl = handler; },
    extend: () => {},
  };
  return {
    net,
    submitted,
    resolve: (state, events) => { onResolved(state, events); },
    openWindow: (remainingMs, charges = 1) => { onTimer(remainingMs, charges); },
    setControl: (ids) => { onControl(ids); },
  };
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
