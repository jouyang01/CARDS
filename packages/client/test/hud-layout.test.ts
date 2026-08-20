// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCatalystPool, buildRoster, createMatch,
  type AbilityDef, type CatalystData, type CharacterDef, type Roster,
} from '@cards/engine';
import {
  createHud, type HudAbility, type HudCatalyst, type HudCharacter, type HudModel,
} from '../src/hud.js';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, mountUI, recordingNet } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * HUD-LAYOUT — reflow the in-match HUD so the board dominates the screen.
 *
 * *"The main game screen is too small in comparison to the buttons… 1. Catalysts
 * move to the left of the bottom next to character 2. Movement/clear moves to
 * the right of the bottom. 3. Lock in bar and timer moves to where catalyst used
 * to be 4. SCore and teams move to the top of the window. 5. Board expands and
 * is bigger and covers as much screen as possible where the timer/lock in bar
 * was."*
 *
 * Nothing here changes behaviour. Every block is the same component doing the
 * same thing in a different corner, which is exactly the kind of change that
 * passes a unit test and breaks the screen — so what is pinned below is **which
 * container each block is in**, and the two facts that make the board grow: the
 * centre column is three rows where it was five, and the score sits beside the
 * title rather than under it.
 *
 * The **geometry** — that the catalysts really are left of centre, that the
 * board's rect really did grow — is `e2e/render.spec.ts`. happy-dom resolves the
 * cascade but lays nothing out, so every `getBoundingClientRect` here would be
 * zero and any "it moved" assertion would be theatre. What a headless DOM *can*
 * answer is which parent a node has and which rules reach it, and that is what
 * this file asks.
 */

const CATALOG = [vex, bastion] as unknown as CharacterDef[];
const VEX = vex as unknown as CharacterDef;
const roster: Roster = buildRoster(CATALOG);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

let css = '';
beforeAll(() => {
  const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
  css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  expect(css.length, 'index.html still carries the stylesheet').toBeGreaterThan(0);
});

const handlers = () => ({
  selectCharacter: vi.fn(), selectAbility: vi.fn(), selectCatalyst: vi.fn(), hoverAbility: vi.fn(),
  selectMove: vi.fn(), selectChase: vi.fn(), hoverMove: vi.fn(), hold: vi.fn(), lock: vi.fn(),
  toggleProjection: vi.fn(), toggleOrbit: vi.fn(), extendTime: vi.fn(), selectMode: vi.fn(), selectRotation: vi.fn(),
});

const character = (): HudCharacter => ({
  unitId: 'vex-t0-0', name: 'Vex', archetype: 'firepower', colour: '#4f8cff',
  hp: 95, maxHp: 95, energy: 0, shield: 0, locked: false, hasOrder: false, statuses: [],
});
const ability = (def: AbilityDef): HudAbility => ({
  id: def.id, name: def.name, isUlt: false, available: true,
  cooldown: 0, selected: false, free: def.free === true, def,
});
/** The three a seat is dealt (`DEFAULT_CATALYSTS`), so the strip is realistic. */
const catalyst = (id: string): HudCatalyst => ({
  id, name: POOL[id]!.name, phase: POOL[id]!.phase, cost: 'free',
  spent: false, selected: false, def: POOL[id]!,
});

const model = (over: Partial<HudModel> = {}): HudModel => ({
  active: character(),
  roster: [character()],
  abilities: VEX.abilities.map(ability),
  modes: [],
  rotations: [],
  catalysts: ['second_wind', 'shift', 'adrenaline'].map(catalyst),
  move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
  chase: { armed: false, disabled: false },
  lock: { label: 'Lock In ▸' },
  view: { projection: 'Isometric', orbit: false },
  ...over,
});

let root: HTMLElement;
beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.appendChild(root);
});

/** The class names of a column's children, in order. */
const rows = (selector: string): string[] =>
  [...root.querySelector(selector)!.children].map((c) => c.className);

