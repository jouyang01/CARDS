import { describe, expect, it } from 'vitest';
import { createMatch, type CharacterDef, type MapDef } from '@cards/engine';
import {
  IDLE,
  afterCommit,
  arm,
  hoverAbility,
  hoverBoard,
  hoverMove,
  previewAim,
  previewMovePath,
} from '../src/order-mode.js';
import { aimFor, commitAim as commitAimGate, emptyDraft, pathTo, type OrderDraft } from '../src/targeting.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';

/**
 * UI1-fix — **a committed action stops following the mouse.**
 *
 * The shipped bug: `onBoardClick` wrote the draft but left the mode armed, so
 * the next `mousemove` re-set `hover.square` and the preview went straight back
 * to painting the pointer's aim over the committed one. The order was stored and
 * permanently invisible, which reads as "it never locked in".
 *
 * These tests drive the state machine the way a player drives it — arm, hover,
 * click, hover again — and assert the painted aim after that last hover.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const OPEN: MapDef = { id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [], spawns: [[{ x: 1, y: 7 }], [{ x: 13, y: 7 }]] };

const state = () => createMatch(OPEN, '1v1', [[VEX], [BASTION]]);
const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
const grenade = VEX.abilities.find((a) => a.id === 'frag_grenade')!;

const setup = () => {
  const s = state();
  const unit = s.units.find((u) => u.characterId === 'vex')!;
  return { s, unit };
};

/** The same board with Wisp on it — the owner's Blink is the case under test. */
const wispSetup = () => {
  const s = createMatch(OPEN, '1v1', [[WISP], [BASTION]]);
  const unit = s.units.find((u) => u.characterId === 'wisp')!;
  return { s, unit };
};

/** Commit an aim exactly as `onBoardClick` does: write the draft, then disarm. */
const commitAim = (s: ReturnType<typeof state>, unit: ReturnType<typeof setup>['unit'], ability: typeof rail, draft: OrderDraft, square: { x: number; y: number }) => {
  const { aim, aimStep } = aimFor(OPEN, s, unit, ability, square);
  draft.aim = aim;
  draft.aimStep = aimStep;
  return afterCommit();
};

describe('UI1-fix: a committed aim no longer follows the mouse', () => {
  it('a directional aim is FIXED at the clicked tile, whatever the pointer does next', () => {
    const { s, unit } = setup();
    const draft = emptyDraft(unit.unitId);
    let it0 = arm('aim');

    // Aim at one tile, click to commit, then sweep the pointer somewhere else.
    it0 = hoverBoard(it0, { x: 9, y: 3 }) ?? it0;
    it0 = commitAim(s, unit, rail, draft, { x: 9, y: 3 });
    const committed = previewAim(OPEN, s, unit, rail, draft, it0);

    for (const elsewhere of [{ x: 4, y: 12 }, { x: 13, y: 7 }, { x: 1, y: 1 }]) {
      const moved = hoverBoard(it0, elsewhere);
      expect(moved, `hover at ${elsewhere.x},${elsewhere.y} should be ignored`).toBeUndefined();
      expect(previewAim(OPEN, s, unit, rail, draft, it0)).toEqual(committed);
    }
    // And it really is the aim that was clicked, not an empty one.
    expect(committed.aimStep).toBe(aimFor(OPEN, s, unit, rail, { x: 9, y: 3 }).aimStep);
  });

  it('a click-to-aim shape is fixed too — the circle stops chasing the pointer', () => {
    const { s, unit } = setup();
    const draft = emptyDraft(unit.unitId);
    let it0 = arm('aim');
    it0 = hoverBoard(it0, { x: 5, y: 7 }) ?? it0;
    it0 = commitAim(s, unit, grenade, draft, { x: 5, y: 7 });

    expect(hoverBoard(it0, { x: 2, y: 10 })).toBeUndefined();
    expect(previewAim(OPEN, s, unit, grenade, draft, it0).aim).toEqual([{ x: 5, y: 7 }]);
  });

  it('a drawn MOVE is fixed by its click too — the same defect lived in that branch', () => {
    const { s, unit } = setup();
    const draft = emptyDraft(unit.unitId);
    let it0 = arm('move');
    const target = { x: unit.pos.x + 2, y: unit.pos.y };
    it0 = hoverBoard(it0, target) ?? it0;

    draft.movePath = pathTo(OPEN, s, unit, target, 4);
    it0 = afterCommit();
    const committed = previewMovePath(OPEN, s, unit, draft, it0);
    expect(committed.length).toBeGreaterThan(0);

    expect(hoverBoard(it0, { x: unit.pos.x, y: unit.pos.y + 3 })).toBeUndefined();
    expect(previewMovePath(OPEN, s, unit, draft, it0)).toEqual(committed);
  });

  it('re-selecting the ability re-arms aiming, so the player is never stuck', () => {
    const { s, unit } = setup();
    const draft = emptyDraft(unit.unitId);
    let it0 = commitAim(s, unit, rail, draft, { x: 9, y: 3 });
    expect(it0.mode).toBe('idle');

    it0 = arm('aim'); // what `selectAbility` does
    const moved = hoverBoard(it0, { x: 3, y: 13 });
    expect(moved).toBeDefined();
    expect(previewAim(OPEN, s, unit, rail, draft, moved!).aimStep)
      .toBe(aimFor(OPEN, s, unit, rail, { x: 3, y: 13 }).aimStep);
  });
});

