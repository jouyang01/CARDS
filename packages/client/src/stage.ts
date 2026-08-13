/**
 * The stage — the ONLY renderer-specific half of playback (A3).
 *
 * It consumes the renderer-agnostic `Cue[]` from `choreograph()` and expresses
 * them with the Web Animations API on the keyed nodes from A1. Everything that
 * decides *what* happens lives upstream (engine → events → cues); this file only
 * decides how it looks, which is why swapping in a 3D renderer means replacing
 * this file and nothing else.
 *
 * Two rules keep it honest:
 * - **Cues decorate, they never mutate state.** `applyEvent` has already run for
 *   the phase before anything here plays, so dropping every animation leaves the
 *   same board. That is what makes "skip == watch" true by construction.
 * - **Everything is a WAAPI animation**, camera included, so `playbackRate` and
 *   `finish()` reach all of it uniformly — no rAF loop to keep in sync.
 */

import type { MapDef, Vec2 } from '@cards/engine';
import { cameraTransform, frameFor } from './camera.js';
import type { Cue } from './choreograph.js';
import type { ViewState } from './playback.js';
import { CELL, PAD, cssVar, paintOverlay, reconcileUnits, renderViewport, unitTransform, type RenderUnit } from './render.js';

/** Milliseconds per beat — the single pacing constant, tuned at playtest. */
export const MS_PER_BEAT = 420;

export interface Stage {
  readonly svg: SVGSVGElement;
  readonly world: SVGGElement;
  /** Reconcile the board to `view` without animating (the Decision screen). */
  show(view: ViewState): void;
  /** Animate one phase's cues over the already-applied `view`. Resolves when done. */
  play(cues: readonly Cue[], view: ViewState): Promise<void>;
  /** Finish every running animation immediately (skip). */
  finishAll(): void;
  setRate(rate: number): void;
  /** Auto-camera on/off (AR shipped both). */
  setAutoCamera(on: boolean): void;
}