describe('HUD-LAYOUT: each block is in the corner the owner drew it in', () => {
  it('the catalysts are bottom-LEFT, beside the character (AC 1)', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    const strip = root.querySelector('.hud-catalysts')!;
    expect(root.querySelector('.hud-left')!.contains(strip), 'in the character column').toBe(true);
    expect(root.querySelector('.hud-centre')!.contains(strip), 'and out of the centre').toBe(false);
    expect(rows('.hud-left').at(-1), 'under the character it belongs to').toBe('hud-catalysts');
  });

  it('the movement controls are bottom-RIGHT (AC 2)', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    const moves = root.querySelector('.hud-moves')!;
    expect(root.querySelector('.hud-right')!.contains(moves)).toBe(true);
    expect(root.querySelector('.hud-centre')!.contains(moves), 'and out of the centre').toBe(false);
    // The column is bottom-aligned, so last means lowest — the corner drawn.
    expect(rows('.hud-right').at(-1)).toBe('hud-moves');
  });

  it('and all four of them are still there to press', () => {
    // A re-layout that dropped a control would pass every containment check
    // above. Move / Sprint / Chase / Clear, by name.
    const hud = createHud(root, handlers());
    hud.update(model());
    // Move carries its remaining budget in the label ("Move (4)"), so the check
    // is on the word rather than the whole string.
    expect([...root.querySelectorAll('.hud-move')]
      .map((n) => (n.textContent ?? '').split(' ')[0]))
      .toEqual(['Move', 'Sprint', 'Chase', 'Clear']);
    expect(root.querySelectorAll('.hud-catalyst'), 'and three catalyst slots').toHaveLength(3);
  });

  it('the centre column is Lock In, the abilities, the qualifiers — and nothing else (AC 3)', () => {
    // The whole of AC 5's mechanism: five stacked rows became three, and the
    // height that frees is what the board takes. Asserted as an exact list
    // rather than as "contains", because a row creeping back in is the way this
    // regresses.
    //
    // WALL-ROTATE adds a fourth entry, and it is the same *kind* of row as the
    // mode row beside it: both qualify the armed ability, both are hidden unless
    // one is armed that wants them, so neither costs the board any height in the
    // common case. The exact-list assertion is what makes that a decision rather
    // than a drift — the next row to appear here has to be argued for too.
    const hud = createHud(root, handlers());
    hud.update(model());
    expect(rows('.hud-centre'))
      .toEqual(['hud-lockrow', 'hud-hotbar', 'hud-modes', 'hud-rotations']);
  });

  it('and the two qualifier rows are both hidden until something wants them', () => {
    // The reason a fourth row is affordable: with nothing armed, neither takes
    // any height at all.
    const hud = createHud(root, handlers());
    hud.update(model());
    for (const cls of ['.hud-modes', '.hud-rotations']) {
      expect(root.querySelector<HTMLElement>(cls)?.style.display, cls).toBe('none');
    }
  });

  it('with the timer bar directly over the hotbar it times', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    const lockRow = root.querySelector('.hud-lockrow')!;
    expect(lockRow.contains(root.querySelector('.hud-lock')), 'the button').toBe(true);
    expect(lockRow.contains(root.querySelector('.hud-timer')), 'and the bar').toBe(true);
    expect(rows('.hud-centre').indexOf('hud-lockrow'))
      .toBeLessThan(rows('.hud-centre').indexOf('hud-hotbar'));
  });
});

describe('HUD-LAYOUT: Skip is no longer a Lock In (OQ 2026-09-20 #5)', () => {
  it('the playback control has its own class', () => {
    const hud = createHud(root, handlers());
    hud.update(model());
    expect(root.querySelector('.hud-playback .hud-skip'), 'Skip is `hud-skip`').toBeTruthy();
    expect(root.querySelectorAll('.hud-lock'), 'and there is exactly one Lock In').toHaveLength(1);
  });

  it('and it still skips', () => {
    // The rename must not have cost the wiring. It is a different selector, not
    // a different button.
    const hud = createHud(root, handlers());
    hud.update(model());
    const onSkip = vi.fn();
    hud.showPlayback(onSkip);
    (root.querySelector('.hud-skip') as HTMLButtonElement).click();
    expect(onSkip).toHaveBeenCalled();
  });

  it('it looks like Lock In, because it plays the same role', () => {
    // The rename is about what a *selector* catches, not about the design. If
    // the two stopped matching, Skip would become an unstyled default button.
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const hud = createHud(root, handlers());
    hud.update(model());
    const skip = getComputedStyle(root.querySelector('.hud-skip')!);
    const lock = getComputedStyle(root.querySelector('.hud-lock')!);
    expect(skip.backgroundColor).toBe(lock.backgroundColor);
    expect(skip.minHeight).toBe('44px');
  });
});