describe('UI1: hover previews without ever touching the draft', () => {
  it('an armed hover paints the POINTER’s aim while the draft stays untouched', () => {
    const { s, unit } = setup();
    const draft = emptyDraft(unit.unitId);
    const hovering = hoverBoard(arm('aim'), { x: 12, y: 7 })!;
    expect(previewAim(OPEN, s, unit, rail, draft, hovering).aimStep)
      .toBe(aimFor(OPEN, s, unit, rail, { x: 12, y: 7 }).aimStep);
    // The draft is still blank — looking is not choosing.
    expect(draft.aim).toEqual([]);
    expect(draft.aimStep).toBeUndefined();
  });

  it('falls back to the committed aim the moment the pointer leaves the board', () => {
    const { s, unit } = setup();
    const draft = emptyDraft(unit.unitId);
    let it0 = commitAim(s, unit, grenade, draft, { x: 5, y: 7 });
    it0 = arm('aim');
    // Inside the grenade's range 6 of Vex's spawn at (1,7): the old fixture
    // hovered (9,9), which is 8.25 away, and only painted because the preview
    // did not yet check (AIM-PREVIEW-RANGE).
    const hovering = hoverBoard(it0, { x: 6, y: 8 })!;
    expect(previewAim(OPEN, s, unit, grenade, draft, hovering).aim).toEqual([{ x: 6, y: 8 }]);

    const offBoard = hoverBoard(hovering, undefined)!;
    expect(previewAim(OPEN, s, unit, grenade, draft, offBoard).aim).toEqual([{ x: 5, y: 7 }]);
  });
});

/**
 * AIM-PREVIEW-RANGE — owner Dev Note: *"Blink and Intercept are both 'blink'
 * dashes that appear to have no range limit. The range shown when mousing over
 * the board should be locked to the effective range of the skill."*
 *
 * The abilities were range-limited all along; the *preview* was not. AIM-RANGE
 * taught the click to refuse an out-of-range square, but the hover kept painting
 * a landing marker and a yellow route wherever the pointer went — and a player
 * reads reach off the overlay, not off what happens when they click.
 */