export function createStage(container: Element, map: MapDef, viewport: { width: number; height: number }): Stage {
  const { svg, world } = renderViewport(map, [], viewport);
  container.replaceChildren(svg);
  let running: Animation[] = [];
  let rate = 1;
  let autoCamera = true;

  const toRender = (view: ViewState): RenderUnit[] =>
    [...view.units.values()].map((v) => ({
      unitId: v.unitId, owner: v.owner, pos: v.pos, hp: v.hp, maxHp: v.maxHp,
      energy: v.energy, alive: v.alive, label: (v.unitId[0] ?? '?').toUpperCase(), shield: v.shield,
    }));

  /** Decoys are overlay squares; they carry no keyed node of their own yet. */
  const paintDecoys = (view: ViewState): void => {
    for (const old of world.querySelectorAll('rect[data-decoy]')) old.remove();
    const squares = [...view.decoys.values()].map((d) => d.pos);
    if (squares.length === 0) return;
    const before = world.querySelectorAll('rect').length;
    paintOverlay(world, squares, cssVar('--spawn1'), 0.35);
    for (const r of [...world.querySelectorAll('rect')].slice(before)) r.setAttribute('data-decoy', '');
  };

  const nodesFor = (view: ViewState): Map<string, SVGGElement> => {
    const nodes = reconcileUnits(world, toRender(view));
    paintDecoys(view);
    return nodes;
  };

  const track = (a: Animation | undefined): void => {
    if (a === undefined) return;
    a.playbackRate = rate;
    running.push(a);
    void a.finished.catch(() => undefined).then(() => {
      running = running.filter((x) => x !== a);
    });
  };

  /** Squares the camera must hold for a cue (shooter ∪ area, or all movers). */
  const subjectsOf = (cues: readonly Cue[], view: ViewState): Vec2[] => {
    const out: Vec2[] = [];
    for (const cue of cues) {
      if (cue.kind === 'ability') {
        const shooter = view.units.get(cue.unitId);
        if (shooter) out.push(shooter.pos); // the shooter stays in frame with its area
        out.push(...cue.area);
      } else if (cue.kind === 'move' || cue.kind === 'displace') {
        out.push(cue.from, cue.to);
      } else if (cue.kind === 'impact' || cue.kind === 'death') {
        const u = view.units.get(cue.unitId);
        if (u) out.push(u.pos);
      }
    }
    return out;
  };

  function animateCue(cue: Cue, nodes: Map<string, SVGGElement>): void {
    const dur = cue.dur * MS_PER_BEAT;
    const delay = cue.t * MS_PER_BEAT;
    const node = 'unitId' in cue ? nodes.get(cue.unitId) : undefined;

    switch (cue.kind) {
      case 'move':
      case 'displace': {
        if (node === undefined) break;
        // The node already sits at its final square (state was applied first);
        // the tween replays the journey and lands exactly where it started.
        const arc = cue.kind === 'displace' ? [{ transform: unitTransform(cue.from) }, { transform: unitTransform(cue.to), offset: 1 }] : undefined;
        track(node.animate(arc ?? [{ transform: unitTransform(cue.from) }, { transform: unitTransform(cue.to) }], {
          duration: dur, delay, easing: cue.kind === 'displace' ? 'ease-out' : 'ease-in-out', fill: 'backwards',
        }));
        break;
      }
      case 'ability': {
        if (node === undefined) break;
        track(node.querySelector('.body')?.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }],
          { duration: dur, delay, easing: 'ease-out' },
        ));
        break;
      }
      case 'impact': {
        if (node !== undefined) {
          track(node.querySelector('.body')?.animate(
            [{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }],
            { duration: dur, delay, iterations: 2 },
          ));
        }
        const victim = nodes.get(cue.unitId);
        if (victim && cue.amount > 0) floatNumber(victim, `-${cue.amount}`, cssVar('--team1'), dur, delay);
        break;
      }
      case 'death': {
        if (node === undefined) break;
        // Deferred by the choreographer to the end of the phase, so the unit is
        // still standing while it plays the action it fired.
        track(node.animate([{ opacity: 1 }, { opacity: 0.35 }], { duration: dur, delay, fill: 'forwards' }));
        break;
      }
      default:
        break; // phase / respawn / decoy need no motion of their own
    }
  }

  function floatNumber(node: SVGGElement, text: string, color: string, dur: number, delay: number): void {
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String((CELL - 2) / 2));
    label.setAttribute('y', '-12');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '12');
    label.setAttribute('font-weight', '600');
    label.setAttribute('fill', color);
    label.setAttribute('pointer-events', 'none');
    label.textContent = text;
    node.appendChild(label);
    const anim = label.animate(
      [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-10px)' }],
      { duration: dur * 2, delay, easing: 'ease-out' },
    );
    track(anim);
    void anim.finished.catch(() => undefined).then(() => label.remove());
  }

  return {
    svg,
    world,
    show(view) {
      nodesFor(view);
    },
    async play(cues, view) {
      const nodes = nodesFor(view);
      for (const cue of cues) animateCue(cue, nodes);

      if (autoCamera) {
        const subjects = subjectsOf(cues, view);
        const frame = frameFor(subjects, viewport, map);
        // The camera is a WAAPI animation like everything else, so it inherits
        // playbackRate and finish() and participates in skip. Its easing overlaps
        // the previous cue's outro rather than waiting for it.
        track(world.animate(
          [{ transform: getComputedStyle(world).transform === 'none' ? cameraTransform(frame, viewport) : getComputedStyle(world).transform }, { transform: cameraTransform(frame, viewport) }],
          { duration: MS_PER_BEAT, easing: 'ease-in-out', fill: 'forwards' },
        ));
      }

      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
    },
    finishAll() {
      for (const a of [...running]) {
        try { a.finish(); } catch { /* a fill:none animation may already be done */ }
      }
      running = [];
    },
    setRate(next) {
      rate = next;
      for (const a of running) a.playbackRate = next;
    },
    setAutoCamera(on) {
      autoCamera = on;
      if (!on) world.style.transform = '';
    },
  };
}