describe('HUD-LAYOUT: playback still takes the ordering controls with it', () => {
  it('the catalysts and the movement row go too, now that they have moved out', () => {
    // They used to be inside `.hud-centre`, which playback hid. Having moved to
    // the side columns they are only hidden because `setOrdering` takes all
    // three — a re-layout that left a live Clear button over a resolving turn
    // would be the regression.
    const hud = createHud(root, handlers());
    hud.update(model());
    hud.showPlayback(() => {});
    for (const column of ['.hud-left', '.hud-centre', '.hud-right']) {
      expect((root.querySelector(column) as HTMLElement).style.display, column).toBe('none');
    }
    hud.update(model());
    for (const column of ['.hud-left', '.hud-centre', '.hud-right']) {
      expect((root.querySelector(column) as HTMLElement).style.display, column).toBe('');
    }
  });
});

describe('HUD-LAYOUT: the score and the team pips are at the top (AC 4)', () => {
  it('the page puts the band above everything else in the overlay', () => {
    const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
    const app = /<div id="app">([\s\S]*?)<div id="controls"/.exec(html)?.[1] ?? '';
    expect(app, 'the top band exists').toContain('id="topchrome"');
    expect(app.indexOf('id="topchrome"'), 'and it is the first thing in the overlay')
      .toBeLessThan(app.indexOf('id="title-block"'));
  });

  it('the controller mounts the scoreboard into that band, not under the status line', () => {
    // The wiring, driven through the real controller. The band is `index.html`'s
    // and the scoreboard is `app.ts`'s, so "does one end up in the other" is a
    // question neither file can answer alone.
    const ui = mountUI();
    const band = document.createElement('div');
    band.id = 'topchrome';
    document.body.appendChild(band);
    const opening = createMatch(OPEN_MAP, '1v1', [[VEX], [bastion as unknown as CharacterDef]]);
    const wire = recordingNet('s0', 0, [opening.units[0]!.unitId]);
    startHotSeat(ui.ui, OPEN_MAP, roster, [[VEX], [bastion as unknown as CharacterDef]],
      '1v1', [1, 1], POOL, undefined, wire.net, opening);

    const score = document.querySelector('.scoreboard')!;
    expect(score, 'the readout was built').toBeTruthy();
    expect(band.contains(score), 'and it is in the top band').toBe(true);
  });

  it('and falls back to where it always was when there is no band', () => {
    // The harness mounts four bare nodes with no page around them. A controller
    // that required `#topchrome` would crash every test that is not this one.
    const ui = mountUI();
    const opening = createMatch(OPEN_MAP, '1v1', [[VEX], [bastion as unknown as CharacterDef]]);
    const wire = recordingNet('s0', 0, [opening.units[0]!.unitId]);
    startHotSeat(ui.ui, OPEN_MAP, roster, [[VEX], [bastion as unknown as CharacterDef]],
      '1v1', [1, 1], POOL, undefined, wire.net, opening);
    expect(ui.status.nextElementSibling?.className).toBe('scoreboard');
  });

  it('the band lays the two out side by side, so it is one title tall', () => {
    // Why the board gains at the top as well as the bottom: stacked, the score
    // started a title's height down the window and the board's inset followed.
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const band = document.createElement('div');
    band.id = 'topchrome';
    document.body.appendChild(band);
    expect(getComputedStyle(band).display).toBe('flex');
    expect(getComputedStyle(band).flexDirection, 'a row, not a stack').not.toBe('column');
  });
});

describe('HUD-LAYOUT: the small-screen rule did not eat the catalysts', () => {
  it('at 820px the character panel goes and the catalyst strip stays', () => {
    // The trap in moving them: `.hud-left { display: none }` used to drop a
    // panel whose HP and energy are also on the unit's own billboarded bars.
    // Applied unchanged it would now silently delete three once-per-match
    // controls from every small screen.
    (globalThis as unknown as { happyDOM: { setViewport(v: { width: number }): void } })
      .happyDOM.setViewport({ width: 800 });
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const hud = createHud(root, handlers());
    hud.update(model());

    expect(getComputedStyle(root.querySelector('.hud-catalysts')!).display,
      'the catalysts survive').not.toBe('none');
    expect(getComputedStyle(root.querySelector('.hud-moves')!).display,
      'and so does movement').not.toBe('none');
    expect(getComputedStyle(root.querySelector('.hud-bars')!).display,
      'the HP/energy panel is what goes').toBe('none');
    (globalThis as unknown as { happyDOM: { setViewport(v: { width: number }): void } })
      .happyDOM.setViewport({ width: 1024 });
  });
});