describe('AIM-PREVIEW-RANGE: the hover paints only what the click would accept', () => {
  const blink = WISP.abilities.find((a) => a.id === 'blink')!;

  it('a blink paints nothing past its range', () => {
    const { s, unit } = wispSetup();
    const draft = emptyDraft(unit.unitId);
    const far = hoverBoard(arm('aim'), { x: 12, y: 7 })!; // well past range 4
    expect(previewAim(OPEN, s, unit, blink, draft, far).aim).toEqual([]);
  });

  it('…and paints the landing square inside it', () => {
    const { s, unit } = wispSetup();
    const draft = emptyDraft(unit.unitId);
    const near = hoverBoard(arm('aim'), { x: 4, y: 7 })!;
    expect(previewAim(OPEN, s, unit, blink, draft, near).aim).toEqual([{ x: 4, y: 7 }]);
  });

  it('a LINE is unaffected — an aim past its range is still a direction', () => {
    // The distinction worth keeping: a directional shape carries its aim as a
    // quantized *step* rather than a target square (AIM2), and a direction is
    // legal at any distance — the beam clips itself at `range`. So sweeping the
    // pointer past the end of a Rail Shot still rotates it, which is the
    // mouse-follow aiming AIM2-UX is built on.
    const { s, unit } = setup();
    const draft = emptyDraft(unit.unitId);
    const far = hoverBoard(arm('aim'), { x: 14, y: 7 })!; // 13 away, rail is range 8
    expect(previewAim(OPEN, s, unit, rail, draft, far).aimStep)
      .toBe(aimFor(OPEN, s, unit, rail, { x: 14, y: 7 }).aimStep);
  });

  it('the preview and the commit agree about whether there is an order at all', () => {
    // The property this buys: one resolver behind both, so "what I saw" and
    // "what I got" cannot differ — including on the answer "nothing".
    const { s, unit } = wispSetup();
    const draft = emptyDraft(unit.unitId);
    for (const square of [{ x: 4, y: 7 }, { x: 12, y: 7 }]) {
      const painted = previewAim(OPEN, s, unit, blink, draft, hoverBoard(arm('aim'), square)!).aim;
      const committed = commitAimGate(OPEN, s, unit, blink, square)?.aim ?? [];
      expect(painted, `${square.x},${square.y}`).toEqual(committed);
    }
  });
});

describe('UI1: hoverBoard reports "nothing changed" so a mousemove is not a repaint', () => {
  it('returns undefined for the same tile twice', () => {
    const first = hoverBoard(arm('aim'), { x: 4, y: 4 })!;
    expect(hoverBoard(first, { x: 4, y: 4 })).toBeUndefined();
    expect(hoverBoard(first, { x: 4, y: 5 })).toBeDefined();
  });

  it('returns undefined when leaving the board twice, and when nothing is armed', () => {
    const first = hoverBoard(arm('aim'), { x: 4, y: 4 })!;
    const left = hoverBoard(first, undefined)!;
    expect(left.hover.square).toBeUndefined();
    expect(hoverBoard(left, undefined)).toBeUndefined();
    expect(hoverBoard(IDLE, { x: 4, y: 4 })).toBeUndefined();
  });

  it('copies the square, so a caller cannot mutate the interaction through it', () => {
    const square = { x: 6, y: 6 };
    const next = hoverBoard(arm('aim'), square)!;
    square.x = 99;
    expect(next.hover.square).toEqual({ x: 6, y: 6 });
  });
});

describe('UI1: control hover and board hover are mutually exclusive', () => {
  it('hovering a control drops any board square, and vice versa', () => {
    const onBoard = hoverBoard(arm('aim'), { x: 4, y: 4 })!;
    const onControl = hoverAbility(onBoard, 'frag_grenade');
    expect(onControl.hover.square).toBeUndefined();
    expect(onControl.hover.abilityId).toBe('frag_grenade');
    expect(onControl.mode).toBe('aim'); // the armed mode survives a control hover

    const onMove = hoverMove(onControl, 'sprint');
    expect(onMove.hover.abilityId).toBeUndefined();
    expect(onMove.hover.move).toBe('sprint');
    expect(hoverAbility(onMove, undefined).hover).toEqual({});
    expect(hoverMove(onMove, undefined).hover).toEqual({});
  });
});
